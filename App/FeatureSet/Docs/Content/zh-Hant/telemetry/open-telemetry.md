# 將 OpenTelemetry（日誌、指標和追蹤）與 OneUptime 集成

### 第一步 - 創建遙測攝取令牌

創建 OneUptime 賬號後，您可以創建遙測攝取令牌，用於從應用程序攝取日誌、指標和追蹤數據。

註冊 OneUptime 並創建項目後。點擊導航欄中的"更多"，然後點擊"項目設置"。

在遙測攝取密鑰頁面，點擊"創建攝取密鑰"以創建令牌。

![創建服務](/docs/static/images/TelemetryIngestionKeys.png)

創建令牌後，點擊"查看"以查看令牌。

![查看服務](/docs/static/images/TelemetryIngestionKeyView.png)


### 第二步

#### 在您的應用程序中配置遙測服務

#### 應用程序日誌

我們使用 OpenTelemetry 收集應用程序日誌。OneUptime 目前支持從以下 OpenTelemetry SDK 攝取日誌。請按照說明在您的應用程序中配置遙測服務。

- [C++](https://opentelemetry.io/docs/instrumentation/cpp/)
- [Go](https://opentelemetry.io/docs/instrumentation/go/)
- [Java](https://opentelemetry.io/docs/instrumentation/java/)
- [JavaScript / TypeScript / NodeJS / Browser](https://opentelemetry.io/docs/instrumentation/js/)
- [Python](https://opentelemetry.io/docs/instrumentation/python/)
- [Ruby](https://opentelemetry.io/docs/instrumentation/ruby/)
- [PHP](https://opentelemetry.io/docs/instrumentation/php/)
- [Erlang](https://opentelemetry.io/docs/instrumentation/erlang/)
- [Rust](https://opentelemetry.io/docs/instrumentation/rust/)
- [.NET / C#](https://opentelemetry.io/docs/instrumentation/net/)
- [Swift](https://opentelemetry.io/docs/instrumentation/swift/)


**與 OneUptime 集成**

在應用程序中配置遙測服務後，您可以通過設置以下環境變量與 OneUptime 集成。

| 環境變量 | 值 |
|---------|-----|
| OTEL_EXPORTER_OTLP_HEADERS | x-oneuptime-token=YOUR_ONEUPTIME_SERVICE_TOKEN |
| OTEL_EXPORTER_OTLP_ENDPOINT | https://oneuptime.com/otlp |
| OTEL_SERVICE_NAME | NAME_OF_YOUR_SERVICE |


**示例**

```bash
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=9c8806e0-a4aa-11ee-be95-010d5967b068
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_SERVICE_NAME=my-service
```


**自託管 OneUptime**

如果您是自託管 OneUptime，可以將其更改爲您的自託管 OpenTelemetry 收集器端點（例如：`http(s)://YOUR-ONEUPTIME-HOST/otlp`）

運行應用程序後，您應該能在 OneUptime 遙測服務頁面中看到日誌。如果需要任何幫助，請聯繫 support@oneuptime.com。


#### 使用 OpenTelemetry Collector

您也可以使用 OpenTelemetry Collector，而不是直接從應用程序發送遙測數據。
如果您使用 OpenTelemetry Collector，可以在收集器配置文件中配置 OneUptime 導出器。

以下是 OpenTelemetry Collector 的示例配置。

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

exporters:

  # 通過 HTTP 導出
  otlphttp:
    endpoint: "https://oneuptime.com/otlp"
    # 需要使用 JSON 編碼器而非默認的 Proto(buf)
    encoding: json
    headers:
      "Content-Type": "application/json"
      "x-oneuptime-token": "ONEUPTIME_TOKEN" # 您的 OneUptime 令牌

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
