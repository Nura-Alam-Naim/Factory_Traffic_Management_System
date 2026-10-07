'use strict';

const express = require('express');

function createJunctionsRouter(repo, actors) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const junctions = await repo.loadJunctions();
      res.json(junctions);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/:id/state', async (req, res) => {
    try {
      const state = await repo.loadState(req.params.id);
      if (!state) {
        return res.status(404).json({ error: 'Junction not found' });
      }
      res.json(state.state);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/:id/history', async (req, res) => {
    try {
      const history = await repo.getHistory(req.params.id, { limit: 100 });
      res.json(history);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/:id/manual', async (req, res) => {
    try {
      const { direction, adminId } = req.body;
      if (!direction || !adminId) {
        return res.status(400).json({ error: 'direction and adminId required' });
      }

      const actor = actors.get(req.params.id);
      if (!actor) {
        return res.status(404).json({ error: 'Junction not found' });
      }

      const result = await actor.dispatch({
        type: 'MANUAL_GREEN_REQUEST',
        adminId,
        direction,
        eventId: `req_${Date.now()}_${Math.random()}`
      });

      if (result.status === 'REJECTED') {
        return res.status(result.code || 400).json({ error: result.message });
      }

      res.json({ status: result.status });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/:id/automatic', async (req, res) => {
    try {
      const { adminId } = req.body;
      if (!adminId) {
        return res.status(400).json({ error: 'adminId required' });
      }

      const actor = actors.get(req.params.id);
      if (!actor) {
        return res.status(404).json({ error: 'Junction not found' });
      }

      const result = await actor.dispatch({
        type: 'RETURN_TO_AUTOMATIC',
        adminId,
        eventId: `req_${Date.now()}_${Math.random()}`
      });

      res.json({ status: result.status });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createJunctionsRouter };
