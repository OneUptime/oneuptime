# 真實使用者監控（瀏覽器與行動裝置）

## 概觀

當傳入的遙測資料攜帶用戶端屬性時——網頁使用 `browser.*`，行動裝置使用 `device.*`——OneUptime 會將其歸類為 **RUM**。每個應用程式皆由其 `service.name` 識別，並且完全歸屬於其 RUM 應用程式（用戶端遙測資料絕不會被重複建立為後端 Service）。

使用它來了解使用者實際的體驗：頁面瀏覽次數、錯誤、延遲、使用中的平台／裝置，以及——當您的 SDK 發出這些資料時——Core Web Vitals。

## 先決條件

- 一個 **OneUptime Telemetry Ingestion Token**——從 *Project Settings → Telemetry Ingestion Keys* 建立。
- OpenTelemetry 瀏覽器或行動裝置 SDK。

## OneUptime 如何識別 RUM 應用程式

| 屬性 | 是否必要 | 用途 |
|---|---|---|
| `service.name` | **是** | 應用程式身分（例如 `storefront-web`） |
| `browser.*` | 網頁需要 | 將遙測資料標記為瀏覽器 RUM |
| `device.*` | 行動裝置需要 | 將遙測資料標記為行動裝置 RUM |
| `telemetry.sdk.language` | 否 | 例如 `webjs`、`swift`，顯示於概觀中 |

## 瀏覽器（OpenTelemetry Web）

將 OTLP/HTTP 匯出器指向 OneUptime，並將 `service.name` 設定為您應用程式的名稱：

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

瀏覽器檢測會自動加入 `browser.*` 資源屬性——這正是將資料導向 RUM 的依據。

## 行動裝置（Swift / Android）

使用 OpenTelemetry Swift 或 Android SDK，設定 `service.name`，並將 OTLP 匯出至 OneUptime：

```bash
OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
```

SDK 的 `device.*` 屬性會將遙測資料導向 RUM。如果您自行託管 OneUptime，請使用 `https://YOUR-ONEUPTIME-HOST/otlp`。

## Core Web Vitals

如果您的瀏覽器檢測將 web vitals（LCP、INP、CLS、FCP、TTFB）以 OpenTelemetry 指標的形式發出，OneUptime 會在應用程式概觀中呈現這些指標，並附上 良好／需要改進／不佳 的評等。如果未回報任何 web-vital 指標，面板會說明如何開始傳送這些資料。

## 您能獲得的功能

- **頁面瀏覽次數**、**錯誤率** 與 **p95 持續時間**，並可在可選取的範圍內顯示趨勢圖表。
- **用戶端**——所見的瀏覽器平台／裝置型號。
- **Core Web Vitals**（當有回報時）。
- 完整的 **Logs**、**Traces** 與 **Metrics** 分頁，範圍限定於該應用程式。
