'use strict';

const { audit } = require('./effects');

function addVehicle(state, event) {
  const { direction, vehicleId, vehicleType, sequenceNo, receivedAt } = event;
  const effects = [];

  // Update sequence tracking for out-of-order detection
  const sourceKey = `${direction}:${event.eventId || 'sensor'}`; // simplified
  const last = state.lastSeq[sourceKey] || 0;
  if (sequenceNo < last) {
    // Just audit, it's safe to process if not tombstoned
    effects.push(audit('OUT_OF_ORDER_EVENT', `Received seq ${sequenceNo} after ${last}`));
  }
  if (sequenceNo > last) {
    state.lastSeq[sourceKey] = sequenceNo;
  }

  // If tombstoned with a higher or equal seq, ignore (late arrival for cleared vehicle)
  const tombstone = state.tombstones[vehicleId];
  if (tombstone && tombstone.seq >= sequenceNo) {
    effects.push(audit('IGNORED_LATE_ARRIVAL', `Vehicle ${vehicleId} was already cleared`));
    return effects;
  }

  // Add to queue (set semantics: overwrite if exists, which updates receivedAt? We'll keep original receivedAt)
  if (!state.queues[direction][vehicleId]) {
    state.queues[direction][vehicleId] = {
      type: vehicleType || 'EMPLOYEE',
      receivedAt, // use server time for fair waiting calculation
      seq: sequenceNo,
    };
  }

  return effects;
}

function clearVehicle(state, event) {
  const { direction, vehicleId, sequenceNo, receivedAt } = event;
  const effects = [];

  const vehicle = state.queues[direction][vehicleId];

  // Record tombstone to block late arrivals
  state.tombstones[vehicleId] = {
    seq: sequenceNo,
    clearedAt: receivedAt,
  };

  if (vehicle) {
    delete state.queues[direction][vehicleId];
  } else {
    effects.push(audit('ORPHAN_CLEAR', `Cleared vehicle ${vehicleId} not in queue`));
  }

  return effects;
}

function expireGhosts(state, now) {
  const effects = [];
  const ttlMs = state.config.policies.queueEntryTtlMs;

  for (const direction of Object.keys(state.queues)) {
    const queue = state.queues[direction];
    for (const [vehicleId, v] of Object.entries(queue)) {
      if (now - v.receivedAt > ttlMs) {
        delete queue[vehicleId];
        effects.push(audit('QUEUE_ENTRY_EXPIRED', `Vehicle ${vehicleId} in ${direction} exceeded TTL`));
      }
    }
  }

  return effects;
}

module.exports = {
  addVehicle,
  clearVehicle,
  expireGhosts,
};
