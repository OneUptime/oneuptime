# Skymiljoer

## Oversikt

OneUptime grupperer administrert skybasert databehandling i **skymiljoer** (Cloud Environments) — AWS ECS / Fargate, Google Cloud Run, Azure Container Apps / Container Instances, AWS Elastic Beanstalk, AWS App Runner og Azure App Service. Det opprettes ett miljo per unik kombinasjon av `cloud.platform` + `cloud.account.id` + `cloud.region`, slik at noe som _"AWS ECS · us-east-1 · 123456789012"_ er en enkelt enhet som aggregerer alle arbeidsbelastninger som kjorer pa den.

Rene virtuelle maskiner (EC2, Compute Engine, Azure VM) forblir **verter** (Hosts), og Kubernetes ligger fortsatt under **Kubernetes**. Denne visningen er spesifikt for administrert / PaaS-databehandling.

## Forutsetninger

- En **OneUptime Telemetry Ingestion Token** — opprett en fra _Project Settings → Telemetry Ingestion Keys_.
- En OpenTelemetry Collector eller SDK som kjorer i eller ved siden av arbeidsbelastningene dine.

## Hvordan OneUptime identifiserer et miljo

| Attributt             | Pakrevd | Formal                                                                                                            |
| --------------------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| `cloud.platform`      | **ja**  | Ma vaere en plattform for administrert databehandling (f.eks. `aws_ecs`, `gcp_cloud_run`, `azure_container_apps`) |
| `cloud.account.id`    | nei     | Del av miljonokkelen                                                                                              |
| `cloud.region`        | nei     | Del av miljonokkelen                                                                                              |
| `service.instance.id` | nei     | Sporet per oppgave/instans under **Instanser** (med direkte CPU / minne)                                          |

Disse fylles normalt ut automatisk av OpenTelemetrys **ressursdetektorer** (resource detectors).

## Trinn 1 — Aktiver skyressursdetektoren

I OpenTelemetry Collector legger du til `resourcedetection`-prosessoren:

```yaml
processors:
  resourcedetection:
    detectors: [env, ecs] # use [gcp] on Cloud Run, [azure] on Azure
    timeout: 5s
```

Med en SDK setter du `OTEL_RESOURCE_DETECTORS` i stedet:

```bash
OTEL_RESOURCE_DETECTORS=env,ecs
```

## Trinn 2 — Eksporter OTLP til OneUptime

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

Hvis du selv hoster OneUptime, bruker du `https://YOUR-ONEUPTIME-HOST/otlp`.

## Hva du far

Miljooversikten viser:

- **CPU** og **minne** per oppgave/instans som kjorer (fra `container.cpu.utilization` / `container.memory.usage`), pluss en liste over **Topp-instanser etter CPU**.
- **Instanser** — en direkte telling av oppgaver.
- **Foresporsler** og trenddiagrammer utledet fra sporene dine.
- Fullstendige faner for **Logger**, **Spor**, **Metrikker** og **Instanser**.

Fordeling per tjeneste for de samme arbeidsbelastningene er tilgjengelig under **Tjenester**.
