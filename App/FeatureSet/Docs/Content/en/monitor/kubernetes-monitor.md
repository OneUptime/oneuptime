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

| Scope     | Description                                                            |
| --------- | ---------------------------------------------------------------------- |
| Cluster   | Monitor the entire cluster                                             |
| Namespace | Monitor resources within a specific namespace                          |
| Workload  | Monitor a specific deployment, statefulset, daemonset, job, or cronjob |
| Node      | Monitor a specific cluster node                                        |
| Pod       | Monitor a specific pod                                                 |

### Resource Filters

Narrow the scope with optional filters:

| Filter        | Description                                      | Applicable Scopes        |
| ------------- | ------------------------------------------------ | ------------------------ |
| Namespace     | Kubernetes namespace                             | Namespace, Workload, Pod |
| Workload Type | deployment, statefulset, daemonset, job, cronjob | Workload                 |
| Workload Name | Name of the workload                             | Workload                 |
| Node Name     | Name of the node                                 | Node                     |
| Pod Name      | Name of the pod                                  | Pod                      |

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

| Metric                       | Description                                        |
| ---------------------------- | -------------------------------------------------- |
| Pod CPU Usage                | CPU consumption by pods                            |
| Pod Memory Usage             | Memory consumption by pods                         |
| Pod Filesystem Usage         | Disk usage by pods                                 |
| Pod Network Receive/Transmit | Network traffic                                    |
| Pod Phase                    | Current pod phase (Running, Pending, Failed, etc.) |

### Node Metrics

| Metric                | Description                 |
| --------------------- | --------------------------- |
| Node CPU Usage        | CPU utilization per node    |
| Node Memory Usage     | Memory utilization per node |
| Node Filesystem Usage | Disk usage per node         |
| Node Disk I/O         | Read/write operations       |
| Node Ready Condition  | Whether the node is ready   |

### Container Metrics

| Metric                        | Description                  |
| ----------------------------- | ---------------------------- |
| Container Restarts            | Number of container restarts |
| Container CPU/Memory Limits   | Resource limits              |
| Container CPU/Memory Requests | Resource requests            |
| Container Ready Status        | Whether containers are ready |

### Workload Metrics

| Metric                                    | Description         |
| ----------------------------------------- | ------------------- |
| Deployment Available/Unavailable Replicas | Replica counts      |
| DaemonSet Misscheduled Nodes              | Scheduling issues   |
| StatefulSet Ready Replicas                | Ready replica count |
| Job Active/Failed/Succeeded Pods          | Job status          |

## Monitoring Criteria

### What Gets Evaluated

These monitors always evaluate the **Metric Value** — the value of the configured metric query or formula. The criteria form has no Filter Type selector; it shows **Metric**, **Aggregation**, **Condition**, and **Threshold**.

### Aggregation Types

| Aggregation   | Description                        |
| ------------- | ---------------------------------- |
| Average       | Average value over the time window |
| Sum           | Sum of all values                  |
| Maximum Value | Highest value in the time window   |
| Minimum Value | Lowest value in the time window    |
| All Values    | All values must match the criteria |
| Any Value     | At least one value must match      |

### Conditions

- **Greater Than**, **Less Than**, **Greater Than or Equal To**, **Less Than or Equal To**, **Equal To**, **Not Equal To**

## Pre-built Alert Templates

OneUptime provides templates for common Kubernetes monitoring scenarios:

| Template                            | Description                                | Threshold       |
| ----------------------------------- | ------------------------------------------ | --------------- |
| CrashLoopBackOff Detection          | Container restart count                    | > 5 restarts    |
| Pod Stuck in Pending                | Pods in Pending phase                      | > 0 pods        |
| Node Not Ready                      | Node readiness condition                   | = 0 (not ready) |
| High Node CPU                       | Node CPU utilization                       | > 90%           |
| High Node Memory                    | Node memory utilization                    | > 85%           |
| Deployment Replica Mismatch         | Unavailable replicas                       | > 0 replicas    |
| Job Failures                        | Failed pods in a job                       | > 0 failures    |
| etcd No Leader                      | etcd cluster leader missing                | = 0 (no leader) |
| API Server Throttling               | Dropped API requests                       | > 0 requests    |
| Scheduler Backlog                   | Pending pods in scheduler                  | > 0 pods        |
| High Node Disk Usage                | Node filesystem usage                      | > 90%           |
| DaemonSet Unavailable               | Misscheduled nodes                         | > 0 nodes       |
| High Node CPU Request Commitment    | Summed pod CPU requests ÷ node allocatable | > 90%           |
| High Node Memory Request Commitment | Summed pod memory requests ÷ allocatable   | > 90%           |
| HPA Saturated at Max Replicas       | HPA current ÷ max replicas                 | >= 90%          |
| Pod Memory Saturating Limit         | Pod memory usage ÷ container memory limit  | > 90%           |
| Pod CPU Saturating Limit            | Pod CPU usage ÷ container CPU limit        | > 90%           |

### Catching causes, not just symptoms

The node-level templates (High Node CPU/Memory, Node Not Ready, Pod Stuck in Pending) fire at the _end_ of a resource-exhaustion chain, when the cluster is already degraded. The last three templates in the table fire at the _start_ of it, which is usually where the fix is:

- **Pod Memory / CPU Saturating Limit** catch a workload pinned against its own container limits. Crossing a memory limit is an immediate OOMKill; crossing a CPU limit means the kernel throttles the pod, so it gets slower without ever erroring. Both are the usual cause behind CrashLoopBackOff and unexplained latency.
- **HPA Saturated at Max Replicas** catches an autoscaler with no headroom left. A workload whose per-pod limits are too low gets throttled or killed, which inflates the very metric the HPA scales on — so the autoscaler keeps adding replicas that are each equally starved, until it hits its ceiling or fills the cluster. Raising the limits is the fix; raising `maxReplicas` makes it worse.

Enable them together on any namespace running an autoscaled workload — the combination distinguishes "genuinely needs more capacity" from "under-resourced per pod".

> **Note on multi-container pods:** the two pod-limit templates compare a pod-level usage metric against a container-level limit metric. For single-container pods (the common case) the ratio is exact. For multi-container pods the denominator is the mean container limit rather than their sum, so the ratio over-reports and the alert fires early — the safe direction for an OOMKill warning, but worth knowing before you tune the threshold down.

## Setup Requirements

To use Kubernetes monitoring, you need to install the OneUptime Kubernetes agent in your cluster. The agent ships cluster metrics, events, pod logs, and — by default — **application traces and HTTP RED metrics captured via eBPF** to OneUptime over OTLP. No code changes or per-app SDKs are required to see service-level traffic.

See the [Install the Kubernetes Agent](/docs/monitor/kubernetes-agent) guide — it covers the one-command Helm install, the `preset` option for picking the right configuration for your cluster (standard, GKE Autopilot, EKS Fargate), and the `ebpf.features.*` toggles for the individual signal families (HTTP RED metrics, service graph, network flows, TCP stats).
