# Microsoft Teams 整合

若要將 Microsoft Teams 與您自架的 OneUptime 執行個體整合，您需要設定 Azure App Registration 並設定所需的環境變數。

## 先決條件

- Azure 帳戶 - 您可以前往 [https://azure.com](https://azure.com) 建立一個
- 具有您 OneUptime 伺服器設定的存取權限

## 設定說明

### 步驟 1：建立 Azure App Registration

1. 前往 [Azure Portal](https://portal.azure.com)
2. 導覽至「App registrations」並點選「New registration」
3. 填寫註冊表單：
   - **名稱：** oneuptime
   - **支援的帳戶類型：** 任何組織目錄中的帳戶（任何 Microsoft Entra ID 租用戶 - 多租用戶）
   - **重新導向 URI：** Web - `https://your-oneuptime-domain.com/api/microsoft-teams/auth`
   - 也請新增：`https://your-oneuptime-domain.com/api/microsoft-teams/admin-consent/callback`
4. 點選「Register」
5. 記下「Application (client) ID」- 您稍後會需要它

### 步驟 2：設定應用程式權限

1. 在您的 app registration 中，前往「API permissions」
2. 點選「Add a permission」並選擇「Microsoft Graph」

**新增委派權限 (Delegated Permissions)**（當代表已登入的使用者執行動作時）：

- **User.Read** - 在 OAuth 流程中取得已驗證使用者的個人資料資訊（顯示名稱、電子郵件）所必需
- **Team.ReadBasic.All** - 在選擇要連線的團隊時，列出使用者所屬團隊所必需
- **Channel.ReadBasic.All** - 讀取頻道資訊並列出團隊內頻道以進行通知傳遞所必需
- **ChannelMessage.Send** - 將警示與事件通知傳送到 Teams 頻道所必需

**新增應用程式權限 (Application Permissions)**（當以應用程式本身執行動作而無已登入的使用者時）：

- **Team.ReadBasic.All** - 在授予管理員同意後，列出組織中所有團隊所必需
- **Channel.ReadBasic.All** - 驗證頻道是否存在並擷取頻道詳細資訊所必需
- **ChannelMessage.Send** - 以程式化方式將訊息傳送到頻道所必需

**注意：** Bot Framework 使用 Teams 應用程式資訊清單中定義的資源特定同意 (Resource-Specific Consent, RSC) 權限來處理訊息傳遞。這些權限為：

- **ChannelMessage.Send.Group** - 允許機器人將訊息傳送到團隊頻道
- **ChannelMessage.Read.Group** - 允許機器人讀取頻道訊息以進行互動式指令
- **Channel.Create.Group** - 允許機器人在需要時建立頻道

3. 為您的組織點選「Grant admin consent」

### 步驟 3：建立用戶端密碼 (Client Secret)

1. 在您的 app registration 中前往「Certificates & secrets」
2. 點選「New client secret」
3. 新增描述並設定到期時間（建議 24 個月）
4. 點選「Add」並立即複製密碼值 - 您將無法再次看到它

**重要：** 請勿複製密碼 ID，您需要的是密碼 VALUE（值），它通常較長且包含較多字元。

### 步驟 4：建立機器人服務 (Bot Service)

1. 在 Azure Portal 中，導覽至「Azure Bot」並點選「Create」
2. 填寫機器人建立表單：

   - **機器人控制代碼 (Bot handle)：** oneuptime-bot
   - **訂閱：** 您的 Azure 訂閱
   - **資源群組：** 建立一個新的或使用現有的
   - **位置：** 選擇接近您使用者的位置
   - **定價層級：** F0（免費）足以用於測試
   - 請使用您稍早建立的 app registration 中的 App (client) ID 與 Tenant ID

3. 點選「Review + create」，然後點選「Create」

4. 部署完成後，前往您的機器人資源並導覽至「Configuration」
5. 將「Messaging endpoint」設定為 `https://your-oneuptime-domain.com/api/microsoft-bot/messages`
6. 儲存設定

### 步驟 5：將 Microsoft Teams 頻道新增到機器人

1. 在您的 Azure Bot 資源中，導覽至「Channels」
2. 找到並選擇「Microsoft Teams」，然後點選「Open」或「Add」
3. 檢閱設定（為 Teams 啟用，除非您有特定需求，否則保留預設的訊息傳遞選項）
4. 點選「Save」（如果系統提示，則點選「Done」/「Publish」）以啟用 Teams 頻道

### 步驟 6：設定 OneUptime 環境變數

#### Docker Compose

如果您使用 Docker Compose，請將這些環境變數新增到您的設定中：

```bash
MICROSOFT_TEAMS_APP_CLIENT_ID=YOUR_TEAMS_APP_CLIENT_ID
MICROSOFT_TEAMS_APP_CLIENT_SECRET=YOUR_TEAMS_APP_CLIENT_SECRET
MICROSOFT_TEAMS_APP_TENANT_ID=YOUR_MICROSOFT_TENANT_ID
```

#### 搭配 Helm 的 Kubernetes

如果您使用搭配 Helm 的 Kubernetes，請將這些新增到您的 `values.yaml` 檔案中：

```yaml
microsoftTeamsApp:
  clientId: YOUR_TEAMS_APP_CLIENT_ID
  clientSecret: YOUR_TEAMS_APP_CLIENT_SECRET
   tenantId: YOUR_MICROSOFT_TENANT_ID
```

**重要：** 在新增這些環境變數後，請重新啟動您的 OneUptime 伺服器，使其生效。

### 步驟 7：上傳 Teams 應用程式資訊清單

1. 前往專案 **Settings** > **Integrations** > **Microsoft Teams**
2. 從該處下載 Teams 應用程式資訊清單
3. 前往 Microsoft Teams，點選側邊欄中的「Apps」
4. 在底部，點選「Manage your apps」
5. 點選「Upload a custom app」
6. 選擇「Upload for me or my teams」
7. 上傳您稍早下載的資訊清單 zip 檔案

## 疑難排解

如果您遇到問題：

- 確保您的應用程式已授予正確的權限
- 檢查重新導向 URI 是否完全相符（將 `your-oneuptime-domain.com` 替換為您實際的網域）
- 確認您的環境變數已正確設定
- 確保機器人訊息傳遞端點可從網際網路存取
- 確認機器人已正確設定 Teams 頻道
- 檢查 Teams 應用程式資訊清單是否已成功上傳

## 支援

我們希望改善此整合，因此非常歡迎您提供意見回饋。請將任何意見傳送給我們：[hello@oneuptime.com](mailto:hello@oneuptime.com)
