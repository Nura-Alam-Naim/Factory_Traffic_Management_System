#!/bin/bash
API="http://localhost:3000/api/junctions/A"

echo "=================================================="
echo "Scenario 8: Crash Recovery"
echo "=================================================="

echo "To demonstrate this, manually restart the backend process."
echo "Wait for it to boot and check the state (should briefly be RECOVERING, then ALL_RED)."

curl -s "$API/state" | grep -o '"mode":"[^"]*"\|"stage":"[^"]*"\|"phase":"[^"]*"'
