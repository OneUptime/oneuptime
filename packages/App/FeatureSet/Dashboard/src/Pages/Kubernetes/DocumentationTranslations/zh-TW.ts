import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Kubernetes setup guide in Traditional Chinese (#8341): each piece of the English
 * guide's markdown (Pages/Kubernetes/Utils/DocumentationMarkdown.ts) and its
 * Traditional Chinese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Traditional Chinese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A Kubernetes cluster running v1.23 or later":
    "執行 v1.23 或更新版本的 Kubernetes 叢集",
  "`kubectl` and `helm` (v3) installed on your machine":
    "你的電腦上已安裝 `kubectl` 和 `helm`（v3）",
  "Wrong cluster? Switch with `kubectl config use-context <context-name>`.":
    "叢集不對？用 `kubectl config use-context <context-name>` 切換。",
  "Replace `my-cluster` with a name for this cluster, such as `prod-us-east-1`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "將 `my-cluster` 換成此叢集的名稱，例如 `prod-us-east-1`。叢集在 OneUptime 中就以此名稱顯示，所以請保持不變：新名稱會註冊一個新叢集。",
  "`--set aiAgent.enabled=true` turns **AI investigations** on, as the chart does by default: OneUptime AI investigates incidents and alerts on this cluster with read-only kubectl, through the Kubernetes AI agent.":
    "`--set aiAgent.enabled=true` 會開啟 **AI 調查**，與 chart 的預設相同：OneUptime AI 會透過 Kubernetes AI 代理程式，使用唯讀 kubectl 調查此叢集上的事件與警示。",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "在第 1 步中選擇一個擷取金鑰，以填入 `<YOUR_API_KEY>`。",
  "You should see:": "你應該會看到：",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "收集器與 Kubernetes AI 代理程式，以及每個節點上各一個 `-logs` 和 `-ebpf` Pod。它們變成 `Running` 後，叢集會自動出現在 **Kubernetes** 區段，通常在一兩分鐘內。",
  "**Kubernetes AI agent (on by default, read-only).** The `kubernetes-agent-ai-agent` pod lets OneUptime AI investigate incidents and alerts on this cluster with read-only kubectl — `get`, `describe`, `logs`, `events`, `top` — using the same API key, and it can change nothing unless you give it write access later. Open the cluster and go to **AI → Agent** to see it. Don't want it? Install with `--set aiAgent.enabled=false` instead of `--set aiAgent.enabled=true`.":
    "**Kubernetes AI 代理程式（預設開啟，唯讀）。** `kubernetes-agent-ai-agent` Pod 讓 OneUptime AI 使用相同的 API 金鑰，以唯讀 kubectl（`get`、`describe`、`logs`、`events`、`top`）調查此叢集上的事件與警示；除非你之後授予它寫入權限，否則它無法變更任何內容。開啟叢集並前往 **人工智慧 → 代理程式** 即可看到它。不需要它？安裝時以 `--set aiAgent.enabled=false` 取代 `--set aiAgent.enabled=true`。",
  "Namespace rules decide what the agent collects from each namespace. To collect pod logs and eBPF data only from `default`, `production` and `staging`:":
    "命名空間規則決定代理程式從每個命名空間收集什麼。若只從 `default`、`production` 和 `staging` 收集 Pod 日誌與 eBPF 資料：",
  "To keep everything but stop the logs of noisy namespaces, exclude them from `podLogs` only:":
    "若要保留全部內容，只停止吵雜命名空間的日誌，請只將它們從 `podLogs` 排除：",
  "- **Scopes:** `podLogs` (container stdout/stderr), `ebpfDiscovery` (eBPF traces and metrics), `metrics` (namespaced metrics) and `traces` (every span).":
    "- **範圍：** `podLogs`（容器的 stdout/stderr）、`ebpfDiscovery`（eBPF 追蹤與指標）、`metrics`（含命名空間的指標）和 `traces`（所有 span）。",
  "- **Patterns** match the whole namespace name and accept `*`, as in `team-*`. An `exclude` rule always wins over an `include` rule.":
    "- **模式** 會比對完整的命名空間名稱，並接受 `*`，例如 `team-*`。`exclude` 規則一律優先於 `include` 規則。",
  "- **Setting the rules replaces the default one**, which excludes `kube-system` from `podLogs` and `ebpfDiscovery`. Keep it in your list, as in the second example, if you still want that.":
    "- **設定規則會取代預設規則**，預設規則會將 `kube-system` 排除在 `podLogs` 和 `ebpfDiscovery` 之外。如果仍需要它，請像第二個範例那樣把它留在清單中。",
  "- Node and cluster metrics have no namespace, so they are always kept.":
    "- 節點與叢集指標沒有命名空間，因此一律保留。",
  "- `--set-json` needs Helm 3.10 or later.":
    "- `--set-json` 需要 Helm 3.10 或更新版本。",
  "**Only send important lines.** Drop pod log lines below a severity before they leave the cluster:":
    "**只傳送重要的日誌行。** 在 Pod 日誌行離開叢集之前，捨棄低於某個嚴重性的行：",
  'Accepts `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` and `FATAL`: `WARN` keeps warnings, errors and fatal lines. The severity is read from the log line itself (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes events are never dropped by this.':
    '接受 `TRACE`、`DEBUG`、`INFO`、`WARN`、`ERROR` 和 `FATAL`：`WARN` 會保留警告、錯誤與嚴重錯誤的行。嚴重性從日誌行本身讀取（`[ERROR]`、`level=warn`、`"level":"info"`）。Kubernetes 事件永遠不會因此被捨棄。',
  "**Turn pod logs off.** Metrics are not affected — the node collector keeps running for kubelet and cAdvisor metrics, it just stops reading pod logs:":
    "**關閉 Pod 日誌。** 指標不受影響：節點收集器會繼續執行以收集 kubelet 和 cAdvisor 指標，只是不再讀取 Pod 日誌：",
  "**Change how logs are read.** The preset picks this for you; an explicit `logs.mode` always wins over it:":
    "**變更日誌的讀取方式。** 預設集會替你選擇；明確指定的 `logs.mode` 一律優先：",
  "- `logs.mode=daemonset` — reads `/var/log/pods` on every node through hostPath (lowest overhead; needs hostPath).":
    "- `logs.mode=daemonset`：透過 hostPath 讀取每個節點上的 `/var/log/pods`（負擔最低；需要 hostPath）。",
  "- `logs.mode=api` — a Deployment tails pod logs through the Kubernetes API (works on any cluster).":
    "- `logs.mode=api`：由一個 Deployment 透過 Kubernetes API 追蹤 Pod 日誌（適用於任何叢集）。",
  "- `logs.mode=disabled` — no pod logs.":
    "- `logs.mode=disabled`：不收集 Pod 日誌。",
  "That reads the API server, where it answers inside the cluster. etcd, the scheduler and the controller manager answer on the control-plane nodes, which the agent's pod cannot guess, so it reads them once you list each node's address:":
    "這會讀取 API 伺服器，也就是它在叢集內回應的地方。etcd、排程器和控制器管理員在控制平面節點上回應，代理程式的 Pod 無法猜出這些節點，所以只要你列出每個節點的位址，它就會讀取它們：",
  "- **The scheduler and the controller manager** serve HTTPS and accept the agent's token, but kubeadm binds them to `127.0.0.1`: give them a `--bind-address` the agent's pod can reach.":
    "- **排程器和控制器管理員** 提供 HTTPS 並接受代理程式的權杖，但 kubeadm 會把它們繫結到 `127.0.0.1`：請給它們一個代理程式的 Pod 能連到的 `--bind-address`。",
  "- **etcd** serves its metrics in plain HTTP on kubeadm's `--listen-metrics-urls` (port 2381, bound to `127.0.0.1` until you add the node's address), as above. Or scrape its HTTPS client port, 2379, with the client certificate it asks for: put `ca.crt`, `tls.crt` and `tls.key` in a Secret in `oneuptime-agent` and name it in `controlPlane.etcd.clientCertSecret`.":
    "- **etcd** 如上所述，在 kubeadm 的 `--listen-metrics-urls`（連接埠 2381，在你加入節點位址之前繫結到 `127.0.0.1`）以純 HTTP 提供指標。也可以用它要求的用戶端憑證抓取它的 HTTPS 用戶端連接埠 2379：把 `ca.crt`、`tls.crt` 和 `tls.key` 放進 `oneuptime-agent` 中的一個 Secret，並在 `controlPlane.etcd.clientCertSecret` 中指定它。",
  "Only for self-managed clusters: managed services (EKS, GKE, AKS) do not expose their control plane metrics.":
    "僅適用於自行管理的叢集：受控服務（EKS、GKE、AKS）不會公開其控制平面指標。",
  "Cost monitoring is on by default: the agent bundles the open-source OpenCost engine (plus the small Prometheus it needs), prices your nodes and volumes from your cloud provider's public list prices — no credentials required — and sends what each namespace and workload costs. The first data appears on the cluster's overview and Costs page after the first full hour.":
    "成本監控預設為開啟：代理程式內建開放原始碼的 OpenCost 引擎（以及它需要的小型 Prometheus），依雲端供應商公開的牌價為你的節點與磁碟區定價，不需要憑證，並傳送每個命名空間與工作負載的成本。第一個完整小時過後，叢集的概覽與「成本」頁面會出現第一批資料。",
  "On an agent installed before it was on by default, upgrade it:":
    "對於在預設開啟之前安裝的代理程式，請升級它：",
  "- **Turn it off:** add `--set cost.enabled=false` to the same upgrade.":
    "- **關閉它：** 在同一次升級中加入 `--set cost.enabled=false`。",
  "Cost monitoring is off by default on this platform: it bills every pod by what it requests, so the three cost pods would add to your bill, and OpenCost prices nodes rather than pods. To turn it on anyway:":
    "此平台上的成本監控預設為關閉：此平台依每個 Pod 要求的資源計費，因此開啟後這三個成本 Pod 會增加你的帳單，而且 OpenCost 是依節點而非依 Pod 定價。若仍要開啟：",
  "That alone is a complete install: the chart bundles the open-source OpenCost engine (plus the small Prometheus it needs) and prices your nodes and volumes from your cloud provider's public list prices — no credentials required. It adds three small pods; the first data appears after the first full hour.":
    "光是這樣就是完整的安裝：chart 內建開放原始碼的 OpenCost 引擎（以及它需要的小型 Prometheus），並依雲端供應商公開的牌價為你的節點與磁碟區定價，不需要憑證。它會加入三個小型 Pod；第一個完整小時過後會出現第一批資料。",
  "- **Already running Kubecost or OpenCost?** The agent finds it and reads it instead of the bundled engine, and the cluster's overview says so: add `--set cost.engine.url=auto` to stop bundling a second one.":
    "- **已經在執行 Kubecost 或 OpenCost？** 代理程式會找到它並讀取它，而不是內建的引擎，叢集的概覽也會說明這一點：加入 `--set cost.engine.url=auto`，即可不再內建第二個引擎。",
  "- **On-prem or bare metal?** Set a rate card with `--set cost.opencost.customPricing.enabled=true` (USD per resource-hour — see the chart's `values.yaml`).":
    "- **地端或裸機？** 用 `--set cost.opencost.customPricing.enabled=true` 設定費率表（每資源小時的美元價格；請參閱 chart 的 `values.yaml`）。",
  "Full guide: [Kubernetes Cost Observability](/docs/telemetry/kubernetes-cost).":
    "完整指南：[Kubernetes 成本可觀測性](/docs/telemetry/kubernetes-cost)。",
  "The agent runs [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) on every node. It captures HTTP/HTTPS, gRPC and SQL/Redis traffic from Go, .NET, Java, Node.js, Python, Ruby and Rust services — no SDK and no sidecar — and ships traces, request (RED) metrics and service-graph data through the collector.":
    "代理程式在每個節點上執行 [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/)。它不需要 SDK 或 sidecar，就能擷取 Go、.NET、Java、Node.js、Python、Ruby 和 Rust 服務的 HTTP/HTTPS、gRPC 與 SQL/Redis 流量，並透過收集器傳送追蹤、要求（RED）指標與服務圖資料。",
  "**Requirements:** Linux kernel **5.8+** with BTF (the default on Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). The eBPF pods run **privileged**, which they need to load eBPF programs.":
    "**要求：** 具備 BTF 的 Linux 核心 **5.8+**（Debian 11+、Ubuntu 20.10+、Fedora 34+、RHEL 9+ 的預設）。eBPF Pod 以 **特權** 模式執行，這是載入 eBPF 程式所必需的。",
  "**Turn it off** if your nodes run an older kernel, if privileged pods are not allowed, or if your services already send traces with OpenTelemetry SDKs and you don't want duplicates:":
    "如果你的節點執行較舊的核心、不允許特權 Pod，或是你的服務已經用 OpenTelemetry SDK 傳送追蹤而你不想要重複資料，請 **關閉它**：",
  "**Choose the signals.** Each family is switched with `--set ebpf.features.<name>=false` (or `=true`):":
    "**選擇訊號。** 每個系列都用 `--set ebpf.features.<name>=false`（或 `=true`）切換：",
  "| `ebpf.features.*` | Default | What it adds |":
    "| `ebpf.features.*` | 預設 | 新增的內容 |",
  "| `httpMetrics` | on | HTTP/gRPC request rate, errors and latency per service |":
    "| `httpMetrics` | 開 | 每個服務的 HTTP/gRPC 要求速率、錯誤與延遲 |",
  "| `spanMetrics` | on | Span call count and duration (`traces.span.metrics.*`) |":
    "| `spanMetrics` | 開 | span 的呼叫次數與持續時間（`traces.span.metrics.*`） |",
  "| `serviceGraph` | on | Caller → callee edges; drives the service map |":
    "| `serviceGraph` | 開 | 呼叫端 → 被呼叫端的邊；驅動服務地圖 |",
  "| `networkMetrics` | on | Pod-to-pod TCP/UDP flow counters |":
    "| `networkMetrics` | 開 | Pod 之間的 TCP/UDP 流量計數器 |",
  "| `networkInterZoneMetrics` | off | Inter-zone network metrics (doubles their cardinality) |":
    "| `networkInterZoneMetrics` | 關 | 跨區域的網路指標（會使其基數加倍） |",
  "| `tcpStats` | on | Node-level TCP RTT, failed-connection and retransmit counters |":
    "| `tcpStats` | 開 | 節點層級的 TCP RTT、連線失敗與重傳計數器 |",
  "**Cross-service trace propagation** — linking a request that crosses pod A → pod B into a single trace, on another node too — is **on by default**. It works by rewriting traffic that is already in flight (widening plaintext HTTP requests in the kernel, and appending a TCP option to TLS and raw TCP), and a mistake in that byte accounting desynchronizes the stream — the reported symptom is transfers through an L7 proxy such as nginx hanging once a response passes ~64KB. If you see that, or a service mesh starts failing pods, turn it off with `--set ebpf.contextPropagation=false`; an OpenTelemetry SDK propagates `traceparent` in userspace without any of that.":
    "**跨服務追蹤傳播**（把從 Pod A → Pod B 的要求串成一條追蹤，即使在另一個節點上也一樣）**預設開啟**。它透過改寫正在傳輸的流量來運作（在核心中擴充純文字 HTTP 要求，並為 TLS 與原始 TCP 附加一個 TCP 選項），而這種位元組計算一旦出錯就會讓資料流失去同步：已回報的症狀是經過 nginx 等 L7 代理的傳輸在回應超過 ~64KB 時卡住。如果你遇到這種情況，或服務網格開始讓 Pod 失敗，請用 `--set ebpf.contextPropagation=false` 關閉它；OpenTelemetry SDK 會在使用者空間傳播 `traceparent`，不需要這些動作。",
  "Each `oneuptime.labels.<key>=<value>` becomes the label `<key>:<value>` on the cluster, and on the services and hosts it reports. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "每個 `oneuptime.labels.<key>=<value>` 都會成為叢集及其回報之服務與主機上的標籤 `<key>:<value>`。標籤比對不區分大小寫，因此會重複使用現有的 `Production` 標籤；在 OneUptime 介面中新增的標籤絕不會被代理程式移除。",
  "**Upgrade** to the latest chart. `--reset-then-reuse-values` (Helm 3.14+) keeps the values you set (preset, cluster name, filters) and takes everything else from the new chart; add any new `--set` flags on top of it:":
    "**升級** 到最新的 chart。`--reset-then-reuse-values`（Helm 3.14+）會保留你設定的值（預設集、叢集名稱、篩選條件），其餘全部採用新 chart 的值；在此之上加入任何新的 `--set` 旗標：",
  "On Helm 3.13 and earlier, upgrade with the values you set instead:":
    "在 Helm 3.13 及更早版本中，請改用你設定的值進行升級：",
  "Don't use `--reuse-values`: it also keeps the defaults of the chart you upgrade from, so a newer chart's defaults (its eBPF image among them) never apply.":
    "請勿使用 `--reuse-values`：它也會保留你升級前那個 chart 的預設值，導致較新 chart 的預設值（包括其 eBPF 映像檔）永遠不會生效。",
  "**Uninstall** the agent and its namespace:":
    "**解除安裝** 代理程式及其命名空間：",
  "| Category | Data |": "| 類別 | 資料 |",
  "| **Node metrics** | CPU, memory, filesystem and network usage |":
    "| **節點指標** | CPU、記憶體、檔案系統與網路使用量 |",
  "| **Pod and container metrics** | CPU, memory, network I/O and restarts |":
    "| **Pod 與容器指標** | CPU、記憶體、網路 I/O 與重新啟動次數 |",
  "| **Cluster metrics** | Node conditions, allocatable resources, pod and workload counts |":
    "| **叢集指標** | 節點狀況、可配置資源、Pod 與工作負載數量 |",
  "| **Kubernetes events** | Warnings, errors and scheduling events |":
    "| **Kubernetes 事件** | 警告、錯誤與排程事件 |",
  "| **Pod logs** | stdout/stderr of every container, read from each node |":
    "| **Pod 日誌** | 每個容器的 stdout/stderr，在各個節點上讀取 |",
  "| **Application traces** *(eBPF)* | HTTP, gRPC and SQL/Redis spans from every pod — no SDK or code changes |":
    "| **應用程式追蹤** *(eBPF)* | 來自每個 Pod 的 HTTP、gRPC 與 SQL/Redis span，不需要 SDK 或程式碼變更 |",
  "| **Request metrics and service graph** *(eBPF)* | Request rate, errors and latency per service, and caller → callee edges for the service map |":
    "| **要求指標與服務圖** *(eBPF)* | 每個服務的要求速率、錯誤與延遲，以及服務地圖所用的呼叫端 → 被呼叫端的邊 |",
  "| **Network flows** *(eBPF)* | Pod-to-pod TCP/UDP byte and packet counters |":
    "| **網路流量** *(eBPF)* | Pod 之間的 TCP/UDP 位元組與封包計數器 |",
  "| **Workload costs** *(opt-in, `cost.enabled=true`)* | Spend per namespace, workload and pod, with idle capacity and efficiency |":
    "| **工作負載成本** *(選用，`cost.enabled=true`)* | 每個命名空間、工作負載與 Pod 的支出，以及閒置容量與效率 |",
  "| **Workload costs** *(on by default)* | Spend per namespace, workload and pod, with idle capacity and efficiency, also as metrics to alert on |":
    "| **工作負載成本** *(預設開啟)* | 每個命名空間、工作負載與 Pod 的支出，以及閒置容量與效率，也以可設定警示的指標形式提供 |",
  "Your cluster blocks `hostPath` volumes or privileged pods. That is normal on **GKE Autopilot** and **EKS Fargate** — pick that platform at the top of this guide and follow its steps. On **OpenShift** the install succeeds instead, but the agent's node pods never start: pick **Red Hat OpenShift**.":
    "你的叢集封鎖了 `hostPath` 磁碟區或特權 Pod。這在 **GKE Autopilot** 和 **EKS Fargate** 上很正常：請在本指南頂端選擇該平台，並依照它的步驟操作。而在 **OpenShift** 上，安裝會成功，但代理程式的節點 Pod 永遠不會啟動：請選擇 **Red Hat OpenShift**。",
  "On any other cluster with a restrictive Pod Security policy, remove the failed release:":
    "在任何其他採用嚴格 Pod Security 原則的叢集上，請移除失敗的 release：",
  "Then run the install command again with `--set preset=gke-autopilot` added. That preset reads pod logs through the Kubernetes API instead of hostPath, applies a hardened security context, and leaves out the privileged eBPF and profiling pods.":
    "接著加上 `--set preset=gke-autopilot`，再次執行安裝命令。這個預設集會透過 Kubernetes API 而非 hostPath 讀取 Pod 日誌，套用強化的安全性內容，並排除需要特權的 eBPF 與效能分析 Pod。",
  "1. Check that the agent's pods are running: `kubectl get pods -n oneuptime-agent`":
    "1. 檢查代理程式的 Pod 是否正在執行：`kubectl get pods -n oneuptime-agent`",
  "2. Check the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "2. 檢查收集器的日誌：`kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "3. Verify the OneUptime URL and ingestion key in the install command are correct.":
    "3. 確認安裝命令中的 OneUptime URL 與擷取金鑰正確。",
  "4. Make sure the cluster can reach your OneUptime instance over the network.":
    "4. 確定叢集能透過網路連到你的 OneUptime 執行個體。",
  "1. Check the AI agent's pod: `kubectl get pods -n oneuptime-agent -l component=ai-agent`":
    "1. 檢查 AI 代理程式的 Pod：`kubectl get pods -n oneuptime-agent -l component=ai-agent`",
  "2. Check its logs: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`":
    "2. 檢查它的日誌：`kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`",
  "3. No pod? Upgrade the chart (see **Upgrade or uninstall the agent** under Advanced) and add `--set aiAgent.enabled=true`.":
    "3. 沒有 Pod？升級 chart（請參閱「進階」中的 **升級或解除安裝代理程式**），並加入 `--set aiAgent.enabled=true`。",
  "1. Check that the cluster name matches: this guide installs **`my-cluster`**.":
    "1. 檢查叢集名稱是否一致：本指南安裝的是 **`my-cluster`**。",
  "2. Verify the agent's RBAC permissions: `kubectl get clusterrolebinding | grep kubernetes-agent`":
    "2. 確認代理程式的 RBAC 權限：`kubectl get clusterrolebinding | grep kubernetes-agent`",
  "3. Look for export errors in the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. 在收集器的日誌中尋找匯出錯誤：`kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "- **Kernel too old or no BTF.** eBPF needs Linux 5.8+ with BTF — check with `uname -r` on a node. If you can't upgrade, turn eBPF off with `--set ebpf.enabled=false`.":
    "- **核心太舊或沒有 BTF。** eBPF 需要具備 BTF 的 Linux 5.8+；請在節點上用 `uname -r` 檢查。如果無法升級，請用 `--set ebpf.enabled=false` 關閉 eBPF。",
  "- **Privileged pods blocked.** Some locked-down clusters reject them. Turn eBPF off.":
    "- **特權 Pod 遭封鎖。** 有些嚴格鎖定的叢集會拒絕它們。請關閉 eBPF。",
  "- **`debugfs` / `tracefs` not available on the host.** Turn off just the TCP stats family: `--set ebpf.features.tcpStats=false`.":
    "- **主機上沒有 `debugfs` / `tracefs`。** 只關閉 TCP 統計系列：`--set ebpf.features.tcpStats=false`。",
  "1. Check the eBPF pods are healthy: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`":
    "1. 檢查 eBPF Pod 是否正常：`kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`",
  "2. Turn on OBI's debug output to confirm it sees traffic: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, then read `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.":
    "2. 開啟 OBI 的偵錯輸出，確認它看得到流量：`--set ebpf.printTraces=true --set ebpf.logLevel=debug`，然後閱讀 `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`。",
  "3. If spans show up there but not in OneUptime, check the collector's logs for export errors: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. 如果 span 出現在那裡，卻沒有出現在 OneUptime 中，請在收集器的日誌中尋找匯出錯誤：`kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "This installs the agent for **`k8s-1`** — keep `clusterName` exactly as it is, or the data registers as a new cluster.":
    "這會為 **`k8s-1`** 安裝代理程式——請讓 `clusterName` 保持原樣，否則資料會註冊為一個新叢集。",
  "The AWS CLI (`aws`), signed in to the cluster's account":
    "已登入叢集所屬帳戶的 AWS CLI（`aws`）",
  "The Google Cloud CLI (`gcloud`) with the `gke-gcloud-auth-plugin` component":
    "具備 `gke-gcloud-auth-plugin` 元件的 Google Cloud CLI（`gcloud`）",
  "The Azure CLI (`az`), signed in to the cluster's subscription":
    "已登入叢集所屬訂用帳戶的 Azure CLI（`az`）",
  "OpenShift 4.11 or later, and the OpenShift CLI (`oc`) logged in with cluster-admin rights: the install creates security context constraints":
    "OpenShift 4.11 或更新版本，以及以 cluster-admin 權限登入的 OpenShift CLI（`oc`）：安裝會建立安全性內容限制",
  "The web console gives the exact command, token included: **Copy login command**, under your user name. Log in as a cluster admin: the install creates security context constraints.":
    "網頁主控台會提供包含權杖的確切命令：你的使用者名稱下方的 **Copy login command**。請以叢集管理員身分登入：安裝會建立安全性內容限制。",
  "`preset=openshift` creates two security context constraints (SCCs), one for the node collector and one for the eBPF pods, each used only by its own service account. Every other pod runs under OpenShift's default `restricted-v2`, with the user ID OpenShift assigns.":
    "`preset=openshift` 會建立兩個安全性內容限制（SCC），一個用於節點收集器，一個用於 eBPF Pod，各自只由自己的服務帳戶使用。其他所有 Pod 都在 OpenShift 預設的 `restricted-v2` 下執行，使用 OpenShift 指派的使用者 ID。",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. The `-logs` and `-ebpf` pods run under the SCCs the chart created for them: `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf` lists both. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "收集器與 Kubernetes AI 代理程式，以及每個節點上各一個 `-logs` 和 `-ebpf` Pod。`-logs` 和 `-ebpf` Pod 在 chart 為它們建立的 SCC 下執行：`kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf` 會列出這兩個。它們變成 `Running` 後，叢集會自動出現在 **Kubernetes** 區段，通常在一兩分鐘內。",
  "OpenShift admits a pod only under a security context constraint (SCC) its service account may use, and the release installs either way, so a refused pod simply never appears. Look for the refusal:":
    "OpenShift 只會在 Pod 的服務帳戶可使用的安全性內容限制（SCC）下接納 Pod，而 release 無論如何都會安裝，所以遭拒的 Pod 只是永遠不會出現。請尋找拒絕的紀錄：",
  "- **`unable to validate against any security context constraint`:** the release was installed without the openshift preset, so the chart created no SCCs. `helm get values kubernetes-agent --namespace oneuptime-agent` shows the values it was given. Add the preset:":
    "- **`unable to validate against any security context constraint`：** release 安裝時沒有使用 openshift 預設集，所以 chart 沒有建立任何 SCC。`helm get values kubernetes-agent --namespace oneuptime-agent` 會顯示它收到的值。請加入該預設集：",
  "- **The SCCs are missing:** check with `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf`. Creating them takes cluster-admin rights, so an install by anyone else fails when it gets to them.":
    "- **缺少 SCC：** 用 `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf` 檢查。建立它們需要 cluster-admin 權限，所以由其他人執行的安裝會在這一步失敗。",
  "- **`violates PodSecurity`:** the namespace's Pod Security level is stricter than the eBPF pods, which run privileged, need. Label it `pod-security.kubernetes.io/enforce=privileged`, or turn eBPF off with `--set ebpf.enabled=false`.":
    "- **`violates PodSecurity`：** 命名空間的 Pod Security 層級比以特權模式執行的 eBPF Pod 所需的更嚴格。請為它加上標籤 `pod-security.kubernetes.io/enforce=privileged`，或用 `--set ebpf.enabled=false` 關閉 eBPF。",
  "- **Your cluster admin will not add SCCs:** use the `openshift-restricted` preset. The chart then creates no SCC and every pod runs under `restricted-v2`, so pod logs come through the Kubernetes API, and there are no host metrics, eBPF traces or profiles:":
    "- **叢集管理員不願新增 SCC：** 請使用 `openshift-restricted` 預設集。這樣 chart 不會建立任何 SCC，所有 Pod 都在 `restricted-v2` 下執行，因此 Pod 日誌會透過 Kubernetes API 取得，也不會有主機指標、eBPF 追蹤或效能剖析：",
  "`preset=gke-autopilot` collects pod logs through the Kubernetes API instead of reading them from each node, and leaves out eBPF tracing and profiling, which need privileged pods that GKE Autopilot does not allow.":
    "`preset=gke-autopilot` 透過 Kubernetes API 收集 Pod 日誌，而不是在每個節點上讀取，並排除 eBPF 追蹤與效能分析，因為它們需要 GKE Autopilot 不允許的特權 Pod。",
  "The collector, the Kubernetes AI agent and the pod log reader, plus one node collector per node for kubelet metrics. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "收集器、Kubernetes AI 代理程式與 Pod 日誌讀取器，以及每個節點一個用於 kubelet 指標的節點收集器。它們變成 `Running` 後，叢集會自動出現在 **Kubernetes** 區段，通常在一兩分鐘內。",
  "On other clusters the agent runs [OpenTelemetry eBPF Instrumentation](https://opentelemetry.io/docs/zero-code/obi/) on every node to capture HTTP, gRPC and SQL traces with no code changes. Loading eBPF programs needs privileged pods, which this platform does not allow, so the platform's preset leaves it out, and the continuous profiler with it.":
    "在其他叢集上，代理程式會在每個節點上執行 [OpenTelemetry eBPF Instrumentation](https://opentelemetry.io/docs/zero-code/obi/)，不需變更程式碼就能擷取 HTTP、gRPC 與 SQL 追蹤。載入 eBPF 程式需要特權 Pod，而此平台不允許，所以該平台的預設集會排除它，連同持續效能分析工具一起。",
  "To get traces here, instrument your services with an [OpenTelemetry SDK](/docs/telemetry/open-telemetry) and send them to OneUptime directly.":
    "若要在這裡取得追蹤，請用 [OpenTelemetry SDK](/docs/telemetry/open-telemetry) 檢測你的服務，並將追蹤直接傳送到 OneUptime。",
  "| **Pod logs** | stdout/stderr of every container, read through the Kubernetes API |":
    "| **Pod 日誌** | 每個容器的 stdout/stderr，透過 Kubernetes API 讀取 |",
  "Autopilot blocks hostPath, so node metrics that read the host's `/proc` and `/sys` (disk I/O, inodes, NIC errors) are not collected; kubelet and cAdvisor metrics are.":
    "Autopilot 封鎖 hostPath，因此不會收集讀取主機 `/proc` 和 `/sys` 的節點指標（磁碟 I/O、inode、網路卡錯誤）；kubelet 和 cAdvisor 指標仍會收集。",
  "Pod logs are read through the Kubernetes API on this platform.":
    "在此平台上，Pod 日誌透過 Kubernetes API 讀取。",
  "1. Check that the log reader is ready: `kubectl get pods -n oneuptime-agent -l component=log-collector`":
    "1. 檢查日誌讀取器是否就緒：`kubectl get pods -n oneuptime-agent -l component=log-collector`",
  "3. Its `/healthz` endpoint reports the number of active log streams and the last export error.":
    "3. 它的 `/healthz` 端點會回報作用中日誌串流的數量與最後一次匯出錯誤。",
  "4. On very large clusters one reader can fall behind — split the namespaces across separate releases with `namespaceFilters`.":
    "4. 在非常大的叢集上，一個讀取器可能跟不上：用 `namespaceFilters` 把命名空間分到不同的 release。",
  "The AWS CLI (`aws`) and `eksctl`, signed in to the cluster's account":
    "已登入叢集所屬帳戶的 AWS CLI（`aws`）與 `eksctl`",
  "Pods run on Fargate only in namespaces a Fargate profile selects. Create one for `oneuptime-agent` — without it the agent's pods stay `Pending`:":
    "在 Fargate 上，Pod 只會在 Fargate 設定檔選取的命名空間中執行。請為 `oneuptime-agent` 建立一個——沒有它，代理程式的 Pod 會一直停在 `Pending`：",
  "`preset=eks-fargate` collects pod logs through the Kubernetes API instead of reading them from each node, and leaves out eBPF tracing and profiling, which need privileged pods that EKS Fargate does not allow.":
    "`preset=eks-fargate` 透過 Kubernetes API 收集 Pod 日誌，而不是在每個節點上讀取，並排除 eBPF 追蹤與效能分析，因為它們需要 EKS Fargate 不允許的特權 Pod。",
  "Three Deployments — the collector, the Kubernetes AI agent and the pod log reader. Fargate never schedules DaemonSets, so there are no per-node pods. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "三個 Deployment：收集器、Kubernetes AI 代理程式與 Pod 日誌讀取器。Fargate 從不排程 DaemonSet，因此沒有每個節點的 Pod。它們變成 `Running` 後，叢集會自動出現在 **Kubernetes** 區段，通常在一兩分鐘內。",
  "Then remove the Fargate profile: `eksctl delete fargateprofile --cluster <cluster-name> --name oneuptime-agent`.":
    "接著移除 Fargate 設定檔：`eksctl delete fargateprofile --cluster <cluster-name> --name oneuptime-agent`。",
  "Fargate never schedules DaemonSets, so node, pod and container metrics are not available there.":
    "Fargate 從不排程 DaemonSet，因此那裡沒有節點、Pod 與容器指標。",
  "Fargate only schedules pods in namespaces that a Fargate profile selects. Check that one exists for `oneuptime-agent`:":
    "Fargate 只會在 Fargate 設定檔選取的命名空間中排程 Pod。請檢查是否有 `oneuptime-agent` 的設定檔：",
  "If there is none, create it. Fargate is chosen when a pod is created, so pods that were already pending stay pending — restart the agent's Deployments once the profile is active:":
    "如果沒有，請建立一個。Fargate 是在建立 Pod 時選定的，因此已經在等候中的 Pod 會繼續等候——設定檔啟用後，請重新啟動代理程式的 Deployment：",
};

export default TRANSLATION;
