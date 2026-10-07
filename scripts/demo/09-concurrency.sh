#!/bin/bash
API="http://localhost:3000/api/junctions/A"

echo "=================================================="
echo "Scenario 9: High Concurrency Inputs"
echo "=================================================="

# Fire multiple events simultaneously.
curl -s -X POST "$API/sensor-events" -H "Content-Type: application/json" -d '{"eventId": "c1", "direction": "NORTH", "vehicleId": "vt1", "type": "VEHICLE_ARRIVED", "vehicleType": "TRUCK", "sequenceNo": 1, "timestamp": '$(date +%s%3N)'}' &
curl -s -X POST "$API/sensor-events" -H "Content-Type: application/json" -d '{"eventId": "c2", "direction": "SOUTH", "vehicleId": "ve1", "type": "VEHICLE_ARRIVED", "vehicleType": "EMERGENCY", "sequenceNo": 1, "timestamp": '$(date +%s%3N)'}' &
curl -s -X POST "$API/manual" -H "Content-Type: application/json" -d '{"adminId": "admin_c", "direction": "WEST"}' &

wait

echo -e "\n\nEvents fired concurrently. Waiting 2s..."
sleep 2
curl -s "$API/history" | grep '"event_type"' | head -n 5
