# 將 OneUptime 連接至 Microsoft Teams

### 將 OneUptime 連接至 Microsoft Teams 的步驟

1. **在 OneUptime 上建立帳戶**

   - 前往 [OneUptime.com](https://oneuptime.com) 並建立一個帳戶。
   - 帳戶建立後，建立一個新專案。

2. **將 Microsoft Teams 連接至 OneUptime 專案**

   - 在您的 OneUptime 專案中，前往 **專案設定** > **Microsoft Teams**。
   - 依照提示將您的 Microsoft Teams 帳戶與 OneUptime 專案連接。

3. **設定事件通知**

   - 連接您的 Microsoft Teams 帳戶後，前往 **Incidents Page** > **Microsoft Teams**。
   - 新增規則，將事件通知傳送至 Microsoft Teams。例如，您可以建立一條規則，在建立事件時將訊息發佈至 Teams 頻道。

4. **設定警示與排程維護通知**
   - 類似的規則也可套用至警示與排程維護，方法是前往其各自的頁面並設定所需的規則。

## 測試規則

規則所在列的 **測試規則** 會把這條規則的一則測試訊息發到它指定的頻道，讓你看到訊息送達。如果規則會為每個事件建立頻道，測試也會建立一個，並邀請規則中的人員加入。

和 **專案設定** > **Workspace** > **Microsoft Teams** 中頻道旁邊的 **傳送測試** 一樣，它需要建立通知規則的權限：**Project Owner**、**Project Admin**、**Project Member**、**Settings Admin**、**Settings Member**，或自訂角色中的 **Create Workspace Notification Rule**。只能檢視規則的人（例如 **Viewer**）會被告知沒有傳送測試通知的權限。在 OneUptime Cloud 上，測試規則和新增規則一樣需要 **Growth** 方案。

## 自架部署的網路存取

有關輸出連線、輸入回呼和私有部署的說明，請參閱[Microsoft Teams 整合](/docs/self-hosted/microsoft-teams-integration)中的網路存取章節。
