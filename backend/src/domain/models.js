'use strict';

const Direction = Object.freeze({
  NORTH: 'NORTH',
  SOUTH: 'SOUTH',
  EAST: 'EAST',
  WEST: 'WEST',
});

const Signal = Object.freeze({
  GREEN: 'GREEN',
  YELLOW: 'YELLOW',
  RED: 'RED',
  UNKNOWN: 'UNKNOWN',
});

const Stage = Object.freeze({
  GREEN: 'GREEN',
  YELLOW: 'YELLOW',
  ALL_RED: 'ALL_RED',
});

const Mode = Object.freeze({
  AUTOMATIC: 'AUTOMATIC',
  MANUAL: 'MANUAL',
  EMERGENCY: 'EMERGENCY',
  DEGRADED: 'DEGRADED',
  RECOVERING: 'RECOVERING',
});

const VehicleType = Object.freeze({
  EMERGENCY: 'EMERGENCY',
  TRUCK: 'TRUCK',
  FORKLIFT: 'FORKLIFT',
  EMPLOYEE: 'EMPLOYEE',
});

const DeviceStatus = Object.freeze({
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
  DEGRADED: 'DEGRADED',
  WARNING: 'WARNING',
  UNKNOWN: 'UNKNOWN',
});

const CommandStatus = Object.freeze({
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  FAILED: 'FAILED',
  TIMED_OUT: 'TIMED_OUT',
  SUPERSEDED: 'SUPERSEDED',
  ABANDONED_ON_RESTART: 'ABANDONED_ON_RESTART',
});

module.exports = {
  Direction,
  Signal,
  Stage,
  Mode,
  VehicleType,
  DeviceStatus,
  CommandStatus,
};
