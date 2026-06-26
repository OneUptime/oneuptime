# Discord 整合

將事件更新發佈到 [Discord](https://discord.com) 頻道。OneUptime 內建了 **Discord** 工作流程元件，因此這是最容易設定的整合之一。

此整合為**對外（outbound）**：OneUptime 透過傳入 webhook URL 發佈訊息到 Discord 頻道。

```text
OneUptime Incident → On Create  ──►  Discord component  ──►  message in your channel
```

## 步驟 1 — 建立 Discord webhook

1. 在 Discord 中，開啟目標頻道的 **Edit Channel → Integrations → Webhooks**。
2. 點選 **New Webhook**，為它命名（例如 `OneUptime`），選擇頻道，然後點選 **Copy Webhook URL**。

## 步驟 2 — 儲存 webhook URL（選用但建議）

1. 在 OneUptime 中，前往 **Workflows → Global Variables → Create**。
2. 將它命名為 `DISCORD_WEBHOOK_URL`，貼上 URL，並開啟 **Is Secret**。

將它保存在變數中，意味著您可以在多個工作流程中重複使用它，並在同一個地方輪替它。

## 步驟 3 — 建立工作流程

1. 開啟 **Workflows → Create Workflow**，將它命名為 `Incidents → Discord`，然後開啟 **Builder**。
2. 新增一個設定為 **On Create** 的 **Incident** 觸發器。將它重新命名為 `Incident`。
3. 新增一個連接到觸發器的 **Discord** 元件：
   - **Webhook URL**：`{{variable.DISCORD_WEBHOOK_URL}}`（或直接貼上）。
   - **Message**：`🔴 New incident: {{Incident.title}}\n{{Incident.description}}`
4. **Save**、啟用，並建立一個測試事件。訊息便會出現在您的頻道中。

## 替代方案：API 元件

如果您不想使用專用元件，**API** 區塊也能達成相同的效果：

- **Method**：`POST`
- **URL**：`{{variable.DISCORD_WEBHOOK_URL}}`
- **Headers**：`Content-Type: application/json`
- **Body**：`{ "content": "New incident: {{Incident.title}}" }`

如果您想使用 Discord 更豐富的 [embeds](https://discord.com/developers/docs/resources/webhook#execute-webhook)，這會很方便 — 只要在 body 中加入一個 `embeds` 陣列即可。

## 提示

- 使用 **Conditions** 僅針對特定嚴重程度發佈訊息 — 在 Discord 區塊之前依據 `{{Incident.incidentSeverity.name}}` 進行分支。
- 在 **Incident → On Update** 上新增更多工作流程，將確認與解決狀態發佈到同一個頻道。

## 接下來閱讀

- [Integrations Overview](/docs/integrations/index) — 對外（outbound）模式。
- [Telegram](/docs/integrations/telegram) — Telegram 的相同概念。
- [Components → Discord](/docs/workflows/components#discord) — 元件參考。
