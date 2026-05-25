## 設置自定義探針

您可以在您的網絡內部設置自定義探針，以監控私有網絡中的資源或防火牆後面的資源。

首先，您需要在項目設置 > 探針中創建自定義探針。在 OneUptime 控制台上創建自定義探針後，您應該獲得 `PROBE_ID` 和 `PROBE_KEY`。

### 部署探針

#### Docker

要運行探針，請確保已安裝 Docker。您可以通過以下方式運行自定義探針：

```
docker run --name oneuptime-probe --network host -e PROBE_KEY=<probe-key> -e PROBE_ID=<probe-id> -e ONEUPTIME_URL=https://oneuptime.com -d oneuptime/probe:release
```

如果您是自託管 OneUptime，可以將 `ONEUPTIME_URL` 更改爲您自定義的自託管實例。

##### 代理配置

如果您的探針需要通過代理服務器訪問 OneUptime 或監控外部資源，可以使用以下環境變量配置代理設置：

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

# 帶認證的代理
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

您也可以使用 docker-compose 運行探針。創建一個 `docker-compose.yml` 文件，內容如下：

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

##### 帶代理配置

如果您需要使用代理服務器，可以添加代理環境變量：

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
      # 代理配置（可選）
      - HTTP_PROXY_URL=http://proxy.example.com:8080
      - HTTPS_PROXY_URL=http://proxy.example.com:8080
      - NO_PROXY=localhost,.internal.example.com
      # 帶認證的代理：
      # - HTTP_PROXY_URL=http://username:password@proxy.example.com:8080
      # - HTTPS_PROXY_URL=http://username:password@proxy.example.com:8080
      # - NO_PROXY=localhost,.internal.example.com
    network_mode: host
    restart: always
```

然後運行以下命令：

```
docker compose up -d
```

如果您是自託管 OneUptime，可以將 `ONEUPTIME_URL` 更改爲您自定義的自託管實例。

#### Kubernetes

您也可以使用 Kubernetes 運行探針。創建一個 `oneuptime-probe.yaml` 文件，內容如下：

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

##### 帶代理配置

如果您需要使用代理服務器，可以添加代理環境變量：

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
          # 代理配置（可選）
          - name: HTTP_PROXY_URL
            value: "http://proxy.example.com:8080"
          - name: HTTPS_PROXY_URL
            value: "http://proxy.example.com:8080"
          - name: NO_PROXY
            value: "localhost,.internal.example.com"
          # 帶認證的代理，使用：
          # - name: HTTP_PROXY_URL
          #   value: "http://username:password@proxy.example.com:8080"
          # - name: HTTPS_PROXY_URL
          #   value: "http://username:password@proxy.example.com:8080"
          # - name: NO_PROXY
          #   value: "localhost,.internal.example.com"
```

然後運行以下命令：

```bash
kubectl apply -f oneuptime-probe.yaml
```

如果您是自託管 OneUptime，可以將 `ONEUPTIME_URL` 更改爲您自定義的自託管實例。

### 環境變量

探針支持以下環境變量：

#### 必填變量
- `PROBE_KEY` - 來自您 OneUptime 控制台的探針密鑰
- `PROBE_ID` - 來自您 OneUptime 控制台的探針 ID
- `ONEUPTIME_URL` - 您的 OneUptime 實例 URL（默認：https://oneuptime.com）

#### 可選變量
- `HTTP_PROXY_URL` - HTTP 請求的 HTTP 代理服務器 URL
- `HTTPS_PROXY_URL` - HTTPS 請求的 HTTP 代理服務器 URL
- `NO_PROXY` - 應繞過代理的主機或域名（逗號分隔）
- `PROBE_NAME` - 探針的自定義名稱
- `PROBE_DESCRIPTION` - 探針的描述
- `PROBE_MONITORING_WORKERS` - 監控 Worker 數量（默認：1）
- `PROBE_MONITOR_FETCH_LIMIT` - 一次獲取的監控器數量（默認：10）
- `PROBE_MONITOR_RETRY_LIMIT` - 失敗監控器的重試次數（默認：3）
- `PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS` - 合成監控器腳本的超時時間（毫秒，默認：60000）
- `PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS` - 自定義代碼監控器腳本的超時時間（毫秒，默認：60000）

#### 代理配置

探針支持 HTTP 和 HTTPS 代理服務器。配置後，探針將通過指定的代理服務器路由所有監控流量。您還可以提供逗號分隔的 `NO_PROXY` 列表，以跳過內部主機或網絡的代理。

**代理 URL 格式：**
```
http://[username:password@]proxy.server.com:port
```

**示例：**
- 基本代理：`http://proxy.example.com:8080`
- 帶認證：`http://username:password@proxy.example.com:8080`

**支持的功能：**
- HTTP 和 HTTPS 代理支持
- 代理認證（用戶名/密碼）
- HTTP 和 HTTPS 代理之間的自動回退
- 使用 `NO_PROXY` 選擇性繞過代理
- 適用於所有監控器類型（網站、API、SSL、合成等）

**注意：** 支持標準環境變量（`HTTP_PROXY_URL`、`HTTPS_PROXY_URL`、`NO_PROXY`）和小寫變體（`http_proxy`、`https_proxy`、`no_proxy`）以實現兼容性。

### 驗證

如果探針運行成功，它應該在您的 OneUptime 控制台上顯示爲 `Connected`（已連接）。如果未顯示爲已連接，您需要檢查容器的日誌。如果仍然遇到問題，請在 [GitHub](https://github.com/oneuptime/oneuptime) 上創建 Issue 或[聯繫支持](https://oneuptime.com/support)。
