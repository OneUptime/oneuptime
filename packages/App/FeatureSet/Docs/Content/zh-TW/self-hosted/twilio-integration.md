# Twilio 簡訊與語音整合

自架 OneUptime 使用您的 Twilio 帳戶傳送簡訊和語音警示，費用由您直接支付給 Twilio。請在 OneUptime 儀表板中設定認證資訊：通知傳送會讀取已儲存的設定，Helm chart 中沒有 Twilio 認證資訊設定值。舊版移轉曾匯入 `TWILIO_ACCOUNT_SID`、`TWILIO_AUTH_TOKEN` 和 `TWILIO_PHONE_NUMBER`；變更這些變數並不是更新現有安裝環境認證資訊的方法。

## 1. 準備 Twilio 帳戶

1. 開啟 [Twilio Console](https://console.twilio.com/)，取得 **Account SID** 和 **Auth Token**。
2. 取得具備所需簡訊及/或語音功能的 Twilio 電話號碼。傳送方和接收方號碼均應採用包含國碼的 E.164 格式。
3. 檢查帳戶餘額、目的地國家/地區權限，以及適用的傳送者註冊要求。試用帳戶在接收方、地理區域等方面有限制，可能導致實際的 OneUptime 警示無法正常傳送；測試前請閱讀 [Twilio 帳戶與試用說明](https://www.twilio.com/docs/usage/tutorials/how-to-use-your-free-trial-account)。正式環境請使用升級後的帳戶。

## 2. 在 OneUptime 中儲存認證資訊

針對單一專案：

1. 前往**專案設定 > 通知 > 通知設定**。
2. 在 **Twilio 設定**中選取**建立 Twilio 設定**。
3. 輸入名稱、**Twilio Account SID**、**Twilio Auth Token** 和 **Twilio 主要電話號碼**。您也可以輸入其他國家/地區的 **Twilio 次要電話號碼**，以逗號分隔。
4. 啟用**設為專案預設值**，將此設定用於專案成員的簡訊和通話，包括值班通知。如果只建立設定而未開啟此選項，系統不會選用該設定來傳送這些通知。
5. 儲存。一個專案只能有一個預設設定。狀態頁面使用明確指派給該頁面的設定。

如需設定整個安裝環境的預設值，管理員也可以開啟**管理儀表板 > 設定 > 通話與簡訊**，編輯 Twilio 認證資訊和電話號碼後儲存。當專案沒有預設設定時，成員通知會使用此全域設定。請妥善保管 Auth Token。

## 3. 設定網路存取

私有部署需要透過輸出 HTTPS 存取 Twilio，才能提交簡訊和通話。由於 API 位址會動態變更，Twilio 建議允許連至 `*.twilio.com` 的輸出 HTTPS；請參閱 [Twilio IP 位址說明](https://help.twilio.com/articles/115015934048-All-About-Twilio-IP-Addresses)。請將此規則套用至 OneUptime 應用程式工作負載的輸出流量，包括 Kubernetes NetworkPolicies 和外部防火牆。 允許 OneUptime 應用程式進行 DNS 解析和輸出 HTTPS (TCP 443) 存取。

是否需要輸入存取取決於所用功能：

| 功能 | Twilio 是否需要存取 OneUptime？ |
| --- | --- |
| 提交簡訊 | 不需要。但更新傳送狀態需要回呼。 |
| 一般語音測試通話 | 不需要。OneUptime 會隨輸出 API 要求提供語音指令。 |
| 按 1 確認值班警示 | 需要。Twilio 會將按鍵輸入提交給 OneUptime。 |
| 來電原則 | 需要。Twilio 會要求通話指令並回報撥號結果。 |

以下是透過 OneUptime Nginx 閘道存取的外部路徑；預留位置依通知而異：

| 方法 | 路徑 | 用途 |
| --- | --- | --- |
| POST | `/notification/sms/status-callback/:smsLogId/:token` | 簡訊傳送狀態 |
| POST | `/api/user-notification-log-timeline/call/gather-input/:itemId?token=...` | 按鍵確認 |
| POST | `/notification/incoming-call/voice` | 選用的來電指令 |
| POST | `/notification/incoming-call/dial-status/:callLogId/:callLogItemId` | 選用的來電路由結果 |

OneUptime 會自動產生簡訊和確認操作的 URL。請勿將其中的權杖替換為固定的 Webhook URL。對於來電，請遵循[來電原則](/docs/on-call/incoming-call-policy)；連結電話號碼時，系統會設定該號碼的 Webhook。

Twilio 要求 [Webhook URL 可供公開存取](https://www.twilio.com/docs/usage/webhooks/webhooks-overview)。請使用公開信任的 TLS 憑證，並在 Proxy 鏈中保留原始主機、通訊協定、路徑、查詢參數、要求本文和 `X-Twilio-Signature` 標頭。來電處理常式會驗證 Twilio 簽章；簡訊傳送狀態使用每則訊息專用的 URL 權杖，按鍵確認使用已簽署的查詢權杖。請勿在共用記錄或螢幕擷取畫面中洩漏權杖。請參閱 [Twilio Webhook 安全性說明](https://www.twilio.com/docs/usage/webhooks/webhooks-security)。

### 正式環境：公開通往私有部署的閘道

1. **選擇主機名稱**，例如 `oneuptime.example.com`。發佈指向面向網際網路閘道的公開 DNS 記錄。提供者無法存取私有 IP 位址和僅供內部使用的 DNS 名稱。使用分割 DNS 時，員工可以將相同主機名稱解析到私有入口，並繼續透過 VPN 使用儀表板。私有入口也必須提供 HTTPS，並使用對該主機名稱有效的憑證。

2. **將閘道連接到 OneUptime。** 將閘道放在能夠路由到私有入口的 DMZ 中，或使用透過您自己的站台對站台 VPN/私人連結連線的公開閘道。允許閘道透過上游服務連接埠存取入口。對於 Kubernetes/Portainer，僅有私有 `ClusterIP` 服務還不夠：閘道需要入口/控制器或其他可存取的上游。資料庫和其他內部服務應保持私有。

3. **在連接埠 443 終止 HTTPS**，使用公開信任的憑證和完整的中繼憑證鏈。允許輸入 TCP 443 存取閘道。僅安裝憑證或變更 DNS 不會建立通往私有上游的路由。

4. 僅透過 OneUptime 的 Nginx 閘道公開上表所需的回呼路徑，該閘道會將 `/notification` 對應至應用程式。保留按鍵確認路徑的 `/api` 前綴。 保留方法、路徑、查詢字串、本文及驗證標頭（`X-Twilio-Signature`）。保留公用 `Host`，設定受信任的 `X-Forwarded-Host` 和 `X-Forwarded-Proto: https` 標頭。不要新增重新導向。

5. 將這些路徑排除在瀏覽器 SSO、CAPTCHA 和 Proxy 登入頁面之外。保持 OneUptime 驗證啟用。僅允許閘道和獲准的內部用戶端存取來源伺服器，並在日誌中隱藏權杖。

6. **設定 OneUptime 的標準 URL**:

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

   將範例替換為您的網域。這些設定用於產生 URL，不會建立 DNS、TLS 或防火牆規則。套用 Compose 設定或 Helm 更新，然後等待應用程式重新啟動。 OneUptime 沒有獨立的 Twilio 回呼主機名稱設定。如果主機名稱變更，還需更新現有 Twilio 電話號碼的 Webhook。

[私有網路存取設定](/docs/self-hosted/private-network-access)控制 OneUptime 向內部服務發出的要求。啟用 `ALLOW_PRIVATE_NETWORK_WEBHOOKS` 不會使 Twilio 能夠存取 OneUptime。

### 輸出存取和 IP 限制

一般 Twilio Webhook 的來源位址會變更；不要將 SIP 或媒體位址範圍用作回呼允許清單。符合條件的版本提供 [Static Proxy for Webhooks](https://www.twilio.com/docs/iam/twilio-editions/twilio-static-proxy)。請確認版本資格與支援的產品，並使用目前公布的位址範圍設定防火牆。繼續驗證回呼身分。

### 測試與不允許輸入存取的部署

沒有輸入存取時，仍可透過輸出 HTTPS 提交簡訊和播放簡單語音。傳送狀態、按鍵確認和來電路由需要可存取的回呼。完全斷網的安裝無法使用 Twilio。

開發時可參考 Twilio 的 [Webhook 測試指南](https://www.twilio.com/docs/usage/webhooks/webhook-testing)使用公用通道。將通道轉送到只允許所需路徑的 Proxy，依上述方式設定取得的主機名稱，並在測試後停止通道。通道仍會公開輸入存取。

## 4. 分別測試傳送和回呼

1. 從公司網路和 VPN 外部驗證回呼主機名稱解析到公用閘道，並提供有效的 TLS 憑證。瀏覽器 GET 不會測試這些 POST 回呼。
2. 在專案的 Twilio 設定中使用**傳送測試簡訊**和**撥打測試電話**，確認目的地手機收到簡訊和來電。
3. 設定使用者已驗證的簡訊/通話聯絡方式和通知規則，然後觸發一次受控的值班警示。按 1，並在 OneUptime 中確認警示已被確認。 如果使用來電原則，請撥打設定的號碼，檢查路由和通話日誌。
4. 在 OneUptime 和 Twilio 訊息記錄中確認簡訊傳送狀態。傳送要求被接受不代表已送達；[Twilio 透過回呼回報後續狀態變更](https://www.twilio.com/docs/messaging/guides/track-outbound-message-status)。

如果傳送失敗，請檢查認證資訊、號碼功能、帳戶限制和輸出連線。如果簡訊或通話已收到，但狀態或確認結果未更新，請檢查回呼 URL 和公開入口記錄。Twilio 的 [HTTP 擷取失敗指南](https://www.twilio.com/docs/api/errors/11200)可協助診斷無法存取的回呼、TLS 問題和 HTTP 錯誤。僅測試通話成功並不能驗證回呼存取。
