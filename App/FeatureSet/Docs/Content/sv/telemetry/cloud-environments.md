# Molnmiljöer

## Översikt

OneUptime grupperar hanterad molnberäkning i **Molnmiljöer** — AWS ECS / Fargate, Google Cloud Run, Azure Container Apps / Container Instances, AWS Elastic Beanstalk, AWS App Runner och Azure App Service. En miljö skapas per unik kombination av `cloud.platform` + `cloud.account.id` + `cloud.region`, så något i stil med _"AWS ECS · us-east-1 · 123456789012"_ är en enda enhet som aggregerar varje arbetsbelastning som körs på den.

Rena virtuella maskiner (EC2, Compute Engine, Azure VM) förblir **Värdar**, och Kubernetes ligger kvar under **Kubernetes**. Den här vyn är specifikt avsedd för hanterad / PaaS-beräkning.

## Förutsättningar

- En **OneUptime-token för telemetriinmatning** — skapa en från _Project Settings → Telemetry Ingestion Keys_.
- En OpenTelemetry Collector eller SDK som körs i eller bredvid dina arbetsbelastningar.

## Hur OneUptime identifierar en miljö

| Attribut              | Krävs  | Syfte                                                                                                     |
| --------------------- | ------ | --------------------------------------------------------------------------------------------------------- |
| `cloud.platform`      | **ja** | Måste vara en plattform för hanterad beräkning (t.ex. `aws_ecs`, `gcp_cloud_run`, `azure_container_apps`) |
| `cloud.account.id`    | nej    | Del av miljönyckeln                                                                                       |
| `cloud.region`        | nej    | Del av miljönyckeln                                                                                       |
| `service.instance.id` | nej    | Spåras per uppgift/instans under **Instanser** (med live-CPU / minne)                                     |

Dessa fylls normalt i automatiskt av OpenTelemetrys **resursdetektorer**.

## Steg 1 — Aktivera molnresursdetektorn

Lägg till `resourcedetection`-processorn i OpenTelemetry Collector:

```yaml
processors:
  resourcedetection:
    detectors: [env, ecs] # use [gcp] on Cloud Run, [azure] on Azure
    timeout: 5s
```

Med en SDK anger du i stället `OTEL_RESOURCE_DETECTORS`:

```bash
OTEL_RESOURCE_DETECTORS=env,ecs
```

## Steg 2 — Exportera OTLP till OneUptime

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

Om du själv är värd för OneUptime använder du `https://YOUR-ONEUPTIME-HOST/otlp`.

## Vad du får

Miljööversikten visar:

- **CPU** och **Minne** per körande uppgift/instans (från `container.cpu.utilization` / `container.memory.usage`), plus en lista över **Toppinstanser efter CPU**.
- **Instanser** — ett live-antal uppgifter.
- **Förfrågningar** och trenddiagram härledda från dina spår.
- Fullständiga flikar för **Loggar**, **Spår**, **Mätvärden** och **Instanser**.

Uppdelning per tjänst för samma arbetsbelastningar finns under **Tjänster**.
