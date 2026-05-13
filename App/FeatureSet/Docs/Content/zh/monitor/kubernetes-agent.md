# 安装 Kubernetes Agent

OneUptime Kubernetes Agent 从您的 Kubernetes 集群收集集群指标、事件和 Pod 日志，并将它们发送到 OneUptime。它以 Helm Chart 的形式分发。

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

您的集群将在几分钟内出现在 OneUptime 中。

## 为您的集群选择合适的预设

不同的 Kubernetes 发行版有不同的限制——最显著的是工作负载是否可以挂载 `hostPath` 卷。Chart 提供了一个顶级选项 `preset`，而无需阅读安全文档。

| 预设 | 适用于 | 日志收集 | 备注 |
|------|--------|---------|------|
| `standard`（默认） | 自管理、**EKS on EC2**、**GKE Standard**、**AKS**、minikube、kind、k3s | 通过 hostPath 读取 `/var/log/pods` 的 DaemonSet | 最低开销。这些平台上 hostPath 可用。 |
| `gke-autopilot` | **GKE Autopilot** | Kubernetes API 跟踪器（Deployment） | Autopilot 上 hostPath 被阻止。设置了通过 Autopilot Pod 安全标准的强化安全上下文。 |
| `eks-fargate` | **EKS Fargate** | Kubernetes API 跟踪器（Deployment） | 与 `gke-autopilot` 相同。Fargate 阻止 hostPath 和 DaemonSet。 |

如果不确定，不要设置 `preset`——您将获得 `standard` 默认值。如果您的集群在安装时拒绝并显示提及 `hostPath` 的 Pod 安全策略错误，请切换到 `gke-autopilot`（或 EKS Fargate 上的 `eks-fargate`）并重新安装。

### 示例

**GKE Standard、EKS on EC2、自管理或 AKS：**

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

## 两种日志收集模式的区别

`preset` 在内部设置 `logs.mode`——如果需要覆盖预设默认值，您也可以直接设置它。

### DaemonSet 模式（`logs.mode: daemonset`）

DaemonSet 每个节点运行一个 OpenTelemetry Collector Pod。它通过 hostPath 卷跟踪 `/var/log/pods/` 下的日志文件，并通过 OTLP 转发它们。

- **优点：** 最低开销，随节点线性扩展，不给 Kubernetes API 服务器增加负载，处理日志轮换。
- **缺点：** 需要 hostPath，需要能够调度 DaemonSet——GKE Autopilot 和 EKS Fargate 上两者都不可用。

### API 模式（`logs.mode: api`）

单副本 Deployment（`oneuptime/kubernetes-log-tailer` 镜像）使用 Kubernetes API 流式传输容器日志——与 `kubectl logs -f` 使用的端点相同。无 hostPath，无主机访问，无 DaemonSet。

- **优点：** 适用于 GKE Autopilot、EKS Fargate，以及任何阻止 hostPath 或强制执行 `restricted` Pod 安全标准的集群。
- **缺点：** 每个容器流都是到 `kube-apiserver` 的长期连接。实际上，一个副本可以舒适地处理几千个容器。对于非常大的集群，可以使用 `logs.api.replicas` 加上每个副本上的 `namespaceFilters.include` 按命名空间分片。

### 应该使用哪种模式？

如果 hostPath 可用，使用 DaemonSet。其他情况使用 API 模式。`preset` 设置会为您选择合适的模式。

您也可以使用 `--set logs.enabled=false` 完全禁用日志收集，改而通过 OpenTelemetry SDK 发送应用程序日志。请参见 [OpenTelemetry](/docs/telemetry/open-telemetry) 文档。

## 常用选项

| 选项 | 默认值 | 描述 |
|------|--------|------|
| `preset` | （空——视为 `standard`） | 参见上方的表格。 |
| `oneuptime.url` | *(必填)* | 您的 OneUptime 实例 URL。 |
| `oneuptime.apiKey` | *(必填)* | 项目 API 密钥（设置 → API 密钥）。 |
| `clusterName` | *(必填)* | 此集群的唯一名称。作为 `k8s.cluster.name` 标记在每条记录上。 |
| `namespaceFilters.include` | `[]` | 如果设置，仅监控这些命名空间。 |
| `namespaceFilters.exclude` | `["kube-system"]` | 要跳过的命名空间。 |
| `logs.enabled` | `true` | 开启或关闭日志收集。 |
| `logs.mode` | （从 `preset` 派生） | `daemonset`、`api` 或 `disabled`。覆盖预设。 |
| `logs.api.replicas` | `1` | 日志跟踪器 Deployment 副本数（仅 API 模式）。 |
| `controlPlane.enabled` | `false` | 抓取 etcd/api-server/scheduler/controller-manager。仅限自管理集群——托管服务（EKS/GKE/AKS）通常不暴露这些端点。 |

完整列表请参见 [Chart 的 `values.yaml`](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/kubernetes-agent/values.yaml)。

## 升级

```bash
helm repo update
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values
```

`--reuse-values` 保留现有配置；在其上传递任何新的 `--set` 覆盖。

## 卸载

```bash
helm uninstall oneuptime-agent --namespace oneuptime-kubernetes-agent
kubectl delete namespace oneuptime-kubernetes-agent
```

## 故障排查

### 安装因"hostPath volumes are not allowed"失败

您的集群阻止了 hostPath。切换到 API 模式预设：

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values \
  --set preset=gke-autopilot   # 或 eks-fargate
```

### OneUptime 中未显示日志

检查 Agent Pod：

```bash
kubectl get pods -n oneuptime-kubernetes-agent
kubectl logs -n oneuptime-kubernetes-agent -l app.kubernetes.io/part-of=oneuptime --tail=200
```

在 API 模式下，日志跟踪器 Pod 在端口 13133 上暴露 `/healthz`——通过 `kubectl port-forward` 访问它，获取导出状态快照。

### API 模式下我的集群 Pod 太多，一个日志跟踪器副本不够用

通过分片命名空间水平扩展。每个命名空间组部署一次：

```bash
helm install oneuptime-agent-ns-a oneuptime/kubernetes-agent \
  --set preset=gke-autopilot \
  --set namespaceFilters.include={app-a,app-b} \
  ...
```

或者，增加 `logs.api.replicas`——但请注意每个副本处理所有允许的命名空间，因此为了去重，您仍然需要命名空间分片。
