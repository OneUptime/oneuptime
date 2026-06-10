# Linux 安裝指南

在 Linux 發行版上將 OneUptime 安裝為桌面應用程式，以進行全面的監控與事件管理。

## 安裝方法

### 方法 1：Google Chrome/Chromium（建議）

Chrome 和 Chromium 提供最佳的 Linux PWA 體驗，並具備原生桌面整合功能。

#### PWA 安裝步驟：
1. **在 Chrome/Chromium 中開啟 OneUptime**
   - 啟動您的瀏覽器
   - 前往您的 OneUptime 執行個體 URL
   - 登入您的 OneUptime 帳戶
   - 等待頁面完整載入

2. **安裝 PWA**
   - 在網址列中尋找 **安裝圖示**（⊞）
   - 點選 **「Install OneUptime」**
   - 或使用 **Chrome 選單**（⋮）→ **More tools** → **Create shortcut**

3. **安裝選項**
   - 勾選 **「Open as window」** 以獲得原生應用程式體驗
   - 如有需要，可自訂應用程式名稱
   - 選擇是否建立桌面捷徑
   - 點選 **「Install」** 或 **「Create」**

4. **啟動應用程式**
   - 在應用程式啟動器中尋找 OneUptime
   - 或使用桌面捷徑
   - 應用程式會在專屬視窗中開啟

### 方法 2：Firefox

Firefox 支援在 Linux 上安裝 PWA，並具備基本的桌面整合功能。

1. **PWA 安裝**：
   - 在 Firefox 中開啟 OneUptime
   - 尋找安裝橫幅或提示
   - 出現時點選 **「Install」**
   - 注意：與 Chrome 相比，桌面整合功能有限

### 方法 3：Microsoft Edge

Edge 已可在 Linux 上使用，並提供良好的 PWA 支援。

1. **安裝 PWA**：請依照與 Chrome 方法相同的步驟操作




## 更新與維護

### 自動更新
OneUptime PWA 會自動更新：
- 當瀏覽器重新整理應用程式時即套用更新
- 重大安全性更新會立即部署
- 無需手動介入


## 解除安裝


### 各瀏覽器專屬的移除方式
```bash
# Chrome PWA management
google-chrome chrome://apps/

# Remove all OneUptime-related browser data
rm -rf ~/.config/google-chrome/Default/Local\ Storage/leveldb/
rm -rf ~/.cache/google-chrome/Default/
```

## 更新與維護

### 自動更新
OneUptime PWA 會自動更新：
- 當瀏覽器重新整理應用程式時即套用更新
- 重大安全性更新會立即部署
- 無需手動介入
