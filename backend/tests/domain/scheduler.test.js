'use strict';

const { choosePhase } = require('../../src/domain/scheduler');
const { createJunctionState } = require('../../src/domain/initial_state');
const { defaultJunctionConfig } = require('../../src/domain/config');
const { Stage, VehicleType } = require('../../src/domain/models');

describe('Scheduler', () => {
  let state;

  beforeEach(() => {
    state = createJunctionState('A', defaultJunctionConfig(), 0);
    // Assume we are in NS phase normally
    state.stage = Stage.GREEN;
    state.phase = 'NS';
    // By default, assume min green is met (say it started 20s ago)
    state.stageConfirmedAt = -20000;
  });

  test('Empty junction does not switch', () => {
    const decision = choosePhase(state, 0);
    expect(decision.switch).toBe(false);
    expect(decision.reason).toMatch(/Both phases empty/);
  });

  test('Current empty, other has traffic -> switches', () => {
    state.queues.EAST['v1'] = { type: VehicleType.EMPLOYEE, receivedAt: 0 };
    const decision = choosePhase(state, 1000);
    expect(decision.switch).toBe(true);
    expect(decision.target).toBe('EW');
    expect(decision.reason).toMatch(/Current empty, other waiting/);
  });

  test('Does not switch before min green', () => {
    state.queues.EAST['v1'] = { type: VehicleType.EMPLOYEE, receivedAt: 0 };
    // Started 5s ago
    state.stageConfirmedAt = -5000;
    
    const decision = choosePhase(state, 0);
    expect(decision.switch).toBe(false);
    expect(decision.reason).toMatch(/Min green not met/);
  });

  test('Max green forces switch when other side is waiting', () => {
    state.queues.EAST['v1'] = { type: VehicleType.EMPLOYEE, receivedAt: 0 };
    // Started 70s ago
    state.stageConfirmedAt = -70000;

    const decision = choosePhase(state, 0);
    expect(decision.switch).toBe(true);
    expect(decision.target).toBe('EW');
    expect(decision.reason).toMatch(/Max green reached/);
  });

  test('Hysteresis prevents flapping', () => {
    // Current (NS) score: 1 truck (5)
    state.queues.NORTH['t1'] = { type: VehicleType.TRUCK, receivedAt: 0 };
    
    // Other (EW) score: 5 employees (5) + a tiny bit of wait time
    state.queues.EAST['e1'] = { type: VehicleType.EMPLOYEE, receivedAt: -500 };
    state.queues.EAST['e2'] = { type: VehicleType.EMPLOYEE, receivedAt: 0 };
    state.queues.EAST['e3'] = { type: VehicleType.EMPLOYEE, receivedAt: 0 };
    state.queues.EAST['e4'] = { type: VehicleType.EMPLOYEE, receivedAt: 0 };
    state.queues.EAST['e5'] = { type: VehicleType.EMPLOYEE, receivedAt: 0 };

    // So EW score > NS score, but not by 1.2x
    const decision = choosePhase(state, 0);
    expect(decision.switch).toBe(false);
    expect(decision.reason).toMatch(/not sufficient to overcome hysteresis/);
  });

  test('Starvation overrides hysteresis', () => {
    state.queues.NORTH['t1'] = { type: VehicleType.TRUCK, receivedAt: 0 };
    
    // EW has 1 employee but waiting for 100 seconds (max wait is 90s)
    state.queues.EAST['e1'] = { type: VehicleType.EMPLOYEE, receivedAt: -100000 };

    const decision = choosePhase(state, 0);
    expect(decision.switch).toBe(true);
    expect(decision.target).toBe('EW');
    expect(decision.reason).toMatch(/Starvation/);
  });
});
