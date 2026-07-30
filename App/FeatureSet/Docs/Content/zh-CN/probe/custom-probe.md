## 设置自定义探针

您可以在您的网络内部设置自定义探针，以监控私有网络中的资源或防火墙后面的资源。

首先，您需要在项目设置 > 探针中创建自定义探针。在 OneUptime 控制台上创建自定义探针后，您应该获得 `PROBE_ID` 和 `PROBE_KEY`。

### 部署探针

#### Docker

要运行探针，请确保已安装 Docker。您可以通过以下方式运行自定义探针：

```
docker run --name oneuptime-probe --network host -e PROBE_KEY=<probe-key> -e PROBE_ID=<probe-id> -e ONEUPTIME_URL=https://oneuptime.com -d oneuptime/probe:release
```

如果您是自托管 OneUptime，可以将 `ONEUPTIME_URL` 更改为您自定义的自托管实例。

##### 代理配置

如果您的探针需要通过代理服务器访问 OneUptime 或监控外部资源，可以使用以下环境变量配置代理设置：

```
# HTTP 代理
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTP_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release

# HTTPS 代理
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTPS_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release

# 带认证的代理
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTP_PROXY_URL=http://username:password@proxy.example.com:8080 \
  -e HTTPS_PROXY_URL=http://username:password@proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release
```

#### Docker Compose

您也可以使用 docker-compose 运行探针。创建一个 `docker-compose.yml` 文件，内容如下：

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
    network_mode: host
    restart: always
```

##### 带代理配置

如果您需要使用代理服务器，可以添加代理环境变量：

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
      # 代理配置（可选）
      - HTTP_PROXY_URL=http://proxy.example.com:8080
      - HTTPS_PROXY_URL=http://proxy.example.com:8080
      - NO_PROXY=localhost,.internal.example.com
      # 带认证的代理：
      # - HTTP_PROXY_URL=http://username:password@proxy.example.com:8080
      # - HTTPS_PROXY_URL=http://username:password@proxy.example.com:8080
      # - NO_PROXY=localhost,.internal.example.com
    network_mode: host
    restart: always
```

然后运行以下命令：

```
docker compose up -d
```

如果您是自托管 OneUptime，可以将 `ONEUPTIME_URL` 更改为您自定义的自托管实例。

#### Kubernetes

您也可以使用 Kubernetes 运行探针。创建一个 `oneuptime-probe.yaml` 文件，内容如下：

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
```

##### 带代理配置

如果您需要使用代理服务器，可以添加代理环境变量：

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
            # 代理配置（可选）
            - name: HTTP_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: HTTPS_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: NO_PROXY
              value: "localhost,.internal.example.com"
            # 带认证的代理，使用：
            # - name: HTTP_PROXY_URL
            #   value: "http://username:password@proxy.example.com:8080"
            # - name: HTTPS_PROXY_URL
            #   value: "http://username:password@proxy.example.com:8080"
            # - name: NO_PROXY
            #   value: "localhost,.internal.example.com"
```

然后运行以下命令：

```bash
kubectl apply -f oneuptime-probe.yaml
```

如果您是自托管 OneUptime，可以将 `ONEUPTIME_URL` 更改为您自定义的自托管实例。

### 环境变量

探针支持以下环境变量：

#### 必填变量

- `PROBE_KEY` - 来自您 OneUptime 控制台的探针密钥
- `PROBE_ID` - 来自您 OneUptime 控制台的探针 ID
- `ONEUPTIME_URL` - 您的 OneUptime 实例 URL（默认：https://oneuptime.com）

#### 可选变量

- `HTTP_PROXY_URL` - HTTP 请求的 HTTP 代理服务器 URL
- `HTTPS_PROXY_URL` - HTTPS 请求的 HTTP 代理服务器 URL
- `NO_PROXY` - 应绕过代理的主机或域名（逗号分隔）
- `PROBE_NAME` - 探针的自定义名称
- `PROBE_DESCRIPTION` - 探针的描述
- `PROBE_MONITORING_WORKERS` - 监控 Worker 数量（默认：1）
- `PROBE_MONITOR_FETCH_LIMIT` - 一次获取的监控器数量（默认：10）
- `PROBE_MONITOR_RETRY_LIMIT` - 失败监控器的重试次数（默认：3）
- `PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS` - 合成监控器脚本的超时时间（毫秒，默认：60000）
- `PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS` - 自定义代码监控器脚本的超时时间（毫秒，默认：60000）
- `PROBE_API_REQUEST_TIMEOUT_IN_MS` - 探针发送至 OneUptime 的每个请求的截止时间（默认：45000）
- `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` - 对发送至 OneUptime 且耗时超过该值的请求记录警告日志（默认：10000）

#### 代理配置

探针支持 HTTP 和 HTTPS 代理服务器。配置后，探针将通过指定的代理服务器路由所有监控流量。您还可以提供逗号分隔的 `NO_PROXY` 列表，以跳过内部主机或网络的代理。

**代理 URL 格式：**

```
http://[username:password@]proxy.server.com:port
```

**示例：**

- 基本代理：`http://proxy.example.com:8080`
- 带认证：`http://username:password@proxy.example.com:8080`

**支持的功能：**

- HTTP 和 HTTPS 代理支持
- 代理认证（用户名/密码）
- HTTP 和 HTTPS 代理之间的自动回退
- 使用 `NO_PROXY` 选择性绕过代理
- 适用于所有监控器类型（网站、API、SSL、合成等）

**注意：** 支持标准环境变量（`HTTP_PROXY_URL`、`HTTPS_PROXY_URL`、`NO_PROXY`）和小写变体（`http_proxy`、`https_proxy`、`no_proxy`）以实现兼容性。

### 验证

如果探针运行成功，它应该在您的 OneUptime 控制台上显示为 `Connected`（已连接）。如果未显示为已连接，您需要检查容器的日志。如果仍然遇到问题，请在 [GitHub](https://github.com/oneuptime/oneuptime) 上创建 Issue 或[联系支持](https://oneuptime.com/support)。

### 诊断已断开连接的探针

当探针发送至 OneUptime 的请求不再成功时，该探针会被标记为 `Disconnected`（已断开连接）。探针日志会记录每个失败请求卡在了哪个环节，因此您很少需要靠猜测来排查。

**1. 查看启动时打印的环境信息块。** 每个探针在启动时都会打印一个 JSON 块，其中包含它所使用的 OneUptime URL、请求截止时间、代理设置、继承的 DNS 解析器、Node/操作系统版本，以及是否已禁用 TLS 验证。报告问题时，请始终附上该信息块。

**2. 找到失败报告。** 每个发送至 OneUptime 的失败请求都会记录一个包含 `stalledAt` 和 `whatThisMeans` 的日志块。`stalledAt` 表示该请求始终未能通过的阶段：

| `stalledAt` | 含义 |
| --- | --- |
| `SocketAssignment` | 没有任何数据离开这台机器。可能是套接字连接池已耗尽，或所配置的代理始终未能完成 CONNECT 隧道的建立。 |
| `TcpConnect` | 机器发出了 SYN，却没有收到任何回应——防火墙或安全设备正在丢弃数据包，或者目标主机不可达。 |
| `TlsHandshake` | TCP 已连接，但 TLS 始终未完成握手。通常是由于中间存在执行 TLS 检测的网络设备。 |
| `RequestSend` | 连接已建立，但请求始终未能完整写出——对端停止了读取。 |
| `WaitingForServerResponse` | 请求已送达，但服务器没有返回任何内容。**探针侧的网络没有问题**——请检查 OneUptime 服务器及其负载均衡器和反向代理。 |
| `ResponseBody` | 服务器已开始应答，但中途停滞。 |

同一个日志块还会报告 `deadlineOverrunInMs`。如果 45000 毫秒的截止时间实际耗费的挂钟时间远超 45000 毫秒，说明是探针进程本身被阻塞了——请先检查该日志块中的 `probeProcess.eventLoopMaxDriftInMs`，然后再去排查网络。

**3. 查看连通性自检结果。** 连续三次失败后，探针会逐层测试同一台服务器——先是 DNS，然后是 TCP、TLS，最后是一次真实的 HTTP 往返——并记录每个阶段及其耗时。第一个失败的阶段就是答案。如果配置了代理，探针会测试到代理的这一跳，因为那是它实际发出的唯一一跳。

**4. 在慢请求演变为失败之前就加以关注。** 请求成功但耗时超过 `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` 时，会连同其耗时一起记录到日志中。如果探针开始记录耗时 20 秒的请求，说明它正在逼近 45 秒的截止时间。

在 OneUptime 服务器侧，响应缓慢的探针请求——或者探针在服务器发出响应之前就已放弃的请求——同样会被记录下来，并附带该探针的 id。将两侧的日志结合起来，就能判断问题出在连接的哪一端。
