# 组件

组件是你在触发器之后添加的构建模块。每一个都只做一件事——发送一条消息、调用一个 API、检查一个条件——并连接到接下来的模块。

本页是组件目录。关于如何在画布上添加和连接它们,见 [Authoring a Workflow](/docs/workflows/authoring)。

## API

向任意 URL 发起一次 HTTP 请求。

**Settings**:

- **Method**——`GET`、`POST`、`PUT`、`PATCH` 或 `DELETE`。
- **URL**——要调用的地址。
- **Headers**——要发送的任意头部。
- **Body**——用于 `POST` / `PUT` / `PATCH` 的请求体。

**Outputs**:

- **Success**——调用成功(2xx 响应)时触发。随之带出状态码、头部和响应体。
- **Error**——发生网络失败或非 2xx 响应时触发。随之带出错误信息。

适合用于:任意外部 API、你自己的管理端点,或任何没有专用组件的集成。

## AI

### Generate Text with AI

根据一段提示词和可选的 JSON 上下文生成一条文本回复。该组件使用项目配置的默认 LLM 提供方,在有可用配置时,回退到安装实例的全局提供方。提供方凭证和端点是集中配置的,不是工作流参数。

**Settings**:

- **System Instructions**——可选,用来指导模型的角色、语气和约束。
- **Prompt**——必填的任务描述。可以包含工作流变量以及前面组件的输出。
- **Context**——可选的 JSON,由你主动决定是否随请求一起带上。它会被附加在一个明确的消息结束信任标记之后,并且在消息的其余部分中都被当作不受信任的数据处理。
- **Temperature**——变化程度,从 `0` 到 `1`。默认值为 `0.2`,以便自动化流程有可预测的结果。
- **Maximum Output Tokens**——从 `1` 到 `4096`。默认值为 `1024`。

System Instructions、Prompt 和序列化后的 Context 加在一起,限制在 50,000 个字符以内。提供方请求的最长时长为 60 秒,并且只会尝试一次。每个项目最多可以有三个工作流 AI 请求并发运行。

**Outputs**:

- **Response**——生成的文本。
- **Provider** 和 **Model**——本次调用实际使用的配置。
- **Total Tokens** 和 **Completion Tokens**——提供方报告的用量。
- **LLM Log ID**——本次调用对应的计费 AI 日志条目。
- **Error**——出现时的校验、访问权限、提供方、预算、账单或超时错误。

把 **Success** 连接到需要使用这条回复的模块。把 **Error** 连接到一条明确的兜底、告警或日志路径。该组件只发起一次模型请求,不带工具定义或提供方原生能力字段:它不能自行查询 OneUptime、调用 API 或更改项目数据。除了 OneUptime 固定的组件安全指令之外,只有你配置的 System Instructions、Prompt 和 Context 会被发送给提供方,而且是在这些字段中的工作流变量被解析之后才发送。所配置的提供方/模型仍然是一个信任边界,因为一个模型可能具备提供方自身内置的能力。

模型输出是不受信任的文本。在把它发给面向客户的通信之前先审阅一遍,也不要单凭自由文本形式的 AI 输出,来授权具有破坏性的工作流操作。提供方、出站流量、日志记录和成本方面的细节,见 [Configuration & Safety](/docs/workflows/configuration)。

## Webhook(出站)

API 组件的简化版本,适合"发出去就不管了"的场景。向一个 URL 发送一段 JSON 正文。

如果你需要读取响应,用 **API**。如果你只想发个通知然后继续,用 **Webhook**。

## Slack

向一个 Slack 频道发送一条消息。

**Settings**:

- **Channel**——频道名称。机器人必须已经在那个频道里。
- **Message**——要发送的文本。支持 Slack 格式。

请先在 **Project Settings → Workspace → Slack** 下把 Slack 连接到你的项目。见 [Slack Workspace Connection](/docs/workspace-connections/slack)。

## Microsoft Teams

向一个 Microsoft Teams 频道发送一条消息。

**Settings**:

- **Team and channel**——发布到哪里。
- **Message**——要发送的文本。

设置方式见 [Microsoft Teams Workspace Connection](/docs/workspace-connections/microsoft-teams)。

## Discord

通过一个入站 webhook URL,向一个 Discord 频道发送一条消息。

## Telegram

使用一个机器人令牌和聊天 ID,向一个 Telegram 聊天发送消息。

## Email

通过 OneUptime 发送一封邮件。

**Settings**:

- **To**——收件人的邮箱地址。
- **Subject**——邮件主题。
- **Body**——Markdown 或 HTML 格式的正文内容。

邮件会从你项目配置的发件人发出——见 [SMTP](/docs/emails/smtp)。

## Custom Code

当其他模块办不到时,运行一小段 JavaScript。

**Settings**:

- **Code**——你的 JavaScript 代码。最后的值(或者异步函数中 return 的值)会成为该模块的输出。
- **Arguments**——你可以传入的具名值。

**Outputs**:success(你的返回值)和 error(任何异常)。

适合用于:在两个系统之间整形数据、做一个小计算,或者任何不值得单独做一个模块的事情。需要更重的脚本能力时,改用 [Runbook](/docs/runbooks/index)。

## JSON

在文本和 JSON 之间转换。

- **JSON → Text**——把一个 JSON 对象转换成字符串。当下一个模块需要文本时有用。
- **Text → JSON**——把一个字符串解析成 JSON 对象。当某些内容以文本形式传来、而你需要读取其中某个字段时有用。

## Conditions

基于一次比较来分支。在 **Add Component** 面板中,这个模块叫 **If / Else**,归在 Conditions 分类下。

**Settings**:

- **Left value**——通常是前面某个模块的一个值。
- **Operator**——`==`、`!=`、`>`、`>=`、`<`、`<=`、`contains`、`starts with`、`ends with`。
- **Right value**——用来比较的对象。

**Outputs**:**Yes** 和 **No**。把后续模块连接到你想要的那条分支上。

## Delay

让工作流暂停一段设定的时间后再继续。当你需要给另一个系统一点时间来跟上时很有用。

## Log

向运行日志写一行。没有任何外部影响——它只会出现在工作流的日志里供你查看。便于调试。

## Execute Workflow

从当前工作流中调用另一个工作流。被调用的工作流会独立运行——你的工作流不会等它执行完成。

用它来共享通用逻辑。构建一次"发布到事件频道"的工作流,然后在任何需要通知该频道的其他工作流里调用它。

有一个安全限制,防止工作流之间循环互相调用。见 [Configuration & Safety](/docs/workflows/configuration)。

## OneUptime 数据组件

对于 OneUptime 中的每一种记录类型(监视器、事件、告警、状态页、值班策略,以及更多),**Add Component** 面板都提供这些组件——按类型名称搜索即可。每个标题都是根据记录类型生成的,所以 Monitor 这一组是:

- **Find One Monitor**——读取一条匹配查询条件的记录。
- **Find Many Monitors**——读取一批匹配查询条件的记录。
- **Create One Monitor**——用一个 JSON 对象新增一条记录。
- **Create Many Monitors**——用一个 JSON 数组新增多条记录。
- **Update One Monitor**——把写入负载应用到一条匹配的记录上。
- **Update Many Monitors**——把写入负载应用到匹配的记录上,最多 Limit 条。
- **Delete One Monitor**——删除一条匹配的记录。
- **Delete Many Monitors**——删除匹配的记录,最多 Limit 条。

同一组类型还提供三个触发器——**On Create Monitor**、**On Update Monitor** 和 **On Delete Monitor**。见 [Triggers](/docs/workflows/triggers)。

一种类型只会提供它的模型所允许的那些组件。一个只读类型只有两个 Find 组件,没有别的,所以如果你在面板里找不到 **Delete One Monitor**,说明该类型不允许删除。

这就是工作流读取和修改 OneUptime 数据的方式。例如:来自你 CI 工具的一个 webhook,可以用 **Create One Incident** 开启一个带有失败详情的事件。

## 处理记录

数据组件上的每个字段,都是以记录自身的 **column** 名称为键的——和 API 使用的名称相同,不是仪表板表单上显示的标签。ID 列是 `_id`。在任何可以填写列名的地方,都可以用 `id` 这个拼法作为别名,但记录返回给你的是 `_id`,所以读取时要认准这个:

```json
{ "_id": "00000000-0000-0000-0000-000000000000" }
```

**Query** 决定这个组件会作用于哪些记录。键是列名,值是要匹配的内容:

```json
{ "monitorType": "Website", "isEnabled": true }
```

一次查询始终限定在工作流所在的那个项目范围内。你无法触及另一个项目的记录,也不需要自己把项目加进查询条件里。

Create One 上的 **JSON Object**、Create Many 上的 **JSON Array**,以及 Update 系列组件上的 **Data (JSON Object)**,承载的是要写入的字段,键的写法是一样的:

```json
{ "name": "Checkout API", "monitorType": "Website" }
```

不是列名的键会被忽略而不是拒绝——运行日志会点出它丢弃了哪些键,所以某个字段没生效时可以去那里查看。**Select Fields** 出现在 Find 组件和触发器上,用同样的列名作键,值为 `true`:`{"_id": true, "name": true}`。

**Skip** 和 **Limit** 是 Find Many、Update Many 和 Delete Many 上的两个数字字段——`Skip: 0` 配 `Limit: 100` 会取前一百条匹配记录。Limit 默认是 `10`,而在 Update Many 和 Delete Many 上,它限制的是实际被写入的记录数,而不只是返回了多少条。所以 `Items Deleted: 10` 的意思是删除了十条记录,而不是匹配到了十条。当你想修改超过十条记录时,要调高 Limit。

**Success** 和 **Error** 反映的是这次查询是否执行成功,而不是它有没有找到东西。一次没有匹配到任何记录的查询会返回 `0`,并且仍然走 Success——这不算失败。要根据是否有东西匹配来分支,得在一个 **If / Else** 模块里读取返回的数量。

## 我该用哪个组件?

几条简单的经验法则:

- 如果有为你想做的事情量身定制的模块(Slack、Email、某个 OneUptime 记录),就用它——你会得到更好的错误处理和更清晰的日志。
- 对于任何其他外部 API,用 **API**。
- 要基于明确选定的工作流数据来总结、分类或起草文本,用 **Generate Text with AI**。
- 要在模块之间整形数据,用 **Custom Code** 或 **JSON**。
- 要根据某个值采取不同的动作,用 **Conditions**。

## 接下来读什么

- [Workflow Variables](/docs/workflows/variables)——在模块之间传递数据。
- [Workflow Runs & Logs](/docs/workflows/runs-and-logs)——查看某次运行中每个模块做了什么。
- [Workflow Configuration & Safety](/docs/workflows/configuration)——限制、所有者和密钥。
