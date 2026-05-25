# 常見問題與故障排查

OneUptime 移動和桌面應用的常見問題及解決方案。

## OneUptime 是如何分發其應用的?

- **移動端(iOS 和 Android):** OneUptime 提供一款名爲 **OneUptime On-Call** 的原生應用。該應用已發佈到 [Apple App Store](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391) 和 [Google Play](https://play.google.com/store/apps/details?id=com.oneuptime.oncall)。對於沒有 Google Play 的 Android 設備,也提供經過簽名的 [APK 下載](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk)。
- **桌面端(Windows、macOS、Linux):** OneUptime Web 控制面板是一個漸進式 Web 應用 (PWA)。您可以直接從基於 Chromium 的瀏覽器或 Safari 將其安裝爲桌面應用 — 無需任何商店賬戶。

## 移動應用常見問題

### 支持哪些設備?

- **iOS:** 運行 iOS 15.0 或更高版本的 iPhone 或 iPad。
- **Android:** 運行 Android 8.0 (Oreo) 或更高版本的手機和平板電腦。

### 該應用免費嗎?

是的。OneUptime On-Call 應用可免費安裝。您使用現有的 OneUptime 賬戶登錄。

### 我可以將該應用與自託管的 OneUptime 實例一起使用嗎?

可以。首次啓動時,應用會詢問 **服務器 URL**。請輸入您自託管實例的 URL(例如 `https://oneuptime.example.com`)。應用會先驗證服務器可訪問,然後才允許您登錄。

如需在自託管實例上接收推送通知,請遵循 [推送通知](/docs/self-hosted/push-notifications) 指南。

### 更新是如何發佈的?

- **iOS:** 通過 App Store。在 **設置 → App Store** 中啓用自動更新,或從您的 App Store 個人資料中手動更新。
- **Android (Google Play):** 默認啓用自動更新。
- **Android (APK 旁加載):** 從上述 GitHub Releases 鏈接下載並安裝最新的 APK。

### 爲什麼我收不到推送通知?

移動推送通過 APNs (iOS) 和 FCM (Android) 並經由 Expo Push 投遞。請檢查以下內容:

1. 在操作系統級別已爲 **OneUptime On-Call** 啓用通知。
2. 已禁用電池優化並允許後臺活動(Android)。
3. 勿擾模式或專注模式已關閉,或者該應用已在例外列表中。
4. 您已登錄 — 推送令牌僅在登錄後纔會註冊到服務器。
5. **僅限自託管:** 您的 OneUptime 實例已配置推送通知。請參閱 [推送通知](/docs/self-hosted/push-notifications) 指南。

### 我手機上的數據安全嗎?

- 所有 API 流量均使用 HTTPS。
- 訪問令牌和刷新令牌儲存在設備的安全密鑰庫中(iOS 上的 Keychain,Android 上的 Keystore)。
- 您可以在應用內的 **設置** 屏幕中要求使用 Face ID / Touch ID / 指紋解鎖。

### 我可以在多臺設備上安裝該應用嗎?

可以。您可以根據需要在任意多臺設備上使用同一個 OneUptime 賬戶登錄。每臺設備都會收到自己的推送通知。

### 如何卸載?

- **iOS:** 長按圖標 → **移除 App** → **刪除 App**。
- **Android:** 長按圖標 → **卸載**,或前往 **設置 → 應用 → OneUptime On-Call → 卸載**。

您的 OneUptime 賬戶和數據儲存在服務器上,卸載應用時不會被刪除。

## 桌面應用 (PWA) 常見問題

### 什麼是漸進式 Web 應用 (PWA)?

漸進式 Web 應用是一種 Web 應用程序,可以像原生桌面應用一樣安裝。安裝後,它會在自己的窗口中運行,在啓動器中擁有自己的圖標,並可發送桌面通知 — 無需通過 Windows 商店、Mac App Store 或任何其他分發渠道。

### 桌面應用爲什麼使用 PWA 技術?

- **即時更新** — 您一旦部署,應用便會立即與您的 OneUptime 實例保持同步。
- **無需商店賬戶** — 可直接從任何現代瀏覽器安裝。
- **單一代碼庫** — 同一個控制面板可在 Windows、macOS 和 Linux 上運行。

### 爲什麼"安裝"按鈕未出現?

1. 使用基於 Chromium 的瀏覽器(Chrome、Edge、Brave、Arc)或 Safari(macOS Sonoma+)。
2. 確認您的 OneUptime 實例通過 HTTPS 提供服務並使用有效證書。
3. 清除瀏覽器緩存並重新加載。
4. 應用可能已經安裝 — 請檢查您的應用程序 / 開始菜單。

### 如何更新桌面應用?

只要您在聯網狀態下打開該 PWA,它就會自動更新。如需強制更新,請使用 **Ctrl+R**(Windows/Linux)或 **Cmd+R**(macOS)刷新窗口。

### 如何卸載桌面 PWA?

- **Windows:** **設置 → 應用 → OneUptime → 卸載**,或右鍵點擊開始菜單條目。
- **macOS:** 將應用從 **應用程序** 拖到廢紙簍,或右鍵點擊程序塢圖標並選擇 **移除**。
- **Linux:** 使用您的應用啓動器的卸載選項,或移除相應的 `.desktop` 文件。

## 故障排查

### 移動應用問題

**應用無法登錄 / "網絡錯誤":**
- 確認 **服務器 URL** 正確,並且可從您的手機訪問。
- 檢查您的手機是否已連接到互聯網。
- 對於位於 VPN 後的自託管實例,請確保 VPN 已啓用。

**推送通知延遲或丟失 (Android):**
- 禁用電池優化:**設置 → 應用 → OneUptime On-Call → 電池 → 無限制**。
- 爲該應用禁用數據節省程序。
- 在 Samsung 設備上,關閉 OneUptime On-Call 的 **設備維護 → 電池 → 後臺使用限制**。

**推送通知延遲或丟失 (iOS):**
- 避免強制退出應用 — iOS 可能會暫停後臺投遞。
- 在您值班期間禁用低電量模式。
- 將 OneUptime On-Call 添加到所有激活的專注模式的允許列表中。

**Face ID / Touch ID / 指紋無法正常工作:**
- 確保已在操作系統設置中註冊生物識別信息。
- 從 OneUptime On-Call 應用內的 **設置** 屏幕重新啓用生物識別解鎖。

### 桌面應用 (PWA) 問題

**缺少安裝按鈕:**
- 使用受支持的瀏覽器(基於 Chromium 的瀏覽器或 macOS Sonoma+ 上的 Safari)。
- 確保 OneUptime 實例通過 HTTPS 提供服務。
- 等待頁面加載完成,然後查看地址欄中的安裝圖標。

**桌面通知未顯示:**
- 當瀏覽器提示時,允許通知。
- 檢查操作系統的通知設置(Windows 專注助手、macOS 通知、Linux 通知守護進程)。
- 對於自託管實例,請確保已完成 [推送通知](/docs/self-hosted/push-notifications) 配置。

**應用未顯示最新數據:**
- 使用 **Ctrl+R** / **Cmd+R** 刷新。
- 關閉並重新打開窗口。
- 檢查您的網絡連接。

## 支持

如果您仍需幫助:

- 移動端:請參閱 [iOS](./ios-installation.md) 或 [Android](./android-installation.md) 安裝指南。
- 桌面端:請參閱 [Windows](./windows-installation.md)、[macOS](./macos-installation.md) 或 [Linux](./linux-installation.md) 安裝指南。
- 在 [OneUptime GitHub 倉庫](https://github.com/OneUptime/oneuptime) 上提交 issue。
- 通過您的 OneUptime 控制面板聯繫支持。
