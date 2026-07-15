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

在**标准**集群上，你会看到一个 metrics-collector Deployment，外加每个节点一个 log-collector DaemonSet Pod：

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-xxxxx                   1/1     Running   0          1m
kubernetes-agent-logs-yyyyy                   1/1     Running   0          1m
```

在 **GKE Autopilot** 或 **EKS Fargate** 上，你会看到两个 Deployment（没有 DaemonSet）：

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-yyyyyyyyyy-yyyyy        1/1     Running   0          1m
```

代理连接成功后，你的集群将自动出现在 OneUptime 仪表板的 **Kubernetes** 部分。

## 配置选项

### 命名空间过滤

`namespaceFilters` 会将 **Pod 日志**（既包括 hostPath DaemonSet，也包括 API 日志拉取器）以及 **eBPF 追踪**限定到你所选择的命名空间。默认情况下，`kube-system` 会被排除。要将这些信号限制到特定命名空间：

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set "namespaceFilters.include={default,production,staging}"
```

要在保留其他所有命名空间的同时忽略某一个噪声较大的命名空间，请改用 `exclude`。`exclude` 始终优先于 `include`，且随 chart 提供的默认值是 `[kube-system]`——因此如果你仍希望排除它，请再次把它列出来：

```bash
  --set "namespaceFilters.exclude={kube-system,noisy-namespace}"
```

对于 **Pod 日志和 eBPF 追踪，这不会带来任何开销**：命名空间是 Pod 日志路径以及 OBI 进程发现的一部分，因此被过滤掉的命名空间从一开始就不会被读取——没有 CPU 开销，也没有出口流量。

#### 将命名空间过滤器应用于指标和追踪

默认情况下，上面的列表仅涵盖 Pod 日志和 eBPF 追踪。`applyTo` 会将它们扩展到其他信号：

```bash
  --set namespaceFilters.applyTo.metrics=true \
  --set namespaceFilters.applyTo.traces=true
```

| 设置 | 它涵盖的内容 |
| ------- | -------------- |
| `applyTo.metrics` | 来自 kubeletstats、cAdvisor 和 kube-state-metrics 的每 Pod / 每容器指标 |
| `applyTo.traces` | 你的应用推送到代理 OTLP 端点的 span（eBPF span 已经被限定了范围） |

两者**默认都是关闭的**，这是有意为之。`exclude: [kube-system]` 是随 chart 提供的默认值，因此自动开启它们会在升级时悄悄地从每一个现有安装中删除 kube-system 的指标。

> **节点级和集群级指标始终会被保留。** 命名空间是 Pod 的属性，而不是节点的属性，因此像节点 CPU、节点内存和文件系统使用率这样的序列没有任何可供匹配的内容，也就永远不会被丢弃。`applyTo.metrics` 会削减每 Pod 的基数，但绝不会让你对某个节点出问题视而不见。

Kubernetes **事件**无法在代理侧按命名空间过滤。它们来自 `k8sobjects` 接收器，且不带 `k8s.namespace.name` 属性——命名空间在事件正文内部——因此过滤器没有任何可匹配的内容。请改为在服务端丢弃它们（见下文）。

### 按日志严重性过滤

`filters.logs.minSeverity` 会在代理侧、在发送任何内容之前，丢弃低于某个严重性的日志记录：

```bash
  --set filters.logs.minSeverity=WARN
```

接受 `TRACE`、`DEBUG`、`INFO`、`WARN`、`ERROR`、`FATAL`。`WARN` 会保留 WARN、ERROR 和 FATAL，并丢弃 INFO、DEBUG 和 TRACE。默认值（`""`）会保留所有内容。

即使容器运行时并不会在日志行上记录严重性，这也依然有效：代理会从日志文本中解析出一个严重性（`[ERROR]`、`WARN:`、`level=info`，……），并回退到 `stderr → ERROR` / `stdout → INFO`。它在**两种**日志模式下都适用——在 `daemonset` 模式下通过采集器，在 `api` 模式下则在日志拉取器内部——因此预设不会在你不知情的情况下改变这一行为。

> 严重性仍然无法确定的记录会被**保留**，绝不会被丢弃。对过滤器而言，安全的失败方式是发送得过多，而不是悄悄删除一条没人知道其未被分类的日志。

### 按名称包含或排除指标

`filters.metrics` 用于控制哪些指标可以离开集群，它作用于流水线中的每一个接收器。

**丢弃少数几个噪声较大的指标**（一个拒绝列表——通常这就是你想要的）：

```bash
  --set-json 'filters.metrics.exclude=["k8s.volume.available","k8s.volume.capacity"]'
```

**只发送一组固定的指标**（一个允许列表——其他所有内容都会被丢弃）：

```bash
  --set-json 'filters.metrics.include=["k8s.pod.cpu.usage","k8s.pod.memory.usage"]'
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

### 禁用日志采集

如果你只需要指标和事件（不需要 Pod 日志）：

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set logs.enabled=false
```

### 强制使用特定的日志采集模式

高级用户可以使用 `logs.mode` 覆盖预设的选择：

- `logs.mode=daemonset` — hostPath DaemonSet（开销最低，需要 hostPath）
- `logs.mode=api` — Kubernetes API 日志拉取器 Deployment（适用于任何集群）
- `logs.mode=disabled` — 不进行日志采集

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
| **eBPF 追踪与 span 指标** | 来自每个被埋点进程的每个请求一条追踪     | `ebpf.enabled`、`ebpf.features.*`、`ebpf.autoTargetExe`、`ebpf.excludeExePaths`              |
| **指标数据点**            | 抓取频率 × Pod/容器数量                  | `collectionInterval`、`hostMetrics.collectionInterval`、`cadvisor.scrapeInterval`            |
| **指标基数**              | 不同序列的数量（每容器、每 PVC，……）     | `filters.metrics.exclude`、`namespaceFilters.applyTo.metrics`、`cadvisor.metricsAllowlist`、`kubeletstats.volumeMetrics` |
| **可选启用的额外项**      | 性能分析、审计日志、控制平面、跨区域指标 | 让它们保持关闭（它们默认已经是关闭的）                                                       |

削减数据量有两种方式，值得弄清楚你正在使用的是哪一种：

- **在接收器处**——数据从不会被采集。作用于 Pod 日志的 `namespaceFilters`、`cadvisor.metricsAllowlist`、更长的 `collectionInterval`。它的运行开销为零，并且同时节省 CPU、出口流量和摄取量。只要能覆盖你的场景，就应始终优先选择这些方式。
- **在 filter 处理器处**——数据会被采集，然后在导出前被丢弃。`filters.logs.minSeverity`、`filters.metrics.*`、`namespaceFilters.applyTo.*`。采集器的 CPU 开销略高，但它可以跨接收器生效，并且能表达接收器无法表达的内容。

两者都是**不可逆的**：你在此处丢弃的数据永远不会到达 OneUptime，任何构建在其之上的监视器都会陷入沉默。如果你更希望以后再做决定，OneUptime 可以改为在服务端丢弃数据（**Logs → Settings → Drop Filters**、**Metrics → Settings → Pipeline Rules**）——那样仍然会产生出口流量，但它是一项你无需重新部署即可更改的设置。

### 调整项 1 — Pod 日志通常是最大的单一来源

容器日志几乎总是摄取量中最大的部分，因为它是集群中每个容器的每一行日志对应一条记录。

- **只想要某些命名空间的日志？** `namespaceFilters` 会在两种日志模式下限定 Pod 日志（以及随之而来的 eBPF 追踪）。匹配发生在 Pod 日志路径上，因此被过滤掉的命名空间甚至从不会被读取——这是本文档中开销最低的调整项：

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set "namespaceFilters.include={default,production}"
  ```

  （`kube-system` 默认已被排除。）若要保留除某一个之外的所有命名空间，请使用 `--set "namespaceFilters.exclude={kube-system,noisy-namespace}"`。

- **只关心警告和错误？** `filters.logs.minSeverity` 会在代理侧丢弃其余内容。在一个话痨般的集群上，这往往是可用的最大单项削减，因为 INFO 和 DEBUG 占了大多数应用输出的绝大部分：

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set filters.logs.minSeverity=WARN
  ```

  有关严重性是如何确定的，以及无法分类的日志会如何处理，请参阅[按日志严重性过滤](#filtering-by-log-severity)。

- **完全不需要 OneUptime 中的 Pod 日志？** 将它们关闭：

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set logs.enabled=false
  ```

  > **这同时也会禁用节点、Pod、容器和主机指标。** kubelet、cAdvisor 和 hostmetrics 接收器全都位于同一个 log-collector DaemonSet 中，因此关闭 Pod 日志也会一并移除它们——以及 OOM-kill、CPU 限流和 PVC 磁盘空间不足监视器。`logs.mode: api` 和 `logs.mode: disabled` 同理。
  >
  > 如果你想要更少的日志但想保留指标，请继续使用 `logs.mode: daemonset`，并转而采用上面的 `namespaceFilters` 或 `filters.logs.minSeverity`。

### 调整项 2 — 精简 eBPF 自动埋点

eBPF 无需更改代码即可为你提供追踪、RED 指标、服务地图和网络流量指标——但它也是第二大的数据来源，因为它为每个请求发出一个 span，并为每个服务发出多个指标系列。你有三个层级的控制方式：

- **已经通过 OTel SDK 发送追踪，或者不想要自动追踪？** 彻底关闭 eBPF：

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.enabled=false
  ```

- **保留追踪，去掉高开销的指标系列。** 上面的[信号系列表](#toggle-individual-signal-families)列出了每个 `ebpf.features.*` 标志。数据量最大的系列是网络指标和 span 指标——关闭它们会让追踪、HTTP RED 指标和服务地图保持完好：

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

  有关完整的默认值，请参阅[切换单个信号系列](#toggle-individual-signal-families)以及 chart values 中的 `excludeExePaths` 说明。

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

  有关精确匹配与正则匹配的对比以及允许列表的形式，请参阅[按名称包含或排除指标](#including-or-excluding-metrics-by-name)。

- **丢弃整个命名空间的指标。** 如果某个命名空间噪声很大，但你仍希望监视它所在的节点，`namespaceFilters.applyTo.metrics=true` 会把你现有的命名空间列表应用到每 Pod 和每容器的序列上。节点级和集群级序列始终会被保留：

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set namespaceFilters.applyTo.metrics=true
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

# Keep the DaemonSet — it is what collects kubelet, cAdvisor and host
# metrics as well as logs — but only ship logs worth alerting on.
logs:
  enabled: true
  mode: daemonset

filters:
  logs:
    minSeverity: WARN # drop INFO / DEBUG / TRACE at the agent

namespaceFilters:
  exclude:
    - kube-system
    - noisy-namespace

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

按需进一步收紧：把 `minSeverity` 提高到 `ERROR`、添加 `namespaceFilters.applyTo.metrics=true`，或者如果你已经从 OTel SDK 发送追踪，则设置 `ebpf.enabled=false`。

> **注意你所削减的内容。** 某些监视器依赖特定的信号：禁用 `cadvisor` 会移除 OOM-kill 和 CPU 限流监视器；禁用 `kubeletstats.volumeMetrics` 会移除 PVC 磁盘空间不足监视器；禁用日志（或关闭 DaemonSet）会移除基于日志的告警*以及*你的节点指标。请削减你不会据以采取行动的信号，而不是某个监视器正在监视的信号。

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
4. 对于非常大的集群，单个副本可能成为瓶颈——在单独的发布版本上使用 `namespaceFilters.include` 按命名空间分片

### 没有指标出现

1. 首先排除被拒绝的摄取密钥——这是最常见的原因，并且从代理一侧是不可见的。参见上文的 [代理显示 "Disconnected"](#agent-shows-disconnected)（或直接运行诊断脚本）。
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
