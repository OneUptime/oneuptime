# OneUptime Kubernetes Agent (Helm)

## 概觀

OneUptime Kubernetes Agent 是一個預先封裝好的 Helm chart，會在您的叢集上安裝以 OpenTelemetry 為基礎的 collector pipeline。它會傳送節點、Pod、容器與叢集指標；Kubernetes 事件；Pod 日誌；並且——在預設啟用 eBPF 的情況下——還會傳送應用程式追蹤、HTTP RED 指標、service-graph 資料，以及 Pod 對 Pod 的網路流量指標。無需修改程式碼、無需 SDK，只要一個 `helm install`。

本頁面是**安裝指南**。若要在 agent 所收集的資料之上設定 Kubernetes 監控與警示，請參閱 [Kubernetes Agent (monitors)](/docs/monitor/kubernetes-agent)。

## 先決條件

- 一個運作中的 Kubernetes 叢集（v1.23+）
- 已設定可存取您叢集的 `kubectl`
- 已安裝 `helm` v3
- 一組 **OneUptime API key**——請從 _Project Settings → API Keys_ 建立

## 步驟 1 — 加入 OneUptime Helm Repository

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm repo update
```

## 步驟 2 — 為您的叢集挑選一個 Preset

此 chart 對外提供單一的頂層選項——`preset`——用來為您的 Kubernetes 發行版挑選相容的預設值。它會控制那些您原本得手動調整的項目：是要透過 hostPath DaemonSet 還是透過 Kubernetes API 來傳送日誌，以及要套用哪一種 security context。

| `preset`            | 適用對象                                                                       | 日誌收集                                                      |
| ------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `standard` _(預設)_ | 自行管理的叢集、**EKS on EC2**、**GKE Standard**、**AKS**、minikube、kind、k3s | DaemonSet 透過 hostPath 讀取 `/var/log/pods`（負擔最低）      |
| `gke-autopilot`     | **GKE Autopilot**                                                              | Kubernetes API 日誌追蹤 Deployment（無 hostPath、無主機存取） |
| `eks-fargate`       | **EKS Fargate**                                                                | Kubernetes API 日誌追蹤 Deployment（無 hostPath、無主機存取） |

如果您不確定，請從 `standard` 開始。如果安裝因提及 `hostPath` 的 Pod Security 錯誤而失敗，請改用 `preset=gke-autopilot`（在 Fargate 上則用 `eks-fargate`）重新執行，即可成功。

## 步驟 3 — 安裝 Kubernetes Agent

請將 `YOUR_ONEUPTIME_URL`、`YOUR_ONEUPTIME_API_KEY` 以及叢集名稱替換為您環境中的對應值。叢集名稱是此叢集在 OneUptime 中顯示的方式——請選一個穩定的名稱，例如 `prod-us-east-1`。

### 標準叢集（自行管理、EKS on EC2、GKE Standard、AKS）

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster"
```

### GKE Autopilot

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set preset=gke-autopilot
```

### EKS Fargate

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set preset=eks-fargate
```

## 步驟 4 — 驗證安裝

檢查 agent 的 Pod 是否正在執行：

```bash
kubectl get pods -n oneuptime-agent
```

在**標準**叢集上，您會看到一個 metrics-collector Deployment，外加每個節點各一個 log-collector DaemonSet Pod：

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-xxxxx                   1/1     Running   0          1m
kubernetes-agent-logs-yyyyy                   1/1     Running   0          1m
```

在 **GKE Autopilot** 或 **EKS Fargate** 上，您會看到兩個 Deployment（沒有 DaemonSet）：

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-yyyyyyyyyy-yyyyy        1/1     Running   0          1m
```

一旦 agent 連線成功，您的叢集就會自動出現在 OneUptime 儀表板的 **Kubernetes** 區段中。

## 設定選項

### Namespace 篩選

`namespaceFilters` 會將 **Pod 日誌**（包含 hostPath DaemonSet 與 API 日誌追蹤器兩者）以及 **eBPF 追蹤**的範圍限定在您所選擇的 namespace。預設會排除 `kube-system`。若要將這些訊號限制在特定 namespace：

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set "namespaceFilters.include={default,production,staging}"
```

若要忽略某個吵雜的 namespace 但保留其他所有 namespace，請改用 `exclude`。`exclude` 一律優先於 `include`，而隨附的預設值是 `[kube-system]`——因此如果您仍想排除它，請再次將它列出：

```bash
  --set "namespaceFilters.exclude={kube-system,noisy-namespace}"
```

對於 **Pod 日誌與 eBPF 追蹤，這不需要任何代價**：namespace 是 Pod 日誌路徑以及 OBI 處理程序探索的一部分，因此被篩除的 namespace 從一開始就不會被讀取——不耗 CPU，也不產生 egress。

#### 將 namespace 篩選套用至指標與追蹤

預設情況下，上述清單只涵蓋 Pod 日誌與 eBPF 追蹤。`applyTo` 會將它們延伸至其他訊號：

```bash
  --set namespaceFilters.applyTo.metrics=true \
  --set namespaceFilters.applyTo.traces=true
```

| 設定值 | 它涵蓋的範圍 |
| ------- | -------------- |
| `applyTo.metrics` | 來自 kubeletstats、cAdvisor 與 kube-state-metrics 的每個 Pod / 每個容器指標 |
| `applyTo.traces` | 您的應用程式推送至 agent OTLP 端點的 span（eBPF span 已經有範圍限定） |

兩者刻意都**預設為關閉**。`exclude: [kube-system]` 是隨附的預設值，因此若自動將這些選項開啟，會在升級時默默地從每個既有安裝中刪除 kube-system 的指標。

> **節點層級與叢集層級的指標一律會被保留。** namespace 是 Pod 的屬性，而不是節點的屬性，因此像節點 CPU、節點記憶體與檔案系統用量這類序列沒有任何東西可供比對，也絕不會被捨棄。`applyTo.metrics` 會精簡每個 Pod 的 cardinality，且絕不會讓您對某個節點出問題視而不見。

Kubernetes **事件**無法在 agent 端依 namespace 篩選。它們來自 `k8sobjects` receiver，且不帶 `k8s.namespace.name` attribute——namespace 位於事件主體內部——因此沒有任何東西可供篩選條件比對。請改為在伺服器端捨棄它們（見下文）。

### 依日誌嚴重性篩選

`filters.logs.minSeverity` 會在 agent 端、於任何資料被傳送之前，捨棄低於某個嚴重性的日誌記錄：

```bash
  --set filters.logs.minSeverity=WARN
```

接受 `TRACE`、`DEBUG`、`INFO`、`WARN`、`ERROR`、`FATAL`。`WARN` 會保留 WARN、ERROR 與 FATAL，並捨棄 INFO、DEBUG 與 TRACE。預設值（`""`）會保留所有內容。

即使容器執行階段並不會在日誌行上記錄嚴重性，這仍然有效：agent 會從日誌文字中解析出嚴重性（`[ERROR]`、`WARN:`、`level=info` 等），並回退到 `stderr → ERROR` / `stdout → INFO`。它在**兩種**日誌模式下都適用——在 `daemonset` 模式下透過 collector，在 `api` 模式下則在日誌追蹤器本身內部——因此 preset 無法在您不知情的情況下改變其行為。

> 嚴重性仍然無法判定的記錄會被**保留**，絕不會被捨棄。對篩選條件而言，安全的失敗方式是傳送過多資料，而不是默默刪除一筆沒人知道未被分類的日誌。

### 依名稱包含或排除指標

`filters.metrics` 會控管哪些指標能離開叢集，範圍涵蓋管線中的每一個 receiver。

**捨棄少數幾個吵雜的指標**（拒絕清單——通常這才是您想要的）：

```bash
  --set-json 'filters.metrics.exclude=["k8s.volume.available","k8s.volume.capacity"]'
```

**只傳送固定的一組指標**（允許清單——其他全部都會被捨棄）：

```bash
  --set-json 'filters.metrics.include=["k8s.pod.cpu.usage","k8s.pod.memory.usage"]'
```

**依模式比對**，而非精確名稱：

```bash
  --set filters.metrics.matchType=regexp \
  --set-json 'filters.metrics.exclude=["^container_network_"]'
```

| 索引鍵 | 意義 |
| --- | ------- |
| `filters.metrics.exclude` | 要捨棄的指標名稱。會套用在 `include` 之上，因此 exclude 一律優先。 |
| `filters.metrics.include` | 當它非空時，**只有**這些指標會被傳送。 |
| `filters.metrics.matchType` | `strict`（精確名稱，預設值）或 `regexp`（RE2，**未錨定**）。 |

能為您省下一場事故的注意事項：

- `regexp` 是**未錨定的**——`system.cpu` 也會比對到 `system.cpu.time`。當您指的就是單一指標時，請將它錨定（`^system\.cpu$`）。
- RE2 **沒有 lookahead**，因此 `^(?!container_)` 無法編譯。請用 `include` 來表達「除了……之外的全部」，而不是用否定的正規表示式。
- `include` 會一次涵蓋每一個 receiver。一份漏掉某個指標的允許清單，會默默移除以該指標為基礎所建立的監控。除非您真的想要一組封閉的集合，否則請優先使用 `exclude`。
- 清單請使用 `--set-json`（或 values 檔案）。單純的 `--set` 會取代整份清單，而不是合併它。

### 停用日誌收集

如果您只需要指標與事件（不需要 Pod 日誌）：

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set logs.enabled=false
```

### 強制使用特定的日誌收集模式

進階使用者可以用 `logs.mode` 覆寫 preset 的選擇：

- `logs.mode=daemonset` — hostPath DaemonSet（負擔最低，需要 hostPath）
- `logs.mode=api` — Kubernetes API 日誌追蹤 Deployment（適用於任何叢集）
- `logs.mode=disabled` — 不收集日誌

明確指定的 `logs.mode` 一律優先於 preset 預設值。如果您比 preset 更了解自己的叢集，就使用這個選項。

### 啟用 Control Plane 監控

對於自行管理的叢集（非 EKS / GKE / AKS），您可以啟用 control plane 指標：

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set controlPlane.enabled=true
```

> 受管理的 Kubernetes 服務（EKS、GKE、AKS）通常不會對外公開 control plane 指標。請只為自行管理的叢集啟用此選項。

### 以專案標籤自動標記

任何以 `oneuptime.label.` 為前綴的 resource attribute 都會被提升為專案 Label，並附加到由此 agent 發出的叢集、服務與主機上。模式：`oneuptime.label.<dimension>=<value>` 會變成名為 `<dimension>:<value>` 的標籤。

在安裝時使用 `--set oneuptime.labels.<key>=<value>` 傳入標籤：

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="prod" \
  --set oneuptime.labels.team=payments \
  --set oneuptime.labels.env=production \
  --set oneuptime.labels.region=us-east-1
```

或將它們保存在 values 檔案中：

```yaml
# values.yaml
oneuptime:
  url: YOUR_ONEUPTIME_URL
  apiKey: YOUR_ONEUPTIME_API_KEY
  labels:
    team: payments
    env: production
    region: us-east-1
clusterName: prod
```

標籤比對時不分大小寫，因此既有的、手動建立的 `Production` 標籤會被重複使用，而不是被複製出一個新的。在 OneUptime UI 中手動加入的標籤，agent 絕不會將其移除。

## 升級 Agent

```bash
helm repo update
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values
```

`--reuse-values` 會保留您既有的設定（preset、叢集名稱、篩選條件）；在其之上傳入任何新的 `--set` 覆寫值。

## 解除安裝 Agent

```bash
helm uninstall kubernetes-agent --namespace oneuptime-agent
kubectl delete namespace oneuptime-agent
```

## 會收集哪些資料

| 類別                                     | 資料                                                                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **節點指標**                             | CPU 使用率、記憶體用量、檔案系統用量、網路 I/O                                                                       |
| **Pod 指標**                             | CPU 用量、記憶體用量、網路 I/O、重新啟動次數                                                                         |
| **容器指標**                             | 每個容器的 CPU 用量、記憶體用量                                                                                      |
| **叢集指標**                             | 節點狀態、可配置資源、Pod 數量                                                                                       |
| **Kubernetes 事件**                      | 警告、錯誤、排程事件                                                                                                 |
| **Pod 日誌**                             | 所有容器的 stdout/stderr 日誌（在標準叢集上透過 hostPath DaemonSet，或在 Autopilot / Fargate 上透過 Kubernetes API） |
| **應用程式追蹤** _(透過 eBPF，預設啟用)_ | 來自每個 Pod 的 HTTP、gRPC、SQL/Redis span——無需 SDK 或修改程式碼                                                    |
| **HTTP RED 指標** _(透過 eBPF)_          | 每個服務的 `http.server.request.duration`、請求與回應主體大小                                                        |
| **Service Graph** _(透過 eBPF)_          | 呼叫端 → 被呼叫端的請求率、延遲與錯誤連線——驅動 service map 檢視                                                     |
| **網路流量指標** _(透過 eBPF)_           | 帶有 k8s 中繼資料的 Pod 對 Pod TCP/UDP 位元組與封包計數器                                                            |
| **TCP 統計** _(透過 eBPF)_               | 節點層級的 RTT、連線失敗與重傳計數器                                                                                 |

## 透過 eBPF 取得應用程式追蹤與 HTTP 指標（預設啟用）

此 chart 會在每個節點上執行一個搭載 [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) 的 DaemonSet。它會將 eBPF 程式載入核心，並自動擷取來自每個受支援執行階段（Go、.NET、Java、Node.js、Python、Ruby、Rust）的 HTTP/HTTPS、gRPC 與 SQL/Redis 流量——無需 SDK，也不需要 sidecar。追蹤與請求指標接著會流經叢集內的 collector 送往 OneUptime。

**需求：** Linux kernel **5.8+** 並支援 BTF（在 Debian 11+、Ubuntu 20.10+、Fedora 34+、RHEL/Stream 9+ 上為預設）。eBPF DaemonSet 以**特權模式（privileged mode）**執行，因為載入 eBPF 程式必須如此。

### 停用 eBPF 自動 instrumentation

在以下情況下您應該停用它：

- 安裝在 **GKE Autopilot** 或 **EKS Fargate** 上——這些平台會封鎖特權 Pod（請使用 `preset=gke-autopilot` / `preset=eks-fargate` 並搭配 `ebpf.enabled=false`）。
- 節點執行的 kernel 舊於 5.8 且未回移植 BTF。
- 您已經從應用程式透過 OpenTelemetry SDK 傳送追蹤，並且不想要重複資料。

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set ebpf.enabled=false
```

### 切換個別的訊號族群

全部預設啟用。可用 `--set ebpf.features.<name>=false` 將其中任何一項關閉：

| `ebpf.features.*`         | 預設 | 它新增了什麼                                         |
| ------------------------- | ---- | ---------------------------------------------------- |
| `httpMetrics`             | 啟用 | 每個服務的 HTTP/gRPC RED 指標（請求率、延遲、錯誤）  |
| `spanMetrics`             | 啟用 | 每個 span 的請求/回應大小與持續時間                  |
| `serviceGraph`            | 啟用 | 呼叫端 → 被呼叫端的連線指標；驅動 service map        |
| `hostMetrics`             | 啟用 | 每個受 instrument 的處理程序的 CPU 與記憶體          |
| `networkMetrics`          | 啟用 | Pod 對 Pod TCP/UDP 流量計數器                        |
| `networkInterZoneMetrics` | 停用 | 網路指標的跨區（inter-zone）變體（cardinality 加倍） |
| `tcpStats`                | 啟用 | 節點層級的 TCP RTT、連線失敗、重傳計數器             |

跨服務的追蹤 context 傳播也預設啟用——OBI 會將 W3C `traceparent` 注入對外的 HTTP/TCP，因此一個橫跨 pod A → pod B 的請求會顯示為單一追蹤，任何地方都不需要修改 SDK。可用 `--set ebpf.contextPropagation=false` 關閉。

## 減少收集的資料量

agent 在開箱即用時是為了**涵蓋範圍**而調校的——它會傳送整個叢集的指標、Pod 日誌與 eBPF 追蹤，讓每個儀表板與監控從第一天起就能運作。在大型或繁忙的叢集上，這可能會是超出您所需的遙測資料量，並表現為更高的擷取量（在 OneUptime Cloud 上則是更高的成本）。這裡沒有任何項目是必要的，但如果某個叢集傳送的資料超過您想要的量，以下就是可供調整的開關——大致依影響程度排序。

訣竅在於**停止收集您不會查看的資料**，而不是收集全部再付費儲存。下方的每個槓桿都是一個 Helm value，因此您可以在 `helm upgrade --reuse-values` 上用 `--set` 套用它，並以相同方式將其回復。

### 資料量的來源

| 訊號                      | 最大來源                                         | 調降方式                                                                                     |
| ------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| **Pod 日誌**              | 叢集範圍內每個容器的每一行日誌                   | `namespaceFilters`、`filters.logs.minSeverity`、`logs.enabled`、`logs.mode`                  |
| **eBPF 追蹤與 span 指標** | 每個受 instrument 的處理程序中每個請求各一筆追蹤 | `ebpf.enabled`、`ebpf.features.*`、`ebpf.autoTargetExe`、`ebpf.excludeExePaths`              |
| **指標資料點**            | 抓取頻率 × Pod/容器的數量                        | `collectionInterval`、`hostMetrics.collectionInterval`、`cadvisor.scrapeInterval`            |
| **指標 cardinality**      | 不同序列的數量（每個容器、每個 PVC……）           | `filters.metrics.exclude`、`namespaceFilters.applyTo.metrics`、`cadvisor.metricsAllowlist`、`kubeletstats.volumeMetrics` |
| **選擇性啟用的額外項目**  | Profiling、稽核日誌、control plane、跨區指標     | 讓它們維持關閉（它們預設就是關閉的）                                                         |

削減資料量有兩種方式，而且值得知道您用的是哪一種：

- **在 receiver 端**——資料根本不會被收集。套用在 Pod 日誌上的 `namespaceFilters`、`cadvisor.metricsAllowlist`、較長的 `collectionInterval`。執行起來不需要任何代價，並且同時節省 CPU、egress 與擷取量。只要能涵蓋您的情境，請一律優先使用這些方式。
- **在 filter processor 端**——資料會先被收集，然後在匯出前被捨棄。`filters.logs.minSeverity`、`filters.metrics.*`、`namespaceFilters.applyTo.*`。會多耗用一些 collector CPU，但它能跨 receiver 運作，並且能表達 receiver 做不到的事情。

兩者都是**不可逆的**：您在此處捨棄的資料永遠不會抵達 OneUptime，而任何以其為基礎所建立的監控都會靜默。如果您寧可稍後再決定，OneUptime 可以改為在伺服器端捨棄資料（**Logs → Settings → Drop Filters**、**Metrics → Settings → Pipeline Rules**）——那仍然會耗用 egress，但它是一個您無需重新部署即可變更的設定。

### 槓桿 1 — Pod 日誌通常是單一最大來源

容器日誌幾乎總是擷取量中最大的一塊，因為叢集中每個容器的每一行日誌都是一筆記錄。

- **只想要特定 namespace 的日誌？** `namespaceFilters` 會在兩種日誌模式下限定 Pod 日誌的範圍（並連同 eBPF 追蹤一起）。比對發生在 Pod 日誌路徑上，因此被篩除的 namespace 根本不會被讀取——這是本文件中代價最低的槓桿：

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set "namespaceFilters.include={default,production}"
  ```

  （`kube-system` 預設就已被排除。）若要保留除了某一個以外的所有 namespace，請使用 `--set "namespaceFilters.exclude={kube-system,noisy-namespace}"`。

- **只在意警告與錯誤？** `filters.logs.minSeverity` 會在 agent 端捨棄其餘的日誌。在一個話很多的叢集上，這往往是可用的單一最大縮減幅度，因為 INFO 與 DEBUG 佔了大多數應用程式輸出的絕大部分：

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set filters.logs.minSeverity=WARN
  ```

  關於嚴重性如何判定，以及無法分類的日誌會有什麼結果，請參閱[依日誌嚴重性篩選](#filtering-by-log-severity)。

- **完全不需要 OneUptime 的 Pod 日誌？** 將它們關閉：

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set logs.enabled=false
  ```

  > **這同時也會停用節點、Pod、容器與主機指標。** kubelet、cAdvisor 與 hostmetrics receiver 全都位於同一個 log-collector DaemonSet 中，因此關閉 Pod 日誌也會一併移除它們——連同 OOM-kill、CPU-throttling 與 PVC 低磁碟空間監控。`logs.mode: api` 與 `logs.mode: disabled` 也適用同樣的情況。
  >
  > 如果您想要更少的日誌但想保留您的指標，請維持在 `logs.mode: daemonset`，並改為採用上方的 `namespaceFilters` 或 `filters.logs.minSeverity`。

### 槓桿 2 — 精簡 eBPF 自動 instrumentation

eBPF 讓您無需修改程式碼即可取得追蹤、RED 指標、service map 與網路流量指標——但它同時也是第二大的資料來源，因為它每個請求會發出一個 span，且每個服務會發出數個指標族群。您有三個層級的控制方式：

- **已經從 OTel SDK 傳送追蹤，或不想要自動追蹤？** 將 eBPF 完全關閉：

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.enabled=false
  ```

- **保留追蹤，捨棄較重的指標族群。** 上方的[訊號族群表格](#toggle-individual-signal-families)列出了每個 `ebpf.features.*` 旗標。資料量最高的族群是網路與 span 指標——將它們關閉後，追蹤、HTTP RED 指標與 service map 仍會保持完整：

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.features.networkMetrics=false \
    --set ebpf.features.tcpStats=false \
    --set ebpf.features.spanMetrics=false
  ```

  讓 `ebpf.features.networkInterZoneMetrics` 維持關閉（其預設值）——它會使網路流量的 cardinality 加倍。

- **只 instrument 您關心的執行階段。** OBI 預設會掛接到它辨識的每個處理程序（`ebpf.autoTargetExe: "*"`）。將它縮小到特定執行階段，或將二進位檔加入略過清單，以減少 agent 產生的「服務」與追蹤數量：

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.autoTargetExe='*/python,*/java'
  ```

  如需完整的預設值，請參閱[切換個別的訊號族群](#toggle-individual-signal-families)以及 chart values 中的 `excludeExePaths` 說明。

### 槓桿 3 — 放慢抓取間隔

指標資料量與 agent 抓取的頻率成正比。將間隔加倍大約會使該指標產生的資料點數量減半，且不會損失涵蓋範圍——只是解析度較粗。如果您不需要 30 秒的精細度，60s 或 120s 是一個幅度大又安全的縮減：

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set collectionInterval=60s \
  --set hostMetrics.collectionInterval=60s \
  --set cadvisor.scrapeInterval=60s
```

- `collectionInterval`（預設 `30s`）驅動節點 / Pod / 容器指標（`kubeletstats`）與叢集狀態指標（`k8s_cluster`）——佔指標資料量的大宗。
- `hostMetrics.collectionInterval` 與 `cadvisor.scrapeInterval` 涵蓋每個節點的 OS 指標以及 throttling / OOM 計數器。
- `resourceSpecs.interval`（預設 `300s`）控制完整資源規格（labels、annotations、status）被拉取的頻率——如果您不需要規格變更被快速反映，可將它調高。
- 如果您啟用了任何可選的抓取器，它們也各有自己的調整項：`kubeStateMetrics.scrapeInterval`、`serviceMesh.*.scrapeInterval`、`coreDns.scrapeInterval`、`csi.scrapeInterval`。

### 槓桿 4 — 讓指標 cardinality 維持在可控範圍

Cardinality（不同時間序列的數量）與頻率同樣重要，因為每個序列都是分開儲存與計費的。

- **cAdvisor 是刻意採用允許清單的。** cAdvisor receiver（預設啟用）可能會發出數百個指標；此 chart 只會轉送用來驅動監控的少數幾個（`cadvisor.metricsAllowlist`）。請讓這份清單保持精簡——**每個項目都會依每個容器保留，因此多一個指標就會乘上叢集的容器數量。** kube-state-metrics 預設為關閉，但如果您啟用它（`kubeStateMetrics.enabled=true`），它的 `kubeStateMetrics.metricsAllowlist` 會以相同方式控管 cardinality。
- **每個 PVC 的 volume 指標**（`kubeletstats.volumeMetrics.enabled`，預設啟用）會為每個 Pod 的每個 PVC 各發出一個序列。對大多數叢集來說這沒問題，但在具有數千個 PVC 的具狀態工作負載（Kafka、資料庫）上可能會很可觀——如果您不監看 PVC 磁碟空間，請在那裡將它關閉：

  ```bash
  --set kubeletstats.volumeMetrics.enabled=false
  ```

- **飽和度指標**（`kubeletstats.utilizationMetrics.enabled`，預設啟用）會新增 8 個衍生的「佔 request/limit 百分比」族群。它們很便宜（不需額外抓取），但如果您不使用 CPU/記憶體對比 limit 的監控，可以用 `--set kubeletstats.utilizationMetrics.enabled=false` 將它們捨棄。

- **依名稱捨棄特定指標。** 上方的允許清單是依每個 receiver 各自運作的；`filters.metrics.exclude` 則會橫跨所有 receiver，因此對於 receiver 層級的開關無法表達的任何情況，請使用它：

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set filters.metrics.matchType=regexp \
    --set-json 'filters.metrics.exclude=["^container_network_"]'
  ```

  關於精確比對與正規表示式比對的差異，以及允許清單的形式，請參閱[依名稱包含或排除指標](#including-or-excluding-metrics-by-name)。

- **捨棄整個 namespace 的指標。** 如果某個 namespace 很吵雜，但您仍想監看它的節點，`namespaceFilters.applyTo.metrics=true` 會將您既有的 namespace 清單套用至每個 Pod 與每個容器的序列。節點層級與叢集層級的序列一律會被保留：

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set namespaceFilters.applyTo.metrics=true
  ```

### 槓桿 5 — 讓較重的選擇性啟用功能維持關閉

這些功能**預設為關閉**，正是因為它們會增加負載——只有在您實際使用它所驅動的功能時才啟用某一項，如果您只是試用一下，之後請將它關回去：

| 設定值                                                    | 新增了什麼                                                                       |
| --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `profiling.enabled`                                       | 持續性 CPU profiling DaemonSet——比 eBPF 追蹤更重                                 |
| `auditLogs.enabled`                                       | 將每個 Kubernetes API 請求作為一筆日誌記錄（高資料量）                           |
| `controlPlane.enabled`                                    | etcd / API-server / scheduler / controller-manager 指標                          |
| `kubeStateMetrics.enabled`                                | CrashLoop / ImagePull / scheduling-reason 指標（新增一個 KSM Deployment + 抓取） |
| `ebpf.features.networkInterZoneMetrics`                   | 使網路流量指標的 cardinality 加倍                                                |
| `serviceMesh.enabled` / `csi.enabled` / `coreDns.enabled` | 額外的 Prometheus 抓取工作                                                       |

### 精簡的起始點

如果您想要較小的佔用，但仍希望監控能運作，這個設定檔會保留**完整的指標涵蓋範圍**，並削減真正驅動資料量的兩件事——日誌行與 eBPF span：

```yaml
# lean-values.yaml
oneuptime:
  url: YOUR_ONEUPTIME_URL
  apiKey: YOUR_ONEUPTIME_API_KEY
clusterName: my-cluster

# 將指標資料點減半。解析度較粗，但涵蓋範圍相同。
collectionInterval: 60s
hostMetrics:
  collectionInterval: 60s
cadvisor:
  scrapeInterval: 60s

# 保留 DaemonSet——它正是負責收集 kubelet、cAdvisor 與主機
# 指標以及日誌的元件——但只傳送值得警示的日誌。
logs:
  enabled: true
  mode: daemonset

filters:
  logs:
    minSeverity: WARN # 在 agent 端捨棄 INFO / DEBUG / TRACE

namespaceFilters:
  exclude:
    - kube-system
    - noisy-namespace

ebpf:
  enabled: true
  features:
    networkMetrics: false # 最重的 eBPF 族群
    tcpStats: false
    spanMetrics: false
```

```bash
helm upgrade --install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --create-namespace \
  -f lean-values.yaml
```

再視需要進一步收緊：將 `minSeverity` 提高到 `ERROR`、加入 `namespaceFilters.applyTo.metrics=true`，或者如果您已經從 OTel SDK 傳送追蹤，就設定 `ebpf.enabled=false`。

> **注意您所削減的內容。** 有些監控依賴特定的訊號：停用 `cadvisor` 會移除 OOM-kill 與 CPU-throttling 監控；停用 `kubeletstats.volumeMetrics` 會移除 PVC 低磁碟空間監控；停用日誌（或關閉 DaemonSet）會移除以日誌為基礎的警示*以及*您的節點指標。請削減您不會據以採取行動的訊號，而不是某個監控正在監看的訊號。

### 衡量效果

遙測用量是以每日為單位彙總的，因此請在 **Project Settings → Usage History** 下觀察一兩天的趨勢來確認下降——它不會在您套用變更的當下就立即變化。一次只調整一個槓桿，這樣您才能歸因於差異——先關閉日誌，接著調高間隔，然後精簡 eBPF——而不是一次把所有東西都調降，結果失去一個您實際依賴的監控。

## 疑難排解

> **最快的途徑——執行診斷指令碼。** 它會檢查 Pod 健康狀態、解碼並驗證 ingestion key、確認您的叢集能否連到 OneUptime，並向 OneUptime 詢問您的 token 是否真的被接受——然後印出單一的根本原因判定結果：
>
> ```bash
> curl -fsSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/HelmChart/Public/kubernetes-agent/troubleshoot.sh \
>   | bash -s -- -n oneuptime-agent
> ```
>
> 它只會讀取叢集狀態並執行幾個探測；它不會改變任何東西。若要進行最準確的對外連線（egress）測試，請先以 `--set debug.enabled=true` 安裝（這會在 agent 的 Pod 中加入一個小型的 network-tools sidecar，讓指令碼測試 collector 的確切對外路徑），然後重新執行。

### 安裝失敗並出現 "hostPath volumes are not allowed" 或 Pod Security admission 錯誤

您的叢集封鎖了 `hostPath`——在 **GKE Autopilot** 與 **EKS Fargate** 上很常見。請切換到 API 模式的 preset：

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set preset=gke-autopilot   # or eks-fargate
```

### Agent 顯示 "Disconnected"

叢集的連線狀態完全由是否有遙測資料抵達來決定——如果沒有任何資料抵達，該叢集會在約 15 分鐘後被標記為 disconnected。因此 "disconnected" 與 "no metrics" 幾乎總是出於**相同的**原因：agent 的遙測資料沒有被接受。

最常見的原因——尤其是在重新安裝之後——是**錯誤或已撤銷的 ingestion key**。這很容易被忽略，因為 OTLP 接收端點即使對於錯誤的 token 也會刻意回傳 HTTP `200`（如此一來，設定錯誤的 collector 才不會用重試風暴轟炸伺服器）。結果就是：collector 回報成功、它的日誌顯示沒有錯誤，而資料卻被默默丟棄。

1. 檢查 agent 的 Pod 是否正在執行：`kubectl get pods -n oneuptime-agent`
2. 檢查 metrics-collector 日誌：`kubectl logs -n oneuptime-agent -l component=metrics-collector -c otel-collector`（此處沒有錯誤**並不**代表資料有抵達——見上文）
3. **驗證 ingestion key。** 直接向 OneUptime 詢問您的 token 是否被接受（`200` = 有效，`401` = 未知/已撤銷）：

   ```bash
   curl -i -H "x-oneuptime-token: <YOUR_API_KEY>" https://oneuptime.com/otlp/v1/validate
   ```

   如果它回傳 `401`，表示您 release 中的 key 是錯誤的或已被撤銷。請從 _Project Settings → Telemetry Ingestion Keys_ 複製一個有效的 key 並重新部署：

   ```bash
   helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
     --namespace oneuptime-agent --reuse-values \
     --set oneuptime.apiKey=<LIVE_KEY>
   ```

4. 確認您的 OneUptime URL 正確，且您的叢集能透過網路連到它。
5. 如果您在重新安裝時更改了 `clusterName`，該 agent 會以**新的**叢集出現——舊的項目會維持在 "Disconnected"（這是預期的；它已經過時了）。

### 沒有日誌出現（僅限 API 模式）

1. 確認日誌追蹤 Pod 已 Ready：`kubectl get pods -n oneuptime-agent -l component=log-collector`
2. 檢查它的 `/healthz`——它會回報作用中的串流數量以及最後一次匯出錯誤
3. 檢查日誌：`kubectl logs -n oneuptime-agent deployment/kubernetes-agent-logs`
4. 對於非常大的叢集，單一 replica 可能成為瓶頸——可在不同的 release 上使用 `namespaceFilters.include` 依 namespace 進行分片

### 沒有指標出現

1. 首先排除被拒絕的 ingestion key——這是最常見的原因，而且從 agent 端看不出來。請見上文的 [Agent 顯示 "Disconnected"](#agent-shows-disconnected)（或直接執行診斷指令碼）。
2. 檢查叢集識別碼是否與您以 `clusterName` 傳入的值相符
3. 驗證 RBAC 權限：`kubectl get clusterrolebinding | grep kubernetes-agent`
4. 檢查 OTel collector 日誌是否有匯出錯誤

### eBPF Pod 處於 CrashLoopBackOff 或無法啟動

```bash
kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200
```

常見原因：

- **Kernel 太舊或缺少 BTF。** OBI 需要 Linux 5.8+ 並支援 BTF。請在節點上執行 `uname -r`。如果您無法升級，請停用 eBPF：`--set ebpf.enabled=false`。
- **特權 Pod 被封鎖。** 有些叢集會拒絕特權 Pod（GKE Autopilot、EKS Fargate，以及高度鎖定的環境）。請停用 eBPF。
- **主機上未掛載 `debugfs` / `tracefs`。** `tcpStats` 功能會掛接到需要它們的 kernel tracepoint。此 chart 會透過 `hostPath` 掛載兩者——但如果您的主機未對外提供它們，請只停用該族群：`--set ebpf.features.tcpStats=false`。

### 沒有應用程式追蹤出現

1. 確認 eBPF DaemonSet 健康：`kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`
2. 開啟 debug 追蹤列印器以確認 OBI 正在擷取流量：`--set ebpf.printTraces=true --set ebpf.logLevel=debug`，然後檢查 `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`
3. 如果您在 OBI 的 stdout 中看到 span，但在儀表板中卻看不到，那麼問題出在 collector → OneUptime 的匯出——請檢查 metrics-collector Pod 的日誌。

## 後續步驟

- 在此 agent 所收集的指標之上設定 **Kubernetes Monitors**——請參閱 [Kubernetes Agent (monitors)](/docs/monitor/kubernetes-agent)。
- 加入 **Logs Monitors** 以針對特定日誌模式發出警示（例如每個 Pod 或每個 namespace 的錯誤計數超過某個門檻）。
- 對於非 Kubernetes 的主機（Linux / macOS / Windows VM 與裸機），請使用 [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector) 頁面。
