'use strict';

const EventEmitter = require('events');

class StatusBus extends EventEmitter {
  constructor() {
    super();
    // Max listeners if we have many clients
    this.setMaxListeners(100);
  }

  broadcast(junctionId, state) {
    this.emit(`junction:${junctionId}`, state);
  }

  subscribe(junctionId, listener) {
    this.on(`junction:${junctionId}`, listener);
  }

  unsubscribe(junctionId, listener) {
    this.off(`junction:${junctionId}`, listener);
  }
}

module.exports = StatusBus;
