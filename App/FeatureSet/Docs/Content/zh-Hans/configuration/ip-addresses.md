# OneUptime.com IP 地址白名单

如果您正在使用 OneUptime.com，并出于安全原因希望将我们的 IP 加入白名单，可以按照以下说明操作。

请在您的防火墙中将以下 IP 加入白名单，以允许 oneuptime.com 访问您的资源。

{{IP_WHITELIST}}

这些 IP 地址可能会发生变化，如有变更我们会提前通知您。

## 通过程序化方式获取 IP 地址

您也可以通过以下 API 端点以程序化方式获取探针出口 IP 地址列表：

```
GET https://oneuptime.com/ip-whitelist
```

此接口返回 JSON 响应：

```json
{
  "ipWhitelist": ["<list of IPs>"]
}
```

您可以使用此端点自动保持防火墙白名单为最新状态。
