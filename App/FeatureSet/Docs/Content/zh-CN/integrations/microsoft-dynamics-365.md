# Microsoft Dynamics 365 集成

每当 OneUptime 里宣布一个事件，就在 [Microsoft Dynamics 365](https://www.microsoft.com/dynamics-365) 里开一个 **Case**（案例），随着事件推进让这个案例保持同步，还能让 Dynamics 把案例的变化推回 OneUptime——这一切都用一个[工作流](/docs/workflows/index)完成。没有什么 Dynamics 专属的方块要装：OneUptime 用 [API 组件](/docs/workflows/components#api)跟 **Dataverse Web API** 打交道，Dynamics 则通过一个 [Webhook 触发器](/docs/workflows/triggers#webhook)回话。

```text
OneUptime Incident → On Create  ──►  API Post (token)  ──►  API Post (POST /api/data/v9.2/incidents)  ──►  Dynamics 365 Case

Dynamics 365 Case changed  ──►  Power Automate flow (HTTP)  ──►  OneUptime Webhook trigger  ──►  Update One Incident
```

这一页两个方向都讲。先搭出站那一半——需要 Microsoft Entra ID 配置的是它，而一旦它跑通了，入站那一半就只是一个流。

## 前提条件

- 一个包含 **Case** 表的 **Dynamics 365** 环境。案例来自 Dynamics 365 Customer Service；没有它的 Dataverse 环境里没有可写入的 `incident` 表。
- 该环境的 **Web API endpoint**。可以在 [Power Platform 管理中心](https://admin.powerplatform.microsoft.com/)里你的环境下的 **Settings → Developer resources** 找到它，或者在 **make.powerapps.com → Settings → Developer resources** 里找。它长得像 `https://yourorg.crm.dynamics.com/api/data/v9.2/`——其中的区域段会变（北美是 `crm`，南美是 `crm2`，日本是 `crm7`，以此类推）。
- 在 **Microsoft Entra ID** 里注册应用程序的权限，以及在 Dynamics 环境里创建**应用程序用户**的权限。这通常是两位不同的管理员负责的。
- 一个你能创建工作流和全局变量的 OneUptime 项目。

> 下面所有内容用的都是 Dataverse 的表名，不是 Dynamics 表单上的标签。一个案例就是 **`incident`** 表，它在 URL 里的集合名是 **`incidents`**，主键是 **`incidentid`**，标题列是 **`title`**。你在界面里看到的案例编号是 **`ticketnumber`**。

## 步骤 1——在 Microsoft Entra ID 里注册一个应用程序

OneUptime 是以应用程序而不是以某个人的身份来认证的，所以它用的是 OAuth 2.0 的**客户端凭据**流程。

1. 用与你的 Dynamics 环境同一租户的管理员身份登录 [Azure 门户](https://portal.azure.com)，打开 **Microsoft Entra ID**。
2. 进入 **App registrations → New registration**。给它起个名字，比如 `OneUptime Integration`，**Supported account types** 保持在 **Accounts in this organizational directory only**，然后选 **Register**。
3. 在这个应用的 **Overview** 页面上，复制 **Application (client) ID** 和 **Directory (tenant) ID**。
4. 进入 **Certificates & secrets → Client secrets → New client secret**。在离开这个页面之前，把这个 secret 的 **Value** 复制下来——不是它的 ID。它永远不会再显示第二次。一个客户端 secret 最长只能活 24 个月，所以把到期日记在一个你看得到的地方。

有两样东西人们会在这里多加，其实你并不需要：

- **不需要 API permissions。** 客户端凭据流程里没有登录用户，所以委派权限什么也做不了。**Dataverse** 下面的 `user_impersonation` 是一个委派权限，只用于交互式应用。就算完全不配置任何权限，Microsoft Entra ID 也会痛快地为 Dataverse 颁发令牌——访问权限是在 Dynamics 那边决定的，也就是步骤 2。
- **不需要管理员同意这一步。** 原因同上。

对于生产环境的应用程序，Microsoft 更推荐用证书而不是客户端 secret。那个方案要求调用方自己构造并签名一个 JWT 断言，而工作流做不到这一点，所以客户端 secret 是这里更实际的选择——那就相应地对待它：把它放在机密变量里，并在它过期之前轮换。

## 步骤 2——在 Dynamics 里创建应用程序用户

这一步是最容易被跳过的，而跳过它会造成整个集成里最令人困惑的故障：令牌请求成功了，然后每一个 Dataverse 调用都以 `403 Forbidden` 和错误码 `0x80072560` 失败——*"The user isn't a member of the organization."*（该用户不是本组织的成员。）Entra ID 在完全不了解 Dynamics 的情况下颁发了令牌；Dynamics 随后去找与该应用程序匹配的用户行，却找不到。

1. 打开 [Power Platform 管理中心](https://admin.powerplatform.microsoft.com/)，选择 **Manage → Environments**，然后选你的环境。
2. 选择 **Settings → Users + permissions → Application users**。
3. 选择 **+ New app user**，然后 **+ Add an app**，挑出步骤 1 里的那个注册，再选 **Add**。
4. 挑一个 **Business unit**，填一个 **Email address**，然后用 **Security roles** 旁边的编辑图标。
5. 分配一个对 **Case** 表拥有创建、读取和写入权限的**自定义**安全角色。应用程序用户不能被赋予内置角色——Microsoft 要求必须用自定义角色。如果你没有合适的角色，就复制一个现有的再把它裁剪一下。
6. 选择 **Save**，然后 **Create**。

在一个环境里，每个注册的应用程序只能有一个应用程序用户。应用程序用户不占许可证，也不受该环境安全组成员资格规则的约束。

## 步骤 3——把凭据存进 OneUptime

去 **工作流 → 全局变量 → 创建**，加上这些变量，标了"是"的那几个要把 **密钥** 打开：

| 名称                     | 值                                                          | 密钥 |
| ------------------------ | ----------------------------------------------------------- | ------ |
| `DYNAMICS_TENANT_ID`     | 步骤 1 里的 Directory (tenant) ID                            | 否     |
| `DYNAMICS_CLIENT_ID`     | 步骤 1 里的 Application (client) ID                          | 否     |
| `DYNAMICS_CLIENT_SECRET` | 步骤 1 里客户端 secret 的 **Value**                          | 是     |
| `DYNAMICS_URL`           | `https://yourorg.crm.dynamics.com`——结尾不要带斜杠            | 否     |

把客户端 secret 原样粘贴，就照 Entra ID 给你的样子。OneUptime 会替你对表单正文做编码，所以别自己去做 URL 编码。

在方块里用 `{{global.variables.DYNAMICS_CLIENT_ID}}` 这样引用它们中的任何一个。机密是怎么从运行日志里被抹掉的，见[变量](/docs/workflows/variables)。

## 步骤 4——取一个访问令牌

每次运行都取自己的令牌。令牌能活 60–90 分钟，而客户端凭据流程从不颁发刷新令牌，所以既没有东西要缓存，也没有东西要续期——代价就是每次运行多一个 HTTP 调用。

1. 打开 **工作流 → 创建工作流**，命名为 `Incidents → Dynamics 365`，然后打开 **生成器**。
2. 点那个虚线占位方块，添加 **On Create Incident** 触发器，在它的 **Select Fields** 里把你想发送的列要出来：

   ```json
   {
     "_id": true,
     "title": true,
     "description": true,
     "incidentNumber": true,
     "incidentSeverity": { "name": true }
   }
   ```

   它的 **Identifier** 保持 `incident-on-create-1` 不变。

3. 点 **添加组件**，加一个 **API Post (JSON)** 方块，把触发器的 **成功** 圆点连到它上面，然后打开它的设置。把 **Identifier** 设成 `get-token`，然后：

   - **URL**：`https://login.microsoftonline.com/{{global.variables.DYNAMICS_TENANT_ID}}/oauth2/v2.0/token`
   - **Request Headers**：

     ```json
     { "Content-Type": "application/x-www-form-urlencoded" }
     ```

   - **Request Body**：

     ```json
     {
       "client_id": "{{global.variables.DYNAMICS_CLIENT_ID}}",
       "client_secret": "{{global.variables.DYNAMICS_CLIENT_SECRET}}",
       "scope": "{{global.variables.DYNAMICS_URL}}/.default",
       "grant_type": "client_credentials"
     }
     ```

**头部名字要写成 `Content-Type`，大小写就照这样。** 正是它告诉 OneUptime 要把正文当作表单提交而不是 JSON 发出去，而这是 Microsoft 令牌端点唯一接受的形状。小写的 `content-type` 匹配不上，请求会以 JSON 发出去，然后回一个 `400`。

`scope` 必须是你的环境 URL 后面跟上 `/.default`——那是机密客户端的写法。这里的环境 URL 写错，是 `AADSTS70011: The provided value for the input parameter 'scope' is not valid` 最常见的原因。

现在这个令牌在下游可以这样取到：

```text
{{local.components.get-token.returnValues.response-body.access_token}}
```

## 步骤 5——创建案例

再加一个 **API Post (JSON)** 方块，把 `get-token` 的 **成功** 圆点连到它上面，并把它的 **Identifier** 设成 `create-case`。

- **URL**：`{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents?$select=incidentid,ticketnumber`
- **Request Headers**：

  ```json
  {
    "Authorization": "Bearer {{local.components.get-token.returnValues.response-body.access_token}}",
    "OData-MaxVersion": "4.0",
    "OData-Version": "4.0",
    "Accept": "application/json",
    "If-None-Match": "null",
    "Prefer": "return=representation"
  }
  ```

- **Request Body**：

  ```json
  {
    "title": "OneUptime #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}: {{local.components.incident-on-create-1.returnValues.model.title}}",
    "description": "{{local.components.incident-on-create-1.returnValues.model.description}}",
    "caseorigincode": 3,
    "prioritycode": 1,
    "customerid_account@odata.bind": "/accounts(00000000-0000-0000-0000-000000000000)"
  }
  ```

把那个 account GUID 换成这些案例所属的客户。**`customerid` 在案例上是真的必填**——它是 Dataverse 在任何编程写入时都会强制要求的列之一，所以不带它的创建请求会被拒绝。因为它既可以指向 account 也可以指向 contact，你永远不会写 `customerid@odata.bind`；你写的是 `customerid_account@odata.bind` 或者 `customerid_contact@odata.bind`，而且这些名字区分大小写。`title` 则是另一种意义上的必填：Dynamics 的表单坚持要它，API 并不要求——不过还是发上它。

`Prefer: return=representation` 是让这一步在工作流里能用起来的关键。没有它，一次成功的创建会回 `204 No Content`，并把新记录的 URI 放进一个 `OData-EntityId` 响应头里，然后你还得从里面把 GUID 抠出来。加上它，响应就是 `201 Created` 并带着记录本身，于是下一个方块可以读：

```text
{{local.components.create-case.returnValues.response-body.incidentid}}
{{local.components.create-case.returnValues.response-body.ticketnumber}}
```

现在把工作流打开——**概览 → 编辑工作流 → 已启用**——宣布一个测试事件，然后在 **运行和日志** 下读这次运行。`create-case` 方块应该显示 `201`，正文里带着新的 `incidentid`。画布上的改动会自动保存；没有保存按钮。

### 映射严重级别和状态

Dynamics 自带的 `severitycode` 只有一个选项 "Default Value"，所以开箱并没有一套可供映射的严重级别刻度。改用 **`prioritycode`**，如果你想按严重级别给出不同的优先级，就用一个 **If / Else** 方块按 `{{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}` 分支。

| 列               | 取值                                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `prioritycode`   | `1` 高、`2` 普通、`3` 低                                                                                                          |
| `caseorigincode` | `1` 电话、`2` 邮件、`3` Web、`2483` Facebook、`3986` Twitter、`700610000` IoT                                                     |
| `casetypecode`   | `1` 问询、`2` 问题、`3` 请求                                                                                                      |
| `statecode`      | `0` 活动、`1` 已解决、`2` 已取消                                                                                                  |
| `statuscode`     | `1` 进行中、`2` 挂起、`3` 等待补充信息、`4` 调查中、`5` 问题已解决、`6` 已取消、`1000` 已提供信息、`2000` 已合并 |

`statuscode` 是可自定义的，所以某个租户可能加了自己的取值。发整数，别发标签。

## 步骤 6——让事件和案例彼此都能找到对方

你之后要做的任何事情——留言、解决、同步回来——都需要两个系统之一保存另一个的标识符。把它放在 Dynamics 这边。

往 Case 表加一个**单行文本**列，比如 `new_oneuptimeincidentid`，并在创建案例时设置它：

```json
"new_oneuptimeincidentid": "{{local.components.incident-on-create-1.returnValues.model._id}}"
```

之后任何工作流都能用一个过滤条件找到这个案例：

```text
{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents?$select=incidentid,ticketnumber&$filter=new_oneuptimeincidentid eq '<the incident id>'
```

如果你把这一列定义成 Case 表上的**备用键**，就可以完全跳过查找，直接 `PATCH` 到 `incidents(new_oneuptimeincidentid='<id>')`——这是一次 upsert，案例不存在就创建，存在就更新。这个键必须先构建完成（状态变成 **Active**）才能使用，而且备用键的值里不能包含 `/ < > * % & : \ ? + #`。OneUptime 的 id 就是一个普通的 UUID，所以是安全的。

反过来——把 Dynamics 的案例 id 存到 OneUptime 事件上——也能做到，用一个 **Update One Incident** 方块写入 `customFields`。但要当心：`customFields` 是一整个 JSON 列，所以写它会替换掉那个事件上每一个自定义字段的值，不只是你的那个。把这条关联放在 Dynamics 这边就完全避开了这个问题。

## 步骤 7——事件解决时把案例也解决掉

把这一段搭成**第二个**工作流，这样这里出问题也挡不住案例的创建。

1. **创建工作流**，命名为 `Incident resolved → Close Dynamics case`，加上 **On Update Incident** 触发器。
2. 在触发器的 **Listen on** 里填 `{"currentIncidentStateId": true}`，这样工作流只在状态变化时醒来，而不是每次编辑都醒。在 **Select Fields** 里，要 `{"_id": true, "currentIncidentState": {"name": true}}`。
3. 加一个 **If / Else** 方块。**Input 1** 是 `{{local.components.incident-on-update-1.returnValues.model.currentIncidentState.name}}`，**Operator** 是 `==`，**Input 2** 是 `Resolved`——或者你项目里表示已解决的那个状态的名字。见[事件状态与严重级别](/docs/incidents/states-and-severities)。
4. 从 **是** 分支出发，重复一遍步骤 4 里的 `get-token` 方块。
5. 加一个 **API Get (JSON)** 方块，把它的 **Identifier** 设成 `find-case`，并给它步骤 6 里那个带 `$filter` 的 URL。Dataverse 的查询会用一个 `value` 数组来回答，而工作流的引用可以用方括号索引数组，所以案例 id 就是 `{{local.components.find-case.returnValues.response-body.value[0].incidentid}}`。
6. 加一个关闭案例的 **API Post (JSON)** 方块：

   - **URL**：`{{global.variables.DYNAMICS_URL}}/api/data/v9.2/CloseIncident`
   - **Request Headers**：和步骤 5 一样，去掉 `Prefer`。
   - **Request Body**：

     ```json
     {
       "IncidentResolution": {
         "@odata.type": "Microsoft.Dynamics.CRM.incidentresolution",
         "subject": "Resolved in OneUptime",
         "incidentid@odata.bind": "/incidents(<the case id>)"
       },
       "Status": 5
     }
     ```

     `Status` 是已解决状态下的一个 `statuscode` 取值——`5` 是 *Problem Solved*。

     **在你真的依赖这个正文之前，先拿你自己的环境测一下。** `CloseIncident` 接受两个参数，`IncidentResolution` 和 `Status`，但 Microsoft 没有发布过它的 HTTP 示例——所有官方示例都是 C#。上面这个形状是按惯例翻译过来的。如果你的环境拒绝它，可以试着用一个普通的 `"incidentid": "<the case id>"` 属性来标识案例，而不是 `@odata.bind` 的写法——Microsoft 其他动作的示例就是这样引用已有记录的。

**为什么不直接 `PATCH` 案例的 `statecode: 1`？** 你可以这么做——Microsoft 文档里把 `PATCH` `statecode` 和 `statuscode` 描述为老的 SetState 消息在 Web API 里的等价物，而且在活动状态之间挪动案例时，它就是对的工具。它做不到的是创建 **Case Resolution** 活动，而 Dynamics 365 Customer Service 里一个已解决的案例本该有这个活动；并且在管理员配置了自定义状态流转的环境里，它会被直接拒绝。要解决就用 `CloseIncident`；其他一切用 `PATCH`。另外，只要你写 `statecode`，就在同一个请求里把 `statuscode` 也设上——否则 Dynamics 会悄悄套用那个状态的默认状态值。

`CloseIncident` 来自 Dynamics 365 Customer Service，而不是基础的 Dataverse，它也没有列在 Dataverse 的动作参考里。如果它返回 `404`，就取一下 `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/$metadata` 并在里面搜 `CloseIncident`，确认它在你的环境里存在。

至于关闭案例之外的事情——加一条备注、提一下优先级、改个标题——用一个 **API Patch (JSON)** 方块打到 `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents(<the case id>)`，并带上 `If-Match: *` 头部，它能防止一次意外的 upsert 创建出一个新案例。只发你要改的那些列。

## 入站——从 Dynamics 365 到 OneUptime

现在换个方向：有人在 Dynamics 里关闭了案例，或者某个客服加了一条备注，OneUptime 应该知道这件事。

### 先搭接收端的工作流

1. **创建工作流**，命名为 `Dynamics 365 → OneUptime`，加上 **Webhook** 触发器。
2. 打开这个工作流的 **设置**，复制 **Webhook Secret Key**。你的 URL 是：

   ```text
   https://oneuptime.com/workflow/trigger/<webhook secret key>
   ```

   在自托管的安装上，换成你自己的主机名。把这个 URL 当密码看待——拿到它的人都能启动这个工作流。你可以在同一个页面上重置密钥。

3. 加一个 **If / Else** 方块，在其他任何事情发生之前先校验一个共享密钥。**Input 1** 是 `{{local.components.webhook-1.returnValues.request-headers.x-oneuptime-secret}}`，**Operator** 是 `==`，**Input 2** 是 `{{global.variables.DYNAMICS_WEBHOOK_SECRET}}`——一个你自己编出来、存成机密全局变量的值。
4. 从 **是** 分支出发，加一个 **Update One Incident** 方块：

   - **Query**：`{"_id": "{{local.components.webhook-1.returnValues.request-body.oneuptimeIncidentId}}"}`
   - **Data (JSON Object)**：这次案例变化在 OneUptime 里该意味着什么——一次状态变更、一条备注、一个标签。

   要把事件挪到某个状态，你需要那个状态的 id：一个查询为 `{"name": "Resolved"}` 的 **Find One Incident State** 方块会给你 `{{local.components.incident-state-find-one-1.returnValues.model._id}}`，把它写进 `currentIncidentStateId`。

让它保持启用、待命。现在去给 Dynamics 一个可以调用的东西。

### 方案 A——一个 Power Automate 流（推荐）

大多数团队都应该走这条路：载荷由你控制，而且没有什么要安装的。

1. 在 [Power Automate](https://make.powerautomate.com) 里创建一个 **Automated cloud flow**。
2. 触发器：**Microsoft Dataverse → When a row is added, modified or deleted**（当行被添加、修改或删除时）。

   - **Change type**：`Modified`
   - **Table name**：`Cases`
   - **Scope**：`Organization`——范围再窄一点的话，就只对你自己或你所在业务部门拥有的行开火。
   - **Select columns**：`statecode,statuscode`。这是一个只对更新生效的过滤条件，值得认真设置。这里不支持查找列；也千万别在这里列出每次更新都会出现的列（比如主键），否则每保存一次流都会开火。

3. 加上 **Microsoft Dataverse → Get a row by ID**，表选 `Cases`，行 id 取自触发器，**Select columns** 填 `incidentid,ticketnumber,title,statecode,statuscode,new_oneuptimeincidentid`。

   这第二个调用是值这个代价的。在一次更新里，触发器只带上发生变化的那些列，所以你要用来匹配的标识符很可能根本不在里面。

4. 加上内置的 **HTTP** 动作：

   - **Method**：`POST`
   - **URI**：上面那个 OneUptime webhook URL
   - **Headers**：`Content-Type: application/json` 和 `X-OneUptime-Secret: <the same secret>`
   - **Body**：用 *Get a row by ID* 的输出拼出来，例如

     ```json
     {
       "oneuptimeIncidentId": "<new_oneuptimeincidentid>",
       "caseId": "<incidentid>",
       "caseNumber": "<ticketnumber>",
       "statecode": "<statecode>",
       "statuscode": "<statuscode>"
     }
     ```

5. 保存并把这个流打开。

在你决定走这条路之前值得知道的几件事：

- **Microsoft Dataverse 连接器是高级功能。** 对一个自动化流来说，只有流的所有者需要那张许可证，不是每个碰过这个案例的人都需要——但所有者的许可证一旦失效，流就会悄无声息地停掉。
- Dataverse 触发器是**推送的，不是轮询的**——Dynamics 注册一个回调然后触发它。投递通常在几秒之内；超过五分钟就说明异步服务积压了，你可以在管理中心的 **Settings → System Jobs** 下看到。
- 自定义头部会保留下来。Power Automate 会从 HTTP 动作里剥掉好几类标准头部（大部分 `Accept-*` 和 `Content-*` 头部，以及 `Host`、`Origin`、`Cookie`），但像 `X-OneUptime-Secret` 这样你自己的头部会被原样传过去。
- 这个流必须和它监视的那张表待在同一个环境里。
- 这些请求会计入你租户的 Power Platform 请求配额，而连接器的限流会在流的运行里以 `429` 的形式出现。

### 方案 B——一个原生的 Dataverse webhook

如果 Power Automate 用不了，Dataverse 也可以直接调 OneUptime。用[插件注册工具](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/register-web-hook)注册这个端点：**Register New WebHook**，填上 OneUptime 的 URL，认证方式选 **HttpHeader**，并加上 `X-OneUptime-Secret` 和你的密钥。然后在 **incident** 表上为 **Update** 消息注册一个步骤，**Filtering Attributes** 限制在你关心的那几列上，阶段选 **PostOperation**，执行模式选 **Asynchronous**。

走这条路要心里有数：

- **只能用 80 和 443 端口。** 跑在其他端口上的自托管 OneUptime 没法注册。
- **Dataverse 不会校验你的密钥。** 它只是把这个头部发出去；拒绝那些不带它的请求完全是你的工作流的活儿——接收端工作流里的那个 **If / Else** 方块就是干这个的。
- **载荷不是一个友好的 JSON 对象。** 它是一个序列化后的 `RemoteExecutionContext`，其中 `InputParameters` 是一个由 `{key, value}` 对组成的*数组*，发生变化的那一行放在键 `Target` 下面，它的各列又在一个 `Attributes` 数组里。做好准备：在别的东西能读它之前，你得加一个 **Run Custom JavaScript** 方块把它摊平。
- **更新时只包含发生变化的列**，所以如果你需要 `ticketnumber` 或者你那个存 OneUptime id 的列，就注册一个 **Post Image**。
- **超过 256 KB，有意思的那部分会被剥掉**——`InputParameters`、`PreEntityImages` 和 `PostEntityImages` 都没了，请求会带上一个 `x-ms-dynamics-msg-size-exceeded` 头部。`PrimaryEntityId` 和 `PrimaryEntityName` 会保留下来，所以退路是通过 Web API 把这一行再读回来。
- **投递几乎不留余地。** Dataverse 会等 60 秒等一个 `2xx`，而且只重试一次，还只对 `502`、`503` 和 `504` 重试。其他任何情况——包括你这边返回的 `500`——都不会重试；它会变成一个失败的 System Job。
- 选 **Asynchronous**。同步的步骤会让客服的保存操作卡在你的端点上，而且如果事务之后回滚了，请求已经发出去了、收不回来。

经典的 Dynamics 后台工作流根本没有 HTTP 或 webhook 步骤，所以它们在这里不算第三个选项。

## 对告警做同样的事

上面所有内容都是围绕事件写的，因为那是常见情况，不过告警的做法完全一样——把记录类型换掉，别的什么都不用改：

| 事件                                                          | 告警                                                |
| ------------------------------------------------------------ | --------------------------------------------------- |
| **On Create Incident**（`incident-on-create-1`）              | **On Create Alert**（`alert-on-create-1`）           |
| **On Update Incident**（`incident-on-update-1`）              | **On Update Alert**（`alert-on-update-1`）           |
| `incidentNumber`、`currentIncidentState`、`incidentSeverity`  | `alertNumber`、`currentAlertState`、`alertSeverity` |
| **Find One Incident State**                                   | **Find One Alert State**                            |
| **Update One Incident**                                       | **Update One Alert**                                |

一个工作流恰好只有一个触发器，所以事件和告警各需要一个工作流。如果两者要做的活儿是一样的，就把 Dynamics 那一半搭一次，然后用 **Execute Workflow** 组件从两边分别调用它。

## 故障排查

先在 **运行和日志** 里读出错的那个方块——两个 Microsoft 端点都会返回一个解释性的 JSON 正文，而 API 组件会把它保存在 `response-body` 里。

**令牌请求以 `400` 加 `invalid_request` 或者不支持的 grant type 失败。** `Content-Type` 头部不是精确的 `Content-Type: application/x-www-form-urlencoded`，所以正文是以 JSON 发出去的。检查大小写。

**`400` 带 `AADSTS70011: The provided value for the input parameter 'scope' is not valid`。** `scope` 不是你的环境 URL 加 `/.default`。从 **Developer resources** 里把 URL 复制过来，去掉结尾的斜杠和任何 `/api/data/...` 路径。

**Dynamics 返回 `401 Unauthorized`。** `Authorization` 头部缺失、格式不对，或者令牌在运行中途过期了。它必须写成 `Bearer <token>`，中间只有一个空格。

**`403 Forbidden` 带 `0x80072560`，"The user isn't a member of the organization"。** 步骤 2 被跳过了，或者应用程序用户绑到了另一个应用注册上。令牌没问题；Dynamics 那边的用户不在。

**`403 Forbidden` 带权限错误。** 应用程序用户是存在的，但它的自定义安全角色在 **Case** 上缺少 Create、Read 或 Write 权限。

**`400 Bad Request` 提到 customer。** `customerid` 是必填的。设置 `customerid_account@odata.bind` 或 `customerid_contact@odata.bind`，拼写要精确，值是一个以斜杠开头的 URI，比如 `/accounts(<guid>)`。

**`/CloseIncident` 返回 `404 Not Found`。** 这个动作是 Dynamics 365 Customer Service 的动作。在假定它可用之前，先在你环境的 `$metadata` 里搜一下它。

**`412 Precondition Failed` 带 `DuplicateRecord`。** 有一条重复检测规则匹配上了。要么把规则收窄，要么别再发它用来匹配的那个字段。

**`429 Too Many Requests`。** 这是 Dataverse 的服务保护限制——在任意五分钟窗口内，每个用户、每台 web 服务器大约 6,000 个请求和 20 分钟的执行时间。响应里带着以秒为单位的 `Retry-After`。如果某个工作流在突发，就在里面放一个 **Delay** 方块，或者把这些活儿挪到一个做批处理的计划工作流里。

**OneUptime 这边什么都没收到。** 自己用 `curl` 往那个 webhook URL 发一个请求，看看这个工作流的 **运行和日志**。如果你自己的请求出现了而 Dynamics 的没有，问题就在上游：Power Automate 的话，去看那个流自己的运行历史；原生 webhook 的话，去看 **Settings → System Jobs** 并筛选失败项。

**工作流跑了，但事件没有变化。** 当查询什么都没匹配到时，**Update One Incident** 方块会报 `Items Updated: 0`——那是成功，不是错误。检查载荷里的那个 id 是不是 OneUptime 的事件 id，以及你查的是不是 `_id`。

## 接下来读什么

- [集成](/docs/integrations/index)——入站和出站模式，以及认证速查表。
- [Jira](/docs/integrations/jira)——针对 Jira 的同样的双向搭法。
- [工作流概览](/docs/workflows/index) 和 [创建工作流](/docs/workflows/authoring)——画布、identifier，以及怎么把工作流打开。
- [组件](/docs/workflows/components)——API 方块、If / Else，以及 OneUptime 数据组件。
- [变量](/docs/workflows/variables)——机密，以及从下一个方块读取上一个方块的输出。
- [配置与安全](/docs/workflows/configuration)——webhook 安全和出网访问。
- [IP 地址](/docs/configuration/ip-addresses)——OneUptime 的出网地址段，如果 Dynamics 在一个白名单后面的话。
