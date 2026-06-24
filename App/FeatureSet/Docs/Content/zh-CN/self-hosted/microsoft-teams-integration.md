# Microsoft Teams 集成

要将 Microsoft Teams 与您的自托管 OneUptime 实例集成，您需要配置 Azure 应用注册并设置所需的环境变量。

## 前提条件

- Azure 账号 - 您可以在 [https://azure.com](https://azure.com) 创建
- 访问您的 OneUptime 服务器配置

## 设置说明

### 第一步：创建 Azure 应用注册

1. 前往 [Azure 门户](https://portal.azure.com)
2. 导航至"应用注册"并点击"新注册"
3. 填写注册表单：
   - **名称：** oneuptime
   - **支持的账号类型：** 任何组织目录中的账号（任何 Microsoft Entra ID 租户 - 多租户）
   - **重定向 URI：** Web - `https://your-oneuptime-domain.com/api/microsoft-teams/auth`
   - 还请添加：`https://your-oneuptime-domain.com/api/microsoft-teams/admin-consent/callback`
4. 点击"注册"
5. 记录"应用程序（客户端）ID" - 稍后您将需要它

### 第二步：配置应用权限

1. 在您的应用注册中，前往"API 权限"
2. 点击"添加权限"并选择"Microsoft Graph"

**添加委派权限**（代表已登录用户操作时）：

- **User.Read** - 在 OAuth 流程中获取已认证用户的个人资料信息（显示名称、电子邮件）所必需
- **Team.ReadBasic.All** - 选择要连接的团队时列出用户所属团队所必需
- **Channel.ReadBasic.All** - 读取频道信息并列出团队内的频道以进行通知传送所必需
- **ChannelMessage.Send** - 向 Teams 频道发送告警和事件通知所必需

**添加应用程序权限**（以应用本身操作，无需已登录用户时）：

- **Team.ReadBasic.All** - 授予管理员同意后列出组织中所有团队所必需
- **Channel.ReadBasic.All** - 验证频道存在并检索频道详情所必需
- **ChannelMessage.Send** - 以程序化方式向频道发送消息所必需

**注意：** Bot Framework 使用 Teams 应用清单中定义的资源特定同意（RSC）权限处理消息传送。这些权限包括：

- **ChannelMessage.Send.Group** - 允许机器人向团队频道发送消息
- **ChannelMessage.Read.Group** - 允许机器人读取频道消息以处理交互式命令
- **Channel.Create.Group** - 允许机器人在需要时创建频道

3. 点击"为您的组织授予管理员同意"

### 第三步：创建客户端密钥

1. 在您的应用注册中，前往"证书和密钥"
2. 点击"新建客户端密钥"
3. 添加描述并设置过期时间（建议 24 个月）
4. 点击"添加"并立即复制密钥值——之后将无法再次查看

**重要提示：** 不要复制密钥 ID，您需要的是密钥**值**，它通常更长，包含更多字符。

### 第四步：创建机器人服务

1. 在 Azure 门户中，导航至"Azure Bot"并点击"创建"
2. 填写机器人创建表单：

   - **机器人句柄：** oneuptime-bot
   - **订阅：** 您的 Azure 订阅
   - **资源组：** 创建新的或使用现有的
   - **位置：** 选择靠近您用户的位置
   - **定价层：** F0（免费）足够用于测试
   - 请使用之前创建的应用注册中的应用（客户端）ID 和租户 ID

3. 点击"审阅 + 创建"，然后点击"创建"

4. 部署完成后，前往您的机器人资源并导航至"配置"
5. 将"消息传送端点"设置为 `https://your-oneuptime-domain.com/api/microsoft-bot/messages`
6. 保存配置

### 第五步：向机器人添加 Microsoft Teams 频道

1. 在您的 Azure Bot 资源中，导航至"频道"
2. 找到并选择"Microsoft Teams"，点击"打开"或"添加"
3. 查看设置（为 Teams 启用，除非有特定需求，否则保留默认消息选项）
4. 点击"保存"（如果提示，点击"完成"/"发布"）以启用 Teams 频道

### 第六步：配置 OneUptime 环境变量

#### Docker Compose

如果您使用 Docker Compose，请将这些环境变量添加到您的配置中：

```bash
MICROSOFT_TEAMS_APP_CLIENT_ID=YOUR_TEAMS_APP_CLIENT_ID
MICROSOFT_TEAMS_APP_CLIENT_SECRET=YOUR_TEAMS_APP_CLIENT_SECRET
MICROSOFT_TEAMS_APP_TENANT_ID=YOUR_MICROSOFT_TENANT_ID
```

#### Kubernetes with Helm

如果您使用 Kubernetes with Helm，请将这些添加到您的 `values.yaml` 文件中：

```yaml
microsoftTeamsApp:
  clientId: YOUR_TEAMS_APP_CLIENT_ID
  clientSecret: YOUR_TEAMS_APP_CLIENT_SECRET
   tenantId: YOUR_MICROSOFT_TENANT_ID
```

**重要提示：** 添加这些环境变量后重启您的 OneUptime 服务器以使其生效。

### 第七步：上传 Teams 应用清单

1. 前往项目 **设置** > **集成** > **Microsoft Teams**
2. 从那里下载 Teams 应用清单
3. 前往 Microsoft Teams，点击侧边栏中的"应用"
4. 在底部，点击"管理您的应用"
5. 点击"上传自定义应用"
6. 选择"为我或我的团队上传"
7. 上传您之前下载的清单 zip 文件

## 故障排查

如果您遇到问题：

- 确保您的应用具有正确的已授权权限
- 检查重定向 URI 是否完全匹配（将 `your-oneuptime-domain.com` 替换为您的实际域名）
- 验证您的环境变量是否正确设置
- 确保机器人消息传送端点可从互联网访问
- 验证机器人是否已正确配置 Teams 频道
- 检查 Teams 应用清单是否已成功上传

## 支持

我们希望改进此集成，因此非常欢迎您的反馈。请发送至 [hello@oneuptime.com](mailto:hello@oneuptime.com)
