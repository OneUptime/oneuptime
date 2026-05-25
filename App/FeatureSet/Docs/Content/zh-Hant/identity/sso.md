# SSO（單點登錄）

OneUptime 支持基於 SAML 2.0 的單點登錄（SSO）進行企業認證。SSO 允許您的團隊成員使用組織的身份提供商（IdP）登錄 OneUptime，從而實現集中訪問管理和增強的安全性。

## 概述

SSO 集成提供以下優勢：

- **集中認證**：用戶使用現有的企業憑據登錄
- **增強安全性**：利用 IdP 的多因素認證和安全策略
- **簡化用戶管理**：從現有身份管理系統管理訪問權限
- **減少密碼疲勞**：用戶無需記住單獨的 OneUptime 密碼

## 設置 SSO

1. **導航至項目設置**
   - 進入您的 OneUptime 項目
   - 導航至 **項目設置** > **認證** > **SSO**

2. **創建 SSO 配置**
   - 點擊 **創建 SSO**
   - 輸入 SSO 配置的 **名稱**（例如"Keycloak SAML"或"Okta SAML"）
   - 輸入身份提供商的 **登錄 URL**
   - 輸入身份提供商的 **頒發者**（實體 ID）
   - 粘貼身份提供商的 **公共證書**
   - 選擇 **簽名算法**（例如 `RSA-SHA-256`）
   - 選擇 **摘要算法**（例如 `SHA256`）

3. **獲取 OneUptime SSO 元數據**
   - 保存後，點擊 **查看 SSO 配置** 按鈕
   - 複製 **標識符（實體 ID）** — IdP 配置中需要此信息
   - 複製 **回覆 URL（斷言使用者服務 URL）** — IdP 配置中需要此信息

## Keycloak SAML 配置

Keycloak 是一款流行的開源身份和訪問管理解決方案。按照以下步驟將 Keycloak 配置爲 OneUptime 的 SAML 身份提供商。

### 前提條件

- 運行中的 Keycloak 實例，且已配置 realm
- 對 Keycloak 和 OneUptime 的管理員訪問權限
- 支持 SSO 的 OneUptime 賬號

### 第一步：配置 OneUptime SSO

1. 登錄您的 OneUptime 控制台
2. 導航至 **項目設置** > **認證** > **SSO**
3. 點擊 **創建 SSO** 並填寫以下內容：
   - **名稱**：描述性名稱（例如 `my-project-oneuptime`）
   - **登錄 URL**：`https://<your-keycloak-domain>/auth/realms/<your-realm>/protocol/saml`
   - **頒發者**：`https://<your-keycloak-domain>/auth/realms/<your-realm>`
   - **證書**：參見下方[第二步](#第二步獲取-keycloak-證書)
   - **簽名算法**：`RSA-SHA-256`
   - **摘要算法**：`SHA256`
4. 保存配置

### 第二步：獲取 Keycloak 證書

1. 在 Keycloak 中，導航至您的客戶端配置
2. 點擊 **導出**（或根據您的 Keycloak 版本轉到 **密鑰** 選項卡）
3. 在導出的 JSON 文件中，找到名稱中帶有 `certificate` 的密鑰
4. 複製證書值並以以下格式粘貼到 OneUptime 中：

```
-----BEGIN CERTIFICATE-----
MIICnzCCAYcCBgFyPZ8QFzANBgkqhkiG.......
-----END CERTIFICATE-----
```

### 第三步：配置 Keycloak 客戶端

1. 在 Keycloak 中，導航至您 realm 中的 **客戶端**
2. 創建新客戶端或編輯現有客戶端
3. 將 **客戶端協議** 設置爲 `saml`
4. 將 **客戶端 ID** 設置爲 OneUptime **查看 SSO 配置** 中的 **標識符（實體 ID）** 值
5. 將 **有效重定向 URI** 設置爲您的 OneUptime URL
6. 將 **根 URL** 設置爲您的 OneUptime 基礎 URL
7. 將 OneUptime 中的 **回覆 URL（斷言使用者服務 URL）** 粘貼到 **斷言使用者服務 POST 綁定 URL** 字段中

### 第四步：配置 Keycloak 客戶端設置

1. 禁用 **簽名密鑰配置**（在密鑰選項卡下）
2. 將 **Name ID 格式** 設置爲 `email`
3. 確保啓用 **強制 Name ID 格式** 選項，以便 Keycloak 始終將電郵作爲 Name ID 發送

### 第五步：驗證配置

1. 保存 Keycloak 和 OneUptime 中的所有設置
2. 嘗試使用 SSO 登錄 OneUptime
3. 您應該被重定向到 Keycloak 登錄頁面，成功認證後返回 OneUptime

### Keycloak 故障排查

- **登錄因簽名錯誤失敗**：確保證書已正確複製，包括 `BEGIN CERTIFICATE` 和 `END CERTIFICATE` 行
- **Name ID 錯誤**：驗證 Keycloak 中的 **Name ID 格式** 是否設置爲 `email`
- **重定向循環**：檢查 **有效重定向 URI** 和 **斷言使用者服務 POST 綁定 URL** 是否正確配置
- **證書未找到**：確保您從正確的 realm 中的正確客戶端導出

---

## Microsoft Entra ID（原 Azure AD / Active Directory）SAML 配置

Microsoft Entra ID 是 Microsoft 基於雲的身份和訪問管理服務。按照以下步驟將 Entra ID 配置爲 OneUptime 的 SAML 身份提供商。

### 前提條件

- Microsoft Entra ID 租戶（任何支持企業應用程序 SAML SSO 的層級）
- 對 Microsoft Entra ID 和 OneUptime 的管理員訪問權限
- 支持 SSO 的 OneUptime 賬號

### 第一步：配置 OneUptime SSO

1. 登錄您的 OneUptime 控制台
2. 導航至 **項目設置** > **認證** > **SSO**
3. 點擊 **創建 SSO** 並填寫以下內容：
   - **名稱**：描述性名稱（例如 `Azure AD SAML`）
   - **登錄 URL**：您將在[第三步](#第三步將-entra-id-saml-元數據複製到-oneuptime)中從 Entra ID 獲取
   - **頒發者**：您將在[第三步](#第三步將-entra-id-saml-元數據複製到-oneuptime)中從 Entra ID 獲取
   - **證書**：您將在[第三步](#第三步將-entra-id-saml-元數據複製到-oneuptime)中從 Entra ID 獲取
   - **簽名算法**：`RSA-SHA-256`
   - **摘要算法**：`SHA256`
4. 點擊 **查看 SSO 配置** 並複製 **標識符（實體 ID）** 和 **回覆 URL（斷言使用者服務 URL）** — 您將在 Entra ID 中使用這些信息

### 第二步：在 Microsoft Entra ID 中創建企業應用程序

1. 登錄 [Microsoft Entra 管理中心](https://entra.microsoft.com)
2. 導航至 **標識** > **應用程序** > **企業應用程序**
3. 點擊 **+ 新建應用程序**
4. 點擊 **+ 創建您自己的應用程序**
5. 輸入名稱（例如"OneUptime"）
6. 選擇 **集成在庫中找不到的任何其他應用程序（非庫應用程序）**
7. 點擊 **創建**

### 第三步：在 Entra ID 中配置 SAML SSO

1. 在您的新企業應用程序中，轉到 **單一登錄**
2. 選擇 **SAML** 作爲單一登錄方法
3. 在 **基本 SAML 配置** 中，點擊 **編輯** 並設置：
   - **標識符（實體 ID）**：粘貼 OneUptime **查看 SSO 配置** 中的 **標識符（實體 ID）**
   - **回覆 URL（斷言使用者服務 URL）**：粘貼 OneUptime **查看 SSO 配置** 中的 **回覆 URL**
4. 點擊 **保存**
5. 在 **SAML 證書** 部分：
   - 下載 **證書（Base64）**
   - 在文本編輯器中打開下載的證書文件並複製內容
6. 在 **設置 OneUptime** 部分，複製：
   - **登錄 URL** — 將其粘貼爲 OneUptime 中的 **登錄 URL**
   - **Azure AD 標識符** — 將其粘貼爲 OneUptime 中的 **頒發者**
7. 返回 OneUptime，粘貼證書和 URL，然後保存

### 第四步：配置用戶屬性和聲明

1. 在 SAML 配置頁面，點擊 **屬性和聲明** 上的 **編輯**
2. 確保以下聲明已配置：

| 聲明名稱 | 值 |
|---------|-----|
| `Unique User Identifier (Name ID)` | `user.userprincipalname` 或 `user.mail` |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress` | `user.mail` |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname` | `user.givenname` |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname` | `user.surname` |

3. 將 **名稱標識符格式** 設置爲 `電郵地址`
4. 點擊 **保存**

### 第五步：分配用戶和組

1. 在您的企業應用程序中，轉到 **用戶和組**
2. 點擊 **+ 添加用戶/組**
3. 選擇您要授予 SSO 訪問權限的用戶和/或組
4. 點擊 **分配**

### 第六步：驗證配置

1. 保存 Entra ID 和 OneUptime 中的所有設置
2. 嘗試使用 SSO 登錄 OneUptime
3. 您應該被重定向到 Microsoft 登錄頁面，成功認證後返回 OneUptime

### Microsoft Entra ID 故障排查

- **AADSTS700016 錯誤**：Entra ID 中的標識符（實體 ID）與 OneUptime 不匹配 — 驗證兩個值是否完全相同
- **證書錯誤**：確保您下載的是 **Base64** 證書（而非原始/二進制格式），幷包含 `BEGIN CERTIFICATE` / `END CERTIFICATE` 行
- **用戶未分配**：用戶必須明確分配到企業應用程序才能通過 SSO 登錄
- **Name ID 不匹配**：確保 Name ID 聲明設置爲與用戶在 OneUptime 中的電郵匹配的電郵地址

---

## Okta SAML 配置

Okta 是一款廣泛使用的身份平臺，提供強大的 SAML SSO 能力。按照以下步驟將 Okta 配置爲 OneUptime 的 SAML 身份提供商。

### 前提條件

- 具有管理員訪問權限的 Okta 組織
- 支持 SSO 的 OneUptime 賬號

### 第一步：配置 OneUptime SSO

1. 登錄您的 OneUptime 控制台
2. 導航至 **項目設置** > **認證** > **SSO**
3. 點擊 **創建 SSO** 並填寫以下內容：
   - **名稱**：描述性名稱（例如 `Okta SAML`）
   - **登錄 URL**：您將在[第三步](#第三步將-okta-saml-元數據複製到-oneuptime)中從 Okta 獲取
   - **頒發者**：您將在[第三步](#第三步將-okta-saml-元數據複製到-oneuptime)中從 Okta 獲取
   - **證書**：您將在[第三步](#第三步將-okta-saml-元數據複製到-oneuptime)中從 Okta 獲取
   - **簽名算法**：`RSA-SHA-256`
   - **摘要算法**：`SHA256`
4. 點擊 **查看 SSO 配置** 並複製 **標識符（實體 ID）** 和 **回覆 URL（斷言使用者服務 URL）** — 您將在 Okta 中使用這些信息

### 第二步：在 Okta 中創建 SAML 應用程序

1. 登錄您的 Okta 管理控制台
2. 導航至 **應用程序** > **應用程序**
3. 點擊 **創建應用集成**
4. 選擇 **SAML 2.0** 並點擊 **下一步**
5. 輸入"OneUptime"作爲 **應用名稱** 並點擊 **下一步**
6. 在 **SAML 設置** 部分，配置：
   - **單一登錄 URL**：粘貼 OneUptime **查看 SSO 配置** 中的 **回覆 URL（斷言使用者服務 URL）**
   - **受衆 URI（SP 實體 ID）**：粘貼 OneUptime **查看 SSO 配置** 中的 **標識符（實體 ID）**
   - **Name ID 格式**：選擇 `EmailAddress`
   - **應用程序用戶名**：選擇 `Email`
7. 點擊 **下一步**，選擇 **我是添加內部應用的 Okta 客戶** 並點擊 **完成**

### 第三步：將 Okta SAML 元數據複製到 OneUptime

1. 在您的 Okta 應用程序中，轉到 **登錄** 選項卡
2. 在 **SAML 簽名證書** 部分，找到活動證書，點擊 **操作** > **查看 IdP 元數據**
3. 從元數據 XML 或 **登錄** 選項卡詳情中：
   - 複製 **登錄 URL**（也稱爲 **身份提供商單一登錄 URL**）— 將其粘貼爲 OneUptime 中的 **登錄 URL**
   - 複製 **頒發者**（也稱爲 **身份提供商頒發者**）— 將其粘貼爲 OneUptime 中的 **頒發者**
4. 下載簽名證書：
   - 在 **SAML 簽名證書** 部分，點擊活動證書的 **操作** > **下載證書**
   - 在文本編輯器中打開下載的 `.cert` 文件並複製內容
   - 將證書粘貼到 OneUptime 中（包括 `BEGIN CERTIFICATE` 和 `END CERTIFICATE` 行）
5. 保存 OneUptime SSO 配置

### 第四步：配置屬性聲明（可選）

1. 在 Okta 應用程序中，轉到 **常規** 選項卡
2. 在 **SAML 設置** 部分點擊 **編輯**，然後點擊 **下一步** 進入 SAML 設置
3. 在 **屬性聲明** 部分，添加：

| 名稱 | 值 |
|------|-----|
| `email` | `user.email` |
| `firstName` | `user.firstName` |
| `lastName` | `user.lastName` |

4. 點擊 **下一步** 然後點擊 **完成**

### 第五步：分配用戶和組

1. 在您的 Okta 應用程序中，轉到 **分配** 選項卡
2. 點擊 **分配** > **分配給人員** 或 **分配給組**
3. 選擇您要授予 SSO 訪問權限的用戶或組
4. 對每個選擇點擊 **分配**，然後點擊 **完成**

### 第六步：驗證配置

1. 保存 Okta 和 OneUptime 中的所有設置
2. 嘗試使用 SSO 登錄 OneUptime
3. 您應該被重定向到 Okta 登錄頁面，成功認證後返回 OneUptime

### Okta 故障排查

- **404 或無效的 SSO URL**：驗證 Okta 中的 **單一登錄 URL** 是否與 OneUptime 中的 **回覆 URL** 完全匹配
- **受衆不匹配**：確保 Okta 中的 **受衆 URI** 與 OneUptime 中的 **標識符（實體 ID）** 完全匹配
- **證書錯誤**：確保您下載的是 **活動** 簽名證書的證書，而非不活動的證書
- **用戶未分配**：用戶必須分配到 Okta 應用程序才能通過 SSO 登錄
- **Name ID 錯誤**：驗證 **Name ID 格式** 是否設置爲 `EmailAddress`，以及 **應用程序用戶名** 是否設置爲 `Email`

---

## 其他身份提供商

OneUptime 的 SSO 實現使用 SAML 2.0 協議，應能與任何合規的身份提供商配合使用。通用配置步驟如下：

1. 在 OneUptime 中，創建 SSO 配置，並從 **查看 SSO 配置** 按鈕記錄 **標識符（實體 ID）** 和 **回覆 URL（斷言使用者服務 URL）**
2. 在您的身份提供商中，使用以下信息創建 SAML 應用程序：
   - **斷言使用者服務 URL / 回覆 URL**：來自 OneUptime SSO 配置
   - **實體 ID / 受衆 URI**：來自 OneUptime SSO 配置
   - **Name ID 格式**：電郵地址
3. 從您的身份提供商複製以下信息到 OneUptime：
   - **登錄 URL**（SSO 端點）
   - **頒發者**（IdP 的實體 ID）
   - **公共證書**（X.509 簽名證書）
4. 將 **簽名算法** 設置爲 `RSA-SHA-256`，將 **摘要算法** 設置爲 `SHA256`

## 關於 SSO 和角色的說明

OneUptime 目前不支持從身份提供商映射 SAML 角色。基於角色的訪問控制必須在 OneUptime 的 **項目設置** > **SSO** 設置中單獨配置，您可以在其中爲 SSO 用戶分配默認角色。
