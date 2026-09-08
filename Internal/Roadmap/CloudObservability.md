# Cloud Observability (managed cloud compute)

Roadmap for the **Cloud** product: the dashboard section that groups managed
cloud compute — AWS ECS / Fargate, Google Cloud Run, Azure Container Apps,
Elastic Beanstalk, App Runner, App Engine, App Service, Container Instances —
into **Cloud Environments** (one per `cloud.platform` + `cloud.account.id` +
`cloud.region`) discovered from OpenTelemetry resource attributes.

Related: [NetworkObservability.md](./NetworkObservability.md) for the same
shape of document on the network pillar; issue
[#3658](https://github.com/OneUptime/oneuptime/issues/3658) for the docs gap
that triggered the baseline audit below.

## Shipped baseline

What exists after the "cloud observability improvements" change set.

### Discovery and identity

- Ingest gate, environment key and display name come from one registry,
  `Common/Types/Cloud/CloudPlatform.ts` (`MANAGED_CLOUD_PLATFORMS`). The
  dashboard create form, the in-app Connect guide, the docs and the tests all
  read the same list, so adding a platform is a one-line change and the
  tests fail by name when a doc page or picker falls behind.
- `cloud.platform` values are normalised before the gate: the Node and .NET
  Azure detectors emit dotted `azure.container_apps` / `azure.app_service`
  where semconv (and the collector) say `azure_container_apps` /
  `azure_app_service`. Both spellings land on the same environment.
- Instance identity falls back through
  `Common/Utils/Telemetry/CloudInstanceIdentity.ts`:
  `aws.ecs.task.id` → `aws.ecs.task.arn` (shortened to the task id) →
  `faas.instance` → `azure.container_app.instance.id` →
  `service.instance.id` → `container.id` → `host.id` → `host.name`. The
  platform's identity precedes `service.instance.id` so an SDK-minted
  per-process id cannot split a task away from the sidecar's metrics.
  Before this the Instances tab of an ECS environment stayed empty
  because the ECS detector never sets `service.instance.id`.
- The CPU / memory snapshot fold understands the `awsecscontainermetrics`
  receiver (`ecs.task.cpu.utilized` %, `ecs.task.memory.utilized` MiB,
  `ecs.task.memory.usage` bytes, and the `container.*` equivalents) as well
  as `docker_stats`-style `container.cpu.utilization` /
  `container.memory.usage.total`. Task-level points win over container-level
  points for the same task.
- A hand-created environment carries platform / account / region from the
  create form and gets the same composite key ingest would mint, so the
  first telemetry batch attaches to it instead of creating a duplicate.

### Lifecycle

- `Cloud:CleanupStaleResources` (every 5 minutes) flips environments to
  Disconnected after 15 minutes of silence and prunes instance rows not seen
  for `CLOUD_INSTANCE_STALE_MINUTES` (default 15, minimum 10), anchored to
  the environment's own `lastSeenAt` so an outage freezes rather than wipes
  the last-known inventory. `Serverless:CleanupStaleResources` does the same
  for functions. Neither `markDisconnected*` method had a scheduled caller
  before.

### Dashboard

- List page: fleet summary strip (environments, connected, per provider,
  live instances); provider and friendly platform columns.
- Environment view: Overview with CPU / memory / live instances / requests /
  error rate / p95 tiles, a "waiting for telemetry" banner until the first
  batch arrives, Instances with formatted CPU / memory and a Running / Stale
  status, Owners (owner rules assigned owners for months with no page to see
  them), Feed, Logs / Traces / Metrics scoped strictly to the environment's
  `resource.cloud.*` attributes (an unscoped environment no longer shows the
  whole project's telemetry), and a platform-aware Connect guide.

### Docs

- `/docs/telemetry/cloud-environments` is the hub; per-platform end-to-end
  walkthroughs (console navigation, SDK-direct and sidecar-collector shapes,
  a full ECS Task Definition, a Cloud Run service YAML with a sidecar, the
  Azure CLI flow, IAM and networking) live at `cloud-aws-ecs`,
  `cloud-gcp-cloud-run`, `cloud-azure-container-apps`,
  `cloud-other-platforms`, with `cloud-troubleshooting` for the symptoms
  support sees most. `App/Tests/FeatureSet/Docs/CloudEnvironmentDocs.test.ts`
  pins the pages to the registry and the identity chain.

## Remaining epics

Ordered by how often the gap has come up. Sizes are rough engineer-weeks.

### E1 — Incidents, alerts and maintenance on an environment (size 2)

Kubernetes clusters can be attached to incidents, alerts and scheduled
maintenance (`Incident.kubernetesClusters` etc.) and get badge counts in the
side menu. Cloud environments cannot. Needs the three many-to-many columns
on Incident / Alert / ScheduledMaintenance, migrations, the side-menu
`CountModelSideMenuItem`s, and the status-page resource picker.

Open question: attach at the environment level only, or also allow the
Service rows that run on it (the per-service breakdown) to inherit the
environment's incidents?

### E2 — Metric monitors from the overview (size 1)

"Alert when p95 on this environment exceeds X" is a metric monitor with the
environment's `resource.cloud.*` filters pre-filled. A "Create alert" quick
link on the overview that deep-links into the monitor create form with
those filters (and the span-derived error-rate query) covers most of the
value without a new monitor type.

### E3 — Cloud-provider metrics without a sidecar (size 3)

Cloud Run and App Runner expose no container stats inside the container, so
the CPU / memory tiles stay empty unless the user runs a collector that can
scrape Cloud Monitoring / CloudWatch. A pull-based receiver on the OneUptime
side (Cloud Monitoring API for GCP, CloudWatch Container Insights for ECS)
would need per-project cloud credentials — the first time this product
would hold cloud credentials at all — and a credential model with the same
scoping story as Telemetry Ingestion Keys.

### E4 — Cost per environment (size 3)

Kubernetes has cost allocation. ECS / Fargate and Cloud Run bill per
vCPU-second and GiB-second, so an environment's cost is derivable from the
same snapshot metrics the Instances tab already stores plus a price table
(like `LlmModelPriceService`). Blocked on E3 for platforms that do not emit
container metrics.

### E5 — Service-level rollup inside an environment (size 1)

The environment aggregates every workload on the platform + account +
region; the per-service breakdown lives under Services with no link back.
An "Services on this environment" card (top N by request volume, each
linking to its Service) closes the loop. The data is already there:
`Span.serviceId` filtered by the environment's `resource.cloud.*`
attributes.

### E6 — Azure managed OpenTelemetry agent path (size 1, docs + verify)

Azure Container Apps can route OTLP from a managed agent
(`az containerapp env telemetry otlp add`) without a sidecar. The agent is
gRPC-only; OneUptime serves OTLP/gRPC through the same host (Nginx proxies
`/opentelemetry.proto.collector*` to the gRPC listener). The docs describe
the flow but it has not been exercised end to end against a real
environment — do that, then promote it from "alternative" to the
recommended path for Container Apps.

## Update cadence

When an epic starts (spin its section into a design doc), when a platform is
added to the registry, or when the shipped baseline changes shape.
