# 推送通知

原生推送通知（iOS/Android）由 **Expo Push** 提供支持，自託管實例**無需任何服務器端配置**。

## 工作原理

OneUptime 移動應用將 Expo Push Token 註冊到後端。當後端需要發送通知時，它會 POST 到公共 Expo Push API，該 API 代表應用將消息路由到 Apple APNs 或 Google FCM。

Web 推送通知繼續使用 VAPID 密鑰和 Web Push 協議。

## 自託管設置

無需推送通知配置。移動應用二進制文件通過 Expo 的推送基礎設施自動處理所有平臺註冊。

## 故障排查

### 推送通知未到達

- 確保移動應用是使用 EAS Build 構建的（Expo Go 不支持推送通知）
- 驗證設備是否在數據庫的 `UserPush` 表中註冊
- 檢查 OneUptime 服務器日誌中的 Expo Push API 錯誤
- 確認設備有活躍的互聯網連接並已啓用通知權限

### 日誌中出現"DeviceNotRegistered"錯誤

Expo Push Token 不再有效。這通常意味着應用已卸載或用戶撤銷了通知權限。該令牌將自動清理。

## 支持

如果您在推送通知方面遇到問題，請：

1. 查看上方的故障排查部分
2. 查看 OneUptime 日誌以獲取詳細錯誤消息
3. 通過 [hello@oneuptime.com](mailto:hello@oneuptime.com) 聯繫我們
