# Slack 整合

將自架 OneUptime 專案連接到 Slack，以傳送通知並使用事件操作、指令和訊息事件。

## 設定

1. 依下文設定 OneUptime 主機名稱和 HTTPS。在 **Settings > Slack Integration** 複製產生的應用程式資訊清單，也可從 `https://your-oneuptime-domain.com/api/slack/app-manifest` 取得。
2. 使用自己部署產生的資訊清單，在工作區中[建立 Slack 應用程式](https://api.slack.com/apps)，確保 URL 與主機名稱一致。
3. 將應用程式 **Basic Information** 中的 **Client ID**、**Client Secret** 和 **Signing Secret** 複製到 Docker Compose 的 `config.env`：

   ```dotenv
   SLACK_APP_CLIENT_ID=YOUR_SLACK_APP_CLIENT_ID
   SLACK_APP_CLIENT_SECRET=YOUR_SLACK_APP_CLIENT_SECRET
   SLACK_APP_SIGNING_SECRET=YOUR_SLACK_APP_SIGNING_SECRET
   ```

   Helm 使用以下設定：

   ```yaml
   slackApp:
     clientId: "YOUR_SLACK_APP_CLIENT_ID"
     clientSecret: "YOUR_SLACK_APP_CLIENT_SECRET"
     signingSecret: "YOUR_SLACK_APP_SIGNING_SECRET"
   ```

4. 套用設定並等待 OneUptime 重新啟動。如果設定簽章密鑰前 Events URL 驗證失敗，請現在重試。
5. 返回 **Settings > Slack Integration**，選擇 **Connect to Slack** 並授權應用程式。使用需要使用者身分的操作時，也請在 OneUptime 連接個人 Slack 帳號。

## 自架部署的網路存取

### 流量方向與端點

| 流量 | 所需存取 |
| --- | --- |
| OneUptime → Slack | DNS 和 TCP 443 輸出 HTTPS：Web API 與 OAuth 權杖交換使用 `slack.com`；指令回覆及使用中的傳入 Webhook 通知使用 `hooks.slack.com` |
| Slack → OneUptime | 完整整合需要透過 TCP 443 公開 HTTPS 存取下列四個 POST 路由 |
| 使用者瀏覽器 → OneUptime | 儀表板和 OAuth 重新導向 `/api/slack/auth/:projectId/:userId`、`/api/slack/auth/:projectId/:userId/user`；可維持僅透過使用者 VPN 存取 |

這些輸出網域描述的是 OneUptime 整合，並非 Slack 用戶端或所有功能的完整允許清單。Slack 的「傳入 Webhook」由 Slack 託管：OneUptime 向它傳送請求，它不是 OneUptime 伺服器的輸入端點。參閱 [Slack 傳入 Webhook 指南](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/)。

透過 ingress 將下列供應商回呼轉送到 OneUptime 應用程式：

| 方法與路徑 | 用途 |
| --- | --- |
| `POST /api/slack/events` | Events API 驗證、表情回應、提及與訊息 |
| `POST /api/slack/interactive` | 按鈕、捷徑、互動視窗提交、`/incident` 和 `/maintenance` |
| `POST /api/slack/options-load` | 互動式選單選項請求 |
| `POST /api/slack/command` | `/oneuptime` 指令 |

OAuth 透過[瀏覽器重新導向，再由伺服器交換權杖](https://docs.slack.dev/authentication/installing-with-oauth/)。資訊清單將 `/api/slack/auth` 登錄為重新導向前綴，OneUptime 在授權時附加專案和使用者路徑。瀏覽器能存取，不代表 Slack 能傳遞事件或按鈕操作。

### 私有部署與回呼安全

使用公開 DNS，以及具有公開信任 HTTPS 憑證、完整憑證鏈和通往 OneUptime ingress 私有路由的閘道。允許輸入 TCP 443，只公開上述供應商 POST 回呼。私有 `ClusterIP`、內部 DNS 或員工 VPN 本身無法讓供應商存取。使用分割 DNS，可在同一主機名稱下維持儀表板與瀏覽器 OAuth 路由私有。

在 `config.env` 設定 `HOST=oneuptime.example.com` 和 `HTTP_PROTOCOL=https`，或在 Helm 設定 `host: oneuptime.example.com` 和 `httpProtocol: https`。套用設定並等待重新啟動。這些值產生 URL，不會自動設定 DNS、TLS 或防火牆。 變更主機名稱後，重新產生並更新 Slack 資訊清單。

保留方法、路徑、查詢字串、原始本文、`Content-Type`、`X-Slack-Signature` 和 `X-Slack-Request-Timestamp`。透過可信任的代理標頭保留公開主機與 HTTPS 通訊協定。回呼應豁免瀏覽器 SSO、CAPTCHA 和代理登入頁，但維持 OneUptime 的簽章與時間戳記驗證。同步伺服器時鐘。來源 IP 檢查不能取代 [Slack 簽章驗證](https://docs.slack.dev/authentication/verifying-requests-from-slack/)。

### 驗證存取與了解限制

在 **Event Subscriptions** 驗證 Events Request URL：Slack 會[傳送 POST 驗證請求並檢查 TLS](https://docs.slack.dev/apis/events-api/using-http-request-urls/)。接著傳送測試通知、執行斜線指令、點擊事件按鈕並觸發已訂閱事件。檢查閘道與 OneUptime 記錄，不要記錄機密。Slack 要求即時確認，包括[互動請求須在三秒內回應](https://docs.slack.dev/interactivity/handling-user-interaction/)。瀏覽器 GET 或傳送訊息成功無法驗證這些 POST 回呼。

如果禁止所有輸入連線，已授權應用程式仍可透過輸出 HTTPS 傳送訊息，但事件、按鈕、捷徑和指令無法運作。OneUptime 資訊清單使用 HTTP 回呼並停用 Socket Mode；啟用 Slack Socket Mode 並非支援的替代方式。[私有網路存取設定](/docs/self-hosted/private-network-access)控制傳往私有目的地的輸出請求，不會公開回呼。
