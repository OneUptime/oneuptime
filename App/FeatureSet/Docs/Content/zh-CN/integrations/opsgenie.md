# Opsgenie 集成

每当创建 OneUptime 事件时，创建一个 [Opsgenie](https://www.atlassian.com/software/opsgenie) 告警，并在 OneUptime 解决时关闭它。

此集成为**出站**模式：OneUptime 调用 [Opsgenie Alert API](https://docs.opsgenie.com/docs/alert-api)。它使用带有 **Incident → On Create** 触发器和 **API 组件**的 OneUptime **[工作流](/docs/workflows/index)**。

```text
OneUptime Incident → On Create  ──►  API component (POST /v2/alerts)  ──►  Opsgenie alert
```

## 前提条件

- 来自 API 集成的 Opsgenie **API 密钥**：**Settings → Integrations → Add → API**。复制该密钥。
- 了解你的区域。默认 API 主机为 `https://api.opsgenie.com`；欧盟账户使用 `https://api.eu.opsgenie.com`。
- 一个可以创建工作流的 OneUptime 项目。

## 步骤 1——存储 API 密钥

1. 前往 **Workflows → Global Variables → Create**。
2. 命名为 `OPSGENIE_KEY`，粘贴 API 密钥，并开启 **Is Secret**。

## 步骤 2——构建"创建告警"工作流

1. 打开 **Workflows → Create Workflow**，命名为 `Incidents → Opsgenie`，并打开 **Builder**。
2. 添加 **Incident** 触发器，设置为 **On Create**。重命名为 `Incident`。
3. 添加连接到触发器的 **API** 模块：

   - **Method**：`POST`
   - **URL**：`https://api.opsgenie.com/v2/alerts` _（欧盟区域使用 `api.eu.opsgenie.com`）_
   - **Headers**：

     ```text
     Authorization: GenieKey {{variable.OPSGENIE_KEY}}
     Content-Type: application/json
     ```

   - **Body**：

     ```json
     {
       "message": "{{Incident.title}}",
       "alias": "oneuptime-{{Incident._id}}",
       "description": "{{Incident.description}}",
       "priority": "P1",
       "source": "OneUptime"
     }
     ```

   **`alias`** 将此 Opsgenie 告警与 OneUptime 事件关联，以便之后通过别名关闭。注意 Opsgenie 认证方案是字面词 `GenieKey` 后跟一个空格和你的密钥。

4. **保存**，启用，并创建一个测试事件。工作流日志中出现 `202 Accepted` 响应表示 Opsgenie 已将告警加入队列。

## 步骤 3——在 OneUptime 解决时关闭（推荐）

1. 创建一个名为 `Close Opsgenie` 的**第二个**工作流，使用 **Incident → On Update** 触发器。
2. 添加 **Conditions** 模块，检查事件是否已解决（分支判断 `{{Incident.currentIncidentState.name}}`）。
3. 从 **Yes** 出发，添加 **API** 模块：
   - **Method**：`POST`
   - **URL**：`https://api.opsgenie.com/v2/alerts/oneuptime-{{Incident._id}}/close?identifierType=alias`
   - **Headers**：同 `Authorization: GenieKey {{variable.OPSGENIE_KEY}}`
   - **Body**：`{ "source": "OneUptime", "note": "Resolved in OneUptime" }`

Opsgenie 通过别名查找告警并关闭它。

## 优先级映射（可选）

Opsgenie 优先级从 `P1` 到 `P5`。通过在 API 模块之前对 `{{Incident.incidentSeverity.name}}` 添加 **Conditions** 分支来映射 OneUptime 严重程度。

## 故障排查

- **`401`/`403`**——密钥错误、区域主机错误，或集成缺少创建告警的权限。确认你使用的是 **API** 集成密钥以及匹配的 `api`/`api.eu` 主机。
- **关闭返回 `404`**——关闭调用中的 `alias` 必须与创建调用完全一致，且查询字符串中必须包含 `identifierType=alias`。
- **什么都没发生**——确认工作流已 **Enabled**。

## 接下来读什么

- [集成概览](/docs/integrations/index)——模式和认证速查表。
- [PagerDuty](/docs/integrations/pagerduty)——适用于 PagerDuty 的相同思路。
- [值班](/docs/on-call/incoming-call-policy)——OneUptime 内置的升级功能。
