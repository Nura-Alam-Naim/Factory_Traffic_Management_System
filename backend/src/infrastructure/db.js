'use strict';

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

let pool = null;

async function initDb(config) {
  // First, connect without database to create it if not exists
  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
  });

  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${config.database}\``);
  await connection.end();

  // Create pool
  pool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  // Apply schema
  const schemaPath = path.join(__dirname, '../../../schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  
  // Poor man's schema runner: split by ; and run
  const statements = schemaSql.split(';').map(s => s.trim()).filter(s => s.length > 0);
  for (const stmt of statements) {
    await pool.query(stmt);
  }

  return pool;
}

function getPool() {
  if (!pool) throw new Error('Database not initialized');
  return pool;
}

async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  initDb,
  getPool,
  closeDb,
};
