# 規模規劃與容量規劃

本指南協助您在 Kubernetes（Helm）上規劃自架 OneUptime 部署的規模。內容涵蓋 OneUptime 所依賴的三個資料儲存區 — **PostgreSQL**、**Redis** 與 **ClickHouse** — 以及應用程式運算資源，並提供您在掌握實際數據後可加以調整的起始層級。

> **請先閱讀此處：** Helm chart 出貨時**未設定任何 CPU/記憶體 requests 或 limits**，且 PostgreSQL 與 ClickHouse 採用較小的 **25 Gi** 預設磁碟區。這些預設值的存在是為了讓 chart 能在任何叢集上安裝並執行 — 它們**並非**正式環境的規模規劃。對於超出快速試用範圍的任何用途，請使用下方的數字明確設定資源與儲存空間。

如果您改用單機 Docker Compose 安裝，規模規劃會比較簡單 — 請參閱 [Docker Compose](/docs/installation/docker-compose)（建議：16 GB RAM、8 核心、400 GB 磁碟）。

## 各資料儲存區的規模驅動因素

OneUptime 在正式環境中需要三個資料儲存區。它們依完全不同的輸入進行擴展，因此請各自獨立進行規模規劃。

| 資料儲存區     | 儲存的內容                                                                                        | 驅動其規模的因素                                                      |
| -------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **ClickHouse** | 所有遙測資料 — logs、metrics、traces、exceptions、profiles                                        | 遙測**擷取速率 × 保留期**。這約佔您儲存空間的 95%，也是最主要的成本。 |
| **PostgreSQL** | 設定與狀態 — monitors、incidents、alerts、使用者、團隊、專案、workflows、status pages、dashboards | **實體數量與歷史紀錄**，而非遙測資料量。增長緩慢。                    |
| **Redis**      | 快取、工作佇列與工作階段                                                                          | **佇列深度與作用中工作階段**。受記憶體限制且規模不大。並非真實來源。  |

OneUptime 執行**不**需要物件儲存（S3/MinIO）。它僅選擇性地用於資料庫**備份**（透過 PostgreSQL 的 CloudNativePG Barman plugin，或 ClickHouse 的 `clickhouse-backup`）。OneUptime 不會將遙測資料分層儲存至物件儲存 — 請參閱下方「保留期及其對儲存空間的影響」一節。

## ClickHouse — 最主要的驅動因素

您幾乎所有的儲存空間以及大部分的 RAM 都會用在 ClickHouse 上，因為每一行 log、每一個 metric 點、每一個 trace span 以及每一個 exception 都儲存在這裡。

### 儲存空間公式

```
ClickHouse disk ≈ (daily raw telemetry GB ÷ compression) × retention days × replicas × 1.3 (headroom)
```

壓縮率取決於訊號類型：

- **Logs** 壓縮效果良好 — 大約 **5:1**。
- **Metrics** 壓縮效果較差 — 大約 **2:1** — 而高 label **基數（cardinality）** 對磁碟與 RAM 的膨脹速度比原始資料量更快。請讓 labels 保持低基數。
- **Traces** 介於兩者之間，取決於 span attributes。

### 實際範例

一個由 **10 個叢集**組成的機群，每個叢集約有 10 個節點 / 約 100 個 pod 並以 INFO 等級的詳盡程度運作，在 30 天內每個叢集會產生大約 **50–150 GB 的原始 logs**（每個叢集每天約 1.7–5 GB）。整個機群在加入 metrics 與 traces 並經壓縮後，請編列大約 **每天 5–15 GB 的壓縮遙測資料**預算。

| 保留期 | 單一 replica  | 2 個 replicas + 30% headroom |
| ------ | ------------- | ---------------------------- |
| 30 天  | ~150–450 GB   | **~0.4–1.2 TB**              |
| 90 天  | ~0.45–1.35 TB | **~1.2–3.5 TB**              |

儲存空間會**隨保留期線性擴展** — 90 天的時間窗成本約為 30 天時間窗的 3 倍。

### RAM 與磁碟類型

- **請使用 NVMe/SSD。** 遙測資料寫入密集，且伴隨突發性的彙總讀取；在傳統旋轉式磁碟上執行 ClickHouse 會很吃力。
- **為 ClickHouse 提供充足的 RAM。** 彙總查詢非常耗用記憶體。經驗法則是，將 RAM 設定為您*熱*（近期查詢過）的壓縮資料集的有意義比例（25–50%），並為任何真正的正式環境機群設定 16 GB 的實務下限。
- **管控 metric 基數。** 它是對 ClickHouse RAM 與磁碟影響最大的單一槓桿。在收集層強制執行低基數的 label 慣例，並留意作用中的 series 數量。

## PostgreSQL — 設定與狀態

PostgreSQL 儲存您的設定與營運狀態，而非遙測資料，因此相對於 ClickHouse 它增長緩慢且維持小規模。即使是大型部署，通常也只在數十 GB 範圍內。預設的 **25 Gi** 磁碟區對於小型安裝已足夠；對於規模較大者，請規劃 50–100 GB，並為 incident/alert 歷史紀錄保留餘裕空間。

如果您執行許多 application、worker 與 probe replicas，資料庫連線數量可能在儲存空間之前先成為瓶頸。OneUptime 的 Helm chart 包含選用的 **PgBouncer** 連線池（`pgbouncer.enabled`），正是為此而設 — 對於高 replica 數的部署請啟用它。

## Redis — 快取、佇列與工作階段

Redis 用作快取、工作佇列與工作階段儲存。它**受記憶體限制**，且持久化**預設為停用**（此處的 Redis 並非真實來源 — 它可被重建）。請依預期的佇列深度與並行工作階段進行規模規劃；2–8 GB 的記憶體可涵蓋大多數部署。請注意預設的逐出策略為 `noeviction`，因此如果佇列在持續超載下堆積，請監控 Redis 記憶體。

## 應用程式運算資源

除了資料儲存區之外，請為無狀態工作負載（ingress、web/API、workers 與 probes）規劃規模。它們全部預設為 **1 replica** 且無資源 limits — 請明確設定它們。chart 內建 **KEDA**，因此 workers 與 probes 可依佇列深度自動擴展；對於變動負載請啟用它。Workers 隨遙測/擷取處理量擴展，而 probes 隨作用中 monitors 的數量擴展。

## 起始層級

選擇最接近您環境的層級作為起點，然後觀察實際使用情況（`kubectl top pods`、ClickHouse/Postgres 磁碟增長）並加以調整。

- **小型 / PoC** — 1–3 個叢集、≤30 個節點、每天 ≤5 GB 原始遙測資料、30 天保留期。
- **中型 / 正式環境機群** — 約 10 個叢集、約 100 個節點、每天 10–30 GB 原始遙測資料、30–90 天保留期。
- **大型 / 多機群** — 50 個以上叢集、500 個以上節點、每天 100 GB 以上原始遙測資料、90 天保留期。

|                  | 小型 / PoC                   | 中型 / 正式環境機群          | 大型 / 多機群                                            |
| ---------------- | ---------------------------- | ---------------------------- | -------------------------------------------------------- |
| **ClickHouse**   | 4 vCPU / 16 GB / 200 GB NVMe | 8 vCPU / 32 GB / 1–3 TB NVMe | 16+ vCPU / 64–128 GB / 5–15 TB NVMe，**分片（sharded）** |
| **PostgreSQL**   | 2 vCPU / 4 GB / 50 GB SSD    | 4 vCPU / 8 GB / 100 GB SSD   | 8 vCPU / 16–32 GB / 250 GB SSD（+ PgBouncer）            |
| **Redis**        | 1 vCPU / 2 GB                | 2 vCPU / 4 GB                | 4 vCPU / 8–16 GB                                         |
| **假設的保留期** | 30 天                        | 30–90 天                     | 90 天                                                    |

這些是 OneUptime **後端**的規模。在每個受監控叢集上執行的 OneUptime 收集器需各自規劃規模 — 請參閱 [Kubernetes Agent](/docs/telemetry/kubernetes-agent) 的規模層級。

## 高可用性

chart 內建的資料儲存區預設以**單一執行個體**執行。對於正式環境的 HA：

- **PostgreSQL** — 啟用內建的 [CloudNativePG](https://cloudnative-pg.io) operator（`postgresOperator.cnpg.enabled`），搭配 **3 個執行個體**（1 個 primary + 2 個 hot standbys）以實現自動容錯移轉。
- **ClickHouse** — 啟用內建的 [Altinity](https://github.com/Altinity/clickhouse-operator) operator（`clickhouseOperator.altinity.enabled`），搭配**每個分片 ≥2 個 replicas** 與 **3 個 ClickHouse Keeper** 節點以達成法定人數（quorum）。一旦單一節點的磁碟或 RAM 成為瓶頸，便加入分片。
- **Redis** — chart 內並無 chart 內建的複寫機制。若要實現 HA，請將 OneUptime 指向**外部代管的 Redis**（或 Sentinel/cluster 部署）。

## 保留期及其對儲存空間的影響

遙測資料保留期是以**以天數設定的 ClickHouse TTL** 強制執行，可**依專案**設定，並可**依訊號**（logs、metrics、traces、profiles）以及依 bucket（例如依 log 嚴重程度）進一步調整。寫死的預設值為 15 天。

由於保留期會直接倍增 ClickHouse 儲存空間，請在規劃磁碟規模之前先決定它。OneUptime **不**會自動將舊的遙測資料封存或分層至物件儲存 — 對於多年期的合規保留需求，請延長保留期時間窗，並相應地規劃 ClickHouse 儲存空間（或匯出至您自選的外部封存區）。

## 在決定前先量測

遙測資料量會隨應用程式 log 的詳盡程度、namespace 數量、scrape 間隔，以及是否在任何地方啟用 DEBUG logging 而有極大差異。請將上述層級視為起點：**為您的環境進行至少四週的觀測**，量測每個訊號每天的實際 GB 數，然後根據真實資料規劃保留期與儲存空間。

## 相關資源

- [Docker Compose](/docs/installation/docker-compose) — 單機規模規劃
- [Self-Hosted Architecture](/docs/self-hosted/architecture) — 各元件如何協同運作
- [Kubernetes Agent](/docs/telemetry/kubernetes-agent) — 收集器（data-plane）規模規劃
- [Helm chart on Artifact Hub](https://artifacthub.io/packages/helm/oneuptime/oneuptime)
