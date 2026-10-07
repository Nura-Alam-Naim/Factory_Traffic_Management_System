'use strict';

const express = require('express');
const { validateBody, manualRequestSchema, automaticRequestSchema, sensorEventSchema } = require('../validation');
const { createSseHandler } = require('../sse');

function createJunctionsRouter(repo, actors, statusBus) {
  const router = express.Router();

  router.get('/', async (req, res, next) => {
    try {
      const junctions = await repo.loadJunctions();
      res.json(junctions);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id/state', async (req, res, next) => {
    try {
      const state = await repo.loadState(req.params.id);
      if (!state) {
        return res.status(404).json({ error: { code: 404, message: 'Junction not found' } });
      }
      res.json(state.state);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id/history', async (req, res, next) => {
    try {
      const history = await repo.getHistory(req.params.id, { limit: 100 });
      res.json(history);
    } catch (err) {
      next(err);
    }
  });

  // SSE stream
  router.get('/:id/stream', createSseHandler(statusBus));

  // Sensor Event
  router.post('/:id/sensor-events', validateBody(sensorEventSchema), async (req, res, next) => {
    try {
      const actor = actors.get(req.params.id);
      if (!actor) return res.status(404).json({ error: { code: 404, message: 'Junction not found' } });
      
      const payload = req.body;
      const result = await actor.dispatch({
        type: 'SENSOR_EVENT',
        junctionId: req.params.id,
        ...payload,
        receivedAt: Date.now()
      });

      if (result.status === 'REJECTED') {
        return res.status(result.code || 400).json({ error: { code: result.code || 400, message: result.message } });
      }
      res.status(201).json({ status: result.status, reason: result.reason });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/manual', validateBody(manualRequestSchema), async (req, res, next) => {
    try {
      const { direction, adminId } = req.body;
      const actor = actors.get(req.params.id);
      if (!actor) return res.status(404).json({ error: { code: 404, message: 'Junction not found' } });

      const result = await actor.dispatch({
        type: 'MANUAL_GREEN_REQUEST',
        adminId,
        direction,
        eventId: `req_${Date.now()}_${Math.random()}`
      });

      if (result.status === 'REJECTED') {
        return res.status(result.code || 400).json({ error: { code: result.code || 400, message: result.message } });
      }

      res.status(202).json({ status: result.status });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/automatic', validateBody(automaticRequestSchema), async (req, res, next) => {
    try {
      const { adminId } = req.body;
      const actor = actors.get(req.params.id);
      if (!actor) return res.status(404).json({ error: { code: 404, message: 'Junction not found' } });

      const result = await actor.dispatch({
        type: 'RETURN_TO_AUTOMATIC',
        adminId,
        eventId: `req_${Date.now()}_${Math.random()}`
      });

      res.json({ status: result.status });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createJunctionsRouter };
