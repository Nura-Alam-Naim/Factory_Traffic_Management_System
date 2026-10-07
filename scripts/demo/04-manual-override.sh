#!/bin/bash
API="http://localhost:3000/api/junctions/A"
echo "=================================================="
echo "Scenario 4: Manual Override"
echo "=================================================="
curl -s -X POST "$API/manual" -H "Content-Type: application/json" -d '{
  "adminId": "admin99", "direction": "WEST"
}'
echo -e "\n\nManual override requested. Mode should be MANUAL."
sleep 1
curl -s "$API/state" | grep -o '"mode":"[^"]*"\|"stage":"[^"]*"\|"phase":"[^"]*"'

echo -e "\n\nReverting to Automatic..."
curl -s -X POST "$API/automatic" -H "Content-Type: application/json" -d '{
  "adminId": "admin99"
}'
