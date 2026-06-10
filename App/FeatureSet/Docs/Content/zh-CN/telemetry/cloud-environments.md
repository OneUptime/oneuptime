# 云环境

## 概述

OneUptime 将托管的云计算资源归类为 **云环境（Cloud Environments）**—— AWS ECS / Fargate、Google Cloud Run、Azure Container Apps / Container Instances、AWS Elastic Beanstalk、AWS App Runner 以及 Azure App Service。每一个由 `cloud.platform` + `cloud.account.id` + `cloud.region` 组成的唯一组合都会创建一个环境，因此诸如 *“AWS ECS · us-east-1 · 123456789012”* 这样的组合就是一个单一实体，它聚合了在其上运行的每一个工作负载。

裸虚拟机（EC2、Compute Engine、Azure VM）仍归类为 **主机（Hosts）**，而 Kubernetes 仍归类在 **Kubernetes** 下。此视图专门用于托管 / PaaS 计算资源。

## 前提条件

- 一个 **OneUptime 遥测摄取令牌（Telemetry Ingestion Token）**—— 从 *项目设置 → 遥测摄取密钥（Project Settings → Telemetry Ingestion Keys）* 创建。
- 一个在你的工作负载中或随其一起运行的 OpenTelemetry Collector 或 SDK。

## OneUptime 如何识别环境

| 属性 | 是否必需 | 用途 |
|---|---|---|
| `cloud.platform` | **是** | 必须是托管计算平台（例如 `aws_ecs`、`gcp_cloud_run`、`azure_container_apps`） |
| `cloud.account.id` | 否 | 环境键的一部分 |
| `cloud.region` | 否 | 环境键的一部分 |
| `service.instance.id` | 否 | 在 **实例（Instances）** 下按任务/实例进行跟踪（含实时 CPU / 内存） |

这些通常由 OpenTelemetry **资源检测器（resource detectors）** 自动填充。

## 步骤 1 —— 启用云资源检测器

在 OpenTelemetry Collector 中，添加 `resourcedetection` 处理器：

```yaml
processors:
  resourcedetection:
    detectors: [env, ecs]   # use [gcp] on Cloud Run, [azure] on Azure
    timeout: 5s
```

使用 SDK 时，则改为设置 `OTEL_RESOURCE_DETECTORS`：

```bash
OTEL_RESOURCE_DETECTORS=env,ecs
```

## 步骤 2 —— 将 OTLP 导出到 OneUptime

```yaml
exporters:
  otlphttp/oneuptime:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [resourcedetection]
      exporters: [otlphttp/oneuptime]
    metrics:
      receivers: [otlp]
      processors: [resourcedetection]
      exporters: [otlphttp/oneuptime]
    logs:
      receivers: [otlp]
      processors: [resourcedetection]
      exporters: [otlphttp/oneuptime]
```

如果你自托管 OneUptime，请使用 `https://YOUR-ONEUPTIME-HOST/otlp`。

## 你将获得什么

环境概览将显示：

- 每个运行中任务/实例的 **CPU** 和 **内存（Memory）**（来自 `container.cpu.utilization` / `container.memory.usage`），以及一份 **按 CPU 排序的 Top 实例** 列表。
- **实例（Instances）**—— 任务的实时计数。
- 从你的追踪数据派生的 **请求数（Requests）** 和趋势图表。
- 完整的 **日志（Logs）**、**追踪（Traces）**、**指标（Metrics）** 和 **实例（Instances）** 标签页。

同一批工作负载的按服务细分视图可在 **服务（Services）** 下查看。
