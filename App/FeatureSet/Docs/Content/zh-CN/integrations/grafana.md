# Grafana 集成

将 [Grafana](https://grafana.com) 告警转化为 OneUptime 事件。Grafana 评估仪表盘上的告警规则；OneUptime 记录、升级并追踪它们。

此集成为**入站**模式：Grafana 的告警通过 Grafana **Webhook 联系人**向以 **Webhook 触发器**开始的 OneUptime **[工作流](/docs/workflows/index)**发送。

```text
Grafana alert rule fires  ──►  Webhook contact point  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## 前提条件

- Grafana 9+，并已启用[统一告警](https://grafana.com/docs/grafana/latest/alerting/)（现代 Grafana 的默认设置）。
- Grafana 必须能通过 HTTPS 访问你的 OneUptime 实例。
- 一个可以创建工作流的 OneUptime 项目。

## 步骤 1——构建 OneUptime 工作流

1. 打开 **Workflows → Create Workflow**，命名为 `Grafana → Incidents`，并打开 **Builder**。
2. 添加 **Webhook** 触发器并**复制其 URL**。将模块重命名为 `Grafana`。
3. 添加连接到触发器的 **Conditions** 模块：
   - **Left**：`{{Grafana.Request Body.status}}`
   - **Operator**：`==`
   - **Right**：`firing`
4. 从 **Yes** 出发，添加 **Create Incident** 模块：
   - **Title**：`{{Grafana.Request Body.title}}`
   - **Description**：`{{Grafana.Request Body.message}}`
   - **Severity**：选择一个（或对 `{{Grafana.Request Body.commonLabels.severity}}` 进行分支）。
5. **保存**（测试前保持禁用状态）。

Grafana 的 webhook 负载遵循 Alertmanager 的格式——包含 `status`、一个 `alerts` 数组、`commonLabels` 和 `commonAnnotations`，以及便捷的顶层 `title` 和 `message` 字段。

## 步骤 2——配置 Grafana 联系人

1. 在 Grafana 中，前往 **Alerting → Contact points → Add contact point**。
2. **Name**：`OneUptime`。**Integration**：**Webhook**。
3. **URL**：粘贴你工作流的 webhook URL。**HTTP Method**：`POST`。
4. 保存联系人。
5. 前往 **Alerting → Notification policies**，将你想要的告警（或默认策略）路由到 **OneUptime** 联系人。

## 步骤 3——测试

1. 启用工作流。
2. 在联系人界面使用 **Test** 发送一个示例通知，或让真实的告警规则触发。
3. 检查工作流的 **Logs** 标签和你的**事件**列表。

## 恢复时解决（可选）

当告警清除时，Grafana 会发送另一个 `status: resolved` 的通知。添加第二个 **Conditions** 分支（`status == resolved`），找到匹配的事件，并用 **Update Incident** 将其移至已解决状态。

## 注意事项

- **旧版告警（Grafana 8 及更早版本）**发送不同的负载（`ruleName`、`state`、`evalMatches`）。如果你使用旧版告警，请改用 `{{Grafana.Request Body.ruleName}}` 和 `{{Grafana.Request Body.state}}`，并对 `state == alerting` 进行分支。
- 你也可以完全跳过 Grafana 的告警，让 OneUptime 直接监控相同的指标——参见[指标监控器](/docs/monitor/metrics-monitor)。

## 故障排查

- **没有运行记录出现**——确认 Grafana 可以访问该 URL（检查 Grafana 的服务器日志），以及工作流已 **Enabled**。
- **字段为空**——在 **Logs** 标签中检查触发器输出；引用适合你告警版本的实际存在字段。

## 接下来读什么

- [集成概览](/docs/integrations/index)——入站模式。
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager)——密切相关的负载格式。
- [指标监控器](/docs/monitor/metrics-monitor)——直接在 OneUptime 中监控指标。
