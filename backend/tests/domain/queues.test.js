'use strict';

const { addVehicle, clearVehicle, expireGhosts } = require('../../src/domain/queues');
const { createJunctionState } = require('../../src/domain/initial_state');
const { defaultJunctionConfig } = require('../../src/domain/config');
const { VehicleType, Direction } = require('../../src/domain/models');

describe('Queues', () => {
  let state;
  let now;

  beforeEach(() => {
    state = createJunctionState('A', defaultJunctionConfig(), 0);
    now = 1000;
  });

  test('addVehicle puts vehicle in correct queue', () => {
    addVehicle(state, {
      direction: Direction.NORTH,
      vehicleId: 'v1',
      vehicleType: VehicleType.TRUCK,
      sequenceNo: 1,
      receivedAt: now,
    });

    expect(state.queues.NORTH.v1).toEqual({
      type: VehicleType.TRUCK,
      receivedAt: now,
      seq: 1,
    });
  });

  test('clearVehicle removes vehicle and leaves tombstone', () => {
    addVehicle(state, {
      direction: Direction.NORTH, vehicleId: 'v1', sequenceNo: 1, receivedAt: now
    });
    const effects = clearVehicle(state, {
      direction: Direction.NORTH, vehicleId: 'v1', sequenceNo: 2, receivedAt: now + 10
    });

    expect(state.queues.NORTH.v1).toBeUndefined();
    expect(state.tombstones.v1).toEqual({ seq: 2, clearedAt: now + 10 });
    expect(effects.length).toBe(0);
  });

  test('orphan clear generates an audit', () => {
    const effects = clearVehicle(state, {
      direction: Direction.NORTH, vehicleId: 'v2', sequenceNo: 1, receivedAt: now
    });
    
    expect(state.tombstones.v2).toBeDefined();
    expect(effects).toContainEqual(expect.objectContaining({
      type: 'AUDIT',
      eventType: 'ORPHAN_CLEAR',
    }));
  });

  test('late arrival after clearance is ignored', () => {
    // Vehicle clears at seq 2
    clearVehicle(state, { direction: Direction.NORTH, vehicleId: 'v1', sequenceNo: 2, receivedAt: now });
    
    // Arrival from seq 1 arrives later
    const effects = addVehicle(state, {
      direction: Direction.NORTH, vehicleId: 'v1', sequenceNo: 1, receivedAt: now + 5
    });

    expect(state.queues.NORTH.v1).toBeUndefined();
    expect(effects).toContainEqual(expect.objectContaining({ eventType: 'IGNORED_LATE_ARRIVAL' }));
  });

  test('expireGhosts removes old entries', () => {
    state.config.policies.queueEntryTtlMs = 5000;
    
    addVehicle(state, { direction: Direction.NORTH, vehicleId: 'old', sequenceNo: 1, receivedAt: 100 });
    addVehicle(state, { direction: Direction.NORTH, vehicleId: 'new', sequenceNo: 2, receivedAt: 5000 });

    const effects = expireGhosts(state, 6000); // 6000 - 100 = 5900 > 5000 (expires). 6000 - 5000 = 1000 < 5000 (keeps)

    expect(state.queues.NORTH.old).toBeUndefined();
    expect(state.queues.NORTH.new).toBeDefined();
    expect(effects).toContainEqual(expect.objectContaining({ eventType: 'QUEUE_ENTRY_EXPIRED' }));
  });
});
