# SMSEagle 集成

通过 [SMSEagle](https://www.smseagle.eu) 以短信或电话发送告警通知。SMSEagle 是安装在你自己网络中的硬件短信网关。OneUptime 内置了 **SMSEagle** 工作流组件，所以很快就能配置好。

此集成是 **出站** 的：OneUptime 通过 [SMSEagle APIv2](https://www.smseagle.eu/docs/apiv2/) 发送消息。

```text
OneUptime 告警 → On Create  ──►  SMSEagle 组件  ──►  发往手机的短信或电话
```

## 第 1 步：创建 API 密钥

1. 在 SMSEagle 网页 GUI 中，进入 **Settings → API → API v2**，然后点击 **Create API key**。
2. 在 **Permissions** 下允许 **Send SMS**；如果需要电话，再允许 **Make a TTS Advanced Call**。
3. 复制密钥。OneUptime 把它称为 **SMSEagle Access Token**。

## 第 2 步：让 OneUptime 能访问设备

1. 在两者之间的防火墙和 VPN 中，允许从 OneUptime 服务器到设备地址（例如 `https://192.168.0.100`）的连接。
2. SMSEagle 设备通常使用私有地址，而工作流默认会阻止私有地址。在自托管实例上，把设备的 IP 地址或主机名加入 API 服务器的 `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST`，例如 `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST=192.168.0.100`，然后重启它。参见 [私有网络访问](/docs/self-hosted/private-network-access)。

## 第 3 步：保存密钥信息

1. 在 OneUptime 中，进入 **工作流 → 全局变量 → 创建**。
2. 创建 `SMSEAGLE_URL`、`SMSEAGLE_ACCESS_TOKEN`（机密）和 `ONCALL_PHONE`。

## 第 4 步：构建工作流

1. 打开 **工作流 → 创建工作流**，命名为 `Alerts → SMSEagle`，然后打开 **生成器**。
2. 添加一个设置为 **On Create** 的 **Alert** 触发器，并将其重命名为 `Alert`。
3. 添加一个连接到触发器的 **Send SMS via SMSEagle** 组件：
   - **SMSEagle URL**：`{{variable.SMSEAGLE_URL}}`
   - **SMSEagle Access Token**：`{{variable.SMSEAGLE_ACCESS_TOKEN}}`
   - **Phone Number**：`{{variable.ONCALL_PHONE}}`
   - **Message Text**：`New alert: {{Alert.title}}`
4. 点击 **保存**，启用工作流，并创建一条测试告警。短信会发到手机上。

模板 **Text a phone via SMSEagle when an alert fires** 会构建同样的工作流。

## 用电话代替短信

改用 **Make a Call via SMSEagle**。它的设置相同，另外还有 **Voice ID**，即设备上的语音合成声音，并会朗读 **Text to Read Out**。API 密钥需要 **Make a TTS Advanced Call** 权限。

模板 **Call a phone via SMSEagle when an alert fires** 会构建同样的、以电话通知的工作流。

## 替代方案：API 组件

也可以使用 **API** 块：

- **Method**：`POST`
- **URL**：`{{variable.SMSEAGLE_URL}}/api/v2/messages/sms`
- **Headers**：`access-token: {{variable.SMSEAGLE_ACCESS_TOKEN}}`
- **Body**：`{ "to": ["{{variable.ONCALL_PHONE}}"], "text": "New alert: {{Alert.title}}" }`

## 提示

- 如果设备拒绝了消息，原因会放在组件的 **Error** 值中。请在 **错误** 输出上把它记录到日志。
- 发送前用 **条件** 按严重程度筛选。
- 要通知多个人，就连接多个 SMSEagle 组件，每个号码一个。

## 接下来阅读

- [集成概览](/docs/integrations/index)：出站模式。
- [组件 → SMSEagle](/docs/workflows/components#smseagle)：组件参考。
