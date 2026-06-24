# Отправка телеметрических данных в OneUptime с помощью FluentBit

## Обзор

Вы можете использовать плагин [FluentBit](https://docs.fluentbit.io/manual) для сбора журналов и телеметрических данных из ваших приложений и сервисов. Плагин отправляет телеметрические данные в коллектор OneUptime OpenTelemetry HTTP. Для отправки данных можно использовать выходной плагин opentelemetry в FluentBit. Плагин доступен здесь: https://docs.fluentbit.io/manual/pipeline/outputs/opentelemetry

## Начало работы

FluentBit поддерживает сотни источников данных, и вы можете передавать журналы и телеметрию из любого из них в OneUptime. Среди наиболее популярных источников:

- Docker
- Syslog
- Apache
- Nginx
- MySQL
- PostgreSQL
- MongoDB
- NodeJS
- Ruby
- Python
- Java
- PHP
- Go
- Rust

и многие другие.

Полный список поддерживаемых источников доступен [здесь](https://docs.fluentbit.io/manual)

## Предварительные требования

- **Шаг 1: Установите FluentBit на вашу систему** — инструкции по установке доступны [здесь](https://docs.fluentbit.io/manual/installation/getting-started-with-fluent-bit)
- **Шаг 2: Зарегистрируйтесь в OneUptime** — вы можете зарегистрировать бесплатный аккаунт [здесь](https://oneuptime.com). Обратите внимание: аккаунт бесплатный, но прием журналов является платной функцией. Подробнее о ценах [здесь](https://oneuptime.com/pricing).
- **Шаг 3: Создайте проект OneUptime** — после регистрации создайте проект на панели управления OneUptime. При необходимости помощи напишите нам по адресу support@oneuptime.com
- **Шаг 4: Создайте токен приёма телеметрии** — после создания учётной записи OneUptime создайте токен приёма телеметрии для приёма журналов, метрик и трассировок от вашего приложения.

После регистрации в OneUptime и создания проекта нажмите «Ещё» в панели навигации и выберите «Настройки проекта».

На странице ключей приёма телеметрии нажмите «Создать ключ приёма» для создания токена.

![Создание сервиса](/docs/static/images/TelemetryIngestionKeys.png)

После создания токена нажмите «Просмотреть» для его отображения.

![Просмотр сервиса](/docs/static/images/TelemetryIngestionKeyView.png)

## Конфигурация

Используйте следующую конфигурацию для отправки телеметрических данных в коллектор OneUptime OpenTelemetry HTTP. Добавьте её в файл конфигурации FluentBit (обычно находится по пути `/etc/fluent-bit/fluent-bit.yaml`). Вот пример раздела outputs конфигурационного файла:

```yaml
outputs:
  - name: stdout
    match: "*"
  - name: opentelemetry
    match: "*"
    host: "oneuptime.com"
    port: 443
    metrics_uri: "/otlp/v1/metrics"
    logs_uri: "/otlp/v1/logs"
    traces_uri: "/otlp/v1/traces"
    tls: On
    header:
      - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
```

Убедитесь, что в разделе inputs присутствует `opentelemetry_envelope`. Пример раздела inputs:

```yaml
pipeline:
  inputs:
    # Ваши inputs

    processors:
      logs:
        - name: opentelemetry_envelope

        - name: content_modifier
          context: otel_resource_attributes
          action: upsert
          key: service.name
          # Замените YOUR_SERVICE_NAME на название вашего сервиса
          value: YOUR_SERVICE_NAME
```

Пример полного конфигурационного файла:

```yaml
service:
  flush: 1
  log_level: info

pipeline:
  inputs:
    - name: http
      listen: 0.0.0.0
      port: 8888

      processors:
        logs:
          - name: opentelemetry_envelope

          - name: content_modifier
            context: otel_resource_attributes
            action: upsert
            key: service.name
            value: YOUR_SERVICE_NAME

  outputs:
    - name: stdout
      match: "*"
    - name: opentelemetry
      match: "*"
      host: "oneuptime.com"
      port: 443
      metrics_uri: "/otlp/v1/metrics"
      logs_uri: "/otlp/v1/logs"
      traces_uri: "/otlp/v1/traces"
      tls: On
      header:
        - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
```

**При самостоятельном хостинге OneUptime**: замените значение `host` на хост вашего экземпляра. Если хостинг на HTTP, а не HTTPS, замените значение `port` соответственно (скорее всего, порт 80).

В этом случае конфигурация будет выглядеть следующим образом:

```yaml
outputs:
  - name: stdout
    match: "*"
  - name: opentelemetry
    match: "*"
    host: "your-oneuptime-instance.com"
    port: 80
    metrics_uri: "/otlp/v1/metrics"
    logs_uri: "/otlp/v1/logs"
    traces_uri: "/otlp/v1/traces"
    header:
      - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
```

## Использование

После добавления конфигурации в файл FluentBit перезапустите сервис. После перезапуска телеметрические данные будут отправляться в коллектор OneUptime. Вы сможете видеть данные на панели управления OneUptime. При возникновении вопросов или необходимости помощи с конфигурацией напишите нам по адресу support@oneuptime.com
