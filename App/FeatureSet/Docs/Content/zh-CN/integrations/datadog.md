# Datadog 集成

将 [Datadog](https://www.datadoghq.com) 监控告警转化为 OneUptime 事件，让 Datadog 的检测驱动 OneUptime 的事件响应和状态页。

此集成为**入站**模式：Datadog 的 [Webhooks 集成](https://docs.datadoghq.com/integrations/webhooks/)向以 **Webhook 触发器**开始的 OneUptime **[工作流](/docs/workflows/index)**发送请求。

```text
Datadog monitor alerts  ──►  Webhook integration  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## 前提条件

- 一个可以配置集成和监控器的 Datadog 账户。
- 一个可以创建工作流的 OneUptime 项目。

## 步骤 1——构建 OneUptime 工作流

1. 打开 **Workflows → Create Workflow**，命名为 `Datadog → Incidents`，并打开 **Builder**。
2. 添加 **Webhook** 触发器并**复制其 URL**。将模块重命名为 `Datadog`。
3. 添加连接到触发器的 **Conditions** 模块：
   - **Left**：`{{Datadog.Request Body.transition}}`
   - **Operator**：`==`
   - **Right**：`Triggered`
4. 从 **Yes** 出发，添加 **Create Incident** 模块：
   - **Title**：`{{Datadog.Request Body.title}}`
   - **Description**：`{{Datadog.Request Body.body}}\nHost: {{Datadog.Request Body.host}}\n{{Datadog.Request Body.link}}`
   - **Severity**：选择一个。
5. **保存**（测试前保持禁用状态）。

## 步骤 2——创建 Datadog webhook

1. 在 Datadog 中，前往 **Integrations → Webhooks**（如果尚未安装，请安装 **Webhooks** 集成）。
2. **添加一个 webhook**：

   - **Name**：`oneuptime`（这会变成 `@webhook-oneuptime`）。
   - **URL**：你工作流的 webhook URL。
   - **Payload**——Datadog 允许你使用[模板变量](https://docs.datadoghq.com/integrations/webhooks/#usage)自定义 JSON 正文：

     ```json
     {
       "title": "$EVENT_TITLE",
       "body": "$TEXT_ONLY_MSG",
       "alert_type": "$ALERT_TYPE",
       "transition": "$ALERT_TRANSITION",
       "id": "$ALERT_ID",
       "host": "$HOSTNAME",
       "link": "$LINK",
       "priority": "$PRIORITY"
     }
     ```

3. 保存 webhook。

## 步骤 3——将监控器的告警发送到 webhook

将 webhook 句柄添加到你想要转发的监控器中。在每个监控器的**通知消息**中，加入：

```text
{{#is_alert}}@webhook-oneuptime{{/is_alert}}
{{#is_recovery}}@webhook-oneuptime{{/is_recovery}}
```

这会将告警和恢复都发送到 OneUptime。（要转发所有内容，你也可以无条件地在监控器中添加 `@webhook-oneuptime`。）

## 步骤 4——测试

1. 启用工作流。
2. 从监控器使用 **Test Notifications → Alert**，或让真实的监控器触发。
3. 检查工作流的 **Logs** 标签和你的**事件**列表。

## 恢复时解决（可选）

当监控器清除时，`$ALERT_TRANSITION` 为 `Recovered`。添加第二个 **Conditions** 分支（`transition == Recovered`），找到匹配的事件（通过你发送的 `id` 匹配），并用 **Update Incident** 将其移至已解决状态。

## 故障排查

- **没有运行记录出现**——确认监控器消息中包含 `@webhook-oneuptime`，以及工作流已 **Enabled**。
- **字段为空**——Datadog 只会替换适用于该事件的模板变量。在 **Logs** 标签中检查触发器输出，并调整你的 webhook 负载。
- **重复事件**——重新告警（renotify）的监控器会发送多个 `Triggered` 事件；在创建之前用 **Find Incident** 检查 `id` 来去重。

## 接下来读什么

- [集成概览](/docs/integrations/index)——入站模式。
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) 和 [Grafana](/docs/integrations/grafana)——其他入站来源。
- [Webhook 触发器](/docs/workflows/triggers#webhook)——接收 URL 的工作原理。
