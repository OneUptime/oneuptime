# 雲端環境

## 概觀

OneUptime 將受管理的雲端運算歸類為**雲端環境**——AWS ECS / Fargate、Google Cloud Run、Azure Container Apps / Container Instances、AWS Elastic Beanstalk、AWS App Runner 以及 Azure App Service。每一個 `cloud.platform` + `cloud.account.id` + `cloud.region` 的獨特組合會建立一個環境，因此像是 _「AWS ECS · us-east-1 · 123456789012」_ 這樣的組合就是單一實體，它會彙整在其上執行的所有工作負載。

原始的虛擬機器（EC2、Compute Engine、Azure VM）仍歸類為**主機（Hosts）**，而 Kubernetes 則歸類於 **Kubernetes** 之下。此檢視專門用於受管理的 / PaaS 運算。

## 先決條件

- 一組 **OneUptime 遙測擷取權杖（Telemetry Ingestion Token）**——可從 _Project Settings → Telemetry Ingestion Keys_ 建立。
- 在你的工作負載中或與其並行執行的 OpenTelemetry Collector 或 SDK。

## OneUptime 如何識別環境

| 屬性                  | 是否必要 | 用途                                                                              |
| --------------------- | -------- | --------------------------------------------------------------------------------- |
| `cloud.platform`      | **是**   | 必須是受管理的運算平台（例如 `aws_ecs`、`gcp_cloud_run`、`azure_container_apps`） |
| `cloud.account.id`    | 否       | 環境鍵的一部分                                                                    |
| `cloud.region`        | 否       | 環境鍵的一部分                                                                    |
| `service.instance.id` | 否       | 在**執行個體（Instances）**下依每個任務 / 執行個體追蹤（包含即時 CPU / 記憶體）   |

這些通常由 OpenTelemetry **資源偵測器（resource detectors）**自動填入。

## 步驟 1 — 啟用雲端資源偵測器

在 OpenTelemetry Collector 中，加入 `resourcedetection` 處理器：

```yaml
processors:
  resourcedetection:
    detectors: [env, ecs] # use [gcp] on Cloud Run, [azure] on Azure
    timeout: 5s
```

使用 SDK 時，請改為設定 `OTEL_RESOURCE_DETECTORS`：

```bash
OTEL_RESOURCE_DETECTORS=env,ecs
```

## 步驟 2 — 將 OTLP 匯出至 OneUptime

```yaml
exporters:
  otlphttp/oneuptime:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [resourcedetection]
      exporters: [otlphttp/oneuptime]
    metrics:
      receivers: [otlp]
      processors: [resourcedetection]
      exporters: [otlphttp/oneuptime]
    logs:
      receivers: [otlp]
      processors: [resourcedetection]
      exporters: [otlphttp/oneuptime]
```

如果你自行託管 OneUptime，請使用 `https://YOUR-ONEUPTIME-HOST/otlp`。

## 你會得到什麼

環境概觀會顯示：

- 每個執行中任務 / 執行個體的 **CPU** 與**記憶體**（來自 `container.cpu.utilization` / `container.memory.usage`），以及一份 **Top instances by CPU**（依 CPU 排序的執行個體）清單。
- **執行個體（Instances）**——任務的即時計數。
- 由你的追蹤資料衍生的**請求（Requests）**與趨勢圖表。
- 完整的**記錄（Logs）**、**追蹤（Traces）**、**指標（Metrics）**與**執行個體（Instances）**分頁。

相同工作負載依服務的細項分析可在**服務（Services）**下取得。
