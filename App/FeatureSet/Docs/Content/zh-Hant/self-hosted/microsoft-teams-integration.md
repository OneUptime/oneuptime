# Microsoft Teams 集成

要將 Microsoft Teams 與您的自託管 OneUptime 實例集成，您需要配置 Azure 應用註冊並設置所需的環境變量。

## 前提條件

- Azure 賬號 - 您可以在 [https://azure.com](https://azure.com) 創建
- 訪問您的 OneUptime 服務器配置

## 設置說明

### 第一步：創建 Azure 應用註冊

1. 前往 [Azure 門戶](https://portal.azure.com)
2. 導航至"應用註冊"並點擊"新註冊"
3. 填寫註冊表單：
   - **名稱：** oneuptime
   - **支持的賬號類型：** 任何組織目錄中的賬號（任何 Microsoft Entra ID 租戶 - 多租戶）
   - **重定向 URI：** Web - `https://your-oneuptime-domain.com/api/microsoft-teams/auth`
   - 還請添加：`https://your-oneuptime-domain.com/api/microsoft-teams/admin-consent/callback`
4. 點擊"註冊"
5. 記錄"應用程序（客戶端）ID" - 稍後您將需要它

### 第二步：配置應用權限

1. 在您的應用註冊中，前往"API 權限"
2. 點擊"添加權限"並選擇"Microsoft Graph"

**添加委派權限**（代表已登錄用戶操作時）：
   - **User.Read** - 在 OAuth 流程中獲取已認證用戶的個人資料信息（顯示名稱、電郵）所必需
   - **Team.ReadBasic.All** - 選擇要連接的團隊時列出用戶所屬團隊所必需
   - **Channel.ReadBasic.All** - 讀取頻道信息並列出團隊內的頻道以進行通知傳送所必需
   - **ChannelMessage.Send** - 向 Teams 頻道發送警報和事件通知所必需

**添加應用程序權限**（以應用本身操作，無需已登錄用戶時）：
   - **Team.ReadBasic.All** - 授予管理員同意後列出組織中所有團隊所必需
   - **Channel.ReadBasic.All** - 驗證頻道存在並檢索頻道詳情所必需
   - **ChannelMessage.Send** - 以程序化方式向頻道發送消息所必需

**注意：** Bot Framework 使用 Teams 應用清單中定義的資源特定同意（RSC）權限處理消息傳送。這些權限包括：
   - **ChannelMessage.Send.Group** - 允許機器人向團隊頻道發送消息
   - **ChannelMessage.Read.Group** - 允許機器人讀取頻道消息以處理交互式命令
   - **Channel.Create.Group** - 允許機器人在需要時創建頻道

3. 點擊"爲您的組織授予管理員同意"

### 第三步：創建客戶端密鑰

1. 在您的應用註冊中，前往"證書和密鑰"
2. 點擊"新建客戶端密鑰"
3. 添加描述並設置過期時間（建議 24 個月）
4. 點擊"添加"並立即複製密鑰值——之後將無法再次查看

**重要提示：** 不要複製密鑰 ID，您需要的是密鑰**值**，它通常更長，包含更多字符。

### 第四步：創建機器人服務

1. 在 Azure 門戶中，導航至"Azure Bot"並點擊"創建"
2. 填寫機器人創建表單：
   - **機器人句柄：** oneuptime-bot
   - **訂閱：** 您的 Azure 訂閱
   - **資源組：** 創建新的或使用現有的
   - **位置：** 選擇靠近您用戶的位置
   - **定價層：** F0（免費）足夠用於測試
   - 請使用之前創建的應用註冊中的應用（客戶端）ID 和租戶 ID

3. 點擊"審閱 + 創建"，然後點擊"創建"

4. 部署完成後，前往您的機器人資源並導航至"配置"
5. 將"消息傳送端點"設置爲 `https://your-oneuptime-domain.com/api/microsoft-bot/messages`
6. 保存配置

### 第五步：向機器人添加 Microsoft Teams 頻道

1. 在您的 Azure Bot 資源中，導航至"頻道"
2. 找到並選擇"Microsoft Teams"，點擊"打開"或"添加"
3. 查看設置（爲 Teams 啓用，除非有特定需求，否則保留默認消息選項）
4. 點擊"保存"（如果提示，點擊"完成"/"發佈"）以啓用 Teams 頻道

### 第六步：配置 OneUptime 環境變量

#### Docker Compose

如果您使用 Docker Compose，請將這些環境變量添加到您的配置中：

```bash
MICROSOFT_TEAMS_APP_CLIENT_ID=YOUR_TEAMS_APP_CLIENT_ID
MICROSOFT_TEAMS_APP_CLIENT_SECRET=YOUR_TEAMS_APP_CLIENT_SECRET
MICROSOFT_TEAMS_APP_TENANT_ID=YOUR_MICROSOFT_TENANT_ID
```

#### Kubernetes with Helm

如果您使用 Kubernetes with Helm，請將這些添加到您的 `values.yaml` 文件中：

```yaml
microsoftTeamsApp:
  clientId: YOUR_TEAMS_APP_CLIENT_ID
  clientSecret: YOUR_TEAMS_APP_CLIENT_SECRET
   tenantId: YOUR_MICROSOFT_TENANT_ID
```

**重要提示：** 添加這些環境變量後重啓您的 OneUptime 服務器以使其生效。

### 第七步：上傳 Teams 應用清單

1. 前往項目 **設置** > **集成** > **Microsoft Teams**
2. 從那裏下載 Teams 應用清單
3. 前往 Microsoft Teams，點擊側邊欄中的"應用"
4. 在底部，點擊"管理您的應用"
5. 點擊"上傳自定義應用"
6. 選擇"爲我或我的團隊上傳"
7. 上傳您之前下載的清單 zip 文件

## 故障排查

如果您遇到問題：

- 確保您的應用具有正確的已授權權限
- 檢查重定向 URI 是否完全匹配（將 `your-oneuptime-domain.com` 替換爲您的實際域名）
- 驗證您的環境變量是否正確設置
- 確保機器人消息傳送端點可從互聯網訪問
- 驗證機器人是否已正確配置 Teams 頻道
- 檢查 Teams 應用清單是否已成功上傳

## 支持

我們希望改進此集成，因此非常歡迎您的反饋。請發送至 [hello@oneuptime.com](mailto:hello@oneuptime.com)
