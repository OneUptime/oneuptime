# macOS 安装指南

在 macOS 上将 OneUptime 安装为原生桌面应用程序，实现无缝监控和事件管理。

## 安装方法

### 方法一：Safari（macOS 推荐）

Safari 与 macOS 原生功能具有出色的 PWA 集成。

1. **在 Safari 中打开 OneUptime**
   - 启动 Safari 浏览器
   - 导航至您的 OneUptime 实例 URL
   - 登录您的 OneUptime 账号
   - 等待页面完全加载

2. **安装 PWA**
   - 点击菜单栏中的 **文件**
   - 选择 **"添加到 Dock"**（macOS Sonoma 及以上版本）
   - 或在地址栏查找 **安装图标**
   - 或者：**文件** → **"添加到主屏幕"**（较旧的 macOS 版本）

3. **自定义安装**
   - **应用名称**：根据需要修改（默认：OneUptime）
   - **Dock**：选择是否添加到 Dock
   - **Launchpad**：添加到 Launchpad 以便快速访问

4. **启动应用**
   - 在 Dock、Launchpad 或应用程序文件夹中找到 OneUptime
   - 点击以在专用窗口中启动
   - 应用独立于 Safari 浏览器运行

### 方法二：Google Chrome

Chrome 提供强大的 PWA 支持，具有出色的桌面集成。

1. **在 Chrome 中打开 OneUptime**
   - 启动 Google Chrome
   - 前往您的 OneUptime 实例
   - 确保已登录
   - 允许页面完全加载

2. **通过菜单安装**
   - 查找地址栏中的 **安装图标**（⊞）
   - 点击 **"安装 OneUptime"**
   - 或使用 **Chrome 菜单** → **更多工具** → **创建快捷方式**

3. **安装选项**
   - 勾选 **"作为窗口打开"** 以获得原生应用体验
   - 根据需要自定义应用名称
   - 点击 **"安装"** 或 **"创建"**

4. **访问应用**
   - 在应用程序文件夹中找到 OneUptime
   - 或通过 Spotlight 搜索访问
   - 将其固定到 Dock 以便快速访问

### 方法三：Microsoft Edge

Edge 提供良好的 PWA 支持，具有不错的 macOS 集成。

1. **在 Edge 中打开 OneUptime**
   - 启动 Microsoft Edge
   - 导航至 OneUptime URL
   - 完成登录流程

2. **安装应用**
   - 点击 **三点菜单** → **应用** → **将此站点安装为应用**
   - 或在地址栏查找安装提示
   - 根据需要自定义应用名称
   - 点击 **"安装"**

### 自定义选项

### Dock 和 Launchpad
1. **Dock 位置**：将 OneUptime 拖到首选 Dock 位置
2. **Dock 大小**：在 Dock 偏好设置中调整图标大小
3. **Launchpad 整理**：创建监控应用文件夹
4. **角标通知**：在 Dock 图标上显示事件数量

### 菜单栏和通知
1. **通知中心**
   - 系统偏好设置 → 通知 → OneUptime
   - 配置告警样式和传送方式
   - 为不同事件类型设置优先级

2. **菜单栏集成**
   - Safari PWA 的原生菜单栏
   - 常用操作的自定义菜单项
   - 常见任务的键盘快捷键

## 故障排查

### 安装问题

**Safari 中"添加到 Dock"不可用：**
```
解决方案：
1. 确保 macOS Sonoma（14.0）或更高版本
2. 将 Safari 更新到最新版本
3. 尝试替代方案：文件 → 添加到主屏幕
4. 清除 Safari 缓存后重试
5. 使用 Chrome 或 Edge 作为替代
```

**PWA 无法安装或崩溃：**
```
解决方案：
1. 检查 macOS 版本兼容性
2. 确保足够的磁盘空间（100MB 以上）
3. 将浏览器更新到最新版本
4. 清除浏览器缓存和 Cookie
5. 临时禁用浏览器扩展
6. 重启 Mac 后重试安装
```

**应用未出现在应用程序中：**
```
解决方案：
1. 在 Launchpad 中查找 OneUptime 图标
2. 使用 Spotlight 搜索（⌘+空格）
3. 在浏览器的 PWA 管理部分查找
4. 尝试使用不同浏览器重新安装
5. 检查是否以不同名称安装
```

### 通知问题

**macOS 通知不工作：**
```
解决方案：
1. 系统偏好设置 → 通知 → OneUptime
2. 启用"允许通知"
3. 设置适当的告警样式（横幅/提醒）
4. 检查勿扰模式设置
5. 验证 OneUptime 通知设置
6. 出现提示时授予通知权限
```

## 卸载

### 完全移除
1. **应用程序文件夹方法**
   - 打开应用程序文件夹
   - 找到 OneUptime
   - 拖到废纸篓或右键单击 → 移到废纸篓

2. **Dock 方法**
   - 右键单击 Dock 中的 OneUptime
   - 选择"选项" → "从 Dock 中移除"
   - 然后从应用程序文件夹中删除

3. **浏览器 PWA 管理**
   - **Chrome**：chrome://apps/ → 找到 OneUptime → 移除
   - **Edge**：edge://apps/ → 找到 OneUptime → 卸载
   - **Safari**：没有专用管理页面

## 更新和维护

### 自动更新
- OneUptime PWA 在在线状态下自动更新
- 无需 App Store 更新
- 新功能立即可用
- 紧急更新即时应用

## 故障排查

### 安装问题

**Safari 中"添加到 Dock"不可用：**
```
解决方案：
1. 确保 macOS Sonoma（14.0）或更高版本
2. 将 Safari 更新到最新版本
3. 尝试替代方案：文件 → 添加到主屏幕
4. 清除 Safari 缓存后重试
5. 使用 Chrome 或 Edge 作为替代
```

**PWA 无法安装或崩溃：**
```
解决方案：
1. 检查 macOS 版本兼容性
2. 确保足够的磁盘空间（100MB 以上）
3. 将浏览器更新到最新版本
4. 清除浏览器缓存和 Cookie
5. 临时禁用浏览器扩展
6. 重启 Mac 后重试安装
```

**应用未出现在应用程序中：**
```
解决方案：
1. 在 Launchpad 中查找 OneUptime 图标
2. 使用 Spotlight 搜索（⌘+空格）
3. 在浏览器的 PWA 管理部分查找
4. 尝试使用不同浏览器重新安装
5. 检查是否以不同名称安装
```

### 性能问题

**性能缓慢或 CPU 使用率高：**
```
解决方案：
1. 在活动监视器中检查资源使用情况
2. 关闭不必要的应用程序
3. 确保足够的内存（建议 8GB 以上）
4. 更新 macOS 和浏览器
5. 清除浏览器缓存和应用数据
6. 重启 OneUptime 应用
```

**内存泄漏或崩溃：**
```
解决方案：
1. 在活动监视器中监控内存使用情况
2. 定期重启 OneUptime 应用
3. 更新到最新浏览器版本
4. 完全清除浏览器缓存
5. 在控制台应用中查看错误日志
6. 附带崩溃日志报告问题
```

### 显示和窗口问题

**窗口大小或位置问题：**
```
解决方案：
1. 手动调整大小和重新定位窗口
2. 使用 窗口 菜单 → 缩放（Safari PWA）
3. 退出并重新打开来重置窗口状态
4. 检查系统偏好设置中的显示缩放
5. 尝试不同的桌面空间或全屏模式
```

**应用无响应：**
```
解决方案：
1. 强制退出：⌘+Option+Esc → 选择 OneUptime
2. 或右键单击 Dock 图标 → 强制退出
3. 重启应用程序
4. 检查 macOS 和浏览器更新
5. 清除应用缓存，如有必要重新安装
```

### 通知问题

**macOS 通知不工作：**
```
解决方案：
1. 系统偏好设置 → 通知 → OneUptime
2. 启用"允许通知"
3. 设置适当的告警样式（横幅/提醒）
4. 检查勿扰模式设置
5. 验证 OneUptime 通知设置
6. 出现提示时授予通知权限
```

## 卸载

### 完全移除
1. **应用程序文件夹方法**
   - 打开应用程序文件夹
   - 找到 OneUptime
   - 拖到废纸篓或右键单击 → 移到废纸篓

2. **Dock 方法**
   - 右键单击 Dock 中的 OneUptime
   - 选择"选项" → "从 Dock 中移除"
   - 然后从应用程序文件夹中删除

3. **浏览器 PWA 管理**
   - **Chrome**：chrome://apps/ → 找到 OneUptime → 移除
   - **Edge**：edge://apps/ → 找到 OneUptime → 卸载
   - **Safari**：没有专用管理页面

### 完全清除安装
移除所有关联数据：

```bash
# 清除 Safari PWA 数据（通用网站数据）
rm -rf ~/Library/Safari/Databases
rm -rf ~/Library/Caches/com.apple.Safari

# 清除 Chrome PWA 数据
rm -rf ~/Library/Application\ Support/Google/Chrome/Default/Web\ Applications

# 清除 Edge PWA 数据
rm -rf ~/Library/Application\ Support/Microsoft\ Edge/Default/Web\ Applications
```

## 更新和维护

### 自动更新
- OneUptime PWA 在在线状态下自动更新
- 无需 App Store 更新
- 新功能立即可用
- 紧急更新即时应用

### 手动更新流程
强制更新应用程序：
1. **Safari PWA**：在 Safari 浏览器中刷新
2. **Chrome PWA**：右键单击应用 → 重新加载，或按 ⌘+R
3. **完全刷新**：关闭应用，重新打开浏览器，访问 OneUptime

### 维护计划
定期维护以获得最佳性能：

**每周：**
- 重启 OneUptime 应用
- 如遇到问题，清除浏览器缓存
- 检查 macOS 更新

**每月：**
- 检查存储使用情况，必要时清理
- 如未自动更新，请更新浏览器
- 验证通知设置是否正常工作

## 与 macOS 功能集成

### 快捷指令应用集成
为 OneUptime 创建自定义快捷指令：
1. 打开 **快捷指令** 应用
2. 创建 **新快捷指令**
3. 添加 **"打开应用"** 操作
4. 选择 **OneUptime**
5. 添加到 Siri 以实现语音激活

### Automator 集成
自动化 OneUptime 任务：
1. 启动 **Automator**
2. 创建 **应用程序** 或 **工作流程**
3. 添加 **"启动应用程序"** 操作
4. 选择 OneUptime PWA
5. 添加其他自动化步骤

### 终端集成
通过终端管理 OneUptime：

```bash
# 为快速启动 OneUptime 创建别名
echo 'alias oneuptime="open -a \"OneUptime\""' >> ~/.zshrc

# 检查 OneUptime 是否正在运行的函数
oneuptime_status() {
    if pgrep -f "OneUptime" > /dev/null; then
        echo "OneUptime is running"
    else
        echo "OneUptime is not running"
    fi
}
```

## 安全和隐私

### macOS 安全功能
1. **Gatekeeper**：确保 PWA 安装来自可信来源
2. **系统完整性保护**：保护系统文件
3. **FileVault**：加密磁盘以保护数据
4. **钥匙串**：安全的凭据存储

### 隐私注意事项
1. **定位服务**：按需配置监控
2. **相机/麦克风**：按需授予权限
3. **屏幕录制**：某些监控功能可能需要
4. **网络访问**：确保正确的防火墙配置

### 最佳实践
1. **定期更新**：保持 macOS 和浏览器为最新版本
2. **强认证**：使用 Touch ID/Face ID（如可用）
3. **网络安全**：使用 VPN 进行远程监控访问
4. **数据备份**：定期进行 Time Machine 备份（包含 PWA 数据）
5. **权限审查**：定期审查已授予的权限
