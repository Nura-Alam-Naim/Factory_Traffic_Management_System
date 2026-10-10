'use strict'; // force restart

const express = require('express');
const cors = require('cors');
const { createJunctionsRouter } = require('./api/routes/junctions');
const { recoverJunctions } = require('./application/recovery');
const JunctionActor = require('./application/actor');
const { initDb } = require('./infrastructure/db');
const MysqlRepository = require('./infrastructure/mysql_repo');
const MqttAdapter = require('./infrastructure/mqtt');
const ControllerSimulator = require('./infrastructure/controller_sim');
const StatusBus = require('./application/status_bus');
const { errorHandler } = require('./api/errors');

class Application {
  constructor(config) {
    this.config = config;
    this.app = express();
    this.repo = new MysqlRepository();
    this.mqtt = new MqttAdapter(config.mqttPort);
    this.statusBus = new StatusBus();
    this.simulators = [];
    this.actors = new Map();
    this.tickInterval = null;
    
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use('/api/junctions', createJunctionsRouter(this.repo, this.actors, this.statusBus));
    this.app.use(errorHandler);
  }

  async start() {
    console.log('Starting app...');
    await initDb(this.config.db);
    console.log('DB initialized');
    await this.mqtt.start();
    console.log('MQTT started');

    // Setup actors
    const clock = { now: () => Date.now() };
    const junctions = await this.repo.loadJunctions();
    console.log('Junctions loaded:', junctions.length);
    for (const j of junctions) {
      const actor = new JunctionActor(j.id, this.repo, this.mqtt, clock, this.statusBus);
      this.actors.set(j.id, actor);

      // Start simulator for each junction if enabled
      if (this.config.simulator && this.config.simulator.enabled) {
        console.log('Starting simulator for', j.id);
        const sim = new ControllerSimulator(`mqtt://127.0.0.1:${this.config.mqttPort}`, j.id, this.config.simulator);
        this.simulators.push(sim);
        await sim.start();
        console.log('Simulator started for', j.id);
      }
    }
    
    this.mqtt.setActors(this.actors);

    // Recover
    console.log('Recovering...');
    const commandsToDispatch = await recoverJunctions({ repo: this.repo, clock });
    for (const { junctionId, command } of commandsToDispatch) {
      await this.mqtt.sendCommand(junctionId, command);
    }
    console.log('Recovery done');

    // Start tick loop
    this.tickInterval = setInterval(() => {
      for (const actor of this.actors.values()) {
        actor.tick();
      }
    }, 100);

    return new Promise((resolve) => {
      this.server = this.app.listen(this.config.port, () => {
        resolve();
      });
    });
  }

  async stop() {
    if (this.tickInterval) clearInterval(this.tickInterval);
    if (this.server) {
      await new Promise(r => this.server.close(r));
    }
    for (const sim of this.simulators) {
      await sim.stop();
    }
    await this.mqtt.stop();
    const { closeDb } = require('./infrastructure/db');
    await closeDb();
  }
}

module.exports = Application;
