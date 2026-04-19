#!/bin/bash
# Test webhook with API Key authentication
# Usage: ./scripts/test_webhook.sh [API_KEY]

API_KEY="${1:-REPLACE_WITH_TEST_API_KEY}"
BASE_URL="${BASE_URL:-http://127.0.0.1:8081}"

echo "Testing webhook with API Key..."
echo "API Key: ${API_KEY:0:16}..."
echo ""

# Test OCP/Prometheus Alertmanager format
echo "=== Test 1: OCP Alert (firing) ==="
curl -X POST "${BASE_URL}/webhook/ocp" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "firing",
    "labels": {
      "severity": "critical",
      "alertname": "HighCPU",
      "instance": "node-1"
    },
    "annotations": {
      "summary": "CPU above 90%",
      "description": "Node node-1 CPU high"
    },
    "startsAt": "2025-02-06T13:00:00Z",
    "generatorURL": "http://prometheus/graph"
  }'
echo -e "\n"

# Test flat JSON via same OCP path
echo "=== Test 2: Flat JSON alert (same /webhook/ocp) ==="
curl -X POST "${BASE_URL}/webhook/ocp" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "alertId": "a1",
    "description": "Broker down",
    "severity": "high"
  }'
echo -e "\n"

# Test without API Key (should fail if required)
echo "=== Test 3: Without API Key (should fail if required) ==="
curl -X POST "${BASE_URL}/webhook/ocp" \
  -H "Content-Type: application/json" \
  -d '{"status":"firing","labels":{"alertname":"Test"}}'
echo -e "\n"

echo "Done!"
