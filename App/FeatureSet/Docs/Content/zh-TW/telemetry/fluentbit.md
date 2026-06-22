# 使用 FluentBit 將遙測資料傳送至 OneUptime

## 概觀

您可以使用 [FluentBit](https://docs.fluentbit.io/manual) 外掛從您的應用程式與服務收集記錄與遙測資料。此外掛會將遙測資料傳送至 OneUptime OpenTelemetry HTTP Collector。您可以使用 fluentbit 的 opentelemetry 輸出外掛，將遙測資料傳送至 OneUptime OpenTelemetry HTTP Collector。此外掛可於此處找到：https://docs.fluentbit.io/manual/pipeline/outputs/opentelemetry

## 開始使用

FluentBit 支援數百種資料來源，您可以將來自任何這些來源的記錄與遙測擷取至 OneUptime。一些熱門的來源包括：

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

以及更多。

您可以於[此處](https://docs.fluentbit.io/manual)找到支援來源的完整清單

## 先決條件

- **步驟 1：在您的系統上安裝 FluentBit** - 您可以依照[此處](https://docs.fluentbit.io/manual/installation/getting-started-with-fluent-bit)提供的說明來安裝 FluentBit
- **步驟 2：註冊 OneUptime 帳戶** - 您可以於[此處](https://oneuptime.com)註冊免費帳戶。請注意，雖然帳戶是免費的，但記錄擷取是付費功能。您可以於[此處](https://oneuptime.com/pricing)找到更多關於價格的詳細資訊。
- **步驟 3：建立 OneUptime 專案** - 擁有帳戶後，您可以從 OneUptime 儀表板建立專案。如果您在建立專案時需要任何協助或有任何問題，請透過 support@oneuptime.com 與我們聯絡
- **步驟 4：建立遙測擷取權杖** - 在您建立 OneUptime 帳戶後，您可以建立遙測擷取權杖，以從您的應用程式擷取記錄、指標與追蹤。

在您註冊 OneUptime 並建立專案後。點按導覽列中的「More」，然後點按「Project Settings」。

在 Telemetry Ingestion Key 頁面上，點按「Create Ingestion Key」以建立權杖。

![Create Service](/docs/static/images/TelemetryIngestionKeys.png)

在您建立權杖後，點按「View」以檢視該權杖。

![View Service](/docs/static/images/TelemetryIngestionKeyView.png)

## 設定

您可以使用以下設定，將遙測資料傳送至 OneUptime OpenTelemetry HTTP Collector。您可以將此設定加入 fluentbit 設定檔。設定檔通常位於 `/etc/fluent-bit/fluent-bit.yaml`。以下是設定檔的 outputs 區段看起來的樣子：

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

請確保您的 input 區段中包含 opentelemetry_envelope。以下是 input 區段看起來的範例：

```yaml
pipeline:
  inputs:
    # Your inputs

    processors:
      logs:
        - name: opentelemetry_envelope

        - name: content_modifier
          context: otel_resource_attributes
          action: upsert
          key: service.name
          # Please replace YOUR_SERVICE_NAME with the name of your service
          value: YOUR_SERVICE_NAME
```

以下是完整設定檔的範例：

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

**如果您正在自架 OneUptime**：如果您正在自架 OneUptime，您可以將 `host` 替換為您 OneUptime 執行個體的主機。如果您是以 http 伺服器而非 https 託管，您可以將 `port` 替換為您 OneUptime 執行個體的連接埠（可能是連接埠 80）。

在此情況下，設定看起來會是：

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

## 使用方式

在您將設定加入 fluentbit 設定檔後，您可以重新啟動 fluentbit 服務。服務重新啟動後，遙測資料便會傳送至 OneUptime HTTP Source。您現在可以開始在 OneUptime 儀表板中看到遙測資料。如果您有任何問題或在設定上需要協助，請透過 support@oneuptime.com 與我們聯絡
