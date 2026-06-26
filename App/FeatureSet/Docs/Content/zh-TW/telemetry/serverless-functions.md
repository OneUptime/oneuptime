# 無伺服器函式（Serverless Functions）

## 概觀

當 OneUptime 收到以 `faas.name` 資源屬性標記的 OpenTelemetry 資料時，會自動辨識出一個**無伺服器函式（Serverless Function）**。您無需手動建立任何東西——只要使用對應執行階段的 OpenTelemetry SDK 為您的函式進行檢測，將其 OTLP 匯出器指向 OneUptime，該函式就會連同其追蹤（traces）、日誌（logs）與指標（metrics）一起出現在**無伺服器函式（Serverless Functions）**之下。

這適用於 AWS Lambda、Google Cloud Functions、Azure Functions、Cloudflare Workers，或任何能夠發送 OpenTelemetry 的 FaaS 執行階段。

## 先決條件

- 一個 **OneUptime 遙測擷取權杖（Telemetry Ingestion Token）**——從 _Project Settings → Telemetry Ingestion Keys_ 建立一個，並複製 `x-oneuptime-token` 的值。
- 對應您函式語言的 OpenTelemetry SDK（或自動檢測層）。

## OneUptime 如何識別函式

OneUptime 以 `faas.name` 資源屬性作為每個函式的鍵：

| 屬性                                                   | 是否必填 | 用途                                                        |
| ------------------------------------------------------ | -------- | ----------------------------------------------------------- |
| `faas.name`                                            | **是**   | 函式身分識別（例如 `checkout-handler`）                     |
| `faas.version`                                         | 否       | 顯示於概觀頁                                                |
| `faas.instance`                                        | 否       | 在 **Instances** 分頁中逐執行個體追蹤                       |
| `cloud.platform`                                       | 否       | `aws_lambda`、`gcp_cloud_functions`、`azure_functions`、... |
| `cloud.provider` / `cloud.region` / `cloud.account.id` | 否       | 顯示於概觀頁                                                |

> 同時設定了 `service.name` 的函式仍會一併出現在 **Services** 之下。**無伺服器函式（Serverless Functions）**檢視則是以 `faas.name` 為範圍、聚焦於 FaaS 的視角。

## 步驟 1 — 設定 OTLP 匯出器環境變數

大多數語言的自動檢測都會遵循標準的 OpenTelemetry 環境變數：

```bash
OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
OTEL_RESOURCE_ATTRIBUTES="faas.name=checkout-handler,faas.version=1.4.2"
```

如果您自行託管 OneUptime，請將端點替換為 `https://YOUR-ONEUPTIME-HOST/otlp`。

## 步驟 2 —（AWS Lambda）加入 OpenTelemetry 層

對於 AWS Lambda，最簡單的途徑是 [OpenTelemetry Lambda 層](https://opentelemetry.io/docs/faas/lambda-auto/)。為您的執行階段附加該層，並設定：

```bash
AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler
OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
```

該層會自動依函式名稱設定 `faas.name`，而資源偵測器則會填入 `cloud.platform`、`cloud.region` 與 `cloud.account.id`。

## 您會獲得什麼

一旦函式發送出 span、日誌或指標，它就會出現在**無伺服器函式（Serverless Functions）**之下。概觀頁會顯示：

- **呼叫次數（Invocations）**、**錯誤率（error rate）**與 **p95 持續時間（p95 duration）**——從您的追蹤資料衍生而來，可選取時間範圍，並附有趨勢圖表。
- **執行個體（Instances）**——所見 `faas.instance` 值的即時計數。
- 以此函式為範圍的完整 **Logs**、**Traces** 與 **Metrics** 分頁。

您也可以透過 _Serverless → Settings → Label Rules / Owner Rules_ 自動套用標籤與擁有者。
