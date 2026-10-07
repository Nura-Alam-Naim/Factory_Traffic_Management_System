'use strict';

const fc = require('fast-check');
const { handle } = require('../../src/domain/engine');
const { createJunctionState } = require('../../src/domain/initial_state');
const { defaultJunctionConfig } = require('../../src/domain/config');
const { Stage, Direction, Mode } = require('../../src/domain/models');
const events = require('../../src/domain/events');
const { assertNoConflict } = require('../../src/domain/safety');

describe('Safety Property Test', () => {
  test('Random sequence preserves invariants', () => {
    // Generate events
    const evtGen = fc.oneof(
      // Ticks with random time jumps (0-10000ms)
      fc.integer({ min: 0, max: 10000 }).map(jump => ({ type: 'TICK', jump })),
      // Sensors
      fc.record({
        type: fc.constant('SENSOR'),
        dir: fc.constantFrom(Direction.NORTH, Direction.SOUTH, Direction.EAST, Direction.WEST),
        vType: fc.constantFrom('EMPLOYEE', 'TRUCK', 'EMERGENCY'),
        eType: fc.constantFrom('VEHICLE_ARRIVED', 'VEHICLE_CLEARED')
      }),
      // Manual
      fc.record({ type: fc.constant('MANUAL'), dir: fc.constantFrom(Direction.NORTH, Direction.EAST) }),
      // Acks
      fc.record({ type: fc.constant('ACK'), delay: fc.integer({min: 0, max: 2000}) }),
      // Controller status
      fc.constant({ type: 'STATUS', status: 'OFFLINE' }),
      fc.constant({ type: 'STATUS', status: 'ONLINE' })
    );

    fc.assert(
      fc.property(fc.array(evtGen, { maxLength: 200 }), (seq) => {
        let now = 10000;
        let state = createJunctionState('A', defaultJunctionConfig(), now);
        
        // Boot
        handle(state, events.recover(), now);
        handle(state, events.controllerAck(state.pendingCommand.commandId, {NORTH:'RED', SOUTH:'RED', EAST:'RED', WEST:'RED'}), now);
        
        let seqNo = 0;
        let vId = 0;

        for (const op of seq) {
          seqNo++;
          if (op.type === 'TICK') {
            now += op.jump;
            handle(state, events.tick(), now);
          } else if (op.type === 'SENSOR') {
            handle(state, events.sensorEvent('e'+seqNo, 'A', op.dir, 'v'+(++vId), op.vType, op.eType, seqNo, now, now), now);
          } else if (op.type === 'MANUAL') {
            handle(state, events.manualRequest('admin1', op.dir), now);
          } else if (op.type === 'STATUS') {
            handle(state, events.controllerStatus(op.status), now);
          } else if (op.type === 'ACK') {
            if (state.pendingCommand) {
              now += op.delay;
              handle(state, events.controllerAck(state.pendingCommand.commandId, state.pendingCommand.requestedSignals), now);
            }
          }

          // Invariants!
          // 1. Never conflicting GREEN/YELLOW
          assertNoConflict(state.desiredSignals, state.config);
          assertNoConflict(state.actualSignals, state.config);

          // 2. Not GREEN in degraded/recovering
          if (state.mode === Mode.DEGRADED || state.mode === Mode.RECOVERING) {
            expect(state.stage).not.toBe(Stage.GREEN);
          }
        }
        
        return true;
      }),
      { numRuns: 100 }
    );
  });
});
