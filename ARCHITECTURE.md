# Architecture & Design Decisions

## 1. Domain-Driven Design (Hexagonal Architecture)
The core traffic logic is entirely pure (`src/domain/`). It contains no imports from external frameworks, database drivers, or time mechanisms (`Date.now()`). Everything is evaluated based on inputs (`state`, `event`, `now`).
- **Purity:** Ensures tests are 100% deterministic and extremely fast. We can fuzz test millions of state transitions in seconds (see `safety.property.test.js`).
- **Effect Pattern:** The domain does not perform I/O. It returns `{ state, effects }`. The application layer interprets the effects (e.g., `SEND_COMMAND`, `AUDIT`).
- **Safety Guard:** All stage transitions must pass through a single choke point (`src/domain/safety.js`) that enforces the single non-negotiable rule: Conflicting directions can *never* be GREEN or YELLOW at the same time, either requested or actual.

## 2. Actor Model (The Mailbox)
Traffic management requires strict serialization. If two sensors send events at the exact same millisecond, processing them concurrently could corrupt the state machine or conflict logic.
- **JunctionActor:** Each junction runs in its own "Actor" (`src/application/actor.js`).
- **Serialization:** All events for a single junction are appended to a Promise chain. This guarantees that one event is fully processed and persisted to MySQL before the next one is evaluated.
- **Tick Loop:** A periodic interval (`tick()`) injects time into the actor. The actor checks timeouts, min/max green times, and scheduler logic, driving the system forward independently of external events.

## 3. Storage and Persistence
State must survive restarts cleanly.
- **MySQL Backend:** All state transitions are saved to MySQL in a single transaction.
- **Optimistic Concurrency:** We use a `version` field. If the actor tries to save state but the version changed, it throws. (Though the actor's serialization already prevents this, it adds defense-in-depth).
- **Restart Recovery:** On boot, the system checks the last known state. If it was mid-transition (e.g. YELLOW with a pending command), it Abandons the pending command, falls back to `ALL_RED`, and enters `RECOVERING` mode until the controller acks the safe state.

## 4. Modes and Preemption
The system supports multiple operational modes:
1. **AUTOMATIC:** Driven by the `scheduler.js` which scores phases based on traffic, wait time, and starvation thresholds.
2. **MANUAL:** An admin can take a lease on a direction. Overrides automatic logic.
3. **EMERGENCY:** Highest priority operational mode. Preempts immediately.
4. **DEGRADED:** The fail-safe mode. If the controller disconnects, or doesn't ACK after retries, the system drops to `DEGRADED`, forcing `ALL_RED` and stopping all traffic until manual intervention or recovery.

## 5. MQTT and Edge Integration
- We embed an MQTT broker (`aedes`) directly in the Node.js application. This makes the system fully self-contained and avoids the operational complexity of deploying a separate Mosquitto instance.
- The `MqttAdapter` listens to `factory/traffic/+/sensor` and translates them into domain events to dispatch to the actor.

## Testing Strategy
- **Unit Tests:** `tests/domain/` tests the pure logic. Extremely fast.
- **Property-Based Tests:** `tests/domain/safety.property.test.js` generates completely random sequences of events (sensor blips, manual requests, acks, random time jumps) and ensures the core invariants (No conflicting greens) are NEVER violated.
- **Integration Tests:** `tests/application/` and `tests/api/` test the wiring.
