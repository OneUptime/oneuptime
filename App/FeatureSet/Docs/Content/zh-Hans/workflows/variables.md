# 变量

工作流的核心是数据流动——从触发器到第一个模块、从一个模块到下一个、从共享的值到任何需要的地方。变量就是数据流动的方式。

有两种,它们共用同一种语法。

## 全局变量

项目级的值,保存一次就可以在任何地方复用。比如 API 密钥、URL、频道名——任何你不想复制到十个不同工作流里的东西。

在 **工作流 → 全局变量** 下查看。每个变量有:

- **名称**——你引用它的方式。使用 `UPPER_SNAKE_CASE`,这样在模块里更显眼。
- **值**——实际的值。也支持多行值。
- **是否密钥**——开启后,保存之后值会在 UI 中隐藏,并且不会出现在运行日志里。

在任意工作流中用以下语法引用全局变量:

```
{{variable.NAME}}
```

例如,如果你保存了 PagerDuty 密钥为 `PAGERDUTY_KEY`,任意模块都可以用 `{{variable.PAGERDUTY_KEY}}` 引用它——真正的密钥不会出现在工作流或它的日志中。

## 局部变量(来自前面模块的数据)

局部变量是本次执行中已经运行的模块的输出。每个触发器和每个组件都会产生一些可以读取的输出。

像这样引用前一个模块的输出:

```
{{BlockName.fieldName}}
```

`BlockName` 是画布上触发器或组件的名称(你可以把它改成简短清晰的名字)。`fieldName` 是该模块产生的内容。

示例:

- 一个名为 `LookupUser` 的 **API** 模块运行后,你可以读取状态码 `{{LookupUser.response-status}}` 和响应体 `{{LookupUser.response-body}}`。
- 在一个名为 `Incident` 的 **事件 → 创建时** 触发器之后,你可以读取 `{{Incident.title}}`、`{{Incident.description}}` 以及事件上的任意其他字段。
- 在一个名为 `Transform` 的 **自定义代码** 模块之后,返回的值位于 `{{Transform.value}}`。

局部变量只在当前运行期间存在。每次新的运行都是全新开始。

## 变量在哪里可用

几乎每个文本字段都接受变量:

- API 模块的 URL。
- Slack、Teams、Discord、Telegram、邮件的消息文本。
- 邮件的主题和正文。
- 头部和正文字段(在字符串值中)。
- 条件模块的两侧。

纯 JSON 字段在字符串值里可以使用变量,但不能把变量当作键。如果你需要动态构建结构,使用 **自定义代码** 模块来构建,然后把它的输出传给下一个模块。

**自定义代码** 模块读取变量的方式不同——全局变量通过 `args.variables` 传入,而前面模块的输出由你决定以参数形式传入哪些。

## 示例

### 从 webhook 构建一个负载

一个 webhook 到达,请求体类似 `{ "service": "checkout", "status": "failed" }`。要把它转换成 OneUptime 事件:

1. 名为 `CIWebhook` 的 **Webhook** 触发器。
2. **条件** 模块:左侧 `{{CIWebhook.Request Body.status}}`、运算符 `==`、右侧 `failed`。
3. 从 **是** 分支接一个 **Create Incident** 模块:
   - 标题:`CI build failed: {{CIWebhook.Request Body.service}}`
   - 描述:`See {{CIWebhook.Request Body.url}} for the logs.`

### 在 API 调用中使用密钥

一个调用 PagerDuty 的工作流:

1. 把 `PAGERDUTY_KEY` 保存为密钥型全局变量。
2. 在 **API** 模块上,把 `Authorization` 头设为 `Token token={{variable.PAGERDUTY_KEY}}`。

密钥不会出现在工作流和日志里。

### 串接两个 API 调用

第一个调用返回的 ID 是第二个调用需要的:

1. **API** 模块 `LookupOrder`:`GET /orders?email={{Manual.JSON.email}}`。
2. **API** 模块 `CancelOrder`:`POST /orders/{{LookupOrder.response-body.id}}/cancel`。

如果 `LookupOrder` 失败,触发的是它的 **错误** 输出而不是 **成功**。把它连接到邮件或 Slack 模块,这样失败就不会被忽略。

## 注意点

- **重命名模块会破坏引用。** 如果重命名了一个模块,要更新所有引用它的地方。在运行日志里,未解析的引用会显示为字面文本 `{{BlockName.field}}`。
- **变量名区分大小写。** `{{variable.MyKey}}` 和 `{{variable.mykey}}` 是不同的。
- **缺失的字段会变为空。** 引用不存在的字段会得到空字符串,而不是错误。这虽然方便——但可能掩盖 bug。在继续之前使用 **条件** 模块检查重要字段。

## 接下来读什么

- [组件](/docs/workflows/components)——每个模块产生的完整输出列表。
- [运行与日志](/docs/workflows/runs-and-logs)——在运行后查看每个变量的实际值。
- [配置与安全](/docs/workflows/configuration)——哪些内容适合放进全局变量。
