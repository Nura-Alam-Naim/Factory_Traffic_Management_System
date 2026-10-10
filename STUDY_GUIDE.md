# 🧠 Factory Traffic Management System: Study Guide

Since you have a technical review coming up, this guide breaks down the entire project into bite-sized, understandable concepts. If they ask you *why* something was built a certain way, the answers are here.

---

## 1. The Big Picture: What did we build?
We built the backend for a **Factory Traffic Light System**. Factory vehicles (forklifts, trucks, emergencies) approach an intersection (Junction A). Sensors tell us they arrived. Our backend decides who gets a GREEN light and who gets a RED light.

However, the assessment wasn't just about turning lights green. It was a test of **engineering judgment, safety, and system architecture**. The code we wrote proves that you know how to build a mission-critical system that won't crash or cause accidents under heavy load.

---

## 2. The Golden Rule: Hexagonal Architecture (Ports & Adapters)
If the interviewer asks about architecture, tell them you used **Hexagonal Architecture**.

- **The Domain Layer (`src/domain`)**: This is the "brain" of the traffic lights. It contains the strict rules (e.g., "NORTH and EAST cannot be GREEN at the same time"). 
  - *Crucial detail:* The domain layer is **100% pure JavaScript**. It has absolutely zero knowledge of HTTP requests, MySQL databases, or MQTT. It doesn't even know what the current time is (we inject the time manually). This makes it incredibly easy and fast to test.
- **The Infrastructure Layer (`src/infrastructure`)**: This handles the messy outside world. It talks to MySQL, connects to the MQTT broker, and provides the real system time.
- **The API Layer (`src/api`)**: This is just dumb routing. It receives an HTTP POST request, validates the JSON body using `zod`, and hands the data over to the system.

---

## 3. The Core Concept: Desired vs. Actual State
In the real world, just because a computer tells a traffic light to turn RED, doesn't mean the bulb actually turned RED. 

Therefore, our system tracks two different things:
1. **`desired_signals`**: What the backend *wants* the lights to be.
2. **`actual_signals`**: What the physical hardware controller *confirms* the lights are (via an ACK message).

**The Safety Mechanism:** If the backend wants to switch traffic from NORTH to EAST, it first sets the desired state to YELLOW, then ALL_RED. It **will not** issue the new GREEN to EAST until the hardware controller explicitly ACKs that the NORTH light has physically turned RED.

---

## 4. How We Handle Concurrency (The Actor Model)
**Interview Question:** *"What happens if 5 sensors fire at the exact same millisecond?"*

If you use normal database locks, things get messy, slow, and prone to deadlocks. Instead, we used an **Actor Mailbox Model** (`src/application/junction_actor.js`).

- **How it works:** Every junction has its own asynchronous "queue" (a promise chain). 
- When 5 events arrive at the exact same millisecond, they are placed in a single-file line.
- The junction processes them **strictly one at a time**. It calculates the new state, saves it to MySQL, and only then looks at the next event in line. 
- *Result:* Zero race conditions. Perfect consistency.

---

## 5. The Algorithm: How do we choose who gets GREEN?
We use a **Weighted Scoring Scheduler** (`src/domain/scheduler.js`).
- **Base Score:** Vehicles have different weights. An `EMERGENCY` vehicle is worth 100 points, a `TRUCK` is worth 5, an `EMPLOYEE` is worth 1.
- **Wait Time:** The longer a queue waits, the higher its score gets.
- **Starvation Bonus:** If a phase has been waiting for an extremely long time, it gets a massive bonus (+1000) so it doesn't wait forever.
- **Hysteresis:** To prevent the lights from flickering back and forth every 2 seconds when traffic is equal, the currently active GREEN phase gets a 1.2x multiplier advantage. It wants to stay green.

---

## 6. Real-World Failures & Recovery

### What happens if the controller goes offline?
If we send a command to the controller and it doesn't ACK within 5 seconds, we retry. If it still fails, the system drops into **`DEGRADED` mode**. 
- In DEGRADED mode, the system sets the desired state to `ALL_RED` for safety and refuses to issue any new GREEN lights until the controller comes back online.

### What happens if the server crashes and restarts?
If the Node.js server crashes, we don't know what happened to the traffic lights while we were dead. 
- On boot, the system reads the last known state from MySQL.
- It enters **`RECOVERING` mode**.
- It abandons any old pending commands.
- It sends a fresh `ALL_RED` command to the hardware to forcefully synchronize and make the intersection safe. 
- Once the hardware ACKs the `ALL_RED`, the system resumes normal `AUTOMATIC` operation.

---

## 7. How to Study for the Interview

To master this project before Friday, I highly recommend you do the following:

1. **Run the 9 Demo Scripts:** Open a terminal, start the server (`npm start`), and in another terminal run the scripts in `scripts/demo/`. Watch the console logs and understand what triggers what.
2. **Read `src/domain/safety.js`**: This file contains the ultimate truth of the system. It proves that conflicting greens are impossible.
3. **Read `src/application/junction_actor.js`**: Understand how the promise chain `this.tail = this.tail.then(...)` forces events to process one by one.
4. **Run `npm test`**: Look at how fast the tests run. Because the domain is pure, we can run hundreds of complex scenarios in less than a second without ever touching a database.

If the interviewer asks you to change a requirement (e.g., *"Make Forklifts higher priority than Trucks"*), you would just go into `src/domain/config.js` and update the scoring weights!
