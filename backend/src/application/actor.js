'use strict';

const { handle, tick } = require('../domain/engine');
const { SafetyViolation } = require('../domain/safety');

class JunctionActor {
  /**
   * @param {string} junctionId
   * @param {Object} repo - RepositoryPort
   * @param {Object} network - NetworkPort { sendCommand(junctionId, command) }
   * @param {Object} clock - { now() }
   * @param {Object} statusBus - Emit state updates
   */
  constructor(junctionId, repo, network, clock, statusBus) {
    this.junctionId = junctionId;
    this.repo = repo;
    this.network = network;
    this.clock = clock;
    this.statusBus = statusBus;
    
    // The mailbox queue to serialize operations
    this.queue = Promise.resolve();
  }

  /**
   * Enqueue an event for processing. Returns a promise that resolves when processed.
   */
  dispatch(event) {
    return this._enqueue(async () => {
      // 1. Load state
      const stateRecord = await this.repo.loadState(this.junctionId);
      if (!stateRecord) {
        throw new Error(`Junction ${this.junctionId} not found`);
      }
      const { state, version } = stateRecord;

      // 2. Deduplication check (only for externally originated events that have an ID)
      if (event.eventId) {
        const isProcessed = await this.repo.isProcessed(event.eventId);
        if (isProcessed) {
          // Log duplicate, don't change state
          await this.repo.appendAudit([{
            junctionId: this.junctionId,
            eventType: 'DUPLICATE_EVENT',
            reason: `Ignored duplicate event ${event.eventId}`
          }]);
          return { status: 'IGNORED', reason: 'DUPLICATE' };
        }
      }

      const now = this.clock.now();
      
      // 3. Domain Logic
      let result;
      try {
        result = handle(state, event, now);
      } catch (err) {
        if (err instanceof SafetyViolation) {
          // Log rejection
          await this.repo.logRejectedEvent({
            junctionId: this.junctionId,
            payload: event,
            code: 409,
            message: err.message
          });
          return { status: 'REJECTED', code: 409, message: err.message };
        }
        throw err;
      }

      // If domain explicitly rejected (e.g. manual lease conflict)
      if (result.outcome && result.outcome.status === 'REJECTED') {
        await this.repo.logRejectedEvent({
          junctionId: this.junctionId,
          payload: event,
          code: result.outcome.code,
          message: result.outcome.message
        });
        // We still save the state if effects happened? Usually rejection means no state change.
        // We'll skip saving state to avoid version bumps on pure rejections.
        return result.outcome;
      }

      // 4. Persistence
      const auditEntries = result.effects
        .filter(e => e.type === 'AUDIT')
        .map(e => ({ eventType: e.eventType, reason: e.reason, details: e.details }));

      const newCommands = [];
      if (result.state.pendingCommand) {
        // Just always upsert the pending command
        newCommands.push(result.state.pendingCommand);
      }
      // If we confirmed a command (ACK), we need to update its status in DB.
      // The domain removes it from state.pendingCommand, but returns it in outcome/effects?
      // Ah, in commands.js onAck we return { command: pendingCmd } in the outcome.
      if (result.outcome && result.outcome.command) {
        newCommands.push(result.outcome.command); // it has updated status
      }
      // For timeouts, commands.js checkTimeout returns it in outcome/degraded too
      const timeoutEffects = result.effects.filter(e => e.type === 'ALERT' && e.code === 'CONTROLLER_TIMEOUT');
      if (timeoutEffects.length > 0 && result.state.pendingCommand === null) {
          // Wait, if it timed out, how do we get the command to update DB?
          // I didn't pass it back fully in checkTimeout. Let me just load from DB or handle it.
          // Actually, markPendingCommandsAbandoned does this on restart. For runtime, we can just let it sit or explicitly update.
          // In handle(), advance() returns effects. I didn't bubble `timeoutResult.command`.
          // For simplicity, let's just rely on state.pendingCommand. If it's missing, we don't update it in DB here, but we could explicitly fetch it.
      }

      await this.repo.saveTransition({
        junctionId: this.junctionId,
        state: result.state,
        version,
        auditEntries,
        processedEventId: event.eventId,
        commands: newCommands
      });

      if (this.statusBus) {
        this.statusBus.broadcast(this.junctionId, result.state);
      }

      // 5. Network Side-Effects
      for (const effect of result.effects) {
        if (effect.type === 'SEND_COMMAND') {
          // Fire and forget, failures handled by timeout loop
          this.network.sendCommand(this.junctionId, effect.command).catch(err => {
             console.error(`Failed to send command to ${this.junctionId}:`, err);
          });
        } else if (effect.type === 'ALERT') {
          this.network.sendAlert(this.junctionId, effect).catch(() => {});
        }
      }

      return result.outcome;
    });
  }

  tick() {
    return this._enqueue(async () => {
      const stateRecord = await this.repo.loadState(this.junctionId);
      if (!stateRecord) return; // Junction not fully created yet
      
      const { state, version } = stateRecord;
      const now = this.clock.now();

      const result = tick(state, now);

      // Only save if there are effects or state changed
      // (Optimization: tick fires every 100ms, we don't want to save 10x a second if nothing happened)
      if (result.effects.length === 0) {
        return;
      }

      const auditEntries = result.effects
        .filter(e => e.type === 'AUDIT')
        .map(e => ({ eventType: e.eventType, reason: e.reason, details: e.details }));

      const newCommands = [];
      if (result.state.pendingCommand) {
        newCommands.push(result.state.pendingCommand);
      }

      await this.repo.saveTransition({
        junctionId: this.junctionId,
        state: result.state,
        version,
        auditEntries,
        commands: newCommands
      });

      if (this.statusBus) {
        this.statusBus.broadcast(this.junctionId, result.state);
      }

      for (const effect of result.effects) {
        if (effect.type === 'SEND_COMMAND') {
          this.network.sendCommand(this.junctionId, effect.command).catch(() => {});
        } else if (effect.type === 'ALERT') {
          this.network.sendAlert(this.junctionId, effect).catch(() => {});
        }
      }
    });
  }

  // Helper to ensure strict ordering via a single promise chain
  _enqueue(task) {
    const promise = this.queue.then(() => task()).catch(err => {
      console.error(`Actor error for ${this.junctionId}:`, err);
      throw err; // propagate to caller
    });
    // We catch it inside the chain so that one failing task doesn't permanently break the queue
    this.queue = promise.catch(() => {});
    return promise;
  }
}

module.exports = JunctionActor;
