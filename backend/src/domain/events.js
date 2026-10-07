
'use strict';

// Input types that handle() will process

function sensorEvent(eventId, junctionId, direction, vehicleId, vehicleType, eventType, sequenceNo, timestamp, receivedAt) {
  return {
    type: 'SENSOR_EVENT',
    eventId,
    junctionId,
    direction,
    vehicleId,
    vehicleType,
    eventType, // VEHICLE_ARRIVED | VEHICLE_CLEARED
    sequenceNo,
    timestamp,
    receivedAt,
  };
}

function manualRequest(adminId, direction) {
  return {
    type: 'MANUAL_GREEN_REQUEST',
    adminId,
    direction,
  };
}

function returnToAutomatic(adminId) {
  return {
    type: 'RETURN_TO_AUTOMATIC',
    adminId,
  };
}

function controllerAck(commandId, actualSignals, reason = null) {
  return {
    type: 'CONTROLLER_ACK',
    commandId,
    actualSignals,
    reason,
  };
}

function controllerNack(commandId, reason = null) {
  return {
    type: 'CONTROLLER_NACK',
    commandId,
    reason,
  };
}

function controllerStatus(status) {
  return {
    type: 'CONTROLLER_STATUS',
    status, // ONLINE | OFFLINE
  };
}

function tick() {
  return { type: 'TICK' };
}

function recover(previousState) {
  return { type: 'RECOVER', previousState };
}

module.exports = {
  sensorEvent,
  manualRequest,
  returnToAutomatic,
  controllerAck,
  controllerNack,
  controllerStatus,
  tick,
  recover,
};
