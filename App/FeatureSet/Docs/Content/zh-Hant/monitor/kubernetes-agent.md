# 安裝 Kubernetes Agent

OneUptime Kubernetes 代理從您的 Kubernetes 集羣中收集集羣指標、事件、Pod 日誌、**應用追蹤（通過 eBPF 採集 HTTP/gRPC）**以及**操作系統級節點指標**，並將這些數據發送到 OneUptime。它以 Helm chart 的形式分發，只需一條命令即可安裝 —— eBPF 自動埋點默認已啓用，因此您無需修改任何代碼即可看到服務級別的追蹤和 RED 指標。**持續的 CPU 火焰圖（eBPF profiler）**也可用 —— 當您需要更多遙測數據時，可通過 `--set profiling.enabled=true` 選擇啓用。

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

幾分鐘內您的集羣就會出現在 OneUptime 中。

## 爲您的集羣選擇合適的預設

不同的 Kubernetes 發行版有不同的約束 —— 最顯著的是工作負載是否可以掛載 `hostPath` 卷。chart 沒有強迫您閱讀安全文檔，而是公開了一個頂層選項：`preset`。

| Preset | 適用場景 | 日誌採集方式 | 備註 |
| --- | --- | --- | --- |
| `standard`（默認） | 自管集羣、**EC2 上的 EKS**、**GKE Standard**、**AKS**、minikube、kind、k3s | 通過 hostPath 讀取 `/var/log/pods` 的 DaemonSet | 開銷最低。這些平臺上 hostPath 可用。 |
| `gke-autopilot` | **GKE Autopilot** | 使用 Kubernetes API 的日誌收集器（Deployment） | Autopilot 上禁用 hostPath。設置了一個加固的安全上下文，可以通過 Autopilot 的 Pod Security Standards。 |
| `eks-fargate` | **EKS Fargate** | 使用 Kubernetes API 的日誌收集器（Deployment） | 與 `gke-autopilot` 相同。Fargate 禁用 hostPath 和 DaemonSet。 |

如果不確定，可以不設置 `preset` —— 這樣會使用 `standard` 默認值。如果您的集羣因 Pod Security 策略錯誤（提及 `hostPath`）而拒絕安裝，請切換到 `gke-autopilot`（或在 EKS Fargate 上切換到 `eks-fargate`），然後重新安裝。

### 示例

**GKE Standard、EC2 上的 EKS、自管集羣或 AKS：**

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

## 兩種日誌採集模式的區別

實際上 `preset` 會設置 `logs.mode` —— 如果需要覆蓋預設的默認值，您也可以直接設置該項。

### DaemonSet 模式（`logs.mode: daemonset`）

DaemonSet 在每個節點上運行一個 OpenTelemetry Collector pod。它通過 hostPath 卷讀取 `/var/log/pods/` 下的日誌文件，並通過 OTLP 轉發。

- **優點：** 開銷最低，隨節點數量線性擴展，不會給 Kubernetes API 服務器增加負載，並能處理日誌輪轉。
- **缺點：** 需要 hostPath，需要調度 DaemonSet 的能力 —— GKE Autopilot 和 EKS Fargate 上兩者都不可用。

### API 模式（`logs.mode: api`）

單副本 Deployment（`oneuptime/kubernetes-log-tailer` 鏡像）使用 Kubernetes API 來流式獲取容器日誌 —— 與 `kubectl logs -f` 使用的是同一個端點。無需 hostPath、無需主機訪問、無需 DaemonSet。

- **優點：** 可在 GKE Autopilot、EKS Fargate 以及任何禁用 hostPath 或強制使用 `restricted` Pod Security Standard 的集羣上運行。
- **缺點：** 每個容器流都是與 `kube-apiserver` 建立的長連接。實際使用中，一個副本可以從容處理幾千個容器。對於非常大的集羣，可以按命名空間分片，使用 `logs.api.replicas` 加上每個副本上的 `namespaceFilters.include`。

### 應該使用哪種模式？

如果 hostPath 可用，請使用 DaemonSet。其他情況下，使用 API 模式。`preset` 設置會爲您選擇正確的模式。

您還可以通過 `--set logs.enabled=false` 完全禁用日誌採集，轉而通過 OpenTelemetry SDK 發送應用日誌。請參閱 [OpenTelemetry](/docs/telemetry/open-telemetry) 文檔。

## 通過 eBPF 採集應用追蹤和 HTTP 請求（默認啓用）

chart 在每個節點上部署一個運行 [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) 的 DaemonSet。OBI 將 eBPF 程序加載到 Linux 內核中，監視套接字級流量，從節點上的每個 Pod 重建 HTTP/HTTPS、gRPC 和 SQL/Redis 調用 —— 無需修改代碼、無需 SDK、無需 sidecar。捕獲到的流量以 OTLP 追蹤和請求/延遲指標的形式直接導出到 OneUptime。

安裝完成後一兩分鐘內，您的服務就會出現在 **Telemetry → Traces** 和服務圖譜中，並將 `k8s.cluster.name` 設置爲您的 `clusterName`，便於按集羣過濾。

### 何時關閉

eBPF **默認啓用**。在以下情況下您應該禁用它（`--set ebpf.enabled=false`）：

- 您在 **GKE Autopilot** 或 **EKS Fargate** 上安裝。這些平臺禁止特權 Pod，而 OBI 需要特權模式才能加載 eBPF 程序。
- 您的節點運行的內核版本早於 **Linux 5.8** 且未回移植 BTF。（現代發行版 —— Debian 11+、Ubuntu 20.10+、Fedora 34+、RHEL/Stream 9+ —— 都沒問題。）
- 您已經在應用中通過 OpenTelemetry SDK 發送追蹤，不希望產生重複數據。

### 發送的數據

OBI 從捕獲的流量中提取多種信號家族。所有信號默認都已啓用；每個都可以通過 `--set ebpf.features.<key>=false` 獨立禁用：

| 信號 | 默認 | 增加的內容 |
| --- | --- | --- |
| `ebpf.features.httpMetrics` | on | 每個服務的 HTTP/gRPC RED 指標 —— 請求速率、延遲直方圖、錯誤數量。 |
| `ebpf.features.spanMetrics` | on | 以 span 屬性爲鍵的指標：請求大小、響應大小、按路由/操作細分的耗時。 |
| `ebpf.features.serviceGraph` | on | 服務間邊的指標（調用方 → 被調方的請求速率 + 延遲）。爲服務圖譜提供數據。 |
| `ebpf.features.hostMetrics` | on | 每個被埋點進程的 CPU 和內存 —— 對於基本的容量問題，可省去單獨運行性能分析器。 |
| `ebpf.features.networkMetrics` | on | 帶 k8s 元數據的 Pod 間 TCP/UDP 流字節和數據包計數器。展現每對相互通信的 Pod，包括運行 OBI 無法解析的協議的 Pod。 |
| `ebpf.features.networkInterZoneMetrics` | off | 網絡指標的跨可用區版本。基數會加倍；只有在確實使用基於可用區調度時才值得啓用。 |
| `ebpf.features.tcpStats` | on | 節點級 TCP 統計信息：RTT 直方圖、失敗連接數、重傳次數。 |

OBI 默認還會跨服務邊界傳播追蹤上下文。當 pod A 向 pod B 發起 HTTP/gRPC 請求時，OBI 會向出站請求注入 W3C `traceparent` 頭 —— 這樣 pod B 端生成的 span 就會與 pod A 的出站 span 鏈接到同一個 trace。兩端應用都不需要修改 SDK。

| 選項 | 默認 | 描述 |
| --- | --- | --- |
| `ebpf.contextPropagation` | on | 向出站流量注入 W3C `traceparent`（HTTP 頭 + 自定義 TCP 選項）。設爲 `false` 可讓每個服務的 span 保持本地。 |
| `ebpf.trackRequestHeaders` | on | 內核側的請求頭跟蹤，使傳播在普通 HTTP 服務器（非 Go、非 TLS）上也能工作。僅在 `contextPropagation` 爲 true 時生效。 |

### 日誌 ↔ 追蹤關聯

默認也啓用。OBI 的日誌增強器攔截被埋點進程的 Pod stdout 寫入，並：

- 對於 **JSON 格式日誌**：向日志行中注入 `trace_id` 和 `span_id` 字段（日誌中任何已有的值都會被保留）。然後 filelog DaemonSet 將這些字段提升到 LogRecord 的原生 trace_id/span_id 槽位，因此在追蹤視圖中點擊某個 span 即可跳轉到 OneUptime 中的對應日誌 —— 反之，點擊某條日誌行就可以跳到其父 trace。
- 對於 **非 JSON 日誌**：日誌行保持原樣 —— 仍然會被採集，但不會自動關聯。

| 選項 | 默認 | 描述 |
| --- | --- | --- |
| `ebpf.logToTraceCorrelation` | on | 啓用 OBI 日誌增強器和 filelog 流水線的 trace_id 提升。設爲 `false` 可跳過兩者。 |

注意事項：

- **日誌必須是 JSON 格式，trace_id 纔會出現。** 將您的日誌記錄器切換爲 JSON 格式 —— `structlog`、`pino`、`winston`、`serilog`、`logback-json`、klog `--logging-format=json` 等。
- **緩衝的 stdout 會破壞關聯**，因爲 `write()` 系統調用發生在與處理請求的線程不同的線程上。常見修復方法：
  - **Python**：設置 `PYTHONUNBUFFERED=1`（運行時在非 TTY 時會對 stdout 進行塊緩衝）。
  - **.NET**：啓動時執行 `Console.SetOut(new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true })`。Microsoft.Extensions.Logging 的 `AddConsole()` 和 Serilog 的異步 sink 也不能工作 —— 請切換到同步控制台寫入器（Serilog 默認的 `WriteTo.Console()` 沒有問題）。
- Greenlet / gevent、Tornado 以及其他自定義異步運行時不在覆蓋範圍內。

### 調優

| 選項 | 默認 | 描述 |
| --- | --- | --- |
| `ebpf.enabled` | `true` | 總開關。設爲 `false` 可完全跳過 eBPF DaemonSet。 |
| `ebpf.image.tag` | `v0.9.0` | OBI 鏡像標籤。OBI 仍處於 1.0 之前；請固定到一個已知良好的版本，並在升級時重新測試。 |
| `ebpf.autoTargetExe` | `*` | 要進行埋點的可執行文件 glob 模式。如果想縮小自動埋點範圍（例如 `*/python,*/java`），請收窄此項。 |
| `ebpf.excludeExePaths` | （shell、kubelet、runc、containerd、otelcol、OBI 自身） | 要跳過的逗號分隔 glob 模式。 |
| `ebpf.logLevel` | `info` | `debug`、`info`、`warn` 或 `error`。排查問題時設爲 `debug`。 |
| `ebpf.printTraces` | `false` | 除 OTLP 導出外還將 span 打印到 OBI 的 stdout —— 在安裝期間驗證捕獲很有用。 |
| `ebpf.resources.*` | requests `100m / 256Mi`、limits `1000m / 1Gi` | 對於高流量集羣可調大。 |

要檢查 OBI 是否正在運行並看到流量：

```bash
kubectl get pods -n oneuptime-kubernetes-agent -l component=ebpf-instrument
kubectl logs -n oneuptime-kubernetes-agent -l component=ebpf-instrument --tail=200
```

## 持續 CPU 性能分析（默認禁用）

另一個獨立的 DaemonSet 運行 [OpenTelemetry eBPF Profiler](https://github.com/open-telemetry/opentelemetry-ebpf-profiler) —— 以 `otel/opentelemetry-collector-ebpf-profiler` 鏡像形式打包。它以 19Hz 在所有支持的運行時（Go、Java、.NET、Python、Ruby、Node.js、PHP、Perl、C/C++、Rust）上採樣 on-CPU 調用棧，並將 OTLP profile 發送到 OneUptime，您可以在 **Telemetry → Performance Profiles** 中以及從單個 trace span 鏈接的火焰圖中看到這些數據。

性能分析**默認禁用** —— 它比 OBI 自動埋點更耗資源（每個節點的 CPU 佔用更多，內存佔用更大），並非每個集羣都希望始終開啓火焰圖。當您需要更豐富的遙測數據時再啓用它：`--set profiling.enabled=true`。

當 eBPF 自動埋點也啓用時（`ebpf.enabled: true`，即默認值），每個 CPU 採樣都會通過共享的 bpffs map 與 OBI 的追蹤上下文相關聯 —— 因此火焰圖會攜帶 trace_id/span_id，OneUptime UI 可以爲您展示每個 span 的火焰圖。

要求：

- **Linux 內核 5.10+**（比 OBI 需要的 5.8 稍新）。
- 帶有 hostPID 的特權 Pod —— 與 eBPF 自動埋點 DaemonSet 的限制相同。無法在 GKE Autopilot、EKS Fargate 或其他受鎖定的環境中運行。

調優：

| 選項 | 默認 | 描述 |
| --- | --- | --- |
| `profiling.enabled` | `false` | 總開關。默認禁用；如需持續 CPU 火焰圖請選擇啓用。 |
| `profiling.image.tag` | `0.152.0` | `otel/opentelemetry-collector-ebpf-profiler` 鏡像標籤。性能分析器仍處於 1.0 之前；請固定到已知良好的版本。 |
| `profiling.samplesPerSecond` | `19` | 採樣頻率（Hz）。上游默認值；避免與常見定時器頻率意外混疊。 |
| `profiling.offCpuThreshold` | `0` | (0–1] 啓用 off-CPU 分析 —— 用於診斷鎖競爭和阻塞 I/O。默認關閉，因爲它會增加 tracepoint 開銷。 |
| `profiling.tracers` | `""` *(所有運行時)* | 要加載的語言追蹤器的逗號分隔列表。 |
| `profiling.obiProcessContext` | `true` | 將採樣與 OBI 的追蹤上下文相關聯，以實現追蹤 ↔ 性能分析的關聯。 |

## 其他數據採集（host metrics、飽和度指標、cAdvisor、KSM、審計日誌、CSI、CoreDNS）

chart 還可以採集：

| `<key>.enabled` | 默認 | 增加的內容 |
| --- | --- | --- |
| `hostMetrics` | on | 來自 `/proc` 和 `/sys` 的每節點操作系統指標 —— 磁盤 I/O 隊列深度、文件系統 inode 使用率、NIC 錯誤計數、分頁統計、負載平均值。位於日誌收集器 DaemonSet 內（不增加額外 Pod）。 |
| `kubeletstats.utilizationMetrics` | on | 飽和度指標 —— 容器和 Pod 的 CPU/內存以佔 request 和 limit 的百分比表示。八個派生指標家族，爲 "CPU/Memory vs Request" 和 "CPU/Memory vs Limit" 監控器提供數據。與現有的 `kubeletstats` receiver 共用同一次抓取，不增加額外 Pod。當 Pod 未設置 request/limit 時始終爲 0。 |
| `kubeletstats.volumeMetrics` | on | 每個 PVC 的磁盤使用情況（`k8s.volume.available`、`k8s.volume.capacity`）。爲 "PVC Low Disk Space" 監控器提供數據。每個 Pod 的每個 PVC 一條 series —— 對大多數集羣是有界的，對擁有數千個 PVC 的有狀態工作負載則更重。 |
| `cadvisor` | on | 從每個節點的 DaemonSet Pod 抓取 kubelet 的 `/metrics/cadvisor` 端點，獲取 `kubeletstats` 不會翻譯的容器指標：CFS 節流（`container_cpu_cfs_throttled_seconds_total`、`container_cpu_cfs_periods_total`）和 OOM 終止事件（`container_oom_events_total`）。一個 relabel 白名單會在 receiver 端丟棄其他所有內容，使基數保持有界。 |
| `kubeStateMetrics` | off | 從 kube-state-metrics 拉取集羣狀態指標：Pod 階段（Pending / Terminating）、容器等待原因（CrashLoopBackOff、ImagePullBackOff）以及資源配額使用情況。`mode: bundled`（默認）會爲您部署一個小型 KSM Deployment；`mode: external` 則通過 `endpoint` 抓取已有的 KSM。默認關閉，因爲 bundled 模式會爲 chart 增加一個 Deployment 的佔用。 |
| `auditLogs` | off | 從主機讀取 `/var/log/kubernetes/audit.log`。捕獲每一個 Kubernetes API 請求 —— 誰對哪個資源執行了什麼操作。僅適用於自管集羣 —— 託管 K8s（EKS、GKE、AKS、DOKS）會將審計日誌路由到雲提供商的接收端。 |
| `csi` | off | 自動發現帶有標籤 `app=csi-driver`（或 `app.kubernetes.io/component=csi-driver`）的 Pod，並抓取其 Prometheus `metrics` 端口 —— 卷掛載/卸載延遲、配置失敗、IOPS。 |
| `coreDns` | off | 在 `:9153/metrics` 上抓取集羣的 CoreDNS 服務。展現查詢速率、延遲、緩存命中率、錯誤數量 —— 這些是 P99 延遲的常見原因。 |

## 常用選項

| 選項 | 默認 | 描述 |
| --- | --- | --- |
| `preset` | （空 —— 視爲 `standard`） | 見上表。 |
| `oneuptime.url` | *(必填)* | OneUptime 實例的 URL。 |
| `oneuptime.apiKey` | *(必填)* | 項目 API 密鑰（Settings → API Keys）。 |
| `clusterName` | *(必填)* | 此集羣的唯一名稱。會作爲 `k8s.cluster.name` 打到每條記錄上。 |
| `namespaceFilters.include` | `[]` | 如果設置，則僅監控這些命名空間。 |
| `namespaceFilters.exclude` | `["kube-system"]` | 要跳過的命名空間。 |
| `logs.enabled` | `true` | 啓用或禁用日誌採集。 |
| `logs.mode` | （從 `preset` 派生） | `daemonset`、`api` 或 `disabled`。會覆蓋預設。 |
| `logs.api.replicas` | `1` | 日誌收集器 Deployment 的副本數（僅在 API 模式下）。 |
| `ebpf.enabled` | `true` | 通過 OpenTelemetry eBPF Instrumentation 自動捕獲每個 Pod 的 HTTP/gRPC 追蹤。請參閱上文章節。 |
| `profiling.enabled` | `false` | 通過 OpenTelemetry eBPF Profiler 持續生成 CPU 火焰圖。默認禁用；如需更多遙測數據請選擇啓用。請參閱上文章節。 |
| `hostMetrics.enabled` | `true` | 每個節點的操作系統指標。 |
| `kubeletstats.utilizationMetrics.enabled` | `true` | 容器和 Pod 的 CPU/內存飽和度（佔 request 和 limit 的百分比）。不增加額外抓取 —— 從 kubeletstats 數據派生。 |
| `kubeletstats.volumeMetrics.enabled` | `true` | 每個 PVC 的磁盤使用情況（`k8s.volume.available`、`k8s.volume.capacity`）。 |
| `cadvisor.enabled` | `true` | 抓取本節點 kubelet 的 `/metrics/cadvisor`，獲取 CFS 節流 + OOM 終止計數器。已通過白名單限定爲 3 個指標。 |
| `kubeStateMetrics.enabled` | `false` | 從 kube-state-metrics 拉取 Pod 階段、容器等待原因（CrashLoopBackOff / ImagePullBackOff）以及 ResourceQuota 使用情況。bundled 與 external 模式的區別參見 `kubeStateMetrics.mode`。 |
| `auditLogs.enabled` | `false` | Kubernetes 審計日誌採集（自管集羣）。 |
| `csi.enabled` | `false` | CSI 驅動的 Prometheus 指標。 |
| `coreDns.enabled` | `false` | CoreDNS 的 Prometheus 指標。 |
| `controlPlane.enabled` | `false` | 抓取 etcd / api-server / scheduler / controller-manager。僅適用於自管集羣 —— 託管產品（EKS/GKE/AKS）通常不暴露這些端點。 |

查看 [chart 的 `values.yaml`](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/kubernetes-agent/values.yaml) 獲取完整列表。

## 升級

```bash
helm repo update
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values
```

`--reuse-values` 會保留您現有的配置；任何新增的 `--set` 覆蓋項可以在其之上傳入。

> **請注意：`--reuse-values` 不會合並 chart 的新默認值。** Helm 會原樣複用您先前渲染的值 —— 因此較新 chart 版本中新增的任何頂層字段（例如 `profiling.*`、`ebpf.features.*`）在您現有的 release 中仍然未設置，模板渲染時就好像您禁用了它一樣。
>
> **Helm 3.14+** —— 切換到 `--reset-then-reuse-values`。它會爲您未覆蓋的鍵重新讀取 chart 默認值：
>
> ```bash
> helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
>   --namespace oneuptime-kubernetes-agent \
>   --reset-then-reuse-values
> ```
>
> **Helm 3.13 或更早版本** —— 去掉 `--reuse-values`，顯式傳入原始的 `--set` 標誌（或 `-f values.yaml`）。對於您未覆蓋的所有項，將會應用新的 chart 默認值。
>
> 如果升級後某項新功能的 Pod（例如 `kubernetes-agent-profiling-*`）沒有出現，幾乎總是因爲這個原因。`helm get values <release>` 顯示 Helm 實際持有的內容 —— 輸出中缺失的字段意味着沒有爲它們合併默認值。

## 卸載

```bash
helm uninstall oneuptime-agent --namespace oneuptime-kubernetes-agent
kubectl delete namespace oneuptime-kubernetes-agent
```

## 故障排查

### 安裝失敗，提示 "hostPath volumes are not allowed"

您的集羣禁用了 hostPath。請切換到 API 模式的預設：

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values \
  --set preset=gke-autopilot   # or eks-fargate
```

### OneUptime 中看不到日誌

檢查代理 Pod：

```bash
kubectl get pods -n oneuptime-kubernetes-agent
kubectl logs -n oneuptime-kubernetes-agent -l app.kubernetes.io/part-of=oneuptime --tail=200
```

在 API 模式下，日誌收集器 Pod 在 13133 端口上暴露 `/healthz` —— 通過 `kubectl port-forward` 訪問它可以獲取導出狀態快照。

### eBPF DaemonSet Pod 處於 `CrashLoopBackOff` 或無法啓動

檢查 OBI Pod 的日誌：

```bash
kubectl logs -n oneuptime-kubernetes-agent -l component=ebpf-instrument --tail=200
```

常見原因：

- **內核太舊或缺少 BTF。** OBI 需要帶有 BTF 的 Linux 5.8+。在節點上用 `uname -r` 檢查。如果無法升級，請禁用 eBPF：`--set ebpf.enabled=false`。
- **特權 Pod 被阻止。** 某些集羣即使不是 Autopilot/Fargate 也會拒絕特權 Pod。請禁用 eBPF。
- **OBI 正在運行但儀表板中沒有追蹤。** 設置 `--set ebpf.printTraces=true` 並查看 OBI 的 stdout —— 如果您在那裏看到了 span，那麼問題在於 OTLP 投遞（請檢查 `OTEL_EXPORTER_OTLP_ENDPOINT` 以及您的 OneUptime URL/API key）。如果看不到 span，則 OBI 監視的流量可能全部被 OBI 無法攔截的 TLS 庫加密（例如它無法識別的靜態鏈接 TLS 實現）。

### 我的集羣對一個日誌收集器副本來說 Pod 太多了（僅 API 模式）

通過對命名空間分片來橫向擴展。爲每個命名空間組部署一次：

```bash
helm install oneuptime-agent-ns-a oneuptime/kubernetes-agent \
  --set preset=gke-autopilot \
  --set namespaceFilters.include={app-a,app-b} \
  ...
```

或者，調大 `logs.api.replicas` —— 但請注意每個副本都會處理所有被允許的命名空間，因此爲了去重您仍然需要按命名空間分片。
