'use strict';

const { guardTransition, SafetyViolation } = require('../../src/domain/safety');
const { Stage, Signal, Mode, Direction } = require('../../src/domain/models');
const { defaultJunctionConfig, validateConfig } = require('../../src/domain/config');

describe('Safety Guard', () => {
  let config;
  let state;

  beforeEach(() => {
    config = defaultJunctionConfig();
    state = {
      config,
      mode: Mode.AUTOMATIC,
      stage: Stage.GREEN,
      phase: 'NS',
      actualSignals: {
        [Direction.NORTH]: Signal.GREEN,
        [Direction.SOUTH]: Signal.GREEN,
        [Direction.EAST]: Signal.RED,
        [Direction.WEST]: Signal.RED,
      },
      pendingCommand: null,
    };
  });

  describe('Edge Rules', () => {
    test('Allows GREEN -> YELLOW', () => {
      expect(() => guardTransition(state, Stage.YELLOW, 'NS')).not.toThrow();
    });

    test('Rejects GREEN -> GREEN', () => {
      expect(() => guardTransition(state, Stage.GREEN, 'EW')).toThrow(SafetyViolation);
    });

    test('Rejects GREEN -> ALL_RED directly', () => {
      expect(() => guardTransition(state, Stage.ALL_RED, 'EW')).toThrow(SafetyViolation);
    });

    test('Allows YELLOW -> ALL_RED', () => {
      state.stage = Stage.YELLOW;
      expect(() => guardTransition(state, Stage.ALL_RED, 'EW')).not.toThrow();
    });

    test('Rejects YELLOW -> GREEN', () => {
      state.stage = Stage.YELLOW;
      expect(() => guardTransition(state, Stage.GREEN, 'NS')).toThrow(SafetyViolation);
    });
  });

  describe('Conflict Rules', () => {
    test('Rejects GREEN on EW while actual NS is not RED', () => {
      state.stage = Stage.ALL_RED;
      state.phase = null;
      // Actual NS is still GREEN!
      expect(() => guardTransition(state, Stage.GREEN, 'EW')).toThrow(/conflicting actual/);
    });

    test('Allows GREEN on EW when actual NS is RED', () => {
      state.stage = Stage.ALL_RED;
      state.phase = null;
      state.actualSignals[Direction.NORTH] = Signal.RED;
      state.actualSignals[Direction.SOUTH] = Signal.RED;
      expect(() => guardTransition(state, Stage.GREEN, 'EW')).not.toThrow();
    });

    test('Rejects GREEN if a command is pending', () => {
      state.stage = Stage.ALL_RED;
      state.phase = null;
      state.actualSignals[Direction.NORTH] = Signal.RED;
      state.actualSignals[Direction.SOUTH] = Signal.RED;
      state.pendingCommand = { commandId: '123' };
      expect(() => guardTransition(state, Stage.GREEN, 'EW')).toThrow(SafetyViolation);
    });
  });

  describe('Mode Restrictions', () => {
    test('Rejects GREEN while DEGRADED', () => {
      state.mode = Mode.DEGRADED;
      state.stage = Stage.ALL_RED;
      expect(() => guardTransition(state, Stage.GREEN, 'NS')).toThrow(/Cannot issue GREEN while DEGRADED/);
    });

    test('Rejects GREEN while RECOVERING', () => {
      state.mode = Mode.RECOVERING;
      state.stage = Stage.ALL_RED;
      expect(() => guardTransition(state, Stage.GREEN, 'NS')).toThrow(/Cannot issue GREEN while RECOVERING/);
    });
  });
});

describe('Config Validation', () => {
  test('Accepts default config', () => {
    const { ok, errors } = validateConfig(defaultJunctionConfig());
    expect(ok).toBe(true);
    expect(errors).toEqual([]);
  });

  test('Rejects asymmetric conflicts', () => {
    const cfg = defaultJunctionConfig();
    cfg.conflicts.NS = ['EW'];
    cfg.conflicts.EW = []; // asymmetric
    const { ok, errors } = validateConfig(cfg);
    expect(ok).toBe(false);
    expect(errors[0]).toMatch(/Conflict asymmetry/);
  });
});
