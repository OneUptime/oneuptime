# SSO（單一登入）

OneUptime 支援以 SAML 2.0 為基礎的單一登入（SSO），以進行企業驗證。SSO 讓您的團隊成員能夠使用貴組織的身分提供者（IdP）登入 OneUptime，提供集中式的存取管理與更高的安全性。

## 概觀

SSO 整合提供下列好處：

- **集中式驗證**：使用者以既有的公司認證登入
- **更高的安全性**：善用您 IdP 的多重要素驗證與安全性原則
- **簡化使用者管理**：從既有的身分管理系統管理存取權
- **降低密碼疲勞**：使用者不需要再記住另一組 OneUptime 密碼

## 設定 SSO

1. **前往專案設定**
   - 進入您的 OneUptime 專案
   - 導覽至 **Project Settings** > **Authentication** > **SSO**

2. **建立 SSO 設定**
   - 點選 **Create SSO**
   - 為此 SSO 設定輸入一個 **Name**（例如「Keycloak SAML」或「Okta SAML」）
   - 輸入來自您身分提供者的 **Sign On URL**
   - 輸入來自您身分提供者的 **Issuer**（Entity ID）
   - 貼上來自您身分提供者的 **Public Certificate**
   - 選擇 **Signature Algorithm**（例如 `RSA-SHA-256`）
   - 選擇 **Digest Algorithm**（例如 `SHA256`）

3. **取得 OneUptime SSO 中繼資料**
   - 儲存後，點選 **View SSO Config** 按鈕
   - 複製 **Identifier (Entity ID)** — 在您的 IdP 設定中會用到此項
   - 複製 **Reply URL (Assertion Consumer Service URL)** — 在您的 IdP 設定中會用到此項

## Keycloak SAML 設定

Keycloak 是熱門的開源身分與存取管理解決方案。請依照下列步驟，將 Keycloak 設定為 OneUptime 的 SAML 身分提供者。

### 先決條件

- 一個已設定 realm 且正在執行的 Keycloak 執行個體
- 同時具有 Keycloak 與 OneUptime 的管理員存取權
- 支援 SSO 的 OneUptime 帳號

### 步驟 1：設定 OneUptime SSO

1. 登入您的 OneUptime 儀表板
2. 導覽至 **Project Settings** > **Authentication** > **SSO**
3. 點選 **Create SSO** 並填寫下列內容：
   - **Name**：具描述性的名稱（例如 `my-project-oneuptime`）
   - **Sign On URL**：`https://<your-keycloak-domain>/auth/realms/<your-realm>/protocol/saml`
   - **Issuer**：`https://<your-keycloak-domain>/auth/realms/<your-realm>`
   - **Certificate**：請參閱下方的[步驟 2](#step-2-get-the-keycloak-certificate)
   - **Signature Algorithm**：`RSA-SHA-256`
   - **Digest Algorithm**：`SHA256`
4. 儲存此設定

### 步驟 2：取得 Keycloak 憑證

1. 在 Keycloak 中，導覽至您的用戶端設定
2. 點選 **Export**（或視您的 Keycloak 版本而前往 **Keys** 分頁）
3. 在匯出的 JSON 檔案中，找出名稱含有 `certificate` 的金鑰
4. 複製憑證值並以下列格式貼入 OneUptime：

```
-----BEGIN CERTIFICATE-----
MIICnzCCAYcCBgFyPZ8QFzANBgkqhkiG.......
-----END CERTIFICATE-----
```

### 步驟 3：設定 Keycloak 用戶端

1. 在 Keycloak 中，導覽至您 realm 內的 **Clients**
2. 建立新的用戶端，或編輯既有的用戶端
3. 將 **Client Protocol** 設為 `saml`
4. 將 **Client ID** 設為 OneUptime **View SSO Config** 中的 **Identifier (Entity ID)** 值
5. 將 **Valid Redirect URIs** 設為您的 OneUptime URL
6. 將 **Root URL** 設為您的 OneUptime 基礎 URL
7. 將 OneUptime 的 **Reply URL (Assertion Consumer Service URL)** 貼入 **Assertion Consumer Service POST Binding URL** 欄位

### 步驟 4：設定 Keycloak 用戶端設定值

1. 停用 **Signing keys config**（位於 Keys 分頁下）
2. 將 **Name ID Format** 設為 `email`
3. 確認已啟用 **Force Name ID Format** 選項，讓 Keycloak 一律以電子郵件作為 Name ID 傳送

### 步驟 5：驗證設定

1. 在 Keycloak 與 OneUptime 中儲存所有設定
2. 嘗試使用 SSO 登入 OneUptime
3. 您應會被重新導向至您的 Keycloak 登入頁面，並在成功驗證後返回 OneUptime

### Keycloak 疑難排解

- **登入因簽章錯誤而失敗**：確認憑證已正確複製，包含 `BEGIN CERTIFICATE` 與 `END CERTIFICATE` 兩行
- **Name ID 錯誤**：確認 Keycloak 中的 **Name ID Format** 已設為 `email`
- **重新導向迴圈**：檢查 **Valid Redirect URIs** 與 **Assertion Consumer Service POST Binding URL** 是否已正確設定
- **找不到憑證**：請確認您是從正確 realm 中的正確用戶端進行匯出

---

## Microsoft Entra ID（前稱 Azure AD / Active Directory）SAML 設定

Microsoft Entra ID 是 Microsoft 以雲端為基礎的身分與存取管理服務。請依照下列步驟，將 Entra ID 設定為 OneUptime 的 SAML 身分提供者。

### 先決條件

- Microsoft Entra ID 租用戶（任何支援具 SAML SSO 之企業應用程式的層級）
- 同時具有 Microsoft Entra ID 與 OneUptime 的管理員存取權
- 支援 SSO 的 OneUptime 帳號

### 步驟 1：設定 OneUptime SSO

1. 登入您的 OneUptime 儀表板
2. 導覽至 **Project Settings** > **Authentication** > **SSO**
3. 點選 **Create SSO** 並填寫下列內容：
   - **Name**：具描述性的名稱（例如 `Azure AD SAML`）
   - **Sign On URL**：您將在[步驟 3](#step-3-copy-entra-id-saml-metadata-to-oneuptime) 從 Entra ID 取得此項
   - **Issuer**：您將在[步驟 3](#step-3-copy-entra-id-saml-metadata-to-oneuptime) 從 Entra ID 取得此項
   - **Certificate**：您將在[步驟 3](#step-3-copy-entra-id-saml-metadata-to-oneuptime) 從 Entra ID 取得此項
   - **Signature Algorithm**：`RSA-SHA-256`
   - **Digest Algorithm**：`SHA256`
4. 點選 **View SSO Config** 並複製 **Identifier (Entity ID)** 與 **Reply URL (Assertion Consumer Service URL)** — 您在 Entra ID 中會需要這些項目

### 步驟 2：在 Microsoft Entra ID 中建立企業應用程式

1. 登入 [Microsoft Entra 系統管理中心](https://entra.microsoft.com)
2. 導覽至 **Identity** > **Applications** > **Enterprise applications**
3. 點選 **+ New application**
4. 點選 **+ Create your own application**
5. 輸入名稱（例如「OneUptime」）
6. 選擇 **Integrate any other application you don't find in the gallery (Non-gallery)**
7. 點選 **Create**

### 步驟 3：在 Entra ID 中設定 SAML SSO

1. 在您新建立的企業應用程式中，前往 **Single sign-on**
2. 選擇 **SAML** 作為單一登入方法
3. 在 **Basic SAML Configuration** 中，點選 **Edit** 並設定：
   - **Identifier (Entity ID)**：貼上 OneUptime **View SSO Config** 中的 **Identifier (Entity ID)**
   - **Reply URL (Assertion Consumer Service URL)**：貼上 OneUptime **View SSO Config** 中的 **Reply URL**
4. 點選 **Save**
5. 在 **SAML Certificates** 區段中：
   - 下載 **Certificate (Base64)**
   - 在文字編輯器中開啟下載的憑證檔案並複製其內容
6. 在 **Set up OneUptime** 區段中，複製：
   - **Login URL** — 將此貼為 OneUptime 中的 **Sign On URL**
   - **Azure AD Identifier** — 將此貼為 OneUptime 中的 **Issuer**
7. 返回 OneUptime 並貼上憑證與 URL，然後儲存

### 步驟 4：設定使用者屬性與宣告

1. 在 SAML 設定頁面中，於 **Attributes & Claims** 上點選 **Edit**
2. 確認已設定下列宣告：

| 宣告名稱 | 值 |
|-----------|-------|
| `Unique User Identifier (Name ID)` | `user.userprincipalname` 或 `user.mail` |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress` | `user.mail` |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname` | `user.givenname` |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname` | `user.surname` |

3. 將 **Name identifier format** 設為 `Email address`
4. 點選 **Save**

### 步驟 5：指派使用者與群組

1. 在您的企業應用程式中，前往 **Users and groups**
2. 點選 **+ Add user/group**
3. 選擇您要授與 SSO 存取權的使用者及/或群組
4. 點選 **Assign**

### 步驟 6：驗證設定

1. 在 Entra ID 與 OneUptime 中儲存所有設定
2. 嘗試使用 SSO 登入 OneUptime
3. 您應會被重新導向至 Microsoft 登入頁面，並在成功驗證後返回 OneUptime

### Microsoft Entra ID 疑難排解

- **AADSTS700016 錯誤**：Entra ID 中的 Identifier (Entity ID) 與 OneUptime 不相符 — 請確認兩個值完全相同
- **憑證錯誤**：確認您下載的是 **Base64** 憑證（而非原始／二進位格式），並包含 `BEGIN CERTIFICATE` / `END CERTIFICATE` 兩行
- **使用者未指派**：使用者必須先明確指派至企業應用程式，才能透過 SSO 登入
- **Name ID 不相符**：確認 Name ID 宣告所設定的電子郵件地址，與該使用者在 OneUptime 中的電子郵件相符

---

## Okta SAML 設定

Okta 是廣為使用的身分平台，提供強大的 SAML SSO 能力。請依照下列步驟，將 Okta 設定為 OneUptime 的 SAML 身分提供者。

### 先決條件

- 具有管理員存取權的 Okta 組織
- 支援 SSO 的 OneUptime 帳號

### 步驟 1：設定 OneUptime SSO

1. 登入您的 OneUptime 儀表板
2. 導覽至 **Project Settings** > **Authentication** > **SSO**
3. 點選 **Create SSO** 並填寫下列內容：
   - **Name**：具描述性的名稱（例如 `Okta SAML`）
   - **Sign On URL**：您將在[步驟 3](#step-3-copy-okta-saml-metadata-to-oneuptime) 從 Okta 取得此項
   - **Issuer**：您將在[步驟 3](#step-3-copy-okta-saml-metadata-to-oneuptime) 從 Okta 取得此項
   - **Certificate**：您將在[步驟 3](#step-3-copy-okta-saml-metadata-to-oneuptime) 從 Okta 取得此項
   - **Signature Algorithm**：`RSA-SHA-256`
   - **Digest Algorithm**：`SHA256`
4. 點選 **View SSO Config** 並複製 **Identifier (Entity ID)** 與 **Reply URL (Assertion Consumer Service URL)** — 您在 Okta 中會需要這些項目

### 步驟 2：在 Okta 中建立 SAML 應用程式

1. 登入您的 Okta Admin Console
2. 導覽至 **Applications** > **Applications**
3. 點選 **Create App Integration**
4. 選擇 **SAML 2.0** 並點選 **Next**
5. 在 **App name** 輸入「OneUptime」並點選 **Next**
6. 在 **SAML Settings** 區段中，設定：
   - **Single sign-on URL**：貼上 OneUptime **View SSO Config** 中的 **Reply URL (Assertion Consumer Service URL)**
   - **Audience URI (SP Entity ID)**：貼上 OneUptime **View SSO Config** 中的 **Identifier (Entity ID)**
   - **Name ID format**：選擇 `EmailAddress`
   - **Application username**：選擇 `Email`
7. 點選 **Next**，接著選擇 **I'm an Okta customer adding an internal app** 並點選 **Finish**

### 步驟 3：將 Okta SAML 中繼資料複製到 OneUptime

1. 在您的 Okta 應用程式中，前往 **Sign On** 分頁
2. 在 **SAML Signing Certificates** 區段中，找出使用中的憑證並點選 **Actions** > **View IdP metadata**
3. 從中繼資料 XML 中，或從 **Sign On** 分頁的詳細資訊中：
   - 複製 **Sign On URL**（也稱為 **Identity Provider Single Sign-On URL**）— 將此貼為 OneUptime 中的 **Sign On URL**
   - 複製 **Issuer**（也稱為 **Identity Provider Issuer**）— 將此貼為 OneUptime 中的 **Issuer**
4. 下載簽署憑證：
   - 在 **SAML Signing Certificates** 區段中，針對使用中的憑證點選 **Actions** > **Download certificate**
   - 在文字編輯器中開啟下載的 `.cert` 檔案並複製其內容
   - 將憑證貼入 OneUptime（包含 `BEGIN CERTIFICATE` 與 `END CERTIFICATE` 兩行）
5. 儲存 OneUptime SSO 設定

### 步驟 4：設定屬性陳述式（選用）

1. 在 Okta 應用程式中，前往 **General** 分頁
2. 在 **SAML Settings** 區段中點選 **Edit**，然後點選 **Next** 以進入 SAML 設定
3. 在 **Attribute Statements** 區段中，新增：

| 名稱 | 值 |
|------|-------|
| `email` | `user.email` |
| `firstName` | `user.firstName` |
| `lastName` | `user.lastName` |

4. 點選 **Next**，然後點選 **Finish**

### 步驟 5：指派使用者與群組

1. 在您的 Okta 應用程式中，前往 **Assignments** 分頁
2. 點選 **Assign** > **Assign to People** 或 **Assign to Groups**
3. 選擇您要授與 SSO 存取權的使用者或群組
4. 針對每個選取項目點選 **Assign**，然後點選 **Done**

### 步驟 6：驗證設定

1. 在 Okta 與 OneUptime 中儲存所有設定
2. 嘗試使用 SSO 登入 OneUptime
3. 您應會被重新導向至 Okta 登入頁面，並在成功驗證後返回 OneUptime

### Okta 疑難排解

- **404 或無效的 SSO URL**：確認 Okta 中的 **Single sign-on URL** 與 OneUptime 的 **Reply URL** 完全相符
- **Audience 不相符**：確認 Okta 中的 **Audience URI** 與 OneUptime 的 **Identifier (Entity ID)** 完全相符
- **憑證錯誤**：請確認您下載的是 **使用中** 簽署憑證的憑證，而非未使用中的憑證
- **使用者未指派**：使用者必須先指派至 Okta 應用程式，才能透過 SSO 登入
- **Name ID 錯誤**：確認 **Name ID format** 已設為 `EmailAddress`，且 **Application username** 已設為 `Email`

---

## 其他身分提供者

OneUptime 的 SSO 實作採用 SAML 2.0 協定，應可與任何相容的身分提供者搭配運作。一般設定步驟如下：

1. 在 OneUptime 中建立一個 SSO 設定，並從 **View SSO Config** 按鈕記下 **Identifier (Entity ID)** 與 **Reply URL (Assertion Consumer Service URL)**
2. 在您的身分提供者中，使用下列項目建立一個 SAML 應用程式：
   - **Assertion Consumer Service URL / Reply URL**：來自 OneUptime SSO 設定
   - **Entity ID / Audience URI**：來自 OneUptime SSO 設定
   - **Name ID Format**：電子郵件地址
3. 從您的身分提供者中，將下列項目複製到 OneUptime：
   - **Sign On URL**（SSO 端點）
   - **Issuer**（IdP 的 Entity ID）
   - **Public Certificate**（X.509 簽署憑證）
4. 將 **Signature Algorithm** 設為 `RSA-SHA-256`，並將 **Digest Algorithm** 設為 `SHA256`

## 關於 SSO 與角色的注意事項

OneUptime 目前不支援從您的身分提供者對應 SAML 角色。以角色為基礎的存取必須在 OneUptime 的 **Project Settings** > **SSO** 設定中個別設定，您可以在該處為 SSO 使用者指派預設角色。
