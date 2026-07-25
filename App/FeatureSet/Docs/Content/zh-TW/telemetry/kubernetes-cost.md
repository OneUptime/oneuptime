# Kubernetes 成本可觀測性

## 概觀

OneUptime 能讓您看到每個 Kubernetes 工作負載實際花費多少——依命名空間、依控制器、依 Pod 的支出，外加閒置容量與 request 對比實際用量的效率——就在您已經透過 [Kubernetes Agent](/docs/telemetry/kubernetes-agent) 收集的指標、日誌與追蹤旁邊。

啟用它只需要一道指令：

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set cost.enabled=true
```

這樣就是一次完整的安裝。此 chart 隨附了開源的 [OpenCost](https://opencost.io) 引擎（Apache-2.0、CNCF——也就是同樣驅動 Kubecost 的那個 [cost-model](https://github.com/kubecost/cost-model)），外加它查詢用量歷史所需的一個最小化專用 Prometheus——兩個小 Pod，作為看不見的底層管線。OpenCost 會依據您雲端供應商的**公開牌價自動**為您的節點、volume 與負載平衡器定價，**不需要任何憑證**（AWS、GCP、Azure）；地端叢集則改為設定一份費率表（見下文）。

大約一小時內（第一個已結束的小時視窗），您會得到：

- **每個叢集的 Costs 頁面**（_Kubernetes → 您的叢集 → Costs_）：支出趨勢、依命名空間並按 cpu/記憶體/儲存拆分的支出、依工作負載的支出、閒置支出與效率。
- **專案層級的 Costs 頁面**（_Kubernetes → Costs_）：專案中每個叢集的支出。
- **一個 Kubernetes 成本儀表板範本**（_Dashboards → Create → Kubernetes Cost Dashboard_）：節點每小時成本趨勢、CPU/RAM 單位成本、persistent volume 與負載平衡器支出。
- **Metric Explorer** 中的原始成本指標（`node_total_hourly_cost`、`pv_hourly_cost`……），可用於自訂儀表板與指標警示。

## 運作方式

在 `cost.enabled=true` 時，此 chart 會執行四樣東西：

1. **OpenCost**（隨附）——監看叢集、探索雲端牌價，並為每個工作負載計算預先定價的成本配置。
2. **一個最小化的 Prometheus**（隨附）——OpenCost 需要一個 PromQL 端點來取得用量／價格歷史。這個 Prometheus 只為此而存在：單一副本、3 天保留期，以及恰好兩個抓取目標（透過 API-server 節點 proxy 抓取的 cAdvisor，以及 OpenCost 本身——OpenCost 會發出自己的 KSM 風格資源請求指標，因此不需要 kube-state-metrics 參與）。它絕不會暴露在叢集之外，其資料也永遠不會離開叢集。
3. **成本配置輪詢器**（`cost.agent`）——在每個已結束的小時視窗輪詢一次 OpenCost 的 Allocation API，並將每個工作負載的成本資料列（cpu / ram / gpu / pv / 網路 / 負載平衡器 / 閒置，外加效率）POST 到 OneUptime。每個視窗只會傳送一次——伺服器會略過已經擷取過的視窗，因此重新啟動不會造成支出被重複計算。
4. **一個成本指標抓取**（`cost.metrics`）——agent 的 OpenTelemetry collector 會透過與您其餘叢集指標相同的 OTLP 管線，抓取 OpenCost 的 Prometheus 指標（已以允許清單限定為成本序列）。

## 已經在執行 Kubecost 或 OpenCost？

讓此 chart 指向您既有的引擎即可——此時不會隨附任何東西：

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set cost.enabled=true \
  --set cost.engine.url=http://kubecost-cost-analyzer.kubecost.svc.cluster.local:9090
```

| 引擎     | 常見的服務 URL                                                   |
| -------- | ---------------------------------------------------------------- |
| OpenCost | `http://opencost.opencost.svc.cluster.local:9003`                |
| Kubecost | `http://kubecost-cost-analyzer.kubecost.svc.cluster.local:9090`  |

Allocation API 路徑會自動偵測（Kubecost 為 `/model/allocation`，OpenCost 為 `/allocation/compute` 或 `/allocation`）。只有在非標準安裝時才需要設定 `cost.engine.allocationPath`。

## 地端 / 裸機定價

節點沒有公開雲端牌價的叢集可以設定一份費率表——OpenCost 之後便會依這些數字為每項資源定價。所有數值均為**每資源小時的美元（USD）**：

```yaml
cost:
  enabled: true
  opencost:
    customPricing:
      enabled: true
      cpuPerCoreHour: "0.031611"       # ~$23 per core-month
      ramPerGiBHour: "0.004237"        # ~$3 per GiB-month
      storagePerGBHour: "0.00005479452" # ~$0.04 per GB-month
      gpuPerHour: "0.95"
```

## 實用的調整項

全部皆為選用——完整清單請參閱此 chart 的 `values.yaml`：

```yaml
cost:
  agent:
    windowSeconds: 3600   # allocation window length (hourly = native)
    includeIdle: true     # ship the engine's __idle__ allocation
    currency: USD         # currency code shown in the UI (informational)
  prometheus:
    retention: 3d         # bundled TSDB history — a few days is plenty
    persistence:
      enabled: false      # set true for a small PVC; emptyDir otherwise
  metrics:
    enabled: true         # cost metrics for dashboards / Metric Explorer
    scrapeInterval: 60s
```

## 依成本發出警示

抓取到的成本指標就是一般的 OneUptime 指標，因此您可以像對其他任何指標一樣對它們設定指標警示——例如，當平均 `node_total_hourly_cost` 升破某個預算門檻時發出警示，或當某個不該存在於叢集中的 volume class 出現 `pv_hourly_cost` 時發出警示。

## 資料模型與保留

配置資料列儲存在 ClickHouse 中（每個叢集、視窗、命名空間、控制器、Pod 與容器各一列），並遵循該叢集的遙測保留設定：優先採用 Kubernetes 叢集資源上的 `retainTelemetryDataForDays` 設定，未設定時則回退到專案的資料保留。閒置與未配置的容量會以一般資料列儲存在 `__idle__` / `__unallocated__` 命名空間之下，因此可以用與工作負載支出相同的 group-by 進行查詢。

## 疑難排解

- **Costs 頁面是空的**——檢查成本 agent 的日誌：`kubectl logs -n <agent namespace> deploy/<release>-kubernetes-agent-cost`。`401` 表示 ingestion key 無效；`cost engine did not answer any known allocation path` 表示引擎尚未就緒（隨附的 OpenCost 在安裝後需要幾分鐘才能為最初的視窗定價），或 `cost.engine.url` 設定有誤。
- **隨附的 OpenCost 尚未就緒**——`kubectl logs -n <agent namespace> deploy/<release>-kubernetes-agent-opencost`。它會在日誌中記錄偵測到哪個雲端供應商，以及定價資料是否載入成功。
- **儀表板範本沒有資料**——該範本讀取的是抓取到的成本指標；請確認 `cost.metrics.enabled` 為 `true`。
- **數字與引擎自己的 UI 不同**——OneUptime 會將引擎的對帳（reconciliation）調整計入每個成本組成，且只傳送完整結束的視窗；目前這個小時的部分支出會在該視窗結束後出現。
- **Prometheus Pod 重新啟動**——在預設的 `emptyDir` 儲存下，重新啟動會遺失幾個小時的用量歷史，因此那些視窗的配置可能會偏小。如果這對您很重要，請設定 `cost.prometheus.persistence.enabled=true`。
