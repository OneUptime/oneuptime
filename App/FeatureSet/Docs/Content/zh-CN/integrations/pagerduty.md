# PagerDuty 集成

每当创建 OneUptime 事件时触发一个 [PagerDuty](https://www.pagerduty.com) 事件，并在 OneUptime 解决时一并解决。当 PagerDuty 负责你的升级和值班排班，而你希望 OneUptime 的监控来驱动它时，这个集成非常有用。

此集成为**出站**模式：OneUptime 调用 PagerDuty 的 [Events API v2](https://developer.pagerduty.com/docs/events-api-v2/overview/)。它使用带有 **Incident → On Create** 触发器和 **API 组件**的 OneUptime **[工作流](/docs/workflows/index)**。

> OneUptime 内置了自己的值班和升级功能——参见[值班](/docs/on-call/incoming-call-policy)。仅当你明确希望事件也出现在 PagerDuty 中时才使用此集成。

```text
OneUptime Incident → On Create  ──►  API component (POST /v2/enqueue)  ──►  PagerDuty incident
```

## 前提条件

- 一个带有 **Events API v2** 集成的 PagerDuty 服务。在 PagerDuty 中：**Service → Integrations → Add integration → Events API v2**。复制 **Integration Key**（也称为 *routing key*）。
- 一个可以创建工作流的 OneUptime 项目。

## 步骤 1——存储 routing key

1. 前往 **Workflows → Global Variables → Create**。
2. 命名为 `PAGERDUTY_ROUTING_KEY`，粘贴集成密钥，并开启 **Is Secret**。

## 步骤 2——构建"触发"工作流

1. 打开 **Workflows → Create Workflow**，命名为 `Incidents → PagerDuty`，并打开 **Builder**。
2. 添加 **Incident** 触发器，设置为 **On Create**。重命名为 `Incident`。
3. 添加连接到触发器的 **API** 模块：
   - **Method**：`POST`
   - **URL**：`https://events.pagerduty.com/v2/enqueue`
   - **Headers**：`Content-Type: application/json`
   - **Body**：

     ```json
     {
       "routing_key": "{{variable.PAGERDUTY_ROUTING_KEY}}",
       "event_action": "trigger",
       "dedup_key": "oneuptime-{{Incident._id}}",
       "payload": {
         "summary": "{{Incident.title}}",
         "source": "OneUptime",
         "severity": "critical",
         "custom_details": {
           "description": "{{Incident.description}}"
         }
       }
     }
     ```

   **`dedup_key`** 将此 PagerDuty 事件与 OneUptime 事件关联，以便之后解决。使用 OneUptime 事件 ID 可确保其唯一且可预测。
4. **保存**，启用，并创建一个测试事件。工作流日志中出现 `202` 响应表示 PagerDuty 已接受该事件。

## 步骤 3——在 OneUptime 解决时解决（推荐）

1. 在**同一个**工作流中再添加一个 **Incident** 触发器？不——一个工作流只能有一个触发器。请创建一个**第二个**工作流，命名为 `Resolve PagerDuty`，使用 **Incident → On Update** 触发器。
2. 添加 **Conditions** 模块，检查事件是否已解决（分支判断事件状态 `{{Incident.currentIncidentState.name}}` 是否等于你的已解决状态名称）。
3. 从 **Yes** 出发，添加 **API** 模块向 PagerDuty 发送请求，使用**相同的 `dedup_key`**，并将 `event_action` 设置为 `resolve`：

   ```json
   {
     "routing_key": "{{variable.PAGERDUTY_ROUTING_KEY}}",
     "event_action": "resolve",
     "dedup_key": "oneuptime-{{Incident._id}}"
   }
   ```

PagerDuty 通过 `dedup_key` 匹配并关闭原始事件。

## 严重程度映射（可选）

PagerDuty 的 `severity` 接受 `critical`、`error`、`warning` 或 `info`。要从 OneUptime 严重程度映射，在 API 模块之前对 `{{Incident.incidentSeverity.name}}` 添加 **Conditions** 分支，并从每个分支发送不同的正文。

## 入站（可选）

要反向操作——从 PagerDuty 事件创建 OneUptime 事件——添加一个带 **Webhook** 触发器的工作流，将 PagerDuty [V3 webhook](https://developer.pagerduty.com/docs/webhooks/v3-overview/)（或 Events Orchestration）指向其 URL，然后使用 **Create Incident**。参见[入站模式](/docs/integrations/index#inbound-another-tool-sends-data-into-oneuptime)。

## 故障排查

- **`400` 提示 `"invalid routing key"`**——集成必须是 **Events API v2**，而非较旧的 Events API v1 或其他集成类型。重新复制密钥。
- **解决操作没有关闭任何内容**——解决调用中的 `dedup_key` 必须与触发调用完全一致。
- **日志中什么都没有**——确认工作流已 **Enabled** 且触发器为 **On Create**。

## 接下来读什么

- [集成概览](/docs/integrations/index)——模式和认证速查表。
- [值班](/docs/on-call/incoming-call-policy)——OneUptime 内置的升级功能。
- [Opsgenie](/docs/integrations/opsgenie)——适用于 Opsgenie 的相同思路。
