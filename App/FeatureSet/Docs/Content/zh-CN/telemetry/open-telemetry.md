# 将 OpenTelemetry（日志、指标和追踪）与 OneUptime 集成

### 第一步 - 创建遥测摄取令牌

创建 OneUptime 账号后，您可以创建遥测摄取令牌，用于从应用程序摄取日志、指标和追踪数据。

注册 OneUptime 并创建项目后。点击导航栏中的"更多"，然后点击"项目设置"。

在遥测摄取密钥页面，点击"创建摄取密钥"以创建令牌。

![创建服务](/docs/static/images/TelemetryIngestionKeys.png)

创建令牌后，点击"查看"以查看令牌。

![查看服务](/docs/static/images/TelemetryIngestionKeyView.png)

### 第二步

#### 在您的应用程序中配置遥测服务

#### 应用程序日志

我们使用 OpenTelemetry 收集应用程序日志。OneUptime 目前支持从以下 OpenTelemetry SDK 摄取日志。请按照说明在您的应用程序中配置遥测服务。

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

**与 OneUptime 集成**

在应用程序中配置遥测服务后，您可以通过设置以下环境变量与 OneUptime 集成。

| 环境变量                    | 值                                             |
| --------------------------- | ---------------------------------------------- |
| OTEL_EXPORTER_OTLP_HEADERS  | x-oneuptime-token=YOUR_ONEUPTIME_SERVICE_TOKEN |
| OTEL_EXPORTER_OTLP_ENDPOINT | https://oneuptime.com/otlp                     |
| OTEL_SERVICE_NAME           | NAME_OF_YOUR_SERVICE                           |

**示例**

```bash
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=9c8806e0-a4aa-11ee-be95-010d5967b068
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_SERVICE_NAME=my-service
```

**自托管 OneUptime**

如果您是自托管 OneUptime，可以将其更改为您的自托管 OpenTelemetry 收集器端点（例如：`http(s)://YOUR-ONEUPTIME-HOST/otlp`）

运行应用程序后，您应该能在 OneUptime 遥测服务页面中看到日志。如果需要任何帮助，请联系 support@oneuptime.com。

#### 使用 OpenTelemetry Collector

您也可以使用 OpenTelemetry Collector，而不是直接从应用程序发送遥测数据。
如果您使用 OpenTelemetry Collector，可以在收集器配置文件中配置 OneUptime 导出器。

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
  # 通过 HTTP 导出
  otlphttp:
    endpoint: "https://oneuptime.com/otlp"
    # 需要使用 JSON 编码器而非默认的 Proto(buf)
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
