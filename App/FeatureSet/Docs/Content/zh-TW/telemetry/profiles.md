# 將持續效能剖析資料傳送到 OneUptime

## 概觀

持續效能剖析（Continuous profiling）是可觀測性的第四大支柱，與日誌、指標和追蹤並列。剖析資料會擷取您的應用程式如何在函式層級消耗 CPU 時間、配置記憶體以及使用系統資源。OneUptime 透過 OpenTelemetry Protocol（OTLP）擷取剖析資料，並將其與您的其他遙測訊號一同儲存，以進行統一分析。

有了 OneUptime 中的剖析資料，您可以辨識消耗 CPU 的熱點函式、偵測記憶體洩漏、找出競爭瓶頸，並將效能問題與特定的追蹤和 span 建立關聯。

## 支援的剖析類型

OneUptime 支援以下剖析類型：

| 剖析類型      | 說明                          | 單位        |
| ------------- | ----------------------------- | ----------- |
| cpu           | 執行程式碼所花費的 CPU 時間   | nanoseconds |
| wall          | 牆鐘時間（包含等待／休眠）    | nanoseconds |
| alloc_objects | 堆積配置的數量                | count       |
| alloc_space   | 配置的堆積記憶體位元組數      | bytes       |
| goroutine     | 作用中的 goroutine 數量（Go） | count       |
| contention    | 等待鎖／互斥鎖所花費的時間    | nanoseconds |

## 開始使用

### 步驟 1 - 建立遙測擷取權杖

當您註冊 OneUptime 並建立專案後，請點擊導覽列中的「More」，然後點擊「Project Settings」。

在 Telemetry Ingestion Key 頁面上，點擊「Create Ingestion Key」以建立權杖。

![Create Service](/docs/static/images/TelemetryIngestionKeys.png)

建立權杖後，點擊「View」以檢視該權杖。

![View Service](/docs/static/images/TelemetryIngestionKeyView.png)

### 步驟 2 - 設定您的剖析器

OneUptime 使用 OTLP profiles 通訊協定，同時透過 gRPC 與 HTTP 接受剖析資料。

| 通訊協定 | 端點                                                |
| -------- | --------------------------------------------------- |
| gRPC     | `your-oneuptime-host:4317`（OTLP 標準 gRPC 連接埠） |
| HTTP     | `https://your-oneuptime-host/otlp/v1/profiles`      |

**環境變數**

設定以下環境變數，讓您的剖析器指向 OneUptime：

```bash
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_ONEUPTIME_SERVICE_TOKEN
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_SERVICE_NAME=my-service
```

**自架 OneUptime**

如果您是自架 OneUptime，請將端點替換為您自己的主機（例如 `http(s)://YOUR-ONEUPTIME-HOST/otlp`）。對於 gRPC，請直接連接到 OneUptime 主機上的連接埠 4317。

## 檢測指南

### 使用 Grafana Alloy（以 eBPF 為基礎的剖析）

Grafana Alloy（前身為 Grafana Agent）可以使用 eBPF 從 Linux 主機上的所有處理程序收集 CPU 剖析資料，且無需變更任何程式碼。請將其設定為透過 OTLP 匯出至 OneUptime。

Alloy 設定範例：

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

對於 Java 應用程式，請搭配 OpenTelemetry Java agent 使用 [async-profiler](https://github.com/async-profiler/async-profiler)，以透過 OTLP 傳送剖析資料。

```bash
# Start your Java application with the OpenTelemetry Java agent
java -javaagent:opentelemetry-javaagent.jar \
  -Dotel.exporter.otlp.endpoint=https://oneuptime.com/otlp \
  -Dotel.exporter.otlp.headers=x-oneuptime-token=YOUR_ONEUPTIME_SERVICE_TOKEN \
  -Dotel.service.name=my-java-service \
  -jar my-app.jar
```

### 使用 Go pprof 並透過 OTLP 匯出

對於 Go 應用程式，您可以搭配 OTLP 匯出器使用標準的 `net/http/pprof` 套件。透過定期收集 pprof 資料並將其轉送至 OneUptime，來設定持續效能剖析。

```go
import (
    "runtime/pprof"
    "bytes"
    "time"
)

// Collect a 30-second CPU profile and export periodically
func collectProfile() {
    var buf bytes.Buffer
    pprof.StartCPUProfile(&buf)
    time.Sleep(30 * time.Second)
    pprof.StopCPUProfile()
    // Convert pprof output to OTLP format and send to OneUptime
}
```

或者，使用 OpenTelemetry Collector 搭配剖析接收器，抓取您的 Go 應用程式的 `/debug/pprof` 端點，並透過 OTLP 匯出。

### 使用 py-spy（Python）

對於 Python 應用程式，[py-spy](https://github.com/benfred/py-spy) 可以在不變更程式碼的情況下擷取 CPU 剖析資料。請使用 OpenTelemetry Collector 來接收並轉送剖析資料。

```bash
# Capture profiles and send to a local OTLP collector
py-spy record --format speedscope --pid $PID -o profile.json
```

對於持續效能剖析，請將 py-spy 與您的應用程式一同執行，並設定 OpenTelemetry Collector 來擷取剖析資料並將其轉送至 OneUptime。

## 使用 OpenTelemetry Collector

您可以使用 OpenTelemetry Collector 作為代理，從您的應用程式接收剖析資料並將其轉送至 OneUptime。

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

## 功能

### 火焰圖視覺化

OneUptime 會將剖析資料呈現為互動式火焰圖（flamegraph）。每個長條代表呼叫堆疊中的一個函式，其寬度與所消耗的時間或資源成正比。您可以點擊任何函式以放大檢視其呼叫者（callers）和被呼叫者（callees）。

### 函式清單

檢視一份可排序的表格，列出剖析資料中擷取到的所有函式，並依自身時間（self time）、總時間（total time）或配置次數排名。這能協助您快速辨識應用程式中最耗費資源的函式。

### 追蹤關聯

OneUptime 中的剖析資料可以與分散式追蹤建立關聯。當剖析資料包含追蹤與 span ID 時（透過 OTLP 連結表），您可以直接從緩慢的追蹤 span 導覽至對應的 CPU 或記憶體剖析資料，以準確了解當時正在執行哪些程式碼。

### 依剖析類型篩選

依類型（cpu、wall、alloc_objects、alloc_space、goroutine、contention）篩選剖析資料，以專注於您正在調查的特定資源面向。

## 資料保留

剖析資料的保留期限是在您的 OneUptime 專案設定中針對每個遙測服務進行設定。預設保留期限為 15 天。資料會在保留期限到期後自動刪除。

若要變更某個服務的保留期限，請前往 **Telemetry > Services > [您的服務] > Settings**，並更新資料保留值。

## 需要協助嗎？

如果您在設定 OneUptime 的剖析功能時需要任何協助，請聯絡 support@oneuptime.com。
