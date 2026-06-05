# Discord 集成

向 [Discord](https://discord.com) 频道发布事件更新。OneUptime 内置了 **Discord** 工作流组件，因此这是最快速的集成之一。

此集成为**出站**模式：OneUptime 通过入站 webhook URL 向 Discord 频道发送消息。

```text
OneUptime Incident → On Create  ──►  Discord component  ──►  message in your channel
```

## 步骤 1——创建 Discord webhook

1. 在 Discord 中，打开目标频道的 **Edit Channel → Integrations → Webhooks**。
2. 点击 **New Webhook**，给它一个名称（例如 `OneUptime`），选择频道，并**复制 Webhook URL**。

## 步骤 2——存储 webhook URL（可选但推荐）

1. 在 OneUptime 中，前往 **Workflows → Global Variables → Create**。
2. 命名为 `DISCORD_WEBHOOK_URL`，粘贴 URL，并开启 **Is Secret**。

将其存储在变量中，便于在多个工作流中复用，并在一个地方进行轮换。

## 步骤 3——构建工作流

1. 打开 **Workflows → Create Workflow**，命名为 `Incidents → Discord`，并打开 **Builder**。
2. 添加 **Incident** 触发器，设置为 **On Create**。重命名为 `Incident`。
3. 添加连接到触发器的 **Discord** 组件：
   - **Webhook URL**：`{{variable.DISCORD_WEBHOOK_URL}}`（或直接粘贴）。
   - **Message**：`🔴 New incident: {{Incident.title}}\n{{Incident.description}}`
4. **保存**，启用，并创建一个测试事件。消息会出现在你的频道中。

## 替代方案：API 组件

如果你不想使用专用组件，**API** 模块可以完成同样的事情：

- **Method**：`POST`
- **URL**：`{{variable.DISCORD_WEBHOOK_URL}}`
- **Headers**：`Content-Type: application/json`
- **Body**：`{ "content": "New incident: {{Incident.title}}" }`

如果你想使用 Discord 更丰富的 [embeds](https://discord.com/developers/docs/resources/webhook#execute-webhook)，这很方便——在正文中添加一个 `embeds` 数组即可。

## 提示

- 使用 **Conditions** 仅针对特定严重程度发送——在 Discord 模块之前对 `{{Incident.incidentSeverity.name}}` 进行分支。
- 在 **Incident → On Update** 上添加更多工作流，将确认和解决消息发布到同一频道。

## 接下来读什么

- [集成概览](/docs/integrations/index)——出站模式。
- [Telegram](/docs/integrations/telegram)——适用于 Telegram 的相同思路。
- [组件 → Discord](/docs/workflows/components#discord)——组件参考。
