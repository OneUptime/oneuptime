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

私有部署需要通过出站 HTTPS 访问 Twilio 才能提交短信和通话。由于 API 地址会动态变化，Twilio 建议允许到 `*.twilio.com` 的出站 HTTPS；请参阅 [Twilio IP 地址说明](https://help.twilio.com/articles/115015934048-All-About-Twilio-IP-Addresses)。请将此规则应用于 OneUptime 应用工作负载的出站流量，包括 Kubernetes NetworkPolicies 和外部防火墙。

是否需要入站访问取决于所用功能：

| 功能 | Twilio 是否需要访问 OneUptime？ |
| --- | --- |
| 提交短信 | 不需要。但更新发送状态需要回调。 |
| 普通语音测试通话 | 不需要。OneUptime 会随出站 API 请求提供语音指令。 |
| 按 1 确认值班告警 | 需要。Twilio 会将按键输入提交给 OneUptime。 |
| 来电策略 | 需要。Twilio 会请求通话指令并报告拨号结果。 |

对于回调，请按照 [Twilio 和 Microsoft Teams 网络访问指南](/docs/self-hosted/integration-network-access)，通过入口或反向代理公开必要的 HTTPS 路由，同时保持仪表板私有。管理员笔记本电脑上的 VPN 不会为 Twilio 提供连接路径。

在 Docker Compose 的 `config.env` 中设置 `HOST=oneuptime.example.com` 和 `HTTP_PROTOCOL=https`，或在 Helm values 中设置 `host: oneuptime.example.com` 和 `httpProtocol: https`，然后应用部署变更。请将示例域名替换为您的域名。这些设置决定生成的 URL，不会创建 DNS 记录、证书或防火墙规则。OneUptime 没有单独的 Twilio 回调主机名设置。

以下是通过 OneUptime Nginx 网关访问的外部路径；占位符因通知而异：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/notification/sms/status-callback/:smsLogId/:token` | 短信发送状态 |
| POST | `/api/user-notification-log-timeline/call/gather-input/:itemId?token=...` | 按键确认 |
| POST | `/notification/incoming-call/voice` | 可选的来电指令 |
| POST | `/notification/incoming-call/dial-status/:callLogId/:callLogItemId` | 可选的来电路由结果 |

OneUptime 会自动生成短信和确认操作的 URL。请勿将其中的令牌替换为静态 Webhook URL。对于来电，请按照[来电策略](/docs/on-call/incoming-call-policy)配置；关联电话号码时，系统会配置该号码的 Webhook。

Twilio 要求 [Webhook URL 可公开访问](https://www.twilio.com/docs/usage/webhooks/webhooks-overview)。请使用公开受信任的 TLS 证书，并在代理链中保留原始主机、协议、路径、查询参数、请求正文和 `X-Twilio-Signature` 标头。来电处理程序会验证 Twilio 签名；短信发送状态使用每条消息独有的 URL 令牌，按键确认使用带签名的查询令牌。请勿在共享日志或截图中暴露令牌。请参阅 [Twilio Webhook 安全说明](https://www.twilio.com/docs/usage/webhooks/webhooks-security)。

## 4. 分别测试发送和回调

1. 在项目的 Twilio 配置中使用**发送测试短信**和**拨打测试电话**，确认目标手机收到短信和来电。
2. 配置用户已验证的短信/通话联系方式和通知规则，然后触发一次受控的值班告警。按 1，并在 OneUptime 中确认告警已被确认。
3. 在 OneUptime 和 Twilio 消息日志中确认短信发送状态。发送请求被接受不代表已送达；[Twilio 通过回调报告后续状态变化](https://www.twilio.com/docs/messaging/guides/track-outbound-message-status)。

如果发送失败，请检查凭据、号码功能、账户限制和出站连接。如果短信或通话已收到，但状态或确认结果未更新，请检查回调 URL 和公共入口日志。Twilio 的 [HTTP 获取失败指南](https://www.twilio.com/docs/api/errors/11200)可帮助诊断回调无法访问、TLS 问题和 HTTP 错误。仅测试通话成功并不能验证回调访问。
