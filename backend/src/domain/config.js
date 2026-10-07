'use strict';

const { Direction } = require('./models');

function defaultJunctionConfig() {
  return {
    phases: {
      NS: [Direction.NORTH, Direction.SOUTH],
      EW: [Direction.EAST, Direction.WEST],
    },
    conflicts: {
      NS: ['EW'],
      EW: ['NS'],
    },
    timings: {
      greenTargetMs: 30000,
      yellowMs: 5000,
      allRedMs: 2000,
      minGreenMs: 10000,
      maxGreenMs: 60000,
    },
    scoring: {
      weights: {
        EMERGENCY: 100,
        TRUCK: 5,
        FORKLIFT: 3,
        EMPLOYEE: 1,
      },
      waitFactor: 0.1,
      hysteresis: 1.2,
      maxWaitMs: 90000,
      starvationBonus: 1000,
    },
    controller: {
      ackTimeoutMs: 5000,
      maxRetries: 2,
    },
    policies: {
      manualLeaseMs: 300000,
      emergencyTimeoutMs: 120000,
      staleEventMaxAgeMs: 300000,
      queueEntryTtlMs: 900000,
    },
  };
}

function validateConfig(cfg) {
  const errors = [];

  // 1. Conflicts must be symmetric
  for (const [phase, conflictsList] of Object.entries(cfg.conflicts)) {
    for (const conflict of conflictsList) {
      if (!cfg.conflicts[conflict] || !cfg.conflicts[conflict].includes(phase)) {
        errors.push(`Conflict asymmetry: ${phase} conflicts with ${conflict}, but not vice versa.`);
      }
    }
  }

  // 2. Every direction in exactly one phase
  const allDirectionsInPhases = [];
  for (const dirList of Object.values(cfg.phases)) {
    allDirectionsInPhases.push(...dirList);
  }
  
  const uniqueDirections = new Set(allDirectionsInPhases);
  if (allDirectionsInPhases.length !== uniqueDirections.size) {
    errors.push('A direction is in multiple phases.');
  }

  // 3. Timings valid
  if (cfg.timings.minGreenMs > cfg.timings.maxGreenMs) {
    errors.push('minGreenMs cannot be > maxGreenMs.');
  }
  if (cfg.timings.yellowMs < 0 || cfg.timings.allRedMs < 0 || cfg.timings.greenTargetMs < 0) {
    errors.push('Timings must be positive.');
  }

  return { ok: errors.length === 0, errors };
}

module.exports = {
  defaultJunctionConfig,
  validateConfig,
};
