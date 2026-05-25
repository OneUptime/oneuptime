# SMTP 配置

OneUptime 支持通過自定義 SMTP 服務器發送電郵，提供三種認證方式：

- **用戶名和密碼** - 傳統 SMTP 認證
- **OAuth 2.0** - 適用於 Microsoft 365 和 Google Workspace 的現代認證
- **無認證** - 適用於不需要認證的中繼服務器

本指南介紹如何爲 Microsoft 365 和 Google Workspace 配置 OAuth 2.0 認證。

## OAuth 2.0 認證

OAuth 2.0 爲與郵件服務器進行認證提供了更安全的方式，尤其適用於已禁用基本認證的企業環境。OneUptime 支持兩種 OAuth 授權類型：

- **客戶端憑據（Client Credentials）** - 適用於 Microsoft 365 和大多數 OAuth 提供商
- **JWT Bearer** - 適用於 Google Workspace 服務賬號

### OAuth 所需字段

在 OneUptime 中使用 OAuth 認證配置 SMTP 時，您需要填寫以下信息：

| 字段 | 描述 |
|------|------|
| **主機名** | SMTP 服務器地址 |
| **端口** | SMTP 端口（通常 STARTTLS 使用 587，隱式 TLS 使用 465） |
| **用戶名** | 發送郵件的電郵地址 |
| **認證類型** | 選擇"OAuth" |
| **OAuth 提供商類型** | Microsoft 365 選擇"Client Credentials"，Google Workspace 選擇"JWT Bearer" |
| **Client ID** | 來自您 OAuth 提供商的應用程序/客戶端 ID（Google 填寫服務賬號郵件地址） |
| **Client Secret** | 來自您 OAuth 提供商的客戶端密鑰（Google 填寫私鑰） |
| **Token URL** | OAuth 令牌端點 URL |
| **Scope** | SMTP 訪問所需的 OAuth 範圍 |

---

## Microsoft 365 配置

要將 OAuth 與 Microsoft 365/Exchange Online 配合使用，您需要在 Microsoft Entra（Azure AD）中註冊應用程序並配置適當的權限。

### 第一步：在 Microsoft Entra 中註冊應用程序

1. 登錄 [Microsoft Entra 管理中心](https://entra.microsoft.com)
2. 導航至 **標識** > **應用程序** > **應用註冊**
3. 點擊 **新註冊**
4. 爲您的應用程序輸入名稱（例如"OneUptime SMTP"）
5. 對於 **受支持的帳戶類型**，選擇"僅此組織目錄中的帳戶"
6. 將 **重定向 URI** 留空（客戶端憑據流程不需要）
7. 點擊 **註冊**

註冊後，從 **概述** 頁面記錄以下值：
- **應用程序（客戶端）ID** - 這是您的 Client ID
- **目錄（租戶）ID** - 您將需要此信息來構建 Token URL

### 第二步：創建客戶端密鑰

1. 在您的應用註冊中，轉到 **證書和密鑰**
2. 點擊 **新建客戶端密鑰**
3. 添加描述並選擇過期時間
4. 點擊 **添加**
5. **立即複製密鑰值** - 之後將不再顯示

### 第三步：添加 SMTP API 權限

1. 轉到 **API 權限**
2. 點擊 **添加權限**
3. 選擇 **我的組織使用的 API**
4. 搜索並選擇 **Office 365 Exchange Online**
5. 選擇 **應用程序權限**
6. 找到並勾選 **SMTP.SendAsApp**
7. 點擊 **添加權限**
8. 點擊 **爲 [您的組織] 授予管理員同意**（需要管理員權限）

### 第四步：在 Exchange Online 中註冊服務主體

在您的應用程序能夠發送電郵之前，您必須在 Exchange Online 中註冊服務主體並授予郵箱權限。

1. 安裝 Exchange Online PowerShell 模塊：

```powershell
Install-Module -Name ExchangeOnlineManagement -Force
```

2. 連接到 Exchange Online：

```powershell
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -Organization <your-tenant-id>
```

3. 註冊服務主體（使用 **企業應用程序** 中的對象 ID，而非應用註冊中的 ID）：

```powershell
# 在 Microsoft Entra > 企業應用程序 > 您的應用 > 對象 ID 中查找對象 ID
New-ServicePrincipal -AppId <application-client-id> -ObjectId <enterprise-app-object-id>
```

4. 授予服務主體從特定郵箱發送郵件的權限：

```powershell
# 向服務主體授予完整郵箱訪問權限
Add-MailboxPermission -Identity "sender@yourdomain.com" -User <service-principal-id> -AccessRights FullAccess
```

> **注意：** 使用 `Add-MailboxPermission`（而非 `Add-RecipientPermission`）。`Add-RecipientPermission` 僅在收件人上授予 `SendAs` 權限，對於服務主體通過 OAuth 使用 SMTP 發送郵件來說不夠用——發送時會出現認證/權限錯誤。帶 `FullAccess` 的 `Add-MailboxPermission` 纔是實際有效的命令。

### 第五步：在 OneUptime 中配置

在 OneUptime 中，使用以下設置創建或編輯 SMTP 配置：

| 字段 | 值 |
|------|-----|
| 主機名 | `smtp.office365.com` |
| 端口 | `587` |
| 用戶名 | 您授權的電郵地址（例如 `sender@yourdomain.com`） |
| 認證類型 | `OAuth` |
| OAuth 提供商類型 | `Client Credentials` |
| Client ID | 第一步中的應用程序（客戶端）ID |
| Client Secret | 第二步中的密鑰值 |
| Token URL | `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` |
| Scope | `https://outlook.office365.com/.default` |
| 發件人郵箱 | 與用戶名相同 |
| 安全（TLS） | 已啓用 |

將 `<tenant-id>` 替換爲第一步中的目錄（租戶）ID。

---

## Google Workspace 配置

Google Workspace 需要一個具有域範圍委派權限的**服務賬號**，以便代表用戶發送電郵。這是必要的，因爲 Google 的 SMTP 服務器不支持 Gmail 的直接 OAuth 客戶端憑據流程。

### 前提條件

- Google Workspace 賬號（非普通 Gmail - 消費者 Gmail 賬號不支持此功能）
- Google Workspace 管理員控制台的超級管理員訪問權限
- Google Cloud Console 的訪問權限

### 第一步：創建 Google Cloud 項目

1. 轉到 [Google Cloud Console](https://console.cloud.google.com)
2. 點擊項目下拉菜單並選擇 **新建項目**
3. 輸入項目名稱並點擊 **創建**
4. 選擇您的新項目

### 第二步：啓用 Gmail API

1. 轉到 **API 和服務** > **庫**
2. 搜索"Gmail API"
3. 點擊 **Gmail API** 然後點擊 **啓用**

### 第三步：創建服務賬號

1. 轉到 **API 和服務** > **憑據**
2. 點擊 **創建憑據** > **服務賬號**
3. 輸入服務賬號的名稱和描述
4. 點擊 **創建並繼續**
5. 跳過可選步驟並點擊 **完成**

### 第四步：創建服務賬號密鑰

1. 點擊您剛創建的服務賬號
2. 轉到 **密鑰** 選項卡
3. 點擊 **添加密鑰** > **創建新密鑰**
4. 選擇 **JSON** 並點擊 **創建**
5. 安全保存下載的 JSON 文件 - 它包含：
   - `client_id` - 您的 Client ID
   - `private_key` - 您的 Client Secret（私鑰）

### 第五步：啓用域範圍委派

1. 在服務賬號詳情中，點擊 **顯示高級設置**
2. 記錄 **客戶端 ID**（數字 ID）
3. 勾選 **啓用 Google Workspace 域範圍委派**
4. 點擊 **保存**

### 第六步：在 Google Workspace 管理員控制台中授權服務賬號

1. 登錄 [Google Workspace 管理員控制台](https://admin.google.com)
2. 轉到 **安全** > **訪問和數據控制** > **API 控制**
3. 點擊 **管理域範圍委派**
4. 點擊 **添加新項**
5. 輸入第五步中的 **客戶端 ID**
6. 對於 **OAuth 範圍**，輸入：`https://mail.google.com/`
7. 點擊 **授權**

注意：委派生效可能需要幾分鐘到 24 小時。

### 第七步：在 OneUptime 中配置

在 OneUptime 中，使用以下設置創建或編輯 SMTP 配置：

| 字段 | 值 |
|------|-----|
| 主機名 | `smtp.gmail.com` |
| 端口 | `587` |
| 用戶名 | 要發送郵件的 Google Workspace 電郵地址（例如 `notifications@yourdomain.com`）。此用戶將被服務賬號模擬。 |
| 認證類型 | `OAuth` |
| OAuth 提供商類型 | `JWT Bearer` |
| Client ID | 服務賬號 JSON 中的 `client_email`（例如 `your-service@your-project.iam.gserviceaccount.com`） |
| Client Secret | 服務賬號 JSON 中的 `private_key`（包括 `-----BEGIN PRIVATE KEY-----` 和 `-----END PRIVATE KEY-----` 的完整密鑰） |
| Token URL | `https://oauth2.googleapis.com/token` |
| Scope | `https://mail.google.com/` |
| 發件人郵箱 | 與用戶名相同 |
| 安全（TLS） | 已啓用 |

**重要提示：** 對於 Google（JWT Bearer），Client ID 是**服務賬號郵箱**（`client_email`），而非數字 `client_id`。服務賬號將模擬用戶名字段中指定的用戶來發送電郵。

---

## 故障排查

### Microsoft 365

| 問題 | 解決方案 |
|------|---------|
| "Authentication unsuccessful" | 驗證服務主體是否已在 Exchange 中註冊並具有郵箱權限 |
| "AADSTS700016: Application not found" | 檢查 Client ID 是否正確，以及應用程序是否存在於您的租戶中 |
| "AADSTS7000215: Invalid client secret" | 重新生成客戶端密鑰 - 可能已過期 |
| "The mailbox is not enabled for this operation" | 運行 `Add-MailboxPermission` 以授予郵箱訪問權限 |

### Google Workspace

| 問題 | 解決方案 |
|------|---------|
| "invalid_grant" | 確保域範圍委派已正確配置並已生效 |
| "unauthorized_client" | 驗證 Client ID 已在 Google Workspace 管理員控制台中獲得授權 |
| "access_denied" | 檢查範圍 `https://mail.google.com/` 是否已獲得授權 |
| "Domain policy has disabled third-party Drive apps" | 在 Google Workspace 管理員 > 安全 > API 控制中啓用 API 訪問 |

### 通用

- **測試您的配置**：使用 OneUptime 中的"發送測試郵件"按鈕驗證您的設置
- **檢查日誌**：查看 OneUptime 日誌以獲取詳細錯誤信息
- **令牌緩存**：OneUptime 會緩存 OAuth 令牌並在過期前自動刷新

---

## 安全最佳實踐

1. **定期輪換密鑰**：設置日曆提醒，在客戶端密鑰過期前輪換
2. **使用專用服務賬號**：爲 OneUptime 創建獨立憑據，而非與其他應用程序共享
3. **最小權限原則**：僅授予所需的最低權限（Microsoft 使用 SMTP.SendAsApp，Google 使用 mail.google.com 範圍）
4. **監控使用情況**：檢查電郵日誌和 OAuth 應用程序登錄記錄，查找異常活動
5. **安全儲存**：切勿將客戶端密鑰提交到版本控制系統

---

## 其他資源

### Microsoft 365
- [使用 OAuth 進行 IMAP、POP 或 SMTP 連接認證](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
- [向 Microsoft 標識平臺註冊應用程序](https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)

### Google Workspace
- [將 OAuth 2.0 用於服務器到服務器應用程序](https://developers.google.com/identity/protocols/oauth2/service-account)
- [Gmail API 文檔](https://developers.google.com/gmail/api)
- [XOAUTH2 協議](https://developers.google.com/gmail/imap/xoauth2-protocol)
