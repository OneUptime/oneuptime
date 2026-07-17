# OneUptime Kubernetes 代理（Helm）

## 概述

OneUptime Kubernetes 代理是一个预打包的 Helm chart，可在你的集群上安装一套基于 OpenTelemetry 的采集器流水线。它会发送节点、Pod、容器和集群指标；Kubernetes 事件；Pod 日志；并且——在默认开启 eBPF 的情况下——还会发送应用追踪、HTTP RED 指标、服务图数据以及 Pod 到 Pod 的网络流量指标。无需更改代码、无需 SDK，只需一条 `helm install`。

本页是**安装指南**。如需在代理采集的数据之上配置 Kubernetes 监视器和告警，请参阅 [Kubernetes 代理（监视器）](/docs/monitor/kubernetes-agent)。

## 先决条件

- 一个正在运行的 Kubernetes 集群（v1.23+）
- 已配置可访问你集群的 `kubectl`
- 已安装 `helm` v3
- 一个 **OneUptime API 密钥**——可从 _Project Settings → API Keys_ 创建

## 步骤 1 — 添加 OneUptime Helm 仓库

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm repo update
```

## 步骤 2 — 为你的集群选择一个预设

该 chart 公开了一个顶层选项——`preset`——它会为你的 Kubernetes 发行版选择兼容的默认值。它控制着那些你本来需要手动调整的事项：是通过 hostPath DaemonSet 发送日志，还是通过 Kubernetes API 发送日志，以及应用哪种安全上下文。

| `preset`            | 适用于                                                                     | 日志采集                                                        |
| ------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `standard` _(默认)_ | 自管理集群、**EKS on EC2**、**GKE Standard**、**AKS**、minikube、kind、k3s | DaemonSet 通过 hostPath 读取 `/var/log/pods`（开销最低）        |
| `gke-autopilot`     | **GKE Autopilot**                                                          | Kubernetes API 日志拉取器 Deployment（无 hostPath，无主机访问） |
| `eks-fargate`       | **EKS Fargate**                                                            | Kubernetes API 日志拉取器 Deployment（无 hostPath，无主机访问） |

如果你不确定，请从 `standard` 开始。如果安装因提及 `hostPath` 的 Pod Security 错误而失败，请改用 `preset=gke-autopilot`（或在 Fargate 上使用 `eks-fargate`）重新运行，它就能正常工作。

## 步骤 3 — 安装 Kubernetes 代理

将 `YOUR_ONEUPTIME_URL`、`YOUR_ONEUPTIME_API_KEY` 以及集群名称替换为适用于你环境的值。集群名称决定了该集群在 OneUptime 中的显示方式——请选择一个稳定的名称，例如 `prod-us-east-1`。

### 标准集群（自管理、EKS on EC2、GKE Standard、AKS）

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

## 步骤 4 — 验证安装

检查代理 Pod 是否正在运行：

```bash
kubectl get pods -n oneuptime-agent
```

在**标准**集群上，你会看到一个 cluster-collector Deployment，外加每个节点一个 node-collector DaemonSet Pod：

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-xxxxx                   1/1     Running   0          1m
kubernetes-agent-logs-yyyyy                   1/1     Running   0          1m
```

在 **GKE Autopilot** 上，节点采集器仍会运行——它无需 hostPath 即可采集 kubelet 和 cAdvisor 指标——并且会有一个额外的 Deployment 通过 Kubernetes API 读取 Pod 日志：

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-yyyyyyyyyy-yyyyy        1/1     Running   0          1m
kubernetes-agent-logs-xxxxx                   1/1     Running   0          1m
```

在 **EKS Fargate** 上，你会看到两个 Deployment 且没有 DaemonSet——Fargate 为每个 Pod 分配独立的微型虚拟机，从不调度 DaemonSet，因此那里无法获得节点级指标：

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-yyyyyyyyyy-yyyyy        1/1     Running   0          1m
```

代理连接成功后，你的集群将自动出现在 OneUptime 仪表板的 **Kubernetes** 部分。

## 配置选项

### 命名空间过滤

`namespaceFilters.rules` 将命名空间模式独立应用到四个作用域:

- `podLogs`: 在 hostPath filelog 接收器或 API 日志采集器中过滤 Pod 的 stdout/stderr；不会影响 Kubernetes 事件和审计日志。
- `ebpfDiscovery`: 过滤 OBI 进程发现，因此同时控制 eBPF 追踪和 eBPF 指标。
- `metrics`: 在元数据补充后过滤带命名空间的指标序列；不带命名空间的节点和集群序列会保留。
- `traces`: 在元数据补充后过滤 eBPF span 和应用程序推送的 OTLP span。

命名空间模式匹配完整名称，并支持使用 * 作为通配符，例如 team-*。如果某个作用域存在任何 include 规则，则该作用域只保留匹配的命名空间。exclude 规则始终优先。默认规则仅从 podLogs 和 ebpfDiscovery 中排除 kube-system。

要将 Pod 日志和 eBPF 发现限制到指定命名空间：

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set-json 'namespaceFilters.rules=[{"action":"include","namespaces":["default","production","staging"],"scopes":["podLogs","ebpfDiscovery"]}]'
```

要停止某个高噪声命名空间的日志，同时保留其 eBPF 追踪、服务地图和指标，请仅将排除规则应用到 podLogs：

```bash
  --set-json 'namespaceFilters.rules=[{"action":"exclude","namespaces":["kube-system"],"scopes":["podLogs","ebpfDiscovery"]},{"action":"exclude","namespaces":["noisy-*"],"scopes":["podLogs"]}]'
```

podLogs 和 ebpfDiscovery 规则在源头过滤：被排除的日志文件不会打开，被排除的工作负载不会被插桩。metrics 和 traces 规则在补充命名空间元数据后，于 collector 中稍后执行。

#### 按命名空间过滤指标和追踪

如果还需要过滤带命名空间的指标或 span，请直接把这些作用域添加到规则中：

```bash
  --set-json 'namespaceFilters.rules=[{"action":"exclude","namespaces":["kube-system","noisy-*"],"scopes":["podLogs","ebpfDiscovery","metrics","traces"]}]'
```

> **节点和集群级指标始终保留。命名空间是 Pod 而不是节点的属性，因此不带命名空间的序列不会匹配规则，也不会被删除。**

代理无法按命名空间过滤 Kubernetes 事件。事件由 k8sobjects 接收器提供，不包含 k8s.namespace.name 属性；命名空间位于事件正文中。请改为在服务器端过滤。

### 按日志严重性过滤

`filters.logs.minSeverity` 会在代理侧、在发送任何内容之前，丢弃低于某个严重性的 **Pod 日志**记录：

```bash
  --set filters.logs.minSeverity=WARN
```

接受 `TRACE`、`DEBUG`、`INFO`、`WARN`、`ERROR`、`FATAL`。`WARN` 会保留 WARN、ERROR 和 FATAL，并丢弃 INFO、DEBUG 和 TRACE。默认值（`""`）会保留所有内容。它在**两种**日志模式下都适用——在 `daemonset` 模式下通过采集器，在 `api` 模式下则在日志拉取器内部——因此预设无法在你不知情的情况下把它关掉。

容器运行时并不会在日志行上记录严重性，因此代理会自行从日志文本中解析出一个严重性（`[ERROR]`、`WARN:`、`level=info`，……）。

> **Kubernetes 事件和资源规格（spec）绝不会被它过滤。** 它们来自 Kubernetes API，本身不带任何严重性，因此阈值会删除整个数据流，而不是把它变稀疏——其中就包括你最想要的 `FailedScheduling`、`BackOff` 和 `OOMKilling` 警告。它们数据量小而价值高，因此代理始终会发送它们。若要精简它们，请改用仪表板中服务端的 **Logs → Settings → Drop Filters**。

**一行没有可识别级别的日志会如何处理，取决于日志模式**，因为两种模式可获得的信息并不相同：

| 模式 | 无级别标记的日志行 | 原因 |
| ---- | --------------- | --- |
| `daemonset` | `stderr` → 视为 ERROR（保留），`stdout` → 视为 INFO（会被 WARN 阈值丢弃） | 容器运行时会记录每一行来自哪个流。 |
| `api` | 始终**保留** | Kubernetes 的 `pods/log` API 会把 stdout 和 stderr 合并成单个流，且不带任何逐行标记。代理不会去猜测，而是保留该行。 |

> 因此 `api` 模式丢弃的内容严格少于 `daemonset` 模式。这是有意为之：一段 Python traceback 或 `npm ERR!` 并不带有严重性关键字，而悄悄删除它，正是严重性阈值本应保护你免于遭遇的那种故障。

多行事件在两种模式下都会在过滤**之前**被重新组合，因此一段 Java 堆栈跟踪会依据它的第一行来判定，并被整体保留或整体丢弃——你绝不会得到一条被剥掉了栈帧的光秃秃的 `ERROR` 行。

### 按名称包含或排除指标

`filters.metrics` 用于控制哪些指标可以离开集群，它作用于流水线中的每一个接收器。

**丢弃少数几个噪声较大的指标**（一个拒绝列表——通常这就是你想要的）：

```bash
  --set-json 'filters.metrics.exclude=["k8s.volume.available","k8s.volume.capacity"]'
```

**只发送一组固定的指标**（一个允许列表——其他所有内容都会被丢弃）：

```bash
  --set-json 'filters.metrics.include=["k8s.pod.cpu.utilization","k8s.pod.memory.usage"]'
```

**按模式匹配**，而不是按精确名称：

```bash
  --set filters.metrics.matchType=regexp \
  --set-json 'filters.metrics.exclude=["^container_network_"]'
```

| 键 | 含义 |
| --- | ------- |
| `filters.metrics.exclude` | 要丢弃的指标名称。它在 `include` 之上应用，因此 exclude 始终优先。 |
| `filters.metrics.include` | 当它非空时，**只有**这些指标会被发送。 |
| `filters.metrics.matchType` | `strict`（精确名称，默认值）或 `regexp`（RE2，**不带锚点**）。 |

一些能帮你避免一次故障的注意事项：

- `regexp` 是**不带锚点的**——`system.cpu` 也会匹配 `system.cpu.time`。当你确实只想指一个指标时，请加上锚点（`^system\.cpu$`）。
- RE2 **没有先行断言（lookahead）**，因此 `^(?!container_)` 无法编译。请用 `include` 来表达“除……之外的所有内容”，而不是用否定式正则。
- `include` 会一次性作用于每一个接收器。一个漏掉了某个指标的允许列表会悄悄移除构建在该指标之上的监视器。除非你确实想要一个封闭的集合，否则请优先使用 `exclude`。
- 对于列表，请使用 `--set-json`（或一个 values 文件）。普通的 `--set` 会替换整个列表，而不是与之合并。

> **在推广之前先测试你的正则。** 模式是由采集器在启动时编译的，而不是逐条记录编译，因此一个无效的模式并不会悄无声息地出问题——采集器会拒绝启动并进入 CrashLoopBackOff，从而把该采集器的**日志**连同它的指标一起拖垮。Helm 无法编译 RE2，因此 `helm upgrade` 会毫无怨言地接受一个错误的模式。

### 追踪采样

上面那些过滤器移除的都是一**类**遥测数据——一个命名空间、一个严重性、一个指标名称。采样则不同：它保留每一个类别，转而对总体做稀释。把 `sampling.traces.percentage` 设为你想保留的追踪比例：

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set sampling.traces.percentage=10
```

这会每十条追踪保留一条，其余九条在代理处、在它们离开你的集群之前就被丢弃。

**你得到的是完整的追踪，而不是碎片。** 采样决策依据的是对追踪 ID 的哈希，而不是逐 span 抛一次硬币，因此一条追踪的每一个 span 会被一起保留或一起丢弃——存活下来的追踪是完整的，可以端到端读完。正是这一特性让采样可以放心开启。

**你的基于指标的监视器不会有任何变动。** eBPF RED 指标——请求速率、错误率、持续时间——属于**指标**系列。OBI 会根据每一个请求计算它们，并且它们走的是指标流水线，而采样器并不在这条流水线上。在 `percentage: 10` 下，你得到的是十分之一的追踪，以及 100% 准确的速率/错误/延迟。构建在这些指标之上的仪表板和监视器不受影响。

**但你的基于 span 的监视器会变。** 凡是 OneUptime 从 span 本身派生出来的东西，都会随着采样率一起按比例缩小——在开启它之前，请先看下面的警告。

| 键 | 含义 |
| --- | ------- |
| `sampling.traces.percentage` | 要**保留**的追踪百分比，0-100。默认值 `100`（全部保留）。 |
| `sampling.traces.hashSeed` | 追踪 ID 哈希所用的种子。默认值 `22`。 |

一些能帮你避免一次故障的注意事项：

- **`0` 表示一条追踪都不保留。** 它是一个采样率，而不是一个开关——它会删除每一条追踪，而 eBPF DaemonSet 仍在运行并持续消耗你的资源。如果你不想要追踪，请使用 `ebpf.enabled=false`。如果你不想要追踪但**确实**想要 RED 指标和服务地图，那就让 eBPF 保持开启，并有意识地把它设为 `0`。
- **仅在 `ebpf.enabled` 时生效。** 否则追踪流水线根本不存在，因此在 `ebpf.enabled=false` 下这个值不起任何作用。
- **仅限追踪。** 没有 `sampling.logs` 或 `sampling.metrics`，这是有意为之——参见下面的说明。
- **小数需要用 `--set-json`，而且它们有一个下限。** `--set sampling.traces.percentage=0.5` 会失败，因为 Helm 会把 `0.5` 读成字符串。请使用 `--set-json 'sampling.traces.percentage=0.5'` 或一个 values 文件。整数用 `--set` 没有问题。低于约 `0.0061` 时，采样率会被量化为零，其行为与 `0` 完全一致——每一条追踪都被丢弃，且不会报错。`0.01`（万分之一）是最小的名副其实的值。
- **多集群默认即可正常工作。** 两个代理只有在 `hashSeed` 和 `percentage` 上都一致时，才会保留同一条追踪。两者在各处的默认值都相同，因此一条跨越两个集群的追踪无需任何额外配置就能完整存活。只有当你想刻意让两个采样层级**去相关**时才去改 `hashSeed`——因为采样决策是对同一个哈希设定阈值，所以相同种子在不同比例下是嵌套的，第二个层级只会在第一个层级已经保留的追踪里再挑一遍，而不是独立抽样。
- **Pod 日志从不会被采样**，因此在 `ebpf.logToTraceCorrelation: true` 下，每一条日志记录仍然带着追踪 ID，而这些追踪中只有 `percentage`% 会被保留。大约 (100 − `percentage`)% 的日志记录会显示一个走不通的追踪链接。追踪 → 日志的跳转不受影响；只有日志 → 追踪可能落空。

> **设置这一项时，请重新调校你的基于 span 的监视器。** 采样会减少到达 OneUptime 的 span，因此凡是统计 span 的东西都会统计得更少：一个基于 `Span Count` 的 **Traces** 监视器，以及一个基于 `Exception Count` 的 **Exceptions** 监视器，都只会看到昨天数据量的约 `percentage`%。一个按未采样流量调校过的阈值会悄无声息地不再被跨越——监视器不会报错，它只是陷入沉默。设定采样率时，请把这些阈值除以同样的倍数；采样率是集群级的，因此没有办法让某个单独的服务豁免于它。错误**分组**的退化比线性还要糟糕：常见的异常仍然会浮现出来，但一个罕见的一次性异常更可能是彻底消失，而不是以十分之一的频率出现。

> **为什么这里没有日志或指标采样。** 采集器的采样器根本无法对指标采样。它可以对日志采样，但它的随机性来源是追踪 ID——而 Pod 日志没有追踪 ID。于是每一条没有追踪 ID 的记录都会哈希到同一个桶里，因此一个日志采样率并不会稀释数据流：取决于种子，它要么全部保留，要么全部删除。与其提供一个会悄悄删除你日志的旋钮，这份 chart 索性不提供。请用[按日志严重性过滤](#按日志严重性过滤)和[命名空间过滤](#命名空间过滤)来精简日志，它们对自己移除的内容是精确的。

### 禁用日志采集

如果你不需要 Pod 日志：

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set logs.enabled=false
```

你的指标不受影响：节点采集器会继续运行以采集 kubelet、cAdvisor 和主机指标，它只是不再读取 Pod 日志。只有基于日志的告警会停止。

### 强制使用特定的日志采集模式

高级用户可以使用 `logs.mode` 覆盖预设的选择：

- `logs.mode=daemonset` — hostPath DaemonSet（开销最低，需要 hostPath）
- `logs.mode=api` — Kubernetes API 日志拉取器 Deployment（适用于任何集群）
- `logs.mode=disabled` — 不进行日志采集

> 日志模式只决定 **Pod 日志**从哪里来。节点指标的采集与它无关，因此 `api` 和 `disabled` 都会保留你的 kubelet、cAdvisor 和主机指标。
>
> 唯一的例外来自平台而非模式：**EKS Fargate 根本无法调度 DaemonSet**，因此那里没有节点采集器，节点/Pod/容器级指标不可用。GKE Autopilot 可以正常运行节点采集器，但会阻止 `hostPath`，因此它采集 kubelet 和 cAdvisor 指标，但不包含需要读取主机 `/proc` 和 `/sys` 的 `hostmetrics` 指标（磁盘 I/O、inode、网卡错误）。


显式的 `logs.mode` 始终优先于预设默认值。如果你比预设更了解你的集群，请使用此选项。

### 启用控制平面监控

对于自管理集群（非 EKS / GKE / AKS），你可以启用控制平面指标：

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set controlPlane.enabled=true
```

> 托管的 Kubernetes 服务（EKS、GKE、AKS）通常不会暴露控制平面指标。请仅对自管理集群启用此项。

### 使用项目标签自动打标签

任何以 `oneuptime.label.` 为前缀的资源属性都会被提升为项目 Label，并附加到由此代理发出的集群、服务和主机上。规则：`oneuptime.label.<dimension>=<value>` 会变成一个名为 `<dimension>:<value>` 的标签。

在安装时使用 `--set oneuptime.labels.<key>=<value>` 传递标签：

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

或者将它们保存在一个 values 文件中：

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

标签匹配不区分大小写，因此现有的手动创建的 `Production` 标签会被复用，而不会被重复创建。在 OneUptime UI 中手动添加的标签永远不会被代理移除。

## 升级代理

```bash
helm repo update
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values
```

`--reuse-values` 会保留你现有的配置（预设、集群名称、过滤器）；可在其之上传递任何新的 `--set` 覆盖项。

## 卸载代理

```bash
helm uninstall kubernetes-agent --namespace oneuptime-agent
kubectl delete namespace oneuptime-agent
```

## 采集了哪些内容

| 类别                                 | 数据                                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| **节点指标**                         | CPU 利用率、内存使用、文件系统使用、网络 I/O                                                                             |
| **Pod 指标**                         | CPU 使用、内存使用、网络 I/O、重启次数                                                                                   |
| **容器指标**                         | 每个容器的 CPU 使用、内存使用                                                                                            |
| **集群指标**                         | 节点状况、可分配资源、Pod 数量                                                                                           |
| **Kubernetes 事件**                  | 警告、错误、调度事件                                                                                                     |
| **Pod 日志**                         | 来自所有容器的 stdout/stderr 日志（在标准集群上通过 hostPath DaemonSet，或在 Autopilot / Fargate 上通过 Kubernetes API） |
| **应用追踪** _(通过 eBPF，默认开启)_ | 来自每个 Pod 的 HTTP、gRPC、SQL/Redis span——无需 SDK 或代码更改                                                          |
| **HTTP RED 指标** _(通过 eBPF)_      | 每个服务的 `http.server.request.duration`、请求和响应体大小                                                              |
| **服务图** _(通过 eBPF)_             | 调用方 → 被调用方的请求速率、延迟和错误边——驱动服务地图视图                                                              |
| **网络流量指标** _(通过 eBPF)_       | 带 k8s 元数据的 Pod 到 Pod 的 TCP/UDP 字节和数据包计数器                                                                 |
| **TCP 统计** _(通过 eBPF)_           | 节点级别的 RTT、连接失败和重传计数器                                                                                     |

## 通过 eBPF 实现应用追踪与 HTTP 指标（默认开启）

该 chart 在每个节点上运行一个带有 [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) 的 DaemonSet。它将 eBPF 程序加载到内核中，并自动捕获来自每个受支持运行时（Go、.NET、Java、Node.js、Python、Ruby、Rust）的 HTTP/HTTPS、gRPC 和 SQL/Redis 流量——无需 SDK，也无需 sidecar。追踪和请求指标随后通过集群内的采集器流向 OneUptime。

**要求：** 启用 BTF 的 Linux 内核 **5.8+**（在 Debian 11+、Ubuntu 20.10+、Fedora 34+、RHEL/Stream 9+ 上为默认）。eBPF DaemonSet 以**特权模式**运行，因为它必须如此才能加载 eBPF 程序。

### 禁用 eBPF 自动埋点

在以下情况下你应该禁用它：

- 在 **GKE Autopilot** 或 **EKS Fargate** 上安装时——这些平台会阻止特权 Pod（使用 `preset=gke-autopilot` / `preset=eks-fargate` 并搭配 `ebpf.enabled=false`）。
- 节点运行的内核版本早于 5.8 且没有 BTF 反向移植。
- 你已经从应用中通过 OpenTelemetry SDK 发送追踪，并且不希望出现重复。

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set ebpf.enabled=false
```

### 切换单个信号系列

全部默认开启。使用 `--set ebpf.features.<name>=false` 关闭其中任意一个：

| `ebpf.features.*`         | 默认 | 它增加了什么                                          |
| ------------------------- | ---- | ----------------------------------------------------- |
| `httpMetrics`             | 开   | 每个服务的 HTTP/gRPC RED 指标（请求速率、延迟、错误） |
| `spanMetrics`             | 开   | 每个 span 的请求/响应大小和持续时间                   |
| `serviceGraph`            | 开   | 调用方 → 被调用方的边指标；驱动服务地图               |
| `hostMetrics`             | 开   | 每个被埋点进程的 CPU 和内存                           |
| `networkMetrics`          | 开   | Pod 到 Pod 的 TCP/UDP 流量计数器                      |
| `networkInterZoneMetrics` | 关   | 网络指标的跨区域变体（使基数翻倍）                    |
| `tcpStats`                | 开   | 节点级别的 TCP RTT、连接失败、重传计数器              |

跨服务追踪上下文传播也默认开启——OBI 会将 W3C `traceparent` 注入到出站的 HTTP/TCP 中，因此一个从 Pod A → Pod B 跨越的请求会显示为单个追踪，在任何地方都无需更改 SDK。使用 `--set ebpf.contextPropagation=false` 关闭。

## 减少采集的数据量

开箱即用时，代理是为**覆盖范围**而调优的——它会发送来自整个集群的指标、Pod 日志和 eBPF 追踪，因此每个仪表板和监视器从第一天起就能正常工作。在大型或繁忙的集群上，这可能会超出你所需的遥测量，表现为更高的摄取量（在 OneUptime Cloud 上还意味着更高的成本）。这里的任何设置都不是必需的，但如果某个集群发送的数据超出你的需要，以下就是可以调整的旋钮——大致按影响大小排序。

诀窍在于**停止采集你不会去查看的内容**，而不是采集所有内容再花钱把它存储起来。下面的每个调整项都是一个 Helm 值，因此你可以在 `helm upgrade --reuse-values` 上用 `--set` 应用它，并以同样的方式将它回滚。

### 数据量从何而来

| 信号                      | 最主要的来源                             | 用以下项调低                                                                                 |
| ------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Pod 日志**              | 整个集群中每个容器的每一行日志           | `namespaceFilters`、`filters.logs.minSeverity`、`logs.enabled`、`logs.mode`                  |
| **eBPF 追踪与 span 指标** | 来自每个被埋点进程的每个请求一条追踪     | `sampling.traces.percentage`、`ebpf.enabled`、`ebpf.features.*`、`ebpf.autoTargetExe`、`ebpf.excludeExePaths` |
| **指标数据点**            | 抓取频率 × Pod/容器数量                  | `collectionInterval`、`hostMetrics.collectionInterval`、`cadvisor.scrapeInterval`            |
| **指标基数**              | 不同序列的数量（每容器、每 PVC，……）     | `filters.metrics.exclude`、`namespaceFilters.rules` (`metrics`)、`cadvisor.metricsAllowlist`、`kubeletstats.volumeMetrics` |
| **可选启用的额外项**      | 性能分析、审计日志、控制平面、跨区域指标 | 让它们保持关闭（它们默认已经是关闭的）                                                       |

削减数据量有三种方式，值得弄清楚你正在使用的是哪一种：

- **在接收器处**——数据从不会被采集。作用于 Pod 日志的 `namespaceFilters`、`cadvisor.metricsAllowlist`、更长的 `collectionInterval`。它的运行开销为零，并且同时节省 CPU、出口流量和摄取量。只要能覆盖你的场景，就应始终优先选择这些方式。
- **在 filter 处理器处**——数据会被采集，然后在导出前被丢弃。`filters.logs.minSeverity`、`filters.metrics.*`、`namespaceFilters.rules` (`metrics`/`traces`)。采集器的 CPU 开销略高，但它可以跨接收器生效，并且能表达接收器无法表达的内容。
- **只需要特定命名空间的日志？请使用作用域为 podLogs 的 include 规则。匹配发生在日志源，因此被过滤的命名空间不会被读取，而 eBPF 遥测保持独立。**

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set-json 'namespaceFilters.rules=[{"action":"include","namespaces":["default","production"],"scopes":["podLogs"]}]'
  ```

  要保留除一组高噪声命名空间之外的所有命名空间，请使用 namespaces: [noisy-*]、scopes: [podLogs] 的 exclude 规则。

- **只关心警告和错误？** `filters.logs.minSeverity` 会在代理侧丢弃其余内容。在一个话痨般的集群上，这往往是可用的最大单项削减，因为 INFO 和 DEBUG 占了大多数应用输出的绝大部分：

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set filters.logs.minSeverity=WARN
  ```

  有关严重性是如何确定的，以及无法分类的日志会如何处理，请参阅[按日志严重性过滤](#按日志严重性过滤)。

- **完全不需要 OneUptime 中的 Pod 日志？** 将它们关闭：

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set logs.enabled=false
  ```

  > 这只会停止 Pod 日志。节点、Pod 和容器指标会继续流入，基于它们的监控（OOM kill、CPU 限流、PVC 磁盘空间不足）也会继续工作——节点采集器仍在，只是不再读取 `/var/log/pods`。`logs.mode: api` 和 `logs.mode: disabled` 同理。

### 调整项 2 — 精简 eBPF 自动埋点

eBPF 无需更改代码即可为你提供追踪、RED 指标、服务地图和网络流量指标——但它也是第二大的数据来源，因为它为每个请求发出一个 span，并为每个服务发出多个指标系列。你有三个层级的控制方式：

- **已经通过 OTel SDK 发送追踪，或者不想要自动追踪？** 彻底关闭 eBPF：

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.enabled=false
  ```

- **保留追踪，去掉高开销的指标系列。** 上面的[信号系列表](#切换单个信号系列)列出了每个 `ebpf.features.*` 标志。数据量最大的系列是网络指标和 span 指标——关闭它们会让追踪、HTTP RED 指标和服务地图保持完好：

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.features.networkMetrics=false \
    --set ebpf.features.tcpStats=false \
    --set ebpf.features.spanMetrics=false
  ```

  让 `ebpf.features.networkInterZoneMetrics` 保持关闭（其默认值）——它会使网络流量基数翻倍。

- **只对你关心的运行时进行埋点。** 默认情况下，OBI 会附加到它识别的每个进程上（`ebpf.autoTargetExe: "*"`）。将其缩小到特定的运行时，或将二进制文件加入跳过列表，以减少代理产生的“服务”和追踪的数量：

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.autoTargetExe='*/python,*/java'
  ```

  有关完整的默认值，请参阅[切换单个信号系列](#切换单个信号系列)以及 chart values 中的 `excludeExePaths` 说明。

### 调整项 3 — 放慢抓取间隔

指标量与代理抓取的频率成正比。将某个间隔加倍大致会使该指标产生的数据点数量减半，且不会损失覆盖范围——只是分辨率更粗。如果你不需要 30 秒的粒度，60s 或 120s 是一个大幅且安全的削减：

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set collectionInterval=60s \
  --set hostMetrics.collectionInterval=60s \
  --set cadvisor.scrapeInterval=60s
```

- `collectionInterval`（默认 `30s`）驱动节点 / Pod / 容器指标（`kubeletstats`）和集群状态指标（`k8s_cluster`）——占指标量的大部分。
- `hostMetrics.collectionInterval` 和 `cadvisor.scrapeInterval` 涵盖每节点的操作系统指标以及限流 / OOM 计数器。
- `resourceSpecs.interval`（默认 `300s`）控制拉取完整资源规格（标签、注解、状态）的频率——如果你不需要快速反映规格变更，请调高它。
- 如果你启用了任何可选的抓取器，它们也有各自的旋钮：`kubeStateMetrics.scrapeInterval`、`serviceMesh.*.scrapeInterval`、`coreDns.scrapeInterval`、`csi.scrapeInterval`。

### 调整项 4 — 控制指标基数上限

基数（不同时间序列的数量）与频率同样重要，因为每个序列都是单独存储和计费的。

- **cAdvisor 是有意加了允许列表的。** cAdvisor 接收器（默认开启）可以发出数百个指标；该 chart 只转发用于驱动监视器的少数几个（`cadvisor.metricsAllowlist`）。请保持该列表精简——**每个条目都是按容器保留的，因此一个额外的指标会乘以集群的容器数量。** kube-state-metrics 默认是关闭的，但如果你启用它（`kubeStateMetrics.enabled=true`），它的 `kubeStateMetrics.metricsAllowlist` 会以同样的方式限制基数。
- **每 PVC 的卷指标**（`kubeletstats.volumeMetrics.enabled`，默认开启）为每个 Pod 的每个 PVC 发出一个序列。这对大多数集群来说没问题，但在拥有数千个 PVC 的有状态工作负载（Kafka、数据库）上可能会很可观——如果你不关注 PVC 磁盘空间，请在那里关闭它：

  ```bash
  --set kubeletstats.volumeMetrics.enabled=false
  ```

- **饱和度指标**（`kubeletstats.utilizationMetrics.enabled`，默认开启）会增加 8 个派生的“占 request/limit 百分比”系列。它们开销很低（无需额外抓取），但如果你不使用 CPU/内存相对于 limit 的监视器，可以用 `--set kubeletstats.utilizationMetrics.enabled=false` 去掉它们。

- **按名称丢弃特定指标。** 上面的允许列表是按接收器划分的；`filters.metrics.exclude` 会作用于所有接收器，因此对于接收器级旋钮无法表达的任何内容，请使用它：

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set filters.metrics.matchType=regexp \
    --set-json 'filters.metrics.exclude=["^container_network_"]'
  ```

  有关精确匹配与正则匹配的对比以及允许列表的形式，请参阅[按名称包含或排除指标](#按名称包含或排除指标)。

- **要丢弃整个命名空间的指标？请添加作用域为 metrics 的 exclude 规则。按 Pod 和容器划分的序列会被过滤，不带命名空间的节点和集群序列会保留。**

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set-json 'namespaceFilters.rules=[{"action":"exclude","namespaces":["noisy-*"],"scopes":["metrics"]}]'
  ```

### 调整项 5 — 让重型的可选启用功能保持关闭

这些功能**默认是关闭的**，正是因为它们会增加负载——只有当你确实在使用它所驱动的功能时才启用它，如果你只是想试用一下，请把它重新关闭：

| 值                                                        | 增加了什么                                                             |
| --------------------------------------------------------- | ---------------------------------------------------------------------- |
| `profiling.enabled`                                       | 持续 CPU 性能分析 DaemonSet——比 eBPF 追踪更重                          |
| `auditLogs.enabled`                                       | 将每个 Kubernetes API 请求作为一条日志记录（高数据量）                 |
| `controlPlane.enabled`                                    | etcd / API-server / scheduler / controller-manager 指标                |
| `kubeStateMetrics.enabled`                                | CrashLoop / ImagePull / 调度原因指标（增加一个 KSM Deployment + 抓取） |
| `ebpf.features.networkInterZoneMetrics`                   | 使网络流量指标基数翻倍                                                 |
| `serviceMesh.enabled` / `csi.enabled` / `coreDns.enabled` | 额外的 Prometheus 抓取作业                                             |

### 调整项 6 — 采样追踪，而不是丢弃它们

上面每一个调整项换来的数据量削减，都要以放弃某样东西为代价：一个你不再观察的命名空间、一个你不再保留的严重性、一个你不再采集的指标系列。采样是个例外，而在繁忙的集群上，它往往是以最小的损失换来的最大一笔削减：

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set sampling.traces.percentage=10
```

这是追踪数据量 90% 的削减，而它带来的损失比这里的任何其他调整项都要窄：

- 你保留下来的追踪是**完整的**——采样决策对追踪 ID 做哈希，因此一条追踪的所有 span 共享同一个决策。你得到的是更少的追踪，而不是残缺的追踪。
- 你的 **RED 指标保持精确**。请求速率、错误率和持续时间由 OBI 根据每一个请求计算，并且走的是指标流水线，而采样器并不在这条流水线上。构建在它们之上的每一个仪表板和监视器读数都与之前完全相同。

你放弃的主要是示例追踪：当一个监视器触发时，你能打开的追踪只有原来的十分之一。在一个每秒处理数千个完全相同请求的集群上，这通常是一笔划算的交易——第一百个一模一样的 `/healthz` span 并不会告诉你第一个没告诉你的任何东西。而在一个安静的集群上，这笔交易并不划算，因为你可能一个出问题的稀有请求的样本都没有。

例外情况，也是你在推广之前要检查的那一件事：那些统计 **span** 而非指标的监视器——基于 `Span Count` 的 Traces、基于 `Exception Count` 的 Exceptions——看到的数量会按比例减少，因此它们的阈值需要按同样的倍数重新调校。参见[追踪采样](#追踪采样)。

当 eBPF 追踪在你的摄取量中占很大比例，但你仍然想让服务地图和 RED 指标保持完好时，就用这一项。如果你想彻底停止对某样东西埋点，请优先选择调整项 2。

有关完整行为——包括为什么 `0` 是一个采样率而不是一个开关，以及为什么没有日志或指标的对应项——请参阅[追踪采样](#追踪采样)。

### 一个精简的起点

如果你想要更小的占用但仍希望监视器能正常工作，这份配置会保留**完整的指标覆盖范围**，并削减真正驱动数据量的两样东西——日志行和 eBPF span：

```yaml
# lean-values.yaml
oneuptime:
  url: YOUR_ONEUPTIME_URL
  apiKey: YOUR_ONEUPTIME_API_KEY
clusterName: my-cluster

# Halve the metric data points. Coarser resolution, same coverage.
collectionInterval: 60s
hostMetrics:
  collectionInterval: 60s
cadvisor:
  scrapeInterval: 60s

# 保留 Pod 日志，但只发送值得告警的那些。
#（指标不依赖于此——节点采集器无论如何都会运行。）
logs:
  enabled: true
  mode: daemonset

filters:
  logs:
    minSeverity: WARN # drop INFO / DEBUG / TRACE at the agent

namespaceFilters:
  rules:
    - action: exclude
      namespaces: [kube-system]
      scopes: [podLogs, ebpfDiscovery]
    - action: exclude
      namespaces: [noisy-*]
      scopes: [podLogs]

ebpf:
  enabled: true
  features:
    networkMetrics: false # the heaviest eBPF families
    tcpStats: false
    spanMetrics: false
```

```bash
helm upgrade --install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --create-namespace \
  -f lean-values.yaml
```

可按需进一步收紧：将 minSeverity 提高到 ERROR，把 metrics 添加到命名空间规则的 scopes，或者在已通过 OTel SDK 发送追踪时设置 ebpf.enabled=false。

> **注意你所削减的内容。** 某些监视器依赖特定的信号：禁用 `cadvisor` 会移除 OOM-kill 和 CPU 限流监视器；禁用 `kubeletstats.volumeMetrics` 会移除 PVC 磁盘空间不足监视器；禁用日志会移除基于日志的告警；而 `sampling.traces.percentage` 不会移除某个监视器，但会按比例缩小那些基于 span 的监视器（基于 `Span Count` 的 Traces、基于 `Exception Count` 的 Exceptions），因此请相应地重新调校它们的阈值。请削减你不会据以采取行动的信号，而不是某个监视器正在监视的信号。

### 衡量效果

遥测用量是按天汇总的，因此请在 **Project Settings → Usage History** 下查看一两天内的趋势以确认下降——它不会在你应用更改的那一刻立即变化。每次只更改一个调整项，这样你就能把差异归因于它——先关闭日志，然后调高间隔，再精简 eBPF——而不是一次性把所有内容都调低，结果丢失了一个你实际依赖的监视器。

## 故障排查

> **最快路径——运行诊断脚本。** 它会检查 Pod 健康状况、解码并验证摄取密钥、检查你的集群能否连通 OneUptime，并询问 OneUptime 你的令牌是否真的被接受——然后打印出单一的根因结论：
>
> ```bash
> curl -fsSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/HelmChart/Public/kubernetes-agent/troubleshoot.sh \
>   | bash -s -- -n oneuptime-agent
> ```
>
> 它只读取集群状态并运行几个探测；不会更改任何内容。为了获得最准确的出口测试，请先使用 `--set debug.enabled=true` 安装（这会向代理 Pod 添加一个小型的 network-tools sidecar，以便脚本测试采集器的确切出口路径），然后重新运行。

### 安装失败并提示 "hostPath volumes are not allowed" 或 Pod Security 准入错误

你的集群阻止了 `hostPath`——这在 **GKE Autopilot** 和 **EKS Fargate** 上很常见。切换到 API 模式的预设：

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set preset=gke-autopilot   # or eks-fargate
```

### 代理显示 "Disconnected"

集群的连接状态完全由到达的遥测数据驱动——如果没有数据到达，集群会在约 15 分钟后被标记为断开连接。因此 "disconnected" 和 "no metrics" 几乎总是出于**相同**的原因：代理的遥测数据未被接受。

最常见的原因——尤其是在重新安装之后——是**错误或已吊销的摄取密钥**。这很容易被忽略，因为 OTLP 摄取端点即使对于错误的令牌也会刻意返回 HTTP `200`（这样一个配置错误的采集器就不会对服务器发起重试风暴）。结果是：采集器报告成功，其日志中没有错误，而数据被悄悄丢弃。

1. 检查代理 Pod 是否正在运行：`kubectl get pods -n oneuptime-agent`
2. 检查 metrics-collector 日志：`kubectl logs -n oneuptime-agent -l component=metrics-collector -c otel-collector`（这里没有错误并**不**意味着数据正在到达——见上文）
3. **验证摄取密钥。** 直接询问 OneUptime 你的令牌是否被接受（`200` = 有效，`401` = 未知/已吊销）：

   ```bash
   curl -i -H "x-oneuptime-token: <YOUR_API_KEY>" https://oneuptime.com/otlp/v1/validate
   ```

   如果它返回 `401`，则你发布版本中的密钥是错误的或已被吊销。从 _Project Settings → Telemetry Ingestion Keys_ 复制一个有效的密钥并重新部署：

   ```bash
   helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
     --namespace oneuptime-agent --reuse-values \
     --set oneuptime.apiKey=<LIVE_KEY>
   ```

4. 验证你的 OneUptime URL 是否正确，以及你的集群能否通过网络连通它。
5. 如果你在重新安装时更改了 `clusterName`，代理会显示为一个**新**集群——旧条目仍保持 "Disconnected"（这是预期的；它已经过时了）。

### 没有日志出现（仅 API 模式）

1. 确认日志拉取器 Pod 处于 Ready 状态：`kubectl get pods -n oneuptime-agent -l component=log-collector`
2. 检查它的 `/healthz`——它会报告活跃流的数量和最近一次导出错误
3. 检查日志：`kubectl logs -n oneuptime-agent deployment/kubernetes-agent-logs`
4. 对于超大型集群，单个副本可能成为瓶颈；请在 namespaceFilters.rules 中使用 podLogs 作用域的 include 规则，将不同发布分片。

### 没有指标出现

1. 首先排除被拒绝的摄取密钥——这是最常见的原因，并且从代理一侧是不可见的。参见上文的 [代理显示 "Disconnected"](#代理显示-disconnected)（或直接运行诊断脚本）。
2. 检查集群标识符是否与你作为 `clusterName` 传递的值匹配
3. 验证 RBAC 权限：`kubectl get clusterrolebinding | grep kubernetes-agent`
4. 检查 OTel 采集器日志中的导出错误

### eBPF Pod 处于 CrashLoopBackOff 或无法启动

```bash
kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200
```

常见原因：

- **内核太旧或缺少 BTF。** OBI 需要启用 BTF 的 Linux 5.8+。在节点上运行 `uname -r`。如果你无法升级，请禁用 eBPF：`--set ebpf.enabled=false`。
- **特权 Pod 被阻止。** 某些集群拒绝特权 Pod（GKE Autopilot、EKS Fargate 以及锁定的环境）。请禁用 eBPF。
- **主机上未挂载 `debugfs` / `tracefs`。** `tcpStats` 功能会附加到需要它们的内核 tracepoint。该 chart 通过 `hostPath` 挂载两者——但如果你的主机不暴露它们，请仅禁用该系列：`--set ebpf.features.tcpStats=false`。

### 没有应用追踪出现

1. 确认 eBPF DaemonSet 健康：`kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`
2. 打开调试追踪打印器以确认 OBI 正在捕获流量：`--set ebpf.printTraces=true --set ebpf.logLevel=debug`，然后检查 `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`
3. 如果你在 OBI 的 stdout 中看到了 span 但在仪表板中没有，则问题出在采集器 → OneUptime 的导出上——检查 metrics-collector Pod 的日志。

## 后续步骤

- 在此代理采集的指标之上配置 **Kubernetes 监视器**——参见 [Kubernetes 代理（监视器）](/docs/monitor/kubernetes-agent)。
- 添加**日志监视器**以针对特定日志模式发出告警（例如，每个 Pod 或每个命名空间的错误计数超过阈值）。
- 对于非 Kubernetes 主机（Linux / macOS / Windows 虚拟机和裸机），请使用 [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector) 页面。
