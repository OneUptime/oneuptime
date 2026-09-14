# Microsoft Teams 集成

要将 Microsoft Teams 与您的自托管 OneUptime 实例集成，您需要配置 Azure 应用注册并设置所需的环境变量。

## 前提条件

- Azure 账号 - 您可以在 [https://azure.com](https://azure.com) 创建
- 访问您的 OneUptime 服务器配置

## 网络访问

OneUptime 的 Teams 集成使用 Azure Bot。Incoming Webhook 或 Teams Workflow URL 不能替代此机器人的消息端点。Microsoft 要求[自托管机器人提供可公开访问的 HTTPS 端点](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0)。私有 IP 地址、内部 DNS 名称或员工的 VPN 连接均不会让 Azure Bot Service 能够访问 OneUptime。

| 功能 | OneUptime 到提供商 | 提供商到 OneUptime |
| --- | --- | --- |
| Teams 通知 | 到 Microsoft API 的 HTTPS | 完整的机器人集成需要入站访问，包括会话发现 |
| Teams 命令、卡片按钮、聊天安装事件 | HTTPS | `POST /api/microsoft-bot/messages` |

应用注册重定向 `/api/microsoft-teams/auth` 和 `/api/microsoft-teams/admin-consent/callback` 通过用户浏览器返回。该浏览器必须能够访问 OneUptime，例如通过公司网络或 VPN。机器人消息和卡片操作来自 Microsoft 服务器，需要另外提供可访问的入口。仅出站告警发送成功不能验证入站连接。

### 生产环境：公开通往私有部署的网关

1. **选择主机名**，例如 `oneuptime.example.com`。发布指向面向互联网网关的公共 DNS 记录。提供商无法访问私有 IP 地址和仅供内部使用的 DNS 名称。使用分离 DNS 时，员工可以将相同主机名解析到私有入口，并继续通过 VPN 使用仪表板。私有入口也必须提供 HTTPS，并使用对该主机名有效的证书。

2. **将网关连接到 OneUptime。** 将网关放置在能够路由到私有入口的 DMZ 中，或使用通过您自己的站点间 VPN/私有链路连接的公共网关。允许网关通过上游服务端口访问入口。对于 Kubernetes/Portainer，仅有私有 `ClusterIP` 服务还不够：网关需要入口/控制器或其他可访问的上游。数据库和其他内部服务应保持私有。

3. **在 443 端口终止 HTTPS**，使用公开受信任的证书和完整的中间证书链。允许入站 TCP 443 访问网关。仅安装证书或更改 DNS 不会建立通往私有上游的路由。

4. 仅公开 `/api/microsoft-bot/messages`，并在步骤 4 中将 Azure Bot 消息传递端点设为此完整的公共 HTTPS URL。OneUptime 的 Bot Framework 适配器必须能够接收请求并验证身份。 保留方法、路径、查询字符串、正文和身份验证标头（`Authorization`）。保留公共 `Host`，设置可信的 `X-Forwarded-Host` 和 `X-Forwarded-Proto: https` 标头。不要添加重定向。

5. 将这些路径排除在浏览器 SSO、CAPTCHA 和代理登录页面之外。保持 OneUptime 身份验证启用。仅允许网关和获准的内部客户端访问源站，并在日志中隐藏令牌。

6. **设置 OneUptime 的规范 URL**:

   Docker Compose，在 `config.env` 中：

   ```dotenv
   HOST=oneuptime.example.com
   HTTP_PROTOCOL=https
   ```

   Helm/Portainer values：

   ```yaml
   host: oneuptime.example.com
   httpProtocol: https
   ```

   将示例替换为您的域名。这些设置用于生成 URL，不会创建 DNS、TLS 或防火墙规则。应用 Compose 配置或 Helm 更新，然后等待应用重启。 如果主机名改变，请更新 Azure Bot 端点和应用注册的重定向 URI，然后重新下载并上传 Teams 清单。

[私有网络访问设置](/docs/self-hosted/private-network-access)控制 OneUptime 向内部服务发出的请求。启用 `ALLOW_PRIVATE_NETWORK_WEBHOOKS` 不会使 Teams 能够访问 OneUptime。

### 出站访问和 IP 限制

允许 OneUptime 应用进行 DNS 解析和出站 HTTPS (TCP 443) 访问。 Teams 使用 `graph.microsoft.com`、`login.microsoftonline.com`、Bot Framework 身份验证/频道端点以及会话的连接器服务 URL。请参考 [Microsoft 防火墙指南](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0)，并在测试时检查被阻止的流量；这些示例不是完整的域名列表。 商业云的备用连接器为 `https://smba.trafficmanager.net/teams/`；各会话的服务 URL 可能不同。

Microsoft 不支持固定的 Bot Framework 入站 IP 允许列表，因为地址会改变。Teams 客户端媒体地址范围不是机器人 Webhook 的源地址。请保持 Bot Framework 身份验证启用。

### 测试和不允许入站访问的部署

从 VPN 之外的网络验证公共 DNS 和 TLS，然后检查 Teams 路由：

```bash
curl -sS -i https://oneuptime.example.com/api/microsoft-bot/messages
```

在当前 OneUptime 版本中，预期返回 `405 Method Not Allowed`，并包含 `Allow: POST`。这只能确认 GET 请求已到达该路由，并不能证明经过身份验证的机器人 POST 请求能够正常工作。旧版本可能返回 OneUptime 的 JSON 404；请检查响应正文和代理日志。TLS 错误、超时或代理的 HTML 错误页面表示存在证书或路由问题。

连接 Teams，发送测试通知，向机器人发消息并点击卡片按钮。在 OneUptime 中确认操作，并将 Microsoft 诊断信息与网关和应用日志对应检查。通知送达不能验证经过身份验证的入站 POST。

对于开发环境，Microsoft 的 [Teams 测试指南](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/authentication/add-authentication#testing-the-bot-locally-in-teams)介绍了通过隧道公开本地服务的方法。请转发至 OneUptime 入口，并使用 `/api/microsoft-bot/messages` 替代 Microsoft 示例中的 `/api/messages` 路径。公共隧道 URL 变化时应更新 Azure Bot 端点，生产环境请使用稳定的入口。 还需配置对应的 OneUptime 主机名。测试后停止隧道，因为它仍会公开入站访问。

如果禁止所有入站连接，完整的 Teams 集成将无法工作：命令、卡片操作和会话发现都依赖入站连接。完全断网的安装无法使用 Teams。

Azure Bot Private Endpoint 不能替代这个 Teams 入口。Microsoft 的[网络隔离说明](https://learn.microsoft.com/en-us/azure/bot-service/dl-network-isolation-how-to?view=azure-bot-service-4.0)描述的是 Direct Line 隔离，并指出禁用公共网络访问会取消 Teams 频道配置。

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

`ChannelMessage.Send` 仅提供委托权限；[Microsoft Graph 权限参考](https://learn.microsoft.com/en-us/graph/permissions-reference#channelmessagesend)中没有对应的应用程序权限。请将其保留在上方的委托权限列表中。

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

1. 前往 **项目设置** > **工作区** > **Microsoft Teams**
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
