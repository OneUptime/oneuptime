# OneUptime 移动和桌面应用

OneUptime 提供两种在浏览器之外使用平台的方式:

- **原生移动应用**,适用于 iOS 和 Android,已发布到 **Apple App Store** 和 **Google Play**。它们可将随叫随到呼叫、事件警报和确认操作直接发送到您的手机。
- **可安装的桌面应用**,适用于 Windows、macOS 和 Linux,作为渐进式 Web 应用 (PWA) 直接从浏览器安装。它们让 OneUptime 控制面板在您的电脑上拥有自己的窗口、图标和通知界面。

## 移动端(原生应用)

**OneUptime On-Call** 应用是一款使用 React Native 构建的原生应用。它通过官方商店分发,因此您可以获得自动更新、推送通知和生物识别解锁。

- **iOS** — [在 App Store 下载](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391)。需要 iOS 15.0 或更高版本。请参阅 [iOS 安装指南](./ios-installation.md)。
- **Android** — [在 Google Play 获取](https://play.google.com/store/apps/details?id=com.oneuptime.oncall)。需要 Android 8.0 或更高版本。对于没有 Google Play 的设备,也可直接 [下载 APK](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk)。请参阅 [Android 安装指南](./android-installation.md)。

## 桌面端(渐进式 Web 应用)

OneUptime 的 Web 控制面板是一个渐进式 Web 应用,因此您可以从现代浏览器将其安装为桌面应用,无需通过任何商店。

- [Windows 安装](./windows-installation.md)
- [macOS 安装](./macos-installation.md)
- [Linux 安装](./linux-installation.md)

### 桌面入门

1. 在基于 Chromium 的浏览器(Chrome、Edge)或 Safari 中打开您的 OneUptime 实例。
2. 在地址栏中查找 **安装** 按钮,或前往 **文件 → 添加到程序坞 / 应用 → 将此网站作为应用安装**。
3. 从开始菜单、启动台或应用启动器启动已安装的应用。

### 桌面故障排查

**未出现安装选项:**

- 确保您使用的是受支持的浏览器。
- 确认您的 OneUptime 实例通过 HTTPS 提供服务。
- 刷新页面或清除浏览器缓存。

**推送通知无法正常工作:**

- 当浏览器提示时,授予通知权限。
- 检查操作系统中针对该浏览器的通知设置。
- 自托管用户:确认您的 OneUptime 实例已配置推送通知。

## 支持

- 移动端相关问题:请查看 [iOS](./ios-installation.md) 或 [Android](./android-installation.md) 安装指南。
- 桌面端相关问题:请查看 [Windows](./windows-installation.md)、[macOS](./macos-installation.md) 或 [Linux](./linux-installation.md) 安装指南。
- 一般问题:请参阅 [常见问题与故障排查](./faq-troubleshooting.md) 页面。
- 在我们的 [GitHub 仓库](https://github.com/OneUptime/oneuptime) 上提交错误或功能请求。
