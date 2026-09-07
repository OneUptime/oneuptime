# 從私有網路存取整合

自架 OneUptime 執行個體可能可以向 Twilio 和 Microsoft 傳送要求，但它們的雲端服務無法存取該執行個體。員工的 VPN 連線不會為任一提供者開放私有網路存取。請搭配 [Twilio 設定指南](/docs/self-hosted/twilio-integration)、[Teams 設定指南](/docs/self-hosted/microsoft-teams-integration)和以下網路步驟進行設定。

## 哪個方向需要存取？

| 功能 | OneUptime 到提供者 | 提供者到 OneUptime |
| --- | --- | --- |
| 傳送簡訊或播放簡單的撥出語音警示 | HTTPS | 提交簡訊或播放內嵌語音指令不需要輸入存取 |
| 簡訊傳送狀態更新、語音按鍵操作、來電路由 | HTTPS | 需要回呼；路由請參閱 Twilio 指南 |
| Teams 通知 | 連至 Microsoft API 的 HTTPS | 完整的機器人整合需要輸入存取，包括交談探索 |
| Teams 命令、卡片按鈕、聊天安裝事件 | HTTPS | `POST /api/microsoft-bot/messages` |

[私有網路存取設定](/docs/self-hosted/private-network-access)控制 OneUptime 向內部服務發出的要求。啟用 `ALLOW_PRIVATE_NETWORK_WEBHOOKS` 不會使 Twilio 或 Teams 能夠存取 OneUptime。

## 正式環境：公開通往私有部署的閘道

```text
Twilio / Azure Bot Service
          | HTTPS :443
          v
公開閘道（反向 Proxy 或負載平衡器）
          | 私有連線；僅回呼路由
          v
私有 OneUptime 入口 -> OneUptime 應用程式
```

1. **選擇主機名稱**，例如 `oneuptime.example.com`。發佈指向面向網際網路閘道的公開 DNS 記錄。提供者無法存取私有 IP 位址和僅供內部使用的 DNS 名稱。使用分割 DNS 時，員工可以將相同主機名稱解析到私有入口，並繼續透過 VPN 使用儀表板。私有入口也必須提供 HTTPS，並使用對該主機名稱有效的憑證。
2. **將閘道連接到 OneUptime。** 將閘道放在能夠路由到私有入口的 DMZ 中，或使用透過您自己的站台對站台 VPN/私人連結連線的公開閘道。允許閘道透過上游服務連接埠存取入口。對於 Kubernetes/Portainer，僅有私有 `ClusterIP` 服務還不夠：閘道需要入口/控制器或其他可存取的上游。資料庫和其他內部服務應保持私有。
3. **在連接埠 443 終止 HTTPS**，使用公開信任的憑證和完整的中繼憑證鏈。允許輸入 TCP 443 存取閘道。僅安裝憑證或變更 DNS 不會建立通往私有上游的路由。
4. **僅轉送必要的回呼路徑**，包括 Twilio 指南表格中的路徑和 Teams 的 `/api/microsoft-bot/messages`。透過 OneUptime 入口轉送；該入口已將 `/notification` 對應到應用程式。保留方法、原始路徑、查詢字串、本文、`Authorization` 和 `X-Twilio-Signature`。保留公開 `Host`，並在閘道設定受信任的 `X-Forwarded-Host` 和 `X-Forwarded-Proto: https`。請勿移除 `/api` 或新增重新導向。在公開閘道拒絕其他路徑；員工可透過私有入口存取儀表板和瀏覽器登入回呼。
5. **保留回呼驗證。** 將這些路由排除在瀏覽器 SSO、CAPTCHA 和 Proxy 登入頁面之外，因為提供者無法完成這些互動。OneUptime 仍會驗證回呼權杖、來電路由上的 Twilio 簽章，以及 Bot Framework 驗證。請勿移除這些檢查。僅允許閘道和已授權的內部用戶端存取來源站台，並在記錄中隱藏回呼權杖。Twilio 說明了這種 [DMZ Proxy 架構和 Webhook 安全性](https://www.twilio.com/docs/usage/webhooks/webhooks-security)。
6. 設定任一整合之前，**設定 OneUptime 的標準 URL**：

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

   這些設定控制產生的 URL；不會佈建 DNS、TLS 或防火牆存取。套用 Compose 設定或 Helm release 更新，並等待應用程式重新啟動。OneUptime 不提供獨立的 Twilio 回呼主機名稱設定。如果主機名稱變更，請更新現有 Twilio 電話號碼的 Webhook、Azure Bot 訊息端點和應用程式註冊重新導向 URI，並重新下載和上傳 Teams 資訊清單。

## 輸出存取和 IP 限制

允許 OneUptime 應用程式進行 DNS 解析和輸出 HTTPS 存取。由於 API 位址會變更，Twilio 建議允許存取 `*.twilio.com`；請參閱 [Twilio IP 位址指南](https://help.twilio.com/articles/115015934048-All-About-Twilio-IP-Addresses)。Teams 使用 `graph.microsoft.com`、`login.microsoftonline.com`、Bot Framework 驗證/頻道端點，以及交談的連接器服務 URL。請參考 [Microsoft 防火牆指南](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0)，並在測試時檢查遭封鎖的流量；這些範例不是完整的網域清單。

請勿將 Twilio SIP/媒體位址範圍或 Teams 用戶端媒體位址範圍作為 Webhook 來源允許清單。一般 Twilio Webhook 位址是動態的；符合資格的 Twilio 版本提供 [Static Proxy for Webhooks](https://www.twilio.com/docs/iam/twilio-editions/twilio-static-proxy)，需要與 Twilio 個別設定。Microsoft 防火牆指南指出，不支援固定的 Bot Framework 輸入 IP 允許清單。請在應用程式層驗證回呼身分，不要假設固定來源 IP 就能證明身分。

## 測試與不允許輸入存取的部署

從 VPN 以外的網路驗證公開 DNS 和 TLS，然後檢查 Teams 路由：

```bash
curl -sS -i https://oneuptime.example.com/api/microsoft-bot/messages
```

在目前的 OneUptime 版本中，預期傳回 `405 Method Not Allowed`，並包含 `Allow: POST`。這只能確認 GET 要求已到達該路由，不能證明經過驗證的機器人 POST 要求能夠正常運作。舊版本可能傳回 OneUptime 的 JSON 404；請檢查回應本文和 Proxy 記錄。TLS 錯誤、逾時或 Proxy 的 HTML 錯誤頁面表示存在憑證或路由問題。

瀏覽器 GET 要求不能測試 Twilio POST 回呼。傳送一則實際的測試簡訊並檢查傳送狀態更新，接聽一次測試事件通話並執行按鍵操作，然後向 Teams 機器人傳送訊息並按一下卡片按鈕。對照提供者的傳送診斷、閘道和應用程式記錄進行排查，並隱藏權杖。輸出傳送成功本身不能證明回呼正常。

對於開發環境，Twilio 介紹了[透過通道測試](https://www.twilio.com/docs/usage/webhooks/webhooks-overview)，Microsoft 介紹了 [Teams 本機偵錯](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/debug)。將公開 HTTPS 通道轉送到僅允許必要路由的 Proxy，依上述方式設定產生的主機名稱，並在測試完成後停止通道。通道仍會公開輸入端點，無法讓部署維持實體隔離。

如果原則禁止所有輸入連線，簡訊提交和簡單的內嵌語音播放仍可透過輸出 HTTPS 運作，但傳送狀態回呼、按鍵操作、來電路由和完整 Teams 機器人整合無法運作。用於 Direct Line 的 Azure Bot 私人端點無法解決 Teams 連線問題：Microsoft 的[網路隔離指南](https://learn.microsoft.com/en-us/azure/bot-service/dl-network-isolation-how-to?view=azure-bot-service-4.0)說明，停用公開存取會移除包括 Teams 在內的其他頻道。完全斷線的部署無法使用這些雲端整合。
