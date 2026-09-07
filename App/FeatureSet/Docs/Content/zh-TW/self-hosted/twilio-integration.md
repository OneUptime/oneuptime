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

私有部署需要透過輸出 HTTPS 存取 Twilio，才能提交簡訊和通話。由於 API 位址會動態變更，Twilio 建議允許連至 `*.twilio.com` 的輸出 HTTPS；請參閱 [Twilio IP 位址說明](https://help.twilio.com/articles/115015934048-All-About-Twilio-IP-Addresses)。請將此規則套用至 OneUptime 應用程式工作負載的輸出流量，包括 Kubernetes NetworkPolicies 和外部防火牆。

是否需要輸入存取取決於所用功能：

| 功能 | Twilio 是否需要存取 OneUptime？ |
| --- | --- |
| 提交簡訊 | 不需要。但更新傳送狀態需要回呼。 |
| 一般語音測試通話 | 不需要。OneUptime 會隨輸出 API 要求提供語音指令。 |
| 按 1 確認值班警示 | 需要。Twilio 會將按鍵輸入提交給 OneUptime。 |
| 來電原則 | 需要。Twilio 會要求通話指令並回報撥號結果。 |

對於回呼，請遵循 [Twilio 和 Microsoft Teams 網路存取指南](/docs/self-hosted/integration-network-access)，透過入口或反向 Proxy 公開必要的 HTTPS 路由，同時讓儀表板保持私有。管理員筆記型電腦上的 VPN 不會為 Twilio 提供連線路徑。

在 Docker Compose 的 `config.env` 中設定 `HOST=oneuptime.example.com` 和 `HTTP_PROTOCOL=https`，或在 Helm values 中設定 `host: oneuptime.example.com` 和 `httpProtocol: https`，然後套用部署變更。請將範例網域替換為您的網域。這些設定決定產生的 URL，不會建立 DNS 記錄、憑證或防火牆規則。OneUptime 沒有獨立的 Twilio 回呼主機名稱設定。

以下是透過 OneUptime Nginx 閘道存取的外部路徑；預留位置依通知而異：

| 方法 | 路徑 | 用途 |
| --- | --- | --- |
| POST | `/notification/sms/status-callback/:smsLogId/:token` | 簡訊傳送狀態 |
| POST | `/api/user-notification-log-timeline/call/gather-input/:itemId?token=...` | 按鍵確認 |
| POST | `/notification/incoming-call/voice` | 選用的來電指令 |
| POST | `/notification/incoming-call/dial-status/:callLogId/:callLogItemId` | 選用的來電路由結果 |

OneUptime 會自動產生簡訊和確認操作的 URL。請勿將其中的權杖替換為固定的 Webhook URL。對於來電，請遵循[來電原則](/docs/on-call/incoming-call-policy)；連結電話號碼時，系統會設定該號碼的 Webhook。

Twilio 要求 [Webhook URL 可供公開存取](https://www.twilio.com/docs/usage/webhooks/webhooks-overview)。請使用公開信任的 TLS 憑證，並在 Proxy 鏈中保留原始主機、通訊協定、路徑、查詢參數、要求本文和 `X-Twilio-Signature` 標頭。來電處理常式會驗證 Twilio 簽章；簡訊傳送狀態使用每則訊息專用的 URL 權杖，按鍵確認使用已簽署的查詢權杖。請勿在共用記錄或螢幕擷取畫面中洩漏權杖。請參閱 [Twilio Webhook 安全性說明](https://www.twilio.com/docs/usage/webhooks/webhooks-security)。

## 4. 分別測試傳送和回呼

1. 在專案的 Twilio 設定中使用**傳送測試簡訊**和**撥打測試電話**，確認目的地手機收到簡訊和來電。
2. 設定使用者已驗證的簡訊/通話聯絡方式和通知規則，然後觸發一次受控的值班警示。按 1，並在 OneUptime 中確認警示已被確認。
3. 在 OneUptime 和 Twilio 訊息記錄中確認簡訊傳送狀態。傳送要求被接受不代表已送達；[Twilio 透過回呼回報後續狀態變更](https://www.twilio.com/docs/messaging/guides/track-outbound-message-status)。

如果傳送失敗，請檢查認證資訊、號碼功能、帳戶限制和輸出連線。如果簡訊或通話已收到，但狀態或確認結果未更新，請檢查回呼 URL 和公開入口記錄。Twilio 的 [HTTP 擷取失敗指南](https://www.twilio.com/docs/api/errors/11200)可協助診斷無法存取的回呼、TLS 問題和 HTTP 錯誤。僅測試通話成功並不能驗證回呼存取。
