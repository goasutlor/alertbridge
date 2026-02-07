#!/bin/bash
# Test webhook with API Key authentication
# Usage: ./scripts/test_webhook.sh [API_KEY]

API_KEY="${1:-4727d4eea8f3396efc71487edc5e751820128d8e130da98b4b8e29a1f8f08bf3}"
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

# Test Confluent format
echo "=== Test 2: Confluent Alert ==="
curl -X POST "${BASE_URL}/webhook/confluent" \
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
