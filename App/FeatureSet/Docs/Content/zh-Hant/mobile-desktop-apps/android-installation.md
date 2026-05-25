# Android 安裝指南

從 Google Play 商店安裝 **OneUptime On-Call** 原生 Android 應用,或者在沒有 Google Play 的設備上直接旁加載 APK。

## 系統要求

- 運行 **Android 8.0 (Oreo) 或更高版本** 的 Android 手機或平板電腦
- 有效的 OneUptime 賬戶(或您自託管 OneUptime 實例的 URL)
- 用於登錄和接收推送通知的互聯網連接

## 選項 1:從 Google Play 安裝(推薦)

1. 在您的設備上打開 **Google Play 商店**。
2. 搜索 **"OneUptime On-Call"**,或在設備上打開此鏈接:
   [https://play.google.com/store/apps/details?id=com.oneuptime.oncall](https://play.google.com/store/apps/details?id=com.oneuptime.oncall)
3. 點按 **安裝**。
4. 安裝完成後,點按 **打開**,或從應用抽屜啓動 **OneUptime On-Call**。

## 選項 2:直接安裝 APK

對於沒有 Google Play 的設備(例如 GrapheneOS、/e/OS 或 Huawei 設備),請從 GitHub Releases 安裝官方 APK:

1. 在您的 Android 設備上打開此鏈接:
   [https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk)
2. 當出現提示時,允許您的瀏覽器安裝未知應用:
   **設置 → 應用 → \[您的瀏覽器\] → 安裝未知應用 → 允許來自此來源**。
3. 打開下載好的 APK,然後點按 **安裝**。
4. 從應用抽屜啓動 **OneUptime On-Call**。

該 APK 由 OneUptime 使用與 Play Store 版本相同的源代碼構建並簽名。旁加載時應用更新不是自動的 — 當新版本發佈時,請從上述鏈接下載最新的 APK。

## 首次啓動與登錄

1. **服務器 URL**
   - 如果您使用 OneUptime Cloud,請保留默認值 `https://oneuptime.com`。
   - 如果您是自託管,請輸入您的 OneUptime 實例的 URL(例如 `https://oneuptime.example.com`)。
   - 應用會在繼續之前驗證服務器是否可訪問。
2. **登錄**
   - 輸入您 OneUptime 賬戶的電郵和密碼。
   - 可選擇啓用 **生物識別解鎖**(指紋),以便在後續啓動時更快地解鎖。
3. **允許通知**
   - 當提示出現時,點按 **允許**,以便應用可以發送隨叫隨到呼叫、事件警報和確認信息。

## 推送通知

推送通知通過 Firebase Cloud Messaging (FCM) 並經由 Expo Push 投遞。爲了確保值班期間呼叫可靠地送達:

1. 打開 **設置 → 應用 → OneUptime On-Call → 通知**,確認所有類別均已啓用。
2. 打開 **設置 → 應用 → OneUptime On-Call → 電池**,選擇 **無限制**(或禁用電池優化),以便操作系統不會延遲後臺推送。
3. 允許應用在後臺運行,並禁用任何針對該應用的"數據節省程序"限制。
4. 如果您使用 Samsung 設備,還需在 **設置 → 設備維護 → 電池 → 後臺使用限制** 中爲 OneUptime On-Call 關閉限制。
5. 將 OneUptime On-Call 添加到所有 **勿擾模式** 例外列表中,以便在您值班期間呼叫仍能響鈴。

## 更新

**Google Play:**
- 更新會自動安裝。要手動觸發更新,請打開 **Play 商店 → 個人資料 → 管理應用和設備 → 有可用更新 → OneUptime On-Call → 更新**。

**APK 旁加載:**
- 從上述 GitHub Releases 鏈接重新下載最新的 APK 並覆蓋安裝現有應用 — 您的數據、服務器 URL 和登錄信息會被保留。

## 卸載

1. **長按** **OneUptime On-Call** 圖標,然後點按 **卸載**。
2. 或打開 **設置 → 應用 → OneUptime On-Call → 卸載**。
3. 確認以移除該應用。

您的 OneUptime 賬戶和值班排班儲存在服務器端,卸載應用時不會被刪除。

## 故障排查

**登錄時出現"網絡錯誤":**
- 驗證 **服務器 URL** 是否正確,並且可從您的設備訪問。
- 如果您處於企業網絡或 VPN 上,請確保可以訪問該 OneUptime 實例。
- 確認服務器通過 HTTPS 提供服務並使用有效證書。

**未收到推送通知:**
- 在 **設置 → 應用 → OneUptime On-Call → 通知** 中確認已啓用通知。
- 禁用 OneUptime On-Call 的電池優化(請參閱上文"推送通知"部分)。
- 確保勿擾模式已關閉,或者 OneUptime On-Call 已在例外列表中。
- 退出登錄後重新登錄,以刷新已在服務器上註冊的推送令牌。
- 自託管用戶:確認您的 OneUptime 實例已配置推送通知(請參閱自託管 [推送通知](/docs/self-hosted/push-notifications) 指南)。

**生物識別解鎖無法正常工作:**
- 在 **設置 → 安全 → 指紋** 中註冊指紋。
- 從 OneUptime On-Call 應用內的 **設置** 屏幕重新啓用生物識別解鎖。

**APK 安裝被阻止:**
- 您必須授予瀏覽器安裝未知應用的權限(請參閱上文"選項 2")。
- 部分運營商或企業設備配置文件會完全阻止旁加載;在這種情況下,請改用 Google Play 版本。

**應用啓動時崩潰:**
- 從 Google Play 更新到最新版本,或下載最新的 APK。
- 重新啓動您的設備。
- 如果問題仍然存在,請卸載並重新安裝,然後重新登錄。

## 支持

如果您仍需幫助,請通過您的 OneUptime 控制面板聯繫我們,或在我們的 [GitHub 倉庫](https://github.com/OneUptime/oneuptime) 上提交 issue。
