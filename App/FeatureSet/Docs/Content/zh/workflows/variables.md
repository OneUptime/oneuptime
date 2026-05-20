# 工作流变量

只有数据在工作流中流动，它才有用。变量就是数据流动的方式——从触发器到第一个组件、从一个组件的输出到下一个组件的输入、从项目级密钥到所有引用它的地方。

OneUptime 有两种变量，以及一套对两者都生效的插值语法。

## 全局变量

在 **工作流 → 全局变量** 下定义一次的项目级值。比如 API key、基础 URL、频道名称——任何你不想硬编码到十个工作流里的东西。

一个全局变量包含：

- **Name** — 引用它的标识符。用 `UPPER_SNAKE_CASE` 让它在模板里更显眼。
- **Value** — 字符串值。支持多行。
- **Is Secret** — 打开后，值在保存后界面变为只写，并在运行日志中被打码。

在任意工作流的任意位置引用全局变量：

```
{{variable.NAME}}
```

例如，如果你把 `PAGERDUTY_KEY` 定义为密钥型变量，那么每个调用 PagerDuty 的 API 组件都可以用 `{{variable.PAGERDUTY_KEY}}` 读到它，而工作流的 JSON 里不会出现真实 key。

## 本地变量

本地变量是在本次执行中已经运行过的节点的返回值。每个触发器、每个组件都会发布一份——按节点列出的清单见 [工作流触发器](/docs/workflows/triggers) 和 [工作流组件](/docs/workflows/components)。

本地变量的引用方式：

```
{{NodeId.fieldName}}
```

`NodeId` 是触发器或组件在画布上的名称（为了可读性可以重命名——保持简短并使用 `PascalCase` 让引用更整洁）。`fieldName` 是该节点发布的字段名。

例子：

- 在一个名为 `LookupUser` 的 **API** 组件成功返回后，下游节点可以用 `{{LookupUser.response-status}}` 读到状态码、用 `{{LookupUser.response-body}}` 读到解析后的响应体。
- 在一个名为 `Incident` 的 **Incident → On Create** 触发器之后，可以读 `{{Incident.title}}`、`{{Incident.description}}`、`{{Incident.incidentSeverityId}}` 等事件上的任意列。
- 在一个名为 `Transform` 的 **Custom Code** 组件之后，其返回的值通过 `{{Transform.value}}` 暴露。

本地变量的作用域是单次运行。下一次运行从干净状态开始。

## 插值在哪里生效

几乎所有文本类的参数都支持插值：

- API 组件的 URL 字段
- Slack / Teams / Discord / Telegram / Email 的消息文本
- Email 的主题和正文
- Headers 与请求体字段（在 JSON 值里使用）
- Conditions 的左右操作数

纯 JSON 类参数支持在字符串值中插值；你不能对键做插值。如果你需要构造动态结构，用 **Custom Code** 拼装负载，然后把它的返回值喂给下一节点。

**Custom Code** 组件读取变量的方式不同——全局变量通过 `args.variables` 暴露，上游返回值则作为你在组件上配置的命名参数传入。

## 例子

### 从触发器构造负载

一个 webhook 收到 CI 构建结果。请求体是类似 `{ "service": "checkout", "status": "failed" }` 的 JSON。把它变成 OneUptime 事件：

1. **Webhook** 触发器命名为 `CIWebhook`。
2. **Conditions** 组件：左 `{{CIWebhook.Request Body.status}}`，操作符 `==`，右 `failed`。
3. 从 `yes` 端口接一个 **Create Incident** 组件：
   - Title：`CI build failed: {{CIWebhook.Request Body.service}}`
   - Description：`See {{CIWebhook.Request Body.url}} for the build logs.`

### 在出站 API 调用中使用密钥

一个调用 PagerDuty 的工作流：

1. 把 `PAGERDUTY_KEY` 定义为密钥型全局变量。
2. 在 **API** 组件上，把 `Authorization` 头设为 `Token token={{variable.PAGERDUTY_KEY}}`。

key 永远不会出现在工作流 JSON 或运行日志中。

### 串联两个 API 调用

第一个调用返回的 ID 是第二个调用需要的：

1. **API** 组件 `LookupOrder`：`GET /orders?email={{Manual.JSON.email}}`。
2. **API** 组件 `CancelOrder`：`POST /orders/{{LookupOrder.response-body.id}}/cancel`。

如果 `LookupOrder` 返回非 2xx 响应，它会触发 `error` 端口而非 `success`——把那条分支接到 Email 或 Slack 组件，让失败不会被悄悄忽略。

## 几个坑

- **节点名打字错误会让引用静默失效。** 如果你在下游引用了 `{{OldName.field}}` 之后又重命名了节点，要把所有引用都更新。看运行日志——如果你在捕获到的参数里看到字面的 `{{OldName.field}}`，说明查找没有解析。
- **密钥区分大小写。** `{{variable.MyKey}}` 和 `{{variable.mykey}}` 是不同的变量。
- **缺失字段为空。** 引用 `{{Foo.nonexistent}}` 产生空字符串，而不是错误。这有时有用，但也可能掩盖 bug——如果某个字段在下一步是必需的，用 **Conditions** 节点先断言它的存在。

## 接下来读什么

- [工作流组件](/docs/workflows/components) — 返回值名称的完整清单。
- [工作流运行与日志](/docs/workflows/runs-and-logs) — 运行后查看每个插值参数的字面值。
- [工作流配置与安全](/docs/workflows/configuration) — 什么适合放进全局变量。
