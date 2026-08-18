# 组件

组件就是你在触发器后面添加的那些构建模块。每个组件只干一件事——发一条消息、调一次 API、判断一个条件——然后接到后面的东西上。

这一页是目录。至于怎么在画布上添加和连接它们，见[创建工作流](/docs/workflows/authoring)。

## API

向任意 URL 发起一次 HTTP 请求。

**设置**：

- **Method**——`GET`、`POST`、`PUT`、`PATCH` 或 `DELETE`。
- **URL**——要调用的地址。
- **Headers**——要发送的头部。
- **Body**——`POST` / `PUT` / `PATCH` 的请求正文。

**Outputs**：

- **成功**——调用成功（2xx 响应）时开火。把状态码、头部和正文一并传下去。
- **错误**——网络失败或者非 2xx 响应时开火。把错误信息传下去。

适合：任何外部 API、你自己的管理端点，或者任何还没有专属组件的集成。

## AI

### Generate Text with AI

根据一段提示词和可选的 JSON 上下文，生成一条文本回复。这个组件用的是项目配置的默认 LLM 提供商；当安装层面有全局提供商时，就回退到它。提供商的凭据和端点是集中配置的，不是工作流参数。

**设置**：

- **System Instructions**——可选，用来交代模型的角色、语气和约束。
- **Prompt**——必填的任务描述。里面可以带工作流变量和前面组件的输出。
- **Context**——可选的 JSON，由你自己决定要不要随请求一起带上。它会被追加在一个明确的消息结束信任标记之后，并在消息剩下的部分里被当作不可信数据对待。
- **Temperature**——从 `0` 到 `1` 的变化幅度。默认是 `0.2`，让自动化的结果更可预测。
- **Maximum Output Tokens**——从 `1` 到 `4096`。默认是 `1024`。

System Instructions、Prompt 和序列化之后的 Context 加起来限制在 50,000 个字符以内。发给提供商的请求最长 60 秒，而且只尝试一次。每个项目最多同时跑三个工作流 AI 请求。

**Outputs**：

- **Response**——生成出来的文本。
- **提供商** 和 **Model**——这次调用用的是哪套配置。
- **Total Tokens** 和 **Completion Tokens**——提供商报告的用量。
- **LLM Log ID**——这次调用对应的那条计量 AI 日志。
- **错误**——验证、访问、提供商、预算、计费或者超时错误，有的话就在这里。

把 **成功** 接到要用这段回复的组件上。把 **错误** 接到一条明确的兜底、告警或者记录路径上。这个组件只发起一次模型请求，不带工具定义，也不带提供商原生的能力字段：它自己没法查询 OneUptime、调用 API 或者改动项目数据。除了 OneUptime 固定的组件安全指令之外，发给提供商的只有你配置的 System Instructions、Prompt 和 Context，而且是在这些字段里的工作流变量解析之后。配置好的提供商/模型仍然是一条信任边界，因为模型可能自带由提供商管理的能力。

模型的输出是不可信文本。拿它去发面向客户的沟通之前先审一遍，也别只凭一段自由格式的 AI 文本就去授权破坏性的工作流动作。提供商、出网、日志和成本方面的细节见[工作流配置与安全](/docs/workflows/configuration)。

## Webhook（出站）

API 组件的简化版，适合"发完就走"的场景。往一个 URL POST 一个 JSON 正文。

需要读响应就用 **API**。只想发个通知然后继续往下走，就用 **Webhook**。

## Slack

往一个 Slack 频道发消息。

**设置**：

- **频道**——频道名称。机器人必须已经在那个频道里。
- **消息**——要发送的文本。支持 Slack 的格式语法。

先在 **项目设置 → 工作区 → Slack** 下把 Slack 接到你的项目上。见 [Slack 工作区连接](/docs/workspace-connections/slack)。

## Microsoft Teams

往一个 Microsoft Teams 频道发消息。

**设置**：

- **Team and channel**——发到哪里。
- **消息**——要发送的文本。

配置方法见 [Microsoft Teams 工作区连接](/docs/workspace-connections/microsoft-teams)。

## Discord

通过一个入站 Webhook URL，往 Discord 频道发消息。

## Telegram

用一个机器人令牌和聊天 ID，往 Telegram 会话发消息。

## 电子邮件

通过 OneUptime 发一封邮件。

**设置**：

- **收件人**——收件人的邮箱地址。
- **主题**——邮件的主题行。
- **Body**——用 Markdown 或 HTML 写的正文。

邮件从你项目配置好的发件人那里发出去——见 [SMTP](/docs/emails/smtp)。

## Custom Code

当别的方块都做不到时，跑一小段 JavaScript。

**设置**：

- **代码**——你的 JavaScript。最后一个值（或者你从 async 函数里返回的值）就是这个方块的输出。
- **Arguments**——你可以传进去的具名值。

**Outputs**：成功（你的返回值）和错误（任何异常）。

适合：在两个系统之间重塑数据、做点小计算，以及任何还不值得单独做一个方块的事。要写更重的脚本，改用 [Runbook](/docs/runbooks/index)。

## JSON

在文本和 JSON 之间来回转换。

- **JSON → Text**——把一个 JSON 对象变成字符串。下一个方块要的是文本时很有用。
- **Text → JSON**——把一个字符串解析成 JSON 对象。东西是以文本形式送来的、而你需要读其中某个字段时很有用。

## 条件

按一次比较来分支。在 **添加组件** 面板里，这个方块叫 **If / Else**，在 条件 类别下面。

**设置**：

- **Left value**——通常是前面某个方块给出的值。
- **Operator**——`==`、`!=`、`>`、`>=`、`<`、`<=`、`contains`、`starts with`、`ends with`。
- **Right value**——拿来跟它比的东西。

**Outputs**：**是** 和 **否**。把后面的方块接到你想要的那条分支上。

## Delay

让工作流暂停一段时间再往下走。当你需要给另一个系统一点时间跟上时很有用。

## 日志

往运行日志里写一行。没有任何对外的影响——它只是出现在这个工作流的日志里给你看。调试时很顺手。

## Execute Workflow

从这个工作流里调用另一个工作流。被调用的那个独立运行——你的工作流不会等它跑完，会继续往下走。

用它来复用公共逻辑。把"往事件频道发消息"这件事搭成一个工作流，之后任何需要通知那个频道的工作流都来调它。

有一个安全上限，防止工作流之间无限地互相调用。见[工作流配置与安全](/docs/workflows/configuration)。

## OneUptime 数据组件

OneUptime 里的每一种记录（监视器、事件、警报、状态页面、值班策略，还有很多别的），在 **添加组件** 面板里都有下面这几个组件——按类型的名字搜就行。每个标题都是从记录类型生成出来的，所以监视器这一组是这样的：

- **Find One Monitor**——读取一条匹配查询的记录。
- **Find Many Monitors**——读取一批匹配查询的记录。
- **Create One Monitor**——用一个 JSON 对象新增一条记录。
- **Create Many Monitors**——用一个 JSON 数组新增多条记录。
- **Update One Monitor**——把写入载荷应用到一条匹配的记录上。
- **Update Many Monitors**——把写入载荷应用到匹配的记录上，最多到 Limit 条。
- **Delete One Monitor**——删掉一条匹配的记录。
- **Delete Many Monitors**——删掉匹配的记录，最多到 Limit 条。

同一组还给你三个触发器——**On Create Monitor**、**On Update Monitor** 和 **On Delete Monitor**。见[工作流触发器](/docs/workflows/triggers)。

一种类型只提供它的模型允许的那些组件。只读的类型就只有两个 Find 组件，别的都没有，所以你要是在面板里找不到 **Delete One Monitor**，说明那个类型不允许删。

工作流就是这样读写 OneUptime 数据的。举个例子：从你 CI 工具来的一个 Webhook，可以用 **Create One Incident** 带上失败详情开一个事件。

## 处理记录

数据组件上的每个字段，用的都是记录自己的 **列** 名——和 API 用的是同一套名字，不是控制台表单上的那些标签。ID 列叫 `_id`。凡是能填列名的地方，`id` 这种写法都作为别名被接受，但记录还给你的是 `_id`，所以出来的时候你要读的是它：

```json
{ "_id": "00000000-0000-0000-0000-000000000000" }
```

**Query** 决定这个组件作用在哪些记录上。键是列，值是要匹配的内容：

```json
{ "monitorType": "Website", "isEnabled": true }
```

查询永远被限定在工作流所在的那个项目里。你够不着别的项目的记录，也不需要自己往查询里加项目。

Create One 上的 **JSON Object**、Create Many 上的 **JSON Array**，还有 Update 组件上的 **Data (JSON Object)**，装的是要写进去的字段，键的写法完全一样：

```json
{ "name": "Checkout API", "monitorType": "Website" }
```

不是列的键会被忽略，而不是被拒绝——运行日志会点名它丢掉的那些，所以某个字段没落地的时候去那儿看。Find 组件和触发器上的 **Select Fields** 用的也是这套列名做键，值填 `true`：`{"_id": true, "name": true}`。

**跳过** 和 **Limit** 是 Find Many、Update Many 和 Delete Many 上的两个数字字段——`Skip: 0` 配 `Limit: 100` 取的是前一百条匹配。Limit 默认是 `10`，而且在 Update Many 和 Delete Many 上，它限的是真正被写的记录条数，不只是返回多少条。所以 `Items Deleted: 10` 的意思是删掉了十条，不是匹配到了十条。你打算改动超过十条时，记得把 Limit 调大。

**成功** 和 **错误** 报告的是查询有没有跑通，不是它找到了什么。一个什么都没匹配到的查询返回 `0`，照样从成功那边出去——那不算失败。要根据有没有匹配到来分支，就在一个 **If / Else** 方块里读那个返回的计数。

## 我该用哪个组件？

几条速记规则：

- 如果你要做的事有专属方块（Slack、电子邮件、某种 OneUptime 记录），就用它——错误处理更贴心，日志也更清楚。
- 除此之外的任何外部 API，用 **API**。
- 要对你明确选定的工作流数据做摘要、分类或者起草文本，用 **Generate Text with AI**。
- 要在方块之间重塑数据，用 **Custom Code** 或 **JSON**。
- 要根据某个值走不同的动作，用 **条件**。

## 接下来读什么

- [工作流变量](/docs/workflows/variables) —— 在方块之间传递数据。
- [工作流运行与日志](/docs/workflows/runs-and-logs) —— 查看一次运行里每个方块干了什么。
- [工作流配置与安全](/docs/workflows/configuration) —— 上限、所有者和密钥。
