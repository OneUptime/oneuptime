# Fluent Bit

[Fluent Bit](https://docs.fluentbit.io/manual) 是一个轻量级代理，可以从文件、systemd、容器、syslog、HTTP 以及许多其他来源收集日志。它的 [OpenTelemetry 输出](https://docs.fluentbit.io/manual/pipeline/outputs/opentelemetry)会把收集到的数据发送到 OneUptime 的 OpenTelemetry（OTLP）端点，之后就可以在 **产品 → 日志** 中搜索这些日志。

:::cards
- [配置 Fluent Bit](#配置-fluent-bit): 添加 OpenTelemetry 输出并为服务命名。
- [完整示例](#完整示例): 一份可以直接上手的完整配置文件。
- [自托管 OneUptime](#自托管-oneuptime): 让 Fluent Bit 发送到你自己的实例。
:::

## 工作原理

```mermaid title="从 Fluent Bit 到 OneUptime"
flowchart TB
    sources["文件、容器、syslog、HTTP"] --> inputs["Fluent Bit 输入"]
    inputs --> envelope["opentelemetry_envelope 处理器"]
    envelope --> name["content_modifier 设置 service.name"]
    name --> output["opentelemetry 输出"]
    output -->|"OTLP/HTTP + 摄取密钥"| oneuptime["OneUptime /otlp/v1/logs"]
    oneuptime --> logs["日志"]
```

Fluent Bit 会把每条记录包进一个 OpenTelemetry 信封，使其能够携带 `service.name` 这样的资源属性。然后 OpenTelemetry 输出把记录发送到 OneUptime，并在 `x-oneuptime-token` 请求头中带上你的摄取密钥。OneUptime 会把它们归到 `service.name` 指定的服务下，并在首次发送时创建该服务。

## 开始之前

- **安装 Fluent Bit**：参见[安装指南](https://docs.fluentbit.io/manual/installation/getting-started-with-fluent-bit)。本页的配置使用 Fluent Bit 的 YAML 格式和 `opentelemetry_envelope` 处理器，因此请使用较新的版本。
- **一个 OneUptime 项目。** 在 OneUptime Cloud 上，遥测数据按摄取的 GB 计费（参见[价格](https://oneuptime.com/pricing)），而且 Free 套餐的项目需要先添加付款方式才能发送遥测数据。
- **一个遥测摄取密钥。** 如果还没有，请按以下步骤创建：

:::steps
### 打开摄取密钥

前往 **产品 → 项目设置**，在侧边菜单中展开 **遥测与 APM**，然后选择 **摄取密钥**。

![“摄取密钥”列表，“创建摄取密钥”已框出](screen:ingestion-keys)

### 创建密钥

点击 **创建摄取密钥**。对话框已经填好了密钥名称，并选择了 **服务器**（应用或 Collector 发送数据时使用的密钥类型），因此直接点击 **创建摄取密钥** 即可创建，也可以先改名。

### 复制机密

新密钥会在它自己的页面中打开。复制它的 **密钥**：这就是下面配置中的 `YOUR_TELEMETRY_INGESTION_TOKEN`。

![显示密钥的遥测摄取密钥页面](/docs/static/images/TelemetryIngestionKeyView.png)
:::

## 配置 Fluent Bit

Fluent Bit 从 `/etc/fluent-bit/fluent-bit.yaml` 这样的文件读取 YAML 配置。

:::steps
### 添加 OpenTelemetry 输出

添加一个发送到 OneUptime 的 `opentelemetry` 输出。如果想在本地查看记录，测试期间可以保留 `stdout` 输出：

```yaml title="fluent-bit.yaml"
service:
  # Keep the chunks still to send on disk: a restart of Fluent Bit loses none
  storage.path: /var/lib/fluent-bit/buffer
  storage.sync: normal
  # Try a chunk again about every 30 seconds
  scheduler.base: 30
  scheduler.cap: 30

pipeline:
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
      # Send a chunk again when OneUptime is busy or restarting, for about 72 hours
      retry_limit: 8640
      # At most 512 MB on disk: when it is full, the oldest chunks are dropped
      storage.total_limit_size: 512M
```

`retry_limit: 8640` 会在 OneUptime 繁忙（`429`）或正在重启（`502`、`503`、`504`）时重新发送一个块，大约每 30 秒一次（`scheduler.base` 和 `scheduler.cap`），持续约 72 小时；Fluent Bit 默认只再试一次，然后丢弃它。`storage.path` 把尚未发送的块保存在磁盘上，因此重启 Fluent Bit 不会丢失其中任何一个，这适用于每个设置了 `storage.type: filesystem` 的输入，如下一步所示。Fluent Bit 必须能写入该文件夹：软件包的服务以 root 身份运行，手动运行时请用 `sudo`。`storage.total_limit_size: 512M` 为该输出最多保存 512 MB；满了之后，最早的块会被丢弃。

### 把日志包进 OpenTelemetry 信封并为服务命名

给每个输入添加 `opentelemetry_envelope` 处理器，后面再跟一个设置 `service.name` 的 `content_modifier`。把 `YOUR_SERVICE_NAME` 换成日志在 OneUptime 中显示的名称：

```yaml title="fluent-bit.yaml"
pipeline:
  inputs:
    - name: tail # or any other input
      path: /var/log/my-app/*.log
      # Keep its place in each file, so a restart reads on from there
      db: /var/lib/fluent-bit/tail.db
      # Keep its chunks on disk until OneUptime takes them
      storage.type: filesystem

      processors:
        logs:
          - name: opentelemetry_envelope

          - name: content_modifier
            context: otel_resource_attributes
            action: upsert
            key: service.name
            value: YOUR_SERVICE_NAME
```

`db` 记住 tail 在每个文件中的位置，因此重启后会从那里接着读；没有它，Fluent Bit 会从每个文件的末尾重新开始，停机期间写入的行永远不会发送。`storage.type: filesystem` 把输入的块保存在 `storage.path` 中。

### 重启 Fluent Bit

`fluent-bit` 软件包的服务读取的是软件包自带的示例 `/etc/fluent-bit/fluent-bit.conf`，而不是这个文件。用一个 drop-in 让它改读 `/etc/fluent-bit/fluent-bit.yaml`，然后让它现在启动，并在每次开机时启动：

```bash
sudo mkdir -p /etc/systemd/system/fluent-bit.service.d
printf '[Service]\nExecStart=\nExecStart=/opt/fluent-bit/bin/fluent-bit -c /etc/fluent-bit/fluent-bit.yaml\n' | sudo tee /etc/systemd/system/fluent-bit.service.d/fluent-bit-yaml.conf
sudo systemctl daemon-reload
sudo systemctl enable fluent-bit
sudo systemctl restart fluent-bit
```

空的 `ExecStart=` 会清掉软件包自带的启动行。要先在前台试一试这个文件，请运行 `sudo /opt/fluent-bit/bin/fluent-bit -c /etc/fluent-bit/fluent-bit.yaml`：软件包把程序放在 `/opt/fluent-bit/bin`，它不在 `PATH` 中。几秒钟内，日志就会出现在 **产品 → 日志** 中，服务也会列在 **产品 → 服务** 下。
:::

## 完整示例

这份配置在端口 `8888` 上通过 HTTP 只接收来自本主机的日志，并转发到 OneUptime：

```yaml title="fluent-bit.yaml"
service:
  flush: 1
  log_level: info
  # Keep the chunks still to send on disk: a restart of Fluent Bit loses none
  storage.path: /var/lib/fluent-bit/buffer
  storage.sync: normal
  # Try a chunk again about every 30 seconds
  scheduler.base: 30
  scheduler.cap: 30

pipeline:
  inputs:
    - name: http
      # This host alone may send here
      listen: 127.0.0.1
      port: 8888
      storage.type: filesystem

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
      # Send a chunk again when OneUptime is busy or restarting, for about 72 hours
      retry_limit: 8640
      # At most 512 MB on disk: when it is full, the oldest chunks are dropped
      storage.total_limit_size: 512M
```

`listen: 127.0.0.1` 只接收来自本主机的日志：`http` 输入不要求任何密钥，所以使用 `listen: 0.0.0.0` 时，任何能访问该端口的人都可以用你的摄取密钥向 OneUptime 发送日志。把 `http` 输入换成你需要的输入，例如日志文件用 `tail`，journal 用 `systemd`，并在每个输入上保留这两个处理器和 `storage.type: filesystem`。

## 用 HTTP 输出发送

Fluent Bit 的 [HTTP 输出](https://docs.fluentbit.io/manual/pipeline/outputs/http)也可以发送到 OneUptime 的 Fluentd 端点，它会按照 [Fluentd 页面](/docs/telemetry/fluentd)所说的方式读取每条记录。把 `format` 设为 `json_lines`（如下所示）或 `json`：OneUptime 两者都能读取，无论是否用 `compress: gzip` 压缩。Fluent Bit 的默认格式 `msgpack` 会被拒绝。

```yaml title="fluent-bit.yaml"
pipeline:
  outputs:
    - name: http
      match: "*"
      host: "oneuptime.com"
      port: 443
      uri: "/fluentd/logs"
      format: json_lines
      # Send each record's time where OneUptime reads it
      json_date_key: timestamp
      tls: On
      header:
        - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
        - x-oneuptime-service-name YOUR_SERVICE_NAME
      # Send a chunk again when OneUptime is busy or restarting, for about 72 hours
      retry_limit: 8640
      # At most 512 MB on disk: when it is full, the oldest chunks are dropped
      storage.total_limit_size: 512M
```

## 自托管 OneUptime

把 `host` 设为你的 OneUptime 实例的主机。如果它通过普通 HTTP 而不是 HTTPS 提供服务，还要把 `port` 设为它监听的端口（通常是 `80`），并删除 `tls`：

```yaml title="fluent-bit.yaml"
pipeline:
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
      # Send a chunk again when OneUptime is busy or restarting, for about 72 hours
      retry_limit: 8640
      # At most 512 MB on disk: when it is full, the oldest chunks are dropped
      storage.total_limit_size: 512M
```

## 故障排除

:::details Fluent Bit 记录了来自 OpenTelemetry 输出的 `401`
摄取密钥缺失、未知或已过期。检查 `header` 这一行：它是 `x-oneuptime-token`、一个空格，然后是该密钥的 **密钥**。
:::

:::details Fluent Bit 记录了 `402` 或 `422`
`402`：在 OneUptime Cloud 上，项目处于 Free 套餐且没有付款方式。请在 **项目设置 → 账单和发票 → 账单** 中添加。`422`：密钥已被禁用，或者是浏览器密钥。请在密钥的设置中重新打开 **已启用**，或者创建一个 **服务器** 密钥。
:::

:::details 日志归到了意料之外的服务下
服务来自 `service.name`。检查每个输入是否都有 `opentelemetry_envelope` 处理器，并且后面跟着设置它的 `content_modifier`。
:::

:::details 什么都没有收到，Fluent Bit 记录了连接错误
检查 HTTPS 端点是否设置了 `tls: On` 和 `port: 443`，以及运行 Fluent Bit 的主机能否通过该端口访问你的 OneUptime 主机。
:::

:::details Fluent Bit 记录了 `cannot be retried`
Fluent Bit 丢弃了一个无法发送的块。像上面的配置那样设置 `retry_limit: 8640` 后，OneUptime 以 `429`、`502`、`503` 或 `504` 回应的块，会大约每 30 秒重新发送一次，持续约 72 小时；使用 Fluent Bit 的默认值时，它只再试一次。`400`、`401`、`402`、`413`、`422` 或 `500` 会被立即丢弃，因为每次的回应都一样：请检查密钥、套餐和请求大小。
:::

如果对配置有任何问题或需要帮助，请发送邮件至 support@oneuptime.com。

## 后续步骤

:::cards
- [日志管道](/docs/telemetry/log-pipelines): 解析并丰富 Fluent Bit 发送的日志。
- [搜索语法](/docs/telemetry/search-syntax): 在日志浏览器中查找日志。
- [OpenTelemetry](/docs/telemetry/open-telemetry): 所有遥测数据的端点、密钥和限制。
- [Fluentd](/docs/telemetry/fluentd): 改用 Fluentd。
:::
