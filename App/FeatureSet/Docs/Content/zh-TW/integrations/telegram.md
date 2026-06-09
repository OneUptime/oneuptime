# Telegram 整合

將事件更新傳送到 [Telegram](https://telegram.org) 聊天或群組。OneUptime 內建 **Telegram** 工作流程元件，因此設定相當快速。

此整合屬於**對外（outbound）**：OneUptime 透過 Telegram 機器人傳送訊息。

```text
OneUptime Incident → On Create  ──►  Telegram component  ──►  message in your chat
```

## 步驟 1 — 建立機器人並取得其權杖

1. 在 Telegram 中，向 [@BotFather](https://t.me/BotFather) 傳送訊息並輸入 `/newbot`。
2. 依照提示操作。BotFather 會提供您一組**機器人權杖（bot token）**，格式類似 `123456789:AA...`。

## 步驟 2 — 找出您的 chat ID

1. 將機器人加入群組（或與其開始一對一聊天）並傳送任意訊息給它。
2. 在瀏覽器中開啟 `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`。
3. 在回應中找到 `"chat":{"id":...}` — 該數字就是您的 **chat ID**（群組 ID 為負數）。

## 步驟 3 — 儲存密鑰

1. 在 OneUptime 中，前往 **Workflows → Global Variables → Create**。
2. 建立 `TELEGRAM_BOT_TOKEN`（secret）與 `TELEGRAM_CHAT_ID`。

## 步驟 4 — 建構工作流程

1. 開啟 **Workflows → Create Workflow**，將其命名為 `Incidents → Telegram`，然後開啟 **Builder**。
2. 新增一個設定為 **On Create** 的 **Incident** 觸發器。將其重新命名為 `Incident`。
3. 新增一個連接至觸發器的 **Telegram** 元件：
   - **Bot token**：`{{variable.TELEGRAM_BOT_TOKEN}}`
   - **Chat ID**：`{{variable.TELEGRAM_CHAT_ID}}`
   - **Message**：`🔴 New incident: {{Incident.title}}\n{{Incident.description}}`
4. **Save**、啟用，然後建立一個測試事件。訊息便會送達您的聊天。

## 替代方案：API 元件

使用 **API** 區塊也可以：

- **Method**：`POST`
- **URL**：`https://api.telegram.org/bot{{variable.TELEGRAM_BOT_TOKEN}}/sendMessage`
- **Headers**：`Content-Type: application/json`
- **Body**：`{ "chat_id": "{{variable.TELEGRAM_CHAT_ID}}", "text": "New incident: {{Incident.title}}" }`

## 提示

- 機器人只有在被加入群組且**隱私模式（privacy mode）**允許後才能看到訊息 — 如果 `getUpdates` 為空，請先傳送訊息給機器人，或透過 BotFather 停用隱私模式。
- 使用 **Conditions** 在傳送前依嚴重程度進行篩選。
- 在 API body 中加入 `"parse_mode": "Markdown"`（或使用元件的格式化功能）以支援粗體與連結。

## 接下來閱讀

- [Integrations Overview](/docs/integrations/index) — 對外模式。
- [Discord](/docs/integrations/discord) — 適用於 Discord 的相同概念。
- [Components → Telegram](/docs/workflows/components#telegram) — 元件參考。
