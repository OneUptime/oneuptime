# SCIM（跨網域身分管理系統，System for Cross-domain Identity Management）

OneUptime 支援 SCIM v2.0 通訊協定，用於自動化的使用者佈建與解除佈建。SCIM 讓 Azure AD、Okta 等身分提供者（IdP）以及其他企業身分系統，能夠自動管理使用者對 OneUptime 專案與狀態頁面的存取權。

## 概觀

SCIM 整合提供下列優點：

- **自動化使用者佈建**：當使用者在您的 IdP 中被指派時，自動於 OneUptime 中建立該使用者
- **自動化使用者解除佈建**：當使用者在您的 IdP 中被取消指派時，自動將其從 OneUptime 中移除
- **使用者屬性同步**：讓使用者資訊在您的 IdP 與 OneUptime 之間保持同步
- **集中式存取管理**：從您既有的身分管理系統管理 OneUptime 的存取權

## 專案的 SCIM

專案 SCIM 讓身分提供者能夠管理 OneUptime 專案內的團隊成員。

### 設定專案 SCIM

1. **前往專案設定**

   - 進入您的 OneUptime 專案
   - 前往 **Project Settings** > **Team** > **SCIM**

2. **設定 SCIM 選項**

   - 啟用 **Auto Provision Users**，當使用者在您的 IdP 中被指派時自動新增使用者
   - 啟用 **Auto Deprovision Users**，當使用者在您的 IdP 中被取消指派時自動移除使用者
   - 選取新使用者應加入的 **Default Teams**
   - 複製 **SCIM Base URL** 與 **Bearer Token**，以供您的 IdP 設定使用

3. **設定您的身分提供者**
   - 使用 SCIM Base URL：`https://oneuptime.com/scim/v2/{scimId}`
   - 使用提供的權杖設定 Bearer 權杖驗證
   - 對應使用者屬性（email 為必填）

### 專案 SCIM 端點

- **Service Provider Config**：`GET /scim/v2/{scimId}/ServiceProviderConfig`
- **Schemas**：`GET /scim/v2/{scimId}/Schemas`
- **Resource Types**：`GET /scim/v2/{scimId}/ResourceTypes`
- **List Users**：`GET /scim/v2/{scimId}/Users`
- **Get User**：`GET /scim/v2/{scimId}/Users/{userId}`
- **Create User**：`POST /scim/v2/{scimId}/Users`
- **Update User**：`PUT /scim/v2/{scimId}/Users/{userId}` 或 `PATCH /scim/v2/{scimId}/Users/{userId}`
- **Delete User**：`DELETE /scim/v2/{scimId}/Users/{userId}`
- **List Groups**：`GET /scim/v2/{scimId}/Groups`
- **Get Group**：`GET /scim/v2/{scimId}/Groups/{groupId}`
- **Create Group**：`POST /scim/v2/{scimId}/Groups`
- **Update Group**：`PUT /scim/v2/{scimId}/Groups/{groupId}` 或 `PATCH /scim/v2/{scimId}/Groups/{groupId}`
- **Delete Group**：`DELETE /scim/v2/{scimId}/Groups/{groupId}`

### 專案 SCIM 使用者生命週期

1. **在 IdP 中指派使用者**：當使用者在您的 IdP 中被指派至 OneUptime 時
2. **SCIM 佈建**：IdP 呼叫 OneUptime SCIM API 以建立使用者
3. **團隊成員資格**：使用者會被自動加入已設定的預設團隊
4. **授予存取權**：使用者現在可以存取該 OneUptime 專案
5. **取消指派使用者**：當使用者在 IdP 中被取消指派時
6. **SCIM 解除佈建**：IdP 呼叫 OneUptime SCIM API 以移除使用者
7. **撤銷存取權**：使用者失去對該專案的存取權

## 狀態頁面的 SCIM

狀態頁面 SCIM 讓身分提供者能夠管理私人狀態頁面的訂閱者。

### 設定狀態頁面 SCIM

1. **前往狀態頁面設定**

   - 進入您的 OneUptime 狀態頁面
   - 前往 **Status Page Settings** > **Private Users** > **SCIM**

2. **設定 SCIM 選項**

   - 啟用 **Auto Provision Users**，當訂閱者在您的 IdP 中被指派時自動新增訂閱者
   - 啟用 **Auto Deprovision Users**，當訂閱者在您的 IdP 中被取消指派時自動移除訂閱者
   - 複製 **SCIM Base URL** 與 **Bearer Token**，以供您的 IdP 設定使用

3. **設定您的身分提供者**
   - 使用 SCIM Base URL：`https://oneuptime.com/status-page-scim/v2/{scimId}`
   - 使用提供的權杖設定 Bearer 權杖驗證
   - 對應使用者屬性（email 為必填）

### 狀態頁面 SCIM 端點

- **Service Provider Config**：`GET /status-page-scim/v2/{scimId}/ServiceProviderConfig`
- **Schemas**：`GET /status-page-scim/v2/{scimId}/Schemas`
- **Resource Types**：`GET /status-page-scim/v2/{scimId}/ResourceTypes`
- **List Users**：`GET /status-page-scim/v2/{scimId}/Users`
- **Get User**：`GET /status-page-scim/v2/{scimId}/Users/{userId}`
- **Create User**：`POST /status-page-scim/v2/{scimId}/Users`
- **Update User**：`PUT /status-page-scim/v2/{scimId}/Users/{userId}` 或 `PATCH /status-page-scim/v2/{scimId}/Users/{userId}`
- **Delete User**：`DELETE /status-page-scim/v2/{scimId}/Users/{userId}`

### 狀態頁面 SCIM 使用者生命週期

1. **在 IdP 中指派使用者**：當使用者在您的 IdP 中被指派至 OneUptime 狀態頁面時
2. **SCIM 佈建**：IdP 呼叫 OneUptime SCIM API 以建立訂閱者
3. **授予存取權**：使用者現在可以存取該私人狀態頁面
4. **取消指派使用者**：當使用者在 IdP 中被取消指派時
5. **SCIM 解除佈建**：IdP 呼叫 OneUptime SCIM API 以移除訂閱者
6. **撤銷存取權**：使用者失去對該狀態頁面的存取權

## 身分提供者設定

### Microsoft Entra ID（前身為 Azure AD）

Microsoft Entra ID 提供企業等級的身分管理，並具備強大的 SCIM 佈建功能。請依照下列詳細步驟設定與 OneUptime 的 SCIM 佈建。

#### 先決條件

- 具備 Premium P1 或 P2 授權的 Microsoft Entra ID 租用戶（自動佈建所需）
- 採用 Scale 方案或更高方案的 OneUptime 帳戶
- 對 Microsoft Entra ID 與 OneUptime 兩者皆具有管理員存取權

#### 步驟 1：從 OneUptime 取得 SCIM 設定

1. 登入您的 OneUptime 儀表板
2. 前往 **Project Settings** > **Team** > **SCIM**
3. 點選 **Create SCIM Configuration**
4. 輸入易記名稱（例如「Microsoft Entra ID Provisioning」）
5. 設定下列選項：
   - **Auto Provision Users**：啟用以自動建立使用者
   - **Auto Deprovision Users**：啟用以自動移除使用者
   - **Default Teams**：選取新使用者應加入的團隊
   - **Enable Push Groups**：若您想透過 Entra ID 群組管理團隊成員資格，請啟用此選項
6. 儲存設定
7. 複製 **SCIM Base URL** 與 **Bearer Token**——您在 Entra ID 中會需要用到這些資訊

#### 步驟 2：在 Microsoft Entra ID 中建立企業應用程式

1. 登入 [Microsoft Entra 系統管理中心](https://entra.microsoft.com)
2. 前往 **Identity** > **Applications** > **Enterprise applications**
3. 點選 **+ New application**
4. 點選 **+ Create your own application**
5. 輸入名稱（例如「OneUptime」）
6. 選取 **Integrate any other application you don't find in the gallery (Non-gallery)**
7. 點選 **Create**

#### 步驟 3：設定 SCIM 佈建

1. 在您的 OneUptime 企業應用程式中，前往 **Provisioning**
2. 點選 **Get started**
3. 將 **Provisioning Mode** 設定為 **Automatic**
4. 在 **Admin Credentials** 下：
   - **Tenant URL**：輸入來自 OneUptime 的 SCIM Base URL（例如 `https://oneuptime.com/api/identity/scim/v2/{your-scim-id}`）
   - **Secret Token**：輸入來自 OneUptime 的 Bearer Token
5. 點選 **Test Connection** 以驗證設定
6. 點選 **Save**

#### 步驟 4：設定屬性對應

1. 在 Provisioning 區段中，點選 **Mappings**
2. 點選 **Provision Azure Active Directory Users**
3. 設定下列屬性對應：

| Azure AD 屬性                                                 | OneUptime SCIM 屬性            | 是否必填 |
| ------------------------------------------------------------- | ------------------------------ | -------- |
| `userPrincipalName`                                           | `userName`                     | 是       |
| `mail`                                                        | `emails[type eq "work"].value` | 建議     |
| `displayName`                                                 | `displayName`                  | 建議     |
| `givenName`                                                   | `name.givenName`               | 選填     |
| `surname`                                                     | `name.familyName`              | 選填     |
| `Switch([IsSoftDeleted], , "False", "True", "True", "False")` | `active`                       | 建議     |

4. 移除任何不需要的對應，以簡化佈建
5. 點選 **Save**

#### 步驟 5：設定群組佈建（選用）

若您在 OneUptime 中啟用了 **Push Groups**：

1. 返回 **Mappings**
2. 點選 **Provision Azure Active Directory Groups**
3. 將 **Enabled** 設定為 **Yes** 以啟用群組佈建
4. 設定下列屬性對應：

| Azure AD 屬性 | OneUptime SCIM 屬性 |
| ------------- | ------------------- |
| `displayName` | `displayName`       |
| `members`     | `members`           |

5. 點選 **Save**

#### 步驟 6：指派使用者與群組

1. 在您的 OneUptime 企業應用程式中，前往 **Users and groups**
2. 點選 **+ Add user/group**
3. 選取您想佈建至 OneUptime 的使用者及／或群組
4. 點選 **Assign**

#### 步驟 7：開始佈建

1. 前往 **Provisioning** > **Overview**
2. 點選 **Start provisioning**
3. 初始佈建週期將開始（首次同步可能需時長達 40 分鐘）
4. 監看 **Provisioning logs** 是否有任何錯誤

#### Microsoft Entra ID 疑難排解

- **測試連線失敗**：確認 SCIM Base URL 包含 `/api/identity` 前綴，且 Bearer Token 正確無誤
- **使用者未佈建**：檢查使用者是否已指派至該應用程式，且屬性對應是否正確
- **佈建錯誤**：檢視 Entra ID 中的 Provisioning logs 以取得特定錯誤訊息
- **同步延遲**：初始佈建可能需時長達 40 分鐘；後續同步每 40 分鐘進行一次

---

### Okta

Okta 提供具彈性的身分管理，並擁有絕佳的 SCIM 支援。請依照下列詳細步驟設定與 OneUptime 的 SCIM 佈建。

#### 先決條件

- 具備佈建功能（Lifecycle Management 功能）的 Okta 租用戶
- 採用 Scale 方案或更高方案的 OneUptime 帳戶
- 對 Okta 與 OneUptime 兩者皆具有管理員存取權

#### 步驟 1：從 OneUptime 取得 SCIM 設定

1. 登入您的 OneUptime 儀表板
2. 前往 **Project Settings** > **Team** > **SCIM**
3. 點選 **Create SCIM Configuration**
4. 輸入易記名稱（例如「Okta Provisioning」）
5. 設定下列選項：
   - **Auto Provision Users**：啟用以自動建立使用者
   - **Auto Deprovision Users**：啟用以自動移除使用者
   - **Default Teams**：選取新使用者應加入的團隊
   - **Enable Push Groups**：若您想透過 Okta 群組管理團隊成員資格，請啟用此選項
6. 儲存設定
7. 複製 **SCIM Base URL** 與 **Bearer Token**——您在 Okta 中會需要用到這些資訊

#### 步驟 2：建立或設定 Okta 應用程式

**若您已有既有的 SSO 應用程式：**

1. 登入您的 Okta Admin Console
2. 前往 **Applications** > **Applications**
3. 找到並選取您既有的 OneUptime 應用程式

**若要建立新的應用程式：**

1. 登入您的 Okta Admin Console
2. 前往 **Applications** > **Applications**
3. 點選 **Create App Integration**
4. 選取 **SAML 2.0** 並點選 **Next**
5. 在 App name 中輸入「OneUptime」
6. 完成 SAML 設定（請參閱 SSO 文件）
7. 點選 **Finish**

#### 步驟 3：啟用 SCIM 佈建

1. 在您的 OneUptime 應用程式中，前往 **General** 索引標籤
2. 在 **App Settings** 區段中，點選 **Edit**
3. 在 **Provisioning** 下，選取 **SCIM**
4. 點選 **Save**
5. 將會出現一個新的 **Provisioning** 索引標籤

#### 步驟 4：設定 SCIM 連線

1. 前往 **Provisioning** 索引標籤
2. 點選左側側邊欄的 **Integration**
3. 點選 **Configure API Integration**
4. 勾選 **Enable API integration**
5. 設定下列項目：
   - **SCIM connector base URL**：輸入來自 OneUptime 的 SCIM Base URL（例如 `https://oneuptime.com/api/identity/scim/v2/{your-scim-id}`）
   - **Unique identifier field for users**：輸入 `userName`
   - **Supported provisioning actions**：選取您想啟用的動作：
     - Import New Users and Profile Updates
     - Push New Users
     - Push Profile Updates
     - Push Groups（若使用以群組為基礎的佈建）
   - **Authentication Mode**：選取 **HTTP Header**
   - **Authorization**：輸入 `Bearer {your-bearer-token}`（請替換為實際的權杖）
6. 點選 **Test API Credentials** 以驗證連線
7. 點選 **Save**

#### 步驟 5：設定對應用程式的佈建

1. 在 **Provisioning** 索引標籤中，點選左側側邊欄的 **To App**
2. 點選 **Edit**
3. 啟用下列選項：
   - **Create Users**：啟用以佈建新使用者
   - **Update User Attributes**：啟用以同步屬性變更
   - **Deactivate Users**：啟用以在取消指派時解除佈建使用者
4. 點選 **Save**

#### 步驟 6：設定屬性對應

1. 向下捲動至 **Attribute Mappings**
2. 確認或設定下列對應：

| Okta 屬性          | OneUptime SCIM 屬性             | 方向        |
| ------------------ | ------------------------------- | ----------- |
| `userName`         | `userName`                      | Okta to App |
| `user.email`       | `emails[primary eq true].value` | Okta to App |
| `user.firstName`   | `name.givenName`                | Okta to App |
| `user.lastName`    | `name.familyName`               | Okta to App |
| `user.displayName` | `displayName`                   | Okta to App |

3. 移除任何不必要的對應
4. 若您有進行變更，請點選 **Save**

#### 步驟 7：設定推送群組（選用）

若您在 OneUptime 中啟用了 **Push Groups**：

1. 前往 **Push Groups** 索引標籤
2. 點選 **+ Push Groups**
3. 選取 **Find groups by name** 或 **Find groups by rule**
4. 搜尋並選取您想推送的群組
5. 點選 **Save**

#### 步驟 8：指派使用者

1. 前往 **Assignments** 索引標籤
2. 點選 **Assign** > **Assign to People** 或 **Assign to Groups**
3. 選取您想佈建的使用者或群組
4. 為每個選取項目點選 **Assign**
5. 點選 **Done**

#### 步驟 9：驗證佈建

1. 在 Okta Admin Console 中前往 **Reports** > **System Log**
2. 篩選與您的 OneUptime 應用程式相關的事件
3. 確認佈建事件已成功
4. 檢查 OneUptime 以確認使用者已被建立

#### Okta 疑難排解

- **API 認證測試失敗**：確認 SCIM Base URL 與 Bearer Token 正確無誤
- **使用者未佈建**：確保使用者已指派至該應用程式，且已啟用佈建
- **重複的使用者**：確保 `userName` 屬性是唯一的，且正確對應至 email
- **群組推送失敗**：確認群組存在且具有正確的成員資格
- **錯誤：401 Unauthorized**：在 OneUptime 中重新產生 Bearer Token 並更新 Okta

---

### 其他身分提供者

OneUptime 的 SCIM 實作遵循 SCIM v2.0 規格，應可與任何符合規範的身分提供者搭配運作。一般設定步驟：

1. **SCIM Base URL**：`https://oneuptime.com/api/identity/scim/v2/{scim-id}`（用於專案）或 `https://oneuptime.com/api/identity/status-page-scim/v2/{scim-id}`（用於狀態頁面）
2. **驗證**：HTTP Bearer Token
3. **必填使用者屬性**：`userName`（必須是有效的電子郵件地址）
4. **支援的操作**：對 Users 與 Groups 進行 GET、POST、PUT、PATCH、DELETE

#### 支援的 SCIM 端點

| 端點                     | 方法                    | 說明                                  |
| ------------------------ | ----------------------- | ------------------------------------- |
| `/ServiceProviderConfig` | GET                     | SCIM 伺服器功能                       |
| `/Schemas`               | GET                     | 可用的資源結構描述                    |
| `/ResourceTypes`         | GET                     | 可用的資源類型                        |
| `/Users`                 | GET, POST               | 列出與建立使用者                      |
| `/Users/{id}`            | GET, PUT, PATCH, DELETE | 管理個別使用者                        |
| `/Groups`                | GET, POST               | 列出與建立群組／團隊（僅限專案 SCIM） |
| `/Groups/{id}`           | GET, PUT, PATCH, DELETE | 管理個別群組（僅限專案 SCIM）         |

#### SCIM 使用者結構描述

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "userName": "user@example.com",
  "name": {
    "givenName": "John",
    "familyName": "Doe",
    "formatted": "John Doe"
  },
  "displayName": "John Doe",
  "emails": [
    {
      "value": "user@example.com",
      "type": "work",
      "primary": true
    }
  ],
  "active": true
}
```

#### SCIM 群組結構描述

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
  "displayName": "Engineering Team",
  "members": [
    {
      "value": "user-id-here",
      "display": "user@example.com"
    }
  ]
}
```

## 常見問題

### 當使用者被解除佈建時會發生什麼事？

當使用者被解除佈建時（無論是透過 DELETE 請求，或是將 `active: false` 進行設定），他們會從 SCIM 設定中所設定的團隊中被移除。使用者帳戶本身仍會保留在 OneUptime 中，但會失去對該專案的存取權。

### 我可以在不使用 SSO 的情況下使用 SCIM 嗎？

可以，SCIM 與 SSO 是各自獨立的功能。您可以使用 SCIM 進行使用者佈建，同時允許使用者以其 OneUptime 密碼或任何其他驗證方式登入。

### 我該如何處理已存在於 OneUptime 中的使用者？

當 SCIM 嘗試建立一個已存在的使用者（以 email 比對）時，OneUptime 只會將其加入所設定的預設團隊，而不會建立重複的使用者。

### 預設團隊與推送群組之間有什麼差異？

- **Default Teams**：所有透過 SCIM 佈建的使用者都會被加入相同的預先定義團隊
- **Push Groups**：團隊成員資格由您的身分提供者管理，可讓不同的使用者依其 IdP 群組成員資格而被分配至不同的團隊

### 佈建同步多久進行一次？

這取決於您的身分提供者：

- **Microsoft Entra ID**：初始同步可能需時長達 40 分鐘，後續同步每 40 分鐘進行一次
- **Okta**：大多數操作接近即時，並會定期進行完整同步
