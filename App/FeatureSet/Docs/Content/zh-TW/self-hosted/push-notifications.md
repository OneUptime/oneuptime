# 推播通知

原生推播通知（iOS/Android）由 **Expo Push** 提供支援，自架實例**無需任何伺服器端設定**。

## 運作方式

OneUptime 行動應用程式會向後端註冊一個 Expo Push Token。當後端需要傳送通知時，它會向公開的 Expo Push API 發出 POST 請求，由該 API 代表應用程式將訊息路由至 Apple APNs 或 Google FCM。

網頁推播通知則繼續使用 VAPID 金鑰與 Web Push 協定。

## 自架設定

無需任何推播通知設定。行動應用程式的二進位檔會透過 Expo 的推播基礎架構自動處理所有平台註冊。

## 疑難排解

### 推播通知未送達

- 確認行動應用程式是使用 EAS Build 建置的（Expo Go 不支援推播通知）
- 驗證該裝置已註冊於您資料庫中的 `UserPush` 資料表
- 檢查 OneUptime 伺服器記錄中是否有 Expo Push API 錯誤
- 確認裝置具有可用的網際網路連線且已啟用通知權限

### 記錄中出現「DeviceNotRegistered」錯誤

該 Expo Push Token 已不再有效。這通常表示應用程式已被解除安裝，或使用者撤銷了通知權限。該 Token 將會自動被清除。

## 支援

如果您在使用推播通知時遇到問題，請：

1. 查看上方的疑難排解章節
2. 檢視 OneUptime 記錄以取得詳細的錯誤訊息
3. 透過 [hello@oneuptime.com](mailto:hello@oneuptime.com) 與我們聯絡
