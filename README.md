# Factory Traffic Management System

A mission-critical backend service for managing traffic junctions inside a busy industrial factory.

## Overview
This system safely manages traffic flows for factory junctions, preventing conflicts between vehicles (forklifts, trucks, employee vehicles, and emergency responders). The backend is driven by a pure, deterministic state machine and an event-sourced queue processor that is entirely detached from I/O constraints.

## Setup & Run

1. **Start the Database (Optional if you have local MySQL)**
   ```bash
   docker-compose up -d
   ```

2. **Install Dependencies**
   ```bash
   cd backend
   npm install
   cd ../frontend
   npm install
   ```

3. **Start the System**
   ```bash
   # Run the backend (API + MQTT Broker on port 1883)
   cd backend
   npm start

   # Run the frontend (Vite React dashboard)
   cd frontend
   npm run dev
   ```

## Architecture Decisions
- **Hexagonal Architecture (Ports & Adapters):** The domain logic (`src/domain`) is 100% pure, containing no I/O, no promises, and no hidden state (e.g., `Date.now()`). All persistence, routing, and MQTT communication are kept outside the domain layer.
- **Actor Model:** Each junction is represented as a serialized message queue (actor) to process concurrent sensor events strictly in order, eliminating race conditions.
- **Embedded MQTT Broker:** Uses `aedes` to embed the MQTT broker directly in the Node process, reducing external dependencies.
- **SSE for UI:** Server-Sent Events (SSE) push live state updates to the React frontend dashboard efficiently.

## Traffic-Control Algorithm
The scheduling algorithm is built on a weighted scoring mechanism:
1. Vehicles are assigned base weights (`EMERGENCY`: 100, `TRUCK`: 5, `FORKLIFT`: 3, `EMPLOYEE`: 1).
2. The waiting time multiplied by a wait-factor (0.1) adds to the score over time.
3. Hysteresis (a 1.2x multiplier for the currently active phase) prevents rapid flickering when traffic is balanced.
4. **Starvation Prevention:** A flat bonus (+1000) is given if vehicles wait longer than the max wait time threshold.
5. Strict overrides exist for `MANUAL` lease modes and `EMERGENCY` preemption.

## State Transitions
Transitions are heavily guarded by a single safety function (`safety.js`). The normal sequence goes:
`GREEN` -> `YELLOW` (waits for physical ACK and timer) -> `ALL_RED` -> `GREEN` (new phase).
- **Safety Invariant:** Opposing directions are NEVER permitted to be GREEN or YELLOW simultaneously. 
- **Timeouts:** If the controller fails to ACK within limits, the system drops into a `DEGRADED` mode holding `ALL_RED` for safety.

## Assumptions / Questions / Requirement Issues
As required in the assessment, here are answers to key decisions:
- **What exactly counts as a conflicting traffic movement?** Orthogonal phases are conflicting (e.g., NORTH/SOUTH vs EAST/WEST).
- **How is maximum waiting time calculated?** By computing `serverTime - receivedAt` for the oldest vehicle in a queue. If it exceeds a configured starvation threshold, a large bonus forces service.
- **What happens if a `VEHICLE_CLEARED` event arrives without a corresponding arrival?** It is recorded as a tombstone. If an older ARRIVAL arrives later, it is ignored safely. Audited as `ORPHAN_CLEAR`.
- **How should delayed sensor events be treated?** The system relies on `sequence_no`. Strictly older sequence numbers from the same sensor are ignored.
- **How should out-of-order events be treated?** Similar to above, monotonic `sequence_no` tracking discards older/out-of-order repeats.
- **How should duplicate events be detected?** Primary: The application layer checks if `event_id` exists in `processed_events`. Secondary: A database PK constraint on `event_id`.
- **Is event_id, sequence_no, or another mechanism authoritative?** `event_id` is authoritative for deduplication. `sequence_no` is authoritative for device ordering.
- **Which timestamp is authoritative: sensor time or server time?** Server time (`receivedAt`) determines waiting durations and tie-breakers. Sensor timestamps are retained only for auditing/staleness validation.
- **How long does manual override remain active?** Implemented as a lease with an explicit timeout (e.g., 5 minutes) after which it automatically reverts to `AUTOMATIC`.
- **What happens when two administrators issue commands simultaneously?** The first serialized command acquires the lease. The second receives a `409 Conflict`.
- **Should emergency mode override manual mode?** Yes. `EMERGENCY` > `MANUAL`. After the emergency, control reverts to the manual lease if it has not yet expired.
- **What happens if two emergency vehicles arrive from conflicting directions?** The first to arrive (by server timestamp) begins its preemption. The second waits in the queue and is served next. No unsafe flapping or simultaneous greens.
- **When is an emergency considered cleared?** When a corresponding `VEHICLE_CLEARED` event arrives, or if a hard TTL timeout is reached (stale emergency).
- **How long should the backend wait for a controller acknowledgement?** 5000ms (configurable). 
- **Should controller commands be retried?** Yes, up to 2 times with the exact same `command_id` to remain idempotent for the controller.
- **How should duplicate ACK messages be treated?** Ignored silently if the `command_id` has already been confirmed.
- **What happens when the controller reconnects?** The backend enters `RECOVERING` mode, assumes physical signals are `UNKNOWN`, issues an `ALL_RED` sync command, and waits for ACK before resuming normal traffic.
- **What happens if desired state and actual state disagree?** The transition timers (e.g. YELLOW duration) do not start counting until the controller explicitly ACKs the state.
- **What should happen when the backend loses communication with the controller?** Command timeout triggers `DEGRADED` mode. Desired state becomes `ALL_RED` for safety.
- **How should signal timers behave after a server restart?** Timers do not blindly resume. All pending commands are abandoned and the system performs the `ALL_RED` recovery procedure.
- **How should the application recover if it restarts in the middle of a signal transition?** It boots into `RECOVERING` mode, issues `ALL_RED`, and waits for controller confirmation. Only once confirmed safe does it resume phase transitions.

## API Docs & Changes
- OpenAPI specification: `docs/openapi.json`
- Postman Collection: `docs/postman_collection.json`
- **Changes from Plan:** Added `/api/junctions/:id/stream` for SSE streaming, enabling real-time UI dashboard updates without polling. 

## Demo Scenarios
In `scripts/demo/`, you will find 9 shell scripts to test specific scenarios using curl:
- `01-basic-switch.sh`: Standard traffic switch.
- `02-min-green.sh`: Testing the minimum green delay.
- `03-max-green.sh`: Timeout for maximum green phase.
- `04-starvation.sh`: Forcing a phase change via starvation.
- `05-emergency.sh`: Emergency vehicle preemption.
- `06-manual.sh`: Requesting manual administrative control.
- `07-degraded.sh`: Forcing controller offline timeout.
- `08-recovery.sh`: Instructions for restarting the node process.
- `09-concurrency.sh`: Fire multiple conflicting sensor/manual events simultaneously.

## Tests
Over 40+ tests available testing domain rules and API integration.
```bash
cd backend
npm run test
```
The test suite includes a **fast-check Property Test** spanning hundreds of iterations asserting that safety invariants hold under all random traffic conditions.

## Incomplete / Next Steps
- Implement Authentication & Authorization.
- Expand conflict matrices to handle partial intersection topologies.
- Expand React UI to support adding and configuring new junctions visually.
- Hardware-level physical conflict monitor simulation.

## AI / Tool Usage
This project utilized Google Deepmind Antigravity for planning, scaffolding, implementation generation, and testing (including property-based tests). All architectural bounds, pure domain logic boundaries, and code structures were guided iteratively and thoroughly reviewed to guarantee correctness.
