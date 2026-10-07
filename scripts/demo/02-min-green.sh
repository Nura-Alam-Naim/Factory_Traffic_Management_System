#!/bin/bash
API="http://localhost:3000/api/junctions/A"

echo "=================================================="
echo "Scenario 2: Minimum Green Enforcement"
echo "=================================================="

# Just arrived on GREEN, then immediately someone arrives on RED.
# The system must wait for Minimum Green time before switching.

curl -s -X POST "$API/sensor-events" \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "evt_s2",
    "direction": "NORTH",
    "vehicleId": "truck2",
    "type": "VEHICLE_ARRIVED",
    "vehicleType": "TRUCK",
    "sequenceNo": 1,
    "timestamp": '$(date +%s%3N)'
  }'

echo -e "\n\nState (should still be waiting for min green):"
sleep 1
curl -s "$API/state" | grep -o '"mode":"[^"]*"\|"stage":"[^"]*"\|"phase":"[^"]*"'
