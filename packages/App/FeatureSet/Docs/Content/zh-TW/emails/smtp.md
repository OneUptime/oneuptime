# SMTP 設定

OneUptime 支援透過自訂 SMTP 伺服器寄送電子郵件，提供三種驗證方式：

- **使用者名稱與密碼** - 傳統的 SMTP 驗證
- **OAuth 2.0** - 適用於 Microsoft 365 與 Google Workspace 的現代驗證方式
- **無** - 適用於不需要驗證的轉送（relay）伺服器

下方第一節說明每項設定的位置。本指南其餘部分介紹 Microsoft 365 與 Google Workspace 的 OAuth 2.0 驗證。

## 新增 SMTP 伺服器

在 **專案設定 > 通知 > 通知設定** 的 **自訂 SMTP 設定** 卡片中新增專案的郵件伺服器。在自行託管的安裝中，OneUptime 本身用來寄信的伺服器在 **Admin Dashboard > 設定 > 電子郵件** 的 **自訂電子郵件和 SMTP 設定** 卡片中設定。兩個表單都分兩個步驟詢問相同的內容：

1. **伺服器**：**名稱**（僅限專案設定）、**主機名稱**、**連接埠**（新設定從 `587` 開始）、**使用者名稱** 和 **密碼**。
2. **寄件者**：您的郵件所用的 **寄件者電子郵件** 和 **寄件人名稱**。

其餘所有選項都收合在伺服器步驟最後的 **進階** 中。收合時，其標題會說明郵件的傳送方式，例如：「透過 SMTP 傳送郵件，使用使用者名稱和密碼登入。需要 TLS。」

| 欄位           | 作用                                                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **傳輸**       | `SMTP`（預設），或適用於已關閉 SMTP AUTH 之 Microsoft 365 租用戶的 `Microsoft Graph`。選擇 Microsoft Graph 會隱藏主機名稱、連接埠、使用者名稱和密碼，並顯示 OAuth 欄位。 |
| **要求 TLS**   | 新的專案設定中預設開啟。郵件只會透過使用有效憑證的加密連線傳送。關閉時，只有在伺服器支援時才會加密郵件，且不會檢查憑證。連接埠 465 一律加密。                            |
| **驗證類型**   | `Username and Password`（預設）、`OAuth`，或用於不需登入之轉送伺服器的 `None`。                                                                                          |
| **OAuth 欄位** | 提供者類型、用戶端 ID、用戶端密碼、權杖 URL 和範圍，在選擇 OAuth 或 Microsoft Graph 後顯示。                                                                             |
| **描述**       | 給團隊的備註（僅限專案設定）。                                                                                                                                           |

**Microsoft Graph。** 開啟 **進階**，將 **傳輸** 設為 `Microsoft Graph`，然後填入具有 **Mail.Send** 應用程式權限的 Azure 應用程式：其用戶端 ID 和用戶端密碼、權杖 URL `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` 以及範圍 `https://graph.microsoft.com/.default`。郵件會從 **寄件者電子郵件** 的信箱寄出，該信箱必須是您租用戶中已授權的信箱。

儲存專案設定後，可使用其所在列的 **傳送測試電子郵件** 確認它是否正常運作。

## OAuth 2.0 驗證

OAuth 2.0 提供了一種更安全的方式來向電子郵件伺服器進行驗證，特別適用於已停用基本驗證的企業環境。OneUptime 支援兩種 OAuth 授權類型（grant type）：

- **Client Credentials** - 由 Microsoft 365 及大多數 OAuth 供應商使用
- **JWT Bearer** - 由 Google Workspace 服務帳戶使用

### OAuth 所需的欄位

在 OneUptime 中設定使用 OAuth 驗證的 SMTP 時，你會需要：

| 欄位                 | 說明                                                                          |
| -------------------- | ----------------------------------------------------------------------------- |
| **主機名稱**         | SMTP 伺服器位址                                                               |
| **連接埠**           | SMTP 連接埠（STARTTLS 通常為 587，隱含式 TLS 通常為 465）                     |
| **使用者名稱**       | 用來寄送郵件的電子郵件地址                                                    |
| **驗證類型**         | 選擇「OAuth」                                                                 |
| **OAuth 提供者類型** | Microsoft 365 選擇「Client Credentials」，Google Workspace 選擇「JWT Bearer」 |
| **用戶端 ID**        | 來自你 OAuth 供應商的應用程式/用戶端 ID（Google 則為服務帳戶電子郵件）        |
| **用戶端密鑰**       | 來自你 OAuth 供應商的用戶端密鑰（Google 則為私密金鑰）                        |
| **Token URL**        | OAuth 權杖端點 URL                                                            |
| **範圍**             | 存取 SMTP 所需的 OAuth 範圍（scope）                                          |

**驗證類型** 和 OAuth 欄位位於表單伺服器步驟的 **進階** 中。

---

## Microsoft 365 設定

若要在 Microsoft 365/Exchange Online 上使用 OAuth，你需要在 Microsoft Entra（Azure AD）中註冊一個應用程式，並設定適當的權限。

### 步驟 1：在 Microsoft Entra 中註冊應用程式

1. 登入 [Microsoft Entra 系統管理中心](https://entra.microsoft.com)
2. 前往 **Identity** > **Applications** > **App registrations**
3. 點選 **New registration**
4. 為你的應用程式輸入名稱（例如「OneUptime SMTP」）
5. 在 **Supported account types** 中，選擇「Accounts in this organizational directory only」
6. **Redirect URI** 保持空白（用戶端認證流程不需要）
7. 點選 **Register**

註冊完成後，從 **Overview** 頁面記下以下值：

- **Application (client) ID** - 這是你的 Client ID
- **Directory (tenant) ID** - 你在設定 Token URL 時會需要它

### 步驟 2：建立用戶端密鑰

1. 在你的應用程式註冊中，前往 **Certificates & secrets**
2. 點選 **New client secret**
3. 新增說明並選擇有效期間
4. 點選 **Add**
5. **立即複製密鑰值** - 之後將不會再次顯示

### 步驟 3：新增 SMTP API 權限

1. 前往 **API permissions**
2. 點選 **Add a permission**
3. 選擇 **APIs my organization uses**
4. 搜尋並選擇 **Office 365 Exchange Online**
5. 選擇 **Application permissions**
6. 找到並勾選 **SMTP.SendAsApp**
7. 點選 **Add permissions**
8. 點選 **Grant admin consent for [your organization]**（需要管理員權限）

### 步驟 4：在 Exchange Online 中註冊服務主體

在你的應用程式能夠寄送電子郵件之前，你必須在 Exchange Online 中註冊服務主體（service principal），並授予信箱權限。

1. 安裝 Exchange Online PowerShell 模組：

```powershell
Install-Module -Name ExchangeOnlineManagement -Force
```

2. 連線至 Exchange Online：

```powershell
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -Organization <your-tenant-id>
```

3. 註冊服務主體（請使用來自 **Enterprise Applications** 的 Object ID，而非 App Registrations）：

```powershell
# Find the Object ID in Microsoft Entra > Enterprise Applications > Your App > Object ID
New-ServicePrincipal -AppId <application-client-id> -ObjectId <enterprise-app-object-id>
```

4. 授予服務主體以特定信箱身分寄送郵件的權限：

```powershell
# Grant full mailbox access to the service principal
Add-MailboxPermission -Identity "sender@yourdomain.com" -User <service-principal-id> -AccessRights FullAccess
```

> **注意：** 請使用 `Add-MailboxPermission`（而非 `Add-RecipientPermission`）。`Add-RecipientPermission` 只會授予收件者的 `SendAs` 權限，不足以讓服務主體透過使用 OAuth 的 SMTP 寄送郵件 — 你會在寄送時收到驗證/權限錯誤。`Add-MailboxPermission` 搭配 `FullAccess` 才是真正有效的指令。

### 步驟 5：在 OneUptime 中設定

在 OneUptime 中，使用以下設定建立或編輯一項 SMTP 設定：

| 欄位                | 值                                                                |
| ------------------- | ----------------------------------------------------------------- |
| Hostname            | `smtp.office365.com`                                              |
| Port                | `587`                                                             |
| Username            | 你授予權限的電子郵件地址（例如 `sender@yourdomain.com`）          |
| Authentication Type | `OAuth`                                                           |
| OAuth Provider Type | `Client Credentials`                                              |
| Client ID           | 來自步驟 1 的你的 Application (client) ID                         |
| Client Secret       | 來自步驟 2 的密鑰值                                               |
| Token URL           | `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` |
| Scope               | `https://outlook.office365.com/.default`                          |
| From Email          | 與 Username 相同                                                  |
| 要求 TLS            | 啟用                                                              |

請將 `<tenant-id>` 替換為來自步驟 1 的 Directory (tenant) ID。

---

## Google Workspace 設定

Google Workspace 需要一個具備網域層級委派（domain-wide delegation）的**服務帳戶**，才能代表使用者寄送電子郵件。這是必要的，因為 Google 的 SMTP 伺服器不支援 Gmail 的直接 OAuth 用戶端認證流程。

### 先決條件

- Google Workspace 帳戶（非一般 Gmail - 消費者 Gmail 帳戶不支援此功能）
- Google Workspace 管理控制台的超級管理員（Super Admin）存取權限
- Google Cloud Console 的存取權限

### 步驟 1：建立 Google Cloud 專案

1. 前往 [Google Cloud Console](https://console.cloud.google.com)
2. 點選專案下拉選單並選擇 **New Project**
3. 輸入專案名稱並點選 **Create**
4. 選擇你的新專案

### 步驟 2：啟用 Gmail API

1. 前往 **APIs & Services** > **Library**
2. 搜尋「Gmail API」
3. 點選 **Gmail API**，然後點選 **Enable**

### 步驟 3：建立服務帳戶

1. 前往 **APIs & Services** > **Credentials**
2. 點選 **Create Credentials** > **Service account**
3. 為服務帳戶輸入名稱與說明
4. 點選 **Create and Continue**
5. 略過選用步驟並點選 **Done**

### 步驟 4：建立服務帳戶金鑰

1. 點選你剛建立的服務帳戶
2. 前往 **Keys** 分頁
3. 點選 **Add Key** > **Create new key**
4. 選擇 **JSON** 並點選 **Create**
5. 妥善保存下載的 JSON 檔案 - 它包含：
   - `client_id` - 你的 Client ID
   - `private_key` - 你的 Client Secret（私密金鑰）

### 步驟 5：啟用網域層級委派

1. 在服務帳戶詳細資料中，點選 **Show Advanced Settings**
2. 記下 **Client ID**（數字 ID）
3. 勾選 **Enable Google Workspace Domain-wide Delegation**
4. 點選 **Save**

### 步驟 6：在 Google Workspace 管理控制台中授權服務帳戶

1. 登入 [Google Workspace 管理控制台](https://admin.google.com)
2. 前往 **Security** > **Access and data control** > **API Controls**
3. 點選 **Manage Domain Wide Delegation**
4. 點選 **Add new**
5. 輸入來自步驟 5 的 **Client ID**
6. 在 **OAuth Scopes** 中，輸入：`https://mail.google.com/`
7. 點選 **Authorize**

注意：委派的傳播可能需要幾分鐘到 24 小時的時間。

### 步驟 7：在 OneUptime 中設定

在 OneUptime 中，使用以下設定建立或編輯一項 SMTP 設定：

| 欄位                | 值                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Hostname            | `smtp.gmail.com`                                                                                                               |
| Port                | `587`                                                                                                                          |
| Username            | 用來寄送郵件的 Google Workspace 電子郵件地址（例如 `notifications@yourdomain.com`）。此使用者將被服務帳戶模擬（impersonate）。 |
| Authentication Type | `OAuth`                                                                                                                        |
| OAuth Provider Type | `JWT Bearer`                                                                                                                   |
| Client ID           | 來自你服務帳戶 JSON 的 `client_email`（例如 `your-service@your-project.iam.gserviceaccount.com`）                              |
| Client Secret       | 來自你服務帳戶 JSON 的 `private_key`（整把金鑰，包含 `-----BEGIN PRIVATE KEY-----` 與 `-----END PRIVATE KEY-----`）            |
| Token URL           | `https://oauth2.googleapis.com/token`                                                                                          |
| Scope               | `https://mail.google.com/`                                                                                                     |
| From Email          | 與 Username 相同                                                                                                               |
| 要求 TLS            | 啟用                                                                                                                           |

**重要：** 對於 Google（JWT Bearer），Client ID 是**服務帳戶電子郵件**（`client_email`），而非數字 `client_id`。服務帳戶會模擬 Username 欄位中指定的使用者來寄送電子郵件。

---

## 疑難排解

### Microsoft 365

| 問題                                              | 解決方案                                                      |
| ------------------------------------------------- | ------------------------------------------------------------- |
| 「Authentication unsuccessful」                   | 確認服務主體已在 Exchange 中註冊並具備信箱權限                |
| 「AADSTS700016: Application not found」           | 檢查 Client ID 是否正確，以及該應用程式是否存在於你的租用戶中 |
| 「AADSTS7000215: Invalid client secret」          | 重新產生用戶端密鑰 - 它可能已過期                             |
| 「The mailbox is not enabled for this operation」 | 執行 `Add-MailboxPermission` 以授予該信箱的存取權限           |

### Google Workspace

| 問題                                                  | 解決方案                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------ |
| 「invalid_grant」                                     | 確認網域層級委派已正確設定並完成傳播                                     |
| 「unauthorized_client」                               | 確認 Client ID 已在 Google Workspace 管理控制台中獲得授權                |
| 「access_denied」                                     | 檢查範圍 `https://mail.google.com/` 是否已獲得授權                       |
| 「Domain policy has disabled third-party Drive apps」 | 在 Google Workspace 管理控制台 > Security > API Controls 中啟用 API 存取 |

### 一般

- **測試你的設定**：使用 OneUptime 中的「傳送測試電子郵件」按鈕來驗證你的設定
- **檢查記錄**：查看 OneUptime 記錄以取得詳細的錯誤訊息
- **權杖快取**：OneUptime 會快取 OAuth 權杖，並在到期前自動重新整理

---

## 安全性最佳實務

1. **定期輪換密鑰**：設定行事曆提醒，在用戶端密鑰到期前進行輪換
2. **使用專用的服務帳戶**：為 OneUptime 建立獨立的認證，而非與其他應用程式共用
3. **最小權限原則**：只授予所需的最低權限（Microsoft 為 SMTP.SendAsApp，Google 為 mail.google.com 範圍）
4. **監控使用情況**：查看電子郵件記錄與 OAuth 應用程式登入，以發現異常活動
5. **安全儲存**：絕不要將用戶端密鑰提交至版本控制系統

---

## 其他資源

### Microsoft 365

- [Authenticate an IMAP, POP or SMTP connection using OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
- [Register an application with Microsoft identity platform](https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)

### Google Workspace

- [Using OAuth 2.0 for Server to Server Applications](https://developers.google.com/identity/protocols/oauth2/service-account)
- [Gmail API Documentation](https://developers.google.com/gmail/api)
- [XOAUTH2 Protocol](https://developers.google.com/gmail/imap/xoauth2-protocol)
