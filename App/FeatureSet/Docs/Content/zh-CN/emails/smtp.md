# SMTP 配置

OneUptime 支持通过自定义 SMTP 服务器发送电子邮件，提供三种认证方式：

- **用户名和密码** - 传统 SMTP 认证
- **OAuth 2.0** - 适用于 Microsoft 365 和 Google Workspace 的现代认证
- **无认证** - 适用于不需要认证的中继服务器

本指南介绍如何为 Microsoft 365 和 Google Workspace 配置 OAuth 2.0 认证。

## OAuth 2.0 认证

OAuth 2.0 为与邮件服务器进行认证提供了更安全的方式，尤其适用于已禁用基本认证的企业环境。OneUptime 支持两种 OAuth 授权类型：

- **客户端凭据（Client Credentials）** - 适用于 Microsoft 365 和大多数 OAuth 提供商
- **JWT Bearer** - 适用于 Google Workspace 服务账号

### OAuth 所需字段

在 OneUptime 中使用 OAuth 认证配置 SMTP 时，您需要填写以下信息：

| 字段                 | 描述                                                                      |
| -------------------- | ------------------------------------------------------------------------- |
| **主机名**           | SMTP 服务器地址                                                           |
| **端口**             | SMTP 端口（通常 STARTTLS 使用 587，隐式 TLS 使用 465）                    |
| **用户名**           | 发送邮件的电子邮件地址                                                    |
| **认证类型**         | 选择"OAuth"                                                               |
| **OAuth 提供商类型** | Microsoft 365 选择"Client Credentials"，Google Workspace 选择"JWT Bearer" |
| **Client ID**        | 来自您 OAuth 提供商的应用程序/客户端 ID（Google 填写服务账号邮件地址）    |
| **Client Secret**    | 来自您 OAuth 提供商的客户端密钥（Google 填写私钥）                        |
| **Token URL**        | OAuth 令牌端点 URL                                                        |
| **Scope**            | SMTP 访问所需的 OAuth 范围                                                |

---

## Microsoft 365 配置

要将 OAuth 与 Microsoft 365/Exchange Online 配合使用，您需要在 Microsoft Entra（Azure AD）中注册应用程序并配置适当的权限。

### 第一步：在 Microsoft Entra 中注册应用程序

1. 登录 [Microsoft Entra 管理中心](https://entra.microsoft.com)
2. 导航至 **标识** > **应用程序** > **应用注册**
3. 点击 **新注册**
4. 为您的应用程序输入名称（例如"OneUptime SMTP"）
5. 对于 **受支持的帐户类型**，选择"仅此组织目录中的帐户"
6. 将 **重定向 URI** 留空（客户端凭据流程不需要）
7. 点击 **注册**

注册后，从 **概述** 页面记录以下值：

- **应用程序（客户端）ID** - 这是您的 Client ID
- **目录（租户）ID** - 您将需要此信息来构建 Token URL

### 第二步：创建客户端密钥

1. 在您的应用注册中，转到 **证书和密钥**
2. 点击 **新建客户端密钥**
3. 添加描述并选择过期时间
4. 点击 **添加**
5. **立即复制密钥值** - 之后将不再显示

### 第三步：添加 SMTP API 权限

1. 转到 **API 权限**
2. 点击 **添加权限**
3. 选择 **我的组织使用的 API**
4. 搜索并选择 **Office 365 Exchange Online**
5. 选择 **应用程序权限**
6. 找到并勾选 **SMTP.SendAsApp**
7. 点击 **添加权限**
8. 点击 **为 [您的组织] 授予管理员同意**（需要管理员权限）

### 第四步：在 Exchange Online 中注册服务主体

在您的应用程序能够发送电子邮件之前，您必须在 Exchange Online 中注册服务主体并授予邮箱权限。

1. 安装 Exchange Online PowerShell 模块：

```powershell
Install-Module -Name ExchangeOnlineManagement -Force
```

2. 连接到 Exchange Online：

```powershell
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -Organization <your-tenant-id>
```

3. 注册服务主体（使用 **企业应用程序** 中的对象 ID，而非应用注册中的 ID）：

```powershell
# 在 Microsoft Entra > 企业应用程序 > 您的应用 > 对象 ID 中查找对象 ID
New-ServicePrincipal -AppId <application-client-id> -ObjectId <enterprise-app-object-id>
```

4. 授予服务主体从特定邮箱发送邮件的权限：

```powershell
# 向服务主体授予完整邮箱访问权限
Add-MailboxPermission -Identity "sender@yourdomain.com" -User <service-principal-id> -AccessRights FullAccess
```

> **注意：** 使用 `Add-MailboxPermission`（而非 `Add-RecipientPermission`）。`Add-RecipientPermission` 仅在收件人上授予 `SendAs` 权限，对于服务主体通过 OAuth 使用 SMTP 发送邮件来说不够用——发送时会出现认证/权限错误。带 `FullAccess` 的 `Add-MailboxPermission` 才是实际有效的命令。

### 第五步：在 OneUptime 中配置

在 OneUptime 中，使用以下设置创建或编辑 SMTP 配置：

| 字段             | 值                                                                |
| ---------------- | ----------------------------------------------------------------- |
| 主机名           | `smtp.office365.com`                                              |
| 端口             | `587`                                                             |
| 用户名           | 您授权的电子邮件地址（例如 `sender@yourdomain.com`）              |
| 认证类型         | `OAuth`                                                           |
| OAuth 提供商类型 | `Client Credentials`                                              |
| Client ID        | 第一步中的应用程序（客户端）ID                                    |
| Client Secret    | 第二步中的密钥值                                                  |
| Token URL        | `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` |
| Scope            | `https://outlook.office365.com/.default`                          |
| 发件人邮箱       | 与用户名相同                                                      |
| 安全（TLS）      | 已启用                                                            |

将 `<tenant-id>` 替换为第一步中的目录（租户）ID。

---

## Google Workspace 配置

Google Workspace 需要一个具有域范围委派权限的**服务账号**，以便代表用户发送电子邮件。这是必要的，因为 Google 的 SMTP 服务器不支持 Gmail 的直接 OAuth 客户端凭据流程。

### 前提条件

- Google Workspace 账号（非普通 Gmail - 消费者 Gmail 账号不支持此功能）
- Google Workspace 管理员控制台的超级管理员访问权限
- Google Cloud Console 的访问权限

### 第一步：创建 Google Cloud 项目

1. 转到 [Google Cloud Console](https://console.cloud.google.com)
2. 点击项目下拉菜单并选择 **新建项目**
3. 输入项目名称并点击 **创建**
4. 选择您的新项目

### 第二步：启用 Gmail API

1. 转到 **API 和服务** > **库**
2. 搜索"Gmail API"
3. 点击 **Gmail API** 然后点击 **启用**

### 第三步：创建服务账号

1. 转到 **API 和服务** > **凭据**
2. 点击 **创建凭据** > **服务账号**
3. 输入服务账号的名称和描述
4. 点击 **创建并继续**
5. 跳过可选步骤并点击 **完成**

### 第四步：创建服务账号密钥

1. 点击您刚创建的服务账号
2. 转到 **密钥** 选项卡
3. 点击 **添加密钥** > **创建新密钥**
4. 选择 **JSON** 并点击 **创建**
5. 安全保存下载的 JSON 文件 - 它包含：
   - `client_id` - 您的 Client ID
   - `private_key` - 您的 Client Secret（私钥）

### 第五步：启用域范围委派

1. 在服务账号详情中，点击 **显示高级设置**
2. 记录 **客户端 ID**（数字 ID）
3. 勾选 **启用 Google Workspace 域范围委派**
4. 点击 **保存**

### 第六步：在 Google Workspace 管理员控制台中授权服务账号

1. 登录 [Google Workspace 管理员控制台](https://admin.google.com)
2. 转到 **安全** > **访问和数据控制** > **API 控制**
3. 点击 **管理域范围委派**
4. 点击 **添加新项**
5. 输入第五步中的 **客户端 ID**
6. 对于 **OAuth 范围**，输入：`https://mail.google.com/`
7. 点击 **授权**

注意：委派生效可能需要几分钟到 24 小时。

### 第七步：在 OneUptime 中配置

在 OneUptime 中，使用以下设置创建或编辑 SMTP 配置：

| 字段             | 值                                                                                                               |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| 主机名           | `smtp.gmail.com`                                                                                                 |
| 端口             | `587`                                                                                                            |
| 用户名           | 要发送邮件的 Google Workspace 电子邮件地址（例如 `notifications@yourdomain.com`）。此用户将被服务账号模拟。      |
| 认证类型         | `OAuth`                                                                                                          |
| OAuth 提供商类型 | `JWT Bearer`                                                                                                     |
| Client ID        | 服务账号 JSON 中的 `client_email`（例如 `your-service@your-project.iam.gserviceaccount.com`）                    |
| Client Secret    | 服务账号 JSON 中的 `private_key`（包括 `-----BEGIN PRIVATE KEY-----` 和 `-----END PRIVATE KEY-----` 的完整密钥） |
| Token URL        | `https://oauth2.googleapis.com/token`                                                                            |
| Scope            | `https://mail.google.com/`                                                                                       |
| 发件人邮箱       | 与用户名相同                                                                                                     |
| 安全（TLS）      | 已启用                                                                                                           |

**重要提示：** 对于 Google（JWT Bearer），Client ID 是**服务账号邮箱**（`client_email`），而非数字 `client_id`。服务账号将模拟用户名字段中指定的用户来发送电子邮件。

---

## 故障排查

### Microsoft 365

| 问题                                            | 解决方案                                                  |
| ----------------------------------------------- | --------------------------------------------------------- |
| "Authentication unsuccessful"                   | 验证服务主体是否已在 Exchange 中注册并具有邮箱权限        |
| "AADSTS700016: Application not found"           | 检查 Client ID 是否正确，以及应用程序是否存在于您的租户中 |
| "AADSTS7000215: Invalid client secret"          | 重新生成客户端密钥 - 可能已过期                           |
| "The mailbox is not enabled for this operation" | 运行 `Add-MailboxPermission` 以授予邮箱访问权限           |

### Google Workspace

| 问题                                                | 解决方案                                                    |
| --------------------------------------------------- | ----------------------------------------------------------- |
| "invalid_grant"                                     | 确保域范围委派已正确配置并已生效                            |
| "unauthorized_client"                               | 验证 Client ID 已在 Google Workspace 管理员控制台中获得授权 |
| "access_denied"                                     | 检查范围 `https://mail.google.com/` 是否已获得授权          |
| "Domain policy has disabled third-party Drive apps" | 在 Google Workspace 管理员 > 安全 > API 控制中启用 API 访问 |

### 通用

- **测试您的配置**：使用 OneUptime 中的"发送测试邮件"按钮验证您的设置
- **检查日志**：查看 OneUptime 日志以获取详细错误信息
- **令牌缓存**：OneUptime 会缓存 OAuth 令牌并在过期前自动刷新

---

## 安全最佳实践

1. **定期轮换密钥**：设置日历提醒，在客户端密钥过期前轮换
2. **使用专用服务账号**：为 OneUptime 创建独立凭据，而非与其他应用程序共享
3. **最小权限原则**：仅授予所需的最低权限（Microsoft 使用 SMTP.SendAsApp，Google 使用 mail.google.com 范围）
4. **监控使用情况**：检查电子邮件日志和 OAuth 应用程序登录记录，查找异常活动
5. **安全存储**：切勿将客户端密钥提交到版本控制系统

---

## 其他资源

### Microsoft 365

- [使用 OAuth 进行 IMAP、POP 或 SMTP 连接认证](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
- [向 Microsoft 标识平台注册应用程序](https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)

### Google Workspace

- [将 OAuth 2.0 用于服务器到服务器应用程序](https://developers.google.com/identity/protocols/oauth2/service-account)
- [Gmail API 文档](https://developers.google.com/gmail/api)
- [XOAUTH2 协议](https://developers.google.com/gmail/imap/xoauth2-protocol)
