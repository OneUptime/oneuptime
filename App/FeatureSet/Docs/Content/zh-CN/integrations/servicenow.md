# ServiceNow 集成

每当创建 OneUptime 事件时，自动创建一个 [ServiceNow](https://www.servicenow.com) 事件——让 ITSM 和监控保持同步。

此集成为**出站**模式：OneUptime 调用 ServiceNow [Table API](https://docs.servicenow.com/bundle/utah-application-development/page/integrate/inbound-rest/concept/c_TableAPI.html)。它使用带有 **Incident → On Create** 触发器和 **API 组件**的 OneUptime **[工作流](/docs/workflows/index)**。

```text
OneUptime Incident → On Create  ──►  API component (POST /api/now/table/incident)  ──►  ServiceNow incident
```

## 前提条件

- 一个 ServiceNow 实例（`https://your-instance.service-now.com`）。
- 一个具有 `rest_api_explorer` / `itil` 角色（或足够权限创建 `incident` 记录）的 ServiceNow 用户。使用此用户凭证的 Basic 认证是最简单的起点；生产环境推荐使用 OAuth。
- 一个可以创建工作流的 OneUptime 项目。

## 步骤 1——将凭证存储为机密

ServiceNow 的 Table API 接受 **Basic 认证**。

1. 对 `username:password` 进行一次 base64 编码：

   ```bash
   printf '%s' 'integration_user:password' | base64
   ```

2. 在 OneUptime 中，前往 **Workflows → Global Variables → Create**，命名为 `SERVICENOW_AUTH`，粘贴 base64 字符串，并开启 **Is Secret**。

## 步骤 2——构建工作流

1. 打开 **Workflows → Create Workflow**，命名为 `Incidents → ServiceNow`，并打开 **Builder**。
2. 添加 **Incident** 触发器，设置为 **On Create**。重命名为 `Incident`。
3. 添加连接到触发器的 **API** 模块：

   - **Method**：`POST`
   - **URL**：`https://your-instance.service-now.com/api/now/table/incident`
   - **Headers**：

     ```text
     Authorization: Basic {{variable.SERVICENOW_AUTH}}
     Content-Type: application/json
     Accept: application/json
     ```

   - **Body**：

     ```json
     {
       "short_description": "OneUptime: {{Incident.title}}",
       "description": "{{Incident.description}}",
       "urgency": "1",
       "impact": "1",
       "correlation_id": "oneuptime-{{Incident._id}}"
     }
     ```

   `correlation_id` 保持了指向 OneUptime 事件的链接——如果之后你要添加解决步骤会很方便。ServiceNow `urgency`/`impact` 使用 `1`（高）、`2`（中）、`3`（低）。

4. **保存**，启用，并创建一个测试事件。工作流日志中出现 `201 Created` 响应，将返回新记录的 `sys_id` 和 `number`（例如 `INC0012345`）。

## 步骤 3——在 OneUptime 解决时解决（可选）

1. 创建一个带有 **Incident → On Update** 触发器的**第二个**工作流，并添加 **Conditions** 模块检查事件是否已解决。
2. 要更新正确的 ServiceNow 记录，你需要其 `sys_id`。可以在步骤 2 中将其存储到 OneUptime 事件上（读取 `{{CreateRecord.response-body.result.sys_id}}` 并用 **Update Incident** 写入标签），或者先通过 `GET` 请求 `/api/now/table/incident?sysparm_query=correlation_id=oneuptime-{{Incident._id}}` 查找记录。
3. 添加 **API** 模块：**Method** `PATCH`，**URL** `https://your-instance.service-now.com/api/now/table/incident/<sys_id>`，正文 `{ "state": "6", "close_code": "Resolved by monitoring", "close_notes": "Resolved in OneUptime" }`（`state` `6` = 默认 ITIL 工作流中的 Resolved 状态）。

## 故障排查

- **`401`**——用 `printf`（不是 `echo`，它会添加换行符）重新编码 `username:password` 并更新 `SERVICENOW_AUTH`。
- **`403`**——用户缺少写入 `incident` 表的权限；添加 `itil` 角色。
- **`400`**——某个字段名或字段值与你实例的自定义配置不符。在 **System Definition → Tables → incident** 中检查字段名。
- **实例拒绝调用**——某些实例限制了 Table API；确认 REST 已启用且你的 IP 未被 ACL 屏蔽。

## 接下来读什么

- [集成概览](/docs/integrations/index)——模式和认证速查表。
- [Jira](/docs/integrations/jira)——适用于 Jira 的相同出站模式。
- [API 组件](/docs/workflows/components#api)——读取响应体。
