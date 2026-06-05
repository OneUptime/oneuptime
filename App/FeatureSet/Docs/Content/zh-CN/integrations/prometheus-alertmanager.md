# Prometheus Alertmanager 集成

将 [Prometheus Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/) 通知转化为 OneUptime 事件。Prometheus 评估你的告警规则，Alertmanager 路由它们，OneUptime 记录并升级它们。

此集成为**入站**模式：Alertmanager POST 到以 **Webhook 触发器**开始的 OneUptime **[工作流](/docs/workflows/index)**。

```text
Prometheus rule fires  ──►  Alertmanager webhook receiver  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## 前提条件

- 一个你可以编辑 `alertmanager.yml` 的 Prometheus + Alertmanager 环境。
- Alertmanager 必须能通过 HTTPS 访问你的 OneUptime 实例。
- 一个可以创建工作流的 OneUptime 项目。

## 步骤 1——构建 OneUptime 工作流

1. 打开 **Workflows → Create Workflow**，命名为 `Alertmanager → Incidents`，并打开 **Builder**。
2. 添加 **Webhook** 触发器并**复制其 URL**。将模块重命名为 `Alertmanager`。
3. 添加连接到触发器的 **Conditions** 模块：
   - **Left**：`{{Alertmanager.Request Body.status}}`
   - **Operator**：`==`
   - **Right**：`firing`
4. 从 **Yes** 出发，添加 **Create Incident** 模块：
   - **Title**：`{{Alertmanager.Request Body.commonAnnotations.summary}}`
   - **Description**：`{{Alertmanager.Request Body.commonAnnotations.description}}\nAlert: {{Alertmanager.Request Body.commonLabels.alertname}}`
   - **Severity**：选择一个（或先对 `{{Alertmanager.Request Body.commonLabels.severity}}` 进行分支）。
5. **保存**（测试前保持禁用状态）。

> **关于分组告警。** Alertmanager 对告警进行分组，并发送一个 `alerts` **数组**。上面的 `commonLabels` 和 `commonAnnotations` 是该组中所有告警共有的字段——非常适合每次通知创建一个事件。如果你想**每个告警创建一个事件**，添加一个[Custom Code](/docs/workflows/components#custom-code)模块，循环遍历 `Request Body.alerts` 并为每个创建一个事件。通过路由中的 `group_by` 调整分组。

## 步骤 2——配置 Alertmanager

添加一个指向工作流 URL 的 webhook 接收器，并将告警路由到它。在 `alertmanager.yml` 中：

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://<your-workflow-webhook-url>"
        send_resolved: true

route:
  receiver: oneuptime
  group_by: ["alertname"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 3h
```

重新加载 Alertmanager（`curl -X POST http://localhost:9093/-/reload` 或重启它）。

## 步骤 3——测试

1. 启用工作流。
2. 触发一个测试告警——例如，使用 `amtool`：

   ```bash
   amtool alert add test_alert severity=warning --annotation=summary="Test from Alertmanager" --alertmanager.url=http://localhost:9093
   ```

3. 检查工作流的 **Logs** 标签和你的**事件**列表。

## 恢复时解决（可选）

设置 `send_resolved: true` 后，Alertmanager 在告警清除时也会 POST，此时 `status: resolved`。添加第二个 **Conditions** 分支（`status == resolved`），找到匹配的事件（通过 `commonLabels.alertname` 匹配），并用 **Update Incident** 将其移至已解决状态。

## 故障排查

- **没有运行记录出现**——确认 Alertmanager 可以访问该 URL（检查其日志中的投递错误），以及工作流已 **Enabled**。
- **事件字段为空**——不同的规则设置了不同的注解。在 **Logs** 标签中检查触发器输出，引用实际存在的字段（`commonAnnotations` 与每个告警的 `annotations`）。
- **事件过多**——增大 `group_by`/`group_interval`，让 Alertmanager 批量合并相关告警。

## 接下来读什么

- [集成概览](/docs/integrations/index)——入站模式。
- [Grafana](/docs/integrations/grafana)——相同思路，Grafana 告警。
- [Webhook 触发器](/docs/workflows/triggers#webhook)——接收 URL 的工作原理。
