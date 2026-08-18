# 狀態頁面概觀

狀態頁面是您所監控一切的公開門面:一個 URL,讓您的客戶可以打開來查看,而不必寫信問您是不是只有他們遇到問題。它顯示您選擇公開的服務目前的狀態、您正在處理的事件、您排定的維護作業,以及您想釘選在頂端的任何公告。

當凌晨兩點出問題時,狀態頁面就是您的支援佇列首先連結過去的地方。它也是您的訂閱者會收到通知的來源——所以值得在需要之前就先設定好,而不是等到中斷發生時才做。

狀態頁面位於儀表板左側導覽的 **Status Pages** 之下,屬於 **essentials** 群組。本頁的一切都是以單一狀態頁面為單位:一個專案可以隨意執行多個狀態頁面——一個給客戶的公開頁面、一個給內部觀眾的私人頁面、一個給特定市場的區域頁面。

## 一覽

- **只用兩個欄位建立。** 建立新狀態頁面只需要 **Name** 與 **Description**。資源、品牌與網域都是之後才設定的。
- **資源就是訪客所看到的東西。** 頁面上的每一列都是一個 **Status Page Resource**——一個監測器(或監測器群組),擁有自己的顯示名稱、工具提示與正常運作時間選項。群組把一個長頁面切分成多個區段,並可以巢狀嵌套。
- **從第一天起就有預覽 URL。** 每個狀態頁面都會取得一個預覽連結,讓您在自訂網域存在之前就能檢視它。
- **訪客可見的路由受設定閘控。** 事件、公告、排定事件與訂閱頁面,只有在 **Advanced Settings** 上對應的開關開啟時才會出現。
- **三種讓頁面變成私人的方式。** 私人使用者、主密碼,或 SAML SSO / OIDC——再加上一份 IP 白名單。
- **訂閱者會自動收到通知。** 電子郵件、SMS、Slack、Microsoft Teams 與 Webhook 訂閱者都可以追蹤一個頁面,各個管道各有自己的開關。

## 關鍵術語

| 術語              | 意義                                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Status page**   | 一個公開(或私人)頁面,擁有自己的品牌、網域、資源與訂閱者。即 `StatusPage` 模型。                    |
| **Resource**      | 訪客看到的一列——在頁面上呈現的監測器或監測器群組,擁有顯示名稱與正常運作時間選項。                      |
| **Group**         | 容納資源的具名區段。群組可以巢狀嵌套於其他群組中,每一層都會匯總其下所有項目的狀態。 |
| **Announcement**  | 您發佈到一個或多個狀態頁面的訊息,附有開始時間與選填的結束時間。                                         |
| **Subscriber**    | 透過電子郵件、SMS、Slack、Microsoft Teams 或 Webhook 追蹤此頁面的人(或系統)。                                                  |
| **Custom domain** | 屬於您的網域——例如 `status.example.com`——透過 CNAME 與 SSL 憑證指向該頁面。                                 |
| **Private user**  | 可以登入私人狀態頁面的帳號。與您的 OneUptime 專案使用者是分開的。                                    |

## 建立狀態頁面

1. 開啟 **Status Pages → All Status Pages** 並點選 **Create Status Page**。
2. 在 **Create New Status Page** 對話框中,填寫 **Name**(必填,至少兩個字元),並可選填 **Description**。
3. 點選 **Create Status Page**。

這就是完整的建立表單。回到清單頁後,您會看到 **Name**、**Description**、**Labels** 與 **Owners**,並可依 **Status Page ID**、**Name** 與 **Description** 篩選。

開啟新頁面後,您會進入它的 **Overview** 畫面,上面有兩張卡片:**Status Page Preview URL**,附有指向頁面本身的連結,以及 **Status Page Details**,您可以在此編輯剛剛設定的名稱、描述與標籤。

接下來,依實用性大致排序:

- 新增資源,讓頁面有內容——請見 [Status Page Resources & Groups](/docs/status-pages/resources-and-groups)。
- 設定頁面標題、favicon、標誌與封面,然後附加自訂網域——請見 [Status Page Branding & Domains](/docs/status-pages/branding-and-domains)。
- 決定人們可以透過哪些管道訂閱——請見 [Subscribers & Announcements](/docs/status-pages/subscribers)。
- 在 **Advanced Settings** 下調整頁面上顯示的內容。

## 一切位於何處

開啟狀態頁面後,它自己的左側選單分成九個區段。將此當作本文件群組其餘部分的地圖。

| 區段               | 內容                                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Basic**             | **Overview**、**Announcements**、**Owners**。                                                                                                   |
| **Resources**         | 單一 **Resources** 畫面——左側是群組,右側是所選群組的監測器。                                                |
| **Subscribers**       | **Email Subscribers**、**SMS Subscribers**、**Slack Subscribers**、**MS Teams Subscribers**、**Webhook Subscribers**、**Subscriber Settings**。 |
| **Notification Logs** | **Notification Logs**——已傳送給訂閱者的內容。                                                                                          |
| **Audit**             | **Audit Logs**。                                                                                                                                |
| **Branding**          | **Essential Branding**、**HTML, CSS & JavaScript**、**Custom Domains**、**Header**、**Footer**、**Overview Page**、**Languages**。              |
| **Security**          | **Private Users**、**SSO**、**OIDC**、**SCIM**、**Authentication Settings**。                                                                   |
| **AI**                | **MCP**。                                                                                                                                       |
| **Advanced**          | **Monitor Rules**、**Embedded Status**、**Reports**、**Custom Fields**、**Advanced Settings**、**Delete Status Page**。                         |

在您開始尋找之前,有兩個命名上的小怪癖值得知道:

- 只有在專案啟用監測器群組時,**Resources** 項目才會標示為 **Resources**。否則它會顯示為 **Monitors**。兩者都是同一個畫面。
- 沒有獨立的 Groups 頁面。群組與資源已合併,舊的 `/groups` 路由現在會重新導向到資源畫面。

在單一頁面之外,**Status Pages** 區段本身有一個 **More** 區段,內含 **Announcements**,以及一個收合的 **Settings** 區段,內含 **Announcement Templates**、**Subscriber Templates**、**Custom Fields**、**Owner Rules** 與 **Label Rules**——這些是專案範圍的,由每個狀態頁面共用。

## 訪客看到的內容

公開頁面是它自己的應用程式,擁有一小組路由:

- `/` —— **Overview**。
- `/incidents` 與 `/incidents/:id` —— 事件清單與單一事件。
- `/announcements` 與 `/announcements/:id`。
- `/scheduled-events` 與 `/scheduled-events/:id`。
- `/subscribe/email`、`/subscribe/sms`、`/subscribe/slack`、`/subscribe/microsoft-teams`、`/subscribe/webhooks`。
- `/rss` —— 該摘要。
- `/login`、`/sso` 與 `/master-password` —— 只在私人頁面上有意義。

頂端導覽列一律顯示 **Overview**;其餘項目只在啟用時才會出現。**Incidents**、**Announcements** 與 **Scheduled Events** 各自需要開啟其開關;**Subscribe** 則需要同時開啟 **Show Subscriber Page** 以及至少一個訂閱者管道。私人頁面還會多出一個 **Logout** 項目。

### 概覽頁面

概覽是大多數訪客唯一會看到的頁面。從上到下,它會呈現:

1. **任何進行中的公告**——開始時間已過且結束時間尚未到的公告。
2. **整體狀態橫幅**——一行摘要,說明是所有資源都受影響,還是只有部分資源受影響。
3. **整體正常運作時間百分比**,如果您開啟了此選項。預設為關閉。
4. **資源群組**,各自附有其資源、目前狀態,以及正常運作時間歷史長條圖。
5. **Active Incidents**。
6. **Scheduled Maintenance Events**。

一個全新、什麼都沒有的頁面會顯示空白狀態,告訴您從儀表板新增資源——這正是提示您前往 **Resources** 畫面的信號。

至於一開始是什麼讓事件出現在此頁面上,以及之後又是什麼讓它消失,請見 [Incident States & Severities](/docs/incidents/states-and-severities)。

## 選擇頁面上顯示的內容

大部分顯示開關都集中在同一處:**Status Pages → your page → Advanced → Advanced Settings**。每張卡片都有自己的 **Edit Settings** 按鈕。

**Incident Settings**:

- **Show Incidents**(`showIncidentsOnStatusPage`)—— 預設開啟。關閉後也會移除 **Incidents** 導覽項目。
- **Show Incident History (in days)**(`showIncidentHistoryInDays`)—— 事件清單回溯的天數。預設為 14。
- **Show Incident Labels**(`showIncidentLabelsOnStatusPage`)—— 預設關閉。

**Episode Settings** —— 針對事件片段的相同三個開關:**Show Episodes**(`showEpisodesOnStatusPage`,預設開啟)、**Show Episode History (in days)**(預設 14)、以及 **Show Episode Labels**(預設關閉)。事件片段是自己的模型,擁有自己的端點,而不是事件的某種檢視。

**Announcement Settings**:

- **Show Announcements**(`showAnnouncementsOnStatusPage`)—— 預設開啟。
- **Show Announcement History (in days)**(`showAnnouncementHistoryInDays`)—— 預設為 14。

**Scheduled Event Settings**:

- **Show Scheduled Maintenance Events**(`showScheduledMaintenanceEventsOnStatusPage`)—— 預設開啟。
- **Show Scheduled Event History (in days)**(`showScheduledEventHistoryInDays`)—— 預設為 14。
- **Show Event Labels**(`showScheduledEventLabelsOnStatusPage`)—— 預設關閉。

**Uptime History Settings**:

- **Show Uptime History (in days)**(`showUptimeHistoryInDays`)—— 每個資源旁正常運作時間長條圖的長度。預設為 90,且必須介於 1 到 90 之間。資源或群組上每個 **Show Uptime %** 與 **Show Status History Chart** 選項都讀取這個數字。

**Subscriber Settings**:

- **Show Subscriber Page**(`showSubscriberPageOnStatusPage`)—— 預設開啟,再加上五個各管道啟用開關。相同的管道開關也出現在 **Subscribers** 區段下專屬的 **Subscriber Settings** 畫面上;請將該處視為設定它們的正式位置。

**Powered By OneUptime Branding**:

- **Hide Powered By OneUptime Branding** —— 預設關閉,所以訪客頁尾會顯示「Powered by OneUptime」,直到您開啟此選項為止。

**顏色設定在哪裡。** 正常運作時間長條的顏色不在這裡——**Default Bar Color**、長條顏色規則、**Downtime Monitor Statuses** 與 **Show Overall Uptime Percent** 都在 **Status Pages → your page → Branding → Overview Page**。這裡沒有任何主題或品牌顏色設定;超出這些控制項的部分都要用 **Custom CSS** 完成。

## 上線前先預覽

每個狀態頁面的 **Overview** 畫面都有一張 **Status Page Preview URL** 卡片,附有直接連到頁面的連結。在您還在新增資源、還沒有自訂網域時使用它。

在幕後,每個公開路由都在 `/status-page/{statusPageId}/...` 下有一個預覽對應版本——預覽概覽頁、預覽事件清單、預覽訂閱頁面等等。這代表從儀表板預覽取得的 URL 或截圖,一旦附加了自訂網域,將與客戶實際看到的內容不同,所以貼到 runbook 或電子郵件中的任何連結都要再三檢查。

## 限制誰能看到此頁面

不是每個狀態頁面都是公開的。所有控制項都在 **Security** 區段之下。

### 私人使用者

在 **Status Pages → your page → Security → Authentication Settings**(`isPublicStatusPage` 欄位)關閉 **Is Visible to Public**。訪客接著會落在 `/login`,必須登入才能繼續。

在 **Status Pages → your page → Security → Private Users** 新增可以登入的人員。這裡有一個 **Add in Bulk** 動作——貼上一份電子郵件地址清單,每個人都會收到一封邀請信。私人使用者有自己的忘記密碼與重設密碼流程,與您的 OneUptime 專案帳號是分開的。

### 主密碼

**Authentication Settings** 也有一張 **Master Password** 卡片,附有 **Require Master Password** 開關與密碼本身。訪客接著會前往 `/master-password`,用一個共用的密碼解鎖頁面。

**主密碼與私人使用者不能並存。** 主密碼開啟時,私人使用者驗證會被停用,**Private Users** 畫面會顯示橫幅告知此事。

### SSO 與 OIDC

若要將私人頁面連結到您的身分識別提供者,**Status Pages → your page → Security → SSO** 設定 SAML(登入 URL、發行者、x509 憑證、簽章與摘要方法),**Status Pages → your page → Security → OIDC** 設定 OpenID Connect(探索 URL、發行者、用戶端 ID 與密鑰、範圍、宣告名稱)。**SCIM** 會自動從身分識別提供者佈建私人使用者。這些功能受方案功能閘控,因此並非每個安裝都會提供。

**SSO Settings** 卡片提供 **Force SSO for Login**(`requireSsoForLogin`,預設關閉)。在開啟之前請先測試您的 SSO 設定——如果設定不正確,您會把自己鎖在狀態頁面之外。

### IP 白名單

**Authentication Settings** 也有一張 **IP Whitelist** 卡片,由 `ipWhitelist` 欄位支援,適用於只應回應已知網路的頁面。

## 嵌入式徽章與 RSS 摘要

有兩種方式可以在頁面本身之外呈現狀態。

**Embedded status badge。** 在 **Status Pages → your page → Advanced → Embedded Status** 的 **Embedded Status Badge** 卡片中開啟 **Enable Embedded Status Badge**(`enableEmbeddedOverallStatus`,預設關閉)。它會搭配一個 `embeddedOverallStatusToken`,並從 `/badge/:statusPageId` 提供徽章,讓您可以把目前的整體狀態嵌入您的文件、應用程式頁尾或行銷頁面中。

**RSS feed。** 每個狀態頁面都會提供 `/rss`——一個標題為「{status page name} Updates」的摘要,其項目分別以 `Incident: `、`Announcement: ` 與 `Scheduled Maintenance: ` 開頭。適合寧願把您的更新匯入閱讀器或聊天機器人,而不是透過電子郵件訂閱的人。

如果您想自行擷取資料,狀態頁面背後有公開的讀取端點,涵蓋概覽、事件、排定維護事件、公告與片段——請見 [Public API](/docs/status-pages/public-api)。

## 接下來可以閱讀

- [狀態頁資源與群組](/docs/status-pages/resources-and-groups) —— 把監測器放上頁面並組織成區段。
- [狀態頁品牌與網域](/docs/status-pages/branding-and-domains) —— 標誌、favicon、頁尾、自訂程式碼,以及將您自己的網域指向此頁面。
- [訂閱者與公告](/docs/status-pages/subscribers) —— 五種訂閱者管道、雙重確認選擇加入,以及發佈公告。
- [公開 API](/docs/status-pages/public-api) —— 以程式化方式讀取狀態頁面資料。
- [事件概觀](/docs/incidents/index) —— 出現在頁面上的事件。
- [事件狀態與嚴重程度](/docs/incidents/states-and-severities) —— 什麼會讓事件出現在狀態頁面上,以及什麼會讓它消失。
