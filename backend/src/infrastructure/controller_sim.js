'use strict';

const mqtt = require('mqtt');

class ControllerSimulator {
  constructor(brokerUrl, junctionId, config = {}) {
    this.brokerUrl = brokerUrl;
    this.junctionId = junctionId;
    this.client = null;
    
    this.autoAck = config.autoAck !== false;
    this.ackDelayMs = config.ackDelayMs || 500;
    this.forceMismatch = config.forceMismatch || false;
    this.dropAcks = config.dropAcks || false;
  }

  async start() {
    return new Promise((resolve) => {
      this.client = mqtt.connect(this.brokerUrl, {
        will: {
          topic: `factory/traffic/${this.junctionId}/controller/status`,
          payload: JSON.stringify({ status: 'OFFLINE' }),
          qos: 1,
          retain: true
        }
      });

      this.client.on('connect', () => {
        this.client.subscribe(`factory/traffic/${this.junctionId}/command`);
        // Publish ONLINE
        this.client.publish(`factory/traffic/${this.junctionId}/controller/status`, JSON.stringify({ status: 'ONLINE' }), { retain: true, qos: 1 });
        resolve();
      });

      this.client.on('message', (topic, message) => {
        if (topic.endsWith('/command')) {
          this._handleCommand(JSON.parse(message.toString()));
        }
      });
    });
  }

  async stop() {
    if (this.client) {
      this.client.publish(`factory/traffic/${this.junctionId}/controller/status`, JSON.stringify({ status: 'OFFLINE' }), { retain: true, qos: 1 });
      await new Promise(r => this.client.end(false, {}, r));
    }
  }

  _handleCommand(cmd) {
    if (!this.autoAck || this.dropAcks) return;
    
    setTimeout(() => {
      let actualSignals = { ...cmd.requestedSignals };
      if (this.forceMismatch) {
        // Just corrupt one of the signals
        const dir = Object.keys(actualSignals)[0];
        actualSignals[dir] = actualSignals[dir] === 'RED' ? 'GREEN' : 'RED';
      }

      const ack = {
        commandId: cmd.commandId,
        actualSignals
      };

      this.client.publish(`factory/traffic/${this.junctionId}/controller/ack`, JSON.stringify(ack), { qos: 1 });
    }, this.ackDelayMs);
  }
}

module.exports = ControllerSimulator;
