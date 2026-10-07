'use strict';

// A simple in-memory repository for tests, implementing RepositoryPort
class MemoryRepository {
  constructor() {
    this.junctions = new Map(); // id -> config
    this.states = new Map();    // id -> { state, version }
    this.processedEvents = new Set();
    this.commands = new Map();
    this.audit = [];
    this.rejected = [];
  }

  async loadJunctions() {
    return Array.from(this.junctions.entries()).map(([id, config]) => ({ id, config }));
  }

  async loadState(junctionId) {
    return this.states.get(junctionId) || null;
  }

  async createJunction(id, config) {
    if (this.junctions.has(id)) throw new Error(`Junction ${id} exists`);
    this.junctions.set(id, config);
  }

  async isProcessed(eventId) {
    return this.processedEvents.has(eventId);
  }

  async saveTransition(txData) {
    const { junctionId, state, version, auditEntries, processedEventId, commands, rejected } = txData;
    
    // Simulate optimistic concurrency check
    const existing = this.states.get(junctionId);
    if (existing && existing.version !== version) {
      throw new Error(`Optimistic concurrency failure. Expected ${existing.version}, got ${version}`);
    }

    // In-memory commit
    this.states.set(junctionId, {
      state: JSON.parse(JSON.stringify(state)),
      version: version + 1
    });

    if (processedEventId) {
      this.processedEvents.add(processedEventId);
    }

    if (auditEntries) {
      for (const a of auditEntries) {
        this.audit.push({ junctionId, ...a, created_at: Date.now() });
      }
    }

    if (commands) {
      for (const c of commands) {
        this.commands.set(c.commandId, { ...c, junctionId });
      }
    }

    if (rejected) {
      this.rejected.push(rejected);
    }
  }

  async appendAudit(entries) {
    for (const a of entries) {
      this.audit.push({ ...a, created_at: Date.now() });
    }
  }

  async getHistory(junctionId, opts = {}) {
    let list = this.audit.filter(a => a.junctionId === junctionId);
    if (opts.eventType) {
      list = list.filter(a => a.eventType === opts.eventType);
    }
    // Most recent first
    list.sort((a, b) => b.created_at - a.created_at);
    if (opts.limit) {
      list = list.slice(0, opts.limit);
    }
    return list;
  }

  async markPendingCommandsAbandoned(junctionId) {
    for (const c of this.commands.values()) {
      if (c.junctionId === junctionId && c.status === 'PENDING') {
        c.status = 'ABANDONED_ON_RESTART';
      }
    }
  }

  async logRejectedEvent(data) {
    this.rejected.push(data);
  }
}

module.exports = MemoryRepository;
