# Linux 安装指南

在 Linux 发行版上将 OneUptime 安装为桌面应用程序，实现全面的监控和事件管理。

## 安装方法

### 方法一：Google Chrome/Chromium（推荐）

Chrome 和 Chromium 提供最佳的 Linux PWA 体验，具有原生桌面集成。

#### PWA 安装步骤：
1. **在 Chrome/Chromium 中打开 OneUptime**
   - 启动您的浏览器
   - 导航至您的 OneUptime 实例 URL
   - 登录您的 OneUptime 账号
   - 等待页面完全加载

2. **安装 PWA**
   - 查找地址栏中的 **安装图标**（⊞）
   - 点击 **"安装 OneUptime"**
   - 或使用 **Chrome 菜单**（⋮）→ **更多工具** → **创建快捷方式**

3. **安装选项**
   - 勾选 **"作为窗口打开"** 以获得原生应用体验
   - 根据需要自定义应用名称
   - 选择是否创建桌面快捷方式
   - 点击 **"安装"** 或 **"创建"**

4. **启动应用**
   - 在应用启动器中找到 OneUptime
   - 或使用桌面快捷方式
   - 应用在专用窗口中打开

### 方法二：Firefox

Firefox 支持在 Linux 上安装 PWA，具有基本的桌面集成。

1. **PWA 安装**：
   - 在 Firefox 中打开 OneUptime
   - 查找安装横幅或提示
   - 点击 **"安装"**（如果可用）
   - 注意：与 Chrome 相比，桌面集成有限

### 方法三：Microsoft Edge

Edge 在 Linux 上可用，并提供良好的 PWA 支持。

1. **安装 PWA**：按照与 Chrome 方法相同的步骤操作




## 更新和维护

### 自动更新
OneUptime PWA 自动更新：
- 浏览器刷新应用时应用更新
- 紧急安全更新立即部署
- 无需手动干预


## 卸载


### 特定浏览器的移除
```bash
# Chrome PWA 管理
google-chrome chrome://apps/

# 移除所有 OneUptime 相关浏览器数据
rm -rf ~/.config/google-chrome/Default/Local\ Storage/leveldb/
rm -rf ~/.cache/google-chrome/Default/
```

## 更新和维护

### 自动更新
OneUptime PWA 自动更新：
- 浏览器刷新应用时应用更新
- 紧急安全更新立即部署
- 无需手动干预
