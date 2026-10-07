'use strict';

const { handle } = require('../../src/domain/engine');
const { createJunctionState } = require('../../src/domain/initial_state');
const { defaultJunctionConfig } = require('../../src/domain/config');
const { Mode, Stage, Signal, Direction } = require('../../src/domain/models');
const { sensorEvent } = require('../../src/domain/events');
const { FakeClock } = require('../helpers/clock');

describe('Emergency Mode', () => {
  let state;
  let clock;

  beforeEach(() => {
    clock = new FakeClock(1000);
    state = createJunctionState('A', defaultJunctionConfig(), clock.now());
    
    // Setup healthy automatic state in EW green
    state.mode = Mode.AUTOMATIC;
    state.stage = Stage.GREEN;
    state.phase = 'EW';
    state.actualSignals = { NORTH: Signal.RED, SOUTH: Signal.RED, EAST: Signal.GREEN, WEST: Signal.GREEN };
    state.stageConfirmedAt = clock.now();
  });

  test('Preemption goes through safe sequence (YELLOW -> ALL_RED -> GREEN)', () => {
    // 1. Emergency truck arrives at NORTH
    const evt = sensorEvent('1', 'A', Direction.NORTH, 'e1', 'EMERGENCY', 'VEHICLE_ARRIVED', 1, clock.now(), clock.now());
    const result = handle(state, evt, clock.now());
    state = result.state;

    // Mode is EMERGENCY, target is NS. It should immediately start YELLOW for EW.
    expect(state.mode).toBe(Mode.EMERGENCY);
    expect(state.stage).toBe(Stage.YELLOW);
    expect(state.pendingCommand).toBeTruthy();
    
    // Simulate ACK
    state.pendingCommand = null;
    state.stageConfirmedAt = clock.now();

    // Advance 4s -> still YELLOW
    clock.advance(4000);
    handle(state, { type: 'TICK' }, clock.now());
    expect(state.stage).toBe(Stage.YELLOW);

    // Advance 1s -> ALL_RED
    clock.advance(1000);
    handle(state, { type: 'TICK' }, clock.now());
    expect(state.stage).toBe(Stage.ALL_RED);

    // Simulate ACK + RED actuals
    state.pendingCommand = null;
    state.stageConfirmedAt = clock.now();
    state.actualSignals.EAST = Signal.RED; state.actualSignals.WEST = Signal.RED;

    // Advance 2s -> GREEN for NS
    clock.advance(2000);
    handle(state, { type: 'TICK' }, clock.now());
    expect(state.stage).toBe(Stage.GREEN);
    expect(state.phase).toBe('NS');
  });

  test('Already GREEN on target phase -> hold GREEN', () => {
    state.phase = 'NS';
    state.actualSignals = { NORTH: Signal.GREEN, SOUTH: Signal.GREEN, EAST: Signal.RED, WEST: Signal.RED };

    const evt = sensorEvent('1', 'A', Direction.NORTH, 'e1', 'EMERGENCY', 'VEHICLE_ARRIVED', 1, clock.now(), clock.now());
    handle(state, evt, clock.now());

    expect(state.mode).toBe(Mode.EMERGENCY);
    expect(state.stage).toBe(Stage.GREEN);
    expect(state.pendingCommand).toBeNull(); // No switch
  });

  test('Conflicting emergencies -> first wins, no flapping', () => {
    // NS emergency
    handle(state, sensorEvent('1', 'A', Direction.NORTH, 'e1', 'EMERGENCY', 'VEHICLE_ARRIVED', 1, clock.now(), clock.now()), clock.now());
    
    // EW emergency arrives slightly later
    clock.advance(1000);
    handle(state, sensorEvent('2', 'A', Direction.EAST, 'e2', 'EMERGENCY', 'VEHICLE_ARRIVED', 2, clock.now(), clock.now()), clock.now());

    // Should prioritize NS
    expect(state.emergency.active[0].vehicleId).toBe('e1');
    expect(state.emergency.active[1].vehicleId).toBe('e2');
  });
});
