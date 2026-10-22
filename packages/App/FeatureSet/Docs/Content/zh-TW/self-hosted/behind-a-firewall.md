# 位於 VPN 或防火牆之後

自行託管的 OneUptime 可以完全不暴露在公用網際網路上：它透過對外連線傳送每一則警示。不過，仍有幾樣東西需要從外部傳回來：值班人員在訊息中點選 **Acknowledge**，Twilio 回報通話中按下的按鍵，Slack 回報按鈕點擊。本頁逐一列出這些情況，以及每種情況下由誰、透過哪條路徑連線到你的伺服器，讓你只發布用到的部分，或者什麼都不發布。

:::cards
- [誰會連線到你的伺服器](#誰會連線到你的伺服器): 值班人員的手機，以及傳送回呼的供應商。
- [全部保持私有](#全部保持私有): 讓值班人員的手機連上你的 VPN。
- [只發布確認頁面](#只發布確認頁面): 為確認連結開一個窄小的入口。
- [供應商回呼](#供應商回呼): Telegram、Twilio、WhatsApp、Slack 和 Microsoft Teams。
:::

## 誰會連線到你的伺服器

傳送從不需要輸入存取：OneUptime 會主動連線到你的郵件伺服器、Twilio、Telegram、Meta、Slack、Microsoft 和推播中繼。從外部傳入的是下列其中一種情況：

| 發生什麼事 | 誰連線到你的伺服器 | 能否用來源位址允許清單涵蓋？ |
| --- | --- | --- |
| 值班人員在電子郵件、簡訊、WhatsApp 或 Telegram 訊息中點選 **Acknowledge** | 值班人員的手機或電腦 | 否：它從值班人員所在的任何地方連線 |
| 值班人員在 OneUptime On-Call 應用程式中確認 | 值班人員的手機 | 否：原因同上 |
| 值班人員在值班呼叫電話中按 1 | Twilio | 僅在使用 Twilio 的 Static Proxy for Webhooks 時可以 |
| 有人連結自己的 Telegram 帳戶 | Telegram | 可以；也可以輪詢 Telegram，什麼都不放行 |
| 有人點擊 Slack 或 Microsoft Teams 訊息上的按鈕 | Slack 或 Microsoft | 否：兩者都不公布固定位址 |
| WhatsApp 回報訊息已送達或已讀 | Meta | 否：Meta 不公布固定位址 |

自行託管的伺服器直接與這些供應商通訊，從不經過 OneUptime 自己的伺服器，因此不存在需要放行的 OneUptime 位址清單。

## 全部保持私有

讓值班人員的手機連上你的 VPN：設為一律連線，或在存取你的 OneUptime 主機名稱時視需要連線，這樣就沒有人需要在凌晨 3 點確認呼叫之前先手動連線。在什麼都不發布的情況下：

- 電子郵件、簡訊、WhatsApp 和 Telegram 訊息中的確認連結都能開啟，因為手機可以連到你的伺服器。
- OneUptime On-Call 應用程式可以正常使用：把它指向你伺服器的位址即可。推播通知不需要輸入存取，因為伺服器會透過推播中繼傳送它們。
- 開啟輪詢後，大家就能連結自己的 Telegram 帳戶（請參閱 [Telegram](#telegram)）。

通訊應用程式中的連結會在該應用程式的內建瀏覽器或手機的預設瀏覽器中開啟，絕不會在 OneUptime 應用程式中開啟。因此，個別應用程式 VPN 必須涵蓋通訊應用程式和瀏覽器，而不只是 OneUptime 應用程式。

在電話中按 1、Slack 和 Microsoft Teams 訊息上的按鈕，以及 WhatsApp 的送達回條，仍然需要各自的供應商能連到你的伺服器。

## 只發布確認頁面

如果值班人員的手機無法使用你的 VPN，就只發布確認連結開啟的頁面，其他一概不發布。在 OneUptime 前面放一個反向代理，或一個對外通道（例如 Cloudflare Tunnel，它不需要任何輸入防火牆規則），並且只放行下列路徑：

| 方法 | 路徑 | 提供的內容 |
| --- | --- | --- |
| GET | `/l/*` | 簡訊、WhatsApp 和 Telegram 訊息中的短連結 |
| GET | `/api/user-notification-log-timeline/acknowledge-page/*` | 顯示呼叫內容和 **Acknowledge** 按鈕的頁面 |
| GET | `/api/user-notification-log-timeline/acknowledge/*` | **Acknowledge** 按鈕 |
| GET | `/api/user-notification-log-timeline/pass-on-page/*` | 選用：把呼叫轉交給下一個人的頁面 |
| POST | `/api/user-notification-log-timeline/pass-on/*` | 選用：該頁面上的按鈕 |
| GET | `/oneuptime-assets/*` | 這些頁面的字型、樣式和標誌 |

:::steps
### 將公開主機名稱指向代理
訊息中的連結是根據你的 `HOST` 設定產生的，因此該名稱必須能公開解析到代理，並搭配公開信任的憑證。使用分割 DNS 時，你網路中的人仍會把它解析到私有位址，其他一切照舊使用。

### 原封不動地轉送這些路徑
把這些路徑連同其方法、路徑和查詢字串一起送到 OneUptime 的 ingress，其餘請求一律回應 404。

### 為它們設定速率限制
每個連結都帶有一個隨機 ID，短連結的長度為八個字母。限制每個位址可以發出的請求數，讓任何人都無法快速嘗試 ID。
:::

值班人員確認後，頁面會在儀表板中開啟該警示，而儀表板只能在你的網路內載入。此時確認已經儲存好了。

## 供應商回呼

### Telegram

傳送警示只需要連到 `api.telegram.org` 的對外 HTTPS。連結帳戶則需要你的伺服器收到使用者傳給你的機器人的 `/start` 訊息，方式有下列兩種：

- **輪詢**：在 **Admin Dashboard > 設定 > Telegram** 中開啟 **Poll Telegram for Messages**。OneUptime 每隔幾秒透過對外 HTTPS 從 Telegram 擷取機器人的訊息，因此不需要任何外部連線進入你的伺服器。
- **Webhook**：Telegram 會把每則訊息 POST 到 `POST /api/notification/telegram/webhook`。Telegram 從 `149.154.160.0/20` 和 `91.108.4.0/22` [傳送 webhook](https://core.telegram.org/bots/webhooks)，因此你可以只允許這些位址。

### Twilio

值班人員按 1 確認電話呼叫時，Twilio 會把按鍵 POST 到 `POST /api/user-notification-log-timeline/call/gather-input/*`。Twilio 傳送 webhook 的位址會變動，除非你的 Twilio 版本包含 [Static Proxy for Webhooks](https://www.twilio.com/docs/iam/twilio-editions/twilio-static-proxy)。簡訊傳送狀態更新和來電請參閱 [Twilio 整合](/docs/self-hosted/twilio-integration)。

### WhatsApp

警示和確認都不需要任何輸入存取。Meta 會把送達回條和已讀回條 POST 到 `/api/notification/whatsapp/webhook`；沒有這些回條，OneUptime 的 WhatsApp 記錄就無法顯示訊息在被 Meta 接受之後是已送達、已讀還是失敗了。Meta 會為每個請求簽署，並且不公布固定位址。

### Slack 和 Microsoft Teams

它們訊息上的按鈕、選單和指令會從兩者都不公布的位址呼叫你的伺服器。這些路徑以及如何發布它們，請參閱 [Slack 整合](/docs/self-hosted/slack-integration) 和 [Microsoft Teams 整合](/docs/self-hosted/microsoft-teams-integration)。

## 後續步驟

:::cards
- [Twilio 整合](/docs/self-hosted/twilio-integration): 透過你自己的 Twilio 帳戶傳送簡訊和撥打電話。
- [推播通知](/docs/self-hosted/push-notifications): 推播中繼，以及你的伺服器和手機需要連到的位址。
- [應用程式概觀](/docs/mobile-desktop-apps/index): 將 OneUptime On-Call 應用程式連線到你的伺服器。
- [私有網路存取](/docs/self-hosted/private-network-access): 反方向：讓 OneUptime 存取你的內部工具。
:::
