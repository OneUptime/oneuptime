# Cloud-miljøer

## Oversigt

OneUptime grupperer administreret cloud-compute i **Cloud-miljøer** — AWS ECS / Fargate, Google Cloud Run, Azure Container Apps / Container Instances, AWS Elastic Beanstalk, AWS App Runner og Azure App Service. Der oprettes ét miljø pr. unik kombination af `cloud.platform` + `cloud.account.id` + `cloud.region`, så noget i stil med *"AWS ECS · us-east-1 · 123456789012"* er en enkelt enhed, der samler alle workloads, der kører på den.

Rene virtuelle maskiner (EC2, Compute Engine, Azure VM) forbliver **Hosts**, og Kubernetes hører fortsat under **Kubernetes**. Denne visning er specifikt til administreret / PaaS-compute.

## Forudsætninger

- En **OneUptime Telemetry Ingestion Token** — opret en fra *Project Settings → Telemetry Ingestion Keys*.
- En OpenTelemetry Collector eller SDK, der kører i eller sammen med dine workloads.

## Sådan identificerer OneUptime et miljø

| Attribut | Påkrævet | Formål |
|---|---|---|
| `cloud.platform` | **ja** | Skal være en administreret compute-platform (f.eks. `aws_ecs`, `gcp_cloud_run`, `azure_container_apps`) |
| `cloud.account.id` | nej | En del af miljønøglen |
| `cloud.region` | nej | En del af miljønøglen |
| `service.instance.id` | nej | Spores pr. task/instans under **Instances** (med live CPU / hukommelse) |

Disse udfyldes normalt automatisk af OpenTelemetry **resource-detektorerne**.

## Trin 1 — Aktivér cloud-resource-detektoren

I OpenTelemetry Collector tilføjes `resourcedetection`-processoren:

```yaml
processors:
  resourcedetection:
    detectors: [env, ecs]   # use [gcp] on Cloud Run, [azure] on Azure
    timeout: 5s
```

Med en SDK skal du i stedet sætte `OTEL_RESOURCE_DETECTORS`:

```bash
OTEL_RESOURCE_DETECTORS=env,ecs
```

## Trin 2 — Eksportér OTLP til OneUptime

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

Hvis du selv hoster OneUptime, skal du bruge `https://YOUR-ONEUPTIME-HOST/otlp`.

## Hvad du får

Miljøoversigten viser:

- **CPU** og **Hukommelse** pr. kørende task/instans (fra `container.cpu.utilization` / `container.memory.usage`), plus en **Top instances by CPU**-liste.
- **Instances** — et live-antal af tasks.
- **Requests** og trenddiagrammer udledt fra dine traces.
- Komplette faner for **Logs**, **Traces**, **Metrics** og **Instances**.

Opdeling pr. service for de samme workloads er tilgængelig under **Services**.
