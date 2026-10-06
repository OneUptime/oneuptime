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

和 **專案設定** > **Workspace** > **Slack** 中頻道旁邊的 **傳送測試** 一樣，它需要建立通知規則的權限：**Project Owner**、**Project Admin**、**Project Member**、**Settings Admin**、**Settings Member**，或自訂角色中的 **Create Workspace Notification Rule**。只能檢視規則的人（例如 **Viewer**）會被告知沒有傳送測試通知的權限。在 OneUptime Cloud 上，測試規則和新增規則一樣需要 **Growth** 方案。

## 自架部署的網路存取

有關輸出連線、輸入回呼和私有部署的說明，請參閱[Slack 整合](/docs/self-hosted/slack-integration)中的網路存取章節。
