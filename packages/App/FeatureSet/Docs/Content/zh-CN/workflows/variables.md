# 变量

工作流做的事情就是搬运数据——从触发器搬到第一个方块，从一个方块搬到下一个，再把共享的值搬到任何你需要它的地方。变量就是数据搬运的方式。

变量有两种作用域，另外还有运行过程中产生的组件输出。

## 全局变量

项目范围的值，存一次，到处都能用。想想 API key、URL、频道名——任何你不想复制到十个不同工作流里的东西。

在 **工作流 → 全局变量** 下找到它们。每个变量有：

- **名称**——你引用它时用的名字。至少两个字符，不能有空格，只能用字母、数字、连字符和下划线。养成用 `UPPER_SNAKE_CASE` 的习惯是好事，因为它在方块里一眼就能认出来。
- **描述**——可选，随便写点什么，提醒自己它是干嘛用的。
- **密钥**——打开之后，这个值会从运行日志和步骤追踪里被抹掉。
- **内容**——真正的值。这是个长文本字段，多行的值也放得下。

在任何工作流里，这样用一个全局变量：

```
{{global.variables.NAME}}
```

举个例子，如果你把 PagerDuty 的 key 存成了 `PAGERDUTY_KEY`，任何方块都能用 `{{global.variables.PAGERDUTY_KEY}}` 取到它——编辑器存的是这个引用，而工作流日志会把解析出来的密钥值抹掉。

变量只能创建和删除，不能编辑。表格上没有编辑按钮，所以要在界面里改一个值，你得先把这个变量删掉再重新建一个——或者通过 API 更新它，本页最后会讲这件事。全局变量和工作流变量是 Growth 套餐的功能。

## 工作流内的局部变量

只属于某一个工作流的变量，在这个工作流左侧菜单的 **工作流变量** 下管理。这样引用它们：

```
{{local.variables.NAME}}
```

## 组件输出（前面方块给的数据）

每个触发器和组件都可能在一次执行中产出输出。用编辑器里的组件取值选择器来生成引用，别自己敲——它插进去的是执行器真正认的那些 id。

这样引用前面某个方块的输出：

```
{{local.components.COMPONENT_ID.returnValues.FIELD_ID}}
```

`COMPONENT_ID` 是方块的 **Identifier**——方块上显示的那个短 id，不是它上面显示的名字。新方块拿到的 id 长得像 `api-get-1`，你可以在方块的 **ID** 区域里改。改了它，所有已经指向它的引用都会失效，和给变量改名是一个道理。`FIELD_ID` 是你选中的那个返回值 id。

几个例子：

- 一个 ID 为 `lookup-user` 的 **API** 组件跑完之后，它的状态码是 `{{local.components.lookup-user.returnValues.response-status}}`，正文是 `{{local.components.lookup-user.returnValues.response-body}}`。
- 一个 ID 为 `transform` 的 **Run Custom JavaScript** 组件跑完之后，它返回的值是 `{{local.components.transform.returnValues.returnValue}}`。
- 针对某种记录类型的触发器——**On Create Incident** 以及同类的那些——只返回一个值 `model`，你从它往里取。对于 ID 是 `incident-on-create-1` 的触发器，事件的标题就是 `{{local.components.incident-on-create-1.returnValues.model.title}}`。

局部变量只在当前这次运行期间存在。每一次新的运行都从头开始。

## 变量在哪些地方能用

几乎每个文本字段都接受变量：

- API 方块上的 URL。
- Slack、Teams、Discord、Telegram、电子邮件的消息文本。
- 邮件的主题和正文。
- 头部和正文字段（在字符串值内部）。
- **If / Else** 方块的左右两边（它列在 条件 类别下）。

在 JSON 字段里，你可以在字符串值内部使用变量，但不能拿它当键。如果一个引用独占了整个值，它会被原样替换进去，你可以用这个办法把一整个对象塞进 JSON 字段。要动态地拼出一个结构，就先用 **Run Custom JavaScript** 方块把它拼好，再把输出传给下一个方块。

**Run Custom JavaScript** 方块不会自动拿到变量——沙箱里什么都不会被注入。把 `{{global.variables.NAME}}`（或者任何组件引用）放进这个方块的 **Arguments** JSON 字段里；这些值会在脚本运行之前被替换掉，然后作为 `args` 送进去。

## 遍历数组

在文本字段里，你可以用 `{{#each path}}…{{/each}}` 遍历一个数组。在这段块里面，`{{property}}` 读的是当前元素的属性，`{{@index}}` 是从 0 开始的位置；如果数组里装的是纯值，`{{this}}` 就是元素本身。`{{#each}}` 块里的名字会被去掉首尾空格，所以在那儿多打的空格没有害处——别的地方可不是这样。

## 例子

### 用 Webhook 的数据拼一个载荷

一个 Webhook 送来的正文长这样：`{ "service": "checkout", "status": "failed" }`。要把它变成一个 OneUptime 事件：

1. 一个 id 为 `ci-webhook` 的 **Webhook** 触发器。
2. 一个 **If / Else** 方块：选中这个 Webhook 的 Request Body 输出，取它的 `status` 属性，运算符 `==`，右边填 `failed`。
3. 从 **是** 分支接出一个 **Create One Incident** 方块：
   - 标题：`CI build failed: {{local.components.ci-webhook.returnValues.request-body.service}}`
   - 描述：`See {{local.components.ci-webhook.returnValues.request-body.url}} for the logs.`

### 在 API 调用里用一个密钥

一个调用 PagerDuty 的工作流：

1. 把 `PAGERDUTY_KEY` 存成一个标记为密钥的全局变量。
2. 在 **API** 方块上，把 `Authorization` 头设成 `Token token={{global.variables.PAGERDUTY_KEY}}`。

这个 key 既不会留在工作流里，也不会留在日志里。

### 把两次 API 调用串起来

第一次调用给你一个 ID，第二次要用它：

1. **API** 组件 `lookup-order`：用选择器把手动触发器 JSON 里的 email 字段插进 `GET /orders?email=...`。
2. **API** 组件 `cancel-order`：`POST /orders/{{local.components.lookup-order.returnValues.response-body.id}}/cancel`。

如果 `lookup-order` 失败了，开火的是它的 **错误** 输出而不是 **成功**。把这个输出接到一个电子邮件或 Slack 方块上，失败就不会没人发现。

## 从工作流里更新一个变量

一个常见的做法是按计划轮换凭据：从第三方取一个新令牌，再把它存回变量里，下一次运行就能用上。用一个调用 OneUptime API 的 **API** 方块来做这件事。

`PUT /api/workflow-variable/<variable-id>`，带上一个 `ApiKey` 头，还有——这一步最容易把人绊住——你想改的那些字段必须 **包在一个 `data` 对象里**：

```json
{
  "data": {
    "content": "{{local.components.get-token.returnValues.response-body.access_token}}"
  }
}
```

没有 `data` 包装的扁平正文会被 400 拒掉。只发你真正想改的字段；`name` 和 `description` 可以不放进载荷。

这个 API key 需要 **Edit Workflow Variables** 权限。不需要读权限——这次更新不会把那一行读回来。

有两点要留神：

- **别给你正在引用的变量改名。** `name` 是 `{{local.variables.NAME}}` 的一部分。改了它，所有已有的引用都解析不出来，而解析不出来的引用会被当成字面文本原样传下去——见下面的坑。
- **变量能这样写进去，却永远读不回来。** 不管是不是密钥，对每一个变量来说，`content` 通过 API 都是只写的。正因如此，变量是存放轮换令牌的安全地方。再把它标为密钥，还能额外保证这个值不出现在运行日志和步骤追踪里。

## 那些坑

- **用选择器。** 它们插进去的是执行器真正认的组件 id、返回值 id 和变量 id，而且让引用不受显示名称影响。
- **变量名区分大小写。** `{{global.variables.MyKey}}` 和 `{{global.variables.mykey}}` 是两回事。
- **解析不出来的引用会原样留着，而不是被清空。** 引用一个不存在的东西不算错误，也不会给你一个空字符串：那对花括号会被直接透传，于是一个步骤 id 打错的 `{{local.components.api-get-1.returnValues.body}}` 会一字不差地出现在你的 Slack 消息、URL 或者请求正文里，而这次运行照样报 **Executed**。运行日志里有一行警告，会点名任何溜过去的引用。
- **生成器查不了变量名。** 它能在你保存之前标出对不上的组件引用——不存在的步骤 id、不存在的返回值、写坏了的根路径。但它没法判断一个变量存不存在，所以改过名的变量只有运行日志能抓到。
- **花括号里的空格不会被去掉。** `{{ local.variables.NAME }}` 和 `{{local.variables.NAME}}` 是两次不同的查找，前者永远解析不出来。唯一的例外是在 `{{#each}}` 块里面，那里的名字会被去掉空格。

## 接下来读什么

- [工作流组件](/docs/workflows/components) —— 每个方块产出的输出的完整清单。
- [工作流运行与日志](/docs/workflows/runs-and-logs) —— 看一次运行之后每个变量的实际值。
- [工作流配置与安全](/docs/workflows/configuration) —— 什么东西适合放进全局变量。
