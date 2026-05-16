# 使用 Fluentd 向 OneUptime 发送遥测数据

## 概述

您可以使用 [Fluentd](https://www.fluentd.org/) 插件从您的应用程序和服务中收集日志和遥测数据。该插件将遥测数据发送到 OneUptime HTTP 源。您可以使用 Fluentd 的 http 输出插件将遥测数据发送到 OneUptime HTTP 源。该插件可在此处找到：https://docs.fluentd.org/output/http

## 入门

Fluentd 支持数百种数据源，您可以将来自任何数据源的日志摄取到 OneUptime 中。一些常用数据源包括：

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

您可以在[此处](https://www.fluentd.org/datasources)找到支持的数据源完整列表。

## 前提条件

- **第一步：在您的系统上安装 Fluentd** - 您可以使用[此处](https://docs.fluentd.org/installation)提供的说明安装 Fluentd
- **第二步：注册 OneUptime 账号** - 您可以在[此处](https://oneuptime.com)注册免费账号。请注意，虽然账号是免费的，但日志摄取是付费功能。您可以在[此处](https://oneuptime.com/pricing)找到有关定价的更多详细信息。
- **第三步：创建 OneUptime 项目** - 拥有账号后，您可以从 OneUptime 控制台创建项目。如果您在创建项目方面需要帮助或有任何问题，请通过 support@oneuptime.com 联系我们。
- **第四步：创建遥测摄取令牌** - 创建 OneUptime 账号后，您可以创建遥测摄取令牌，用于从应用程序摄取日志、指标和追踪数据。

注册 OneUptime 并创建项目后。点击导航栏中的"更多"，然后点击"项目设置"。

在遥测摄取密钥页面，点击"创建摄取密钥"以创建令牌。

![创建服务](/docs/static/images/TelemetryIngestionKeys.png)

创建令牌后，点击"查看"以查看令牌。

![查看服务](/docs/static/images/TelemetryIngestionKeyView.png)


## 配置

您可以使用以下配置将遥测数据发送到 OneUptime HTTP 源。您可以将此配置添加到 Fluentd 配置文件中。配置文件通常位于 `/etc/fluentd/fluent.conf` 或 `/etc/td-agent/td-agent.conf`。

您需要将 `YOUR_SERVICE_TOKEN` 替换为您在上一步创建的令牌。您还需要将 `YOUR_SERVICE_NAME` 替换为您的服务名称。服务名称可以是您喜欢的任何名称。如果该服务在 OneUptime 中不存在，它将自动创建。

```yaml
# 匹配所有模式
<match **>
  @type http

  endpoint https://oneuptime.com/fluentd/logs
  open_timeout 2

  headers {"x-oneuptime-token":"YOUR_SERVICE_TOKEN", "x-oneuptime-service-name":"YOUR_SERVICE_NAME"}

  content_type application/json
  json_array true

  <format>
    @type json
  </format>
  <buffer>
    flush_interval 10s
  </buffer>
</match>
```


以下是完整配置文件的示例：

```yaml
####
## 数据源描述：
##

## 内置 TCP 输入
## @see https://docs.fluentd.org/input/forward
<source>
  @type forward
  port 24224
  bind 0.0.0.0
</source>

<match **>
  @type http

  endpoint https://oneuptime.com/fluentd/logs
  open_timeout 2

  headers {"x-oneuptime-token":"YOUR_SERVICE_TOKEN", "x-oneuptime-service-name":"YOUR_SERVICE_NAME"}

  content_type application/json
  json_array true

  <format>
    @type json
  </format>
  <buffer>
    flush_interval 10s
  </buffer>
</match>
```

**如果您是自托管 OneUptime**：如果您是自托管 OneUptime，可以将 `endpoint_url` 替换为您的 OneUptime 实例的 URL。`http(s)://YOUR_ONEUPTIME_HOST/fluentd/logs`

## 使用

将配置添加到 Fluentd 配置文件后，您可以重启 Fluentd 服务。服务重启后，遥测数据将被发送到 OneUptime HTTP 源。您现在可以在 OneUptime 控制台中看到遥测数据。如果您有任何问题或需要配置方面的帮助，请通过 support@oneuptime.com 联系我们。
