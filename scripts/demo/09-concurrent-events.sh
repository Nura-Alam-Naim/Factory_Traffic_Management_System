#!/bin/bash
API="http://localhost:3000/api/junctions/A"
echo "=================================================="
echo "Scenario 9: Concurrent Events"
echo "=================================================="

curl -s -X POST "$API/sensor-events" -H "Content-Type: application/json" -d '{"eventId": "c1", "direction": "NORTH", "vehicleId": "vt1", "type": "VEHICLE_ARRIVED", "vehicleType": "TRUCK", "sequenceNo": 8, "timestamp": '$(date +%s%3N)'}' &
curl -s -X POST "$API/sensor-events" -H "Content-Type: application/json" -d '{"eventId": "c2", "direction": "EAST", "vehicleId": "ve1", "type": "VEHICLE_ARRIVED", "vehicleType": "EMERGENCY", "sequenceNo": 9, "timestamp": '$(date +%s%3N)'}' &
curl -s -X POST "$API/manual" -H "Content-Type: application/json" -d '{"adminId": "admin_c", "direction": "WEST"}' &
curl -s -X POST "$API/sensor-events" -H "Content-Type: application/json" -d '{"eventId": "c2", "direction": "EAST", "vehicleId": "ve1", "type": "VEHICLE_ARRIVED", "vehicleType": "EMERGENCY", "sequenceNo": 9, "timestamp": '$(date +%s%3N)'}' &

wait

echo -e "\n\nEvents fired concurrently. Checking audit log..."
sleep 2
curl -s "$API/history" | grep '"event_type"' | head -n 5
