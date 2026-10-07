'use strict';

const { Mode, Stage, DeviceStatus } = require('./models');
const { startYellow, startAllRed, startGreen, isStageComplete } = require('./state_machine');
const { choosePhase } = require('./scheduler');
const { addVehicle, clearVehicle, expireGhosts } = require('./queues');
const { issue, onAck, checkTimeout } = require('./commands');
const { audit, alert } = require('./effects');
const modes = require('./modes');
const { deriveSignals } = require('./signals');

function handle(state, event, now) {
  const effects = [];
  let outcome = { status: 'ACCEPTED' };

  switch (event.type) {
    case 'SENSOR_EVENT': {
      if (event.eventType === 'VEHICLE_ARRIVED') {
        effects.push(...addVehicle(state, event));
        if (event.vehicleType === 'EMERGENCY') {
          effects.push(...modes.addEmergency(state, event));
        }
      } else if (event.eventType === 'VEHICLE_CLEARED') {
        effects.push(...clearVehicle(state, event));
        effects.push(...modes.clearEmergency(state, event.vehicleId));
      }
      break;
    }

    case 'MANUAL_GREEN_REQUEST': {
      const res = modes.requestManual(state, event.adminId, event.direction, now);
      if (res.effects) effects.push(...res.effects);
      outcome = { status: res.outcome, code: res.code, message: res.message };
      break;
    }

    case 'RETURN_TO_AUTOMATIC': {
      const res = modes.returnToAutomatic(state, event.adminId, now);
      if (res.effects) effects.push(...res.effects);
      outcome = { status: res.outcome };
      break;
    }

    case 'CONTROLLER_ACK': {
      const res = onAck(state, event, now);
      if (res.effects) effects.push(...res.effects);
      outcome = { status: res.outcome };
      break;
    }

    case 'CONTROLLER_STATUS': {
      state.devices.controller = event.status;
      if (event.status === DeviceStatus.OFFLINE) {
        if (state.mode !== Mode.DEGRADED) {
          state.mode = Mode.DEGRADED;
          state.stage = Stage.ALL_RED;
          state.phase = null;
          state.desiredSignals = deriveSignals(Stage.ALL_RED, null, state.config);
          effects.push(audit('MODE_CHANGED', 'Controller OFFLINE, switching to DEGRADED'));
          effects.push(alert('CONTROLLER_OFFLINE', 'Controller is offline'));
        }
      } else if (event.status === DeviceStatus.ONLINE && state.mode === Mode.DEGRADED) {
        // Reconcile
        state.mode = Mode.RECOVERING;
        state.actualSignals = { NORTH: 'UNKNOWN', SOUTH: 'UNKNOWN', EAST: 'UNKNOWN', WEST: 'UNKNOWN' };
        state.actualStale = true;
        effects.push(audit('MODE_CHANGED', 'Controller ONLINE, RECOVERING'));
        const cmdEffect = issue(state, deriveSignals(Stage.ALL_RED, null, state.config), now);
        effects.push(cmdEffect);
      }
      break;
    }

    case 'RECOVER': {
      // Boot time recovery logic
      state.mode = Mode.RECOVERING;
      state.stage = Stage.ALL_RED;
      state.phase = null;
      state.desiredSignals = deriveSignals(Stage.ALL_RED, null, state.config);
      const cmdEffect = issue(state, state.desiredSignals, now);
      effects.push(cmdEffect);
      break;
    }

    case 'TICK': {
      // Handled in advance()
      break;
    }

    default:
      outcome = { status: 'IGNORED' };
  }

  // After processing any event (including tick), run the continuous logic
  const engineEffects = advance(state, now);
  effects.push(...engineEffects);

  return { state, effects, outcome };
}

function tick(state, now) {
  return handle(state, { type: 'TICK' }, now);
}

function advance(state, now) {
  const effects = [];

  // 1. Timeouts and Expiries
  effects.push(...modes.expireEmergencies(state, now));
  effects.push(...modes.expireLease(state, now));
  effects.push(...expireGhosts(state, now));

  const timeoutResult = checkTimeout(state, now);
  effects.push(...timeoutResult.effects);
  if (timeoutResult.degraded && state.mode !== Mode.DEGRADED) {
    state.mode = Mode.DEGRADED;
    state.stage = Stage.ALL_RED;
    state.phase = null;
    state.desiredSignals = deriveSignals(Stage.ALL_RED, null, state.config);
    effects.push(audit('MODE_CHANGED', 'ACK timeout, switching to DEGRADED'));
  }

  // 2. Resolve Mode
  const prevMode = state.mode;
  state.mode = modes.resolveMode(state, now);
  if (state.mode !== prevMode && prevMode !== Mode.RECOVERING && state.mode !== Mode.RECOVERING) {
    effects.push(audit('MODE_CHANGED', `Mode changed from ${prevMode} to ${state.mode}`));
  }

  // 3. Stage Machine Advancements
  if (state.pendingCommand) {
    // We cannot advance if a command is flying
    return effects;
  }

  let target = modes.targetPhase(state, state.mode, now);
  let schedulerReason = null;
  
  if (target === undefined) {
    // AUTOMATIC mode -> ask scheduler
    const decision = choosePhase(state, now);
    target = decision.target;
    schedulerReason = decision.reason;
    if (schedulerReason !== state.lastDecision) {
      state.lastDecision = schedulerReason;
    }
  }

  const complete = isStageComplete(state, now);

  if (state.stage === Stage.GREEN) {
    if (target !== state.phase) {
      // Min green is handled inside the scheduler for AUTOMATIC. 
      // For EMERGENCY/MANUAL, preemption skips min green, but we shouldn't switch if we are recovering.
      if (state.mode !== Mode.RECOVERING && state.mode !== Mode.DEGRADED) {
         effects.push(...startYellow(state, now, schedulerReason || `${state.mode} preemption`));
      }
    }
  } else if (state.stage === Stage.YELLOW && complete) {
    effects.push(...startAllRed(state, state.phase === 'NS' ? 'EW' : 'NS', now, 'Yellow complete'));
  } else if (state.stage === Stage.ALL_RED && complete) {
    if (target) {
      effects.push(...startGreen(state, target, now, schedulerReason || `${state.mode} target phase`));
    }
  }

  // Check if we need to issue any un-issued desired state (like Degraded fallback to ALL_RED)
  if (!state.pendingCommand && state.stage === Stage.ALL_RED && state.mode === Mode.DEGRADED) {
      // It's already in ALL_RED, but if we haven't commanded it yet we might need to.
      // But guardTransition already updates desiredSignals. Just be safe.
  }

  return effects;
}

module.exports = {
  handle,
  tick,
};
