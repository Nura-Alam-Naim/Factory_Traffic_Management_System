#!/bin/bash
API="http://localhost:3000/api/junctions/A"

echo "=================================================="
echo "Scenario 3: Maximum Green Timeout"
echo "=================================================="

# A continuous stream on GREEN should eventually be cut off by Maximum Green
# if someone is waiting on RED.

curl -s -X POST "$API/sensor-events" \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "evt_s3",
    "direction": "EAST",
    "vehicleId": "truck3",
    "type": "VEHICLE_ARRIVED",
    "vehicleType": "TRUCK",
    "sequenceNo": 1,
    "timestamp": '$(date +%s%3N)'
  }'

echo -e "\n\nCheck History for Phase Transition..."
sleep 1
curl -s "$API/history" | grep '"event_type":"SIGNAL_TRANSITION"' | head -n 1
