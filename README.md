# Factory Traffic Management System

A mission-critical backend service for managing traffic junctions inside a busy industrial factory.

## Stack
- Node.js
- Express (REST API)
- MySQL2 (Persistence)
- Aedes (Embedded MQTT broker)
- Jest (Testing)

## Quick Start

1. **Start the Database**
   ```bash
   docker-compose up -d
   ```

2. **Install Dependencies**
   ```bash
   cd backend
   npm install
   ```

3. **Run Tests**
   ```bash
   npm run test
   ```

4. **Start the Server**
   ```bash
   npm start
   ```

## Documentation

- [Architecture & Design Decisions](./ARCHITECTURE.md)
- [Execution Megaplan](./MEGAPLAN.md)
- [Agent Rules](./AGENTS.md)

## API Endpoints

- `GET /api/junctions` - List all configured junctions
- `GET /api/junctions/:id/state` - Get the current state of a junction
- `GET /api/junctions/:id/history` - Get recent audit logs
- `GET /api/junctions/:id/stream` - SSE stream of live state updates
- `POST /api/junctions/:id/manual` - Take manual control `{"adminId": "123", "direction": "NORTH"}`
- `POST /api/junctions/:id/automatic` - Return to automatic `{"adminId": "123"}`
- `POST /api/junctions/:id/sensor-events` - Submit a vehicle arrival/clearance

## MQTT Topics

- Listen: `factory/traffic/<junction_id>/sensor`
- Listen: `factory/traffic/<junction_id>/controller/ack`
- Listen: `factory/traffic/<junction_id>/controller/status`
- Publish: `factory/traffic/<junction_id>/command`
- Publish: `factory/traffic/<junction_id>/alerts`
