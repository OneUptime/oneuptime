# 传入请求入口

自定义探针可以选择运行一个**入站 HTTP 监听器**，接受来自私有网络内部的 `heartbeat` 和 `incoming-request` 调用，并将其转发到 OneUptime。这使得**没有出站互联网访问**的服务仍然可以通过向本地网络上的探针（而非直接向 `oneuptime.com`）发送请求，向[传入请求监控器](/docs/monitor/incoming-request-monitor)报告。

## 概述

当设置 `PROBE_INGRESS_PORT` 时，探针会在该端口上绑定一个额外的 HTTP 监听器。监听器接受与公共 OneUptime 端点相同的 `secretkey` URL 路径：

- `POST /heartbeat/:secretkey`
- `GET /heartbeat/:secretkey`
- `POST /incoming-request/:secretkey`
- `GET /incoming-request/:secretkey`

然后探针将请求代理到您的 OneUptime 实例，保留方法、正文和请求头（减去逐跳头，如 `Host`、`Connection`、`Content-Length` 等）。探针自动附加 `OneUptime-Probe-Id` 头，以便将请求归属到转发探针。

监听器运行在**专用端口**上，与探针的内部状态/指标端点分离，因此您可以将其暴露给私有网络而不暴露其他任何内容。

## 何时使用此功能

在以下情况下使用入口监听器：

- 您的服务运行在没有出站 HTTPS 访问的隔离网络段中
- 您需要将所有监控流量保持在 VPC/内部网络中
- 您希望只有一个出口点（探针）被允许访问 OneUptime
- 您已经部署了[自定义探针](/docs/probe/custom-probe)，并希望将其重用于入站心跳

如果您的服务已经可以直接访问 `https://oneuptime.com`（或您的自托管 URL），您**不需要**此功能——直接从服务调用心跳 URL 即可。

## 启用入口监听器

将 `PROBE_INGRESS_PORT` 设置为您希望监听器绑定的端口。任何大于 `0` 的值都会启用监听器；将其保留未设置（或 `0`）将禁用它。

### Docker

```bash
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e PROBE_INGRESS_PORT=3875 \
  -d oneuptime/probe:release
```

如果您不使用 `--network host`，请显式发布入口端口：

```bash
docker run --name oneuptime-probe \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e PROBE_INGRESS_PORT=3875 \
  -p 3875:3875 \
  -d oneuptime/probe:release
```

### Docker Compose

```yaml
version: "3"

services:
  oneuptime-probe:
    image: oneuptime/probe:release
    container_name: oneuptime-probe
    environment:
      - PROBE_KEY=<probe-key>
      - PROBE_ID=<probe-id>
      - ONEUPTIME_URL=https://oneuptime.com
      - PROBE_INGRESS_PORT=3875
    ports:
      - "3875:3875"
    restart: always
```

### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-probe
spec:
  selector:
    matchLabels:
      app: oneuptime-probe
  template:
    metadata:
      labels:
        app: oneuptime-probe
    spec:
      containers:
        - name: oneuptime-probe
          image: oneuptime/probe:release
          env:
            - name: PROBE_KEY
              value: "<probe-key>"
            - name: PROBE_ID
              value: "<probe-id>"
            - name: ONEUPTIME_URL
              value: "https://oneuptime.com"
            - name: PROBE_INGRESS_PORT
              value: "3875"
          ports:
            - name: ingress
              containerPort: 3875
---
apiVersion: v1
kind: Service
metadata:
  name: oneuptime-probe-ingress
spec:
  selector:
    app: oneuptime-probe
  ports:
    - name: ingress
      port: 3875
      targetPort: 3875
  type: ClusterIP
```

内部服务可以将心跳发送到 `http://oneuptime-probe-ingress.<namespace>.svc.cluster.local:3875/heartbeat/<secret-key>`。

## 向探针发送请求

将公共心跳 URL：

```
https://oneuptime.com/heartbeat/<secret-key>
```

替换为探针的入口 URL：

```
http://<probe-host>:<PROBE_INGRESS_PORT>/heartbeat/<secret-key>
```

路径、方法、正文和头信息与原来相同，因此任何现有的客户端代码只需更改基础 URL。

### 示例

```bash
# GET 心跳
curl http://probe.internal:3875/heartbeat/YOUR_SECRET_KEY

# 带 JSON 正文的 POST 心跳
curl -X POST http://probe.internal:3875/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{"status": "healthy", "version": "1.2.3"}'

# Cron 作业
*/5 * * * * curl -s http://probe.internal:3875/heartbeat/YOUR_SECRET_KEY > /dev/null
```

## 转发行为

- **同步响应，异步转发。** 探针立即以 `200` 确认入站请求，并在后台转发到 OneUptime。您的服务无需等待转发完成。
- **头信息被保留。** 除逐跳头（`Host`、`Connection`、`Content-Length`、`Transfer-Encoding`、`Keep-Alive`、`Proxy-Authenticate`、`Proxy-Authorization`、`TE`、`Trailer`、`Upgrade`）外，所有头信息都会被传递。探针添加 `OneUptime-Probe-Id` 头以标识自己。
- **正文被保留。** 接受最多 **50 MB** 的 JSON、URL 编码和原始 `application/octet-stream` 负载。
- **带退避的重试。** 如果转发失败，探针最多重试 `PROBE_INGRESS_FORWARD_RETRY_LIMIT` 次，采用指数退避（2秒、4秒、8秒，最多15秒）。
- **代理感知。** 如果探针本身配置了 `HTTP_PROXY_URL` / `HTTPS_PROXY_URL`，转发的请求将通过代理发送。

## 环境变量

| 变量                                | 默认值           | 描述                                                           |
| ----------------------------------- | ---------------- | -------------------------------------------------------------- |
| `PROBE_INGRESS_PORT`                | _未设置_（禁用） | 入站监听器绑定的端口。任何值 `> 0` 都启用入口。                |
| `PROBE_INGRESS_FORWARD_TIMEOUT_MS`  | `10000`          | 每次向 OneUptime 转发尝试的超时时间（毫秒）。最小值为 `1000`。 |
| `PROBE_INGRESS_FORWARD_RETRY_LIMIT` | `3`              | 探针放弃转发前的重试次数。设置为 `0` 以禁用重试。              |

标准探针变量（`PROBE_KEY`、`PROBE_ID`、`ONEUPTIME_URL`、代理变量）均适用——完整列表请参见[自定义探针](/docs/probe/custom-probe)。

## 安全注意事项

- **端点根据设计是未认证的** — URL 路径中的密钥*就是*认证凭据，就像公共 `oneuptime.com` 端点一样。请将密钥视为凭据。
- **仅绑定到私有接口。** 入口监听器不应从公共互联网访问。使用网络策略、防火墙规则或 `ClusterIP` 服务来限制访问。
- **如果需要传输中加密，请使用 HTTPS 终止。** 探针的监听器使用纯 HTTP。如果入站连接需要 TLS，请将其放在内部负载均衡器/入口控制器后面。从探针到 OneUptime 的转发路段始终使用 HTTPS（假设 `ONEUPTIME_URL` 是 `https://`）。
- **资源限制。** 监听器接受最多 50 MB 的请求体。如果您需要更严格的限制，请在前面放置反向代理。

## 故障排查

- **探针启动时日志显示 `Probe ingress listener started on port <port>`** — 确认监听器已启动。如果您没有看到此行，则 `PROBE_INGRESS_PORT` 未设置、为 `0` 或无效。
- **`Probe ingress: failed to forward to <url> after N attempts`** — 探针无法访问 OneUptime。检查探针的出站连接、代理设置和 `ONEUPTIME_URL` 的值。
- **`Probe ingress: probe ID not available, forwarding without it`** — 探针尚未注册。转发仍然成功；心跳只是不会归属到探针。
- **心跳出现在 OneUptime 中但不是通过探针** — 确认您的服务正在访问 `http://<probe-host>:<port>/...` 而非公共 URL。错误配置的 DNS 或 `/etc/hosts` 条目是常见原因。

## 相关内容

- [自定义探针](/docs/probe/custom-probe)
- [传入请求监控器](/docs/monitor/incoming-request-monitor)
