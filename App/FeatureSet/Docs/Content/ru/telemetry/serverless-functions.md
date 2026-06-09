# Бессерверные функции

## Обзор

OneUptime автоматически распознаёт **бессерверную функцию** в тот момент, когда получает данные OpenTelemetry, помеченные ресурсным атрибутом `faas.name`. Создавать ничего вручную не нужно — инструментируйте свою функцию с помощью OpenTelemetry SDK для вашей среды выполнения, направьте её экспортёр OTLP на OneUptime, и функция появится в разделе **Serverless Functions** вместе со своими трассировками, логами и метриками.

Это работает для AWS Lambda, Google Cloud Functions, Azure Functions, Cloudflare Workers или любой среды выполнения FaaS, способной отправлять OpenTelemetry.

## Предварительные требования

- **Токен приёма телеметрии OneUptime** — создайте его в разделе *Project Settings → Telemetry Ingestion Keys* и скопируйте значение `x-oneuptime-token`.
- OpenTelemetry SDK (или слой автоматической инструментации) для языка вашей функции.

## Как OneUptime идентифицирует функцию

OneUptime определяет каждую функцию по ресурсному атрибуту `faas.name`:

| Атрибут | Обязательный | Назначение |
|---|---|---|
| `faas.name` | **да** | Идентичность функции (например, `checkout-handler`) |
| `faas.version` | нет | Отображается в обзоре |
| `faas.instance` | нет | Отслеживается по экземплярам на вкладке **Instances** |
| `cloud.platform` | нет | `aws_lambda`, `gcp_cloud_functions`, `azure_functions`, ... |
| `cloud.provider` / `cloud.region` / `cloud.account.id` | нет | Отображается в обзоре |

> Функция, которая также задаёт `service.name`, по-прежнему появляется и в разделе **Services**. Представление **Serverless Functions** — это ракурс, ориентированный на FaaS и ограниченный по `faas.name`.

## Шаг 1 — Задайте переменные окружения экспортёра OTLP

Большинство автоматических инструментаций для разных языков учитывают стандартные переменные окружения OpenTelemetry:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
OTEL_RESOURCE_ATTRIBUTES="faas.name=checkout-handler,faas.version=1.4.2"
```

Если вы используете самостоятельно размещённый OneUptime, замените конечную точку на `https://YOUR-ONEUPTIME-HOST/otlp`.

## Шаг 2 — (AWS Lambda) добавьте слой OpenTelemetry

Для AWS Lambda самый простой путь — это [слой OpenTelemetry для Lambda](https://opentelemetry.io/docs/faas/lambda-auto/). Подключите слой для вашей среды выполнения и задайте:

```bash
AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler
OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
```

Слой автоматически задаёт `faas.name` на основе имени функции, а детектор ресурсов заполняет `cloud.platform`, `cloud.region` и `cloud.account.id`.

## Что вы получаете

Как только функция отправит спан, лог или метрику, она появляется в разделе **Serverless Functions**. В обзоре отображаются:

- **Invocations**, **error rate** и **p95 duration** — выводятся из ваших трассировок за выбираемый интервал времени, с графиками трендов.
- **Instances** — текущее количество увиденных значений `faas.instance`.
- Полноценные вкладки **Logs**, **Traces** и **Metrics**, ограниченные этой функцией.

Вы также можете автоматически применять метки и владельцев через *Serverless → Settings → Label Rules / Owner Rules*.
