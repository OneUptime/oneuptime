# Android 安裝指南

從 Google Play Store 安裝原生的 **OneUptime On-Call** Android 應用程式，或在沒有 Google Play 的裝置上直接側載 APK。

## 需求

- 執行 **Android 8.0 (Oreo) 或更新版本** 的 Android 手機或平板電腦
- 有效的 OneUptime 帳戶（或您自架的 OneUptime 執行個體的 URL）
- 用於登入及接收推播通知的網際網路連線

## 選項 1：從 Google Play 安裝（建議）

1. 在您的裝置上開啟 **Google Play Store**。
2. 搜尋 **「OneUptime On-Call」**，或在您的裝置上開啟此連結：
   [https://play.google.com/store/apps/details?id=com.oneuptime.oncall](https://play.google.com/store/apps/details?id=com.oneuptime.oncall)
3. 點選 **安裝**。
4. 安裝完成後，點選 **開啟**，或從您的應用程式匣啟動 **OneUptime On-Call**。

## 選項 2：直接安裝 APK

對於沒有 Google Play 的裝置（例如 GrapheneOS、/e/OS 或華為裝置），請從 GitHub Releases 安裝官方 APK：

1. 在您的 Android 裝置上，開啟此連結：
   [https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk)
2. 出現提示時，允許您的瀏覽器安裝未知的應用程式：
   **設定 → 應用程式 → \[您的瀏覽器\] → 安裝未知的應用程式 → 允許來自此來源**。
3. 開啟下載的 APK 並點選 **安裝**。
4. 從您的應用程式匣啟動 **OneUptime On-Call**。

此 APK 由 OneUptime 從與 Play Store 版本相同的原始碼建置並簽署。側載時應用程式不會自動更新——當新版本發布時，請從上方連結下載最新的 APK。

## 首次啟動與登入

1. **伺服器 URL**
   - 如果您使用 OneUptime Cloud，請保留預設的 `https://oneuptime.com`。
   - 如果您是自架，請輸入您的 OneUptime 執行個體的 URL（例如 `https://oneuptime.example.com`）。
   - 應用程式會在繼續之前驗證伺服器是否可連線。
2. **登入**
   - 輸入您 OneUptime 帳戶的電子郵件與密碼。
   - 可選擇啟用 **生物辨識解鎖**（指紋），以在後續啟動時更快速地解鎖。
3. **允許通知**
   - 出現提示時，點選 **允許**，讓應用程式能夠傳送待命呼叫、事件警示與確認。

## 推播通知

推播通知透過 Firebase Cloud Messaging (FCM) 經由 Expo Push 傳送。為確保待命期間呼叫能可靠地送達您：

1. 開啟 **設定 → 應用程式 → OneUptime On-Call → 通知**，並確認所有類別皆已啟用。
2. 開啟 **設定 → 應用程式 → OneUptime On-Call → 電池**，並選擇 **不受限制**（或停用電池最佳化），這樣作業系統就不會延遲背景推播。
3. 允許應用程式在背景執行，並為其停用任何「數據節省」限制。
4. 如果您使用三星裝置，也請關閉 OneUptime On-Call 的 **設定 → 裝置維護 → 電池 → 背景使用限制**。
5. 將 OneUptime On-Call 加入任何 **零打擾** 例外清單，這樣在您的待命輪班期間呼叫仍會響鈴。

## 更新

**Google Play：**
- 更新會自動安裝。若要手動觸發更新，請開啟 **Play Store → 個人檔案 → 管理應用程式和裝置 → 有可用更新 → OneUptime On-Call → 更新**。

**APK 側載：**
- 從上方的 GitHub Releases 連結重新下載最新的 APK，並覆蓋安裝於現有的應用程式之上——您的資料、伺服器 URL 與登入皆會保留。

## 解除安裝

1. **長按** **OneUptime On-Call** 圖示，然後點選 **解除安裝**。
2. 或開啟 **設定 → 應用程式 → OneUptime On-Call → 解除安裝**。
3. 確認以移除應用程式。

您的 OneUptime 帳戶與待命排程儲存於伺服器端，在您解除安裝應用程式時不會被移除。

## 疑難排解

**登入時出現「網路錯誤」：**
- 確認 **伺服器 URL** 正確且可從您的裝置連線。
- 如果您位於公司網路或 VPN 上，請確保 OneUptime 執行個體可存取。
- 確認伺服器透過具有有效憑證的 HTTPS 提供服務。

**未收到推播通知：**
- 確認已在 **設定 → 應用程式 → OneUptime On-Call → 通知** 中啟用通知。
- 為 OneUptime On-Call 停用電池最佳化（請參閱上方的「推播通知」）。
- 確保零打擾已關閉，或 OneUptime On-Call 在例外清單上。
- 登出後再重新登入，以重新整理向伺服器註冊的推播權杖。
- 自架使用者：確認您的 OneUptime 執行個體上已設定推播通知（請參閱自架的 [推播通知](/docs/self-hosted/push-notifications) 指南）。

**生物辨識解鎖無法運作：**
- 在 **設定 → 安全性 → 指紋** 中註冊指紋。
- 從 OneUptime On-Call 應用程式內的 **設定** 畫面重新啟用生物辨識解鎖。

**APK 安裝被封鎖：**
- 您必須授予瀏覽器安裝未知應用程式的權限（請參閱上方的選項 2）。
- 某些電信業者或企業裝置設定檔會完全封鎖側載；在這種情況下，請改用 Google Play 版本。

**應用程式在啟動時當機：**
- 從 Google Play 更新至最新版本，或更新至最新的 APK。
- 重新啟動您的裝置。
- 如果問題持續存在，請解除安裝並重新安裝，然後再次登入。

## 支援

如果您仍需要協助，請透過您的 OneUptime 儀表板聯絡我們，或在我們的 [GitHub 儲存庫](https://github.com/OneUptime/oneuptime) 上提出問題。
