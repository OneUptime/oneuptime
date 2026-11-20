import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Kubernetes setup guide in Simplified Chinese (#8341): each piece of the English
 * guide's markdown (Pages/Kubernetes/Utils/DocumentationMarkdown.ts) and its
 * Simplified Chinese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Simplified Chinese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A Kubernetes cluster running v1.23 or later":
    "运行 v1.23 或更高版本的 Kubernetes 集群",
  "`kubectl` and `helm` (v3) installed on your machine":
    "你的机器上已安装 `kubectl` 和 `helm`（v3）",
  "Wrong cluster? Switch with `kubectl config use-context <context-name>`.":
    "集群不对？用 `kubectl config use-context <context-name>` 切换。",
  "Replace `my-cluster` with a name for this cluster, such as `prod-us-east-1`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "将 `my-cluster` 替换为此集群的名称，例如 `prod-us-east-1`。集群在 OneUptime 中就以此名称显示，所以请保持不变：新名称会注册一个新集群。",
  "`--set aiAgent.enabled=true` turns **AI investigations** on, as the chart does by default: OneUptime AI investigates incidents and alerts on this cluster with read-only kubectl, through the Kubernetes AI agent.":
    "`--set aiAgent.enabled=true` 会开启 **AI 调查**，与 chart 的默认设置一致：OneUptime AI 通过 Kubernetes AI 代理，使用只读 kubectl 调查此集群上的事件和警报。",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "在第 1 步中选择一个摄取密钥，以填入 `<YOUR_API_KEY>`。",
  "You should see:": "你应该会看到：",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "收集器和 Kubernetes AI 代理，外加每个节点上各一个 `-logs` 和 `-ebpf` Pod。它们变为 `Running` 后，集群会自动出现在 **Kubernetes** 部分，通常在一两分钟内。",
  "**Kubernetes AI agent (on by default, read-only).** The `kubernetes-agent-ai-agent` pod lets OneUptime AI investigate incidents and alerts on this cluster with read-only kubectl — `get`, `describe`, `logs`, `events`, `top` — using the same API key, and it can change nothing unless you give it write access later. Open the cluster and go to **AI → Agent** to see it. Don't want it? Install with `--set aiAgent.enabled=false` instead of `--set aiAgent.enabled=true`.":
    "**Kubernetes AI 代理（默认开启，只读）。** `kubernetes-agent-ai-agent` Pod 让 OneUptime AI 使用相同的 API 密钥，以只读 kubectl（`get`、`describe`、`logs`、`events`、`top`）调查此集群上的事件和警报；除非你之后授予它写入权限，否则它无法更改任何内容。打开集群并前往 **人工智能 → 智能体** 即可看到它。不需要它？安装时用 `--set aiAgent.enabled=false` 代替 `--set aiAgent.enabled=true`。",
  "Namespace rules decide what the agent collects from each namespace. To collect pod logs and eBPF data only from `default`, `production` and `staging`:":
    "命名空间规则决定代理从每个命名空间收集什么。若只从 `default`、`production` 和 `staging` 收集 Pod 日志和 eBPF 数据：",
  "To keep everything but stop the logs of noisy namespaces, exclude them from `podLogs` only:":
    "若要保留全部内容，只停止嘈杂命名空间的日志，请仅将它们从 `podLogs` 中排除：",
  "- **Scopes:** `podLogs` (container stdout/stderr), `ebpfDiscovery` (eBPF traces and metrics), `metrics` (namespaced metrics) and `traces` (every span).":
    "- **范围：** `podLogs`（容器的 stdout/stderr）、`ebpfDiscovery`（eBPF 追踪和指标）、`metrics`（带命名空间的指标）和 `traces`（所有 span）。",
  "- **Patterns** match the whole namespace name and accept `*`, as in `team-*`. An `exclude` rule always wins over an `include` rule.":
    "- **模式** 匹配完整的命名空间名称，并支持 `*`，如 `team-*`。`exclude` 规则总是优先于 `include` 规则。",
  "- **Setting the rules replaces the default one**, which excludes `kube-system` from `podLogs` and `ebpfDiscovery`. Keep it in your list, as in the second example, if you still want that.":
    "- **设置规则会替换默认规则**，默认规则会将 `kube-system` 排除在 `podLogs` 和 `ebpfDiscovery` 之外。如果仍需要它，请像第二个示例那样把它保留在列表中。",
  "- Node and cluster metrics have no namespace, so they are always kept.":
    "- 节点和集群指标没有命名空间，因此始终保留。",
  "- `--set-json` needs Helm 3.10 or later.":
    "- `--set-json` 需要 Helm 3.10 或更高版本。",
  "**Only send important lines.** Drop pod log lines below a severity before they leave the cluster:":
    "**只发送重要的日志行。** 在 Pod 日志行离开集群之前，丢弃低于某个严重级别的行：",
  'Accepts `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` and `FATAL`: `WARN` keeps warnings, errors and fatal lines. The severity is read from the log line itself (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes events are never dropped by this.':
    '接受 `TRACE`、`DEBUG`、`INFO`、`WARN`、`ERROR` 和 `FATAL`：`WARN` 保留警告、错误和致命行。严重级别从日志行本身读取（`[ERROR]`、`level=warn`、`"level":"info"`）。Kubernetes 事件永远不会因此被丢弃。',
  "**Turn pod logs off.** Metrics are not affected — the node collector keeps running for kubelet and cAdvisor metrics, it just stops reading pod logs:":
    "**关闭 Pod 日志。** 指标不受影响：节点收集器会继续运行以采集 kubelet 和 cAdvisor 指标，只是不再读取 Pod 日志：",
  "**Change how logs are read.** The preset picks this for you; an explicit `logs.mode` always wins over it:":
    "**更改日志的读取方式。** 预设会为你选择；显式设置的 `logs.mode` 总是优先：",
  "- `logs.mode=daemonset` — reads `/var/log/pods` on every node through hostPath (lowest overhead; needs hostPath).":
    "- `logs.mode=daemonset`：通过 hostPath 读取每个节点上的 `/var/log/pods`（开销最低；需要 hostPath）。",
  "- `logs.mode=api` — a Deployment tails pod logs through the Kubernetes API (works on any cluster).":
    "- `logs.mode=api`：由一个 Deployment 通过 Kubernetes API 跟踪 Pod 日志（适用于任何集群）。",
  "- `logs.mode=disabled` — no pod logs.":
    "- `logs.mode=disabled`：不收集 Pod 日志。",
  "That reads the API server, where it answers inside the cluster. etcd, the scheduler and the controller manager answer on the control-plane nodes, which the agent's pod cannot guess, so it reads them once you list each node's address:":
    "这会读取 API 服务器，即它在集群内应答的地方。etcd、调度器和控制器管理器在控制平面节点上应答，代理的 Pod 无法猜出这些节点，所以只要你列出每个节点的地址，它就会读取它们：",
  "- **The scheduler and the controller manager** serve HTTPS and accept the agent's token, but kubeadm binds them to `127.0.0.1`: give them a `--bind-address` the agent's pod can reach.":
    "- **调度器和控制器管理器** 提供 HTTPS 并接受代理的令牌，但 kubeadm 会把它们绑定到 `127.0.0.1`：请给它们一个代理的 Pod 能够访问的 `--bind-address`。",
  "- **etcd** serves its metrics in plain HTTP on kubeadm's `--listen-metrics-urls` (port 2381, bound to `127.0.0.1` until you add the node's address), as above. Or scrape its HTTPS client port, 2379, with the client certificate it asks for: put `ca.crt`, `tls.crt` and `tls.key` in a Secret in `oneuptime-agent` and name it in `controlPlane.etcd.clientCertSecret`.":
    "- **etcd** 如上所述，在 kubeadm 的 `--listen-metrics-urls`（端口 2381，在你添加节点地址之前绑定到 `127.0.0.1`）上以明文 HTTP 提供指标。也可以用它要求的客户端证书抓取它的 HTTPS 客户端端口 2379：把 `ca.crt`、`tls.crt` 和 `tls.key` 放进 `oneuptime-agent` 中的一个 Secret，并在 `controlPlane.etcd.clientCertSecret` 中指定它。",
  "Only for self-managed clusters: managed services (EKS, GKE, AKS) do not expose their control plane metrics.":
    "仅适用于自管理集群：托管服务（EKS、GKE、AKS）不会公开其控制平面指标。",
  "Cost monitoring is on by default: the agent bundles the open-source OpenCost engine (plus the small Prometheus it needs), prices your nodes and volumes from your cloud provider's public list prices — no credentials required — and sends what each namespace and workload costs. The first data appears on the cluster's overview and Costs page after the first full hour.":
    "成本监控默认开启：代理内置开源的 OpenCost 引擎（以及它所需的小型 Prometheus），按云服务商公开的目录价格为你的节点和卷定价，无需凭据，并发送每个命名空间和工作负载的成本。第一个完整小时之后，集群的概览和“成本”页面上会出现首批数据。",
  "On an agent installed before it was on by default, upgrade it:":
    "对于在默认开启之前安装的代理，请升级它：",
  "- **Turn it off:** add `--set cost.enabled=false` to the same upgrade.":
    "- **关闭它：** 在同一次升级中添加 `--set cost.enabled=false`。",
  "Cost monitoring is off by default on this platform: it bills every pod by what it requests, so the three cost pods would add to your bill, and OpenCost prices nodes rather than pods. To turn it on anyway:":
    "此平台上的成本监控默认关闭：该平台按每个 Pod 请求的资源计费，因此开启后这三个成本 Pod 会增加你的账单，而且 OpenCost 按节点而不是按 Pod 定价。如仍要开启：",
  "That alone is a complete install: the chart bundles the open-source OpenCost engine (plus the small Prometheus it needs) and prices your nodes and volumes from your cloud provider's public list prices — no credentials required. It adds three small pods; the first data appears after the first full hour.":
    "仅此一项就是完整的安装：chart 内置开源的 OpenCost 引擎（以及它所需的小型 Prometheus），并按云服务商公开的目录价格为你的节点和卷定价，无需凭据。它会添加三个小型 Pod；第一个完整小时之后会出现首批数据。",
  "- **Already running Kubecost or OpenCost?** The agent finds it and reads it instead of the bundled engine, and the cluster's overview says so: add `--set cost.engine.url=auto` to stop bundling a second one.":
    "- **已经在运行 Kubecost 或 OpenCost？** 代理会找到它并读取它，而不是内置的引擎，集群的概览也会说明这一点：添加 `--set cost.engine.url=auto`，即可不再内置第二个引擎。",
  "- **On-prem or bare metal?** Set a rate card with `--set cost.opencost.customPricing.enabled=true` (USD per resource-hour — see the chart's `values.yaml`).":
    "- **本地部署或裸机？** 用 `--set cost.opencost.customPricing.enabled=true` 设置价目表（每资源小时的美元价格；参见 chart 的 `values.yaml`）。",
  "Full guide: [Kubernetes Cost Observability](/docs/telemetry/kubernetes-cost).":
    "完整指南：[Kubernetes 成本可观测性](/docs/telemetry/kubernetes-cost)。",
  "The agent runs [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) on every node. It captures HTTP/HTTPS, gRPC and SQL/Redis traffic from Go, .NET, Java, Node.js, Python, Ruby and Rust services — no SDK and no sidecar — and ships traces, request (RED) metrics and service-graph data through the collector.":
    "代理在每个节点上运行 [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/)。它无需 SDK 和 sidecar，即可捕获 Go、.NET、Java、Node.js、Python、Ruby 和 Rust 服务的 HTTP/HTTPS、gRPC 和 SQL/Redis 流量，并通过收集器发送追踪、请求（RED）指标和服务图数据。",
  "**Requirements:** Linux kernel **5.8+** with BTF (the default on Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). The eBPF pods run **privileged**, which they need to load eBPF programs.":
    "**要求：** 带 BTF 的 Linux 内核 **5.8+**（Debian 11+、Ubuntu 20.10+、Fedora 34+、RHEL 9+ 上的默认配置）。eBPF Pod 以 **特权** 方式运行，这是加载 eBPF 程序所必需的。",
  "**Turn it off** if your nodes run an older kernel, if privileged pods are not allowed, or if your services already send traces with OpenTelemetry SDKs and you don't want duplicates:":
    "如果你的节点运行较旧的内核、不允许特权 Pod，或者你的服务已经用 OpenTelemetry SDK 发送追踪而你不想要重复数据，请 **关闭它**：",
  "**Choose the signals.** Each family is switched with `--set ebpf.features.<name>=false` (or `=true`):":
    "**选择信号。** 每个系列都用 `--set ebpf.features.<name>=false`（或 `=true`）开关：",
  "| `ebpf.features.*` | Default | What it adds |":
    "| `ebpf.features.*` | 默认 | 增加的内容 |",
  "| `httpMetrics` | on | HTTP/gRPC request rate, errors and latency per service |":
    "| `httpMetrics` | 开 | 每个服务的 HTTP/gRPC 请求速率、错误和延迟 |",
  "| `spanMetrics` | on | Span call count and duration (`traces.span.metrics.*`) |":
    "| `spanMetrics` | 开 | span 的调用次数和时长（`traces.span.metrics.*`） |",
  "| `serviceGraph` | on | Caller → callee edges; drives the service map |":
    "| `serviceGraph` | 开 | 调用方 → 被调用方的边；驱动服务地图 |",
  "| `networkMetrics` | on | Pod-to-pod TCP/UDP flow counters |":
    "| `networkMetrics` | 开 | Pod 之间的 TCP/UDP 流计数器 |",
  "| `networkInterZoneMetrics` | off | Inter-zone network metrics (doubles their cardinality) |":
    "| `networkInterZoneMetrics` | 关 | 跨可用区的网络指标（会使其基数翻倍） |",
  "| `tcpStats` | on | Node-level TCP RTT, failed-connection and retransmit counters |":
    "| `tcpStats` | 开 | 节点级 TCP RTT、连接失败和重传计数器 |",
  "**Cross-service trace propagation** — linking a request that crosses pod A → pod B into a single trace, on another node too — is **on by default**. It works by rewriting traffic that is already in flight (widening plaintext HTTP requests in the kernel, and appending a TCP option to TLS and raw TCP), and a mistake in that byte accounting desynchronizes the stream — the reported symptom is transfers through an L7 proxy such as nginx hanging once a response passes ~64KB. If you see that, or a service mesh starts failing pods, turn it off with `--set ebpf.contextPropagation=false`; an OpenTelemetry SDK propagates `traceparent` in userspace without any of that.":
    "**跨服务追踪传播**（把从 Pod A → Pod B 的请求连接成一条追踪，即使在另一个节点上也是如此）**默认开启**。它通过改写正在传输的流量来工作（在内核中扩展明文 HTTP 请求，并给 TLS 和原始 TCP 附加一个 TCP 选项），而这种字节计算一旦出错就会使数据流失去同步：已报告的症状是经过 nginx 等 L7 代理的传输在响应超过 ~64KB 时卡住。如果你遇到这种情况，或者服务网格开始让 Pod 失败，请用 `--set ebpf.contextPropagation=false` 关闭它；OpenTelemetry SDK 会在用户空间传播 `traceparent`，而无需这些操作。",
  "Each `oneuptime.labels.<key>=<value>` becomes the label `<key>:<value>` on the cluster, and on the services and hosts it reports. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "每个 `oneuptime.labels.<key>=<value>` 都会成为集群及其上报的服务和主机上的标签 `<key>:<value>`。标签匹配不区分大小写，因此会复用现有的 `Production` 标签；在 OneUptime 界面中添加的标签永远不会被代理删除。",
  "**Upgrade** to the latest chart. `--reset-then-reuse-values` (Helm 3.14+) keeps the values you set (preset, cluster name, filters) and takes everything else from the new chart; add any new `--set` flags on top of it:":
    "**升级** 到最新的 chart。`--reset-then-reuse-values`（Helm 3.14+）会保留你设置的值（预设、集群名称、筛选条件），其余全部采用新 chart 的值；在此基础上添加任何新的 `--set` 标志：",
  "On Helm 3.13 and earlier, upgrade with the values you set instead:":
    "在 Helm 3.13 及更早版本中，请改用你设置的值进行升级：",
  "Don't use `--reuse-values`: it also keeps the defaults of the chart you upgrade from, so a newer chart's defaults (its eBPF image among them) never apply.":
    "不要使用 `--reuse-values`：它还会保留你升级前那个 chart 的默认值，导致较新 chart 的默认值（包括其 eBPF 镜像）永远不会生效。",
  "**Uninstall** the agent and its namespace:": "**卸载** 代理及其命名空间：",
  "| Category | Data |": "| 类别 | 数据 |",
  "| **Node metrics** | CPU, memory, filesystem and network usage |":
    "| **节点指标** | CPU、内存、文件系统和网络使用情况 |",
  "| **Pod and container metrics** | CPU, memory, network I/O and restarts |":
    "| **Pod 和容器指标** | CPU、内存、网络 I/O 和重启次数 |",
  "| **Cluster metrics** | Node conditions, allocatable resources, pod and workload counts |":
    "| **集群指标** | 节点状况、可分配资源、Pod 和工作负载数量 |",
  "| **Kubernetes events** | Warnings, errors and scheduling events |":
    "| **Kubernetes 事件** | 警告、错误和调度事件 |",
  "| **Pod logs** | stdout/stderr of every container, read from each node |":
    "| **Pod 日志** | 每个容器的 stdout/stderr，在各个节点上读取 |",
  "| **Application traces** *(eBPF)* | HTTP, gRPC and SQL/Redis spans from every pod — no SDK or code changes |":
    "| **应用追踪** *(eBPF)* | 来自每个 Pod 的 HTTP、gRPC 和 SQL/Redis span，无需 SDK 或代码更改 |",
  "| **Request metrics and service graph** *(eBPF)* | Request rate, errors and latency per service, and caller → callee edges for the service map |":
    "| **请求指标和服务图** *(eBPF)* | 每个服务的请求速率、错误和延迟，以及服务地图所用的调用方 → 被调用方的边 |",
  "| **Network flows** *(eBPF)* | Pod-to-pod TCP/UDP byte and packet counters |":
    "| **网络流** *(eBPF)* | Pod 之间的 TCP/UDP 字节和数据包计数器 |",
  "| **Workload costs** *(opt-in, `cost.enabled=true`)* | Spend per namespace, workload and pod, with idle capacity and efficiency |":
    "| **工作负载成本** *(可选，`cost.enabled=true`)* | 每个命名空间、工作负载和 Pod 的支出，以及闲置容量和效率 |",
  "| **Workload costs** *(on by default)* | Spend per namespace, workload and pod, with idle capacity and efficiency, also as metrics to alert on |":
    "| **工作负载成本** *(默认开启)* | 每个命名空间、工作负载和 Pod 的支出，以及闲置容量和效率，也以可设置警报的指标形式提供 |",
  "Your cluster blocks `hostPath` volumes or privileged pods. That is normal on **GKE Autopilot** and **EKS Fargate** — pick that platform at the top of this guide and follow its steps. On **OpenShift** the install succeeds instead, but the agent's node pods never start: pick **Red Hat OpenShift**.":
    "你的集群阻止了 `hostPath` 卷或特权 Pod。这在 **GKE Autopilot** 和 **EKS Fargate** 上很正常：请在本指南顶部选择该平台并按其步骤操作。而在 **OpenShift** 上，安装会成功，但代理的节点 Pod 永远不会启动：请选择 **Red Hat OpenShift**。",
  "On any other cluster with a restrictive Pod Security policy, remove the failed release:":
    "在任何其他具有严格 Pod Security 策略的集群上，请删除失败的 release：",
  "Then run the install command again with `--set preset=gke-autopilot` added. That preset reads pod logs through the Kubernetes API instead of hostPath, applies a hardened security context, and leaves out the privileged eBPF and profiling pods.":
    "然后添加 `--set preset=gke-autopilot`，再次运行安装命令。该预设通过 Kubernetes API 而不是 hostPath 读取 Pod 日志，应用加固的安全上下文，并去掉需要特权的 eBPF 和性能分析 Pod。",
  "1. Check that the agent's pods are running: `kubectl get pods -n oneuptime-agent`":
    "1. 检查代理的 Pod 是否在运行：`kubectl get pods -n oneuptime-agent`",
  "2. Check the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "2. 检查收集器的日志：`kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "3. Verify the OneUptime URL and ingestion key in the install command are correct.":
    "3. 确认安装命令中的 OneUptime URL 和摄取密钥正确。",
  "4. Make sure the cluster can reach your OneUptime instance over the network.":
    "4. 确保集群能通过网络访问你的 OneUptime 实例。",
  "1. Check the AI agent's pod: `kubectl get pods -n oneuptime-agent -l component=ai-agent`":
    "1. 检查 AI 代理的 Pod：`kubectl get pods -n oneuptime-agent -l component=ai-agent`",
  "2. Check its logs: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`":
    "2. 检查它的日志：`kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`",
  "3. No pod? Upgrade the chart (see **Upgrade or uninstall the agent** under Advanced) and add `--set aiAgent.enabled=true`.":
    "3. 没有 Pod？升级 chart（参见“高级”中的 **升级或卸载代理**），并添加 `--set aiAgent.enabled=true`。",
  "1. Check that the cluster name matches: this guide installs **`my-cluster`**.":
    "1. 检查集群名称是否一致：本指南安装的是 **`my-cluster`**。",
  "2. Verify the agent's RBAC permissions: `kubectl get clusterrolebinding | grep kubernetes-agent`":
    "2. 确认代理的 RBAC 权限：`kubectl get clusterrolebinding | grep kubernetes-agent`",
  "3. Look for export errors in the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. 在收集器的日志中查找导出错误：`kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "- **Kernel too old or no BTF.** eBPF needs Linux 5.8+ with BTF — check with `uname -r` on a node. If you can't upgrade, turn eBPF off with `--set ebpf.enabled=false`.":
    "- **内核过旧或没有 BTF。** eBPF 需要带 BTF 的 Linux 5.8+；请在节点上用 `uname -r` 检查。如果无法升级，请用 `--set ebpf.enabled=false` 关闭 eBPF。",
  "- **Privileged pods blocked.** Some locked-down clusters reject them. Turn eBPF off.":
    "- **特权 Pod 被阻止。** 一些锁定严格的集群会拒绝它们。请关闭 eBPF。",
  "- **`debugfs` / `tracefs` not available on the host.** Turn off just the TCP stats family: `--set ebpf.features.tcpStats=false`.":
    "- **主机上没有 `debugfs` / `tracefs`。** 只关闭 TCP 统计系列：`--set ebpf.features.tcpStats=false`。",
  "1. Check the eBPF pods are healthy: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`":
    "1. 检查 eBPF Pod 是否健康：`kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`",
  "2. Turn on OBI's debug output to confirm it sees traffic: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, then read `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.":
    "2. 打开 OBI 的调试输出，确认它能看到流量：`--set ebpf.printTraces=true --set ebpf.logLevel=debug`，然后阅读 `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`。",
  "3. If spans show up there but not in OneUptime, check the collector's logs for export errors: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. 如果 span 出现在那里，却没有出现在 OneUptime 中，请在收集器的日志中查找导出错误：`kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "This installs the agent for **`k8s-1`** — keep `clusterName` exactly as it is, or the data registers as a new cluster.":
    "这会为 **`k8s-1`** 安装代理——请让 `clusterName` 保持原样，否则数据会注册为一个新集群。",
  "The AWS CLI (`aws`), signed in to the cluster's account":
    "已登录集群所在账户的 AWS CLI（`aws`）",
  "The Google Cloud CLI (`gcloud`) with the `gke-gcloud-auth-plugin` component":
    "带有 `gke-gcloud-auth-plugin` 组件的 Google Cloud CLI（`gcloud`）",
  "The Azure CLI (`az`), signed in to the cluster's subscription":
    "已登录集群所在订阅的 Azure CLI（`az`）",
  "OpenShift 4.11 or later, and the OpenShift CLI (`oc`) logged in with cluster-admin rights: the install creates security context constraints":
    "OpenShift 4.11 或更高版本，以及以 cluster-admin 权限登录的 OpenShift CLI（`oc`）：安装会创建安全上下文约束",
  "The web console gives the exact command, token included: **Copy login command**, under your user name. Log in as a cluster admin: the install creates security context constraints.":
    "Web 控制台会给出包含令牌的确切命令：你的用户名下方的 **Copy login command**。请以集群管理员身份登录：安装会创建安全上下文约束。",
  "`preset=openshift` creates two security context constraints (SCCs), one for the node collector and one for the eBPF pods, each used only by its own service account. Every other pod runs under OpenShift's default `restricted-v2`, with the user ID OpenShift assigns.":
    "`preset=openshift` 会创建两个安全上下文约束（SCC），一个用于节点收集器，一个用于 eBPF Pod，各自只由自己的服务账户使用。其他所有 Pod 都在 OpenShift 默认的 `restricted-v2` 下运行，使用 OpenShift 分配的用户 ID。",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. The `-logs` and `-ebpf` pods run under the SCCs the chart created for them: `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf` lists both. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "收集器和 Kubernetes AI 代理，外加每个节点上各一个 `-logs` 和 `-ebpf` Pod。`-logs` 和 `-ebpf` Pod 在 chart 为它们创建的 SCC 下运行：`kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf` 会列出这两个。它们变为 `Running` 后，集群会自动出现在 **Kubernetes** 部分，通常在一两分钟内。",
  "OpenShift admits a pod only under a security context constraint (SCC) its service account may use, and the release installs either way, so a refused pod simply never appears. Look for the refusal:":
    "OpenShift 只在 Pod 的服务账户可使用的安全上下文约束（SCC）下接纳 Pod，而 release 无论如何都会安装，因此被拒绝的 Pod 只是永远不会出现。请查找拒绝记录：",
  "- **`unable to validate against any security context constraint`:** the release was installed without the openshift preset, so the chart created no SCCs. `helm get values kubernetes-agent --namespace oneuptime-agent` shows the values it was given. Add the preset:":
    "- **`unable to validate against any security context constraint`：** release 安装时没有使用 openshift 预设，因此 chart 没有创建任何 SCC。`helm get values kubernetes-agent --namespace oneuptime-agent` 会显示它收到的值。请添加该预设：",
  "- **The SCCs are missing:** check with `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf`. Creating them takes cluster-admin rights, so an install by anyone else fails when it gets to them.":
    "- **缺少 SCC：** 用 `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf` 检查。创建它们需要 cluster-admin 权限，因此由其他人执行的安装会在这一步失败。",
  "- **`violates PodSecurity`:** the namespace's Pod Security level is stricter than the eBPF pods, which run privileged, need. Label it `pod-security.kubernetes.io/enforce=privileged`, or turn eBPF off with `--set ebpf.enabled=false`.":
    "- **`violates PodSecurity`：** 命名空间的 Pod Security 级别比以特权方式运行的 eBPF Pod 所需的更严格。请给它加上标签 `pod-security.kubernetes.io/enforce=privileged`，或用 `--set ebpf.enabled=false` 关闭 eBPF。",
  "- **Your cluster admin will not add SCCs:** use the `openshift-restricted` preset. The chart then creates no SCC and every pod runs under `restricted-v2`, so pod logs come through the Kubernetes API, and there are no host metrics, eBPF traces or profiles:":
    "- **集群管理员不愿添加 SCC：** 请使用 `openshift-restricted` 预设。这样 chart 不会创建任何 SCC，所有 Pod 都在 `restricted-v2` 下运行，因此 Pod 日志通过 Kubernetes API 获取，也不会有主机指标、eBPF 追踪或性能剖析：",
  "`preset=gke-autopilot` collects pod logs through the Kubernetes API instead of reading them from each node, and leaves out eBPF tracing and profiling, which need privileged pods that GKE Autopilot does not allow.":
    "`preset=gke-autopilot` 通过 Kubernetes API 收集 Pod 日志，而不是在每个节点上读取，并去掉 eBPF 追踪和性能分析，因为它们需要 GKE Autopilot 不允许的特权 Pod。",
  "The collector, the Kubernetes AI agent and the pod log reader, plus one node collector per node for kubelet metrics. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "收集器、Kubernetes AI 代理和 Pod 日志读取器，外加每个节点一个用于 kubelet 指标的节点收集器。它们变为 `Running` 后，集群会自动出现在 **Kubernetes** 部分，通常在一两分钟内。",
  "On other clusters the agent runs [OpenTelemetry eBPF Instrumentation](https://opentelemetry.io/docs/zero-code/obi/) on every node to capture HTTP, gRPC and SQL traces with no code changes. Loading eBPF programs needs privileged pods, which this platform does not allow, so the platform's preset leaves it out, and the continuous profiler with it.":
    "在其他集群上，代理会在每个节点上运行 [OpenTelemetry eBPF Instrumentation](https://opentelemetry.io/docs/zero-code/obi/)，无需更改代码即可捕获 HTTP、gRPC 和 SQL 追踪。加载 eBPF 程序需要特权 Pod，而此平台不允许，因此该平台的预设会去掉它，连同持续性能分析器一起。",
  "To get traces here, instrument your services with an [OpenTelemetry SDK](/docs/telemetry/open-telemetry) and send them to OneUptime directly.":
    "若要在这里获得追踪，请用 [OpenTelemetry SDK](/docs/telemetry/open-telemetry) 对你的服务进行插桩，并将追踪直接发送到 OneUptime。",
  "| **Pod logs** | stdout/stderr of every container, read through the Kubernetes API |":
    "| **Pod 日志** | 每个容器的 stdout/stderr，通过 Kubernetes API 读取 |",
  "Autopilot blocks hostPath, so node metrics that read the host's `/proc` and `/sys` (disk I/O, inodes, NIC errors) are not collected; kubelet and cAdvisor metrics are.":
    "Autopilot 阻止 hostPath，因此不会收集读取主机 `/proc` 和 `/sys` 的节点指标（磁盘 I/O、inode、网卡错误）；kubelet 和 cAdvisor 指标仍会收集。",
  "Pod logs are read through the Kubernetes API on this platform.":
    "在此平台上，Pod 日志通过 Kubernetes API 读取。",
  "1. Check that the log reader is ready: `kubectl get pods -n oneuptime-agent -l component=log-collector`":
    "1. 检查日志读取器是否就绪：`kubectl get pods -n oneuptime-agent -l component=log-collector`",
  "3. Its `/healthz` endpoint reports the number of active log streams and the last export error.":
    "3. 它的 `/healthz` 端点会报告活跃日志流的数量和最后一次导出错误。",
  "4. On very large clusters one reader can fall behind — split the namespaces across separate releases with `namespaceFilters`.":
    "4. 在非常大的集群上，一个读取器可能跟不上：用 `namespaceFilters` 把命名空间分到不同的 release 中。",
  "The AWS CLI (`aws`) and `eksctl`, signed in to the cluster's account":
    "已登录集群所在账户的 AWS CLI（`aws`）和 `eksctl`",
  "Pods run on Fargate only in namespaces a Fargate profile selects. Create one for `oneuptime-agent` — without it the agent's pods stay `Pending`:":
    "在 Fargate 上，Pod 只在 Fargate 配置文件选择的命名空间中运行。请为 `oneuptime-agent` 创建一个——没有它，代理的 Pod 会一直处于 `Pending`：",
  "`preset=eks-fargate` collects pod logs through the Kubernetes API instead of reading them from each node, and leaves out eBPF tracing and profiling, which need privileged pods that EKS Fargate does not allow.":
    "`preset=eks-fargate` 通过 Kubernetes API 收集 Pod 日志，而不是在每个节点上读取，并去掉 eBPF 追踪和性能分析，因为它们需要 EKS Fargate 不允许的特权 Pod。",
  "Three Deployments — the collector, the Kubernetes AI agent and the pod log reader. Fargate never schedules DaemonSets, so there are no per-node pods. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "三个 Deployment：收集器、Kubernetes AI 代理和 Pod 日志读取器。Fargate 从不调度 DaemonSet，因此没有每个节点的 Pod。它们变为 `Running` 后，集群会自动出现在 **Kubernetes** 部分，通常在一两分钟内。",
  "Then remove the Fargate profile: `eksctl delete fargateprofile --cluster <cluster-name> --name oneuptime-agent`.":
    "然后删除 Fargate 配置文件：`eksctl delete fargateprofile --cluster <cluster-name> --name oneuptime-agent`。",
  "Fargate never schedules DaemonSets, so node, pod and container metrics are not available there.":
    "Fargate 从不调度 DaemonSet，因此那里没有节点、Pod 和容器指标。",
  "Fargate only schedules pods in namespaces that a Fargate profile selects. Check that one exists for `oneuptime-agent`:":
    "Fargate 只在 Fargate 配置文件选择的命名空间中调度 Pod。请检查是否存在 `oneuptime-agent` 的配置文件：",
  "If there is none, create it. Fargate is chosen when a pod is created, so pods that were already pending stay pending — restart the agent's Deployments once the profile is active:":
    "如果没有，请创建一个。Fargate 在创建 Pod 时选定，因此已经处于等待中的 Pod 会继续等待——配置文件激活后，请重启代理的 Deployment：",
};

export default TRANSLATION;
