# 推送通知

原生推送通知（iOS/Android）由 **Expo Push** 提供支持，自托管实例**无需任何服务器端配置**。

## 工作原理

OneUptime 移动应用将 Expo Push Token 注册到后端。当后端需要发送通知时，它会 POST 到公共 Expo Push API，该 API 代表应用将消息路由到 Apple APNs 或 Google FCM。

Web 推送通知继续使用 VAPID 密钥和 Web Push 协议。

## 自托管设置

无需推送通知配置。移动应用二进制文件通过 Expo 的推送基础设施自动处理所有平台注册。

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
