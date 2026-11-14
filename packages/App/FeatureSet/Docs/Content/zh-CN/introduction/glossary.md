# 术语表

OneUptime 使用的每个词，都用一两句话解释，并附上它的其他名称和完整介绍它的页面。这些词按你接触它们的顺序分组：第一组是每个项目都会经历的流程，最后一组是有多种含义的词。

:::cards
- [从这里开始](#从这里开始): 每个项目都会经历的流程，从监视器到呼叫，再到状态页面。
- [你监视的对象](#你监视的对象): 服务、主机、集群、云，以及你为它们设定的目标。
- [处理问题](#处理问题): 状态、严重程度、所有者和标签，以及其他类型的问题。
- [遥测和仪表板](#遥测和仪表板): 你的系统发送什么，以及在哪里查看它。
- [自动化与 AI](#自动化与-ai): 哪些会自动运行，以及 OneUptime AI 做什么。
- [你安装的组件和密钥](#你安装的组件和密钥): 你运行的代理，以及每个代理使用的密钥。
- [有多种含义的词](#有多种含义的词): 规则、角色、资源、设置，以及其他身兼数职的词。
:::

## 从这里开始

### 项目

你设置的一切都存放在这里：监视器、事件、值班、状态页面、遥测和设置。一个项目中的任何内容在另一个项目中都不可见，大多数公司只需要一个项目。

参见 [核心概念](/docs/introduction/core-concepts#项目和人员)。

### 账户

就是你自己：你用来登录的邮箱和密码，以及你的姓名、时区和语言。一个账户可以属于任意数量的项目。

参见 [您的账户](/docs/introduction/your-account)。

### 团队

项目中的一组人，团队的权限决定其成员可以做什么。每个新项目一开始都有三个团队：Owners、Admin 和 Members。在 **用户** 下邀请成员，在 **团队** 下为他们分组。

参见 [用户、团队与权限](/docs/permissions/index)。

### 监视器

检查你运行的某一样东西，例如网站、API、服务器或 Kubernetes 集群，并判断它是否正常工作。当它的条件匹配时，它会改变自己的状态，并可以声明事件或创建警报。

参见 [创建监视器](/docs/monitor/create-monitor)。

### 标准

监视器的规则：每个检查结果意味着什么。它们按顺序检查，第一个匹配的规则可以改变监视器的状态、声明事件、创建警报，或三者都做。

也称为：**监控条件**、**监视器条件**、**Monitor Steps**。参见 [条件与状态](/docs/monitor/criteria-and-statuses)。

### 监视器状态

监视器此刻的状况。每个新项目都有三种监视器状态：**运行正常**、**性能下降** 和 **离线**，你也可以添加自己的状态。

参见 [条件与状态](/docs/monitor/criteria-and-statuses)。

### 探测器

按计划运行监视器检查的机器：它会请求页面、调用 API 或 ping 主机。OneUptime Cloud 在多个区域运行探测器，而你在自己的网络中运行的自定义探测器可以检查只有该网络才能访问的内容。

也称为：**自定义探针**。参见 [自定义探针](/docs/probe/custom-probe)。

### 事件

影响用户的问题，例如服务中断或变慢，也是问题持续期间团队据以开展工作的记录。它可以呼叫值班人员，并显示在你的状态页面上。

参见 [事件概览](/docs/incidents/index)。

### 警报

需要团队在用户注意到之前调查的问题，例如磁盘快要写满或证书即将过期。它可以呼叫值班人员，但从不显示在状态页面上。

参见 [警报概览](/docs/alerts/index)。

### 片段

一组相关的事件或相关的警报，团队把它们作为一个整体处理，共用一组所有者和一个状态。分组规则决定哪些属于同一个片段。

也称为：**事件片段**、**警报片段**。参见 [片段](/docs/incidents/episodes)。

### 值班策略

决定针对事件、警报或片段呼叫谁，以及没人确认时下一个呼叫谁。它的各个级别就是升级规则。

也称为：**值班**、**On-Call Duty Policy**、`OnCallDutyPolicy`。参见 [值班策略](/docs/on-call/policies)。

### 升级规则

值班策略的一个级别：呼叫谁，以及在呼叫下一级之前等待多久让人确认。一个级别可以呼叫人员、团队或值班排班。

参见 [升级规则](/docs/on-call/escalation-rules)。

### 值班排班

任意时刻由谁值班：人们轮流值班，每个人把值班交接给下一个人。呼叫某个排班的升级规则，会呼叫该排班中当前值班的人。

也称为：**Rotation**、**值班策略计划**。参见 [值班计划](/docs/on-call/schedules)。

### 层

值班计划中的一个轮换：谁轮流值班、多久交接一次，以及它覆盖哪些时段。有人值班的最上层会被呼叫，因此主轮换放在最上面，后备值班放在下面。

参见 [值班计划](/docs/on-call/schedules#层)。

### 通知方式

OneUptime 在项目中可以联系到你的地址：邮箱地址、用于短信或电话的电话号码、你的 Slack 或 Microsoft Teams 账户，或你手机上的 OneUptime 应用。每个人都在 **用户设置** 下添加自己的通知方式。

参见 [通知方式](/docs/notifications/notification-methods)。

### 如何联系我

你自己的被呼叫规则：呼叫时尝试你的哪些通知方式，以及间隔多久。一个阶梯适用于每个事件、警报和片段，某个严重程度也可以有自己的规则。每个人在 **用户设置** 下设置自己的规则。

也称为：**个人值班规则**。参见 [如何联系我](/docs/notifications/on-call-rules)。

### 状态页

向客户展示你的服务是否正常工作，以及影响它们的事件和维护的页面。它可以是公开的，也可以只对你允许的人开放。

参见 [状态页概览](/docs/status-pages/index)。

### 订阅者

通过邮件、短信、Slack、Microsoft Teams 或 Webhook 关注某个状态页面的人，当页面上的事件或维护开始、变化和结束时，他们会收到通知。

参见 [订阅者与公告](/docs/status-pages/subscribers)。

### 计划维护

提前公布的计划工作。每个维护事件会依次经历维护状态 **已计划**、**进行中**、**已结束** 和 **已完成**，显示它的状态页面会告知访问者和订阅者。

也称为：**计划维护事件**、**计划事件**、**事件**。参见 [计划维护概览](/docs/scheduled-maintenance/index)。

### 遥测

你的系统发送给 OneUptime 的内容：日志、指标、追踪、异常和性能剖析数据。应用通过 OpenTelemetry 发送，OneUptime 的代理则从主机、集群和其他基础设施发送，每个发送方都使用一个摄取密钥。

参见 [OpenTelemetry](/docs/telemetry/open-telemetry)。

## 你监视的对象

### 监视器组

把多个监视器汇总为一个状态（取其中最差的），并拥有自己的正常运行时间。状态页面可以把整个组显示为一行。在 **项目设置 → 高级 → 功能标志** 下开启监视器组。

参见 [监视器组](/docs/monitor/monitor-groups)。

### 服务

你运行的应用或微服务。它的遥测第一次到达时，OneUptime 会添加它，以它的 `service.name` 命名，并把它的日志、追踪、指标、异常、事件和所有者汇集到一个页面上。

也称为：**服务目录**、**遥测服务**。参见 [服务](/docs/telemetry/services)。

### 主机

通过 OpenTelemetry Collector 发送其指标、进程、日志和服务状态的 Linux、Windows 或 macOS 机器。**添加主机** 用一条命令安装收集器，OneUptime 会让它的配置保持最新。

参见 [主机](/docs/telemetry/hosts)。

### Kubernetes

你的 Kubernetes 集群，以及它们的节点、Pod、工作负载、事件和日志，由你用 Helm 安装的 Kubernetes 代理发送。

参见 [Kubernetes 代理](/docs/telemetry/kubernetes-agent)。

### 基础设施

菜单中汇集你所运行的机器和平台的一组：主机、Kubernetes、Docker、Docker Swarm、Podman、Proxmox、OpenStack、VMware、Ceph、存储阵列、网络和 IoT。每一项都由代理或连接填充，并显示其中每台机器、每个集群或每台设备的运行状况。

参见 [主机](/docs/telemetry/hosts)。

### 网络

你的交换机、路由器、防火墙、接入点，以及网络中任何有地址的设备，无论它是否支持 SNMP。

参见 [网络设备监控](/docs/monitor/network-device-monitor)。

### 云

你的 AWS 账户、Azure 订阅和 Google Cloud 项目，从仪表板中连接。OneUptime 会列出其中的每个资源，读取它们的关键指标，并记录其中发生的变化。

参见 [连接云账户](/docs/telemetry/cloud-accounts)。

### 应用平台

你在托管平台上运行的应用，例如 Amazon ECS 和 Fargate、Google Cloud Run 以及 Azure App Service。它们运行的每个地方都是一个云环境，OneUptime 会在其遥测第一次到达时创建它。

也称为：**云环境**。参见 [云环境](/docs/telemetry/cloud-environments)。

### 无服务器

你的无服务器函数，例如 AWS Lambda、Google Cloud Functions 和 Azure Functions，一旦它们的 OpenTelemetry 数据到达，就会连同其追踪、日志和指标一起列出。

也称为：**无服务器函数**。参见 [无服务器函数](/docs/telemetry/serverless-functions)。

### 数据库

你的应用查询的每个数据库，由你的追踪、数据库自身的指标以及 OneUptime 能读取的其他来源汇总而成，并显示其引擎的运行状况。

参见 [数据库](/docs/telemetry/databases)。

### 队列

你的服务使用的消息队列和主题，例如 Apache Kafka、RabbitMQ 和 Amazon SQS，信息来自你的追踪和消息代理的指标。

参见 [队列](/docs/telemetry/queues)。

### 真实用户监控

真实用户在你的 Web 和移动应用中的体验：页面加载、请求、错误和 Core Web Vitals，由应用本身而不是探测器报告。

参见 [RUM 概览](/docs/rum/index)。

### 清单

一个列表，汇集了 OneUptime 对你的环境所知道的一切：服务、主机、Kubernetes 对象、虚拟机、网络设备、云资源，以及根本不发送遥测的东西。其中大部分会自动填充。

参见 [资产清单概览](/docs/inventory/overview)。

### 拓扑

一张展示你的系统如何相互连接的地图：哪些服务调用哪些服务、什么运行在哪里，根据你已经发送的遥测绘制。

参见 [拓扑](/docs/telemetry/topology)。

### SLO

为你所监控的对象设定的可靠性目标，例如在 30 天内 99.9% 的时间可用。OneUptime 每 5 分钟根据其监视器测量一次每个 SLO。

也称为：**Service Level Objective**。参见 [SLO 概览](/docs/slo/introduction)。

### 错误预算

SLO 的目标所允许的停机时间：目标为 30 天内 99.9% 时，就是 43 分 12 秒。余量充足时可以承担风险；余量不多时，就要放慢节奏，投入稳定性建设。

参见 [错误预算](/docs/slo/error-budget)。

## 处理问题

### 状态

事件或警报在你的响应中进行到了哪一步。每个新项目一开始都有 **已识别**、**已确认** 和 **已解决**：确认表示已经有人在处理，并阻止呼叫下一个升级级别；解决则将其关闭。

也称为：**事件状态**、**警报状态**。参见 [事件状态与严重级别](/docs/incidents/states-and-severities)。

### 严重程度

事件或警报有多重要。新项目一开始为事件提供 Critical Incident、Major Incident 和 Minor Incident，为警报提供 **高** 和 **低**；你可以重命名它们、更改颜色或添加自己的严重程度。

也称为：**事件严重性**、**警报严重性**。参见 [事件状态与严重级别](/docs/incidents/states-and-severities)。

### 所有者

对某条记录（例如监视器、事件或状态页面）负责的人员或团队。当他们拥有的内容发生情况时，所有者会收到通知。

参见 [标签与所有者规则](/docs/configuration/label-and-owner-rules)。

### 标签

一种标记，例如 Production 或 Checkout，你把它加到监视器、事件、状态页面和大多数其他记录上，用于筛选和分组。团队的权限可以限定在带有某些标签的记录上。

参见 [标签与所有者规则](/docs/configuration/label-and-owner-rules)。

### 异常

你的代码抛出的错误。OneUptime 把同一错误的每次出现归为一个异常，并附上它的堆栈跟踪、趋势以及发生它的请求。

也称为：**异常跟踪**、`/telemetry-exception`。参见 [异常](/docs/telemetry/exceptions)。

### AI 洞察

OneUptime 在任何呼叫发生之前就在你的遥测中发现的问题：新出现和激增的异常、错误日志激增、变慢的追踪、指标漂移，以及让情况变糟的部署。洞察从不呼叫任何人，也从不创建事件；它们在收件箱中等待，直到有人查看。产品或记录的 AI 部分中的 **洞察** 页面，是 OneUptime AI 在那里了解到的内容。

也称为：**洞察**。参见 [AI SRE](/docs/ai/ai-sre#洞察主动检测)。

### 安全事件

OneUptime 的 SIEM：来自你的日志、安全工具以及你发送的其他任何内容的安全事件，以统一的格式保存在你的遥测旁边，并通过检测规则从中发现威胁。

也称为：**SIEM**。参见 [安全事件(SIEM)](/docs/telemetry/security-events)。

### 安全案例

一件值得调查的事情，来自检测规则、威胁情报或已连接的安全产品，关于同一用户、主机或地址的每次检测都归入其中。分析师在队列中处理案例，剧本对其作出响应。

也称为：**案例**。参见 [安全案例与剧本(SOAR)](/docs/telemetry/security-cases)。

## 遥测和仪表板

### 日志

你的服务、主机和代理写下的日志行，你可以在日志浏览器中搜索它们，并用日志监视器监控它们。

参见 [日志浏览器](/docs/telemetry/logs-explorer)。

### 指标

你的服务和基础设施随时间报告的数值，例如请求数、延迟、CPU 和队列深度。

参见 [指标浏览器](/docs/telemetry/metrics-explorer)。

### 追踪

一个请求逐步穿过你的服务的路径。每一步都是一个 span，带有它的耗时和结果。

参见 [跟踪浏览器](/docs/telemetry/traces-explorer)。

### 性能剖析

你的应用如何逐个函数地消耗 CPU 时间和内存，由向 OneUptime 的 Pyroscope 兼容 API 推送数据的性能分析器发送。

也称为：**性能配置文件**、**持续性能分析**。参见 [性能剖析](/docs/telemetry/profiles)。

### AI / LLM

你的 AI 应用和智能体进行的对话：每次模型调用，连同其令牌数、成本、延迟、提示词和回答，根据你的应用发送的 OpenTelemetry span 构建。

也称为：**AI / LLM 可观测性**。参见 [AI / LLM 可观测性](/docs/telemetry/ai-llm-observability)。

### 数据可观测性

监视你的数据库和数据仓库中的表，在数据延迟、缺失或出错时告诉你，并指出是哪次运行、哪次部署或哪张表导致的。

参见 [数据可观测性概览](/docs/data-observability/index)。

### 数据安全

找出你的公司保存的敏感数据，无论它们在云存储桶、数据库、数据仓库还是你发送的遥测中，并告诉你它们的保存方式有什么问题。

参见 [数据安全概览](/docs/data-security/index)。

### 仪表板

由你自己摆放的小部件组成的页面：指标、日志和追踪的图表，事件和监视器的列表，你的 SLO 等等。在你共享之前，仪表板仅对你的项目可见。

参见 [仪表板概览](/docs/dashboards/index)。

### Public Dashboard

通过公开链接共享的仪表板，供不登录你项目的人查看。你可以用密码保护它、限制只有某些 IP 地址可以访问，或在你自己的域名上托管它。

参见 [共享与公开仪表板](/docs/dashboards/sharing)。

## 自动化与 AI

### 工作流

无需代码的自动化：画布上的块在其触发器触发时运行，例如在声明事件时向 Slack 发帖，或调用另一个工具。

参见 [工作流概览](/docs/workflows/index)。

### 运行手册

可重复使用的响应流程：团队在事件、警报或维护事件上运行的手动和自动步骤，可以手动运行，也可以在运行手册规则匹配时自动运行。

参见 [Runbook 概览](/docs/runbooks/index)。

### 剧本

响应安全案例的步骤，例如保全证据、呼叫值班人员或停用某个用户，可以自动运行，也可以一键运行。

也称为：**安全剧本**。参见 [安全案例与剧本(SOAR)](/docs/telemetry/security-cases#剧本)。

### AI 规则

决定 OneUptime AI 调查和修复哪些新的事件或警报，以及如何处理。没有 AI 规则时，它会调查每一个，因此大多数项目都不需要 AI 规则。

也称为：**自动修复规则**。参见 [AI SRE](/docs/ai/ai-sre#哪些事件会被调查和修复)。

### OneUptime AI

OneUptime 的 AI 站点可靠性工程师：它在你的遥测中调查每个新的事件和警报，并把发现发布到它们的时间线上。**项目设置** 中的 **启用 AI** 开关可以把它全部关闭。

也称为：**AI SRE**。参见 [AI SRE](/docs/ai/ai-sre)。

### 询问 AI

基于你项目数据的聊天。它会查询你的日志、追踪、指标、事件、监视器等，并为每个论断给出引用来源。

也称为：**聊天**。参见 [询问 AI](/docs/ai/ask-ai)。

### 代码

你在这里让 OneUptime AI 在你的代码仓库中工作，就像向编码智能体提出请求一样：修复 bug、编写测试或做出修改，然后收到一个拉取请求。

也称为：**任务**。参见 [代码](/docs/ai/ai-agent)。

### 表单

任何拥有链接的人都可以填写的页面，无需账户。每次提交都会创建一个事件（用于问题报告）或一个维护事件（用于变更请求）。

参见 [表单概览](/docs/forms/index)。

## 你安装的组件和密钥

### 基础设施代理

Server / VM 监视器背后的 `oneuptime-infrastructure-agent` 服务：它每 30 秒报告一次一台机器的 CPU、内存、磁盘和进程，并用该监视器的密钥签名。

参见 [服务器 / 虚拟机监控](/docs/monitor/server-monitor)。

### Kubernetes 代理

一个 Helm chart，用于收集集群的指标、事件和 Pod 日志，并借助 eBPF 收集其追踪，然后用摄取密钥发送它们。

参见 [Kubernetes 代理](/docs/telemetry/kubernetes-agent)。

### OpenTelemetry Collector

接收、处理和发送遥测的开源代理。**添加主机** 会把它安装到机器上，Docker 代理也是一个这样的收集器，你自己的收集器则用摄取密钥向 OneUptime 发送数据。

也称为：**收集器**。参见 [主机](/docs/telemetry/hosts) 和 [主机 OpenTelemetry Collector](/docs/telemetry/host-otel-collector)。

### Runner

你在自己的基础设施中运行的一个小进程，用于运行运行手册中的 JavaScript、Bash、SSH 和 kubectl 步骤。它使用自己的 Runner ID 和密钥向外连接到 OneUptime。

也称为：**Runbook 代理**。参见 [Runbook 代理](/docs/runbooks/agents)。

### 摄取密钥

允许某样东西向你的项目发送遥测的密钥：使用 OpenTelemetry 的应用、收集器和代理。它放在 `x-oneuptime-token` 请求头中，项目的 API 密钥不能代替它。

也称为：**遥测摄取 Key**、`oneuptime.apiKey`。参见 [摄取密钥](/docs/telemetry/ingestion-keys)。

### API 密钥

一种密钥，让脚本、CLI、Terraform 或 AI 助手通过 API 读取和更改你的项目，权限由你授予。在 **项目设置 → 高级 → API 密钥** 下创建。

参见 [用户、团队与权限](/docs/permissions/index#api-密钥)。

## 有多种含义的词

### 规则

OneUptime 中有许多东西都是规则，每一种都替你做一个决定：呼叫谁（**值班规则**、**升级规则**），谁拥有新记录以及给它加什么标签（**所有者规则**、**标签规则**），哪些属于同一组（**分组规则**），以及 OneUptime AI 做什么（**AI 规则**）。监视器自身的规则就是它的标准。

参见 [核心概念](/docs/introduction/core-concepts#规则的类型)。

### 角色

四种不同的东西：团队授予的权限，例如 Project Owner 或 Project Admin；你用权限组合而成的 **自定义角色**；**事件角色**，即某人在一次事件中担任的职责；以及 **Network Device Role**，即网络中某台设备的用途。

参见 [用户、团队与权限](/docs/permissions/index)。

### 资源

最常见的是指 OneUptime 记录的基础设施，例如主机、集群、数据库和云资源。事件的 **受影响的资源** 是它涉及的监视器和基础设施，状态页面的资源是它显示的监视器和组，而 OpenTelemetry 的资源属性说明遥测来自哪里。

参见 [资产清单概览](/docs/inventory/overview)。

### 设置

每个层级都有自己的设置：针对整个项目的 **项目设置**，决定 OneUptime 如何联系你的 **用户设置**，以及产品侧边菜单中它自己的 **设置**，例如 **事件** 下的事件状态和模板。自托管服务器的设置位于 Admin Dashboard 中。

参见 [项目设置](/docs/configuration/project-settings)。

### 策略

最常见的是 **值班策略**：呼叫谁，以及下一个是谁。来电策略为你的团队提供一个会拨给值班人员的电话号码，而错误预算策略写明当 SLO 的预算即将耗尽时你的团队要做什么。

参见 [值班策略](/docs/on-call/policies)。

### 模板

保存下来的起点：监视器模板用于创建监视器，事件和警报模板用于填写新记录，备注和事后分析模板为你要写的内容开个头，仪表板模板则构建仪表板的小部件。

参见 [监视器模板](/docs/monitor/monitor-templates)。

### 工作区

你在 **工作区连接** 下连接到 OneUptime 的 Slack 或 Microsoft Teams 工作区，用于向你的频道发布更新，并在聊天中处理事件。其他一些工具所说的工作区，在 OneUptime 中就是项目。

参见 [Slack](/docs/workspace-connections/slack)。

### 智能体

你安装的、向 OneUptime 报告或代表它执行操作的程序：基础设施、Kubernetes 和 Docker 代理发送它们收集的数据，Runner 运行运行手册步骤，AI 智能体让 OneUptime AI 查看集群或主机。你交给 **代码** 的任务就是 AI 智能体任务。

参见 [该用哪一个？](/docs/introduction/which-one#探测器代理收集器还是-runner)。

### 值班规则

在 **事件** 和 **警报** 下，值班规则挑选新事件或警报要运行的值班策略。每个人决定呼叫如何送达自己的规则，过去也叫值班规则：现在是 **用户设置** 下的 **如何联系我**。

参见 [事件设置与自动化](/docs/incidents/settings#事件值班规则) 和 [如何联系我](/docs/notifications/on-call-rules)。

### 通知设置

在 **用户设置** 下，决定关于你所拥有内容的哪些更新会通知你，以及通过哪些渠道。项目的短信和电话开关、消息余额，以及它自己的 SMTP 和 Twilio，过去也叫通知设置：现在是 **项目设置** 下的 **通知渠道**。

参见 [通知设置](/docs/notifications/notification-settings)。

## 后续步骤

:::cards
- [该用哪一个？](/docs/introduction/which-one): 事件还是警报、工作流还是运行手册，以及其他相似之物的并排对比。
- [核心概念](/docs/introduction/core-concepts): 各部分如何联系，都在一个页面上。
- [快速开始](/docs/introduction/quickstart): 在十五分钟内把这些词付诸实践。
:::
