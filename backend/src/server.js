'use strict';

require('dotenv').config();
const Application = require('./app');

const config = {
  port: process.env.PORT || 3000,
  mqttPort: process.env.MQTT_PORT || 1883,
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_NAME || 'factory_traffic'
  }
};

const app = new Application(config);

app.start().then(() => {
  console.log(`Server started on port ${config.port}`);
  console.log(`MQTT broker listening on port ${config.mqttPort}`);
}).catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await app.stop();
  process.exit(0);
});
