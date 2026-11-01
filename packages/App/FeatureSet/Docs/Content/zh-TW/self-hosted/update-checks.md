# 更新與安全性檢查

自架的 OneUptime 每天會向 GitHub 詢問一次：是否有較新的版本發布，以及 OneUptime 發布的某則安全性公告是否影響你正在執行的版本。一旦有公告影響你的版本，系統就會請你的主管理員升級。本頁說明此檢查會傳送什麼、你會看到什麼，以及如何關閉它。

:::cards
- [檢查會傳送什麼](#檢查會傳送什麼): 兩個公開的問題，不涉及你的安裝的任何資訊。
- [你會看到什麼](#你會看到什麼): 頁尾、管理員儀表板，以及每則公告一封電子郵件。
- [關閉檢查](#關閉檢查): 適用於無法存取網際網路的網路，或想改用鏡像時。
:::

## 檢查會傳送什麼

Worker 會向 GitHub 的 API（`api.github.com`）傳送兩個請求，且不攜帶權杖：

| 請求 | 詢問的內容 |
| --- | --- |
| `GET /repos/OneUptime/oneuptime/releases/latest` | 最新的 OneUptime 版本是哪一個 |
| `GET /repos/OneUptime/oneuptime/security-advisories?state=published` | OneUptime 發布了哪些安全性公告、每則公告影響哪些版本，以及修正它的版本 |

這些請求中沒有任何關於你的安裝的資訊：沒有你執行的版本，沒有它的位址，也沒有任何關於你的使用者、專案或監控資料的內容。如同對待任何請求，GitHub 會看到你伺服器的公用 IP 位址，以及一個註明 OneUptime 的 `User-Agent`。某則公告是否影響你的版本，是在你的伺服器上判斷的，也不會有任何瀏覽器呼叫 GitHub。

檢查會在 worker 啟動時執行，之後每天執行一次。它最多每 12 小時向 GitHub 詢問一次；請求失敗後，最多每小時詢問一次。

## 你會看到什麼

只有主管理員會收到通知。只有他們能夠升級，而告訴其他任何人這台伺服器執行著有已知安全問題的版本，就等於指出一台尚未修補的伺服器。

- 有較新的版本時，Dashboard 和管理員儀表板的頁尾會出現 **有可用的更新**。它會開啟升級指南。
- 如果某則已發布的安全性公告影響你正在執行的版本，那裡會改為出現紅色的 **安全性更新**。
- 接著，管理員儀表板的首頁會列出每則公告：它的嚴重程度、它影響的版本、修正它的版本，以及它在 GitHub 上的連結。首頁也會說明檢查上次讀取公告的時間，以及最近一次檢查失敗的原因（如果有失敗的話）。
- 你的主管理員和管理員通知電子郵件（管理員儀表板中的 **設定** > **電子郵件**）會就每則影響你的版本的公告收到一封電子郵件，而且絕不會收到第二封。

一旦你執行的版本不受任何公告影響，這一切就會消失。如何升級，請參閱[升級](/docs/installation/upgrading)。

## 關閉檢查

在無法存取網際網路的網路中，或者你的伺服器不應連線到 GitHub 時，請關閉此檢查。這樣就不會顯示任何內容，也不會寄送任何電子郵件。

:::tabs
@tab Kubernetes
```yaml
updateCheck:
  disabled: true
```
@tab Docker Compose
```bash
DISABLE_UPDATE_CHECK=true
```
在 `config.env` 中設定它，然後執行 `npm start`。
:::

如果要改為對照你網路內部的鏡像進行檢查，請將檢查指向該鏡像。鏡像的回應必須與 GitHub 的格式一致。

| Helm 值 | Docker Compose 設定 | 預設值 |
| --- | --- | --- |
| `updateCheck.url` | `LATEST_RELEASE_CHECK_URL` | `https://api.github.com/repos/OneUptime/oneuptime/releases/latest` |
| `updateCheck.securityAdvisoriesUrl` | `SECURITY_ADVISORIES_CHECK_URL` | `https://api.github.com/repos/OneUptime/oneuptime/security-advisories` |

## 無法連線到 GitHub 時

在無法存取網際網路的網路中，請求失敗是意料中的事，並不是錯誤。Worker 會以 debug 等級記錄它，保留上次讀取到的內容，並在稍後重試。管理員儀表板會顯示上次讀取公告的時間，以及最近一次檢查失敗的原因：GitHub 的速率限制、沒有通往 GitHub 的路由、逾時，或收到的不是 GitHub 的回應。

## 後續步驟

:::cards
- [升級](/docs/installation/upgrading): 升級到較新的版本，一次一個主要版本。
- [架構](/docs/self-hosted/architecture): 自架的 OneUptime 建立的每一個連線。
- [位於 VPN 或防火牆之後](/docs/self-hosted/behind-a-firewall): 從外部連到你的伺服器的內容。
:::
