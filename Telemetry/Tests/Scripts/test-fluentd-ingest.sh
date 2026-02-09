#!/bin/bash
# Integration test script for Fluent Bit / Fluentd log ingestion
#
# Tests the /fluentd/v1/logs endpoint with realistic payloads
# to verify that structured attributes are preserved.
#
# Usage:
#   ./test-fluentd-ingest.sh <ONEUPTIME_URL> <SERVICE_TOKEN> [SERVICE_NAME]
#
# Example:
#   ./test-fluentd-ingest.sh http://localhost:3400 your-token-here my-k8s-service

set -euo pipefail

URL="${1:?Usage: $0 <ONEUPTIME_URL> <SERVICE_TOKEN> [SERVICE_NAME]}"
TOKEN="${2:?Usage: $0 <ONEUPTIME_URL> <SERVICE_TOKEN> [SERVICE_NAME]}"
SERVICE_NAME="${3:-fluent-test-service}"

ENDPOINT="${URL}/fluentd/v1/logs"

echo "=== Fluent Bit/Fluentd Log Ingestion Integration Tests ==="
echo "Endpoint: ${ENDPOINT}"
echo "Service:  ${SERVICE_NAME}"
echo ""

# Test 1: Single structured Kubernetes log entry
echo "--- Test 1: Single Kubernetes log entry with metadata ---"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "${ENDPOINT}" \
  -H "Content-Type: application/json" \
  -H "x-oneuptime-token: ${TOKEN}" \
  -H "x-oneuptime-service-name: ${SERVICE_NAME}" \
  -d '{
    "message": "Connection to database established successfully",
    "level": "info",
    "stream": "stdout",
    "time": "2024-01-15T10:30:00.123456789Z",
    "kubernetes": {
      "namespace_name": "production",
      "pod_name": "api-server-7b9f4c8d5-xk2m9",
      "container_name": "api-server",
      "pod_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "labels": {
        "app": "api-server",
        "version": "v2.1.0",
        "team": "platform"
      },
      "host": "node-pool-1-abc"
    }
  }')
echo "HTTP Status: ${HTTP_CODE}"
[ "${HTTP_CODE}" = "200" ] && echo "PASS" || echo "FAIL (expected 200)"
echo ""

# Test 2: Batch of log entries (array format from Fluentd)
echo "--- Test 2: Batch of structured log entries ---"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "${ENDPOINT}" \
  -H "Content-Type: application/json" \
  -H "x-oneuptime-token: ${TOKEN}" \
  -H "x-oneuptime-service-name: ${SERVICE_NAME}" \
  -d '[
    {
      "message": "Request received: GET /api/health",
      "level": "debug",
      "stream": "stdout",
      "kubernetes": {
        "namespace_name": "production",
        "pod_name": "web-abc123",
        "container_name": "nginx"
      }
    },
    {
      "message": "Upstream timeout after 30s",
      "level": "error",
      "stream": "stderr",
      "kubernetes": {
        "namespace_name": "production",
        "pod_name": "web-abc123",
        "container_name": "nginx"
      }
    },
    {
      "message": "Retrying connection to upstream",
      "level": "warning",
      "stream": "stderr",
      "kubernetes": {
        "namespace_name": "production",
        "pod_name": "web-abc123",
        "container_name": "nginx"
      }
    }
  ]')
echo "HTTP Status: ${HTTP_CODE}"
[ "${HTTP_CODE}" = "200" ] && echo "PASS" || echo "FAIL (expected 200)"
echo ""

# Test 3: Fluentd json-wrapped format
echo "--- Test 3: Fluentd json-wrapped format ---"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "${ENDPOINT}" \
  -H "Content-Type: application/json" \
  -H "x-oneuptime-token: ${TOKEN}" \
  -H "x-oneuptime-service-name: ${SERVICE_NAME}" \
  -d '{
    "json": {
      "log": "2024-01-15 ERROR: Failed to connect to redis:6379",
      "stream": "stderr",
      "level": "error",
      "kubernetes": {
        "namespace_name": "default",
        "pod_name": "cache-worker-xyz",
        "container_name": "worker",
        "labels": {
          "app.kubernetes.io/name": "cache-worker",
          "app.kubernetes.io/component": "background"
        }
      }
    }
  }')
echo "HTTP Status: ${HTTP_CODE}"
[ "${HTTP_CODE}" = "200" ] && echo "PASS" || echo "FAIL (expected 200)"
echo ""

# Test 4: Log with trace context
echo "--- Test 4: Log with trace/span IDs ---"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "${ENDPOINT}" \
  -H "Content-Type: application/json" \
  -H "x-oneuptime-token: ${TOKEN}" \
  -H "x-oneuptime-service-name: ${SERVICE_NAME}" \
  -d '{
    "message": "Processing order #12345",
    "level": "info",
    "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
    "span_id": "00f067aa0ba902b7",
    "kubernetes": {
      "namespace_name": "production",
      "pod_name": "order-service-abc"
    },
    "order_id": "12345",
    "customer_id": "cust-789"
  }')
echo "HTTP Status: ${HTTP_CODE}"
[ "${HTTP_CODE}" = "200" ] && echo "PASS" || echo "FAIL (expected 200)"
echo ""

# Test 5: Plain string (backward compatibility)
echo "--- Test 5: Plain string body (backward compatibility) ---"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "${ENDPOINT}" \
  -H "Content-Type: application/json" \
  -H "x-oneuptime-token: ${TOKEN}" \
  -H "x-oneuptime-service-name: ${SERVICE_NAME}" \
  -d '"A simple plain-text log message"')
echo "HTTP Status: ${HTTP_CODE}"
[ "${HTTP_CODE}" = "200" ] && echo "PASS" || echo "FAIL (expected 200)"
echo ""

# Test 6: Docker/container log format (log field instead of message)
echo "--- Test 6: Docker container log format (using 'log' field) ---"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "${ENDPOINT}" \
  -H "Content-Type: application/json" \
  -H "x-oneuptime-token: ${TOKEN}" \
  -H "x-oneuptime-service-name: ${SERVICE_NAME}" \
  -d '{
    "log": "{\"ts\":\"2024-01-15T10:30:00Z\",\"msg\":\"Server started on port 8080\"}\n",
    "stream": "stdout",
    "time": "2024-01-15T10:30:00.000000001Z",
    "kubernetes": {
      "namespace_name": "staging",
      "pod_name": "api-v2-deployment-85d97fb8c7-4xnpq",
      "container_name": "api",
      "container_image": "registry.example.com/api:v2.0.1"
    }
  }')
echo "HTTP Status: ${HTTP_CODE}"
[ "${HTTP_CODE}" = "200" ] && echo "PASS" || echo "FAIL (expected 200)"
echo ""

echo "=== All integration tests completed ==="
echo ""
echo "To verify attributes were stored, query the logs in OneUptime UI"
echo "and check for attributes like:"
echo "  - fluentd.kubernetes.namespace_name"
echo "  - fluentd.kubernetes.pod_name"
echo "  - fluentd.kubernetes.container_name"
echo "  - fluentd.kubernetes.labels.*"
echo "  - fluentd.stream"
echo "  - fluentd.time"
