'use strict';

const { audit, alert } = require('./effects');
const { CommandStatus } = require('./models');

function issue(state, requestedSignals, now) {
  state.commandCounter++;
  const commandId = `${state.junctionId}-${state.commandCounter}`;
  
  state.pendingCommand = {
    commandId,
    requestedSignals: { ...requestedSignals },
    sentAt: now,
    attempts: 1,
    status: CommandStatus.PENDING,
  };

  return {
    type: 'SEND_COMMAND',
    command: state.pendingCommand,
  };
}

function onAck(state, event, now) {
  const { commandId, actualSignals } = event;
  const effects = [];

  if (!state.pendingCommand || state.pendingCommand.commandId !== commandId) {
    // Ignore old/unknown ACKs
    effects.push(audit('UNKNOWN_COMMAND_ACK', `Received ACK for ${commandId} but expected ${state.pendingCommand?.commandId || 'none'}`));
    return { outcome: 'IGNORED', effects };
  }

  // Update actual signals
  state.actualSignals = { ...actualSignals };
  state.actualStale = false;
  state.pendingCommand.status = CommandStatus.CONFIRMED;
  state.pendingCommand.ackedAt = now;
  state.stageConfirmedAt = now;
  
  // Verify actual == requested (mismatch check)
  const requested = state.pendingCommand.requestedSignals;
  let mismatch = false;
  for (const dir of Object.keys(requested)) {
    if (requested[dir] !== actualSignals[dir]) {
      mismatch = true;
      break;
    }
  }

  if (mismatch) {
    effects.push(alert('STATE_MISMATCH', `Controller actual state does not match requested for ${commandId}`));
    effects.push(audit('STATE_MISMATCH', `Command ${commandId} ACK mismatch`));
    // Do not advance stage logic, treat as failure from traffic perspective
    // It remains CONFIRMED from communication perspective, but state logic must handle it
  }

  const pendingCmd = state.pendingCommand;
  state.pendingCommand = null;

  effects.push(audit('COMMAND_ACKED', `Command ${commandId} confirmed`));
  return { outcome: 'ACCEPTED', effects, mismatch, command: pendingCmd };
}

function checkTimeout(state, now) {
  const effects = [];
  
  if (!state.pendingCommand || state.pendingCommand.status !== CommandStatus.PENDING) {
    return { effects, degraded: false };
  }

  const elapsed = now - state.pendingCommand.sentAt;
  if (elapsed <= state.config.controller.ackTimeoutMs) {
    return { effects, degraded: false };
  }

  // Timeout reached
  if (state.pendingCommand.attempts <= state.config.controller.maxRetries) {
    state.pendingCommand.attempts++;
    state.pendingCommand.sentAt = now; // reset timer for retry
    effects.push(audit('COMMAND_RETRY', `Retrying ${state.pendingCommand.commandId}, attempt ${state.pendingCommand.attempts}`));
    effects.push({
      type: 'SEND_COMMAND',
      command: state.pendingCommand,
    });
    return { effects, degraded: false };
  }

  // Max retries exceeded -> DEGRADED
  state.pendingCommand.status = CommandStatus.TIMED_OUT;
  effects.push(audit('CONTROLLER_TIMEOUT', `Max retries exceeded for ${state.pendingCommand.commandId}`));
  effects.push(alert('CONTROLLER_TIMEOUT', `Controller did not respond`));
  
  const pendingCmd = state.pendingCommand;
  state.pendingCommand = null;

  return { effects, degraded: true, command: pendingCmd };
}

module.exports = {
  issue,
  onAck,
  checkTimeout,
};
