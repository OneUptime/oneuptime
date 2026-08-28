# 集成

OneUptime 通过内置的自动化引擎 **[工作流](/docs/workflows/index)**，与你的团队已经在用的工具相连——Zabbix、Jira、PagerDuty、Slack 等等。不需要单独安装插件。你在拖放式画布上把一个集成搭起来，之后只要有事情发生，它就会跑。

这一页讲的是每个集成都会用到的两种模式。理解了它们，你几乎可以把 OneUptime 接到任何东西上，哪怕这里还没有它自己的页面。

## 两种模式

每个集成都在某一个方向上搬运数据（很多集成两个方向都用）。

### 入站——另一个工具把数据送进 OneUptime

当外部系统需要*在 OneUptime 里创建或更新点什么*时用这种模式——通常是它发现问题之后开一个事件或者一条告警。

1. 搭一个以 **[Webhook 触发器](/docs/workflows/triggers#webhook)** 开头的工作流。OneUptime 会给你一个专属 URL。
2. 在另一个工具里，配置一个 webhook / 通知动作，让它在事情发生时 POST 到那个 URL。
3. 在工作流里读取传入的载荷，用一个 **Create Incident**（或 Create Alert）组件把它记下来。

```text
Zabbix / Prometheus / Grafana / Datadog  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

> **提示：** 专门针对告警工具的话，**[Incoming Request 监视器](/docs/monitor/incoming-request-monitor)** 通常是更好的入站路径。它不用搭工作流就能给你一个 webhook URL，为载荷里的每条告警各开一个事件，升级到值班策略，并在工具报告恢复时逐个解决这些事件。当你需要 OneUptime 原生做不到的逻辑时，再去用工作流。完整示例见 [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager)。

### 出站——OneUptime 把数据送到另一个工具

当*OneUptime 里的某件事需要出现在另一个工具里*时用这种模式——开一张 Jira 工单、在 PagerDuty 里呼叫某人、发到 Slack。

1. 搭一个以 **[OneUptime 事件触发器](/docs/workflows/triggers#oneuptime-event-triggers)** 开头的工作流——比如 **Incident → On Create**。
2. 加一个 **[API 组件](/docs/workflows/components#api)**，带上事件的详情去调另一个工具的 REST API。
3. 把所有 API 密钥存成机密**[全局变量](/docs/workflows/variables#global-variables)**，这样它们不会出现在工作流里，也不会出现在日志里。

```text
OneUptime Incident → On Create  ──►  API component  ──►  Jira / PagerDuty / ServiceNow / GitHub
```

## 目录

| 工具                                                                  | 方向           | 功能说明                                                       |
| --------------------------------------------------------------------- | -------------- | -------------------------------------------------------------- |
| [Zabbix](/docs/integrations/zabbix)                                   | 入站           | 把 Zabbix 问题变成 OneUptime 事件（并在恢复时解决它们）。      |
| [Jira](/docs/integrations/jira)                                       | 出站（+ 入站） | 为每个事件开一张 Jira 工单；把状态同步回来。                   |
| [PagerDuty](/docs/integrations/pagerduty)                             | 出站（+ 入站） | 从 OneUptime 事件触发和解决 PagerDuty 事件。                   |
| [Opsgenie](/docs/integrations/opsgenie)                               | 出站（+ 入站） | 创建和关闭 Opsgenie 告警。                                     |
| [ServiceNow](/docs/integrations/servicenow)                           | 出站（+ 入站） | 从 OneUptime 开 ServiceNow 事件。                              |
| [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365)   | 出站（+ 入站） | 从 OneUptime 事件开启和解决 Dynamics 365 案例。                |
| [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) | 入站           | 把 Alertmanager 通知转成事件。                                 |
| [Grafana](/docs/integrations/grafana)                                 | 入站           | 把 Grafana 告警转成事件。                                      |
| [Datadog](/docs/integrations/datadog)                                 | 入站           | 把 Datadog 监视器告警转成事件。                                |
| [GitHub](/docs/integrations/github)                                   | 出站           | 为事件开一个 GitHub issue。                                    |
| [GitLab](/docs/integrations/gitlab)                                   | 出站           | 为事件开一个 GitLab issue。                                    |
| [Discord](/docs/integrations/discord)                                 | 出站           | 把事件更新发到 Discord 频道。                                  |
| [Telegram](/docs/integrations/telegram)                               | 出站           | 把事件更新发到 Telegram 聊天。                                 |
| [Slack](/docs/workspace-connections/slack)                            | 双向           | 原生工作区连接——频道、告警和值班。                             |
| [Microsoft Teams](/docs/workspace-connections/microsoft-teams)        | 双向           | 原生工作区连接。                                               |

> **Slack 和 Microsoft Teams** 有更深的原生连接，超出工作流的范围——自动开事件频道、双向操作、值班通知。这两个请用 [Slack](/docs/workspace-connections/slack) 和 [Microsoft Teams](/docs/workspace-connections/microsoft-teams) 工作区连接，而不是自己搭工作流。

## 处理机密

千万别把 API key 或者令牌直接粘到某个方块里。应该这样：

1. 去 **工作流 → 全局变量**。
2. 建一个变量——比如 `JIRA_AUTH`——并把 **密钥** 打开。
3. 之后在任何地方用 `{{global.variables.JIRA_AUTH}}` 引用它。

机密变量在你保存之后会在界面里隐藏起来，也会从运行日志里被抹掉。见[变量](/docs/workflows/variables#global-variables)。

## 认证速查表

大多数出站集成都需要在 API 方块上带一个 `Authorization` 头部。常见的几种形式：

| 方案                         | 头部值                                             | 谁在用                              |
| --------------------------- | -------------------------------------------------- | ----------------------------------- |
| Bearer 令牌                 | `Bearer {{global.variables.TOKEN}}`                | GitHub 以及很多现代 API             |
| Basic 认证                  | `Basic {{global.variables.BASE64_USER_PASS}}`      | Jira Cloud、ServiceNow              |
| API key 头部                | `GenieKey {{global.variables.OPSGENIE_KEY}}`       | Opsgenie                            |
| 正文里的令牌                | JSON 正文里的 `routing_key` 字段                    | PagerDuty Events API                |
| 私有令牌头部                | `PRIVATE-TOKEN: {{global.variables.GITLAB_TOKEN}}` | GitLab                              |
| OAuth 2.0 客户端凭据         | `Bearer <token fetched by an earlier API block>`   | Microsoft Dynamics 365（Dataverse） |

对于 Basic 认证，把 `username:password`（或者 `email:api_token`）base64 编码**一次**，然后把结果存成机密。在 macOS/Linux 上：

```bash
printf '%s' 'you@example.com:your_api_token' | base64
```

## 没找到你的工具？

几乎所有工具都能套进上面两种模式之一：

- 如果这个工具能在事情发生时**发一个 webhook**，就用**入站**模式——它要是个告警工具，就把它的 webhook 指向 [Incoming Request 监视器](/docs/monitor/incoming-request-monitor)；你需要自定义逻辑的话，就指向一个 OneUptime Webhook 触发器。
- 如果这个工具有 **REST API**，就用**出站**模式——从一个 **API 组件**里调它。
- 如果你需要在两者之间把数据重新整形，塞一个 **[Custom Code](/docs/workflows/components#custom-code)** 方块进去。

长尾的那些工具就这么覆盖了——Zendesk、AWS CloudWatch（通过 SNS）、New Relic、Splunk、StatusCake 等等。套路是一样的，变的只有 URL 和载荷。

## 接下来读什么

- [工作流概览](/docs/workflows/index)——自动化引擎是怎么运作的。
- [触发器](/docs/workflows/triggers)——Webhook 和 OneUptime 事件触发器详解。
- [组件](/docs/workflows/components)——API、Webhook 和数据组件。
- [变量](/docs/workflows/variables)——机密，以及在方块之间传递数据。
- [Incoming Request 监视器](/docs/monitor/incoming-request-monitor)——面向告警工具、不用搭工作流的入站路径。
- [Zabbix](/docs/integrations/zabbix)、[Jira](/docs/integrations/jira) 和 [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365)——完整的实操示例。
