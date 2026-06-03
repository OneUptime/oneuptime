# Zabbix 集成

[Zabbix](https://www.zabbix.com) 监控你的服务器和网络；OneUptime 负责事件响应、值班和状态页。将两者连接起来，每个 Zabbix 问题都会自动成为 OneUptime 事件——让合适的人收到告警，状态页保持实时准确。

此集成为**入站**模式：Zabbix 向 OneUptime 发送问题。一侧使用 Zabbix **webhook 媒体类型**，另一侧使用 OneUptime **[工作流](/docs/workflows/index)**。无需插件，无需额外服务。

```text
Zabbix trigger fires  ──►  Webhook media type  ──►  OneUptime Workflow (Webhook trigger)  ──►  Create Incident
```

## 工作原理

1. Zabbix 触发器变为 **PROBLEM** 状态。
2. Zabbix **动作**通知 **OneUptime** 媒体类型发送事件。
3. 媒体类型的脚本将一小段 JSON 负载 POST 到 OneUptime 工作流 URL。
4. 工作流读取负载并创建事件（可选地，在 Zabbix 恢复时解决事件）。

## 前提条件

- 一台你管理的 Zabbix 服务器（本指南针对 **Zabbix 6.0 LTS / 7.0 LTS**；webhook 媒体类型在 5.0+ 上同样有效）。
- 你的 Zabbix 服务器必须能通过 HTTPS 访问你的 OneUptime 实例。
- 一个可以创建工作流的 OneUptime 项目。

## 第一部分——构建 OneUptime 工作流

先完成这一步，因为你需要它生成的 webhook URL。

1. 打开 **Workflows → Create Workflow**，命名为 `Zabbix → Incidents`，并打开 **Builder** 标签。
2. 将 **Webhook** 触发器拖到画布上。点击它并**复制其显示的唯一 URL**。请妥善保管——任何拥有它的人都可以启动工作流。将该模块重命名为 `Zabbix`，以便变量读取更清晰。
3. 将 **Conditions** 模块拖到画布上，并将触发器的输出连接到它。配置：
   - **Left value**：`{{Zabbix.Request Body.status}}`
   - **Operator**：`==`
   - **Right value**：`1`  *（Zabbix 发送 `1` 表示问题，`0` 表示恢复）*
4. 拖入 **Create Incident** 模块并连接到 Conditions 模块的 **Yes** 输出。填写：
   - **Title**：`Zabbix: {{Zabbix.Request Body.name}}`
   - **Description**：`Host: {{Zabbix.Request Body.host}}\nSeverity: {{Zabbix.Request Body.severity}}\nZabbix event: {{Zabbix.Request Body.event_id}}`
   - **Severity**：选择你想要的 OneUptime 事件严重程度（之后可以通过更多 Conditions 分支来映射 Zabbix 严重程度）。
5. 保存。暂时将 **Enabled** 保持*关闭*——测试后再开启。

> **提示：** 在描述（或事件标签）中放入 Zabbix `event_id`，可以让你在 Zabbix 恢复时再次找到该事件。参见[自动解决（可选）](#自动解决可选)。

## 第二部分——配置 Zabbix

### 步骤 1：创建 OneUptime 媒体类型

1. 在 Zabbix 中，前往 **Alerts → Media types**（较旧版本：**Administration → Media types**）。
2. 点击 **Create media type**，将 **Type** 设置为 **Webhook**。
3. **Name**：`OneUptime`。
4. 添加以下**参数**（每个点击 *Add*）。这些将 Zabbix [宏](https://www.zabbix.com/documentation/current/en/manual/appendix/macros/supported_by_location)映射到一个干净的负载中：

   | 名称 | 值 |
   | --- | --- |
   | `url` | `{ALERT.SENDTO}` |
   | `event_id` | `{EVENT.ID}` |
   | `event_name` | `{EVENT.NAME}` |
   | `event_value` | `{EVENT.VALUE}` |
   | `event_severity` | `{EVENT.SEVERITY}` |
   | `host` | `{HOST.NAME}` |
   | `event_date` | `{EVENT.DATE}` |
   | `event_time` | `{EVENT.TIME}` |

5. 将以下内容粘贴到 **Script** 字段中：

   ```javascript
   var params = JSON.parse(value);
   var request = new HttpRequest();
   request.addHeader('Content-Type: application/json');

   var payload = {
     source: 'zabbix',
     event_id: params.event_id,
     name: params.event_name,
     host: params.host,
     severity: params.event_severity,
     // "1" = problem, "0" = recovered. OneUptime reads this in a Conditions block.
     status: params.event_value,
     date: params.event_date,
     time: params.event_time
   };

   var response = request.post(params.url, JSON.stringify(payload));

   if (request.getStatus() < 200 || request.getStatus() >= 300) {
     throw 'OneUptime responded with HTTP ' + request.getStatus() + ': ' + response;
   }

   return 'OK';
   ```

6. 点击 **Message templates** 标签，为 **Problem** 和 **Problem recovery** 各添加一个模板（正文可以为空——负载在脚本中构建）。这是 Zabbix 针对这些事件类型使用该媒体类型的必要条件。
7. 点击 **Add** 保存媒体类型。

### 步骤 2：创建承载 webhook 的用户

Zabbix 将通知发送*给一个用户*。创建一个专用用户，便于查找和停用集成。

1. 前往 **Users → Users → Create user**，命名为 `OneUptime Webhook`，赋予其可以接收通知的角色（例如 **User role**），并将其加入用户组。
2. 在 **Media** 标签上，点击 **Add**：
   - **Type**：`OneUptime`
   - **Send to**：粘贴你在第一部分复制的**工作流 webhook URL**。
   - **When active** / 严重程度：保持默认（或限制为你关心的严重程度）。
3. 点击 **Add** 然后 **Update**。

### 步骤 3：通过动作将问题发送到 OneUptime

1. 前往 **Alerts → Actions → Trigger actions → Create action**。
2. **Name**：`Notify OneUptime`。
3. **Conditions**（可选）：缩小范围——例如，*触发器严重程度 >= Warning*。留空则发送所有内容。
4. 在 **Operations** 标签上，添加一个操作，通过 **OneUptime** 媒体类型发送给 **User: OneUptime Webhook**。
5. 若要在之后恢复时解决事件，在 **Recovery operations** 中也填入相同的用户/媒体。
6. 点击 **Add** 保存，并确保动作处于 **Enabled** 状态。

## 第三部分——测试

1. 回到 OneUptime 工作流，开启 **Enabled**。
2. 在 Zabbix 中触发一个测试问题——例如，临时降低触发器阈值，或使用翻转为问题状态的测试监控项。
3. 打开工作流的 **Logs** 标签。你应该看到一次包含 Zabbix 负载的运行，Conditions 模块走 **Yes** 路径，并创建了事件。
4. 在 OneUptime 中检查**事件**——你的 Zabbix 问题现在已成为一个事件。

如果没有收到任何内容，参见[故障排查](#故障排查)。

## 自动解决（可选）

上面的核心工作流只*创建*事件。要在 Zabbix 恢复时*关闭*事件：

1. 确保你的 Zabbix 动作已配置 **Recovery operations**（上面的步骤 3），以便也发送恢复事件。恢复时，`status` 值为 `0`。
2. 在工作流中，添加第二个 **Conditions** 分支：左侧 `{{Zabbix.Request Body.status}}`，运算符 `==`，右侧 `0`。
3. 从其 **Yes** 输出，添加一个 **Find Incident** 模块，查找你之前创建的未解决事件——通过描述或标签中存储的 Zabbix `event_id` 来匹配。
4. 将其连接到 **Update Incident** 模块，并将事件移至你的*已解决*状态。

由于解决方式取决于你在项目中如何建模事件状态，请先确保事件正确流转后再添加解决路径。参见[组件 → OneUptime 数据组件](/docs/workflows/components#oneuptime-data-components)。

## 映射 Zabbix 严重程度（可选）

Zabbix 严重程度（`Not classified`、`Information`、`Warning`、`Average`、`High`、`Disaster`）以 `{{Zabbix.Request Body.severity}}` 形式传入。要将它们映射到 OneUptime 事件严重程度，在 **Create Incident** 之前添加 **Conditions** 分支——例如，将 `Disaster` 和 `High` 路由到"Critical"事件，将其他所有内容路由到"Major"。每个分支各建一个 **Create Incident** 模块。

## 故障排查

**工作流从未运行。**
- 确认工作流的 **Enabled** 开关已开启。
- 从 Zabbix 服务器确认能访问该 URL：`curl -i -X POST <workflow-url> -d '{}' -H 'Content-Type: application/json'`。你应该很快收到确认响应。
- 在 Zabbix 中检查 **Reports → Action log** 是否有投递错误。

**Zabbix 报告脚本错误。**
- 打开媒体类型，使用 **Test** 发送一个示例负载。Zabbix 会显示脚本的输出或抛出的错误。
- OneUptime 返回非 2xx 响应时会被脚本中的 `throw` 捕获——检查工作流 URL 是否完全正确。

**事件已创建但字段为空。**
- 打开工作流的 **Logs** 标签并检查触发器输出。确认 **Request Body** 下的字段名与你引用的字段（`name`、`host`、`severity`、`status`、`event_id`）一致。
- 缺失的字段会解析为空字符串而不是错误——参见[变量 → 注意事项](/docs/workflows/variables#gotchas)。

**所有内容触发了两次。**
- 你可能同时有一个问题操作和一个升级步骤发送给同一媒体。检查动作的 **Operations** 步骤。

## 安全注意事项

- 像对待密码一样对待工作流 webhook URL。如果泄露，请删除触发器并新建一个来轮换 URL。
- 限制 Zabbix 动作的条件，只转发需要创建事件的严重程度。
- 如果你在防火墙后自托管 OneUptime，允许你的 Zabbix 服务器的出口 IP 通过 HTTPS 访问它。

## 接下来读什么

- [集成概览](/docs/integrations/index)——入站/出站模式。
- [Webhook 触发器](/docs/workflows/triggers#webhook)——接收 URL 的工作原理。
- [组件](/docs/workflows/components)——Conditions、Create Incident 等。
- [变量](/docs/workflows/variables)——在后续模块中读取 Zabbix 负载。
