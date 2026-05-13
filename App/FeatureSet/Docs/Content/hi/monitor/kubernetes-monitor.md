# Kubernetes Monitor

Kubernetes monitoring आपको अपने Kubernetes clusters की health और performance monitor करने की अनुमति देता है, जिसमें nodes, pods, workloads और control plane components शामिल हैं। OneUptime आपके cluster से metrics एकत्र करता है और उन्हें आपके configured criteria के विरुद्ध evaluate करता है।

## Overview

Kubernetes monitors आपके cluster के metrics का उपयोग करके आपके infrastructure में deep visibility प्रदान करते हैं। यह आपको सक्षम बनाता है:

- cluster, namespace, workload, node और pod health monitor करें
- resources में CPU, memory, disk और network usage track करें
- pod crashes, restarts और scheduling failures detect करें
- deployment replica availability monitor करें
- control plane issues (etcd, API server, scheduler) पर alert करें
- resource requests और limits track करें

## Kubernetes Monitor बनाना

1. OneUptime Dashboard में **Monitors** पर जाएं
2. **Create Monitor** पर क्लिक करें
3. monitor type के रूप में **Kubernetes** चुनें
4. monitor करने के लिए cluster और resource scope चुनें
5. resource filters और metric queries configure करें
6. आवश्यकतानुसार monitoring criteria configure करें

## Configuration Options

### Cluster

monitor करने के लिए Kubernetes cluster चुनें। Clusters को OpenTelemetry के माध्यम से OneUptime के साथ integrate किया जाना चाहिए।

### Resource Scope

resources monitor करने के level को चुनें:

| Scope | विवरण |
|-------|-------|
| Cluster | पूरे cluster को monitor करें |
| Namespace | एक specific namespace के भीतर resources monitor करें |
| Workload | एक specific deployment, statefulset, daemonset, job, या cronjob monitor करें |
| Node | एक specific cluster node monitor करें |
| Pod | एक specific pod monitor करें |

### Resource Filters

वैकल्पिक filters के साथ scope narrow करें:

| Filter | विवरण | लागू Scopes |
|--------|-------|------------|
| Namespace | Kubernetes namespace | Namespace, Workload, Pod |
| Workload Type | deployment, statefulset, daemonset, job, cronjob | Workload |
| Workload Name | workload का नाम | Workload |
| Node Name | node का नाम | Node |
| Pod Name | pod का नाम | Pod |

### Metric Queries

evaluate करने के लिए एक या अधिक metric queries configure करें। प्रत्येक query निर्दिष्ट करती है:

- **Metric name** — query करने के लिए Kubernetes metric
- **Aggregation** — metric values को कैसे aggregate करें
- **Filters** — additional attribute-based filtering

आप **formulas** भी बना सकते हैं जो mathematical expressions का उपयोग करके कई metric queries को combine करती हैं।

### Rolling Time Window

metric evaluation के लिए time window चुनें:

- Past 1 Minute
- Past 5 Minutes
- Past 10 Minutes
- Past 15 Minutes
- Past 30 Minutes
- Past 60 Minutes

## सामान्य Kubernetes Metrics

### Pod Metrics

| Metric | विवरण |
|--------|-------|
| Pod CPU Usage | pods द्वारा CPU consumption |
| Pod Memory Usage | pods द्वारा Memory consumption |
| Pod Filesystem Usage | pods द्वारा Disk usage |
| Pod Network Receive/Transmit | Network traffic |
| Pod Phase | वर्तमान pod phase (Running, Pending, Failed, आदि) |

### Node Metrics

| Metric | विवरण |
|--------|-------|
| Node CPU Usage | प्रति node CPU utilization |
| Node Memory Usage | प्रति node Memory utilization |
| Node Filesystem Usage | प्रति node Disk usage |
| Node Disk I/O | Read/write operations |
| Node Ready Condition | node ready है या नहीं |

### Container Metrics

| Metric | विवरण |
|--------|-------|
| Container Restarts | container restarts की संख्या |
| Container CPU/Memory Limits | Resource limits |
| Container CPU/Memory Requests | Resource requests |
| Container Ready Status | containers ready हैं या नहीं |

### Workload Metrics

| Metric | विवरण |
|--------|-------|
| Deployment Available/Unavailable Replicas | Replica counts |
| DaemonSet Misscheduled Nodes | Scheduling issues |
| StatefulSet Ready Replicas | Ready replica count |
| Job Active/Failed/Succeeded Pods | Job status |

## Monitoring Criteria

### उपलब्ध Check Types

| Check Type | विवरण |
|------------|-------|
| Metric Value | configured metric query या formula का value |

### Aggregation Types

| Aggregation | विवरण |
|-------------|-------|
| Average | time window पर average value |
| Sum | सभी values का sum |
| Maximum Value | time window में highest value |
| Minimum Value | time window में lowest value |
| All Values | सभी values criteria से match होनी चाहिए |
| Any Value | कम से कम एक value match होनी चाहिए |

### Filter Types

- **Greater Than**, **Less Than**, **Greater Than or Equal To**, **Less Than or Equal To**, **Equal To**, **Not Equal To**

## Pre-built Alert Templates

OneUptime सामान्य Kubernetes monitoring scenarios के लिए templates प्रदान करता है:

| Template | विवरण | Threshold |
|----------|-------|-----------|
| CrashLoopBackOff Detection | Container restart count | > 5 restarts |
| Pod Stuck in Pending | Pending phase में Pods | > 0 pods |
| Node Not Ready | Node readiness condition | = 0 (not ready) |
| High Node CPU | Node CPU utilization | > 90% |
| High Node Memory | Node memory utilization | > 85% |
| Deployment Replica Mismatch | Unavailable replicas | > 0 replicas |
| Job Failures | एक job में Failed pods | > 0 failures |
| etcd No Leader | etcd cluster leader missing | = 0 (no leader) |
| API Server Throttling | Dropped API requests | > 0 requests |
| Scheduler Backlog | scheduler में Pending pods | > 0 pods |
| High Node Disk Usage | Node filesystem usage | > 90% |
| DaemonSet Unavailable | Misscheduled nodes | > 0 nodes |

## Setup Requirements

Kubernetes monitoring उपयोग करने के लिए, आपको अपने cluster में OneUptime Kubernetes agent install करना होगा। Agent OTLP पर OneUptime को cluster metrics, events और pod logs ship करता है।

[Install the Kubernetes Agent](/docs/monitor/kubernetes-agent) guide देखें — यह one-command Helm install और आपके cluster के लिए सही configuration चुनने के लिए `preset` option cover करता है (standard, GKE Autopilot, EKS Fargate)।
