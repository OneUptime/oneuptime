# macOS 安裝指南

在 macOS 上將 OneUptime 安裝爲原生桌面應用程序，實現無縫監控和事件管理。

## 安裝方法

### 方法一：Safari（macOS 推薦）

Safari 與 macOS 原生功能具有出色的 PWA 集成。

1. **在 Safari 中打開 OneUptime**
   - 啓動 Safari 瀏覽器
   - 導航至您的 OneUptime 實例 URL
   - 登錄您的 OneUptime 賬號
   - 等待頁面完全加載

2. **安裝 PWA**
   - 點擊菜單欄中的 **文件**
   - 選擇 **"添加到 Dock"**（macOS Sonoma 及以上版本）
   - 或在地址欄查找 **安裝圖標**
   - 或者：**文件** → **"添加到主屏幕"**（較舊的 macOS 版本）

3. **自定義安裝**
   - **應用名稱**：根據需要修改（默認：OneUptime）
   - **Dock**：選擇是否添加到 Dock
   - **Launchpad**：添加到 Launchpad 以便快速訪問

4. **啓動應用**
   - 在 Dock、Launchpad 或應用程序文件夾中找到 OneUptime
   - 點擊以在專用窗口中啓動
   - 應用獨立於 Safari 瀏覽器運行

### 方法二：Google Chrome

Chrome 提供強大的 PWA 支持，具有出色的桌面集成。

1. **在 Chrome 中打開 OneUptime**
   - 啓動 Google Chrome
   - 前往您的 OneUptime 實例
   - 確保已登錄
   - 允許頁面完全加載

2. **通過菜單安裝**
   - 查找地址欄中的 **安裝圖標**（⊞）
   - 點擊 **"安裝 OneUptime"**
   - 或使用 **Chrome 菜單** → **更多工具** → **創建快捷方式**

3. **安裝選項**
   - 勾選 **"作爲窗口打開"** 以獲得原生應用體驗
   - 根據需要自定義應用名稱
   - 點擊 **"安裝"** 或 **"創建"**

4. **訪問應用**
   - 在應用程序文件夾中找到 OneUptime
   - 或通過 Spotlight 搜索訪問
   - 將其固定到 Dock 以便快速訪問

### 方法三：Microsoft Edge

Edge 提供良好的 PWA 支持，具有不錯的 macOS 集成。

1. **在 Edge 中打開 OneUptime**
   - 啓動 Microsoft Edge
   - 導航至 OneUptime URL
   - 完成登錄流程

2. **安裝應用**
   - 點擊 **三點菜單** → **應用** → **將此站點安裝爲應用**
   - 或在地址欄查找安裝提示
   - 根據需要自定義應用名稱
   - 點擊 **"安裝"**

### 自定義選項

### Dock 和 Launchpad
1. **Dock 位置**：將 OneUptime 拖到首選 Dock 位置
2. **Dock 大小**：在 Dock 偏好設置中調整圖標大小
3. **Launchpad 整理**：創建監控應用文件夾
4. **角標通知**：在 Dock 圖標上顯示事件數量

### 菜單欄和通知
1. **通知中心**
   - 系統偏好設置 → 通知 → OneUptime
   - 配置警報樣式和傳送方式
   - 爲不同事件類型設置優先級

2. **菜單欄集成**
   - Safari PWA 的原生菜單欄
   - 常用操作的自定義菜單項
   - 常見任務的鍵盤快捷鍵

## 故障排查

### 安裝問題

**Safari 中"添加到 Dock"不可用：**
```
解決方案：
1. 確保 macOS Sonoma（14.0）或更高版本
2. 將 Safari 更新到最新版本
3. 嘗試替代方案：文件 → 添加到主屏幕
4. 清除 Safari 緩存後重試
5. 使用 Chrome 或 Edge 作爲替代
```

**PWA 無法安裝或崩潰：**
```
解決方案：
1. 檢查 macOS 版本兼容性
2. 確保足夠的磁盤空間（100MB 以上）
3. 將瀏覽器更新到最新版本
4. 清除瀏覽器緩存和 Cookie
5. 臨時禁用瀏覽器擴展
6. 重啓 Mac 後重試安裝
```

**應用未出現在應用程序中：**
```
解決方案：
1. 在 Launchpad 中查找 OneUptime 圖標
2. 使用 Spotlight 搜索（⌘+空格）
3. 在瀏覽器的 PWA 管理部分查找
4. 嘗試使用不同瀏覽器重新安裝
5. 檢查是否以不同名稱安裝
```

### 通知問題

**macOS 通知不工作：**
```
解決方案：
1. 系統偏好設置 → 通知 → OneUptime
2. 啓用"允許通知"
3. 設置適當的警報樣式（橫幅/提醒）
4. 檢查勿擾模式設置
5. 驗證 OneUptime 通知設置
6. 出現提示時授予通知權限
```

## 卸載

### 完全移除
1. **應用程序文件夾方法**
   - 打開應用程序文件夾
   - 找到 OneUptime
   - 拖到廢紙簍或右鍵單擊 → 移到廢紙簍

2. **Dock 方法**
   - 右鍵單擊 Dock 中的 OneUptime
   - 選擇"選項" → "從 Dock 中移除"
   - 然後從應用程序文件夾中刪除

3. **瀏覽器 PWA 管理**
   - **Chrome**：chrome://apps/ → 找到 OneUptime → 移除
   - **Edge**：edge://apps/ → 找到 OneUptime → 卸載
   - **Safari**：沒有專用管理頁面

## 更新和維護

### 自動更新
- OneUptime PWA 在在線狀態下自動更新
- 無需 App Store 更新
- 新功能立即可用
- 緊急更新即時應用

## 故障排查

### 安裝問題

**Safari 中"添加到 Dock"不可用：**
```
解決方案：
1. 確保 macOS Sonoma（14.0）或更高版本
2. 將 Safari 更新到最新版本
3. 嘗試替代方案：文件 → 添加到主屏幕
4. 清除 Safari 緩存後重試
5. 使用 Chrome 或 Edge 作爲替代
```

**PWA 無法安裝或崩潰：**
```
解決方案：
1. 檢查 macOS 版本兼容性
2. 確保足夠的磁盤空間（100MB 以上）
3. 將瀏覽器更新到最新版本
4. 清除瀏覽器緩存和 Cookie
5. 臨時禁用瀏覽器擴展
6. 重啓 Mac 後重試安裝
```

**應用未出現在應用程序中：**
```
解決方案：
1. 在 Launchpad 中查找 OneUptime 圖標
2. 使用 Spotlight 搜索（⌘+空格）
3. 在瀏覽器的 PWA 管理部分查找
4. 嘗試使用不同瀏覽器重新安裝
5. 檢查是否以不同名稱安裝
```

### 性能問題

**性能緩慢或 CPU 使用率高：**
```
解決方案：
1. 在活動監視器中檢查資源使用情況
2. 關閉不必要的應用程序
3. 確保足夠的內存（建議 8GB 以上）
4. 更新 macOS 和瀏覽器
5. 清除瀏覽器緩存和應用數據
6. 重啓 OneUptime 應用
```

**內存泄漏或崩潰：**
```
解決方案：
1. 在活動監視器中監控內存使用情況
2. 定期重啓 OneUptime 應用
3. 更新到最新瀏覽器版本
4. 完全清除瀏覽器緩存
5. 在控制台應用中查看錯誤日誌
6. 附帶崩潰日誌報告問題
```

### 顯示和窗口問題

**窗口大小或位置問題：**
```
解決方案：
1. 手動調整大小和重新定位窗口
2. 使用 窗口 菜單 → 縮放（Safari PWA）
3. 退出並重新打開來重置窗口狀態
4. 檢查系統偏好設置中的顯示縮放
5. 嘗試不同的桌面空間或全屏模式
```

**應用無響應：**
```
解決方案：
1. 強制退出：⌘+Option+Esc → 選擇 OneUptime
2. 或右鍵單擊 Dock 圖標 → 強制退出
3. 重啓應用程序
4. 檢查 macOS 和瀏覽器更新
5. 清除應用緩存，如有必要重新安裝
```

### 通知問題

**macOS 通知不工作：**
```
解決方案：
1. 系統偏好設置 → 通知 → OneUptime
2. 啓用"允許通知"
3. 設置適當的警報樣式（橫幅/提醒）
4. 檢查勿擾模式設置
5. 驗證 OneUptime 通知設置
6. 出現提示時授予通知權限
```

## 卸載

### 完全移除
1. **應用程序文件夾方法**
   - 打開應用程序文件夾
   - 找到 OneUptime
   - 拖到廢紙簍或右鍵單擊 → 移到廢紙簍

2. **Dock 方法**
   - 右鍵單擊 Dock 中的 OneUptime
   - 選擇"選項" → "從 Dock 中移除"
   - 然後從應用程序文件夾中刪除

3. **瀏覽器 PWA 管理**
   - **Chrome**：chrome://apps/ → 找到 OneUptime → 移除
   - **Edge**：edge://apps/ → 找到 OneUptime → 卸載
   - **Safari**：沒有專用管理頁面

### 完全清除安裝
移除所有關聯數據：

```bash
# 清除 Safari PWA 數據（通用網站數據）
rm -rf ~/Library/Safari/Databases
rm -rf ~/Library/Caches/com.apple.Safari

# 清除 Chrome PWA 數據
rm -rf ~/Library/Application\ Support/Google/Chrome/Default/Web\ Applications

# 清除 Edge PWA 數據
rm -rf ~/Library/Application\ Support/Microsoft\ Edge/Default/Web\ Applications
```

## 更新和維護

### 自動更新
- OneUptime PWA 在在線狀態下自動更新
- 無需 App Store 更新
- 新功能立即可用
- 緊急更新即時應用

### 手動更新流程
強制更新應用程序：
1. **Safari PWA**：在 Safari 瀏覽器中刷新
2. **Chrome PWA**：右鍵單擊應用 → 重新加載，或按 ⌘+R
3. **完全刷新**：關閉應用，重新打開瀏覽器，訪問 OneUptime

### 維護計劃
定期維護以獲得最佳性能：

**每週：**
- 重啓 OneUptime 應用
- 如遇到問題，清除瀏覽器緩存
- 檢查 macOS 更新

**每月：**
- 檢查儲存使用情況，必要時清理
- 如未自動更新，請更新瀏覽器
- 驗證通知設置是否正常工作

## 與 macOS 功能集成

### 快捷指令應用集成
爲 OneUptime 創建自定義快捷指令：
1. 打開 **快捷指令** 應用
2. 創建 **新快捷指令**
3. 添加 **"打開應用"** 操作
4. 選擇 **OneUptime**
5. 添加到 Siri 以實現語音激活

### Automator 集成
自動化 OneUptime 任務：
1. 啓動 **Automator**
2. 創建 **應用程序** 或 **工作流程**
3. 添加 **"啓動應用程序"** 操作
4. 選擇 OneUptime PWA
5. 添加其他自動化步驟

### 終端集成
通過終端管理 OneUptime：

```bash
# 爲快速啓動 OneUptime 創建別名
echo 'alias oneuptime="open -a \"OneUptime\""' >> ~/.zshrc

# 檢查 OneUptime 是否正在運行的函數
oneuptime_status() {
    if pgrep -f "OneUptime" > /dev/null; then
        echo "OneUptime is running"
    else
        echo "OneUptime is not running"
    fi
}
```

## 安全和隱私

### macOS 安全功能
1. **Gatekeeper**：確保 PWA 安裝來自可信來源
2. **系統完整性保護**：保護系統文件
3. **FileVault**：加密磁盤以保護數據
4. **鑰匙串**：安全的憑據儲存

### 隱私注意事項
1. **定位服務**：按需配置監控
2. **相機/麥克風**：按需授予權限
3. **屏幕錄製**：某些監控功能可能需要
4. **網絡訪問**：確保正確的防火牆配置

### 最佳實踐
1. **定期更新**：保持 macOS 和瀏覽器爲最新版本
2. **強認證**：使用 Touch ID/Face ID（如可用）
3. **網絡安全**：使用 VPN 進行遠程監控訪問
4. **數據備份**：定期進行 Time Machine 備份（包含 PWA 數據）
5. **權限審查**：定期審查已授予的權限
