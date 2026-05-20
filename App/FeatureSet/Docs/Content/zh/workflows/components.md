# 工作流组件

组件是你放在触发器之后的动作节点。每一个只做一件事——发起 HTTP 请求、发 Slack 消息、按条件分支、运行 JavaScript 片段——并暴露一个或多个输出端口供下一节点连接。

本页是清单。关于连线规则和画布本身，见 [创建工作流](/docs/workflows/authoring)。

## API

向任意 URL 发起出站 HTTP 请求。

**参数**：

- **Method** — `GET`、`POST`、`PUT`、`PATCH`、`DELETE`。
- **URL** — 请求 URL。支持插值。
- **Request Headers** — 头的 JSON 对象。
- **Request Body** — `POST` / `PUT` / `PATCH` 的 JSON 或文本请求体。

**输出端口**：

- `success` — 响应状态为 2xx 时触发。返回值：`response-status`、`response-headers`、`response-body`。
- `error` — 网络失败或非 2xx 响应时触发。返回值：`error` 消息。

适用场景：任意第三方 REST API、你自己的管理端点、没有专用组件的轻量集成。

## Webhook（出站）

是 API 组件围绕"发出不管"这一常见场景的简化封装。向一个 URL 发 JSON 请求体，并暴露一对 `success` / `error`。

如果你需要在下游读取响应体，优先用 **API**；如果你只想通知另一个系统，用 **Webhook**。

## Slack

使用项目的 Slack 工作区连接向 Slack 频道发消息。

**参数**：

- **Channel name** — 要发送到的频道。机器人必须已经是该频道的成员。
- **Message text** — 正文。支持插值；支持 Slack mrkdwn。

先在 **项目设置 → 工作区连接 → Slack** 中配置工作区连接。见 [Slack 工作区连接](/docs/workspace-connections/slack)。

## Microsoft Teams

使用项目的 Teams 连接向 Microsoft Teams 频道发消息。

**参数**：

- **Team & channel** — 目的地。
- **Message text** — 正文。

连接配置见 [Microsoft Teams 工作区连接](/docs/workspace-connections/microsoft-teams)。

## Discord

通过在组件上配置的入站 webhook URL 向 Discord 频道发消息。

## Telegram

通过在组件上配置的机器人 token 和 chat ID 向 Telegram 聊天发送消息。

## Email

通过 OneUptime 的 SMTP 配置发送邮件。

**参数**：

- **To** — 收件人邮箱地址。
- **Subject** — 支持插值。
- **Body** — Markdown 或 HTML。

邮件从项目配置的发件地址发出（见 [SMTP](/docs/emails/smtp)）。

## Custom Code

运行一段可以访问工作流变量与上游节点返回值的 JavaScript 片段。

**参数**：

- **Code** — JavaScript 主体。最后一个表达式的值（或 `(async () => { ... })()` 返回的值）成为组件的返回值。
- **Arguments** — 可选的命名参数，作为 `args` 传入。

**输出端口**：`success`（返回值）、`error`（捕获的异常）。

适用场景：在两个系统之间转换负载、做一个不值得单开组件的小计算、调用仅 JS 的逻辑。需要在你自己的基础设施中运行的更重型脚本，应该作为 [Runbook](/docs/runbooks/index) 的 Bash 或 JavaScript 步骤。

## JSON

在文本和 JSON 之间转换。

- **JSON → Text** — 把 JSON 对象序列化为字符串（适合作为期望文本的出站组件 `body` 参数的输入）。
- **Text → JSON** — 把字符串解析为 JSON 对象。当上游 API 以文本形式返回响应体但你需要读取某个字段时很有用。

## Conditions

基于比较做分支。配置：

- **Left value** — 通常是 `{{Incident.title}}` 这样的插值引用。
- **Operator** — `==`、`!=`、`>`、`>=`、`<`、`<=`、`contains`、`starts with`、`ends with`。
- **Right value** — 要比较的值。

**输出端口**：`yes` 和 `no`。把工作流的后续连到符合你意图的那条分支。

## Schedule（延迟）

让工作流在继续之前暂停一段配置好的时长。当你需要给外部系统一点时间稳定下来再检查其状态时很有用。

## Log

向工作流运行日志写一行。纯调试辅助；该行会被捕获在运行上，可在 **日志** 下查看。无外部副作用。

## Execute Workflow

把另一个工作流作为子步骤调用。被调用的工作流独立运行（发出不管）——调用一旦派发，控制权就立即返回给调用方。

用它把共享逻辑从多个工作流中抽出：构建一个 "post-to-incident-channel" 工作流一次，从所有需要通知该频道的其它工作流调用它。

递归限制可防止工作流之间陷入无限循环调用。见 [工作流配置与安全](/docs/workflows/configuration)。

## 模型组件（对 OneUptime 实体的增删改查）

对每个支持工作流的 OneUptime 实体（监控、事件、告警、状态页、值班策略等），面板都会自动暴露下列组件——可按实体名搜索：

- **Find One {Entity}** — 按查询取一条记录。
- **Find {Entity}** — 按查询取一组记录（分页）。
- **Create {Entity}** — 插入新记录。
- **Update {Entity}** — 按 ID 更新一条记录。
- **Delete {Entity}** — 按 ID 删除一条记录。
- **Count {Entity}** — 统计匹配查询的记录数。

这是工作流不离开平台就能读写 OneUptime 状态的方式。例如：来自你 CI 工具的 webhook 用构建失败信息调用 **Create Incident**；或者一个调度工作流每五分钟跑一次 **Find Incident** 并以邮件发送摘要。

## 选对组件

一些经验法则：

- 如果你想做的事已经有专用组件（Slack、Email、对 OneUptime 实体的 CRUD），就用它——它给你更友好的错误处理和更清晰的日志，胜过自己拼一个。
- 如果你要调一个没有专用组件的外部 HTTP API，用 **API**。
- 如果你需要在两个组件之间*塑形*数据，用 **Custom Code** 或 **JSON**。
- 如果你需要根据某个值做出不同的动作，用 **Conditions**。

## 接下来读什么

- [工作流变量](/docs/workflows/variables) — 如何把数据从一个组件喂给下一个。
- [工作流运行与日志](/docs/workflows/runs-and-logs) — 如何查看每个组件在某次运行中的返回值。
- [工作流配置与安全](/docs/workflows/configuration) — 限制、所有权和密钥。
