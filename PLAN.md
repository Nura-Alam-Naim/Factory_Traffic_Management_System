# Factory Traffic Management System: LLM Execution Plan

Use this file as the project brief for Antigravity. Put Section 1 into the workspace rules / `AGENTS.md`, then feed the agent one phase at a time (Section 7). Do not give it the whole spec and say "build everything".

---

## 0. What the assessors are really grading

The PDF says it directly: they grade **engineering judgment**, not feature count. Priority order:

1. Safety invariants never violated (no conflicting GREEN, no bypass by manual/emergency).
2. Clean separation: domain engine knows nothing about HTTP, DB, MQTT, or the frontend.
3. Consistency under concurrency (serialized per-junction processing).
4. Desired vs actual (controller-confirmed) state kept separate; never assume an unACKed command executed.
5. Idempotency, recovery after restart, audit trail.
6. The README section **"Assumptions / Questions / Requirement Issues"** (exact title) and honest "AI / Tool Usage".
7. Tests of domain logic without HTTP/DB/MQTT. A plain dashboard is enough.

You will be questioned in the Friday review. **Read every file the agent writes**, and be able to explain the state machine, the actor model, and the restart recovery from memory.

**Time plan** (it is Thursday night, review is Friday): aim for about 5 focused hours. If short on time, cut in this order: SSE, extra UI polish, filtering, Docker. Never cut: domain safety, tests, README sections.

---

## 1. Rules for the agent (paste into AGENTS.md / workspace rules)

```
PROJECT: Factory Traffic Management System (backend intern assessment).
STACK: Node.js, Express.js, RestAPI, MySQL, React.js, MQTT.

NON-NEGOTIABLE RULES
1. The domain layer (src/domain) must not import Express, mysql2, sequelize, mqtt, or global Date.now().
   Time is always passed in as a parameter (`now`). The domain is pure and deterministic.
2. The domain engine is a pure function style: handle(state, input, now) -> {newState, effects}.
   Effects = commands to send to the controller + audit entries. The domain never performs I/O.
3. Clients never write signal states. They submit intents (sensor events, commands, controller events).
4. Safety invariants (enforced in ONE place, the state machine, and checked by tests):
   - NS and EW are never GREEN at the same time, in desired state OR in believed actual state.
   - GREEN -> YELLOW -> ALL_RED -> GREEN is the only path between conflicting greens. Manual and emergency use it too.
   - A new GREEN is only issued after the previous phase is confirmed RED (actual), or the controller is unconfirmed -> DEGRADED, no new GREEN.
   - Unknown/invalid command -> rejected, state unchanged.
5. No setTimeout/setInterval in request handlers. Timing is driven by a tick loop + injected clock.
6. All state changes for one junction go through ONE serialized queue (actor). No locks scattered around.
7. Every state change writes an audit row in the SAME DB transaction as the state snapshot.
8. Every decision gets a short "why" string in the audit log (e.g. "EW score 14.2 > NS 9.1 * 1.2").
9. Small files, clear names, JSDoc/type hints, no dead code, no giant functions.
10. After each phase: run tests, summarize what changed, list assumptions made. Do not start the next phase.
11. Do not invent endpoints beyond the plan without recording the change in README ("API changes" section).
```

---

## 2. Architecture

```
traffic/
  backend/
    src/
      domain/                # PURE. No I/O.
        models.js            # enums, classes: Direction, Signal, Phase, Mode, Vehicle, QueueState, JunctionState, Command...
        config.js            # JunctionConfig: phases, conflicts, timings, scoring weights
        state_machine.js     # phase/transition state machine + safety guard
        scheduler.js         # scoring + next-phase selection (pure)
        engine.js            # TrafficEngine.handle(...) / tick(...)
        events.js            # input events (SensorEvent, ControllerEvent, Command, Tick)
        ports.js             # ControllerPort, Clock (interfaces)
      application/
        junction_actor.js    # async queue per junction, serializes everything
        service.js           # orchestrates: validate -> actor -> persist -> dispatch effects
        recovery.js          # boot-time recovery
      infrastructure/
        mysql_repo.js        # repository implementation + connection pooling
        controller_sim.js    # REST-simulated controller (implements ControllerPort)
        mqtt_adapter.js      # MQTT integration
        clock.js             # SystemClock, FakeClock (tests)
      api/
        routes.js, validation.js (Zod/Joi), errors.js
      index.js               # wiring, startup recovery, tick loop, Express setup
    tests/
      domain/ ...            # no fixtures needing HTTP/DB
      api/ ...               # Supertest API tests
    schema.sql               # MySQL schema
    package.json
  frontend/
    public/
    src/                     # React.js application
      components/
      App.js
      index.js
    package.json
  README.md
  docs/postman_collection.json (or openapi export)
```

Dependency direction: `api -> application -> domain <- infrastructure`. The domain only knows `ports.js`.

---

## 3. Domain design decisions (pre-made, so the agent doesn't wander)

### 3.1 Phases and signals
- Config-driven: `phases = {NS: [NORTH, SOUTH], EW: [EAST, WEST]}`, `conflicts = {NS: [EW], EW: [NS]}`. Junction A is seeded; `POST /api/junctions` creates others with the same config shape.
- Internal sub-states (one junction cycle): `NS_GREEN -> NS_YELLOW -> ALL_RED -> EW_GREEN -> EW_YELLOW -> ALL_RED -> NS_GREEN`.
- Timings (configurable, tests use small values): GREEN 30s nominal, YELLOW 5s, ALL_RED 2s, min green 10s, max green 60s.
- Signal map per direction is derived from the sub-state, never set directly.

### 3.2 Desired vs actual
- `desired_signals`: computed by the engine.
- `actual_signals`: only updated by a valid controller ACK or status event via MQTT/REST. Initial/unknown = `UNKNOWN`.
- **Transition gating:** the engine advances to the next step (e.g. YELLOW -> ALL_RED -> opposite GREEN) only when the previous command is ACKed (actual confirmed). A GREEN is never issued while the opposing side's actual state is not confirmed RED.

### 3.3 Sensor events: ordering and idempotency
- **`event_id` is authoritative for idempotency** (unique constraint in `processed_events`; duplicate -> HTTP 200 with `{"status":"duplicate"}`, audit `DUPLICATE_EVENT_REJECTED`, state untouched).
- **`sequence_no`** is monotonic per (junction, direction, sensor source); used for ordering, not dedup.
- **Sensor `timestamp`** = when it happened (used for audit and staleness). **Server `received_at`** = authoritative for waiting-time and scheduling (sensor clocks drift).
- Queue is a **set of vehicle_ids per direction** (not a bare counter). Count = `size`, so it can never go negative.
- CLEARED without ARRIVED -> recorded as a **tombstone** (`cleared_vehicles`); a late ARRIVED with lower sequence_no for the same vehicle is then ignored (out-of-order safe). Audit it as `ORPHAN_CLEAR`.
- Duplicate ARRIVED for the same vehicle_id (different event_id) -> no double count (set semantics).
- Events older than a configurable max age (e.g. 5 min) -> rejected as stale (HTTP 422/202 with reason, audited).
- Validation errors: unknown junction -> 404; malformed or unknown vehicle_type/direction -> 422. Rejected events are stored in an error/dead-letter table (bonus, cheap).

### 3.4 Scheduling (document in README)
For each phase P:
```
score(P) = sum(vehicle_weight(v) for v in queues of P's directions)     # weights: EMERGENCY 100, TRUCK 5, FORKLIFT 3, EMPLOYEE 1
         + wait_factor * oldest_wait_seconds(P)                          # oldest waiting vehicle, server time
         + starvation_bonus if oldest_wait > max_wait (e.g. 90s)         # large bonus -> forced service
```
Rules:
- Only consider switching after **min green** has elapsed.
- **Hysteresis:** switch only if `score(other) > score(current) * 1.2` (avoids flapping).
- Both phases empty -> stay (no unnecessary switch).
- Current phase empty, other has traffic -> switch after min green.
- Max green reached and the other side is waiting -> must switch.
- Starvation: `oldest_wait > max_wait` overrides hysteresis.
- Priority gives faster clearance by increasing score; an EMERGENCY vehicle triggers preemption (3.5).

### 3.5 Modes and the mode lattice
Modes: `AUTOMATIC`, `MANUAL`, `EMERGENCY`, `DEGRADED`, plus an internal `RECOVERING` (boot).
Priority: **DEGRADED/safety > EMERGENCY > MANUAL > AUTOMATIC**.

**Emergency policy**
- Emergency arrival -> mode `EMERGENCY`, target phase = the emergency vehicle's phase. If the target is already GREEN, hold it. Otherwise begin the standard sequence: finish YELLOW (never shortened below 5s), ALL_RED, then GREEN. Skipping min green is allowed; skipping YELLOW/ALL_RED is not.
- Multiple emergencies, same phase: served together.
- Conflicting emergencies: **first-come (by server `received_at`) wins**; the other waits, is shown in the UI, and is served next. Tie-break by sequence/event order. Never alternate flapping.
- Repeated emergency event (same vehicle_id): idempotent.
- **Emergency cleared** when its `VEHICLE_CLEARED` arrives, or by timeout (e.g. 120s stale -> `EMERGENCY_TIMEOUT`, audited with an alert).
- Emergency overrides MANUAL (safety-over-convenience). After emergency clears: resume MANUAL if its lease is still valid, else AUTOMATIC. Audited.

**Manual policy**
- `MANUAL_GREEN_REQUEST{direction, admin_id}` -> mode MANUAL, safe transition to that direction's phase, then hold GREEN.
- **Lease with TTL** (default 5 min). Refreshing = repeat the command by the same admin. Admin disconnect -> lease expiry returns to AUTOMATIC (no "stuck manual").
- **Single holder:** a second admin's manual command while a lease is held by someone else -> HTTP 409 Conflict. Same admin may change direction. `RETURN_TO_AUTOMATIC` allowed by holder (and, documented, by any admin as an override for safety, audited).
- Commands are serialized by the actor, so two simultaneous admins get deterministic results (first processed wins).
- Manual command during DEGRADED -> rejected 409.

### 3.6 Controller communication (ports & failure handling)
`ControllerPort.send(command)`, where command = `{command_id, junction_id, direction(s), requested_state}`. Implemented by MQTT adapter and a REST fallback/simulator.

- Every command has a unique `command_id` (uuid or counter-based, persisted). Stored as `PENDING` with `sent_at`, `attempts`.
- **ACK timeout:** 5s (configurable). On timeout: retry up to 2 times **with the same command_id** (idempotent for the controller). After retries: command `TIMED_OUT`, audit `CONTROLLER_TIMEOUT`, junction -> `DEGRADED`.
- **DEGRADED behavior (fail safe):** stop issuing GREENs; desired state = ALL_RED (safe fallback); alert shown; actual states stay `UNKNOWN`/last confirmed with a stale flag. Documented caveat: a real controller should have its own hardware fail-safe (flashing red / conflict monitor), because the backend cannot guarantee delivery. List this under Requirement Issues.
- **Duplicate ACK:** ignored (command already `CONFIRMED`), audited at debug level, HTTP 200.
- **ACK for unknown/old command_id** (superseded, or from before a restart): rejected/ignored, audited, state unchanged.
- **ACK with actual_state != requested_state:** mismatch -> `STATE_MISMATCH` alert, treat as failure, no advance.
- **Controller OFFLINE status event:** mode -> DEGRADED, pending commands failed. **Reconnect (ONLINE):** do NOT trust old state. Reconciliation: actual = UNKNOWN, send a fresh ALL_RED command, wait for ACK, then resume AUTOMATIC from ALL_RED.
- **Sensor OFFLINE:** that direction is flagged `sensor_failure`; the queue for it is marked unreliable (alert). Scheduling policy: give an offline-sensor direction a minimum periodic service so it can't starve (documented).
- **Per-device status** stored: `ONLINE/OFFLINE/DEGRADED/WARNING/UNKNOWN`.

### 3.7 Persistence and restart recovery
Persist (MySQL, tables in `schema.sql`): `junctions` (config JSON), `junction_state` (mode, sub_state, desired, actual, emergency, manual lease, timers as absolute timestamps), `queue_vehicles` (+ tombstones), `processed_events` (event_id PK), `commands` (id, status, attempts, timestamps), `audit_log`, `device_status`, `rejected_events`.

Rules:
- State snapshot + audit row are written in **one transaction**.
- Do **not** persist timers as "remaining time"; persist absolute timestamps for audit, but on boot **never resume a timer blindly**.

**Recovery algorithm (on startup, before accepting traffic):**
1. Load config + queues + processed_events + history (queues are kept: vehicles are probably still waiting; staleness cleanup applies).
2. Mark all `actual_signals = UNKNOWN`, all `PENDING` commands -> `ABANDONED_ON_RESTART` (audit).
3. Whatever the sub-state was (GREEN / YELLOW / ALL_RED / mid-transition), restart from a **safe baseline**: desired = ALL_RED; send a fresh command; wait for ACK (mode `RECOVERING`).
4. After ACK of ALL_RED: restore the previous mode if valid (MANUAL lease still valid; EMERGENCY if the emergency vehicle is still present and not timed out), else AUTOMATIC, and continue via the normal state machine from ALL_RED.
5. If no ACK arrives: DEGRADED.
Audit entry `RECOVERY_STARTED` with the previous persisted state recorded.

### 3.8 Concurrency strategy (explain in README)
**Serialized per-junction processing (actor / event-loop model).** Each junction has one asynchronous message queue (e.g., using `fastq` or a custom Promise queue) and one consumer loop. The API, MQTT handlers, the tick loop, and controller callbacks only *enqueue* a message. Only the actor mutates junction state and calls the repository. Different junctions run in parallel. The unique constraint on `event_id` is a second line of defense. Write a test that fires the "concurrent sequence" from the PDF (truck, emergency, manual, duplicate emergency, ACK) and asserts invariants.

### 3.9 Real-time updates
MQTT for real-time status pushing to the React frontend, or Server-Sent Events (SSE) / Polling as a fallback. Explain: simple, robust; the dashboard is responsive.

---

## 4. API (minimum + small additions)

| Method | Path | Notes |
|---|---|---|
| GET | /api/junctions | list with summary |
| GET | /api/junctions/{id} | config + state |
| POST | /api/junctions | create (201), validate config (conflicts must be symmetric, every direction in exactly one phase) |
| GET | /api/junctions/{id}/status | exactly the shape in the PDF + `alerts`, `pending_command`, `emergency`, `manual_lease`, `sub_state`, `device_status` |
| POST | /api/sensor-events | 201 accepted, 200 duplicate, 404 unknown junction, 422 invalid, 409/200 stale (document) |
| POST | /api/junctions/{id}/commands | `MANUAL_GREEN_REQUEST`, `RETURN_TO_AUTOMATIC` (+ `admin_id`) |
| POST | /api/controller-events | ACK / NACK / status (ONLINE/OFFLINE), `command_id` correlation (Also via MQTT) |
| POST | /api/device-status | sensor/controller/signal status events (or merge into controller-events; document the choice) |
| GET | /api/junctions/{id}/history | `?limit=&event_type=` |
| GET | /api/health | liveness |
| POST | /api/sim/... | simulator-only helpers (auto-ack toggle, delay, set offline) clearly marked as simulator |

Consistent error body: `{"error": {"code": "...", "message": "..."}}`. Correct status codes everywhere (200/201/202/400/404/409/422/503).

---

## 5. Frontend (React.js)

React application. Components: overview card per junction; detail view with **desired vs actual** table; intersection graphic (CSS grid, four lights colored from backend `actual` with desired shown as outline or text); mode badge + emergency banner + manual-override banner with lease countdown; alerts list (controller offline, signal/sensor failure, mismatch, command timeout, unknown state); pending command; manual control buttons (4 directions + Return to Automatic); recent activity list; simulation form (arrival, clearance, vehicle type, direction, emergency, controller ONLINE/OFFLINE, send ACK for pending command, auto-ack toggle). Error handling: backend unreachable banner, toast on 4xx/5xx, graceful null/missing field rendering, invalid junction message. **The frontend contains zero sequencing logic.**

---

## 6. Test plan (domain tests need no HTTP/DB/clock)

Use `FakeClock` and call `engine.handle/tick` directly with Jest.

1. Safety property test: random event/command/tick sequences (using `fast-check` or seeded random loop); after every step assert: never NS and EW GREEN in desired or believed-actual; never a direct GREEN->GREEN jump.
2. Normal cycle: NS GREEN -> YELLOW -> ALL_RED -> EW GREEN with correct timings.
3. Scheduler: bigger queue wins; truck beats employee vehicles; hysteresis prevents flapping; starvation forces service; empty junction doesn't switch; min green respected.
4. Emergency: preemption goes through YELLOW + ALL_RED; emergency during manual; two emergencies same phase; conflicting emergencies (first wins); repeated emergency idempotent; emergency timeout; emergency cleared -> returns to correct mode.
5. Manual: request goes through safe sequence; second admin gets conflict; lease expiry returns to AUTOMATIC; RETURN_TO_AUTOMATIC; rejected during DEGRADED.
6. Queue/events: duplicate event_id no double count; CLEARED never makes queue < 0; orphan clear + late arrival; out-of-order via sequence_no; stale rejected; unknown vehicle_type rejected.
7. Controller: ACK advances; ACK missing -> retry (same command_id) -> timeout -> DEGRADED; duplicate ACK ignored; wrong/unknown command_id ignored; actual != requested -> mismatch alert; controller offline -> degraded; reconnect -> ALL_RED reconciliation.
8. Recovery: persist mid-transition (each sub-state) -> restart -> actual UNKNOWN, ALL_RED baseline first, pending commands abandoned, queues and history preserved.
9. Concurrency: the PDF sequence (T=0..17ms) through the actor; assert final state is consistent and invariants hold.
10. API smoke tests (Supertest): status codes for each error case; duplicate returns 200 and queue unchanged; history endpoint.

---

## 7. Phased prompts for Antigravity

Run one phase at a time. After each phase: run `npm test`, read the diff, commit.

### Phase 0: Scaffold (10 min)
```
Read PLAN.md fully. Create the project structure from Section 2, initialize package.json (express, mysql2, zod, jest, supertest, fast-check, mqtt), the rules file from Section 1, and an empty README with the required section headings: Overview, Setup & Run, Architecture Decisions, Traffic-Control Algorithm, State Transitions, Assumptions / Questions / Requirement Issues, API Docs, Demo Scenarios, Tests, Incomplete / Next Steps, AI / Tool Usage. Do not write logic yet.
```

### Phase 1: Domain core (60-75 min)
```
Implement src/domain per PLAN.md Sections 3.1-3.6 as pure JavaScript (no I/O, no Date.now, no promises). Include: models/enums, JunctionConfig, the sub-state machine with a single safety guard function that every transition passes through, the scheduler (3.4), mode handling and emergency/manual policies (3.5), and controller-command bookkeeping with ACK gating, timeout/retry decisions, and DEGRADED fallback (3.6). Engine API: handle(state, event, now) -> {state, effects} and tick(state, now) -> {state, effects}. Effects are data (SendCommand, AuditEntry). Write the domain tests in Jest from Section 6 items 1-8 as you go. Stop when they pass.
```

### Phase 2: Persistence + recovery (40 min)
```
Create schema.sql and mysql_repo.js implementing a repository interface defined in the application layer (not the domain). Snapshot + audit in one transaction; processed_events with event_id primary key; commands table; tombstones. Implement recovery.js per PLAN.md 3.7 and the recovery tests (Section 6 item 8), including a test that kills the 'process' mid-transition for each sub-state using a mock DB.
```

### Phase 3: Actor + service + MQTT (40 min)
```
Implement the per-junction async actor (Section 3.8), the service layer, a tick loop task, command dispatch via MQTT adapter / ControllerPort, ACK timeout scheduling driven by ticks (no setTimeouts in handlers), and controller_sim.js (in-process simulator with auto-ack toggle, delay, offline). Add the concurrency test from Section 6 item 9.
```

### Phase 4: API (30 min)
```
Implement the Express REST layer per Section 4 with Zod validation, consistent error bodies, correct status codes, and wiring in index.js (startup recovery, tick loop, graceful shutdown). Routes contain no traffic logic: they translate HTTP to messages for the service. Add API smoke tests using Supertest. Export OpenAPI JSON and create docs/postman_collection.json.
```

### Phase 5: Frontend (40 min)
```
Build frontend/ per Section 5 using React.js. Implement all panels and error handling listed. Keep styling minimal but clear (color-coded signals, banners for emergency/manual/degraded). Connect to the backend using Axios/Fetch and MQTT or SSE for real-time updates. No sequencing logic in the frontend.
```

### Phase 6: Docs + demo (30 min)
```
Fill the README completely. Include: setup/run, architecture + dependency diagram, the algorithm (3.4), state-transition diagram (ASCII or mermaid) with timings, the mode lattice, recovery procedure, concurrency strategy, API table, demo script for all 9 scenarios in the PDF (with curl commands AND the UI steps), and 'Assumptions / Questions / Requirement Issues' covering every item in PDF Section 17 with the decision made (use Section 3 of PLAN.md as source, add the extra issues listed in PLAN.md Section 8). Add 'Incomplete / Next Steps' honestly.
```

### Phase 7: Review pass (30 min, most important for the interview)
```
Act as a strict reviewer. 1) Search the domain package for forbidden imports. 2) Try to find any path that produces conflicting GREEN (manual during yellow, emergency during all-red, ACK arriving late, restart mid-transition, DEGRADED recovery). Write a failing test for each hole found, then fix. 3) List dead code and unclear names. 4) Verify every audit event type from PDF Section 11 is emitted somewhere. 5) Verify the README matches the actual behavior.
```

---

## 8. Requirement issues to call out in the README (shows judgment)

- "Emergency should immediately begin preemption" vs "must not bypass the safe sequence": decision: begin immediately, but YELLOW/ALL_RED are never shortened.
- "Normal GREEN approx 30s" vs min/max green and preemption: green length is a *target*, bounded by min/max.
- "Desired vs actual": the backend cannot know physical state without ACK; a backend-only design cannot guarantee safety if the link fails, so a **hardware conflict monitor / fail-safe in the controller** is required in the real world.
- The signals "NORTH + SOUTH green together" ignore turning movements (left turns can conflict); the model treats only NS vs EW as conflicting; note that real junctions need a movement-level conflict matrix.
- Pedestrians/crossings are not mentioned.
- Vehicle priority order (EMERGENCY > TRUCK > FORKLIFT > EMPLOYEE) is a business decision; make weights configurable.
- `VEHICLE_CLEARED` has no vehicle_type; the vehicle is looked up by vehicle_id.
- `POST /api/junctions` payload shape is unspecified; the schema is defined in the README.
- `status-*` events have `event_id` but no `sequence_no`; dedup by event_id only.
- Controller ACK example has no `junction_id`/`direction`; correlated by `command_id`.
- A sensor miss (vehicle never reported leaving) can leave ghost vehicles in a queue; mitigation: queue entry TTL (documented, configurable).
- Sensor clocks can be wrong; server `received_at` is used for waiting time; sensor time only for audit/staleness.
- No authentication: `admin_id` is trusted (bonus: simple API key).
- Dates in the examples are in 2026; stale-event rules must use the injected clock, so tests are not date dependent.
- The same command being retried must be idempotent on the controller side.

---

## 9. Final checklist before submitting

- [ ] Fresh clone: README setup steps work, server starts, DB auto-created.
- [ ] `npm test` passes; domain tests run without HTTP/DB.
- [ ] Safety property test passes with many random seeds.
- [ ] All 9 scenarios from the PDF demonstrable via UI and via curl.
- [ ] Restart demo: stop server mid-transition, restart, see ALL_RED recovery, history and queues intact.
- [ ] README has the **exact** heading "Assumptions / Questions / Requirement Issues" and an "AI / Tool Usage" section (state honestly: Antigravity used for scaffolding/implementation/tests, and that you reviewed everything).
- [ ] Schema file, Postman/OpenAPI file, frontend source included; no secrets, no `node_modules`.
- [ ] You can explain on a whiteboard: sub-state diagram, why the actor model, why queues are sets, what happens on ACK timeout, how recovery works, and how you would add MQTT or Junction B.

## 10. Tips for working with the agent

- Keep the agent in planning mode first for Phases 1 and 3, and review its plan against Section 3 before letting it write code.
- Commit after every phase so you can roll back when it drifts.
- If it adds features not in the plan (auth, Docker, analytics), refuse them until the core is stable.
- Before the interview, deliberately break one thing (change a timeout, add a rule) and practice fixing it. They said they may ask you to modify a requirement.
