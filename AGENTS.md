# Agent Rules: Factory Traffic Management System

Source: [PLAN.md](./PLAN.md) Section 1. Execution plan: [MEGAPLAN.md](./MEGAPLAN.md).

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

Domain purity (rule 1) is enforced mechanically by `backend/eslint.config.js` (`npm run lint`).
