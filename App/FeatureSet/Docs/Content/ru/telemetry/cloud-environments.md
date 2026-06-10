# Облачные среды

## Обзор

OneUptime группирует управляемые облачные вычислительные ресурсы в **Облачные среды** — AWS ECS / Fargate, Google Cloud Run, Azure Container Apps / Container Instances, AWS Elastic Beanstalk, AWS App Runner и Azure App Service. Одна среда создаётся для каждой уникальной комбинации `cloud.platform` + `cloud.account.id` + `cloud.region`, поэтому нечто вроде *«AWS ECS · us-east-1 · 123456789012»* является единой сущностью, которая агрегирует все рабочие нагрузки, выполняющиеся на ней.

Чистые виртуальные машины (EC2, Compute Engine, Azure VM) остаются **Хостами**, а Kubernetes относится к разделу **Kubernetes**. Это представление предназначено именно для управляемых / PaaS вычислений.

## Предварительные требования

- **Токен приёма телеметрии OneUptime** — создайте его в *Настройки проекта → Ключи приёма телеметрии*.
- OpenTelemetry Collector или SDK, работающий внутри или рядом с вашими рабочими нагрузками.

## Как OneUptime определяет среду

| Атрибут | Обязательно | Назначение |
|---|---|---|
| `cloud.platform` | **да** | Должен быть платформой управляемых вычислений (например, `aws_ecs`, `gcp_cloud_run`, `azure_container_apps`) |
| `cloud.account.id` | нет | Часть ключа среды |
| `cloud.region` | нет | Часть ключа среды |
| `service.instance.id` | нет | Отслеживается для каждой задачи/экземпляра в разделе **Экземпляры** (с актуальными данными CPU / памяти) |

Они обычно заполняются автоматически с помощью **детекторов ресурсов** OpenTelemetry.

## Шаг 1 — Включите детектор облачных ресурсов

В OpenTelemetry Collector добавьте процессор `resourcedetection`:

```yaml
processors:
  resourcedetection:
    detectors: [env, ecs]   # use [gcp] on Cloud Run, [azure] on Azure
    timeout: 5s
```

При использовании SDK задайте вместо этого `OTEL_RESOURCE_DETECTORS`:

```bash
OTEL_RESOURCE_DETECTORS=env,ecs
```

## Шаг 2 — Экспортируйте OTLP в OneUptime

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

Если вы размещаете OneUptime самостоятельно, используйте `https://YOUR-ONEUPTIME-HOST/otlp`.

## Что вы получаете

Обзор среды показывает:

- **CPU** и **Память** по каждой выполняющейся задаче/экземпляру (из `container.cpu.utilization` / `container.memory.usage`), а также список **Топ экземпляров по CPU**.
- **Экземпляры** — актуальное количество задач.
- **Запросы** и графики трендов, полученные из ваших трейсов.
- Полные вкладки **Логи**, **Трейсы**, **Метрики** и **Экземпляры**.

Разбивка по сервисам для тех же рабочих нагрузок доступна в разделе **Сервисы**.
