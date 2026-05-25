# 使用 FluentBit 向 OneUptime 發送遙測數據

## 概述

您可以使用 [FluentBit](https://docs.fluentbit.io/manual) 插件從您的應用程序和服務中收集日誌和遙測數據。該插件將遙測數據發送到 OneUptime OpenTelemetry HTTP 收集器。您可以使用 FluentBit 的 opentelemetry 輸出插件將遙測數據發送到 OneUptime OpenTelemetry HTTP 收集器。該插件可在此處找到：https://docs.fluentbit.io/manual/pipeline/outputs/opentelemetry

## 入門

FluentBit 支持數百種數據源，您可以將來自任何數據源的日誌和遙測數據攝取到 OneUptime 中。一些常用數據源包括：

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

以及更多其他數據源。

您可以在[此處](https://docs.fluentbit.io/manual)找到支持的數據源完整列表。

## 前提條件

- **第一步：在您的系統上安裝 FluentBit** - 您可以使用[此處](https://docs.fluentbit.io/manual/installation/getting-started-with-fluent-bit)提供的說明安裝 FluentBit
- **第二步：註冊 OneUptime 賬號** - 您可以在[此處](https://oneuptime.com)註冊免費賬號。請注意，雖然賬號是免費的，但日誌攝取是付費功能。您可以在[此處](https://oneuptime.com/pricing)找到有關定價的更多詳細信息。
- **第三步：創建 OneUptime 項目** - 擁有賬號後，您可以從 OneUptime 控制台創建項目。如果您在創建項目方面需要幫助或有任何問題，請通過 support@oneuptime.com 聯繫我們。
- **第四步：創建遙測攝取令牌** - 創建 OneUptime 賬號後，您可以創建遙測攝取令牌，用於從應用程序攝取日誌、指標和追蹤數據。

註冊 OneUptime 並創建項目後。點擊導航欄中的"更多"，然後點擊"項目設置"。

在遙測攝取密鑰頁面，點擊"創建攝取密鑰"以創建令牌。

![創建服務](/docs/static/images/TelemetryIngestionKeys.png)

創建令牌後，點擊"查看"以查看令牌。

![查看服務](/docs/static/images/TelemetryIngestionKeyView.png)


## 配置

您可以使用以下配置將遙測數據發送到 OneUptime OpenTelemetry HTTP 收集器。您可以將此配置添加到 FluentBit 配置文件中。配置文件通常位於 `/etc/fluent-bit/fluent-bit.yaml`。以下是配置文件的 outputs 部分示例：


```yaml


outputs:
  - name: stdout
    match: '*'
  - name: opentelemetry
    match: '*'
    host: 'oneuptime.com'
    port: 443
    metrics_uri: '/otlp/v1/metrics'
    logs_uri: '/otlp/v1/logs'
    traces_uri: '/otlp/v1/traces'
    tls: On
    header:
      - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN

```

請確保在您的 input 部分包含 opentelemetry_envelope。以下是 input 部分的示例：

```yaml
pipeline:
  inputs:
      # 您的輸入

      processors:
        logs:
          - name: opentelemetry_envelope

          - name: content_modifier
            context: otel_resource_attributes
            action: upsert
            key: service.name
            # 請將 YOUR_SERVICE_NAME 替換爲您的服務名稱
            value: YOUR_SERVICE_NAME
```

以下是完整的配置文件示例：

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
      match: '*'
    - name: opentelemetry
      match: '*'
      host: 'oneuptime.com'
      port: 443
      metrics_uri: '/otlp/v1/metrics'
      logs_uri: '/otlp/v1/logs'
      traces_uri: '/otlp/v1/traces'
      tls: On
      header:
        - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
```


**如果您是自託管 OneUptime**：如果您是自託管 OneUptime，可以將 `host` 替換爲您的 OneUptime 實例的主機名。如果您在 HTTP 服務器而非 HTTPS 上託管，可以將 `port` 替換爲您的 OneUptime 實例的端口（可能是 80 端口）。

在這種情況下，配置應如下所示：

```yaml
outputs:
  - name: stdout
    match: '*'
  - name: opentelemetry
    match: '*'
    host: 'your-oneuptime-instance.com'
    port: 80
    metrics_uri: '/otlp/v1/metrics'
    logs_uri: '/otlp/v1/logs'
    traces_uri: '/otlp/v1/traces'
    header:
      - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
```

## 使用

將配置添加到 FluentBit 配置文件後，您可以重啓 FluentBit 服務。服務重啓後，遙測數據將被髮送到 OneUptime HTTP 源。您現在可以在 OneUptime 控制台中看到遙測數據。如果您有任何問題或需要配置方面的幫助，請通過 support@oneuptime.com 聯繫我們。
