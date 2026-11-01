# 云环境

**云环境** 是你的容器在托管云平台上运行的地方：ECS 集群所在的账户和区域、Cloud Run 的项目和区域、Container Apps 的订阅和区域。当你的遥测数据第一次带着正确的资源属性到达时，OneUptime 就会创建一个环境，并汇总在其中运行的每个工作负载。无需手动注册任何内容。

环境列在 应用平台 中，这是一个独立的产品：**应用平台 → 概览** 按平台对环境分组，并把已经停止上报的环境排在最前面，**应用平台 → 所有应用** 列出环境中运行的每个应用，**应用平台 → 所有环境** 列出所有环境。云账户中的资源，例如虚拟机、存储桶和托管数据库，位于 云 中：参见 [云资源](/docs/telemetry/cloud-resources)。

:::cards
- [AWS ECS / Fargate](/docs/telemetry/cloud-aws-ecs): Fargate 或 EC2 上的任务，以及每个任务的 CPU 和内存。
- [Google Cloud Run](/docs/telemetry/cloud-gcp-cloud-run): 服务和作业，它们也会作为无服务器函数列出。
- [Azure Container Apps](/docs/telemetry/cloud-azure-container-apps): 副本，其区域和订阅需要手动设置。
- [其他云平台](/docs/telemetry/cloud-other-platforms): Elastic Beanstalk、App Runner、App Engine、App Service 和 Container Instances。
:::

## 工作原理

```mermaid title="遥测数据如何成为云环境"
flowchart TB
    subgraph workload["你的工作负载"]
        direction LR
        app["使用 OpenTelemetry<br/>SDK 的应用"]
        sidecar["Sidecar Collector<br/>(可选)"]
    end
    app -->|"OTLP"| sidecar
    app -->|"OTLP + token"| ingest["OneUptime"]
    sidecar -->|"OTLP + token"| ingest
    ingest -->|"托管的<br/>cloud.platform"| env["云环境<br/>平台 · 区域 · 账户"]
    ingest -->|"service.name"| svc["服务"]
    env --> inst["实例<br/>每个任务一行"]
```

- **资源检测器说明工作负载在哪里运行。** SDK 或 Collector 中的 OpenTelemetry 资源检测器会读取平台的元数据，并在工作负载发送的所有数据上设置 `cloud.platform`、`cloud.account.id` 和 `cloud.region`。没有检测器的地方，需要你自己设置。
- **环境负责汇总。** 平台、账户和区域都相同的工作负载会进入同一个环境。各个服务仍在 **服务** 中保留各自的行。
- **每个运行中的任务都是一个实例。** 环境的 **实例** 选项卡会列出运行中的任务、实例或副本，并在平台能提供时显示实时的 CPU 和内存。
- **每个服务都是一个应用。** ECS 服务、Cloud Run 服务或 Container App 都是其环境的一个应用，OneUptime 会记录它运行的修订版本：参见 [应用与部署](#应用与部署)。

## 开始之前

- **摄取密钥。** 在 **项目设置 → 遥测与 APM → 摄取密钥** 中创建一个 **服务器** 密钥并复制其令牌，参见[创建摄取密钥](/docs/telemetry/open-telemetry#创建摄取密钥)。令牌属于机密：每个平台页面都会说明应把它存放在该云的机密存储中的什么位置。
- **应用中的 OpenTelemetry。** 导出 OTLP 的 OpenTelemetry SDK，或在应用旁边运行的 OpenTelemetry Collector。

## 支持的平台

| 平台 | `cloud.platform` | `cloud.*` 由谁填写 | 实例标识 | 指南 |
| ------------------------- | --------------------------- | ---------------------- | --------------------------------- | ------------------------------------------------------------------ |
| AWS ECS / Fargate | `aws_ecs` | 资源检测器 | `aws.ecs.task.arn` | [AWS ECS / Fargate](/docs/telemetry/cloud-aws-ecs) |
| AWS Elastic Beanstalk | `aws_elastic_beanstalk` | 资源检测器 | `host.id` | [其他云平台](/docs/telemetry/cloud-other-platforms) |
| AWS App Runner | `aws_app_runner` | 手动设置 | `host.name` | [其他云平台](/docs/telemetry/cloud-other-platforms) |
| Google Cloud Run | `gcp_cloud_run` | 资源检测器 | `faas.instance` | [Google Cloud Run](/docs/telemetry/cloud-gcp-cloud-run) |
| Google App Engine | `gcp_app_engine` | 资源检测器 | `faas.instance` | [其他云平台](/docs/telemetry/cloud-other-platforms) |
| Azure Container Apps | `azure_container_apps` | 资源检测器 | `azure.container_app.instance.id` | [Azure Container Apps](/docs/telemetry/cloud-azure-container-apps) |
| Azure Container Instances | `azure_container_instances` | 手动设置 | `host.name` | [其他云平台](/docs/telemetry/cloud-other-platforms) |
| Azure App Service | `azure_app_service` | 资源检测器 | `host.id` | [其他云平台](/docs/telemetry/cloud-other-platforms) |

- **资源检测器：** SDK 或 Collector 的 `resourcedetection` 处理器中的 OpenTelemetry 资源检测器会替你设置 `cloud.*` 属性。
- **手动设置：** 没有检测器，所以你要把属性写进 `OTEL_RESOURCE_ATTRIBUTES`。平台页面会给出确切的那一行。
- **Azure 检测器知道得更少。** Container Apps 检测器既不知道区域也不知道订阅，App Service 检测器不知道订阅：缺少的部分需要你自己设置。
- **带点号的 Azure 写法也能用。** Node.js 和 .NET 的 Azure 检测器写入的是 `azure.container_apps` 和 `azure.app_service`。OneUptime 收到后会把它们改写为上面带下划线的值。

## OneUptime 如何识别环境

三个资源属性的每种组合各对应一个环境：

| 属性 | 必填 | 含义 |
| ------------------ | -------- | ------------------------------------------------------------------------------------------- |
| `cloud.platform` | 是 | [支持的平台](#支持的平台) 中的某个值 |
| `cloud.account.id` | 否 | AWS 账户 ID、Google Cloud 项目 ID 或 Azure 订阅 ID |
| `cloud.region` | 否 | 区域，例如 `us-east-1`、`us-central1` 或 `eastus` |

OneUptime 用 `|` 把这三个值连接成 **环境密钥**，并用同样的值为环境命名，例如 _AWS ECS · us-east-1 · 123456789012_ ：

```text title="Environment keys"
aws_ecs|123456789012|us-east-1
gcp_cloud_run|my-project|us-central1
azure_container_apps|00000000-0000-0000-0000-000000000000|eastus
```

> [!IMPORTANT]
> 缺少的部分会以空段的形式留在密钥中：`aws_ecs||us-east-1`。因此，省略了 `cloud.account.id` 的工作负载会进入与设置了它的工作负载不同的环境。本以为只有一个环境却看到两个，通常就是这个原因。

### 实例标识

在一个环境中，每个运行中的任务、实例或副本在 **实例** 下各占一行。它的名称取自遥测数据中按以下顺序找到的第一个资源属性：

1. `aws.ecs.task.id`
2. `aws.ecs.task.arn`（缩短为任务 ID）
3. `faas.instance`
4. `azure.container_app.instance.id`
5. `service.instance.id`
6. `container.id`
7. `host.id`
8. `host.name`

平台自身的标识有意排在最前面。sidecar Collector 和应用的 SDK 都能看到它，而且它在重启后保持不变。SDK 通常会为每个进程生成一个新的 `service.instance.id`（Node.js SDK 默认如此），因此如果先用它作为键，一个 ECS 任务就会被拆成两行。只有当平台没有设置自己的标识时，才会使用 `service.instance.id`。[支持的平台](#支持的平台) 中的 **实例标识** 列给出了每个平台上典型配置所使用的属性。

### 添加环境

摄取过程会为你创建环境，因此无需填写任何内容。打开 **应用平台 → 所有环境** 并点击 **添加云环境**：选择你的应用运行的位置，指南就会显示该平台的 OpenTelemetry 设置，并已填好你的 OneUptime URL 和摄取密钥。指南的最后一步 **等待连接** 会在环境的第一批数据到达时告诉你，并给出指向它的链接。要显示其他名称，请在环境的 **设置** 页面上，于 **环境详情** 卡片中选择 **编辑详情**，然后填写 **显示名称**。

## 应用与部署

环境运行的每个服务都是该环境的一个应用，名称与平台控制台中的名称一致。**应用平台 → 所有应用** 列出每个应用及其正在运行的修订版本，以及过去一小时的请求、错误率和 p95 延迟；环境的 **应用** 选项卡列出该环境自己的应用。

| 平台 | 应用 | 区分依据 | 修订版本 |
| --- | --- | --- | --- |
| AWS ECS / Fargate | `aws.ecs.task.family`，否则 `service.name` | `aws.ecs.cluster.arn` | `aws.ecs.task.revision`，否则 `service.version` 或 `container.image.tag` |
| AWS Elastic Beanstalk | `service.name` | `deployment.environment.name` | `service.version` |
| AWS App Runner | `service.name` | — | `service.version`，否则 `container.image.tag` |
| Google Cloud Run | `faas.name`，否则 `service.name` | — | `faas.version`，否则 `service.version` |
| Google App Engine | `faas.name`，否则 `service.name` | — | `faas.version`，否则 `service.version` |
| Azure Container Apps | `service.name` | — | `service.version`，否则 `container.image.tag` |
| Azure Container Instances | `service.name` | — | `service.version`，否则 `container.image.tag` |
| Azure App Service | `service.name` | `deployment.environment.name` | `service.version` |

遥测数据携带的第一个属性就是应用的名称，因此没有资源检测器的平台上的应用仍然是应用，名称取自它的 `service.name`。未设置 `service.name` 时 SDK 上报的 `unknown_service` 不会成为任何应用的名称。

- **应用从未运行过的修订版本就是一次部署。** OneUptime 会记录它替换了哪个修订版本，以及替换的时间。OneUptime 看到的第一个修订版本是应用历史的起点，而不是一次部署。
- **退回就是回滚。** 当应用正在运行的修订版本 15 分钟内没有任何上报，而它之前运行过的某个修订版本仍在运行时，OneUptime 会记录一次回滚到该修订版本。
- **两者都是变更。** 每一次都会成为应用和环境图表上的一条虚线、环境 **动态** 中的一行，以及 OneUptime AI 调查该环境的事件时会读取的一条 [变更事件](/docs/telemetry/change-events)。**应用平台 → 概览** 上的 **近期部署** 列出最新的几次。
- **每个应用每小时最多记录 12 个新修订版本。** 否则，随每次构建变化的 `service.version` 会变成每分钟一次部署。

应用的页面有显示其请求、错误、延迟、实例和当前运行的修订版本的 **概览**，显示每个修订版本数据的 **修订版本** 选项卡，以及筛选到该应用的 **实例**、**日志** 和 **追踪** 选项卡。**设置警报** 会打开 **服务** 中该应用所属服务的推荐监控器。

30 天内没有发送任何数据的应用会连同其修订版本一起被删除；30 天内没有任何实例上报的修订版本也会被删除，除非应用仍在运行它。在自托管的 OneUptime 上，可以用 `CLOUD_APP_RETENTION_DAYS` 设置这个 30。

## 哪些不是云环境

| 运行在 | 出现的位置 | 原因 |
| ------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------- |
| EC2, Compute Engine, Azure VM (`aws_ec2`, `gcp_compute_engine`, `azure_vm`) | **主机** | 虚拟机就是主机。参见 [主机 OpenTelemetry Collector](/docs/telemetry/host-otel-collector) |
| EKS、GKE、AKS、自管理的 Kubernetes | **Kubernetes** | 按 `k8s.*` 属性路由。参见 [Kubernetes 代理](/docs/telemetry/kubernetes-agent) |
| Lambda, Cloud Functions, Azure Functions (`aws_lambda`, `gcp_cloud_functions`, `azure_functions`) | **无服务器函数** | 按 `faas.name` 路由，若 `cloud.platform` 为 FaaS 平台，则按 `service.name` 路由。参见 [无服务器函数](/docs/telemetry/serverless-functions) |
| 负载均衡器、存储桶、托管数据库以及其他 IaaS 或 PaaS 资源 | **Cloud Resources** | 根据 Azure Monitor、CloudWatch 和 Cloud Monitoring 发布的指标发现。参见 [云资源](/docs/telemetry/cloud-resources) |

> [!NOTE]
> Cloud Run 和 App Engine 会有意出现在两个地方。它们的检测器同时设置了托管的 `cloud.platform` 和 `faas.name`，因此每个服务本身也是一个 **无服务器函数**，而 **云环境** 则汇总了该项目和区域中的所有服务。同一份遥测数据会同时归档到两处。

## 连接工作负载

每个平台页面都会用该云自己的命令和控制台界面介绍这些步骤。概要如下：

:::steps
### 为遥测数据加上云属性

:::tabs
@tab Sidecar collector
任务、实例或副本中的第二个容器。应用导出到 `localhost:4318`，Collector 的 `resourcedetection` 处理器会在经过的所有数据上加上 `cloud.*`。令牌由 Collector 保存，在 ECS 上它还会发送每个任务的 CPU 和内存：

```yaml title="collector.yaml"
processors:
  resourcedetection:
    detectors: [env, ecs] # [env, gcp] on Cloud Run and App Engine; [env, azurecontainerapps] on Container Apps
    timeout: 5s
```
@tab SDK direct
应用的 SDK 直接导出到 OneUptime。在 SDK 中开启平台的资源检测器，例如 Node.js 中的 `OTEL_NODE_RESOURCE_DETECTORS=env,host,os,aws`：每个平台页面都列出了各语言对应的开关。没有额外的容器，也就没有容器的 CPU 和内存。
:::

### 将 OTLP 导出到 OneUptime

:::tabs
@tab Sidecar collector
```yaml title="collector.yaml"
exporters:
  otlphttp/oneuptime:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: ${env:ONEUPTIME_TOKEN}

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [resourcedetection, batch]
      exporters: [otlphttp/oneuptime]
    metrics:
      receivers: [otlp]
      processors: [resourcedetection, batch]
      exporters: [otlphttp/oneuptime]
    logs:
      receivers: [otlp]
      processors: [resourcedetection, batch]
      exporters: [otlphttp/oneuptime]
```

Collector 从环境变量中展开 `${env:ONEUPTIME_TOKEN}`，该变量由平台从其机密存储中填入：Secrets Manager、Secret Manager 或 Container Apps 机密。
@tab SDK direct
```bash
OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
```
:::

如果你自托管 OneUptime，请使用 `https://YOUR-ONEUPTIME-HOST/otlp`。

### 检查连接

```bash
curl -i https://oneuptime.com/otlp/v1/validate \
  -H "x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN"
```

返回 `200` 且 `"valid": true` 表示令牌已被接受。`401` 表示令牌未知、已吊销、已停用或已过期，响应中的 `message` 会说明是哪一种。在第一个 span、日志或指标到达后的 1 分钟内，环境就会出现在 **应用平台 → 所有环境** 中。
:::

> [!TIP]
> 同样的步骤也在仪表板中，并已填好你的令牌：在 **应用平台 → 所有环境** 中点击 **添加云环境** 即可打开；每个环境的 **文档** 选项卡中也有。

## 你能看到什么

环境的 **概览** 显示：

- 根据请求进入服务的 span 计算的 **请求**、**错误率** 和 **p95 延迟**，以及你所选时间范围内的请求、错误和内存图表，每次部署处都有一条虚线。
- 所有在线实例的 **CPU** 和 **内存**，以及 **按 CPU 排名的实例** 列表。它们来自带有实例标识的 `container.cpu.utilization` 和 `container.memory.usage` 指标；在 ECS 上则来自 `awsecscontainermetrics` 接收器的 `ecs.task.cpu.utilized` 和 `ecs.task.memory.utilized`。
- **实例**：最近 15 分钟内上报过的实例数量。**实例** 选项卡中每个实例一行。
- **应用**：环境运行的应用，需要关注的排在前面，并显示它们过去一小时的请求和错误。
- 按环境过滤的 **日志**、**追踪** 和 **指标** 选项卡。

尚未发送任何数据的环境会显示 **正在等待**。遥测数据中断 15 分钟的环境会显示 **已断开**，下一个 span、日志或指标到达后会恢复为 **已连接**。OneUptime 自身停机或追赶积压数据的时间不计入这 15 分钟。

### 标签和所有者

- **来自遥测数据：** 像 `oneuptime.label.team=payments` 这样的资源属性会给环境添加标签 `team:payments`。
- **来自规则：** **应用平台 → 设置 → 标签规则** 和 **所有者规则** 会为匹配的环境添加标签和所有者。云 中的规则适用于你云账户中的资源，在两者拆分之前创建的规则对两者都适用。参见 [标签与所有者规则](/docs/configuration/label-and-owner-rules)。

## 故障排除

[云故障排除](/docs/telemetry/cloud-troubleshooting) 按发生顺序逐一介绍各种故障：环境始终不出现、落在 **主机** 下或只出现在 **无服务器函数** 下、没有实例或没有 CPU 和内存、显示 **已断开**、被拆成两个，或者是手动创建后始终无法匹配。

## 后续步骤

:::cards
- [AWS ECS / Fargate](/docs/telemetry/cloud-aws-ecs): 最常见的配置，附带完整的任务定义。
- [云故障排除](/docs/telemetry/cloud-troubleshooting): 环境缺失或不正确时该检查什么。
- [云资源(IaaS 与 PaaS)](/docs/telemetry/cloud-resources): 来自云自身监控的负载均衡器、存储桶和托管数据库。
- [无服务器函数](/docs/telemetry/serverless-functions): Lambda、Cloud Functions 和 Azure Functions。
:::
