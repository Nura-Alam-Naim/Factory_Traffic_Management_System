'use strict';

const MemoryRepository = require('../../src/infrastructure/memory_repo');
const { recoverJunctions } = require('../../src/application/recovery');
const { createJunctionState } = require('../../src/domain/initial_state');
const { defaultJunctionConfig } = require('../../src/domain/config');
const { Mode, Stage, Signal, CommandStatus } = require('../../src/domain/models');
const { FakeClock } = require('../helpers/clock');

describe('Restart Recovery', () => {
  let repo;
  let clock;

  beforeEach(async () => {
    repo = new MemoryRepository();
    clock = new FakeClock(1000);
    
    // Seed A
    await repo.createJunction('A', defaultJunctionConfig());
  });

  test('Recovers from mid-transition state into ALL_RED baseline', async () => {
    // 1. Create a state that was in YELLOW with a pending command
    const state = createJunctionState('A', defaultJunctionConfig(), 0);
    state.mode = Mode.AUTOMATIC;
    state.stage = Stage.YELLOW;
    state.phase = 'NS';
    state.actualSignals = { NORTH: Signal.YELLOW, SOUTH: Signal.YELLOW, EAST: Signal.RED, WEST: Signal.RED };
    state.pendingCommand = { commandId: 'A-10', status: CommandStatus.PENDING };
    
    // Also add a queue
    state.queues.EAST['v1'] = { type: 'EMPLOYEE', receivedAt: 0, seq: 1 };

    await repo.saveTransition({
      junctionId: 'A',
      state,
      version: 0,
      commands: [state.pendingCommand]
    });

    // 2. Recover
    clock.advance(5000);
    const commandsToDispatch = await recoverJunctions({ repo, clock });

    // 3. Assertions
    const recovered = await repo.loadState('A');
    expect(recovered.state.mode).toBe(Mode.RECOVERING);
    expect(recovered.state.stage).toBe(Stage.ALL_RED);
    expect(recovered.state.actualSignals.NORTH).toBe(Signal.UNKNOWN); // Wiped
    
    // Queue preserved
    expect(recovered.state.queues.EAST['v1']).toBeDefined();

    // Pending command abandoned
    const oldCmd = repo.commands.get('A-10');
    expect(oldCmd.status).toBe(CommandStatus.ABANDONED_ON_RESTART);

    // New ALL_RED command generated
    expect(commandsToDispatch.length).toBe(1);
    expect(commandsToDispatch[0].command.requestedSignals.NORTH).toBe(Signal.RED);

    // Audit generated
    const history = await repo.getHistory('A');
    const recoveryAudit = history.find(a => a.eventType === 'RECOVERY_STARTED');
    expect(recoveryAudit).toBeDefined();
    expect(recoveryAudit.details.stage).toBe(Stage.YELLOW);
  });
});
