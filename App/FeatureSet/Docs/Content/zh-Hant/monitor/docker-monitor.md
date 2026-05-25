# Docker 監控器

Docker 監控允許您監控 Docker 主機及其上運行的容器的健康狀況和性能。OneUptime 通過預配置的 OpenTelemetry Collector（**OneUptime Docker Agent**）收集指標和容器日誌，並根據您配置的標準進行評估。

## 概述

Docker 監控器使用來自主機的指標和日誌，爲您的容器工作負載提供可見性。這使您能夠：

- 監控 Docker 主機和每個容器的健康狀況
- 跨容器跟蹤 CPU、內存、網絡、塊 I/O 和進程數
- 檢測容器重啓、崩潰和 CPU 限速
- 以原生 OpenTelemetry 格式流式傳輸結構化容器日誌
- 就高 CPU、高內存、重啓循環等發出警報

## 創建 Docker 監控器

1. 在 OneUptime 控制台中轉到 **監控器**
2. 點擊 **創建監控器**
3. 選擇 **Docker** 作爲監控器類型
4. 選擇要監控的 Docker 主機和資源範圍
5. 配置指標查詢和聚合
6. 根據需要配置監控標準

## 配置選項

### Docker 主機

選擇要監控的 Docker 主機。主機在 OneUptime Docker Agent 首次從其發送遙測數據時自動註冊——您無需手動創建它們。

### 資源範圍

選擇監控資源的級別：

| 範圍 | 描述 |
|------|------|
| 主機 | 監控整個 Docker 主機，跨所有容器聚合 |
| 容器 | 按名稱或鏡像監控特定容器 |

### 指標查詢

配置一個或多個指標查詢進行評估。每個查詢指定：

- **指標名稱** — 要查詢的容器指標
- **聚合** — 如何聚合指標值（平均值、求和、最大值、最小值）
- **過濾器** — 基於屬性的額外過濾（例如按容器名稱、鏡像或主機過濾）
- **分組** — 可選地按 `resource.container.name` 分組，以便每個容器單獨評估

您還可以創建使用數學表達式組合多個指標查詢的**公式**。

### 滾動時間窗口

選擇指標評估的時間窗口：

- 過去 1 分鐘
- 過去 5 分鐘
- 過去 10 分鐘
- 過去 15 分鐘
- 過去 30 分鐘
- 過去 60 分鐘

## 收集的指標

Docker Agent 使用 OpenTelemetry `docker_stats` 接收器，該接收器以可配置的間隔（默認每 30 秒）抓取 Docker Engine API。

### CPU

| 指標 | 描述 |
|------|------|
| `container.cpu.utilization` | CPU 利用率，佔主機 CPU 的百分比 |
| `container.cpu.usage.total` | 容器消耗的累計 CPU 時間 |
| `container.cpu.throttling_data.throttled_time` | 容器被 cgroups 限速的時間 |
| `container.cpu.throttling_data.throttled_periods` | 限速週期數 |

### 內存

| 指標 | 描述 |
|------|------|
| `container.memory.usage.total` | 當前內存使用量（字節） |
| `container.memory.usage.limit` | 內存限制（字節） |
| `container.memory.percent` | 內存使用量佔限制的百分比 |

### 網絡

| 指標 | 描述 |
|------|------|
| `container.network.io.usage.rx_bytes` | 接收的總字節數 |
| `container.network.io.usage.tx_bytes` | 發送的總字節數 |

### 塊 I/O

| 指標 | 描述 |
|------|------|
| `container.blockio.io_service_bytes_recursive.read` | 從塊設備讀取的字節數 |
| `container.blockio.io_service_bytes_recursive.write` | 寫入塊設備的字節數 |

### 容器信息

| 指標 | 描述 |
|------|------|
| `container.uptime` | 容器運行時間（秒） |
| `container.restarts` | 容器重啓次數 |
| `container.pids.count` | 容器內的進程數 |

## 監控標準

### 可用檢查類型

| 檢查類型 | 描述 |
|---------|------|
| 指標值 | 配置的指標查詢或公式的值 |

### 聚合類型

| 聚合 | 描述 |
|------|------|
| 平均值 | 時間窗口內的平均值 |
| 求和 | 所有值的總和 |
| 最大值 | 時間窗口內的最高值 |
| 最小值 | 時間窗口內的最低值 |
| 所有值 | 所有值必須滿足標準 |
| 任意值 | 至少一個值必須滿足標準 |

### 過濾類型

- **大於**、**小於**、**大於或等於**、**小於或等於**、**等於**、**不等於**

## 預置警報模板

OneUptime 爲常見的 Docker 監控場景提供模板：

| 模板 | 描述 | 閾值 | 聚合 |
|------|------|------|------|
| 高容器 CPU | 每個容器的 CPU 利用率 | > 90% | 最大值（每個容器） |
| 高容器內存 | 內存使用量佔限制的百分比 | > 85% | 最大值（每個容器） |
| 高 CPU 限速 | CPU 限速週期數 | > 0 | 最大值（每個容器） |
| 容器重啓循環 | 容器重啓次數 | > 3 | 求和 |
| 容器宕機 | 容器運行時間重置爲 0 | = 0 | 最小值 |

> 注意：CPU、內存和限速模板使用按 `resource.container.name` 分組的 **最大值** 聚合。這可以防止單個繁忙容器的信號被同一主機上的許多空閒容器稀釋。

## 收集的日誌

除了指標外，Docker Agent 還通過 OpenTelemetry filelog 接收器跟蹤每個容器的 `*-json.log` 文件，並以原生 OTLP 日誌格式發送日誌記錄。每條日誌記錄都包含以下信息：

- `resource.host.name` — Docker 主機標識符
- `resource.container.id` — 完整的容器 ID
- `resource.container.runtime` — 始終爲 `docker`
- `attributes["log.iostream"]` — `stdout` 或 `stderr`
- `severityText` / `severityNumber` — 從流中派生：`stderr` → `ERROR`，`stdout` → `INFO`
- `body` — 容器進程輸出的原始日誌行
- `time` — Docker 守護進程對該行的時間戳

日誌顯示在 Docker 主機的 **日誌** 選項卡和每個容器的詳情頁面上。

### 日誌驅動程序要求

**Docker Agent 只攝取使用 Docker `json-file` 日誌驅動程序的容器的日誌。** 這是 Docker 的默認設置，但可以按容器或全局覆蓋：

- **`local`** 驅動程序 — 將二進制 protobuf 塊寫入 `/var/lib/docker/containers/<id>/local-logs/container.log`。filelog 接收器無法解析此格式。
- **`journald`**、**`syslog`**、**`fluentd`**、**`gelf`**、**`awslogs`**、**`splunk`** 等 — 將日誌發送到遠程目標；沒有文件可供跟蹤。
- **`none`** — 完全丟棄日誌。

如果使用了上述任何驅動程序，您將在 Docker 主機頁面上看到指標，但 **日誌** 選項卡將爲空（或僅包含 Docker Agent 自身的日誌）。

**檢查特定容器的日誌驅動程序：**

```bash
docker inspect <container> --format '{{.HostConfig.LogConfig.Type}}'
```

**檢查守護進程默認值：**

```bash
docker info --format '{{.LoggingDriver}}'
```

**將 Docker Compose 服務切換爲帶有合理輪換的 `json-file`：**

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

**切換守護進程默認值**（適用於之後創建的每個容器），編輯 `/etc/docker/daemon.json`：

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "5"
  }
}
```

然後重啓 Docker 守護進程並**重建**受影響的容器。Docker 在容器創建時綁定日誌驅動程序，因此現有容器會保留舊驅動程序，直到被刪除並重新創建：

```bash
# Docker Compose
docker compose up -d --force-recreate <service>

# 普通 docker
docker rm -f <container>
docker run ... <image>
```

## 設置要求

要使用 Docker 監控，您需要：

1. 在每個要監控的 Docker 主機上安裝 OneUptime Docker Agent
2. 將 `ONEUPTIME_URL`、`ONEUPTIME_SERVICE_TOKEN` 和 `DOCKER_HOST_NAME` 作爲環境變量傳入
3. 確保要觀察的容器使用 `json-file` 日誌驅動程序（見上文）

該 Agent 以 `oneuptime/docker-agent:release` 的形式發佈在 Docker Hub 上。完整的 `docker run` 和 `docker compose` 示例請參見 [Docker Agent 安裝指南](https://github.com/OneUptime/oneuptime/tree/master/DockerAgent)。

## 故障排查

### 指標顯示但日誌選項卡爲空

您的容器幾乎肯定沒有使用 `json-file` 日誌驅動程序。運行上方[日誌驅動程序要求](#日誌驅動程序要求)部分中的診斷命令，並切換任何需要發送日誌的容器。

### Filelog 接收器日誌顯示"no files match the configured criteria"

這意味着 include glob `/var/lib/docker/containers/*/*-json.log` 在 Agent 啓動時未匹配任何文件。原因可能是：

1. 此主機上沒有容器使用 `json-file`，或
2. 綁定掛載 `-v /var/lib/docker/containers:/var/lib/docker/containers:ro` 缺失或指向空目錄，或
3. Agent 運行在 Docker Desktop for macOS 上，未暴露 Linux VM 的容器目錄。

### 日誌到達但被歸類到錯誤的主機名下

OneUptime 通過 `resource.host.name` 自動註冊 Docker 主機，該值來自 `DOCKER_HOST_NAME` 環境變量。在首次遙測批次發送後更改 `DOCKER_HOST_NAME` 會創建第二個主機行，而不是重命名現有行。

### "高 CPU"未觸發事件

確保指標查詢的聚合爲 **最大值**（而非平均值），並且按 `resource.container.name` 分組。跨繁忙主機上所有容器的平均值會被空閒容器稀釋，很少超過閾值。
