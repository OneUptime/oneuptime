# 事件備註、負責人與動態

每個事件在你處理的過程中都會累積一份書面紀錄。其中一部分是給客戶看的——凌晨兩點十四分發布在狀態頁上、說明你已找到問題部署的更新。其餘部分是給你的團隊看的——有人貼上的堆疊追蹤、終於讓人看懂的圖表、決定要進行容錯移轉的決策。

OneUptime 把這兩種對象分開處理。**Public Notes** 會發佈到你的狀態頁，並可以通知訂閱者。**Private Notes**（`IncidentInternalNote` 模型）則留在儀表板內。這兩者底下都有 **Incident Feed**，一份只能新增、記錄事件所發生一切的時間軸，以及 **Owners** 清單，決定誰會被通知。

這一切都掛在事件的左側選單下：**Notes → Public Notes**、**Notes → Private Notes**，以及 **Team → Owners**。動態則位於事件的 **Overview** 頁面上。

## 公開備註 vs 私人備註

這兩種備註類型在儀表板中看起來很相似，但行為卻大不相同。

- **公開備註**——`IncidentPublicNote` 模型，會作為事件時間軸的一部分提供給狀態頁。它們帶有一個你可以自行設定的 **Posted At** 日期，以及 **Notify Status Page Subscribers** 核取方塊。
- **私人備註**——`IncidentInternalNote` 模型。狀態頁應用程式完全不會讀取它們。它們沒有 posted-at 欄位（清單是依 `createdAt` 蓋章並排序），也完全沒有訂閱者相關欄位，所以私人備註永遠不會觸發訂閱者通知。

**「private」實際上的意思。** 它指的是「不會發佈到狀態頁」——而不是「只限縮小一群人看」。這兩種備註類型享有相同的讀取權限，所以任何能讀取該事件的人，都能讀取它的私人備註。如果你需要限制誰能看到整個事件，請使用事件本身的 **Private Incident** 旗標（`isPrivate`），它會讓該事件在所有狀態頁上隱藏，並僅限於事件的擁有者使用者、其擁有者團隊的成員，以及專案管理員與擁有者。

**負責人兩者都看得到。** 負責人通知工作會同時查詢公開與私人備註。私人備註對你的訂閱者是私密的,對正在回應的人並不是。

| 如果你想要……                                              | 選擇             |
| ------------------------------------------------------ | ---------------- |
| 告訴客戶你所知道的情況，以及何時會有更多資訊              | **Public Note**  |
| 回填你已經在其他地方發送過的更新                          | **Public Note**  |
| 記錄一個假設、你執行過的指令，或一條死路                  | **Private Note** |
| 附上一份 heap dump 或內部儀表板截圖                       | **Private Note** |

## 發佈公開備註

在事件側邊選單中開啟 **Notes → Public Notes** 並建立備註。卡片會說明你在此處寫的內容會顯示在狀態頁上；空白狀態則會顯示目前尚未為此事件建立任何公開備註。

| 欄位                                | 用途                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------ |
| **Public Incident Note**           | 內容主體，以 Markdown 撰寫。必填。表單會提醒你這則備註會顯示在你的狀態頁上，並附有速查表連結。 |
| **Attachments**                    | 與訂閱者在狀態頁上共享的檔案。選填。                                                        |
| **Notify Status Page Subscribers** | 核取方塊，預設開啟。關閉即可安靜地發佈。                                                    |
| **Posted At**                      | 必填的日期與時間，預設為現在，以你目前的時區顯示。                                          |

**Posted At 才是這則備註真正的時間戳記。** 狀態頁是依 `postedAt`（而不是你實際輸入的時間）來排序與顯示公開備註——所以如果你正在為狀態頁補上 40 分鐘前已發送過的更新,請把 **Posted At** 設為事情實際發生的時間。如果一則備註是透過 API 送入而沒有指定這個欄位，OneUptime 會蓋上目前時間。

清單會顯示每則備註的撰寫者、其 **Posted At**、渲染後的 Markdown 內容與其附件，以及一欄 **Subscriber Notification Status**。你可以依 **Created By**、**Note** 與 **Created At** 篩選。

## 發佈私人備註

**Notes → Private Notes** 刻意做得更精簡。只有兩個欄位：

- **Private Incident Note**——Markdown 內容,必填。表單直接說明這對你的團隊是私密的,不會顯示在狀態頁上。
- **Attachments**——供事件回應團隊使用的檔案。

沒有 **Posted At**，也沒有訂閱者核取方塊——備註在建立時就會被蓋上時間戳記。

## 備註上的附件

兩種備註類型都可以透過 **Attachments** 欄位接受檔案附件,並且都會在備註內容下方渲染一份附件清單,每個檔案都有 **Download attachment** 連結。

它們的差異在於誰能取得檔案：

- **公開備註附件**可由狀態頁訪客透過狀態頁路由下載，與備註本身一起。
- **私人備註附件**只能透過已驗證的儀表板 API 取得。沒有對應的狀態頁路由。

這使得附件與備註文字面臨相同的公開/私人決定。面向客戶的時間軸圖片放在公開備註上；設定檔轉存則放在私人備註上。

## 用 AI 生成備註

兩個備註頁面都有 **Generate with AI** 按鈕。它會將事件內容送到你專案的 AI 供應商,並將生成的 Markdown 內容放入備註編輯器中，你可以在儲存前先編輯它——不會自動發佈任何內容。

- **Generate Public Note with AI**——描述為分析事件資料以產生面向客戶的備註。範本包含 **Status Update** 與 **Resolution Notice**。
- **Generate Private Note with AI**——則產生內部技術性備註。範本包含 **Investigation Update** 與 **Technical Analysis**。

在按鈕背後,儀表板會將選定的範本與 `public` 或 `internal` 的備註類型,一併 POST 到 `/incident/generate-note-from-ai/{incidentId}`。

## 備註範本

如果你的團隊每次事故都寫相同的三則更新，不妨儲存一次就好。兩個備註頁面都有 **Create from Template** 按鈕，會開啟一個 **Create Note from Template** 選取器，附有 **Select Note Template** 下拉選單。

範本在公開與私人備註之間是共用的：單一份範本清單同時服務兩者，同一份範本可以插入任一種備註中。

你可以在 **Incidents → Settings → Note Templates** 管理它們——卡片標題為 **Public or Private Note Templates for Incidents**，其表單有一個 **Template Info** 步驟（**Template Name** 與 **Template Description**，皆為必填），以及一個用於內容主體的 **Note Details** 步驟。如果你在建立任何範本之前就點擊 **Create from Template**，OneUptime 會告訴你目前還沒有範本；請注意，該訊息指向 Project Settings，但這個頁面實際上位於 **Incidents → Settings → Note Templates** 之下。

## 從 Slack 或 Microsoft Teams 發佈備註

如果你已連接了一個工作區,回應人員完全不需要離開頻道。Slack 與 Microsoft Teams 都提供了一個新增備註的動作，會開啟一個彈窗，附有下拉選單可選擇 **Public Note** 或 **Private Note**,再加上一個文字方塊,並將結果直接寫入該事件。

有兩個細節值得留意：

- **重複保護**——每則備註都會記錄它來自哪一則 Slack 訊息（`postedFromSlackMessageId`，格式為 `channel_id:message_ts`），所以多人對同一則訊息做出反應只會產生一則備註，而不是五則。
- **備註會回傳訊息**——發佈任一種備註也會將訊息推送到已連接的事件頻道，因為該備註的動態項目在建立時就啟用了工作區通知。

## 公開備註何時會真正送達訂閱者

建立一則開啟了 **Notify Status Page Subscribers** 的公開備註，並不保證電子郵件一定會發出。這則備註必須通過一連串檢查，而每一次失敗都會記錄具體原因，而不是直接報錯：

1. **Notify Status Page Subscribers** 必須是開啟的。如果不是，備註在建立的當下就會被蓋上已略過的狀態。
2. 這則備註必須屬於一個仍然存在的事件。
3. 這個事件必須至少附加一個監測器——沒有監測器就沒有狀態頁資源可以路由這則備註。
4. 事件的 **Visible on Status Page** 旗標（`isVisibleOnStatusPage`）必須為 true。
5. 事件所觸及的每個狀態頁都必須開啟 **Show Incidents**（`showIncidentsOnStatusPage`）。
6. 每位訂閱者都必須符合自己的偏好設定——未取消訂閱，並且已訂閱此資源以及頁面允許訂閱者選擇的 `Incident` 事件類型。

**通知不是即時的。** 傳送通知的工作每分鐘執行一次，所以從儲存備註到郵件寄出，預計會有大約一分鐘的間隔。這就是 **Sending Soon** 標籤的意思。

**Subscriber Notification Status** 欄位追蹤整個歷程：

| 狀態                          | 代表意義                                     |
| ----------------------------- | -------------------------------------------- |
| **Notifications skipped.**   | 上述其中一道關卡未通過。原因會被記錄下來。   |
| **Sending Soon**             | 已排入佇列，等待傳送工作下一次執行。         |
| **Notifications Being Sent** | 工作正在逐一處理訂閱者清單。                 |
| **Notifications Sent**       | 所有訂閱者通知都已送出。                     |
| **Failed**                   | 工作發生錯誤；錯誤內容會與備註一併儲存。     |

點擊狀態旁的 **more details** 可以開啟 **Notification Status Details**。若重新傳送有意義,該彈窗上的按鈕是 **Retry**，會將備註放回待處理狀態，讓下一次執行時再次處理它。

訂閱者實際收到的訊息，是依狀態頁與管道各自套用範本的——電子郵件、簡訊、Slack 與 Microsoft Teams 都各自有自己的 **Subscriber Incident Note Created** 事件範本，內含狀態頁名稱與網址、詳細資訊連結、受影響的資源、事件嚴重程度與標題、備註內容，以及每位訂閱者專屬的取消訂閱連結等變數。這些範本與管道如何設定，請參見 [Subscribers & Announcements](/docs/status-pages/subscribers)。

## 事件動態

**Incident Feed** 卡片位於事件 **Overview** 頁面左欄的最下方。它依序呈現這個事件的故事：每個項目都有一個圖示、觸發者的頭像與名稱、一個滑鼠懸停可顯示確切本地時間的相對時間戳記，以及一段 Markdown 內容。項目依最舊優先排序。

有些項目帶有額外細節——例如,一則負責人通知會列出所有收到郵件的人。這些項目會顯示 **More Information** 按鈕，開啟一個 **More Information** 面板。

卡片標頭還有一個 **Actions** 選單，讓你不必離開時間軸就能採取行動：

- **Execute Runbook**——針對這個事件啟動一份[運行手冊](/docs/runbooks/index)。
- **Execute On-Call Policy**——依需求呼叫一個待命政策。
- **Add Public Note**——與 Public Notes 頁面相同的四個欄位，以彈窗形式呈現。
- **Add Private Note**——僅有備註內容與附件。

在它旁邊，**Refresh** 會重新取得動態內容。

**動態只能新增，它不是你的稽核日誌。** API 允許建立與讀取動態項目,但不允許更新或刪除,所以沒有人能悄悄改寫一個事件的歷史。它也不是永久保存的：在計費的安裝環境中，超過三年的動態列會被移除。若需要持久保存誰變更了什麼的紀錄，請使用事件側邊選單中的 **Audit → Audit Logs**。

## 動態記錄的內容

動態項目由事件服務本身、兩種備註服務、狀態時間軸、負責人與成員變更、規則引擎、待命執行、AI 調查與事後檢討執行器,以及通知的排程工作寫入。事件類型涵蓋：

- **事件本身**——`IncidentCreated`、`IncidentUpdated`、`IncidentStateChanged`。
- **備註與寫作內容**——`PublicNote`、`PrivateNote`、`RootCause`、`RemediationNotes`、`PostmortemNote`。
- **人員**——`OwnerUserAdded`、`OwnerTeamAdded`、`OwnerUserRemoved`、`OwnerTeamRemoved`、`IncidentMemberAdded`、`IncidentMemberRemoved`。
- **通知**——`OwnerNotificationSent`、`SubscriberNotificationSent`、`OnCallPolicy`、`OnCallNotification`。
- **自動化**——`LabelRuleExecuted`、`OwnerRuleExecuted`、`PrivacyRuleExecuted`、`OnCallRuleExecuted`、`AutoRemediation`。

每種類型都有自己的圖示，所以你可以快速瀏覽一份很長的動態，從雜訊中挑出狀態變更。AI 生成的根本原因分析會被明顯標示，並以受限的 Markdown 模式渲染。

動態會遵守事件的隱私設定：對於私人事件,動態的讀取權限會與該事件本身受到相同的篩選。

## 負責人

Owners（負責人）是對一個事件負責的人與團隊。他們是這個事件所發生一切事情的通知對象——也是事件不會在大家都以為「應該有別人在處理」的情況下被忽略的原因。

在事件側邊選單中開啟 **Team → Owners**。**Owners** 卡片會顯示一個計數徽章，並將負責人描述為對這個事件負責、會收到變更通知的人與團隊，附有像「2 people · 1 team」這樣的即時計數。負責人以重疊的頭像呈現；將滑鼠懸停在其中一個上，會顯示該人員的電子郵件，或標示該項目為 **Team**。

- 點擊 **Add owner** 開啟一個選取器，內有搜尋框可以搜尋人員或團隊。
- 點擊頭像上的移除控制項，開啟 **Remove owner** 確認彈窗，然後點擊 **Remove**。
- 如果目前還沒有負責人，卡片會如實顯示，並邀請你新增一位隊友或一個團隊，讓他們能收到變更通知。

負責人使用者與負責人團隊是各自獨立的紀錄——新增一個團隊會讓該團隊的每位成員都成為負責人，用於通知目的，而不需要逐一列出他們。

## 負責人如何被指派

有四種途徑可以將人加入負責人清單：

- **來自事件範本**——範本帶有 **Owner - Teams** 與 **Owner - Users** 欄位，描述為擁有這個事件、並會在事件建立或更新時收到通知的團隊與使用者。從範本建立事件會預先填入這些內容。請參見 [Declaring an Incident](/docs/incidents/declaring-incidents)。
- **來自 Incident Owner Rules**——符合條件的規則會在建立時自動新增負責人。
- **透過 API 在建立時指定**——隨建立呼叫一併傳入的負責人使用者與團隊會立即被加入,並有一個旗標控制他們是否會收到「你已被新增」的電子郵件。
- **手動新增**——在事件的任何時間點,使用 **Owners** 頁面上的 **Add owner** 控制項。

重複新增同一個人是安全的；已指派的負責人不會被重複加入。

## 事件負責人規則

**Incident Owner Rules** 會在符合條件的事件建立時自動指派負責人使用者與團隊——這是讓資料庫事件不需要任何人思考就會落到資料庫團隊身上的路由層。你可以在 [Incident Settings & Automation](/docs/incidents/settings) 中，與其餘的事件自動化功能一起找到它們。

規則表單有三個步驟——**Basic Info**、**Match Criteria** 與 **Owners**——而 Owners 步驟包含兩個區段：

- **Owners to Assign**——選擇 **Owner Teams** 與 **Owner Users**。當規則符合時，每個選定的使用者與團隊都會被加為負責人，已指派的負責人不會被重複加入。
- **Inherit Owners**——從相關實體繼承負責人，而不是逐一指定。**Inherit Owners From Monitors** 會讓事件監測器的每位負責人都成為該事件的負責人，**Inherit Owners From Hosts**、**… From Kubernetes Clusters**、**… From Docker Hosts**、**… From Podman Hosts** 與 **… From Services** 則對相應的資源做同樣的事。

**Notify Owners** 開關控制大家是否會被告知。若要進行真正的路由,請保持開啟；若要靜靜地新增負責人,則關閉它——當一項規則只是行政上的便利措施而非要發出呼叫時,這很有用。

每一次規則執行都會被寫入事件動態，所以你隨時都能分辨一個人是被規則加入的，還是由人手動加入的。

## 負責人會收到哪些通知

有五項工作會通知負責人，各自每分鐘執行一次：

- **事件已建立**——主旨為 `[New Incident {number}] - {title}`。
- **有備註被發佈**——公開*與*私人備註皆適用，主旨為 `[Update Incident {number}] - {title}`。
- **事件狀態已變更**——請參見 [Incident States & Severities](/docs/incidents/states-and-severities)。
- **你被新增為負責人**——主旨為 `You have been added as the owner of Incident {number} - {title}`。
- **仍未解決**——由事件的下一次提醒時間所驅動的提醒，主旨為 `[Reminder] Incident {number} is still {state} - {title}`。

每則通知都會建立電子郵件、簡訊、語音電話、推播與 WhatsApp 版本，並交由使用者的通知設定決定實際要傳送哪些。每位收件人都可以個別關閉這些通知——每位使用者的設定用語是「傳送事件建立、備註發佈、狀態變更、負責人新增、成員指派，以及仍未解決提醒通知給你」。只想在狀態變更時接到電話的人，就可以只設定這一項。

**沒有負責人的事件不會被靜音。** 如果一個事件完全沒有負責人，通知工作會退回通知專案的擁有者，所以不會有任何事情被漏掉。每一位被通知到的人，也都會被附加到對應的動態項目中，所以事後你可以確切看到誰在何處被告知過。

## 接下來可以閱讀

- [Incidents Overview](/docs/incidents/index)——事件是什麼，以及各部分如何組合在一起。
- [Declaring an Incident](/docs/incidents/declaring-incidents)——手動、透過範本，以及透過監測器建立事件。
- [Incident States & Severities](/docs/incidents/states-and-severities)——驅動半數動態內容的狀態機。
- [Incident Settings & Automation](/docs/incidents/settings)——負責人規則、備註範本，以及其餘的自動化功能。
- [Subscribers & Announcements](/docs/status-pages/subscribers)——公開備註最終會送到哪裡、誰會收到。
- [Status Pages Overview](/docs/status-pages/index)——事件面向客戶的一面。
