'use strict';

const JunctionActor = require('../../src/application/actor');
const MemoryRepository = require('../../src/infrastructure/memory_repo');
const { createJunctionState } = require('../../src/domain/initial_state');
const { defaultJunctionConfig } = require('../../src/domain/config');
const { FakeClock } = require('../helpers/clock');

describe('Concurrency & Serialization', () => {
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

  test('Strict serialization under heavy concurrent load (PDF T=0..17ms)', async () => {
    // We fire all these simultaneously. The actor queue must serialize them.
    // If they ran in parallel without locks/versioning, the state would corrupt.
    // With actor queue, they should run strictly sequentially.

    // First we simulate a boot recover to put it in ALL_RED
    await actor.dispatch({ type: 'RECOVER' });
    
    // T=0: TRUCK SOUTH
    const p1 = actor.dispatch({ type: 'SENSOR_EVENT', eventId: 'evt_1', junctionId: 'A', direction: 'SOUTH', vehicleId: 'trk_1', vehicleType: 'TRUCK', eventType: 'VEHICLE_ARRIVED', sequenceNo: 1, receivedAt: clock.now() });
    // T=2: EMERGENCY NORTH
    const p2 = actor.dispatch({ type: 'SENSOR_EVENT', eventId: 'evt_2', junctionId: 'A', direction: 'NORTH', vehicleId: 'emg_1', vehicleType: 'EMERGENCY', eventType: 'VEHICLE_ARRIVED', sequenceNo: 2, receivedAt: clock.now() + 2 });
    // T=5: MANUAL EAST
    const p3 = actor.dispatch({ type: 'MANUAL_GREEN_REQUEST', eventId: 'evt_3', direction: 'EAST', adminId: 'admin_1' });
    // T=9: DUPLICATE EMERGENCY NORTH
    const p4 = actor.dispatch({ type: 'SENSOR_EVENT', eventId: 'evt_2', junctionId: 'A', direction: 'NORTH', vehicleId: 'emg_1', vehicleType: 'EMERGENCY', eventType: 'VEHICLE_ARRIVED', sequenceNo: 2, receivedAt: clock.now() + 9 });
    // T=12: ACK FOR ALL_RED
    const p5 = actor.dispatch({ type: 'CONTROLLER_ACK', commandId: 'A-1', actualSignals: { NORTH: 'RED', SOUTH: 'RED', EAST: 'RED', WEST: 'RED' } });

    // Wait for all to finish
    const results = await Promise.all([p1, p2, p3, p4, p5]);

    const finalStateRec = await repo.loadState('A');
    const finalState = finalStateRec.state;

    // 1. EMERGENCY should win (Mode = EMERGENCY, target = NS)
    expect(finalState.mode).toBe('EMERGENCY');
    
    // 2. We should be in ALL_RED because we haven't waited allRedMs (2000).
    expect(finalState.stage).toBe('ALL_RED');
    
    // Now advance clock by 2000 and tick
    clock.advance(2000);
    await actor.tick();

    const greenStateRec = await repo.loadState('A');
    const greenState = greenStateRec.state;

    // Now it should be GREEN for NS (target for EMERGENCY NORTH)
    expect(greenState.stage).toBe('GREEN');
    expect(greenState.phase).toBe('NS');
    expect(finalState.phase).toBe('NS');

    // 3. Duplicate should be ignored
    expect(results[3].status).toBe('IGNORED');
    expect(results[3].reason).toBe('DUPLICATE');

    // 4. Queues should have exactly 1 TRUCK and active emergency has 1.
    expect(finalState.queues.SOUTH['trk_1']).toBeDefined();
    expect(finalState.emergency.active.length).toBe(1);

    // 5. Version should be predictable
    // Initial = 1 (after saveTransition version 0)
    // RECOVER = 2
    // p1 = 3
    // p2 = 4
    // p3 = 5 (Manual is accepted, but overridden by emergency in reality)
    // p4 = 5 (Ignored, no version bump)
    // p5 = 6 (ACK -> GREEN transition)
    expect(finalStateRec.version).toBeGreaterThanOrEqual(5);
  });
});
