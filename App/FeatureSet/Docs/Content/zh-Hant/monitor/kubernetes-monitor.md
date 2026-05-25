# Kubernetes 監控器

Kubernetes 監控允許您監控 Kubernetes 集羣的健康狀況和性能，包括節點、Pod、工作負載和控制平面組件。OneUptime 會從您的集羣中收集指標，並根據您配置的條件對其進行評估。

## 概述

Kubernetes 監控器使用來自您集羣的指標，爲您的基礎設施提供深度可視性。它使您能夠：

- 監控集羣、命名空間、工作負載、節點和 Pod 的健康狀況
- 跟蹤資源的 CPU、內存、磁盤和網絡使用情況
- 檢測 Pod 崩潰、重啓和調度失敗
- 監控 Deployment 副本可用性
- 在控制平面問題（etcd、API 服務器、scheduler）發生時警報
- 跟蹤資源 requests 和 limits

## 創建 Kubernetes 監控器

1. 在 OneUptime 儀表板中前往 **Monitors**
2. 點擊 **Create Monitor**
3. 選擇 **Kubernetes** 作爲監控器類型
4. 選擇要監控的集羣和資源範圍
5. 配置資源過濾器和指標查詢
6. 根據需要配置監控條件

## 配置選項

### 集羣

選擇要監控的 Kubernetes 集羣。集羣必須通過 OpenTelemetry 與 OneUptime 集成。

### 資源範圍

選擇監控資源的層級：

| 範圍 | 描述 |
|-------|-------------|
| Cluster | 監控整個集羣 |
| Namespace | 監控特定命名空間內的資源 |
| Workload | 監控特定的 deployment、statefulset、daemonset、job 或 cronjob |
| Node | 監控特定的集羣節點 |
| Pod | 監控特定的 Pod |

### 資源過濾器

使用可選過濾器縮小範圍：

| 過濾器 | 描述 | 適用範圍 |
|--------|-------------|-------------------|
| Namespace | Kubernetes 命名空間 | Namespace、Workload、Pod |
| Workload Type | deployment、statefulset、daemonset、job、cronjob | Workload |
| Workload Name | 工作負載名稱 | Workload |
| Node Name | 節點名稱 | Node |
| Pod Name | Pod 名稱 | Pod |

### 指標查詢

配置一個或多個要評估的指標查詢。每個查詢指定：

- **指標名稱** —— 要查詢的 Kubernetes 指標
- **聚合方式** —— 如何聚合指標值
- **過濾器** —— 基於屬性的額外過濾

您還可以創建**公式**，使用數學表達式組合多個指標查詢。

### 滾動時間窗口

選擇指標評估的時間窗口：

- 過去 1 分鐘
- 過去 5 分鐘
- 過去 10 分鐘
- 過去 15 分鐘
- 過去 30 分鐘
- 過去 60 分鐘

## 常用 Kubernetes 指標

### Pod 指標

| 指標 | 描述 |
|--------|-------------|
| Pod CPU Usage | Pod 的 CPU 消耗 |
| Pod Memory Usage | Pod 的內存消耗 |
| Pod Filesystem Usage | Pod 的磁盤使用情況 |
| Pod Network Receive/Transmit | 網絡流量 |
| Pod Phase | 當前 Pod 階段（Running、Pending、Failed 等） |

### 節點指標

| 指標 | 描述 |
|--------|-------------|
| Node CPU Usage | 每個節點的 CPU 使用率 |
| Node Memory Usage | 每個節點的內存使用率 |
| Node Filesystem Usage | 每個節點的磁盤使用情況 |
| Node Disk I/O | 讀/寫操作 |
| Node Ready Condition | 節點是否就緒 |

### 容器指標

| 指標 | 描述 |
|--------|-------------|
| Container Restarts | 容器重啓次數 |
| Container CPU/Memory Limits | 資源 limits |
| Container CPU/Memory Requests | 資源 requests |
| Container Ready Status | 容器是否就緒 |

### 工作負載指標

| 指標 | 描述 |
|--------|-------------|
| Deployment Available/Unavailable Replicas | 副本數 |
| DaemonSet Misscheduled Nodes | 調度問題 |
| StatefulSet Ready Replicas | 就緒副本數 |
| Job Active/Failed/Succeeded Pods | Job 狀態 |

## 監控條件

### 可用的檢查類型

| 檢查類型 | 描述 |
|------------|-------------|
| Metric Value | 所配置指標查詢或公式的值 |

### 聚合類型

| 聚合方式 | 描述 |
|-------------|-------------|
| Average | 時間窗口內的平均值 |
| Sum | 所有值的總和 |
| Maximum Value | 時間窗口內的最高值 |
| Minimum Value | 時間窗口內的最低值 |
| All Values | 所有值都必須滿足條件 |
| Any Value | 至少有一個值滿足條件 |

### 過濾類型

- **大於**、**小於**、**大於或等於**、**小於或等於**、**等於**、**不等於**

## 預置警報模板

OneUptime 爲常見的 Kubernetes 監控場景提供模板：

| 模板 | 描述 | 閾值 |
|----------|-------------|-----------|
| CrashLoopBackOff Detection | 容器重啓次數 | > 5 次重啓 |
| Pod Stuck in Pending | 處於 Pending 階段的 Pod | > 0 個 Pod |
| Node Not Ready | 節點就緒狀態 | = 0（未就緒） |
| High Node CPU | 節點 CPU 使用率 | > 90% |
| High Node Memory | 節點內存使用率 | > 85% |
| Deployment Replica Mismatch | 不可用副本數 | > 0 個副本 |
| Job Failures | Job 中失敗的 Pod | > 0 次失敗 |
| etcd No Leader | etcd 集羣缺少 leader | = 0（無 leader） |
| API Server Throttling | 被丟棄的 API 請求 | > 0 個請求 |
| Scheduler Backlog | scheduler 中待處理的 Pod | > 0 個 Pod |
| High Node Disk Usage | 節點文件系統使用率 | > 90% |
| DaemonSet Unavailable | 調度失敗的節點 | > 0 個節點 |

## 安裝要求

要使用 Kubernetes 監控，您需要在集羣中安裝 OneUptime Kubernetes 代理。該代理通過 OTLP 將集羣指標、事件、Pod 日誌，以及 —— 默認情況下 —— **通過 eBPF 捕獲的應用追蹤和 HTTP RED 指標** 發送到 OneUptime。無需修改代碼或爲每個應用配置 SDK 即可看到服務級別的流量。

請參閱 [安裝 Kubernetes Agent](/docs/monitor/kubernetes-agent) 指南 —— 它涵蓋了單條命令的 Helm 安裝、用於爲您的集羣挑選正確配置（standard、GKE Autopilot、EKS Fargate）的 `preset` 選項，以及各信號家族（HTTP RED 指標、服務圖譜、網絡流、TCP 統計）的 `ebpf.features.*` 開關。
