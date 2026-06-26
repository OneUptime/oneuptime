# 真实用户监控（浏览器与移动端）

## 概述

当传入的遥测数据携带客户端属性时（Web 端的 `browser.*` 或移动端的 `device.*`），OneUptime 会将其归类为 **RUM**。每个应用都由其 `service.name` 标识，并完全归属于其 RUM 应用（客户端遥测数据绝不会被重复创建为后端 Service）。

借助它，你可以了解用户的实际体验：页面浏览量、错误、延迟、所使用的平台 / 设备，以及——当你的 SDK 上报时——核心 Web 指标（Core Web Vitals）。

## 前置条件

- 一个 **OneUptime Telemetry Ingestion Token**——从 _Project Settings → Telemetry Ingestion Keys_ 创建。
- OpenTelemetry 浏览器或移动端 SDK。

## OneUptime 如何识别 RUM 应用

| 属性                     | 是否必需   | 用途                                |
| ------------------------ | ---------- | ----------------------------------- |
| `service.name`           | **是**     | 应用标识（例如 `storefront-web`）   |
| `browser.*`              | Web 端需要 | 将遥测数据标记为浏览器 RUM          |
| `device.*`               | 移动端需要 | 将遥测数据标记为移动端 RUM          |
| `telemetry.sdk.language` | 否         | 例如 `webjs`、`swift`，显示在概览中 |

## 浏览器（OpenTelemetry Web）

将 OTLP/HTTP 导出器指向 OneUptime，并将 `service.name` 设置为你的应用名称：

```js
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

// OneUptime OTLP/HTTP exporter:
const exporter = new OTLPTraceExporter({
  url: "https://oneuptime.com/otlp/v1/traces",
  headers: { "x-oneuptime-token": "YOUR_TELEMETRY_INGESTION_TOKEN" },
});

// Register `exporter` with your WebTracerProvider, using a resource of:
//   { "service.name": "storefront-web" }
```

浏览器插桩会自动添加 `browser.*` 资源属性——正是这一点将数据路由到 RUM。

## 移动端（Swift / Android）

使用 OpenTelemetry Swift 或 Android SDK，设置 `service.name`，并将 OTLP 导出到 OneUptime：

```bash
OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
```

SDK 的 `device.*` 属性会将遥测数据路由到 RUM。如果你自托管 OneUptime，请使用 `https://YOUR-ONEUPTIME-HOST/otlp`。

## 核心 Web 指标（Core Web Vitals）

如果你的浏览器插桩将 Web 指标（LCP、INP、CLS、FCP、TTFB）作为 OpenTelemetry 指标上报，OneUptime 会在应用概览中以 良好 / 需要改进 / 较差 的评级展示它们。如果没有上报任何 Web 指标，该面板会说明如何开始发送这些指标。

## 你能获得什么

- **页面浏览量**、**错误率** 和 **p95 时长**，并带有可选时间范围的趋势图表。
- **客户端**——所观察到的浏览器平台 / 设备型号。
- **核心 Web 指标**（当有上报时）。
- 完整的 **Logs**、**Traces** 和 **Metrics** 标签页，范围限定于该应用。
