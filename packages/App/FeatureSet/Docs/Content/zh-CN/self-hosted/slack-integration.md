# Slack 集成

将自托管 OneUptime 项目连接到 Slack，以发送通知并使用事件操作、命令和消息事件。

## 设置

1. 按下文配置 OneUptime 主机名和 HTTPS。在 **Settings > Slack Integration** 复制生成的应用清单，也可访问 `https://your-oneuptime-domain.com/api/slack/app-manifest` 获取。
2. 使用自己部署生成的清单，在工作区中[创建 Slack 应用](https://api.slack.com/apps)，确保 URL 与主机名一致。
3. 将应用 **Basic Information** 中的 **Client ID**、**Client Secret** 和 **Signing Secret** 复制到 Docker Compose 的 `config.env`：

   ```dotenv
   SLACK_APP_CLIENT_ID=YOUR_SLACK_APP_CLIENT_ID
   SLACK_APP_CLIENT_SECRET=YOUR_SLACK_APP_CLIENT_SECRET
   SLACK_APP_SIGNING_SECRET=YOUR_SLACK_APP_SIGNING_SECRET
   ```

   Helm 使用以下配置：

   ```yaml
   slackApp:
     clientId: "YOUR_SLACK_APP_CLIENT_ID"
     clientSecret: "YOUR_SLACK_APP_CLIENT_SECRET"
     signingSecret: "YOUR_SLACK_APP_SIGNING_SECRET"
   ```

4. 应用配置并等待 OneUptime 重启。如果设置签名密钥之前 Events URL 验证失败，请现在重试。
5. 返回 **Settings > Slack Integration**，选择 **Connect to Slack** 并授权应用。使用需要用户身份的操作时，也请在 OneUptime 中连接个人 Slack 账号。

## 自托管部署的网络访问

### 流量方向与端点

| 流量 | 所需访问 |
| --- | --- |
| OneUptime → Slack | DNS 和 TCP 443 出站 HTTPS：Web API 与 OAuth 令牌交换使用 `slack.com`；命令回复及使用中的传入 Webhook 通知使用 `hooks.slack.com` |
| Slack → OneUptime | 完整集成需要通过 TCP 443 公网 HTTPS 访问下列四个 POST 路由 |
| 用户浏览器 → OneUptime | 仪表板和 OAuth 重定向 `/api/slack/auth/:projectId/:userId`、`/api/slack/auth/:projectId/:userId/user`；这些地址可保持仅通过用户 VPN 访问 |

这些出站域名描述的是 OneUptime 集成，并非 Slack 客户端或所有功能的完整允许列表。Slack 的“传入 Webhook”托管在 Slack：OneUptime 向它发送请求，它不是 OneUptime 服务器上的入站端点。参见 [Slack 传入 Webhook 指南](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/)。

通过 ingress 将以下供应商回调转发到 OneUptime 应用：

| 方法与路径 | 用途 |
| --- | --- |
| `POST /api/slack/events` | Events API 验证、回应、提及与消息 |
| `POST /api/slack/interactive` | 按钮、快捷方式、模态表单提交、`/incident` 和 `/maintenance` |
| `POST /api/slack/options-load` | 交互菜单选项请求 |
| `POST /api/slack/command` | `/oneuptime` 命令 |

OAuth 通过[浏览器重定向，再由服务器交换令牌](https://docs.slack.dev/authentication/installing-with-oauth/)。清单将 `/api/slack/auth` 注册为重定向前缀，OneUptime 在授权时附加项目和用户路径。浏览器可以访问，并不代表 Slack 可以投递事件或按钮操作。

### 私有部署与回调安全

使用公共 DNS，以及具有公信 HTTPS 证书、完整证书链和到 OneUptime ingress 私有路由的网关。允许入站 TCP 443，只公开上述供应商 POST 回调。私有 `ClusterIP`、内部 DNS 或员工 VPN 本身无法让供应商访问。使用分离 DNS，可在同一主机名下保持仪表板和浏览器 OAuth 路由私有。

在 `config.env` 设置 `HOST=oneuptime.example.com` 和 `HTTP_PROTOCOL=https`，或在 Helm 设置 `host: oneuptime.example.com` 和 `httpProtocol: https`。应用配置并等待重启。这些值生成 URL，不会自动配置 DNS、TLS 或防火墙。 更改主机名后，重新生成并更新 Slack 清单。

保留方法、路径、查询字符串、原始请求体、`Content-Type`、`X-Slack-Signature` 和 `X-Slack-Request-Timestamp`。通过可信代理头保留公网主机和 HTTPS 协议。回调应豁免浏览器 SSO、CAPTCHA 和代理登录页，但保留 OneUptime 的签名与时间戳验证。同步服务器时钟。来源 IP 检查不能替代 [Slack 签名验证](https://docs.slack.dev/authentication/verifying-requests-from-slack/)。

### 验证访问与了解限制

在 **Event Subscriptions** 验证 Events Request URL：Slack 会[发送 POST 验证请求并检查 TLS](https://docs.slack.dev/apis/events-api/using-http-request-urls/)。随后发送测试通知、运行斜杠命令、点击事件按钮并触发已订阅事件。检查网关与 OneUptime 日志，不要记录密钥。Slack 要求及时确认，包含[交互请求三秒内响应](https://docs.slack.dev/interactivity/handling-user-interaction/)。浏览器 GET 或发送消息成功不能验证这些 POST 回调。

如果禁止所有入站连接，已授权应用仍可通过出站 HTTPS 发送消息，但事件、按钮、快捷方式和命令无法工作。OneUptime 清单使用 HTTP 回调并禁用 Socket Mode；开启 Slack Socket Mode 不是受支持的替代方式。[私有网络访问设置](/docs/self-hosted/private-network-access)控制发往私有目标的出站请求，不会公开回调。
