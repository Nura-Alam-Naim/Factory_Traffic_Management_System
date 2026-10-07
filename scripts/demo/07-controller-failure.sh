#!/bin/bash
API="http://localhost:3000/api/junctions/A"
echo "=================================================="
echo "Scenario 7: Controller Failure"
echo "=================================================="

curl -s -X POST "$API/controller-events" -H "Content-Type: application/json" -d '{
  "status": "OFFLINE"
}' || echo "Simulate offline controller via controller-events endpoint."

echo -e "\nWaiting 1s for state update..."
sleep 1
curl -s "$API/state" | grep -o '"mode":"[^"]*"\|"stage":"[^"]*"\|"phase":"[^"]*"'
