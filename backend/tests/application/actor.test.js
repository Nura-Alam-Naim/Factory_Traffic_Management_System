'use strict';

const JunctionActor = require('../../src/application/actor');
const MemoryRepository = require('../../src/infrastructure/memory_repo');
const { createJunctionState } = require('../../src/domain/initial_state');
const { defaultJunctionConfig } = require('../../src/domain/config');
const { FakeClock } = require('../helpers/clock');

describe('JunctionActor', () => {
  let repo;
  let network;
  let clock;
  let actor;

  beforeEach(async () => {
    repo = new MemoryRepository();
    clock = new FakeClock(1000);
    network = {
      sendCommand: jest.fn().mockResolvedValue(),
      sendAlert: jest.fn().mockResolvedValue()
    };

    await repo.createJunction('A', defaultJunctionConfig());
    const state = createJunctionState('A', defaultJunctionConfig(), clock.now());
    await repo.saveTransition({ junctionId: 'A', state, version: 0 });

    actor = new JunctionActor('A', repo, network, clock);
  });

  test('Processes events sequentially', async () => {
    let activeTasks = 0;
    let maxOverlap = 0;

    // We will inject a delay in the mock network to artificially slow down processing
    // and verify that the next event doesn't start until the first finishes.
    // Wait, the delay would be inside the domain logic or repo to actually overlap.
    // Let's mock repo.loadState to take time.
    const origLoad = repo.loadState.bind(repo);
    repo.loadState = async (id) => {
      activeTasks++;
      if (activeTasks > maxOverlap) maxOverlap = activeTasks;
      await new Promise(r => setTimeout(r, 10));
      const res = await origLoad(id);
      activeTasks--;
      return res;
    };

    const p1 = actor.dispatch({ type: 'SENSOR_EVENT', eventType: 'VEHICLE_ARRIVED', vehicleId: 'v1', direction: 'NORTH', sequenceNo: 1, eventId: 'evt1' });
    const p2 = actor.dispatch({ type: 'SENSOR_EVENT', eventType: 'VEHICLE_ARRIVED', vehicleId: 'v2', direction: 'SOUTH', sequenceNo: 2, eventId: 'evt2' });

    await Promise.all([p1, p2]);

    // If they were parallel, maxOverlap would be 2
    expect(maxOverlap).toBe(1);
  });

  test('Deduplicates events with eventId', async () => {
    const evt = { type: 'SENSOR_EVENT', eventType: 'VEHICLE_ARRIVED', vehicleId: 'v1', direction: 'NORTH', sequenceNo: 1, eventId: 'evt1' };
    
    const res1 = await actor.dispatch(evt);
    expect(res1.status).not.toBe('IGNORED');

    const res2 = await actor.dispatch(evt);
    expect(res2.status).toBe('IGNORED');
    expect(res2.reason).toBe('DUPLICATE');

    const state = await repo.loadState('A');
    // Version should be 2 (creation=0 -> dispatch1=1 -> dispatch1 saved as 2). Duplicate doesn't bump version.
    expect(state.version).toBe(2);
  });

  test('Dispatches network effects', async () => {
    // Tick enough to generate an ALL_RED command (since initial state is RECOVERING and we never acked the boot ALL_RED because boot didn't happen via actor)
    // Actually, dispatching a RECOVER event will do it.
    await actor.dispatch({ type: 'RECOVER' });
    
    expect(network.sendCommand).toHaveBeenCalledWith('A', expect.objectContaining({
      commandId: expect.any(String),
      requestedSignals: expect.any(Object)
    }));
  });
});
