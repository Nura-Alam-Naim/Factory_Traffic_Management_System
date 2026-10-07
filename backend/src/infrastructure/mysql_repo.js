'use strict';

const { getPool } = require('./db');

class MysqlRepository {
  async loadJunctions() {
    const [rows] = await getPool().query('SELECT id, config FROM junctions');
    return rows.map(r => ({ id: r.id, config: r.config }));
  }

  async loadState(junctionId) {
    const [rows] = await getPool().query('SELECT state, version FROM junction_state WHERE junction_id = ?', [junctionId]);
    if (rows.length === 0) return null;
    return { state: rows[0].state, version: rows[0].version };
  }

  async createJunction(id, config) {
    await getPool().query('INSERT INTO junctions (id, name, config) VALUES (?, ?, ?)', [id, id, JSON.stringify(config)]);
  }

  async isProcessed(eventId) {
    const [rows] = await getPool().query('SELECT 1 FROM processed_events WHERE event_id = ?', [eventId]);
    return rows.length > 0;
  }

  async saveTransition(txData) {
    const { junctionId, state, version, auditEntries, processedEventId, commands, rejected } = txData;
    const conn = await getPool().getConnection();
    
    try {
      await conn.beginTransaction();

      // 1. Snapshot with version check
      const stateJson = JSON.stringify(state);
      if (version === 0) {
        await conn.query('INSERT INTO junction_state (junction_id, state, version) VALUES (?, ?, 1)', [junctionId, stateJson]);
      } else {
        const [result] = await conn.query(
          'UPDATE junction_state SET state = ?, version = ? WHERE junction_id = ? AND version = ?',
          [stateJson, version + 1, junctionId, version]
        );
        if (result.affectedRows === 0) {
          throw new Error('Optimistic concurrency failure');
        }
      }

      // 2. Processed event
      if (processedEventId) {
        // We rely on unique constraint to throw if duplicate races
        await conn.query('INSERT INTO processed_events (event_id, junction_id, received_at) VALUES (?, ?, ?)', 
          [processedEventId, junctionId, Date.now()]);
      }

      // 3. Audit
      if (auditEntries && auditEntries.length > 0) {
        const auditValues = auditEntries.map(a => [
          junctionId, a.eventType, a.reason || null, a.details ? JSON.stringify(a.details) : null, Date.now()
        ]);
        await conn.query('INSERT INTO audit_log (junction_id, event_type, reason, details, created_at) VALUES ?', [auditValues]);
      }

      // 4. Commands
      if (commands && commands.length > 0) {
        for (const c of commands) {
          await conn.query(`
            INSERT INTO commands (command_id, junction_id, requested, status, attempts, sent_at, acked_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE status = VALUES(status), attempts = VALUES(attempts), acked_at = VALUES(acked_at)
          `, [
            c.commandId, junctionId, JSON.stringify(c.requestedSignals), c.status, c.attempts, c.sentAt, c.ackedAt || null
          ]);
        }
      }

      // 5. Sync queues (for easier SQL reporting, though state JSON has it too)
      // Delete old queues for this junction, then insert current
      await conn.query('DELETE FROM queue_vehicles WHERE junction_id = ?', [junctionId]);
      const queueValues = [];
      for (const [dir, queue] of Object.entries(state.queues)) {
        for (const [vId, v] of Object.entries(queue)) {
          queueValues.push([junctionId, vId, dir, v.type, v.receivedAt, v.seq]);
        }
      }
      if (queueValues.length > 0) {
        await conn.query('INSERT INTO queue_vehicles (junction_id, vehicle_id, direction, vehicle_type, arrived_at, seq) VALUES ?', [queueValues]);
      }

      // Sync tombstones
      await conn.query('DELETE FROM tombstones WHERE junction_id = ?', [junctionId]);
      const tsValues = Object.entries(state.tombstones).map(([vId, ts]) => [junctionId, vId, ts.seq, ts.clearedAt]);
      if (tsValues.length > 0) {
        await conn.query('INSERT INTO tombstones (junction_id, vehicle_id, seq, cleared_at) VALUES ?', [tsValues]);
      }

      // Sync devices
      await conn.query('DELETE FROM device_status WHERE junction_id = ?', [junctionId]);
      const devValues = [
        [junctionId, 'controller', 'CONTROLLER', state.devices.controller, Date.now()]
      ];
      for (const [dir, status] of Object.entries(state.devices.sensors)) {
        devValues.push([junctionId, `sensor_${dir}`, 'SENSOR', status, Date.now()]);
      }
      await conn.query('INSERT INTO device_status (junction_id, device_id, device_type, status, updated_at) VALUES ?', [devValues]);

      if (rejected) {
        await conn.query('INSERT INTO rejected_events (payload, error_code, message, received_at) VALUES (?, ?, ?, ?)',
          [JSON.stringify(rejected.payload), rejected.code, rejected.message, Date.now()]);
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async appendAudit(entries) {
    if (!entries || entries.length === 0) return;
    const values = entries.map(a => [
      a.junctionId, a.eventType, a.reason || null, a.details ? JSON.stringify(a.details) : null, Date.now()
    ]);
    await getPool().query('INSERT INTO audit_log (junction_id, event_type, reason, details, created_at) VALUES ?', [values]);
  }

  async getHistory(junctionId, opts = {}) {
    let sql = 'SELECT * FROM audit_log WHERE junction_id = ?';
    const args = [junctionId];
    if (opts.eventType) {
      sql += ' AND event_type = ?';
      args.push(opts.eventType);
    }
    sql += ' ORDER BY created_at DESC';
    if (opts.limit) {
      sql += ' LIMIT ?';
      args.push(Number(opts.limit));
    }
    const [rows] = await getPool().query(sql, args);
    return rows;
  }

  async markPendingCommandsAbandoned(junctionId) {
    await getPool().query(`
      UPDATE commands 
      SET status = 'ABANDONED_ON_RESTART' 
      WHERE junction_id = ? AND status = 'PENDING'
    `, [junctionId]);
  }

  async logRejectedEvent(data) {
    await getPool().query('INSERT INTO rejected_events (payload, error_code, message, received_at) VALUES (?, ?, ?, ?)',
      [JSON.stringify(data.payload), data.code, data.message, Date.now()]);
  }
}

module.exports = MysqlRepository;
