# 向 OneUptime 发送 Syslog 数据

## 概述

OpenTelemetry 数据摄取服务现在接受原生 Syslog 负载。您可以将来自任何兼容 RFC3164 或 RFC5424 的数据源的消息直接通过 HTTPS 转发到 OneUptime。OneUptime 在存储所有内容之前会解析 Syslog 优先级、设施、严重程度、结构化数据和消息正文，使其成为可搜索的日志。

## 前提条件

- **遥测摄取令牌** – 从 _项目设置 → 遥测摄取密钥_ 创建一个，并复制 `x-oneuptime-token` 值。
- **Syslog 转发器** – 任何能够发送 HTTP POST 请求的工具（例如 `curl`、通过 `omhttp` 的 `rsyslog`，或使用 HTTP 目标插件的 `syslog-ng`）。
- **服务名称（可选）** – 设置 `x-oneuptime-service-name` 请求头，将传入日志归类到特定遥测服务下。省略时，OneUptime 回退到 Syslog `APP-NAME`、主机名或 `Syslog`。

## 端点

```
POST https://oneuptime.com/syslog/v1/logs
```

- 如果您是自托管 OneUptime，请将 `oneuptime.com` 替换为您的主机。
- 请求中始终包含 `x-oneuptime-token` 请求头。

## 请求体

发送以换行符分隔的 Syslog 字符串或包含 `messages` 数组的 JSON 负载。RFC3164（BSD）和 RFC5424 格式均受支持。

```json
{
  "messages": [
    "<34>1 2025-03-02T14:48:05.003Z web-01 nginx 7421 ID47 [env@32473 host=\"web-01\"] 502 on /api/login",
    "<13>Feb  5 17:32:18 db-01 postgres[2419]: connection received from 10.0.0.12"
  ]
}
```

### 支持的内容类型

- `application/json` – 推荐。
- `text/plain` – 换行符分隔的消息。
- `application/octet-stream` – 原始负载。也接受 Gzip 压缩（`Content-Encoding: gzip`）。

## 使用 curl 快速测试

```bash
curl \
  -X POST https://oneuptime.com/syslog/v1/logs \
  -H "Content-Type: application/json" \
  -H "x-oneuptime-token: YOUR_TELEMETRY_KEY" \
  -H "x-oneuptime-service-name: production-web" \
  -d '{
    "messages": [
      "<34>1 2025-03-02T14:48:05.003Z web-01 nginx 7421 ID47 [env@32473 host=\"web-01\"] 502 on /api/login"
    ]
  }'
```

## 从 rsyslog 转发

1. 安装 HTTP 输出模块：
   ```bash
   sudo apt-get install rsyslog-omhttp
   ```
2. 将目标配置追加到 `/etc/rsyslog.d/oneuptime.conf`：

   ```
   module(load="omhttp")

   template(name="OneUptimeJson" type="list") {
     constant(value="{\"messages\":[\"")
     property(name="rawmsg")
     constant(value="\"]}")
   }

   action(
     type="omhttp"
     server="oneuptime.com"
     serverport="443"
     usehttps="on"
     endpoint="/syslog/v1/logs"
     header="Content-Type: application/json"
     header="x-oneuptime-token: YOUR_TELEMETRY_KEY"
     header="x-oneuptime-service-name: rsyslog-demo"
     template="OneUptimeJson"
   )
   ```

3. 重启 rsyslog：
   ```bash
   sudo systemctl restart rsyslog
   ```

## 我们已经看到的常见使用场景

### 1. 网络和安全设备

大多数网络设备仍然仅通过 Syslog 暴露配置更改、ACL 命中和威胁检测信息。将您现有的中继（Palo Alto、Fortinet、Cisco ASA、Juniper、pfSense 等）直接指向 OneUptime，或保持内部中继并通过 HTTPS 转发：

```bash
# rsyslog 片段，将消息批量打包成 JSON 并 POST 到 OneUptime
module(load="omhttp")

template(name="OneUptimeJSON" type="list") {
  constant(value="{\"messages\":[\"")
  property(name="rawmsg")
  constant(value="\"]}")
}

action(
  type="omhttp"
  server="oneuptime.com"
  serverport="443"
  usehttps="on"
  endpoint="/syslog/v1/logs"
  header="Content-Type: application/json"
  header="x-oneuptime-token: <TOKEN>"
  header="x-oneuptime-service-name: perimeter-firewall"
  template="OneUptimeJSON"
)
```

### 2. Linux 服务器和 Cron 作业

许多 Cron 作业和旧版守护进程仍然仅通过内核/syslog 设施记录日志。转发 `/var/log/syslog` 或 journald 条目可以将操作记录保存在一个地方。基于 Systemd 的主机可以依赖 journald → syslog 桥接：

```bash
# /etc/rsyslog.d/oneuptime.conf
module(load="imjournal" StateFile="imjournal.state")
module(load="omhttp")

action(
  type="omhttp"
  server="oneuptime.com"
  serverport="443"
  usehttps="on"
  endpoint="/syslog/v1/logs"
  header="Content-Type: application/json"
  header="x-oneuptime-token: <TOKEN>"
  header="x-oneuptime-service-name: linux-fleet"
  template="OneUptimeJSON"
)
```

由于我们映射了严重程度代码，您可以对 `syslog.severity.name = "error"` 发出告警，或通过 `syslog.hostname` 切片以快速隔离噪声较多的主机。

### 3. Kubernetes 入口控制器和边缘节点

如果您已经运行 Fluent Bit 或 Fluentd，请保留它们用于容器日志，并为边缘主机或设备添加轻量级 Syslog 接收器。Fluent Bit 的 `syslog` 输入与 HTTP 输出配合使用：

```ini
[INPUT]
    Name              syslog
    Mode              tcp
    Listen            0.0.0.0
    Port              5140

[OUTPUT]
    Name              http
    Match             *
    Host              oneuptime.com
    Port              443
    URI               /syslog/v1/logs
    Format            json
    json_date_key     time
    Header            Content-Type application/json
    Header            x-oneuptime-token <TOKEN>
    Header            x-oneuptime-service-name edge-ingress
    tls               On
```

此设置允许您从裸金属 Worker 或硬件负载均衡器摄取 Syslog，而无需创建另一个日志记录栈。

### 4. 无需等待的合规归档

需要为 PCI 或 SOX 保留防火墙日志？直接将它们发送到 OneUptime，对遥测服务应用长保留策略，并从一个地方导出到冷存储。无需再从多个 Syslog 中继导出。

## 解析的属性

OneUptime 自动为每条日志条目添加以下属性：

- `syslog.priority`、`syslog.facility.code`、`syslog.facility.name`
- `syslog.severity.code`、`syslog.severity.name`
- `syslog.hostname`、`syslog.appName`、`syslog.processId`、`syslog.messageId`
- `syslog.structured.*`（扁平化的 RFC5424 结构化数据）
- `syslog.raw`（原始消息，用于追溯）

这些属性在遥测 → 日志浏览器中变为可搜索的内容。

## 故障排查

- **HTTP 401 或空结果** – 验证 `x-oneuptime-token` 请求头是否属于接收日志的项目。
- **日志未出现** – 确认请求体实际包含 Syslog 行。空请求体将以 HTTP 400 被拒绝。
- **意外的服务名称** – 设置 `x-oneuptime-service-name` 以覆盖默认检测逻辑。
- **大量突发请求** – 每个请求支持批量处理最多 1,000 行。更大的突发请求会排队并异步处理。
