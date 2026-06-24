# Мониторинг реальных пользователей (браузер и мобильные устройства)

## Обзор

OneUptime классифицирует входящую телеметрию как **RUM**, когда она содержит клиентские атрибуты — `browser.*` для веба или `device.*` для мобильных устройств. Каждое приложение идентифицируется по своему `service.name` и полностью принадлежит своему RUM-приложению (клиентская телеметрия никогда не дублируется как серверный Service).

Используйте его, чтобы увидеть, что на самом деле испытывают ваши пользователи: просмотры страниц, ошибки, задержки, используемые платформы / устройства и — когда ваш SDK их передаёт — Core Web Vitals.

## Предварительные требования

- **Токен приёма телеметрии OneUptime** — создайте его в разделе _Project Settings → Telemetry Ingestion Keys_.
- Браузерный или мобильный SDK OpenTelemetry.

## Как OneUptime идентифицирует RUM-приложение

| Атрибут                  | Обязательно   | Назначение                                           |
| ------------------------ | ------------- | ---------------------------------------------------- |
| `service.name`           | **да**        | Идентичность приложения (например, `storefront-web`) |
| `browser.*`              | для веба      | Помечает телеметрию как браузерный RUM               |
| `device.*`               | для мобильных | Помечает телеметрию как мобильный RUM                |
| `telemetry.sdk.language` | нет           | Например, `webjs`, `swift`, отображается в обзоре    |

## Браузер (OpenTelemetry Web)

Направьте экспортёр OTLP/HTTP на OneUptime и задайте в `service.name` имя вашего приложения:

```js
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

// OneUptime OTLP/HTTP exporter:
const exporter = new OTLPTraceExporter({
  url: "https://oneuptime.com/otlp/v1/traces",
  headers: { "x-oneuptime-token": "YOUR_TELEMETRY_INGESTION_TOKEN" },
});

// Register `exporter` with your WebTracerProvider, using a resource of:
//   { "service.name": "storefront-web" }
```

Браузерная инструментация автоматически добавляет ресурсные атрибуты `browser.*` — именно это направляет данные в RUM.

## Мобильные устройства (Swift / Android)

Используйте SDK OpenTelemetry для Swift или Android, задайте `service.name` и экспортируйте OTLP в OneUptime:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
```

Атрибуты `device.*` из SDK направляют телеметрию в RUM. Если вы используете самостоятельно размещённый OneUptime, используйте `https://YOUR-ONEUPTIME-HOST/otlp`.

## Core Web Vitals

Если ваша браузерная инструментация передаёт web vitals (LCP, INP, CLS, FCP, TTFB) как метрики OpenTelemetry, OneUptime отображает их в обзоре приложения с оценками good / needs-improvement / poor. Если метрики web vitals не передаются, панель объясняет, как начать их отправлять.

## Что вы получаете

- **Просмотры страниц**, **частота ошибок** и **длительность p95** с графиками трендов за выбираемый период.
- **Клиенты** — обнаруженные браузерные платформы / модели устройств.
- **Core Web Vitals** (когда передаются).
- Полные вкладки **Logs**, **Traces** и **Metrics**, ограниченные областью приложения.
