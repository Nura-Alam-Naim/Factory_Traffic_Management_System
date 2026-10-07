#!/bin/bash
API="http://localhost:3000/api/junctions/A"
echo "=================================================="
echo "Scenario 1: Normal Traffic"
echo "=================================================="
curl -s -X POST "$API/sensor-events" -H "Content-Type: application/json" -d '{
  "eventId": "evt_norm_1", "direction": "EAST", "vehicleId": "v_emp_1", "type": "VEHICLE_ARRIVED", "vehicleType": "EMPLOYEE", "sequenceNo": 1, "timestamp": '$(date +%s%3N)'
}'
echo -e "\n\nWaiting 1s..."
sleep 1
curl -s "$API/state" | grep -o '"mode":"[^"]*"\|"stage":"[^"]*"\|"phase":"[^"]*"'
