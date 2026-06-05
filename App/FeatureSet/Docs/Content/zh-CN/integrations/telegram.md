# Telegram 集成

向 [Telegram](https://telegram.org) 聊天或群组发送事件更新。OneUptime 内置了 **Telegram** 工作流组件，设置非常快捷。

此集成为**出站**模式：OneUptime 通过 Telegram 机器人发送消息。

```text
OneUptime Incident → On Create  ──►  Telegram component  ──►  message in your chat
```

## 步骤 1——创建机器人并获取令牌

1. 在 Telegram 中，向 [@BotFather](https://t.me/BotFather) 发送消息并输入 `/newbot`。
2. 按照提示操作。BotFather 会给你一个类似 `123456789:AA...` 的**机器人令牌**。

## 步骤 2——找到你的聊天 ID

1. 将机器人添加到群组（或与其开始私聊），并向它发送任意消息。
2. 在浏览器中打开 `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`。
3. 在响应中找到 `"chat":{"id":...}`——那个数字就是你的**聊天 ID**（群组 ID 为负数）。

## 步骤 3——存储机密

1. 在 OneUptime 中，前往 **Workflows → Global Variables → Create**。
2. 创建 `TELEGRAM_BOT_TOKEN`（机密）和 `TELEGRAM_CHAT_ID`。

## 步骤 4——构建工作流

1. 打开 **Workflows → Create Workflow**，命名为 `Incidents → Telegram`，并打开 **Builder**。
2. 添加 **Incident** 触发器，设置为 **On Create**。重命名为 `Incident`。
3. 添加连接到触发器的 **Telegram** 组件：
   - **Bot token**：`{{variable.TELEGRAM_BOT_TOKEN}}`
   - **Chat ID**：`{{variable.TELEGRAM_CHAT_ID}}`
   - **Message**：`🔴 New incident: {{Incident.title}}\n{{Incident.description}}`
4. **保存**，启用，并创建一个测试事件。消息会出现在你的聊天中。

## 替代方案：API 组件

**API** 模块同样有效：

- **Method**：`POST`
- **URL**：`https://api.telegram.org/bot{{variable.TELEGRAM_BOT_TOKEN}}/sendMessage`
- **Headers**：`Content-Type: application/json`
- **Body**：`{ "chat_id": "{{variable.TELEGRAM_CHAT_ID}}", "text": "New incident: {{Incident.title}}" }`

## 提示

- 机器人只能在被添加到群组后才能看到消息，且**隐私模式**须允许它——如果 `getUpdates` 返回空，请先给机器人发一条消息，或通过 BotFather 关闭隐私模式。
- 使用 **Conditions** 在发送前按严重程度过滤。
- 在 API 正文中添加 `"parse_mode": "Markdown"`（或使用组件的格式功能）以支持粗体和链接。

## 接下来读什么

- [集成概览](/docs/integrations/index)——出站模式。
- [Discord](/docs/integrations/discord)——适用于 Discord 的相同思路。
- [组件 → Telegram](/docs/workflows/components#telegram)——组件参考。
