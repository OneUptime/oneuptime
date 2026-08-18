# 变量

工作流的核心是数据流动——从触发器到第一个模块、从一个模块到下一个模块、从共享的值流向你需要用到它的任何地方。变量就是数据流动的方式。

有两种变量作用域,再加上运行过程中模块产生的输出。

## 全局变量

项目级的值,保存一次就可以在任何地方复用。比如 API 密钥、URL、频道名——任何你不想复制到十个不同工作流里的东西。

在 **Workflows → Global Variables** 下查看它们。每个变量有:

- **Name**——你引用它时用的名字。至少两个字符,不能有空格,只能包含字母、数字、连字符和下划线。用 `UPPER_SNAKE_CASE` 是个好习惯,因为它在模块里更显眼。
- **Description**——可选,用来提醒自己这个变量是做什么的自由文本。
- **Secret**——开启后,该值会从运行日志和步骤追踪中被抹去。
- **Content**——实际的值。这是一个长文本字段,支持多行值。

在任意工作流中用以下语法引用一个全局变量:

```
{{global.variables.NAME}}
```

举例来说,如果你把 PagerDuty 密钥保存为 `PAGERDUTY_KEY`,任意模块都可以用 `{{global.variables.PAGERDUTY_KEY}}` 来引用它——编辑器存的是这个引用本身,而工作流日志会把解析出来的密钥值抹掉。

变量只能创建和删除,不能编辑。表格上没有编辑按钮,所以要在界面上修改一个值,得先删除这个变量再重新创建——或者通过 API 更新它,本页末尾会讲到。全局变量和工作流变量是 Growth 套餐的功能。

## 局部工作流变量

作用域限定在单个工作流内的变量,在该工作流左侧菜单的 **Workflow Variables** 下管理。用以下方式引用它们:

```
{{local.variables.NAME}}
```

## 模块输出(来自前面模块的数据)

每个触发器和每个组件在一次执行中都可能产生输出。用编辑器里的 component-value 选择器来生成引用,而不是手动输入——它会插入执行器所期望的确切 id。

像这样引用前一个模块的输出:

```
{{local.components.COMPONENT_ID.returnValues.FIELD_ID}}
```

`COMPONENT_ID` 是模块的 **Identifier**——显示在模块上的那个短 id,而不是它显示出来的名称。新建的模块会得到类似 `api-get-1` 这样的 id,你可以在模块的 **ID** 区块里重命名它。重命名它会破坏所有已经指向它的引用,和重命名变量的道理一样。`FIELD_ID` 是你选中的返回值 id。

示例:

- 一个 ID 为 `lookup-user` 的 **API** 组件运行后,它的状态码是 `{{local.components.lookup-user.returnValues.response-status}}`,响应体是 `{{local.components.lookup-user.returnValues.response-body}}`。
- 一个 ID 为 `transform` 的 **Run Custom JavaScript** 组件,它返回的值是 `{{local.components.transform.returnValues.returnValue}}`。
- 针对某种记录类型的触发器——**On Create Incident** 及同类触发器——只返回一个值,即 `model`,你需要在其中逐层深入。对于一个 ID 为 `incident-on-create-1` 的触发器,该事件的标题是 `{{local.components.incident-on-create-1.returnValues.model.title}}`。

局部变量只在当前这次运行期间存在。每次新的运行都是从头开始。

## 变量在哪里可用

几乎每个文本字段都接受变量:

- API 模块上的 URL。
- Slack、Teams、Discord、Telegram、Email 上的消息文本。
- 邮件的主题和正文。
- 头部字段和正文字段(在字符串值内部)。
- **If / Else** 模块的两侧(列在 Conditions 分类下)。

在 JSON 字段里,你可以在字符串值内部使用变量,但不能把变量用作键。如果一个引用单独占据整个值,它会被原样替换进去,所以你可以用这种方式把一整个对象塞进一个 JSON 字段。如果你需要动态构建一个结构,用 **Run Custom JavaScript** 模块来构建它,然后把它的输出传给下一个模块。

**Run Custom JavaScript** 模块不会自动拿到变量——沙箱里不会自动注入任何东西。把 `{{global.variables.NAME}}`(或任意组件引用)放进该模块的 **Arguments** JSON 字段;这些值会在脚本运行之前被替换,并以 `args` 的形式传入。

## 遍历数组

在文本字段内部,你可以用 `{{#each path}}…{{/each}}` 遍历一个数组。在这个块内部,`{{property}}` 读取当前元素上的字段,`{{@index}}` 是从 0 开始的位置,`{{this}}` 则代表元素本身,用于纯值数组。`{{#each}}` 块内部的名字会被去除首尾空格,所以这里多余的空格是无害的——这一点和其他地方不同。

## 示例

### 从 webhook 构建一个负载

一个 webhook 到达,请求体类似 `{ "service": "checkout", "status": "failed" }`。要把它转换成一个 OneUptime 事件:

1. id 为 `ci-webhook` 的 **Webhook** 触发器。
2. **If / Else** 模块:选中该 webhook 的 Request Body 输出,使用它的 `status` 字段,运算符 `==`,右侧值 `failed`。
3. 从 **Yes** 分支接一个 **Create One Incident** 模块,设置:
   - Title:`CI build failed: {{local.components.ci-webhook.returnValues.request-body.service}}`
   - Description:`See {{local.components.ci-webhook.returnValues.request-body.url}} for the logs.`

### 在 API 调用中使用密钥

一个调用 PagerDuty 的工作流:

1. 把 `PAGERDUTY_KEY` 保存为一个 secret 类型的全局变量。
2. 在 **API** 模块上,把 `Authorization` 头设为 `Token token={{global.variables.PAGERDUTY_KEY}}`。

这个密钥不会出现在工作流本身和日志里。

### 串联两次 API 调用

第一次调用给出的 ID,是第二次调用需要用到的:

1. **API** 组件 `lookup-order`:用选择器把 manual 触发器的 JSON email 字段插入到 `GET /orders?email=...` 中。
2. **API** 组件 `cancel-order`:`POST /orders/{{local.components.lookup-order.returnValues.response-body.id}}/cancel`。

如果 `lookup-order` 失败,触发的是它的 **Error** 输出而不是 **Success**。把它连接到一个 Email 或 Slack 模块,这样失败就不会被忽略。

## 从工作流中更新一个变量

一个常见的模式是按计划轮换凭证:从第三方获取一个新令牌,然后把它存回变量,这样下一次运行就能用上它。用一个调用 OneUptime API 的 **API** 模块来做这件事。

`PUT /api/workflow-variable/<variable-id>`,带上 `ApiKey` 头,而且——这是最容易让人栽跟头的地方——你想修改的字段要 **包在一个 `data` 对象里**:

```json
{
  "data": {
    "content": "{{local.components.get-token.returnValues.response-body.access_token}}"
  }
}
```

不带 `data` 包装的扁平请求体会被以 400 拒绝。只发送你确实想修改的字段;`name` 和 `description` 可以不出现在负载里。

这个 API key 需要 **Edit Workflow Variables** 权限。不需要读权限——这次更新不会把这一行读回来。

有两点需要注意:

- **不要重命名一个你还在引用的变量。** `name` 是 `{{local.variables.NAME}}` 的一部分。改名会让所有现有引用都变得无法解析,而一个无法解析的引用会被原样当作文本传递下去——见下面的坑。
- **一个变量可以用这种方式写入,但永远读不回来。** 对每一个变量来说,不管是不是 secret,`content` 在 API 上都是只写的。这正是变量能安全用来存放一个轮换令牌的原因。把它标记为 secret,还能额外让这个值不出现在运行日志和步骤追踪里。

## 坑

- **使用选择器。** 它们会插入执行器所期望的确切 component id、返回值 id 和变量 id,让引用不依赖于显示出来的标签。
- **变量名区分大小写。** `{{global.variables.MyKey}}` 和 `{{global.variables.mykey}}` 是不同的。
- **无法解析的引用会被原样保留,而不是留空。** 引用一个不存在的东西不是一个错误,也不会给你一个空字符串:大括号会被原样传递下去,所以拼错了步骤 id 的 `{{local.components.api-get-1.returnValues.body}}`,会原封不动地出现在你的 Slack 消息、URL 或请求体里,而运行仍然会报告 **Executed**。运行日志里会有一行警告,点出任何这样漏掉的引用。
- **Builder 无法校验变量名。** 它会在你保存之前,标记出它无法匹配的组件引用——未知的步骤 id、未知的返回值、格式错误的根字段。但它无法判断一个变量是否存在,所以一个被重命名的变量,只能靠运行日志才能发现。
- **大括号内部的空格不会被去除。** `{{ local.variables.NAME }}` 和 `{{local.variables.NAME}}` 是不同的查找,前者永远不会被解析。唯一的例外是在 `{{#each}}` 块内部,那里的名字会被去除首尾空格。

## 接下来读什么

- [Workflow Components](/docs/workflows/components)——每个模块能产生的完整输出列表。
- [Workflow Runs & Logs](/docs/workflows/runs-and-logs)——在一次运行后查看每个变量的实际值。
- [Workflow Configuration & Safety](/docs/workflows/configuration)——什么样的内容适合放进一个全局变量。
