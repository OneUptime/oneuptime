# 推播通知

原生推播通知（iOS/Android）使用 **Expo Push**。自架執行個體預設使用 OneUptime 推播中繼服務，需要允許對該服務的連出網路存取。

## 運作方式

OneUptime 行動應用程式向後端註冊 Expo Push Token。後端透過 OneUptime 中繼服務傳送通知；設定 `EXPO_ACCESS_TOKEN` 後則直接傳送到 Expo。Expo 再將訊息轉送至 Apple APNs 或 Google FCM，傳遞到裝置。

網頁推播通知則繼續使用 VAPID 金鑰與 Web Push 協定。

## 自架設定

使用官方行動應用程式與預設中繼服務時，伺服器不需要 Expo 認證資料。若要直接傳送，請為 `EXPO_ACCESS_TOKEN` 設定適用於應用程式 Expo 專案的認證資料。網頁推播需要 `VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY` 和 `VAPID_SUBJECT`。

## 網路存取

| 方向 | 目的地 | 協定 / 連接埠 | 適用情況 |
| --- | --- | --- | --- |
| OneUptime → 預設推播中繼 | `https://oneuptime.com/api/notification/push-relay/send` | HTTPS / TCP 443 | 未設定 `EXPO_ACCESS_TOKEN` 的行動推播。 |
| OneUptime → Expo | `https://exp.host/--/api/v2/push/send` | HTTPS / TCP 443 | 已設定 `EXPO_ACCESS_TOKEN` 的直接行動推播。 |
| OneUptime → 瀏覽器推播服務 | 瀏覽器推播訂閱保存的 HTTPS 端點 | HTTPS / 通常為 TCP 443 | 網頁推播。 |
| 行動應用程式或瀏覽器 → OneUptime | 您的 OneUptime 主機名稱 | HTTPS / TCP 443 | 登入、註冊裝置和開啟通知連結。 |

若修改 `PUSH_NOTIFICATION_RELAY_URL`，請允許其目標主機名稱和設定的連接埠。自訂中繼必須實作 OneUptime 中繼 API。預設值及傳送模式選擇見 [OneUptime 設定](https://github.com/OneUptime/oneuptime/blob/master/config.example.env)與[推播服務](https://github.com/OneUptime/oneuptime/blob/master/Common/Server/Services/PushNotificationService.ts)；直接端點見 [Expo 傳送指南](https://docs.expo.dev/push-notifications/sending-notifications/)。

網頁推播應允許團隊所用瀏覽器訂閱端點的實際主機。OneUptime 接受 `fcm.googleapis.com`、`android.googleapis.com`、`push.services.mozilla.com`、`notify.windows.com` 和 `push.apple.com` 及其子網域，例如 `updates.push.services.mozilla.com` 和 `web.push.apple.com`。[瀏覽器訂閱](https://developer.mozilla.org/en-US/docs/Web/API/PushSubscription)提供目的地；只允許 Expo 或 OneUptime 中繼無法啟用網頁推播。

允許傳送通知的 OneUptime 程序進行 DNS 解析及連出 TLS。其信任存放區必須驗證目標憑證；代理不得要求 API 請求進行互動式驗證。推播供應商不會呼叫 OneUptime 上的 webhook。因此，只要裝置可透過 VPN 或其他私有連線存取 OneUptime，伺服器就能保持私有。無法存取中繼或外部推播服務的伺服器不能傳送這些通知。

裝置本身也需要網路連線。iOS 需要 APNs，通常使用 TCP 5223，TCP 443 作為備援；目的網段請參閱 [Apple 最新網路需求](https://support.apple.com/en-us/102266)。Android 需要透過 TCP 5228–5230 和 443 存取 FCM，主機及規則請參閱 [Google 最新指南](https://firebase.google.com/docs/cloud-messaging/network-configuration)。這些裝置連接埠不必在 OneUptime 開放連入；行動推播的伺服器流程透過中繼或 Expo，而非直接連線到 APNs/FCM。

從傳送通知的容器或 Pod 檢查到所選模式目的地的 DNS 和 HTTPS，再從 **User Settings > Notification Methods > Push** 傳送測試，確認已註冊裝置收到通知。網頁推播應逐一測試各瀏覽器。查看 OneUptime 記錄中的中繼、Expo 或 web-push 錯誤；API 接受請求不代表裝置已收到通知。

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
