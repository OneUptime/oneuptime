# 位于 VPN 或防火墙之后

自托管的 OneUptime 可以完全不暴露在公共互联网上：它通过出站连接发送每一条告警。不过，仍有几样东西需要从外部传回来：值班人员在消息中点按 **Acknowledge**，Twilio 报告通话中按下的按键，Slack 报告按钮点击。本页逐一列出这些情况，以及每种情况下由谁、通过哪条路径连接到你的服务器，让你只发布用到的部分，或者什么都不发布。

:::cards
- [谁会连接到你的服务器](#谁会连接到你的服务器): 值班人员的手机，以及发送回调的提供商。
- [全部保持私有](#全部保持私有): 让值班人员的手机接入你的 VPN。
- [只发布确认页面](#只发布确认页面): 为确认链接开一个窄小的入口。
- [提供商回调](#提供商回调): Telegram、Twilio、WhatsApp、Slack 和 Microsoft Teams。
:::

## 谁会连接到你的服务器

发送从不需要入站访问：OneUptime 会主动连接你的邮件服务器、Twilio、Telegram、Meta、Slack、Microsoft 和推送中继。从外部传入的是以下几种情况之一：

| 发生了什么 | 谁连接到你的服务器 | 能否用来源地址允许列表覆盖？ |
| --- | --- | --- |
| 值班人员在邮件、短信、WhatsApp 或 Telegram 消息中点按 **Acknowledge** | 值班人员的手机或电脑 | 否：它从值班人员所在的任何地方连接 |
| 值班人员在 OneUptime On-Call 应用中确认 | 值班人员的手机 | 否：原因同上 |
| 值班人员在值班呼叫电话中按 1 | Twilio | 仅在使用 Twilio 的 Static Proxy for Webhooks 时可以 |
| 有人关联自己的 Telegram 账户 | Telegram | 可以；也可以轮询 Telegram，什么都不放行 |
| 有人点击 Slack 或 Microsoft Teams 消息上的按钮 | Slack 或 Microsoft | 否：两者都不公布固定地址 |
| WhatsApp 报告消息已送达或已读 | Meta | 否：Meta 不公布固定地址 |

自托管服务器直接与这些提供商通信，从不经过 OneUptime 自己的服务器，因此不存在需要放行的 OneUptime 地址列表。

## 全部保持私有

让值班人员的手机接入你的 VPN：设为始终连接，或在访问你的 OneUptime 主机名时按需连接，这样就没有人需要在凌晨 3 点确认呼叫之前先手动连接。在什么都不发布的情况下：

- 邮件、短信、WhatsApp 和 Telegram 消息中的确认链接都能打开，因为手机可以访问你的服务器。
- OneUptime On-Call 应用可以正常使用：把它指向你服务器的地址即可。推送通知不需要入站访问，因为服务器通过推送中继发送它们。
- 开启轮询后，大家就能关联自己的 Telegram 账户（参见 [Telegram](#telegram)）。

消息应用中的链接会在该应用的内置浏览器或手机的默认浏览器中打开，而不会在 OneUptime 应用中打开。因此，按应用划分的 VPN 必须覆盖消息应用和浏览器，而不只是 OneUptime 应用。

在电话中按 1、Slack 和 Microsoft Teams 消息上的按钮，以及 WhatsApp 的送达回执，仍然需要各自的提供商能访问你的服务器。

## 只发布确认页面

如果值班人员的手机无法使用你的 VPN，就只发布确认链接打开的页面，其他一概不发布。在 OneUptime 前面放一个反向代理，或者一个出站隧道（例如 Cloudflare Tunnel，它不需要任何入站防火墙规则），并且只放行以下路径：

| 方法 | 路径 | 提供的内容 |
| --- | --- | --- |
| GET | `/l/*` | 短信、WhatsApp 和 Telegram 消息中的短链接 |
| GET | `/api/user-notification-log-timeline/acknowledge-page/*` | 显示呼叫内容和 **Acknowledge** 按钮的页面 |
| GET | `/api/user-notification-log-timeline/acknowledge/*` | **Acknowledge** 按钮 |
| GET | `/api/user-notification-log-timeline/pass-on-page/*` | 可选：把呼叫转交给下一个人的页面 |
| POST | `/api/user-notification-log-timeline/pass-on/*` | 可选：该页面上的按钮 |
| GET | `/oneuptime-assets/*` | 这些页面的字体、样式和徽标 |

:::steps
### 将公共主机名指向代理
消息中的链接是根据你的 `HOST` 设置生成的，因此该名称必须能被公开解析到代理，并配有公开受信任的证书。使用拆分 DNS 时，你网络中的人仍会把它解析到私有地址，其他一切照旧使用。

### 原样转发这些路径
把这些路径连同其方法、路径和查询字符串一起发送到 OneUptime 的 ingress，其余请求一律返回 404。

### 对它们限速
每个链接都带有一个随机 ID，短链接的长度为八个字母。限制每个地址可以发出的请求数，让任何人都无法快速地尝试 ID。
:::

值班人员确认后，页面会在仪表板中打开该告警，而仪表板只能在你的网络内加载。此时确认已经保存好了。

## 提供商回调

### Telegram

发送告警只需要到 `api.telegram.org` 的出站 HTTPS。关联账户则需要你的服务器收到用户发给你的机器人的 `/start` 消息，有以下两种方式：

- **轮询**：在 **Admin Dashboard > 设置 > Telegram** 中开启 **Poll Telegram for Messages**。OneUptime 每隔几秒通过出站 HTTPS 从 Telegram 拉取机器人的消息，因此不需要任何外部连接进入你的服务器。
- **Webhook**：Telegram 把每条消息 POST 到 `POST /api/notification/telegram/webhook`。Telegram 从 `149.154.160.0/20` 和 `91.108.4.0/22` [发送 webhook](https://core.telegram.org/bots/webhooks)，因此你可以只允许这些地址。

### Twilio

值班人员按 1 确认电话呼叫时，Twilio 会把按键 POST 到 `POST /api/user-notification-log-timeline/call/gather-input/*`。Twilio 发送 webhook 的地址会变化，除非你的 Twilio 版本包含 [Static Proxy for Webhooks](https://www.twilio.com/docs/iam/twilio-editions/twilio-static-proxy)。短信投递状态更新和来电请参阅 [Twilio 集成](/docs/self-hosted/twilio-integration)。

### WhatsApp

告警和确认都不需要任何入站访问。Meta 会把送达回执和已读回执 POST 到 `/api/notification/whatsapp/webhook`；没有这些回执，OneUptime 的 WhatsApp 日志就无法显示消息在被 Meta 接受之后是已送达、已读还是失败了。Meta 会为每个请求签名，并且不公布固定地址。

### Slack 和 Microsoft Teams

它们消息上的按钮、菜单和命令会从两者都不公布的地址调用你的服务器。这些路径以及如何发布它们，请参阅 [Slack 集成](/docs/self-hosted/slack-integration) 和 [Microsoft Teams 集成](/docs/self-hosted/microsoft-teams-integration)。

## 后续步骤

:::cards
- [Twilio 集成](/docs/self-hosted/twilio-integration): 通过你自己的 Twilio 账户发送短信和拨打电话。
- [推送通知](/docs/self-hosted/push-notifications): 推送中继，以及你的服务器和手机需要访问的地址。
- [应用概览](/docs/mobile-desktop-apps/index): 将 OneUptime On-Call 应用连接到你的服务器。
- [私有网络访问](/docs/self-hosted/private-network-access): 反方向：让 OneUptime 访问你的内部工具。
:::
