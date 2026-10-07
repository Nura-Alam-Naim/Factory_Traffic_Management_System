#!/bin/bash
API="http://localhost:3000/api/junctions/A"
echo "=================================================="
echo "Scenario 3: Emergency Preemption"
echo "=================================================="
curl -s -X POST "$API/sensor-events" -H "Content-Type: application/json" -d '{
  "eventId": "evt_emg_1", "direction": "NORTH", "vehicleId": "emg1", "type": "VEHICLE_ARRIVED", "vehicleType": "EMERGENCY", "sequenceNo": 4, "timestamp": '$(date +%s%3N)'
}'
echo -e "\n\nEmergency vehicle registered. Mode should be EMERGENCY."
sleep 1
curl -s "$API/state" | grep -o '"mode":"[^"]*"\|"stage":"[^"]*"\|"phase":"[^"]*"'
