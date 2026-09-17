# Global SSO（執行個體層級單一登入）

Global SSO 讓 OneUptime 的**執行個體管理員**（master admin）能夠**在執行個體層級設定一次**單一的 SAML 2.0 或 OpenID Connect（OIDC）身分提供者，並將其連接至伺服器上的任何專案。它是各專案 SSO 的執行個體層級對應方案：與其讓每位專案擁有者各自設定自己的身分提供者，master admin 只需設定一個即可服務整個執行個體。

Global SSO 是 **OneUptime Enterprise Edition** 功能，僅在執行 Enterprise Edition 組建的執行個體上可用。

## Global SSO 與 Project SSO 的差異

|          | Project SSO                            | Global SSO                               |
| -------- | -------------------------------------- | ---------------------------------------- |
| 設定者   | 專案擁有者／管理員（Project Settings） | 執行個體 master admin（Admin Dashboard） |
| 範圍     | 單一專案                               | 整個執行個體 — 可連接至任何專案          |
| 登入結果 | 存取該單一專案                         | 存取該使用者可觸及的每個專案             |

## 設定 Global SSO

1. **開啟 Admin Dashboard**

   - 以 master admin 身分登入，並開啟 **Admin** > **Settings** > **Global SSO**（用於 SAML）或 **Global OIDC**（用於 OpenID Connect）。

2. **建立提供者**

   - 點選 **Create Global SSO**。
   - 若使用 SAML：輸入 **Name**、來自您身分提供者的 **Sign On URL** 與 **Issuer**，並貼上 **Public Certificate**。選擇 **Signature** 與 **Digest** 方法（若不確定，請保留預設值 — `RSA-SHA256` / `SHA256`）。
   - 若使用 OIDC：輸入 **Discovery URL**、**Issuer**、**Client ID**、**Client Secret**、**Scopes**（必須包含 `openid`），以及 **email** / **name** 宣告名稱。

3. **將 OneUptime URL 複製到您的身分提供者**

   - 開啟該提供者（點選清單中的該列）以顯示 **Identity Provider URLs** 卡片。
   - 若使用 SAML，請將 **ACS URL (Reply URL)** 與 **Issuer (Entity ID)** 複製到您的 IdP（Okta、Azure AD、OneLogin、JumpCloud 等）。
   - 若使用 OIDC，請將 **Redirect URI** 複製到您 IdP 的允許重新導向清單中。

4. **測試提供者**
   - 使用該提供者頁面上的 **Test this SSO provider** 連結，透過您的身分提供者執行端對端的登入。提供者必須處於**已啟用**狀態，該連結才能運作。啟用全域提供者只會在登入頁面新增一個「使用 SSO 登入」的選項 — 它絕不會強制使用 SSO，也不會將任何人鎖在外面，因此啟用、測試，並在需要時再次停用都是安全的。

## 使用者如何登入

全域提供者的行為取決於您是否將任何專案附加至它：

- **未附加任何專案（default-all／邀請優先）：** 使用者可以使用該提供者登入，並觸及**任何他們已是成員的專案**。新使用者**不會**自動建立 — 使用者必須先被邀請至某個專案。當成員資格於他處管理時，請將此用於全公司範圍的 SSO。

- **已附加專案（自動佈建）：** 開啟該提供者，並使用 **Attached Projects** 表格附加一個或多個專案，每個專案皆搭配一組預設團隊。登入的使用者會在首次登入時被**自動佈建**至這些專案，並加入預設團隊。一次新增一個專案及團隊以建立清單；若要變更某項附加設定，請將其刪除後再重新新增。

若您希望即使在已附加專案的情況下也防止任何自動建立帳號，請在該提供者上啟用 **Disable Sign Up with SSO** — 屆時使用者必須先被邀請才能登入。

## 強制使用 SSO

設定全域提供者並不會強制任何人使用它；密碼登入仍然有效。若要強制使用 SSO，請使用 **Require SSO for Login** 控制項：

- **依專案：** 專案可以要求使用 SSO，並可選擇性地要求*特定*提供者（專案或全域）。
- **執行個體層級：** **Admin** > **Settings** > **Authentication** 內有一個 **Require SSO for Login** 切換開關，可對執行個體中的每位使用者強制使用 SSO。Master admin 仍然豁免，因此不會被鎖在外面。

## 相關內容

- [SSO (Project SSO)](/docs/identity/sso)
- [SCIM](/docs/identity/scim)
