# iOS 安装指南

在您的 iPhone 或 iPad 上从 Apple App Store 安装 **OneUptime On-Call** 原生 iOS 应用。

## 系统要求

- 运行 **iOS 15.0 或更高版本** 的 iPhone 或 iPad
- 有效的 OneUptime 账户(或您自托管 OneUptime 实例的 URL)
- 用于登录和接收推送通知的互联网连接

## 从 App Store 安装

1. 在您的 iPhone 或 iPad 上 **打开 App Store**。
2. 点按 **搜索** 标签并搜索 **"OneUptime On-Call"**,或在设备上打开此链接:
   [https://apps.apple.com/us/app/oneuptime-on-call/id6759615391](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391)
3. 点按 **获取**,然后使用 Face ID、Touch ID 或您的 Apple ID 密码进行身份验证。
4. 安装完成后,点按 **打开**,或从主屏幕启动 **OneUptime On-Call**。

## 首次启动与登录

1. **服务器 URL**
   - 如果您使用 OneUptime Cloud,请保留默认值 `https://oneuptime.com`。
   - 如果您是自托管,请输入您的 OneUptime 实例的 URL(例如 `https://oneuptime.example.com`)。
   - 应用会在继续之前验证服务器是否可访问。
2. **登录**
   - 输入您 OneUptime 账户的电子邮件和密码。
   - 可选择启用 **Face ID** 或 **Touch ID**,以便在后续启动时更快地解锁。
3. **允许通知**
   - 当提示出现时,点按 **允许**,以便应用可以发送随叫随到呼叫、事件警报和确认信息。

## 推送通知

推送通知通过 Apple Push Notification 服务 (APNs) 并经由 Expo Push 投递。为了确保呼叫可靠地送达:

1. 前往 **设置 → 通知 → OneUptime On-Call**。
2. 启用 **允许通知**、**声音**、**徽标** 以及 **锁定屏幕 / 横幅 / 通知中心** 投递。
3. 将 **通知分组** 设置为 **自动**。
4. 如果您正在值班,请在轮班期间禁用 **低电量模式**,并避免强制退出应用 — 如果强制关闭应用,iOS 可能会延迟后台投递。
5. 将 **OneUptime On-Call** 添加到您仍希望接收呼叫的所有 **专注模式** 中。

## 更新

应用通过 App Store 更新:

- 打开 **App Store**,点按您的头像,滚动至 **OneUptime On-Call**,然后点按 **更新**。
- 或在 **设置 → App Store → App 更新** 中启用自动安装更新。

## 卸载

1. 在主屏幕上 **长按** **OneUptime On-Call** 图标。
2. 点按 **移除 App → 删除 App**。
3. 点按 **删除** 进行确认。

您的 OneUptime 账户和值班排班存储在服务器端,卸载应用时不会被删除。

## 故障排查

**App Store 提示该应用"在您所在的地区不可用":**

- 该应用发布于全球 App Store。如果在您所在的地区未显示,请联系 [支持](mailto:support@oneuptime.com)。

**登录时出现"网络错误":**

- 验证 **服务器 URL** 是否正确,并且可从您的设备访问。
- 如果您处于企业网络或 VPN 上,请确保可以访问该 OneUptime 实例。
- 确认服务器通过 HTTPS 提供服务并使用有效证书。

**未收到推送通知:**

- 打开 **设置 → 通知 → OneUptime On-Call**,确认已允许通知。
- 禁用 **勿扰模式**,或将 OneUptime On-Call 添加到当前激活的专注模式的允许列表中。
- 退出登录后重新登录,以刷新已在服务器上注册的推送令牌。
- 自托管用户:确认您的 OneUptime 实例已配置推送通知(请参阅自托管 [推送通知](/docs/self-hosted/push-notifications) 指南)。

**Face ID / Touch ID 无法正常工作:**

- 确保已在 **设置 → 面容 ID 与密码** 或 **设置 → 触控 ID 与密码** 中注册生物识别信息。
- 从 OneUptime On-Call 应用内的 **设置** 屏幕重新启用生物识别解锁。

**应用启动时崩溃:**

- 从 App Store 更新到最新版本。
- 重新启动您的设备。
- 如果问题仍然存在,请删除并重新安装应用,然后重新登录。

## 支持

如果您仍需帮助,请通过您的 OneUptime 控制面板联系我们,或在我们的 [GitHub 仓库](https://github.com/OneUptime/oneuptime) 上提交 issue。
