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
- **Phase 1.1: kubernetes-agent Helm Chart** - Full chart with kubeletstats, k8s_cluster, k8sobjects receivers, DaemonSet for logs, RBAC, configmaps, secret management
- **Phase 1.2: KubernetesCluster Database Model & Auto-Discovery** - Full model with provider detection, otelCollectorStatus, cached counts; auto-discovery via `findOrCreateByClusterIdentifier()`; disconnect detection after 5 min
- **Phase 1.3: Kubernetes Observability Product (Dashboard/Routes)** - Full sidebar navigation, 40+ routes, cluster list with onboarding guide, breadcrumbs
- **Phase 1.4: Cluster Overview Page** - Overview tab with health summary and resource consumption insights
- **Phase 1.5: Pod and Container Resource Metrics** - Pod list page, pod detail page with metrics/logs/events/YAML/containers tabs, container detail pages
- **Phase 1.6: Node Health Monitoring** - Node list page, node detail page with resource utilization
- **Phase 1.7: Kubernetes Event Ingestion** - Events page with timeline, filtering by namespace/reason/kind
- **Phase 1.8: Control Plane Monitoring** - Control plane page, Prometheus receiver config for etcd/apiserver/scheduler/controller-manager
- **Phase 2.3: Kubernetes Resource Inventory** - Full resource pages for Deployments, StatefulSets, DaemonSets, Jobs, CronJobs, Namespaces, Nodes, PVs, PVCs with detail views
- **Phase 2.5: Namespace Resource Quota Monitoring** - Namespace detail page with quota information
- **Phase 3.1: Kubernetes Log Collection** - DaemonSet with filelog receiver in kubernetes-agent Helm chart, logs tab on pod detail pages
- **Phase 3.3: Kubernetes-to-Telemetry Correlation** - Metrics, Logs, Events, YAML, and Containers tabs on all resource detail pages
- **Phase 4.10: Live YAML / Resource Inspection** - YAML tab component showing live resource specs

---

## Product Architecture

### Kubernetes as an Observability Product

Kubernetes is a **standalone product in the Observability section**, peer to Logs, Traces, Metrics, Services, and Exceptions. Users discover and explore their clusters in Observability, then create monitors on top of cluster data in Monitoring.

```
Observability
├── Logs
├── Traces
├── Metrics
├── Services
├── Exceptions
└── Kubernetes              ← NEW standalone product
    ├── Clusters List       ← All clusters in this project
    └── Cluster Detail
        ├── Overview        (health summary, resource usage, node/pod counts)
        ├── Namespaces      (list, quota usage, workload counts)
        ├── Workloads       (Deployments, StatefulSets, DaemonSets, Jobs, CronJobs)
        ├── Pods            (list, phase, restarts, resource usage)
        ├── Nodes           (list, conditions, capacity, utilization)
        ├── Events          (Warning/Normal events timeline)
        └── Control Plane   (etcd, API server, scheduler, controller manager)

Monitoring
├── Monitors
│   └── Create Monitor → Type: Kubernetes
│       └── Select Clusters → Select Resource Scope → Configure Conditions
├── Monitor Groups
```

This follows the same pattern as other observability products: **Observability = view and explore data**, **Monitoring = create alerts and incidents on that data**. Users first onboard a cluster in Observability, then create Kubernetes-type monitors scoped to that cluster.

### Multi-Cluster Support

Multiple clusters are supported per project as a first-class concept. Each cluster is a distinct resource.

**Data Model:**

```
Project (1)
  └── KubernetesCluster (many)
        ├── name: "production-us-east"
        ├── clusterIdentifier: (from k8s.cluster.name OTel resource attribute)
        ├── otelCollectorStatus: connected / disconnected
        ├── lastSeenAt: timestamp
        ├── provider: EKS / GKE / AKS / self-managed / unknown

```

**How it works:**
1. User installs the `oneuptime/kubernetes-agent` Helm chart in each cluster with a unique `clusterName`, their OneUptime URL, and project API key
2. The agent's OTel Collector `resource` processor stamps every metric/log/event with `k8s.cluster.name`
3. The agent's `k8sattributes` processor enriches all telemetry with pod/namespace/deployment metadata
4. OneUptime backend auto-discovers clusters from incoming telemetry (or user registers manually via UI)
5. All dashboards, resource pages, and monitors are scoped per cluster
6. Cross-cluster comparison views available from the Clusters List page

Multi-cluster is table stakes — most production environments have 2+ clusters (prod/staging/dev, or regional). Datadog, Grafana Cloud, and New Relic all support it.

### OTel Collector vs Custom Agent

The OpenTelemetry Collector handles **~80% of Kubernetes data collection** with zero custom agent code. The remaining 20% is backend intelligence built on top of the data OTel delivers. Do not dsign the custom agent.

**What OTel Collector handles (no custom agent needed):**

| Data | OTel Component | Notes |
|---|---|---|
| Pod/container CPU, memory, network, filesystem | `kubeletstats` receiver | Per-pod and per-container granularity |
| Node health & resource metrics | `kubeletstats` receiver | CPU, memory, disk, network, conditions |
| Cluster state (deployments, replicas, pod phases, conditions) | `k8s_cluster` receiver | All workload types |
| Kubernetes events | `k8sobjects` receiver | Warning and Normal events as structured logs |
| HPA current/desired replicas | `k8s_cluster` receiver | Autoscaler metrics |
| Namespace resource quotas | `k8s_cluster` receiver | Hard/used for CPU, memory, pods |
| Control plane (etcd, API server, scheduler, controller manager) | `prometheus` receiver | Scrape /metrics endpoints |
| K8s metadata enrichment on all telemetry | `k8sattributes` processor | Pod, namespace, deployment, node, labels |
| Pod log collection | `filelog` receiver (DaemonSet) | Parse CRI/Docker log format from /var/log/pods |
| Service mesh metrics (Istio/Linkerd) | `prometheus` receiver | Scrape sidecar metrics |

The current OTel Collector image (`otel/opentelemetry-collector-contrib`) already includes all these components. Only configuration changes are needed.

**What requires custom OneUptime backend code (OTel cannot do this):**

| Feature | Why OTel Can't | What's Needed |
|---|---|---|
| Resource inventory (live state) | OTel emits metrics, not full K8s object specs | Backend service watching K8s API via `k8sobjects` receiver streaming objects as logs |
| Live YAML inspection | OTel doesn't fetch/store resource specs | K8s API proxy or lightweight sidecar querying API and sending specs to backend |
| Topology / service dependency map | OTel collects metrics but doesn't build graphs | Backend analysis of trace data + K8s Service/Ingress metadata |
| Cost attribution | OTel has no concept of pricing | Backend: node pricing config + resource usage metrics (from OTel) |
| AI/ML root cause analysis | OTel is a data pipeline, not analytics | Backend intelligence correlating metrics/logs/events |
| Incident automation | OTel doesn't create incidents | Backend: existing monitor/alert system triggers incidents with K8s context |
| Status page automation | OTel doesn't manage status pages | Backend: map K8s health signals to status page components |
| Auto-discovery (onboarding) | OTel discovers for collection but doesn't auto-create monitors/dashboards | Backend: detect incoming K8s metrics → auto-provision dashboards + alert templates |
| Deployment tracking | OTel captures events but doesn't annotate charts | Backend: capture deploy events → overlay on dashboard time-series |

**Current InfrastructureAgent (Go):** Collects basic VM metrics (CPU, memory, disk, processes) via `gopsutil`. **Not needed for K8s monitoring** — the `kubeletstats` receiver provides the same data and more. Keep the InfrastructureAgent for non-K8s servers (bare metal/VMs). Do not extend it for Kubernetes.

### Two Helm Charts — Don't Confuse Them

There are two separate Helm charts. OneUptime's own OTel Collector is **not modified** for K8s monitoring. Instead, a new separate Helm chart is deployed in the user's cluster.

| Helm Chart | What It Is | Where It Runs | Purpose |
|---|---|---|---|
| `oneuptime/oneuptime` | The OneUptime platform | OneUptime's own infrastructure | Runs the backend, dashboard, ingestor, OTel Collector (OTLP receiver only) |
| `oneuptime/kubernetes-agent` **(NEW)** | K8s monitoring agent | User's Kubernetes cluster(s) | Collects K8s metrics, logs, events and sends them to OneUptime via OTLP |

**OneUptime's own OTel Collector** (`OTelCollector/otel-collector-config.template.yaml`) only has OTLP receivers — it accepts data from users. It should **NOT** be modified with `kubeletstats`, `k8s_cluster`, `k8sobjects`, or `prometheus` receivers. Those belong in the new `kubernetes-agent` Helm chart.

**The `kubernetes-agent` Helm chart** is a new chart that users install in each cluster they want to monitor. It deploys:
- An OTel Collector **Deployment** with `kubeletstats`, `k8s_cluster`, `k8sobjects`, `prometheus` receivers + `k8sattributes` and `resource` processors → exports via OTLP to OneUptime's ingestor
- An OTel Collector **DaemonSet** (optional) with `filelog` receiver for pod log collection
- ClusterRole + ClusterRoleBinding + ServiceAccount for read-only K8s API access
- ConfigMap with the OTel Collector config, templated from Helm values

**New files to create:**
- `HelmChart/Public/kubernetes-agent/` (new chart directory)
- `HelmChart/Public/kubernetes-agent/Chart.yaml`
- `HelmChart/Public/kubernetes-agent/values.yaml`
- `HelmChart/Public/kubernetes-agent/templates/deployment.yaml` (OTel Collector Deployment for metrics/events)
- `HelmChart/Public/kubernetes-agent/templates/daemonset.yaml` (OTel Collector DaemonSet for logs)
- `HelmChart/Public/kubernetes-agent/templates/configmap-deployment.yaml` (OTel config for Deployment)
- `HelmChart/Public/kubernetes-agent/templates/configmap-daemonset.yaml` (OTel config for DaemonSet)
- `HelmChart/Public/kubernetes-agent/templates/rbac.yaml` (ClusterRole, ClusterRoleBinding, ServiceAccount)
- `HelmChart/Public/kubernetes-agent/templates/secret.yaml` (OneUptime API key)

**Summary of layers:**

| Layer | Responsibility | Technology |
|---|---|---|
| Data collection (metrics, logs, events, control plane) | `kubernetes-agent` Helm chart | OTel Collector deployed in user's cluster |
| Data enrichment (K8s metadata on all telemetry) | `kubernetes-agent` Helm chart | `k8sattributes` processor in the agent |
| Data ingestion (receive OTLP from agents) | OneUptime's OTel Collector | Existing, unchanged |
| Storage | ClickHouse | Already exists |
| Cluster discovery, inventory, topology, cost, AI, incidents, status pages | OneUptime backend + frontend | Custom code |

---

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
| Multi-cluster support | None | Yes | Yes | Thanos/Cortex | **P0** |
| K8s log collection (pod stdout/stderr) | Via Fluentd example | DaemonSet agent | Fluent Bit integration | Loki + Promtail | **P2** |
| Service mesh observability (Istio, Linkerd) | None | Yes | Yes | Partial | **P2** |
| Control plane monitoring (etcd, API server, scheduler, controller-manager) | None | Yes (Agent check) | K8s integration | Prometheus scrape + mixins | **P0** |
| Network policy monitoring | None | NPM | None | Cilium Hubble | **P3** |
| eBPF-based deep observability | None | Universal Service Monitoring | Pixie | Cilium/Tetragon | **P3** |

> **Note:** Multi-cluster moved from P2 to P0 — it's foundational to the product architecture. Every cluster is a first-class resource from day one.

---

## Phase 1: Foundation (P0) — COMPLETED

All Phase 1 items have been implemented. See the Completed section above for details.

---

## Phase 2: Intelligent Alerting & Workload Health (P1) — Actionable Monitoring

### 2.1 Enable MonitorType.Kubernetes

**Current**: `MonitorType.Kubernetes` exists in the enum but is disabled.
**Target**: Enable it and wire it to cluster-scoped monitoring.

**Implementation**:

- Enable Kubernetes in `getAllMonitorTypeProps()` and `getActiveMonitorTypes()`
- Kubernetes monitor creation flow:
  1. Select cluster (from auto-discovered clusters)
  2. Select resource scope: Cluster / Namespace / Workload / Node / Pod
  3. Configure conditions (metric thresholds, event patterns, state changes)
- Monitor evaluation: query ClickHouse for K8s metrics scoped to the selected cluster and resource
- Link monitors to the Kubernetes product pages (click a pod → see its monitors)

**Files to modify**:
- `Common/Types/Monitor/MonitorType.ts` (enable Kubernetes type)
- `App/FeatureSet/Dashboard/src/Pages/Monitor/MonitorCreate.tsx` (add K8s cluster/resource selection)
- `Worker/Jobs/TelemetryMonitor/MonitorTelemetryMonitor.ts` (support K8s-specific criteria evaluation)

### 2.2 Kubernetes-Aware Alert Templates

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
  - **etcd No Leader**: `etcd_server_has_leader == 0` — critical, immediate page
  - **etcd Frequent Leader Elections**: rate of `etcd_server_leader_changes_seen_total` > 3/hour — warning
  - **etcd High WAL Fsync Latency**: p99 > 100ms — warning; > 500ms — critical
  - **etcd DB Size Near Quota**: > 80% of quota — warning; > 90% — critical
  - **API Server Throttling**: `apiserver_dropped_requests_total` rate > 0 — critical
  - **API Server Latency**: p99 > 1s for non-WATCH verbs — warning
  - **Scheduler Backlog**: `scheduler_pending_pods` > 0 for > 5 minutes — warning
- One-click enable for each alert template during K8s monitoring setup
- Auto-route alerts to the OneUptime incident management system

**Files to modify**:
- `Common/Types/Monitor/Templates/KubernetesAlertTemplates.ts` (new)
- `App/FeatureSet/Dashboard/src/Pages/Kubernetes/AlertSetup.tsx` (new - guided alert configuration)
- `Worker/Jobs/TelemetryMonitor/MonitorTelemetryMonitor.ts` (support K8s-specific criteria evaluation)

### 2.3 HPA and VPA Monitoring (was 2.4)

**Current**: No autoscaler visibility.
**Target**: Track HPA/VPA behavior and scaling events.

**Implementation**:

- Ingest HPA metrics from `k8s_cluster` receiver:
  - `k8s.hpa.current_replicas`, `k8s.hpa.desired_replicas`, `k8s.hpa.min_replicas`, `k8s.hpa.max_replicas`
  - Target metric values vs actual
- HPA overview page within cluster:
  - List all HPAs with current/desired/min/max replicas
  - Time-series chart showing scaling events overlaid with the target metric
  - Alert when HPA is at max replicas sustained (capacity ceiling)
  - Alert when scale-up frequency is abnormally high (thrashing)

**Files to modify**:
- `App/FeatureSet/Dashboard/src/Pages/Kubernetes/Autoscaling.tsx` (new)

---

## Phase 3: Advanced Observability (P2) — Correlation & Deep Visibility

### 3.1 Service Mesh Observability

**Current**: No service mesh integration.
**Target**: Ingest and visualize service mesh metrics from Istio, Linkerd, or similar.

**Implementation**:

- Add Prometheus receiver to the `kubernetes-agent` OTel Collector config for scraping service mesh metrics:
  - Istio: `istio_requests_total`, `istio_request_duration_milliseconds`, `istio_tcp_connections_opened_total`
  - Linkerd: `request_total`, `response_latency_ms`
- Service-to-service traffic map from mesh metrics
- mTLS status visibility
- Circuit breaker and retry metrics
- Dashboard templates for Istio and Linkerd

**Files to modify**:
- `HelmChart/Public/kubernetes-agent/templates/configmap-deployment.yaml` (add prometheus receiver for mesh metrics)
- `Common/Types/Dashboard/Templates/ServiceMesh.ts` (new - mesh dashboard templates)

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

### 4.10 Topology / Service Dependency Map

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
| Multi-cluster support | P0 | Fleet Automation | Per-cluster pod-hour billing | Fleet Control GA | Thanos/Mimir/Cortex | CLUSTER_NAME labeling |
| Pre-built alert templates | P1 | Auto-monitors | Auto-baselines | Pre-built alerts | PrometheusRule CRDs | Yes |
| Resource inventory | P1 | Orchestrator Explorer | Expanded Jan 2026 (CRDs, NetworkPolicies, PVCs with live YAML) | Cluster explorer | None native | Yes |
| HPA monitoring | P1 | Yes | Yes | Yes (custom metrics adapter) | Via kube-state-metrics | Yes |
| Cost optimization | P3 | Pod-level granularity, autoscaling recs | Cost & Carbon Optimization, idle workload detection | Resource optimization recs | OpenCost integration | Cost Advisor (~40% waste reduction) |
| eBPF-based observability | P3 | Network monitoring, file integrity (35% CPU reduction) | eBPF Discovery in OneAgent | eAPM (zero-instrumentation GA) | Cilium/Hubble, Beyla | Core agent eBPF |
| Network monitoring | P3 | Full NPM (Layer 4 eBPF) | Horizontal topology mapping | Via Pixie/eBPF | Cilium/Hubble | Deep traffic analysis |
| Security/compliance | P3 | CSM, Falco integration | Security posture monitoring | RBAC-aware deployment | OPA/Gatekeeper dashboards | Core brand (runtime security) |
| GitOps integration | P3 | Flux/ArgoCD with health metrics | Limited (Operator CRDs) | Agent Control + Fleet Control | GitOps-native by design | Limited |
| Service mesh | P2 | Istio/Envoy with RBAC telemetry | Istio/Envoy via Prometheus | Via OpenTelemetry | Istio dashboards, Cilium | Yes |
| Auto-discovery | P3 | Automatic workload detection | Zero-config (thousands of pods) | eBPF eAPM auto-discovers all services | Prometheus K8s service discovery | eBPF auto-discovery |
| AI root cause analysis | P3 | Watchdog anomaly detection | Davis AI (automated RCA) | AI-driven anomaly detection | None native | Anomaly/threat detection |
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

OneUptime is the only platform that combines Kubernetes monitoring + incident management + status pages + on-call in a single product. No pure observability tool offers this end-to-end flow. The roadmap should aggressively leverage this advantage:

- **K8s failure → auto-incident → status page update → on-call notification** in one flow
- **K8s-aware status pages** that automatically reflect cluster health — no competitor has this
- **Zero tool-switching**: see a CrashLoopBackOff, create an incident, update the status page, page on-call — all without leaving OneUptime

---

## Gaps and Recommendations

### Critical Gaps Not Addressed in Original Roadmap

1. **Auto-discovery / zero-config onboarding** — Dynatrace's killer feature. Our plan requires manual Helm config. Should be elevated to P1.
2. **AI/ML-driven root cause analysis** — Dynatrace (Davis AI) and Datadog (Watchdog) do this automatically. No AI component in our roadmap.
3. **Kubernetes-native incident automation** — Our all-in-one platform advantage is not leveraged. K8s failure → auto-incident → status page update → on-call notification should be a headline feature.
4. **Kubernetes-aware status pages** — No competitor has this. Automatically reflecting K8s health on public status pages is a unique differentiator we're not building.
5. ~~**Live YAML / resource inspection**~~ — **DONE.** YAML tab implemented on all resource detail pages.
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

---

## Recommended Implementation Order

1. **Quick Win** - Enable MonitorType.Kubernetes (makes K8s data actionable)
2. **Phase 2.2** - K8s-aware alert templates, including etcd/control plane alerts
3. **Phase 2.3** - HPA/VPA monitoring
4. **Phase 3.1** - Service mesh observability
5. **Phase 4.x** - Cost attribution, network policies, eBPF, compliance, GitOps, AI RCA, incident automation, status page automation, topology map, managed provider integrations, deployment tracking

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
