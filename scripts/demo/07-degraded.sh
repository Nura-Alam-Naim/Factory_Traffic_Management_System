#!/bin/bash
API="http://localhost:3000/api/junctions/A"

echo "=================================================="
echo "Scenario 7: Controller Timeout (Degraded Mode)"
echo "=================================================="

# Simulate the controller going offline or failing to ack commands.
# We can do this by submitting an offline status.

curl -s -X POST "$API/controller-events" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "OFFLINE"
  }' || echo "If controller-events endpoint is absent, use MQTT or simulator."

echo -e "\n\nWaiting 1s..."
sleep 1
curl -s "$API/state" | grep -o '"mode":"[^"]*"\|"stage":"[^"]*"\|"phase":"[^"]*"'
