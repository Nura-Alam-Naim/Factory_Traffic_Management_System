#!/bin/bash
API="http://localhost:3000/api/junctions/A"

echo "=================================================="
echo "Scenario 1: Basic Switch (Truck Arrives on Red)"
echo "=================================================="

# Check initial state
echo "Initial State:"
curl -s "$API/state" | grep -o '"mode":"[^"]*"\|"stage":"[^"]*"\|"phase":"[^"]*"'

# Submit event
curl -s -X POST "$API/sensor-events" \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "evt_s1",
    "direction": "EAST",
    "vehicleId": "truck1",
    "type": "VEHICLE_ARRIVED",
    "vehicleType": "TRUCK",
    "sequenceNo": 1,
    "timestamp": '$(date +%s%3N)'
  }'

echo -e "\n\nWaiting 1s for switch to initiate..."
sleep 1
echo "New State:"
curl -s "$API/state" | grep -o '"mode":"[^"]*"\|"stage":"[^"]*"\|"phase":"[^"]*"'
