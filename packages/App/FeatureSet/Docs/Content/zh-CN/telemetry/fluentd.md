# Fluentd

[Fluentd](https://www.fluentd.org/) 可以从文件、容器、syslog、应用以及[许多其他来源](https://www.fluentd.org/datasources)收集日志。它内置的 [HTTP 输出](https://docs.fluentd.org/output/http)会把日志发送到 OneUptime 的 Fluentd 端点，之后就可以在 **产品 → 日志** 中搜索这些日志。

:::cards
- [配置 Fluentd](#配置-fluentd): 添加一个指向 OneUptime 的 HTTP 输出。
- [如何读取记录](#如何读取记录): 哪些字段会成为消息、严重级别和属性。
- [自托管 OneUptime](#自托管-oneuptime): 让 Fluentd 发送到你自己的实例。
:::

## 工作原理

```mermaid title="从 Fluentd 到 OneUptime"
flowchart TB
    sources["文件、容器、syslog、应用"] --> fluentd["Fluentd"]
    fluentd -->|"HTTP 输出，JSON + 摄取密钥"| ingest["OneUptime /fluentd/logs"]
    ingest --> service["请求中指定的服务"]
    service --> logs["日志"]
```

Fluentd 以 JSON 格式批量发送记录，摄取密钥放在 `x-oneuptime-token` 请求头中，服务名称放在 `x-oneuptime-service-name` 中。OneUptime 会把每条记录变成该服务的一条日志，并在首次发送时创建该服务。

## 开始之前

- **安装 Fluentd**：参见[安装指南](https://docs.fluentd.org/installation)。
- **一个 OneUptime 项目。** 在 OneUptime Cloud 上，遥测数据按摄取的 GB 计费（参见[价格](https://oneuptime.com/pricing)），而且 Free 套餐的项目需要先添加付款方式才能发送遥测数据。
- **一个遥测摄取密钥。** 如果还没有，请按以下步骤创建：

:::steps
### 打开摄取密钥

前往 **产品 → 项目设置**，在侧边菜单中展开 **遥测与 APM**，然后选择 **摄取密钥**。

![“摄取密钥”列表，“创建摄取密钥”已框出](screen:ingestion-keys)

### 创建密钥

点击 **创建摄取密钥**。对话框已经填好了密钥名称，并选择了 **服务器**（应用或 Collector 发送数据时使用的密钥类型），因此直接点击 **创建摄取密钥** 即可创建，也可以先改名。

### 复制机密

新密钥会在它自己的页面中打开。复制它的 **密钥**：这就是下面配置中的 `YOUR_SERVICE_TOKEN`。

![显示密钥的遥测摄取密钥页面](/docs/static/images/TelemetryIngestionKeyView.png)
:::

## 配置 Fluentd

Fluentd 的配置文件通常是 `/etc/fluent/fluentd.conf`，旧的 td-agent 包则是 `/etc/td-agent/td-agent.conf`。

:::steps
### 添加 HTTP 输出

添加一个把记录发送到 OneUptime 的 `<match>` 段。把 `YOUR_SERVICE_TOKEN` 换成你的摄取密钥，把 `YOUR_SERVICE_NAME` 换成日志要显示的名称（任意名称都可以）：

```text title="fluentd.conf"
# Send the time Fluentd gave each event: the HTTP output sends only the record
<filter **>
  @type record_transformer
  enable_ruby true
  <record>
    fluentd_time ${time.utc.strftime("%Y-%m-%dT%H:%M:%S.%NZ")}
  </record>
</filter>

# Match all patterns
<match **>
  @type http

  endpoint https://oneuptime.com/fluentd/logs
  open_timeout 2

  headers {"x-oneuptime-token":"YOUR_SERVICE_TOKEN", "x-oneuptime-service-name":"YOUR_SERVICE_NAME"}

  content_type application/json
  json_array true

  # Send a batch again when OneUptime is busy (429) or restarting (502, 503, 504)
  retryable_response_codes 429,502,503,504

  <format>
    @type json
  </format>
  <buffer>
    # Keep the batches on disk until OneUptime takes them: a restart of Fluentd loses none
    @type file
    path /var/log/fluent/buffer/oneuptime
    total_limit_size 512m
    flush_interval 10s
    chunk_limit_size 900k
    # Try again at least every 30 seconds, for up to 72 hours
    retry_max_interval 30s
    retry_timeout 72h
  </buffer>
</match>

# Keep Fluentd's own logs out of OneUptime
<label @FLUENT_LOG>
  <match **>
    @type null
  </match>
</label>
```

`json_array true` 让缓冲区的每个块都以一个 JSON 数组发送，`flush_interval 10s` 则每 10 秒发送一次缓冲区。`chunk_limit_size 900k` 让每个请求都小于 1 MB，这是 OneUptime 在这个端点上接受的上限。

Fluentd 自己的默认设置也可以：不设 `content_type` 和 `json_array true` 时，Fluentd 会发送按行分隔的 JSON，每行一条记录，OneUptime 会把每一行读作它所表示的记录，无论是否使用 `compress gzip`。

`@type file` 把尚未发送的批次保存在 `path` 指定的文件夹中，因此重启 Fluentd 不会丢失其中任何一批；内存中的缓冲区（Fluentd 的默认设置）会丢失其中保存的内容。Fluentd 的用户必须能写入该文件夹：`/var/log/fluent` 是 fluent-package 的，`/var/log/td-agent` 是 td-agent 的，`/fluentd/log` 是 `fluent/fluentd` 镜像的。`total_limit_size 512m` 让那里最多保存 512 MB；满了之后，Fluentd 在发出一批数据之前不再接收记录。

`retryable_response_codes 429,502,503,504` 会在 OneUptime 繁忙（`429`）或正在重启（`502`、`503`、`504`）时重新发送一批数据；没有这一项，Fluentd 遇到 `503` 以外的任何响应都会丢弃这批数据。`retry_max_interval 30s` 让两次重试之间最多等待 30 秒，`retry_timeout 72h` 则会丢弃 72 小时后仍无法发送的一批数据。`record_transformer` 过滤器把 Fluentd 给每条记录的时间作为 `fluentd_time` 加入记录：HTTP 输出只发送记录本身，而 OneUptime 从记录中读取日志的时间。

### 重启 Fluentd

重启 Fluentd 服务，让它加载新的输出。

### 确认日志已到达

下一次刷新之后几秒钟内，日志就会出现在 **产品 → 日志** 中。服务会列在 **产品 → 服务** 下；如果它之前不存在，OneUptime 会创建它。
:::

## 完整示例

这份配置在端口 `24224` 上通过 Fluentd 的 forward 协议只接收来自本主机的记录，并把它们全部发送到 OneUptime：

```text title="fluentd.conf"
####
## Source descriptions:
##

## built-in TCP input
## @see https://docs.fluentd.org/input/forward
<source>
  @type forward
  port 24224
  # This host alone: see "Take records from other hosts" to open it
  bind 127.0.0.1
</source>

# Send the time Fluentd gave each event: the HTTP output sends only the record
<filter **>
  @type record_transformer
  enable_ruby true
  <record>
    fluentd_time ${time.utc.strftime("%Y-%m-%dT%H:%M:%S.%NZ")}
  </record>
</filter>

<match **>
  @type http

  endpoint https://oneuptime.com/fluentd/logs
  open_timeout 2

  headers {"x-oneuptime-token":"YOUR_SERVICE_TOKEN", "x-oneuptime-service-name":"YOUR_SERVICE_NAME"}

  content_type application/json
  json_array true

  # Send a batch again when OneUptime is busy (429) or restarting (502, 503, 504)
  retryable_response_codes 429,502,503,504

  <format>
    @type json
  </format>
  <buffer>
    # Keep the batches on disk until OneUptime takes them: a restart of Fluentd loses none
    @type file
    path /var/log/fluent/buffer/oneuptime
    total_limit_size 512m
    flush_interval 10s
    chunk_limit_size 900k
    # Try again at least every 30 seconds, for up to 72 hours
    retry_max_interval 30s
    retry_timeout 72h
  </buffer>
</match>

# Keep Fluentd's own logs out of OneUptime
<label @FLUENT_LOG>
  <match **>
    @type null
  </match>
</label>
```

`bind 127.0.0.1` 只接收来自本主机的记录，例如 Docker 的 `fluentd` 日志驱动发往 `localhost:24224` 的记录。要把不同的来源作为不同的服务发送，请为每个标签使用一个 `<match>` 段，并各自设置 `x-oneuptime-service-name` 和缓冲区的 `path`：两个缓冲区使用同一路径时，Fluentd 无法启动。

## 接收来自其他主机的记录

使用 `bind 0.0.0.0` 而没有 `<security>` 部分时，任何能访问端口 `24224` 的人都可以用你的摄取密钥向 OneUptime 发送日志。要接收其他主机上 Fluentd 或 Fluent Bit 的记录，请在所有地址上监听，要求每个发送方提供共享密钥，并使用 TLS。把完整示例的 `<source>` 部分替换为：

```text title="fluentd.conf on this host"
<source>
  @type forward
  port 24224
  bind 0.0.0.0
  <transport tls>
    cert_path /etc/fluent/certs/fluentd.crt
    private_key_path /etc/fluent/certs/fluentd.key
  </transport>
  <security>
    self_hostname fluentd.example.com
    shared_key YOUR_SHARED_KEY
  </security>
</source>
```

`cert_path` 和 `private_key_path` 是本主机名称（这里是 `fluentd.example.com`）的证书及其私钥，Fluentd 的用户必须能读取它们。私钥没有密码短语时 Fluentd 会发出警告；`private_key_passphrase` 用来设置密码短语。把 `YOUR_SHARED_KEY` 换成一个很长的随机密钥，例如用 `openssl rand -base64 32` 生成的，并给每个发送方设置同一个：

```text title="fluentd.conf on each sender"
<match **>
  @type forward
  transport tls
  # The certificate of the authority that signed this host's; not needed for a public one
  tls_cert_path /etc/fluent/certs/ca.crt
  <security>
    self_hostname app-1.example.com
    shared_key YOUR_SHARED_KEY
  </security>
  <server>
    host fluentd.example.com
    port 24224
  </server>
  <buffer>
    @type file
    path /var/log/fluent/buffer/forward
  </buffer>
</match>

# Keep Fluentd's own logs out of OneUptime
<label @FLUENT_LOG>
  <match **>
    @type null
  </match>
</label>
```

Fluent Bit 的 `forward` 输出接受同样的设置：`Shared_Key`、`Self_Hostname`、`tls On` 和 `tls.ca_file`。

没有密钥或不使用 TLS 的发送方会被拒绝。密钥本身从不经过网络：双方各自证明自己持有它。没有 TLS，主机之间网络上的任何人都能读取这些记录。只在主机防火墙中对发送数据的主机开放端口 `24224`。如果 Fluentd 通过日志指南的 Docker Compose 文件运行，也要在那里把端口发布到所有地址（`"24224:24224"`），并把证书所在的文件夹挂载到容器中。

## 如何读取记录

OneUptime 从每条记录中读取以下字段：

| 日志字段 | 从记录中以下字段里最先出现的一个读取 | 说明 |
| --- | --- | --- |
| 正文 | `message`、`log`、`msg`、`body`、`text` | 日志行。这些字段都没有的记录会整条以 JSON 保存。 |
| 严重级别 | `level`、`severity`、`loglevel`、`log_level`、`priority`、`severityText`、`severity_text` | 例如 `trace`、`debug`、`info`、`notice`、`warn`、`error`、`critical` 和 `fatal` 这样的名称，不区分大小写。其他任何值都会保存为 `Unspecified`。 |
| 追踪 ID | `trace_id`、`traceId`、`traceid` | 把日志关联到它的追踪。 |
| Span ID | `span_id`、`spanId`、`spanid` | 把日志关联到它的 span。 |
| 服务 | `x-oneuptime-service-name` 请求头 | 未设置该请求头时为 `Fluentd`。 |
| 时间 | `time`、`timestamp`、`@timestamp`、`ts`、`fluentd_time` | ISO 8601 时间，例如 `2026-11-14T08:00:00.123Z`，或自纪元起的秒、毫秒、微秒或纳秒；没有时区的时间按 UTC 处理。早于 2000 年或超前一天以上的时间不会被读取。读取时间的字段不会保存为属性。没有时间的记录按 OneUptime 收到它的时间保存。 |

其他每个字段都会成为一个名为 `fluentd.` 加字段名的属性，可以用来搜索和筛选：例如 `container_name` 字段在日志浏览器中就是 `@fluentd.container_name`。嵌套对象会用点号展开，例如 `fluentd.kubernetes.pod_name`，列表则以 JSON 保存。

Fluentd 日志会像其他日志一样经过你的[日志管道](/docs/telemetry/log-pipelines)、丢弃过滤器和脱敏规则。

## 自托管 OneUptime

把 `endpoint` 中的 `https://oneuptime.com` 换成你的 OneUptime 实例的 URL：`http(s)://YOUR_ONEUPTIME_HOST/fluentd/logs`。

## 故障排除

:::details Fluentd 记录了来自 HTTP 输出的 `401`
摄取密钥缺失、未知或已过期。检查 `headers` 中 `x-oneuptime-token` 的值。
:::

:::details Fluentd 记录了 `402` 或 `422`
`402`：在 OneUptime Cloud 上，项目处于 Free 套餐且没有付款方式。请在 **项目设置 → 账单和发票 → 账单** 中添加。`422`：密钥已被禁用，或者是浏览器密钥。请在密钥的设置中重新打开 **已启用**，或者创建一个 **服务器** 密钥。
:::

:::details Fluentd 记录了 `413`
请求超过了 1 MB，这是 OneUptime 在这个端点上接受的上限。请像上面的配置那样，在 `<buffer>` 部分设置 `chunk_limit_size 900k`。
:::

:::details Fluentd 记录了 `429`、`502`、`503` 或 `504`
OneUptime 繁忙或正在重启。像上面的配置那样在 `<match>` 部分加上 `retryable_response_codes 429,502,503,504`，Fluentd 就会保留这批数据并重新发送；没有这一项，Fluentd 会丢弃这批数据。在 `<buffer>` 部分加上 `@type file`，Fluentd 重启时也会保留这批数据。
:::

:::details 日志显示的是 OneUptime 收到它们的时间，而不是它们自己的时间
OneUptime 从日志的记录中读取它的时间，而 Fluentd 的 HTTP 输出只发送记录本身。`<parse>` 部分会把 `time` 字段作为事件时间从记录中取出：请在其中加上 `time_key fluentd_time`，让它不读取任何记录的时间，并保留 `time` 原样。再加上上面配置中的 `record_transformer` 过滤器：它把 Fluentd 给每条记录的时间作为 `fluentd_time` 加入记录。
:::

:::details `time` 为 `null`、`true`、列表或对象的 JSON 行始终没有到达
Fluentd 的 `json` 解析器把一行的 `time` 字段读作事件时间，并且会在没有任何警告的情况下丢弃 `time` 既不是文本也不是数字的行。像上面一样在它的 `<parse>` 部分加上 `time_key fluentd_time`：这样 Fluentd 会把 `time` 原样留在记录中。有了上面的 `record_transformer` 过滤器，OneUptime 会按 Fluentd 读取它的时间 `fluentd_time` 存储日志；没有它，则按 OneUptime 收到它的时间存储。
:::

:::details 日志归到了 `Fluentd` 服务下
缺少 `x-oneuptime-service-name` 请求头。在每个 `<match>` 段的 `headers` 中加上它。
:::

:::details 日志正文显示了整条记录的 JSON
OneUptime 从记录中 `message`、`log`、`msg`、`body` 或 `text` 里最先出现的一个读取正文，这些都没有时就保存整条记录。把保存日志行的字段重命名为其中之一，例如使用 Fluentd 的 `record_transformer` 过滤器。
:::

如果对配置有任何问题或需要帮助，请发送邮件至 support@oneuptime.com。

## 后续步骤

:::cards
- [日志管道](/docs/telemetry/log-pipelines): 解析并丰富 Fluentd 发送的日志。
- [搜索语法](/docs/telemetry/search-syntax): 在日志浏览器中查找日志。
- [Fluent Bit](/docs/telemetry/fluentbit): 一个通过 OpenTelemetry 发送的更轻量的代理。
- [日志监控](/docs/monitor/logs-monitor): 出现匹配的日志时发出警报。
:::
