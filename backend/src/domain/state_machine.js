'use strict';

const { Stage } = require('./models');
const { guardTransition } = require('./safety');
const { deriveSignals } = require('./signals');
const { sendCommand, audit } = require('./effects');

function isStageComplete(state, now) {
  if (state.stageConfirmedAt === null) return false; // Not even ACKed yet

  
  const elapsed = now - state.stageConfirmedAt;
  
  if (state.stage === Stage.GREEN) {
    // GREEN doesn't complete automatically, it waits for scheduler switch decision
    // (though maxGreen limits it in the scheduler)
    return elapsed >= state.config.timings.minGreenMs;
  }
  if (state.stage === Stage.YELLOW) {
    return elapsed >= state.config.timings.yellowMs;
  }
  if (state.stage === Stage.ALL_RED) {
    return elapsed >= state.config.timings.allRedMs;
  }
  return false;
}

function executeTransition(state, toStage, toPhase, now, reason) {
  // 1. Guard
  guardTransition(state, toStage, toPhase);

  // 2. Mutate (in a copy or direct properties if we assume caller clones)
  state.stage = toStage;
  if (toStage === Stage.ALL_RED) {
    // Keep nextPhase so we know where we are going
    state.nextPhase = toPhase;
    state.phase = null;
  } else {
    state.phase = toPhase;
    state.nextPhase = null;
  }
  
  state.desiredSignals = deriveSignals(state.stage, state.phase || state.nextPhase, state.config);
  state.stageConfirmedAt = null; // Cleared until ACK
  state.actualStale = true;

  // 3. Effects
  const effects = [];
  
  // Issue command (bookkeeping handled by commands.js later)
  // For now we just emit the effect
  state.commandCounter++;
  const commandId = `${state.junctionId}-${state.commandCounter}`;
  
  state.pendingCommand = {
    commandId,
    requestedSignals: { ...state.desiredSignals },
    sentAt: now,
    attempts: 1,
    status: 'PENDING',
  };

  effects.push(sendCommand(state.junctionId, state.pendingCommand));
  effects.push(audit('SIGNAL_TRANSITION', reason, { stage: toStage, phase: toPhase }));

  return effects;
}

function startYellow(state, now, reason = 'Switch requested') {
  return executeTransition(state, Stage.YELLOW, state.phase, now, reason);
}

function startAllRed(state, nextPhase, now, reason = 'Yellow complete') {
  return executeTransition(state, Stage.ALL_RED, nextPhase, now, reason);
}

function startGreen(state, phase, now, reason = 'All red complete') {
  return executeTransition(state, Stage.GREEN, phase, now, reason);
}

module.exports = {
  isStageComplete,
  startYellow,
  startAllRed,
  startGreen,
  executeTransition
};
