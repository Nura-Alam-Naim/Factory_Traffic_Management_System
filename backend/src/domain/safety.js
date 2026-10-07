'use strict';

const { Signal, Stage, Mode } = require('./models');
const { deriveSignals } = require('./signals');

class SafetyViolation extends Error {
  constructor(message) {
    super(`SafetyViolation: ${message}`);
    this.name = 'SafetyViolation';
  }
}

/**
 * Checks if a set of signals violates the conflict matrix.
 */
function assertNoConflict(signals, config) {
  for (const [phase, conflicts] of Object.entries(config.conflicts)) {
    const isPhaseActive = config.phases[phase].some(dir => 
      signals[dir] === Signal.GREEN || signals[dir] === Signal.YELLOW
    );

    if (isPhaseActive) {
      for (const conflictPhase of conflicts) {
        const isConflictActive = config.phases[conflictPhase].some(dir =>
          signals[dir] === Signal.GREEN || signals[dir] === Signal.YELLOW
        );
        if (isConflictActive) {
          throw new SafetyViolation(`Conflict detected between ${phase} and ${conflictPhase}.`);
        }
      }
    }
  }
}

/**
 * The SINGLE guard through which every stage transition must pass.
 */
function guardTransition(state, toStage, toPhase) {
  if (state.mode === Mode.DEGRADED && toStage === Stage.GREEN) {
    throw new SafetyViolation('Cannot issue GREEN while DEGRADED.');
  }

  if (state.mode === Mode.RECOVERING && toStage === Stage.GREEN) {
    throw new SafetyViolation('Cannot issue GREEN while RECOVERING.');
  }

  // 1. Edge rules
  if (state.stage === Stage.GREEN && toStage !== Stage.YELLOW) {
    throw new SafetyViolation(`Invalid transition: ${state.stage} to ${toStage}. Must go GREEN -> YELLOW.`);
  }
  if (state.stage === Stage.YELLOW && toStage !== Stage.ALL_RED) {
    throw new SafetyViolation(`Invalid transition: ${state.stage} to ${toStage}. Must go YELLOW -> ALL_RED.`);
  }

  // 2. Derive signals and check conflicts
  const desired = deriveSignals(toStage, toPhase, state.config);
  assertNoConflict(desired, state.config);

  // 3. ALL_RED -> GREEN requires actual conflicting signals to be RED, and no pending command
  if (state.stage === Stage.ALL_RED && toStage === Stage.GREEN) {
    if (state.pendingCommand) {
      throw new SafetyViolation('Cannot issue GREEN while a command is pending.');
    }

    const conflicts = state.config.conflicts[toPhase] || [];
    for (const conflictPhase of conflicts) {
      const dirs = state.config.phases[conflictPhase] || [];
      for (const dir of dirs) {
        if (state.actualSignals[dir] !== Signal.RED) {
          throw new SafetyViolation(`Cannot issue GREEN for ${toPhase} while conflicting actual ${dir} is not RED.`);
        }
      }
    }
  }
}

module.exports = {
  SafetyViolation,
  assertNoConflict,
  guardTransition,
};
