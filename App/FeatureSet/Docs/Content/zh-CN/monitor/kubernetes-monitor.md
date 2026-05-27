# Kubernetes 监控器

Kubernetes 监控允许您监控 Kubernetes 集群的健康状况和性能，包括节点、Pod、工作负载和控制平面组件。OneUptime 会从您的集群中收集指标，并根据您配置的条件对其进行评估。

## 概述

Kubernetes 监控器使用来自您集群的指标，为您的基础设施提供深度可视性。它使您能够：

- 监控集群、命名空间、工作负载、节点和 Pod 的健康状况
- 跟踪资源的 CPU、内存、磁盘和网络使用情况
- 检测 Pod 崩溃、重启和调度失败
- 监控 Deployment 副本可用性
- 在控制平面问题（etcd、API 服务器、scheduler）发生时告警
- 跟踪资源 requests 和 limits

## 创建 Kubernetes 监控器

1. 在 OneUptime 仪表板中前往 **Monitors**
2. 点击 **Create Monitor**
3. 选择 **Kubernetes** 作为监控器类型
4. 选择要监控的集群和资源范围
5. 配置资源过滤器和指标查询
6. 根据需要配置监控条件

## 配置选项

### 集群

选择要监控的 Kubernetes 集群。集群必须通过 OpenTelemetry 与 OneUptime 集成。

### 资源范围

选择监控资源的层级：

| 范围 | 描述 |
|-------|-------------|
| Cluster | 监控整个集群 |
| Namespace | 监控特定命名空间内的资源 |
| Workload | 监控特定的 deployment、statefulset、daemonset、job 或 cronjob |
| Node | 监控特定的集群节点 |
| Pod | 监控特定的 Pod |

### 资源过滤器

使用可选过滤器缩小范围：

| 过滤器 | 描述 | 适用范围 |
|--------|-------------|-------------------|
| Namespace | Kubernetes 命名空间 | Namespace、Workload、Pod |
| Workload Type | deployment、statefulset、daemonset、job、cronjob | Workload |
| Workload Name | 工作负载名称 | Workload |
| Node Name | 节点名称 | Node |
| Pod Name | Pod 名称 | Pod |

### 指标查询

配置一个或多个要评估的指标查询。每个查询指定：

- **指标名称** —— 要查询的 Kubernetes 指标
- **聚合方式** —— 如何聚合指标值
- **过滤器** —— 基于属性的额外过滤

您还可以创建**公式**，使用数学表达式组合多个指标查询。

### 滚动时间窗口

选择指标评估的时间窗口：

- 过去 1 分钟
- 过去 5 分钟
- 过去 10 分钟
- 过去 15 分钟
- 过去 30 分钟
- 过去 60 分钟

## 常用 Kubernetes 指标

### Pod 指标

| 指标 | 描述 |
|--------|-------------|
| Pod CPU Usage | Pod 的 CPU 消耗 |
| Pod Memory Usage | Pod 的内存消耗 |
| Pod Filesystem Usage | Pod 的磁盘使用情况 |
| Pod Network Receive/Transmit | 网络流量 |
| Pod Phase | 当前 Pod 阶段（Running、Pending、Failed 等） |

### 节点指标

| 指标 | 描述 |
|--------|-------------|
| Node CPU Usage | 每个节点的 CPU 使用率 |
| Node Memory Usage | 每个节点的内存使用率 |
| Node Filesystem Usage | 每个节点的磁盘使用情况 |
| Node Disk I/O | 读/写操作 |
| Node Ready Condition | 节点是否就绪 |

### 容器指标

| 指标 | 描述 |
|--------|-------------|
| Container Restarts | 容器重启次数 |
| Container CPU/Memory Limits | 资源 limits |
| Container CPU/Memory Requests | 资源 requests |
| Container Ready Status | 容器是否就绪 |

### 工作负载指标

| 指标 | 描述 |
|--------|-------------|
| Deployment Available/Unavailable Replicas | 副本数 |
| DaemonSet Misscheduled Nodes | 调度问题 |
| StatefulSet Ready Replicas | 就绪副本数 |
| Job Active/Failed/Succeeded Pods | Job 状态 |

## 监控条件

### 可用的检查类型

| 检查类型 | 描述 |
|------------|-------------|
| Metric Value | 所配置指标查询或公式的值 |

### 聚合类型

| 聚合方式 | 描述 |
|-------------|-------------|
| Average | 时间窗口内的平均值 |
| Sum | 所有值的总和 |
| Maximum Value | 时间窗口内的最高值 |
| Minimum Value | 时间窗口内的最低值 |
| All Values | 所有值都必须满足条件 |
| Any Value | 至少有一个值满足条件 |

### 过滤类型

- **大于**、**小于**、**大于或等于**、**小于或等于**、**等于**、**不等于**

## 预置告警模板

OneUptime 为常见的 Kubernetes 监控场景提供模板：

| 模板 | 描述 | 阈值 |
|----------|-------------|-----------|
| CrashLoopBackOff Detection | 容器重启次数 | > 5 次重启 |
| Pod Stuck in Pending | 处于 Pending 阶段的 Pod | > 0 个 Pod |
| Node Not Ready | 节点就绪状态 | = 0（未就绪） |
| High Node CPU | 节点 CPU 使用率 | > 90% |
| High Node Memory | 节点内存使用率 | > 85% |
| Deployment Replica Mismatch | 不可用副本数 | > 0 个副本 |
| Job Failures | Job 中失败的 Pod | > 0 次失败 |
| etcd No Leader | etcd 集群缺少 leader | = 0（无 leader） |
| API Server Throttling | 被丢弃的 API 请求 | > 0 个请求 |
| Scheduler Backlog | scheduler 中待处理的 Pod | > 0 个 Pod |
| High Node Disk Usage | 节点文件系统使用率 | > 90% |
| DaemonSet Unavailable | 调度失败的节点 | > 0 个节点 |

## 安装要求

要使用 Kubernetes 监控，您需要在集群中安装 OneUptime Kubernetes 代理。该代理通过 OTLP 将集群指标、事件、Pod 日志，以及 —— 默认情况下 —— **通过 eBPF 捕获的应用追踪和 HTTP RED 指标** 发送到 OneUptime。无需修改代码或为每个应用配置 SDK 即可看到服务级别的流量。

请参阅 [安装 Kubernetes Agent](/docs/monitor/kubernetes-agent) 指南 —— 它涵盖了单条命令的 Helm 安装、用于为您的集群挑选正确配置（standard、GKE Autopilot、EKS Fargate）的 `preset` 选项，以及各信号家族（HTTP RED 指标、服务图谱、网络流、TCP 统计）的 `ebpf.features.*` 开关。
