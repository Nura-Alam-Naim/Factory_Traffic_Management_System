'use strict';

const { audit } = require('./effects');
const { Mode } = require('./models');

function addEmergency(state, event) {
  const { vehicleId, direction, receivedAt } = event;
  const phase = Object.keys(state.config.phases).find(p => state.config.phases[p].includes(direction));

  const existing = state.emergency.active.find(e => e.vehicleId === vehicleId);
  if (!existing) {
    state.emergency.active.push({ vehicleId, direction, phase, receivedAt });
    // Sort by receivedAt ascending (first wins)
    state.emergency.active.sort((a, b) => a.receivedAt - b.receivedAt);
    return [audit('EMERGENCY_ARRIVED', `Emergency vehicle ${vehicleId} in ${direction}`)];
  }
  return [];
}

function clearEmergency(state, vehicleId) {
  const idx = state.emergency.active.findIndex(e => e.vehicleId === vehicleId);
  if (idx !== -1) {
    state.emergency.active.splice(idx, 1);
    return [audit('EMERGENCY_CLEARED', `Emergency vehicle ${vehicleId} cleared`)];
  }
  return [];
}

function expireEmergencies(state, now) {
  const effects = [];
  const timeoutMs = state.config.policies.emergencyTimeoutMs;
  
  const expired = state.emergency.active.filter(e => now - e.receivedAt > timeoutMs);
  if (expired.length > 0) {
    state.emergency.active = state.emergency.active.filter(e => now - e.receivedAt <= timeoutMs);
    for (const e of expired) {
      effects.push(audit('EMERGENCY_TIMEOUT', `Emergency vehicle ${e.vehicleId} timed out`));
    }
  }
  return effects;
}

function requestManual(state, adminId, direction, now) {
  if (state.mode === Mode.DEGRADED) {
    return { outcome: 'REJECTED', code: 409, message: 'Cannot request manual while DEGRADED' };
  }
  if (state.mode === Mode.RECOVERING) {
    return { outcome: 'REJECTED', code: 409, message: 'Junction is recovering' };
  }

  // Conflict check: if someone else holds it
  if (state.manualLease && state.manualLease.adminId !== adminId && state.manualLease.expiresAt > now) {
    return { outcome: 'REJECTED', code: 409, message: `Manual lease held by ${state.manualLease.adminId}` };
  }

  const phase = Object.keys(state.config.phases).find(p => state.config.phases[p].includes(direction));
  
  state.manualLease = {
    adminId,
    direction,
    phase,
    expiresAt: now + state.config.policies.manualLeaseMs,
  };

  return { 
    outcome: 'ACCEPTED',
    effects: [audit('MANUAL_GREEN_REQUEST', `Admin ${adminId} requested ${direction}`)] 
  };
}

function returnToAutomatic(state, adminId, now) {
  if (!state.manualLease || state.manualLease.expiresAt <= now) {
    return { outcome: 'IGNORED', effects: [] };
  }

  const holder = state.manualLease.adminId;
  state.manualLease = null;

  return {
    outcome: 'ACCEPTED',
    effects: [audit('RETURN_TO_AUTOMATIC', `Admin ${adminId} cancelled lease (held by ${holder})`)]
  };
}

function expireLease(state, now) {
  if (state.manualLease && state.manualLease.expiresAt <= now) {
    const admin = state.manualLease.adminId;
    state.manualLease = null;
    return [audit('MANUAL_LEASE_EXPIRED', `Lease for ${admin} expired`)];
  }
  return [];
}

function resolveMode(state, now) {
  // Mode priority: DEGRADED/RECOVERING > EMERGENCY > MANUAL > AUTOMATIC
  
  if (state.devices.controller === 'OFFLINE' || state.mode === Mode.DEGRADED) {
    return Mode.DEGRADED;
  }
  
  if (state.mode === Mode.RECOVERING) {
    return Mode.RECOVERING;
  }

  if (state.emergency.active.length > 0) {
    return Mode.EMERGENCY;
  }

  if (state.manualLease && state.manualLease.expiresAt > now) {
    return Mode.MANUAL;
  }

  return Mode.AUTOMATIC;
}

function targetPhase(state, mode, _now) {
  if (mode === Mode.DEGRADED || mode === Mode.RECOVERING) {
    return null; // Hold ALL_RED
  }
  if (mode === Mode.EMERGENCY) {
    return state.emergency.active[0].phase;
  }
  if (mode === Mode.MANUAL) {
    return state.manualLease.phase;
  }
  // Automatic relies on scheduler, return undefined to signal engine to ask scheduler
  return undefined; 
}

module.exports = {
  addEmergency,
  clearEmergency,
  expireEmergencies,
  requestManual,
  returnToAutomatic,
  expireLease,
  resolveMode,
  targetPhase,
};
