# Plan: Docker Container Monitoring for OneUptime

## Context

OneUptime's infrastructure monitoring currently supports Server/VM monitoring via the InfrastructureAgent (a Go-based agent that collects CPU, memory, disk, and process metrics) and has full Kubernetes monitoring via an OpenTelemetry Collector-based kubernetes-agent Helm chart. There is **no Docker container monitoring** today. Users running containerized workloads — whether on bare-metal Docker hosts, Docker Compose, or Docker Swarm — have no visibility into container-level health, resource consumption, or lifecycle events.

Docker container monitoring is a critical gap: Docker remains the dominant container runtime, and many users run workloads on Docker without Kubernetes. Competitors (Datadog, New Relic, Grafana Cloud) all provide first-class Docker monitoring. This plan proposes a phased implementation to close this gap.

### Architecture Decision: OTel Collector (not custom agent)

Kubernetes monitoring uses an **OpenTelemetry Collector** deployed via Helm chart — not a custom agent. Docker monitoring follows the same pattern for consistency.

| Factor | Custom Agent | OTel Collector (chosen) |
|--------|-------------|------------------------|
| Maintenance | Must maintain custom Docker SDK code in Go | Community-maintained receivers |
| Maturity | New, unproven | Production-proven, widely deployed |
| Consistency | Different pattern than K8s monitoring | Same pattern as K8s monitoring |
| Log collection | Must build custom log collector | `filelog` receiver already handles Docker JSON logs |
| Metrics format | Custom format, needs custom ingest API | Standard OTLP, uses existing `/otlp/v1/*` endpoints |
| New API endpoints | Need `/docker-monitor/` endpoints | None needed — existing OTLP pipeline |
| Agent updates | Must release new agent binary | Update collector config YAML |

### Open Source Components

The **OpenTelemetry Collector Contrib** (`otel/opentelemetry-collector-contrib`) — the same image used for kubernetes-agent — includes:

1. **`docker_stats` receiver** — Collects per-container CPU, memory, network, block I/O metrics from Docker daemon via `/var/run/docker.sock`
2. **`docker_observer` extension** — Auto-discovers running containers for dynamic monitoring
3. **`filelog` receiver** — Collects container logs from Docker JSON log files (`/var/lib/docker/containers/`)
4. **`resourcedetection` processor** — Enriches telemetry with host metadata
5. **`resource` processor** — Stamps all data with project identifiers

OneUptime already has **full OTLP ingestion** (HTTP on `/otlp/v1/metrics`, `/otlp/v1/logs`, gRPC on port 4317), so no new ingest endpoints are needed.

---

## Gap Analysis Summary

| Feature | OneUptime | Datadog | New Relic | Priority |
|---------|-----------|---------|-----------|----------|
| Container discovery & inventory | None | Auto-discovery via agent | Auto-discovery via infra agent | **P0** |
| Container CPU/memory/network/disk metrics | None | Full metrics via cgroups | Full metrics via cgroups | **P0** |
| Container lifecycle events (start/stop/restart/OOM) | None | Event stream + alerts | Event stream + alerts | **P0** |
| Container health status monitoring | None | Health check integration | Health check integration | **P0** |
| Container log collection | None (generic OTLP only) | Auto-collected per container | Auto-collected per container | **P1** |
| Docker Compose service grouping | None | Auto-detection via labels | Label-based grouping | **P1** |
| Container image vulnerability scanning | None | Integrated via Snyk/Trivy | None | **P2** |
| Docker Swarm service monitoring | None | Full Swarm support | Limited | **P2** |
| Container resource limit alerts | None | OOM/throttle alerts | Threshold alerts | **P1** |
| Container networking (inter-container traffic) | None | Network map + flow data | Limited | **P2** |
| Live container exec / inspect | None | None | None | **P3** |

---

## Phase 1: Foundation (P0) — Docker Agent & Core Metrics

### 1.1 Docker Monitor Type

**Current**: No Docker monitor type exists.
**Target**: Add a `Docker` monitor type with full UI integration.

**Implementation**:

- Add `Docker = "Docker"` to the `MonitorType` enum
- Add Docker to the "Infrastructure" monitor type category alongside Server and SNMP
- Add monitor type props (title: "Docker Container", description, icon: `IconProp.Cube`)
- Add Docker to `getActiveMonitorTypes()` and relevant helper methods

**Files to modify**:
- `Common/Types/Monitor/MonitorType.ts` (add enum value, category, props)

### 1.2 Docker Agent — OTel Collector Deployment

**Current**: No Docker metrics collection.
**Target**: Deploy an OpenTelemetry Collector on Docker hosts to collect container metrics and logs, sending them to OneUptime via standard OTLP.

**Implementation**:

Provide multiple deployment options (Docker hosts are not Kubernetes, so no Helm chart):

**Option A: Docker Compose (recommended)**
```yaml
# docker-compose.yml
services:
  oneuptime-docker-agent:
    image: otel/opentelemetry-collector-contrib:latest
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
      - ./otel-collector-config.yaml:/etc/otelcol-contrib/config.yaml
    environment:
      - ONEUPTIME_URL=${ONEUPTIME_URL}
      - ONEUPTIME_SERVICE_TOKEN=${ONEUPTIME_SERVICE_TOKEN}
    restart: unless-stopped
```

**Option B: Standalone Docker run command** (quick start)
**Option C: systemd service** (bare-metal install)

**OTel Collector configuration** (`otel-collector-config.yaml`):
```yaml
receivers:
  docker_stats:
    endpoint: unix:///var/run/docker.sock
    collection_interval: 30s
    provide_per_core_cpu_metrics: true
    # Collects: container.cpu.*, container.memory.*, container.network.io.*,
    #           container.blockio.*, container.uptime, container.restarts,
    #           container.pids.count

  filelog:
    include:
      - /var/lib/docker/containers/*/*.log
    operators:
      - type: json_parser
        # Docker JSON log format: {"log":"...","stream":"stdout","time":"..."}
      - type: move
        from: attributes.log
        to: body
      - type: move
        from: attributes.stream
        to: attributes["log.iostream"]

processors:
  resource:
    attributes:
      - key: oneuptime.project.id
        value: "${ONEUPTIME_PROJECT_ID}"
        action: upsert
  resourcedetection:
    detectors: [env, system, docker]
    system:
      hostname_sources: [os]
  batch:
    timeout: 10s
    send_batch_size: 1024

exporters:
  otlphttp:
    endpoint: "${ONEUPTIME_URL}/otlp"
    headers:
      x-oneuptime-service-token: "${ONEUPTIME_SERVICE_TOKEN}"

service:
  pipelines:
    metrics:
      receivers: [docker_stats]
      processors: [resourcedetection, resource, batch]
      exporters: [otlphttp]
    logs:
      receivers: [filelog]
      processors: [resourcedetection, resource, batch]
      exporters: [otlphttp]
```

**Metrics collected by `docker_stats` receiver:**
- `container.cpu.usage.total` — Total CPU time consumed
- `container.cpu.usage.percpu` — Per-core CPU usage
- `container.cpu.percent` — CPU usage percentage
- `container.cpu.throttling_data.throttled_time` — CPU throttled time
- `container.memory.usage.total` — Total memory usage
- `container.memory.usage.limit` — Memory limit
- `container.memory.percent` — Memory usage percentage
- `container.memory.active_anon`, `container.memory.cache`, `container.memory.rss` — Memory breakdown
- `container.network.io.usage.rx_bytes` / `tx_bytes` — Network I/O
- `container.network.io.usage.rx_packets` / `tx_packets` — Network packets
- `container.blockio.io_service_bytes_recursive.read` / `write` — Block I/O
- `container.uptime` — Container uptime
- `container.restarts` — Restart count
- `container.pids.count` — Process count in container

**Resource attributes automatically included:**
- `container.id`, `container.name`, `container.image.name`, `container.image.tag`
- `container.runtime` = "docker"
- `host.name`, `os.type`

**Files to create**:
- `DockerAgent/docker-compose.yml` — OTel Collector deployment
- `DockerAgent/otel-collector-config.yaml` — Collector configuration template
- `DockerAgent/install.sh` — One-line install script (downloads compose file, prompts for config values)
- `DockerAgent/systemd/oneuptime-docker-agent.service` — systemd unit file alternative
- `DockerAgent/README.md` — Setup guide

### 1.3 Docker Host Auto-Discovery

**Current**: No Docker host awareness.
**Target**: Auto-discover Docker hosts when telemetry arrives, following the Kubernetes cluster auto-discovery pattern.

**Implementation**:

The Kubernetes monitoring uses a `KubernetesCluster` model (`Common/Models/DatabaseModels/KubernetesCluster.ts`) with auto-discovery via `findOrCreateByClusterIdentifier()` when telemetry arrives with `k8s.cluster.name` attribute. Follow the same pattern for Docker hosts:

- Create a `DockerHost` PostgreSQL model:
  - `hostName` (from `host.name` resource attribute)
  - `projectId`
  - `otelCollectorStatus` (connected / disconnected)
  - `lastSeenAt` (timestamp — mark disconnected if no data for 5+ minutes)
  - `dockerVersion` (from container metadata if available)
  - `containersRunning`, `containersStopped`, `containersPaused` (cached counts)
  - `osType`, `osVersion` (from `os.type`, `os.version` resource attributes)
- Auto-discover: when Docker container metrics arrive with `host.name` attribute, call `findOrCreateByHostIdentifier()`
- Disconnect detection: worker job marks hosts as disconnected if no metrics received in 5+ minutes

**Files to create**:
- `Common/Models/DatabaseModels/DockerHost.ts` (new)
- `Common/Server/Services/DockerHostService.ts` (new)

### 1.4 Docker Metric Catalog

**Current**: No Docker-specific metric catalog.
**Target**: Pre-defined metric catalog for Docker container metrics, following the Kubernetes metric catalog pattern.

**Implementation**:

The K8s monitoring has `Common/Types/Monitor/KubernetesMetricCatalog.ts` with 30+ pre-defined metrics. Create an equivalent for Docker:

- Define all `docker_stats` receiver metrics with human-readable names, descriptions, units, and aggregation types
- Group by category: CPU, Memory, Network, Block I/O, Container Info
- Used in monitor creation UI for metric selection (no manual metric name typing)

**Files to create**:
- `Common/Types/Monitor/DockerMetricCatalog.ts` (new)

### 1.5 Container Lifecycle Events

**Current**: No container event tracking.
**Target**: Capture and surface container lifecycle events (start, stop, restart, OOM kill, health check failures).

**Implementation**:

- Add Docker events receiver to the OTel Collector config using the `docker_observer` extension or by subscribing to Docker events API
- Capture events: `start`, `stop`, `die`, `kill`, `oom`, `restart`, `pause`, `unpause`, `health_status`
- Events arrive as structured logs via the existing OTLP log pipeline
- Include exit code, OOM killed flag, and signal information for `die` events
- Surface events as an overlay on container metric charts (vertical markers)
- Enable alerting on lifecycle events via Log-based monitors

**Files to modify**:
- `DockerAgent/otel-collector-config.yaml` (add Docker events collection)

---

## Phase 2: Alerting & Monitoring Rules (P0-P1) — Actionable Monitoring

### 2.1 Docker Monitor Creation & Evaluation

**Current**: No Docker-specific monitoring.
**Target**: Create Docker monitors that query container metrics and evaluate criteria, following the Kubernetes monitor pattern.

**Implementation**:

The K8s monitoring implements `monitorKubernetes()` in the TelemetryMonitor worker, which queries ClickHouse for K8s metrics using the metric catalog. Follow the same pattern:

- Docker monitors query ClickHouse for Docker container metrics
- Support filtering by host, container name, container image
- Criteria evaluation checks metric values against thresholds
- Pre-built alert templates (like K8s has 12 templates):
  - Container stopped unexpectedly
  - Container CPU usage > threshold
  - Container memory usage > threshold (limit-aware)
  - Container restart loop (restart count > N in time window)
  - Container OOM killed
  - Docker daemon disconnected (no metrics received)

**Files to create**:
- `Common/Server/Utils/Monitor/Criteria/DockerMonitorCriteria.ts` (new)
- `Common/Types/Monitor/DockerMonitor/DockerAlertTemplates.ts` (new)

**Files to modify**:
- `Common/Server/Utils/Monitor/MonitorCriteriaEvaluator.ts` (route Docker type)
- `Common/Types/Monitor/CriteriaFilter.ts` (add Docker-specific filter types)

### 2.2 Container Resource Threshold Alerts

**Current**: Server monitor supports CPU/memory threshold alerts at the host level.
**Target**: Per-container resource threshold alerting with limit-aware thresholds.

**Implementation**:

- Add monitor criteria for container-level metrics:
  - CPU usage % (of container limit or host total)
  - Memory usage % (of container limit)
  - Memory usage absolute (approaching container limit)
  - Network error rate
  - Block I/O throughput
  - Restart count in time window
  - PID count approaching limit
- **Limit-aware alerting**: When a container has resource limits set, calculate usage as a percentage of the limit rather than host total
  - E.g., container with 2GB memory limit using 1.8GB = 90% (alert), not 1.8/64GB = 2.8% (misleading)
- Support compound criteria (e.g., CPU > 80% AND memory > 90% for 5 minutes)

### 2.3 Container Auto-Restart Detection

**Current**: No restart tracking.
**Target**: Detect and alert on container restart loops (CrashLoopBackOff equivalent for Docker).

**Implementation**:

- Track restart count per container over sliding time windows (5 min, 15 min, 1 hour)
- Alert when restart count exceeds configurable threshold
- Include container exit code and last log lines in the alert context
- Dashboard widget showing containers with highest restart frequency

---

## Phase 3: Visualization & UX (P1) — Docker Observability Product

### 3.1 Docker as an Observability Product

**Current**: No Docker UI.
**Target**: Docker as a standalone product in the Observability section, following the Kubernetes product pattern.

```
Observability
├── Logs
├── Traces
├── Metrics
├── Services
├── Exceptions
├── Kubernetes    (existing)
└── Docker        (NEW)
    ├── Hosts List         ← All Docker hosts in project
    └── Host Detail
        ├── Overview       (daemon info, container counts, resource usage)
        ├── Containers     (list with CPU/memory/status, drill into detail)
        ├── Events         (container lifecycle events)
        └── Logs           (container logs, pre-filtered by host)
```

### 3.2 Container List & Detail Pages

**Container List Page**: Table with columns for name, image, status, health, CPU%, memory%, network I/O, uptime, restart count. Sortable, filterable, searchable.

**Container Detail Page**: Single-container view with:
- Header: container name, image, status badge, health badge, uptime
- Metrics charts: CPU, memory, network, block I/O (time series, matching existing metric chart style)
- Events timeline: lifecycle events overlaid on charts
- Container metadata: labels, ports, mounts, resource limits
- Logs tab: recent container logs (pre-filtered from log management)

### 3.3 Docker Monitor Setup Documentation

Show install instructions in the monitor creation UI:
- Docker Compose method (recommended)
- Standalone Docker run command (quick start)
- systemd service (bare-metal)
- Configuration values: OneUptime URL, project ID, service token
- Note: requires access to `/var/run/docker.sock`

**Files to create**:
- `App/FeatureSet/Dashboard/src/Pages/Docker/` (new directory — host list, host detail, container list, container detail)
- `App/FeatureSet/Dashboard/src/Components/Docker/` (new directory — view components)
- `App/FeatureSet/Dashboard/src/Components/Monitor/DockerMonitor/Documentation.tsx` (new)

**Files to modify**:
- Dashboard routing and sidebar navigation (add Docker product)
- Monitor creation form (add Docker type with metric catalog picker and template selector)

---

## Phase 4: Container Log Collection (P1) — Unified Observability

### 4.1 Automatic Container Log Collection

**Current**: Log collection requires explicit OTLP/Fluentd/Syslog integration per application.
**Target**: The Docker Agent OTel Collector automatically collects logs from all containers.

**Implementation**:

The `filelog` receiver in the OTel Collector config (Phase 1.2) already handles this:
- Reads from `/var/lib/docker/containers/*/*.log` (Docker JSON log format)
- Parses JSON log format automatically
- Enriches with container metadata (name, image, ID) via `resourcedetection` processor
- Forwards to OneUptime's `/otlp/v1/logs` endpoint

Configuration options (via environment variables or collector config):
- Enable/disable log collection per container (via Docker labels: `oneuptime.logs.enabled=true/false`)
- Max log line size
- Log rate limiting (to prevent noisy container flooding)
- Include/exclude containers by name pattern or label selector

### 4.2 Container Log Correlation

**Current**: No automatic correlation between container logs and container metrics.
**Target**: Link container logs to container metrics and events for unified troubleshooting.

**Implementation**:

- All container logs and metrics share `container.name` and `container.id` resource attributes (set by OTel Collector)
- In the container detail page, the "Logs" tab pre-filters the log viewer by `container.id`
- When viewing a metric anomaly or event, show a link to "View logs around this time"
- In the log detail view, show a link to "View container metrics" when `container.id` attribute is present

**Files to modify**:
- Container detail page (add Logs tab with pre-filtered log viewer)
- Log details panel (add container metrics link)

---

## Phase 5: Docker Compose & Swarm Support (P1-P2) — Multi-Container Orchestration

### 5.1 Docker Compose Project Grouping

**Current**: Containers are flat, no grouping.
**Target**: Automatically detect Docker Compose projects and group containers by service.

**Implementation**:

- Detect Compose projects via standard labels (available as resource attributes from `docker_stats` receiver):
  - `com.docker.compose.project` (project name)
  - `com.docker.compose.service` (service name)
  - `com.docker.compose.container-number` (replica number)
  - `com.docker.compose.oneoff` (one-off vs service container)
- Create a Compose project view showing:
  - Project name with list of services
  - Per-service status (all replicas healthy, degraded, down)
  - Per-service aggregated metrics (total CPU, memory across replicas)
- Alert at the service level (e.g., "all replicas of service X are down")

**Files to create**:
- `Common/Models/DatabaseModels/DockerComposeProject.ts` (new)
- `Common/Server/Services/DockerComposeProjectService.ts` (new)
- `App/FeatureSet/Dashboard/src/Pages/Docker/ComposeProjects.tsx` (new)
- `App/FeatureSet/Dashboard/src/Pages/Docker/ComposeProjectDetail.tsx` (new)

### 5.2 Docker Swarm Monitoring

**Current**: No Swarm support.
**Target**: Monitor Docker Swarm services, tasks, and nodes.

**Implementation**:

- Detect if the Docker host is a Swarm manager node (from Docker daemon info)
- Extend OTel Collector config to collect Swarm-specific metrics (may require custom receiver or Prometheus exporter)
- Collect Swarm-specific data: services (desired/running replicas), tasks (state, assigned node), nodes (availability, status)
- Surface Swarm service health: desired replicas vs running replicas
- Alert when service degraded (running < desired) or task failures
- Swarm-specific dashboard showing cluster overview

---

## Phase 6: Advanced Features (P2-P3) — Differentiation

### 6.1 Container Image Analysis

**Current**: No image awareness beyond name/tag.
**Target**: Track image versions across containers and optionally scan for known vulnerabilities.

**Implementation**:

- Maintain an image registry (image name, tag, digest, size, creation date)
- Show which containers are running outdated images (when a newer tag is available locally)
- Optional: integrate with Trivy or Grype for vulnerability scanning of local images
- Dashboard showing image inventory, version distribution, and vulnerability summary

### 6.2 Container Resource Recommendations

**Current**: No resource guidance.
**Target**: Recommend CPU/memory limits based on observed usage patterns.

**Implementation**:

- Analyze historical container metrics (p95 CPU, p99 memory over 7 days) from ClickHouse
- Compare actual usage to configured limits
- Flag over-provisioned containers (limit >> usage) and under-provisioned containers (usage approaching limit)
- Generate recommendations: "Container X uses max 256MB, but has a 4GB limit — consider reducing to 512MB"

### 6.3 Container Diff / Change Detection

**Current**: No change tracking.
**Target**: Detect when container configuration changes (image update, env var change, port mapping change).

**Implementation**:

- Store container configuration snapshots (from resource attributes) on each metric report
- Diff against previous snapshot and generate change events
- Alert on unexpected configuration changes
- Show change history in the container detail page

---

## Quick Wins (Can Ship First)

1. **Docker Agent** — Create the OTel Collector config + Docker Compose file (Phase 1.2) — users can start collecting Docker metrics immediately using existing Telemetry/Metrics monitors
2. **Add Docker monitor type** — Add the enum value, category, and props (Phase 1.1)
3. **Docker metric catalog** — Define metrics for the monitor creation UI (Phase 1.4)
4. **Container inventory page** — Simple table showing discovered containers across hosts (Phase 3.2)

---

## Recommended Implementation Order

1. **Phase 1.2** — Docker Agent (OTel Collector config + deployment) — immediate value
2. **Phase 1.1** — Docker monitor type (enum, UI scaffolding)
3. **Phase 1.4** — Docker metric catalog
4. **Phase 1.3** — Docker host auto-discovery
5. **Phase 2.1** — Docker monitor creation & evaluation with alert templates
6. **Phase 3.1** — Docker as Observability product (dashboard pages)
7. **Phase 3.2** — Container list & detail pages
8. **Phase 1.5** — Container lifecycle events
9. **Phase 2.2** — Container resource threshold alerts
10. **Phase 4.1** — Automatic container log collection
11. **Phase 4.2** — Container log correlation
12. **Phase 5.1** — Docker Compose project grouping
13. **Phase 2.3** — Container auto-restart detection
14. **Phase 5.2** — Docker Swarm monitoring
15. **Phase 6.1** — Container image analysis
16. **Phase 6.2** — Container resource recommendations
17. **Phase 6.3** — Container diff / change detection

## Verification

For each feature:
1. Deploy OTel Collector with `docker_stats` receiver on a Docker host, verify metrics arrive at OneUptime's `/otlp/v1/metrics` and appear in ClickHouse
2. Verify container logs arrive via `filelog` receiver at `/otlp/v1/logs`
3. Create a Docker monitor, verify criteria evaluation fires alerts correctly
4. Test auto-discovery: start collector, verify DockerHost record auto-created
5. Test alerting: stop a container, verify alert fires
6. Performance test: verify collector overhead is minimal (< 1% CPU) when monitoring 50+ containers
7. Test Docker Compose project detection via standard labels
8. Test graceful handling of Docker daemon unavailability (collector should report errors, not crash)
9. Verify container metrics accuracy by comparing OTel-reported values to `docker stats` CLI output
