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
| OneUptime → 預設推播中繼 | `https://oneuptime.com/api/notification/push-relay/send`, `https://oneuptime.com/api/notification/push-relay/receipts` | HTTPS / TCP 443 | 未設定 `EXPO_ACCESS_TOKEN` 的行動推播。 |
| OneUptime → Expo | `https://exp.host/--/api/v2/push/send`, `https://exp.host/--/api/v2/push/getReceipts` | HTTPS / TCP 443 | 已設定 `EXPO_ACCESS_TOKEN` 的直接行動推播。 |
| OneUptime → 瀏覽器推播服務 | 瀏覽器推播訂閱保存的 HTTPS 端點 | HTTPS / 通常為 TCP 443 | 網頁推播。 |
| 行動應用程式或瀏覽器 → OneUptime | 您的 OneUptime 主機名稱 | HTTPS / TCP 443 | 登入、註冊裝置和開啟通知連結。 |

若修改 `PUSH_NOTIFICATION_RELAY_URL`，請允許其目標主機名稱和設定的連接埠。自訂中繼必須實作 OneUptime 中繼 API。預設值及傳送模式選擇見 [OneUptime 設定](https://github.com/OneUptime/oneuptime/blob/master/config.example.env)與[推播服務](https://github.com/OneUptime/oneuptime/blob/master/packages/Common/Server/Services/PushNotificationService.ts)；直接端點見 [Expo 傳送指南](https://docs.expo.dev/push-notifications/sending-notifications/)。OneUptime 會從中繼的同一位址讀取送達回條，只是把 `/send` 換成 `/receipts`。沒有該路由的中繼仍會送達推播；這時，已移除應用程式的裝置只有在之後傳往它的推播遭拒時才會被發現。

網頁推播應允許團隊所用瀏覽器訂閱端點的實際主機。OneUptime 接受 `fcm.googleapis.com`、`android.googleapis.com`、`push.services.mozilla.com`、`notify.windows.com` 和 `push.apple.com` 及其子網域，例如 `updates.push.services.mozilla.com` 和 `web.push.apple.com`。[瀏覽器訂閱](https://developer.mozilla.org/en-US/docs/Web/API/PushSubscription)提供目的地；只允許 Expo 或 OneUptime 中繼無法啟用網頁推播。

允許傳送通知的 OneUptime 程序進行 DNS 解析及連出 TLS。其信任存放區必須驗證目標憑證；代理不得要求 API 請求進行互動式驗證。推播供應商不會呼叫 OneUptime 上的 webhook。因此，只要裝置可透過 VPN 或其他私有連線存取 OneUptime，伺服器就能保持私有。無法存取中繼或外部推播服務的伺服器不能傳送這些通知。

裝置本身也需要網路連線。iOS 需要 APNs，通常使用 TCP 5223，TCP 443 作為備援；目的網段請參閱 [Apple 最新網路需求](https://support.apple.com/en-us/102266)。Android 需要透過 TCP 5228–5230 和 443 存取 FCM，主機及規則請參閱 [Google 最新指南](https://firebase.google.com/docs/cloud-messaging/network-configuration)。這些裝置連接埠不必在 OneUptime 開放連入；行動推播的伺服器流程透過中繼或 Expo，而非直接連線到 APNs/FCM。

從傳送通知的容器或 Pod 檢查到所選模式目的地的 DNS 和 HTTPS，再從 **User Settings > Notification Methods > Push** 傳送測試，確認已註冊裝置收到通知。網頁推播應逐一測試各瀏覽器。查看 OneUptime 記錄中的中繼、Expo 或 web-push 錯誤；API 接受請求不代表裝置已收到通知。對於行動推播，OneUptime 也會在每次推播約 15 分鐘後讀取 Expo 的送達回條：從未送達裝置的推播會在推播記錄中顯示為未送達，如果是值班通知，也會顯示在值班時間軸上。

## 疑難排解

### 推播通知未送達

- 確認行動應用程式是使用 EAS Build 建置的（Expo Go 不支援推播通知）
- 驗證該裝置已註冊於您資料庫中的 `UserPush` 資料表
- 檢查 OneUptime 伺服器記錄中是否有 Expo Push API 錯誤
- 確認裝置具有可用的網際網路連線且已啟用通知權限
- 檢查 **User Settings > Notification Methods > Push**:標記為 **未收到通知** 的裝置已停止接收通知,需要重新註冊(見下文)

### 標記為「未送達」的推播

Expo 接受推播並不代表推播已送達裝置：Apple 或 Google 仍可能拒絕它。OneUptime 會在傳送約 15 分鐘後讀取每則行動推播的送達回條；未設定 `EXPO_ACCESS_TOKEN` 時會透過推播中繼讀取。當回條回報錯誤時，該通知的推播記錄和值班時間軸會從已傳送變為 **Push notification not delivered**，並附上 Expo 的錯誤代碼：

- `DeviceNotRegistered`：行動應用程式已從裝置移除，或其推播權杖已失效。請參閱下一節。
- `MessageRateExceeded`：短時間內傳送到該裝置的通知過多。之後傳往它的推播會照常傳送。
- `MessageTooBig`：通知超出推播服務接受的大小。OneUptime 會縮短通知使其符合限制，因此不應發生這種情況；如果發生，請回報給我們。
- `InvalidCredentials` 或 `MismatchSenderId`：傳送該推播的 Expo 專案的推播憑證無效。使用 `EXPO_ACCESS_TOKEN` 時，請檢查您 Expo 專案的推播憑證；使用預設中繼時，請聯絡 OneUptime 支援。

當 Expo 當場拒絕推播時，推播記錄會立即說明原因。透過推播中繼也是如此：中繼會轉達 Expo 的錯誤代碼，而不是回應伺服器錯誤。

### 記錄中出現「DeviceNotRegistered」錯誤

當行動應用程式已從裝置移除，或裝置的推播權杖已失效時，Expo 會回報 `DeviceNotRegistered`。它通常在推播的送達回條中回報，OneUptime 會在傳送約 15 分鐘後讀取該回條；有時 Expo 也會當場拒絕推播。無論哪種情況，OneUptime 都會停止傳送至該裝置。該裝置會被標記為不再接收通知，而不是被刪除，因此其通知規則會保留，未送達通知的推播記錄和值班時間軸會說明原因。**User Settings > Notification Methods > Push** 會將其顯示為 **未收到通知**。其擁有者的其他裝置和通知方式仍會收到通知。

若要恢復該裝置，請在登入狀態下於該裝置上開啟行動應用程式。應用程式會重新註冊，藉此在 Expo 更新其推播權杖，裝置將帶著原有規則重新接收通知。如果應用程式已被移除，請重新安裝並登入。應用程式重新註冊之前傳送之推播的回條不會標記該裝置。當在新手機上透過舊手機的備份設定最新版行動應用程式時，應用程式會將先前的推播權杖告知 OneUptime；如果舊手機的裝置已不再接收通知，新手機會連同其規則接管該裝置。

透過推播中繼（未設定 `EXPO_ACCESS_TOKEN`）時也是如此：中繼在傳送推播時回報 `DeviceNotRegistered`，並讀取您的執行個體所詢問的送達回條。

## 支援

如果您在使用推播通知時遇到問題，請：

1. 查看上方的疑難排解章節
2. 檢視 OneUptime 記錄以取得詳細的錯誤訊息
3. 透過 [hello@oneuptime.com](mailto:hello@oneuptime.com) 與我們聯絡
