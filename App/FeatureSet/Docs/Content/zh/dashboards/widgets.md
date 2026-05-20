# 仪表板小部件

小部件是仪表板上的一块瓦片。每个小部件都有类型（图表、值、列表等）、位置、尺寸和配置。本页就是清单——每个小部件展示什么、需要什么输入、什么时候选用它。

关于画布机制，见 [创建仪表板](/docs/dashboards/authoring)。

## 时间序列小部件

### Chart

一个或多个指标序列在仪表板时间范围上的折线/柱状/面积图。

**配置**：

- 一个或多个指标查询（单序列用 `metricQueryConfig`、多序列用 `metricQueryConfigs`）。
- 可选 **formula** 用于组合多个查询（例如 `errors / total * 100`）。
- 可选 **transformAsRate** 用于 OpenTelemetry 累积计数器（例如 `system.disk.io`）——小部件按桶计算 `(value - previousValue) / Δt`。
- 展示：堆叠还是重叠序列、Y 轴单位、图例开关、图表类型。

什么时候用：趋势重要的时候。请求延迟、错误数随时间的变化、队列深度——任何曲线形状能告诉你信息的场景。

### Value

带可选阈值和可选迷你曲线的一个大数字。

**配置**：

- 一个指标查询（单值——通常是时间范围上的 `last`、`avg` 或 `max`）。
- 可选 **warning threshold**（超过为黄色）。
- 可选 **critical threshold**（超过为红色）。
- 展示：数字格式、单位后缀。

什么时候用：单一数字就能回答问题的时候。当前错误率、此刻的 P95 延迟、当前打开事件数。

### Gauge

带最小值、最大值、警告区段、严重区段的圆形仪表盘。

**配置**：指标查询和四个边界（min、max、warning、critical）。

什么时候用：值落在已知范围内的时候。CPU 利用率（0–100%）、磁盘填充、队列容量。

### Table

指标查询结果的表格展示，每个分组一行。

**配置**：指标查询（通常按 `host.name`、`service.name` 这样的标签分组）、要显示的列、行数上限。

什么时候用：你想要分项细节而不是趋势的时候。最吵的 10 台主机、各服务的错误数、各端点的请求率。

## 注释小部件

### Text

一段静态 Markdown。

**配置**：Markdown 正文。标题、列表、链接、强调、行内代码、围栏代码块都能渲染。

什么时候用：你想要一个分区标题、一段上下文（"这个仪表板覆盖 checkout 服务"）、Runbook 或相关仪表板的链接清单，或者事件期间的临时横幅。

## 日志与追踪

### LogStream

匹配过滤器的日志行的实时尾随。

**配置**：日志过滤器（服务、级别、属性匹配）、要显示的列。

什么时候用：你想在仪表板上看应用*现在*在说什么，而不必离开页面去打开日志浏览器。

### TraceList

匹配过滤器的最近 trace 列表，附带耗时、状态和服务名。

**配置**：trace 过滤器（服务、状态、属性匹配）。

什么时候用：你想要近期活动的分页视图而不是图表。常见搭配：上方一个延迟 Chart，下方一个慢 trace 的 TraceList。

## 运营列表

### IncidentList

匹配过滤器的事件实时列表。

**配置**：按状态、严重度、标签、监控、所属团队过滤。

什么时候用：仪表板的目的是回答"现在哪里出了问题？"。

### AlertList

匹配过滤器的告警实时列表。

**配置**：按状态、严重度、标签过滤。

什么时候用：告警驱动工作流的仪表板（例如开发团队盯自己服务告警的看板）。

### MonitorList

匹配过滤器的监控实时列表，显示每个监控的当前状态。

**配置**：按监控类型、标签、当前状态过滤。

什么时候用：你想要机群级"所有网站都在线吗？"视图，或按团队列出受监控端点。

## Kubernetes 资源列表

对于安装了 [Kubernetes Agent](/docs/monitor/kubernetes-agent) 的项目，提供以下实时资源小部件。每个都接收可选的 `cluster`、`namespace` 和标签过滤器。

- **KubernetesPodList** — Pod，带相位、重启次数和节点归属。
- **KubernetesNodeList** — 节点，带状态条件、容量和分配。
- **KubernetesNamespaceList** — 命名空间及其工作负载数。
- **KubernetesDeploymentList** — Deployment 的目标副本数与就绪副本数。
- **KubernetesStatefulSetList** — StatefulSet 与就绪副本数。
- **KubernetesDaemonSetList** — DaemonSet 的目标与就绪。
- **KubernetesJobList** — Job 与完成状态。
- **KubernetesCronJobList** — CronJob 的调度与最后一次运行。

什么时候用：你想要一个把 Kubernetes 资源状态与这些工作负载的遥测混合在一起的仪表板。

## Docker 资源列表

对于安装了 Docker 监控的项目：

- **DockerHostList** — 运行 Docker 的主机，附带容器数量。
- **DockerContainerList** — 容器，附带状态、镜像、宿主、运行时长。
- **DockerImageList** — 镜像及其大小。
- **DockerNetworkList** — Docker 网络与连接的容器数量。
- **DockerVolumeList** — Docker 卷与其使用情况。

## 基础设施

### HostList

由 OneUptime 服务器监控监控的主机——附带当前状态、CPU、内存和运行时长。

**配置**：按标签或当前健康状态过滤。

## 选对小部件

一些经验法则：

- **看时间趋势？** Chart。
- **现在最重要的单一数字？** Value（如果有自然范围，则用 Gauge）。
- **跨多个维度的分项？** Table。
- **系统当下正在发生什么？** LogStream、TraceList、IncidentList。
- **特定资源机群的状态？** 对应的资源列表小部件。
- **一个标题、一段说明或一个链接？** Text。

大多数仪表板用混合搭配——顶部一个 Chart，旁边一两个 Value、一个 Text 分隔，下面一两个列表。

## 接下来读什么

- [仪表板变量与过滤器](/docs/dashboards/variables) — 让小部件在多个服务/客户/集群间复用。
- [创建仪表板](/docs/dashboards/authoring) — 画布、网格和编辑模式。
- [共享与公开仪表板](/docs/dashboards/sharing) — 把仪表板暴露给团队之外。
