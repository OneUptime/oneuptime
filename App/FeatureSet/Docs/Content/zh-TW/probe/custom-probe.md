## 設定自訂探針 (Custom Probes)

您可以在您的網路內設定自訂探針，以監控您私有網路中的資源，或位於防火牆後方的資源。

首先，您需要在 Project Settings > Probe 中建立一個自訂探針。在您於 OneUptime 儀表板上建立自訂探針之後，您應該會取得 `PROBE_ID` 與 `PROBE_KEY`。

### 部署探針

#### Docker

若要執行探針，請先確認您已安裝 docker。您可以透過以下方式執行自訂探針：

```
docker run --name oneuptime-probe --network host -e PROBE_KEY=<probe-key> -e PROBE_ID=<probe-id> -e ONEUPTIME_URL=https://oneuptime.com -d oneuptime/probe:release
```

如果您是自行託管 OneUptime，您可以將 `ONEUPTIME_URL` 變更為您自訂的自行託管執行個體。

##### Proxy 設定

如果您的探針需要透過 proxy 伺服器才能連線至 OneUptime 或監控外部資源，您可以使用以下環境變數來設定 proxy：

```
# For HTTP proxy
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTP_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release

# For HTTPS proxy
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTPS_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release

# With proxy authentication
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

您也可以使用 docker-compose 來執行探針。請建立一個包含以下內容的 `docker-compose.yml` 檔案：

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

##### 搭配 Proxy 設定

如果您需要使用 proxy 伺服器，您可以加入 proxy 環境變數：

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
      # Proxy configuration (optional)
      - HTTP_PROXY_URL=http://proxy.example.com:8080
      - HTTPS_PROXY_URL=http://proxy.example.com:8080
      - NO_PROXY=localhost,.internal.example.com
      # For proxy with authentication:
      # - HTTP_PROXY_URL=http://username:password@proxy.example.com:8080
      # - HTTPS_PROXY_URL=http://username:password@proxy.example.com:8080
      # - NO_PROXY=localhost,.internal.example.com
    network_mode: host
    restart: always
```

接著執行以下指令：

```
docker compose up -d
```

如果您是自行託管 OneUptime，您可以將 `ONEUPTIME_URL` 變更為您自訂的自行託管執行個體。

#### Kubernetes

您也可以使用 Kubernetes 來執行探針。請建立一個包含以下內容的 `oneuptime-probe.yaml` 檔案：

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

##### 搭配 Proxy 設定

如果您需要使用 proxy 伺服器，您可以加入 proxy 環境變數：

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
            # Proxy configuration (optional)
            - name: HTTP_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: HTTPS_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: NO_PROXY
              value: "localhost,.internal.example.com"
            # For proxy with authentication, use:
            # - name: HTTP_PROXY_URL
            #   value: "http://username:password@proxy.example.com:8080"
            # - name: HTTPS_PROXY_URL
            #   value: "http://username:password@proxy.example.com:8080"
            # - name: NO_PROXY
            #   value: "localhost,.internal.example.com"
```

接著執行以下指令：

```bash
kubectl apply -f oneuptime-probe.yaml
```

如果您是自行託管 OneUptime，您可以將 `ONEUPTIME_URL` 變更為您自訂的自行託管執行個體。

### 環境變數

探針支援以下環境變數：

#### 必要變數

- `PROBE_KEY` - 來自您 OneUptime 儀表板的探針金鑰
- `PROBE_ID` - 來自您 OneUptime 儀表板的探針 ID
- `ONEUPTIME_URL` - 您 OneUptime 執行個體的 URL（預設值：https://oneuptime.com）

#### 選用變數

- `HTTP_PROXY_URL` - 用於 HTTP 請求的 HTTP proxy 伺服器 URL
- `HTTPS_PROXY_URL` - 用於 HTTPS 請求的 HTTP proxy 伺服器 URL
- `NO_PROXY` - 應略過 proxy 的主機或網域，以逗號分隔
- `PROBE_NAME` - 探針的自訂名稱
- `PROBE_DESCRIPTION` - 探針的描述
- `PROBE_MONITORING_WORKERS` - 監控 worker 的數量（預設值：1）
- `PROBE_MONITOR_FETCH_LIMIT` - 一次擷取的監控器數量（預設值：10）
- `PROBE_MONITOR_RETRY_LIMIT` - 失敗監控器的重試次數（預設值：3）
- `PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS` - 合成監控器指令碼的逾時時間（以毫秒為單位，預設值：60000）
- `PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS` - 自訂程式碼監控器指令碼的逾時時間（以毫秒為單位，預設值：60000）

#### Proxy 設定

探針同時支援 HTTP 與 HTTPS proxy 伺服器。設定完成後，探針會將所有監控流量透過指定的 proxy 伺服器進行路由。您也可以提供以逗號分隔的 `NO_PROXY` 清單，讓內部主機或網路略過 proxy。

**Proxy URL 格式：**

```
http://[username:password@]proxy.server.com:port
```

**範例：**

- 基本 proxy：`http://proxy.example.com:8080`
- 搭配驗證：`http://username:password@proxy.example.com:8080`

**支援的功能：**

- HTTP 與 HTTPS proxy 支援
- Proxy 驗證（使用者名稱／密碼）
- HTTP 與 HTTPS proxy 之間的自動容錯移轉
- 使用 `NO_PROXY` 進行選擇性 proxy 略過
- 適用於所有監控器類型（Website、API、SSL、Synthetic 等）

**注意：** 為了相容性，標準環境變數（`HTTP_PROXY_URL`、`HTTPS_PROXY_URL`、`NO_PROXY`）與小寫變體（`http_proxy`、`https_proxy`、`no_proxy`）皆受支援。

### 驗證

如果探針成功執行，它應該會在您的 OneUptime 儀表板上顯示為 `Connected`。如果它未顯示為已連線，您需要檢查容器的記錄。如果您仍然遇到問題，請在 [GitHub](https://github.com/oneuptime/oneuptime) 上建立 issue，或[聯絡支援](https://oneuptime.com/support)。
