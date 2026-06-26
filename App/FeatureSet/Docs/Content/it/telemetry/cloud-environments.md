# Ambienti Cloud

## Panoramica

OneUptime raggruppa il calcolo cloud gestito in **Ambienti Cloud** — AWS ECS / Fargate, Google Cloud Run, Azure Container Apps / Container Instances, AWS Elastic Beanstalk, AWS App Runner e Azure App Service. Viene creato un ambiente per ogni combinazione univoca di `cloud.platform` + `cloud.account.id` + `cloud.region`, quindi qualcosa come _"AWS ECS · us-east-1 · 123456789012"_ è una singola entità che aggrega ogni carico di lavoro in esecuzione su di essa.

Le macchine virtuali pure (EC2, Compute Engine, Azure VM) rimangono **Host**, e Kubernetes resta sotto **Kubernetes**. Questa vista è specifica per il calcolo gestito / PaaS.

## Prerequisiti

- Un **Token di Ingestione Telemetria OneUptime** — creane uno da _Impostazioni Progetto → Chiavi di Ingestione Telemetria_.
- Un OpenTelemetry Collector o SDK in esecuzione all'interno o insieme ai tuoi carichi di lavoro.

## Come OneUptime identifica un ambiente

| Attributo             | Obbligatorio | Scopo                                                                                                   |
| --------------------- | ------------ | ------------------------------------------------------------------------------------------------------- |
| `cloud.platform`      | **sì**       | Deve essere una piattaforma di calcolo gestito (es. `aws_ecs`, `gcp_cloud_run`, `azure_container_apps`) |
| `cloud.account.id`    | no           | Parte della chiave dell'ambiente                                                                        |
| `cloud.region`        | no           | Parte della chiave dell'ambiente                                                                        |
| `service.instance.id` | no           | Tracciato per task/istanza sotto **Istanze** (con CPU / memoria in tempo reale)                         |

Questi vengono normalmente compilati automaticamente dai **rilevatori di risorse** di OpenTelemetry.

## Passaggio 1 — Abilita il rilevatore di risorse cloud

Nell'OpenTelemetry Collector, aggiungi il processore `resourcedetection`:

```yaml
processors:
  resourcedetection:
    detectors: [env, ecs] # use [gcp] on Cloud Run, [azure] on Azure
    timeout: 5s
```

Con un SDK, imposta invece `OTEL_RESOURCE_DETECTORS`:

```bash
OTEL_RESOURCE_DETECTORS=env,ecs
```

## Passaggio 2 — Esporta OTLP verso OneUptime

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

Se ospiti OneUptime autonomamente, usa `https://YOUR-ONEUPTIME-HOST/otlp`.

## Cosa ottieni

La panoramica dell'ambiente mostra:

- **CPU** e **Memoria** per task/istanza in esecuzione (da `container.cpu.utilization` / `container.memory.usage`), oltre a un elenco **Top istanze per CPU**.
- **Istanze** — un conteggio in tempo reale dei task.
- **Richieste** e grafici di tendenza derivati dalle tue tracce.
- Schede complete **Logs**, **Traces**, **Metrics** e **Istanze**.

La suddivisione per servizio per gli stessi carichi di lavoro è disponibile sotto **Servizi**.
