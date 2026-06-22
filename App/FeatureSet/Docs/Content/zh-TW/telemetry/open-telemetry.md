# 將 OpenTelemetry（記錄、指標與追蹤）與 OneUptime 整合。

### 步驟 1 - 建立遙測擷取權杖。

建立 OneUptime 帳號後，您可以建立遙測擷取權杖，以從您的應用程式擷取記錄、指標與追蹤。

在您註冊 OneUptime 並建立專案之後，請點選導覽列中的「More」，然後點選「Project Settings」。

在 Telemetry Ingestion Key 頁面上，點選「Create Ingestion Key」以建立權杖。

![Create Service](/docs/static/images/TelemetryIngestionKeys.png)

建立權杖後，請點選「View」以檢視權杖。

![View Service](/docs/static/images/TelemetryIngestionKeyView.png)

### 步驟 2

#### 在您的應用程式中設定遙測服務。

#### 應用程式記錄

我們使用 OpenTelemetry 來收集應用程式記錄。OneUptime 目前支援從以下 OpenTelemetry SDK 擷取記錄。請依照指示在您的應用程式中設定遙測服務。

- [C++](https://opentelemetry.io/docs/instrumentation/cpp/)
- [Go](https://opentelemetry.io/docs/instrumentation/go/)
- [Java](https://opentelemetry.io/docs/instrumentation/java/)
- [JavaScript / Typescript / NodeJS / Browser](https://opentelemetry.io/docs/instrumentation/js/)
- [Python](https://opentelemetry.io/docs/instrumentation/python/)
- [Ruby](https://opentelemetry.io/docs/instrumentation/ruby/)
- [PHP](https://opentelemetry.io/docs/instrumentation/php/)
- [Erlang](https://opentelemetry.io/docs/instrumentation/erlang/)
- [Rust](https://opentelemetry.io/docs/instrumentation/rust/)
- [.NET / C#](https://opentelemetry.io/docs/instrumentation/net/)
- [Swift](https://opentelemetry.io/docs/instrumentation/swift/)

**與 OneUptime 整合**

在您的應用程式中設定遙測服務後，您可以透過設定以下環境變數來與 OneUptime 整合。

| Environment Variable        | Value                                          |
| --------------------------- | ---------------------------------------------- |
| OTEL_EXPORTER_OTLP_HEADERS  | x-oneuptime-token=YOUR_ONEUPTIME_SERVICE_TOKEN |
| OTEL_EXPORTER_OTLP_ENDPOINT | https://oneuptime.com/otlp                     |
| OTEL_SERVICE_NAME           | NAME_OF_YOUR_SERVICE                           |

**範例**

```bash
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=9c8806e0-a4aa-11ee-be95-010d5967b068
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_SERVICE_NAME=my-service
```

**自架式 OneUptime**

如果您是自架 oneuptime，這可以變更為您的自架 OpenTelemetry 收集器端點（例如：`http(s)://YOUR-ONEUPTIME-HOST/otlp`）

執行您的應用程式後，您應該會在 OneUptime 遙測服務頁面上看到記錄。如果您需要任何協助，請聯絡 support@oneuptime.com。

#### 使用 OpenTelemetry 收集器

您也可以使用 OpenTelemetry 收集器，而不是直接從您的應用程式傳送遙測資料。
如果您使用 OpenTelemetry Collector，您可以在收集器設定檔中設定 OneUptime 匯出器。

以下是 OpenTelemetry Collector 的範例設定。

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

exporters:
  # Export over HTTP
  otlphttp:
    endpoint: "https://oneuptime.com/otlp"
    # Requires use JSON encoder insted of default Proto(buf)
    encoding: json
    headers:
      "Content-Type": "application/json"
      "x-oneuptime-token": "ONEUPTIME_TOKEN" # Your OneUptime token

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

### 來自記錄的例外狀況

OneUptime 會偵測您**記錄**內的例外狀況，並將它們彙整到追蹤錯誤所匯入的同一個**例外狀況**（問題）檢視中。由於每筆記錄都已解析為某個服務或主機，因此衍生自記錄的例外狀況會被歸屬到正確的資源，而且它們共用相同的指紋分組——因此同時由追蹤與記錄回報的錯誤會合併為單一問題。

有兩種偵測路徑：

1. **明確的例外狀況屬性（建議）。** 帶有 OpenTelemetry `exception.type`、`exception.message` 或 `exception.stacktrace` 屬性的記錄項目會直接轉換為例外狀況。大多數記錄整合（Logback / Log4j appender、Serilog、Python logging instrumentation 等）會在您記錄例外狀況時設定這些屬性。這是精確且與語言無關的。

2. **記錄主體中的堆疊追蹤。** 對於沒有那些屬性的 error/fatal 記錄——例如原始 stdout、syslog 或 journald——OneUptime 會掃描主體以尋找堆疊追蹤（JavaScript、Python、Java、Go、Ruby、C#/.NET、PHP），並擷取類型、訊息與框架。多行追蹤必須以單一記錄項目的形式抵達；如果您收集純文字記錄，請在收集器啟用多行重組（請參閱 [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector) 指南）。

此功能預設為開啟。在自架式 OneUptime 上，您可以透過在擷取服務上設定 `TELEMETRY_LOG_EXCEPTION_EXTRACTION_ENABLED=false` 來停用它。
