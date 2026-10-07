#!/bin/bash
API="http://localhost:3000/api/junctions/A"

echo "=================================================="
echo "Scenario 4: Starvation Prevention"
echo "=================================================="

# Even if a phase has a lower score, if it waits long enough, starvation overrides hysteresis.

curl -s -X POST "$API/sensor-events" \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "evt_s4",
    "direction": "SOUTH",
    "vehicleId": "emp1",
    "type": "VEHICLE_ARRIVED",
    "vehicleType": "EMPLOYEE",
    "sequenceNo": 1,
    "timestamp": '$(date -v-5M +%s%3N 2>/dev/null || date -d "5 minutes ago" +%s%3N)'
  }'

echo -e "\n\nWaiting 1s..."
sleep 1
curl -s "$API/state" | grep -o '"mode":"[^"]*"\|"stage":"[^"]*"\|"phase":"[^"]*"'
