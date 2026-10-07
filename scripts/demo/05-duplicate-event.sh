#!/bin/bash
API="http://localhost:3000/api/junctions/A"
echo "=================================================="
echo "Scenario 5: Duplicate Event"
echo "=================================================="

# Same eventId sent twice
PAYLOAD='{
  "eventId": "evt_dup_1", "direction": "SOUTH", "vehicleId": "v_dup_1", "type": "VEHICLE_ARRIVED", "sequenceNo": 5, "timestamp": '$(date +%s%3N)'
}'

echo "First submission:"
curl -s -X POST "$API/sensor-events" -H "Content-Type: application/json" -d "$PAYLOAD"

echo -e "\n\nSecond submission (should be 200 Duplicate):"
curl -s -X POST "$API/sensor-events" -H "Content-Type: application/json" -d "$PAYLOAD"
