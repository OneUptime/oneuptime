# 向 OneUptime 发送持续性能分析数据

## 概述

持续性能分析是可观测性的第四大支柱，与日志、指标和追踪并列。性能分析数据在函数级别捕获您的应用程序如何消耗 CPU 时间、分配内存以及使用系统资源。OneUptime 通过 OpenTelemetry 协议（OTLP）摄取性能分析数据，并将其与您的其他遥测信号一起存储，以便进行统一分析。

借助 OneUptime 中的性能分析数据，您可以识别消耗大量 CPU 的热点函数、检测内存泄漏、发现竞争瓶颈，以及将性能问题与特定追踪和 Span 关联起来。

## 支持的性能分析类型

OneUptime 支持以下性能分析类型：

| 分析类型 | 描述 | 单位 |
|---------|------|------|
| cpu | 执行代码所花费的 CPU 时间 | 纳秒 |
| wall | 挂钟时间（包括等待/休眠） | 纳秒 |
| alloc_objects | 堆分配次数 | 次数 |
| alloc_space | 分配的堆内存字节数 | 字节 |
| goroutine | 活跃的 goroutine 数量（Go） | 次数 |
| contention | 等待锁/互斥锁所花费的时间 | 纳秒 |

## 入门

### 第一步 - 创建遥测摄取令牌

注册 OneUptime 并创建项目后，点击导航栏中的"更多"，然后点击"项目设置"。

在遥测摄取密钥页面，点击"创建摄取密钥"以创建令牌。

![创建服务](/docs/static/images/TelemetryIngestionKeys.png)

创建令牌后，点击"查看"以查看令牌。

![查看服务](/docs/static/images/TelemetryIngestionKeyView.png)

### 第二步 - 配置您的性能分析器

OneUptime 通过 OTLP 性能分析协议同时接受 gRPC 和 HTTP 的性能分析数据。

| 协议 | 端点 |
|------|------|
| gRPC | `your-oneuptime-host:4317`（OTLP 标准 gRPC 端口） |
| HTTP | `https://your-oneuptime-host/otlp/v1/profiles` |

**环境变量**

设置以下环境变量，将您的性能分析器指向 OneUptime：

```bash
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_ONEUPTIME_SERVICE_TOKEN
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_SERVICE_NAME=my-service
```

**自托管 OneUptime**

如果您是自托管 OneUptime，请将端点替换为您自己的主机（例如 `http(s)://YOUR-ONEUPTIME-HOST/otlp`）。对于 gRPC，直接连接到您的 OneUptime 主机的 4317 端口。

## 埋点指南

### 使用 Grafana Alloy（基于 eBPF 的性能分析）

Grafana Alloy（原 Grafana Agent）可以使用 eBPF 从 Linux 主机上的所有进程收集 CPU 性能分析数据，无需任何代码更改。将其配置为通过 OTLP 导出到 OneUptime。

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

对于 Java 应用程序，使用 [async-profiler](https://github.com/async-profiler/async-profiler) 与 OpenTelemetry Java Agent 通过 OTLP 发送性能分析数据。

```bash
# 使用 OpenTelemetry Java Agent 启动您的 Java 应用程序
java -javaagent:opentelemetry-javaagent.jar \
  -Dotel.exporter.otlp.endpoint=https://oneuptime.com/otlp \
  -Dotel.exporter.otlp.headers=x-oneuptime-token=YOUR_ONEUPTIME_SERVICE_TOKEN \
  -Dotel.service.name=my-java-service \
  -jar my-app.jar
```

### 使用 Go pprof 与 OTLP 导出

对于 Go 应用程序，您可以使用标准的 `net/http/pprof` 包配合 OTLP 导出器。通过定期收集 pprof 数据并将其转发到 OneUptime 来配置持续性能分析。

```go
import (
    "runtime/pprof"
    "bytes"
    "time"
)

// 每 30 秒收集一次 CPU 性能分析数据并定期导出
func collectProfile() {
    var buf bytes.Buffer
    pprof.StartCPUProfile(&buf)
    time.Sleep(30 * time.Second)
    pprof.StopCPUProfile()
    // 将 pprof 输出转换为 OTLP 格式并发送到 OneUptime
}
```

或者，使用 OpenTelemetry Collector 配合性能分析接收器，抓取 Go 应用程序的 `/debug/pprof` 端点并通过 OTLP 导出。

### 使用 py-spy（Python）

对于 Python 应用程序，[py-spy](https://github.com/benfred/py-spy) 可以在不修改代码的情况下捕获 CPU 性能分析数据。使用 OpenTelemetry Collector 接收并转发性能分析数据。

```bash
# 捕获性能分析数据并发送到本地 OTLP 收集器
py-spy record --format speedscope --pid $PID -o profile.json
```

对于持续性能分析，在应用程序旁边运行 py-spy，并配置 OpenTelemetry Collector 摄取并转发性能分析数据到 OneUptime。

## 使用 OpenTelemetry Collector

您可以使用 OpenTelemetry Collector 作为代理，从应用程序接收性能分析数据并将其转发到 OneUptime。

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

### 火焰图可视化

OneUptime 将性能分析数据渲染为交互式火焰图。每个条形代表调用栈中的一个函数，其宽度与消耗的时间或资源成正比。您可以点击任意函数进行放大，查看其调用者和被调用者。

### 函数列表

查看按自身时间、总时间或分配次数排序的所有性能分析捕获函数的可排序表格。这有助于您快速识别应用程序中开销最大的函数。

### 追踪关联

OneUptime 中的性能分析数据可以与分布式追踪关联。当性能分析包含追踪和 Span ID（通过 OTLP 链接表）时，您可以从慢速追踪 Span 直接导航到对应的 CPU 或内存性能分析，以了解具体执行的代码。

### 按性能分析类型过滤

按类型（cpu、wall、alloc_objects、alloc_space、goroutine、contention）过滤性能分析数据，专注于您正在调查的特定资源维度。

## 数据保留

性能分析数据保留期限在您的 OneUptime 项目设置中按遥测服务配置。默认保留期为 15 天。数据在保留期到期后自动删除。

要更改服务的保留期，请导航至 **遥测 > 服务 > [您的服务] > 设置** 并更新数据保留值。

## 需要帮助？

如果您在使用 OneUptime 设置性能分析时需要帮助，请联系 support@oneuptime.com。
