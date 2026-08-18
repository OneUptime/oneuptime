# 訂閱者與公告

狀態頁面是人們主動前往的地方。訂閱者則是不想每次都跑一趟的人——他們把電子郵件地址、電話號碼、Slack Webhook 或 HTTP 端點交給你一次，之後更新就會自己送上門。

公告負責同一件事的另一半。監測器可以告訴訪客結帳一直回傳 500；但沒有任何監測器能告訴他們你週六要遷移資料庫、某個第三方供應商今天狀況不好，或是他們昨天讀到的那起事件已經完全收尾。公告是自由文字的管道，用來說明你的檢查看不到的一切，而且會發送給同一份訂閱者名單。

本頁兩者都會談到：五種訂閱管道以及訪客如何註冊、訂閱者可以選擇收到哪些內容、雙重確認與取消訂閱的流程，還有公告怎麼寫、怎麼排程、怎麼做成範本。

## 訂閱管道

狀態頁面支援五種管道，每一種在狀態頁面上都有自己的開關。前往 **狀態頁面 → 你的頁面 → 訂閱者 → 訂閱者設定**：

- **啟用電子郵件訂閱者**（`enableEmailSubscribers`）——預設開啟。在你打開之前，其餘管道全都是關的。
- **啟用 SMS 訂閱者**（`enableSmsSubscribers`）——預設關閉。
- **啟用 Slack 訂閱者**（`enableSlackSubscribers`）——預設關閉。
- **啟用 Microsoft Teams 訂閱者**（`enableMicrosoftTeamsSubscribers`）——預設關閉。
- **啟用 Webhook 訂閱者**（`enableWebhookSubscribers`）——預設關閉。

每個管道在狀態頁面側邊選單的 **訂閱者** 底下也各有一份清單：**電子郵件訂閱者**、**SMS 訂閱者**、**Slack 訂閱者**、**MS Teams 訂閱者** 與 **Webhook 訂閱者**。你在那裡查看誰註冊了、手動加人，或替某位訂閱者留下一則 **備註**（`internalNote`）。

**只開一個開關還不夠。** 狀態頁面導覽列上的 **訂閱** 項目，只有在 **顯示訂閱者頁面**（`showSubscriberPageOnStatusPage`）開啟*而且*至少啟用一種管道時才會出現。如果你打開了 **啟用電子郵件訂閱者** 卻沒開 **顯示訂閱者頁面**，訪客根本走不到那張表單。

同樣這五個開關會在 **進階設定** 的 **訂閱者設定** 卡片上再出現一次，旁邊還有 **顯示訂閱者頁面**。它們底下是同一批欄位——挑一個畫面用到底就好，而且建議用專屬的 **訂閱者設定** 頁面，因為其餘的訂閱者設定都在那裡。

## 訪客在訂閱頁面上看到什麼

**訂閱** 頁面有一列子選單，每個已啟用的管道各一個分頁——**電子郵件**、**簡訊**、**Slack**、**MS Teams**、**Webhook**——分別對應 `/subscribe/email`、`/subscribe/sms`、`/subscribe/slack`、`/subscribe/microsoft-teams` 與 `/subscribe/webhooks`。每個分頁只問它最低限度需要的資料：

- **電子郵件**——標題 **透過電子郵件訂閱**，一個欄位 **您的電子郵件**，預留文字為 `subscriber@company.com`。
- **簡訊**——標題 **透過簡訊訂閱**，一個欄位 **您的電話號碼**，預留文字為 `+11234567890`。
- **Slack**——標題 **透過 Slack 訂閱**，包含 **Slack 工作區名稱**（用於驗證）與 **Slack 傳入 Webhook URL**，預留文字為 `https://hooks.slack.com/services/...`。
- **MS Teams**——標題 **透過 Microsoft Teams 訂閱**，包含 **Microsoft Teams 工作區名稱** 與 **Microsoft Teams 傳入 Webhook URL**，預留文字為 `https://outlook.office.com/webhook/...`。
- **Webhook**——標題 **透過 Webhook 訂閱**，一個欄位 **Webhook URL**。每次狀態頁面事件發生時，都會向它送出一個 JSON `POST` 請求。

送出按鈕寫著 **訂閱**，註冊成功會顯示 *您已成功訂閱。*。這個頁面還分成 **新訂閱** 與 **管理現有訂閱** 兩邊，讓已經訂閱過的人不必翻舊信也能回到自己的偏好設定。

## 讓訂閱者自己挑資源與事件類型

預設情況下，訂閱者會收到頁面上的所有內容。**進階訂閱者設定** 卡片中的兩個開關可以改變這一點：

- **允許訂閱者選擇資源**（`allowSubscribersToChooseResources`）——預設關閉。打開後，訂閱表單會多出一個 **訂閱所有資源** 開關；取消勾選就會出現 **選擇要訂閱的資源**，讓訪客逐一挑選資源。
- **允許訂閱者選擇事件類型**（`allowSubscribersToChooseEventTypes`）——預設關閉。做法一樣：一個 **訂閱所有事件類型** 開關，取消勾選後底下出現 **選擇要訂閱的事件類型**。

事件類型有 `Incident`、`Announcement` 與 `Scheduled Event`。

這些選擇會寫進訂閱者記錄的 **Is Subscribed to All Resources**（`isSubscribedToAllResources`，預設 true）、**Is Subscribed to All Event Types**（`isSubscribedToAllEventTypes`，預設 true）、**Subscribed to Resources** 與 **Subscribed to Event Types**。

適合這種情況：一個頁面涵蓋好幾項產品。只用你 API 的客戶不想在行銷網站每次抖一下時都被通知——與其眼睜睜看著他整個退訂，不如讓他自己把範圍縮小。

同一張卡片上還有 **訂閱者時區**。

## 電子郵件的雙重確認

電子郵件訂閱者一律要確認。當一筆訂閱者記錄以電子郵件地址建立、而且不是在建立時就標為已確認，**Is Subscription Confirmed**（`isSubscriptionConfirmed`）會被強制設為 `false`，同時產生一組六位數的 **Subscription Confirmation Token**。接著 OneUptime 會寄出一封確認信，連結的形式是 `{statusPageUrl}/confirm-subscription/{statusPageSubscriberId}?verification-token={token}`。訪客會進到 **確認訂閱** 頁面，通過之後看到 *訂閱確認成功*。

SMS、Slack、Microsoft Teams 與 Webhook 訂閱者跳過這一關——它們建立時 `isSubscriptionConfirmed` 就已經是 `true`。

**沒確認就等於沒聲音。** 發送通知時撈取訂閱者的查詢會過濾 `isUnsubscribed: false` 與 `isSubscriptionConfirmed: true`。從沒點過連結的電子郵件地址會留在 **電子郵件訂閱者** 清單裡，卻什麼都收不到。有人堅稱自己訂閱了卻毫無音訊時，先看這一欄。

沒有任何開關可以關掉電子郵件確認——只要是從狀態頁面註冊的人，一律適用。另有一個逐筆訂閱者的欄位 **Send You Have Subscribed Message**（`sendYouHaveSubscribedMessage`，預設 true），控制訂閱者確認之後那封「你已訂閱」的信要不要寄出。

## 管理與取消訂閱

每封寄給訂閱者的信都帶著一個取消訂閱連結，形式為 `{statusPageUrl}/update-subscription/{statusPageSubscriberId}`。那個頁面標題是 **更新訂閱**，並告訴訪客可以在這裡更新偏好或取消訂閱。頁面上有：

- 這個狀態頁面允許的資源與事件類型選單。
- 一個 **取消訂閱** 開關，說明是取消訂閱所有資源。它會寫入 **已取消訂閱**（`isUnsubscribed`，預設 false）。
- 一個寫著 **更新訂閱** 的送出按鈕；儲存後顯示 *您的變更已儲存。*。

弄丟連結的人可以在 **訂閱** 頁面上用 **管理現有訂閱**，然後按 **傳送管理連結**。OneUptime 會回覆說含連結的信已寄出，若沒收到請檢查垃圾郵件匣。

支撐這一切的端點是 `POST .../subscribe/:statusPageId`、`POST .../manage-subscription/:statusPageId`、`POST .../get-subscription/:statusPageId/:subscriberId` 與 `PUT .../update-subscription/:statusPageId/:subscriberId`。

取消訂閱只是翻動一個旗標，不會刪掉整筆資料，所以記錄仍會留在管道清單裡並標示 **已取消訂閱**——之後要解釋某個地址為什麼不再收信時，這很有用。

## 訂閱者會收到哪些通知

訂閱者會收到上述三種事件類型的通知，但每個來源各有自己的開關，所以不會有東西誤送出去。

### 公告通知

公告本身帶著 **Should subscribers be notified?**（`shouldStatusPageSubscribersBeNotified`），在建立表單上呈現為 **通知狀態頁面訂閱者** 核取方塊，預設開啟。如果公告在 **受影響的監測器（選填）** 中指定了監測器，通知範圍就限縮到那些監測器；留空則通知所有訂閱者。

### 排定維護事件

排定維護事件有自己的一組訂閱者欄位：**Should subscribers be notified when event is created?**、**Should subscribers be notified when event is changed to ongoing?**、**Should subscribers be notified when event is changed to ended?**，再加上用於事前預告的 **Subscriber notifications before the event** 與 **Next subscriber notification before the event at?**。事件上的 **狀態頁面** 決定它出現在哪些頁面，而 **Should be visible on status page?** 決定它到底要不要出現。

### 事件

`Incident` 是第三種事件類型。至於一起事件最初是怎麼登上狀態頁面的——它牽涉哪些資源、哪些狀態會讓它持續顯示——請見[事件狀態與嚴重程度](/docs/incidents/states-and-severities)。

狀態頁面側邊選單裡的 **通知日誌** 區段（`{id}/notification-logs`），就是你需要查看這個頁面實際送出了什麼時該去的地方。

## 自訂通知範本

**訂閱者設定** 上的 **通知範本** 卡片列出這個狀態頁面使用的範本，欄位有 **範本名稱**、**事件類型** 與 **通知方式**——所以你可以依事件類型、依管道調整措辭，而不必所有情況都套同一段公版文字。

專案層級的範本則在上一層，位於 **狀態頁面 → 設定 → 訂閱者範本**，就在 **公告範本** 旁邊。

## 電子郵件頁尾、自訂 SMTP 與 Twilio

**訂閱者設定** 上另外三張卡片控制訂閱者訊息如何離開你的專案：

- **電子郵件頁尾設定**——**啟用自訂電子郵件頁尾文字** 與 **訂閱者電子郵件通知頁尾文字** 讓你在訂閱者信件上放自己的頁尾。
- **自訂 SMTP**——**自訂 SMTP 設定** 讓訂閱者信件改走你自己的郵件伺服器，而不是預設的那一台。
- **Twilio 設定**——**Twilio 設定** 是 SMS 訂閱者所使用的 Twilio 帳號。

如果你有電子郵件訂閱者，自訂 SMTP 值得及早設好：從你自己網域寄出的信被過濾掉的機率低得多，而凌晨兩點讀信的客戶也更願意相信它。

## 公告

公告是一筆專案層級的記錄（`StatusPageAnnouncement` 模型），你把它分送到一個或多個狀態頁面，可以選擇性地限縮到特定監測器，並設定它顯示的時間區間。

你可以從 **狀態頁面 → 更多 → 公告** 建立，或是在個別狀態頁面的側邊選單中從 **公告** 建立。建立表單是一個四步驟精靈：

1. **基本資訊**——**公告標題**（必填，至少兩個字元）、**描述**（Markdown，選填）與 **附件**，用來放應該隨公告一起顯示在狀態頁面上的檔案。
2. **狀態頁面**——**在這些狀態頁面上顯示公告**，這是必填的多選欄位。一則公告可以同時投放到多個頁面。
3. **受影響的資源**——**受影響的監測器（選填）**。如果一個都不選，所有訂閱者都會收到通知。
4. **排程與設定**——**開始顯示公告於**（必填，預設為現在）、**公告顯示結束於**（選填）與 **通知狀態頁面訂閱者**（預設開啟）。

訪客在 `/announcements` 讀公告，內容分成 **進行中公告** 與 **過往公告**，每則都標註 **公告於**。目前生效中的公告也會釘在總覽頁面最上方。沒有東西可顯示時，頁面會寫著 *無公告*，並註明目前尚未發佈任何公告。

附件由 `GET {statusPageCrudPath}/status-page-announcement/attachment/:statusPageId/:announcementId/:fileId` 提供，並套用與狀態頁面本身相同的讀取檢查——所以私人頁面上的附件依然是私人的。

## 公告排程的運作方式

**Show At**（`showAnnouncementAt`）與 **End At**（`endAnnouncementAt`）主導一切，但總覽頁面和公告清單問的問題不一樣，這個差別常讓人踩坑。

- **總覽頁面** 在 `showAnnouncementAt` 已經過去、而 `endAnnouncementAt` 還在未來或根本沒填時顯示公告。
- **`/announcements` 清單** 顯示 `showAnnouncementAt` 落在 **顯示公告歷史記錄（天數）**（`showAnnouncementHistoryInDays`，預設 14）範圍內的公告，然後在前端把它們分成進行中與過往。

有兩個後果值得先想好：

- **沒有結束日期的公告永遠不會過期。** 把 **公告顯示結束於** 留空，它就會無限期釘在總覽頁面上。凡是有時效的內容都設個結束時間。
- **舊但仍生效的公告可能從清單中消失。** 如果它的開始時間早於 `showAnnouncementHistoryInDays`，它會從 `/announcements` 掉出去，但仍留在總覽頁面上。如果你會掛長期公告，就把歷史區間調大。

公告到底要不要顯示，由 **進階設定** 上的 **公告設定** 卡片控制：**顯示公告**（`showAnnouncementsOnStatusPage`，預設 true）與 **顯示公告歷史記錄（天數）**（預設 14）。**顯示公告** 關閉時，公告端點會直接拒絕請求。

## 公告範本

如果你會反覆張貼同一類通知——每月的維護預告、週期性的第三方服務降級——就先做成範本。**狀態頁面 → 設定 → 公告範本** 存放的是 `StatusPageAnnouncementTemplate` 模型，它的表單會問 **範本名稱**、**範本描述**、**公告標題**、**描述**、**在這些狀態頁面上顯示公告**、**受影響的監測器（選填）** 與 **通知訂閱者**，所以投放範圍和通知與否只需決定一次，不必每次重來。

## Webhook 訂閱者與 SSRF 防護

Webhook 訂閱者會在每次狀態頁面事件時收到一個 JSON `POST` 請求，這使它成為把狀態頁面更新導進你自己系統最省事的方式——聊天機器人、內部儀表板、工單佇列都行。

由於訂閱是公開頁面上的公開操作，OneUptime 會守住目標位址：

- 一般的 **Webhook URL** 在被接受前會先驗證，私有位址、回送位址、連結本機位址與雲端中繼資料位址一律拒絕。你無法把訂閱指向 OneUptime 部署自身網路裡的東西。
- **Slack 傳入 Webhook URL** 必須以 `https://hooks.slack.com/services/` 開頭。

如果 Webhook 訂閱在註冊時被拒，先檢查是不是內部網址或格式有誤。

## 接下來可以閱讀

- [狀態頁概觀](/docs/status-pages/index)——狀態頁面是什麼，以及它由哪些部分組成。
- [狀態頁資源與群組](/docs/status-pages/resources-and-groups)——訂閱者可以挑選的監測器與群組。
- [狀態頁品牌與網域](/docs/status-pages/branding-and-domains)——自訂網域、標誌，以及你信件所指向那個頁面的外觀。
- [公開 API](/docs/status-pages/public-api)——以程式方式讀取狀態頁面資料。
- [事件狀態與嚴重程度](/docs/incidents/states-and-severities)——什麼會把事件放上狀態頁面，什麼又會把它拿下來。
- [事件設定與自動化](/docs/incidents/settings)——事件溝通背後的專案層級規則。
