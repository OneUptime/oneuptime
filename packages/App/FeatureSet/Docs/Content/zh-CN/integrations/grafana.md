# Grafana 集成

把 [Grafana](https://grafana.com) 的告警变成 OneUptime 事件。Grafana 评估你仪表板上的告警规则；OneUptime 负责记录、升级和跟踪。

这个集成是 **入站** 的：Grafana 的 **Webhook 联系人** 向 OneUptime 发送 POST。有两种接收方式。

| 方式                                                                 | 适用场景                                                                  |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **[传入请求监控器](/docs/monitor/incoming-request-monitor)**（推荐） | 你希望告警变成带值班升级的事件，每条告警一个事件，并在恢复时自动解决。    |
| **[工作流](/docs/workflows/index) 配 Webhook 触发器**                | 你需要 OneUptime 原生不提供的路由逻辑——调用其他系统、改造负载、条件分支。 |

```text
Grafana alert rule fires  ──►  Webhook contact point  ──►  OneUptime  ──►  Incident + on-call
```

Grafana 的 webhook 负载遵循 Alertmanager 的格式——`status`、一个 `alerts` 数组、`commonLabels` 和 `commonAnnotations`，以及便捷的顶层 `title` 和 `message` 字段。

## 前提条件

- 启用了 [unified alerting](https://grafana.com/docs/grafana/latest/alerting/) 的 Grafana 9+（现代 Grafana 的默认设置）。
- Grafana 必须能通过 HTTPS 访问到你的 OneUptime 实例。
- 一个你可以创建监控器（或工作流）的 OneUptime 项目。

## 方案 1 —— 传入请求监控器

1. 进入 **监控器 → 创建监控器**，选择 **传入请求**。打开它，点击左侧菜单中的 **Documentation** 复制 URL。
2. 打开监控器的 **Criteria**，把 **Filter Type** 设为 `JavaScript Expression`，**Value** 设为 `"{{requestBody.status}}" === "firing"`。
3. 匹配时创建事件，选择要呼叫的 **On-Call Policies**，并在 **Advanced Options** 下打开 **Auto Resolve Incident**。
4. 在 **Settings** 下打开 **Group incidents and alerts by a payload field**，并设置：

   | 字段                               | 值                                  |
   | ---------------------------------- | ----------------------------------- |
   | Open a separate incident for each… | `requestBody.alerts[*].fingerprint` |
   | Field that signals recovery        | `requestBody.alerts[*].status`      |
   | Value that means recovered         | `resolved`                          |

5. 把事件标题设为 `{{requestBody.commonLabels.alertname}}`，描述使用 `{{requestBody.message}}` 或 `{{requestBody.commonAnnotations.summary}}`。（`{{fingerprint}}` 保存的是分组键本身，但它是一个哈希——不适合展示给响应人员。）
6. 把 Grafana 联系人指向该监控器的 URL（见下面的联系人配置步骤）。

每个 **不同的** 分组值都会成为独立的事件，并在 Grafana 报告其已解决时各自关闭。Grafana 每条告警的 `fingerprint` 对于告警的标签集是唯一的，这就是上面用它作为分组路径的原因。[Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) 页面对同样的配置讲得更详细——负载格式相同，因此那里的每一步在这里同样适用。

> **Warning:** 不要按在整个通知中保持不变的标签分组。Grafana 默认的通知策略按 `grafana_folder` 和 `alertname` 分组，因此同一个 webhook 中的每条告警都共用相同的 alertname——按 `requestBody.alerts[*].labels.alertname` 分组会把整份负载压缩成一个事件。分组路径还必须以字面量 `requestBody.` 开头，且路径中只有第一个 `[*]` 是通配符。这些错误全都会静默失败。

## 方案 2 —— 工作流

当你需要超出「告警变成事件」的逻辑时使用它。

### 步骤 1 —— 构建 OneUptime 工作流

1. 打开 **工作流 → 创建工作流**，命名为 `Grafana → Incidents`，并打开 **生成器**。
2. 添加 **Webhook** 触发器并**复制其 URL**。将模块重命名为 `Grafana`。
3. 添加连接到触发器的 **条件** 模块：
   - **Left**：`{{Grafana.Request Body.status}}`
   - **Operator**：`==`
   - **Right**：`firing`
4. 从 **是** 出发，添加 **创建事件** 模块：
   - **标题**：`{{Grafana.Request Body.title}}`
   - **描述**：`{{Grafana.Request Body.message}}`
   - **严重程度**：选择一个（或对 `{{Grafana.Request Body.commonLabels.severity}}` 进行分支）。
5. **保存**（测试前保持禁用状态）。

## 配置 Grafana 联系人

1. 在 Grafana 中，前往 **Alerting → Contact points → Add contact point**。
2. **Name**：`OneUptime`。**Integration**：**Webhook**。
3. **URL**：粘贴方案 1 中的监控器 URL，或方案 2 中工作流的 webhook URL。**HTTP Method**：`POST`。
4. 保存该联系人。
5. 前往 **Alerting → Notification policies**，把你想要的告警（或默认策略）路由到 **OneUptime** 联系人。

## 测试

1. 如果你构建了工作流，请先启用它。
2. 在联系人页面用 **Test** 发送一条示例通知，或者等待真实的告警规则触发。
3. 查看你的 **事件** 列表——如果使用了方案 2，还可以查看工作流的 **日志** 标签页。

## 恢复时解决

当告警消除时，Grafana 会再发送一条带 `status: resolved` 的通知。

在 **方案 1** 中，上面配置的恢复字段和取值会自动关闭对应的事件——前提是 **Auto Resolve Incident** 已打开。

在 **方案 2** 中，添加第二条 **条件** 分支（`status == resolved`），找到对应事件，并用 **Update Incident** 将其移到你的已解决状态。

## 说明

- **旧版告警（Grafana 8 及更早）** 发送的负载不同（`ruleName`、`state`、`evalMatches`）。如果你在使用旧版告警，请改为引用 `{{Grafana.Request Body.ruleName}}` 和 `{{Grafana.Request Body.state}}`，并按 `state == alerting` 分支。
- 你也可以完全绕过 Grafana 的告警功能，让 OneUptime 直接监控同样的指标——参见 [指标监控器](/docs/monitor/metrics-monitor)。

## 故障排查

- **什么都没收到** —— 确认 Grafana 能访问该 URL（检查 Grafana 的服务器日志），若使用方案 2 还要确认工作流处于 **已启用** 状态。OneUptime 会在校验之前就用空的 `200` 回应每个传入请求，因此 Grafana 日志中的 `200` 并不能确认负载被接受。
- **事件能打开但从不关闭** —— 检查条件中的恢复字段与取值，以及事件 **Advanced Options** 下的 **Auto Resolve Incident** 是否打开。比较是区分大小写的。
- **一份满是告警的负载只产生一个事件** —— 你按一个在通知内部不变的标签做了分组。请改用 `requestBody.alerts[*].fingerprint` 分组。
- **事件文本中显示原始的 `{{...}}` 占位符** —— 路径没有解析成功，未解析的占位符会被原样保留而不是清空。请引用你所用告警版本中确实存在的字段；若使用了方案 2，可在 **日志** 标签页查看触发器的输出。

## 接下来读什么

- [传入请求监控器](/docs/monitor/incoming-request-monitor) —— 该监控器类型、它的条件以及完整的事件分组说明。
- [集成概述](/docs/integrations/index) —— 入站模式。
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) —— 高度相关的负载。
- [指标监控器](/docs/monitor/metrics-monitor) —— 在 OneUptime 中直接监控指标。
