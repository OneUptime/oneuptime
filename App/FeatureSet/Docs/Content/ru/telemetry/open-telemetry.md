# Интеграция OpenTelemetry (журналы, метрики и трассировки) с OneUptime.

### Шаг 1 — Создание токена приёма телеметрии.

После создания учётной записи OneUptime создайте токен приёма телеметрии для приёма журналов, метрик и трассировок от вашего приложения.

После регистрации в OneUptime и создания проекта нажмите «Ещё» в панели навигации и выберите «Настройки проекта».

На странице ключей приёма телеметрии нажмите «Создать ключ приёма» для создания токена.

![Создание сервиса](/docs/static/images/TelemetryIngestionKeys.png)

После создания токена нажмите «Просмотреть» для его отображения.

![Просмотр сервиса](/docs/static/images/TelemetryIngestionKeyView.png)

### Шаг 2

#### Настройка телеметрического сервиса в вашем приложении.

#### Журналы приложений

Для сбора журналов приложений мы используем OpenTelemetry. OneUptime в настоящее время поддерживает приём журналов из следующих SDK OpenTelemetry. Следуйте инструкциям по настройке телеметрического сервиса в вашем приложении.

- [C++](https://opentelemetry.io/docs/instrumentation/cpp/)
- [Go](https://opentelemetry.io/docs/instrumentation/go/)
- [Java](https://opentelemetry.io/docs/instrumentation/java/)
- [JavaScript / TypeScript / NodeJS / Браузер](https://opentelemetry.io/docs/instrumentation/js/)
- [Python](https://opentelemetry.io/docs/instrumentation/python/)
- [Ruby](https://opentelemetry.io/docs/instrumentation/ruby/)
- [PHP](https://opentelemetry.io/docs/instrumentation/php/)
- [Erlang](https://opentelemetry.io/docs/instrumentation/erlang/)
- [Rust](https://opentelemetry.io/docs/instrumentation/rust/)
- [.NET / C#](https://opentelemetry.io/docs/instrumentation/net/)
- [Swift](https://opentelemetry.io/docs/instrumentation/swift/)

**Интеграция с OneUptime**

После настройки телеметрического сервиса в вашем приложении выполните интеграцию с OneUptime, установив следующие переменные среды.

| Переменная среды            | Значение                                       |
| --------------------------- | ---------------------------------------------- |
| OTEL_EXPORTER_OTLP_HEADERS  | x-oneuptime-token=YOUR_ONEUPTIME_SERVICE_TOKEN |
| OTEL_EXPORTER_OTLP_ENDPOINT | https://oneuptime.com/otlp                     |
| OTEL_SERVICE_NAME           | NAME_OF_YOUR_SERVICE                           |

**Пример**

```bash
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=9c8806e0-a4aa-11ee-be95-010d5967b068
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_SERVICE_NAME=my-service
```

**Самостоятельный хостинг OneUptime**

При самостоятельном хостинге значение можно изменить на вашу конечную точку коллектора OpenTelemetry (например: `http(s)://YOUR-ONEUPTIME-HOST/otlp`)

После запуска приложения журналы должны появиться на странице телеметрического сервиса OneUptime. При необходимости помощи обращайтесь по адресу support@oneuptime.com

#### Использование коллектора OpenTelemetry

Вместо прямой отправки телеметрических данных из приложения можно использовать коллектор OpenTelemetry.
При использовании коллектора OpenTelemetry настройте экспортёр OneUptime в конфигурационном файле коллектора.

Пример конфигурации коллектора OpenTelemetry:

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

exporters:
  # Экспорт через HTTP
  otlphttp:
    endpoint: "https://oneuptime.com/otlp"
    # Требует использования JSON-кодировщика вместо Proto(buf) по умолчанию
    encoding: json
    headers:
      "Content-Type": "application/json"
      "x-oneuptime-token": "ONEUPTIME_TOKEN" # Ваш токен OneUptime

service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [otlphttp]
    metrics:
      receivers: [otlp]
      exporters: [otlphttp]
    logs:
      receivers: [otlp]
      exporters: [otlphttp]
```
