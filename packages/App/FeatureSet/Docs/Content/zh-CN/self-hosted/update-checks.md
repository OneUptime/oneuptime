# 更新与安全检查

自托管的 OneUptime 每天会向 GitHub 询问一次：是否有更新的版本发布，以及 OneUptime 发布的某条安全公告是否影响你正在运行的版本。一旦有公告影响你的版本，系统就会请你的主管理员升级。本页说明该检查会发送什么、你会看到什么，以及如何关闭它。

:::cards
- [检查会发送什么](#检查会发送什么): 两个公开的问题，不涉及你的安装的任何信息。
- [你会看到什么](#你会看到什么): 页脚、管理员仪表板，以及每条公告一封邮件。
- [关闭检查](#关闭检查): 适用于无法访问互联网的网络，或想改用镜像时。
:::

## 检查会发送什么

Worker 会向 GitHub 的 API（`api.github.com`）发送两个请求，且不携带令牌：

| 请求 | 询问的内容 |
| --- | --- |
| `GET /repos/OneUptime/oneuptime/releases/latest` | 最新的 OneUptime 版本是哪个 |
| `GET /repos/OneUptime/oneuptime/security-advisories?state=published` | OneUptime 发布了哪些安全公告、每条公告影响哪些版本，以及修复它的版本 |

这些请求中没有任何关于你的安装的信息：没有你运行的版本，没有它的地址，也没有任何关于你的用户、项目或监控数据的内容。与对待任何请求一样，GitHub 会看到你服务器的公网 IP 地址，以及一个注明 OneUptime 的 `User-Agent`。某条公告是否影响你的版本，是在你的服务器上判断的，也不会有任何浏览器调用 GitHub。

检查会在 worker 启动时运行，之后每天运行一次。它最多每 12 小时向 GitHub 询问一次；请求失败后，最多每小时询问一次。

## 你会看到什么

只有主管理员会收到通知。只有他们能够升级，而告诉其他任何人这台服务器运行着存在已知安全问题的版本，就等于指出了一台未打补丁的服务器。

- 有更新的版本时，Dashboard 和管理员仪表板的页脚会出现 **有可用更新**。它会打开升级指南。
- 如果某条已发布的安全公告影响你正在运行的版本，那里会改为出现红色的 **安全更新**。
- 随后，管理员仪表板的首页会列出每条公告：它的严重程度、它影响的版本、修复它的版本，以及它在 GitHub 上的链接。首页还会说明检查上次读取公告的时间，以及最近一次检查失败的原因（如果失败了）。
- 你的主管理员和管理员通知电子邮件（管理员仪表板中的 **设置** > **电子邮件**）会就每条影响你的版本的公告收到一封邮件，并且绝不会收到第二封。

一旦你运行的版本不受任何公告影响，这一切就会消失。如何升级，请参阅[升级](/docs/installation/upgrading)。

## 关闭检查

在无法访问互联网的网络中，或者你的服务器不应联系 GitHub 时，请关闭该检查。这样就不会显示任何内容，也不会发送任何邮件。

:::tabs
@tab Kubernetes
```yaml
updateCheck:
  disabled: true
```
@tab Docker Compose
```bash
DISABLE_UPDATE_CHECK=true
```
在 `config.env` 中设置它，然后运行 `npm start`。
:::

如果要改为对照你网络内部的镜像进行检查，请把检查指向该镜像。镜像的响应必须与 GitHub 的格式一致。

| Helm 值 | Docker Compose 设置 | 默认值 |
| --- | --- | --- |
| `updateCheck.url` | `LATEST_RELEASE_CHECK_URL` | `https://api.github.com/repos/OneUptime/oneuptime/releases/latest` |
| `updateCheck.securityAdvisoriesUrl` | `SECURITY_ADVISORIES_CHECK_URL` | `https://api.github.com/repos/OneUptime/oneuptime/security-advisories` |

## 无法访问 GitHub 时

在无法访问互联网的网络中，请求失败是意料之中的，并不是错误。Worker 会以 debug 级别记录它，保留上次读取到的内容，并在稍后重试。管理员仪表板会显示上次读取公告的时间，以及最近一次检查失败的原因：GitHub 的速率限制、没有通往 GitHub 的路由、超时，或收到的不是 GitHub 的响应。

## 后续步骤

:::cards
- [升级](/docs/installation/upgrading): 升级到更新的版本，一次一个主要版本。
- [架构](/docs/self-hosted/architecture): 自托管的 OneUptime 建立的每一个连接。
- [位于 VPN 或防火墙之后](/docs/self-hosted/behind-a-firewall): 从外部到达你的服务器的内容。
:::
