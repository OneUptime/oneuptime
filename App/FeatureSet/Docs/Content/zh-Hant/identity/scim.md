# SCIM（跨域身份管理系統）

OneUptime 支持 SCIM v2.0 協議，用於自動化用戶配置和取消配置。SCIM 使身份提供商（IdP）（如 Azure AD、Okta 及其他企業身份系統）能夠自動管理用戶對 OneUptime 項目和狀態頁面的訪問權限。

## 概述

SCIM 集成提供以下優勢：

- **自動化用戶配置**：當用戶在 IdP 中被分配時，自動在 OneUptime 中創建用戶
- **自動化用戶取消配置**：當用戶在 IdP 中被取消分配時，自動從 OneUptime 中移除用戶
- **用戶屬性同步**：保持 IdP 與 OneUptime 之間用戶信息的同步
- **集中訪問管理**：從現有身份管理系統管理 OneUptime 訪問權限

## 項目 SCIM

項目 SCIM 允許身份提供商管理 OneUptime 項目中的團隊成員。

### 設置項目 SCIM

1. **導航至項目設置**
   - 進入您的 OneUptime 項目
   - 導航至 **項目設置** > **團隊** > **SCIM**

2. **配置 SCIM 設置**
   - 啓用 **自動配置用戶** 以在 IdP 中分配用戶時自動添加用戶
   - 啓用 **自動取消配置用戶** 以在 IdP 中取消分配用戶時自動移除用戶
   - 選擇新用戶應加入的 **默認團隊**
   - 複製 **SCIM 基礎 URL** 和 **Bearer Token** 用於 IdP 配置

3. **配置您的身份提供商**
   - 使用 SCIM 基礎 URL：`https://oneuptime.com/scim/v2/{scimId}`
   - 使用提供的令牌配置 Bearer 令牌認證
   - 映射用戶屬性（電郵爲必填項）

### 項目 SCIM 端點

- **服務提供商配置**：`GET /scim/v2/{scimId}/ServiceProviderConfig`
- **Schema**：`GET /scim/v2/{scimId}/Schemas`
- **資源類型**：`GET /scim/v2/{scimId}/ResourceTypes`
- **用戶列表**：`GET /scim/v2/{scimId}/Users`
- **獲取用戶**：`GET /scim/v2/{scimId}/Users/{userId}`
- **創建用戶**：`POST /scim/v2/{scimId}/Users`
- **更新用戶**：`PUT /scim/v2/{scimId}/Users/{userId}` 或 `PATCH /scim/v2/{scimId}/Users/{userId}`
- **刪除用戶**：`DELETE /scim/v2/{scimId}/Users/{userId}`
- **組列表**：`GET /scim/v2/{scimId}/Groups`
- **獲取組**：`GET /scim/v2/{scimId}/Groups/{groupId}`
- **創建組**：`POST /scim/v2/{scimId}/Groups`
- **更新組**：`PUT /scim/v2/{scimId}/Groups/{groupId}` 或 `PATCH /scim/v2/{scimId}/Groups/{groupId}`
- **刪除組**：`DELETE /scim/v2/{scimId}/Groups/{groupId}`

### 項目 SCIM 用戶生命週期

1. **在 IdP 中分配用戶**：當用戶在 IdP 中被分配到 OneUptime 時
2. **SCIM 配置**：IdP 調用 OneUptime SCIM API 創建用戶
3. **團隊成員資格**：用戶被自動添加到配置的默認團隊
4. **授予訪問權限**：用戶現在可以訪問 OneUptime 項目
5. **取消分配用戶**：當用戶在 IdP 中被取消分配時
6. **SCIM 取消配置**：IdP 調用 OneUptime SCIM API 移除用戶
7. **撤銷訪問權限**：用戶失去對項目的訪問權限

## 狀態頁面 SCIM

狀態頁面 SCIM 允許身份提供商管理私有狀態頁面的訂閱者。

### 設置狀態頁面 SCIM

1. **導航至狀態頁面設置**
   - 進入您的 OneUptime 狀態頁面
   - 導航至 **狀態頁面設置** > **私有用戶** > **SCIM**

2. **配置 SCIM 設置**
   - 啓用 **自動配置用戶** 以在 IdP 中分配用戶時自動添加訂閱者
   - 啓用 **自動取消配置用戶** 以在 IdP 中取消分配用戶時自動移除訂閱者
   - 複製 **SCIM 基礎 URL** 和 **Bearer Token** 用於 IdP 配置

3. **配置您的身份提供商**
   - 使用 SCIM 基礎 URL：`https://oneuptime.com/status-page-scim/v2/{scimId}`
   - 使用提供的令牌配置 Bearer 令牌認證
   - 映射用戶屬性（電郵爲必填項）

### 狀態頁面 SCIM 端點

- **服務提供商配置**：`GET /status-page-scim/v2/{scimId}/ServiceProviderConfig`
- **Schema**：`GET /status-page-scim/v2/{scimId}/Schemas`
- **資源類型**：`GET /status-page-scim/v2/{scimId}/ResourceTypes`
- **用戶列表**：`GET /status-page-scim/v2/{scimId}/Users`
- **獲取用戶**：`GET /status-page-scim/v2/{scimId}/Users/{userId}`
- **創建用戶**：`POST /status-page-scim/v2/{scimId}/Users`
- **更新用戶**：`PUT /status-page-scim/v2/{scimId}/Users/{userId}` 或 `PATCH /status-page-scim/v2/{scimId}/Users/{userId}`
- **刪除用戶**：`DELETE /status-page-scim/v2/{scimId}/Users/{userId}`

### 狀態頁面 SCIM 用戶生命週期

1. **在 IdP 中分配用戶**：當用戶在 IdP 中被分配到 OneUptime 狀態頁面時
2. **SCIM 配置**：IdP 調用 OneUptime SCIM API 創建訂閱者
3. **授予訪問權限**：用戶現在可以訪問私有狀態頁面
4. **取消分配用戶**：當用戶在 IdP 中被取消分配時
5. **SCIM 取消配置**：IdP 調用 OneUptime SCIM API 移除訂閱者
6. **撤銷訪問權限**：用戶失去對狀態頁面的訪問權限

## 身份提供商配置

### Microsoft Entra ID（原 Azure AD）

Microsoft Entra ID 提供企業級身份管理，具備強大的 SCIM 配置能力。按照以下詳細步驟配置與 OneUptime 的 SCIM 配置。

#### 前提條件

- 具有 Premium P1 或 P2 許可證的 Microsoft Entra ID 租戶（自動配置所必需）
- 具有 Scale 計劃或更高版本的 OneUptime 賬號
- 對 Microsoft Entra ID 和 OneUptime 的管理員訪問權限

#### 第一步：從 OneUptime 獲取 SCIM 配置

1. 登錄您的 OneUptime 控制台
2. 導航至 **項目設置** > **團隊** > **SCIM**
3. 點擊 **創建 SCIM 配置**
4. 輸入友好名稱（例如"Microsoft Entra ID Provisioning"）
5. 配置以下選項：
   - **自動配置用戶**：啓用以自動創建用戶
   - **自動取消配置用戶**：啓用以自動移除用戶
   - **默認團隊**：選擇新用戶應加入的團隊
   - **啓用推送組**：如果您想通過 Entra ID 組管理團隊成員資格，請啓用
6. 保存配置
7. 複製 **SCIM 基礎 URL** 和 **Bearer Token** - Entra ID 配置中需要這些信息

#### 第二步：在 Microsoft Entra ID 中創建企業應用程序

1. 登錄 [Microsoft Entra 管理中心](https://entra.microsoft.com)
2. 導航至 **標識** > **應用程序** > **企業應用程序**
3. 點擊 **+ 新建應用程序**
4. 點擊 **+ 創建您自己的應用程序**
5. 輸入名稱（例如"OneUptime"）
6. 選擇 **集成在庫中找不到的任何其他應用程序（非庫應用程序）**
7. 點擊 **創建**

#### 第三步：配置 SCIM 預配

1. 在您的 OneUptime 企業應用程序中，轉到 **預配**
2. 點擊 **開始使用**
3. 將 **預配模式** 設置爲 **自動**
4. 在 **管理員憑據** 下：
   - **租戶 URL**：輸入 OneUptime 中的 SCIM 基礎 URL（例如 `https://oneuptime.com/api/identity/scim/v2/{your-scim-id}`）
   - **機密令牌**：輸入 OneUptime 中的 Bearer Token
5. 點擊 **測試連接** 以驗證配置
6. 點擊 **保存**

#### 第四步：配置屬性映射

1. 在預配部分，點擊 **映射**
2. 點擊 **預配 Azure Active Directory 用戶**
3. 配置以下屬性映射：

| Azure AD 屬性 | OneUptime SCIM 屬性 | 是否必填 |
|--------------|---------------------|---------|
| `userPrincipalName` | `userName` | 是 |
| `mail` | `emails[type eq "work"].value` | 建議 |
| `displayName` | `displayName` | 建議 |
| `givenName` | `name.givenName` | 可選 |
| `surname` | `name.familyName` | 可選 |
| `Switch([IsSoftDeleted], , "False", "True", "True", "False")` | `active` | 建議 |

4. 刪除不需要的映射以簡化配置
5. 點擊 **保存**

#### 第五步：配置組預配（可選）

如果您在 OneUptime 中啓用了 **推送組**：

1. 返回 **映射**
2. 點擊 **預配 Azure Active Directory 組**
3. 將 **已啓用** 設置爲 **是** 以啓用組預配
4. 配置以下屬性映射：

| Azure AD 屬性 | OneUptime SCIM 屬性 |
|--------------|---------------------|
| `displayName` | `displayName` |
| `members` | `members` |

5. 點擊 **保存**

#### 第六步：分配用戶和組

1. 在您的 OneUptime 企業應用程序中，轉到 **用戶和組**
2. 點擊 **+ 添加用戶/組**
3. 選擇您要配置到 OneUptime 的用戶和/或組
4. 點擊 **分配**

#### 第七步：開始預配

1. 轉到 **預配** > **概述**
2. 點擊 **開始預配**
3. 初始預配週期將開始（首次同步可能需要長達 40 分鐘）
4. 監控 **預配日誌** 以查看任何錯誤

#### Microsoft Entra ID 故障排查

- **測試連接失敗**：驗證 SCIM 基礎 URL 是否包含 `/api/identity` 前綴，以及 Bearer Token 是否正確
- **用戶未配置**：檢查用戶是否已分配到應用程序，以及屬性映射是否正確
- **預配錯誤**：在 Entra ID 的預配日誌中查看具體錯誤消息
- **同步延遲**：初始預配可能需要長達 40 分鐘；後續同步每 40 分鐘進行一次

---

### Okta

Okta 提供靈活的身份管理，具有出色的 SCIM 支持。按照以下詳細步驟配置與 OneUptime 的 SCIM 配置。

#### 前提條件

- 具有配置能力的 Okta 租戶（生命週期管理功能）
- 具有 Scale 計劃或更高版本的 OneUptime 賬號
- 對 Okta 和 OneUptime 的管理員訪問權限

#### 第一步：從 OneUptime 獲取 SCIM 配置

1. 登錄您的 OneUptime 控制台
2. 導航至 **項目設置** > **團隊** > **SCIM**
3. 點擊 **創建 SCIM 配置**
4. 輸入友好名稱（例如"Okta Provisioning"）
5. 配置以下選項：
   - **自動配置用戶**：啓用以自動創建用戶
   - **自動取消配置用戶**：啓用以自動移除用戶
   - **默認團隊**：選擇新用戶應加入的團隊
   - **啓用推送組**：如果您想通過 Okta 組管理團隊成員資格，請啓用
6. 保存配置
7. 複製 **SCIM 基礎 URL** 和 **Bearer Token** - Okta 配置中需要這些信息

#### 第二步：創建或配置 Okta 應用程序

**如果您有現有的 SSO 應用程序：**
1. 登錄您的 Okta 管理控制台
2. 導航至 **應用程序** > **應用程序**
3. 找到並選擇您現有的 OneUptime 應用程序

**如果創建新應用程序：**
1. 登錄您的 Okta 管理控制台
2. 導航至 **應用程序** > **應用程序**
3. 點擊 **創建應用集成**
4. 選擇 **SAML 2.0** 並點擊 **下一步**
5. 輸入"OneUptime"作爲應用名稱
6. 完成 SAML 配置（參閱 SSO 文檔）
7. 點擊 **完成**

#### 第三步：啓用 SCIM 預配

1. 在您的 OneUptime 應用程序中，轉到 **常規** 選項卡
2. 在 **應用程序設置** 部分，點擊 **編輯**
3. 在 **預配** 下，選擇 **SCIM**
4. 點擊 **保存**
5. 將出現新的 **預配** 選項卡

#### 第四步：配置 SCIM 連接

1. 轉到 **預配** 選項卡
2. 點擊左側邊欄中的 **集成**
3. 點擊 **配置 API 集成**
4. 勾選 **啓用 API 集成**
5. 配置以下內容：
   - **SCIM 連接器基礎 URL**：輸入 OneUptime 中的 SCIM 基礎 URL（例如 `https://oneuptime.com/api/identity/scim/v2/{your-scim-id}`）
   - **用戶的唯一標識符字段**：輸入 `userName`
   - **支持的預配操作**：選擇您要啓用的操作：
     - 導入新用戶和配置文件更新
     - 推送新用戶
     - 推送配置文件更新
     - 推送組（如果使用基於組的預配）
   - **認證模式**：選擇 **HTTP Header**
   - **授權**：輸入 `Bearer {your-bearer-token}`（替換爲實際令牌）
6. 點擊 **測試 API 憑據** 以驗證連接
7. 點擊 **保存**

#### 第五步：配置應用程序預配

1. 在 **預配** 選項卡中，點擊左側邊欄中的 **到應用**
2. 點擊 **編輯**
3. 啓用以下選項：
   - **創建用戶**：啓用以配置新用戶
   - **更新用戶屬性**：啓用以同步屬性更改
   - **停用用戶**：啓用以在取消分配時取消配置用戶
4. 點擊 **保存**

#### 第六步：配置屬性映射

1. 向下滾動至 **屬性映射**
2. 驗證或配置以下映射：

| Okta 屬性 | OneUptime SCIM 屬性 | 方向 |
|----------|---------------------|------|
| `userName` | `userName` | Okta 到應用 |
| `user.email` | `emails[primary eq true].value` | Okta 到應用 |
| `user.firstName` | `name.givenName` | Okta 到應用 |
| `user.lastName` | `name.familyName` | Okta 到應用 |
| `user.displayName` | `displayName` | Okta 到應用 |

3. 刪除不必要的映射
4. 如果有更改，點擊 **保存**

#### 第七步：配置推送組（可選）

如果您在 OneUptime 中啓用了 **推送組**：

1. 轉到 **推送組** 選項卡
2. 點擊 **+ 推送組**
3. 選擇 **按名稱查找組** 或 **按規則查找組**
4. 搜索並選擇要推送的組
5. 點擊 **保存**

#### 第八步：分配用戶

1. 轉到 **分配** 選項卡
2. 點擊 **分配** > **分配給人員** 或 **分配給組**
3. 選擇要配置的用戶或組
4. 對每個選擇點擊 **分配**
5. 點擊 **完成**

#### 第九步：驗證預配

1. 在 Okta 管理控制台中轉到 **報告** > **系統日誌**
2. 篩選與您的 OneUptime 應用程序相關的事件
3. 驗證預配事件是否成功
4. 檢查 OneUptime 以確認用戶已被創建

#### Okta 故障排查

- **API 憑據測試失敗**：驗證 SCIM 基礎 URL 和 Bearer Token 是否正確
- **用戶未配置**：確保用戶已分配到應用程序且預配已啓用
- **重複用戶**：確保 `userName` 屬性唯一且正確映射到電郵
- **組推送失敗**：驗證組是否存在且成員資格是否正確
- **錯誤：401 Unauthorized**：在 OneUptime 中重新生成 Bearer Token 並更新 Okta

---

### 其他身份提供商

OneUptime 的 SCIM 實現遵循 SCIM v2.0 規範，應能與任何合規的身份提供商配合使用。通用配置步驟：

1. **SCIM 基礎 URL**：`https://oneuptime.com/api/identity/scim/v2/{scim-id}`（用於項目）或 `https://oneuptime.com/api/identity/status-page-scim/v2/{scim-id}`（用於狀態頁面）
2. **認證**：HTTP Bearer 令牌
3. **必填用戶屬性**：`userName`（必須是有效的電郵地址）
4. **支持的操作**：GET、POST、PUT、PATCH、DELETE（用於用戶和組）

#### 支持的 SCIM 端點

| 端點 | 方法 | 描述 |
|------|------|------|
| `/ServiceProviderConfig` | GET | SCIM 服務器能力 |
| `/Schemas` | GET | 可用資源 Schema |
| `/ResourceTypes` | GET | 可用資源類型 |
| `/Users` | GET, POST | 列出和創建用戶 |
| `/Users/{id}` | GET, PUT, PATCH, DELETE | 管理單個用戶 |
| `/Groups` | GET, POST | 列出和創建組/團隊（僅項目 SCIM） |
| `/Groups/{id}` | GET, PUT, PATCH, DELETE | 管理單個組（僅項目 SCIM） |

#### SCIM 用戶 Schema

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

#### SCIM 組 Schema

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

### 用戶取消配置後會發生什麼？

當用戶被取消配置（通過 DELETE 請求或將 `active` 設置爲 `false`）時，他們將從 SCIM 設置中配置的團隊中被移除。用戶賬號本身仍保留在 OneUptime 中，但失去對項目的訪問權限。

### 我可以在不使用 SSO 的情況下使用 SCIM 嗎？

可以，SCIM 和 SSO 是獨立的功能。您可以使用 SCIM 進行用戶配置，同時允許用戶使用 OneUptime 密碼或任何其他認證方式登錄。

### 如何處理 OneUptime 中已存在的用戶？

當 SCIM 嘗試創建已存在（通過電郵匹配）的用戶時，OneUptime 只會將其添加到配置的默認團隊，而不是創建重複用戶。

### 默認團隊和推送組有什麼區別？

- **默認團隊**：通過 SCIM 配置的所有用戶都會被添加到相同的預定義團隊
- **推送組**：團隊成員資格由您的身份提供商管理，允許不同用戶根據 IdP 組成員資格加入不同的團隊

### 預配同步頻率是多少？

這取決於您的身份提供商：
- **Microsoft Entra ID**：初始同步最長可達 40 分鐘；後續同步每 40 分鐘進行一次
- **Okta**：大多數操作接近實時，並定期進行完整同步
