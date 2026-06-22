# SSO（单点登录）

OneUptime 支持基于 SAML 2.0 的单点登录（SSO）进行企业认证。SSO 允许您的团队成员使用组织的身份提供商（IdP）登录 OneUptime，从而实现集中访问管理和增强的安全性。

## 概述

SSO 集成提供以下优势：

- **集中认证**：用户使用现有的企业凭据登录
- **增强安全性**：利用 IdP 的多因素认证和安全策略
- **简化用户管理**：从现有身份管理系统管理访问权限
- **减少密码疲劳**：用户无需记住单独的 OneUptime 密码

## 设置 SSO

1. **导航至项目设置**

   - 进入您的 OneUptime 项目
   - 导航至 **项目设置** > **认证** > **SSO**

2. **创建 SSO 配置**

   - 点击 **创建 SSO**
   - 输入 SSO 配置的 **名称**（例如"Keycloak SAML"或"Okta SAML"）
   - 输入身份提供商的 **登录 URL**
   - 输入身份提供商的 **颁发者**（实体 ID）
   - 粘贴身份提供商的 **公共证书**
   - 选择 **签名算法**（例如 `RSA-SHA-256`）
   - 选择 **摘要算法**（例如 `SHA256`）

3. **获取 OneUptime SSO 元数据**
   - 保存后，点击 **查看 SSO 配置** 按钮
   - 复制 **标识符（实体 ID）** — IdP 配置中需要此信息
   - 复制 **回复 URL（断言使用者服务 URL）** — IdP 配置中需要此信息

## Keycloak SAML 配置

Keycloak 是一款流行的开源身份和访问管理解决方案。按照以下步骤将 Keycloak 配置为 OneUptime 的 SAML 身份提供商。

### 前提条件

- 运行中的 Keycloak 实例，且已配置 realm
- 对 Keycloak 和 OneUptime 的管理员访问权限
- 支持 SSO 的 OneUptime 账号

### 第一步：配置 OneUptime SSO

1. 登录您的 OneUptime 控制台
2. 导航至 **项目设置** > **认证** > **SSO**
3. 点击 **创建 SSO** 并填写以下内容：
   - **名称**：描述性名称（例如 `my-project-oneuptime`）
   - **登录 URL**：`https://<your-keycloak-domain>/auth/realms/<your-realm>/protocol/saml`
   - **颁发者**：`https://<your-keycloak-domain>/auth/realms/<your-realm>`
   - **证书**：参见下方[第二步](#第二步获取-keycloak-证书)
   - **签名算法**：`RSA-SHA-256`
   - **摘要算法**：`SHA256`
4. 保存配置

### 第二步：获取 Keycloak 证书

1. 在 Keycloak 中，导航至您的客户端配置
2. 点击 **导出**（或根据您的 Keycloak 版本转到 **密钥** 选项卡）
3. 在导出的 JSON 文件中，找到名称中带有 `certificate` 的密钥
4. 复制证书值并以以下格式粘贴到 OneUptime 中：

```
-----BEGIN CERTIFICATE-----
MIICnzCCAYcCBgFyPZ8QFzANBgkqhkiG.......
-----END CERTIFICATE-----
```

### 第三步：配置 Keycloak 客户端

1. 在 Keycloak 中，导航至您 realm 中的 **客户端**
2. 创建新客户端或编辑现有客户端
3. 将 **客户端协议** 设置为 `saml`
4. 将 **客户端 ID** 设置为 OneUptime **查看 SSO 配置** 中的 **标识符（实体 ID）** 值
5. 将 **有效重定向 URI** 设置为您的 OneUptime URL
6. 将 **根 URL** 设置为您的 OneUptime 基础 URL
7. 将 OneUptime 中的 **回复 URL（断言使用者服务 URL）** 粘贴到 **断言使用者服务 POST 绑定 URL** 字段中

### 第四步：配置 Keycloak 客户端设置

1. 禁用 **签名密钥配置**（在密钥选项卡下）
2. 将 **Name ID 格式** 设置为 `email`
3. 确保启用 **强制 Name ID 格式** 选项，以便 Keycloak 始终将电子邮件作为 Name ID 发送

### 第五步：验证配置

1. 保存 Keycloak 和 OneUptime 中的所有设置
2. 尝试使用 SSO 登录 OneUptime
3. 您应该被重定向到 Keycloak 登录页面，成功认证后返回 OneUptime

### Keycloak 故障排查

- **登录因签名错误失败**：确保证书已正确复制，包括 `BEGIN CERTIFICATE` 和 `END CERTIFICATE` 行
- **Name ID 错误**：验证 Keycloak 中的 **Name ID 格式** 是否设置为 `email`
- **重定向循环**：检查 **有效重定向 URI** 和 **断言使用者服务 POST 绑定 URL** 是否正确配置
- **证书未找到**：确保您从正确的 realm 中的正确客户端导出

---

## Microsoft Entra ID（原 Azure AD / Active Directory）SAML 配置

Microsoft Entra ID 是 Microsoft 基于云的身份和访问管理服务。按照以下步骤将 Entra ID 配置为 OneUptime 的 SAML 身份提供商。

### 前提条件

- Microsoft Entra ID 租户（任何支持企业应用程序 SAML SSO 的层级）
- 对 Microsoft Entra ID 和 OneUptime 的管理员访问权限
- 支持 SSO 的 OneUptime 账号

### 第一步：配置 OneUptime SSO

1. 登录您的 OneUptime 控制台
2. 导航至 **项目设置** > **认证** > **SSO**
3. 点击 **创建 SSO** 并填写以下内容：
   - **名称**：描述性名称（例如 `Azure AD SAML`）
   - **登录 URL**：您将在[第三步](#第三步将-entra-id-saml-元数据复制到-oneuptime)中从 Entra ID 获取
   - **颁发者**：您将在[第三步](#第三步将-entra-id-saml-元数据复制到-oneuptime)中从 Entra ID 获取
   - **证书**：您将在[第三步](#第三步将-entra-id-saml-元数据复制到-oneuptime)中从 Entra ID 获取
   - **签名算法**：`RSA-SHA-256`
   - **摘要算法**：`SHA256`
4. 点击 **查看 SSO 配置** 并复制 **标识符（实体 ID）** 和 **回复 URL（断言使用者服务 URL）** — 您将在 Entra ID 中使用这些信息

### 第二步：在 Microsoft Entra ID 中创建企业应用程序

1. 登录 [Microsoft Entra 管理中心](https://entra.microsoft.com)
2. 导航至 **标识** > **应用程序** > **企业应用程序**
3. 点击 **+ 新建应用程序**
4. 点击 **+ 创建您自己的应用程序**
5. 输入名称（例如"OneUptime"）
6. 选择 **集成在库中找不到的任何其他应用程序（非库应用程序）**
7. 点击 **创建**

### 第三步：在 Entra ID 中配置 SAML SSO

1. 在您的新企业应用程序中，转到 **单一登录**
2. 选择 **SAML** 作为单一登录方法
3. 在 **基本 SAML 配置** 中，点击 **编辑** 并设置：
   - **标识符（实体 ID）**：粘贴 OneUptime **查看 SSO 配置** 中的 **标识符（实体 ID）**
   - **回复 URL（断言使用者服务 URL）**：粘贴 OneUptime **查看 SSO 配置** 中的 **回复 URL**
4. 点击 **保存**
5. 在 **SAML 证书** 部分：
   - 下载 **证书（Base64）**
   - 在文本编辑器中打开下载的证书文件并复制内容
6. 在 **设置 OneUptime** 部分，复制：
   - **登录 URL** — 将其粘贴为 OneUptime 中的 **登录 URL**
   - **Azure AD 标识符** — 将其粘贴为 OneUptime 中的 **颁发者**
7. 返回 OneUptime，粘贴证书和 URL，然后保存

### 第四步：配置用户属性和声明

1. 在 SAML 配置页面，点击 **属性和声明** 上的 **编辑**
2. 确保以下声明已配置：

| 声明名称                                                             | 值                                      |
| -------------------------------------------------------------------- | --------------------------------------- |
| `Unique User Identifier (Name ID)`                                   | `user.userprincipalname` 或 `user.mail` |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress` | `user.mail`                             |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname`    | `user.givenname`                        |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname`      | `user.surname`                          |

3. 将 **名称标识符格式** 设置为 `电子邮件地址`
4. 点击 **保存**

### 第五步：分配用户和组

1. 在您的企业应用程序中，转到 **用户和组**
2. 点击 **+ 添加用户/组**
3. 选择您要授予 SSO 访问权限的用户和/或组
4. 点击 **分配**

### 第六步：验证配置

1. 保存 Entra ID 和 OneUptime 中的所有设置
2. 尝试使用 SSO 登录 OneUptime
3. 您应该被重定向到 Microsoft 登录页面，成功认证后返回 OneUptime

### Microsoft Entra ID 故障排查

- **AADSTS700016 错误**：Entra ID 中的标识符（实体 ID）与 OneUptime 不匹配 — 验证两个值是否完全相同
- **证书错误**：确保您下载的是 **Base64** 证书（而非原始/二进制格式），并包含 `BEGIN CERTIFICATE` / `END CERTIFICATE` 行
- **用户未分配**：用户必须明确分配到企业应用程序才能通过 SSO 登录
- **Name ID 不匹配**：确保 Name ID 声明设置为与用户在 OneUptime 中的电子邮件匹配的电子邮件地址

---

## Okta SAML 配置

Okta 是一款广泛使用的身份平台，提供强大的 SAML SSO 能力。按照以下步骤将 Okta 配置为 OneUptime 的 SAML 身份提供商。

### 前提条件

- 具有管理员访问权限的 Okta 组织
- 支持 SSO 的 OneUptime 账号

### 第一步：配置 OneUptime SSO

1. 登录您的 OneUptime 控制台
2. 导航至 **项目设置** > **认证** > **SSO**
3. 点击 **创建 SSO** 并填写以下内容：
   - **名称**：描述性名称（例如 `Okta SAML`）
   - **登录 URL**：您将在[第三步](#第三步将-okta-saml-元数据复制到-oneuptime)中从 Okta 获取
   - **颁发者**：您将在[第三步](#第三步将-okta-saml-元数据复制到-oneuptime)中从 Okta 获取
   - **证书**：您将在[第三步](#第三步将-okta-saml-元数据复制到-oneuptime)中从 Okta 获取
   - **签名算法**：`RSA-SHA-256`
   - **摘要算法**：`SHA256`
4. 点击 **查看 SSO 配置** 并复制 **标识符（实体 ID）** 和 **回复 URL（断言使用者服务 URL）** — 您将在 Okta 中使用这些信息

### 第二步：在 Okta 中创建 SAML 应用程序

1. 登录您的 Okta 管理控制台
2. 导航至 **应用程序** > **应用程序**
3. 点击 **创建应用集成**
4. 选择 **SAML 2.0** 并点击 **下一步**
5. 输入"OneUptime"作为 **应用名称** 并点击 **下一步**
6. 在 **SAML 设置** 部分，配置：
   - **单一登录 URL**：粘贴 OneUptime **查看 SSO 配置** 中的 **回复 URL（断言使用者服务 URL）**
   - **受众 URI（SP 实体 ID）**：粘贴 OneUptime **查看 SSO 配置** 中的 **标识符（实体 ID）**
   - **Name ID 格式**：选择 `EmailAddress`
   - **应用程序用户名**：选择 `Email`
7. 点击 **下一步**，选择 **我是添加内部应用的 Okta 客户** 并点击 **完成**

### 第三步：将 Okta SAML 元数据复制到 OneUptime

1. 在您的 Okta 应用程序中，转到 **登录** 选项卡
2. 在 **SAML 签名证书** 部分，找到活动证书，点击 **操作** > **查看 IdP 元数据**
3. 从元数据 XML 或 **登录** 选项卡详情中：
   - 复制 **登录 URL**（也称为 **身份提供商单一登录 URL**）— 将其粘贴为 OneUptime 中的 **登录 URL**
   - 复制 **颁发者**（也称为 **身份提供商颁发者**）— 将其粘贴为 OneUptime 中的 **颁发者**
4. 下载签名证书：
   - 在 **SAML 签名证书** 部分，点击活动证书的 **操作** > **下载证书**
   - 在文本编辑器中打开下载的 `.cert` 文件并复制内容
   - 将证书粘贴到 OneUptime 中（包括 `BEGIN CERTIFICATE` 和 `END CERTIFICATE` 行）
5. 保存 OneUptime SSO 配置

### 第四步：配置属性声明（可选）

1. 在 Okta 应用程序中，转到 **常规** 选项卡
2. 在 **SAML 设置** 部分点击 **编辑**，然后点击 **下一步** 进入 SAML 设置
3. 在 **属性声明** 部分，添加：

| 名称        | 值               |
| ----------- | ---------------- |
| `email`     | `user.email`     |
| `firstName` | `user.firstName` |
| `lastName`  | `user.lastName`  |

4. 点击 **下一步** 然后点击 **完成**

### 第五步：分配用户和组

1. 在您的 Okta 应用程序中，转到 **分配** 选项卡
2. 点击 **分配** > **分配给人员** 或 **分配给组**
3. 选择您要授予 SSO 访问权限的用户或组
4. 对每个选择点击 **分配**，然后点击 **完成**

### 第六步：验证配置

1. 保存 Okta 和 OneUptime 中的所有设置
2. 尝试使用 SSO 登录 OneUptime
3. 您应该被重定向到 Okta 登录页面，成功认证后返回 OneUptime

### Okta 故障排查

- **404 或无效的 SSO URL**：验证 Okta 中的 **单一登录 URL** 是否与 OneUptime 中的 **回复 URL** 完全匹配
- **受众不匹配**：确保 Okta 中的 **受众 URI** 与 OneUptime 中的 **标识符（实体 ID）** 完全匹配
- **证书错误**：确保您下载的是 **活动** 签名证书的证书，而非不活动的证书
- **用户未分配**：用户必须分配到 Okta 应用程序才能通过 SSO 登录
- **Name ID 错误**：验证 **Name ID 格式** 是否设置为 `EmailAddress`，以及 **应用程序用户名** 是否设置为 `Email`

---

## 其他身份提供商

OneUptime 的 SSO 实现使用 SAML 2.0 协议，应能与任何合规的身份提供商配合使用。通用配置步骤如下：

1. 在 OneUptime 中，创建 SSO 配置，并从 **查看 SSO 配置** 按钮记录 **标识符（实体 ID）** 和 **回复 URL（断言使用者服务 URL）**
2. 在您的身份提供商中，使用以下信息创建 SAML 应用程序：
   - **断言使用者服务 URL / 回复 URL**：来自 OneUptime SSO 配置
   - **实体 ID / 受众 URI**：来自 OneUptime SSO 配置
   - **Name ID 格式**：电子邮件地址
3. 从您的身份提供商复制以下信息到 OneUptime：
   - **登录 URL**（SSO 端点）
   - **颁发者**（IdP 的实体 ID）
   - **公共证书**（X.509 签名证书）
4. 将 **签名算法** 设置为 `RSA-SHA-256`，将 **摘要算法** 设置为 `SHA256`

## 关于 SSO 和角色的说明

OneUptime 目前不支持从身份提供商映射 SAML 角色。基于角色的访问控制必须在 OneUptime 的 **项目设置** > **SSO** 设置中单独配置，您可以在其中为 SSO 用户分配默认角色。
