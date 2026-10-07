#!/bin/bash
API="http://localhost:3000/api/junctions/A"
echo "=================================================="
echo "Scenario 6: Vehicle Clearance"
echo "=================================================="

TS=$(date +%s%3N)
curl -s -X POST "$API/sensor-events" -H "Content-Type: application/json" -d '{
  "eventId": "evt_clr_1", "direction": "NORTH", "vehicleId": "v_clr_1", "type": "VEHICLE_ARRIVED", "sequenceNo": 6, "timestamp": '$TS'
}'

echo "Queue after arrival:"
curl -s "$API/state" | grep -o '"NORTH":[^,}]*'

sleep 1

curl -s -X POST "$API/sensor-events" -H "Content-Type: application/json" -d '{
  "eventId": "evt_clr_2", "direction": "NORTH", "vehicleId": "v_clr_1", "type": "VEHICLE_CLEARED", "sequenceNo": 7, "timestamp": '$(date +%s%3N)'
}'

echo -e "\nQueue after clearance:"
curl -s "$API/state" | grep -o '"NORTH":[^,}]*'
