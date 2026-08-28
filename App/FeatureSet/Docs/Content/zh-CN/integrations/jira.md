# Jira 集成

每当 OneUptime 里宣布一个事件，就开一张 [Jira](https://www.atlassian.com/software/jira) 工单，随着事件推进让工单保持同步，还能让 Jira 把状态变化推回 OneUptime——这一切都用一个[工作流](/docs/workflows/index)完成。没有什么 Jira 专属的方块要装：OneUptime 用 [API 组件](/docs/workflows/components#api)去调 Jira 的 REST API，Jira 则回调到一个 [Webhook 触发器](/docs/workflows/triggers#webhook)。

```text
OneUptime Incident → On Create  ──►  API Post (POST /rest/api/3/issue)  ──►  Jira issue

Jira issue transitioned  ──►  Automation rule (Send web request)  ──►  OneUptime Webhook trigger  ──►  Update One Incident
```

这一页把两个方向都搭出来。入站那一节之前的所有内容都是针对 **Jira Cloud** 写的；接近末尾有一节列出在 **Jira Data Center** 上有哪些不同。

> Atlassian 一直在给 Jira Cloud 里的东西改名：**project**（项目）在界面的大部分地方现在叫 **space**（空间），**issue**（工单）则成了 **work item**（工作项）。两套说法在不同租户上都还在用，所以下面凡是措辞要紧的地方，两种叫法都会给出。

## 前提条件

- 一个 Jira Cloud 站点（`https://your-domain.atlassian.net`），以及一个用来提交工单的项目。记下它的**项目密钥**——也就是 `OPS-1234` 里的那个 `OPS`。
- 一个能在该项目里创建工单的 Jira 账户，以及从 [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens) 为它取得的 **API 令牌**。用服务账户，别用某个人的账户——这样创建出来的工单会算在令牌所有者头上。
- 在该项目里创建自动化规则的权限，这是入站那一半需要的。
- 一个你能创建工作流和全局变量的 OneUptime 项目。

## 步骤 1——把 Jira 凭据存成机密

Jira Cloud 的 REST API 用的是 **Basic 认证**，由你的 Atlassian 账户邮箱和一个 API 令牌拼起来再做 base64 编码得到。

1. 把 `email:api_token` 编码一次：

   ```bash
   printf '%s' 'you@example.com:your_api_token' | base64
   ```

   用 `printf`，别用 `echo`。`echo` 会补一个换行符，这个换行符会跟其他内容一起被编码进去，然后 Jira 回你一个 `401`——而你粘贴的那串字符里根本看不出原因。

2. 在 OneUptime 里，去 **工作流 → 全局变量 → 创建**。把它命名为 `JIRA_AUTH`，把 base64 字符串粘到 **内容** 里，并把 **密钥** 打开。
3. 再加一个非机密的变量 `JIRA_URL`，值为 `https://your-domain.atlassian.net`，结尾不要带斜杠。

现在任何方块都能用 `Basic {{global.variables.JIRA_AUTH}}` 作为它的 `Authorization` 头部，而令牌不会出现在工作流里，也不会出现在它的运行日志里。见[变量](/docs/workflows/variables)。

关于 Atlassian API 令牌有两件事，早晚会咬到一个没人盯着的集成：

- **它们会过期。** 令牌创建时的有效期在一天到一年之间，默认一年，而且没有刷新机制——过期的令牌只能在同一个页面上手动换一个新的，再重新编码进 `JIRA_AUTH`。把到期日记到日历里。一个跑了好几个月的工作流突然开始回 `401`，原因就在这里。
- **带作用域的令牌要用另一个基础 URL。** 令牌页面除了经典的 **Create API token** 之外，还提供 **Create API token with scopes**。带作用域的令牌更安全，但它们不是发给你的站点的：它们发往 `https://api.atlassian.com/ex/jira/<cloudId>`，所以 `JIRA_URL` 要改成那个地址，下面所有的路径原封不动地挂在它后面。你的 `cloudId` 在 `https://your-domain.atlassian.net/_edge/tenant_info` 返回的 JSON 里。带作用域的令牌发给 `your-domain.atlassian.net` 只会失败。

如果你的组织用的是 Atlassian 的集中式用户管理，还有第三个选项可以绕开过期问题：[为服务账户创建 OAuth 2.0 凭据](https://support.atlassian.com/user-management/docs/create-oauth-2-0-credential-for-service-accounts/)。它给你的是一个 client id 和一个 secret，而不是令牌，工作流在每次运行开始时拿它们换一个短期的访问令牌——和 [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365) 那一页用的是同样的两方块结构：一个 **API Post (JSON)** 方块去取令牌，它后面的所有方块都发 `Bearer <token>`。一年之后不需要手动换任何东西。Atlassian 的页面上有确切的令牌请求格式；API 的基础 URL 是 `https://api.atlassian.com`。

## 步骤 2——为每个事件开一张 Jira 工单

1. 打开 **工作流 → 创建工作流**，命名为 `Incidents → Jira`，然后打开 **生成器**。
2. 点那个虚线占位方块，添加 **On Create Incident** 触发器。在它的 **Select Fields** 里，把你想发送的列要出来：

   ```json
   {
     "_id": true,
     "title": true,
     "description": true,
     "incidentNumber": true,
     "incidentSeverity": { "name": true }
   }
   ```

   它的 **Identifier** 保持 `incident-on-create-1` 不变——后面的方块就是靠这个名字引用它的。

3. 点 **添加组件**，加一个 **API Post (JSON)** 方块，然后从触发器的 **成功** 圆点拖到新方块的输入圆点上。打开它，把 **Identifier** 设成 `create-issue`，然后填写：

   - **URL**：`{{global.variables.JIRA_URL}}/rest/api/3/issue`
   - **Request Headers**：

     ```json
     {
       "Authorization": "Basic {{global.variables.JIRA_AUTH}}",
       "Accept": "application/json"
     }
     ```

   - **Request Body**：

     ```json
     {
       "fields": {
         "project": { "key": "OPS" },
         "issuetype": { "name": "Bug" },
         "summary": "OneUptime #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}: {{local.components.incident-on-create-1.returnValues.model.title}}",
         "labels": ["oneuptime"],
         "description": {
           "type": "doc",
           "version": 1,
           "content": [
             {
               "type": "paragraph",
               "content": [
                 {
                   "type": "text",
                   "text": "{{local.components.incident-on-create-1.returnValues.model.description}}"
                 }
               ]
             }
           ]
         }
       }
     }
     ```

   把 `OPS` 换成你的项目密钥，把 `Bug` 换成该项目里确实存在的一种工单类型。这两个也都可以用 id 来给——`{"id": "10000"}`——Atlassian 自己的示例用的就是这种写法；如果你站点里有两种工单类型重名，更应该优先用 id。下面那些 `createmeta` 调用会把这些 id 给你。

description 看起来这么笨重，是因为 Jira Cloud 的 v3 API 把富文本当作 **Atlassian Document Format** 来接收——那是一棵文档树，不是一个字符串。上面这个形状已经是最小的合法文档了：一个段落，里面装一个文本节点。`environment` 以及任何多行文本自定义字段都是同样的规矩；单行文本自定义字段仍然接受纯字符串。

现在从 **概览 → 编辑工作流 → 已启用** 把工作流打开，宣布一个测试事件，然后打开 **运行和日志**。`create-issue` 方块应该显示 `201`，正文里带着新工单的 `id`、`key` 和 `self`。画布上的改动会自动保存——没有保存按钮，而且被禁用的工作流根本跑不了，手动也不行。

新工单的 key 对这个方块之后的任何方块都是可用的：

```text
{{local.components.create-issue.returnValues.response-body.key}}
```

### 填更多字段

`fields` 里几个常见的补充项：

- **优先级**——`"priority": { "id": "20000" }`，用你站点里的某个优先级 id。要把 OneUptime 的严重级别映射到 Jira 优先级，就在触发器和 API 方块之间放一个 **If / Else** 方块，按 `{{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}` 分支。
- **经办人**——`"assignee": { "id": "<accountId>" }`。Jira Cloud 用 Atlassian 账户 id 来标识人；`username` 和 `userKey` 好几年前就从 Cloud API 里移除了。
- **标签**——`"labels": ["oneuptime", "sev1"]`，一个扁平的字符串数组。标签里不能有空格。
- **模块**——`"components": [{ "id": "10000" }]`。
- **自定义字段**——`"customfield_10034": "..."`，用字段自己的 id。值的形状取决于字段的类型：单选接受 `{"value": "red"}`，多选接受一个 id 数组，多行文本字段接受一个 Atlassian Document Format 文档。

想知道某个项目到底要求什么，去问 Jira，别猜。先列出项目里的工单类型，再列出其中一种类型的字段：

```bash
curl -u 'you@example.com:your_api_token' \
  'https://your-domain.atlassian.net/rest/api/3/issue/createmeta/OPS/issuetypes'

curl -u 'you@example.com:your_api_token' \
  'https://your-domain.atlassian.net/rest/api/3/issue/createmeta/OPS/issuetypes/10001'
```

第二个调用会列出这种工单类型接受的每一个字段、其中哪些是必填的，以及确切的 `customfield_NNNNN` id。如果你想从一张已有的工单上把这些 id 读出来，用 `?expand=names` 去取它。

## 步骤 3——把事件 id 带进 Jira

双向同步的两半都需要有一个系统保存另一个系统的标识符，而 Jira 是更适合放它的地方：OneUptime 的 `customFields` 列是一整块 JSON，所以从工作流里写一个值，会把那个事件上的每一个自定义字段都替换掉。

**有 Jira 管理员帮忙的话。** 往项目的创建界面上加一个短文本自定义字段——就叫 *OneUptime Incident ID*——用 `createmeta` 找到它的 id，然后跟其他字段一起设置：

```json
"customfield_10050": "{{local.components.incident-on-create-1.returnValues.model._id}}"
```

**没有管理员帮忙的话。** 那就把它放进一个标签里。标签里不能有空格，而 OneUptime 的 id 就是一个普通的 UUID，所以 `oneuptime-<id>` 是一个合法的标签：

```json
"labels": ["oneuptime", "oneuptime-{{local.components.incident-on-create-1.returnValues.model._id}}"]
```

那么入站的工作流就得从标签列表里把它挑出来，这在一个 **Run Custom JavaScript** 方块里也就是两行代码。要是能用自定义字段，那还是更清爽。

既然说到这儿，顺手在 Jira 工单上加一个指回事件的链接也是值得的。在 `create-issue` 之后加一个 **API Post (JSON)** 方块，指向 `{{global.variables.JIRA_URL}}/rest/api/3/issue/{{local.components.create-issue.returnValues.response-body.key}}/remotelink`，正文为：

```json
{
  "globalId": "system=https://oneuptime.com&id={{local.components.incident-on-create-1.returnValues.model._id}}",
  "object": {
    "url": "https://oneuptime.com/dashboard/{{local.components.incident-on-create-1.returnValues.model.projectId}}/incidents/{{local.components.incident-on-create-1.returnValues.model._id}}",
    "title": "OneUptime incident #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}"
  }
}
```

这样 Jira 里的每个人都有了一条一键返回的路。为此要把 `projectId` 也加到触发器的 **Select Fields** 里。`globalId` 正是这个调用可以安全重复的原因：Jira 会更新已经带着这个 id 的那条链接，而不是再加一条。因为更新还会把你没带上的字段清空，所以永远要发完整的 `object`，别发它的一部分。

## 步骤 4——随着事件推进留言和流转

把这一段搭成**第二个**工作流，这样这里出问题也绝不会挡住工单的创建。

1. **创建工作流**，命名为 `Incident updates → Jira`，加上 **On Update Incident** 触发器。
2. 在 **Listen on** 里填 `{"currentIncidentStateId": true}`。这样触发器只在状态变化时开火，而不是每次编辑都开火。在 **Select Fields** 里，要 `{"_id": true, "currentIncidentState": {"name": true}}`。
3. 加一个 **If / Else** 方块：**Input 1** 填 `{{local.components.incident-on-update-1.returnValues.model.currentIncidentState.name}}`，**Operator** 选 `==`，**Input 2** 填 `Resolved`——或者你项目里表示已解决的那个状态的名字。见[事件状态与严重级别](/docs/incidents/states-and-severities)。

从 **是** 分支出发，你首先得找到步骤 2 里开的那张工单。用一个 **Identifier** 为 `find-issue` 的 **API Post (JSON)** 方块，按你在步骤 3 里存的 id 去问 Jira：

- **URL**：`{{global.variables.JIRA_URL}}/rest/api/3/search/jql`
- **Request Body**：

  ```json
  {
    "jql": "project = OPS AND labels = \"oneuptime-{{local.components.incident-on-update-1.returnValues.model._id}}\"",
    "maxResults": 1
  }
  ```

  如果你用的是自定义字段而不是标签，这个子句就变成 `cf[10050] ~ \"...\"`，里面填你自己的字段 id。

工单 id 于是就是 `{{local.components.find-issue.returnValues.response-body.issues[0].id}}`，而下面每一个端点接受 id 和接受 key 一样痛快。

关于这个端点有三件事值得知道。**把 JQL 放进正文里发出去，别放在 URL 里**——查询字符串里的值一旦含有 `=`，从工作流发出去的路上就会被截断，而 JQL 里全都是 `=` 号。**查询必须是有界的**：光写一个 `order by key desc` 会被 `400` 拒绝，这正是那个 `project =` 子句存在的原因。还有，`/rest/api/3/search/jql` 是当前的端点——更老的 `/rest/api/3/search` 已经废弃并正在退场，别去用它。

**留一条评论** 就是一个 **API Post (JSON)** 方块，打到 `{{global.variables.JIRA_URL}}/rest/api/3/issue/<id>/comment`，正文和 description 一样是 Atlassian Document Format：

```json
{
  "body": {
    "type": "doc",
    "version": 1,
    "content": [
      {
        "type": "paragraph",
        "content": [{ "type": "text", "text": "Resolved in OneUptime." }]
      }
    ]
  }
}
```

**流转这张工单** 需要两个调用，因为一次流转是用一个 id 来标识的，而这个 id 在不同的 Jira 工作流之间不一样，在某些看板上甚至在不同工单之间也不一样。

1. 一个打到 `{{global.variables.JIRA_URL}}/rest/api/3/issue/<id>/transitions` 的 **API Get (JSON)** 方块，会返回*从这张工单当前状态出发*可用的那些流转，每一条都带一个 `id` 和一个 `name`，还有一个 `to` 对象说明它通向哪个状态。
2. 一个打到同一个 URL 的 **API Post (JSON)** 方块执行其中一条：

   ```json
   { "transition": { "id": "31" } }
   ```

流转成功会返回 `204`，没有正文。如果你不想在运行时去读这个列表，就对一张处在正确状态的工单手动调一次，把 id 硬编码进去——只是别忘了它跟那个 Jira 工作流是绑定的，管理员一改 Jira 工作流，它就会悄无声息地失效。

## 入站——从 Jira 到 OneUptime

现在换个方向：有人把工单挪到了 Done，OneUptime 的事件应该跟着走。

### 先搭接收端的工作流

1. **创建工作流**，命名为 `Jira → OneUptime`，加上 **Webhook** 触发器。
2. 打开这个工作流的 **设置**，复制 **Webhook Secret Key**。你的 URL 是：

   ```text
   https://oneuptime.com/workflow/trigger/<webhook secret key>
   ```

   自托管的安装用它们自己的主机名。把这个 URL 当密码看待——拿到它的人都能启动这个工作流——万一泄露了，就在同一个页面上重置密钥。

3. 加一个 **If / Else** 方块，在其他任何事情跑起来之前先校验一个共享密钥。**Input 1** 是 `{{local.components.webhook-1.returnValues.request-headers.x-oneuptime-secret}}`，**Operator** 是 `==`，**Input 2** 是 `{{global.variables.JIRA_WEBHOOK_SECRET}}`——一个你自己编出来、存成机密全局变量的值。
4. 从 **是** 分支出发，加一个 **Update One Incident** 方块：

   - **Query**：`{"_id": "{{local.components.webhook-1.returnValues.request-body.oneuptimeIncidentId}}"}`
   - **Data (JSON Object)**：这次 Jira 的变化在这边应该意味着什么——通常是一次状态变更。

   挪动一个事件需要目标状态的 id，用一个查询为 `{"name": "Resolved"}` 的 **Find One Incident State** 方块就能拿到，它是 `{{local.components.incident-state-find-one-1.returnValues.model._id}}`。把它写进 `currentIncidentStateId`。

让这个工作流保持启用。现在去给 Jira 一个可以调用的东西。

### 从 Jira 自动化规则把事件发出来

1. 在 Jira 里打开该项目的自动化规则：新一点的租户是 **Space settings → Automation**，老一点的是 **Project settings → Automation**。要做一条跨多个项目的规则，用 **Settings → System → Global automation**，这需要 *Administer Jira* 全局权限。
2. **Create rule**，选 **Work item transitioned** 触发器——老租户上叫 **Issue transitioned**。把它设成状态流转*到* **Done** 时运行。

   用这个触发器，别用 *Work item updated*：更新触发器是特意把状态变化排除在外的。

3. 加上 **Send web request**（发送 Web 请求）动作并配置它：

   - **Web request URL**：上面那个 OneUptime webhook URL。
   - **HTTP method**：`POST`
   - **Headers**：`Content-Type` / `application/json`，以及 `X-OneUptime-Secret` / 你的共享密钥。对密钥的值用 **Hide** 选项，这样其他编辑规则的人读不到它——注意，隐藏对那个值来说是不可逆的，而且规则一旦被导出或复制，隐藏起来的值就会丢失。
   - **Web request body**：选 **Custom format**，这样形状由你说了算：

     ```json
     {
       "oneuptimeIncidentId": "{{issue.customfield_10050}}",
       "issueKey": "{{issue.key}}",
       "summary": "{{issue.summary}}",
       "status": "{{issue.status.name}}"
     }
     ```

     如果你在步骤 3 里用的是标签而不是自定义字段，就发 `"labels": "{{issue.labels}}"`，然后在 OneUptime 这边用一个 **Run Custom JavaScript** 方块把 id 抠出来。

4. 把规则打开，把一张测试工单挪到 Done，然后两边都检查一下：Jira 里这条规则自己的审计日志，以及 OneUptime 里的 **运行和日志**。

在你真的依赖它之前，有几件事值得知道：

- **目标端口是受限的。** Send web request 只能访问 80、8080、443、6017、8443、8444、7990、8090、8085、8060、8900 和 9900 端口。OneUptime Cloud 在 443 上；一个跑在非常规端口上的自托管安装没法用这种方式被调用。
- **没有请求签名。** 这个动作没有 HMAC 选项，所以在 HTTPS 上用一个头部里的共享密钥就是 Atlassian 文档给出的机制。接收端工作流步骤 3 里的那个 **If / Else** 校验，正是让这个机制变得有价值的东西。
- **规则运行是计量的。** Jira Cloud 会把成功执行的规则次数计入一个按套餐而定的月度额度——Free 是 100 次，Standard 是 1,700 次，Premium 是 1,000 × 用户数，Enterprise 无限制。在一个繁忙的项目里，一条每次流转都开火的规则会积少成多。
- **值不会替你做 URL 编码。** 这只在你发送表单编码的正文时才有影响；上面那个 JSON 没问题。
- **Atlassian 会公布它的出网地址段**，在 [ip-ranges.atlassian.com](https://ip-ranges.atlassian.com)，如果你的 OneUptime 安装在一个白名单后面的话可以用。这些地址会变，所以去轮询这个源，别把地址钉死。

### 或者改用 Jira webhook

Jira 管理员可以直接在 **Settings → System → Advanced → WebHooks** 下注册一个 webhook，选择要发送哪些事件，还可以额外用一条 JQL 查询来收窄哪些工单会触发它。和自动化规则相比：

- 载荷是 Jira 自己的，不是你的：`webhookEvent`、`issue_event_type_name`、完整的 `issue`，以及一个 `changelog`，它的 `items` 数组里装着每个变化字段的前后值。状态变化你要看的是 `field` 为 `status` 的那一项。要在工作流里读它，通常意味着得加一个 **Run Custom JavaScript** 方块。
- webhook **可以**签名——给 webhook 一个密钥，Jira 就会发一个 `X-Hub-Signature` 头部，里面是请求正文的 HMAC——但工作流没法校验它。签名覆盖的是 Jira 发出的确切字节，而 Webhook 触发器交给工作流的正文已经被解析成 JSON 了，所以没有东西可以再拿去做哈希。如果你要请求经过认证，请改用带共享密钥头部的自动化规则。
- URL 必须是 HTTPS，端口要在 Jira 自己那份清单里，而这份清单和自动化动作用的那份*不一样*——这里不允许 80 端口。
- 投递最多重试五次，退避时间为五到十五分钟，所以你的工作流必须容忍同一个事件到达两次。

由某个应用通过 `/rest/api/3/webhook` 注册的 webhook 又是另一回事：它们在注册 30 天之后过期，除非被刷新。上面那种管理员注册的不会过期。

## Jira Data Center

自管的 Jira 用法完全一样，只需要替换少数几处。**Jira Server** 已于 2024 年 2 月结束支持、不再收到任何修复，所以自管这边请以 Data Center 为目标。

| Cloud                                             | Data Center                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| `/rest/api/3/...`                                 | `/rest/api/2/...`——Data Center 上没有 v3                                     |
| `description` 是一个 Atlassian Document Format 文档 | `description` 是一个 wiki 标记的纯字符串                                     |
| `Authorization: Basic base64(email:api_token)`    | `Authorization: Bearer <personal access token>`                              |
| 来自 id.atlassian.com 的 API 令牌                  | 在你自己的 Jira 账户上 **Profile → Personal access tokens → Create token**    |
| 自动化动作 **Send web request**                    | 自动化动作 **Send outgoing web request**                                     |

于是创建工单的那个方块变成一个打到 `/rest/api/2/issue` 的 `POST`，正文为：

```json
{
  "fields": {
    "project": { "key": "OPS" },
    "issuetype": { "name": "Bug" },
    "summary": "OneUptime #123: Checkout is down",
    "description": "Plain text goes straight in here."
  }
}
```

这个模板要简单得多——没有文档树。

其他需要预先考虑的差异：

- **个人访问令牌** 从 Jira Core 和 Jira Software 8.14、以及 Jira Service Management 4.15 起提供。它们会过期——默认 365 天——界面会在到期前五天把它标为 *Expires soon*。在 Data Center 上用用户名和密码做 Basic 认证仍然可行，但几次登录失败就会触发 CAPTCHA，把这个账户彻底锁在 REST API 之外，直到有人在浏览器里手动解开——用这种方式发现自己打错了一个字，代价太大了。还是用令牌吧。
- **自动化从 Jira Data Center 10.0 起是内置的。** 在那之前它是单独安装的 Automation for Jira 应用。它的出站请求默认超时是 3000 毫秒，可以用 `outgoing.webhook.timeout.ms` 属性调整。
- **Webhook** 在 **Administration → System → Advanced → WebHooks** 注册，并且支持 JQL 收窄。把这些过滤条件写窄一点：Jira 会在引发事件的那个线程上评估每一个已注册 webhook 的 JQL，所以十几条松散的过滤条件会把触发它们的那个用户操作拖慢。
- **从 Data Center 10.0 起 webhook 投递是异步的**，而且没有同步选项，所以事件可能乱序到达。让接收端的工作流具备幂等性。
- **Jira 10 去掉了 webhook URL 变量里的 `$`**——`${issue.id}` 变成了 `{issue.id}`——并且把 webhook 的 REST 资源从 `/rest/webhooks/1.0/webhook` 移到了 `/rest/jira-webhook/1.0/webhooks`。

## 对告警做同样的事

上面所有内容都是围绕事件写的，因为那是常见情况，不过告警的做法完全一样——把记录类型换掉，别的什么都不用改：

| 事件                                     | 告警                                        |
| ---------------------------------------- | ------------------------------------------- |
| **On Create Incident**（`incident-on-create-1`） | **On Create Alert**（`alert-on-create-1`）   |
| **On Update Incident**（`incident-on-update-1`） | **On Update Alert**（`alert-on-update-1`）   |
| `incidentNumber`、`currentIncidentState`、`incidentSeverity` | `alertNumber`、`currentAlertState`、`alertSeverity` |
| **Find One Incident State**              | **Find One Alert State**                    |
| **Update One Incident**                  | **Update One Alert**                        |

一个工作流恰好只有一个触发器，所以事件和告警各需要一个工作流。如果两者要做的活儿是一样的，就把 Jira 那一半搭一次，然后用 **Execute Workflow** 组件从两边分别调用它。

## 故障排查

先在 **运行和日志** 里打开出错的那个方块。Jira 会返回一个 JSON 正文，明确说明它拒绝了什么，而 API 组件会把它保存在 `response-body` 里。

**`401 Unauthorized`。** 用 `printf` 重新编码 `email:api_token` 并更新 `JIRA_AUTH`；`echo` 带来的结尾换行符是最常见的原因。然后确认拥有该令牌的账户能在那个项目里创建工单。在 Data Center 上，检查你发的是 `Bearer` 而不是 `Basic`。

**`400 Bad Request` 并点名了某个字段。** 要么这个工单类型在项目里不存在，要么项目有一个必填字段而你没有发。对着那个项目和工单类型跑一下上面的 `createmeta` 调用，然后逐项比对。

**`400` 抱怨 `description`。** 在 Cloud v3 上，description 必须是一个 Atlassian Document Format 文档，不能是字符串。要么发上面展示的那个文档，要么把那个方块改成打到 `/rest/api/2/issue` 并发纯文本。

**`404 Not Found`。** 检查基础 URL 和 API 版本——Cloud 上是 `/rest/api/3/...`，Data Center 上是 `/rest/api/2/...`。

**`429 Too Many Requests`。** Jira 在限流。响应里带着以秒为单位的 `Retry-After`，还有一个 `RateLimit-Reason` 说明你撞上了哪条限制。针对单张工单的写操作被卡得很紧——大约是两秒内二十次——所以一个连着留言又流转的工作流，光在一张工单上就可能踩线。在这些调用之间放一个 **Delay** 方块，或者把批量的活儿挪到计划工作流里去做。

**流转调用返回 `400`。** 这个流转 id 从工单的*当前*状态出发是不合法的。为那张工单取一次 `/transitions`，用响应里的某个 id。

**自动化规则显示成功，但什么都没到 OneUptime。** 先检查端口——见上面那份受限清单。然后自己用 `curl` 往那个 webhook URL 发一个请求，看它会不会出现在 **运行和日志** 里；如果你的请求到了而 Jira 的没到，问题就在 Jira 那边。

**工作流跑了，但事件没有变化。** 当 **Update One Incident** 方块的查询什么都没匹配到时，它会报 `Items Updated: 0`，而这算成功，不算错误。检查载荷里的那个 id 确实是 OneUptime 的事件 id，并且你查的是 `_id`。

**一个 `{{...}}` 引用原样出现在 Jira 工单里。** 没能解析的引用会被当作文本原样传过去，而不是被清空。运行日志会点名任何没解析成功的引用——通常是方块 identifier 打错了，或者变量被改了名。

## 接下来读什么

- [集成](/docs/integrations/index)——入站和出站模式，以及认证速查表。
- [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365)——针对 Dynamics 的同样的双向搭法。
- [工作流概览](/docs/workflows/index) 和 [创建工作流](/docs/workflows/authoring)——画布、identifier，以及怎么把工作流打开。
- [组件](/docs/workflows/components)——API 方块、If / Else，以及 OneUptime 数据组件。
- [变量](/docs/workflows/variables)——机密，以及从下一个方块读取上一个方块的输出。
- [配置与安全](/docs/workflows/configuration)——webhook 安全和出网访问。
- [ServiceNow](/docs/integrations/servicenow) 和 [PagerDuty](/docs/integrations/pagerduty)——其他工具的同样的出站模式。
