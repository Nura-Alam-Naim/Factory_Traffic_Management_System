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
    this.vehicleGenInterval = null;
    this.vehicleClearInterval = null;
    this.currentSignals = { NORTH: 'RED', SOUTH: 'RED', EAST: 'RED', WEST: 'RED' };
    this.simQueues = { NORTH: [], SOUTH: [], EAST: [], WEST: [] };
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
        
        // Start autonomous vehicle generation for DEMO
        this._startVehicleGenerator();
        this._startVehicleClearer();
        
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
    if (this.vehicleGenInterval) clearInterval(this.vehicleGenInterval);
    if (this.vehicleClearInterval) clearInterval(this.vehicleClearInterval);
    
    if (this.client) {
      this.client.publish(`factory/traffic/${this.junctionId}/controller/status`, JSON.stringify({ status: 'OFFLINE' }), { retain: true, qos: 1 });
      await new Promise(r => this.client.end(false, {}, r));
    }
  }

  _startVehicleGenerator() {
    // Generate a new vehicle randomly every 1 to 4 seconds
    const scheduleNext = () => {
      const delay = Math.random() * 3000 + 1000;
      this.vehicleGenInterval = setTimeout(() => {
        this._injectRandomVehicle();
        scheduleNext();
      }, delay);
    };
    scheduleNext();
  }
  
  _startVehicleClearer() {
    // Check every second to clear vehicles from GREEN lanes
    this.vehicleClearInterval = setInterval(() => {
      for (const dir of Object.keys(this.simQueues)) {
        if (this.currentSignals[dir] === 'GREEN' && this.simQueues[dir].length > 0) {
          const v = this.simQueues[dir].shift();
          
          const sensorEvent = {
            sensorId: `SIM_S_${dir}`,
            direction: dir,
            type: 'VEHICLE_CLEARED',
            vehicleId: v.id,
            vehicleType: v.type
          };
          
          this.client.publish(`factory/traffic/${this.junctionId}/sensor`, JSON.stringify(sensorEvent), { qos: 0 });
        }
      }
    }, 1500);
  }

  _injectRandomVehicle() {
    const directions = ['NORTH', 'SOUTH', 'EAST', 'WEST'];
    const types = ['CAR', 'CAR', 'TRUCK', 'MOTORCYCLE'];
    const dir = directions[Math.floor(Math.random() * directions.length)];
    const type = types[Math.floor(Math.random() * types.length)];
    
    const v = { id: `V_${Date.now().toString().slice(-6)}`, type };
    this.simQueues[dir].push(v);
    
    const sensorEvent = {
      sensorId: `SIM_S_${dir}`,
      direction: dir,
      type: 'VEHICLE_ARRIVED',
      vehicleId: v.id,
      vehicleType: v.type
    };
    
    this.client.publish(`factory/traffic/${this.junctionId}/sensor`, JSON.stringify(sensorEvent), { qos: 0 });
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

      this.currentSignals = actualSignals; // Track current state for clearer
      
      const ack = {
        commandId: cmd.commandId,
        actualSignals
      };

      this.client.publish(`factory/traffic/${this.junctionId}/controller/ack`, JSON.stringify(ack), { qos: 1 });
    }, this.ackDelayMs);
  }
}

module.exports = ControllerSimulator;
