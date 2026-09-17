# 推送通知

原生推送通知（iOS/Android）使用 **Expo Push**。自托管实例默认使用 OneUptime 推送中继，需要允许出站网络连接到该中继。

## 工作原理

OneUptime 移动应用向后端注册 Expo Push Token。后端通过 OneUptime 推送中继发送通知；配置 `EXPO_ACCESS_TOKEN` 后则直接发送到 Expo。Expo 将消息转发到 Apple APNs 或 Google FCM，再投递到设备。

Web 推送通知继续使用 VAPID 密钥和 Web Push 协议。

## 自托管设置

使用官方移动应用和默认中继时，服务器无需配置 Expo 凭据。若要直接投递，请为 `EXPO_ACCESS_TOKEN` 配置适用于应用 Expo 项目的凭据。Web 推送需要 `VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY` 和 `VAPID_SUBJECT`。

## 网络访问

| 方向 | 目标 | 协议 / 端口 | 适用条件 |
| --- | --- | --- | --- |
| OneUptime → 默认推送中继 | `https://oneuptime.com/api/notification/push-relay/send` | HTTPS / TCP 443 | 未设置 `EXPO_ACCESS_TOKEN` 时的移动推送。 |
| OneUptime → Expo | `https://exp.host/--/api/v2/push/send` | HTTPS / TCP 443 | 设置 `EXPO_ACCESS_TOKEN` 后直接发送移动推送。 |
| OneUptime → 浏览器推送服务 | 浏览器推送订阅中保存的 HTTPS 端点 | HTTPS / 通常为 TCP 443 | Web 推送。 |
| 移动应用或浏览器 → OneUptime | 您的 OneUptime 主机名 | HTTPS / TCP 443 | 登录、注册设备和打开通知链接。 |

若修改 `PUSH_NOTIFICATION_RELAY_URL`，请允许其目标主机名和配置的端口。自定义中继必须实现 OneUptime 中继 API。默认值和投递模式切换逻辑见 [OneUptime 配置](https://github.com/OneUptime/oneuptime/blob/master/config.example.env)和[推送服务](https://github.com/OneUptime/oneuptime/blob/master/Common/Server/Services/PushNotificationService.ts)；直接投递端点见 [Expo 发送指南](https://docs.expo.dev/push-notifications/sending-notifications/)。

对于 Web 推送，请允许团队所用浏览器订阅端点的实际主机。OneUptime 接受 `fcm.googleapis.com`、`android.googleapis.com`、`push.services.mozilla.com`、`notify.windows.com` 和 `push.apple.com` 及其子域，例如 `updates.push.services.mozilla.com` 和 `web.push.apple.com`。[浏览器推送订阅](https://developer.mozilla.org/en-US/docs/Web/API/PushSubscription)提供目标地址；仅允许 Expo 或 OneUptime 中继不能启用 Web 推送。

允许发送通知的 OneUptime 进程进行 DNS 解析和出站 TLS 连接。其信任存储必须能验证目标证书，代理不能要求 API 请求进行交互式认证。推送服务商不会调用 OneUptime 服务器上的 Webhook，因此只要设备可通过 VPN 或其他私有连接访问 OneUptime，服务器就可保持私有。无法访问中继或外部推送服务的服务器不能投递这些通知。

设备本身也需要网络连接。iOS 需要访问 APNs，通常使用 TCP 5223，TCP 443 用于回退；目标网段参见 [Apple 最新网络要求](https://support.apple.com/en-us/102266)。Android 需要通过 TCP 5228–5230 和 443 访问 FCM，主机和防火墙规则参见 [Google 最新指南](https://firebase.google.com/docs/cloud-messaging/network-configuration)。这些设备端口无需在 OneUptime 上开放入站连接；移动推送的服务器路径使用中继或 Expo，而非直接访问 APNs/FCM。

从发送通知的容器或 Pod 检查到所选模式目标的 DNS 和 HTTPS 连接，再从 **User Settings > Notification Methods > Push** 发送测试并确认已注册设备收到通知。Web 推送应逐个浏览器测试。检查 OneUptime 日志中的中继、Expo 或 web-push 错误；API 提交成功不等于设备已收到通知。

## 故障排查

### 推送通知未到达

- 确保移动应用是使用 EAS Build 构建的（Expo Go 不支持推送通知）
- 验证设备是否在数据库的 `UserPush` 表中注册
- 检查 OneUptime 服务器日志中的 Expo Push API 错误
- 确认设备有活跃的互联网连接并已启用通知权限

### 日志中出现"DeviceNotRegistered"错误

Expo Push Token 不再有效。这通常意味着应用已卸载或用户撤销了通知权限。该令牌将自动清理。

## 支持

如果您在推送通知方面遇到问题，请：

1. 查看上方的故障排查部分
2. 查看 OneUptime 日志以获取详细错误消息
3. 通过 [hello@oneuptime.com](mailto:hello@oneuptime.com) 联系我们
