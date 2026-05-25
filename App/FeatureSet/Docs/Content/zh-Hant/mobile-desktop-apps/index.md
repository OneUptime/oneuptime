# OneUptime 移動和桌面應用

OneUptime 提供兩種在瀏覽器之外使用平臺的方式:

- **原生移動應用**,適用於 iOS 和 Android,已發佈到 **Apple App Store** 和 **Google Play**。它們可將隨叫隨到呼叫、事件警報和確認操作直接發送到您的手機。
- **可安裝的桌面應用**,適用於 Windows、macOS 和 Linux,作爲漸進式 Web 應用 (PWA) 直接從瀏覽器安裝。它們讓 OneUptime 控制面板在您的電腦上擁有自己的窗口、圖標和通知界面。

## 移動端(原生應用)

**OneUptime On-Call** 應用是一款使用 React Native 構建的原生應用。它通過官方商店分發,因此您可以獲得自動更新、推送通知和生物識別解鎖。

- **iOS** — [在 App Store 下載](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391)。需要 iOS 15.0 或更高版本。請參閱 [iOS 安裝指南](./ios-installation.md)。
- **Android** — [在 Google Play 獲取](https://play.google.com/store/apps/details?id=com.oneuptime.oncall)。需要 Android 8.0 或更高版本。對於沒有 Google Play 的設備,也可直接 [下載 APK](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk)。請參閱 [Android 安裝指南](./android-installation.md)。

## 桌面端(漸進式 Web 應用)

OneUptime 的 Web 控制面板是一個漸進式 Web 應用,因此您可以從現代瀏覽器將其安裝爲桌面應用,無需通過任何商店。

- [Windows 安裝](./windows-installation.md)
- [macOS 安裝](./macos-installation.md)
- [Linux 安裝](./linux-installation.md)

### 桌面入門

1. 在基於 Chromium 的瀏覽器(Chrome、Edge)或 Safari 中打開您的 OneUptime 實例。
2. 在地址欄中查找 **安裝** 按鈕,或前往 **文件 → 添加到程序塢 / 應用 → 將此網站作爲應用安裝**。
3. 從開始菜單、啓動臺或應用啓動器啓動已安裝的應用。

### 桌面故障排查

**未出現安裝選項:**
- 確保您使用的是受支持的瀏覽器。
- 確認您的 OneUptime 實例通過 HTTPS 提供服務。
- 刷新頁面或清除瀏覽器緩存。

**推送通知無法正常工作:**
- 當瀏覽器提示時,授予通知權限。
- 檢查操作系統中針對該瀏覽器的通知設置。
- 自託管用戶:確認您的 OneUptime 實例已配置推送通知。

## 支持

- 移動端相關問題:請查看 [iOS](./ios-installation.md) 或 [Android](./android-installation.md) 安裝指南。
- 桌面端相關問題:請查看 [Windows](./windows-installation.md)、[macOS](./macos-installation.md) 或 [Linux](./linux-installation.md) 安裝指南。
- 一般問題:請參閱 [常見問題與故障排查](./faq-troubleshooting.md) 頁面。
- 在我們的 [GitHub 倉庫](https://github.com/OneUptime/oneuptime) 上提交錯誤或功能請求。
