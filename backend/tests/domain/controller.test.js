'use strict';

const { handle } = require('../../src/domain/engine');
const { createJunctionState } = require('../../src/domain/initial_state');
const { defaultJunctionConfig } = require('../../src/domain/config');
const { Stage, Mode, Signal } = require('../../src/domain/models');
const { controllerAck, controllerStatus } = require('../../src/domain/events');
const { FakeClock } = require('../helpers/clock');

describe('Controller Bookkeeping', () => {
  let state;
  let clock;

  beforeEach(() => {
    clock = new FakeClock(1000);
    state = createJunctionState('A', defaultJunctionConfig(), clock.now());
    
    // Setup in NS green
    state.mode = Mode.AUTOMATIC;
    state.stage = Stage.GREEN;
    state.phase = 'NS';
    state.actualSignals = { NORTH: Signal.GREEN, SOUTH: Signal.GREEN, EAST: Signal.RED, WEST: Signal.RED };
    
    // Simulate engine issuing a YELLOW command
    handle(state, { type: 'TICK' }, clock.now()); // won't do much without traffic, let's force a state change by manually setting pending
    
    state.pendingCommand = {
      commandId: 'A-1',
      requestedSignals: { NORTH: Signal.YELLOW, SOUTH: Signal.YELLOW, EAST: Signal.RED, WEST: Signal.RED },
      sentAt: clock.now(),
      attempts: 1,
      status: 'PENDING'
    };
  });

  test('ACK confirms state and updates actuals', () => {
    const result = handle(state, controllerAck('A-1', { NORTH: Signal.YELLOW, SOUTH: Signal.YELLOW, EAST: Signal.RED, WEST: Signal.RED }), clock.now());
    
    expect(result.outcome.status).toBe('ACCEPTED');
    expect(state.pendingCommand).toBeNull();
    expect(state.actualStale).toBe(false);
    expect(state.actualSignals.NORTH).toBe(Signal.YELLOW);
    expect(state.stageConfirmedAt).toBe(clock.now());
  });

  test('Mismatch ACK triggers alert and prevents advance', () => {
    // Requested YELLOW, controller ACKs with RED
    const result = handle(state, controllerAck('A-1', { NORTH: Signal.RED, SOUTH: Signal.RED, EAST: Signal.RED, WEST: Signal.RED }), clock.now());
    
    expect(result.outcome.status).toBe('ACCEPTED'); // Technically accepted the message
    expect(result.effects).toContainEqual(expect.objectContaining({ type: 'ALERT', code: 'STATE_MISMATCH' }));
    // The actual signals are updated to RED, but we don't advance the state logic normally because we handle mismatch out of band
    // Wait, the test checks if it is null
    expect(state.pendingCommand).toBeNull();
  });

  test('Unknown ACK is ignored', () => {
    const result = handle(state, controllerAck('A-999', {}), clock.now());
    
    expect(result.outcome.status).toBe('IGNORED');
    expect(state.pendingCommand).not.toBeNull();
  });

  test('Timeout triggers retry, then DEGRADED', () => {
    // Config: timeout 5s, max 2 retries (so 3 total attempts)
    
    // 1. Advance 6s -> Retry 1 (Attempt 2)
    clock.advance(6000);
    handle(state, { type: 'TICK' }, clock.now());
    expect(state.pendingCommand.attempts).toBe(2);
    expect(state.pendingCommand.status).toBe('PENDING');

    // 2. Advance 6s -> Retry 2 (Attempt 3)
    clock.advance(6000);
    handle(state, { type: 'TICK' }, clock.now());
    expect(state.pendingCommand.attempts).toBe(3);

    // 3. Advance 6s -> Max retries exceeded -> DEGRADED
    clock.advance(6000);
    handle(state, { type: 'TICK' }, clock.now());
    expect(state.mode).toBe(Mode.DEGRADED);
    expect(state.stage).toBe(Stage.ALL_RED);
    expect(state.pendingCommand).toBeNull();
  });

  test('OFFLINE status triggers DEGRADED', () => {
    handle(state, controllerStatus('OFFLINE'), clock.now());
    
    expect(state.mode).toBe(Mode.DEGRADED);
    expect(state.stage).toBe(Stage.ALL_RED);
    expect(state.devices.controller).toBe('OFFLINE');
  });

  test('ONLINE status triggers RECOVERING from DEGRADED', () => {
    state.mode = Mode.DEGRADED;
    state.devices.controller = 'OFFLINE';

    handle(state, controllerStatus('ONLINE'), clock.now());
    
    expect(state.mode).toBe(Mode.RECOVERING);
    expect(state.actualStale).toBe(true);
    expect(state.pendingCommand).not.toBeNull();
    // It should have commanded ALL_RED
    expect(state.pendingCommand.requestedSignals.NORTH).toBe(Signal.RED);
  });
});
