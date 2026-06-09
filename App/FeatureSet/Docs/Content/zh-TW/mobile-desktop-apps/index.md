# OneUptime 行動裝置與桌面應用程式

OneUptime 提供兩種在瀏覽器之外使用平台的方式：

- **原生行動應用程式**，適用於 iOS 與 Android，發佈於 **Apple App Store** 與 **Google Play**。這些應用程式可將待命傳呼、事件警報以及確認操作直接送達您的手機。
- **可安裝的桌面應用程式**，適用於 Windows、macOS 與 Linux，以漸進式網頁應用程式（PWA）形式直接從您的瀏覽器安裝。這些應用程式讓 OneUptime 儀表板在您的電腦上擁有專屬的視窗、圖示與通知介面。

## 行動裝置（原生應用程式）

**OneUptime On-Call** 應用程式是以 React Native 打造的原生應用程式。它透過官方商店發佈，因此您可獲得自動更新、推播通知以及生物辨識解鎖功能。

- **iOS** — [在 App Store 下載](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391)。需要 iOS 15.0 或更新版本。請參閱 [iOS 安裝指南](./ios-installation.md)。
- **Android** — [在 Google Play 取得](https://play.google.com/store/apps/details?id=com.oneuptime.oncall)。需要 Android 8.0 或更新版本。對於沒有 Google Play 的裝置，亦提供直接 [APK 下載](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk)。請參閱 [Android 安裝指南](./android-installation.md)。

## 桌面（漸進式網頁應用程式）

OneUptime 的網頁儀表板是一個漸進式網頁應用程式，因此您可以從現代瀏覽器將它安裝為桌面應用程式，而無需透過任何商店。

- [Windows 安裝](./windows-installation.md)
- [macOS 安裝](./macos-installation.md)
- [Linux 安裝](./linux-installation.md)

### 桌面入門

1. 在以 Chromium 為基礎的瀏覽器（Chrome、Edge）或 Safari 中開啟您的 OneUptime 執行個體。
2. 在網址列中尋找 **Install** 按鈕，或透過 **File → Add to Dock / Apps → Install this site as an app**。
3. 從您的開始功能表、Launchpad 或應用程式啟動器啟動已安裝的應用程式。

### 桌面疑難排解

**未出現安裝選項：**
- 請確認您使用的是受支援的瀏覽器。
- 確認您的 OneUptime 執行個體是透過 HTTPS 提供服務。
- 重新整理頁面或清除您的瀏覽器快取。

**推播通知無法運作：**
- 當瀏覽器提示時，請授予通知權限。
- 檢查您作業系統中該瀏覽器的通知設定。
- 自我託管的使用者：請確認您的 OneUptime 執行個體已設定推播通知。

## 支援

- 行動裝置相關問題：請查看 [iOS](./ios-installation.md) 或 [Android](./android-installation.md) 安裝指南。
- 桌面相關問題：請查看 [Windows](./windows-installation.md)、[macOS](./macos-installation.md) 或 [Linux](./linux-installation.md) 安裝指南。
- 一般問題：請參閱 [常見問題與疑難排解](./faq-troubleshooting.md) 頁面。
- 在我們的 [GitHub 儲存庫](https://github.com/OneUptime/oneuptime) 回報錯誤或提出功能請求。
