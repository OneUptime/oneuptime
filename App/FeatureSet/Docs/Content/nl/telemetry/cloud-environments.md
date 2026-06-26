# Cloud-omgevingen

## Overzicht

OneUptime groepeert beheerde cloud-compute in **Cloud-omgevingen** — AWS ECS / Fargate, Google Cloud Run, Azure Container Apps / Container Instances, AWS Elastic Beanstalk, AWS App Runner en Azure App Service. Er wordt één omgeving aangemaakt per unieke combinatie van `cloud.platform` + `cloud.account.id` + `cloud.region`, dus iets als _"AWS ECS · us-east-1 · 123456789012"_ is één entiteit die elke workload aggregeert die erop draait.

Onbewerkte virtuele machines (EC2, Compute Engine, Azure VM) blijven **Hosts**, en Kubernetes blijft onder **Kubernetes** vallen. Deze weergave is specifiek voor beheerde / PaaS-compute.

## Vereisten

- Een **OneUptime Telemetry Ingestion Token** — maak er een aan via _Project Settings → Telemetry Ingestion Keys_.
- Een OpenTelemetry Collector of SDK die in/naast je workloads draait.

## Hoe OneUptime een omgeving identificeert

| Attribuut             | Vereist | Doel                                                                                              |
| --------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| `cloud.platform`      | **ja**  | Moet een beheerd-compute-platform zijn (bijv. `aws_ecs`, `gcp_cloud_run`, `azure_container_apps`) |
| `cloud.account.id`    | nee     | Onderdeel van de omgevingssleutel                                                                 |
| `cloud.region`        | nee     | Onderdeel van de omgevingssleutel                                                                 |
| `service.instance.id` | nee     | Per taak/instance bijgehouden onder **Instances** (met live CPU / geheugen)                       |

Deze worden normaal gesproken automatisch ingevuld door de OpenTelemetry **resource detectors**.

## Stap 1 — Schakel de cloud resource detector in

Voeg in de OpenTelemetry Collector de `resourcedetection`-processor toe:

```yaml
processors:
  resourcedetection:
    detectors: [env, ecs] # use [gcp] on Cloud Run, [azure] on Azure
    timeout: 5s
```

Stel bij een SDK in plaats daarvan `OTEL_RESOURCE_DETECTORS` in:

```bash
OTEL_RESOURCE_DETECTORS=env,ecs
```

## Stap 2 — Exporteer OTLP naar OneUptime

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

Als je OneUptime zelf host, gebruik dan `https://YOUR-ONEUPTIME-HOST/otlp`.

## Wat je krijgt

Het omgevingsoverzicht toont:

- **CPU** en **Geheugen** per draaiende taak/instance (uit `container.cpu.utilization` / `container.memory.usage`), plus een lijst **Top instances by CPU**.
- **Instances** — een live telling van taken.
- **Requests** en trendgrafieken afgeleid van je traces.
- Volledige tabbladen **Logs**, **Traces**, **Metrics** en **Instances**.

Een uitsplitsing per service voor dezelfde workloads is beschikbaar onder **Services**.
