# Prometheus Alertmanager 集成

把 [Prometheus Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/) 的通知变成 OneUptime 事件。Prometheus 评估你的告警规则，Alertmanager 负责路由，OneUptime 负责记录并升级。

这个集成是 **入站** 的，有两种构建方式：

| 方式                                                                 | 适用场景                                                                                       |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **[传入请求监控器](/docs/monitor/incoming-request-monitor)**（推荐） | 你希望告警变成带值班升级的事件，每条告警一个事件，并在恢复时自动解决。没有自定义逻辑需要维护。 |
| **[工作流](/docs/workflows/index) 配 Webhook 触发器**                | 你需要 OneUptime 原生不提供的路由逻辑——调用其他系统、改造负载、条件分支。                      |

```text
Prometheus rule fires  ──►  Alertmanager webhook receiver  ──►  OneUptime  ──►  Incident + on-call
```

## 前提条件

- 一套你可以编辑 `alertmanager.yml` 的 Prometheus + Alertmanager 环境。
- Alertmanager 必须能通过 HTTPS 访问到你的 OneUptime 实例。
- 一个你可以创建监控器（或工作流）的 OneUptime 项目。

## 方案 1 —— 传入请求监控器

### 步骤 1 —— 创建监控器

1. 进入 **监控器 → 创建监控器**，选择 **传入请求**。
2. 打开该监控器，点击左侧菜单中的 **Documentation**。复制 URL：

   ```
   https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
   ```

   自托管时请使用你自己的主机。路径中的密钥是唯一的凭据。

### 步骤 2 —— 让 Alertmanager 指向它

在 `alertmanager.yml` 中：

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/YOUR_SECRET_KEY"
        send_resolved: true

route:
  receiver: oneuptime
  group_by: ["alertname", "instance"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
```

`send_resolved: true` 是必需的——正是它告诉 OneUptime 某条告警已经恢复。用 `curl -X POST http://localhost:9093/-/reload` 重新加载 Alertmanager，或者重启它。

Alertmanager 会发送 `Content-Type: application/json`，OneUptime 需要它才能从负载中读取字段。

### 步骤 3 —— 配置条件

打开监控器的 **Criteria**，编辑第一个条件。

**过滤器**

- **Filter Type**：`JavaScript Expression`
- **Filter Condition**：`Evaluates To True`
- **Value**：`"{{requestBody.status}}" === "firing"`

  占位符两侧的引号是字符串比较所必需的。如果你不想用表达式，`Request Body` / `Contains` / `"status":"firing"` 的过滤器同样可行。

**动作**

- 打开 _When filters match, change monitor status_，设为 **Offline**（或 Degraded）。
- 打开 _When filters match, declare an incident_。设置 **Title**、**Severity** 以及需要呼叫的 **On-Call Policies**。
- 在该事件的 **Advanced Options** 下打开 **Auto Resolve Incident**。否则恢复通知会被忽略，事件将永远处于打开状态。

**Settings → Group incidents and alerts by a payload field**

打开它，这样同一个端点就能同时保持多个事件——每条告警一个——而不是每次通知只有一个事件。

| 字段                               | 值                                  |
| ---------------------------------- | ----------------------------------- |
| Open a separate incident for each… | `requestBody.alerts[*].fingerprint` |
| Field that signals recovery        | `requestBody.alerts[*].status`      |
| Value that means recovered         | `resolved`                          |
| Max incidents per request          | `100`                               |

`[*]` 会在 Alertmanager 的 `alerts` 数组上展开，为每个 **不同的** 提取值创建一个事件。因为两个路径都用了 `[*]`，恢复是按告警逐条判断的：在一条已解决、两条仍在触发的负载中，只有已解决的那条会被关闭。

> **Warning:** 请按每条告警真正唯一的字段来分组。Alertmanager 的 `fingerprint` 是告警完整标签集的哈希，因此它总是唯一的。标签只有在一次通知 **内部** 发生变化时才可用——而任何列在路由 `group_by` 中的标签永远不会变化，因为正是它定义了聚合分组。在上面的 `group_by: ["alertname", "instance"]` 下，按 `requestBody.alerts[*].labels.alertname` 分组会从负载中的每条告警提取出相同的值，于是它们全部合并成一个事件。更糟的是，重复的值只保留 **第一次** 出现，因此如果负载中第一条告警是 `resolved`，就会在其余告警仍在触发时把该事件关闭。

### 步骤 4 —— 编写事件标题和描述

分组键会以路径最后一段命名的变量提供，因此 `requestBody.alerts[*].fingerprint` 给你的是 `{{fingerprint}}`。它是一个哈希，不适合展示给响应人员——请改用整个通知共享的标签来拟定事件标题。`commonLabels` 承载路由 `group_by` 中的每个标签，因此在上面的配置下 `alertname` 和 `instance` 都可用：

- **Title**：`{{requestBody.commonLabels.alertname}} on {{requestBody.commonLabels.instance}}`
- **Description**：

  ```
  {{requestBody.commonAnnotations.summary}}

  {{requestBody.commonAnnotations.description}}
  Severity: {{requestBody.commonLabels.severity}}
  Alertmanager: {{requestBody.externalURL}}
  ```

`commonLabels` 和 `commonAnnotations` 保存的是整个通知共享的字段。像 `requestBody.alerts[0].annotations.summary` 这样的单条告警路径始终读取负载中的 _第一_ 条告警，而不是这个事件所对应的那一条——所以如果你希望每个事件带上各自的注解文本，就要把 `group_by` 收得更紧。无法解析的路径会连同花括号原样输出，而不是留空。完整变量列表见 [事件与告警动态模板](/docs/monitor/incident-alert-templating)。

### 步骤 5 —— 把监控器恢复为 Operational（可选）

条件只在匹配时才起作用，因此请添加第二个条件，避免一切平息后监控器仍停留在 Offline：

- **Filter Type**：`JavaScript Expression`，**Value**：`"{{requestBody.status}}" === "resolved"`
- _Change monitor status to_ **Operational**，并且不创建任何事件。

### 步骤 6 —— 测试

```bash
curl -X POST https://oneuptime.com/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{
    "version": "4",
    "status": "firing",
    "commonLabels": { "alertname": "HighCPU", "severity": "critical" },
    "commonAnnotations": { "summary": "CPU above 90% for 5m" },
    "externalURL": "http://alertmanager:9093",
    "alerts": [
      {
        "status": "firing",
        "labels": { "alertname": "HighCPU", "instance": "web-1" },
        "fingerprint": "a1b2c3d4e5f60001"
      },
      {
        "status": "firing",
        "labels": { "alertname": "HighCPU", "instance": "web-2" },
        "fingerprint": "a1b2c3d4e5f60002"
      }
    ]
  }'
```

你应该得到两个事件——每个 `fingerprint` 一个。把两条告警的 `status` 都改为 `resolved` 再发一次，两个事件都应该关闭。

你也可以用 `amtool` 触发一条真实告警：

```bash
amtool alert add test_alert severity=warning \
  --annotation=summary="Test from Alertmanager" \
  --alertmanager.url=http://localhost:9093
```

## 方案 2 —— 工作流

当你需要超出「告警变成事件」的逻辑时使用它。

1. 打开 **工作流 → 创建工作流**，命名为 `Alertmanager → Incidents`，并打开 **生成器**。
2. 添加 **Webhook** 触发器并**复制其 URL**。将模块重命名为 `Alertmanager`。
3. 添加连接到触发器的 **条件** 模块：
   - **Left**：`{{Alertmanager.Request Body.status}}`
   - **Operator**：`==`
   - **Right**：`firing`
4. 从 **是** 出发，添加 **创建事件** 模块：
   - **标题**：`{{Alertmanager.Request Body.commonAnnotations.summary}}`
   - **描述**：`{{Alertmanager.Request Body.commonAnnotations.description}}\nAlert: {{Alertmanager.Request Body.commonLabels.alertname}}`
   - **严重程度**：选择一个（或先对 `{{Alertmanager.Request Body.commonLabels.severity}}` 进行分支）。
5. **保存**，然后把上面步骤 2 中 `webhook_configs` 的 URL 改指向该工作流的 URL。

若要每条告警一个事件，添加一个 [Custom Code](/docs/workflows/components#custom-code) 模块，循环遍历 `Request Body.alerts`。配合 `send_resolved: true`，再添加第二条基于 `status == resolved` 的 **条件** 分支，找到对应事件并用 **Update Incident** 将其移到你的已解决状态。

## 死人开关

两种方案都无法告诉你 Prometheus 自身何时停止工作——没有告警到达，看起来和一切正常一模一样。通常的做法是设置一条始终触发的告警，把它路由到一个按计划等待它的监控器。[kube-prometheus-stack](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack) 自带一条名为 `Watchdog` 的规则；在纯 Prometheus 上，添加一条表达式恒为真的告警规则（`vector(1)`）。

再创建 **第二个** 传入请求监控器，用较短的 `repeat_interval` 把 `Watchdog` 路由到它，并给该监控器设置 **Filter Type: Incoming Request** / **Filter Condition: Not Recieved In Minutes** 条件。这是「请求缺失」条件唯一适合放在告警接收器上的场景。

下面是步骤 2 的配置，加入了 watchdog 的路由与接收器——子路由会在父路由自身的接收器之前匹配，因此 `Watchdog` 会走向第二个监控器，其余仍然进入第一个：

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/YOUR_SECRET_KEY"
        send_resolved: true

  - name: oneuptime-watchdog
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/WATCHDOG_SECRET_KEY"

route:
  receiver: oneuptime
  group_by: ["alertname", "instance"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - receiver: oneuptime-watchdog
      matchers:
        - alertname = "Watchdog"
      group_wait: 0s
      group_interval: 5m
      repeat_interval: 5m
```

## 故障排查

- **什么都没收到** —— 确认 Alertmanager 能访问该 URL；检查它的日志有无投递错误。OneUptime 会在做任何校验之前就用空的 `200` 回应每个请求，所以 `200` 并不能确认负载被接受。请改看监控器的时间线。
- **事件能打开但从不关闭** —— 检查 Alertmanager 中的 `send_resolved: true`、条件里的恢复字段与取值（比较区分大小写），以及事件 **Advanced Options** 下的 **Auto Resolve Incident**。还有两个更隐蔽的原因：当负载中不同键的数量超过 **Max incidents per request** 时，超出上限的键对恢复同样不可见；另外，如果被入口合并（见下）丢弃的恰好是 `resolved` 通知，该事件就会被永久搁置，因为 Alertmanager 会重复发送触发通知，却不会重复发送恢复通知。这些只能手动关闭。
- **完全没有事件，监控器状态也没变** —— 分组路径必须以字面量 `requestBody.` 开头，且路径中只有第一个 `[*]` 是通配符。这两个错误都会静默失败。
- **事件文本中显示原始的 `{{...}}` 占位符** —— 路径没有解析成功，而 OneUptime 会原样保留未解析的占位符，而不是清空它们。不同规则设置的注解不同，所以请引用你的规则中确实存在的字段（`commonAnnotations` 还是每条告警各自的 `annotations`）。
- **一份满是告警的负载只产生一个事件** —— 你按一个在通知内部不变的标签做了分组，通常正是路由 `group_by` 中的那个标签。请改用 `requestBody.alerts[*].fingerprint` 分组。
- **事件太多** —— 放宽 `group_by` / `group_interval`，让 Alertmanager 把相关告警合并。调低 **Max incidents per request** 能限制数量，但也会让超出上限的键对恢复不可见。
- **在密集突发时似乎有些通知被跳过** —— 发往同一监控器的请求会在入口处合并，以免单个发送方压垮监控器，因此当通知接连到达时可能会丢弃中间的某次负载。增大 `group_wait` 和 `group_interval` 可以把它们拉开。合并由应用容器的环境变量 `INCOMING_REQUEST_INGEST_COALESCE_ENABLED` 控制，默认开启；需要每次负载都被评估的自托管运维人员，可以在该容器上把它设为 `false`。

## 接下来读什么

- [传入请求监控器](/docs/monitor/incoming-request-monitor) —— 该监控器类型、它的条件以及完整的事件分组说明。
- [集成概述](/docs/integrations/index) —— 入站与出站模式。
- [Grafana](/docs/integrations/grafana) —— 同样的思路，用于 Grafana 告警。
- [Webhook 触发器](/docs/workflows/triggers#webhook) —— 工作流接收 URL 的工作原理。
