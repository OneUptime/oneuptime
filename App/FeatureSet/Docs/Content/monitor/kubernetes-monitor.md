# Kubernetes Monitor

Kubernetes monitoring allows you to monitor the health and performance of your Kubernetes clusters, including nodes, pods, workloads, and control plane components. OneUptime collects metrics from your cluster and evaluates them against your configured criteria.

## Overview

Kubernetes monitors use metrics from your cluster to provide deep visibility into your infrastructure. This enables you to:

- Monitor cluster, namespace, workload, node, and pod health
- Track CPU, memory, disk, and network usage across resources
- Detect pod crashes, restarts, and scheduling failures
- Monitor deployment replica availability
- Alert on control plane issues (etcd, API server, scheduler)
- Track resource requests and limits

## Creating a Kubernetes Monitor

1. Go to **Monitors** in the OneUptime Dashboard
2. Click **Create Monitor**
3. Select **Kubernetes** as the monitor type
4. Select the cluster and resource scope to monitor
5. Configure resource filters and metric queries
6. Configure monitoring criteria as needed

## Configuration Options

### Cluster

Select the Kubernetes cluster to monitor. Clusters must be integrated with OneUptime via OpenTelemetry.

### Resource Scope

Choose the level at which to monitor resources:

| Scope | Description |
|-------|-------------|
| Cluster | Monitor the entire cluster |
| Namespace | Monitor resources within a specific namespace |
| Workload | Monitor a specific deployment, statefulset, daemonset, job, or cronjob |
| Node | Monitor a specific cluster node |
| Pod | Monitor a specific pod |

### Resource Filters

Narrow the scope with optional filters:

| Filter | Description | Applicable Scopes |
|--------|-------------|-------------------|
| Namespace | Kubernetes namespace | Namespace, Workload, Pod |
| Workload Type | deployment, statefulset, daemonset, job, cronjob | Workload |
| Workload Name | Name of the workload | Workload |
| Node Name | Name of the node | Node |
| Pod Name | Name of the pod | Pod |

### Metric Queries

Configure one or more metric queries to evaluate. Each query specifies:

- **Metric name** — The Kubernetes metric to query
- **Aggregation** — How to aggregate metric values
- **Filters** — Additional attribute-based filtering

You can also create **formulas** that combine multiple metric queries using mathematical expressions.

### Rolling Time Window

Select the time window for metric evaluation:

- Past 1 Minute
- Past 5 Minutes
- Past 10 Minutes
- Past 15 Minutes
- Past 30 Minutes
- Past 60 Minutes

## Common Kubernetes Metrics

### Pod Metrics

| Metric | Description |
|--------|-------------|
| Pod CPU Usage | CPU consumption by pods |
| Pod Memory Usage | Memory consumption by pods |
| Pod Filesystem Usage | Disk usage by pods |
| Pod Network Receive/Transmit | Network traffic |
| Pod Phase | Current pod phase (Running, Pending, Failed, etc.) |

### Node Metrics

| Metric | Description |
|--------|-------------|
| Node CPU Usage | CPU utilization per node |
| Node Memory Usage | Memory utilization per node |
| Node Filesystem Usage | Disk usage per node |
| Node Disk I/O | Read/write operations |
| Node Ready Condition | Whether the node is ready |

### Container Metrics

| Metric | Description |
|--------|-------------|
| Container Restarts | Number of container restarts |
| Container CPU/Memory Limits | Resource limits |
| Container CPU/Memory Requests | Resource requests |
| Container Ready Status | Whether containers are ready |

### Workload Metrics

| Metric | Description |
|--------|-------------|
| Deployment Available/Unavailable Replicas | Replica counts |
| DaemonSet Misscheduled Nodes | Scheduling issues |
| StatefulSet Ready Replicas | Ready replica count |
| Job Active/Failed/Succeeded Pods | Job status |

## Monitoring Criteria

### Available Check Types

| Check Type | Description |
|------------|-------------|
| Metric Value | The value of the configured metric query or formula |

### Aggregation Types

| Aggregation | Description |
|-------------|-------------|
| Average | Average value over the time window |
| Sum | Sum of all values |
| Maximum Value | Highest value in the time window |
| Minimum Value | Lowest value in the time window |
| All Values | All values must match the criteria |
| Any Value | At least one value must match |

### Filter Types

- **Greater Than**, **Less Than**, **Greater Than or Equal To**, **Less Than or Equal To**, **Equal To**, **Not Equal To**

## Pre-built Alert Templates

OneUptime provides templates for common Kubernetes monitoring scenarios:

| Template | Description | Threshold |
|----------|-------------|-----------|
| CrashLoopBackOff Detection | Container restart count | > 5 restarts |
| Pod Stuck in Pending | Pods in Pending phase | > 0 pods |
| Node Not Ready | Node readiness condition | = 0 (not ready) |
| High Node CPU | Node CPU utilization | > 90% |
| High Node Memory | Node memory utilization | > 85% |
| Deployment Replica Mismatch | Unavailable replicas | > 0 replicas |
| Job Failures | Failed pods in a job | > 0 failures |
| etcd No Leader | etcd cluster leader missing | = 0 (no leader) |
| API Server Throttling | Dropped API requests | > 0 requests |
| Scheduler Backlog | Pending pods in scheduler | > 0 pods |
| High Node Disk Usage | Node filesystem usage | > 90% |
| DaemonSet Unavailable | Misscheduled nodes | > 0 nodes |

## Setup Requirements

To use Kubernetes monitoring, you need to:

1. Install the OneUptime OpenTelemetry collector in your Kubernetes cluster
2. Configure the collector to send metrics to your OneUptime instance
3. Ensure the collector has appropriate RBAC permissions to read cluster metrics

See the [OpenTelemetry](/docs/telemetry/open-telemetry) documentation for setup instructions.
