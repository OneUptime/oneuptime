# Jira 集成

每当创建 OneUptime 事件时，自动创建一个 [Jira](https://www.atlassian.com/software/jira) 工单——让工程工作在开发者已经使用的地方得到追踪，并附带指向事件的链接。

此集成为**出站**模式：OneUptime 调用 Jira 的 REST API。它使用带有 **Incident → On Create** 触发器和 **API 组件**的 OneUptime **[工作流](/docs/workflows/index)**。你可以选择添加**入站**路径，以便关闭 Jira 工单时解决 OneUptime 事件。

```text
OneUptime Incident → On Create  ──►  API component (POST /rest/api/3/issue)  ──►  Jira issue
```

## 前提条件

- 一个 Jira Cloud 站点（`https://your-domain.atlassian.net`）和一个用于提交工单的项目——记录其**项目密钥**（例如 `OPS`）。
- 一个可以创建工单的 Jira 账户，以及从 [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens) 获取的 **API 令牌**。
- 一个可以创建工作流的 OneUptime 项目。

> 使用 **Jira Data Center / Server**（自托管）？流程完全相同——使用你自己的基础 URL，并用带 `Bearer` 认证头的[个人访问令牌](https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html)代替 Basic 认证。`/rest/api/2/issue` 端点接受纯文本描述，模板更简单。

## 步骤 1——将 Jira 凭证存储为机密

Jira Cloud 使用 **Basic 认证**，需要你的邮箱和 API 令牌（base64 编码）。

1. 对 `email:api_token` 进行一次 base64 编码。在 macOS/Linux 上：

   ```bash
   printf '%s' 'you@example.com:your_api_token' | base64
   ```

2. 在 OneUptime 中，前往 **Workflows → Global Variables → Create**。
3. 命名为 `JIRA_AUTH`，将 base64 字符串粘贴为值，并开启 **Is Secret**。

现在你可以使用 `Basic {{variable.JIRA_AUTH}}` 作为认证头，令牌不会出现在工作流或日志中。

## 步骤 2——构建工作流

1. 打开 **Workflows → Create Workflow**，命名为 `Incidents → Jira`，并打开 **Builder**。
2. 将 **Incident** 触发器拖到画布上，选择 **On Create** 事件。重命名为 `Incident`。
3. 拖入 **API** 模块并将触发器连接到它。配置：

   - **Method**：`POST`
   - **URL**：`https://your-domain.atlassian.net/rest/api/3/issue`
   - **Headers**：

     ```text
     Authorization: Basic {{variable.JIRA_AUTH}}
     Content-Type: application/json
     ```

   - **Body**（Jira Cloud v3 的描述使用 Atlassian Document Format）：

     ```json
     {
       "fields": {
         "project": { "key": "OPS" },
         "issuetype": { "name": "Bug" },
         "summary": "OneUptime incident: {{Incident.title}}",
         "description": {
           "type": "doc",
           "version": 1,
           "content": [
             {
               "type": "paragraph",
               "content": [
                 { "type": "text", "text": "{{Incident.description}}" }
               ]
             }
           ]
         }
       }
     }
     ```

   将 `OPS` 替换为你的项目密钥，将 `Bug` 替换为该项目中存在的工单类型。

4. **保存。** 测试前先保持工作流禁用状态。

## 步骤 3——测试

1. 开启工作流 **Enabled**。
2. 在 OneUptime 中创建一个测试事件（或从监控器触发一个）。
3. 打开工作流的 **Logs** 标签。**API** 模块应显示 `201` 状态，响应体包含新工单的 `key`（例如 `OPS-1234`）。
4. 检查 Jira——工单已在那里。

如果 API 模块返回错误，在日志中展开它——Jira 的响应会明确说明哪个字段被拒绝了。参见[故障排查](#故障排查)。

## 步骤 4——将事件链接回工单（推荐）

将 Jira 工单密钥存储在事件上很有用，方便人们在两者之间跳转。

- API 模块的响应可通过 `{{CreateIssue.response-body.key}}` 获取（如果你将模块命名为 `CreateIssue`）。
- 在其后添加 **Update Incident** 模块，将密钥写入事件的标签、自定义字段或备注中。

这也使下面的可选双向同步成为可能。

## 双向同步（可选）

要在有人关闭 Jira 工单时解决 OneUptime 事件，添加一个**入站**工作流：

1. 创建第二个以 **Webhook** 触发器开始的工作流，并复制其 URL。
2. 在 Jira 中，前往 **Project settings → Automation → Create rule**：

   - **触发器**：_Issue transitioned_ 到 **Done**（或 _Issue resolved_）。
   - **动作**：_Send web request_ → 方法 `POST`，URL = 你的工作流 webhook URL，正文包含工单密钥和 OneUptime 事件 ID，例如：

     ```json
     { "issueKey": "{{issue.key}}", "status": "resolved" }
     ```

3. 在工作流中，使用 **Find Incident** 模块通过存储的密钥定位事件，然后使用 **Update Incident** 模块将其移至已解决状态。

如果你在步骤 4 中将 Jira 密钥存储在事件上，匹配就很简单了。参见[组件 → OneUptime 数据组件](/docs/workflows/components#oneuptime-data-components)。

## 自定义工单

API 模块正文的几个常见调整：

- **优先级**——在 `fields` 中添加 `"priority": { "name": "High" }`。你可以通过 **Conditions** 分支 `{{Incident.incidentSeverity.name}}` 将 OneUptime 严重程度映射到 Jira 优先级。
- **标签**——添加 `"labels": ["oneuptime", "incident"]`。
- **经办人**——添加 `"assignee": { "id": "<accountId>" }`（Jira Cloud 使用账户 ID，不是用户名）。
- **自定义字段**——使用 Jira 管理中该字段的 ID 添加 `"customfield_XXXXX": "..."`。

要了解项目期望的确切字段名，可以从浏览器或 `curl` 中一次性调用 Jira 的 `GET /rest/api/3/issue/createmeta` 端点。

## 故障排查

**`401 Unauthorized`。**

- 重新编码 `email:api_token` 并更新 `JIRA_AUTH` 变量。末尾换行符是常见原因——编码时使用 `printf`（不是 `echo`）。
- 确认拥有 API 令牌的账户可以在项目中创建工单。

**`400 Bad Request` 提到某个字段。**

- 工单类型或某个必填字段有误。检查项目的**工单类型**名称以及是否有必填的自定义字段。使用上面的 `createmeta` 查看哪些是必填的。

**`404 Not Found`。**

- 仔细检查基础 URL，确认你访问的是 `/rest/api/3/issue`（Cloud）还是 `/rest/api/2/issue`（Server/Data Center）。

**描述显示为单行 / 看起来奇怪。**

- v3 需要上面展示的 Atlassian Document Format。如果你想发送纯文本，请使用 `/rest/api/2/issue` 端点，将描述改为纯字符串 `"description": "{{Incident.description}}"`。

## 接下来读什么

- [集成概览](/docs/integrations/index)——入站/出站模式和认证速查表。
- [API 组件](/docs/workflows/components#api)——方法、头部和读取响应。
- [变量](/docs/workflows/variables)——机密和事件字段。
- [PagerDuty](/docs/integrations/pagerduty) 和 [ServiceNow](/docs/integrations/servicenow)——其他工具的相同出站模式。
