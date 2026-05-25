# OneUptime.com IP 地址白名單

如果您正在使用 OneUptime.com，並出於安全原因希望將我們的 IP 加入白名單，可以按照以下說明操作。

請在您的防火牆中將以下 IP 加入白名單，以允許 oneuptime.com 訪問您的資源。

{{IP_WHITELIST}}

這些 IP 地址可能會發生變化，如有變更我們會提前通知您。

## 通過程序化方式獲取 IP 地址

您也可以通過以下 API 端點以程序化方式獲取探針出口 IP 地址列表：

```
GET https://oneuptime.com/ip-whitelist
```

此接口返回 JSON 響應：

```json
{
  "ipWhitelist": ["<list of IPs>"]
}
```

您可以使用此端點自動保持防火牆白名單爲最新狀態。
