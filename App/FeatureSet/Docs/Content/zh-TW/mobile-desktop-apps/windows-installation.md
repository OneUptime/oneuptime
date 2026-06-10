# Windows 安裝指南

在 Windows 上將 OneUptime 安裝為桌面應用程式，以進行全面的監控與事件管理。


## 安裝方式

### 方式 1：Microsoft Edge（建議）

Edge 提供最佳的 Windows PWA 整合，具備原生功能。

1. **在 Edge 中開啟 OneUptime**
   - 啟動 Microsoft Edge 瀏覽器
   - 前往您的 OneUptime 執行個體 URL
   - 登入您的 OneUptime 帳戶
   - 等待頁面完整載入

2. **安裝應用程式**
   - 在網址列中尋找**安裝圖示**（⊞）
   - 點擊 **"Install OneUptime"** 按鈕
   - 或點擊**三點選單** → **Apps** → **Install this site as an app**

3. **自訂安裝**
   - **應用程式名稱**：可依需求修改（預設值：OneUptime）
   - **開始功能表**：選擇是否加入開始功能表
   - **工作列**：可選擇釘選到工作列
   - **桌面**：建立桌面捷徑

4. **完成安裝**
   - 點擊 **"Install"** 以完成
   - OneUptime 將會在自己的視窗中開啟
   - 在開始功能表的已安裝應用程式中找到它

### 方式 2：Google Chrome

Chrome 提供出色的 PWA 支援，並具備豐富的桌面整合。

1. **在 Chrome 中開啟 OneUptime**
   - 啟動 Google Chrome
   - 前往您的 OneUptime 執行個體
   - 確認您已登入
   - 允許頁面完整載入

2. **透過網址列安裝**
   - 在網址列中尋找**安裝圖示**（⊞）
   - 點擊 **"Install OneUptime"**
   - 或使用選單：**三點** → **More tools** → **Create shortcut**

3. **安裝選項**
   - 勾選 **"Open as window"** 以獲得類似應用程式的體驗
   - 可依需求自訂應用程式名稱
   - 點擊 **"Install"** 或 **"Create"**

4. **啟動應用程式**
   - 在 Windows 開始功能表中找到 OneUptime
   - 或從桌面捷徑啟動
   - 應用程式會在專屬視窗中開啟

### 方式 3：Firefox

Firefox 支援 PWA 安裝，並具備基本的桌面整合。

1. **在 Firefox 中開啟 OneUptime**
   - 啟動 Firefox 瀏覽器
   - 前往 OneUptime URL
   - 完成登入程序

2. **安裝 PWA**
   - 尋找**安裝提示**或橫幅
   - 或點擊**選單** → **Install**
   - 若有提供，請點擊相當於 **"Add to Home Screen"** 的選項


### 啟動設定
1. **自動啟動**：設定 OneUptime 隨 Windows 一起啟動
   - 在工作列上按右鍵 → 工作管理員 → 啟動
   - 如有需要，啟用 OneUptime
2. **預設大小**：設定偏好的視窗大小與位置

### 通知設定
1. **Windows 通知**
   - 設定 → 系統 → 通知與動作
   - 找到 OneUptime 並設定警示偏好
   - 啟用事件的橫幅通知

2. **專注輔助**
   - 設定「請勿打擾」設定
   - 允許 OneUptime 的重要通知
   - 為不同的警示類型設定優先順序

## 進階安裝選項


## 疑難排解

### 安裝問題

**未顯示安裝按鈕：**
```
Solutions:
1. Ensure you're using Edge or Chrome (recommended browsers)
2. Verify HTTPS connection to OneUptime instance
3. Clear browser cache and cookies
4. Update browser to latest version
5. Check if PWA requirements are met on server
6. Disable browser extensions temporarily
```

**安裝失敗或當機：**
```
Solutions:
1. Run browser as administrator
2. Check Windows User Account Control (UAC) settings
3. Ensure sufficient disk space (minimum 100MB)
4. Temporarily disable antivirus software
5. Clear browser data completely
6. Restart Windows and try again
```

**應用程式未出現在開始功能表中：**
```
Solutions:
1. Search for "OneUptime" in Windows search
2. Check if installed under different name
3. Look in "Recently added" apps section
4. Reinstall and ensure "Add to Start Menu" is checked
5. Manually create shortcut if necessary
```

### 通知問題

**Windows 通知無法運作：**
```
Solutions:
1. Windows Settings → System → Notifications & actions
2. Enable notifications for OneUptime
3. Check Focus Assist settings
4. Ensure notification permissions in OneUptime
5. Test with simple notification first
```

## 解除安裝

### 完整移除
1. **Windows 設定方式**
   - 設定 → 應用程式 → 應用程式與功能
   - 搜尋 "OneUptime"
   - 點擊並選擇「解除安裝」

2. **瀏覽器方式**
   - 開啟 Edge/Chrome
   - 前往 edge://apps/ 或 chrome://apps/
   - 找到 OneUptime
   - 點擊選項 → 解除安裝

3. **開始功能表方式**
   - 在開始功能表中於 OneUptime 上按右鍵
   - 選擇「解除安裝」
   - 確認移除


## 更新與維護

### 自動更新
- OneUptime PWA 在連線時會自動更新
- 無需手動介入
- 更新會在重新啟動後立即套用
- 重要修補程式會即時部署
