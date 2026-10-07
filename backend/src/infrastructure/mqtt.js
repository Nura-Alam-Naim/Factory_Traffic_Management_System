'use strict';

const aedes = require('aedes')();
const net = require('net');
const mqtt = require('mqtt');

class MqttAdapter {
  constructor(port = 1883) {
    this.port = port;
    this.server = net.createServer(aedes.handle);
    this.client = null;
    this.actors = new Map();
  }

  setActors(actorsMap) {
    this.actors = actorsMap;
  }

  async start() {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        // Connect a client to our own broker to subscribe and publish
        this.client = mqtt.connect(`mqtt://127.0.0.1:${this.port}`);
        
        this.client.on('connect', () => {
          this.client.subscribe('factory/traffic/+/sensor');
          this.client.subscribe('factory/traffic/+/controller/ack');
          this.client.subscribe('factory/traffic/+/controller/status');
          resolve();
        });

        this.client.on('message', this._handleMessage.bind(this));
      });
    });
  }

  async stop() {
    return new Promise((resolve) => {
      if (this.client) this.client.end();
      this.server.close(() => resolve());
    });
  }

  _handleMessage(topic, message) {
    const parts = topic.split('/');
    if (parts.length < 4) return;
    
    const junctionId = parts[2];
    const actor = this.actors.get(junctionId);
    if (!actor) return;

    let payload;
    try {
      payload = JSON.parse(message.toString());
    } catch {
      return; // ignore invalid json
    }

    const endpoint = parts[3];

    if (endpoint === 'sensor') {
      actor.dispatch({
        type: 'SENSOR_EVENT',
        eventId: payload.eventId,
        junctionId,
        direction: payload.direction,
        vehicleId: payload.vehicleId,
        vehicleType: payload.vehicleType,
        eventType: payload.type, // VEHICLE_ARRIVED or VEHICLE_CLEARED
        sequenceNo: payload.sequenceNo,
        timestamp: payload.timestamp,
        receivedAt: Date.now()
      }).catch(console.error);
    } else if (endpoint === 'controller') {
      const sub = parts[4];
      if (sub === 'ack') {
        actor.dispatch({
          type: 'CONTROLLER_ACK',
          commandId: payload.commandId,
          actualSignals: payload.actualSignals,
          reason: payload.reason
        }).catch(console.error);
      } else if (sub === 'status') {
        actor.dispatch({
          type: 'CONTROLLER_STATUS',
          status: payload.status // ONLINE | OFFLINE
        }).catch(console.error);
      }
    }
  }

  // Network port implementation for JunctionActor
  async sendCommand(junctionId, command) {
    if (!this.client) return;
    this.client.publish(`factory/traffic/${junctionId}/command`, JSON.stringify(command));
  }

  async sendAlert(junctionId, alert) {
    if (!this.client) return;
    this.client.publish(`factory/traffic/${junctionId}/alerts`, JSON.stringify(alert));
  }
}

module.exports = MqttAdapter;
