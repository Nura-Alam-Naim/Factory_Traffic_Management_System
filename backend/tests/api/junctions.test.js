'use strict';

const request = require('supertest');
const express = require('express');
const { createJunctionsRouter } = require('../../src/api/routes/junctions');

describe('API Routes', () => {
  let app;
  let repo;
  let actors;

  beforeEach(() => {
    repo = {
      loadJunctions: jest.fn().mockResolvedValue([{ id: 'A', config: {} }]),
      loadState: jest.fn().mockResolvedValue({ state: { mode: 'AUTOMATIC' } }),
      getHistory: jest.fn().mockResolvedValue([{ eventType: 'TEST' }])
    };

    actors = new Map([
      ['A', {
        dispatch: jest.fn().mockResolvedValue({ status: 'ACCEPTED' })
      }]
    ]);

    app = express();
    app.use(express.json());
    app.use('/api/junctions', createJunctionsRouter(repo, actors));
  });

  test('GET /api/junctions', async () => {
    const res = await request(app).get('/api/junctions');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([{ id: 'A', config: {} }]);
  });

  test('GET /api/junctions/:id/state', async () => {
    const res = await request(app).get('/api/junctions/A/state');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ mode: 'AUTOMATIC' });
  });

  test('POST /api/junctions/:id/manual', async () => {
    const res = await request(app)
      .post('/api/junctions/A/manual')
      .send({ adminId: 'admin1', direction: 'NORTH' });
      
    expect(res.statusCode).toBe(200);
    expect(actors.get('A').dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'MANUAL_GREEN_REQUEST',
      adminId: 'admin1',
      direction: 'NORTH'
    }));
  });
});
