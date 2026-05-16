# 安装 Kubernetes Agent

OneUptime Kubernetes 代理从您的 Kubernetes 集群中收集集群指标、事件、Pod 日志、**应用追踪（通过 eBPF 采集 HTTP/gRPC）**、**持续的 CPU 火焰图（eBPF profiler）**以及**操作系统级节点指标**，并将这些数据发送到 OneUptime。它以 Helm chart 的形式分发，只需一条命令即可安装 —— eBPF 自动埋点和性能分析默认均已启用，因此您无需修改任何代码即可看到服务级别的追踪、RED 指标和火焰图。

## 快速开始

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

几分钟内您的集群就会出现在 OneUptime 中。

## 为您的集群选择合适的预设

不同的 Kubernetes 发行版有不同的约束 —— 最显著的是工作负载是否可以挂载 `hostPath` 卷。chart 没有强迫您阅读安全文档，而是公开了一个顶层选项：`preset`。

| Preset | 适用场景 | 日志采集方式 | 备注 |
| --- | --- | --- | --- |
| `standard`（默认） | 自管集群、**EC2 上的 EKS**、**GKE Standard**、**AKS**、minikube、kind、k3s | 通过 hostPath 读取 `/var/log/pods` 的 DaemonSet | 开销最低。这些平台上 hostPath 可用。 |
| `gke-autopilot` | **GKE Autopilot** | 使用 Kubernetes API 的日志收集器（Deployment） | Autopilot 上禁用 hostPath。设置了一个加固的安全上下文，可以通过 Autopilot 的 Pod Security Standards。 |
| `eks-fargate` | **EKS Fargate** | 使用 Kubernetes API 的日志收集器（Deployment） | 与 `gke-autopilot` 相同。Fargate 禁用 hostPath 和 DaemonSet。 |

如果不确定，可以不设置 `preset` —— 这样会使用 `standard` 默认值。如果您的集群因 Pod Security 策略错误（提及 `hostPath`）而拒绝安装，请切换到 `gke-autopilot`（或在 EKS Fargate 上切换到 `eks-fargate`），然后重新安装。

### 示例

**GKE Standard、EC2 上的 EKS、自管集群或 AKS：**

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

## 两种日志采集模式的区别

实际上 `preset` 会设置 `logs.mode` —— 如果需要覆盖预设的默认值，您也可以直接设置该项。

### DaemonSet 模式（`logs.mode: daemonset`）

DaemonSet 在每个节点上运行一个 OpenTelemetry Collector pod。它通过 hostPath 卷读取 `/var/log/pods/` 下的日志文件，并通过 OTLP 转发。

- **优点：** 开销最低，随节点数量线性扩展，不会给 Kubernetes API 服务器增加负载，并能处理日志轮转。
- **缺点：** 需要 hostPath，需要调度 DaemonSet 的能力 —— GKE Autopilot 和 EKS Fargate 上两者都不可用。

### API 模式（`logs.mode: api`）

单副本 Deployment（`oneuptime/kubernetes-log-tailer` 镜像）使用 Kubernetes API 来流式获取容器日志 —— 与 `kubectl logs -f` 使用的是同一个端点。无需 hostPath、无需主机访问、无需 DaemonSet。

- **优点：** 可在 GKE Autopilot、EKS Fargate 以及任何禁用 hostPath 或强制使用 `restricted` Pod Security Standard 的集群上运行。
- **缺点：** 每个容器流都是与 `kube-apiserver` 建立的长连接。实际使用中，一个副本可以从容处理几千个容器。对于非常大的集群，可以按命名空间分片，使用 `logs.api.replicas` 加上每个副本上的 `namespaceFilters.include`。

### 应该使用哪种模式？

如果 hostPath 可用，请使用 DaemonSet。其他情况下，使用 API 模式。`preset` 设置会为您选择正确的模式。

您还可以通过 `--set logs.enabled=false` 完全禁用日志采集，转而通过 OpenTelemetry SDK 发送应用日志。请参阅 [OpenTelemetry](/docs/telemetry/open-telemetry) 文档。

## 通过 eBPF 采集应用追踪和 HTTP 请求（默认启用）

chart 在每个节点上部署一个运行 [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) 的 DaemonSet。OBI 将 eBPF 程序加载到 Linux 内核中，监视套接字级流量，从节点上的每个 Pod 重建 HTTP/HTTPS、gRPC 和 SQL/Redis 调用 —— 无需修改代码、无需 SDK、无需 sidecar。捕获到的流量以 OTLP 追踪和请求/延迟指标的形式直接导出到 OneUptime。

安装完成后一两分钟内，您的服务就会出现在 **Telemetry → Traces** 和服务图谱中，并将 `k8s.cluster.name` 设置为您的 `clusterName`，便于按集群过滤。

### 何时关闭

eBPF **默认启用**。在以下情况下您应该禁用它（`--set ebpf.enabled=false`）：

- 您在 **GKE Autopilot** 或 **EKS Fargate** 上安装。这些平台禁止特权 Pod，而 OBI 需要特权模式才能加载 eBPF 程序。
- 您的节点运行的内核版本早于 **Linux 5.8** 且未回移植 BTF。（现代发行版 —— Debian 11+、Ubuntu 20.10+、Fedora 34+、RHEL/Stream 9+ —— 都没问题。）
- 您已经在应用中通过 OpenTelemetry SDK 发送追踪，不希望产生重复数据。

### 发送的数据

OBI 从捕获的流量中提取多种信号家族。所有信号默认都已启用；每个都可以通过 `--set ebpf.features.<key>=false` 独立禁用：

| 信号 | 默认 | 增加的内容 |
| --- | --- | --- |
| `ebpf.features.httpMetrics` | on | 每个服务的 HTTP/gRPC RED 指标 —— 请求速率、延迟直方图、错误数量。 |
| `ebpf.features.spanMetrics` | on | 以 span 属性为键的指标：请求大小、响应大小、按路由/操作细分的耗时。 |
| `ebpf.features.serviceGraph` | on | 服务间边的指标（调用方 → 被调方的请求速率 + 延迟）。为服务图谱提供数据。 |
| `ebpf.features.hostMetrics` | on | 每个被埋点进程的 CPU 和内存 —— 对于基本的容量问题，可省去单独运行性能分析器。 |
| `ebpf.features.networkMetrics` | on | 带 k8s 元数据的 Pod 间 TCP/UDP 流字节和数据包计数器。展现每对相互通信的 Pod，包括运行 OBI 无法解析的协议的 Pod。 |
| `ebpf.features.networkInterZoneMetrics` | off | 网络指标的跨可用区版本。基数会加倍；只有在确实使用基于可用区调度时才值得启用。 |
| `ebpf.features.tcpStats` | on | 节点级 TCP 统计信息：RTT 直方图、失败连接数、重传次数。 |

OBI 默认还会跨服务边界传播追踪上下文。当 pod A 向 pod B 发起 HTTP/gRPC 请求时，OBI 会向出站请求注入 W3C `traceparent` 头 —— 这样 pod B 端生成的 span 就会与 pod A 的出站 span 链接到同一个 trace。两端应用都不需要修改 SDK。

| 选项 | 默认 | 描述 |
| --- | --- | --- |
| `ebpf.contextPropagation` | on | 向出站流量注入 W3C `traceparent`（HTTP 头 + 自定义 TCP 选项）。设为 `false` 可让每个服务的 span 保持本地。 |
| `ebpf.trackRequestHeaders` | on | 内核侧的请求头跟踪，使传播在普通 HTTP 服务器（非 Go、非 TLS）上也能工作。仅在 `contextPropagation` 为 true 时生效。 |

### 日志 ↔ 追踪关联

默认也启用。OBI 的日志增强器拦截被埋点进程的 Pod stdout 写入，并：

- 对于 **JSON 格式日志**：向日志行中注入 `trace_id` 和 `span_id` 字段（日志中任何已有的值都会被保留）。然后 filelog DaemonSet 将这些字段提升到 LogRecord 的原生 trace_id/span_id 槽位，因此在追踪视图中点击某个 span 即可跳转到 OneUptime 中的对应日志 —— 反之，点击某条日志行就可以跳到其父 trace。
- 对于 **非 JSON 日志**：日志行保持原样 —— 仍然会被采集，但不会自动关联。

| 选项 | 默认 | 描述 |
| --- | --- | --- |
| `ebpf.logToTraceCorrelation` | on | 启用 OBI 日志增强器和 filelog 流水线的 trace_id 提升。设为 `false` 可跳过两者。 |

注意事项：

- **日志必须是 JSON 格式，trace_id 才会出现。** 将您的日志记录器切换为 JSON 格式 —— `structlog`、`pino`、`winston`、`serilog`、`logback-json`、klog `--logging-format=json` 等。
- **缓冲的 stdout 会破坏关联**，因为 `write()` 系统调用发生在与处理请求的线程不同的线程上。常见修复方法：
  - **Python**：设置 `PYTHONUNBUFFERED=1`（运行时在非 TTY 时会对 stdout 进行块缓冲）。
  - **.NET**：启动时执行 `Console.SetOut(new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true })`。Microsoft.Extensions.Logging 的 `AddConsole()` 和 Serilog 的异步 sink 也不能工作 —— 请切换到同步控制台写入器（Serilog 默认的 `WriteTo.Console()` 没有问题）。
- Greenlet / gevent、Tornado 以及其他自定义异步运行时不在覆盖范围内。

### 调优

| 选项 | 默认 | 描述 |
| --- | --- | --- |
| `ebpf.enabled` | `true` | 总开关。设为 `false` 可完全跳过 eBPF DaemonSet。 |
| `ebpf.image.tag` | `v0.9.0` | OBI 镜像标签。OBI 仍处于 1.0 之前；请固定到一个已知良好的版本，并在升级时重新测试。 |
| `ebpf.autoTargetExe` | `*` | 要进行埋点的可执行文件 glob 模式。如果想缩小自动埋点范围（例如 `*/python,*/java`），请收窄此项。 |
| `ebpf.excludeExePaths` | （shell、kubelet、runc、containerd、otelcol、OBI 自身） | 要跳过的逗号分隔 glob 模式。 |
| `ebpf.logLevel` | `info` | `debug`、`info`、`warn` 或 `error`。排查问题时设为 `debug`。 |
| `ebpf.printTraces` | `false` | 除 OTLP 导出外还将 span 打印到 OBI 的 stdout —— 在安装期间验证捕获很有用。 |
| `ebpf.resources.*` | requests `100m / 256Mi`、limits `1000m / 1Gi` | 对于高流量集群可调大。 |

要检查 OBI 是否正在运行并看到流量：

```bash
kubectl get pods -n oneuptime-kubernetes-agent -l component=ebpf-instrument
kubectl logs -n oneuptime-kubernetes-agent -l component=ebpf-instrument --tail=200
```

## 持续 CPU 性能分析（默认启用）

另一个独立的 DaemonSet 运行 [OpenTelemetry eBPF Profiler](https://github.com/open-telemetry/opentelemetry-ebpf-profiler) —— 以 `otel/opentelemetry-collector-ebpf-profiler` 镜像形式打包。它以 19Hz 在所有支持的运行时（Go、Java、.NET、Python、Ruby、Node.js、PHP、Perl、C/C++、Rust）上采样 on-CPU 调用栈，并将 OTLP profile 发送到 OneUptime，您可以在 **Telemetry → Performance Profiles** 中以及从单个 trace span 链接的火焰图中看到这些数据。

当 eBPF 自动埋点也启用时（`ebpf.enabled: true`，即默认值），每个 CPU 采样都会通过共享的 bpffs map 与 OBI 的追踪上下文相关联 —— 因此火焰图会携带 trace_id/span_id，OneUptime UI 可以为您展示每个 span 的火焰图。

要求：

- **Linux 内核 5.10+**（比 OBI 需要的 5.8 稍新）。
- 带有 hostPID 的特权 Pod —— 与 eBPF 自动埋点 DaemonSet 的限制相同。在 GKE Autopilot、EKS Fargate 和受锁定的环境中请禁用：`--set profiling.enabled=false`。

调优：

| 选项 | 默认 | 描述 |
| --- | --- | --- |
| `profiling.enabled` | `true` | 总开关。 |
| `profiling.image.tag` | `0.152.0` | `otel/opentelemetry-collector-ebpf-profiler` 镜像标签。性能分析器仍处于 1.0 之前；请固定到已知良好的版本。 |
| `profiling.samplesPerSecond` | `19` | 采样频率（Hz）。上游默认值；避免与常见定时器频率意外混叠。 |
| `profiling.offCpuThreshold` | `0` | (0–1] 启用 off-CPU 分析 —— 用于诊断锁竞争和阻塞 I/O。默认关闭，因为它会增加 tracepoint 开销。 |
| `profiling.tracers` | `""` *(所有运行时)* | 要加载的语言追踪器的逗号分隔列表。 |
| `profiling.obiProcessContext` | `true` | 将采样与 OBI 的追踪上下文相关联，以实现追踪 ↔ 性能分析的关联。 |

## 其他数据采集（host metrics、审计日志、CSI、CoreDNS）

chart 还可以采集：

| `<key>.enabled` | 默认 | 增加的内容 |
| --- | --- | --- |
| `hostMetrics` | on | 来自 `/proc` 和 `/sys` 的每节点操作系统指标 —— 磁盘 I/O 队列深度、文件系统 inode 使用率、NIC 错误计数、分页统计、负载平均值。位于日志收集器 DaemonSet 内（不增加额外 Pod）。 |
| `auditLogs` | off | 从主机读取 `/var/log/kubernetes/audit.log`。捕获每一个 Kubernetes API 请求 —— 谁对哪个资源执行了什么操作。仅适用于自管集群 —— 托管 K8s（EKS、GKE、AKS、DOKS）会将审计日志路由到云提供商的接收端。 |
| `csi` | off | 自动发现带有标签 `app=csi-driver`（或 `app.kubernetes.io/component=csi-driver`）的 Pod，并抓取其 Prometheus `metrics` 端口 —— 卷挂载/卸载延迟、配置失败、IOPS。 |
| `coreDns` | off | 在 `:9153/metrics` 上抓取集群的 CoreDNS 服务。展现查询速率、延迟、缓存命中率、错误数量 —— 这些是 P99 延迟的常见原因。 |

## 常用选项

| 选项 | 默认 | 描述 |
| --- | --- | --- |
| `preset` | （空 —— 视为 `standard`） | 见上表。 |
| `oneuptime.url` | *(必填)* | OneUptime 实例的 URL。 |
| `oneuptime.apiKey` | *(必填)* | 项目 API 密钥（Settings → API Keys）。 |
| `clusterName` | *(必填)* | 此集群的唯一名称。会作为 `k8s.cluster.name` 打到每条记录上。 |
| `namespaceFilters.include` | `[]` | 如果设置，则仅监控这些命名空间。 |
| `namespaceFilters.exclude` | `["kube-system"]` | 要跳过的命名空间。 |
| `logs.enabled` | `true` | 启用或禁用日志采集。 |
| `logs.mode` | （从 `preset` 派生） | `daemonset`、`api` 或 `disabled`。会覆盖预设。 |
| `logs.api.replicas` | `1` | 日志收集器 Deployment 的副本数（仅在 API 模式下）。 |
| `ebpf.enabled` | `true` | 通过 OpenTelemetry eBPF Instrumentation 自动捕获每个 Pod 的 HTTP/gRPC 追踪。请参阅上文章节。 |
| `profiling.enabled` | `true` | 通过 OpenTelemetry eBPF Profiler 持续生成 CPU 火焰图。请参阅上文章节。 |
| `hostMetrics.enabled` | `true` | 每个节点的操作系统指标。 |
| `auditLogs.enabled` | `false` | Kubernetes 审计日志采集（自管集群）。 |
| `csi.enabled` | `false` | CSI 驱动的 Prometheus 指标。 |
| `coreDns.enabled` | `false` | CoreDNS 的 Prometheus 指标。 |
| `controlPlane.enabled` | `false` | 抓取 etcd / api-server / scheduler / controller-manager。仅适用于自管集群 —— 托管产品（EKS/GKE/AKS）通常不暴露这些端点。 |

查看 [chart 的 `values.yaml`](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/kubernetes-agent/values.yaml) 获取完整列表。

## 升级

```bash
helm repo update
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values
```

`--reuse-values` 会保留您现有的配置；任何新增的 `--set` 覆盖项可以在其之上传入。

> **请注意：`--reuse-values` 不会合并 chart 的新默认值。** Helm 会原样复用您先前渲染的值 —— 因此较新 chart 版本中新增的任何顶层字段（例如 `profiling.*`、`ebpf.features.*`）在您现有的 release 中仍然未设置，模板渲染时就好像您禁用了它一样。
>
> **Helm 3.14+** —— 切换到 `--reset-then-reuse-values`。它会为您未覆盖的键重新读取 chart 默认值：
>
> ```bash
> helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
>   --namespace oneuptime-kubernetes-agent \
>   --reset-then-reuse-values
> ```
>
> **Helm 3.13 或更早版本** —— 去掉 `--reuse-values`，显式传入原始的 `--set` 标志（或 `-f values.yaml`）。对于您未覆盖的所有项，将会应用新的 chart 默认值。
>
> 如果升级后某项新功能的 Pod（例如 `kubernetes-agent-profiling-*`）没有出现，几乎总是因为这个原因。`helm get values <release>` 显示 Helm 实际持有的内容 —— 输出中缺失的字段意味着没有为它们合并默认值。

## 卸载

```bash
helm uninstall oneuptime-agent --namespace oneuptime-kubernetes-agent
kubectl delete namespace oneuptime-kubernetes-agent
```

## 故障排查

### 安装失败，提示 "hostPath volumes are not allowed"

您的集群禁用了 hostPath。请切换到 API 模式的预设：

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values \
  --set preset=gke-autopilot   # or eks-fargate
```

### OneUptime 中看不到日志

检查代理 Pod：

```bash
kubectl get pods -n oneuptime-kubernetes-agent
kubectl logs -n oneuptime-kubernetes-agent -l app.kubernetes.io/part-of=oneuptime --tail=200
```

在 API 模式下，日志收集器 Pod 在 13133 端口上暴露 `/healthz` —— 通过 `kubectl port-forward` 访问它可以获取导出状态快照。

### eBPF DaemonSet Pod 处于 `CrashLoopBackOff` 或无法启动

检查 OBI Pod 的日志：

```bash
kubectl logs -n oneuptime-kubernetes-agent -l component=ebpf-instrument --tail=200
```

常见原因：

- **内核太旧或缺少 BTF。** OBI 需要带有 BTF 的 Linux 5.8+。在节点上用 `uname -r` 检查。如果无法升级，请禁用 eBPF：`--set ebpf.enabled=false`。
- **特权 Pod 被阻止。** 某些集群即使不是 Autopilot/Fargate 也会拒绝特权 Pod。请禁用 eBPF。
- **OBI 正在运行但仪表板中没有追踪。** 设置 `--set ebpf.printTraces=true` 并查看 OBI 的 stdout —— 如果您在那里看到了 span，那么问题在于 OTLP 投递（请检查 `OTEL_EXPORTER_OTLP_ENDPOINT` 以及您的 OneUptime URL/API key）。如果看不到 span，则 OBI 监视的流量可能全部被 OBI 无法拦截的 TLS 库加密（例如它无法识别的静态链接 TLS 实现）。

### 我的集群对一个日志收集器副本来说 Pod 太多了（仅 API 模式）

通过对命名空间分片来横向扩展。为每个命名空间组部署一次：

```bash
helm install oneuptime-agent-ns-a oneuptime/kubernetes-agent \
  --set preset=gke-autopilot \
  --set namespaceFilters.include={app-a,app-b} \
  ...
```

或者，调大 `logs.api.replicas` —— 但请注意每个副本都会处理所有被允许的命名空间，因此为了去重您仍然需要按命名空间分片。
