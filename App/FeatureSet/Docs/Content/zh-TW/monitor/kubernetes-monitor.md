# Kubernetes 監視器

Kubernetes 監控可讓您監控 Kubernetes 叢集的健康狀態與效能，包括節點、Pod、工作負載以及控制平面元件。OneUptime 會從您的叢集收集指標，並依據您設定的條件進行評估。

## 概觀

Kubernetes 監視器使用叢集中的指標，為您的基礎架構提供深入的可視性。這讓您能夠：

- 監控叢集、命名空間、工作負載、節點與 Pod 的健康狀態
- 追蹤各資源的 CPU、記憶體、磁碟與網路使用量
- 偵測 Pod 當機、重新啟動與排程失敗
- 監控部署的副本可用性
- 針對控制平面問題（etcd、API server、scheduler）發出警示
- 追蹤資源請求量與限制量

## 建立 Kubernetes 監視器

1. 前往 OneUptime 儀表板中的 **Monitors**
2. 點選 **Create Monitor**
3. 選擇 **Kubernetes** 作為監視器類型
4. 選擇要監控的叢集與資源範圍
5. 設定資源篩選條件與指標查詢
6. 視需要設定監控條件

## 設定選項

### 叢集

選擇要監控的 Kubernetes 叢集。叢集必須透過 OpenTelemetry 與 OneUptime 整合。

### 資源範圍

選擇要監控資源的層級：

| 範圍 | 說明 |
|-------|-------------|
| Cluster | 監控整個叢集 |
| Namespace | 監控特定命名空間內的資源 |
| Workload | 監控特定的 deployment、statefulset、daemonset、job 或 cronjob |
| Node | 監控特定的叢集節點 |
| Pod | 監控特定的 Pod |

### 資源篩選條件

使用選用的篩選條件縮小範圍：

| 篩選條件 | 說明 | 適用範圍 |
|--------|-------------|-------------------|
| Namespace | Kubernetes 命名空間 | Namespace、Workload、Pod |
| Workload Type | deployment、statefulset、daemonset、job、cronjob | Workload |
| Workload Name | 工作負載的名稱 | Workload |
| Node Name | 節點的名稱 | Node |
| Pod Name | Pod 的名稱 | Pod |

### 指標查詢

設定一個或多個要評估的指標查詢。每個查詢會指定：

- **指標名稱** — 要查詢的 Kubernetes 指標
- **彙總方式** — 如何彙總指標值
- **篩選條件** — 額外的屬性篩選

您也可以建立 **公式**，使用數學運算式來組合多個指標查詢。

### 滾動時間窗口

選擇用於指標評估的時間窗口：

- 過去 1 分鐘
- 過去 5 分鐘
- 過去 10 分鐘
- 過去 15 分鐘
- 過去 30 分鐘
- 過去 60 分鐘

## 常見的 Kubernetes 指標

### Pod 指標

| 指標 | 說明 |
|--------|-------------|
| Pod CPU Usage | Pod 的 CPU 消耗量 |
| Pod Memory Usage | Pod 的記憶體消耗量 |
| Pod Filesystem Usage | Pod 的磁碟使用量 |
| Pod Network Receive/Transmit | 網路流量 |
| Pod Phase | 目前的 Pod 階段（Running、Pending、Failed 等） |

### 節點指標

| 指標 | 說明 |
|--------|-------------|
| Node CPU Usage | 每個節點的 CPU 使用率 |
| Node Memory Usage | 每個節點的記憶體使用率 |
| Node Filesystem Usage | 每個節點的磁碟使用量 |
| Node Disk I/O | 讀取/寫入作業 |
| Node Ready Condition | 節點是否就緒 |

### 容器指標

| 指標 | 說明 |
|--------|-------------|
| Container Restarts | 容器重新啟動的次數 |
| Container CPU/Memory Limits | 資源限制量 |
| Container CPU/Memory Requests | 資源請求量 |
| Container Ready Status | 容器是否就緒 |

### 工作負載指標

| 指標 | 說明 |
|--------|-------------|
| Deployment Available/Unavailable Replicas | 副本數量 |
| DaemonSet Misscheduled Nodes | 排程問題 |
| StatefulSet Ready Replicas | 就緒副本數量 |
| Job Active/Failed/Succeeded Pods | Job 狀態 |

## 監控條件

### 可用的檢查類型

| 檢查類型 | 說明 |
|------------|-------------|
| Metric Value | 已設定的指標查詢或公式的值 |

### 彙總類型

| 彙總方式 | 說明 |
|-------------|-------------|
| Average | 時間窗口內的平均值 |
| Sum | 所有值的總和 |
| Maximum Value | 時間窗口內的最高值 |
| Minimum Value | 時間窗口內的最低值 |
| All Values | 所有值都必須符合條件 |
| Any Value | 至少一個值必須符合 |

### 篩選類型

- **Greater Than**、**Less Than**、**Greater Than or Equal To**、**Less Than or Equal To**、**Equal To**、**Not Equal To**

## 預先建置的警示範本

OneUptime 為常見的 Kubernetes 監控情境提供範本：

| 範本 | 說明 | 閾值 |
|----------|-------------|-----------|
| CrashLoopBackOff Detection | 容器重新啟動次數 | > 5 次重新啟動 |
| Pod Stuck in Pending | 處於 Pending 階段的 Pod | > 0 個 Pod |
| Node Not Ready | 節點就緒狀態 | = 0（未就緒） |
| High Node CPU | 節點 CPU 使用率 | > 90% |
| High Node Memory | 節點記憶體使用率 | > 85% |
| Deployment Replica Mismatch | 不可用的副本 | > 0 個副本 |
| Job Failures | Job 中失敗的 Pod | > 0 次失敗 |
| etcd No Leader | etcd 叢集缺少 leader | = 0（無 leader） |
| API Server Throttling | 遭丟棄的 API 請求 | > 0 個請求 |
| Scheduler Backlog | scheduler 中待處理的 Pod | > 0 個 Pod |
| High Node Disk Usage | 節點檔案系統使用量 | > 90% |
| DaemonSet Unavailable | 排程錯誤的節點 | > 0 個節點 |

## 設定需求

若要使用 Kubernetes 監控，您需要在叢集中安裝 OneUptime Kubernetes agent。該 agent 會透過 OTLP 將叢集指標、事件、Pod 記錄，以及（預設情況下）**透過 eBPF 擷取的應用程式追蹤與 HTTP RED 指標** 傳送至 OneUptime。無需變更任何程式碼或為每個應用程式安裝 SDK，即可看到服務層級的流量。

請參閱 [Install the Kubernetes Agent](/docs/monitor/kubernetes-agent) 指南 — 其中涵蓋單一指令的 Helm 安裝、用於為您的叢集挑選正確設定的 `preset` 選項（standard、GKE Autopilot、EKS Fargate），以及用於各個訊號家族（HTTP RED 指標、服務圖、網路流量、TCP 統計）的 `ebpf.features.*` 切換選項。
