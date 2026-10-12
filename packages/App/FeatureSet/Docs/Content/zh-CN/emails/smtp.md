# SMTP

通过您自己的邮件服务器发送 OneUptime 的邮件。项目可以添加 SMTP 配置，供其状态页面发送邮件时使用；自托管安装则设置 OneUptime 发送其他所有邮件所用的服务器。两者都支持三种登录方式：

- **用户名和密码**：传统的 SMTP 认证。
- **OAuth 2.0**：适用于通常已关闭基本认证的 Microsoft 365 和 Google Workspace。
- **无**：适用于不需要认证的中继服务器。

```mermaid title="哪个邮件服务器发送什么"
flowchart TB
    SP["状态页面的邮件"] --> Q{"页面是否选择了<br/>自定义 SMTP 配置？"}
    Q -->|"是"| P["项目的 SMTP 配置"]
    Q -->|"否"| D["OneUptime 自己的邮件服务器"]
    E["OneUptime 的其他所有邮件"] --> D
```

在自托管安装中，OneUptime 自己的邮件服务器就是您在 Admin Dashboard 中设置的服务器。状态页面在其 **订阅者设置** 页面的 **自定义 SMTP** 卡片中选择 SMTP 配置。

:::cards
- [添加邮件服务器](#添加-smtp-服务器): 两个步骤，其余内容都已折叠。
- [Microsoft 365](#microsoft-365-配置): 使用 Entra 应用注册的 OAuth。
- [Google Workspace](#google-workspace-配置): 使用服务账号的 OAuth。
- [故障排查](#故障排查): 常见错误及其含义。
:::

## 添加 SMTP 服务器

在 **项目设置 > 通知 > 通知设置** 的 **自定义 SMTP 配置** 卡片中添加项目的邮件服务器。在自托管安装中，OneUptime 自身用于发信的服务器在 **Admin Dashboard > 设置 > 通知 > 电子邮件** 的 **自定义电子邮件和 SMTP 设置** 卡片中设置。两个表单分两步询问相同的内容。

:::steps
### 打开表单

:::tabs
@tab 项目
在 **项目设置 > 通知 > 通知设置** 的 **自定义 SMTP 配置** 卡片中，点击 **创建SMTP 配置**。
@tab 自托管实例
在 Admin Dashboard 中打开 **设置**，然后打开侧边菜单中的 **通知 > 电子邮件**（**通知** 默认折叠）。在 **电子邮件服务器设置** 卡片中点击 **编辑服务器**，并将 **邮件服务器类型** 设置为 `Custom SMTP`。然后在其下方出现的 **自定义电子邮件和 SMTP 设置** 卡片中点击 **编辑 SMTP 配置**。
:::

### 填写服务器步骤

在 **服务器** 步骤中，输入 **名称**（仅项目配置）、**主机名**、**端口**（新项目配置从 `587` 开始）、**用户名** 和 **密码**。

### 检查更多字段

其余所有选项都折叠在 **服务器** 步骤末尾的 **更多字段** 中。折叠时，其标题会说明邮件的发送方式，例如：“通过 SMTP 发送邮件，使用用户名和密码登录。需要 TLS。”只有在需要更改下表中的某项设置时才展开它。

### 填写发件人步骤

在 **发件人** 步骤中，输入邮件所用的 **发件人邮箱** 和 **发件人名称**。您的服务器必须允许从该地址发送邮件。

### 保存并发送测试邮件

保存配置。保存项目配置后，可使用其所在行的 **发送测试电子邮件** 检查它是否正常工作。这需要添加 SMTP 配置的权限：**Project Owner**、**Project Admin**，或自定义角色中的 **Create SMTP Config** 和 **Read SMTP Config**。在 OneUptime Cloud 上，它还像添加配置一样需要 **Growth** 套餐。对其他人，该按钮处于锁定状态，其提示会说明需要什么。

测试会询问要发送到的 **电子邮件** 地址，默认填写您自己的地址。请检查邮件是否送达。
:::

**更多字段** 中的设置如下：

| 字段 | 作用 |
| --- | --- |
| **传输** | `SMTP`（默认），或用于已关闭 SMTP AUTH 的 Microsoft 365 租户的 `Microsoft Graph`。选择 Microsoft Graph 会隐藏主机名、端口、用户名和密码，并显示 OAuth 字段。 |
| **要求 TLS** | 在新项目配置中默认开启。邮件仅通过使用有效证书的加密连接发送。关闭后，仅在服务器支持时才加密邮件，且不检查证书。端口 465 始终加密。 |
| **认证类型** | `Username and Password`（默认）、`OAuth`，或用于无需登录的中继的 `None`。 |
| **OAuth 字段** | **OAuth 提供商类型**、**OAuth 客户端 ID**、**OAuth 客户端密钥**、**OAuth 令牌 URL** 和 **OAuth 范围**，在选择 OAuth 或 Microsoft Graph 后显示。 |
| **描述** | 给团队的备注（仅项目配置）。 |

**Microsoft Graph.** 打开 **更多字段**，将 **传输** 设置为 `Microsoft Graph`，然后填写具有 **Mail.Send** 应用程序权限的 Azure 应用的信息：其客户端 ID 和客户端密钥、令牌 URL `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` 以及范围 `https://graph.microsoft.com/.default`。邮件从 **发件人邮箱** 对应的邮箱发送，该邮箱必须是您租户中已获得许可的邮箱。

> [!NOTE]
> 在 OneUptime Cloud 上，项目的邮件服务器必须能够通过互联网访问：解析为私有地址或内部地址的主机会被拒绝。在自托管安装中，除非 `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` 为 `true`，否则允许私有地址，但环回地址和链路本地地址始终会被拒绝。实例自己的邮件服务器不会经过这种检查。

## OAuth 2.0 认证

OAuth 2.0 让 OneUptime 无需密码即可登录您的邮件服务器，企业邮件服务也越来越多地要求使用它。OneUptime 支持两种 OAuth 授权类型：

- **Client Credentials**：Microsoft 365 和大多数 OAuth 提供商使用。
- **JWT Bearer**：Google Workspace 服务账号使用。

```mermaid title="OneUptime 如何通过 OAuth 登录"
sequenceDiagram
    participant O as OneUptime
    participant T as 令牌 URL
    participant M as 邮件服务器
    O->>T: 请求访问令牌
    T-->>O: 访问令牌
    Note over O: 缓存令牌，<br/>并在过期前刷新
    O->>M: 使用令牌登录
    O->>M: 发送电子邮件
```

**认证类型** 和 OAuth 字段位于表单服务器步骤的 **更多字段** 中。要通过 OAuth 登录，请填写：

| 字段 | 描述 |
| --- | --- |
| **主机名** | SMTP 服务器地址 |
| **端口** | SMTP 端口（通常 STARTTLS 使用 587，隐式 TLS 使用 465） |
| **用户名** | 发送邮件的邮箱的电子邮件地址 |
| **认证类型** | `OAuth` |
| **OAuth 提供商类型** | Microsoft 365 选择 `Client Credentials`，Google Workspace 选择 `JWT Bearer` |
| **OAuth 客户端 ID** | 来自 OAuth 提供商的应用程序（客户端）ID（Google 填写服务账号邮箱） |
| **OAuth 客户端密钥** | 来自 OAuth 提供商的客户端密钥（Google 填写私钥） |
| **OAuth 令牌 URL** | 提供商的 OAuth 令牌端点 |
| **OAuth 范围** | 授予 SMTP 访问权限的 OAuth 范围 |

OneUptime 会缓存 OAuth 令牌，并在其过期前自动刷新。

## Microsoft 365 配置

要在 Microsoft 365（Exchange Online）中使用 OAuth，请在 Microsoft Entra 中注册一个应用程序，授予它通过 SMTP 发送邮件的权限，并允许它使用发件邮箱。

:::steps
### 在 Microsoft Entra 中注册应用程序

1. 登录 [Microsoft Entra 管理中心](https://entra.microsoft.com)。
2. 转到 **Identity** > **Applications** > **App registrations**，然后点击 **New registration**。
3. 输入名称（例如 "OneUptime SMTP"），选择 "Accounts in this organizational directory only"，并将 **Redirect URI** 留空。
4. 点击 **Register**。

在 **Overview** 页面上，记下 **Application (client) ID**（您的客户端 ID）和 **Directory (tenant) ID**（用于令牌 URL）。

### 创建客户端密钥

1. 在应用注册中，转到 **Certificates & secrets**，然后点击 **New client secret**。
2. 添加描述，选择过期时间，然后点击 **Add**。
3. **立即复制密钥值**：它不会再次显示。

### 添加 SMTP 权限

1. 转到 **API permissions**，然后点击 **Add a permission**。
2. 选择 **APIs my organization uses**，然后搜索并选择 **Office 365 Exchange Online**。
3. 选择 **Application permissions**，勾选 **SMTP.SendAsApp**，然后点击 **Add permissions**。
4. 点击 **Grant admin consent for [your organization]**（需要管理员权限）。

### 在 Exchange Online 中注册服务主体

在应用程序能够发送邮件之前，请在 Exchange Online 中注册其服务主体，并授予它访问发件邮箱的权限：

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
> 请使用 `Add-MailboxPermission`，而不是 `Add-RecipientPermission`。`Add-RecipientPermission` 仅在收件人上授予 `SendAs`，这不足以让服务主体通过 OAuth 使用 SMTP 发送邮件，发送会因认证或权限错误而失败。

### 在 OneUptime 中创建 SMTP 配置

使用以下设置创建或编辑 SMTP 配置，并将 `<tenant-id>` 替换为您的 **Directory (tenant) ID**：

| 字段 | 值 |
| --- | --- |
| 主机名 | `smtp.office365.com` |
| 端口 | `587` |
| 用户名 | 您授权的电子邮件地址（例如 `sender@yourdomain.com`） |
| 认证类型 | `OAuth` |
| OAuth 提供商类型 | `Client Credentials` |
| OAuth 客户端 ID | 您的 **Application (client) ID** |
| OAuth 客户端密钥 | 您的客户端密钥值 |
| OAuth 令牌 URL | `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` |
| OAuth 范围 | `https://outlook.office365.com/.default` |
| 发件人邮箱 | 与用户名相同 |
| 要求 TLS | 开启 |

然后使用 **发送测试电子邮件** 进行检查。
:::

## Google Workspace 配置

Google Workspace 需要一个具有域范围委派权限的 **服务账号**，由它代表您域中的用户发送邮件。Google 的 SMTP 服务器不支持 Gmail 使用简单的 client credentials 流程。

### Google Workspace 的准备工作

- Google Workspace 账号。个人 Gmail 账号不支持此功能。
- Google Workspace 管理员控制台的超级管理员访问权限。
- Google Cloud Console 的访问权限。

:::steps
### 创建 Google Cloud 项目

1. 转到 [Google Cloud Console](https://console.cloud.google.com)。
2. 点击项目下拉菜单并选择 **New Project**。
3. 输入项目名称，点击 **Create**，然后选择新项目。

### 启用 Gmail API

1. 转到 **APIs & Services** > **Library**。
2. 搜索 "Gmail API"，点击 **Gmail API**，然后点击 **Enable**。

### 创建服务账号

1. 转到 **APIs & Services** > **Credentials**。
2. 点击 **Create Credentials** > **Service account**。
3. 输入名称和描述，点击 **Create and Continue**，跳过可选步骤，然后点击 **Done**。

### 创建服务账号密钥

1. 点击您刚创建的服务账号，然后转到 **Keys** 选项卡。
2. 点击 **Add Key** > **Create new key**，选择 **JSON**，然后点击 **Create**。
3. 妥善保存下载的 JSON 文件。其中的 `client_email` 是您的 OAuth 客户端 ID，`private_key` 是您的 OAuth 客户端密钥。

### 启用域范围委派

1. 在服务账号详情中，点击 **Show Advanced Settings**。
2. 记下数字形式的 **Client ID**。
3. 勾选 **Enable Google Workspace Domain-wide Delegation**，然后点击 **Save**。

### 在 Google Workspace 管理员控制台中授权服务账号

1. 登录 [Google Workspace 管理员控制台](https://admin.google.com)。
2. 转到 **Security** > **Access and data control** > **API Controls**，然后点击 **Manage Domain Wide Delegation**。
3. 点击 **Add new**，输入上一步中数字形式的 **Client ID**，并在 **OAuth Scopes** 中输入 `https://mail.google.com/`。
4. 点击 **Authorize**。

委派可能需要几分钟到 24 小时才能生效。

### 为 Google Workspace 创建 SMTP 配置

使用以下设置创建或编辑 SMTP 配置：

| 字段 | 值 |
| --- | --- |
| 主机名 | `smtp.gmail.com` |
| 端口 | `587` |
| 用户名 | 用于发送邮件的 Google Workspace 电子邮件地址（例如 `notifications@yourdomain.com`）。服务账号会模拟此用户。 |
| 认证类型 | `OAuth` |
| OAuth 提供商类型 | `JWT Bearer` |
| OAuth 客户端 ID | 服务账号 JSON 中的 `client_email`（例如 `your-service@your-project.iam.gserviceaccount.com`） |
| OAuth 客户端密钥 | 服务账号 JSON 中的 `private_key`（包括 `-----BEGIN PRIVATE KEY-----` 和 `-----END PRIVATE KEY-----` 在内的完整密钥） |
| OAuth 令牌 URL | `https://oauth2.googleapis.com/token` |
| OAuth 范围 | `https://mail.google.com/` |
| 发件人邮箱 | 与用户名相同 |
| 要求 TLS | 开启 |

然后使用 **发送测试电子邮件** 进行检查。
:::

> [!IMPORTANT]
> 对于 Google（JWT Bearer），**OAuth 客户端 ID** 是 **服务账号邮箱**（`client_email`），而不是数字形式的 `client_id`。服务账号会模拟 **用户名** 中的用户来发送邮件。

## 故障排查

### Microsoft 365 错误

| 问题 | 解决方案 |
| --- | --- |
| "Authentication unsuccessful" | 确认服务主体已在 Exchange 中注册并具有邮箱权限 |
| "AADSTS700016: Application not found" | 检查客户端 ID 是否正确，以及应用是否存在于您的租户中 |
| "AADSTS7000215: Invalid client secret" | 创建新的客户端密钥；旧的可能已过期 |
| "The mailbox is not enabled for this operation" | 运行 `Add-MailboxPermission` 授予邮箱访问权限 |

### Google Workspace 错误

| 问题 | 解决方案 |
| --- | --- |
| "invalid_grant" | 确认域范围委派已正确配置并已生效 |
| "unauthorized_client" | 确认客户端 ID 已在 Google Workspace 管理员控制台中获得授权 |
| "access_denied" | 检查范围 `https://mail.google.com/` 是否已获得授权 |
| "Domain policy has disabled third-party Drive apps" | 在 Google Workspace 管理员控制台的 Security > API Controls 中启用 API 访问 |

### 其他问题

:::details "Cannot send email. Please check your SMTP config."
使用用户名和密码登录或无需登录的服务器不接收邮件时，**发送测试电子邮件** 会显示此消息。请检查 **主机名**、**端口**、**用户名** 和 **密码**。如果您的服务器不提供 TLS，或其证书对其主机名无效，请在 **更多字段** 中关闭 **要求 TLS** 并重试。服务器自己的回复会随测试一起保存：打开 **项目设置 > 通知 > 通知日志** 的 **电子邮件** 选项卡，然后在对应行上选择 **查看状态消息**。
:::

:::details "Cannot send email with OAuth authentication"
OAuth 登录失败，消息末尾附有提供商返回的错误。请检查 **OAuth 客户端 ID**、**OAuth 客户端密钥**、**OAuth 令牌 URL** 和 **OAuth 范围**，确认应用程序具有上述权限，并且已授予管理员同意。如果您的 Microsoft 365 租户已关闭 SMTP AUTH，请改为将 **传输** 设置为 `Microsoft Graph`。
:::

:::details "Microsoft Graph send failed"
**传输** 为 `Microsoft Graph` 的配置在 Graph 不接收邮件时会显示此消息，后面跟着 Microsoft 自己的错误。请确认应用具有已授予管理员同意的 **Mail.Send** 应用程序权限、**OAuth 范围** 为 `https://graph.microsoft.com/.default`，并且 **发件人邮箱** 是您租户中已获得许可的邮箱。
:::

:::details "SMTP server host … could not be reached"
OneUptime 拒绝连接项目的邮件服务器。在 OneUptime Cloud 上，无法解析的主机名，或解析为私有、环回或链路本地地址的主机名，都会以此消息被拒绝，而且消息不会说明属于哪种情况：请使用邮件服务器的公共主机名。在自托管安装中，以及对于以 IP 地址指定的邮件服务器，消息会改为说明原因。**发送测试电子邮件** 只会对 OAuth 配置显示此消息；对于其他配置，请在通知日志的 **电子邮件** 选项卡中通过 **查看状态消息** 查找。
:::

:::details 测试邮件没有送达
检查 **发件人邮箱**：您的服务器必须允许从该地址发送邮件。然后查看收件人的垃圾邮件文件夹，以及邮件服务器日志中的发送尝试。
:::

## 安全最佳实践

- **定期轮换密钥。** 设置提醒，在客户端密钥过期前进行轮换。
- **使用专用凭据。** 为 OneUptime 创建独立的凭据，而不是与其他应用程序共享。
- **授予最小权限。** 只授予发送所需的权限：Microsoft 为 **SMTP.SendAsApp**，Google 为范围 `https://mail.google.com/`。
- **监控使用情况。** 检查邮件日志和 OAuth 应用程序的登录记录，留意异常活动。
- **安全存储密钥。** 切勿将客户端密钥提交到版本控制系统。

## 延伸阅读

- Microsoft：[Authenticate an IMAP, POP or SMTP connection using OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
- Microsoft：[Register an application with Microsoft identity platform](https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)
- Google：[Using OAuth 2.0 for Server to Server Applications](https://developers.google.com/identity/protocols/oauth2/service-account)
- Google：[Gmail API Documentation](https://developers.google.com/gmail/api)
- Google：[XOAUTH2 Protocol](https://developers.google.com/gmail/imap/xoauth2-protocol)

## 后续步骤

:::cards
- [通知汇总](/docs/emails/notification-rollup): OneUptime 如何合并一连串发给所有者的邮件。
- [订阅者与公告](/docs/status-pages/subscribers): 使用项目的 SMTP 配置向状态页面订阅者发送邮件。
:::
