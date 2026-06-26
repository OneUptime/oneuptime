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

默认情况下，`kube-system` 会被排除。要仅监控特定命名空间：

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set "namespaceFilters.include={default,production,staging}"
```

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
