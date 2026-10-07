#!/bin/bash
API="http://localhost:3000/api/junctions/A"

echo "=================================================="
echo "Scenario 6: Manual Override"
echo "=================================================="

curl -s -X POST "$API/manual" \
  -H "Content-Type: application/json" \
  -d '{
    "adminId": "admin99",
    "direction": "WEST"
  }'

echo -e "\n\nWaiting 1s..."
sleep 1
curl -s "$API/state" | grep -o '"mode":"[^"]*"\|"stage":"[^"]*"\|"phase":"[^"]*"'
