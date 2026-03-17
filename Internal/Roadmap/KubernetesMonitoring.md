# Plan: Kubernetes Monitoring for OneUptime

## Context

OneUptime has foundational infrastructure for Kubernetes monitoring: OTLP ingestion (HTTP and gRPC), ClickHouse metric/log/trace storage, telemetry-based monitors (Metrics, Logs, Traces), and a Helm chart for deploying OneUptime itself on Kubernetes. A `Kubernetes` monitor type exists in the `MonitorType` enum but is currently disabled and has no implementation. The OpenTelemetry Collector config supports OTLP receivers but has no Kubernetes-specific receivers (kubelet, kube-state-metrics, Prometheus). Server monitoring exists but is limited to basic VM-level checks.

This plan proposes a phased implementation to deliver first-class Kubernetes monitoring — from cluster health and workload observability to intelligent alerting — leveraging OneUptime's all-in-one observability platform (metrics, logs, traces, incidents, status pages).

## Completed

- **OTLP Metric Ingestion** - HTTP and gRPC metric ingestion with async queue-based batch processing
- **ClickHouse Metric Storage** - MergeTree with partitioning, per-service TTL
- **Telemetry-Based Monitors** - Metric, Log, Trace, and Exception monitors with configurable criteria
- **Helm Chart** - OneUptime deploys on Kubernetes with KEDA auto-scaling support
- **OpenTelemetry Collector** - Deployed via Helm, accepts OTLP on ports 4317/4318
- **MonitorType.Kubernetes** - Enum value defined (but disabled and unimplemented)

## Gap Analysis Summary

| Feature | OneUptime | DataDog | New Relic | Grafana/Prometheus | Priority |
|---------|-----------|---------|-----------|-------------------|----------|
| K8s metric collection (kubelet, kube-state-metrics) | None | Agent auto-discovery | K8s integration | Prometheus + kube-state-metrics | **P0** |
| Cluster overview dashboard | None | Out-of-box | Pre-built | Pre-built via mixins | **P0** |
| Pod/Container resource metrics | None | Live Containers | K8s cluster explorer | cAdvisor + Grafana | **P0** |
| Node health monitoring | None | Host Map + agent | Infrastructure UI | node-exporter + Grafana | **P0** |
| Kubernetes event ingestion | None | Auto-collected | K8s events integration | Eventrouter/Exporter | **P0** |
| Workload health alerts (CrashLoopBackOff, OOMKilled, etc.) | None | Auto-monitors | Pre-built alerts | PrometheusRule CRDs | **P1** |
| Namespace/workload cost attribution | None | Container cost allocation | None | Kubecost integration | **P1** |
| K8s resource inventory (deployments, services, ingresses) | None | Orchestrator Explorer | Cluster explorer | None native | **P1** |
| HPA/VPA monitoring | None | Yes | Partial | Prometheus metrics | **P1** |
| Multi-cluster support | None | Yes | Yes | Thanos/Cortex | **P2** |
| K8s log collection (pod stdout/stderr) | Via Fluentd example | DaemonSet agent | Fluent Bit integration | Loki + Promtail | **P2** |
| Service mesh observability (Istio, Linkerd) | None | Yes | Yes | Partial | **P2** |
| Control plane monitoring (etcd, API server, scheduler, controller-manager) | None | Yes (Agent check) | K8s integration | Prometheus scrape + mixins | **P0** |
| Network policy monitoring | None | NPM | None | Cilium Hubble | **P3** |
| eBPF-based deep observability | None | Universal Service Monitoring | Pixie | Cilium/Tetragon | **P3** |

---

## Phase 1: Foundation (P0) — Kubernetes Metric Collection & Visibility

Without these, OneUptime cannot monitor any Kubernetes cluster. This phase makes K8s metrics flow into the platform and provides basic visibility.

### 1.1 OpenTelemetry Collector Kubernetes Receivers

**Current**: OTel Collector only has OTLP receivers. No Kubernetes-specific metric collection.
**Target**: Pre-configured OTel Collector with receivers for kubelet, kube-state-metrics, and Kubernetes events.

**Implementation**:

- Add `kubeletstats` receiver to the OTel Collector config for node and pod resource metrics:
  - CPU, memory, filesystem, network per node and per pod/container
  - Collection interval: 30s
  - Auth via serviceAccount token
- Add `k8s_cluster` receiver for cluster-level metrics from the Kubernetes API:
  - Deployment, ReplicaSet, StatefulSet, DaemonSet replica counts and status
  - Pod phase, container states (waiting/running/terminated with reasons)
  - Node conditions (Ready, MemoryPressure, DiskPressure, PIDPressure)
  - Namespace resource quotas and limit ranges
  - HPA current/desired replicas
- Add `k8sobjects` receiver for Kubernetes events:
  - Watch Events API for Warning and Normal events
  - Ingest as logs with structured attributes (reason, involvedObject, message)
- Add `k8s_events` receiver as alternative lightweight event collection
- Configure `k8sattributes` processor to enrich all telemetry with K8s metadata:
  - Pod name, namespace, node, deployment, replicaset, labels, annotations
- Provide Helm values to enable/disable K8s monitoring and configure which namespaces to monitor

**Files to modify**:
- `OTelCollector/otel-collector-config.template.yaml` (add kubeletstats, k8s_cluster, k8sobjects receivers and k8sattributes processor)
- `HelmChart/Public/oneuptime/templates/otel-collector.yaml` (restore and configure OTel Collector deployment with proper RBAC)
- `HelmChart/Public/oneuptime/templates/otel-collector-rbac.yaml` (new - ClusterRole, ClusterRoleBinding, ServiceAccount for K8s API access)
- `HelmChart/Public/oneuptime/values.yaml` (add kubernetesMonitoring config section)

### 1.2 Kubernetes Cluster Overview Dashboard Template

**Current**: No pre-built Kubernetes dashboards.
**Target**: Auto-generated cluster overview dashboard showing key health indicators.

**Implementation**:

- Create a dashboard template with the following panels:
  - **Cluster Summary**: Total nodes, pods (running/pending/failed), namespaces, deployments
  - **Node Health**: CPU and memory utilization per node, node conditions
  - **Pod Status**: Pod phase distribution (Running/Pending/Succeeded/Failed/Unknown)
  - **Resource Utilization**: Cluster-wide CPU and memory usage vs capacity (requests, limits, actual)
  - **Top Consumers**: Top 10 pods by CPU usage, top 10 by memory usage
  - **Recent Events**: Kubernetes Warning events stream
  - **Container Restarts**: Pods with highest restart counts
  - **Control Plane Health**: etcd leader status, API server request rate/error rate, scheduler pending pods
  - **etcd**: DB size gauge, WAL fsync latency, peer RTT
- Auto-detect K8s metrics and offer dashboard creation during onboarding
- Use template variables for namespace and node filtering

**Files to modify**:
- `Common/Types/Dashboard/Templates/KubernetesCluster.ts` (new - cluster overview template)
- `Common/Types/Dashboard/Templates/KubernetesWorkload.ts` (new - per-namespace workload template)
- `App/FeatureSet/Dashboard/src/Pages/Dashboards/Templates.tsx` (add K8s templates to gallery)

### 1.3 Pod and Container Resource Metrics

**Current**: No container-level visibility.
**Target**: Detailed resource metrics for every pod and container with drill-down.

**Implementation**:

- Ensure the following kubeletstats metrics are ingested and queryable:
  - `k8s.pod.cpu.utilization`, `k8s.pod.memory.usage`, `k8s.pod.memory.rss`
  - `k8s.pod.network.io` (rx/tx bytes), `k8s.pod.filesystem.usage`
  - `container.cpu.utilization`, `container.memory.usage`, `container.restarts`
- Create a "Kubernetes" section in the dashboard navigation:
  - Cluster > Namespace > Workload > Pod > Container drill-down hierarchy
- Pod detail page showing: resource usage over time, container statuses, events, logs (linked), traces (linked)
- Calculate resource efficiency: actual usage vs requests vs limits

**Files to modify**:
- `App/FeatureSet/Dashboard/src/Pages/Kubernetes/` (new directory)
- `App/FeatureSet/Dashboard/src/Pages/Kubernetes/ClusterOverview.tsx` (new)
- `App/FeatureSet/Dashboard/src/Pages/Kubernetes/Namespaces.tsx` (new)
- `App/FeatureSet/Dashboard/src/Pages/Kubernetes/Pods.tsx` (new)
- `App/FeatureSet/Dashboard/src/Pages/Kubernetes/PodDetail.tsx` (new)

### 1.4 Node Health Monitoring

**Current**: No node-level metrics.
**Target**: Per-node resource utilization, conditions, and capacity tracking.

**Implementation**:

- Ingest node metrics via kubeletstats receiver:
  - `k8s.node.cpu.utilization`, `k8s.node.memory.usage`, `k8s.node.memory.available`
  - `k8s.node.filesystem.usage`, `k8s.node.filesystem.capacity`
  - `k8s.node.network.io`, `k8s.node.condition` (Ready, MemoryPressure, etc.)
- Node list page: table with all nodes showing CPU%, memory%, disk%, conditions, pod count
- Node detail page: time-series charts for resource usage, pod list on node, events
- Node capacity planning: show allocatable vs requested vs used per node

**Files to modify**:
- `App/FeatureSet/Dashboard/src/Pages/Kubernetes/Nodes.tsx` (new)
- `App/FeatureSet/Dashboard/src/Pages/Kubernetes/NodeDetail.tsx` (new)

### 1.5 Kubernetes Event Ingestion

**Current**: No Kubernetes event collection.
**Target**: Ingest and surface Kubernetes events as structured logs with correlation to resources.

**Implementation**:

- Configure `k8sobjects` receiver to watch Kubernetes Events
- Map events to structured log entries:
  - `severity` from event type (Warning -> WARN, Normal -> INFO)
  - `body` from event message
  - Attributes: `k8s.event.reason`, `k8s.event.count`, `k8s.object.kind`, `k8s.object.name`, `k8s.namespace.name`
- Create a dedicated "Kubernetes Events" view:
  - Filterable by namespace, event reason, object kind
  - Timeline visualization showing event frequency
  - Link events to related pods/deployments/nodes
- Alert on specific event patterns (e.g., repeated FailedScheduling, FailedMount)

**Files to modify**:
- `OTelCollector/otel-collector-config.template.yaml` (add k8sobjects receiver)
- `App/FeatureSet/Dashboard/src/Pages/Kubernetes/Events.tsx` (new)

### 1.6 Control Plane Monitoring (etcd, API Server, Scheduler, Controller Manager)

**Current**: No control plane visibility. Cluster-level failures (etcd latency, API server overload, scheduler backlog) are invisible.
**Target**: Full control plane observability covering etcd, kube-apiserver, kube-scheduler, and kube-controller-manager.

**Implementation**:

- Add `prometheus` receiver to OTel Collector to scrape control plane metrics endpoints:
  - **etcd** (typically `:2379/metrics`):
    - `etcd_server_has_leader` — alert immediately if 0 (no leader elected)
    - `etcd_server_leader_changes_seen_total` — rate of leader elections (frequent changes indicate instability)
    - `etcd_disk_wal_fsync_duration_seconds` — WAL fsync latency (high values cause write stalls)
    - `etcd_disk_backend_commit_duration_seconds` — backend commit latency
    - `etcd_mvcc_db_total_size_in_bytes` — database size (alert when approaching quota, default 2GB)
    - `etcd_network_peer_round_trip_time_seconds` — peer-to-peer RTT (network health between etcd members)
    - `etcd_server_proposals_failed_total` — failed Raft proposals
    - `etcd_server_proposals_pending` — pending proposals (backpressure indicator)
    - `etcd_debugging_mvcc_keys_total` — total key count (cardinality tracking)
    - `etcd_mvcc_db_total_size_in_use_in_bytes` — actual data size vs total DB size (fragmentation indicator)
    - `grpc_server_handled_total` — gRPC request rate and error rate to etcd
  - **kube-apiserver** (typically `:6443/metrics`):
    - `apiserver_request_total` — request rate by verb, resource, and response code
    - `apiserver_request_duration_seconds` — request latency by verb and resource
    - `apiserver_current_inflight_requests` — concurrent in-flight requests (throttling indicator)
    - `apiserver_dropped_requests_total` — dropped requests due to throttling
    - `apiserver_storage_objects` — object count per resource type in etcd
    - `apiserver_admission_webhook_rejection_count` — webhook rejections
    - `workqueue_depth` — controller work queue depth (backlog indicator)
    - `workqueue_adds_total` — work queue processing rate
  - **kube-scheduler** (typically `:10259/metrics`):
    - `scheduler_pending_pods` — pods waiting to be scheduled (by queue)
    - `scheduler_scheduling_attempt_duration_seconds` — scheduling latency
    - `scheduler_schedule_attempts_total` — scheduling attempts by result (scheduled/unschedulable/error)
    - `scheduler_preemption_attempts_total` — preemption frequency
  - **kube-controller-manager** (typically `:10257/metrics`):
    - `workqueue_depth` — per-controller queue depth
    - `workqueue_retries_total` — retry rate (indicator of failing reconciliation)
    - `node_collector_evictions_total` — node eviction count
- Handle access modes for different cluster types:
  - Self-managed clusters: direct scrape with TLS client certs
  - Managed clusters (EKS/GKE/AKS): use kube-proxy or metrics-server where control plane metrics are exposed; document limitations per provider
  - Helm values for toggling control plane monitoring and configuring endpoints
- Create etcd-specific alert templates:
  - **No Leader**: `etcd_server_has_leader == 0` — critical, immediate page
  - **Frequent Leader Elections**: rate of `etcd_server_leader_changes_seen_total` > 3/hour — warning
  - **High WAL Fsync Latency**: `etcd_disk_wal_fsync_duration_seconds` p99 > 100ms — warning; > 500ms — critical
  - **DB Size Near Quota**: `etcd_mvcc_db_total_size_in_bytes` > 80% of quota — warning; > 90% — critical
  - **High Proposal Failure Rate**: `etcd_server_proposals_failed_total` rate > 0 sustained — warning
  - **Peer RTT Degradation**: `etcd_network_peer_round_trip_time_seconds` p99 > 100ms — warning
  - **API Server Throttling**: `apiserver_dropped_requests_total` rate > 0 — critical
  - **API Server Latency**: `apiserver_request_duration_seconds` p99 > 1s for non-WATCH verbs — warning
  - **Scheduler Backlog**: `scheduler_pending_pods` > 0 for > 5 minutes — warning
- Control Plane dashboard template with panels:
  - etcd: leader status, DB size gauge, WAL/commit latency, peer RTT, key count, proposal rates
  - API Server: request rate by verb, error rate, latency heatmap, inflight requests, throttling events
  - Scheduler: pending pods, scheduling latency, attempt success/failure rates
  - Controller Manager: per-controller queue depth, retry rates, eviction counts

**Files to modify**:
- `OTelCollector/otel-collector-config.template.yaml` (add prometheus receiver with control plane scrape targets)
- `HelmChart/Public/oneuptime/values.yaml` (add controlPlaneMonitoring config with endpoint overrides and TLS settings)
- `HelmChart/Public/oneuptime/templates/otel-collector-rbac.yaml` (ensure access to control plane metrics endpoints)
- `Common/Types/Dashboard/Templates/KubernetesControlPlane.ts` (new - control plane dashboard template)
- `Common/Types/Monitor/Templates/KubernetesAlertTemplates.ts` (add etcd and control plane alert templates)

---

## Phase 2: Intelligent Alerting & Workload Health (P1) — Actionable Monitoring

### 2.1 Kubernetes-Aware Alert Templates

**Current**: Generic metric threshold alerts only. Users must manually configure alerts for K8s failure modes.
**Target**: Pre-built alert templates for common Kubernetes failure patterns.

**Implementation**:

- Create alert templates for critical K8s conditions:
  - **CrashLoopBackOff**: Alert when `k8s.container.restarts` increases rapidly (> N restarts in M minutes)
  - **OOMKilled**: Alert on container termination reason = OOMKilled
  - **Pod Pending**: Alert when pods remain in Pending phase for > N minutes
  - **Node NotReady**: Alert when node condition transitions to NotReady
  - **High Resource Utilization**: Alert when node CPU > 90% or memory > 85% sustained
  - **Deployment Replica Mismatch**: Alert when available replicas < desired replicas for > N minutes
  - **PVC Disk Full**: Alert when PV usage > 90% capacity
  - **Failed Scheduling**: Alert on repeated FailedScheduling events
  - **Image Pull Failures**: Alert on ErrImagePull/ImagePullBackOff events
  - **Job/CronJob Failures**: Alert when job completion fails
- One-click enable for each alert template during K8s monitoring setup
- Auto-route alerts to the OneUptime incident management system

**Files to modify**:
- `Common/Types/Monitor/Templates/KubernetesAlertTemplates.ts` (new)
- `App/FeatureSet/Dashboard/src/Pages/Kubernetes/AlertSetup.tsx` (new - guided alert configuration)
- `Worker/Jobs/TelemetryMonitor/MonitorTelemetryMonitor.ts` (support K8s-specific criteria evaluation)

### 2.2 Kubernetes Resource Inventory

**Current**: No visibility into K8s resource state.
**Target**: Live inventory of Kubernetes resources with health status.

**Implementation**:

- Create a `KubernetesResource` model stored in ClickHouse (or PostgreSQL depending on query patterns):
  - Kind, name, namespace, labels, annotations, status, conditions, timestamps
  - Updated via the `k8s_cluster` receiver or periodic API sync
- Resource pages:
  - **Deployments**: List with replica status (ready/desired), last update, strategy
  - **StatefulSets**: Ordered pod status, PVC bindings
  - **DaemonSets**: Node coverage, desired vs current vs ready
  - **Services**: Type (ClusterIP/NodePort/LoadBalancer), endpoints, selector
  - **Ingresses**: Host rules, backend services, TLS status
  - **ConfigMaps/Secrets**: List with last-modified (secrets show metadata only, never values)
  - **PVCs**: Bound PV, capacity, access modes, storage class
- Drill-down from any resource to its associated pods, events, and telemetry

**Files to modify**:
- `Common/Models/AnalyticsModels/KubernetesResource.ts` (new)
- `Telemetry/Services/KubernetesResourceService.ts` (new - sync K8s resources)
- `App/FeatureSet/Dashboard/src/Pages/Kubernetes/Resources/` (new - pages for each resource kind)

### 2.3 HPA and VPA Monitoring

**Current**: No autoscaler visibility.
**Target**: Track HPA/VPA behavior and scaling events.

**Implementation**:

- Ingest HPA metrics from `k8s_cluster` receiver:
  - `k8s.hpa.current_replicas`, `k8s.hpa.desired_replicas`, `k8s.hpa.min_replicas`, `k8s.hpa.max_replicas`
  - Target metric values vs actual
- HPA overview page:
  - List all HPAs with current/desired/min/max replicas
  - Time-series chart showing scaling events overlaid with the target metric
  - Alert when HPA is at max replicas sustained (capacity ceiling)
  - Alert when scale-up frequency is abnormally high (thrashing)

**Files to modify**:
- `App/FeatureSet/Dashboard/src/Pages/Kubernetes/Autoscaling.tsx` (new)

### 2.4 Namespace Resource Quota Monitoring

**Current**: No quota tracking.
**Target**: Track resource quota usage per namespace and alert on approaching limits.

**Implementation**:

- Ingest quota metrics from `k8s_cluster` receiver:
  - `k8s.resource_quota.hard.cpu`, `k8s.resource_quota.used.cpu`
  - `k8s.resource_quota.hard.memory`, `k8s.resource_quota.used.memory`
  - `k8s.resource_quota.hard.pods`, `k8s.resource_quota.used.pods`
- Namespace detail page showing quota utilization gauges
- Alert when any quota usage exceeds 80% (configurable threshold)

**Files to modify**:
- `App/FeatureSet/Dashboard/src/Pages/Kubernetes/NamespaceDetail.tsx` (new)

---

## Phase 3: Advanced Observability (P2) — Correlation & Deep Visibility

### 3.1 Kubernetes Log Collection

**Current**: Users can manually configure Fluentd to send logs. No built-in K8s log collection.
**Target**: Automated pod log collection via OTel Collector with K8s metadata enrichment.

**Implementation**:

- Add `filelog` receiver to OTel Collector for collecting container logs from `/var/log/pods/`:
  - Parse container runtime log format (Docker JSON, CRI)
  - Extract pod name, namespace, container name from file path
  - Enrich with K8s metadata via `k8sattributes` processor
- Deploy OTel Collector as a DaemonSet (in addition to existing Deployment) for log collection
- Helm values to configure:
  - Namespace inclusion/exclusion filters
  - Log level filtering (e.g., only collect WARN and above)
  - Container name exclusion patterns
- Link pod logs in the Kubernetes pod detail page

**Files to modify**:
- `HelmChart/Public/oneuptime/templates/otel-collector-daemonset.yaml` (new - DaemonSet for log collection)
- `OTelCollector/otel-collector-daemonset-config.template.yaml` (new - DaemonSet-specific config with filelog receiver)
- `HelmChart/Public/oneuptime/values.yaml` (add DaemonSet configuration options)

### 3.2 Multi-Cluster Support

**Current**: Single-cluster assumption.
**Target**: Monitor multiple Kubernetes clusters from a single OneUptime project.

**Implementation**:

- Add `cluster` attribute to all K8s metrics via OTel Collector resource processor
- Cluster registration: each cluster gets a unique name and OneUptime API key
- Helm install per cluster with cluster-specific configuration
- Cluster selector in the K8s monitoring UI (template variable)
- Cross-cluster comparison views (e.g., resource utilization across clusters)
- Unified alerting: same alert rules applied across all clusters or cluster-specific

**Files to modify**:
- `OTelCollector/otel-collector-config.template.yaml` (add resource processor with cluster name)
- `HelmChart/Public/oneuptime/values.yaml` (add clusterName config)
- `App/FeatureSet/Dashboard/src/Pages/Kubernetes/Clusters.tsx` (new - multi-cluster view)

### 3.3 Service Mesh Observability

**Current**: No service mesh integration.
**Target**: Ingest and visualize service mesh metrics from Istio, Linkerd, or similar.

**Implementation**:

- Add Prometheus receiver to OTel Collector for scraping service mesh metrics:
  - Istio: `istio_requests_total`, `istio_request_duration_milliseconds`, `istio_tcp_connections_opened_total`
  - Linkerd: `request_total`, `response_latency_ms`
- Service-to-service traffic map from mesh metrics
- mTLS status visibility
- Circuit breaker and retry metrics
- Dashboard templates for Istio and Linkerd

**Files to modify**:
- `OTelCollector/otel-collector-config.template.yaml` (add prometheus receiver for mesh metrics)
- `Common/Types/Dashboard/Templates/ServiceMesh.ts` (new - mesh dashboard templates)

### 3.4 Kubernetes-to-Telemetry Correlation

**Current**: K8s resources and telemetry (metrics, logs, traces) are separate.
**Target**: Click on any K8s resource to see correlated telemetry.

**Implementation**:

- From any pod/deployment/service page, show:
  - **Metrics**: CPU, memory, network filtered to that resource
  - **Logs**: Logs from containers in that pod, filtered by K8s metadata attributes
  - **Traces**: Traces originating from or passing through that service
  - **Events**: Kubernetes events for that resource
- Use `k8sattributes` processor enrichment to correlate:
  - `k8s.pod.name`, `k8s.namespace.name`, `k8s.deployment.name` across all signals
- Deep link from incident timeline to K8s resource view

**Files to modify**:
- `App/FeatureSet/Dashboard/src/Pages/Kubernetes/PodDetail.tsx` (add telemetry correlation tabs)
- `App/FeatureSet/Dashboard/src/Components/Kubernetes/ResourceTelemetryPanel.tsx` (new - reusable correlation panel)

---

## Phase 4: Intelligence & Differentiation (P3) — Long-Term

### 4.1 Kubernetes Cost Attribution

- Track CPU and memory usage per namespace, workload, and label
- Calculate cost based on node instance pricing (configurable per cluster)
- Show cost trends over time, cost per team/project (via labels)
- Identify idle resources (requested but unused capacity)
- Recommendations: right-size requests/limits based on actual usage

### 4.2 Network Policy Monitoring

- Visualize network policies and their effect on pod communication
- Alert on denied network connections
- Integration with Cilium Hubble or Calico for deep network visibility
- Service dependency map derived from actual network traffic

### 4.3 eBPF-Based Deep Observability

- Kernel-level visibility without application instrumentation
- Automatic service discovery and dependency mapping
- DNS monitoring and latency
- TCP connection tracking and retransmit analysis
- Integration with tools like Tetragon, Pixie, or custom eBPF probes

### 4.4 Kubernetes Compliance and Security Monitoring

- Pod security standards compliance tracking
- RBAC audit logging and visualization
- Image vulnerability scanning status
- Network policy coverage analysis
- CIS Kubernetes Benchmark compliance scoring

### 4.5 GitOps Integration

- Track ArgoCD/Flux deployments as annotations on metric charts
- Correlate deployment events with performance changes
- Show deployment history per workload with rollback status
- Alert when deployment sync fails or drift is detected

### 4.6 Auto-Discovery and Zero-Config Onboarding

**Current**: K8s monitoring requires manual Helm config and receiver setup.
**Target**: Automatic workload, service, and dependency detection with zero manual configuration.

- Auto-detect all running workloads, services, and dependencies upon agent installation
- Automatically create monitors and dashboards for discovered services
- Suggest relevant alert templates based on discovered workload types (e.g., StatefulSet → PVC alerts)
- No manual namespace or receiver configuration required — monitor everything by default, allow exclusions
- This is Dynatrace's primary differentiator (OneAgent auto-discovers thousands of pods with no config)

### 4.7 AI/ML-Driven Root Cause Analysis

**Current**: No automated root cause analysis. Users must manually investigate K8s failures.
**Target**: Automatically correlate K8s events, metrics, and logs to pinpoint root causes of failures.

- When an alert fires (e.g., pod CrashLoopBackOff), automatically:
  - Gather correlated K8s events (OOMKilled, FailedMount, ImagePullBackOff, etc.)
  - Check recent deployment changes that may have caused the regression
  - Analyze resource utilization trends leading up to the failure
  - Check node health and scheduling constraints
- Surface a ranked list of probable root causes with supporting evidence
- Competitors: Dynatrace Davis AI (automatic root cause), Datadog Watchdog (anomaly detection)

### 4.8 Kubernetes-Native Incident Automation

**Current**: K8s monitoring and incident management exist but are not deeply integrated.
**Target**: End-to-end automation from K8s failure detection to incident resolution — leveraging OneUptime's unique all-in-one platform.

- Auto-create incidents from K8s failures with full context:
  - Pod/node/deployment details, relevant events, logs, and metrics pre-attached
  - Suggested root cause and remediation steps
  - Automatic status page component mapping (e.g., a failed deployment auto-degrades the associated status page component)
- Auto-resolve incidents when K8s state recovers (e.g., pod returns to Running, replicas match desired)
- On-call notification with K8s-specific context (not just "metric threshold exceeded" but "Pod X in namespace Y is CrashLoopBackOff due to OOMKilled")
- This is OneUptime's unique moat — no pure observability tool offers monitoring + incidents + status pages + on-call in one flow

### 4.9 Kubernetes-Aware Status Pages

**Current**: Status pages are manually configured. No automatic reflection of K8s cluster health.
**Target**: Automatically map K8s services/workloads to status page components and reflect real-time health.

- Map K8s namespaces, deployments, or services to status page components
- Automatically update component status based on K8s health (e.g., if >50% of pods in a deployment are unhealthy, degrade the component)
- Show K8s-sourced incident details on the public status page
- No competitor offers this — this is a unique differentiator for OneUptime

### 4.10 Live YAML / Resource Inspection

**Current**: No ability to view actual K8s resource specs from within OneUptime.
**Target**: View live YAML definitions for any K8s object alongside its metrics and events.

- Fetch and display the current YAML spec for any K8s resource (Deployments, Services, Ingresses, ConfigMaps, PVCs, NetworkPolicies, CRDs)
- Diff view showing recent spec changes
- Correlate spec changes with metric anomalies
- Dynatrace shipped this in Jan 2026 — increasingly a buyer expectation

### 4.11 Topology / Service Dependency Map

**Current**: No visual service-to-service dependency mapping.
**Target**: Auto-generated service dependency map derived from K8s metadata and network traffic.

- Build dependency graph from K8s Service selectors, Ingress rules, and network traffic patterns
- Visual map showing services, request flow, latency, and error rates between services
- Click any edge to see request metrics between two services
- Highlight unhealthy edges and propagation paths
- Competitors: Datadog Service Map, Dynatrace Smartscape topology

### 4.12 Managed Kubernetes Provider Integrations

**Current**: Generic K8s monitoring only. No provider-specific integrations.
**Target**: Dedicated integrations for EKS, GKE, and AKS with provider-specific metrics and features.

- **EKS**: CloudWatch integration for control plane logs, EKS-specific IAM/IRSA setup guidance, Fargate pod monitoring
- **GKE**: GKE Autopilot support, Workload Identity configuration, GKE-specific system metrics
- **AKS**: Azure Monitor integration, AKS-specific diagnostics, Azure AD pod identity support
- Per-provider documentation for control plane metric access (which varies significantly)
- Auto-detect provider and suggest appropriate configuration

### 4.13 Deployment Tracking and Change Correlation

**Current**: No deployment event tracking or change correlation.
**Target**: Overlay deployment events on metric charts to answer "did a deploy cause this regression?"

- Capture deployment events (kubectl rollout, Helm release, ArgoCD sync, Flux reconciliation)
- Display as vertical annotations on all metric time-series charts
- Auto-correlate: when a metric anomaly occurs, flag any deployments that happened in the preceding window
- Deployment detail view: show before/after metrics comparison for each deploy
- This is a basic expectation in Datadog and New Relic — should be P1 priority

---

## Competitive Analysis (March 2026)

### Feature Comparison Matrix

| Area | OneUptime (Roadmap) | Datadog | Dynatrace | New Relic | Grafana/Prometheus | Sysdig |
|---|---|---|---|---|---|---|
| Core metrics (pods/nodes/containers) | P0 | Yes | Yes | Yes | Yes | Yes |
| Control plane monitoring | P0 | Yes | Yes | Yes | Yes (kube-prometheus-stack) | Yes |
| K8s events | P0 | Auto-collected | Unified view | OTel-based | Event exporters | Yes |
| Pre-built alert templates | P1 | Auto-monitors | Auto-baselines | Pre-built alerts | PrometheusRule CRDs | Yes |
| Resource inventory | P1 | Orchestrator Explorer | Expanded Jan 2026 (CRDs, NetworkPolicies, PVCs with live YAML) | Cluster explorer | None native | Yes |
| HPA monitoring | P1 | Yes | Yes | Yes (custom metrics adapter) | Via kube-state-metrics | Yes |
| Cost optimization | P3 | Pod-level granularity, autoscaling recs | Cost & Carbon Optimization, idle workload detection | Resource optimization recs | OpenCost integration | Cost Advisor (~40% waste reduction) |
| Multi-cluster | P2 | Fleet Automation | Per-cluster pod-hour billing | Fleet Control GA | Thanos/Mimir/Cortex | CLUSTER_NAME labeling |
| eBPF-based observability | P3 | Network monitoring, file integrity (35% CPU reduction) | eBPF Discovery in OneAgent | eAPM (zero-instrumentation GA) | Cilium/Hubble, Beyla | Core agent eBPF |
| Network monitoring | P3 | Full NPM (Layer 4 eBPF) | Horizontal topology mapping | Via Pixie/eBPF | Cilium/Hubble | Deep traffic analysis |
| Security/compliance | P3 | CSM, Falco integration | Security posture monitoring | RBAC-aware deployment | OPA/Gatekeeper dashboards | Core brand (runtime security) |
| GitOps integration | P3 | Flux/ArgoCD with health metrics | Limited (Operator CRDs) | Agent Control + Fleet Control | GitOps-native by design | Limited |
| Service mesh | P2 | Istio/Envoy with RBAC telemetry | Istio/Envoy via Prometheus | Via OpenTelemetry | Istio dashboards, Cilium | Yes |
| Auto-discovery | Not planned | Automatic workload detection | Zero-config (thousands of pods) | eBPF eAPM auto-discovers all services | Prometheus K8s service discovery | eBPF auto-discovery |
| AI root cause analysis | Not planned | Watchdog anomaly detection | Davis AI (automated RCA) | AI-driven anomaly detection | None native | Anomaly/threat detection |
| Log aggregation | P2 | Unified DaemonSet agent | Fully automated Log Module | OTel-based collection | Loki + Promtail/Alloy | Log forwarding |
| OpenTelemetry native | Yes (core architecture) | OTel Collector ingestion | OTel-native ingestion | OTel-first strategy | OTel Collector recommended | OTel compatible |
| Helm chart deployment | Yes | Operator + Helm | Operator Helm chart | nri-kubernetes Helm | kube-prometheus-stack | Agent Helm chart |
| Custom metrics | Via OTLP | 1000+ integrations | Extensions + custom API | NRQL, metric adapter | PromQL (native strength) | Prometheus-compatible |

### Competitor Differentiators

- **Datadog**: Broadest integration ecosystem (1000+), pod-level cost management, Fleet Automation for multi-cluster, eBPF network monitoring. Highest cost at scale.
- **Dynatrace**: Zero-config auto-discovery, Davis AI root cause analysis, Cost & Carbon Optimization. Jan 2026: expanded K8s object visibility with live YAML inspection.
- **New Relic**: OpenTelemetry-first, eAPM (eBPF zero-instrumentation monitoring GA), Fleet Control GA, Windows node support. Competitive usage-based pricing.
- **Grafana/Prometheus**: Open-source standard (75% K8s adoption), PromQL ecosystem, vendor independence, Cilium/Hubble eBPF partnership, OpenCost. Requires more operational effort.
- **Sysdig**: Security-first (runtime security + monitoring), deep eBPF kernel instrumentation, managed Prometheus with long-term storage, Cost Advisor.

### OneUptime's Unique Advantage

OneUptime is the only platform that combines Kubernetes monitoring + incident management + status pages + on-call in a single product. No pure observability tool offers this end-to-end flow. The roadmap should aggressively leverage this advantage.

---

## Gaps and Recommendations

### Critical Gaps Not Addressed in Original Roadmap

1. **Auto-discovery / zero-config onboarding** — Dynatrace's killer feature. Our plan requires manual Helm config. Should be elevated to P1.
2. **AI/ML-driven root cause analysis** — Dynatrace (Davis AI) and Datadog (Watchdog) do this automatically. No AI component in our roadmap.
3. **Kubernetes-native incident automation** — Our all-in-one platform advantage is not leveraged. K8s failure → auto-incident → status page update → on-call notification should be a headline feature.
4. **Kubernetes-aware status pages** — No competitor has this. Automatically reflecting K8s health on public status pages is a unique differentiator we're not building.
5. **Live YAML / resource inspection** — Dynatrace shipped this Jan 2026. Increasingly a buyer expectation.
6. **Topology / service dependency map** — Datadog and Dynatrace both offer visual service maps. We only mention this briefly under network policy monitoring.
7. **Managed K8s provider integrations** — No EKS/GKE/AKS-specific plans. These providers expose different control plane metrics with unique quirks.
8. **Cost optimization at P3 is too late** — Competitors treat cost optimization as core. It's the easiest way to show ROI to buyers.
9. **Deployment tracking / change correlation** — Basic in Datadog. "Did a deploy cause this?" is a fundamental debugging workflow.
10. **Windows container / node support** — New Relic supports Windows nodes. Niche but relevant for enterprise.

### Strategic Recommendations

1. **Double down on the all-in-one advantage** — K8s failure → auto-incident → status page update → on-call notification, all in one flow. Nobody else does this end-to-end. This should be the #1 marketing differentiator.
2. **Move cost optimization to P1** — It's the easiest way to show ROI to buyers and justify switching from competitors.
3. **Add a basic topology map in P1** — Visual service maps are a top buyer expectation during evaluations.
4. **Add deployment annotations in P1** — Low effort, high value for debugging. Standard in every competitor.
5. **Build K8s-aware status page automation as a headline feature** — This is our moat. No one else has it.
6. **Invest in auto-discovery for P2** — Reduces onboarding friction dramatically. The current manual config approach will lose evaluations against Dynatrace.
7. **Plan AI-driven RCA for P2-P3** — Without this, the product will feel "dumb" compared to Dynatrace Davis AI.

### Overall Assessment

The roadmap achieves **feature parity** on core K8s monitoring by P2. This is necessary but not differentiating — competitors have had years of maturity. To be **significantly better** than competition, OneUptime must aggressively leverage its unique all-in-one platform (monitoring + incidents + status pages + on-call) and build features no pure observability tool can match: automatic incident creation from K8s failures, K8s-aware status pages, and end-to-end remediation workflows.

---

## Quick Wins (Can Ship This Week)

1. **Enable Kubernetes MonitorType** - Uncomment the Kubernetes entry in `getAllMonitorTypeProps()` and wire it to existing telemetry monitors
2. **Add k8sattributes processor** - Enrich all existing OTLP data with K8s metadata for free
3. **Kubernetes dashboard template** - Create a basic cluster health dashboard using standard OTEL K8s metric names
4. **K8s event alerting** - Use existing log monitors to alert on K8s Warning events once event ingestion is configured
5. **Document OTel Collector K8s setup** - Guide for users to configure their own OTel Collector with K8s receivers pointing to OneUptime

---

## Recommended Implementation Order

1. **Quick Wins** - Enable MonitorType, k8sattributes processor, documentation
2. **Phase 1.1** - OTel Collector K8s receivers (prerequisite for everything else)
3. **Phase 1.6** - Control plane monitoring — etcd, API server, scheduler, controller manager (critical for cluster health)
4. **Phase 1.5** - Kubernetes event ingestion (high value, uses existing log infrastructure)
5. **Phase 1.2** - Cluster overview dashboard template (now includes control plane panels)
6. **Phase 1.3** - Pod and container resource metrics pages
7. **Phase 1.4** - Node health monitoring pages
8. **Phase 2.1** - K8s-aware alert templates, including etcd/control plane alerts (makes monitoring actionable)
9. **Phase 2.2** - Resource inventory pages
10. **Phase 2.4** - Namespace quota monitoring
11. **Phase 2.3** - HPA/VPA monitoring
12. **Phase 3.1** - K8s log collection via DaemonSet
13. **Phase 3.4** - K8s-to-telemetry correlation
14. **Phase 3.2** - Multi-cluster support
15. **Phase 3.3** - Service mesh observability
16. **Phase 4.x** - Cost attribution, network policies, eBPF, compliance, GitOps

## Verification

For each feature:
1. Unit tests for new K8s metric query builders, resource models, and alert template logic
2. Integration tests for OTel Collector K8s receivers (use minikube or kind in CI)
3. Manual verification on a test cluster (minikube/kind) with representative workloads
4. Verify K8s metadata enrichment via `k8sattributes` processor across metrics, logs, and traces
5. Check ClickHouse query performance for K8s-specific queries (namespace filtering, resource correlation)
6. Load test with realistic cluster sizes (100+ nodes, 1000+ pods) to validate metric volume handling
7. Verify RBAC permissions are minimal (principle of least privilege for ClusterRole)
8. Test Helm chart upgrades to ensure K8s monitoring can be enabled without disruption
