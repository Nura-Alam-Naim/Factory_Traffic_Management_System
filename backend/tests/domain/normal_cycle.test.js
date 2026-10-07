'use strict';

const { startYellow, startAllRed, startGreen, isStageComplete } = require('../../src/domain/state_machine');
const { Stage, Signal } = require('../../src/domain/models');
const { defaultJunctionConfig } = require('../../src/domain/config');
const { createJunctionState } = require('../../src/domain/initial_state');
const { FakeClock } = require('../helpers/clock');

describe('Normal Cycle', () => {
  let state;
  let clock;
  let config;

  beforeEach(() => {
    clock = new FakeClock(0);
    config = defaultJunctionConfig();
    // Use smaller timings for test if we want, but default is fine
    state = createJunctionState('A', config, clock.now());
    
    // Simulate we are in NS GREEN and actuals are matching
    state.mode = 'AUTOMATIC';
    state.stage = Stage.GREEN;
    state.phase = 'NS';
    state.actualSignals = { NORTH: Signal.GREEN, SOUTH: Signal.GREEN, EAST: Signal.RED, WEST: Signal.RED };
    state.stageConfirmedAt = clock.now();
  });

  test('Full transition sequence: GREEN -> YELLOW -> ALL_RED -> GREEN', () => {
    // 1. Advance min green so we can switch
    clock.advance(config.timings.minGreenMs);
    expect(isStageComplete(state, clock.now())).toBe(true);

    // 2. Start YELLOW
    let effects = startYellow(state, clock.now(), 'Switch triggered');
    expect(state.stage).toBe(Stage.YELLOW);
    expect(state.desiredSignals.NORTH).toBe(Signal.YELLOW);
    expect(state.pendingCommand).toBeTruthy();
    expect(effects.length).toBe(2);
    expect(effects[0].type).toBe('SEND_COMMAND');

    // Simulate ACK
    state.pendingCommand = null;
    state.stageConfirmedAt = clock.now();

    // Not complete yet
    clock.advance(config.timings.yellowMs - 1);
    expect(isStageComplete(state, clock.now())).toBe(false);
    
    // Complete YELLOW
    clock.advance(1);
    expect(isStageComplete(state, clock.now())).toBe(true);

    // 3. Start ALL_RED
    effects = startAllRed(state, 'EW', clock.now(), 'Yellow done');
    expect(state.stage).toBe(Stage.ALL_RED);
    expect(state.nextPhase).toBe('EW');
    expect(state.desiredSignals.NORTH).toBe(Signal.RED);

    // Simulate ACK
    state.pendingCommand = null;
    state.stageConfirmedAt = clock.now();
    // Simulate actual states arriving as RED
    state.actualSignals = { NORTH: Signal.RED, SOUTH: Signal.RED, EAST: Signal.RED, WEST: Signal.RED };

    // Not complete yet
    clock.advance(config.timings.allRedMs - 1);
    expect(isStageComplete(state, clock.now())).toBe(false);

    // Complete ALL_RED
    clock.advance(1);
    expect(isStageComplete(state, clock.now())).toBe(true);

    // 4. Start GREEN for EW
    effects = startGreen(state, 'EW', clock.now(), 'All red done');
    expect(state.stage).toBe(Stage.GREEN);
    expect(state.phase).toBe('EW');
    expect(state.desiredSignals.EAST).toBe(Signal.GREEN);
  });
});
