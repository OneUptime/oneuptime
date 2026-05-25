# 向 OneUptime 發送持續性能分析數據

## 概述

持續性能分析是可觀測性的第四大支柱，與日誌、指標和追蹤並列。性能分析數據在函數級別捕獲您的應用程序如何消耗 CPU 時間、分配內存以及使用系統資源。OneUptime 通過 OpenTelemetry 協議（OTLP）攝取性能分析數據，並將其與您的其他遙測信號一起儲存，以便進行統一分析。

藉助 OneUptime 中的性能分析數據，您可以識別消耗大量 CPU 的熱點函數、檢測內存泄漏、發現競爭瓶頸，以及將性能問題與特定追蹤和 Span 關聯起來。

## 支持的性能分析類型

OneUptime 支持以下性能分析類型：

| 分析類型 | 描述 | 單位 |
|---------|------|------|
| cpu | 執行代碼所花費的 CPU 時間 | 納秒 |
| wall | 掛鐘時間（包括等待/休眠） | 納秒 |
| alloc_objects | 堆分配次數 | 次數 |
| alloc_space | 分配的堆內存字節數 | 字節 |
| goroutine | 活躍的 goroutine 數量（Go） | 次數 |
| contention | 等待鎖/互斥鎖所花費的時間 | 納秒 |

## 入門

### 第一步 - 創建遙測攝取令牌

註冊 OneUptime 並創建項目後，點擊導航欄中的"更多"，然後點擊"項目設置"。

在遙測攝取密鑰頁面，點擊"創建攝取密鑰"以創建令牌。

![創建服務](/docs/static/images/TelemetryIngestionKeys.png)

創建令牌後，點擊"查看"以查看令牌。

![查看服務](/docs/static/images/TelemetryIngestionKeyView.png)

### 第二步 - 配置您的性能分析器

OneUptime 通過 OTLP 性能分析協議同時接受 gRPC 和 HTTP 的性能分析數據。

| 協議 | 端點 |
|------|------|
| gRPC | `your-oneuptime-host:4317`（OTLP 標準 gRPC 端口） |
| HTTP | `https://your-oneuptime-host/otlp/v1/profiles` |

**環境變量**

設置以下環境變量，將您的性能分析器指向 OneUptime：

```bash
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_ONEUPTIME_SERVICE_TOKEN
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_SERVICE_NAME=my-service
```

**自託管 OneUptime**

如果您是自託管 OneUptime，請將端點替換爲您自己的主機（例如 `http(s)://YOUR-ONEUPTIME-HOST/otlp`）。對於 gRPC，直接連接到您的 OneUptime 主機的 4317 端口。

## 埋點指南

### 使用 Grafana Alloy（基於 eBPF 的性能分析）

Grafana Alloy（原 Grafana Agent）可以使用 eBPF 從 Linux 主機上的所有進程收集 CPU 性能分析數據，無需任何代碼更改。將其配置爲通過 OTLP 導出到 OneUptime。

Alloy 配置示例：

```hcl
pyroscope.ebpf "default" {
  forward_to = [pyroscope.write.oneuptime.receiver]
  targets    = discovery.process.all.targets
}

pyroscope.write "oneuptime" {
  endpoint {
    url = "https://oneuptime.com/pyroscope"
    headers = {
      "x-oneuptime-token" = "YOUR_ONEUPTIME_SERVICE_TOKEN",
    }
  }
}
```

### 使用 async-profiler（Java）

對於 Java 應用程序，使用 [async-profiler](https://github.com/async-profiler/async-profiler) 與 OpenTelemetry Java Agent 通過 OTLP 發送性能分析數據。

```bash
# 使用 OpenTelemetry Java Agent 啓動您的 Java 應用程序
java -javaagent:opentelemetry-javaagent.jar \
  -Dotel.exporter.otlp.endpoint=https://oneuptime.com/otlp \
  -Dotel.exporter.otlp.headers=x-oneuptime-token=YOUR_ONEUPTIME_SERVICE_TOKEN \
  -Dotel.service.name=my-java-service \
  -jar my-app.jar
```

### 使用 Go pprof 與 OTLP 導出

對於 Go 應用程序，您可以使用標準的 `net/http/pprof` 包配合 OTLP 導出器。通過定期收集 pprof 數據並將其轉發到 OneUptime 來配置持續性能分析。

```go
import (
    "runtime/pprof"
    "bytes"
    "time"
)

// 每 30 秒收集一次 CPU 性能分析數據並定期導出
func collectProfile() {
    var buf bytes.Buffer
    pprof.StartCPUProfile(&buf)
    time.Sleep(30 * time.Second)
    pprof.StopCPUProfile()
    // 將 pprof 輸出轉換爲 OTLP 格式併發送到 OneUptime
}
```

或者，使用 OpenTelemetry Collector 配合性能分析接收器，抓取 Go 應用程序的 `/debug/pprof` 端點並通過 OTLP 導出。

### 使用 py-spy（Python）

對於 Python 應用程序，[py-spy](https://github.com/benfred/py-spy) 可以在不修改代碼的情況下捕獲 CPU 性能分析數據。使用 OpenTelemetry Collector 接收並轉發性能分析數據。

```bash
# 捕獲性能分析數據併發送到本地 OTLP 收集器
py-spy record --format speedscope --pid $PID -o profile.json
```

對於持續性能分析，在應用程序旁邊運行 py-spy，並配置 OpenTelemetry Collector 攝取並轉發性能分析數據到 OneUptime。

## 使用 OpenTelemetry Collector

您可以使用 OpenTelemetry Collector 作爲代理，從應用程序接收性能分析數據並將其轉發到 OneUptime。

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

exporters:
  otlphttp:
    endpoint: "https://oneuptime.com/otlp"
    encoding: json
    headers:
      "Content-Type": "application/json"
      "x-oneuptime-token": "YOUR_ONEUPTIME_SERVICE_TOKEN"

service:
  pipelines:
    profiles:
      receivers: [otlp]
      exporters: [otlphttp]
```

## 功能特性

### 火焰圖可視化

OneUptime 將性能分析數據渲染爲交互式火焰圖。每個條形代表調用棧中的一個函數，其寬度與消耗的時間或資源成正比。您可以點擊任意函數進行放大，查看其調用者和被調用者。

### 函數列表

查看按自身時間、總時間或分配次數排序的所有性能分析捕獲函數的可排序表格。這有助於您快速識別應用程序中開銷最大的函數。

### 追蹤關聯

OneUptime 中的性能分析數據可以與分佈式追蹤關聯。當性能分析包含追蹤和 Span ID（通過 OTLP 鏈接表）時，您可以從慢速追蹤 Span 直接導航到對應的 CPU 或內存性能分析，以瞭解具體執行的代碼。

### 按性能分析類型過濾

按類型（cpu、wall、alloc_objects、alloc_space、goroutine、contention）過濾性能分析數據，專注於您正在調查的特定資源維度。

## 數據保留

性能分析數據保留期限在您的 OneUptime 項目設置中按遙測服務配置。默認保留期爲 15 天。數據在保留期到期後自動刪除。

要更改服務的保留期，請導航至 **遙測 > 服務 > [您的服務] > 設置** 並更新數據保留值。

## 需要幫助？

如果您在使用 OneUptime 設置性能分析時需要幫助，請聯繫 support@oneuptime.com。
