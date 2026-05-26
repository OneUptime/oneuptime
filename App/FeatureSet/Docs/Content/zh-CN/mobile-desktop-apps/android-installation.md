# Android 安装指南

从 Google Play 商店安装 **OneUptime On-Call** 原生 Android 应用,或者在没有 Google Play 的设备上直接旁加载 APK。

## 系统要求

- 运行 **Android 8.0 (Oreo) 或更高版本** 的 Android 手机或平板电脑
- 有效的 OneUptime 账户(或您自托管 OneUptime 实例的 URL)
- 用于登录和接收推送通知的互联网连接

## 选项 1:从 Google Play 安装(推荐)

1. 在您的设备上打开 **Google Play 商店**。
2. 搜索 **"OneUptime On-Call"**,或在设备上打开此链接:
   [https://play.google.com/store/apps/details?id=com.oneuptime.oncall](https://play.google.com/store/apps/details?id=com.oneuptime.oncall)
3. 点按 **安装**。
4. 安装完成后,点按 **打开**,或从应用抽屉启动 **OneUptime On-Call**。

## 选项 2:直接安装 APK

对于没有 Google Play 的设备(例如 GrapheneOS、/e/OS 或 Huawei 设备),请从 GitHub Releases 安装官方 APK:

1. 在您的 Android 设备上打开此链接:
   [https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk)
2. 当出现提示时,允许您的浏览器安装未知应用:
   **设置 → 应用 → \[您的浏览器\] → 安装未知应用 → 允许来自此来源**。
3. 打开下载好的 APK,然后点按 **安装**。
4. 从应用抽屉启动 **OneUptime On-Call**。

该 APK 由 OneUptime 使用与 Play Store 版本相同的源代码构建并签名。旁加载时应用更新不是自动的 — 当新版本发布时,请从上述链接下载最新的 APK。

## 首次启动与登录

1. **服务器 URL**
   - 如果您使用 OneUptime Cloud,请保留默认值 `https://oneuptime.com`。
   - 如果您是自托管,请输入您的 OneUptime 实例的 URL(例如 `https://oneuptime.example.com`)。
   - 应用会在继续之前验证服务器是否可访问。
2. **登录**
   - 输入您 OneUptime 账户的电子邮件和密码。
   - 可选择启用 **生物识别解锁**(指纹),以便在后续启动时更快地解锁。
3. **允许通知**
   - 当提示出现时,点按 **允许**,以便应用可以发送随叫随到呼叫、事件警报和确认信息。

## 推送通知

推送通知通过 Firebase Cloud Messaging (FCM) 并经由 Expo Push 投递。为了确保值班期间呼叫可靠地送达:

1. 打开 **设置 → 应用 → OneUptime On-Call → 通知**,确认所有类别均已启用。
2. 打开 **设置 → 应用 → OneUptime On-Call → 电池**,选择 **无限制**(或禁用电池优化),以便操作系统不会延迟后台推送。
3. 允许应用在后台运行,并禁用任何针对该应用的"数据节省程序"限制。
4. 如果您使用 Samsung 设备,还需在 **设置 → 设备维护 → 电池 → 后台使用限制** 中为 OneUptime On-Call 关闭限制。
5. 将 OneUptime On-Call 添加到所有 **勿扰模式** 例外列表中,以便在您值班期间呼叫仍能响铃。

## 更新

**Google Play:**
- 更新会自动安装。要手动触发更新,请打开 **Play 商店 → 个人资料 → 管理应用和设备 → 有可用更新 → OneUptime On-Call → 更新**。

**APK 旁加载:**
- 从上述 GitHub Releases 链接重新下载最新的 APK 并覆盖安装现有应用 — 您的数据、服务器 URL 和登录信息会被保留。

## 卸载

1. **长按** **OneUptime On-Call** 图标,然后点按 **卸载**。
2. 或打开 **设置 → 应用 → OneUptime On-Call → 卸载**。
3. 确认以移除该应用。

您的 OneUptime 账户和值班排班存储在服务器端,卸载应用时不会被删除。

## 故障排查

**登录时出现"网络错误":**
- 验证 **服务器 URL** 是否正确,并且可从您的设备访问。
- 如果您处于企业网络或 VPN 上,请确保可以访问该 OneUptime 实例。
- 确认服务器通过 HTTPS 提供服务并使用有效证书。

**未收到推送通知:**
- 在 **设置 → 应用 → OneUptime On-Call → 通知** 中确认已启用通知。
- 禁用 OneUptime On-Call 的电池优化(请参阅上文"推送通知"部分)。
- 确保勿扰模式已关闭,或者 OneUptime On-Call 已在例外列表中。
- 退出登录后重新登录,以刷新已在服务器上注册的推送令牌。
- 自托管用户:确认您的 OneUptime 实例已配置推送通知(请参阅自托管 [推送通知](/docs/self-hosted/push-notifications) 指南)。

**生物识别解锁无法正常工作:**
- 在 **设置 → 安全 → 指纹** 中注册指纹。
- 从 OneUptime On-Call 应用内的 **设置** 屏幕重新启用生物识别解锁。

**APK 安装被阻止:**
- 您必须授予浏览器安装未知应用的权限(请参阅上文"选项 2")。
- 部分运营商或企业设备配置文件会完全阻止旁加载;在这种情况下,请改用 Google Play 版本。

**应用启动时崩溃:**
- 从 Google Play 更新到最新版本,或下载最新的 APK。
- 重新启动您的设备。
- 如果问题仍然存在,请卸载并重新安装,然后重新登录。

## 支持

如果您仍需帮助,请通过您的 OneUptime 控制面板联系我们,或在我们的 [GitHub 仓库](https://github.com/OneUptime/oneuptime) 上提交 issue。
