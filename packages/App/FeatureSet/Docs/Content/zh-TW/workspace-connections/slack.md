# 將 OneUptime 連接至 Slack

### 將 OneUptime 連接至 Slack 的步驟

1. **在 OneUptime 上建立帳戶**

   - 前往 [OneUptime.com](https://oneuptime.com) 並建立帳戶。
   - 建立帳戶後，建立一個新專案。

2. **將 Slack 連接至 OneUptime 專案**

   - 在您的 OneUptime 專案中，前往 **專案設定** > **Slack**。
   - 依照提示將您的 Slack 帳戶與 OneUptime 專案連接。

3. **設定事件通知**

   - 連接您的 Slack 帳戶後，前往 **Incidents Page** > **Slack**。
   - 新增規則以將事件通知傳送至 Slack。例如，您可以建立一條規則，在建立事件時建立新的 Slack 頻道並邀請事件負責人。

4. **設定警報與排程維護通知**
   - 透過前往相應的頁面並設定所需的規則，可將類似的規則套用至警報與排程維護。

## 測試規則

規則所在列的 **測試規則** 會把這條規則的一則測試訊息發到它指定的頻道，讓你看到訊息送達。如果規則會為每個事件建立頻道，測試也會建立一個，並邀請規則中的人員加入。

和 **專案設定** > **Workspace** > **Slack** 中頻道旁邊的 **傳送測試** 一樣，它需要建立通知規則的權限：**Project Owner**、**Project Admin**、**Project Member**、**Settings Admin**、**Settings Member**，或自訂角色中的 **Create Workspace Notification Rule** 與 **Read Workspace Notification Rule**。對於只能檢視規則的人（例如 **Viewer**），**測試規則** 是鎖定的，它的提示會說明需要什麼；API 會以 "You do not have permission to send test notifications in this project." 拒絕其測試。在 OneUptime Cloud 上，測試規則和新增規則一樣需要 **Growth** 方案。

在 OneUptime Cloud 上，頻道旁邊的 **傳送測試** 也需要 **Growth** 方案，因為在頻道中發文正是規則和摘要所做的事。摘要上的 **立即發送測試** 需要建立摘要的權限（自訂角色中的 **Create Workspace Notification Summary** 與 **Read Workspace Notification Summary**），在 OneUptime Cloud 上還需要 **Growth** 方案；對其他人它是鎖定的，它的提示會說明需要什麼。以唯讀權限連線的 MCP 用戶端無法傳送任何測試。

## 摘要

**事件** > **Workspace** > **Slack**（以及 **警示**）的 **Summary** 分頁會定期向你指定的頻道發布彙整：有多少事件或警示、確認與解決的速度，以及附連結的清單。新摘要每週發送一次，涵蓋最近 7 天。將 **首次報告發送於** 留空，第一份摘要會在下一週、下一天或下個月開始時的 09:00 發送；表單會顯示確切時間。

摘要依其 **時區** 的時鐘發送，時區預設為你的時區。摘要在該時區全年維持同一時間：設為柏林 09:00 的摘要在日光節約時間調整時鐘後，仍依柏林時間 09:00 發送，訊息中的日期也以柏林時間顯示。透過 API 時，請以 IANA 時區名稱傳送 `timezone`，例如 `Europe/Berlin`。未指定時區建立的摘要會使用建立者個人資料中的時區；由 API 金鑰建立時使用 UTC。

## 自架部署的網路存取

有關輸出連線、輸入回呼和私有部署的說明，請參閱[Slack 整合](/docs/self-hosted/slack-integration)中的網路存取章節。
