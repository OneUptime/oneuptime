# Plan: Docker Container Monitoring for OneUptime

## Context

OneUptime's infrastructure monitoring currently supports Server/VM monitoring via the InfrastructureAgent (a Go-based agent that collects CPU, memory, disk, and process metrics) and has a commented-out Kubernetes monitor type. There is **no Docker container monitoring** today. Users running containerized workloads — whether on bare-metal Docker hosts, Docker Compose, or Docker Swarm — have no visibility into container-level health, resource consumption, or lifecycle events.

Docker container monitoring is a critical gap: Docker remains the dominant container runtime, and many users run workloads on Docker without Kubernetes. Competitors (Datadog, New Relic, Grafana Cloud) all provide first-class Docker monitoring. This plan proposes a phased implementation to close this gap.

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

## Phase 1: Foundation (P0) — Container Discovery & Core Metrics

These are table-stakes features required for any Docker monitoring product.

### 1.1 Docker Monitor Type

**Current**: No Docker monitor type exists. Kubernetes is defined but commented out.
**Target**: Add a `Docker` monitor type with full UI integration.

**Implementation**:

- Add `Docker = "Docker"` to the `MonitorType` enum
- Add Docker to the "Infrastructure" monitor type category alongside Server and SNMP
- Add monitor type props (title: "Docker Container", description, icon: `IconProp.Cube`)
- Create `DockerMonitorResponse` interface for container metric reporting
- Add Docker to `getActiveMonitorTypes()` and relevant helper methods

**Files to modify**:
- `Common/Types/Monitor/MonitorType.ts` (add enum value, category, props)
- `Common/Types/Monitor/DockerMonitor/DockerMonitorResponse.ts` (new)
- `Common/Types/Monitor/DockerMonitor/DockerContainerMetrics.ts` (new)

### 1.2 Container Metrics Collection in InfrastructureAgent

**Current**: The Go-based InfrastructureAgent collects host-level CPU, memory, disk, and process metrics.
**Target**: Extend the agent to discover and collect metrics from all running Docker containers on the host.

**Implementation**:

- Add a Docker collector module to the InfrastructureAgent that uses the Docker Engine API (via `/var/run/docker.sock` or configurable endpoint)
- Discover all running containers via `GET /containers/json`
- For each container, collect metrics via `GET /containers/{id}/stats?stream=false`:
  - **CPU**: `cpu_stats.cpu_usage.total_usage`, `cpu_stats.system_cpu_usage`, per-core usage, throttled periods/time
  - **Memory**: `memory_stats.usage`, `memory_stats.limit`, `memory_stats.stats.cache`, RSS, swap, working set, OOM kill count
  - **Network**: `networks.*.rx_bytes`, `tx_bytes`, `rx_packets`, `tx_packets`, `rx_errors`, `tx_errors`, `rx_dropped`, `tx_dropped` (per interface)
  - **Block I/O**: `blkio_stats.io_service_bytes_recursive` (read/write bytes), `io_serviced_recursive` (read/write ops)
  - **PIDs**: `pids_stats.current`, `pids_stats.limit`
- Collect container metadata: name, image, image ID, labels, created time, status, health check status, restart count, ports, mounts, environment (filtered for sensitive values)
- Report interval: configurable, default 30 seconds (matching existing server monitor interval)

**Files to modify**:
- `InfrastructureAgent/collector/docker.go` (new - Docker metrics collector)
- `InfrastructureAgent/model/docker.go` (new - Docker metric data models)
- `InfrastructureAgent/agent.go` (add Docker collection to the main loop)
- `InfrastructureAgent/config.go` (add Docker-related configuration: socket path, collection enabled/disabled)

### 1.3 Container Inventory & Discovery

**Current**: No container awareness.
**Target**: Auto-discover containers on monitored hosts and maintain a live inventory.

**Implementation**:

- Create a `DockerContainer` PostgreSQL model to store discovered containers:
  - `containerId` (Docker container ID)
  - `containerName`
  - `imageName`, `imageId`, `imageTag`
  - `status` (running, paused, stopped, restarting, dead, created)
  - `healthStatus` (healthy, unhealthy, starting, none)
  - `labels` (JSON)
  - `createdAt` (container creation time)
  - `startedAt`
  - `hostMonitorId` (reference to the Server monitor for the host)
  - `projectId`
  - `restartCount`
  - `ports` (JSON - exposed ports mapping)
  - `mounts` (JSON - volume mounts)
  - `cpuLimit`, `memoryLimit` (resource constraints)
- On each agent report, upsert container records (create new, update existing, mark removed containers as stopped)
- Container inventory page in the dashboard showing all containers across all monitored hosts

**Files to modify**:
- `Common/Models/DatabaseModels/DockerContainer.ts` (new)
- `Common/Server/Services/DockerContainerService.ts` (new)
- `App/FeatureSet/Dashboard/src/Pages/Infrastructure/DockerContainers.tsx` (new - container list page)
- `App/FeatureSet/Dashboard/src/Pages/Infrastructure/DockerContainerDetail.tsx` (new - single container detail)

### 1.4 Container Lifecycle Events

**Current**: No container event tracking.
**Target**: Capture and surface container lifecycle events (start, stop, restart, OOM kill, health check failures).

**Implementation**:

- In the InfrastructureAgent, subscribe to Docker events via `GET /events?filters={"type":["container"]}` (long-poll/streaming)
- Capture events: `start`, `stop`, `die`, `kill`, `oom`, `restart`, `pause`, `unpause`, `health_status`
- Include exit code, OOM killed flag, and signal information for `die` events
- Report events to OneUptime alongside metric data
- Store events in the existing telemetry pipeline (as structured logs or a dedicated events table)
- Surface events as an overlay on container metric charts (vertical markers)
- Enable alerting on lifecycle events (e.g., alert on OOM kill, alert on restart count > N in time window)

**Files to modify**:
- `InfrastructureAgent/collector/docker_events.go` (new - event listener)
- `Common/Types/Monitor/DockerMonitor/DockerContainerEvent.ts` (new)
- `Worker/Jobs/Monitors/DockerContainerMonitor.ts` (new - process container reports, evaluate criteria)

---

## Phase 2: Alerting & Monitoring Rules (P0-P1) — Actionable Monitoring

### 2.1 Container Health Check Monitoring

**Current**: No health check awareness.
**Target**: Monitor Docker health check status and alert on unhealthy containers.

**Implementation**:

- Extract health check status from container inspect data (`State.Health.Status`, `State.Health.FailingStreak`, `State.Health.Log`)
- Add monitor criteria for health check status:
  - Alert when container health transitions to `unhealthy`
  - Alert when failing streak exceeds threshold
  - Surface health check log output in alert details
- Add health status column to the container inventory table

**Files to modify**:
- `Common/Server/Utils/Monitor/Criteria/DockerContainerCriteria.ts` (new)
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

**Files to modify**:
- `Common/Server/Utils/Monitor/Criteria/DockerContainerCriteria.ts` (extend)
- `Worker/Jobs/Monitors/DockerContainerMonitor.ts` (criteria evaluation)

### 2.3 Container Auto-Restart Detection

**Current**: No restart tracking.
**Target**: Detect and alert on container restart loops (CrashLoopBackOff equivalent for Docker).

**Implementation**:

- Track restart count per container over sliding time windows (5 min, 15 min, 1 hour)
- Alert when restart count exceeds configurable threshold
- Include container exit code and last log lines in the alert context
- Dashboard widget showing containers with highest restart frequency

**Files to modify**:
- `Worker/Jobs/Monitors/DockerContainerMonitor.ts` (add restart loop detection)

---

## Phase 3: Visualization & UX (P1) — Container Dashboard

### 3.1 Container Overview Dashboard

**Current**: No container UI.
**Target**: Dedicated container monitoring pages with rich visualizations.

**Implementation**:

- **Container List Page**: Table with columns for name, image, status, health, CPU%, memory%, network I/O, uptime, restart count. Sortable, filterable, searchable
- **Container Detail Page**: Single-container view with:
  - Header: container name, image, status badge, health badge, uptime
  - Metrics charts: CPU, memory, network, block I/O (time series, matching existing metric chart style)
  - Events timeline: lifecycle events overlaid on charts
  - Container metadata: labels, ports, mounts, environment variables (filtered), resource limits
  - Processes: top processes inside the container (if available via `docker top`)
  - Logs: recent container logs (linked to log management if available)
- **Host-Container Relationship**: From the existing Server monitor detail page, add a "Containers" tab showing all containers on that host

**Files to modify**:
- `App/FeatureSet/Dashboard/src/Pages/Infrastructure/DockerContainers.tsx` (new - list view)
- `App/FeatureSet/Dashboard/src/Pages/Infrastructure/DockerContainerDetail.tsx` (new - detail view)
- `App/FeatureSet/Dashboard/src/Components/Docker/ContainerMetricsCharts.tsx` (new)
- `App/FeatureSet/Dashboard/src/Components/Docker/ContainerEventsTimeline.tsx` (new)
- `App/FeatureSet/Dashboard/src/Components/Docker/ContainerMetadataPanel.tsx` (new)

### 3.2 Container Map / Topology View

**Current**: No topology visualization.
**Target**: Visual map showing containers, their host, and network relationships.

**Implementation**:

- Show containers grouped by host
- Color-code by status (green=healthy, yellow=warning, red=unhealthy/stopped)
- Show network links between containers on the same Docker network
- Click to drill into container detail
- Show Docker Compose project grouping via labels

**Files to modify**:
- `App/FeatureSet/Dashboard/src/Components/Docker/ContainerTopology.tsx` (new)

---

## Phase 4: Container Log Collection (P1) — Unified Observability

### 4.1 Automatic Container Log Collection

**Current**: Log collection requires explicit OTLP/Fluentd/Syslog integration per application.
**Target**: Automatically collect logs from all Docker containers via the InfrastructureAgent.

**Implementation**:

- Add a log collector to the InfrastructureAgent using `GET /containers/{id}/logs?stdout=true&stderr=true&follow=true&tail=100`
- Automatically enrich logs with container metadata:
  - `container.id`, `container.name`, `container.image.name`, `container.image.tag`
  - Host information (hostname, OS)
  - Docker labels as log attributes
- Forward logs to OneUptime's telemetry ingestion endpoint (OTLP format)
- Configurable:
  - Enable/disable per container (via label `oneuptime.logs.enabled=true/false`)
  - Max log line size
  - Log rate limiting (to prevent noisy container flooding)
  - Include/exclude containers by name pattern or label selector

**Files to modify**:
- `InfrastructureAgent/collector/docker_logs.go` (new - log collector)
- `InfrastructureAgent/config.go` (add log collection config)

### 4.2 Container Log Correlation

**Current**: No automatic correlation between container logs and container metrics.
**Target**: Link container logs to container metrics and events for unified troubleshooting.

**Implementation**:

- Automatically tag container logs with `container.id` and `container.name` attributes
- In the container detail page, add a "Logs" tab that pre-filters the log viewer to the container's logs
- When viewing a metric anomaly or event, show a link to "View logs around this time"
- In the log detail view, show a link to "View container metrics" when `container.id` attribute is present

**Files to modify**:
- `App/FeatureSet/Dashboard/src/Pages/Infrastructure/DockerContainerDetail.tsx` (add Logs tab)
- `App/FeatureSet/Dashboard/src/Components/Logs/LogDetailsPanel.tsx` (add container link)

---

## Phase 5: Docker Compose & Swarm Support (P1-P2) — Multi-Container Orchestration

### 5.1 Docker Compose Project Grouping

**Current**: Containers are flat, no grouping.
**Target**: Automatically detect Docker Compose projects and group containers by service.

**Implementation**:

- Detect Compose projects via standard labels:
  - `com.docker.compose.project` (project name)
  - `com.docker.compose.service` (service name)
  - `com.docker.compose.container-number` (replica number)
  - `com.docker.compose.oneoff` (one-off vs service container)
- Create a Compose project view showing:
  - Project name with list of services
  - Per-service status (all replicas healthy, degraded, down)
  - Per-service aggregated metrics (total CPU, memory across replicas)
  - Service dependency visualization (if depends_on info is available via labels)
- Alert at the service level (e.g., "all replicas of service X are down")

**Files to modify**:
- `Common/Models/DatabaseModels/DockerComposeProject.ts` (new)
- `Common/Server/Services/DockerComposeProjectService.ts` (new)
- `App/FeatureSet/Dashboard/src/Pages/Infrastructure/DockerComposeProjects.tsx` (new)
- `App/FeatureSet/Dashboard/src/Pages/Infrastructure/DockerComposeProjectDetail.tsx` (new)

### 5.2 Docker Swarm Monitoring

**Current**: No Swarm support.
**Target**: Monitor Docker Swarm services, tasks, and nodes.

**Implementation**:

- Detect if the Docker host is a Swarm manager node
- Collect Swarm-specific data:
  - Services: `GET /services` (desired/running replicas, update status)
  - Tasks: `GET /tasks` (task state, assigned node, error messages)
  - Nodes: `GET /nodes` (availability, status, resource capacity)
- Surface Swarm service health: desired replicas vs running replicas
- Alert when service degraded (running < desired) or task failures
- Swarm-specific dashboard showing cluster overview

**Files to modify**:
- `InfrastructureAgent/collector/docker_swarm.go` (new)
- `Common/Types/Monitor/DockerMonitor/DockerSwarmMetrics.ts` (new)
- `App/FeatureSet/Dashboard/src/Pages/Infrastructure/DockerSwarm.tsx` (new)

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

- Analyze historical container metrics (p95 CPU, p99 memory over 7 days)
- Compare actual usage to configured limits
- Flag over-provisioned containers (limit >> usage) and under-provisioned containers (usage approaching limit)
- Generate recommendations: "Container X uses max 256MB, but has a 4GB limit — consider reducing to 512MB"

### 6.3 Container Diff / Change Detection

**Current**: No change tracking.
**Target**: Detect when container configuration changes (image update, env var change, port mapping change).

**Implementation**:

- Store container configuration snapshots on each agent report
- Diff against previous snapshot and generate change events
- Alert on unexpected configuration changes
- Show change history in the container detail page

---

## Quick Wins (Can Ship First)

1. **Add Docker monitor type** — Add the enum value, category, and props (no collection yet, but enables the UI scaffolding)
2. **Basic container discovery** — Extend InfrastructureAgent to list running containers and report names, images, status
3. **Container CPU/memory metrics** — Collect basic cgroup stats via Docker stats API
4. **Container inventory page** — Simple table showing discovered containers across hosts

---

## Recommended Implementation Order

1. **Phase 1.1** — Docker monitor type (enum, UI scaffolding)
2. **Phase 1.2** — Container metrics collection in InfrastructureAgent
3. **Phase 1.3** — Container inventory & discovery
4. **Phase 3.1** — Container overview dashboard (list + detail pages)
5. **Phase 1.4** — Container lifecycle events
6. **Phase 2.1** — Container health check monitoring
7. **Phase 2.2** — Container resource threshold alerts
8. **Phase 4.1** — Automatic container log collection
9. **Phase 5.1** — Docker Compose project grouping
10. **Phase 2.3** — Container auto-restart detection
11. **Phase 3.2** — Container map / topology view
12. **Phase 4.2** — Container log correlation
13. **Phase 5.2** — Docker Swarm monitoring
14. **Phase 6.1** — Container image analysis
15. **Phase 6.2** — Container resource recommendations
16. **Phase 6.3** — Container diff / change detection

## Verification

For each feature:
1. Unit tests for new Docker metric collection, parsing, and criteria evaluation
2. Integration tests for container discovery, metric ingestion, and alerting APIs
3. Manual verification with a Docker host running multiple containers (various states: healthy, unhealthy, restarting, OOM)
4. Test with Docker Compose multi-service applications
5. Performance test: verify agent overhead is minimal (< 1% CPU) when monitoring 50+ containers
6. Verify container metrics accuracy by comparing agent-reported values to `docker stats` output
7. Test graceful handling of Docker daemon unavailability (agent should not crash, should report connection failure)
