# 常見問題與疑難排解

OneUptime 行動與桌面應用程式的常見問題與解決方案。

## OneUptime 如何發行其應用程式？

- **行動裝置（iOS 與 Android）：** OneUptime 推出一款名為 **OneUptime On-Call** 的原生應用程式。它已發佈於 [Apple App Store](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391) 與 [Google Play](https://play.google.com/store/apps/details?id=com.oneuptime.oncall)。對於沒有 Google Play 的 Android 裝置，亦提供已簽署的 [APK 下載](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk)。
- **桌面（Windows、macOS、Linux）：** OneUptime 網頁儀表板是一個漸進式網頁應用程式（PWA）。您可以直接從基於 Chromium 的瀏覽器或 Safari 將它安裝為桌面應用程式——無需任何商店帳號。

## 行動應用程式常見問題

### 支援哪些裝置？

- **iOS：** 執行 iOS 15.0 或以上版本的 iPhone 或 iPad。
- **Android：** 執行 Android 8.0（Oreo）或以上版本的手機與平板電腦。

### 應用程式是免費的嗎？

是的。OneUptime On-Call 應用程式可免費安裝。您使用既有的 OneUptime 帳號登入。

### 我可以將應用程式搭配自架的 OneUptime 執行個體使用嗎？

可以。首次啟動時，應用程式會要求輸入 **Server URL**。請輸入您自架執行個體的 URL（例如 `https://oneuptime.example.com`）。在允許您登入之前，應用程式會驗證該伺服器是否可連線。

關於自架執行個體上的推播通知，請參閱[推播通知](/docs/self-hosted/push-notifications)指南。

### 更新如何傳遞？

- **iOS：** 透過 App Store。在 **Settings → App Store** 中啟用自動更新，或從您的 App Store 個人檔案手動更新。
- **Android（Google Play）：** 自動更新預設為啟用。
- **Android（APK 側載）：** 從上方的 GitHub Releases 連結下載並安裝最新的 APK。

### 為什麼我沒有收到推播通知？

行動推播透過 Expo Push 使用 APNs（iOS）與 FCM（Android）。請檢查以下項目：

1. 已在作業系統層級為 **OneUptime On-Call** 啟用通知。
2. 已停用電池最佳化並允許背景活動（Android）。
3. 勿擾或專注模式已關閉，或應用程式位於例外清單中。
4. 您已登入——推播權杖只有在您登入後才會向伺服器註冊。
5. **僅限自架：** 推播通知已在您的 OneUptime 執行個體上設定完成。請參閱[推播通知](/docs/self-hosted/push-notifications)指南。

### 我手機上的資料安全嗎？

- 所有 API 流量皆使用 HTTPS。
- 存取權杖與重新整理權杖儲存在裝置的安全金鑰庫中（iOS 上為 Keychain，Android 上為 Keystore）。
- 您可以在應用程式內的 **Settings** 畫面要求使用 Face ID／Touch ID／指紋解鎖。

### 我可以在多個裝置上安裝應用程式嗎？

可以。在您需要的多個裝置上以相同的 OneUptime 帳號登入即可。每個裝置都會收到自己的推播通知。

### 我該如何解除安裝？

- **iOS：** 長按圖示 →**Remove App** →**Delete App**。
- **Android：** 長按圖示 →**Uninstall**，或 **Settings → Apps → OneUptime On-Call → Uninstall**。

您的 OneUptime 帳號與資料儲存在伺服器上，解除安裝應用程式時不會被移除。

## 桌面應用程式（PWA）常見問題

### 什麼是漸進式網頁應用程式（PWA）？

漸進式網頁應用程式是一種可以像原生桌面應用程式一樣安裝的網頁應用程式。安裝後，它會在自己的視窗中執行、在您的啟動器中擁有自己的圖示，並能傳遞桌面通知——無需透過 Windows Store、Mac App Store 或任何其他發行通路。

### 為什麼桌面應用程式採用 PWA 技術？

- **即時更新**——應用程式在您部署的當下即與您的 OneUptime 執行個體保持同步。
- **無需商店帳號**——直接從任何現代瀏覽器安裝。
- **單一程式碼庫**——相同的儀表板可在 Windows、macOS 與 Linux 上執行。

### 為什麼「安裝」按鈕沒有出現？

1. 使用基於 Chromium 的瀏覽器（Chrome、Edge、Brave、Arc）或 Safari（macOS Sonoma 以上）。
2. 確認您的 OneUptime 執行個體透過具有有效憑證的 HTTPS 提供服務。
3. 清除您的瀏覽器快取並重新載入。
4. 應用程式可能已安裝——請查看您的應用程式／開始功能表。

### 我該如何更新桌面應用程式？

PWA 會在您於連線狀態下開啟時自動更新。若要強制更新，請使用 **Ctrl+R**（Windows／Linux）或 **Cmd+R**（macOS）重新整理視窗。

### 我該如何解除安裝桌面 PWA？

- **Windows：** **Settings → Apps → OneUptime → Uninstall**，或右鍵點選開始功能表中的項目。
- **macOS：** 將應用程式從 **Applications** 拖曳至垃圾桶，或右鍵點選 Dock 圖示並選擇 **Remove**。
- **Linux：** 使用您的應用程式啟動器的解除安裝選項，或移除相關的 `.desktop` 檔案。

## 疑難排解

### 行動應用程式問題

**應用程式無法登入／「Network Error」：**
- 確認 **Server URL** 正確且可從您的手機連線。
- 檢查您的手機是否已連上網際網路。
- 對於位於 VPN 後方的自架執行個體，請確保 VPN 已啟用。

**推播通知延遲或遺失（Android）：**
- 停用電池最佳化：**Settings → Apps → OneUptime On-Call → Battery → Unrestricted**。
- 為應用程式停用 Data Saver。
- 在 Samsung 裝置上，為 OneUptime On-Call 關閉 **Device care → Battery → Background usage limits**。

**推播通知延遲或遺失（iOS）：**
- 避免強制結束應用程式——iOS 可能會暫停背景傳遞。
- 在待命期間停用低耗電模式。
- 將 OneUptime On-Call 加入任何作用中的專注模式的允許清單。

**Face ID／Touch ID／指紋無法運作：**
- 確認已在您的作業系統設定中註冊生物辨識。
- 在 OneUptime On-Call 應用程式內的 **Settings** 畫面重新啟用生物辨識解鎖。

### 桌面應用程式（PWA）問題

**安裝按鈕遺失：**
- 使用支援的瀏覽器（基於 Chromium 或 macOS Sonoma 以上的 Safari）。
- 確保 OneUptime 執行個體透過 HTTPS 提供服務。
- 等待頁面載入完成，然後查看網址列中的安裝圖示。

**桌面通知未出現：**
- 當瀏覽器提示時允許通知。
- 檢查作業系統通知設定（Windows 專注輔助、macOS 通知、Linux 通知常駐程式）。
- 對於自架執行個體，請確保[推播通知](/docs/self-hosted/push-notifications)設定已完成。

**應用程式未顯示最新資料：**
- 使用 **Ctrl+R**／**Cmd+R** 重新整理。
- 關閉並重新開啟視窗。
- 檢查您的網路連線。

## 支援

如果您仍需協助：

- 行動裝置：請參閱 [iOS](./ios-installation.md) 或 [Android](./android-installation.md) 安裝指南。
- 桌面：請參閱 [Windows](./windows-installation.md)、[macOS](./macos-installation.md) 或 [Linux](./linux-installation.md) 安裝指南。
- 在 [OneUptime GitHub 儲存庫](https://github.com/OneUptime/oneuptime)上提出問題。
- 透過您的 OneUptime 儀表板聯絡支援。
