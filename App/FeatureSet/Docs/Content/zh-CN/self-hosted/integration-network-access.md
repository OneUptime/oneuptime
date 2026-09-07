# 从私有网络访问集成

自托管 OneUptime 实例可能能够向 Twilio 和 Microsoft 发送请求，但它们的云服务无法访问该实例。员工的 VPN 连接不会为任一提供商开放私有网络访问。请结合 [Twilio 设置指南](/docs/self-hosted/twilio-integration)、[Teams 设置指南](/docs/self-hosted/microsoft-teams-integration)和以下网络步骤进行配置。

## 哪个方向需要访问？

| 功能 | OneUptime 到提供商 | 提供商到 OneUptime |
| --- | --- | --- |
| 发送短信或播放简单的出站语音告警 | HTTPS | 提交短信或播放内联语音指令不需要入站访问 |
| 短信发送状态更新、语音按键操作、来电路由 | HTTPS | 需要回调；路由请参阅 Twilio 指南 |
| Teams 通知 | 到 Microsoft API 的 HTTPS | 完整的机器人集成需要入站访问，包括会话发现 |
| Teams 命令、卡片按钮、聊天安装事件 | HTTPS | `POST /api/microsoft-bot/messages` |

[私有网络访问设置](/docs/self-hosted/private-network-access)控制 OneUptime 向内部服务发出的请求。启用 `ALLOW_PRIVATE_NETWORK_WEBHOOKS` 不会使 Twilio 或 Teams 能够访问 OneUptime。

## 生产环境：公开通往私有部署的网关

```text
Twilio / Azure Bot Service
          | HTTPS :443
          v
公共网关（反向代理或负载均衡器）
          | 私有连接；仅回调路由
          v
私有 OneUptime 入口 -> OneUptime 应用
```

1. **选择主机名**，例如 `oneuptime.example.com`。发布指向面向互联网网关的公共 DNS 记录。提供商无法访问私有 IP 地址和仅供内部使用的 DNS 名称。使用分离 DNS 时，员工可以将相同主机名解析到私有入口，并继续通过 VPN 使用仪表板。私有入口也必须提供 HTTPS，并使用对该主机名有效的证书。
2. **将网关连接到 OneUptime。** 将网关放置在能够路由到私有入口的 DMZ 中，或使用通过您自己的站点间 VPN/私有链路连接的公共网关。允许网关通过上游服务端口访问入口。对于 Kubernetes/Portainer，仅有私有 `ClusterIP` 服务还不够：网关需要入口/控制器或其他可访问的上游。数据库和其他内部服务应保持私有。
3. **在 443 端口终止 HTTPS**，使用公开受信任的证书和完整的中间证书链。允许入站 TCP 443 访问网关。仅安装证书或更改 DNS 不会建立通往私有上游的路由。
4. **仅转发必需的回调路径**，包括 Twilio 指南表格中的路径和 Teams 的 `/api/microsoft-bot/messages`。通过 OneUptime 入口转发；该入口已经将 `/notification` 映射到应用。保留方法、原始路径、查询字符串、正文、`Authorization` 和 `X-Twilio-Signature`。保留公共 `Host`，并在网关设置可信的 `X-Forwarded-Host` 和 `X-Forwarded-Proto: https`。请勿去除 `/api` 或添加重定向。在公共网关拒绝其他路径；员工可通过私有入口访问仪表板和浏览器登录回调。
5. **保留回调身份验证。** 将这些路由排除在浏览器 SSO、CAPTCHA 和代理登录页面之外，因为提供商无法完成这些交互。OneUptime 仍会验证回调令牌、来电路由上的 Twilio 签名以及 Bot Framework 身份验证。请勿移除这些检查。仅允许网关和已授权的内部客户端访问源站，并在日志中隐藏回调令牌。Twilio 介绍了这种 [DMZ 代理架构和 Webhook 安全措施](https://www.twilio.com/docs/usage/webhooks/webhooks-security)。
6. 配置任一集成之前，**设置 OneUptime 的规范 URL**：

   Docker Compose，在 `config.env` 中：

   ```dotenv
   HOST=oneuptime.example.com
   HTTP_PROTOCOL=https
   ```

   Helm/Portainer values：

   ```yaml
   host: oneuptime.example.com
   httpProtocol: https
   ```

   这些设置控制生成的 URL；不会配置 DNS、TLS 或防火墙访问。应用 Compose 配置或 Helm release 更新，并等待应用重启。OneUptime 不提供独立的 Twilio 回调主机名设置。如果主机名发生变化，请更新现有 Twilio 电话号码的 Webhook、Azure Bot 消息端点和应用注册重定向 URI，并重新下载和上传 Teams 清单。

## 出站访问和 IP 限制

允许 OneUptime 应用进行 DNS 解析和出站 HTTPS 访问。由于 API 地址会变化，Twilio 建议允许访问 `*.twilio.com`；请参阅 [Twilio IP 地址指南](https://help.twilio.com/articles/115015934048-All-About-Twilio-IP-Addresses)。Teams 使用 `graph.microsoft.com`、`login.microsoftonline.com`、Bot Framework 身份验证/频道端点以及会话的连接器服务 URL。请参考 [Microsoft 防火墙指南](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0)，并在测试时检查被阻止的流量；这些示例不是完整的域名列表。

请勿将 Twilio SIP/媒体地址范围或 Teams 客户端媒体地址范围作为 Webhook 来源允许列表。普通 Twilio Webhook 地址是动态的；符合条件的 Twilio 版本提供 [Static Proxy for Webhooks](https://www.twilio.com/docs/iam/twilio-editions/twilio-static-proxy)，需要与 Twilio 单独配置。Microsoft 防火墙指南指出，不支持固定的 Bot Framework 入站 IP 允许列表。请在应用层验证回调身份，不要假设固定来源 IP 就能证明身份。

## 测试和不允许入站访问的部署

从 VPN 之外的网络验证公共 DNS 和 TLS，然后检查 Teams 路由：

```bash
curl -sS -i https://oneuptime.example.com/api/microsoft-bot/messages
```

在当前 OneUptime 版本中，预期返回 `405 Method Not Allowed`，并包含 `Allow: POST`。这只能确认 GET 请求已到达该路由，并不能证明经过身份验证的机器人 POST 请求能够正常工作。旧版本可能返回 OneUptime 的 JSON 404；请检查响应正文和代理日志。TLS 错误、超时或代理的 HTML 错误页面表示存在证书或路由问题。

浏览器 GET 请求不能测试 Twilio POST 回调。发送一条真实的测试短信并检查发送状态更新，接听一次测试事件通话并执行按键操作，然后向 Teams 机器人发送消息并点击卡片按钮。对照提供商的发送诊断、网关和应用日志进行排查，并隐藏令牌。出站发送成功本身不能证明回调正常。

对于开发环境，Twilio 介绍了[通过隧道测试](https://www.twilio.com/docs/usage/webhooks/webhooks-overview)，Microsoft 介绍了 [Teams 本地调试](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/debug)。将公共 HTTPS 隧道转发到仅允许必要路由的代理，按上述方法配置生成的主机名，并在测试完成后停止隧道。隧道仍会公开入站端点，不能使部署保持物理隔离。

如果策略禁止所有入站连接，短信提交和简单的内联语音播放仍可通过出站 HTTPS 工作，但发送状态回调、按键操作、来电路由和完整 Teams 机器人集成无法工作。用于 Direct Line 的 Azure Bot 私有端点不能解决 Teams 连接问题：Microsoft 的[网络隔离指南](https://learn.microsoft.com/en-us/azure/bot-service/dl-network-isolation-how-to?view=azure-bot-service-4.0)说明，禁用公共访问会移除包括 Teams 在内的其他频道。完全断网的部署无法使用这些云集成。
