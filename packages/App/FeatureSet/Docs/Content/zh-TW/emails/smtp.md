# SMTP

透過您自己的郵件伺服器寄送 OneUptime 的郵件。專案可以新增 SMTP 設定，供其狀態頁面寄送郵件時使用；自行託管的安裝則設定 OneUptime 寄送其他所有郵件所用的伺服器。兩者都支援三種登入方式：

- **使用者名稱與密碼**：傳統的 SMTP 驗證。
- **OAuth 2.0**：適用於通常已關閉基本驗證的 Microsoft 365 與 Google Workspace。
- **無**：適用於不需要驗證的轉送伺服器。

```mermaid title="哪個郵件伺服器寄送什麼"
flowchart TB
    SP["狀態頁面的郵件"] --> Q{"頁面是否選擇了<br/>自訂 SMTP 設定？"}
    Q -->|"是"| P["專案的 SMTP 設定"]
    Q -->|"否"| D["OneUptime 自己的郵件伺服器"]
    E["OneUptime 的其他所有郵件"] --> D
```

在自行託管的安裝中，OneUptime 自己的郵件伺服器就是您在 Admin Dashboard 中設定的伺服器。狀態頁面會在其 **訂閱者設定** 頁面的 **自訂 SMTP** 卡片中選擇 SMTP 設定。

:::cards
- [新增郵件伺服器](#新增-smtp-伺服器): 兩個步驟，其餘內容都已摺疊。
- [Microsoft 365](#microsoft-365-設定): 使用 Entra 應用程式註冊的 OAuth。
- [Google Workspace](#google-workspace-設定): 使用服務帳戶的 OAuth。
- [疑難排解](#疑難排解): 常見錯誤及其含義。
:::

## 新增 SMTP 伺服器

在 **專案設定 > 通知 > 通知設定** 的 **自訂 SMTP 設定** 卡片中新增專案的郵件伺服器。在自行託管的安裝中，OneUptime 本身用來寄信的伺服器在 **Admin Dashboard > 設定 > 通知 > 電子郵件** 的 **自訂電子郵件和 SMTP 設定** 卡片中設定。兩個表單都分兩個步驟詢問相同的內容。

:::steps
### 開啟表單

:::tabs
@tab 專案
在 **專案設定 > 通知 > 通知設定** 的 **自訂 SMTP 設定** 卡片中，點選 **建立SMTP 設定**。
@tab 自行託管的執行個體
在 Admin Dashboard 中開啟 **設定**，然後開啟側邊選單中的 **通知 > 電子郵件**（**通知** 預設為摺疊）。在 **電子郵件伺服器設定** 卡片中點選 **編輯伺服器**，並將 **電子郵件伺服器類型** 設為 `Custom SMTP`。接著在其下方出現的 **自訂電子郵件和 SMTP 設定** 卡片中點選 **編輯 SMTP 設定**。
:::

### 填寫伺服器步驟

在 **伺服器** 步驟中，輸入 **名稱**（僅限專案設定）、**主機名稱**、**連接埠**（新的專案設定從 `587` 開始）、**使用者名稱** 和 **密碼**。

### 檢查更多欄位

其餘所有選項都摺疊在 **伺服器** 步驟最後的 **更多欄位** 中。摺疊時，其標題會說明郵件的傳送方式，例如：「透過 SMTP 傳送郵件，使用使用者名稱和密碼登入。需要 TLS。」只有在需要變更下表中的某項設定時才展開它。

### 填寫寄件者步驟

在 **寄件者** 步驟中，輸入郵件所用的 **寄件者電子郵件** 和 **寄件人名稱**。您的伺服器必須允許從該地址寄送郵件。

### 儲存並傳送測試郵件

儲存設定。儲存專案設定後，可使用其所在列的 **傳送測試電子郵件** 確認它是否正常運作。這需要新增 SMTP 設定的權限：**Project Owner**、**Project Admin**，或自訂角色中的 **Create SMTP Config** 和 **Read SMTP Config**。在 OneUptime Cloud 上，它也像新增設定一樣需要 **Growth** 方案。對其他人，這個按鈕會被鎖定，其提示會說明需要什麼。

測試會詢問要寄送到的 **電子郵件** 地址，預設填入您自己的地址。請確認郵件是否送達。
:::

**更多欄位** 中的設定如下：

| 欄位 | 作用 |
| --- | --- |
| **傳輸** | `SMTP`（預設），或適用於已關閉 SMTP AUTH 之 Microsoft 365 租用戶的 `Microsoft Graph`。選擇 Microsoft Graph 會隱藏主機名稱、連接埠、使用者名稱和密碼，並顯示 OAuth 欄位。 |
| **要求 TLS** | 在新的專案設定中預設開啟。郵件只會透過使用有效憑證的加密連線傳送。關閉時，只有在伺服器支援時才會加密郵件，且不會檢查憑證。連接埠 465 一律加密。 |
| **驗證類型** | `Username and Password`（預設）、`OAuth`，或用於不需登入之轉送伺服器的 `None`。 |
| **OAuth 欄位** | **OAuth 提供者類型**、**OAuth Client ID**、**OAuth Client Secret**、**OAuth 權杖 URL** 和 **OAuth Scope**，在選擇 OAuth 或 Microsoft Graph 後顯示。 |
| **描述** | 給團隊的備註（僅限專案設定）。 |

**Microsoft Graph.** 開啟 **更多欄位**，將 **傳輸** 設為 `Microsoft Graph`，然後填入具有 **Mail.Send** 應用程式權限的 Azure 應用程式資訊：其用戶端 ID 和用戶端密碼、權杖 URL `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` 以及範圍 `https://graph.microsoft.com/.default`。郵件會從 **寄件者電子郵件** 的信箱寄出，該信箱必須是您租用戶中已取得授權的信箱。

> [!NOTE]
> 在 OneUptime Cloud 上，專案的郵件伺服器必須能透過網際網路連線：解析為私人位址或內部位址的主機會被拒絕。在自行託管的安裝中，除非 `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` 為 `true`，否則允許私人位址，但迴路位址和鏈路本機位址一律會被拒絕。執行個體自己的郵件伺服器不會經過這種檢查。

## OAuth 2.0 驗證

OAuth 2.0 讓 OneUptime 不需要密碼就能登入您的郵件伺服器，企業郵件服務也越來越常要求使用它。OneUptime 支援兩種 OAuth 授權類型：

- **Client Credentials**：Microsoft 365 及大多數 OAuth 提供者使用。
- **JWT Bearer**：Google Workspace 服務帳戶使用。

```mermaid title="OneUptime 如何透過 OAuth 登入"
sequenceDiagram
    participant O as OneUptime
    participant T as 權杖 URL
    participant M as 郵件伺服器
    O->>T: 要求存取權杖
    T-->>O: 存取權杖
    Note over O: 快取權杖，<br/>並在到期前重新整理
    O->>M: 使用權杖登入
    O->>M: 寄送電子郵件
```

**驗證類型** 和 OAuth 欄位位於表單伺服器步驟的 **更多欄位** 中。若要透過 OAuth 登入，請填寫：

| 欄位 | 描述 |
| --- | --- |
| **主機名稱** | SMTP 伺服器位址 |
| **連接埠** | SMTP 連接埠（通常 STARTTLS 使用 587，隱含式 TLS 使用 465） |
| **使用者名稱** | 寄送郵件之信箱的電子郵件地址 |
| **驗證類型** | `OAuth` |
| **OAuth 提供者類型** | Microsoft 365 選擇 `Client Credentials`，Google Workspace 選擇 `JWT Bearer` |
| **OAuth Client ID** | 來自 OAuth 提供者的應用程式（用戶端）ID（Google 請填服務帳戶電子郵件） |
| **OAuth Client Secret** | 來自 OAuth 提供者的用戶端密碼（Google 請填私密金鑰） |
| **OAuth 權杖 URL** | 提供者的 OAuth 權杖端點 |
| **OAuth Scope** | 授予 SMTP 存取權的 OAuth 範圍 |

OneUptime 會快取 OAuth 權杖，並在到期前自動重新整理。

## Microsoft 365 設定

若要在 Microsoft 365（Exchange Online）中使用 OAuth，請在 Microsoft Entra 中註冊一個應用程式，授予它透過 SMTP 寄送郵件的權限，並允許它使用寄件信箱。

:::steps
### 在 Microsoft Entra 中註冊應用程式

1. 登入 [Microsoft Entra 系統管理中心](https://entra.microsoft.com)。
2. 前往 **Identity** > **Applications** > **App registrations**，然後點選 **New registration**。
3. 輸入名稱（例如 "OneUptime SMTP"），選擇 "Accounts in this organizational directory only"，並將 **Redirect URI** 留白。
4. 點選 **Register**。

在 **Overview** 頁面上，記下 **Application (client) ID**（您的用戶端 ID）和 **Directory (tenant) ID**（用於權杖 URL）。

### 建立用戶端密碼

1. 在應用程式註冊中，前往 **Certificates & secrets**，然後點選 **New client secret**。
2. 新增描述，選擇到期時間，然後點選 **Add**。
3. **立即複製密碼值**：它不會再次顯示。

### 新增 SMTP 權限

1. 前往 **API permissions**，然後點選 **Add a permission**。
2. 選擇 **APIs my organization uses**，然後搜尋並選擇 **Office 365 Exchange Online**。
3. 選擇 **Application permissions**，勾選 **SMTP.SendAsApp**，然後點選 **Add permissions**。
4. 點選 **Grant admin consent for [your organization]**（需要系統管理員權限）。

### 在 Exchange Online 中註冊服務主體

在應用程式能夠寄送郵件之前，請在 Exchange Online 中註冊其服務主體，並授予它存取寄件信箱的權限：

```powershell
# Install and load the Exchange Online module, then connect
Install-Module -Name ExchangeOnlineManagement -Force
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -Organization <your-tenant-id>

# Register the service principal. Use the Object ID from
# Microsoft Entra > Enterprise Applications > your app (not App Registrations)
New-ServicePrincipal -AppId <application-client-id> -ObjectId <enterprise-app-object-id>

# Give the service principal access to the sending mailbox
Add-MailboxPermission -Identity "sender@yourdomain.com" -User <service-principal-id> -AccessRights FullAccess
```

> [!IMPORTANT]
> 請使用 `Add-MailboxPermission`，而不是 `Add-RecipientPermission`。`Add-RecipientPermission` 只會在收件者上授予 `SendAs`，不足以讓服務主體透過 OAuth 使用 SMTP 寄送郵件，寄送會因驗證或權限錯誤而失敗。

### 在 OneUptime 中建立 SMTP 設定

使用以下設定建立或編輯 SMTP 設定，並將 `<tenant-id>` 替換為您的 **Directory (tenant) ID**：

| 欄位 | 值 |
| --- | --- |
| 主機名稱 | `smtp.office365.com` |
| 連接埠 | `587` |
| 使用者名稱 | 您授權的電子郵件地址（例如 `sender@yourdomain.com`） |
| 驗證類型 | `OAuth` |
| OAuth 提供者類型 | `Client Credentials` |
| OAuth Client ID | 您的 **Application (client) ID** |
| OAuth Client Secret | 您的用戶端密碼值 |
| OAuth 權杖 URL | `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` |
| OAuth Scope | `https://outlook.office365.com/.default` |
| 寄件者電子郵件 | 與使用者名稱相同 |
| 要求 TLS | 開啟 |

然後使用 **傳送測試電子郵件** 進行確認。
:::

## Google Workspace 設定

Google Workspace 需要一個具有全網域委派權限的 **服務帳戶**，由它代表您網域中的使用者寄送郵件。Google 的 SMTP 伺服器不支援 Gmail 使用簡單的 client credentials 流程。

### Google Workspace 的準備工作

- Google Workspace 帳戶。個人 Gmail 帳戶不支援此功能。
- Google Workspace 管理控制台的超級管理員存取權。
- Google Cloud Console 的存取權。

:::steps
### 建立 Google Cloud 專案

1. 前往 [Google Cloud Console](https://console.cloud.google.com)。
2. 點選專案下拉式選單並選擇 **New Project**。
3. 輸入專案名稱，點選 **Create**，然後選擇新專案。

### 啟用 Gmail API

1. 前往 **APIs & Services** > **Library**。
2. 搜尋 "Gmail API"，點選 **Gmail API**，然後點選 **Enable**。

### 建立服務帳戶

1. 前往 **APIs & Services** > **Credentials**。
2. 點選 **Create Credentials** > **Service account**。
3. 輸入名稱和描述，點選 **Create and Continue**，略過選用的步驟，然後點選 **Done**。

### 建立服務帳戶金鑰

1. 點選您剛建立的服務帳戶，然後前往 **Keys** 分頁。
2. 點選 **Add Key** > **Create new key**，選擇 **JSON**，然後點選 **Create**。
3. 妥善保存下載的 JSON 檔案。其中的 `client_email` 是您的 OAuth Client ID，`private_key` 是您的 OAuth Client Secret。

### 啟用全網域委派

1. 在服務帳戶詳細資料中，點選 **Show Advanced Settings**。
2. 記下數字形式的 **Client ID**。
3. 勾選 **Enable Google Workspace Domain-wide Delegation**，然後點選 **Save**。

### 在 Google Workspace 管理控制台中授權服務帳戶

1. 登入 [Google Workspace 管理控制台](https://admin.google.com)。
2. 前往 **Security** > **Access and data control** > **API Controls**，然後點選 **Manage Domain Wide Delegation**。
3. 點選 **Add new**，輸入上一個步驟中數字形式的 **Client ID**，並在 **OAuth Scopes** 中輸入 `https://mail.google.com/`。
4. 點選 **Authorize**。

委派可能需要幾分鐘到 24 小時才會生效。

### 為 Google Workspace 建立 SMTP 設定

使用以下設定建立或編輯 SMTP 設定：

| 欄位 | 值 |
| --- | --- |
| 主機名稱 | `smtp.gmail.com` |
| 連接埠 | `587` |
| 使用者名稱 | 用來寄送郵件的 Google Workspace 電子郵件地址（例如 `notifications@yourdomain.com`）。服務帳戶會模擬這個使用者。 |
| 驗證類型 | `OAuth` |
| OAuth 提供者類型 | `JWT Bearer` |
| OAuth Client ID | 服務帳戶 JSON 中的 `client_email`（例如 `your-service@your-project.iam.gserviceaccount.com`） |
| OAuth Client Secret | 服務帳戶 JSON 中的 `private_key`（包括 `-----BEGIN PRIVATE KEY-----` 和 `-----END PRIVATE KEY-----` 在內的完整金鑰） |
| OAuth 權杖 URL | `https://oauth2.googleapis.com/token` |
| OAuth Scope | `https://mail.google.com/` |
| 寄件者電子郵件 | 與使用者名稱相同 |
| 要求 TLS | 開啟 |

然後使用 **傳送測試電子郵件** 進行確認。
:::

> [!IMPORTANT]
> 對於 Google（JWT Bearer），**OAuth Client ID** 是 **服務帳戶電子郵件**（`client_email`），而不是數字形式的 `client_id`。服務帳戶會模擬 **使用者名稱** 中的使用者來寄送郵件。

## 疑難排解

### Microsoft 365 錯誤

| 問題 | 解決方式 |
| --- | --- |
| "Authentication unsuccessful" | 確認服務主體已在 Exchange 中註冊並具有信箱權限 |
| "AADSTS700016: Application not found" | 檢查用戶端 ID 是否正確，以及應用程式是否存在於您的租用戶中 |
| "AADSTS7000215: Invalid client secret" | 建立新的用戶端密碼；舊的可能已到期 |
| "The mailbox is not enabled for this operation" | 執行 `Add-MailboxPermission` 授予信箱存取權 |

### Google Workspace 錯誤

| 問題 | 解決方式 |
| --- | --- |
| "invalid_grant" | 確認全網域委派已正確設定並已生效 |
| "unauthorized_client" | 確認用戶端 ID 已在 Google Workspace 管理控制台中獲得授權 |
| "access_denied" | 檢查範圍 `https://mail.google.com/` 是否已獲得授權 |
| "Domain policy has disabled third-party Drive apps" | 在 Google Workspace 管理控制台的 Security > API Controls 中啟用 API 存取 |

### 其他問題

:::details "Cannot send email. Please check your SMTP config."
使用使用者名稱和密碼登入或不需登入的伺服器不接收郵件時，**傳送測試電子郵件** 會顯示這則訊息。請檢查 **主機名稱**、**連接埠**、**使用者名稱** 和 **密碼**。如果您的伺服器不提供 TLS，或其憑證對其主機名稱無效，請在 **更多欄位** 中關閉 **要求 TLS** 後再試一次。伺服器本身的回應會隨測試一起保存：開啟 **專案設定 > 通知 > 通知日誌** 的 **電子郵件** 分頁，然後在對應的列上選擇 **檢視狀態訊息**。
:::

:::details "Cannot send email with OAuth authentication"
OAuth 登入失敗，訊息結尾附有提供者傳回的錯誤。請檢查 **OAuth Client ID**、**OAuth Client Secret**、**OAuth 權杖 URL** 和 **OAuth Scope**，確認應用程式具有上述權限，且已授予系統管理員同意。如果您的 Microsoft 365 租用戶已關閉 SMTP AUTH，請改為將 **傳輸** 設為 `Microsoft Graph`。
:::

:::details "Microsoft Graph send failed"
**傳輸** 為 `Microsoft Graph` 的設定在 Graph 不接收郵件時會顯示這則訊息，後面接著 Microsoft 本身的錯誤。請確認應用程式具有已授予系統管理員同意的 **Mail.Send** 應用程式權限、**OAuth Scope** 為 `https://graph.microsoft.com/.default`，且 **寄件者電子郵件** 是您租用戶中已取得授權的信箱。
:::

:::details "SMTP server host … could not be reached"
OneUptime 拒絕連線到專案的郵件伺服器。在 OneUptime Cloud 上，無法解析的主機名稱，或解析為私人、迴路或鏈路本機位址的主機名稱，都會以這則訊息被拒絕，而且訊息不會說明屬於哪種情況：請使用郵件伺服器的公開主機名稱。在自行託管的安裝中，以及對於以 IP 位址指定的郵件伺服器，訊息會改為說明原因。**傳送測試電子郵件** 只會對 OAuth 設定顯示這則訊息；對於其他設定，請在通知日誌的 **電子郵件** 分頁中透過 **檢視狀態訊息** 查看。
:::

:::details 測試郵件沒有送達
檢查 **寄件者電子郵件**：您的伺服器必須允許從該地址寄送郵件。接著查看收件者的垃圾郵件資料夾，以及郵件伺服器記錄中的寄送嘗試。
:::

## 安全性最佳做法

- **定期輪替密碼。** 設定提醒，在用戶端密碼到期前進行輪替。
- **使用專用的認證。** 為 OneUptime 建立獨立的認證，而不是與其他應用程式共用。
- **授予最低權限。** 只授予寄送所需的權限：Microsoft 為 **SMTP.SendAsApp**，Google 為範圍 `https://mail.google.com/`。
- **監控使用情況。** 檢閱郵件記錄和 OAuth 應用程式的登入紀錄，留意異常活動。
- **安全地保存密碼。** 切勿將用戶端密碼提交到版本控制系統。

## 延伸閱讀

- Microsoft：[Authenticate an IMAP, POP or SMTP connection using OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
- Microsoft：[Register an application with Microsoft identity platform](https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)
- Google：[Using OAuth 2.0 for Server to Server Applications](https://developers.google.com/identity/protocols/oauth2/service-account)
- Google：[Gmail API Documentation](https://developers.google.com/gmail/api)
- Google：[XOAUTH2 Protocol](https://developers.google.com/gmail/imap/xoauth2-protocol)

## 後續步驟

:::cards
- [通知彙總](/docs/emails/notification-rollup): OneUptime 如何合併一連串寄給擁有者的郵件。
- [訂閱者與公告](/docs/status-pages/subscribers): 使用專案的 SMTP 設定寄送郵件給狀態頁面訂閱者。
:::
