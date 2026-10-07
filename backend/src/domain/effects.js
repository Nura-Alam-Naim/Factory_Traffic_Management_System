'use strict';

function sendCommand(junctionId, command) {
  return {
    type: 'SEND_COMMAND',
    command, // { commandId, requestedSignals, attempt, ... }
  };
}

function audit(eventType, reason, details = {}) {
  return {
    type: 'AUDIT',
    eventType,
    reason,
    details,
  };
}

function alert(code, message) {
  return {
    type: 'ALERT',
    code,
    message,
  };
}

module.exports = {
  sendCommand,
  audit,
  alert,
};
