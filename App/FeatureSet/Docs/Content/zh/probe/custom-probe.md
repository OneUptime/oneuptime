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
