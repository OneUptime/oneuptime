# SSO

單一登入（SSO）讓專案中的人員透過組織的身分提供者（IdP），使用 SAML 2.0 或 OpenID Connect 登入 OneUptime。您可以在同一個地方管理存取權限、密碼和多重要素驗證，也可以要求專案中的所有人都使用 SSO。

> [!NOTE]
> **版本：** SSO（包括「Require SSO to sign in」）屬於 OneUptime 的所有版本：自行託管的安裝在 Community Edition 中即可使用，不需要授權。在 OneUptime Cloud 上，**Scale** 及以上方案可用。各版本包含哪些功能，請參閱 [企業版](/docs/self-hosted/enterprise)。

:::cards
- [設定 SAML 提供者](#設定-sso): 在 OneUptime 中建立它，並把兩個 URL 交給您的 IdP。
- [身分提供者指南](#身分提供者指南): Keycloak、Microsoft Entra ID 和 Okta 的逐步說明。
- [OpenID Connect](#openid-connect-oidc): 改為透過 OIDC 應用程式登入。
- [要求使用 SSO](#為專案要求使用-sso): 讓 SSO 成為進入專案的唯一方式。
:::

## SAML 登入的運作方式

一個 SAML 提供者會把一個專案連接到身分提供者中的一個應用程式。登入的人在 OneUptime 的 **使用 SSO 登入** 頁面上選擇專案，在您的 IdP 登入，然後以已登入狀態返回。

```mermaid title="SAML 登入的步驟"
sequenceDiagram
    actor U as 使用者
    participant O as OneUptime
    participant I as 身分提供者
    U->>O: 使用 SSO 登入，選擇專案
    O->>I: 向登入 URL 傳送 SAML 請求
    I->>U: 登入頁面
    U->>I: 認證資料和 MFA
    I->>O: 向 Reply URL<br/>傳送已簽章的斷言
    Note over O: 檢查簽章和簽發者，<br/>從 Name ID 讀取電子郵件
    O->>U: 已登入專案
```

OneUptime 只會從您的 IdP 傳送的斷言中讀取少量內容：

| 斷言中的內容 | OneUptime 如何處理 |
| --- | --- |
| 簽章 | 使用提供者的 **公開憑證** 進行驗證。回應必須已簽章，且不得加密。 |
| Issuer | 必須與提供者的 **簽發者** 完全一致。 |
| Audience | 必須是提供者的 **識別碼（Entity ID）**。您的 IdP 為其他應用程式建立的回應會被拒絕。 |
| Recipient 和 Destination | 必須是提供者的 **回覆 URL**，也就是回應被傳送到的位址。 |
| `NotBefore` 和 `NotOnOrAfter` | 只有在它們允許的時間內，且不晚於簽發後 10 分鐘，回應才會被接受；並為不一致的時鐘保留 3 分鐘的寬限。 |
| Name ID | 此人的電子郵件地址。必須是有效的電子郵件地址。 |
| 姓名屬性 | 此人的姓名，在 OneUptime 建立其帳戶時使用：顯示名稱（`displayName` 或 `http://schemas.microsoft.com/identity/claims/displayname`），或名字和姓氏（`firstName` 和 `lastName`，或 Microsoft Entra ID 預設傳送的 `givenname` 和 `surname` 宣告）。選填。 |
| `http://schemas.microsoft.com/identity/claims/objectidentifier` | 此人的物件 ID，Microsoft Entra ID 預設會傳送。透過該提供者的首次登入會把帳戶連結到此物件 ID；之後若有登入使用該帳戶的電子郵件地址，卻帶有另一個物件 ID，就會被拒絕。選填。 |

每個回應只能登入一次。再次傳送的回應（例如登入後在瀏覽器中返回上一頁）會被拒絕：請重新登入。

首次登入的人會加入該提供者的 **團隊**，這些團隊決定了他們能做什麼：請參閱 [SSO 使用者的角色和團隊](#sso-使用者的角色和團隊)。

> [!NOTE]
> 在 OneUptime Cloud 上，當某人首次透過專案的某個 SAML 或 OIDC 提供者登入該專案時，OneUptime 不會直接讓其登入，而是透過電子郵件寄送一個連結給此人。此人開啟連結，確認專案的單一登入可以為其登入，然後繼續登入。該連結在 24 小時內有效。這在每個專案中只會發生一次；如果此人離開專案後又回來，則會再次發生。自行託管的安裝會直接讓人登入。在 OneUptime Cloud 上，凡是沒有直接完成的登入，無論該地址是否有帳戶，都會得到同樣的回應：還沒有帳戶的人也會收到這封郵件，並在確認時建立帳戶；被封鎖的帳戶或 OneUptime 管理員則不會收到郵件。自行託管的安裝則會用同一則訊息拒絕這兩種情況。

在 OneUptime Cloud 上，透過 SSO 加入專案的人會占用一個席位，就像您邀請的人一樣。如果您的方案包含固定數量的席位且已全部占用，在有席位空出之前，新成員無法透過 SSO 加入。

## 設定 SSO

您需要新增 SSO 提供者的權限（**專案擁有者**、**專案管理員** 或 **Create Project SSO**），在 OneUptime Cloud 上還需要 **Scale** 方案。身分提供者端的設定請參閱 [身分提供者指南](#身分提供者指南)。

:::steps
1. **前往專案設定**

   - 進入您的 OneUptime 專案
   - 前往 **專案設定** > **安全性** > **SSO**

2. **建立 SSO 設定**

   - 按一下 **新增 SAML 提供者**
   - 輸入 SSO 設定的 **名稱**（例如 "Keycloak SAML" 或 "Okta SAML"）
   - 輸入身分提供者的 **登入 URL**
   - 輸入身分提供者的 **簽發者**（實體 ID）
   - 貼上身分提供者的 **公開憑證**
   - 在 **登入** 步驟中，**團隊** 預設為專案的成員團隊：首次登入的人會加入這些團隊。只接受您自己可以邀請他人加入的團隊：授予的存取權限超出您自身權限的團隊會在 **團隊** 下方註明
   - 其餘內容已在 **更多欄位** 中填好：**簽章方法**（`RSA-SHA256`）、**摘要方法**（`SHA256`）以及描述（「Sign in with」加上名稱）。僅在您的身分提供者需要時才變更它們

3. **取得 OneUptime 的 SSO 中繼資料**
   - 儲存後會開啟 **SSO 設定** 對話方塊。也可以透過 **檢視 SSO 設定** 按鈕再次開啟
   - 複製 **識別碼（Entity ID）**，例如 `https://oneuptime.com/<project-id>/<provider-id>`，IdP 設定中需要它
   - 複製 **回覆 URL（判斷提示取用者服務 URL）**，例如 `https://oneuptime.com/identity/idp-login/<project-id>/<provider-id>`，IdP 設定中需要它
   - 新的提供者預設為關閉狀態。在 IdP 設定好這兩個值後，請編輯該提供者並開啟 **已啟用**

4. **測試提供者**
   - 開啟 **SSO 登入連結** 卡片中的連結，並在開啟的頁面上選擇該提供者。您會被帶到身分提供者的登入頁面，然後以已登入狀態返回 OneUptime
   - 確認可以正常使用後，您就可以為專案 [要求使用 SSO](#為專案要求使用-sso)
:::

## 身分提供者指南

選擇您的身分提供者。每份指南都會取得 IdP 的值，在 OneUptime 中建立提供者，然後把 OneUptime 的 **識別碼（Entity ID）** 和 **回覆 URL** 交給 IdP。

:::tabs
@tab Keycloak
Keycloak 是一款熱門的開放原始碼身分與存取管理解決方案。您需要一個具有 realm 且正在執行的 Keycloak 執行個體，以及 Keycloak 和 OneUptime 的管理員存取權限。

:::steps
1. **收集 realm 的值**

   - **登入 URL**：`https://<your-keycloak-domain>/auth/realms/<your-realm>/protocol/saml`
   - **簽發者**：`https://<your-keycloak-domain>/auth/realms/<your-realm>`
   - **憑證**：realm 的簽章憑證。開啟 `https://<your-keycloak-domain>/auth/realms/<your-realm>/protocol/saml/descriptor` 並複製 `X509Certificate` 的值，或開啟 **Realm settings** > **Keys**，按一下 RS256 金鑰的 **Certificate**

   Keycloak 17 及更新版本提供的這些 URL 不帶 `/auth` 前置詞。請把憑證放在各自獨立的行之間，如下所示：

   ```text
   -----BEGIN CERTIFICATE-----
   MIICnzCCAYcCBgFyPZ8QFzANBgkqhkiG.......
   -----END CERTIFICATE-----
   ```

2. **在 OneUptime 中建立提供者**

   前往 **專案設定** > **安全性** > **SSO**，按一下 **新增 SAML 提供者** 並填寫：
   - **名稱**：一個描述性的名稱（例如 `my-project-oneuptime`）
   - **登入 URL** 和 **簽發者**：上面的值
   - **公開憑證**：憑證，放在各自獨立的 `BEGIN CERTIFICATE` 行和 `END CERTIFICATE` 行之間
   - **簽章方法** 和 **摘要方法**：已在 **更多欄位** 中設定好（`RSA-SHA256` 和 `SHA256`）

   儲存，然後從開啟的對話方塊中複製 **識別碼（Entity ID）** 和 **回覆 URL（判斷提示取用者服務 URL）**。

3. **建立 Keycloak 用戶端**

   在 Keycloak 中開啟您 realm 的 **Clients**，建立一個用戶端或編輯現有的用戶端：
   - **Client Protocol**（用戶端類型）：`saml`
   - **Client ID**：OneUptime 的 **識別碼（Entity ID）**
   - **Root URL** 和 **Valid Redirect URIs**：您的 OneUptime URL
   - **Assertion Consumer Service POST Binding URL**：OneUptime 的 **回覆 URL（判斷提示取用者服務 URL）**

4. **調整用戶端設定**

   - 將 **Name ID Format** 設為 `email`，並開啟 **Force Name ID Format**，讓 Keycloak 一律以電子郵件作為 Name ID 傳送
   - 在用戶端的 **Keys** 分頁上，關閉 **Client signature required**（位於 **Signing keys config** 中）：OneUptime 不會為其登入請求簽章

5. **開啟提供者並進行測試**

   在 OneUptime 中編輯提供者並開啟 **已啟用**，然後開啟 **SSO 登入連結** 卡片中的連結並選擇該提供者。您應該會被帶到 Keycloak 登入頁面，然後返回 OneUptime。
:::
@tab Microsoft Entra ID
Microsoft Entra ID（舊稱 Azure AD / Active Directory）是 Microsoft 的雲端身分服務。您需要一個支援使用 SAML SSO 之企業應用程式的租用戶，以及 Entra ID 和 OneUptime 的管理員存取權限。在 OneUptime Cloud 上，如果 Microsoft Entra 應用程式庫中列出了 OneUptime，請從那裡新增：它已內建 OneUptime 讀取的宣告，以及 OneUptime 各個 URL 的格式。

:::steps
1. **在 Entra ID 中建立企業應用程式**

   - 登入 [Microsoft Entra admin center](https://entra.microsoft.com)
   - 前往 **Identity** > **Applications** > **Enterprise applications**，按一下 **+ New application**
   - 從應用程式庫新增：搜尋 OneUptime，選取它，然後按一下 **Create**
   - 否則：按一下 **+ Create your own application**，輸入名稱（例如 "OneUptime"），選擇 **Integrate any other application you don't find in the gallery (Non-gallery)**，然後按一下 **Create**

2. **複製 Entra ID 的 SAML 值**

   - 在應用程式中前往 **Single sign-on** 並選擇 **SAML**
   - 在 **SAML Certificates** 中下載 **Certificate (Base64)**，用文字編輯器開啟該檔案並複製其內容
   - 在 **Set up OneUptime** 中複製 **Login URL** 和 **Microsoft Entra Identifier**（在較舊的租用戶中為 **Azure AD Identifier**）

3. **在 OneUptime 中建立提供者**

   前往 **專案設定** > **安全性** > **SSO**，按一下 **新增 SAML 提供者** 並填寫：
   - **名稱**：一個描述性的名稱（例如 `Azure AD SAML`）
   - **登入 URL**：**Login URL**
   - **簽發者**：**Microsoft Entra Identifier**
   - **公開憑證**：Base64 憑證，包括 `BEGIN CERTIFICATE` 行和 `END CERTIFICATE` 行
   - **簽章方法** 和 **摘要方法**：已在 **更多欄位** 中設定好（`RSA-SHA256` 和 `SHA256`）

   儲存，然後從開啟的對話方塊中複製 **識別碼（Entity ID）** 和 **回覆 URL（判斷提示取用者服務 URL）**。

4. **把 OneUptime 的 URL 交給 Entra ID**

   在 **Basic SAML Configuration** 中按一下 **Edit** 並設定：
   - **Identifier (Entity ID)**：OneUptime 的 **識別碼（Entity ID）**
   - **Reply URL (Assertion Consumer Service URL)**：OneUptime 的 **回覆 URL**

   按一下 **Save**。

5. **以 Name ID 傳送電子郵件**

   在 **Attributes & Claims** 中按一下 **Edit**。從應用程式庫新增的應用程式已設定好以下各項，請檢查一遍：
   - 將 **Unique User Identifier (Name ID)** 設為使用者的電子郵件地址：`user.mail`，或在 `user.userprincipalname` 就是電子郵件地址時使用它
   - 將 **Name identifier format** 設為 `Email address`
   - 保留 Entra ID 的預設宣告：新帳戶會從 `givenname` 和 `surname` 取得此人的姓名，帳戶會連結到此人的物件 ID，也就是 `objectidentifier`。選擇性：新增一個名為 `http://schemas.microsoft.com/identity/claims/displayname`、來源屬性為 `user.displayname` 的宣告，改用顯示名稱為新帳戶命名。OneUptime 會忽略其他宣告

6. **指派使用者和群組**

   在應用程式的 **Users and groups** 中按一下 **+ Add user/group**，選擇要授予 SSO 存取權限的使用者和群組，然後按一下 **Assign**。

7. **開啟提供者並進行測試**

   在 OneUptime 中編輯提供者並開啟 **已啟用**，然後開啟 **SSO 登入連結** 卡片中的連結並選擇該提供者。您應該會被帶到 Microsoft 登入頁面，然後返回 OneUptime。
:::
@tab Okta
Okta 是一款廣泛使用、支援 SAML SSO 的身分平台。您需要一個具有管理員存取權限的 Okta 組織，以及 OneUptime 的管理員存取權限。在 OneUptime Cloud 上，如果 Okta Integration Network 中列出了 OneUptime，請從那裡新增：它讓使用者既可以從 OneUptime 的 **使用 SSO 登入** 頁面登入，也可以從其 Okta 儀表板登入，會在首次登入時為其建立帳戶，而且只要求填寫兩個 ID，而不是 OneUptime 的 URL。

:::steps
1. **將 OneUptime 新增到 Okta**

   - 在 Okta Admin Console 中前往 **Applications** > **Applications**
   - 從 Okta Integration Network 新增：按一下 **Browse App Catalog**，搜尋 OneUptime，然後按一下 **Add Integration**。Okta 會在 OneUptime 能顯示 **OneUptime Project ID** 和 **OneUptime SSO Provider ID** 之前就要求填寫它們：暫時在兩者中都輸入 `0`，您會在步驟 4 中替換它們。按一下 **Done**，然後繼續步驟 2
   - 否則，按一下 **Create App Integration**，選擇 **SAML 2.0** 並按一下 **Next**，在 **App name** 中輸入 "OneUptime"，然後按一下 **Next**
   - Okta 會在顯示自己的 URL 之前先要求填寫 OneUptime 的 URL。暫時把您的 OneUptime 位址（例如 `https://oneuptime.com`）填入 **Single sign-on URL** 和 **Audience URI (SP Entity ID)**：您會在步驟 4 中替換這兩個值
   - 將 **Name ID format** 設為 `EmailAddress`，將 **Application username** 設為 `Email`
   - 按一下 **Next**，選擇 **I'm an Okta customer adding an internal app**，然後按一下 **Finish**

2. **複製 Okta 的 SAML 值**

   在應用程式的 **Sign On** 分頁上，在 **SAML Signing Certificates** 中找到使用中的憑證：
   - 按一下 **Actions** > **View IdP metadata**，複製 **登入 URL**（Identity Provider Single Sign-On URL）和 **簽發者**（Identity Provider Issuer）
   - 按一下 **Actions** > **Download certificate**，用文字編輯器開啟 `.cert` 檔案並複製其內容

3. **在 OneUptime 中建立提供者**

   前往 **專案設定** > **安全性** > **SSO**，按一下 **新增 SAML 提供者** 並填寫：
   - **名稱**：一個描述性的名稱（例如 `Okta SAML`）
   - **登入 URL** 和 **簽發者**：Okta 的值
   - **公開憑證**：憑證，包括 `BEGIN CERTIFICATE` 行和 `END CERTIFICATE` 行
   - **簽章方法** 和 **摘要方法**：已在 **更多欄位** 中設定好（`RSA-SHA256` 和 `SHA256`）

   儲存，然後從開啟的對話方塊中複製 **識別碼（Entity ID）** 和 **回覆 URL（判斷提示取用者服務 URL）**。

4. **把 OneUptime 的 URL 交給 Okta**

   對於從 Okta Integration Network 新增的應用程式，在 **General** 分頁上按一下 **App Settings** 中的 **Edit**，然後設定：
   - **OneUptime Project ID** 和 **OneUptime SSO Provider ID**：OneUptime 的 **識別碼（Entity ID）** `https://oneuptime.com/<project-id>/<provider-id>` 中的兩個 ID

   按一下 **Save**，並在 **Sign On** 分頁上檢查 **Application username format** 是否為 `Email`。

   對於您自己建立的應用程式，在 **General** 分頁上按一下 **SAML Settings** 中的 **Edit** 和 **Next**，然後設定：
   - **Single sign-on URL**：OneUptime 的 **回覆 URL（判斷提示取用者服務 URL）**
   - **Audience URI (SP Entity ID)**：OneUptime 的 **識別碼（Entity ID）**

   選擇性：新增 attribute statement `firstName`（值為 `user.firstName`）和 `lastName`（值為 `user.lastName`），讓新帳戶取得此人的姓名。按一下 **Next**，然後按一下 **Finish**。

5. **指派人員**

   在 **Assignments** 分頁上按一下 **Assign** > **Assign to People** 或 **Assign to Groups**，選擇要授予 SSO 存取權限的人，為每個人按一下 **Assign**，然後按一下 **Done**。

6. **開啟提供者並進行測試**

   在 OneUptime 中編輯提供者並開啟 **已啟用**，然後開啟 **SSO 登入連結** 卡片中的連結並選擇該提供者。您應該會被帶到 Okta 登入頁面，然後返回 OneUptime。
:::
@tab 其他
OneUptime 的 SSO 使用 SAML 2.0，可與任何相容的身分提供者搭配使用：

:::steps
1. 取得身分提供者的 **登入 URL**（其 SSO 端點）、**簽發者**（其實體 ID）和 **公開憑證**（其 X.509 簽章憑證）。如果您的 IdP 只有在應用程式存在後才顯示這些值，請先用您的 OneUptime 位址作為暫時 URL 建立應用程式。
2. 在 OneUptime 中用這些值建立提供者，並從 **SSO 設定** 對話方塊（或 **檢視 SSO 設定**）中複製 **識別碼（Entity ID）** 和 **回覆 URL（判斷提示取用者服務 URL）**。
3. 在身分提供者的 SAML 應用程式中，將 **Assertion Consumer Service URL / Reply URL** 和 **Entity ID / Audience URI** 設為 OneUptime 的值，並將 **Name ID Format** 設為電子郵件地址。
4. **簽章方法**（`RSA-SHA256`）和 **摘要方法**（`SHA256`）已在 **更多欄位** 中設定好；僅在您的身分提供者使用不同的簽章方式時才變更它們
5. 為提供者開啟 **已啟用**，並使用 **SSO 登入連結** 卡片中的連結進行測試。
:::
:::

## OpenID Connect (OIDC)

專案也可以透過 OpenID Connect 提供者登入，例如 Google Workspace、Okta、Microsoft Entra ID、Auth0 或 Keycloak。您需要新增 OIDC 提供者的權限（**專案擁有者**、**專案管理員** 或 **Create Project OIDC**），在 OneUptime Cloud 上還需要 **Scale** 方案。

:::steps
1. 在身分提供者中註冊一個可以使用帶有 PKCE 之授權碼流程的應用程式（OIDC 用戶端），並複製其 **簽發者 URL**、**用戶端 ID** 和 **用戶端密鑰**。
2. 在 OneUptime 中前往 **專案設定** > **安全性** > **SSO**，在 SAML 提供者下方按一下 **新增 OIDC 提供者**。
3. 輸入 **名稱**（使用者在登入頁面上看到的名稱）、**簽發者 URL**、**用戶端 ID** 和 **用戶端密鑰**。也可以改為把提供者的探索 URL 貼到 **簽發者 URL** 中。
4. 在 **登入** 步驟中，**團隊** 預設為專案的成員團隊：首次登入的人會加入這些團隊。其餘內容已在 **更多欄位** 中填好：**探索 URL**（簽發者後接 `/.well-known/openid-configuration`）、**範圍**（`openid email profile`）、`email` 和 `name` 宣告名稱，以及描述（「Sign in with」加上名稱）。僅在您的提供者需要時才變更它們。只接受您自己可以邀請他人加入的團隊：授予的存取權限超出您自身權限的團隊會在 **團隊** 下方註明。
5. 儲存。**OIDC 設定** 對話方塊會開啟並顯示 **Redirect URI**：請把它加入應用程式允許的重新導向 URI。新的提供者預設為關閉狀態，因此接著請編輯它並開啟 **已啟用**。
6. 在為專案要求使用 SSO 之前，開啟 **SSO 登入連結** 卡片中的連結並選擇該提供者，透過它登入一次。
:::

## 同時登出身分提供者

登出 OneUptime 後，使用者在身分提供者那裡仍保持登入。因此在共用電腦上，例如 NOC 螢幕或資訊站，下一個在登入頁面選擇該提供者的人，會以離開的那個人的身分進入。在 SAML 或 OIDC 提供者的 **更多欄位** 下開啟 **同時登出身分提供者**，即可在有人登出 OneUptime 時，也結束其在提供者那裡的工作階段。此設定預設為關閉：在個人筆電上，它也會讓使用者登出所有使用該提供者的其他應用程式。它適用於開啟後在瀏覽器中登入的人；行動應用程式只登出 OneUptime。

:::tabs
@tab SAML
在 **更多欄位** 下，將身分提供者的登出 URL 填為提供者的 **登出 URL**：沒有它就無法開啟此開關。接著將 **SSO 設定** 對話方塊中的 **單一登出 URL**，以及 OneUptime 用來簽署其登出要求的憑證提供給身分提供者；憑證可在同一對話方塊的 **下載簽署憑證** 取得。

| 身分提供者 | 登出 URL | 單一登出 URL 與憑證要填在哪裡 |
| --- | --- | --- |
| Okta | **Sign On** 索引標籤 **View SAML setup instructions** 中的 **Identity Provider Single Logout URL** | 在 **General** 索引標籤編輯 **SAML Settings**，按一下 **Show Advanced Settings** 並選取 **Allow application to initiate Single Logout**。將 **Single Logout URL** 設為單一登出 URL，將 **SP Issuer** 設為識別碼（Entity ID），並將憑證上傳為 **Signature Certificate**。 |
| Microsoft Entra ID | **Set up OneUptime** 中的 **Logout URL** | 在 **Basic SAML Configuration** 中，將 **Logout Url (Optional)** 設為單一登出 URL。Entra ID 不需要憑證。 |
| Keycloak | 領域的 SAML 端點，與登入 URL 相同 | 在用戶端的 **Advanced** 索引標籤，將 **Logout Service Redirect Binding URL** 設為單一登出 URL。保持 **Front channel logout** 開啟。只要 **Client signature required** 如上文設定保持關閉，Keycloak 就不需要憑證。 |

在那裡登出後，身分提供者會將瀏覽器送回單一登出 URL，由它開啟登入頁面，或提示身分提供者未確認此次登出。當使用者在身分提供者那裡，或在使用它的其他應用程式中登出時，會向其應用程式傳送登出要求的身分提供者（例如 Keycloak 與 Microsoft Entra ID）也會讓其登出 OneUptime。OneUptime 只接受身分提供者簽署的要求。
@tab OpenID Connect
OneUptime 讓瀏覽器登出後，瀏覽器會前往提供者自己的登出頁面，提供者再將它送回 OneUptime 登入頁面。請在提供者那裡註冊該頁面：**OIDC 設定** 對話方塊會將其顯示為登出後的重新導向 URI，提供者稱之為 post-logout redirect URI。像 Google 這樣探索文件中沒有 `end_session_endpoint` 的提供者無法開啟此設定。

| 身分提供者 | 在哪裡註冊登出後的重新導向 URI |
| --- | --- |
| Okta | 在應用程式整合的 **General** 索引標籤，按一下 **General Settings** 中的 **Edit**，將其加入 **Sign-out redirect URIs**。 |
| Microsoft Entra ID | 在應用程式註冊的 **Authentication** 中，將其加入 **Web** 平台的 **Redirect URIs**。**Front-channel logout URL** 是另一項設定，OneUptime 不使用。 |
| Auth0 | 在應用程式的 **Settings** 中，將其加入 **Allowed Logout URLs**。2023 年 11 月 14 日之前建立的租用戶，還需要在租用戶的 **Advanced** 設定中開啟 **RP-Initiated Logout End Session Endpoint Discovery**，其探索文件才會列出 `end_session_endpoint`。 |
| Keycloak | 在用戶端設定中，將其加入 **Valid post logout redirect URIs**（Keycloak 19 及更新版本）。 |

未註冊該位址的提供者，會在有人登出 OneUptime 後顯示自己的錯誤頁面，而不是將人送回；但使用者仍已登出 OneUptime。
:::

## SSO 使用者的角色和團隊

OneUptime 不會對應身分提供者中的角色或群組。一個人能做什麼取決於其所在的團隊：提供者會把新來的人加入它的 **團隊**，而團隊及其權限在 OneUptime 中管理，如 [使用者、團隊與權限](/docs/permissions/index) 所述。若要讓團隊成員與身分提供者保持同步，請使用 [SCIM](/docs/identity/scim)。某人登入時加入的每個團隊，都會作為登入者本人的變更記錄在該團隊的 **稽核日誌** 頁面上。

提供者的團隊決定了透過它登入的人能做什麼，因此只有當儲存者本人可以邀請他人加入這些團隊時，提供者才能儲存。每次儲存都會重新檢查：如果提供者的團隊授予的存取權限超出您自身的權限，則只有存取權限能涵蓋這些團隊的人（例如專案擁有者）才能變更它。在此檢查推出之前儲存的提供者會繼續把人登入其團隊。任何可以編輯提供者的人仍然可以關閉它，以便立即停止它。

## 網域

**使用 SSO 登入** 會詢問電子郵件地址，並提供服務該地址網域的提供者。它不會讀取任何帳戶：在您的專案中有帳戶的地址，和完全沒有帳戶的地址，得到的回答都一樣，因此該頁面不會透露誰有帳戶。要在那裡被提供，提供者需要列出它服務的網域：

1. 在 **專案設定** > **進階** > **網域** 中新增您的網域，在其所在列按一下 **驗證網域**，並將顯示的 TXT 記錄加入該網域的 DNS。一旦找到該記錄，網域即通過驗證。
2. 編輯提供者，在 **登入** 步驟的 **網域** 中選擇該網域。只會列出專案中已驗證的網域。

此後，**使用 SSO 登入** 會把該提供者提供給該網域下的每個地址，無論是誰輸入的。網域必須完全一致：`acme.com` 不包含 `eu.acme.com`，因此請新增大家用來登入的每個網域。

在網域功能推出前設定的提供者，在 OneUptime 升級時取得了其專案已驗證的網域：專案驗證過的每個網域，除非另一個專案也驗證了它。如果這樣的網域是您的，請自行選擇。新增了但從未驗證的網域不會給任何提供者。

沒有已驗證網域的提供者在那裡不會提供給任何人。它的 **網域** 欄顯示 **無已驗證網域**，提供者上方的通知會指出它並說明該怎麼做。在專案還沒有已驗證網域時，通知中的 **驗證網域** 會開啟 **網域**。

電子郵件屬於其他網域的人（例如外部協作者）在那裡也找不到提供者。請把專案的 SSO 登入連結分享給他們：從提供者下方的 **SSO 登入連結** 卡片複製。它列出專案的提供者，不詢問電子郵件地址，因此不會透露誰有帳戶。從您的身分提供者發起的登入同樣有效，無論網域為何。

## 為專案要求使用 SSO

設定提供者並不會阻止任何人使用密碼登入。若要讓 SSO 成為進入專案的唯一方式，請使用 **專案設定** > **安全性** > **SSO** 中提供者下方的 **登入時要求使用 SSO** 開關：

:::steps
1. 先使用 **SSO 登入連結** 卡片中的連結測試您的提供者。
2. 開啟 **登入時要求使用 SSO**。OneUptime 會在儲存任何內容之前詢問：從那時起，專案中的每個人（包括您自己）都必須使用 SSO 登入才能開啟專案，任何使用密碼登入的人都會被鎖在專案之外，直到使用 SSO 登入為止。
3. 按一下 **要求使用 SSO** 進行確認。開關會立即儲存，沒有另外的儲存按鈕。
:::

開啟 **登入時要求使用 SSO** 需要一個能把人登入該專案的提供者：專案自己的一個已開啟的 SAML 或 OIDC 提供者，或一個已開啟且能把人登入該專案的全域提供者。沒有這樣的提供者時，OneUptime 會拒絕，並提示先為專案開啟一個提供者並進行測試。如果您選擇專案要求的提供者，它必須是其中之一；之後要求另一個提供者時，也會進行同樣的檢查。

在 **登入時要求使用 SSO** 已開啟時仍以開啟狀態傳送它的儲存，或指定專案已經要求之提供者的儲存，也會以同樣的方式檢查——API、Terraform 等工具在每次儲存時常常會傳送所有設定。因此，當專案沒有能讓人登入的提供者，或它要求的提供者後來被關閉時，這樣的儲存無論還變更了什麼，都會以相同的措辭被拒絕：請先開啟一個提供者、要求另一個提供者，或關閉 **登入時要求使用 SSO**。

新專案也遵循同樣的規則。新專案還沒有自己的提供者，因此在 **登入時要求使用 SSO** 已開啟的情況下建立專案（只有主管理員可以這樣做）需要一個已開啟且能把人登入每個專案的全域提供者；沒有這樣的提供者時，會以相同的措辭被拒絕。請先建立專案，設定並測試其提供者，然後再開啟該開關。

當整個伺服器要求使用 SSO 時（**Admin** > **設定** > **單一登入** > **登入時要求使用 SSO**），建立任何專案也都需要這樣的全域提供者，否則包括建立者在內，沒有人能開啟該專案。沒有這樣的提供者時，建立專案會被拒絕，訊息會請伺服器管理員開啟一個。主管理員仍然可以建立專案。

關閉 **登入時要求使用 SSO** 會在您切換開關時立即儲存，成員可以馬上重新使用密碼進入——除非恰好在同一時刻有人再次開啟它，此時應用程式伺服器最多可能需要一分鐘才能跟上。專案擁有者、專案管理員以及擁有 **Edit Project** 權限的成員可以變更它；其他人看到的開關會處於鎖定狀態，並顯示他們所需的權限。

> [!NOTE]
> 在 OneUptime Cloud 上，要求使用 SSO 需要 **Scale** 方案，而關閉它在任何方案上都可以。低於 Scale 時，**專案設定** > **安全性** > **SSO** 會顯示方案的升級提示；對於 Scale 試用期結束後仍要求使用 SSO 的專案，升級提示下方也會顯示 **登入時要求使用 SSO**，以便將其關閉。再次開啟需要 **Scale**。

### 透過 SSO 管理成員的登入

要求使用 SSO 能把專案的資料擋在你的身分提供者之後，但你的成員仍可以在 OneUptime 中設定密碼、通行密鑰和雙重驗證，而這些是你的專案從不要求的。在 **登入時要求使用 SSO** 開啟期間，它下方的第二個開關 **透過 SSO 管理登入** 可以阻止這一點。

如果某人所屬的每個專案（包括其受邀加入的任何專案）都要求使用 SSO 並開啟了 **透過 SSO 管理登入**，那麼此人的登入就由 SSO 管理。此後他們無法設定密碼、通行密鑰、安全金鑰、驗證器應用程式、備用代碼或雙重驗證，**忘記密碼？** 不會寄連結給他們，他們的 **使用者設定檔** 會顯示其身分提供者，而不再提供這些設定。登入本身沒有任何變化：他們的密碼仍然可以讓他們登入 OneUptime，你的專案也照常要求使用 SSO。

該規則每次都會檢查，因此：

- **所在專案不管理登入的人**：一旦此人成為某個不要求 SSO、或未開啟 **透過 SSO 管理登入** 的專案的成員，或受邀加入這樣的專案，就會拿回自己的設定，其 **使用者設定檔** 會將該專案列為原因。離開該專案後，其登入會再次受到管理。一個帳戶可以屬於多個組織，因此一個組織絕不會替另一個組織的專案做決定。
- **使用不同提供者的專案**：如果某人所在的兩個專案都管理登入，且各自使用自己的身分提供者，此人仍受管理，其設定檔會列出這兩個提供者。
- **主管理員** 始終保留自己的設定。
- **成員之前設定的內容** 會被保留，但你的專案不會使用。伺服器管理員可以在 Admin Dashboard 中此人的 **驗證** 頁面上，透過 **清除登入設定** 將其清除。

**透過 SSO 管理登入** 會在你切換開關時立即儲存，不會刪除任何內容，關閉它會立即把設定還給所有人。能變更 **登入時要求使用 SSO** 的人也能變更它，所需的方案也相同。當 **登入時要求使用 SSO** 關閉時，它會被隱藏，也不會改變任何內容。

## 關閉或刪除提供者

| 您變更的內容 | 透過該提供者登入的人 |
| --- | --- |
| 關閉或刪除它 | 在要求使用 SSO 的地方，下次請求時重新使用 SSO 登入 |
| 新的憑證或用戶端密鑰、其他 URL、新名稱或其他團隊 | 保持登入狀態 |
| 開啟它 | 可以立即透過它登入 |

關閉或刪除 SAML 或 OIDC 提供者，會結束透過它進行的登入。在要求使用 SSO 的專案中（無論是專案本身要求，還是因為整個伺服器要求）：

- 所有透過它登入的人都必須在下次請求時重新使用 SSO 登入，他們開啟的頁面會立即停止接收即時更新。
- 有人在透過它登入後連接的 MCP 用戶端會在該專案中停止運作。請在使用 SSO 登入後重新連接它。
- 重新開啟提供者不會恢復這些登入：使用者需要再次透過它登入。

變更提供者的其他任何內容都會讓所有人保持登入狀態：新的憑證或用戶端密鑰、其他 URL、新名稱或其他團隊。登入在發生時已經過檢查，下一次登入會使用新的設定。

當專案要求使用 SSO 時，OneUptime 會保留一條進入的途徑：您不能關閉或刪除人們可以用來登入該專案的最後一個提供者（包括能把人登入該專案的全域提供者），也不能關閉或刪除專案要求的提供者。請先關閉 **登入時要求使用 SSO**。

開啟提供者後，人們可以立即透過它登入。

當整個伺服器要求使用 SSO 時（**Admin** > **設定** > **單一登入** > **登入時要求使用 SSO**），每個專案都會以同樣的方式保留一條進入的途徑，即使專案本身不要求使用 SSO：請先為它開啟另一個提供者。

全域提供者也遵循同樣的規則：如果對某個全域提供者或其附加專案的變更會讓要求使用 SSO 的專案沒有提供者，該變更會被拒絕，並指出該專案。請參閱 [全域 SSO](/docs/identity/global-sso#關閉或刪除提供者)。

在專案和伺服器都不要求使用 SSO 的地方，關閉提供者會阻止透過它進行新的登入。已經登入的人會保持登入狀態，就像使用密碼登入的人一樣。

## 低於 Scale 方案時保留的提供者

專案仍有的 SAML 或 OIDC 提供者，在 Scale 試用期結束或方案降級後會繼續讓人登入。因此，低於 Scale 時，**SSO** 頁面會在升級提示下方列出專案的提供者（**仍在設定中的 SAML 提供者**、**仍在設定中的 OIDC 提供者**）：

- **關閉** 會立即停止提供者。OneUptime 會先詢問。
- **刪除** 會將其刪除。

新增提供者、變更提供者或重新開啟提供者都需要 **Scale**。誰可以執行每項操作與 Scale 方案下相同：關閉提供者需要編輯它的權限，刪除它需要刪除它的權限。

當專案仍要求使用 SSO 時，其 **SSO** 頁面還會顯示 **登入時要求使用 SSO**：請在關閉最後一個提供者之前先關閉它。在此之前，人們可以用來登入的最後一個提供者無法被關閉或刪除，因此不會有人被鎖在專案之外。

狀態頁面的 **單一登入** 頁面會以同樣的方式，在其 **SAML** 和 **OIDC** 分頁上列出狀態頁面自己的提供者。當狀態頁面仍要求使用 SSO 時，這兩個分頁也會顯示 **登入時要求使用 SSO**：請在關閉其提供者之前先關閉它，否則其私人使用者將完全無法登入。

## 疑難排解

:::details "SSO Config not found"
提供者已關閉，或連結指向的提供者已不存在。新的提供者預設為關閉狀態：請編輯它並開啟 **已啟用**。
:::

:::details "No teams added."
此人尚未加入專案，而提供者沒有可以把此人加入的 **團隊**。請編輯提供者並至少選擇一個團隊，例如專案的成員團隊。
:::

:::details "Issuer URL does not match"
IdP 斷言中的簽發者不是提供者的 **簽發者**。請從 IdP 重新複製它（Keycloak 的 realm URL、**Microsoft Entra Identifier** 或 Okta 的 Identity Provider Issuer），讓兩者完全一致。
:::

:::details "SAML Audience does not match"
回應的 audience 不是此提供者的 **識別碼（Entity ID）**：您的 IdP 是為其他應用程式建立這個回應的。請在 IdP 中將應用程式的 entity ID 設為 **檢視 SSO 設定** 中的 **識別碼（Entity ID）**：在 Keycloak 中為 **Client ID**，在 Entra ID 中為 **Identifier (Entity ID)**，在 Okta 中為 **Audience URI (SP Entity ID)**。僅以 OneUptime 的位址（例如 `https://oneuptime.com`）作為 entity ID 設定的 IdP 仍可繼續使用。
:::

:::details "SAML Recipient does not match"
回應的 recipient 不是此提供者的 **回覆 URL**：回應是傳往另一個位址的。請在 IdP 中將應用程式的 reply URL 設為 **檢視 SSO 設定** 中的 **回覆 URL（判斷提示取用者服務 URL）**：在 Keycloak 中為 **Assertion Consumer Service POST Binding URL**，在 Entra ID 中為 **Reply URL (Assertion Consumer Service URL)**，在 Okta 中為 **Single sign-on URL**。"SAML Destination does not match" 的原因和解決方法相同。
:::

:::details "SAML response has expired"
回應抵達 OneUptime 的時間晚於您的 IdP 允許的時間，或晚於簽發後 10 分鐘：請重新登入。如果反覆發生，表示您的 IdP 或 OneUptime 伺服器的時鐘不準；OneUptime 允許兩者相差最多 3 分鐘。"SAML response is not valid yet" 是同一問題的反方向。
:::

:::details "SAML response was already used"
您的 IdP 的每個回應只能登入一次。登入後在瀏覽器中返回上一頁，或重新載入 IdP 讓您經過的頁面，都會再次傳送同一個回應：請從 OneUptime 或從您的 IdP 重新登入。
:::

:::details "This account is linked to someone else."
Microsoft Entra ID 以某個帳戶的電子郵件地址讓某人登入，而該帳戶已透過此提供者連結到另一個物件 ID：現在 Entra ID 中是另一個人持有這個地址，或此人的 Entra ID 帳戶曾被重新建立。OneUptime 會拒絕這次登入，這樣之後持有該地址的人就無法使用這個帳戶。如果帳戶確實屬於此人，請將其從專案中移除後再重新加入：其下一次登入會把帳戶連結到新的物件 ID。
:::

:::details 登入因簽章或憑證錯誤而失敗
把 IdP 目前的簽章憑證貼到 **公開憑證** 中，包括 `BEGIN CERTIFICATE` 行和 `END CERTIFICATE` 行。對於 Entra ID，請下載 **Base64** 憑證，而不是原始憑證；對於 Okta，請下載使用中的簽章憑證；對於 Keycloak，請下載正確 realm 的憑證。
:::

:::details "Encrypted SAML Responses are not supported"
OneUptime 不會解密斷言。請在 IdP 中關閉該應用程式的斷言加密，讓它傳送未加密的已簽章斷言。
:::

:::details "SAML response did not include a valid email address"
OneUptime 會從 Name ID 讀取電子郵件地址。請將 Name ID 設為使用者的電子郵件：在 Keycloak 中為 **Name ID Format** `email` 加上 **Force Name ID Format**，在 Entra ID 中為 **Unique User Identifier (Name ID)**，在 Okta 中為 **Name ID format** `EmailAddress` 和 **Application username** `Email`。該地址必須與此人的 OneUptime 帳戶一致。
:::

:::details Entra ID: AADSTS700016
Entra ID 中的 **Identifier (Entity ID)** 與 OneUptime 的不一致。請從 **檢視 SSO 設定** 重新複製；兩個值必須完全相同。
:::

:::details Okta: 404，或 audience 不相符
Okta 中的 **Single sign-on URL** 必須與 OneUptime 的 **回覆 URL** 完全一致，**Audience URI** 必須與 OneUptime 的 **識別碼（Entity ID）** 完全一致。請確認兩者都已替換掉暫時的值。
:::

:::details 使用者未指派給應用程式
Entra ID 和 Okta 只會讓指派給應用程式的人登入。請指派該使用者，或指派其所在的群組。
:::

:::details Keycloak: 重新導向迴圈
請檢查正確 realm 中的用戶端上，**Valid Redirect URIs** 和 **Assertion Consumer Service POST Binding URL** 是否已依上文設定。
:::

## 後續步驟

:::cards
- [全域 SSO](/docs/identity/global-sso): 在自行託管的執行個體上為所有專案使用一個身分提供者。
- [SCIM](/docs/identity/scim): 讓身分提供者自動新增和移除人員。
- [使用者、團隊與權限](/docs/permissions/index): 新來的人加入的團隊允許他們做什麼。
:::
