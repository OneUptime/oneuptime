# 常见问题与故障排查

OneUptime 移动和桌面应用的常见问题及解决方案。

## OneUptime 是如何分发其应用的?

- **移动端(iOS 和 Android):** OneUptime 提供一款名为 **OneUptime On-Call** 的原生应用。该应用已发布到 [Apple App Store](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391) 和 [Google Play](https://play.google.com/store/apps/details?id=com.oneuptime.oncall)。对于没有 Google Play 的 Android 设备,也提供经过签名的 [APK 下载](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk)。
- **桌面端(Windows、macOS、Linux):** OneUptime Web 控制面板是一个渐进式 Web 应用 (PWA)。您可以直接从基于 Chromium 的浏览器或 Safari 将其安装为桌面应用 — 无需任何商店账户。

## 移动应用常见问题

### 支持哪些设备?

- **iOS:** 运行 iOS 15.0 或更高版本的 iPhone 或 iPad。
- **Android:** 运行 Android 8.0 (Oreo) 或更高版本的手机和平板电脑。

### 该应用免费吗?

是的。OneUptime On-Call 应用可免费安装。您使用现有的 OneUptime 账户登录。

### 我可以将该应用与自托管的 OneUptime 实例一起使用吗?

可以。首次启动时,应用会询问 **服务器 URL**。请输入您自托管实例的 URL(例如 `https://oneuptime.example.com`)。应用会先验证服务器可访问,然后才允许您登录。

如需在自托管实例上接收推送通知,请遵循 [推送通知](/docs/self-hosted/push-notifications) 指南。

### 更新是如何发布的?

- **iOS:** 通过 App Store。在 **设置 → App Store** 中启用自动更新,或从您的 App Store 个人资料中手动更新。
- **Android (Google Play):** 默认启用自动更新。
- **Android (APK 旁加载):** 从上述 GitHub Releases 链接下载并安装最新的 APK。

### 为什么我收不到推送通知?

移动推送通过 APNs (iOS) 和 FCM (Android) 并经由 Expo Push 投递。请检查以下内容:

1. 在操作系统级别已为 **OneUptime On-Call** 启用通知。
2. 已禁用电池优化并允许后台活动(Android)。
3. 勿扰模式或专注模式已关闭,或者该应用已在例外列表中。
4. 您已登录 — 推送令牌仅在登录后才会注册到服务器。
5. **仅限自托管:** 您的 OneUptime 实例已配置推送通知。请参阅 [推送通知](/docs/self-hosted/push-notifications) 指南。

### 我手机上的数据安全吗?

- 所有 API 流量均使用 HTTPS。
- 访问令牌和刷新令牌存储在设备的安全密钥库中(iOS 上的 Keychain,Android 上的 Keystore)。
- 您可以在应用内的 **设置** 屏幕中要求使用 Face ID / Touch ID / 指纹解锁。

### 我可以在多台设备上安装该应用吗?

可以。您可以根据需要在任意多台设备上使用同一个 OneUptime 账户登录。每台设备都会收到自己的推送通知。

### 如何卸载?

- **iOS:** 长按图标 → **移除 App** → **删除 App**。
- **Android:** 长按图标 → **卸载**,或前往 **设置 → 应用 → OneUptime On-Call → 卸载**。

您的 OneUptime 账户和数据存储在服务器上,卸载应用时不会被删除。

## 桌面应用 (PWA) 常见问题

### 什么是渐进式 Web 应用 (PWA)?

渐进式 Web 应用是一种 Web 应用程序,可以像原生桌面应用一样安装。安装后,它会在自己的窗口中运行,在启动器中拥有自己的图标,并可发送桌面通知 — 无需通过 Windows 商店、Mac App Store 或任何其他分发渠道。

### 桌面应用为什么使用 PWA 技术?

- **即时更新** — 您一旦部署,应用便会立即与您的 OneUptime 实例保持同步。
- **无需商店账户** — 可直接从任何现代浏览器安装。
- **单一代码库** — 同一个控制面板可在 Windows、macOS 和 Linux 上运行。

### 为什么"安装"按钮未出现?

1. 使用基于 Chromium 的浏览器(Chrome、Edge、Brave、Arc)或 Safari(macOS Sonoma+)。
2. 确认您的 OneUptime 实例通过 HTTPS 提供服务并使用有效证书。
3. 清除浏览器缓存并重新加载。
4. 应用可能已经安装 — 请检查您的应用程序 / 开始菜单。

### 如何更新桌面应用?

只要您在联网状态下打开该 PWA,它就会自动更新。如需强制更新,请使用 **Ctrl+R**(Windows/Linux)或 **Cmd+R**(macOS)刷新窗口。

### 如何卸载桌面 PWA?

- **Windows:** **设置 → 应用 → OneUptime → 卸载**,或右键点击开始菜单条目。
- **macOS:** 将应用从 **应用程序** 拖到废纸篓,或右键点击程序坞图标并选择 **移除**。
- **Linux:** 使用您的应用启动器的卸载选项,或移除相应的 `.desktop` 文件。

## 故障排查

### 移动应用问题

**应用无法登录 / "网络错误":**
- 确认 **服务器 URL** 正确,并且可从您的手机访问。
- 检查您的手机是否已连接到互联网。
- 对于位于 VPN 后的自托管实例,请确保 VPN 已启用。

**推送通知延迟或丢失 (Android):**
- 禁用电池优化:**设置 → 应用 → OneUptime On-Call → 电池 → 无限制**。
- 为该应用禁用数据节省程序。
- 在 Samsung 设备上,关闭 OneUptime On-Call 的 **设备维护 → 电池 → 后台使用限制**。

**推送通知延迟或丢失 (iOS):**
- 避免强制退出应用 — iOS 可能会暂停后台投递。
- 在您值班期间禁用低电量模式。
- 将 OneUptime On-Call 添加到所有激活的专注模式的允许列表中。

**Face ID / Touch ID / 指纹无法正常工作:**
- 确保已在操作系统设置中注册生物识别信息。
- 从 OneUptime On-Call 应用内的 **设置** 屏幕重新启用生物识别解锁。

### 桌面应用 (PWA) 问题

**缺少安装按钮:**
- 使用受支持的浏览器(基于 Chromium 的浏览器或 macOS Sonoma+ 上的 Safari)。
- 确保 OneUptime 实例通过 HTTPS 提供服务。
- 等待页面加载完成,然后查看地址栏中的安装图标。

**桌面通知未显示:**
- 当浏览器提示时,允许通知。
- 检查操作系统的通知设置(Windows 专注助手、macOS 通知、Linux 通知守护进程)。
- 对于自托管实例,请确保已完成 [推送通知](/docs/self-hosted/push-notifications) 配置。

**应用未显示最新数据:**
- 使用 **Ctrl+R** / **Cmd+R** 刷新。
- 关闭并重新打开窗口。
- 检查您的网络连接。

## 支持

如果您仍需帮助:

- 移动端:请参阅 [iOS](./ios-installation.md) 或 [Android](./android-installation.md) 安装指南。
- 桌面端:请参阅 [Windows](./windows-installation.md)、[macOS](./macos-installation.md) 或 [Linux](./linux-installation.md) 安装指南。
- 在 [OneUptime GitHub 仓库](https://github.com/OneUptime/oneuptime) 上提交 issue。
- 通过您的 OneUptime 控制面板联系支持。
