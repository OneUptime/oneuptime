# OneUptime Kubernetes Agent (Helm)

## 概觀

OneUptime Kubernetes Agent 是一個預先封裝好的 Helm chart，會在您的叢集上安裝以 OpenTelemetry 為基礎的 collector pipeline。它會傳送節點、Pod、容器與叢集指標；Kubernetes 事件；Pod 日誌；並且——在預設啟用 eBPF 的情況下——還會傳送應用程式追蹤、HTTP RED 指標、service-graph 資料，以及 Pod 對 Pod 的網路流量指標。無需修改程式碼、無需 SDK，只要一個 `helm install`。

本頁面是**安裝指南**。若要在 agent 所收集的資料之上設定 Kubernetes 監控與警示，請參閱 [Kubernetes Agent (monitors)](/docs/monitor/kubernetes-agent)。

## 先決條件

- 一個運作中的 Kubernetes 叢集（v1.23+）
- 已設定可存取您叢集的 `kubectl`
- 已安裝 `helm` v3
- 一組 **OneUptime API key**——請從 *Project Settings → API Keys* 建立

## 步驟 1 — 加入 OneUptime Helm Repository

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm repo update
```

## 步驟 2 — 為您的叢集挑選一個 Preset

此 chart 對外提供單一的頂層選項——`preset`——用來為您的 Kubernetes 發行版挑選相容的預設值。它會控制那些您原本得手動調整的項目：是要透過 hostPath DaemonSet 還是透過 Kubernetes API 來傳送日誌，以及要套用哪一種 security context。

| `preset` | 適用對象 | 日誌收集 |
|---|---|---|
| `standard` *(預設)* | 自行管理的叢集、**EKS on EC2**、**GKE Standard**、**AKS**、minikube、kind、k3s | DaemonSet 透過 hostPath 讀取 `/var/log/pods`（負擔最低） |
| `gke-autopilot` | **GKE Autopilot** | Kubernetes API 日誌追蹤 Deployment（無 hostPath、無主機存取） |
| `eks-fargate` | **EKS Fargate** | Kubernetes API 日誌追蹤 Deployment（無 hostPath、無主機存取） |

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

預設會排除 `kube-system`。若只要監控特定 namespace：

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set "namespaceFilters.include={default,production,staging}"
```

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

| 類別 | 資料 |
|----------|------|
| **節點指標** | CPU 使用率、記憶體用量、檔案系統用量、網路 I/O |
| **Pod 指標** | CPU 用量、記憶體用量、網路 I/O、重新啟動次數 |
| **容器指標** | 每個容器的 CPU 用量、記憶體用量 |
| **叢集指標** | 節點狀態、可配置資源、Pod 數量 |
| **Kubernetes 事件** | 警告、錯誤、排程事件 |
| **Pod 日誌** | 所有容器的 stdout/stderr 日誌（在標準叢集上透過 hostPath DaemonSet，或在 Autopilot / Fargate 上透過 Kubernetes API） |
| **應用程式追蹤** *(透過 eBPF，預設啟用)* | 來自每個 Pod 的 HTTP、gRPC、SQL/Redis span——無需 SDK 或修改程式碼 |
| **HTTP RED 指標** *(透過 eBPF)* | 每個服務的 `http.server.request.duration`、請求與回應主體大小 |
| **Service Graph** *(透過 eBPF)* | 呼叫端 → 被呼叫端的請求率、延遲與錯誤連線——驅動 service map 檢視 |
| **網路流量指標** *(透過 eBPF)* | 帶有 k8s 中繼資料的 Pod 對 Pod TCP/UDP 位元組與封包計數器 |
| **TCP 統計** *(透過 eBPF)* | 節點層級的 RTT、連線失敗與重傳計數器 |

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

| `ebpf.features.*` | 預設 | 它新增了什麼 |
|---|---|---|
| `httpMetrics` | 啟用 | 每個服務的 HTTP/gRPC RED 指標（請求率、延遲、錯誤） |
| `spanMetrics` | 啟用 | 每個 span 的請求/回應大小與持續時間 |
| `serviceGraph` | 啟用 | 呼叫端 → 被呼叫端的連線指標；驅動 service map |
| `hostMetrics` | 啟用 | 每個受 instrument 的處理程序的 CPU 與記憶體 |
| `networkMetrics` | 啟用 | Pod 對 Pod TCP/UDP 流量計數器 |
| `networkInterZoneMetrics` | 停用 | 網路指標的跨區（inter-zone）變體（cardinality 加倍） |
| `tcpStats` | 啟用 | 節點層級的 TCP RTT、連線失敗、重傳計數器 |

跨服務的追蹤 context 傳播也預設啟用——OBI 會將 W3C `traceparent` 注入對外的 HTTP/TCP，因此一個橫跨 pod A → pod B 的請求會顯示為單一追蹤，任何地方都不需要修改 SDK。可用 `--set ebpf.contextPropagation=false` 關閉。

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

叢集的連線狀態完全由是否有遙測資料抵達來決定——如果沒有任何資料抵達，該叢集會在約 5 分鐘後被標記為 disconnected。因此 "disconnected" 與 "no metrics" 幾乎總是出於**相同的**原因：agent 的遙測資料沒有被接受。

最常見的原因——尤其是在重新安裝之後——是**錯誤或已撤銷的 ingestion key**。這很容易被忽略，因為 OTLP 接收端點即使對於錯誤的 token 也會刻意回傳 HTTP `200`（如此一來，設定錯誤的 collector 才不會用重試風暴轟炸伺服器）。結果就是：collector 回報成功、它的日誌顯示沒有錯誤，而資料卻被默默丟棄。

1. 檢查 agent 的 Pod 是否正在執行：`kubectl get pods -n oneuptime-agent`
2. 檢查 metrics-collector 日誌：`kubectl logs -n oneuptime-agent -l component=metrics-collector -c otel-collector`（此處沒有錯誤**並不**代表資料有抵達——見上文）
3. **驗證 ingestion key。** 直接向 OneUptime 詢問您的 token 是否被接受（`200` = 有效，`401` = 未知/已撤銷）：

   ```bash
   curl -i -H "x-oneuptime-token: <YOUR_API_KEY>" https://oneuptime.com/otlp/v1/validate
   ```

   如果它回傳 `401`，表示您 release 中的 key 是錯誤的或已被撤銷。請從 *Project Settings → Telemetry Ingestion Keys* 複製一個有效的 key 並重新部署：

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
