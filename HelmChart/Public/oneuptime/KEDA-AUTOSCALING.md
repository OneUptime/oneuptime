# KEDA Autoscaling for OneUptime Services

This document describes the KEDA (Kubernetes Event-Driven Autoscaling) configuration for OneUptime services, specifically the OpenTelemetry Ingest service.

## Overview

KEDA enables event-driven autoscaling based on various metrics sources. For the OpenTelemetry Ingest service, we use queue size metrics to automatically scale the number of pods based on telemetry ingestion demand.

## Configuration

### Prerequisites

1. KEDA must be installed in your Kubernetes cluster
2. The `keda.enabled` value must be set to `true` in your values.yaml
3. The service must have a metrics endpoint that exposes Prometheus-format metrics

### OpenTelemetry Ingest KEDA Configuration

The OpenTelemetry Ingest service supports KEDA autoscaling based on queue metrics. The configuration is enabled by setting:

```yaml
keda:
  enabled: true

openTelemetryIngest:
  enableKedaAutoscaler: true
  kedaMinReplicas: 1
  kedaMaxReplicas: 20
  kedaThreshold: "50"
  kedaMetricName: "oneuptime_telemetry_queue_size"
  kedaQuery: "oneuptime_telemetry_queue_size"
  kedaCooldownPeriod: 300
  kedaPollingInterval: 30
  port: 3403
```

### Configuration Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `enableKedaAutoscaler` | Enable KEDA autoscaling for this service | `true` |
| `kedaMinReplicas` | Minimum number of replicas | `1` |
| `kedaMaxReplicas` | Maximum number of replicas | `20` |
| `kedaThreshold` | Queue size threshold to trigger scaling | `"50"` |
| `kedaMetricName` | Name of the metric for KEDA | `"oneuptime_telemetry_queue_size"` |
| `kedaQuery` | Prometheus query for the metric | `"oneuptime_telemetry_queue_size"` |
| `kedaCooldownPeriod` | Cooldown period in seconds after scaling | `300` |
| `kedaPollingInterval` | How often to poll metrics in seconds | `30` |
| `port` | Service port for metrics endpoint | `3403` |

### Metrics Endpoint

The OpenTelemetry Ingest service exposes queue metrics at the `/metrics` endpoint in Prometheus format:

```
# HELP oneuptime_telemetry_queue_size Current size of the telemetry queue
# TYPE oneuptime_telemetry_queue_size gauge
oneuptime_telemetry_queue_size 123

# HELP oneuptime_telemetry_queue_waiting Number of waiting jobs in the telemetry queue
# TYPE oneuptime_telemetry_queue_waiting gauge
oneuptime_telemetry_queue_waiting 45

# HELP oneuptime_telemetry_queue_active Number of active jobs in the telemetry queue
# TYPE oneuptime_telemetry_queue_active gauge
oneuptime_telemetry_queue_active 5
```

### Authentication

KEDA uses a TriggerAuthentication resource to authenticate with the metrics endpoint. This is automatically configured to use the cluster's internal secret (`oneuptime-secret`) for authentication.

## How It Works

1. **Metrics Collection**: KEDA polls the `/metrics` endpoint of the OpenTelemetry Ingest service every 30 seconds (configurable)
2. **Threshold Evaluation**: When `oneuptime_telemetry_queue_size` exceeds the threshold (default: 50), KEDA triggers scaling up
3. **Scaling Decision**: KEDA creates additional pods up to the maximum replica count (default: 20)
4. **Cooldown**: After scaling, KEDA waits for the cooldown period (default: 300 seconds) before making new scaling decisions
5. **Scale Down**: When queue size drops below threshold, KEDA scales down to minimum replicas (default: 1)

## Benefits

- **Responsive Scaling**: Automatically scales based on actual queue load rather than CPU/memory
- **Cost Efficiency**: Scales down to minimum replicas when queue is empty
- **High Availability**: Scales up quickly during high telemetry ingestion periods
- **Zero Configuration**: Works out of the box with default settings

## Fallback Behavior

If KEDA is disabled or not available, the service falls back to traditional Horizontal Pod Autoscaler (HPA) based on CPU and memory metrics.

## Monitoring

You can monitor KEDA autoscaling behavior using:

```bash
# Check ScaledObject status
kubectl get scaledobjects

# View scaling events
kubectl describe scaledobject <release-name>-open-telemetry-ingest

# Check current metrics
kubectl get --raw "/api/v1/namespaces/<namespace>/services/<release-name>-open-telemetry-ingest:3403/proxy/metrics"
```

## Troubleshooting

### Common Issues

1. **KEDA not scaling**: Check if the metrics endpoint is accessible and returning valid data
2. **Authentication errors**: Verify the TriggerAuthentication resource is created and references the correct secret
3. **No metrics**: Ensure the OpenTelemetry Ingest service is running and the metrics endpoint is enabled

### Debug Commands

```bash
# Check KEDA operator logs
kubectl logs -n keda-system deployment/keda-operator

# Verify metrics are accessible
kubectl exec -it <pod-name> -- curl http://localhost:3403/metrics

# Check TriggerAuthentication
kubectl get triggerauthentication
kubectl describe triggerauthentication <release-name>-open-telemetry-ingest-keda-auth
```

## Advanced Configuration

For production environments, consider adjusting:

- Lower `kedaPollingInterval` (15-30 seconds) for faster response
- Higher `kedaThreshold` (100-200) for larger deployments  
- Shorter `kedaCooldownPeriod` (120-180 seconds) for faster scale-down
- Higher `kedaMaxReplicas` based on cluster capacity

Example production configuration:

```yaml
openTelemetryIngest:
  enableKedaAutoscaler: true
  kedaMinReplicas: 2
  kedaMaxReplicas: 50
  kedaThreshold: "100"
  kedaCooldownPeriod: 180
  kedaPollingInterval: 15
```
