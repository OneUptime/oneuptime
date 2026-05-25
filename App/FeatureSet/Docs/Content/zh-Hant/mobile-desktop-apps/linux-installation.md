# Linux 安裝指南

在 Linux 發行版上將 OneUptime 安裝爲桌面應用程序，實現全面的監控和事件管理。

## 安裝方法

### 方法一：Google Chrome/Chromium（推薦）

Chrome 和 Chromium 提供最佳的 Linux PWA 體驗，具有原生桌面集成。

#### PWA 安裝步驟：
1. **在 Chrome/Chromium 中打開 OneUptime**
   - 啓動您的瀏覽器
   - 導航至您的 OneUptime 實例 URL
   - 登錄您的 OneUptime 賬號
   - 等待頁面完全加載

2. **安裝 PWA**
   - 查找地址欄中的 **安裝圖標**（⊞）
   - 點擊 **"安裝 OneUptime"**
   - 或使用 **Chrome 菜單**（⋮）→ **更多工具** → **創建快捷方式**

3. **安裝選項**
   - 勾選 **"作爲窗口打開"** 以獲得原生應用體驗
   - 根據需要自定義應用名稱
   - 選擇是否創建桌面快捷方式
   - 點擊 **"安裝"** 或 **"創建"**

4. **啓動應用**
   - 在應用啓動器中找到 OneUptime
   - 或使用桌面快捷方式
   - 應用在專用窗口中打開

### 方法二：Firefox

Firefox 支持在 Linux 上安裝 PWA，具有基本的桌面集成。

1. **PWA 安裝**：
   - 在 Firefox 中打開 OneUptime
   - 查找安裝橫幅或提示
   - 點擊 **"安裝"**（如果可用）
   - 注意：與 Chrome 相比，桌面集成有限

### 方法三：Microsoft Edge

Edge 在 Linux 上可用，並提供良好的 PWA 支持。

1. **安裝 PWA**：按照與 Chrome 方法相同的步驟操作




## 更新和維護

### 自動更新
OneUptime PWA 自動更新：
- 瀏覽器刷新應用時應用更新
- 緊急安全更新立即部署
- 無需手動干預


## 卸載


### 特定瀏覽器的移除
```bash
# Chrome PWA 管理
google-chrome chrome://apps/

# 移除所有 OneUptime 相關瀏覽器數據
rm -rf ~/.config/google-chrome/Default/Local\ Storage/leveldb/
rm -rf ~/.cache/google-chrome/Default/
```

## 更新和維護

### 自動更新
OneUptime PWA 自動更新：
- 瀏覽器刷新應用時應用更新
- 緊急安全更新立即部署
- 無需手動干預
