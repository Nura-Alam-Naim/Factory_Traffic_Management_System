# Factory Traffic Management System: MEGAPLAN

> Master execution plan built from [PLAN.md](./PLAN.md). PLAN.md says **what** to decide. This file says **how to build it**: phase by phase, with a test gate at the end of each phase.
>
> **Stack:** Node.js (CommonJS), Express.js, REST, MySQL (`mysql2`), MQTT (`mqtt` + embedded `aedes` broker), React (Vite), Jest, Supertest, fast-check, Zod.

---

## Table of Contents

1. [Guiding Principles](#1-guiding-principles)
2. [Full Architecture](#2-full-architecture)
3. [Domain Model (Concrete Shapes)](#3-domain-model-concrete-shapes)
4. [State Machine & Mode Lattice](#4-state-machine--mode-lattice)
5. [Key Runtime Flows](#5-key-runtime-flows)
6. [Persistence Schema](#6-persistence-schema)
7. [MQTT Topic Design](#7-mqtt-topic-design)
8. [Phase Overview](#8-phase-overview)
9. [Phases in Detail](#9-phases-in-detail)
10. [Test Matrix](#10-test-matrix)
11. [Decisions & Deviations from PLAN.md](#11-decisions--deviations-from-planmd)
12. [Risk Register](#12-risk-register)
13. [Definition of Done](#13-definition-of-done)

---

## 1. Guiding Principles

| # | Principle | Where it is enforced |
|---|---|---|
| P1 | **Safety first.** NS and EW are never GREEN together, in desired or believed actual state | `domain/safety.js` (single guard) + property test |
| P2 | **Pure domain.** No I/O, no `Date.now()`, no promises, no imports from Express, mysql2, or mqtt | ESLint `no-restricted-imports` + review grep |
| P3 | **Clients submit intents, never signal states** | API validation schemas |
| P4 | **One serialized queue per junction (actor)** | `application/junction_actor.js` |
| P5 | **Desired ≠ actual.** Actual changes only on controller ACK/status | `domain/engine.js` ACK handler |
| P6 | **Snapshot + audit in one transaction** | `repository.saveTransition()` |
| P7 | **Every decision has a "why"** | `AuditEntry.reason` is required |
| P8 | **Tick-driven time.** No timers in handlers | `application/tick_loop.js` + `Clock` port |
| P9 | **Each phase ends with green tests and a commit** | Phase gates (Section 9) |

---

## 2. Full Architecture

### 2.1 Layered view (Hexagonal / Ports & Adapters)

```mermaid
flowchart TB
    subgraph Clients
        UI["React Dashboard (Vite)"]
        CURL["curl / Postman"]
        CTRL["Signal Controller (real or simulated)"]
    end

    subgraph API["api/ (Express)"]
        ROUTES["routes/*.js"]
        VALID["validation.js (Zod)"]
        ERR["errors.js"]
        SSE["sse.js (status stream)"]
    end

    subgraph APP["application/"]
        SVC["service.js (TrafficService)"]
        REG["actor_registry.js"]
        ACTOR["junction_actor.js (1 per junction)"]
        TICK["tick_loop.js"]
        REC["recovery.js"]
        PORTS_APP["repository_port.js"]
    end

    subgraph DOMAIN["domain/ (PURE)"]
        ENGINE["engine.js handle() / tick()"]
        SM["state_machine.js"]
        SAFE["safety.js (single guard)"]
        SCHED["scheduler.js"]
        MODES["modes.js (emergency/manual)"]
        QUEUE["queues.js"]
        CMD["commands.js (ACK bookkeeping)"]
        MODELS["models.js / config.js / events.js / effects.js"]
        PORTS["ports.js (ControllerPort, Clock)"]
    end

    subgraph INFRA["infrastructure/"]
        MYSQL["mysql_repo.js"]
        MEM["memory_repo.js (tests)"]
        MQTTA["mqtt_adapter.js (ControllerPort)"]
        BROKER["mqtt_broker.js (embedded aedes)"]
        SIM["controller_sim.js"]
        CLOCK["clock.js (SystemClock, FakeClock)"]
    end

    DB[("MySQL")]

    UI -->|REST + SSE| ROUTES
    CURL -->|REST| ROUTES
    ROUTES --> VALID --> SVC
    SVC --> REG --> ACTOR
    TICK --> ACTOR
    ACTOR --> ENGINE
    ENGINE --> SM --> SAFE
    ENGINE --> SCHED
    ENGINE --> MODES
    ENGINE --> QUEUE
    ENGINE --> CMD
    ACTOR --> PORTS_APP
    MYSQL -.implements.-> PORTS_APP
    MEM -.implements.-> PORTS_APP
    MQTTA -.implements.-> PORTS
    SIM -.implements.-> PORTS
    MYSQL --> DB
    MQTTA <-->|commands / acks / status| BROKER
    CTRL <-->|MQTT| BROKER
    SIM <-->|MQTT or in-process| BROKER
    REC --> ACTOR
```

**Dependency rule:** `api → application → domain ← infrastructure`. The domain only knows `ports.js`. The repository interface lives in `application/` because persistence is an application concern, not a domain concern.

### 2.2 Directory tree (final)

```
Factory_Traffic_Management_System/
├── AGENTS.md                       # Rules from PLAN.md Section 1
├── PLAN.md                         # Design decisions (source of truth)
├── MEGAPLAN.md                     # This file
├── README.md                       # Submission documentation
├── docker-compose.yml              # OPTIONAL: MySQL only (convenience)
├── docs/
│   ├── openapi.json
│   └── postman_collection.json
├── backend/
│   ├── package.json
│   ├── .env.example                # DB_HOST, DB_USER, DB_PASS, DB_NAME, MQTT_PORT, TICK_MS...
│   ├── .eslintrc.json              # no-restricted-imports for src/domain
│   ├── jest.config.js
│   ├── schema.sql                  # MySQL DDL (idempotent: IF NOT EXISTS)
│   ├── src/
│   │   ├── domain/                 # PURE, deterministic, synchronous
│   │   │   ├── models.js           # Enums: Direction, Signal, Stage, Mode, VehicleType, DeviceStatus, CommandStatus
│   │   │   ├── config.js           # defaultJunctionConfig(), validateConfig()
│   │   │   ├── events.js           # Input factories: sensorEvent(), controllerAck(), manualRequest(), tick()...
│   │   │   ├── effects.js          # Effect factories: sendCommand(), audit(), alert(), reject()
│   │   │   ├── safety.js           # assertSafe(signals), guardTransition(from, to): THE one guard
│   │   │   ├── signals.js          # deriveSignals(stage, phase, config): signals are derived, never set
│   │   │   ├── state_machine.js    # nextStage(), beginTransitionTo(phase), stage timing rules
│   │   │   ├── scheduler.js        # scorePhase(), choosePhase(): returns {switch, target, reason}
│   │   │   ├── queues.js           # addVehicle(), clearVehicle(), tombstones, TTL cleanup
│   │   │   ├── modes.js            # emergency + manual lease policies, mode resolution
│   │   │   ├── commands.js         # issue/ack/nack/timeout/retry bookkeeping
│   │   │   ├── initial_state.js    # createJunctionState(config, now)
│   │   │   ├── engine.js           # handle(state, input, now) / tick(state, now)
│   │   │   └── ports.js            # JSDoc interfaces: ControllerPort, Clock
│   │   ├── application/
│   │   │   ├── repository_port.js  # JSDoc interface of the repository
│   │   │   ├── junction_actor.js   # Promise-chain mailbox; the ONLY mutator of a junction
│   │   │   ├── actor_registry.js   # junctionId -> actor
│   │   │   ├── service.js          # TrafficService: API/MQTT -> actor messages, results -> HTTP outcome
│   │   │   ├── effect_dispatcher.js# Executes SEND_COMMAND effects via ControllerPort
│   │   │   ├── status_view.js      # Maps state -> PDF status response shape
│   │   │   ├── status_bus.js       # EventEmitter for SSE fan-out
│   │   │   ├── tick_loop.js        # setInterval OUTSIDE handlers; enqueues TICK per junction
│   │   │   └── recovery.js         # Boot recovery (PLAN 3.7)
│   │   ├── infrastructure/
│   │   │   ├── db.js               # mysql2 pool, ensureDatabase(), applySchema()
│   │   │   ├── mysql_repo.js       # Repository implementation
│   │   │   ├── memory_repo.js      # In-memory repository for tests
│   │   │   ├── mqtt_broker.js      # Embedded aedes broker (no external install needed)
│   │   │   ├── mqtt_adapter.js     # ControllerPort over MQTT + inbound ACK/status subscription
│   │   │   ├── controller_sim.js   # Simulated controller: auto-ack, delay, offline, mismatch
│   │   │   └── clock.js            # SystemClock, FakeClock
│   │   ├── api/
│   │   │   ├── app.js              # createApp(deps): Express app factory (testable)
│   │   │   ├── routes/
│   │   │   │   ├── junctions.js
│   │   │   │   ├── sensor_events.js
│   │   │   │   ├── commands.js
│   │   │   │   ├── controller_events.js
│   │   │   │   ├── device_status.js
│   │   │   │   ├── history.js
│   │   │   │   ├── sim.js          # Simulator-only helpers
│   │   │   │   └── health.js
│   │   │   ├── sse.js              # GET /api/junctions/:id/stream
│   │   │   ├── validation.js       # Zod schemas
│   │   │   └── errors.js           # AppError + error middleware -> {error:{code,message}}
│   │   ├── config/env.js           # Reads .env with defaults
│   │   └── index.js                # Composition root: wiring, recovery, tick loop, shutdown
│   └── tests/
│       ├── helpers/                # builders, FakeClock helpers, invariant asserts
│       ├── domain/                 # NO HTTP, NO DB, NO MQTT
│       │   ├── safety.property.test.js
│       │   ├── normal_cycle.test.js
│       │   ├── scheduler.test.js
│       │   ├── emergency.test.js
│       │   ├── manual.test.js
│       │   ├── queues.test.js
│       │   └── controller.test.js
│       ├── application/
│       │   ├── recovery.test.js
│       │   ├── actor.test.js
│       │   └── concurrency.test.js
│       ├── infrastructure/
│       │   └── mysql_repo.test.js  # Skipped unless MYSQL_TEST_URL is set
│       └── api/
│           └── api.smoke.test.js
└── frontend/
    ├── package.json
    ├── vite.config.js              # proxy /api -> backend
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── api/client.js           # fetch wrapper + error normalization
        ├── hooks/useJunctionStatus.js   # SSE with polling fallback
        ├── components/
        │   ├── JunctionOverview.jsx
        │   ├── IntersectionView.jsx     # 4 lights: fill=actual, outline=desired
        │   ├── SignalTable.jsx          # desired vs actual
        │   ├── ModeBanner.jsx           # mode badge, emergency/manual/degraded banners, lease countdown
        │   ├── AlertsPanel.jsx
        │   ├── PendingCommand.jsx
        │   ├── ManualControls.jsx
        │   ├── ActivityLog.jsx
        │   ├── SimulationPanel.jsx
        │   └── Toasts.jsx
        └── styles.css
```

### 2.3 Responsibility of each layer

| Layer | Owns | Must NOT |
|---|---|---|
| **domain** | Rules: safety, sequencing, scheduling, modes, queues, command bookkeeping | Do I/O, read clocks, use promises, know HTTP codes |
| **application** | Serialization (actor), dedup by `event_id`, persistence orchestration, effect dispatch, recovery | Contain traffic rules |
| **infrastructure** | MySQL, MQTT, simulator, real clock | Contain traffic rules |
| **api** | HTTP ↔ messages, validation, error mapping, SSE | Contain traffic rules |
| **frontend** | Rendering backend state, sending intents | Contain sequencing logic |

---

## 3. Domain Model (Concrete Shapes)

### 3.1 Enums (`models.js`)

```js
Direction   = NORTH | SOUTH | EAST | WEST
Signal      = GREEN | YELLOW | RED | UNKNOWN
Stage       = GREEN | YELLOW | ALL_RED
Mode        = AUTOMATIC | MANUAL | EMERGENCY | DEGRADED | RECOVERING
VehicleType = EMERGENCY | TRUCK | FORKLIFT | EMPLOYEE
DeviceStatus= ONLINE | OFFLINE | DEGRADED | WARNING | UNKNOWN
CommandStatus = PENDING | CONFIRMED | FAILED | TIMED_OUT | SUPERSEDED | ABANDONED_ON_RESTART
```

### 3.2 Junction config (`config.js`)

```js
{
  phases:    { NS: ['NORTH','SOUTH'], EW: ['EAST','WEST'] },
  conflicts: { NS: ['EW'], EW: ['NS'] },
  timings:   { greenTargetMs: 30000, yellowMs: 5000, allRedMs: 2000,
               minGreenMs: 10000, maxGreenMs: 60000 },
  scoring:   { weights: { EMERGENCY: 100, TRUCK: 5, FORKLIFT: 3, EMPLOYEE: 1 },
               waitFactor: 0.1, hysteresis: 1.2, maxWaitMs: 90000, starvationBonus: 1000 },
  controller:{ ackTimeoutMs: 5000, maxRetries: 2 },
  policies:  { manualLeaseMs: 300000, emergencyTimeoutMs: 120000,
               staleEventMaxAgeMs: 300000, queueEntryTtlMs: 900000 }
}
```
`validateConfig()`: conflicts are symmetric, every direction belongs to exactly one phase, timings positive, `minGreen ≤ maxGreen`.

### 3.3 Junction state (`initial_state.js`)

```js
{
  junctionId: 'A',
  config,
  mode: 'RECOVERING',
  stage: 'ALL_RED',            // GREEN | YELLOW | ALL_RED
  phase: null,                 // active phase for GREEN/YELLOW, null for ALL_RED
  nextPhase: null,             // where ALL_RED is heading
  stageConfirmedAt: null,      // set when ACK confirms the stage: timers start here
  desiredSignals: { NORTH:'RED', SOUTH:'RED', EAST:'RED', WEST:'RED' },
  actualSignals:  { NORTH:'UNKNOWN', ... },
  actualStale: true,
  queues: { NORTH: { [vehicleId]: { type, arrivedAt, seq } }, ... },
  tombstones: { [vehicleId]: { seq, clearedAt } },
  lastSeq: { 'NORTH:sensor-1': 42 },
  pendingCommand: null,        // { commandId, requestedSignals, sentAt, attempts, status }
  commandCounter: 0,           // deterministic id generation: `${junctionId}-${n}`
  emergency: { active: [ { vehicleId, direction, phase, receivedAt } ] }, // ordered, first wins
  manualLease: null,           // { adminId, phase, direction, expiresAt }
  devices: { controller: 'UNKNOWN', sensors: { NORTH:'ONLINE', ... } },
  alerts: [ { code, message, since } ],
  lastDecision: null,          // last scheduler reason string
  updatedAt
}
```

### 3.4 Inputs (`events.js`)

| Type | Source | Payload |
|---|---|---|
| `SENSOR_EVENT` | API / MQTT | `eventId, junctionId, direction, vehicleId, vehicleType?, eventType (VEHICLE_ARRIVED/VEHICLE_CLEARED), sequenceNo, timestamp, receivedAt` |
| `MANUAL_GREEN_REQUEST` | API | `direction, adminId` |
| `RETURN_TO_AUTOMATIC` | API | `adminId` |
| `CONTROLLER_ACK` / `CONTROLLER_NACK` | API / MQTT | `commandId, actualSignals, reason?` |
| `CONTROLLER_STATUS` | API / MQTT | `status ONLINE/OFFLINE` |
| `DEVICE_STATUS` | API | `deviceType (SENSOR/SIGNAL/CONTROLLER), direction?, status` |
| `TICK` | tick loop | `(none, uses now)` |
| `RECOVER` | boot | `previousState` |

### 3.5 Output (`engine.js`)

```js
handle(state, input, now) -> {
  state,                        // new state (never mutate input)
  effects: [                    // data only
    { type: 'SEND_COMMAND', command: { commandId, junctionId, requestedSignals, attempt } },
    { type: 'AUDIT', eventType, reason, details },
  ],
  outcome: { status: 'ACCEPTED' | 'IGNORED' | 'REJECTED', code?, message? }
}
```
The service maps `outcome.code` to HTTP status (e.g. `MANUAL_LEASE_CONFLICT → 409`). The domain never knows HTTP.

---

## 4. State Machine & Mode Lattice

### 4.1 Stage cycle with ACK gating

```mermaid
stateDiagram-v2
    [*] --> ALL_RED_BOOT: boot / recovery
    ALL_RED_BOOT --> NS_GREEN: ACK(all red) + allRed elapsed + scheduler picks NS
    ALL_RED_BOOT --> EW_GREEN: ACK(all red) + allRed elapsed + scheduler picks EW

    NS_GREEN --> NS_YELLOW: switch decision (scheduler / emergency / manual)
    NS_YELLOW --> ALL_RED_TO_EW: ACK(yellow) + yellowMs elapsed
    ALL_RED_TO_EW --> EW_GREEN: ACK(all red) + allRedMs elapsed + actual NS == RED

    EW_GREEN --> EW_YELLOW: switch decision
    EW_YELLOW --> ALL_RED_TO_NS: ACK(yellow) + yellowMs elapsed
    ALL_RED_TO_NS --> NS_GREEN: ACK(all red) + allRedMs elapsed + actual EW == RED

    NS_GREEN --> DEGRADED_ALL_RED: ACK timeout / controller offline
    EW_GREEN --> DEGRADED_ALL_RED: ACK timeout / controller offline
    NS_YELLOW --> DEGRADED_ALL_RED: ACK timeout / controller offline
    EW_YELLOW --> DEGRADED_ALL_RED: ACK timeout / controller offline
    DEGRADED_ALL_RED --> ALL_RED_BOOT: controller ONLINE -> reconcile
```

**Stage timer rule:** a stage's duration counts from `stageConfirmedAt` (the ACK time), not from when the command was sent. So YELLOW is never shorter than 5 s in physical reality.

**The single guard (`safety.js`)**, called by every transition:
1. Derived desired signals must not have two conflicting phases non-RED.
2. Allowed edges only: `GREEN→YELLOW`, `YELLOW→ALL_RED`, `ALL_RED→GREEN`, `ANY→ALL_RED` (fail-safe).
3. `ALL_RED→GREEN(P)` requires every conflicting direction's **actual** = `RED` and no pending command.
4. No GREEN in `DEGRADED` or `RECOVERING` (before reconcile ACK).

A violation throws `SafetyViolation`. Tests assert it never fires on legal inputs; the property test proves no input sequence produces a conflicting state.

### 4.2 Mode lattice

```mermaid
flowchart LR
    DEG["DEGRADED (safety)"] --> EMG["EMERGENCY"] --> MAN["MANUAL"] --> AUTO["AUTOMATIC"]
    REC["RECOVERING (boot)"] -.after ALL_RED ACK.-> AUTO
    REC -.lease valid.-> MAN
    REC -.emergency still active.-> EMG
```

`resolveMode(state, now)` = the highest active mode: `DEGRADED` if controller unconfirmed/offline, else `EMERGENCY` if emergencies active, else `MANUAL` if lease valid, else `AUTOMATIC`. When EMERGENCY clears, the mode falls back to MANUAL if the lease is still valid, otherwise AUTOMATIC (audited).

### 4.3 Target-phase resolution (who decides the next GREEN)

| Mode | Target phase |
|---|---|
| DEGRADED / RECOVERING | none (hold ALL_RED) |
| EMERGENCY | phase of the earliest `emergency.active[0]` |
| MANUAL | `manualLease.phase` |
| AUTOMATIC | `scheduler.choosePhase()` |

If the target differs from the current GREEN phase, the engine starts the safe sequence (`GREEN→YELLOW`). Min-green may be skipped for EMERGENCY only. YELLOW/ALL_RED are never skipped.

---

## 5. Key Runtime Flows

### 5.1 Sensor event → state change → command → ACK

```mermaid
sequenceDiagram
    participant C as Client (API/MQTT)
    participant S as TrafficService
    participant A as JunctionActor
    participant R as Repository
    participant E as Engine (pure)
    participant P as ControllerPort (MQTT)
    participant K as Controller

    C->>S: POST /api/sensor-events
    S->>S: Zod validation (422 on failure)
    S->>A: enqueue(SENSOR_EVENT)
    A->>R: isProcessed(eventId)?
    alt duplicate
        A->>R: audit DUPLICATE_EVENT_REJECTED
        A-->>S: {status: duplicate}
        S-->>C: 200
    else new
        A->>E: handle(state, event, clock.now())
        E-->>A: {state', effects, outcome}
        A->>R: TX: snapshot + processed_event + audit rows + commands
        A->>P: dispatch SEND_COMMAND effects (after commit)
        A-->>S: outcome
        S-->>C: 201
        P->>K: factory/junctions/A/commands
        K-->>P: factory/junctions/A/acks
        P->>S: CONTROLLER_ACK
        S->>A: enqueue(CONTROLLER_ACK)
        A->>E: handle(...) updates actualSignals
    end
```

**Order inside the actor:** compute → persist in one TX → dispatch commands → publish status to SSE. Commands are only sent after commit, so a crash never leaves an unrecorded command on the wire.

### 5.2 ACK timeout and DEGRADED

```
TICK: pendingCommand && now - sentAt > ackTimeoutMs
  attempts < 1 + maxRetries  -> re-send SAME commandId, attempts++, audit COMMAND_RETRY
  else                       -> status TIMED_OUT, audit CONTROLLER_TIMEOUT,
                                mode DEGRADED, desired ALL_RED, alert, actualStale = true
```

### 5.3 Restart recovery

```
index.js boot:
  repo.loadAll() -> for each junction:
    actualSignals = UNKNOWN, PENDING commands -> ABANDONED_ON_RESTART (audit)
    audit RECOVERY_STARTED { previous: stage/phase/mode }
    engine.handle(state, RECOVER) -> mode RECOVERING, desired ALL_RED, SEND_COMMAND
  ACK -> resolveMode() -> continue from ALL_RED
  no ACK after retries -> DEGRADED
HTTP server starts listening only after recovery has been enqueued for all junctions.
```

### 5.4 The PDF concurrency sequence (T=0..17 ms)

All inputs are enqueued nearly at the same time. The actor processes them strictly one at a time in arrival order: truck arrival → emergency arrival → manual request (accepted but overridden by EMERGENCY, or 409 as documented) → duplicate emergency (200 duplicate) → ACK. The final state is checked with `assertInvariants()`.

---

## 6. Persistence Schema

```sql
junctions        (id PK, name, config JSON, created_at)
junction_state   (junction_id PK FK, state JSON, version INT, updated_at)        -- full snapshot
queue_vehicles   (junction_id, vehicle_id, direction, vehicle_type, arrived_at, seq, PK(junction_id, vehicle_id))
tombstones       (junction_id, vehicle_id, seq, cleared_at, PK(junction_id, vehicle_id))
processed_events (event_id PK, junction_id, received_at)
commands         (command_id PK, junction_id, requested JSON, status, attempts, sent_at, acked_at, updated_at)
audit_log        (id PK AUTO, junction_id, event_type, reason, details JSON, created_at, INDEX(junction_id, created_at), INDEX(event_type))
device_status    (junction_id, device_id, device_type, status, updated_at, PK(junction_id, device_id))
rejected_events  (id PK AUTO, payload JSON, error_code, message, received_at)
```

- `junction_state.version` gives optimistic-concurrency protection as a second line of defense.
- The snapshot JSON is the recovery source; the normalized tables (`queue_vehicles`, `commands`, `device_status`) are written in the same transaction for querying/reporting.
- `db.js` runs `CREATE DATABASE IF NOT EXISTS` and applies `schema.sql` on boot, so a fresh clone needs only a running MySQL.

**Repository port (`application/repository_port.js`):**
```js
loadJunctions() / loadState(id) / createJunction(cfg)
isProcessed(eventId)
saveTransition({ junctionId, state, version, auditEntries, processedEventId?, commands?, rejected? })  // ONE TX
appendAudit(entries)                       // for non-state-changing audits (duplicates, rejections)
getHistory(junctionId, { limit, eventType })
markPendingCommandsAbandoned(junctionId)
```

---

## 7. MQTT Topic Design

| Topic | Direction | Payload |
|---|---|---|
| `factory/junctions/{id}/commands` | backend → controller | `{command_id, junction_id, requested_signals, attempt}` (QoS 1) |
| `factory/junctions/{id}/acks` | controller → backend | `{command_id, status: ACK/NACK, actual_signals}` |
| `factory/junctions/{id}/controller-status` | controller → backend | `{event_id, status: ONLINE/OFFLINE}` (retained + LWT = OFFLINE) |
| `factory/junctions/{id}/sensor-events` | sensors → backend | same body as REST sensor event |

- The **embedded aedes broker** starts with the backend (`MQTT_PORT`, default 1883), so no Mosquitto install is needed. `MQTT_URL` can point to an external broker instead.
- MQTT messages go through the **same** `TrafficService` path as REST: same validation, same actor, same dedup.
- **Last Will (LWT)** on the controller connection publishes `OFFLINE` automatically when it drops. This is a strong talking point for the interview.
- The dashboard receives updates over **SSE**, not MQTT (see Section 11).

---

## 8. Phase Overview

| Phase | Name | Est. | Test gate | Commit tag |
|---|---|---|---|---|
| 0 | Scaffold & tooling | 15 min | `npm test` runs (1 sanity test), lint passes | `phase-0` |
| 1A | Domain foundations (models, config, signals, safety, state machine) | 45 min | safety + normal cycle tests | `phase-1a` |
| 1B | Scheduler + queues | 35 min | scheduler + queue tests | `phase-1b` |
| 1C | Modes (emergency, manual) + controller bookkeeping + engine | 60 min | emergency, manual, controller, **property test** | `phase-1c` |
| 2 | Persistence + recovery | 45 min | recovery tests (memory repo), MySQL repo test (optional) | `phase-2` |
| 3 | Actor, service, tick loop, MQTT, simulator | 50 min | actor + concurrency tests | `phase-3` |
| 4 | REST API + SSE + OpenAPI/Postman | 40 min | Supertest smoke tests | `phase-4` |
| 5 | React dashboard | 50 min | manual UI checklist + build passes | `phase-5` |
| 6 | README + demo scripts | 35 min | all 9 PDF scenarios run via curl | `phase-6` |
| 7 | Strict review & hardening | 30 min | full suite + forbidden-import grep + failing-test-first fixes | `phase-7` |
| | **Total** | **~6.5 h** | | |

> **If short on time, cut in this order:** SSE (use polling), UI polish, history filtering, docker-compose, MySQL integration test. **Never cut:** domain safety, domain tests, recovery, README required sections.

---

## 9. Phases in Detail

Every phase uses the same **workflow loop**:

```mermaid
flowchart LR
    A["Read phase spec + PLAN.md refs"] --> B["Write/extend tests first (where practical)"]
    B --> C["Implement smallest slice"]
    C --> D["npm test"]
    D -->|red| C
    D -->|green| E["Self-review: rules P1-P9, forbidden imports"]
    E --> F["Summarize changes + assumptions"]
    F --> G["git commit -m 'phase-N: ...'"]
    G --> H["STOP: wait for approval"]
```

---

### Phase 0: Scaffold & Tooling

**Goal:** an empty but runnable skeleton, so later phases only add logic.

**Work**
- Create the directory tree from Section 2.2 (empty modules export stubs; no logic).
- `backend/package.json` (CommonJS). Deps: `express`, `mysql2`, `zod`, `mqtt`, `aedes`, `dotenv`, `cors`. Dev: `jest`, `supertest`, `fast-check`, `eslint`.
- Scripts: `start`, `dev` (`node --watch`), `test`, `test:domain`, `lint`.
- `.eslintrc.json` with `no-restricted-imports` / `no-restricted-properties` (`Date.now`) for `src/domain/**`.
- `AGENTS.md` = PLAN.md Section 1 rules.
- `README.md` with the required headings: Overview, Setup & Run, Architecture Decisions, Traffic-Control Algorithm, State Transitions, **Assumptions / Questions / Requirement Issues**, API Docs, Demo Scenarios, Tests, Incomplete / Next Steps, **AI / Tool Usage**.
- `.gitignore` (`node_modules`, `.env`, `dist`, `coverage`), `.env.example`.
- Optional `docker-compose.yml` with only MySQL 8.
- `frontend/`: Vite React scaffold (`npm create vite@latest frontend -- --template react`).

**Tests / gate**
- [ ] `cd backend && npm test`: one sanity test passes.
- [ ] `npm run lint` passes. A deliberate `require('express')` in `src/domain` fails lint (then removed).
- [ ] `cd frontend && npm run build` succeeds.

---

### Phase 1A: Domain Foundations

**Goal:** the safe stage machine, independent of scheduling and modes.

**Files:** `models.js`, `config.js`, `events.js`, `effects.js`, `signals.js`, `safety.js`, `state_machine.js`, `initial_state.js`, `clock.js` (FakeClock only).

**Work**
- Freeze enums (`Object.freeze`).
- `validateConfig(cfg)` returns `{ ok, errors[] }`.
- `deriveSignals(stage, phase, config)`: GREEN/YELLOW for the active phase's directions, RED for everything else; ALL_RED = all RED.
- `safety.js`: `assertNoConflict(signals, config)`, `guardTransition(state, toStage, toPhase)` (edge rules 1-4 from Section 4.1).
- `state_machine.js`: `startYellow(state, now)`, `startAllRed(state, nextPhase, now)`, `startGreen(state, phase, now)`, `stageElapsed(state, now)`, `isStageComplete(state, now)`. Each one calls the guard, recomputes desired signals, and returns a `SEND_COMMAND` effect plus an `AUDIT` effect (`SIGNAL_TRANSITION`, with reason).

**Tests**
- `normal_cycle.test.js`: NS_GREEN → YELLOW (after switch) → ALL_RED (after 5 s from ACK) → EW_GREEN (after 2 s from ACK) with exact timings on FakeClock.
- `safety.test.js`: guard rejects GREEN→GREEN, YELLOW→GREEN, ALL_RED→GREEN while the conflicting actual is not RED, GREEN while DEGRADED; `validateConfig` rejects asymmetric conflicts and duplicate directions.

**Gate:** `npm run test:domain` is green; grep of `src/domain` shows no forbidden imports.

---

### Phase 1B: Scheduler + Queues

**Goal:** a fair, explainable phase choice, and queues that can't go wrong.

**Files:** `scheduler.js`, `queues.js`.

**Work**
- `queues.addVehicle(state, evt)`: set semantics by `vehicleId`. Ignore if a tombstone exists with `seq ≥ evt.seq` (late arrival). Track `lastSeq` per (direction, source) for out-of-order detection (audited, not rejected).
- `queues.clearVehicle(state, evt)`: remove if present, else record a tombstone and audit `ORPHAN_CLEAR`.
- `queues.expireGhosts(state, now)`: TTL cleanup, audited `QUEUE_ENTRY_EXPIRED`.
- `scheduler.scorePhase(state, phase, now)` = weighted sum + `waitFactor × oldestWaitSec` + starvation bonus. Sensor-offline directions get a minimum periodic service score.
- `scheduler.choosePhase(state, now)` returns `{ switch: bool, target, reason }` following PLAN 3.4 rules (min green, hysteresis ×1.2, both empty → stay, max green, starvation overrides hysteresis).

**Tests (`scheduler.test.js`, `queues.test.js`)**
- Bigger queue wins; 1 truck (5) beats 4 employees (4); hysteresis blocks a 10 vs 11 switch; starvation forces a switch; empty junction never switches; no switch before min green; max green forces a switch when the other side waits.
- Duplicate ARRIVED (new event_id, same vehicle) → count 1; CLEARED on empty → count 0 + `ORPHAN_CLEAR`; orphan clear then late ARRIVED (lower seq) → ignored; ghost TTL expiry.
- `reason` strings are human-readable, e.g. `"EW score 14.2 > NS 9.1 × 1.2"`.

**Gate:** domain suite green.

---

### Phase 1C: Modes, Controller Bookkeeping, Engine

**Goal:** the complete pure engine: `handle()` and `tick()`.

**Files:** `modes.js`, `commands.js`, `engine.js`.

**Work**
- `commands.js`: `issue(state, requestedSignals, now)` (deterministic id `A-17`), `onAck` (CONFIRMED, update `actualSignals`, mismatch check → `STATE_MISMATCH`), `onNack`, `onDuplicateAck` (ignored), `onUnknownAck` (ignored + audited), `checkTimeout(state, now)` → retry with the same id or TIMED_OUT → DEGRADED.
- `modes.js`:
  - Emergency: `addEmergency` (idempotent by vehicleId, ordered by `receivedAt`, ties by event order), `clearEmergency`, `expireEmergencies(now)` → `EMERGENCY_TIMEOUT`.
  - Manual: `requestManual(adminId, direction, now)` → lease (409-coded rejection if another admin holds it, or if DEGRADED); same admin refreshes / changes direction; `returnToAutomatic(adminId)` (holder or any admin as an audited override); `expireLease(now)`.
  - `resolveMode(state)` and `targetPhase(state, now)` (Section 4.3).
- `engine.js`:
  - `handle(state, input, now)` dispatches by input type to the modules above, then calls `advance(state, now)`.
  - `tick(state, now)` = timeouts + lease/emergency expiry + ghost TTL + `advance`.
  - `advance()` = the only place that moves stages: if there is no pending command and the stage is complete, or the target phase differs → next legal stage via `state_machine` (guarded).
  - Controller OFFLINE → DEGRADED, pending FAILED, desired ALL_RED. ONLINE → reconcile: actual UNKNOWN, send ALL_RED, mode RECOVERING until ACK.
  - `RECOVER` input implements PLAN 3.7 steps 2-3 inside the domain.

**Tests**
- `emergency.test.js`: preemption goes through YELLOW + ALL_RED (never shortened); target already GREEN → hold; emergency during MANUAL overrides, then returns to MANUAL if the lease is valid; two emergencies on the same phase served together; conflicting emergencies → first wins, second is served next with no flapping; repeated emergency is idempotent; 120 s timeout; cleared → correct mode.
- `manual.test.js`: safe sequence to the requested phase; second admin → `MANUAL_LEASE_CONFLICT`; same admin changes direction; lease expiry → AUTOMATIC; RETURN_TO_AUTOMATIC; rejected in DEGRADED.
- `controller.test.js`: no advance without ACK; timeout → 2 retries with the same commandId → DEGRADED; duplicate ACK ignored; unknown commandId ignored; mismatch → alert, no advance; OFFLINE → DEGRADED; ONLINE → ALL_RED reconcile, then AUTOMATIC.
- `safety.property.test.js` (fast-check, ≥ 500 runs × 200 steps): random mix of sensor events, emergencies, manual requests, ACKs (correct, wrong, duplicate, missing), NACKs, OFFLINE/ONLINE, ticks with random time jumps. After **every** step: no conflicting GREEN in desired or actual; no GREEN→GREEN edge; YELLOW lasted ≥ yellowMs after ACK before ALL_RED; ALL_RED lasted ≥ allRedMs before GREEN.

**Gate:** whole domain suite green, property test green with 3 different seeds. **Commit. This is the most important checkpoint of the project.**

---

### Phase 2: Persistence + Recovery

**Goal:** state survives restarts safely.

**Files:** `schema.sql`, `infrastructure/db.js`, `mysql_repo.js`, `memory_repo.js`, `application/repository_port.js`, `application/recovery.js`.

**Work**
- Schema from Section 6 (idempotent DDL, utf8mb4, InnoDB).
- `db.js`: pool, `ensureDatabase()`, `applySchema()`.
- `mysql_repo.saveTransition()` = one `BEGIN … COMMIT` covering: snapshot UPSERT with version check, audit inserts, `processed_events` insert (unique PK → duplicate detection as a second line of defense), command upserts, queue/device table sync.
- `memory_repo.js` has the same interface (used by unit/application/API tests) and simulates transactional all-or-nothing writes.
- `recovery.js`: `recoverAll({ repo, clock, engine })` → for each junction: load → `markPendingCommandsAbandoned` → `engine.handle(state, RECOVER)` → persist → return effects to dispatch.
- Seed Junction A on first boot.

**Tests (`recovery.test.js`)**
- Parameterized over every stage (`NS_GREEN, NS_YELLOW, ALL_RED→EW, EW_GREEN, EW_YELLOW, ALL_RED→NS`, plus mid-pending-command): persist → simulate a crash (drop the in-memory actor) → recover → assert actual all UNKNOWN, desired ALL_RED, mode RECOVERING, old pending command `ABANDONED_ON_RESTART`, queues and history intact, `RECOVERY_STARTED` audit includes the previous state.
- After the ALL_RED ACK: a valid MANUAL lease is restored; an active emergency is restored; otherwise AUTOMATIC.
- No ACK → retries → DEGRADED.
- An old-command ACK from before the restart is ignored.
- `mysql_repo.test.js` (runs only if `MYSQL_TEST_URL` is set): TX rollback on failure leaves no partial audit; duplicate `event_id` is rejected by PK.

**Gate:** all tests green (MySQL test skipped or green).

---

### Phase 3: Actor, Service, Tick Loop, MQTT, Simulator

**Goal:** a serialized, live runtime around the pure engine.

**Files:** `junction_actor.js`, `actor_registry.js`, `service.js`, `effect_dispatcher.js`, `status_view.js`, `status_bus.js`, `tick_loop.js`, `mqtt_broker.js`, `mqtt_adapter.js`, `controller_sim.js`, `clock.js` (SystemClock).

**Work**
- **Actor:** a mailbox implemented as a promise chain (`this.tail = this.tail.then(() => this.#process(msg))`); errors are caught per message so one failure never stalls the queue. `#process`: dedup check → `engine.handle` → `repo.saveTransition` → in-memory state swap only after commit → dispatch effects → `statusBus.emit`.
- **Service:** `submitSensorEvent`, `submitCommand`, `submitControllerEvent`, `submitDeviceStatus`, `getStatus`, `getHistory`, `createJunction`. It maps `outcome` to a result object `{ httpStatus, body }`.
- **Tick loop:** a single `setInterval(TICK_MS = 250)` in `index.js` (not in handlers) that enqueues `TICK` to each actor; it skips a tick if the previous tick for that actor is still queued.
- **MQTT:** embedded aedes broker; `mqtt_adapter` implements `ControllerPort.send()` (publish QoS 1) and subscribes to acks/status/sensor topics → `service`.
- **Controller simulator:** connects as an MQTT client. Settings: `autoAck` (default on), `ackDelayMs`, `offline`, `forceMismatch`, `dropAcks`. Publishes `ONLINE` on start with LWT `OFFLINE`.

**Tests**
- `actor.test.js`: 100 concurrent enqueues are processed in order, with no interleaving (assert via a recorded sequence); a failing message doesn't block the next; state is not swapped if persistence throws.
- `concurrency.test.js`: the PDF T=0..17 ms sequence fired with `Promise.all` through the service with the memory repo + in-process fake controller port → final state consistent, duplicate counted once, invariants hold, audit order matches processing order.
- Simulator integration test (in-process port, no network): auto-ack drives a full cycle; `dropAcks` → DEGRADED.

**Gate:** full suite green; `npm start` boots with the embedded broker + simulator and the cycle advances in the logs.

---

### Phase 4: REST API + SSE + Docs

**Goal:** a thin HTTP layer with correct status codes.

**Files:** `api/app.js`, `api/routes/*.js`, `api/validation.js`, `api/errors.js`, `api/sse.js`, `index.js`, `docs/openapi.json`, `docs/postman_collection.json`.

**Endpoints** (PLAN Section 4) plus `GET /api/junctions/:id/stream` (SSE) and `/api/sim/*` (simulator-only, documented under "API changes").

| Case | Status |
|---|---|
| Sensor event accepted | 201 |
| Duplicate `event_id` | 200 `{status:"duplicate"}` |
| Unknown junction | 404 |
| Malformed / unknown enum | 422 |
| Stale event | 422 `STALE_EVENT` (documented) |
| Manual lease conflict / DEGRADED | 409 |
| Junction not ready (RECOVERING) for manual | 409 `NOT_READY` |
| Backend error | 500 with error body |

- `createApp(deps)` factory → Supertest uses the memory repo + FakeClock + fake port.
- `index.js` composition root: env → db → repo → broker → adapter → simulator → service → `recoverAll` → tick loop → `listen`. Graceful shutdown on SIGINT/SIGTERM: stop tick → drain actors → close broker/pool.
- Rejected payloads are stored in `rejected_events`.

**Tests (`api.smoke.test.js`)**
- Every row of the status table above.
- Duplicate returns 200 and the queue count is unchanged.
- `GET /status` matches the PDF shape (snapshot test of keys).
- History `?limit=&event_type=` filters correctly.
- Command flow: manual request → 202/200 → status shows MANUAL + lease.
- Error body always `{error:{code,message}}`.

**Gate:** full suite green; Postman collection imports and runs against a live server.

---

### Phase 5: React Dashboard

**Goal:** a functional operator view with no sequencing logic.

**Work**
- `useJunctionStatus(id)`: SSE (`EventSource`) with automatic fallback to 1 s polling on error; exposes `{ status, connected, error }`.
- Components per Section 2.2. The intersection graphic uses a CSS grid: light fill = **actual**, ring/outline = **desired**; UNKNOWN shows grey with a "?".
- Banners: EMERGENCY (red, shows vehicle + waiting conflicting emergency), MANUAL (admin + live lease countdown computed from `expires_at` returned by the backend), DEGRADED (amber), RECOVERING.
- Simulation panel: arrival/clearance form (direction, vehicle type, vehicle id auto-generated), emergency button, controller ONLINE/OFFLINE, "ACK pending command", auto-ack toggle, mismatch toggle.
- Error handling: backend unreachable banner, toasts on 4xx/5xx showing `error.message`, safe rendering of null/missing fields, invalid junction message.
- Styling: dark theme, color-coded signals, clear typography (Inter), subtle transitions.

**Tests / gate (manual checklist, recorded in README)**
- [ ] `npm run build` passes.
- [ ] Normal cycle visible; desired leads actual until ACK.
- [ ] Auto-ack off → stuck at pending → DEGRADED after retries.
- [ ] Emergency banner + preemption visible.
- [ ] Second admin manual → toast "409".
- [ ] Stopping the backend → unreachable banner; restarting → recovers.

---

### Phase 6: README + Demo Scripts

**Goal:** a reviewer can run and understand everything in 10 minutes.

**Work**
- Fill every README heading. Include the architecture diagram (Section 2.1), algorithm (PLAN 3.4), stage diagram with timings (Section 4.1), mode lattice, recovery procedure, concurrency strategy, real-time choice (SSE for UI, MQTT for devices), API table, "API changes" section.
- `scripts/demo/*.sh`: one curl script per PDF scenario (9 total), each printing the status before/after.
- **Assumptions / Questions / Requirement Issues:** every item in PLAN Section 8 + PDF Section 17, each with the **decision taken**.
- **AI / Tool Usage:** honest description (Antigravity used for planning, scaffolding, implementation, tests; all code reviewed and understood).
- **Incomplete / Next Steps:** auth, movement-level conflict matrix, pedestrian phases, hardware conflict monitor, horizontal scaling (actor sharding by junction).

**Gate:** fresh clone → follow the README → server up → all 9 demo scripts behave as described.

---

### Phase 7: Strict Review & Hardening

**Goal:** find holes before the interviewer does.

**Work**
1. `grep -rE "require\('(express|mysql2|mqtt|aedes)'\)|Date\.now|setTimeout|setInterval|Promise" backend/src/domain` → must be empty.
2. Attack the safety invariant: manual during YELLOW, emergency during ALL_RED, late ACK after a supersede, restart mid-transition, ONLINE during DEGRADED, ACK arriving after timeout. **Write a failing test first, then fix.**
3. Verify that every audit event type from PDF Section 11 is emitted (test: `grep` the list against `effects.audit(` calls).
4. Remove dead code, rename unclear identifiers, check JSDoc on public functions.
5. README ↔ behavior consistency pass.
6. Interview rehearsal: change `yellowMs`, add a rule (e.g. FORKLIFT weight 4), and time yourself making the change with tests.

**Gate:** full suite green; Section 13 checklist complete.

---

## 10. Test Matrix

| PLAN §6 item | Test file | Layer | Phase |
|---|---|---|---|
| 1 Safety property | `domain/safety.property.test.js` | domain | 1C |
| 2 Normal cycle | `domain/normal_cycle.test.js` | domain | 1A |
| 3 Scheduler | `domain/scheduler.test.js` | domain | 1B |
| 4 Emergency | `domain/emergency.test.js` | domain | 1C |
| 5 Manual | `domain/manual.test.js` | domain | 1C |
| 6 Queue/events | `domain/queues.test.js` | domain | 1B |
| 7 Controller | `domain/controller.test.js` | domain | 1C |
| 8 Recovery | `application/recovery.test.js` | application (memory repo) | 2 |
| 9 Concurrency | `application/concurrency.test.js` | application | 3 |
| 10 API smoke | `api/api.smoke.test.js` | api (Supertest) | 4 |
| + Actor ordering | `application/actor.test.js` | application | 3 |
| + MySQL TX | `infrastructure/mysql_repo.test.js` | infra (optional) | 2 |

Commands:
```bash
cd backend
npm test                 # everything (MySQL test auto-skips)
npm run test:domain      # pure domain only, < 2 s
MYSQL_TEST_URL=mysql://root:pass@localhost:3306/traffic_test npm test
```

---

## 11. Decisions & Deviations from PLAN.md

| Topic | PLAN.md | MEGAPLAN decision | Why |
|---|---|---|---|
| Repo root | `traffic/` folder | `backend/` and `frontend/` at repo root | The repo itself is the project |
| Real-time to UI | "MQTT to React, or SSE/polling" | **SSE to React, polling fallback**; MQTT for devices only | Browsers need MQTT-over-WebSocket + broker exposure; SSE is simpler, one-way, and enough for a dashboard |
| MQTT broker | unspecified | Embedded **aedes** broker, overridable by `MQTT_URL` | Fresh clone runs with no Mosquitto install |
| Controller transport | MQTT + REST fallback | MQTT is primary; `POST /api/controller-events` is the REST path to the same service | Both converge on one code path |
| Test persistence | "mock DB" | `memory_repo.js` implementing the same port | Real behavior, no mocking library; MySQL test optional |
| Module system | unspecified | CommonJS | Jest works without ESM flags |
| React tooling | `App.js` / CRA-like | Vite + `.jsx` | CRA is deprecated; Vite needs zero config |
| Stage timers | "timings" | Timers start at **ACK time** (`stageConfirmedAt`) | Guarantees physical YELLOW ≥ 5 s |
| Command id | uuid or counter | Deterministic `${junctionId}-${counter}` (persisted) | Keeps the domain pure and tests deterministic |
| Event dedup | `processed_events` | Checked in the actor (application) + DB PK | Unbounded set kept out of domain state |
| Extra files | – | `safety.js`, `signals.js`, `queues.js`, `modes.js`, `commands.js`, `effects.js` | Keeps files small (rule 9); listed in README "API changes / structure" |

---

## 12. Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| MySQL not available on the reviewer's machine | Can't run | `docker-compose.yml` for MySQL; clear README steps; tests don't need MySQL |
| Engine grows into one giant function | Hard to explain | Split by module (Phase 1A-1C); `advance()` is the only stage mover |
| Async bugs in the actor | Inconsistent state | Promise-chain mailbox + state swap only after commit + actor tests |
| Tick loop drift / overlapping ticks | Missed timeouts | Skip a tick if the previous one is still queued; timeouts are computed from absolute timestamps |
| Time overrun | Missing docs | Cut list in Section 8; README written incrementally per phase |
| Over-engineering (auth, analytics) | Wasted time | Refuse until the Section 13 checklist is complete |

---

## 13. Definition of Done

- [ ] `npm test` green; the domain suite runs with no HTTP/DB/MQTT.
- [ ] Property test green across multiple seeds.
- [ ] Fresh clone → README steps → server starts, DB and schema auto-created, Junction A seeded.
- [ ] All 9 PDF scenarios demonstrable via the UI **and** via curl scripts.
- [ ] Restart demo: kill mid-transition → restart → ALL_RED recovery; queues and history intact.
- [ ] README has the exact headings "Assumptions / Questions / Requirement Issues" and "AI / Tool Usage".
- [ ] `schema.sql`, `docs/openapi.json`, `docs/postman_collection.json`, and frontend source committed; no `node_modules`, no secrets.
- [ ] You can whiteboard: the stage diagram, why an actor, why queues are sets, ACK timeout path, recovery, and how to add Junction B or a real MQTT controller.
