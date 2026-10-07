'use strict';

const express = require('express');
const cors = require('cors');
const { createJunctionsRouter } = require('./api/routes/junctions');
const { recoverJunctions } = require('./application/recovery');
const JunctionActor = require('./application/actor');
const { initDb } = require('./infrastructure/db');
const MysqlRepository = require('./infrastructure/mysql_repo');
const MqttAdapter = require('./infrastructure/mqtt');

class Application {
  constructor(config) {
    this.config = config;
    this.app = express();
    this.repo = new MysqlRepository();
    this.mqtt = new MqttAdapter(config.mqttPort);
    this.actors = new Map();
    this.tickInterval = null;
    
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use('/api/junctions', createJunctionsRouter(this.repo, this.actors));
  }

  async start() {
    await initDb(this.config.db);
    await this.mqtt.start();

    // Setup actors
    const clock = { now: () => Date.now() };
    const junctions = await this.repo.loadJunctions();
    for (const j of junctions) {
      const actor = new JunctionActor(j.id, this.repo, this.mqtt, clock);
      this.actors.set(j.id, actor);
    }
    
    this.mqtt.setActors(this.actors);

    // Recover
    const commandsToDispatch = await recoverJunctions({ repo: this.repo, clock });
    for (const { junctionId, command } of commandsToDispatch) {
      await this.mqtt.sendCommand(junctionId, command);
    }

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
    await this.mqtt.stop();
    const { closeDb } = require('./infrastructure/db');
    await closeDb();
  }
}

module.exports = Application;
