# 訂閱者與公告

狀態頁面是人們會前往查看的地方。訂閱者則是那些寧可不必親自前往的人——他們只需交給你一次電子郵件地址、電話號碼、Slack Webhook 或 HTTP 端點，之後你的更新就會主動傳送給他們。

公告是同一項工作的另一半。監測器可以告訴訪客結帳功能正回傳 500 錯誤；但沒有任何監測器能告訴訪客你將於週六遷移資料庫、某個第三方服務商今天狀況不佳，或是他們昨天讀到的事件已經完全結束。公告是自由文字的溝通管道，用來傳達你的檢查機制無法察覺的一切事情，並且會分送給同一份訂閱者名單。

本頁涵蓋兩者：五種訂閱管道與訪客的註冊方式、訂閱者可以選擇接收哪些內容、雙重確認與取消訂閱流程，以及公告的撰寫、排程與範本化方式。

## 訂閱管道

一個狀態頁面支援五種管道，每一種都有自己的開關。前往 **Status Pages → your page → Subscribers → Subscriber Settings**：

- **啟用電子郵件訂閱者**（`enableEmailSubscribers`）——預設為開啟。其他所有管道在你開啟此項之前都是關閉的。
- **啟用 SMS 訂閱者**（`enableSmsSubscribers`）——預設為關閉。
- **啟用 Slack 訂閱者**（`enableSlackSubscribers`）——預設為關閉。
- **啟用 Microsoft Teams 訂閱者**（`enableMicrosoftTeamsSubscribers`）——預設為關閉。
- **啟用 Webhook 訂閱者**（`enableWebhookSubscribers`）——預設為關閉。

每個管道在狀態頁面的側邊選單中，也會於 **Subscribers** 底下各自擁有一份清單：**Email Subscribers**、**SMS Subscribers**、**Slack Subscribers**、**MS Teams Subscribers** 與 **Webhook Subscribers**。你可以在那裡查看誰已註冊、手動新增訂閱者，或是為特定訂閱者留下一則**備註**（`internalNote`）。

**光靠一個開關是不夠的。** 狀態頁面導覽列中的 **Subscribe** 項目，只有在**顯示訂閱者頁面**（`showSubscriberPageOnStatusPage`）開啟*且*至少啟用一個管道時才會出現。如果你開啟了**啟用電子郵件訂閱者**，卻讓**顯示訂閱者頁面**保持關閉，訪客將無法找到訂閱表單。

同樣的五個開關會在**進階設定**的**訂閱者設定**卡片中再次出現，與**顯示訂閱者頁面**並列。它們背後對應的是相同的欄位——選定一個畫面並固定使用即可，建議優先使用專屬的**訂閱者設定**頁面，因為其餘的訂閱者設定選項都集中在那裡。

## 訪客在 Subscribe 頁面上看到的內容

**Subscribe** 頁面有一個子選單，每個已啟用的管道各對應一個分頁——**Email**、**SMS**、**Slack**、**MS Teams**、**Webhooks**——分別對應 `/subscribe/email`、`/subscribe/sms`、`/subscribe/slack`、`/subscribe/microsoft-teams` 與 `/subscribe/webhooks`。每個分頁只詢問所需的最少資訊：

- **Email** ——標題為**透過電子郵件訂閱**，僅有一個欄位**您的電子郵件**，佔位文字為 `subscriber@company.com`。
- **SMS** ——標題為**透過簡訊訂閱**，僅有一個欄位**您的電話號碼**，佔位文字為 `+11234567890`。
- **Slack** ——標題為**透過 Slack 訂閱**，包含用於驗證的 **Slack 工作區名稱**，以及 **Slack 傳入 Webhook URL**，佔位文字為 `https://hooks.slack.com/services/...`。
- **MS Teams** ——標題為**透過 Microsoft Teams 訂閱**，包含 **Microsoft Teams 工作區名稱**與 **Microsoft Teams 傳入 Webhook URL**，佔位文字為 `https://outlook.office.com/webhook/...`。
- **Webhooks** ——標題為**透過 Webhook 訂閱**，僅有一個欄位 **Webhook URL**。每次狀態頁面事件發生時都會向該網址傳送一則 JSON `POST` 請求。

提交按鈕文字為**訂閱**，成功註冊後會顯示「*您已成功訂閱。*」頁面也提供**新訂閱** / **管理現有訂閱**的分頁切換，讓已經訂閱過的人可以直接回到自己的偏好設定，而不需要翻找舊的電子郵件。

## 讓訂閱者選擇資源與事件類型

預設情況下，訂閱者會收到頁面上的所有內容。**進階訂閱者設定**卡片中的兩個開關可以改變這一點：

- **允許訂閱者選擇資源**（`allowSubscribersToChooseResources`）——預設為關閉。開啟後，訂閱表單會新增一個**訂閱所有資源**開關；將其關閉後會出現**選擇要訂閱的資源**，讓訪客可以挑選個別資源。
- **允許訂閱者選擇事件類型**（`allowSubscribersToChooseEventTypes`）——預設為關閉。形式相同：一個**訂閱所有事件類型**開關，關閉後其下方會出現**選擇要訂閱的事件類型**。

事件類型分別為 `Incident`（事件）、`Announcement`（公告）與 `Scheduled Event`（排定事件）。

這些選擇會記錄在訂閱者資料上，欄位為**訂閱所有資源**（`isSubscribedToAllResources`，預設為 true）、**訂閱所有事件類型**（`isSubscribedToAllEventTypes`，預設為 true）、**訂閱的資源**與**訂閱的事件類型**。

適用情境：涵蓋多項產品的頁面。只使用你的 API 的客戶，並不希望每次行銷網站有點小狀況就收到通知——讓他們自行縮小清單範圍，總比看著他們直接完全取消訂閱來得好。

同一張卡片中也包含**訂閱者時區**。

## 電子郵件雙重確認

電子郵件訂閱者一律需要確認。當一位訂閱者以電子郵件地址建立、且並非以「已確認」狀態建立時，**訂閱是否已確認**（`isSubscriptionConfirmed`）會被強制設為 `false`，並產生一組六位數的**訂閱確認權杖**。接著 OneUptime 會寄出一封確認連結郵件，格式為 `{statusPageUrl}/confirm-subscription/{statusPageSubscriberId}?verification-token={token}`。訪客會進入**確認訂閱**頁面，一旦驗證成功，便會看到「*訂閱確認成功*」。

SMS、Slack、Microsoft Teams 與 Webhook 訂閱者則會略過此步驟——他們建立時 `isSubscriptionConfirmed` 已直接設為 `true`。

**未確認即代表靜默。** 用來擷取通知對象的查詢會篩選 `isUnsubscribed: false` 與 `isSubscriptionConfirmed: true`。一個從未點擊確認連結的電子郵件地址，會停留在你的**電子郵件訂閱者**清單中，但不會收到任何通知。如果有人堅稱自己已經訂閱卻什麼都沒收到，請先檢查這一欄。

沒有任何開關可以關閉電子郵件確認機制——對於透過狀態頁面註冊的任何人，這都是無條件執行的。另一個獨立的每位訂閱者欄位，**傳送「您已訂閱」訊息**（`sendYouHaveSubscribedMessage`，預設為 true），則控制訂閱者確認後所寄出的「您已訂閱」電子郵件。

## 管理與取消訂閱

每封訂閱者電子郵件都附有取消訂閱連結，格式為 `{statusPageUrl}/update-subscription/{statusPageSubscriberId}`。該頁面標題為**更新訂閱**，並告知訪客可以在此更新偏好設定或取消訂閱。頁面上包含：

- 頁面所允許的任何資源與事件類型選擇器。
- 一個**取消訂閱**開關，說明為取消訂閱所有資源。它會寫入**已取消訂閱**（`isUnsubscribed`，預設為 false）。
- 一個提交按鈕，文字為**更新訂閱**；儲存後會顯示「*您的變更已儲存。*」

遺失連結的人可以在 **Subscribe** 頁面使用**管理現有訂閱**，並按下**傳送管理連結**。OneUptime 會回覆已寄出一封含連結的電子郵件，並提醒若未收到請檢查垃圾郵件資料夾。

背後對應的端點為 `POST .../subscribe/:statusPageId`、`POST .../manage-subscription/:statusPageId`、`POST .../get-subscription/:statusPageId/:subscriberId` 與 `PUT .../update-subscription/:statusPageId/:subscriberId`。

取消訂閱只是切換一個旗標，而非刪除該筆資料，因此該記錄仍會留在管道清單中，並標示**已取消訂閱**——這在你日後需要解釋某個地址為何不再收到郵件時很有用。

## 訂閱者會收到哪些通知

訂閱者會收到上述三種事件類型的通知，但每個來源都有各自的開關，因此不會意外送出通知。

### 公告通知

公告本身帶有**是否通知訂閱者？**（`shouldStatusPageSubscribersBeNotified`）欄位，在建立表單中對應為**通知狀態頁面訂閱者**核取方塊，預設為開啟。如果公告在**受影響的監測器（選填）**中指定了監測器，通知範圍就會限縮至那些監測器；若留空，則會通知所有訂閱者。

### 排定的維護事件

排定的維護事件擁有自己一組訂閱者欄位：**建立事件時是否通知訂閱者？**、**變更為進行中時是否通知訂閱者？**、**變更為已結束時是否通知訂閱者？**，以及用於提前提醒的**事件前的訂閱者通知**與**下一次事件前的訂閱者通知於？**。事件上的**狀態頁面**決定它會出現在哪些頁面上，而**是否應顯示於狀態頁面？**則決定它是否會出現。

### 事件

`Incident`（事件）是第三種事件類型。至於一個事件最初是如何被送上狀態頁面的——牽涉哪些資源、哪些狀態會讓它保持可見——請參閱[事件狀態與嚴重程度](/docs/incidents/states-and-severities)。

狀態頁面側邊選單中的**通知日誌**區段（`{id}/notification-logs`），是你需要查看該頁面實際發送過哪些內容時該去的地方。

## 自訂通知範本

**訂閱者設定**中的**通知範本**卡片會列出此狀態頁面所使用的範本，欄位包含**範本名稱**、**事件類型**與**通知方式**——讓你能依事件類型與管道分別調整措辭，而不必所有情況都套用同一套制式訊息。

專案層級的範本則位於上一層，路徑為 **Status Pages → Settings → Subscriber Templates**，緊鄰**公告範本**。

## 電子郵件頁尾、自訂 SMTP 與 Twilio

**訂閱者設定**中還有另外三張卡片，控制訂閱者訊息如何從你的專案發出：

- **電子郵件頁尾設定**——**啟用自訂電子郵件頁尾文字**與**訂閱者電子郵件通知頁尾文字**，可將你自己的頁尾套用到訂閱者電子郵件上。
- **自訂 SMTP**——**自訂 SMTP 設定**讓訂閱者電子郵件透過你自己的郵件伺服器發送，而非使用預設伺服器。
- **Twilio 設定**——**Twilio 設定**是用於 SMS 訂閱者的 Twilio 帳號。

如果你有電子郵件訂閱者，及早設定自訂 SMTP 是值得的：從你自己的網域寄出的郵件，被過濾的機率低得多，凌晨兩點閱讀郵件的客戶也更可能信任這封信。

## 公告

公告是一筆專案層級的記錄（`StatusPageAnnouncement` 模型），你可以將它分送到一個或多個狀態頁面，選擇性地限定於特定監測器，並設定一段顯示時間範圍。

你可以從 **Status Pages → More → Announcements** 建立公告，或從個別狀態頁面側邊選單中的 **Announcements** 建立。建立表單是一個四步驟精靈：

1. **基本資訊**——**公告標題**（必填，至少兩個字元）、**描述**（Markdown，選填）與**附件**，用於存放應與公告一同在狀態頁面上提供的檔案。
2. **狀態頁面**——**在這些狀態頁面上顯示公告**，為必填的多選欄位。一則公告可以同時鎖定多個頁面。
3. **受影響的資源**——**受影響的監測器（選填）**。若不選擇任何項目，則會通知所有訂閱者。
4. **排程與設定**——**開始顯示公告於**（必填，預設為現在）、**公告顯示結束於**（選填）與**通知狀態頁面訂閱者**（預設為開啟）。

訪客會在 `/announcements` 閱讀公告，分為**進行中公告**與**過往公告**兩類，各自標示**公告於**。目前正在顯示的公告也會被釘選在總覽頁面的最上方。當沒有內容可顯示時，頁面會顯示「*無公告*」，並註明目前尚未發佈任何公告。

附件透過 `GET {statusPageCrudPath}/status-page-announcement/attachment/:statusPageId/:announcementId/:fileId` 提供服務，並受到與狀態頁面本身相同的讀取權限檢查——因此私人頁面上的附件也會保持私密。

## 公告排程的運作方式

**顯示於**（`showAnnouncementAt`）與**結束於**（`endAnnouncementAt`）驅動一切，但總覽頁面與公告清單所問的問題並不相同，這個差異很容易讓人搞混。

- **總覽頁面**會在 `showAnnouncementAt` 已過去、且 `endAnnouncementAt` 為未來時間或為空時，顯示該則公告。
- **`/announcements` 清單**會顯示 `showAnnouncementAt` 落在**顯示公告歷史記錄（天數）**（`showAnnouncementHistoryInDays`，預設為 14）範圍內的公告，接著在客戶端將其拆分為進行中與過往兩類。

有兩個值得事先規劃的後果：

- **沒有結束日期的公告永遠不會過期。** 將**公告顯示結束於**保持空白，它就會無限期釘選在總覽頁面上。對任何有時效性的內容，請設定結束日期。
- **一則舊的、但仍在進行中的公告可能會從清單中消失。** 如果它開始顯示的時間早於 `showAnnouncementHistoryInDays` 天前，它會從 `/announcements` 中消失，但仍會留在總覽頁面上。如果你經常保留長期公告，請拉長歷史記錄視窗。

公告是否會出現，是由**進階設定**中的**公告設定**卡片所控制：**顯示公告**（`showAnnouncementsOnStatusPage`，預設為 true）與**顯示公告歷史記錄（天數）**（預設為 14）。當**顯示公告**關閉時，公告端點會直接拒絕請求。

## 公告範本

如果你會重複發布同一類公告——例如每月的維護預告，或是週期性的第三方服務降級通知——不妨事先準備好範本。**Status Pages → Settings → Announcement Templates** 儲存 `StatusPageAnnouncementTemplate` 模型，其表單需要填寫**範本名稱**、**範本描述**、**公告標題**、**描述**、**在這些狀態頁面上顯示公告**、**受影響的監測器（選填）**與**通知訂閱者**，讓分送對象與是否通知的決定只需設定一次，而不必每次重來。

## Webhook 訂閱者與 SSRF 防護

Webhook 訂閱者會在每次狀態頁面事件發生時收到一則 JSON `POST` 請求，這使得它們成為將狀態頁面更新導入你自有系統——聊天機器人、內部儀表板、工單佇列——最簡便的方式。

由於訂閱是公開頁面上的公開操作，OneUptime 會保護目標端點：

- 一般性的 **Webhook URL** 在被接受前會先經過驗證，私有位址、迴路位址、鏈結本機位址與雲端中繼資料位址皆會被拒絕。你無法將訂閱指向 OneUptime 部署自身網路內部的任何位置。
- **Slack 傳入 Webhook URL** 必須以 `https://hooks.slack.com/services/` 開頭。

如果某個 Webhook 訂閱在註冊時被拒絕，第一個該檢查的地方就是是否為內部或格式錯誤的網址。

## 延伸閱讀

- [狀態頁概觀](/docs/status-pages/index)——狀態頁面是什麼，以及它是如何組成的。
- [狀態頁資源與群組](/docs/status-pages/resources-and-groups)——訂閱者可以選擇的監測器與群組。
- [狀態頁品牌與網域](/docs/status-pages/branding-and-domains)——自訂網域、標誌，以及你電子郵件連結所指向頁面的外觀。
- [公開 API](/docs/status-pages/public-api)——以程式化方式讀取狀態頁面資料。
- [事件狀態與嚴重程度](/docs/incidents/states-and-severities)——是什麼讓事件出現在狀態頁面上，又是什麼讓它移除。
- [事件設定與自動化](/docs/incidents/settings)——事件溝通背後的專案層級規則。
