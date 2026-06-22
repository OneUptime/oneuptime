# 使用 FluentBit 向 OneUptime 发送遥测数据

## 概述

您可以使用 [FluentBit](https://docs.fluentbit.io/manual) 插件从您的应用程序和服务中收集日志和遥测数据。该插件将遥测数据发送到 OneUptime OpenTelemetry HTTP 收集器。您可以使用 FluentBit 的 opentelemetry 输出插件将遥测数据发送到 OneUptime OpenTelemetry HTTP 收集器。该插件可在此处找到：https://docs.fluentbit.io/manual/pipeline/outputs/opentelemetry

## 入门

FluentBit 支持数百种数据源，您可以将来自任何数据源的日志和遥测数据摄取到 OneUptime 中。一些常用数据源包括：

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

以及更多其他数据源。

您可以在[此处](https://docs.fluentbit.io/manual)找到支持的数据源完整列表。

## 前提条件

- **第一步：在您的系统上安装 FluentBit** - 您可以使用[此处](https://docs.fluentbit.io/manual/installation/getting-started-with-fluent-bit)提供的说明安装 FluentBit
- **第二步：注册 OneUptime 账号** - 您可以在[此处](https://oneuptime.com)注册免费账号。请注意，虽然账号是免费的，但日志摄取是付费功能。您可以在[此处](https://oneuptime.com/pricing)找到有关定价的更多详细信息。
- **第三步：创建 OneUptime 项目** - 拥有账号后，您可以从 OneUptime 控制台创建项目。如果您在创建项目方面需要帮助或有任何问题，请通过 support@oneuptime.com 联系我们。
- **第四步：创建遥测摄取令牌** - 创建 OneUptime 账号后，您可以创建遥测摄取令牌，用于从应用程序摄取日志、指标和追踪数据。

注册 OneUptime 并创建项目后。点击导航栏中的"更多"，然后点击"项目设置"。

在遥测摄取密钥页面，点击"创建摄取密钥"以创建令牌。

![创建服务](/docs/static/images/TelemetryIngestionKeys.png)

创建令牌后，点击"查看"以查看令牌。

![查看服务](/docs/static/images/TelemetryIngestionKeyView.png)

## 配置

您可以使用以下配置将遥测数据发送到 OneUptime OpenTelemetry HTTP 收集器。您可以将此配置添加到 FluentBit 配置文件中。配置文件通常位于 `/etc/fluent-bit/fluent-bit.yaml`。以下是配置文件的 outputs 部分示例：

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

请确保在您的 input 部分包含 opentelemetry_envelope。以下是 input 部分的示例：

```yaml
pipeline:
  inputs:
    # 您的输入

    processors:
      logs:
        - name: opentelemetry_envelope

        - name: content_modifier
          context: otel_resource_attributes
          action: upsert
          key: service.name
          # 请将 YOUR_SERVICE_NAME 替换为您的服务名称
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

**如果您是自托管 OneUptime**：如果您是自托管 OneUptime，可以将 `host` 替换为您的 OneUptime 实例的主机名。如果您在 HTTP 服务器而非 HTTPS 上托管，可以将 `port` 替换为您的 OneUptime 实例的端口（可能是 80 端口）。

在这种情况下，配置应如下所示：

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

## 使用

将配置添加到 FluentBit 配置文件后，您可以重启 FluentBit 服务。服务重启后，遥测数据将被发送到 OneUptime HTTP 源。您现在可以在 OneUptime 控制台中看到遥测数据。如果您有任何问题或需要配置方面的帮助，请通过 support@oneuptime.com 联系我们。
