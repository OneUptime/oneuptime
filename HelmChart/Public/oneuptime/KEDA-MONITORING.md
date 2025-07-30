# KEDA Autoscaling Monitoring Examples

This document provides examples of how to monitor and test KEDA autoscaling for OneUptime services.

## Monitoring KEDA in Action

### 1. Watch ScaledObject Status

Monitor the ScaledObject to see scaling decisions in real-time:

```bash
# Watch ScaledObject status
kubectl get scaledobjects -w

# Get detailed ScaledObject information
kubectl describe scaledobject <release-name>-open-telemetry-ingest
```

### 2. Monitor Queue Metrics

Check the current queue size that KEDA is monitoring:

```bash
# Get a pod name
POD_NAME=$(kubectl get pods -l app=<release-name>-open-telemetry-ingest -o jsonpath='{.items[0].metadata.name}')

# Check queue metrics
kubectl exec $POD_NAME -- curl http://localhost:3403/metrics | grep oneuptime_telemetry_queue_size
```

### 3. View Scaling Events

See the scaling events triggered by KEDA:

```bash
# View HPA events (KEDA creates an HPA under the hood)
kubectl describe hpa keda-hpa-<release-name>-open-telemetry-ingest

# View deployment scaling events
kubectl describe deployment <release-name>-open-telemetry-ingest

# View all events related to autoscaling
kubectl get events --field-selector reason=ScalingReplicaSet -w
```

### 4. Check KEDA Operator Logs

If scaling isn't working as expected, check the KEDA operator logs:

```bash
# KEDA operator logs
kubectl logs -n keda-system deployment/keda-operator -f

# KEDA metrics adapter logs
kubectl logs -n keda-system deployment/keda-metrics-apiserver -f
```

## Testing Autoscaling Behavior

### Simulate High Queue Load

To test if autoscaling works correctly, you can artificially increase the queue size:

1. **Send Multiple Telemetry Requests**: Use a load testing tool to send many telemetry requests to the OpenTelemetry endpoint
2. **Monitor Queue Growth**: Watch the queue size metric increase
3. **Observe Scaling**: See KEDA create additional pods when threshold is exceeded

### Example Load Test Script

```bash
#!/bin/bash

# Simple load test to trigger autoscaling
ENDPOINT="http://<your-oneuptime-host>/opentelemetryingest/v1/traces"

echo "Starting load test to trigger KEDA autoscaling..."
for i in {1..100}; do
  curl -X POST "$ENDPOINT" \
    -H "Content-Type: application/json" \
    -d '{
      "resourceSpans": [
        {
          "resource": {
            "attributes": [
              {"key": "service.name", "value": {"stringValue": "test-service"}}
            ]
          },
          "instrumentationLibrarySpans": [
            {
              "spans": [
                {
                  "traceId": "'"$(openssl rand -hex 16)"'",
                  "spanId": "'"$(openssl rand -hex 8)"'",
                  "name": "test-span-'"$i"'",
                  "startTimeUnixNano": "'"$(date +%s)000000000"'",
                  "endTimeUnixNano": "'"$(date +%s)000000000"'"
                }
              ]
            }
          ]
        }
      ]
    }' &
done

wait
echo "Load test completed. Check queue metrics and scaling status."
```

## Useful Monitoring Commands

```bash
# Check current replica count
kubectl get deployment <release-name>-open-telemetry-ingest -o jsonpath='{.status.replicas}'

# Monitor pod creation/deletion
kubectl get pods -l app=<release-name>-open-telemetry-ingest -w

# Check ScaledObject conditions
kubectl get scaledobject <release-name>-open-telemetry-ingest -o jsonpath='{.status.conditions}'

# View current metric values that KEDA is seeing
kubectl get --raw "/apis/external.metrics.k8s.io/v1beta1/namespaces/<namespace>/oneuptime_telemetry_queue_size"
```

## Expected Scaling Behavior

With the default configuration:

- **Scale Up**: When queue size > 50 items
- **Scale Down**: When queue size < 50 items (after cooldown period)
- **Min Replicas**: 1 pod minimum
- **Max Replicas**: 20 pods maximum  
- **Cooldown**: 5 minutes between scaling decisions
- **Polling**: Check metrics every 30 seconds

## Troubleshooting Common Issues

### Scaling Not Happening

1. **Check Metrics Endpoint**: Ensure `/metrics` is accessible and returning valid data
2. **Verify Authentication**: Check TriggerAuthentication configuration
3. **Review KEDA Logs**: Look for errors in KEDA operator logs
4. **Validate Query**: Test the Prometheus query manually

### Scaling Too Aggressive

1. **Increase Threshold**: Raise the queue size threshold
2. **Extend Cooldown**: Increase cooldown period to slow down scaling decisions
3. **Adjust Polling**: Increase polling interval to check metrics less frequently

### Scaling Too Slow

1. **Decrease Threshold**: Lower the queue size threshold
2. **Reduce Cooldown**: Decrease cooldown period for faster scaling
3. **Increase Polling**: Check metrics more frequently
