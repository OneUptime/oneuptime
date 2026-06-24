# 外部状态页面监控器

外部状态页面监控允许您监控第三方状态页面，并在您所依赖的服务出现中断或性能下降时收到告警。OneUptime 定期检查外部状态页面（如 AWS、GCP、Azure、GitHub、OpenAI、Anthropic 等）并评估其状态。

## 概述

外部状态页面监控器通过查询公共状态页面来检查您所依赖的服务的健康状况。这使您能够：

- 监控您的应用程序所依赖的第三方服务的可用性
- 当上游提供商发生中断时收到告警
- 跟踪各个组件的状态（例如"AWS EC2 us-east-1"）
- 将监控范围限定到单个组件组（例如，仅限 OpenAI 的"APIs"），这样页面上其他位置的无关事件就不会触发您的监控器
- 在性能下降影响您的用户之前检测到它
- 将您自己的事件与上游提供商的问题关联起来

## 支持的提供商

OneUptime 支持通过以下方式监控状态页面：

| 提供商类型               | 描述                                                              |
| ------------------------ | --------------------------------------------------------------- |
| **自动**（默认）         | 自动检测状态页面格式                                            |
| **Atlassian Statuspage** | 由 Atlassian Statuspage 驱动的状态页面（JSON API）              |
| **incident.io**          | 由 incident.io 驱动的状态页面（例如 `https://status.openai.com`） |
| **RSS**                  | 提供 RSS 订阅源的状态页面                                       |
| **Atom**                 | 提供 Atom 订阅源的状态页面                                      |

### 自动检测

设置为 **自动** 时，OneUptime 将尝试按以下顺序自动检测状态页面格式：

1. 首先，尝试 Atlassian Statuspage JSON API（`/api/v2/status.json`、`/api/v2/components.json` 和 `/api/v2/incidents/unresolved.json`）
2. 接着，尝试 incident.io 状态页面 API（`/proxy/<host>`）
3. 如果上述均失败，尝试将页面解析为 RSS 或 Atom 订阅源
4. 作为最终备选，执行基本的 HTTP 可达性检查

## 创建外部状态页面监控器

1. 在 OneUptime 控制台中转到 **监控器**
2. 点击 **创建监控器**
3. 选择 **外部状态页面** 作为监控器类型
4. 输入您要监控的状态页面 URL
5. 可选地选择特定的提供商类型（或保留为 **自动**）
6. 可选地输入 **组件组**，以将范围限定到诸如"APIs"之类的组
7. 可选地输入 **组件名称**，以过滤到单个组件（如果设置了组，则在该组内过滤）
8. 根据需要配置监控标准

## 配置选项

### 状态页面 URL

输入您要监控的外部状态页面的 URL。对于由 Atlassian Statuspage 和 incident.io 驱动的站点，通常是根 URL（例如 `https://status.example.com`）。对于 RSS/Atom 订阅源，直接输入订阅源 URL。

### 提供商类型

选择状态页面的提供商类型。使用 **自动**（默认）让 OneUptime 自动检测格式，或者如果您知道具体类型，指定 **Atlassian Statuspage**、**incident.io**、**RSS** 或 **Atom**。

### 组件组过滤器

如果状态页面将其组件组织成组，您可以将监控器的范围限定到单个组。例如，在 `https://status.openai.com` 上，输入 `APIs` 可将监控器范围限定到 OpenAI 的 API 服务。

设置组件组后，**活跃事件计数** 和 **整体状态** 仅使用该组中的组件来计算——影响无关组（例如 ChatGPT）的事件不会触发范围限定到"APIs"组的监控器。

组件组过滤适用于 **Atlassian Statuspage** 和 **incident.io** 提供商。（RSS/Atom 订阅源不公开组件组。）

### 组件名称过滤器

如果状态页面报告多个组件，您可以选择指定组件名称，以仅监控该特定组件。例如，要仅监控 us-east-1 中的 AWS EC2，您可以输入 `EC2 us-east-1`（状态页面上显示的确切组件名称）。

当同时设置了组件组时，组件名称过滤器将在该组 **内** 应用，让您能够定位较大组内的单个组件。当两个过滤器都未指定时，将监控范围内的所有组件。

### 高级选项

#### 超时

等待状态页面响应的最长时间（毫秒）。默认为 10000ms（10 秒）。

#### 重试次数

请求失败时的重试次数。默认为 3 次重试。

## 监控标准

您可以配置标准来判断外部服务何时被视为在线或离线，基于以下条件：

- **是否在线** – 状态页面是否可达并返回状态数据
- **整体状态** – 状态页面的整体状态指示器（例如 `operational`、`degraded_performance`、`partial_outage`、`major_outage`）
- **组件状态** – 范围内组件的状态（遵循组件组/组件名称过滤器）
- **活跃事件** – 状态页面上当前报告的活跃事件数量（设置过滤器时，限定到组件组/组件范围）
- **响应时间** – 获取状态页面数据所需的时间

### 默认标准

默认情况下，OneUptime 会根据状态页面真正重要的因素来设置标准——即其活跃事件和组件健康状况，而不仅仅是可达性：

- 当范围内没有活跃事件时，监控器被标记为 **在线**。
- 当范围内至少有一个活跃事件，或者范围内的某个组件报告 `degraded_performance`、`partial_outage`、`major_outage` 或 `full_outage` 时，监控器被标记为 **离线**（并创建一个事件）。

由于活跃事件计数和组件状态遵循组件组/组件名称过滤器，这些默认标准会自动仅针对您所关心的组件。

## 常用状态页面 URL

以下是您可以监控的常用服务状态页面 URL 的精选列表：

| 服务                          | 状态页面 URL                                  |
| ----------------------------- | --------------------------------------------- |
| AWS                           | `https://health.aws.amazon.com/health/status` |
| Google Cloud Platform         | `https://status.cloud.google.com`             |
| Microsoft Azure               | `https://status.azure.com`                    |
| GitHub                        | `https://www.githubstatus.com`                |
| OpenAI                        | `https://status.openai.com`                   |
| Anthropic                     | `https://status.anthropic.com`                |
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

> **注意：** 这些服务中有许多使用 Atlassian Statuspage 或 incident.io，因此 **自动** 提供商类型会自动检测它们。

## 事件和告警模板

从外部状态页面监控器创建事件或告警时，您可以使用以下模板变量：

| 变量                      | 描述                                                            |
| ------------------------- | -------------------------------------------------------------- |
| `{{isOnline}}`            | 状态页面是否在线（true/false）                                 |
| `{{responseTimeInMs}}`    | 响应时间（毫秒）                                               |
| `{{failureCause}}`        | 失败原因（如有）                                               |
| `{{overallStatus}}`       | 整体状态指示器值                                               |
| `{{activeIncidentCount}}` | 活跃事件数量（如有，限定到过滤器范围）                         |
| `{{componentStatuses}}`   | 组件状态的 JSON 数组（`name`、`status`、`description`、`groupName`） |
| `{{provider}}`            | 检测到的提供商（Atlassian Statuspage、incident.io、RSS、Atom） |
| `{{componentGroup}}`      | 监控器范围限定到的组件组（如有）                               |
| `{{componentName}}`       | 监控器范围限定到的组件（如有）                                 |

## 最佳实践

- **使用自动提供商类型**，除非您知道确切格式——自动检测对大多数状态页面都很有效
- **将范围限定到组件组**，如果您只依赖提供商的一部分（例如仅限 OpenAI 的"APIs"），这样无关事件就不会产生噪音
- **监控特定组件**，如果您只依赖某些服务（例如特定的 AWS 区域）
- **设置事件关联** — 当您的监控器检测到问题，而上游状态页面也显示问题时，有助于更快地识别根本原因
- **与其他监控器结合** — 将外部状态页面监控器与您自己的 API/网站监控器配合使用，以获得全面的可见性
