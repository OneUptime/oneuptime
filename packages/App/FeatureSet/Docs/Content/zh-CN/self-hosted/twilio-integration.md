# Twilio 短信和语音集成

自托管 OneUptime 使用您的 Twilio 账户发送短信和语音告警，费用由您直接支付给 Twilio。请在 OneUptime 仪表板中配置凭据：通知发送会读取已保存的配置，Helm chart 中没有 Twilio 凭据配置项。旧版迁移曾导入 `TWILIO_ACCOUNT_SID`、`TWILIO_AUTH_TOKEN` 和 `TWILIO_PHONE_NUMBER`；修改这些变量不是更新现有安装凭据的方式。

## 1. 准备 Twilio 账户

1. 打开 [Twilio Console](https://console.twilio.com/)，获取 **Account SID** 和 **Auth Token**。
2. 获取具有所需短信和/或语音功能的 Twilio 电话号码。发送方和接收方号码均应采用包含国家代码的 E.164 格式。
3. 检查账户余额、目标国家/地区权限以及适用的发送方注册要求。试用账户在接收方、地理区域等方面存在限制，可能导致实际 OneUptime 告警无法正常发送；测试前请阅读 [Twilio 账户与试用说明](https://www.twilio.com/docs/usage/tutorials/how-to-use-your-free-trial-account)。生产环境请使用升级后的账户。

## 2. 在 OneUptime 中保存凭据

针对单个项目：

1. 前往**项目设置 > 通知 > 通知设置**。
2. 在 **Twilio 配置**中选择**创建 Twilio 配置**。
3. 输入名称、**Twilio Account SID**、**Twilio Auth Token** 和 **Twilio 主电话号码**。也可以输入其他国家/地区的 **Twilio 备用电话号码**，以逗号分隔。
4. 启用**设为项目默认值**，将此配置用于项目成员的短信和通话，包括值班通知。如果仅创建配置而未打开此开关，该配置不会被选用于这些通知。
5. 保存。一个项目只能有一个默认配置。状态页使用明确分配给该状态页的配置。

如需设置整个安装环境的默认值，管理员也可以打开**管理仪表板 > 设置 > 通话和短信**，编辑 Twilio 凭据和电话号码后保存。当项目没有默认配置时，成员通知会使用此全局配置。请妥善保管 Auth Token。

## 3. 配置网络访问

私有部署需要通过出站 HTTPS 访问 Twilio 才能提交短信和通话。由于 API 地址会动态变化，Twilio 建议允许到 `*.twilio.com` 的出站 HTTPS；请参阅 [Twilio IP 地址说明](https://help.twilio.com/articles/115015934048-All-About-Twilio-IP-Addresses)。请将此规则应用于 OneUptime 应用工作负载的出站流量，包括 Kubernetes NetworkPolicies 和外部防火墙。 允许 OneUptime 应用进行 DNS 解析和出站 HTTPS (TCP 443) 访问。

是否需要入站访问取决于所用功能：

| 功能 | Twilio 是否需要访问 OneUptime？ |
| --- | --- |
| 提交短信 | 不需要。但更新发送状态需要回调。 |
| 普通语音测试通话 | 不需要。OneUptime 会随出站 API 请求提供语音指令。 |
| 按 1 确认值班告警 | 需要。Twilio 会将按键输入提交给 OneUptime。 |
| 来电策略 | 需要。Twilio 会请求通话指令并报告拨号结果。 |

以下是通过 OneUptime Nginx 网关访问的外部路径；占位符因通知而异：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/notification/sms/status-callback/:smsLogId/:token` | 短信发送状态 |
| POST | `/api/user-notification-log-timeline/call/gather-input/:itemId?token=...` | 按键确认 |
| POST | `/notification/incoming-call/voice` | 可选的来电指令 |
| POST | `/notification/incoming-call/dial-status/:callLogId/:callLogItemId` | 可选的来电路由结果 |

OneUptime 会自动生成短信和确认操作的 URL。请勿将其中的令牌替换为静态 Webhook URL。对于来电，请按照[来电策略](/docs/on-call/incoming-call-policy)配置；关联电话号码时，系统会配置该号码的 Webhook。

Twilio 要求 [Webhook URL 可公开访问](https://www.twilio.com/docs/usage/webhooks/webhooks-overview)。请使用公开受信任的 TLS 证书，并在代理链中保留原始主机、协议、路径、查询参数、请求正文和 `X-Twilio-Signature` 标头。来电处理程序会验证 Twilio 签名；短信发送状态使用每条消息独有的 URL 令牌，按键确认使用带签名的查询令牌。请勿在共享日志或截图中暴露令牌。请参阅 [Twilio Webhook 安全说明](https://www.twilio.com/docs/usage/webhooks/webhooks-security)。

### 生产环境：公开通往私有部署的网关

1. **选择主机名**，例如 `oneuptime.example.com`。发布指向面向互联网网关的公共 DNS 记录。提供商无法访问私有 IP 地址和仅供内部使用的 DNS 名称。使用分离 DNS 时，员工可以将相同主机名解析到私有入口，并继续通过 VPN 使用仪表板。私有入口也必须提供 HTTPS，并使用对该主机名有效的证书。

2. **将网关连接到 OneUptime。** 将网关放置在能够路由到私有入口的 DMZ 中，或使用通过您自己的站点间 VPN/私有链路连接的公共网关。允许网关通过上游服务端口访问入口。对于 Kubernetes/Portainer，仅有私有 `ClusterIP` 服务还不够：网关需要入口/控制器或其他可访问的上游。数据库和其他内部服务应保持私有。

3. **在 443 端口终止 HTTPS**，使用公开受信任的证书和完整的中间证书链。允许入站 TCP 443 访问网关。仅安装证书或更改 DNS 不会建立通往私有上游的路由。

4. 仅通过 OneUptime 的 Nginx 网关公开上表所需的回调路径，该网关会将 `/notification` 映射到应用。保留按键确认路径的 `/api` 前缀。 保留方法、路径、查询字符串、正文和身份验证标头（`X-Twilio-Signature`）。保留公共 `Host`，设置可信的 `X-Forwarded-Host` 和 `X-Forwarded-Proto: https` 标头。不要添加重定向。

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

   将示例替换为您的域名。这些设置用于生成 URL，不会创建 DNS、TLS 或防火墙规则。应用 Compose 配置或 Helm 更新，然后等待应用重启。 OneUptime 没有单独的 Twilio 回调主机名设置。如果主机名改变，还需更新现有 Twilio 电话号码的 Webhook。

[私有网络访问设置](/docs/self-hosted/private-network-access)控制 OneUptime 向内部服务发出的请求。启用 `ALLOW_PRIVATE_NETWORK_WEBHOOKS` 不会使 Twilio 能够访问 OneUptime。

### 出站访问和 IP 限制

普通 Twilio Webhook 的源地址会改变；不要将 SIP 或媒体地址范围用作回调允许列表。符合条件的版本提供 [Static Proxy for Webhooks](https://www.twilio.com/docs/iam/twilio-editions/twilio-static-proxy)。请确认版本资格和支持的产品，并使用当前公布的地址范围配置防火墙。继续验证回调身份。

### 测试和不允许入站访问的部署

没有入站访问时，仍可通过出站 HTTPS 提交短信和播放简单语音。送达状态、按键确认和来电路由需要可访问的回调。完全断网的安装无法使用 Twilio。

开发时可参考 Twilio 的 [Webhook 测试指南](https://www.twilio.com/docs/usage/webhooks/webhook-testing)使用公共隧道。将隧道转发到只允许所需路径的代理，按上述方法配置获得的主机名，并在测试后停止隧道。隧道仍会公开入站访问。

## 4. 分别测试发送和回调

1. 从公司网络和 VPN 外部验证回调主机名解析到公共网关，并提供有效的 TLS 证书。浏览器 GET 不会测试这些 POST 回调。
2. 在项目的 Twilio 配置中使用**发送测试短信**和**拨打测试电话**，确认目标手机收到短信和来电。
3. 配置用户已验证的短信/通话联系方式和通知规则，然后触发一次受控的值班告警。按 1，并在 OneUptime 中确认告警已被确认。 如果使用来电策略，请拨打配置的号码，检查路由和通话日志。
4. 在 OneUptime 和 Twilio 消息日志中确认短信发送状态。发送请求被接受不代表已送达；[Twilio 通过回调报告后续状态变化](https://www.twilio.com/docs/messaging/guides/track-outbound-message-status)。

如果发送失败，请检查凭据、号码功能、账户限制和出站连接。如果短信或通话已收到，但状态或确认结果未更新，请检查回调 URL 和公共入口日志。Twilio 的 [HTTP 获取失败指南](https://www.twilio.com/docs/api/errors/11200)可帮助诊断回调无法访问、TLS 问题和 HTTP 错误。仅测试通话成功并不能验证回调访问。
