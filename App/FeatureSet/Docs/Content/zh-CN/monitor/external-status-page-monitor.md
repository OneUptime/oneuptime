# 外部状态页面监控器

外部状态页面监控允许您监控第三方状态页面，并在您所依赖的服务出现中断或性能下降时收到告警。OneUptime 定期检查外部状态页面（如 AWS、GCP、Azure、GitHub 等）并评估其状态。

## 概述

外部状态页面监控器通过查询公共状态页面来检查您所依赖的服务的健康状况。这使您能够：

- 监控您的应用程序所依赖的第三方服务的可用性
- 当上游提供商发生中断时收到告警
- 跟踪各个组件的状态（例如"AWS EC2 us-east-1"）
- 在性能下降影响您的用户之前检测到它
- 将您自己的事件与上游提供商的问题关联起来

## 支持的提供商

OneUptime 支持通过以下方式监控状态页面：

| 提供商类型               | 描述                                               |
| ------------------------ | -------------------------------------------------- |
| **自动**（默认）         | 自动检测状态页面格式                               |
| **Atlassian Statuspage** | 由 Atlassian Statuspage 驱动的状态页面（JSON API） |
| **RSS**                  | 提供 RSS 订阅源的状态页面                          |
| **Atom**                 | 提供 Atom 订阅源的状态页面                         |

### 自动检测

设置为 **自动** 时，OneUptime 将尝试自动检测状态页面格式：

1. 首先，尝试 Atlassian Statuspage JSON API（`/api/v2/status.json` 和 `/api/v2/components.json`）
2. 如果失败，尝试将页面解析为 RSS 或 Atom 订阅源
3. 作为最终备选，执行基本的 HTTP 可达性检查

## 创建外部状态页面监控器

1. 在 OneUptime 控制台中转到 **监控器**
2. 点击 **创建监控器**
3. 选择 **外部状态页面** 作为监控器类型
4. 输入您要监控的状态页面 URL
5. 可选地选择特定的提供商类型（或保留为自动）
6. 可选地输入组件名称以将监控过滤到特定组件
7. 根据需要配置监控标准

## 配置选项

### 状态页面 URL

输入您要监控的外部状态页面的 URL。对于由 Atlassian Statuspage 驱动的站点，通常是根 URL（例如 `https://status.example.com`）。对于 RSS/Atom 订阅源，直接输入订阅源 URL。

### 提供商类型

选择状态页面的提供商类型。使用 **自动**（默认）让 OneUptime 自动检测格式，或者如果您知道具体类型，指定特定的提供商类型。

### 组件名称过滤器

如果状态页面报告多个组件，您可以选择指定组件名称，以仅监控该特定组件。例如，要仅监控 us-east-1 中的 AWS EC2，您可以输入 `EC2 us-east-1`（状态页面上显示的确切组件名称）。

当未指定组件名称时，监控状态页面的整体状态。

### 高级选项

#### 超时

等待状态页面响应的最长时间（毫秒）。默认为 10000ms（10 秒）。

#### 重试次数

请求失败时的重试次数。默认为 3 次重试。

## 监控标准

您可以配置标准来判断外部服务何时处于在线、降级或离线状态，基于以下条件：

- **是否在线** – 状态页面是否可达并返回状态数据
- **整体状态** – 状态页面的整体状态指示器（例如"operational"、"major_outage"）
- **组件状态** – 特定组件的状态（使用组件名称过滤器时）
- **活跃事件** – 状态页面上当前报告的活跃事件数量
- **响应时间** – 获取状态页面数据所需的时间

## 常用状态页面 URL

以下是您可以监控的常用服务状态页面 URL 的精选列表：

| 服务                          | 状态页面 URL                                  |
| ----------------------------- | --------------------------------------------- |
| AWS                           | `https://health.aws.amazon.com/health/status` |
| Google Cloud Platform         | `https://status.cloud.google.com`             |
| Microsoft Azure               | `https://status.azure.com`                    |
| GitHub                        | `https://www.githubstatus.com`                |
| Cloudflare                    | `https://www.cloudflarestatus.com`            |
| Datadog                       | `https://status.datadoghq.com`                |
| PagerDuty                     | `https://status.pagerduty.com`                |
| Twilio                        | `https://status.twilio.com`                   |
| Stripe                        | `https://status.stripe.com`                   |
| Slack                         | `https://status.slack.com`                    |
| Atlassian（Jira、Confluence） | `https://status.atlassian.com`                |
| Vercel                        | `https://www.vercel-status.com`               |
| Netlify                       | `https://www.netlifystatus.com`               |
| DigitalOcean                  | `https://status.digitalocean.com`             |
| Heroku                        | `https://status.heroku.com`                   |
| MongoDB Atlas                 | `https://status.cloud.mongodb.com`            |
| Fastly                        | `https://status.fastly.com`                   |
| New Relic                     | `https://status.newrelic.com`                 |
| Sentry                        | `https://status.sentry.io`                    |
| CircleCI                      | `https://status.circleci.com`                 |

> **注意：** 这些服务中有许多使用 Atlassian Statuspage，因此 **自动** 提供商类型会自动检测它们。

## 事件和告警模板

从外部状态页面监控器创建事件或告警时，您可以使用以下模板变量：

| 变量                      | 描述                           |
| ------------------------- | ------------------------------ |
| `{{isOnline}}`            | 状态页面是否在线（true/false） |
| `{{responseTimeInMs}}`    | 响应时间（毫秒）               |
| `{{failureCause}}`        | 失败原因（如有）               |
| `{{overallStatus}}`       | 整体状态指示器值               |
| `{{activeIncidentCount}}` | 活跃事件数量                   |
| `{{componentStatuses}}`   | 组件状态的 JSON 数组           |

## 最佳实践

- **使用自动提供商类型**，除非您知道确切格式——自动检测对大多数状态页面都很有效
- **监控特定组件**，如果您只依赖某些服务（例如特定的 AWS 区域）
- **设置事件关联** — 当您的监控器检测到问题，而上游状态页面也显示问题时，有助于更快地识别根本原因
- **与其他监控器结合** — 将外部状态页面监控器与您自己的 API/网站监控器配合使用，以获得全面的可见性
