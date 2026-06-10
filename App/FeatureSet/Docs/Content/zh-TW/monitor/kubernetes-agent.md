# 安裝 Kubernetes Agent

OneUptime Kubernetes agent 會從您的 Kubernetes 叢集收集叢集指標、事件、pod 記錄、**應用程式追蹤（透過 eBPF 的 HTTP/gRPC）**，以及 **OS 層級的節點指標**，並將它們傳送至 OneUptime。它以 Helm chart 形式發佈，並透過單一指令安裝 — eBPF 自動檢測（auto-instrumentation）預設為開啟，因此您無需變更任何程式碼即可看到服務層級的追蹤與 RED 指標。**持續性 CPU 火焰圖（eBPF profiler）**也同樣可用 — 當您需要更多遙測資料時，使用 `--set profiling.enabled=true` 選擇加入。

## 快速開始

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm repo update

helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=<A_UNIQUE_NAME_FOR_THIS_CLUSTER>
```

您的叢集將在幾分鐘內出現在 OneUptime 中。

## 選用 — 使用專案標籤自動為此叢集加上標籤

任何以 `oneuptime.label.` 為前綴的資源屬性都會被提升為專案標籤（Label），並附加到此 agent 所發出的叢集、服務和主機上。模式：`oneuptime.label.<dimension>=<value>` 會成為名為 `<dimension>:<value>` 的標籤。

在安裝時使用 `--set oneuptime.labels.<key>=<value>` 傳入標籤：

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod \
  --set oneuptime.labels.team=payments \
  --set oneuptime.labels.env=production \
  --set oneuptime.labels.region=us-east-1
```

或將它們保存在 values 檔案中：

```yaml
# values.yaml
oneuptime:
  url: https://oneuptime.com
  apiKey: <YOUR_API_KEY>
  labels:
    team: payments
    env: production
    region: us-east-1
clusterName: prod
```

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  -f values.yaml
```

此 agent 傳送的每一筆記錄 — 記錄、指標、追蹤、eBPF 自動檢測的 span，以及 CPU profile — 都會在 OneUptime UI 中以 `team:payments`、`env:production` 和 `region:us-east-1` 標記顯示。標籤以不分大小寫的方式比對，因此既有的手動建立的 `Production` 標籤會被重複使用，而不是被複製。在 OneUptime UI 中手動新增的標籤永遠不會被 agent 移除。

## 為您的叢集挑選正確的預設組態（preset）

不同的 Kubernetes 發行版有不同的限制 — 最明顯的是工作負載是否能掛載 `hostPath` 磁碟區。為了讓您不必閱讀安全性文件，此 chart 公開了一個頂層選項：`preset`。

| Preset | 適用於 | 記錄收集 | 備註 |
| --- | --- | --- | --- |
| `standard`（預設） | 自我管理、**EC2 上的 EKS**、**GKE Standard**、**AKS**、minikube、kind、k3s | DaemonSet 透過 hostPath 讀取 `/var/log/pods` | 負擔最低。這些平台上可使用 hostPath。 |
| `gke-autopilot` | **GKE Autopilot** | Kubernetes API tailer（Deployment） | Autopilot 上封鎖 hostPath。設定一個強化的安全性內容（security context），以通過 Autopilot 的 Pod Security Standards。 |
| `eks-fargate` | **EKS Fargate** | Kubernetes API tailer（Deployment） | 與 `gke-autopilot` 相同。Fargate 封鎖 hostPath 和 DaemonSet。 |

如果您不確定，請將 `preset` 保留為未設定 — 您會取得 `standard` 預設值。如果您的叢集因 Pod Security 政策錯誤（提及 `hostPath`）而拒絕安裝，請改用 `gke-autopilot`（或在 EKS Fargate 上使用 `eks-fargate`）並重新安裝。

### 範例

**GKE Standard、EC2 上的 EKS、自我管理或 AKS：**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod
```

**GKE Autopilot：**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod-gke-autopilot \
  --set preset=gke-autopilot
```

**EKS Fargate：**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod-eks-fargate \
  --set preset=eks-fargate
```

## 兩種記錄收集模式有何不同

在底層，`preset` 會設定 `logs.mode` — 而如果您需要覆寫預設組態的預設值，也可以直接設定它。

### DaemonSet 模式（`logs.mode: daemonset`）

DaemonSet 會在每個節點上執行一個 OpenTelemetry Collector pod。它透過 hostPath 磁碟區追蹤 `/var/log/pods/` 下的記錄檔案，並以 OTLP 轉發它們。

- **優點：** 負擔最低、隨節點線性擴展、不對 Kubernetes API server 造成負載、能處理記錄輪替。
- **缺點：** 需要 hostPath、需要排程 DaemonSet 的能力 — 這兩者在 GKE Autopilot 和 EKS Fargate 上都無法使用。

### API 模式（`logs.mode: api`）

一個單一複本的 Deployment（`oneuptime/kubernetes-log-tailer` 映像檔）使用 Kubernetes API 來串流容器記錄 — 與 `kubectl logs -f` 所使用的相同端點。沒有 hostPath、沒有主機存取、沒有 DaemonSet。

- **優點：** 可在 GKE Autopilot、EKS Fargate，以及任何封鎖 hostPath 或強制執行 `restricted` Pod Security Standard 的叢集上運作。
- **缺點：** 每個容器串流都是一條對 `kube-apiserver` 的長存活連線。實務上，一個複本可以輕鬆處理數千個容器。對於非常大型的叢集，請使用 `logs.api.replicas` 加上在每個複本上的 `namespaceFilters.include` 來依命名空間分片（shard）。

### 您應該使用哪一個？

如果 hostPath 可用，請使用 DaemonSet。其他所有情況，請使用 API 模式。`preset` 設定會為您挑選正確的那一個。

您也可以使用 `--set logs.enabled=false` 完全停用記錄收集，並改為透過 OpenTelemetry SDK 傳送應用程式記錄。請參閱 [OpenTelemetry](/docs/telemetry/open-telemetry) 文件。

## 透過 eBPF 收集應用程式追蹤與 HTTP 請求（預設開啟）

此 chart 會發佈一個 DaemonSet，在每個節點上執行 [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/)。OBI 將 eBPF 程式載入 Linux 核心，並監看 socket 層級的流量，以從節點上的每個 pod 重建 HTTP/HTTPS、gRPC 和 SQL/Redis 呼叫 — 無需變更程式碼、無需 SDK、無需 sidecar。擷取到的流量會以 OTLP 追蹤和請求/延遲指標的形式直接匯出到 OneUptime。

安裝後，您的服務會在一兩分鐘內開始出現在 **Telemetry → Traces** 和服務地圖（service map）中，並將 `k8s.cluster.name` 設定為您的 `clusterName`，以便您可以依叢集進行篩選。

### 何時將其關閉

eBPF **預設為開啟**。在以下情況下，您應該停用它（`--set ebpf.enabled=false`）：

- 您在 **GKE Autopilot** 或 **EKS Fargate** 上安裝。這些平台封鎖特權（privileged）pod，而 OBI 需要特權模式才能載入 eBPF 程式。
- 您的節點執行的核心版本舊於 **Linux 5.8** 且未進行 BTF backport。（現代發行版 — Debian 11+、Ubuntu 20.10+、Fedora 34+、RHEL/Stream 9+ — 都沒問題。）
- 您已經透過 OpenTelemetry SDK 從您的應用程式傳送追蹤，且不想要重複的資料。

### 會發出什麼資料

OBI 從擷取到的流量中提取數個訊號家族（signal family）。所有訊號都預設為開啟；每一個都可以使用 `--set ebpf.features.<key>=false` 獨立停用：

| 訊號 | 預設 | 它新增了什麼 |
| --- | --- | --- |
| `ebpf.features.httpMetrics` | 開啟 | 每個服務的 HTTP/gRPC RED 指標 — 請求速率、延遲長條圖、錯誤計數。 |
| `ebpf.features.spanMetrics` | 開啟 | 以 span 屬性為鍵的指標：依路由/操作細分的請求大小、回應大小、持續時間。 |
| `ebpf.features.serviceGraph` | 開啟 | 服務對服務的邊緣指標（呼叫端 → 被呼叫端的請求速率 + 延遲）。為服務地圖提供動力。 |
| `ebpf.features.hostMetrics` | 開啟 | 每個受檢測程序的 CPU 和記憶體 — 對於基本的容量問題，省去執行另一個獨立 profiler 的麻煩。 |
| `ebpf.features.networkMetrics` | 開啟 | 帶有 k8s 中繼資料的 pod 對 pod TCP/UDP 流量位元組與封包計數器。呈現每一對有通訊的 pod，包括那些執行 OBI 無法解析之協定的 pod。 |
| `ebpf.features.networkInterZoneMetrics` | 關閉 | 網路指標的跨區域（inter-zone）變體。會使基數（cardinality）加倍；只有當您實際使用基於區域的排程時才值得啟用。 |
| `ebpf.features.tcpStats` | 開啟 | 節點層級的 TCP 統計資料：RTT 長條圖、失敗連線計數、重傳次數。 |

OBI 也預設會跨服務邊界傳播追蹤內容（trace context）。當 pod A 向 pod B 發出 HTTP/gRPC 請求時，OBI 會在出站請求中注入一個 W3C `traceparent` 標頭 — 因此 pod B 端產生的 span 會連結到與 pod A 出站相同的追蹤中。兩個應用程式都不需要變更 SDK。

| 選項 | 預設 | 描述 |
| --- | --- | --- |
| `ebpf.contextPropagation` | 開啟 | 將 W3C `traceparent` 注入出站流量（HTTP 標頭 + 自訂 TCP 選項）。設定為 `false` 以將每個服務的 span 保留為本地。 |
| `ebpf.trackRequestHeaders` | 開啟 | 核心端的請求標頭追蹤，使傳播也能在純 HTTP 伺服器（非 Go、非 TLS）上運作。僅在 `contextPropagation` 為 true 時生效。 |

### 記錄 ↔ 追蹤關聯（選擇加入）

**預設關閉。** 啟用後，OBI 的記錄增強器（log enricher）會在每個受檢測程序中對 `write()` 系統呼叫附加一個 uprobe，並：

- 對於 **JSON 格式的記錄**：將 `trace_id` 和 `span_id` 欄位注入該行（記錄中任何既有的值都會被保留）。filelog DaemonSet 接著會將這些欄位提升到 LogRecord 的原生 trace_id/span_id 插槽，因此在追蹤檢視中點擊一個 span 便會跳到它在 OneUptime 中的記錄 — 而點擊一行記錄則會跳到它的父追蹤。
- 對於 **非 JSON 記錄**：該行會原封不動地保留 — 仍會被收集，只是不會自動連結。

啟用方式：

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --reset-then-reuse-values \
  --set ebpf.logToTraceCorrelation=true
```

| 選項 | 預設 | 描述 |
| --- | --- | --- |
| `ebpf.logToTraceCorrelation` | `false` | 啟用 OBI 記錄增強器和 filelog pipeline 的 trace_id 提升。預設關閉 — 請參閱下方的相容性警告。 |
| `ebpf.logEnricher.services` | `[{service: [{exe_path: "*"}]}]` | 記錄增強器的程序選擇器。每個項目都是一個 OBI [GlobAttributes](https://opentelemetry.io/docs/zero-code/obi/configure/options/#service-discovery) 選擇器 — 欄位包括 `exe_path`、`languages`、`k8s_pod_labels`、`k8s_pod_annotations`、`open_ports`、`cmd_args`。當您要將記錄增強範圍限定在工作負載的子集合時，請縮小此範圍。 |

#### 為什麼它預設關閉 — APM agent 相容性

記錄增強器會**在程序內（in-process）**重寫應用程式的 stdout 緩衝區：當一個被比對到的程序呼叫 `write()` 時，OBI 的 eBPF probe 會將原始的緩衝區位元組歸零（在下游被過濾掉），並透過一條獨立路徑重新發出一個經過增強的副本。該程序內緩衝區重寫與透過 `LD_PRELOAD` 注入自身並包裝 libc `write()` 的 APM agent 不相容：

| APM agent | 函式庫 | 兩者同時存在時的影響 |
| --- | --- | --- |
| Dynatrace OneAgent | `liboneagentproc.so` | 應用程式 SIGSEGV（exit 139）。Dynatrace watchdog 存活探測（liveness probe）失敗（它自己對 PID 檔案的 `write()` 停滯超過 10 秒門檻），且 OneAgent 進入重啟迴圈。 |
| New Relic | `libnewrelic*.so` | 相同類別的當機。 |
| AppDynamics | `libappdynamics*.so` | 相同類別的當機。 |
| Datadog | `libdd*.so` | 相同類別的當機。 |
| Instana | `libinstana*.so` | 相同類別的當機。 |

**.NET 工作負載最為脆弱** — Dynatrace 的 .NET agent 一律透過 `LD_PRELOAD` 注入，且 Microsoft.Extensions.Logging 主控台 sink 是無緩衝的，因此每一行記錄都會跨越這條競爭的 `write()` 路徑。Python 和 Go 工作負載通常不受影響，因為它們的 I/O 模型不在同一條程式碼路徑上。

**如果您需要在使用上述其中一種 APM agent 的同時取得記錄↔追蹤關聯**，請限定 `logEnricher.services` 的範圍，使增強器跳過執行 APM 的 pod。OBI 的 log_enricher 選擇器沒有 `exclude_services` 欄位（只有正向選擇器），因此您必須列出您「要」增強的工作負載：

```yaml
ebpf:
  logToTraceCorrelation: true
  logEnricher:
    services:
      # Enrich only pods with the apm-agent=none label
      - service:
          - k8s_pod_labels:
              apm-agent: "none"
```

或依執行階段（runtime）限定範圍 — Dynatrace 的 `LD_PRELOAD` 注入是針對 .NET 的，因此只增強 Python/Go 可避免衝突：

```yaml
ebpf:
  logToTraceCorrelation: true
  logEnricher:
    services:
      - service:
          - languages: "python,go,ruby,nodejs"
```

#### 其他注意事項

- **記錄必須是 JSON，`trace_id` 才會出現。** 將您的記錄器（logger）切換為 JSON 格式化器 — `structlog`、`pino`、`winston`、`serilog`、`logback-json`、klog `--logging-format=json` 等。
- **有緩衝的 stdout 會破壞關聯**，因為 `write()` 系統呼叫是在與處理請求的執行緒不同的執行緒上觸發。常見修正方式：
  - **Python**：設定 `PYTHONUNBUFFERED=1`（執行階段在非 TTY 時會對 stdout 進行區塊緩衝）。
  - **.NET**：在啟動時，`Console.SetOut(new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true })`。Microsoft.Extensions.Logging 的 `AddConsole()` 和 Serilog 的非同步 sink 也都無法運作 — 請改用同步的主控台寫入器（Serilog 預設的 `WriteTo.Console()` 沒問題）。
- Greenlet / gevent、Tornado 以及其他自訂的非同步執行階段不在涵蓋範圍內。

### 調校

| 選項 | 預設 | 描述 |
| --- | --- | --- |
| `ebpf.enabled` | `true` | 主開關。設定為 `false` 以完全略過 eBPF DaemonSet。 |
| `ebpf.image.tag` | `v0.9.0` | OBI 映像檔標籤。OBI 處於 pre-1.0；請釘選到一個已知良好的版本，並在升版時重新測試。 |
| `ebpf.autoTargetExe` | `*` | 要檢測的可執行檔的 glob。如果您想要限定自動檢測的範圍，請縮小此範圍（例如 `*/python,*/java`）。 |
| `ebpf.excludeExePaths` | （shell、kubelet、runc、containerd、otelcol、OBI 自身） | 要略過的以逗號分隔的 glob。 |
| `ebpf.logLevel` | `info` | `debug`、`info`、`warn` 或 `error`。在進行疑難排解時設定為 `debug`。 |
| `ebpf.printTraces` | `false` | 在 OTLP 匯出之外，另將 span 列印到 OBI 的 stdout — 對於在安裝期間驗證擷取很有用。 |
| `ebpf.resources.*` | requests `100m / 256Mi`，limits `1000m / 1Gi` | 對於高流量叢集請調高。 |

若要檢查 OBI 是否正在執行並看到流量：

```bash
kubectl get pods -n oneuptime-kubernetes-agent -l component=ebpf-instrument
kubectl logs -n oneuptime-kubernetes-agent -l component=ebpf-instrument --tail=200
```

## 持續性 CPU 分析（預設關閉）

一個獨立的 DaemonSet 執行 [OpenTelemetry eBPF Profiler](https://github.com/open-telemetry/opentelemetry-ebpf-profiler) — 封裝為 `otel/opentelemetry-collector-ebpf-profiler` 映像檔。它以 19Hz 在每個受支援的執行階段（Go、Java、.NET、Python、Ruby、Node.js、PHP、Perl、C/C++、Rust）上取樣 on-CPU 堆疊，並將 OTLP profile 傳送至 OneUptime，在那裡它們會出現在 **Telemetry → Performance Profiles** 之下，並以從個別追蹤 span 連結而來的火焰圖呈現。

分析（profiling）**預設關閉** — 它比 OBI 自動檢測更重（每個節點更多 CPU、更大的記憶體佔用），而且並非每個叢集都想要永遠開啟的火焰圖。當您想要更豐富的遙測資料時再啟用它：`--set profiling.enabled=true`。

當 eBPF 自動檢測也已開啟時（`ebpf.enabled: true`，預設值），每個 CPU 取樣都會透過共享的 bpffs map 與 OBI 的追蹤內容關聯 — 因此火焰圖會帶有 trace_id/span_id，而 OneUptime UI 可以向您顯示每個 span 的火焰圖。

需求：

- **Linux 核心 5.10+**（比 OBI 所需的 5.8 略新）。
- 具有 hostPID 的特權 pod — 與 eBPF 自動檢測 DaemonSet 的限制相同。無法在 GKE Autopilot、EKS Fargate 或其他鎖定的環境中執行。

調校：

| 選項 | 預設 | 描述 |
| --- | --- | --- |
| `profiling.enabled` | `false` | 主開關。預設關閉；為持續性 CPU 火焰圖選擇加入。 |
| `profiling.image.tag` | `0.152.0` | `otel/opentelemetry-collector-ebpf-profiler` 映像檔標籤。此 profiler 處於 pre-1.0；請釘選到一個已知良好的版本。 |
| `profiling.samplesPerSecond` | `19` | 以 Hz 為單位的取樣頻率。上游預設值；避免意外與常見的計時器頻率產生混疊（aliasing）。 |
| `profiling.offCpuThreshold` | `0` | (0–1] 會啟用 off-CPU 分析 — 診斷鎖定爭用（lock contention）和阻塞式 I/O。預設關閉，因為它會增加 tracepoint 負擔。 |
| `profiling.tracers` | `""`*（所有執行階段）* | 要載入的語言追蹤器（tracer）的以逗號分隔清單。 |
| `profiling.obiProcessContext` | `true` | 將取樣與 OBI 的追蹤內容關聯，以進行追蹤 ↔ profile 連結。 |

## 其他資料收集（主機指標、飽和度、cAdvisor、KSM、稽核記錄、CSI、CoreDNS）

此 chart 也可以收集：

| `<key>.enabled` | 預設 | 它新增了什麼 |
| --- | --- | --- |
| `hostMetrics` | 開啟 | 來自 `/proc` 和 `/sys` 的每個節點 OS 指標 — 磁碟 I/O 佇列深度、檔案系統 inode 使用率、NIC 錯誤計數器、分頁統計資料、平均負載。位於記錄收集器 DaemonSet 內部（沒有額外的 pod）。 |
| `kubeletstats.utilizationMetrics` | 開啟 | 飽和度指標 — 以 request 和 limit 百分比表示的容器與 pod CPU/記憶體。八個衍生的指標家族，為「CPU/Memory vs Request」和「CPU/Memory vs Limit」監視器提供動力。與既有的 `kubeletstats` 接收器使用相同的抓取（scrape），沒有額外的 pod。當 pod 未設定 request/limit 時一律為 0。 |
| `kubeletstats.volumeMetrics` | 開啟 | 每個 PVC 的磁碟使用量（`k8s.volume.available`、`k8s.volume.capacity`）。為「PVC Low Disk Space」監視器提供動力。每個 pod 的每個 PVC 一條序列 — 對大多數叢集而言是有界的，對擁有數千個 PVC 的有狀態工作負載則較重。 |
| `cadvisor` | 開啟 | 從每個節點的 DaemonSet pod 抓取 kubelet 的 `/metrics/cadvisor` 端點，以取得 `kubeletstats` 不會轉譯的容器指標：CFS 節流（`container_cpu_cfs_throttled_seconds_total`、`container_cpu_cfs_periods_total`）和 OOM kill 事件（`container_oom_events_total`）。一個 relabel 允許清單（allowlist）會在接收器處捨棄其他所有內容，使基數保持有界。 |
| `kubeStateMetrics` | 關閉 | 從 kube-state-metrics 拉取叢集狀態指標：pod 階段（Pending / Terminating）、pod 排程狀態（排程失敗的 pod）、容器等待原因（CrashLoopBackOff、ImagePullBackOff），以及資源配額使用量。`mode: bundled`（預設）會為您部署一個小型的 KSM Deployment；`mode: external` 則透過 `endpoint` 抓取既有的 KSM。預設關閉，因為 bundled 模式會在 chart 的佔用空間中增加一個 Deployment。 |
| `auditLogs` | 關閉 | 從主機追蹤 `/var/log/kubernetes/audit.log`。擷取每一個 Kubernetes API 請求 — 誰對哪個資源做了什麼。僅限自我管理叢集 — 受管理的 K8s（EKS、GKE、AKS、DOKS）會將稽核記錄路由至雲端供應商的 sink。 |
| `csi` | 關閉 | 自動探索標記為 `app=csi-driver`（或 `app.kubernetes.io/component=csi-driver`）的 pod，並抓取它們的 Prometheus `metrics` 連接埠 — 磁碟區 attach/detach 延遲、佈建失敗、IOPS。 |
| `coreDns` | 關閉 | 在 `:9153/metrics` 上抓取叢集的 CoreDNS 服務。呈現查詢速率、延遲、快取命中率、錯誤計數 — 常見的 P99 延遲元兇。 |

## 常用選項

| 選項 | 預設 | 描述 |
| --- | --- | --- |
| `preset` | （空白 — 視為 `standard`） | 請參閱上方的表格。 |
| `oneuptime.url` | *(必填)* | 您的 OneUptime 實例的 URL。 |
| `oneuptime.apiKey` | *(必填)* | 專案 API 金鑰（Settings → API Keys）。 |
| `oneuptime.labels` | `{}` | 要附加到此 agent 每一筆記錄的專案標籤。每個 `<key>: <value>` 都會成為一個 `oneuptime.label.<key>=<value>` 資源屬性。請參閱上方的自動標記章節。 |
| `clusterName` | *(必填)* | 此叢集的唯一名稱。會在每一筆記錄上標記為 `k8s.cluster.name`。 |
| `namespaceFilters.include` | `[]` | 如果有設定，則只監控這些命名空間。 |
| `namespaceFilters.exclude` | `["kube-system"]` | 要略過的命名空間。 |
| `logs.enabled` | `true` | 開啟或關閉記錄收集。 |
| `logs.mode` | （從 `preset` 衍生） | `daemonset`、`api` 或 `disabled`。覆寫 preset。 |
| `logs.api.replicas` | `1` | 記錄 tailer Deployment 複本的數量（僅在 API 模式中）。 |
| `ebpf.enabled` | `true` | 透過 OpenTelemetry eBPF Instrumentation 從每個 pod 自動擷取 HTTP/gRPC 追蹤。請參閱上方章節。 |
| `profiling.enabled` | `false` | 透過 OpenTelemetry eBPF Profiler 的持續性 CPU 火焰圖。預設關閉；為更多遙測資料選擇加入。請參閱上方章節。 |
| `hostMetrics.enabled` | `true` | 每個節點的 OS 指標。 |
| `kubeletstats.utilizationMetrics.enabled` | `true` | 容器與 pod 的 CPU/記憶體飽和度（request 和 limit 的 %）。無額外抓取 — 從 kubeletstats 資料衍生而來。 |
| `kubeletstats.volumeMetrics.enabled` | `true` | 每個 PVC 的磁碟使用量（`k8s.volume.available`、`k8s.volume.capacity`）。 |
| `cadvisor.enabled` | `true` | 抓取此節點的 kubelet `/metrics/cadvisor`，以取得 CFS 節流 + OOM kill 計數器。允許清單限定為 3 個指標。 |
| `kubeStateMetrics.enabled` | `false` | 從 kube-state-metrics 拉取 pod 階段、pod 排程狀態、容器等待原因（CrashLoopBackOff / ImagePullBackOff）和 ResourceQuota 使用量。bundled 與 external 的差異請參閱 `kubeStateMetrics.mode`。 |
| `auditLogs.enabled` | `false` | Kubernetes 稽核記錄收集（自我管理叢集）。 |
| `csi.enabled` | `false` | CSI 驅動程式 Prometheus 指標。 |
| `coreDns.enabled` | `false` | CoreDNS Prometheus 指標。 |
| `controlPlane.enabled` | `false` | 抓取 etcd / api-server / scheduler / controller-manager。僅限自我管理叢集 — 受管理的方案（EKS/GKE/AKS）通常不會公開這些端點。 |

如需完整清單，請參閱 [chart 的 `values.yaml`](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/kubernetes-agent/values.yaml)。

## 升級

```bash
helm repo update
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values
```

`--reuse-values` 會保留您現有的組態；在它之上傳入任何新的 `--set` 覆寫。

> **請注意：`--reuse-values` 不會合併來自 chart 的新預設值。** Helm 會原封不動地重用您先前已轉譯的值 — 因此在較新的 chart 版本中新增的任何頂層欄位（例如 `profiling.*`、`ebpf.features.*`）在您現有的 release 中會保持未設定，而樣板會像您已停用它一樣轉譯。
>
> **Helm 3.14+** — 改用 `--reset-then-reuse-values`。它會為您未覆寫的鍵重新讀取 chart 預設值：
>
> ```bash
> helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
>   --namespace oneuptime-kubernetes-agent \
>   --reset-then-reuse-values
> ```
>
> **Helm 3.13 或更早版本** — 移除 `--reuse-values` 並明確傳入您原本的 `--set` 旗標（或 `-f values.yaml`）。對於您未覆寫的所有內容，新的 chart 預設值將會套用。
>
> 如果某個新功能的 pod（例如 `kubernetes-agent-profiling-*`）在升級後未出現，這幾乎一定就是原因。`helm get values <release>` 會顯示 Helm 實際擁有的內容 — 輸出中缺少的欄位代表這些欄位的預設值未被合併。

## 解除安裝

```bash
helm uninstall oneuptime-agent --namespace oneuptime-kubernetes-agent
kubectl delete namespace oneuptime-kubernetes-agent
```

## 疑難排解

### 安裝失敗，出現「hostPath volumes are not allowed」

您的叢集封鎖 hostPath。請切換到 API 模式的 preset：

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values \
  --set preset=gke-autopilot   # or eks-fargate
```

### OneUptime 中沒有出現任何記錄

檢查 agent 的 pod：

```bash
kubectl get pods -n oneuptime-kubernetes-agent
kubectl logs -n oneuptime-kubernetes-agent -l app.kubernetes.io/part-of=oneuptime --tail=200
```

在 API 模式中，記錄 tailer pod 會在連接埠 13133 上公開 `/healthz` — 透過 `kubectl port-forward` 連線以取得匯出狀態快照。

### eBPF DaemonSet pod 處於 `CrashLoopBackOff` 或無法啟動

檢查 OBI pod 的記錄：

```bash
kubectl logs -n oneuptime-kubernetes-agent -l component=ebpf-instrument --tail=200
```

常見原因：

- **核心太舊或缺少 BTF。** OBI 需要具有 BTF 的 Linux 5.8+。在節點上用 `uname -r` 檢查。如果您無法升級，請停用 eBPF：`--set ebpf.enabled=false`。
- **特權 pod 被封鎖。** 有些叢集即使在 Autopilot/Fargate 之外也會拒絕特權 pod。請停用 eBPF。
- **儀表板中沒有追蹤，但 OBI 正在執行。** 設定 `--set ebpf.printTraces=true` 並檢查 OBI 的 stdout — 如果您在那裡看到 span，問題就在於 OTLP 傳遞（請檢查 `OTEL_EXPORTER_OTLP_ENDPOINT` 以及您的 OneUptime URL/API 金鑰）。如果您沒有看到 span，OBI 正在監看的流量可能全都被一個 OBI 無法攔截的 TLS 函式庫加密了（例如它無法辨識的靜態連結 TLS 實作）。

### 我的叢集 pod 太多，一個記錄 tailer 複本無法負荷（僅限 API 模式）

透過分片命名空間進行水平擴展。每個命名空間群組部署一次：

```bash
helm install oneuptime-agent-ns-a oneuptime/kubernetes-agent \
  --set preset=gke-autopilot \
  --set namespaceFilters.include={app-a,app-b} \
  ...
```

或者，調高 `logs.api.replicas` — 但請注意每個複本都會處理所有被允許的命名空間，因此為了去重複，您仍然需要命名空間分片。
