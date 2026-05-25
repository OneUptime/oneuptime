# SCIM（跨域身份管理系统）

OneUptime 支持 SCIM v2.0 协议，用于自动化用户配置和取消配置。SCIM 使身份提供商（IdP）（如 Azure AD、Okta 及其他企业身份系统）能够自动管理用户对 OneUptime 项目和状态页面的访问权限。

## 概述

SCIM 集成提供以下优势：

- **自动化用户配置**：当用户在 IdP 中被分配时，自动在 OneUptime 中创建用户
- **自动化用户取消配置**：当用户在 IdP 中被取消分配时，自动从 OneUptime 中移除用户
- **用户属性同步**：保持 IdP 与 OneUptime 之间用户信息的同步
- **集中访问管理**：从现有身份管理系统管理 OneUptime 访问权限

## 项目 SCIM

项目 SCIM 允许身份提供商管理 OneUptime 项目中的团队成员。

### 设置项目 SCIM

1. **导航至项目设置**
   - 进入您的 OneUptime 项目
   - 导航至 **项目设置** > **团队** > **SCIM**

2. **配置 SCIM 设置**
   - 启用 **自动配置用户** 以在 IdP 中分配用户时自动添加用户
   - 启用 **自动取消配置用户** 以在 IdP 中取消分配用户时自动移除用户
   - 选择新用户应加入的 **默认团队**
   - 复制 **SCIM 基础 URL** 和 **Bearer Token** 用于 IdP 配置

3. **配置您的身份提供商**
   - 使用 SCIM 基础 URL：`https://oneuptime.com/scim/v2/{scimId}`
   - 使用提供的令牌配置 Bearer 令牌认证
   - 映射用户属性（电子邮件为必填项）

### 项目 SCIM 端点

- **服务提供商配置**：`GET /scim/v2/{scimId}/ServiceProviderConfig`
- **Schema**：`GET /scim/v2/{scimId}/Schemas`
- **资源类型**：`GET /scim/v2/{scimId}/ResourceTypes`
- **用户列表**：`GET /scim/v2/{scimId}/Users`
- **获取用户**：`GET /scim/v2/{scimId}/Users/{userId}`
- **创建用户**：`POST /scim/v2/{scimId}/Users`
- **更新用户**：`PUT /scim/v2/{scimId}/Users/{userId}` 或 `PATCH /scim/v2/{scimId}/Users/{userId}`
- **删除用户**：`DELETE /scim/v2/{scimId}/Users/{userId}`
- **组列表**：`GET /scim/v2/{scimId}/Groups`
- **获取组**：`GET /scim/v2/{scimId}/Groups/{groupId}`
- **创建组**：`POST /scim/v2/{scimId}/Groups`
- **更新组**：`PUT /scim/v2/{scimId}/Groups/{groupId}` 或 `PATCH /scim/v2/{scimId}/Groups/{groupId}`
- **删除组**：`DELETE /scim/v2/{scimId}/Groups/{groupId}`

### 项目 SCIM 用户生命周期

1. **在 IdP 中分配用户**：当用户在 IdP 中被分配到 OneUptime 时
2. **SCIM 配置**：IdP 调用 OneUptime SCIM API 创建用户
3. **团队成员资格**：用户被自动添加到配置的默认团队
4. **授予访问权限**：用户现在可以访问 OneUptime 项目
5. **取消分配用户**：当用户在 IdP 中被取消分配时
6. **SCIM 取消配置**：IdP 调用 OneUptime SCIM API 移除用户
7. **撤销访问权限**：用户失去对项目的访问权限

## 状态页面 SCIM

状态页面 SCIM 允许身份提供商管理私有状态页面的订阅者。

### 设置状态页面 SCIM

1. **导航至状态页面设置**
   - 进入您的 OneUptime 状态页面
   - 导航至 **状态页面设置** > **私有用户** > **SCIM**

2. **配置 SCIM 设置**
   - 启用 **自动配置用户** 以在 IdP 中分配用户时自动添加订阅者
   - 启用 **自动取消配置用户** 以在 IdP 中取消分配用户时自动移除订阅者
   - 复制 **SCIM 基础 URL** 和 **Bearer Token** 用于 IdP 配置

3. **配置您的身份提供商**
   - 使用 SCIM 基础 URL：`https://oneuptime.com/status-page-scim/v2/{scimId}`
   - 使用提供的令牌配置 Bearer 令牌认证
   - 映射用户属性（电子邮件为必填项）

### 状态页面 SCIM 端点

- **服务提供商配置**：`GET /status-page-scim/v2/{scimId}/ServiceProviderConfig`
- **Schema**：`GET /status-page-scim/v2/{scimId}/Schemas`
- **资源类型**：`GET /status-page-scim/v2/{scimId}/ResourceTypes`
- **用户列表**：`GET /status-page-scim/v2/{scimId}/Users`
- **获取用户**：`GET /status-page-scim/v2/{scimId}/Users/{userId}`
- **创建用户**：`POST /status-page-scim/v2/{scimId}/Users`
- **更新用户**：`PUT /status-page-scim/v2/{scimId}/Users/{userId}` 或 `PATCH /status-page-scim/v2/{scimId}/Users/{userId}`
- **删除用户**：`DELETE /status-page-scim/v2/{scimId}/Users/{userId}`

### 状态页面 SCIM 用户生命周期

1. **在 IdP 中分配用户**：当用户在 IdP 中被分配到 OneUptime 状态页面时
2. **SCIM 配置**：IdP 调用 OneUptime SCIM API 创建订阅者
3. **授予访问权限**：用户现在可以访问私有状态页面
4. **取消分配用户**：当用户在 IdP 中被取消分配时
5. **SCIM 取消配置**：IdP 调用 OneUptime SCIM API 移除订阅者
6. **撤销访问权限**：用户失去对状态页面的访问权限

## 身份提供商配置

### Microsoft Entra ID（原 Azure AD）

Microsoft Entra ID 提供企业级身份管理，具备强大的 SCIM 配置能力。按照以下详细步骤配置与 OneUptime 的 SCIM 配置。

#### 前提条件

- 具有 Premium P1 或 P2 许可证的 Microsoft Entra ID 租户（自动配置所必需）
- 具有 Scale 计划或更高版本的 OneUptime 账号
- 对 Microsoft Entra ID 和 OneUptime 的管理员访问权限

#### 第一步：从 OneUptime 获取 SCIM 配置

1. 登录您的 OneUptime 控制台
2. 导航至 **项目设置** > **团队** > **SCIM**
3. 点击 **创建 SCIM 配置**
4. 输入友好名称（例如"Microsoft Entra ID Provisioning"）
5. 配置以下选项：
   - **自动配置用户**：启用以自动创建用户
   - **自动取消配置用户**：启用以自动移除用户
   - **默认团队**：选择新用户应加入的团队
   - **启用推送组**：如果您想通过 Entra ID 组管理团队成员资格，请启用
6. 保存配置
7. 复制 **SCIM 基础 URL** 和 **Bearer Token** - Entra ID 配置中需要这些信息

#### 第二步：在 Microsoft Entra ID 中创建企业应用程序

1. 登录 [Microsoft Entra 管理中心](https://entra.microsoft.com)
2. 导航至 **标识** > **应用程序** > **企业应用程序**
3. 点击 **+ 新建应用程序**
4. 点击 **+ 创建您自己的应用程序**
5. 输入名称（例如"OneUptime"）
6. 选择 **集成在库中找不到的任何其他应用程序（非库应用程序）**
7. 点击 **创建**

#### 第三步：配置 SCIM 预配

1. 在您的 OneUptime 企业应用程序中，转到 **预配**
2. 点击 **开始使用**
3. 将 **预配模式** 设置为 **自动**
4. 在 **管理员凭据** 下：
   - **租户 URL**：输入 OneUptime 中的 SCIM 基础 URL（例如 `https://oneuptime.com/api/identity/scim/v2/{your-scim-id}`）
   - **机密令牌**：输入 OneUptime 中的 Bearer Token
5. 点击 **测试连接** 以验证配置
6. 点击 **保存**

#### 第四步：配置属性映射

1. 在预配部分，点击 **映射**
2. 点击 **预配 Azure Active Directory 用户**
3. 配置以下属性映射：

| Azure AD 属性 | OneUptime SCIM 属性 | 是否必填 |
|--------------|---------------------|---------|
| `userPrincipalName` | `userName` | 是 |
| `mail` | `emails[type eq "work"].value` | 建议 |
| `displayName` | `displayName` | 建议 |
| `givenName` | `name.givenName` | 可选 |
| `surname` | `name.familyName` | 可选 |
| `Switch([IsSoftDeleted], , "False", "True", "True", "False")` | `active` | 建议 |

4. 删除不需要的映射以简化配置
5. 点击 **保存**

#### 第五步：配置组预配（可选）

如果您在 OneUptime 中启用了 **推送组**：

1. 返回 **映射**
2. 点击 **预配 Azure Active Directory 组**
3. 将 **已启用** 设置为 **是** 以启用组预配
4. 配置以下属性映射：

| Azure AD 属性 | OneUptime SCIM 属性 |
|--------------|---------------------|
| `displayName` | `displayName` |
| `members` | `members` |

5. 点击 **保存**

#### 第六步：分配用户和组

1. 在您的 OneUptime 企业应用程序中，转到 **用户和组**
2. 点击 **+ 添加用户/组**
3. 选择您要配置到 OneUptime 的用户和/或组
4. 点击 **分配**

#### 第七步：开始预配

1. 转到 **预配** > **概述**
2. 点击 **开始预配**
3. 初始预配周期将开始（首次同步可能需要长达 40 分钟）
4. 监控 **预配日志** 以查看任何错误

#### Microsoft Entra ID 故障排查

- **测试连接失败**：验证 SCIM 基础 URL 是否包含 `/api/identity` 前缀，以及 Bearer Token 是否正确
- **用户未配置**：检查用户是否已分配到应用程序，以及属性映射是否正确
- **预配错误**：在 Entra ID 的预配日志中查看具体错误消息
- **同步延迟**：初始预配可能需要长达 40 分钟；后续同步每 40 分钟进行一次

---

### Okta

Okta 提供灵活的身份管理，具有出色的 SCIM 支持。按照以下详细步骤配置与 OneUptime 的 SCIM 配置。

#### 前提条件

- 具有配置能力的 Okta 租户（生命周期管理功能）
- 具有 Scale 计划或更高版本的 OneUptime 账号
- 对 Okta 和 OneUptime 的管理员访问权限

#### 第一步：从 OneUptime 获取 SCIM 配置

1. 登录您的 OneUptime 控制台
2. 导航至 **项目设置** > **团队** > **SCIM**
3. 点击 **创建 SCIM 配置**
4. 输入友好名称（例如"Okta Provisioning"）
5. 配置以下选项：
   - **自动配置用户**：启用以自动创建用户
   - **自动取消配置用户**：启用以自动移除用户
   - **默认团队**：选择新用户应加入的团队
   - **启用推送组**：如果您想通过 Okta 组管理团队成员资格，请启用
6. 保存配置
7. 复制 **SCIM 基础 URL** 和 **Bearer Token** - Okta 配置中需要这些信息

#### 第二步：创建或配置 Okta 应用程序

**如果您有现有的 SSO 应用程序：**
1. 登录您的 Okta 管理控制台
2. 导航至 **应用程序** > **应用程序**
3. 找到并选择您现有的 OneUptime 应用程序

**如果创建新应用程序：**
1. 登录您的 Okta 管理控制台
2. 导航至 **应用程序** > **应用程序**
3. 点击 **创建应用集成**
4. 选择 **SAML 2.0** 并点击 **下一步**
5. 输入"OneUptime"作为应用名称
6. 完成 SAML 配置（参阅 SSO 文档）
7. 点击 **完成**

#### 第三步：启用 SCIM 预配

1. 在您的 OneUptime 应用程序中，转到 **常规** 选项卡
2. 在 **应用程序设置** 部分，点击 **编辑**
3. 在 **预配** 下，选择 **SCIM**
4. 点击 **保存**
5. 将出现新的 **预配** 选项卡

#### 第四步：配置 SCIM 连接

1. 转到 **预配** 选项卡
2. 点击左侧边栏中的 **集成**
3. 点击 **配置 API 集成**
4. 勾选 **启用 API 集成**
5. 配置以下内容：
   - **SCIM 连接器基础 URL**：输入 OneUptime 中的 SCIM 基础 URL（例如 `https://oneuptime.com/api/identity/scim/v2/{your-scim-id}`）
   - **用户的唯一标识符字段**：输入 `userName`
   - **支持的预配操作**：选择您要启用的操作：
     - 导入新用户和配置文件更新
     - 推送新用户
     - 推送配置文件更新
     - 推送组（如果使用基于组的预配）
   - **认证模式**：选择 **HTTP Header**
   - **授权**：输入 `Bearer {your-bearer-token}`（替换为实际令牌）
6. 点击 **测试 API 凭据** 以验证连接
7. 点击 **保存**

#### 第五步：配置应用程序预配

1. 在 **预配** 选项卡中，点击左侧边栏中的 **到应用**
2. 点击 **编辑**
3. 启用以下选项：
   - **创建用户**：启用以配置新用户
   - **更新用户属性**：启用以同步属性更改
   - **停用用户**：启用以在取消分配时取消配置用户
4. 点击 **保存**

#### 第六步：配置属性映射

1. 向下滚动至 **属性映射**
2. 验证或配置以下映射：

| Okta 属性 | OneUptime SCIM 属性 | 方向 |
|----------|---------------------|------|
| `userName` | `userName` | Okta 到应用 |
| `user.email` | `emails[primary eq true].value` | Okta 到应用 |
| `user.firstName` | `name.givenName` | Okta 到应用 |
| `user.lastName` | `name.familyName` | Okta 到应用 |
| `user.displayName` | `displayName` | Okta 到应用 |

3. 删除不必要的映射
4. 如果有更改，点击 **保存**

#### 第七步：配置推送组（可选）

如果您在 OneUptime 中启用了 **推送组**：

1. 转到 **推送组** 选项卡
2. 点击 **+ 推送组**
3. 选择 **按名称查找组** 或 **按规则查找组**
4. 搜索并选择要推送的组
5. 点击 **保存**

#### 第八步：分配用户

1. 转到 **分配** 选项卡
2. 点击 **分配** > **分配给人员** 或 **分配给组**
3. 选择要配置的用户或组
4. 对每个选择点击 **分配**
5. 点击 **完成**

#### 第九步：验证预配

1. 在 Okta 管理控制台中转到 **报告** > **系统日志**
2. 筛选与您的 OneUptime 应用程序相关的事件
3. 验证预配事件是否成功
4. 检查 OneUptime 以确认用户已被创建

#### Okta 故障排查

- **API 凭据测试失败**：验证 SCIM 基础 URL 和 Bearer Token 是否正确
- **用户未配置**：确保用户已分配到应用程序且预配已启用
- **重复用户**：确保 `userName` 属性唯一且正确映射到电子邮件
- **组推送失败**：验证组是否存在且成员资格是否正确
- **错误：401 Unauthorized**：在 OneUptime 中重新生成 Bearer Token 并更新 Okta

---

### 其他身份提供商

OneUptime 的 SCIM 实现遵循 SCIM v2.0 规范，应能与任何合规的身份提供商配合使用。通用配置步骤：

1. **SCIM 基础 URL**：`https://oneuptime.com/api/identity/scim/v2/{scim-id}`（用于项目）或 `https://oneuptime.com/api/identity/status-page-scim/v2/{scim-id}`（用于状态页面）
2. **认证**：HTTP Bearer 令牌
3. **必填用户属性**：`userName`（必须是有效的电子邮件地址）
4. **支持的操作**：GET、POST、PUT、PATCH、DELETE（用于用户和组）

#### 支持的 SCIM 端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/ServiceProviderConfig` | GET | SCIM 服务器能力 |
| `/Schemas` | GET | 可用资源 Schema |
| `/ResourceTypes` | GET | 可用资源类型 |
| `/Users` | GET, POST | 列出和创建用户 |
| `/Users/{id}` | GET, PUT, PATCH, DELETE | 管理单个用户 |
| `/Groups` | GET, POST | 列出和创建组/团队（仅项目 SCIM） |
| `/Groups/{id}` | GET, PUT, PATCH, DELETE | 管理单个组（仅项目 SCIM） |

#### SCIM 用户 Schema

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

#### SCIM 组 Schema

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

## 常见问题

### 用户取消配置后会发生什么？

当用户被取消配置（通过 DELETE 请求或将 `active` 设置为 `false`）时，他们将从 SCIM 设置中配置的团队中被移除。用户账号本身仍保留在 OneUptime 中，但失去对项目的访问权限。

### 我可以在不使用 SSO 的情况下使用 SCIM 吗？

可以，SCIM 和 SSO 是独立的功能。您可以使用 SCIM 进行用户配置，同时允许用户使用 OneUptime 密码或任何其他认证方式登录。

### 如何处理 OneUptime 中已存在的用户？

当 SCIM 尝试创建已存在（通过电子邮件匹配）的用户时，OneUptime 只会将其添加到配置的默认团队，而不是创建重复用户。

### 默认团队和推送组有什么区别？

- **默认团队**：通过 SCIM 配置的所有用户都会被添加到相同的预定义团队
- **推送组**：团队成员资格由您的身份提供商管理，允许不同用户根据 IdP 组成员资格加入不同的团队

### 预配同步频率是多少？

这取决于您的身份提供商：
- **Microsoft Entra ID**：初始同步最长可达 40 分钟；后续同步每 40 分钟进行一次
- **Okta**：大多数操作接近实时，并定期进行完整同步
