'use strict';

const { Mode, Stage, Signal } = require('./models');
const { deriveSignals } = require('./signals');

function createJunctionState(junctionId, config, now) {
  return {
    junctionId,
    config,
    mode: Mode.RECOVERING,
    stage: Stage.ALL_RED,
    phase: null,
    nextPhase: null,
    stageConfirmedAt: null,
    
    desiredSignals: deriveSignals(Stage.ALL_RED, null, config),
    actualSignals: {
      NORTH: Signal.UNKNOWN,
      SOUTH: Signal.UNKNOWN,
      EAST: Signal.UNKNOWN,
      WEST: Signal.UNKNOWN,
    },
    actualStale: true,
    
    queues: {
      NORTH: {}, SOUTH: {}, EAST: {}, WEST: {}
    },
    tombstones: {},
    lastSeq: {},
    
    pendingCommand: null,
    commandCounter: 0,
    
    emergency: { active: [] },
    manualLease: null,
    
    devices: {
      controller: 'UNKNOWN',
      sensors: {
        NORTH: 'UNKNOWN',
        SOUTH: 'UNKNOWN',
        EAST: 'UNKNOWN',
        WEST: 'UNKNOWN',
      }
    },
    
    alerts: [],
    lastDecision: null,
    updatedAt: now
  };
}

module.exports = {
  createJunctionState
};
