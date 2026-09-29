# iOS 安裝指南

在您的 iPhone 或 iPad 上，從 Apple App Store 安裝 **OneUptime On-Call** 原生 iOS 應用程式。

## 需求

- 執行 **iOS 15.0 或更新版本**的 iPhone 或 iPad
- 一個有效的 OneUptime 帳號（或您自架 OneUptime 執行個體的 URL）
- 用於登入及接收推播通知的網際網路連線

## 從 App Store 安裝

1. 在您的 iPhone 或 iPad 上**開啟 App Store**。
2. 點按 **Search**（搜尋）分頁並搜尋 **"OneUptime On-Call"**，或在您的裝置上開啟此連結：
   [https://apps.apple.com/us/app/oneuptime-on-call/id6759615391](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391)
3. 點按 **Get**（取得），然後以 Face ID、Touch ID 或您的 Apple ID 密碼進行驗證。
4. 安裝完成後，點按 **Open**（開啟）或從主畫面啟動 **OneUptime On-Call**。

## 首次啟動與登入

1. **伺服器 URL**
   - 如果您使用 OneUptime Cloud，請保留預設值 `https://oneuptime.com`。
   - 如果您是自架，請輸入您 OneUptime 執行個體的 URL（例如 `https://oneuptime.example.com`）。
   - 應用程式會在繼續之前驗證伺服器是否可連線。
2. **登入**
   - 輸入您 OneUptime 帳號的電子郵件與密碼。
   - 可選擇啟用 **Face ID** 或 **Touch ID**，以便在之後啟動時更快速地解鎖。
3. **允許通知**
   - 出現提示時，請點按 **Allow**（允許），讓應用程式能夠傳遞值班呼叫、事件警示與確認訊息。

## 推播通知

推播通知透過 Apple Push Notification service（APNs）並經由 Expo Push 傳遞。為了確保呼叫能可靠地送達您：

1. 前往 **Settings → Notifications → OneUptime On-Call**。
2. 啟用 **Allow Notifications**、**Sounds**、**Badges** 以及 **Lock Screen / Banner / Notification Centre** 傳遞。
3. 將 **Notification Grouping** 設定為 **Automatic**。
4. 如果您正在值班，請在輪班期間停用 **Low Power Mode**（低耗電模式），並避免強制結束應用程式 — 如果應用程式被強制關閉，iOS 可能會延遲背景傳遞。
5. 將 **OneUptime On-Call** 加入任何您仍想接收呼叫的 **Focus**（專注模式）。

## 更新

應用程式透過 App Store 進行更新：

- 開啟 **App Store**，點按您的個人檔案圖片，捲動至 **OneUptime On-Call**，然後點按 **Update**（更新）。
- 或啟用 **Settings → App Store → App Updates** 以自動安裝更新。

## 解除安裝

1. 在主畫面上**長按** **OneUptime On-Call** 圖示。
2. 點按 **Remove App → Delete App**。
3. 點按 **Delete** 進行確認。

您的 OneUptime 帳號與值班排程儲存在伺服器端，解除安裝應用程式時不會被移除。

## 疑難排解

**App Store 顯示應用程式「Not Available in Your Region」（在您的地區無法使用）：**

- 此應用程式發佈於全球 App Store。如果它未在您的地區出現，請聯絡[支援](mailto:support@oneuptime.com)。

**登入時出現「Network Error」（網路錯誤）：**

- 請確認 **Server URL** 正確且可從您的裝置連線。
- 如果您位於公司網路或 VPN，請確保可存取該 OneUptime 執行個體。
- 確認伺服器是透過 HTTPS 並使用有效憑證提供服務。

**未收到推播通知：**

- 開啟 **Settings → Notifications → OneUptime On-Call** 並確認已允許通知。
- 停用 **Do Not Disturb**（勿擾模式），或將 OneUptime On-Call 加入您目前作用中專注模式的允許清單。
- 登出後再重新登入，以重新整理向伺服器註冊的推播權杖。
- 自架使用者：請確認您的 OneUptime 執行個體已設定推播通知（請參閱自架的[推播通知](/docs/self-hosted/push-notifications)指南）。

**Face ID / Touch ID 無法運作：**

- 請確保已在 **Settings → Face ID & Passcode** 或 **Settings → Touch ID & Passcode** 中註冊生物辨識。
- 從 OneUptime On-Call 應用程式內的 **Settings** 畫面重新啟用生物辨識解鎖。

**應用程式啟動時當機：**

- 從 App Store 更新至最新版本。
- 重新啟動您的裝置。
- 如果問題仍然存在，請刪除並重新安裝應用程式，然後再次登入。

## 支援

如果您仍需協助，請透過您的 OneUptime 儀表板聯絡我們，或在我們的 [GitHub repository](https://github.com/OneUptime/oneuptime) 上開立 issue。
