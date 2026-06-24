# Ambientes de Nuvem

## Visão Geral

O OneUptime agrupa a computação gerenciada na nuvem em **Ambientes de Nuvem** — AWS ECS / Fargate, Google Cloud Run, Azure Container Apps / Container Instances, AWS Elastic Beanstalk, AWS App Runner e Azure App Service. Um ambiente é criado por combinação única de `cloud.platform` + `cloud.account.id` + `cloud.region`, de modo que algo como _"AWS ECS · us-east-1 · 123456789012"_ é uma única entidade que agrega todas as cargas de trabalho em execução nele.

Máquinas virtuais puras (EC2, Compute Engine, Azure VM) permanecem como **Hosts**, e o Kubernetes permanece em **Kubernetes**. Esta visão é especificamente para computação gerenciada / PaaS.

## Pré-requisitos

- Um **Token de Ingestão de Telemetria do OneUptime** — crie um em _Project Settings → Telemetry Ingestion Keys_.
- Um OpenTelemetry Collector ou SDK em execução dentro de/junto com suas cargas de trabalho.

## Como o OneUptime identifica um ambiente

| Atributo              | Obrigatório | Finalidade                                                                                                         |
| --------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------ |
| `cloud.platform`      | **sim**     | Deve ser uma plataforma de computação gerenciada (por exemplo, `aws_ecs`, `gcp_cloud_run`, `azure_container_apps`) |
| `cloud.account.id`    | não         | Parte da chave do ambiente                                                                                         |
| `cloud.region`        | não         | Parte da chave do ambiente                                                                                         |
| `service.instance.id` | não         | Rastreado por tarefa/instância em **Instances** (com CPU / memória ao vivo)                                        |

Esses valores são normalmente preenchidos automaticamente pelos **resource detectors** do OpenTelemetry.

## Passo 1 — Habilite o detector de recursos de nuvem

No OpenTelemetry Collector, adicione o processador `resourcedetection`:

```yaml
processors:
  resourcedetection:
    detectors: [env, ecs] # use [gcp] on Cloud Run, [azure] on Azure
    timeout: 5s
```

Com um SDK, defina `OTEL_RESOURCE_DETECTORS` em vez disso:

```bash
OTEL_RESOURCE_DETECTORS=env,ecs
```

## Passo 2 — Exporte OTLP para o OneUptime

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

Se você hospeda o OneUptime por conta própria, use `https://YOUR-ONEUPTIME-HOST/otlp`.

## O que você obtém

A visão geral do ambiente mostra:

- **CPU** e **Memória** por tarefa/instância em execução (a partir de `container.cpu.utilization` / `container.memory.usage`), além de uma lista **Top instances by CPU**.
- **Instances** — uma contagem ao vivo de tarefas.
- **Requests** e gráficos de tendência derivados dos seus traces.
- Abas completas de **Logs**, **Traces**, **Metrics** e **Instances**.

A análise detalhada por serviço para as mesmas cargas de trabalho está disponível em **Services**.
