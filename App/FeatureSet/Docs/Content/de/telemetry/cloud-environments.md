# Cloud-Umgebungen

## Überblick

OneUptime fasst verwaltete Cloud-Compute-Ressourcen in **Cloud-Umgebungen** zusammen — AWS ECS / Fargate, Google Cloud Run, Azure Container Apps / Container Instances, AWS Elastic Beanstalk, AWS App Runner und Azure App Service. Pro eindeutiger Kombination aus `cloud.platform` + `cloud.account.id` + `cloud.region` wird eine Umgebung erstellt, sodass etwa *"AWS ECS · us-east-1 · 123456789012"* eine einzelne Entität ist, die jeden darauf laufenden Workload aggregiert.

Reine virtuelle Maschinen (EC2, Compute Engine, Azure VM) bleiben **Hosts**, und Kubernetes verbleibt unter **Kubernetes**. Diese Ansicht ist speziell für verwaltete / PaaS-Compute-Ressourcen gedacht.

## Voraussetzungen

- Ein **OneUptime Telemetry Ingestion Token** — erstellen Sie eines unter *Project Settings → Telemetry Ingestion Keys*.
- Ein OpenTelemetry Collector oder SDK, das in oder neben Ihren Workloads läuft.

## Wie OneUptime eine Umgebung identifiziert

| Attribut | Erforderlich | Zweck |
|---|---|---|
| `cloud.platform` | **ja** | Muss eine Managed-Compute-Plattform sein (z. B. `aws_ecs`, `gcp_cloud_run`, `azure_container_apps`) |
| `cloud.account.id` | nein | Teil des Umgebungsschlüssels |
| `cloud.region` | nein | Teil des Umgebungsschlüssels |
| `service.instance.id` | nein | Pro Task/Instanz unter **Instances** erfasst (mit Live-CPU / -Speicher) |

Diese werden normalerweise automatisch durch die OpenTelemetry **Resource Detectors** befüllt.

## Schritt 1 — Cloud-Resource-Detector aktivieren

Fügen Sie im OpenTelemetry Collector den `resourcedetection`-Processor hinzu:

```yaml
processors:
  resourcedetection:
    detectors: [env, ecs]   # use [gcp] on Cloud Run, [azure] on Azure
    timeout: 5s
```

Mit einem SDK setzen Sie stattdessen `OTEL_RESOURCE_DETECTORS`:

```bash
OTEL_RESOURCE_DETECTORS=env,ecs
```

## Schritt 2 — OTLP an OneUptime exportieren

```yaml
exporters:
  otlphttp/oneuptime:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [resourcedetection]
      exporters: [otlphttp/oneuptime]
    metrics:
      receivers: [otlp]
      processors: [resourcedetection]
      exporters: [otlphttp/oneuptime]
    logs:
      receivers: [otlp]
      processors: [resourcedetection]
      exporters: [otlphttp/oneuptime]
```

Wenn Sie OneUptime selbst hosten, verwenden Sie `https://YOUR-ONEUPTIME-HOST/otlp`.

## Was Sie erhalten

Die Umgebungsübersicht zeigt:

- **CPU** und **Speicher** pro laufender Task/Instanz (aus `container.cpu.utilization` / `container.memory.usage`), plus eine Liste **Top instances by CPU**.
- **Instances** — eine Live-Anzahl der Tasks.
- **Requests** und Trenddiagramme, die aus Ihren Traces abgeleitet werden.
- Vollständige Tabs für **Logs**, **Traces**, **Metrics** und **Instances**.

Eine Aufschlüsselung pro Service für dieselben Workloads ist unter **Services** verfügbar.
