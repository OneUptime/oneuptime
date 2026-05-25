# iOS 安裝指南

在您的 iPhone 或 iPad 上從 Apple App Store 安裝 **OneUptime On-Call** 原生 iOS 應用。

## 系統要求

- 運行 **iOS 15.0 或更高版本** 的 iPhone 或 iPad
- 有效的 OneUptime 賬戶(或您自託管 OneUptime 實例的 URL)
- 用於登錄和接收推送通知的互聯網連接

## 從 App Store 安裝

1. 在您的 iPhone 或 iPad 上 **打開 App Store**。
2. 點按 **搜索** 標籤並搜索 **"OneUptime On-Call"**,或在設備上打開此鏈接:
   [https://apps.apple.com/us/app/oneuptime-on-call/id6759615391](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391)
3. 點按 **獲取**,然後使用 Face ID、Touch ID 或您的 Apple ID 密碼進行身份驗證。
4. 安裝完成後,點按 **打開**,或從主屏幕啓動 **OneUptime On-Call**。

## 首次啓動與登錄

1. **服務器 URL**
   - 如果您使用 OneUptime Cloud,請保留默認值 `https://oneuptime.com`。
   - 如果您是自託管,請輸入您的 OneUptime 實例的 URL(例如 `https://oneuptime.example.com`)。
   - 應用會在繼續之前驗證服務器是否可訪問。
2. **登錄**
   - 輸入您 OneUptime 賬戶的電郵和密碼。
   - 可選擇啓用 **Face ID** 或 **Touch ID**,以便在後續啓動時更快地解鎖。
3. **允許通知**
   - 當提示出現時,點按 **允許**,以便應用可以發送隨叫隨到呼叫、事件警報和確認信息。

## 推送通知

推送通知通過 Apple Push Notification 服務 (APNs) 並經由 Expo Push 投遞。爲了確保呼叫可靠地送達:

1. 前往 **設置 → 通知 → OneUptime On-Call**。
2. 啓用 **允許通知**、**聲音**、**徽標** 以及 **鎖定屏幕 / 橫幅 / 通知中心** 投遞。
3. 將 **通知分組** 設置爲 **自動**。
4. 如果您正在值班,請在輪班期間禁用 **低電量模式**,並避免強制退出應用 — 如果強制關閉應用,iOS 可能會延遲後臺投遞。
5. 將 **OneUptime On-Call** 添加到您仍希望接收呼叫的所有 **專注模式** 中。

## 更新

應用通過 App Store 更新:

- 打開 **App Store**,點按您的頭像,滾動至 **OneUptime On-Call**,然後點按 **更新**。
- 或在 **設置 → App Store → App 更新** 中啓用自動安裝更新。

## 卸載

1. 在主屏幕上 **長按** **OneUptime On-Call** 圖標。
2. 點按 **移除 App → 刪除 App**。
3. 點按 **刪除** 進行確認。

您的 OneUptime 賬戶和值班排班儲存在服務器端,卸載應用時不會被刪除。

## 故障排查

**App Store 提示該應用"在您所在的地區不可用":**
- 該應用發佈於全球 App Store。如果在您所在的地區未顯示,請聯繫 [支持](mailto:support@oneuptime.com)。

**登錄時出現"網絡錯誤":**
- 驗證 **服務器 URL** 是否正確,並且可從您的設備訪問。
- 如果您處於企業網絡或 VPN 上,請確保可以訪問該 OneUptime 實例。
- 確認服務器通過 HTTPS 提供服務並使用有效證書。

**未收到推送通知:**
- 打開 **設置 → 通知 → OneUptime On-Call**,確認已允許通知。
- 禁用 **勿擾模式**,或將 OneUptime On-Call 添加到當前激活的專注模式的允許列表中。
- 退出登錄後重新登錄,以刷新已在服務器上註冊的推送令牌。
- 自託管用戶:確認您的 OneUptime 實例已配置推送通知(請參閱自託管 [推送通知](/docs/self-hosted/push-notifications) 指南)。

**Face ID / Touch ID 無法正常工作:**
- 確保已在 **設置 → 面容 ID 與密碼** 或 **設置 → 觸控 ID 與密碼** 中註冊生物識別信息。
- 從 OneUptime On-Call 應用內的 **設置** 屏幕重新啓用生物識別解鎖。

**應用啓動時崩潰:**
- 從 App Store 更新到最新版本。
- 重新啓動您的設備。
- 如果問題仍然存在,請刪除並重新安裝應用,然後重新登錄。

## 支持

如果您仍需幫助,請通過您的 OneUptime 控制面板聯繫我們,或在我們的 [GitHub 倉庫](https://github.com/OneUptime/oneuptime) 上提交 issue。
