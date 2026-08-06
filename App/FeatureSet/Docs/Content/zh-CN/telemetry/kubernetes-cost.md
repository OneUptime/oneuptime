# Kubernetes 成本可观测性

## 概述

OneUptime 可以向你展示每个 Kubernetes 工作负载的实际成本——按命名空间、按控制器、按 Pod 的支出，外加空闲容量以及 request 与实际用量的效率——就在你已经通过 [Kubernetes 代理](/docs/telemetry/kubernetes-agent)采集的指标、日志和追踪旁边。

启用它只需一条命令：

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set cost.enabled=true
```

这就是一次完整的安装。该 chart 捆绑了开源的 [OpenCost](https://opencost.io) 引擎（Apache-2.0，CNCF——也就是同样驱动着 Kubecost 的那个 [cost-model](https://github.com/kubecost/cost-model)），外加它获取用量历史所需的一个最小化的专用 Prometheus——两个小 Pod，充当无形的管道。OpenCost 会根据你云提供商的**公开目录价自动**为你的节点、卷和负载均衡器定价，**无需任何凭据**（AWS、GCP、Azure）；本地部署集群则改为设置一份费率表（见下文）。

大约一小时内（第一个闭合的小时窗口），你会得到：

- **每个集群的 Costs 页面**（_Kubernetes → 你的集群 → Costs_）：支出趋势、按命名空间划分并按 cpu/内存/存储拆分的支出、按工作负载划分的支出、空闲支出以及效率。
- **项目级的 Costs 页面**（_Kubernetes → Costs_）：项目中每个集群的支出。
- **一个 Kubernetes 成本仪表板模板**（_仪表板 → 创建 → Kubernetes Cost Dashboard_）：节点每小时成本趋势、CPU/RAM 单位成本、持久卷和负载均衡器支出。
- **指标浏览器** 中的原始成本指标（`node_total_hourly_cost`、`pv_hourly_cost`，……），可用于自定义仪表板和指标告警。

## 工作原理

在 `cost.enabled=true` 时，该 chart 会运行四样东西：

1. **OpenCost**（捆绑）——监视集群，发现云目录价，并为每个工作负载计算预先定价好的成本分配。
2. **一个最小化的 Prometheus**（捆绑）——OpenCost 需要一个 PromQL 端点来获取用量/价格历史。这个 Prometheus 只为此而存在：单副本、3 天保留期，以及恰好两个抓取目标（通过 API-server 节点代理抓取的 cAdvisor，以及 OpenCost 自身——OpenCost 会发出自己的 KSM 风格资源请求指标，因此不涉及 kube-state-metrics）。它绝不会暴露到集群之外，其数据也永远不会离开集群。
3. **成本分配轮询器**（`cost.agent`）——在每个闭合的小时窗口轮询一次 OpenCost 的 Allocation API，并把每个工作负载的成本行（cpu / ram / gpu / pv / 网络 / 负载均衡器 / 空闲，外加效率）POST 到 OneUptime。每个窗口只发送一次——服务器会跳过已经摄取过的窗口，因此重启不会导致支出被重复计算。
4. **一个成本指标抓取**（`cost.metrics`）——代理的 OpenTelemetry 采集器通过与你其余集群指标相同的 OTLP 流水线，抓取 OpenCost 的 Prometheus 指标（已通过允许列表限定为成本序列）。

## 已经在运行 Kubecost 或 OpenCost？

让该 chart 指向你现有的引擎即可——此时不会捆绑任何东西：

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set cost.enabled=true \
  --set cost.engine.url=http://kubecost-cost-analyzer.kubecost.svc.cluster.local:9090
```

| 引擎     | 典型的服务 URL                                                   |
| -------- | ---------------------------------------------------------------- |
| OpenCost | `http://opencost.opencost.svc.cluster.local:9003`                |
| Kubecost | `http://kubecost-cost-analyzer.kubecost.svc.cluster.local:9090`  |

Allocation API 路径会被自动检测（Kubecost 为 `/model/allocation`，OpenCost 为 `/allocation/compute` 或 `/allocation`）。只有在非标准安装时才需要设置 `cost.engine.allocationPath`。

## 本地部署 / 裸机定价

节点没有公开云目录价的集群可以设置一份费率表——OpenCost 随后会依据这些数字为每种资源定价。所有值均为**每资源小时的美元数（USD）**：

```yaml
cost:
  enabled: true
  opencost:
    customPricing:
      enabled: true
      cpuPerCoreHour: "0.031611"       # ~$23 per core-month
      ramPerGiBHour: "0.004237"        # ~$3 per GiB-month
      storagePerGBHour: "0.00005479452" # ~$0.04 per GB-month
      gpuPerHour: "0.95"
```

## 实用的调整项

全部可选——完整列表参见该 chart 的 `values.yaml`：

```yaml
cost:
  agent:
    windowSeconds: 3600   # allocation window length (hourly = native)
    includeIdle: true     # ship the engine's __idle__ allocation
    currency: USD         # currency code shown in the UI (informational)
  prometheus:
    retention: 7d         # bundled TSDB history; right-sizing reads peaks back over days
    persistence:
      enabled: false      # set true for a small PVC; emptyDir otherwise
  metrics:
    enabled: true         # cost metrics for dashboards / Metric Explorer
    scrapeInterval: 60s
```

## 基于成本的告警

抓取到的成本指标就是普通的 OneUptime 指标，因此你可以像对其他任何指标一样对它们设置指标告警——例如，当平均 `node_total_hourly_cost` 升破某个预算阈值时告警，或者当某个本不该存在于集群中的卷类别出现了 `pv_hourly_cost` 时告警。

## 数据模型与保留期

分配行存储在 ClickHouse 中（每个集群、窗口、命名空间、控制器、Pod 和容器各一行），并遵循集群的遥测保留期：优先采用 Kubernetes 集群资源上的 `retainTelemetryDataForDays` 设置，若未设置则回退到项目的数据保留期。空闲和未分配的容量作为普通行存储在 `__idle__` / `__unallocated__` 命名空间下，因此可以用与工作负载支出相同的 group-by 进行查询。

## 故障排查

- **Costs 页面为空**——检查成本代理的日志：`kubectl logs -n <agent namespace> deploy/<release>-kubernetes-agent-cost`。`401` 表示摄取密钥无效；`cost engine did not answer any known allocation path` 表示引擎尚未就绪（捆绑的 OpenCost 在安装后需要几分钟才能为最初的窗口定价），或者 `cost.engine.url` 配置有误。
- **捆绑的 OpenCost 未就绪**——`kubectl logs -n <agent namespace> deploy/<release>-kubernetes-agent-opencost`。它会在日志中记录检测到了哪个云提供商，以及定价数据是否加载成功。
- **仪表板模板没有数据**——该模板读取的是抓取到的成本指标；请确认 `cost.metrics.enabled` 为 `true`。
- **数字与引擎自己的 UI 不一致**——OneUptime 会把引擎的对账（reconciliation）调整计入每个成本分量，并且只发送完整闭合的窗口；当前小时的部分支出会在该窗口闭合后出现。
- **Prometheus Pod 重启了**——在默认的 `emptyDir` 存储下，一次重启会丢失几小时的用量历史，因此这些窗口的分配可能会偏小。如果这对你很重要，请设置 `cost.prometheus.persistence.enabled=true`。
