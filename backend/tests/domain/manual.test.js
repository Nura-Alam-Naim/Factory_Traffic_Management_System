'use strict';

const { handle } = require('../../src/domain/engine');
const { createJunctionState } = require('../../src/domain/initial_state');
const { defaultJunctionConfig } = require('../../src/domain/config');
const { Mode, Stage, Direction, Signal } = require('../../src/domain/models');
const { manualRequest, returnToAutomatic } = require('../../src/domain/events');
const { FakeClock } = require('../helpers/clock');

describe('Manual Mode', () => {
  let state;
  let clock;

  beforeEach(() => {
    clock = new FakeClock(1000);
    state = createJunctionState('A', defaultJunctionConfig(), clock.now());
    
    state.mode = Mode.AUTOMATIC;
    state.stage = Stage.GREEN;
    state.phase = 'EW';
    state.actualSignals = { NORTH: Signal.RED, SOUTH: Signal.RED, EAST: Signal.GREEN, WEST: Signal.GREEN };
    state.stageConfirmedAt = clock.now();
  });

  test('Manual request accepts and triggers switch', () => {
    const result = handle(state, manualRequest('admin1', Direction.NORTH), clock.now());
    
    expect(result.outcome.status).toBe('ACCEPTED');
    expect(state.mode).toBe(Mode.MANUAL);
    expect(state.manualLease.adminId).toBe('admin1');
    expect(state.stage).toBe(Stage.YELLOW);
  });

  test('Second admin gets conflict', () => {
    handle(state, manualRequest('admin1', Direction.NORTH), clock.now());
    
    const result = handle(state, manualRequest('admin2', Direction.SOUTH), clock.now());
    expect(result.outcome.status).toBe('REJECTED');
    expect(result.outcome.code).toBe(409);
    expect(state.manualLease.adminId).toBe('admin1');
  });

  test('Same admin changes direction', () => {
    handle(state, manualRequest('admin1', Direction.NORTH), clock.now());
    
    const result = handle(state, manualRequest('admin1', Direction.EAST), clock.now());
    expect(result.outcome.status).toBe('ACCEPTED');
    expect(state.manualLease.direction).toBe(Direction.EAST);
  });

  test('Lease expiry returns to AUTOMATIC', () => {
    handle(state, manualRequest('admin1', Direction.NORTH), clock.now());
    expect(state.mode).toBe(Mode.MANUAL);

    clock.advance(state.config.policies.manualLeaseMs + 1);
    handle(state, { type: 'TICK' }, clock.now());

    expect(state.mode).toBe(Mode.AUTOMATIC);
    expect(state.manualLease).toBeNull();
  });

  test('Return to automatic clears lease', () => {
    handle(state, manualRequest('admin1', Direction.NORTH), clock.now());
    
    const result = handle(state, returnToAutomatic('admin1'), clock.now());
    expect(result.outcome.status).toBe('ACCEPTED');
    
    handle(state, { type: 'TICK' }, clock.now());
    expect(state.mode).toBe(Mode.AUTOMATIC);
  });
});
