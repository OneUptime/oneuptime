# Microsoft Teams 整合

若要將 Microsoft Teams 與您自架的 OneUptime 執行個體整合，您需要設定 Azure App Registration 並設定所需的環境變數。

## 先決條件

- Azure 帳戶 - 您可以前往 [https://azure.com](https://azure.com) 建立一個
- 具有您 OneUptime 伺服器設定的存取權限

## 網路存取

OneUptime 的 Teams 整合使用 Azure Bot。Incoming Webhook 或 Teams Workflow URL 不能取代此機器人的訊息端點。Microsoft 要求[自架機器人提供可公開存取的 HTTPS 端點](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0)。私有 IP 位址、內部 DNS 名稱或員工的 VPN 連線都不會讓 Azure Bot Service 能夠存取 OneUptime。

| 功能 | OneUptime 到提供者 | 提供者到 OneUptime |
| --- | --- | --- |
| Teams 通知 | 連至 Microsoft API 的 HTTPS | 完整的機器人整合需要輸入存取，包括交談探索 |
| Teams 命令、卡片按鈕、聊天安裝事件 | HTTPS | `POST /api/microsoft-bot/messages` |

應用程式註冊重新導向 `/api/microsoft-teams/auth` 和 `/api/microsoft-teams/admin-consent/callback` 透過使用者瀏覽器返回。該瀏覽器必須能夠存取 OneUptime，例如透過公司網路或 VPN。機器人訊息和卡片操作來自 Microsoft 伺服器，需要另外提供可存取的入口。僅輸出警示傳送成功不能驗證輸入連線。

### 正式環境：公開通往私有部署的閘道

1. **選擇主機名稱**，例如 `oneuptime.example.com`。發佈指向面向網際網路閘道的公開 DNS 記錄。提供者無法存取私有 IP 位址和僅供內部使用的 DNS 名稱。使用分割 DNS 時，員工可以將相同主機名稱解析到私有入口，並繼續透過 VPN 使用儀表板。私有入口也必須提供 HTTPS，並使用對該主機名稱有效的憑證。

2. **將閘道連接到 OneUptime。** 將閘道放在能夠路由到私有入口的 DMZ 中，或使用透過您自己的站台對站台 VPN/私人連結連線的公開閘道。允許閘道透過上游服務連接埠存取入口。對於 Kubernetes/Portainer，僅有私有 `ClusterIP` 服務還不夠：閘道需要入口/控制器或其他可存取的上游。資料庫和其他內部服務應保持私有。

3. **在連接埠 443 終止 HTTPS**，使用公開信任的憑證和完整的中繼憑證鏈。允許輸入 TCP 443 存取閘道。僅安裝憑證或變更 DNS 不會建立通往私有上游的路由。

4. 僅公開 `/api/microsoft-bot/messages`，並在步驟 4 中將 Azure Bot 訊息端點設為此完整的公用 HTTPS URL。OneUptime 的 Bot Framework 配接器必須能夠接收要求並驗證身分。 保留方法、路徑、查詢字串、本文及驗證標頭（`Authorization`）。保留公用 `Host`，設定受信任的 `X-Forwarded-Host` 和 `X-Forwarded-Proto: https` 標頭。不要新增重新導向。

5. 將這些路徑排除在瀏覽器 SSO、CAPTCHA 和 Proxy 登入頁面之外。保持 OneUptime 驗證啟用。僅允許閘道和獲准的內部用戶端存取來源伺服器，並在日誌中隱藏權杖。

6. **設定 OneUptime 的標準 URL**:

   Docker Compose，在 `config.env` 中：

   ```dotenv
   HOST=oneuptime.example.com
   HTTP_PROTOCOL=https
   ```

   Helm/Portainer values：

   ```yaml
   host: oneuptime.example.com
   httpProtocol: https
   ```

   將範例替換為您的網域。這些設定用於產生 URL，不會建立 DNS、TLS 或防火牆規則。套用 Compose 設定或 Helm 更新，然後等待應用程式重新啟動。 如果主機名稱變更，請更新 Azure Bot 端點和應用程式註冊的重新導向 URI，然後重新下載並上傳 Teams 資訊清單。

[私有網路存取設定](/docs/self-hosted/private-network-access)控制 OneUptime 向內部服務發出的要求。啟用 `ALLOW_PRIVATE_NETWORK_WEBHOOKS` 不會使 Teams 能夠存取 OneUptime。

### 輸出存取和 IP 限制

允許 OneUptime 應用程式進行 DNS 解析和輸出 HTTPS (TCP 443) 存取。 Teams 使用 `graph.microsoft.com`、`login.microsoftonline.com`、Bot Framework 驗證/頻道端點，以及交談的連接器服務 URL。請參考 [Microsoft 防火牆指南](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0)，並在測試時檢查遭封鎖的流量；這些範例不是完整的網域清單。 商業雲端的備用連接器為 `https://smba.trafficmanager.net/teams/`；各交談的服務 URL 可能不同。

Microsoft 不支援固定的 Bot Framework 輸入 IP 允許清單，因為位址會變更。Teams 用戶端媒體位址範圍不是機器人 Webhook 的來源位址。請保持 Bot Framework 驗證啟用。

### 測試與不允許輸入存取的部署

從 VPN 以外的網路驗證公開 DNS 和 TLS，然後檢查 Teams 路由：

```bash
curl -sS -i https://oneuptime.example.com/api/microsoft-bot/messages
```

在目前的 OneUptime 版本中，預期傳回 `405 Method Not Allowed`，並包含 `Allow: POST`。這只能確認 GET 要求已到達該路由，不能證明經過驗證的機器人 POST 要求能夠正常運作。舊版本可能傳回 OneUptime 的 JSON 404；請檢查回應本文和 Proxy 記錄。TLS 錯誤、逾時或 Proxy 的 HTML 錯誤頁面表示存在憑證或路由問題。

連接 Teams、傳送測試通知、向機器人傳送訊息並按下卡片按鈕。在 OneUptime 中確認操作，並將 Microsoft 診斷資訊與閘道及應用程式日誌對照檢查。通知送達不能驗證經過身分驗證的輸入 POST。

對於開發環境，Microsoft 的 [Teams 測試指南](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/authentication/add-authentication#testing-the-bot-locally-in-teams)介紹了透過通道公開本機服務的方法。請轉送至 OneUptime 入口，並使用 `/api/microsoft-bot/messages` 取代 Microsoft 範例中的 `/api/messages` 路徑。公開通道 URL 變更時應更新 Azure Bot 端點，正式環境請使用穩定的入口。 還需設定對應的 OneUptime 主機名稱。測試後停止通道，因為它仍會公開輸入存取。

如果禁止所有輸入連線，完整的 Teams 整合將無法運作：命令、卡片操作和交談探索都依賴輸入連線。完全斷網的安裝無法使用 Teams。

Azure Bot Private Endpoint 不能取代這個 Teams 入口。Microsoft 的[網路隔離說明](https://learn.microsoft.com/en-us/azure/bot-service/dl-network-isolation-how-to?view=azure-bot-service-4.0)描述的是 Direct Line 隔離，並指出停用公開網路存取會取消 Teams 頻道設定。

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

`ChannelMessage.Send` 僅提供委派權限；[Microsoft Graph 權限參考](https://learn.microsoft.com/en-us/graph/permissions-reference#channelmessagesend)中沒有對應的應用程式權限。請將其保留在上方的委派權限清單中。

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

1. 前往專案 **設定** > **工作區** > **Microsoft Teams**
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
