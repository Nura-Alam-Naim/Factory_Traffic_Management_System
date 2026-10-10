'use strict';

const { handle } = require('../domain/engine');
const { recover } = require('../domain/events');

async function recoverJunctions({ repo, clock }) {
  const junctions = await repo.loadJunctions();
  const effectsToDispatch = [];

  for (const { id, config } of junctions) {
    let stateRecord = await repo.loadState(id);
    let isNew = false;
    
    if (!stateRecord) {
      const { createJunctionState } = require('../domain/initial_state');
      stateRecord = {
        state: createJunctionState(id, config, clock.now()),
        version: 0
      };
      isNew = true;
    }

    const { state, version } = stateRecord;

    // 1. Mark pending commands as abandoned
    if (!isNew) {
      await repo.markPendingCommandsAbandoned(id);
    }

    const prevStateLog = {
      mode: state.mode,
      stage: state.stage,
      phase: state.phase
    };

    // 2. Clear actual signals
    state.actualSignals = {
      NORTH: 'UNKNOWN',
      SOUTH: 'UNKNOWN',
      EAST: 'UNKNOWN',
      WEST: 'UNKNOWN'
    };
    state.actualStale = true;
    state.pendingCommand = null;

    // 3. Let engine handle RECOVER (goes to RECOVERING mode, issues ALL_RED)
    const result = handle(state, recover(prevStateLog), clock.now());

    // Extract commands to persist
    const newCommands = [];
    if (result.state.pendingCommand) {
      newCommands.push(result.state.pendingCommand);
    }

    const auditEntries = [
      { eventType: isNew ? 'INITIALIZED' : 'RECOVERY_STARTED', reason: 'Boot', details: prevStateLog },
      ...result.effects.filter(e => e.type === 'AUDIT').map(e => ({
        eventType: e.eventType, reason: e.reason, details: e.details
      }))
    ];

    // 4. Save back to repo
    await repo.saveTransition({
      junctionId: id,
      state: result.state,
      version,
      auditEntries,
      commands: newCommands
    });

    // Save effects to send to network
    for (const e of result.effects) {
      if (e.type === 'SEND_COMMAND') {
        effectsToDispatch.push({ junctionId: id, command: e.command });
      }
    }
  }

  return effectsToDispatch;
}

module.exports = {
  recoverJunctions
};
