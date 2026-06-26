# OneUptime.com 的 IP 位址白名單

如果您正在使用 OneUptime.com，並且基於安全考量想要將我們的 IP 加入白名單，您可以依照下方的說明進行。

請在您的防火牆中將下列 IP 加入白名單，以允許 oneuptime.com 連線至您的資源。

{{IP_WHITELIST}}

這些 IP 可能會變更，如果發生這種情況，我們會事先通知您。

## 以程式方式取得 IP 位址

您也可以透過下列 API 端點以程式方式取得探測（probe）對外連線的 IP 位址清單：

```
GET https://oneuptime.com/ip-whitelist
```

這會回傳一個 JSON 回應：

```json
{
  "ipWhitelist": ["<list of IPs>"]
}
```

您可以使用此端點，自動讓您的防火牆白名單保持更新。
