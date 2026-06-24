# Docker 監控

Docker 監控讓您能夠監控 Docker 主機以及執行於其上的容器的健康狀態與效能。OneUptime 透過預先設定好的 OpenTelemetry Collector（即 **OneUptime Docker Agent**）收集指標與容器日誌，並依據您所設定的條件加以評估。

## 概觀

Docker 監控使用來自您主機的指標與日誌，以提供對容器工作負載的可見性。這讓您能夠：

- 監控 Docker 主機及各容器的健康狀態
- 追蹤各容器的 CPU、記憶體、網路、區塊 I/O 以及行程數量
- 偵測容器重新啟動、當機以及 CPU 節流
- 以原生 OpenTelemetry 格式串流結構化的容器日誌
- 針對高 CPU、高記憶體、重新啟動迴圈等情況發出警示

## 建立 Docker 監控

1. 前往 OneUptime 儀表板中的 **Monitors**
2. 點選 **Create Monitor**
3. 選擇 **Docker** 作為監控類型
4. 選擇要監控的 Docker 主機與資源範圍
5. 設定指標查詢與彙總方式
6. 視需要設定監控條件

## 設定選項

### Docker 主機

選擇要監控的 Docker 主機。當 OneUptime Docker Agent 首次從主機傳送遙測資料時，主機便會自動註冊——您無需手動建立它們。

### 資源範圍

選擇要監控資源的層級：

| 範圍      | 說明                                 |
| --------- | ------------------------------------ |
| Host      | 監控整個 Docker 主機，跨所有容器彙總 |
| Container | 依名稱或映像檔監控特定容器           |

### 指標查詢

設定一個或多個要評估的指標查詢。每個查詢會指定：

- **指標名稱**——要查詢的容器指標
- **彙總方式**——如何彙總指標值（Avg、Sum、Max、Min）
- **篩選條件**——額外的以屬性為基礎的篩選（例如依容器名稱、映像檔或主機）
- **Group By**——可選擇依 `resource.container.name` 分組，使每個容器各自獨立評估

您也可以建立**公式**，使用數學運算式來組合多個指標查詢。

### 滾動時間窗

選擇用於指標評估的時間窗：

- 過去 1 分鐘
- 過去 5 分鐘
- 過去 10 分鐘
- 過去 15 分鐘
- 過去 30 分鐘
- 過去 60 分鐘

## 收集的指標

Docker Agent 使用 OpenTelemetry 的 `docker_stats` 接收器，它會以可設定的間隔（預設每 30 秒）擷取 Docker Engine API。

### CPU

| 指標                                              | 說明                                  |
| ------------------------------------------------- | ------------------------------------- |
| `container.cpu.utilization`                       | CPU 使用率，以佔主機 CPU 的百分比表示 |
| `container.cpu.usage.total`                       | 容器累計消耗的 CPU 時間               |
| `container.cpu.throttling_data.throttled_time`    | 容器被 cgroups 節流的時間             |
| `container.cpu.throttling_data.throttled_periods` | 節流期間的次數                        |

### 記憶體

| 指標                           | 說明                         |
| ------------------------------ | ---------------------------- |
| `container.memory.usage.total` | 目前的記憶體使用量（位元組） |
| `container.memory.usage.limit` | 記憶體上限（位元組）         |
| `container.memory.percent`     | 記憶體使用量佔上限的百分比   |

### 網路

| 指標                                  | 說明             |
| ------------------------------------- | ---------------- |
| `container.network.io.usage.rx_bytes` | 接收的總位元組數 |
| `container.network.io.usage.tx_bytes` | 傳送的總位元組數 |

### 區塊 I/O

| 指標                                                 | 說明                     |
| ---------------------------------------------------- | ------------------------ |
| `container.blockio.io_service_bytes_recursive.read`  | 從區塊裝置讀取的位元組數 |
| `container.blockio.io_service_bytes_recursive.write` | 寫入區塊裝置的位元組數   |

### 容器資訊

| 指標                   | 說明               |
| ---------------------- | ------------------ |
| `container.uptime`     | 容器運行時間（秒） |
| `container.restarts`   | 容器重新啟動的次數 |
| `container.pids.count` | 容器內部的行程數量 |

## 監控條件

### 可用的檢查類型

| 檢查類型     | 說明                     |
| ------------ | ------------------------ |
| Metric Value | 所設定指標查詢或公式的值 |

### 彙總類型

| 彙總方式      | 說明                 |
| ------------- | -------------------- |
| Average       | 時間窗內的平均值     |
| Sum           | 所有值的總和         |
| Maximum Value | 時間窗內的最高值     |
| Minimum Value | 時間窗內的最低值     |
| All Values    | 所有值都必須符合條件 |
| Any Value     | 至少有一個值必須符合 |

### 篩選類型

- **Greater Than**、**Less Than**、**Greater Than or Equal To**、**Less Than or Equal To**、**Equal To**、**Not Equal To**

## 預先建構的警示範本

OneUptime 為常見的 Docker 監控情境提供範本：

| 範本                   | 說明                       | 閾值  | 彙總方式        |
| ---------------------- | -------------------------- | ----- | --------------- |
| High Container CPU     | 每個容器的 CPU 使用率      | > 90% | Max（每個容器） |
| High Container Memory  | 記憶體使用量佔上限的百分比 | > 85% | Max（每個容器） |
| High CPU Throttling    | CPU 被節流的期間數         | > 0   | Max（每個容器） |
| Container Restart Loop | 容器重新啟動次數           | > 3   | Sum             |
| Container Down         | 容器運行時間重設為 0       | = 0   | Min             |

> 注意：CPU、記憶體與節流範本使用依 `resource.container.name` 分組的 **Max** 彙總。這可避免單一高負載容器的訊號被同一主機上眾多閒置容器所稀釋。

## 收集的日誌

除了指標之外，Docker Agent 還會透過 OpenTelemetry filelog 接收器追蹤每個容器的 `*-json.log` 檔案，並以原生 OTLP 日誌格式傳送日誌記錄。每筆日誌記錄都會附加以下資訊：

- `resource.host.name`——Docker 主機識別碼
- `resource.container.id`——完整的容器 ID
- `resource.container.runtime`——永遠為 `docker`
- `attributes["log.iostream"]`——`stdout` 或 `stderr`
- `severityText` / `severityNumber`——由串流推導而來：`stderr` → `ERROR`，`stdout` → `INFO`
- `body`——容器行程所發出的原始日誌行
- `time`——Docker daemon 為該行記錄的時間戳記

日誌會顯示在 Docker 主機的 **Logs** 分頁，以及每個容器的詳細資料頁面上。

### 日誌驅動程式需求

**Docker Agent 僅會擷取使用 Docker `json-file` 日誌驅動程式的容器所產生的日誌。** 這是 Docker 的預設值，但可以針對個別容器或全域加以覆寫：

- **`local`** 驅動程式——將二進位 protobuf 區塊寫入 `/var/lib/docker/containers/<id>/local-logs/container.log`。filelog 接收器無法解析此格式。
- **`journald`**、**`syslog`**、**`fluentd`**、**`gelf`**、**`awslogs`**、**`splunk`** 等——將日誌傳送至遠端目的地；沒有檔案可供追蹤。
- **`none`**——完全捨棄日誌。

如果使用了上述任一種驅動程式，您會在 Docker 主機頁面上看到指標，但 **Logs** 分頁會是空的（或僅包含 Docker Agent 自身的日誌）。

**檢查特定容器的日誌驅動程式：**

```bash
docker inspect <container> --format '{{.HostConfig.LogConfig.Type}}'
```

**檢查 daemon 的預設值：**

```bash
docker info --format '{{.LoggingDriver}}'
```

**將 Docker Compose 服務切換為 `json-file` 並設定合理的輪替：**

```yaml
services:
  my-app:
    image: my-app:latest
    logging:
      driver: "json-file"
      options:
        max-size: "100m"
        max-file: "5"
```

**切換 daemon 的預設值**（套用至之後建立的每個容器），方法為編輯 `/etc/docker/daemon.json`：

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "5"
  }
}
```

接著重新啟動 Docker daemon 並**重新建立**受影響的容器。Docker 會在容器建立時繫結日誌驅動程式，因此既有容器會保留其舊有驅動程式，直到被移除並重新建立為止：

```bash
# Docker Compose
docker compose up -d --force-recreate <service>

# Plain docker
docker rm -f <container>
docker run ... <image>
```

## 設定需求

若要使用 Docker 監控，您需要：

1. 在每一台您想監控的 Docker 主機上安裝 OneUptime Docker Agent
2. 將 `ONEUPTIME_URL`、`ONEUPTIME_SERVICE_TOKEN` 與 `DOCKER_HOST_NAME` 作為環境變數傳入
3. 確保您想觀測的容器使用 `json-file` 日誌驅動程式（見上文）

該 agent 在 Docker Hub 上以 `oneuptime/docker-agent:release` 形式發佈。完整的 `docker run` 與 `docker compose` 範例請參閱 [Docker Agent 安裝指南](https://github.com/OneUptime/oneuptime/tree/master/DockerAgent)。

## 疑難排解

### 指標有顯示，但 Logs 分頁是空的

您的容器幾乎可以確定並未使用 `json-file` 日誌驅動程式。請執行上文 [日誌驅動程式需求](#log-driver-requirement) 一節中的診斷指令，並切換任何需要傳送其日誌的容器。

### filelog 接收器記錄 `no files match the configured criteria`

這表示當 agent 啟動時，include glob `/var/lib/docker/containers/*/*-json.log` 並未比對到任何檔案。可能原因有：

1. 此主機上沒有任何容器使用 `json-file`，或
2. 繫結掛載 `-v /var/lib/docker/containers:/var/lib/docker/containers:ro` 遺漏，或指向了一個空目錄，或
3. 該 agent 在 macOS 的 Docker Desktop 上執行，但未暴露 Linux VM 的容器目錄。

### 日誌有抵達，但被歸類在錯誤的主機名稱底下

OneUptime 會依 `resource.host.name` 自動註冊 Docker 主機，該值取自 `DOCKER_HOST_NAME` 環境變數。在第一批遙測資料之後變更 `DOCKER_HOST_NAME`，會建立第二筆主機記錄，而非將既有主機重新命名。

### 「High CPU」未觸發事件

請確認指標查詢的彙總方式為 **Max**（而非 Avg），並且依 `resource.container.name` 分組。在繁忙主機上對所有容器取 Avg 會被閒置容器稀釋，導致很少跨越閾值。
