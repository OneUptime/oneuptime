# OneUptime Docker Agent

## 概覽

OneUptime Docker Agent 是一個預先建置的容器映像檔，內含經過調校的 OpenTelemetry Collector 設定。將它與您現有的容器一起執行，它會自動探索主機上的每個容器，收集 CPU / 記憶體 / 網路 / 區塊 I/O 指標以及容器日誌，並透過 OTLP 將所有資料轉送至 OneUptime。單一映像檔，單一指令。

本頁是**安裝指南**。若要在 Agent 所收集的資料之上設定 Docker 監控與警示，請參閱 [Docker Monitor](/docs/monitor/docker-monitor)。

## 先決條件

- Docker Engine 20.10+
- 可存取主機上的 `/var/run/docker.sock`
- 一組 **OneUptime Telemetry Ingestion Token** — 從 _Project Settings → Telemetry Ingestion Keys_ 建立一組，並複製其值

## 快速開始（單一指令）

請將 `YOUR_ONEUPTIME_URL`、`YOUR_TELEMETRY_INGESTION_TOKEN` 以及主機名稱替換為您環境的對應值。主機名稱即為此 Docker 主機在 OneUptime 中顯示的名稱 — 請挑選類似 `prod-docker-01` 的名稱。

```bash
docker run -d \
  --name oneuptime-docker-agent \
  --user 0:0 \
  --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v /var/lib/docker/containers:/var/lib/docker/containers:ro \
  -e ONEUPTIME_URL="YOUR_ONEUPTIME_URL" \
  -e ONEUPTIME_SERVICE_TOKEN="YOUR_TELEMETRY_INGESTION_TOKEN" \
  -e DOCKER_HOST_NAME="my-docker-host" \
  oneuptime/docker-agent:release
```

這樣就完成了。一旦 Agent 連線成功，您的 Docker 主機便會自動出現在 OneUptime 儀表板的 **Docker** 區段中。

## 替代方案 — Docker Compose

如果您偏好使用 Docker Compose，請將以下內容放入 `docker-compose.yml`：

```yaml
services:
  oneuptime-docker-agent:
    image: oneuptime/docker-agent:release
    container_name: oneuptime-docker-agent
    user: "0:0"
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
    environment:
      - ONEUPTIME_URL=YOUR_ONEUPTIME_URL
      - ONEUPTIME_SERVICE_TOKEN=YOUR_TELEMETRY_INGESTION_TOKEN
      - DOCKER_HOST_NAME=my-docker-host
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

啟動它：

```bash
docker compose up -d
```

## 環境變數

| 變數                      | 必填 | 說明                                                                                            |
| ------------------------- | ---- | ----------------------------------------------------------------------------------------------- |
| `ONEUPTIME_URL`           | 是   | 您的 OneUptime 執行個體 URL（例如 `https://oneuptime.com` 或您的自架主機）                      |
| `ONEUPTIME_SERVICE_TOKEN` | 是   | 來自 _Project Settings → Telemetry Ingestion Keys_ 的遙測擷取權杖                               |
| `DOCKER_HOST_NAME`        | 否   | 此主機的易記名稱。預設為 `docker-host`。請為每台主機設定一個穩定的名稱（例如 `prod-docker-01`） |

## 驗證安裝

檢查 Agent 是否正在執行：

```bash
docker ps --filter name=oneuptime-docker-agent
```

檢查 Agent 日誌：

```bash
docker logs -f oneuptime-docker-agent
```

尋找：`"Everything is ready. Begin running and processing data."`

大約一分鐘內，主機應會出現在 OneUptime 儀表板中，並開始有指標與日誌流入。

## 升級 Agent

```bash
docker pull oneuptime/docker-agent:release
docker rm -f oneuptime-docker-agent
# Re-run the `docker run` command above
```

或使用 Docker Compose：

```bash
docker compose pull
docker compose up -d
```

## 解除安裝 Agent

```bash
docker rm -f oneuptime-docker-agent
```

如果您使用 Docker Compose：

```bash
docker compose down
```

## 收集哪些資料

| 類別              | 資料                                           |
| ----------------- | ---------------------------------------------- |
| **CPU 指標**      | 使用量總計、使用率百分比、節流時間（每個容器） |
| **記憶體指標**    | 使用量、限制、百分比、RSS、快取（每個容器）    |
| **網路指標**      | 接收 / 傳送的位元組與封包（每個容器）          |
| **區塊 I/O 指標** | 讀取 / 寫入的位元組與操作數（每個容器）        |
| **容器資訊**      | 執行時間、重新啟動次數、處理程序數量           |
| **容器日誌**      | 來自所有容器的 stdout / stderr 日誌            |

## 自架 OneUptime

如果您是自架 OneUptime，請將 `ONEUPTIME_URL` 設定為您自己的執行個體：

```bash
-e ONEUPTIME_URL="https://your-oneuptime-host.example.com"
```

如果您的執行個體僅支援 HTTP，請使用 `http://` 與適當的連接埠。

## 疑難排解

### Docker Socket 權限遭拒

Agent 容器必須以 root 身分（`--user 0:0`）執行才能存取 `/var/run/docker.sock`。請確認 `--user 0:0` 旗標（或 Compose 中的 `user: "0:0"`）存在。

### Agent 顯示為已中斷連線

1. 檢查 Agent 是否正在執行：`docker ps --filter name=oneuptime-docker-agent`
2. 檢查 Agent 日誌：`docker logs oneuptime-docker-agent | grep -i error`
3. 確認您的 OneUptime URL 與服務權杖正確無誤
4. 確認您的 Docker 主機可透過網路連線至 OneUptime 執行個體

### 沒有出現任何指標

1. 確認 Agent 內部可存取 Docker socket：`docker exec oneuptime-docker-agent ls -la /var/run/docker.sock`
2. 檢查 collector 日誌是否有匯出錯誤：`docker logs oneuptime-docker-agent | tail -100`
3. 確認您的服務權杖有效且尚未過期

### 主機名稱顯示為容器 ID

請將 `DOCKER_HOST_NAME` 環境變數設定為易記名稱，並重新建立容器。

## 後續步驟

- 設定 **Docker Monitors** 以針對容器 CPU / 記憶體 / 重新啟動條件發出警示 — 請參閱 [Docker Monitor](/docs/monitor/docker-monitor)。
- 若是 Kubernetes 叢集而非獨立的 Docker 主機，請使用 [OneUptime Kubernetes Agent](/docs/telemetry/kubernetes-agent)。
- 若是非容器化的主機（Linux / macOS / Windows VM 與裸機），請使用 [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector)。
