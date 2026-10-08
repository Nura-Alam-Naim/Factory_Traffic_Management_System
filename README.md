# Factory Traffic Management System

A mission-critical backend system for managing traffic signal junctions inside a busy industrial factory. Built with a **pure, deterministic domain engine**, an **actor-based concurrency model**, and a **React dashboard** for real-time monitoring.

> **Stack:** Node.js · Express.js · MySQL · MQTT (embedded aedes) · React (Vite) · Zod · Jest · fast-check

---

## Table of Contents

- [Overview](#overview)
- [Setup \& Run](#setup--run)
- [Architecture Decisions](#architecture-decisions)
- [Traffic-Control Algorithm](#traffic-control-algorithm)
- [State Transitions](#state-transitions)
- [Mode Lattice](#mode-lattice)
- [Concurrency Strategy](#concurrency-strategy)
- [Recovery Procedure](#recovery-procedure)
- [API Documentation](#api-documentation)
- [MQTT Topic Design](#mqtt-topic-design)
- [Database Schema](#database-schema)
- [Demo Scenarios](#demo-scenarios)
- [Tests](#tests)
- [Assumptions / Questions / Requirement Issues](#assumptions--questions--requirement-issues)
- [Incomplete / Next Steps](#incomplete--next-steps)
- [AI / Tool Usage](#ai--tool-usage)

---

## Overview

This system safely manages traffic flows for one or more factory junctions, preventing conflicts between vehicles — forklifts, trucks, employee vehicles, and emergency responders. The backend is driven by a **pure, deterministic state machine** that:

- **Never** allows opposing directions (NS and EW) to be GREEN simultaneously — in desired state *or* believed actual state.
- Enforces the only legal transition path between conflicting greens: `GREEN → YELLOW → ALL_RED → GREEN`.
- Separates **desired signals** (computed by the engine) from **actual signals** (confirmed by controller ACK only).
- Supports four operational modes: `AUTOMATIC`, `MANUAL`, `EMERGENCY`, and `DEGRADED`.
- Handles controller failures, stale sensors, duplicate events, out-of-order messages, and crash recovery.

---

## Setup & Run

### Prerequisites

| Requirement   | Version  | Notes                                      |
|---------------|----------|--------------------------------------------|
| **Node.js**   | ≥ 20     |                                            |
| **MySQL**     | 8.x      | Or use Docker (see below)                  |
| **npm**       | ≥ 9      | Bundled with Node.js                       |

### 1. Start the Database

**Option A — Docker (recommended):**
```bash
docker-compose up -d
```

**Option B — Local MySQL:**
Ensure a MySQL 8.x instance is running on `localhost:3306`. The backend creates the database and all tables automatically on boot.

### 2. Configure Environment

```bash
cp backend/.env.example backend/.env
# Edit backend/.env if your MySQL credentials differ from the defaults
```

Default `.env` values:
```env
PORT=3000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=factory_traffic
MQTT_PORT=1883
TICK_MS=250
START_SIMULATOR=true
```

### 3. Install Dependencies

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 4. Start the System

```bash
# Terminal 1: Backend (API server + embedded MQTT broker + controller simulator)
cd backend
npm start

# Terminal 2: Frontend (Vite React dashboard)
cd frontend
npm run dev
```

The backend will:
1. Connect to MySQL and create the database/tables if they don't exist.
2. Start an embedded MQTT broker on port 1883 (no Mosquitto installation needed).
3. Seed **Junction A** with the default 4-way intersection config.
4. Run the recovery procedure (safe `ALL_RED` baseline).
5. Start the controller simulator with auto-ACK enabled.
6. Begin the tick loop (every 250ms).

The frontend dashboard will be available at `http://localhost:5173` (proxied to the backend).

---

## Architecture Decisions

### Hexagonal Architecture (Ports & Adapters)

The system follows a strict layered architecture with an inward dependency rule:

```
api/ → application/ → domain/ ← infrastructure/
```

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Clients                                      │
│           React Dashboard    curl / Postman    Signal Controller     │
└────────────┬──────────────────────┬──────────────────┬──────────────┘
             │ REST + SSE          │ REST             │ MQTT
┌────────────▼──────────────────────▼──────────────────▼──────────────┐
│  api/                                                               │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  ┌───────────┐  │
│  │ routes/*.js  │  │ validation.js│  │  errors.js │  │  sse.js   │  │
│  │  (Express)   │  │    (Zod)     │  │            │  │           │  │
│  └──────┬───────┘  └──────────────┘  └────────────┘  └───────────┘  │
└─────────┼───────────────────────────────────────────────────────────┘
          │ messages only (no HTTP concepts leak down)
┌─────────▼───────────────────────────────────────────────────────────┐
│  application/                                                       │
│  ┌──────────────┐  ┌─────────────┐  ┌──────────────┐               │
│  │ actor.js     │  │ recovery.js │  │ status_bus.js│               │
│  │ (1 per junc) │  │             │  │ (EventEmitter│               │
│  │ serialized   │  │             │  │  for SSE)    │               │
│  │ promise-chain│  │             │  │              │               │
│  └──────┬───────┘  └─────────────┘  └──────────────┘               │
└─────────┼───────────────────────────────────────────────────────────┘
          │ handle(state, event, now) → { state, effects, outcome }
┌─────────▼───────────────────────────────────────────────────────────┐
│  domain/  ◄── PURE: no I/O, no Date.now(), no promises             │
│  ┌──────────┐ ┌──────────────┐ ┌───────────┐ ┌───────────────────┐ │
│  │engine.js │ │state_machine │ │ safety.js │ │  scheduler.js     │ │
│  │handle()  │ │   .js        │ │ THE guard │ │  scoring + phase  │ │
│  │tick()    │ │              │ │           │ │  selection         │ │
│  └──────────┘ └──────────────┘ └───────────┘ └───────────────────┘ │
│  ┌──────────┐ ┌──────────────┐ ┌───────────┐ ┌───────────────────┐ │
│  │modes.js  │ │ commands.js  │ │ queues.js │ │  models.js        │ │
│  │emergency │ │ ACK/retry    │ │ set-based │ │  config.js        │ │
│  │manual    │ │ bookkeeping  │ │ vehicles  │ │  events/effects   │ │
│  └──────────┘ └──────────────┘ └───────────┘ └───────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
          ▲ implements ports (ControllerPort, Clock, Repository)
┌─────────┴───────────────────────────────────────────────────────────┐
│  infrastructure/                                                    │
│  ┌────────────┐ ┌──────────────┐ ┌────────────────┐ ┌────────────┐ │
│  │mysql_repo  │ │ mqtt.js      │ │controller_sim  │ │  db.js     │ │
│  │  .js       │ │ (adapter +   │ │  .js           │ │            │ │
│  │            │ │  aedes broker│ │ (auto-ACK)     │ │            │ │
│  └────────────┘ └──────────────┘ └────────────────┘ └────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Design Principles

| # | Principle | Where Enforced |
|---|-----------|----------------|
| 1 | **Pure domain** — no I/O, no `Date.now()`, no promises, no framework imports | `backend/eslint.config.js` (`npm run lint`) + code review |
| 2 | **Effect pattern** — domain returns `{ state, effects }`, never performs I/O | `engine.js` returns `SEND_COMMAND` / `AUDIT` data objects |
| 3 | **Single safety guard** — all stage transitions pass through one choke point | `safety.js` enforces no conflicting greens |
| 4 | **Actor model** — one serialized Promise-chain mailbox per junction | `actor.js` guarantees order; no locks scattered around |
| 5 | **Desired ≠ Actual** — actual signals change only on controller ACK | `commands.js` `onAck()` is the only writer of `actualSignals` |
| 6 | **Snapshot + audit in one transaction** | `mysql_repo.saveTransition()` wraps both in `BEGIN…COMMIT` |
| 7 | **Every decision has a "why"** | `AuditEntry.reason` is required on every state change |
| 8 | **Tick-driven time** — no `setTimeout`/`setInterval` in request handlers | `tick_loop` in `app.js`; handlers only enqueue messages |

### Directory Structure

```
Factory_Traffic_Management_System/
├── README.md                           # This file
├── PLAN.md                             # Design decisions (source of truth)
├── MEGAPLAN.md                         # Phased execution plan
├── ARCHITECTURE.md                     # Architecture deep-dive
├── AGENTS.md                           # Non-negotiable rules for development
├── docker-compose.yml                  # MySQL convenience container
├── docs/
│   ├── openapi.json                    # OpenAPI 3.0 specification
│   └── postman_collection.json         # Postman collection for testing
├── scripts/
│   └── demo/                           # 9 curl-based demo scripts
│       ├── 01-normal-traffic.sh
│       ├── 02-priority-traffic.sh
│       ├── ...
│       └── 09-concurrent-events.sh
├── backend/
│   ├── package.json
│   ├── schema.sql                      # MySQL DDL (idempotent)
│   ├── .env.example
│   ├── eslint.config.js                # Domain purity enforcement
│   ├── src/
│   │   ├── domain/                     # PURE — deterministic, synchronous
│   │   │   ├── models.js              # Enums: Direction, Signal, Stage, Mode, VehicleType, ...
│   │   │   ├── config.js              # defaultJunctionConfig(), validateConfig()
│   │   │   ├── engine.js              # handle(state, event, now) / tick(state, now)
│   │   │   ├── state_machine.js       # Stage transitions: startYellow, startAllRed, startGreen
│   │   │   ├── safety.js              # THE single safety guard — no conflicting greens
│   │   │   ├── scheduler.js           # Weighted scoring + phase selection
│   │   │   ├── queues.js              # Set-based vehicle queues + tombstones
│   │   │   ├── modes.js               # Emergency preemption, manual lease, mode resolution
│   │   │   ├── commands.js            # Command issue/ACK/retry/timeout bookkeeping
│   │   │   ├── signals.js             # deriveSignals(stage, phase, config)
│   │   │   ├── effects.js             # Effect factories: audit(), alert()
│   │   │   ├── events.js              # Input event factories
│   │   │   └── initial_state.js       # createJunctionState(config, now)
│   │   ├── application/
│   │   │   ├── actor.js               # Promise-chain mailbox (1 per junction)
│   │   │   ├── recovery.js            # Boot-time recovery procedure
│   │   │   ├── repository_port.js     # Repository interface (JSDoc)
│   │   │   └── status_bus.js          # EventEmitter for SSE fan-out
│   │   ├── infrastructure/
│   │   │   ├── db.js                  # MySQL pool, ensureDatabase(), applySchema()
│   │   │   ├── mysql_repo.js          # Repository implementation (transactional)
│   │   │   ├── memory_repo.js         # In-memory repo for tests
│   │   │   ├── mqtt.js                # Embedded aedes broker + MQTT adapter
│   │   │   └── controller_sim.js      # Simulated controller (auto-ACK, delay, offline)
│   │   ├── api/
│   │   │   ├── routes/junctions.js    # All REST endpoints
│   │   │   ├── validation.js          # Zod schemas
│   │   │   ├── errors.js              # AppError + error middleware
│   │   │   └── sse.js                 # SSE stream handler
│   │   ├── config/env.js              # Environment config with defaults
│   │   ├── app.js                     # Application composition root
│   │   └── server.js                  # Entry point
│   └── tests/
│       ├── domain/                    # Pure domain tests (no HTTP/DB/MQTT)
│       │   ├── safety.property.test.js
│       │   ├── safety.test.js
│       │   ├── normal_cycle.test.js
│       │   ├── scheduler.test.js
│       │   ├── emergency.test.js
│       │   ├── manual.test.js
│       │   ├── queues.test.js
│       │   └── controller.test.js
│       ├── application/
│       │   ├── actor.test.js
│       │   ├── concurrency.test.js
│       │   └── recovery.test.js
│       └── api/
│           └── junctions.test.js
└── frontend/
    ├── package.json
    ├── vite.config.js                  # Proxy /api → backend
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── components/
        │   ├── IntersectionView.jsx    # Visual signal display
        │   └── SimulationPanel.jsx     # Testing controls
        └── hooks/
            └── useJunctionStatus.js    # SSE with polling fallback
```

---

## Traffic-Control Algorithm

### Weighted Scoring Mechanism

For each candidate phase `P`, the scheduler computes:

```
score(P) = Σ weight(vehicle) for each vehicle in P's direction queues
         + waitFactor × oldestWaitSeconds(P)
         + starvationBonus   if oldestWait > maxWaitMs
```

**Vehicle Weights** (configurable):

| Vehicle Type | Weight | Rationale |
|---|---|---|
| `EMERGENCY` | **100** | Immediate preemption via mode change |
| `TRUCK` | **5** | Heavy factory cargo; blocking causes bottlenecks |
| `FORKLIFT` | **3** | Active factory equipment |
| `EMPLOYEE` | **1** | Baseline |

**Scoring Parameters** (configurable in `config.js`):

| Parameter | Default | Purpose |
|---|---|---|
| `waitFactor` | 0.1 | Score bonus per second of waiting |
| `hysteresis` | 1.2× | Opponent must score 20% higher than the current phase to trigger a switch (prevents flapping) |
| `maxWaitMs` | 90,000 ms | Starvation threshold |
| `starvationBonus` | +1,000 | Large flat bonus forcing service when `maxWaitMs` is exceeded |

### Decision Rules (evaluated in order)

1. **Min green not met** → stay on current phase (default: 10s).
2. **Max green reached** and opponent has traffic → must switch (default: 60s).
3. **Current phase empty**, opponent has traffic → switch after min green.
4. **Starvation**: opponent's `oldestWait > maxWaitMs` → switch regardless of hysteresis.
5. **Hysteresis**: switch only if `score(opponent) > score(current) × 1.2`.
6. **Both empty** → stay on current phase (no unnecessary switching).
7. **Sensor offline** → offline direction gets a minimum periodic service score of 5 (preventing starvation of directions with broken sensors).

### Emergency Preemption

Emergency vehicles bypass the scheduler entirely via a **mode change** to `EMERGENCY`:
- Target phase = the emergency vehicle's direction phase.
- If the target is already GREEN → hold it.
- Otherwise → begin the safe transition: **YELLOW → ALL_RED → GREEN** (YELLOW/ALL_RED are *never* shortened or skipped).
- Min green **may** be skipped for emergency preemption; YELLOW and ALL_RED **may not**.
- Multiple emergencies on the same phase → served together.
- **Conflicting emergencies** → first-come (by server `receivedAt`) wins; the other waits and is served next. No flapping.
- Emergency cleared when `VEHICLE_CLEARED` arrives or by timeout (120s → `EMERGENCY_TIMEOUT`, audited).

### Manual Override

- `MANUAL_GREEN_REQUEST{direction, adminId}` → mode `MANUAL`, safe transition to the requested phase.
- **Lease with TTL** (default 5 minutes). Same admin can refresh or change direction.
- **Single holder**: second admin → `409 Conflict`.
- `RETURN_TO_AUTOMATIC` by the holder (or any admin as a safety override, audited).
- Emergency overrides manual. After emergency clears → resume manual if lease is still valid.
- Manual during `DEGRADED` → rejected (`409`).

---

## State Transitions

### Stage Cycle with ACK Gating

The stage machine enforces a strict sequence. **No transition advances until the previous command is ACKed by the controller**:

```
                    ┌─── boot / recovery
                    ▼
              ┌───────────┐
              │  ALL_RED   │◄──────────────────────────────────────────────┐
              │  (BOOT)    │                                               │
              └─────┬──────┘                                               │
                    │ ACK(all_red) + allRedMs elapsed                      │
                    │ + scheduler/mode picks target                        │
           ┌────────┴────────┐                                             │
           ▼                 ▼                                             │
    ┌────────────┐    ┌────────────┐                                       │
    │  NS_GREEN  │    │  EW_GREEN  │                                       │
    │            │    │            │                                       │
    └─────┬──────┘    └──────┬─────┘                                       │
          │ switch            │ switch                                     │
          │ decision          │ decision                                   │
          ▼                   ▼                                            │
    ┌────────────┐    ┌────────────┐                                       │
    │ NS_YELLOW  │    │ EW_YELLOW  │                                       │
    │  (≥5s)     │    │   (≥5s)    │                                       │
    └─────┬──────┘    └──────┬─────┘                                       │
          │ ACK + elapsed    │ ACK + elapsed                               │
          ▼                  ▼                                             │
    ┌────────────┐    ┌────────────┐                                       │
    │  ALL_RED   │    │  ALL_RED   │                                       │
    │  (→EW)     │    │  (→NS)     │                                       │
    │  (≥2s)     │    │  (≥2s)     │                                       │
    └─────┬──────┘    └──────┬─────┘                                       │
          │ ACK + elapsed    │ ACK + elapsed                               │
          │ + actual=RED     │ + actual=RED                                │
          ▼                  ▼                                             │
    ┌────────────┐    ┌────────────┐                                       │
    │  EW_GREEN  │    │  NS_GREEN  │                                       │
    └────────────┘    └────────────┘                                       │
                                                                           │
    ANY STATE ──── ACK timeout / controller OFFLINE ──── DEGRADED ALL_RED ─┘
                                          controller ONLINE ──► RECOVERING → ALL_RED baseline
```

### Timing Rules

| Stage | Duration | Timer Starts At |
|---|---|---|
| **GREEN** | 10s min, 30s target, 60s max | `stageConfirmedAt` (ACK time) |
| **YELLOW** | 5s (never shortened) | `stageConfirmedAt` (ACK time) |
| **ALL_RED** | 2s (never shortened) | `stageConfirmedAt` (ACK time) |

> **Key:** Stage timers start at **ACK time** (`stageConfirmedAt`), not at command send time. This guarantees that YELLOW is physically ≥ 5s and ALL_RED is physically ≥ 2s, even if the controller takes time to respond.

### Safety Guard (`safety.js`)

Every transition must pass through a single guard function that enforces:

1. Derived desired signals must not have two conflicting phases non-RED simultaneously.
2. Only legal edges: `GREEN → YELLOW`, `YELLOW → ALL_RED`, `ALL_RED → GREEN`, `ANY → ALL_RED` (fail-safe).
3. `ALL_RED → GREEN(P)` requires every conflicting direction's **actual** signal = `RED` and no pending command.
4. No GREEN issued in `DEGRADED` or `RECOVERING` mode (before reconcile ACK).

A violation throws `SafetyViolation`. Property-based testing proves no input sequence ever triggers it.

---

## Mode Lattice

Modes have a strict priority order:

```
DEGRADED (safety)  >  EMERGENCY  >  MANUAL  >  AUTOMATIC
       ▲                  ▲           ▲            ▲
       │                  │           │            │
  controller          emergency    admin       default
  timeout/offline     vehicle      request

  RECOVERING (boot) ─── after ALL_RED ACK ──► resolves to:
                                              AUTOMATIC (default)
                                              MANUAL (if lease valid)
                                              EMERGENCY (if active)
```

`resolveMode(state, now)` always returns the **highest active mode**:

1. `DEGRADED` if controller is unconfirmed/offline.
2. `EMERGENCY` if any emergency vehicles are active.
3. `MANUAL` if the manual lease is valid.
4. `AUTOMATIC` otherwise.

When an emergency clears, mode falls back to `MANUAL` if the lease is still valid, otherwise `AUTOMATIC`. All mode transitions are audited with reason.

---

## Concurrency Strategy

### Serialized Per-Junction Processing (Actor Model)

Each junction has **one** `JunctionActor` with a Promise-chain mailbox:

```
this.tail = this.tail.then(() => this.#process(msg))
```

All inputs — API requests, MQTT messages, tick events, controller callbacks — only **enqueue** a message. The actor is the **only** code path that:

1. Calls `engine.handle(state, event, now)`.
2. Writes to the repository (`saveTransition` in one transaction).
3. Swaps in-memory state (only after successful commit).
4. Dispatches effects (commands sent to controller, SSE updates).

Different junctions run in parallel. The `processed_events` table with a unique PK on `event_id` provides a second line of defense against duplicates.

**Order inside the actor:** compute → persist in one TX → dispatch commands → publish status. Commands are only sent after commit, so a crash never leaves an unrecorded command on the wire.

---

## Recovery Procedure

On startup, before accepting traffic:

```
1. Load all junctions from the database (configs, queues, processed_events).
2. For each junction:
   a. Set actualSignals = UNKNOWN for all directions.
   b. Mark all PENDING commands → ABANDONED_ON_RESTART (audited).
   c. Set mode = RECOVERING, stage = ALL_RED, desired = all RED.
   d. Issue a fresh ALL_RED command to the controller.
3. Wait for controller ACK:
   a. ACK received → resolveMode():
      - If manual lease is still valid → MANUAL
      - If emergency vehicle is still present → EMERGENCY
      - Otherwise → AUTOMATIC
   b. No ACK after retries → DEGRADED (hold ALL_RED).
4. Audit entry: RECOVERY_STARTED with the previous persisted state.
5. HTTP server starts listening only after recovery is complete.
```

Queues and history are **preserved** across restarts — vehicles are probably still waiting. Staleness cleanup applies on the first tick.

---

## API Documentation

**Base URL:** `http://localhost:3000/api`

**Error Format** (consistent across all endpoints):
```json
{
  "error": {
    "code": 404,
    "message": "Junction not found"
  }
}
```

### Endpoints

#### Junctions

| Method | Path | Description | Success | Error Codes |
|--------|------|-------------|---------|-------------|
| `GET` | `/junctions` | List all configured junctions | `200` | — |
| `GET` | `/junctions/:id/state` | Get the full current state of a junction | `200` | `404` |
| `GET` | `/junctions/:id/history` | Get recent audit log entries | `200` | — |
| `GET` | `/junctions/:id/stream` | SSE stream of live state updates | `200` (event stream) | — |

#### Sensor Events

| Method | Path | Description | Success | Error Codes |
|--------|------|-------------|---------|-------------|
| `POST` | `/junctions/:id/sensor-events` | Submit a vehicle arrival or clearance event | `201` accepted | `200` duplicate, `404` unknown junction, `422` validation error |

**Request Body:**
```json
{
  "eventId": "evt-001",
  "direction": "NORTH",
  "vehicleId": "truck-42",
  "vehicleType": "TRUCK",
  "type": "VEHICLE_ARRIVED",
  "sequenceNo": 1,
  "timestamp": 1728345600000
}
```

| Field | Type | Required | Values |
|-------|------|----------|--------|
| `eventId` | string | ✓ | Unique event identifier (idempotency key) |
| `direction` | string | ✓ | `NORTH`, `SOUTH`, `EAST`, `WEST` |
| `vehicleId` | string | ✓ | Unique vehicle identifier |
| `vehicleType` | string | — | `EMERGENCY`, `TRUCK`, `FORKLIFT`, `EMPLOYEE` |
| `type` | string | ✓ | `VEHICLE_ARRIVED`, `VEHICLE_CLEARED` |
| `sequenceNo` | integer | ✓ | Monotonic per (junction, direction, sensor) |
| `timestamp` | integer | ✓ | Unix epoch ms (sensor time) |

**Response Codes:**

| Code | Condition | Body |
|------|-----------|------|
| `201` | Event accepted and processed | `{ "status": "ACCEPTED" }` |
| `200` | Duplicate `eventId` (idempotent) | `{ "status": "duplicate" }` |
| `404` | Unknown junction ID | `{ "error": { "code": 404, "message": "..." } }` |
| `422` | Validation error (bad direction, vehicle type, etc.) | `{ "error": { "code": 422, "message": "..." } }` |

#### Commands

| Method | Path | Description | Success | Error Codes |
|--------|------|-------------|---------|-------------|
| `POST` | `/junctions/:id/manual` | Take manual control of a junction | `202` | `404`, `409` |
| `POST` | `/junctions/:id/automatic` | Return junction to automatic control | `200` | `404` |

**Manual Request Body:**
```json
{
  "adminId": "admin-01",
  "direction": "NORTH"
}
```

**Return to Automatic Body:**
```json
{
  "adminId": "admin-01"
}
```

**Response Codes for Manual:**

| Code | Condition |
|------|-----------|
| `202` | Manual control acquired; safe transition initiated |
| `409` | Lease conflict (another admin holds it) or junction in `DEGRADED` mode |
| `404` | Unknown junction ID |

#### Real-Time Updates (SSE)

Connect to `GET /api/junctions/:id/stream` to receive Server-Sent Events. Each event is a JSON-encoded state update:

```
event: state
data: {"mode":"AUTOMATIC","stage":"GREEN","phase":"NS",...}
```

The frontend uses SSE with automatic fallback to 1-second polling on connection failure.

### Full API Quick Reference

| Method | Endpoint | Body | Success | Errors |
|--------|----------|------|---------|--------|
| `GET` | `/junctions` | — | `200` | — |
| `GET` | `/junctions/:id/state` | — | `200` | `404` |
| `GET` | `/junctions/:id/history` | — | `200` | — |
| `GET` | `/junctions/:id/stream` | — | SSE stream | — |
| `POST` | `/junctions/:id/sensor-events` | sensor event | `201` | `200`, `404`, `422` |
| `POST` | `/junctions/:id/manual` | `{adminId, direction}` | `202` | `404`, `409` |
| `POST` | `/junctions/:id/automatic` | `{adminId}` | `200` | `404` |

> **OpenAPI specification:** [`docs/openapi.json`](docs/openapi.json)
>
> **Postman collection:** [`docs/postman_collection.json`](docs/postman_collection.json)

### API Changes from Plan

| Change | Rationale |
|--------|-----------|
| Added `GET /api/junctions/:id/stream` (SSE) | Enables real-time dashboard updates without polling |
| Sensor events scoped under `/junctions/:id/sensor-events` | Clearer REST hierarchy; junction ID in URL instead of body |
| Manual/automatic commands at `/junctions/:id/manual` and `/junctions/:id/automatic` | Simpler than a generic `/commands` endpoint |

---

## MQTT Topic Design

| Topic | Direction | Payload | QoS |
|-------|-----------|---------|-----|
| `factory/junctions/{id}/commands` | backend → controller | `{ command_id, junction_id, requested_signals, attempt }` | 1 |
| `factory/junctions/{id}/acks` | controller → backend | `{ command_id, status: "ACK"/"NACK", actual_signals }` | 1 |
| `factory/junctions/{id}/controller-status` | controller → backend | `{ event_id, status: "ONLINE"/"OFFLINE" }` | 1 (retained) |
| `factory/junctions/{id}/sensor-events` | sensors → backend | Same body as REST sensor event | 1 |

- The **embedded aedes broker** starts with the backend (`MQTT_PORT`, default 1883). No external Mosquitto installation required. Set `MQTT_URL` to point to an external broker instead.
- MQTT messages go through the **same** actor path as REST — same validation, same dedup, same serialization.
- **Last Will and Testament (LWT)** on the controller connection publishes `OFFLINE` automatically when the connection drops. This provides immediate failure detection.
- The dashboard receives updates over **SSE**, not MQTT (SSE is simpler for browsers; no WebSocket/broker exposure needed).

---

## Database Schema

The MySQL schema (auto-applied on boot via `schema.sql`) consists of 8 tables:

| Table | Purpose | Key |
|-------|---------|-----|
| `junctions` | Junction configurations | `id` PK |
| `junction_state` | Full state snapshot (JSON) + optimistic concurrency version | `junction_id` PK, FK |
| `queue_vehicles` | Vehicles currently in queues | `(junction_id, vehicle_id)` PK |
| `tombstones` | Cleared vehicles (prevents double-count on late arrivals) | `(junction_id, vehicle_id)` PK |
| `processed_events` | Dedup registry for `event_id` idempotency | `event_id` PK |
| `commands` | Signal commands sent to controllers (status, retry count) | `command_id` PK |
| `audit_log` | Complete audit trail with `event_type`, `reason`, `details` | `id` AUTO PK, indexed by `(junction_id, created_at)` and `event_type` |
| `device_status` | Per-device health status (sensors, controller) | `(junction_id, device_id)` PK |
| `rejected_events` | Dead-letter table for invalid/rejected payloads | `id` AUTO PK |

**Transactional Guarantee:** Every state change writes the state snapshot + audit rows + processed event ID + command updates in a single `BEGIN…COMMIT` transaction. A crash between compute and commit leaves the system in the previous consistent state.

---

## Demo Scenarios

Nine demo scripts are provided in `scripts/demo/`. Start the backend first, then run:

```bash
chmod +x scripts/demo/*.sh
```

| # | Script | Scenario | What to Observe |
|---|--------|----------|-----------------|
| 1 | `01-normal-traffic.sh` | Normal traffic flow | Vehicles arrive; scheduler picks the busier phase |
| 2 | `02-priority-traffic.sh` | Priority-based switching | Trucks (weight 5) outscoring employees (weight 1) |
| 3 | `03-emergency-preemption.sh` | Emergency vehicle arrival | Mode → EMERGENCY; safe transition via YELLOW → ALL_RED → GREEN |
| 4 | `04-manual-override.sh` | Admin takes manual control | Mode → MANUAL; lease countdown; return to AUTOMATIC |
| 5 | `05-duplicate-event.sh` | Duplicate event handling | Second event with same `eventId` returns `200 duplicate`; queue unchanged |
| 6 | `06-vehicle-clearance.sh` | Vehicle clearance + orphan clear | CLEARED without ARRIVED → tombstone + `ORPHAN_CLEAR` audit |
| 7 | `07-controller-failure.sh` | Controller ACK timeout | Retries with same `command_id` → DEGRADED mode → ALL_RED |
| 8 | `08-restart.sh` | Server restart mid-transition | Kill → restart → ALL_RED recovery → queues intact |
| 9 | `09-concurrent-events.sh` | Concurrent conflicting events | Multiple events fired simultaneously → serialized deterministically by actor |

---

## Tests

### Running Tests

```bash
cd backend

# Run all tests
npm test

# Run only pure domain tests (no HTTP/DB/MQTT, < 2s)
npm run test:domain

# Run with MySQL integration (optional)
MYSQL_TEST_URL=mysql://root:pass@localhost:3306/traffic_test npm test
```

### Test Suite Overview

| Layer | Test File | What It Covers |
|-------|-----------|----------------|
| **Domain** | `safety.property.test.js` | Property-based (fast-check, hundreds of random event sequences): no conflicting GREEN ever in desired or actual |
| **Domain** | `safety.test.js` | Guard rejects illegal transitions; validates config |
| **Domain** | `normal_cycle.test.js` | Full NS → YELLOW → ALL_RED → EW cycle with exact timings |
| **Domain** | `scheduler.test.js` | Weighted scoring, hysteresis, starvation, min/max green, empty junctions |
| **Domain** | `emergency.test.js` | Preemption through safe sequence; conflicting emergencies; timeout; mode restoration |
| **Domain** | `manual.test.js` | Lease management; second admin conflict; expiry; rejected in DEGRADED |
| **Domain** | `queues.test.js` | Set semantics; duplicate ARRIVED; orphan CLEAR; tombstone; ghost TTL |
| **Domain** | `controller.test.js` | ACK advances state; retry with same command_id; timeout → DEGRADED; duplicate/unknown ACK ignored; mismatch |
| **Application** | `recovery.test.js` | Every stage → crash → recover → ALL_RED baseline, abandoned commands, queues preserved |
| **Application** | `actor.test.js` | 100 concurrent enqueues processed in order; failing message doesn't block next |
| **Application** | `concurrency.test.js` | PDF sequence (T=0..17ms): truck + emergency + manual + duplicate + ACK → deterministic, invariants hold |
| **API** | `junctions.test.js` | HTTP smoke tests: status codes, duplicate handling, error body format |

### Property-Based Testing

The `safety.property.test.js` test uses `fast-check` to generate hundreds of random input sequences (sensor events, emergencies, manual requests, ACKs, NACKs, time jumps) and asserts after **every single step**:

1. NS and EW are never GREEN simultaneously in `desiredSignals`.
2. NS and EW are never GREEN simultaneously in `actualSignals`.
3. No `GREEN → GREEN` edge (must go through YELLOW → ALL_RED).

---

## Assumptions / Questions / Requirement Issues

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| 1 | **"Emergency should immediately begin preemption" vs "must not bypass the safe sequence"** | Begin immediately, but YELLOW (≥5s) and ALL_RED (≥2s) are **never** shortened or skipped. | Physical safety requires clearing time. "Immediately" means "start the sequence now", not "jump to GREEN". |
| 2 | **"Normal GREEN approx 30s" vs min/max green and preemption** | Green duration is a *target* (30s), bounded by min (10s) and max (60s). Emergency preemption may skip min green; nothing skips YELLOW/ALL_RED. | Flexibility within safety bounds. |
| 3 | **Desired vs actual: can the backend guarantee physical safety?** | **No.** The backend can only know physical state via controller ACK. A hardware **conflict monitor / fail-safe in the controller** is required in the real world. The backend assumes delivery but documents the caveat. | A backend-only design cannot guarantee safety if the communication link fails. |
| 4 | **"NORTH + SOUTH green together" — what about turning movements?** | The model treats only NS vs EW as conflicting. Real junctions need a movement-level conflict matrix (documented as a next step). | Simplification per assessment scope. |
| 5 | **Pedestrians/crossings?** | Not modeled. Noted as a next step. | Not mentioned in the assessment requirements. |
| 6 | **Vehicle priority order (EMERGENCY > TRUCK > FORKLIFT > EMPLOYEE)** | Implemented as configurable weights. The ordering is a business decision, not a safety invariant. | Allows factory operators to tune priorities. |
| 7 | **`VEHICLE_CLEARED` has no `vehicle_type`** | The vehicle is looked up by `vehicleId` from the queue. | Type is known from the corresponding ARRIVED event. |
| 8 | **`POST /api/junctions` payload shape is unspecified** | Schema defined in `config.js`: phases, conflicts, timings, scoring, controller, policies. | Validated by `validateConfig()`. |
| 9 | **`status-*` events have `event_id` but no `sequence_no`** | Deduplicated by `event_id` only. | No ordering semantics for status events. |
| 10 | **Controller ACK has no `junction_id` / `direction`** | Correlated by `command_id` (each command is uniquely identified). | The `command_id` already encodes the junction (e.g., `A-17`). |
| 11 | **Ghost vehicles (sensor miss — vehicle never reported leaving)** | Mitigation: queue entry TTL (default 15 minutes). Expired entries are audited as `QUEUE_ENTRY_EXPIRED`. | Configurable; documented. |
| 12 | **Sensor clocks can be wrong** | Server `receivedAt` is authoritative for waiting-time calculation. Sensor `timestamp` is retained for audit and staleness validation only. | Sensor clock drift should not affect scheduling fairness. |
| 13 | **No authentication** | `adminId` is trusted. A simple API key mechanism is a documented next step. | Assessment does not require auth. |
| 14 | **Dates in examples are in 2026** | Stale-event rules use the injected clock (`now` parameter), so tests are not date-dependent. | Domain purity ensures deterministic testing. |
| 15 | **Controller command idempotency** | Retries use the **same `command_id`** so the controller can safely deduplicate. | Documented requirement for the controller implementation. |
| 16 | **What happens if two admins issue manual commands simultaneously?** | The actor serializes them. The first processed acquires the lease; the second gets `409 Conflict`. | Deterministic via the Promise-chain mailbox. |

---

## Incomplete / Next Steps

- [ ] **Authentication & Authorization** — API key or JWT-based access control for admin commands.
- [ ] **Movement-level conflict matrix** — support for turning movements and partial intersection topologies beyond NS/EW.
- [ ] **Pedestrian phases** — crosswalk timing integrated into the stage machine.
- [ ] **Hardware conflict monitor** — simulation of a physical fail-safe device that independently monitors signal states.
- [ ] **Horizontal scaling** — actor sharding by junction ID across multiple Node.js processes.
- [ ] **Full React dashboard** — expand UI to support adding/configuring new junctions visually, alert panels, and admin controls.
- [ ] **Docker Compose full stack** — containerize backend + frontend + MySQL in a single `docker-compose up`.
- [ ] **Rate limiting and request throttling** — protect API from abuse in production.

---

## AI / Tool Usage

This project utilized **Google DeepMind Antigravity** for:

- **Planning** — structured the phased execution plan (PLAN.md, MEGAPLAN.md) and architectural decisions.
- **Scaffolding** — generated initial project structure, file stubs, and configuration boilerplate.
- **Implementation** — assisted in writing domain logic, application wiring, API routes, and infrastructure adapters.
- **Testing** — generated domain unit tests and property-based tests (fast-check).
- **Documentation** — assisted in writing this README and API documentation.

All architectural decisions, domain logic boundaries, safety invariants, and generated code were **thoroughly reviewed** to ensure correctness, consistency, and adherence to the non-negotiable rules. The author can explain the state machine, actor model, queue semantics, recovery procedure, and scheduling algorithm from memory.
