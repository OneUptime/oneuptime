# macOS 安裝指南

在 macOS 上將 OneUptime 安裝為原生桌面應用程式，以實現無縫的監控與事件管理。

## 安裝方式

### 方式 1：Safari（macOS 推薦）

Safari 提供出色的 PWA 整合，並支援原生 macOS 功能。

1. **在 Safari 中開啟 OneUptime**

   - 啟動 Safari 瀏覽器
   - 前往您的 OneUptime 執行個體 URL
   - 登入您的 OneUptime 帳戶
   - 等待頁面完全載入

2. **安裝 PWA**

   - 點選功能表列中的 **File**
   - 選擇 **"Add to Dock"**（macOS Sonoma 以上版本）
   - 或在網址列中尋找 **安裝圖示**
   - 或者：**File** → **"Add to Home Screen"**（較舊版本的 macOS）

3. **自訂安裝**

   - **應用程式名稱**：如有需要可修改（預設為 OneUptime）
   - **Dock**：選擇加入 Dock
   - **Launchpad**：加入 Launchpad 以便輕鬆存取

4. **啟動應用程式**
   - 在 Dock、Launchpad 或「應用程式」資料夾中找到 OneUptime
   - 點選以在專屬視窗中啟動
   - 應用程式獨立於 Safari 瀏覽器運行

### 方式 2：Google Chrome

Chrome 提供強大的 PWA 支援，並擁有出色的桌面整合。

1. **在 Chrome 中開啟 OneUptime**

   - 啟動 Google Chrome
   - 前往您的 OneUptime 執行個體
   - 確認您已登入
   - 允許頁面完整載入

2. **透過功能表安裝**

   - 在網址列中尋找 **安裝圖示**（⊞）
   - 點選 **"Install OneUptime"**
   - 或使用 **Chrome 功能表** → **More tools** → **Create shortcut**

3. **安裝選項**

   - 勾選 **"Open as window"** 以獲得原生應用程式體驗
   - 如有需要可自訂應用程式名稱
   - 點選 **"Install"** 或 **"Create"**

4. **存取應用程式**
   - 在「應用程式」資料夾中找到 OneUptime
   - 或透過 Spotlight 搜尋存取
   - 釘選至 Dock 以便快速存取

### 方式 3：Microsoft Edge

Edge 提供穩固的 PWA 支援，並具備良好的 macOS 整合。

1. **在 Edge 中開啟 OneUptime**

   - 啟動 Microsoft Edge
   - 前往 OneUptime URL
   - 完成登入流程

2. **安裝應用程式**
   - 點選 **三點功能表** → **Apps** → **Install this site as an app**
   - 或在網址列中尋找安裝提示
   - 如有需要可自訂應用程式名稱
   - 點選 **"Install"**

### 自訂選項

### Dock 與 Launchpad

1. **Dock 位置**：將 OneUptime 拖曳至偏好的 Dock 位置
2. **Dock 大小**：在 Dock 偏好設定中調整圖示大小
3. **Launchpad 組織**：建立監控應用程式資料夾
4. **標記通知**：在 Dock 圖示上顯示事件數量

### 功能表列與通知

1. **通知中心**

   - 系統偏好設定 → 通知 → OneUptime
   - 設定提醒樣式與傳遞方式
   - 為不同的事件類型設定優先順序層級

2. **功能表列整合**
   - Safari PWA 的原生功能表列
   - 為常用操作自訂功能表項目
   - 為常見任務設定鍵盤快捷鍵

## 疑難排解

### 安裝問題

**Safari 中無法使用 "Add to Dock"：**

```
Solutions:
1. Ensure macOS Sonoma (14.0) or later
2. Update Safari to latest version
3. Try alternative: File → Add to Home Screen
4. Clear Safari cache and try again
5. Use Chrome or Edge as alternative
```

**PWA 無法安裝或當機：**

```
Solutions:
1. Check macOS version compatibility
2. Ensure sufficient disk space (100MB+)
3. Update browser to latest version
4. Clear browser cache and cookies
5. Temporarily disable browser extensions
6. Restart Mac and try installation again
```

**應用程式未出現在「應用程式」中：**

```
Solutions:
1. Check Launchpad for OneUptime icon
2. Search with Spotlight (⌘+Space)
3. Look in browser's PWA management section
4. Try reinstalling with different browser
5. Check if installed under different name
```

### 通知問題

**macOS 通知無法運作：**

```
Solutions:
1. System Preferences → Notifications → OneUptime
2. Enable "Allow notifications"
3. Set appropriate alert style (banners/alerts)
4. Check Do Not Disturb settings
5. Verify OneUptime notification settings
6. Grant notification permissions when prompted
```

## 解除安裝

### 完整移除

1. **「應用程式」資料夾方式**

   - 開啟「應用程式」資料夾
   - 找到 OneUptime
   - 拖曳至「垃圾桶」，或按右鍵 → 移到垃圾桶

2. **Dock 方式**

   - 在 Dock 中對 OneUptime 按右鍵
   - 選擇「選項」→「從 Dock 中移除」
   - 然後從「應用程式」資料夾中刪除

3. **瀏覽器 PWA 管理**
   - **Chrome**：chrome://apps/ → 找到 OneUptime → 移除
   - **Edge**：edge://apps/ → 找到 OneUptime → 解除安裝
   - **Safari**：沒有專屬的管理頁面

## 更新與維護

### 自動更新

- OneUptime PWA 在連線時會自動更新
- 無需透過 App Store 更新
- 新功能立即可用
- 重要更新即時套用

## 疑難排解

### 安裝問題

**Safari 中無法使用 "Add to Dock"：**

```
Solutions:
1. Ensure macOS Sonoma (14.0) or later
2. Update Safari to latest version
3. Try alternative: File → Add to Home Screen
4. Clear Safari cache and try again
5. Use Chrome or Edge as alternative
```

**PWA 無法安裝或當機：**

```
Solutions:
1. Check macOS version compatibility
2. Ensure sufficient disk space (100MB+)
3. Update browser to latest version
4. Clear browser cache and cookies
5. Temporarily disable browser extensions
6. Restart Mac and try installation again
```

**應用程式未出現在「應用程式」中：**

```
Solutions:
1. Check Launchpad for OneUptime icon
2. Search with Spotlight (⌘+Space)
3. Look in browser's PWA management section
4. Try reinstalling with different browser
5. Check if installed under different name
```

### 效能問題

**效能緩慢或 CPU 使用率過高：**

```
Solutions:
1. Check Activity Monitor for resource usage
2. Close unnecessary applications
3. Ensure adequate RAM (8GB+ recommended)
4. Update macOS and browser
5. Clear browser cache and app data
6. Restart OneUptime app
```

**記憶體洩漏或當機：**

```
Solutions:
1. Monitor memory usage in Activity Monitor
2. Restart OneUptime app regularly
3. Update to latest browser version
4. Clear browser cache completely
5. Check Console app for error logs
6. Report issues with crash logs
```

### 顯示與視窗問題

**視窗大小或位置問題：**

```
Solutions:
1. Manually resize and reposition window
2. Use Window menu → Zoom (Safari PWAs)
3. Reset window state by quitting and reopening
4. Check display scaling in System Preferences
5. Try different desktop space or full-screen mode
```

**應用程式無回應：**

```
Solutions:
1. Force quit: ⌘+Option+Esc → Select OneUptime
2. Or right-click Dock icon → Force Quit
3. Restart the application
4. Check for macOS and browser updates
5. Clear app cache and reinstall if necessary
```

### 通知問題

**macOS 通知無法運作：**

```
Solutions:
1. System Preferences → Notifications → OneUptime
2. Enable "Allow notifications"
3. Set appropriate alert style (banners/alerts)
4. Check Do Not Disturb settings
5. Verify OneUptime notification settings
6. Grant notification permissions when prompted
```

## 解除安裝

### 完整移除

1. **「應用程式」資料夾方式**

   - 開啟「應用程式」資料夾
   - 找到 OneUptime
   - 拖曳至「垃圾桶」，或按右鍵 → 移到垃圾桶

2. **Dock 方式**

   - 在 Dock 中對 OneUptime 按右鍵
   - 選擇「選項」→「從 Dock 中移除」
   - 然後從「應用程式」資料夾中刪除

3. **瀏覽器 PWA 管理**
   - **Chrome**：chrome://apps/ → 找到 OneUptime → 移除
   - **Edge**：edge://apps/ → 找到 OneUptime → 解除安裝
   - **Safari**：沒有專屬的管理頁面

### 徹底解除安裝

移除所有相關資料：

```bash
# Clear Safari PWA data (general website data)
rm -rf ~/Library/Safari/Databases
rm -rf ~/Library/Caches/com.apple.Safari

# Clear Chrome PWA data
rm -rf ~/Library/Application\ Support/Google/Chrome/Default/Web\ Applications

# Clear Edge PWA data
rm -rf ~/Library/Application\ Support/Microsoft\ Edge/Default/Web\ Applications
```

## 更新與維護

### 自動更新

- OneUptime PWA 在連線時會自動更新
- 無需透過 App Store 更新
- 新功能立即可用
- 重要更新即時套用

### 手動更新流程

強制更新應用程式：

1. **Safari PWA**：在 Safari 瀏覽器中重新整理
2. **Chrome PWA**：對應用程式按右鍵 → 重新載入，或按 ⌘+R
3. **完整重新整理**：關閉應用程式、重新開啟瀏覽器、前往 OneUptime

### 維護排程

定期維護以達到最佳效能：

**每週：**

- 重新啟動 OneUptime 應用程式
- 若遇到問題，清除瀏覽器快取
- 檢查 macOS 更新

**每月：**

- 檢視儲存空間使用情況，必要時進行清理
- 若未自動更新，請更新瀏覽器
- 確認通知設定仍正常運作

## 與 macOS 功能整合

### Shortcuts App 整合

為 OneUptime 建立自訂捷徑：

1. 開啟 **Shortcuts** 應用程式
2. 建立 **New Shortcut**
3. 加入 **"Open App"** 動作
4. 選擇 **OneUptime**
5. 加入 Siri 以進行語音啟動

### Automator 整合

自動化 OneUptime 任務：

1. 啟動 **Automator**
2. 建立 **Application** 或 **Workflow**
3. 加入 **"Launch Application"** 動作
4. 選擇 OneUptime PWA
5. 加入額外的自動化步驟

### Terminal 整合

透過 Terminal 管理 OneUptime：

```bash
# Create alias for quick OneUptime launch
echo 'alias oneuptime="open -a \"OneUptime\""' >> ~/.zshrc

# Function to check if OneUptime is running
oneuptime_status() {
    if pgrep -f "OneUptime" > /dev/null; then
        echo "OneUptime is running"
    else
        echo "OneUptime is not running"
    fi
}
```

## 安全性與隱私

### macOS 安全功能

1. **Gatekeeper**：確保 PWA 安裝來自可信任的來源
2. **系統完整性保護**：保護系統檔案
3. **FileVault**：加密磁碟以保護資料
4. **Keychain**：安全儲存憑證

### 隱私考量

1. **定位服務**：如監控所需，請進行設定
2. **相機/麥克風**：依需求授予權限
3. **螢幕錄製**：某些監控功能可能需要
4. **網路存取**：確保防火牆設定正確

### 最佳實務

1. **定期更新**：保持 macOS 與瀏覽器為最新版本
2. **強式驗證**：可用時請使用 Touch ID/Face ID
3. **網路安全**：使用 VPN 進行遠端監控存取
4. **資料備份**：定期的 Time Machine 備份會包含 PWA 資料
5. **權限檢視**：定期檢視已授予的權限
