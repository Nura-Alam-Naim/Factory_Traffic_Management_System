#!/bin/bash
API="http://localhost:3000/api/junctions/A"
echo "=================================================="
echo "Scenario 2: Priority Traffic (Truck vs Employee)"
echo "=================================================="
curl -s -X POST "$API/sensor-events" -H "Content-Type: application/json" -d '{
  "eventId": "evt_prio_1", "direction": "NORTH", "vehicleId": "v_emp_2", "type": "VEHICLE_ARRIVED", "vehicleType": "EMPLOYEE", "sequenceNo": 2, "timestamp": '$(date +%s%3N)'
}'
curl -s -X POST "$API/sensor-events" -H "Content-Type: application/json" -d '{
  "eventId": "evt_prio_2", "direction": "EAST", "vehicleId": "v_trk_1", "type": "VEHICLE_ARRIVED", "vehicleType": "TRUCK", "sequenceNo": 3, "timestamp": '$(date +%s%3N)'
}'
echo -e "\n\nChecking priority score (EAST should win due to TRUCK)..."
sleep 1
curl -s "$API/history" | grep '"event_type":"SIGNAL_TRANSITION"' | head -n 1
