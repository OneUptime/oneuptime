# 集成概览

OneUptime 通过内置的自动化引擎 **[工作流](/docs/workflows/index)** 与你的团队已在使用的工具相连——Zabbix、Jira、PagerDuty、Slack 等等。无需安装额外插件。你只需在拖放式画布上将集成连接起来，它就会在事件发生时自动运行。

本页介绍每种集成所使用的两种模式。一旦理解它们，你几乎可以将 OneUptime 连接到任何工具，即使该工具在这里没有独立页面。

## 两种模式

每种集成都以两个方向之一传递数据（许多集成同时使用两者）。

### 入站——另一个工具向 OneUptime 发送数据

当外部系统需要*在 OneUptime 中创建或更新某些内容*时使用此模式——通常是在检测到问题时创建一个事件或告警。

1. 构建一个以 **[Webhook 触发器](/docs/workflows/triggers#webhook)** 开始的工作流。OneUptime 会给你一个唯一的 URL。
2. 在另一个工具中，配置一个 webhook / 通知动作，在发生某些事情时 POST 到该 URL。
3. 在工作流中，读取传入的负载，并使用 **Create Incident**（或 Create Alert）组件将其记录下来。

```text
Zabbix / Prometheus / Grafana / Datadog  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

### 出站——OneUptime 向另一个工具发送数据

当 *OneUptime 中发生的事情需要呈现在另一个工具中*时使用此模式——在 Jira 中创建工单、在 PagerDuty 中呼叫某人、发布到 Slack。

1. 构建一个以 **[OneUptime 事件触发器](/docs/workflows/triggers#oneuptime-event-triggers)** 开始的工作流——例如 **Incident → On Create**。
2. 添加一个 **[API 组件](/docs/workflows/components#api)**，用事件详情调用另一个工具的 REST API。
3. 将所有 API 密钥作为**机密[全局变量](/docs/workflows/variables#global-variables)**存储，使其不会出现在工作流或日志中。

```text
OneUptime Incident → On Create  ──►  API component  ──►  Jira / PagerDuty / ServiceNow / GitHub
```

## 目录

| 工具 | 方向 | 功能说明 |
| --- | --- | --- |
| [Zabbix](/docs/integrations/zabbix) | 入站 | 将 Zabbix 问题转化为 OneUptime 事件（并在恢复时解决）。 |
| [Jira](/docs/integrations/jira) | 出站（+ 入站） | 为每个事件创建 Jira 工单；同步状态回来。 |
| [PagerDuty](/docs/integrations/pagerduty) | 出站（+ 入站） | 从 OneUptime 事件触发和解决 PagerDuty 事件。 |
| [Opsgenie](/docs/integrations/opsgenie) | 出站（+ 入站） | 创建和关闭 Opsgenie 告警。 |
| [ServiceNow](/docs/integrations/servicenow) | 出站（+ 入站） | 从 OneUptime 创建 ServiceNow 事件。 |
| [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) | 入站 | 将 Alertmanager 通知转化为事件。 |
| [Grafana](/docs/integrations/grafana) | 入站 | 将 Grafana 告警转化为事件。 |
| [Datadog](/docs/integrations/datadog) | 入站 | 将 Datadog 监控告警转化为事件。 |
| [GitHub](/docs/integrations/github) | 出站 | 为事件创建 GitHub issue。 |
| [GitLab](/docs/integrations/gitlab) | 出站 | 为事件创建 GitLab issue。 |
| [Discord](/docs/integrations/discord) | 出站 | 向 Discord 频道发布事件更新。 |
| [Telegram](/docs/integrations/telegram) | 出站 | 向 Telegram 聊天发送事件更新。 |
| [Slack](/docs/workspace-connections/slack) | 双向 | 原生工作区连接——频道、告警和值班。 |
| [Microsoft Teams](/docs/workspace-connections/microsoft-teams) | 双向 | 原生工作区连接。 |

> **Slack 和 Microsoft Teams** 具有更深层的原生连接，超越了工作流——自动事件频道、双向操作和值班通知。请使用 [Slack](/docs/workspace-connections/slack) 和 [Microsoft Teams](/docs/workspace-connections/microsoft-teams) 工作区连接，而不是构建工作流。

## 处理机密

永远不要将 API 密钥或令牌直接粘贴到模块中。应当：

1. 前往 **Workflows → Global Variables**。
2. 创建一个变量——例如 `JIRA_AUTH`——并开启 **Is Secret**。
3. 在任何地方通过 `{{variable.JIRA_AUTH}}` 引用它。

机密变量在保存后会在 UI 中隐藏，并从运行日志中清除。参见[变量](/docs/workflows/variables#global-variables)。

## 认证速查表

大多数出站集成需要在 API 模块上添加 `Authorization` 头部。常见形式：

| 方案 | 头部值 | 使用方 |
| --- | --- | --- |
| Bearer 令牌 | `Bearer {{variable.TOKEN}}` | GitHub、许多现代 API |
| Basic 认证 | `Basic {{variable.BASE64_USER_PASS}}` | Jira、ServiceNow |
| API 密钥头部 | `GenieKey {{variable.OPSGENIE_KEY}}` | Opsgenie |
| 正文中的令牌 | JSON 正文中的 `routing_key` 字段 | PagerDuty Events API |
| 私有令牌头部 | `PRIVATE-TOKEN: {{variable.GITLAB_TOKEN}}` | GitLab |

对于 Basic 认证，将 `username:password`（或 `email:api_token`）进行一次 base64 编码，然后将结果存储为机密。在 macOS/Linux 上：

```bash
printf '%s' 'you@example.com:your_api_token' | base64
```

## 没有找到你的工具？

几乎所有工具都符合上面两种模式之一：

- 如果该工具能**发送 webhook**，使用**入站**模式——将其 webhook 指向 OneUptime Webhook 触发器。
- 如果该工具有 **REST API**，使用**出站**模式——从 **API 组件**中调用它。
- 如果你需要在两者之间重塑数据，添加一个 **[Custom Code](/docs/workflows/components#custom-code)** 模块。

这涵盖了长尾工具——Zendesk、AWS CloudWatch（通过 SNS）、New Relic、Splunk、StatusCake 等等。方法是一样的，只有 URL 和负载不同。

## 接下来读什么

- [工作流概览](/docs/workflows/index)——自动化引擎的工作原理。
- [触发器](/docs/workflows/triggers)——Webhook 和 OneUptime 事件触发器详解。
- [组件](/docs/workflows/components)——API、Webhook 和数据组件。
- [变量](/docs/workflows/variables)——机密和在模块间传递数据。
- [Zabbix](/docs/integrations/zabbix) 和 [Jira](/docs/integrations/jira)——完整的实操示例。
