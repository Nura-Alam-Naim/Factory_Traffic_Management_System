#!/bin/bash

# Configuration
API="http://localhost:3000/api/junctions/A"
echo "=================================================="
echo "Scenario 1: Truck Arrives on Red"
echo "=================================================="
curl -s -X POST "$API/sensor-events" \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "evt_truck_1",
    "direction": "EAST",
    "vehicleId": "truck1",
    "type": "VEHICLE_ARRIVED",
    "vehicleType": "TRUCK",
    "sequenceNo": 1,
    "timestamp": '$(date +%s%3N)'
  }'
echo -e "\n\nChecking State..."
sleep 1
curl -s "$API/state" | grep -o '"mode":"[^"]*"\|"stage":"[^"]*"\|"phase":"[^"]*"'

echo -e "\n\n=================================================="
echo "Scenario 5: Emergency Preemption"
echo "=================================================="
curl -s -X POST "$API/sensor-events" \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "evt_emg_1",
    "direction": "NORTH",
    "vehicleId": "emg1",
    "type": "VEHICLE_ARRIVED",
    "vehicleType": "EMERGENCY",
    "sequenceNo": 2,
    "timestamp": '$(date +%s%3N)'
  }'
echo -e "\n\nChecking State..."
sleep 1
curl -s "$API/state" | grep -o '"mode":"[^"]*"\|"stage":"[^"]*"\|"phase":"[^"]*"'

echo -e "\n\n=================================================="
echo "Scenario 6: Manual Override"
echo "=================================================="
curl -s -X POST "$API/manual" \
  -H "Content-Type: application/json" \
  -d '{
    "adminId": "admin99",
    "direction": "WEST"
  }'
echo -e "\n\nChecking State..."
sleep 1
curl -s "$API/state" | grep -o '"mode":"[^"]*"\|"stage":"[^"]*"\|"phase":"[^"]*"'
