# 事件概觀

OneUptime 中的事件是當有東西壞掉時，您團隊會圍繞的記錄。它帶有編號、標題、嚴重程度、目前狀態、受影響的資源，以及您團隊在應對過程中寫下的一切——備註、根本原因、補救步驟，以及一份誰在何時做了什麼的僅供附加的活動紀錄。

事件是把監控器變紅這件事，轉變為一次協同回應的關鍵。宣告一起事件會呼叫正確的待命輪值、加入會收到每次變更通知的擁有者、啟動運行手冊，並且——如果您希望的話——將此中斷發布到您的公開狀態頁面，讓客戶不必再開工單詢問您是否已經知道了。

您可以在凌晨 3 點手動宣告一起事件，也可以讓監控器在符合條件的當下自動幫您宣告。無論哪種方式，事件都是同一種物件，擁有相同的生命週期，最終也留下相同的紀錄軌跡。

## 一覽

- **頂層功能** — 儀表板左側導覽中的 **Incidents**，位於 `/dashboard/{projectId}/incidents`。
- **三個預先建立的狀態** — 每個新專案都會建立 **Identified**、**Acknowledged** 和 **Resolved**。您可以新增自己的狀態；這三個預先建立的狀態可以重新命名和變更顏色，但永遠無法刪除。
- **三個預先建立的嚴重程度** — **Critical Incident**、**Major Incident** 和 **Minor Incident**。嚴重程度是一個帶有顏色與順序的標籤——本身不帶有任何行為。
- **四種進入方式** — **Declare Incident** 精靈、**Create from Template**、監控器條件規則，或 `POST /api/incident`。
- **依專案編號** — 每一起事件都會取得一個事件編號，預設呈現為 `#42`，或以您自訂的前綴呈現，例如 `INC-42`。
- **兩種備註** — 給您團隊的私人備註（內部備註），以及給狀態頁面訂閱者的公開備註。
- **設定位於 Incidents 之下，而非 Project Settings** — 狀態、嚴重程度、範本、自訂欄位以及規則引擎全都位於 **Incidents → Settings** 和 **Incidents → Rules**。

## 關鍵術語

有幾個詞會出現在本節幾乎每一頁上。先把這些弄清楚。

| 術語                   | 意義                                                                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Incident（事件）**           | 記錄本身——標題、描述、嚴重程度、目前狀態、受影響的資源，以及應對過程中寫在上面的一切。              |
| **Incident state（事件狀態）**     | 事件在其生命週期中所處的位置。這是一列限定於專案範圍內的資料，具有名稱、顏色和 `order`，加上賦予其意義的旗標。                   |
| **Incident severity（事件嚴重程度）**  | 事件有多嚴重。這是一列限定於專案範圍內的資料，具有名稱、顏色和 `order`。純粹是一種分類——產品中沒有任何機制會特別對待某個嚴重程度。 |
| **Incident number（事件編號）**    | 依專案計數，顯示為 `#42`，或依您設定的前綴顯示為 `INC-42`。                                                                                  |
| **Resources affected（受影響的資源）** | 您附加到事件上的監控器、主機、Kubernetes 叢集、Docker 主機、服務以及其他基礎架構。                                                                               |
| **Public note（公開備註）**        | 為狀態頁面讀者與訂閱者所寫的更新內容。會呈現在狀態頁面的時間軸上。                                                                                  |
| **Private note（私人備註）**       | 給應對團隊的內部備註（`IncidentInternalNote` 模型）。永遠不會出現在狀態頁面上。                                                        |
| **Owner（擁有者）**              | 負責這起事件的使用者或團隊。擁有者會在事件建立時、有備註發布時，以及狀態變更時收到通知。             |
| **Incident feed（事件動態）**      | 位於事件 **Overview** 頁面上、僅供附加的活動時間軸，記錄狀態變更、備註、擁有者變更、規則執行與通知。 |
| **State timeline（狀態時間軸）**     | 記錄事件曾處於哪些狀態、何時進入、持續多久——並附上每次轉換的訂閱者通知狀態。                                                |

## OneUptime 為每個專案預先建立的三個狀態

當專案建立時，OneUptime 會依以下順序預先建立三個事件狀態：

| 狀態            | 順序 | 顏色              | 意義                                                             |
| ---------------- | ----- | ------------------ | ------------------------------------------------------------------------- |
| **Identified**   | 1     | 紅色 (`#fd625e`)    | 全新事件會落入的狀態。這是建立狀態（created state）。       |
| **Acknowledged** | 2     | 黃色 (`#ffbf53`) | 已有人接手這起事件並著手處理。                 |
| **Resolved**     | 3     | 綠色 (`#2ab57d`)  | 事件已結束。將其解決會把它從您的狀態頁面上移除。 |

這些名稱只是標籤——真正驅動行為的，是狀態資料列上的三個布林值：`isCreatedState`、`isAcknowledgedState` 和 `isResolvedState`。每個專案預期只有一個狀態持有各個旗標。

這個區別比聽起來更重要：

- `isCreatedState` 決定新事件從哪裡開始。若建立時未明確選擇狀態，OneUptime 會尋找該專案的建立狀態並使用它。
- `isAcknowledgedState` 和 `isResolvedState` 驅動事件標頭中的 **Acknowledge** 與 **Resolve** 按鈕、事件 **Overview** 上的兩個統計方塊，以及側邊選單中的 **Active Incidents** 計數徽章。
- **Active Incidents** 純粹定義為「目前狀態不是已解決狀態」。因此，您新增的任何自訂狀態都會被視為進行中，除非它就是已解決狀態。

**留意命名。** 第一個預先建立的狀態命名為 **Identified**，儘管產品內部有幾處描述仍稱之為建立狀態（created state）。如果您在專案的狀態清單中尋找「Created」，那就是名為 **Identified** 的那一列。

您可以在 **Incidents → Settings → Incident State** 新增自己的狀態。新狀態會附加到有序清單的最後，您可以拖曳來重新排序。三個帶旗標的狀態無法刪除——OneUptime 會擋下這個操作——但您可以重新命名並變更顏色，這也是為什麼介面上的狀態名稱是動態讀取的。

順序是強制執行的，而非裝飾性的：事件無法移動到順序早於其目前狀態的狀態。

完整細節請見[事件狀態與嚴重程度](/docs/incidents/states-and-severities)。

## OneUptime 為每個專案預先建立的三個嚴重程度

每個新專案也會取得三個嚴重程度：

| 嚴重程度              | 順序 | 顏色              | 意義                                              |
| --------------------- | ----- | ------------------ | ---------------------------------------------------------- |
| **Critical Incident** | 1     | 栗色 (`#b70400`) | 對客戶影響非常大，需要立即回應。  |
| **Major Incident**    | 2     | 紅色 (`#fd625e`)    | 影響重大，通常需要立即回應。 |
| **Minor Incident**    | 3     | 黃色 (`#ffbf53`) | 影響輕微，通常在工作時間內處理。              |

完整的預先建立描述請見[事件狀態與嚴重程度](/docs/incidents/states-and-severities)。

嚴重程度只有 `name`、`description`、`color` 和 `order`，僅此而已。沒有任何旗標，也沒有任何程式碼路徑會對「Critical Incident」有別於其他資料列的特殊待遇。嚴重程度是人類用來分級的方式，並且在您撰寫待命規則時可作為比對條件——但選擇某個嚴重程度本身並不會呼叫任何人。

在 **Incidents → Settings → Incident Severity** 編輯或新增嚴重程度。

## 一起事件的生命週期

### 1. 它被宣告

四條途徑最終都指向同一個物件：

- **手動** — 從 Incidents 清單，點擊 **Declare Incident**。這會開啟 **Declare New Incident** 精靈，共分五個步驟：**Incident Details**、**Resources Affected**、**Incident Roles**、**On-Call**、**More**。
- **從範本** — 點擊 **Create from Template** 並挑選一份已儲存的 **Incident Template**。範本會預先填入標題、描述、嚴重程度、初始狀態、資源、待命政策、擁有者與標籤。
- **從監控器** — 一條啟用了「宣告事件」切換開關的監控器條件規則，會在其篩選條件符合的當下自動建立事件。此處的標題與描述支援 `{{variable}}` 範本語法。
- **透過 API** — 使用 API 金鑰執行 `POST /api/incident`。伺服器會為您填入 `declaredAt`、建立狀態，以及事件編號。

逐欄位的完整走查請見[宣告事件](/docs/incidents/declaring-incidents)。

### 2. 正確的人得知消息

事件建立時，OneUptime 會執行您設定的自動化：標籤規則、待命規則、擁有者規則與運行手冊規則。附加到該事件的任何待命輪值政策——無論是手動附加、來自範本，或由符合的待命規則合併加入——都會並行執行。

擁有者會透過電子郵件、簡訊、電話、推播和 WhatsApp 收到通知，具體取決於每位使用者自己的通知偏好設定。如果某起事件完全沒有擁有者，通知會退回給專案擁有者，而不會被略過。

如果該事件在狀態頁面上可見且已啟用訂閱者通知，訂閱者也會收到通知。通知是由排程工作（cron）驅動、每分鐘執行一次，因此請預期最多約一分鐘的延遲，而非即時發送。

### 3. 您的團隊處理它

應對人員確認事件、附加受影響的資源、執行運行手冊、指派事件角色，並在了解情況的過程中隨時記錄下來——給團隊的私人備註、給客戶的公開備註，以及在情況更明朗時撰寫的 **Root Cause** 與 **Remediation** 頁面。他們所做的一切都會出現在 **Overview** 頁面上的 **Incident Feed** 中。

### 4. 它被解決

點擊 **Resolve** 會將事件移至已解決狀態、在狀態時間軸上蓋上紀錄、停止持續時間計時，並將該事件從它曾出現的任何狀態頁面的進行中區塊移除。除此之外不需要再做任何其他變更——狀態頁面查詢所看的正是這個已解決狀態旗標。

之後您可以撰寫事後分析（postmortem），並選擇性地將其發布到狀態頁面。

## 事件在儀表板中的位置

在左側導覽中開啟 **Incidents**。它的側邊選單分為以下幾個區塊：

| 區塊       | 您在這裡做什麼                                                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Overview**  | **All Incidents** 與 **Active Incidents**——後者帶有一個紅色徽章，顯示目前不在已解決狀態的事件數量。                                |
| **Episodes**  | 事件片段（incident episodes），一個有自己頁面的獨立分組功能。                                                                                                         |
| **AI**        | **Investigation** 與 **Remediation** — 自動調查與自動補救設定。                                                                                             |
| **Workspace** | 事件用的 **Slack** 與 **Microsoft Teams** 連線。                                                                                                               |
| **Rules**     | 規則引擎：**Grouping Rules**、**On-Call Rules**、**Owner Rules**、**Runbook Rules**、**Privacy Rules**、**Label Rules**、**SLA Rules**、**Reminder Rules**。        |
| **Settings**  | **Incident State**、**Incident Severity**、**Incident Templates**、**Note Templates**、**Postmortem Templates**、**Custom Fields**、**Incident Roles**、**More Settings**。 |

**Rules** 和 **Settings** 預設是收合的——展開它們才能找到本文件其餘部分所提到的頁面。事件的設定不在 Project Settings 之下，全都位於此處。

事件清單本身會顯示 **Incident Number**、**Title**、**State**、**Severity**、**Resources Affected**、**Declared**、**Duration**、**Labels** 與 **Owners**，並提供一個 **Change State** 批次動作，可一次關閉多起事件。

## 事件上每個頁面顯示的內容

開啟一起事件後，您會看到一個左側選單，分組如下：

- **Overview** — **Incident Details** 卡片（標題、嚴重程度、標籤、事件編號、宣告時間、宣告人、待命政策）、**Affected Resources** 卡片，以及 **Incident Feed**。上方則是確認耗時、解決耗時，以及總 **Duration** 的統計方塊。
- **State Timeline** — 事件經歷過的每一個狀態，附上 **Starts At**、**Ends At**、**Duration**，以及每次轉換的訂閱者通知狀態。**View Cause** 與 **View Logs** 說明每次變更發生的原因。
- **SLA** — 這起事件的 SLA 追蹤。
- **Description**、**Root Cause**、**Remediation** — 三個 Markdown 頁面。其中 Description 會顯示在您的狀態頁面上。
- **Runbooks** — 附加到這起事件的運行手冊執行紀錄。
- **Postmortem** — 事後分析報告，您可以選擇性地將其發布到狀態頁面。
- **Roles**、**On-Call Executions**、**Owners** — 誰參與其中、哪些政策被觸發，以及誰會收到通知。
- **Notification Logs**、**AI Logs**、**Audit Logs** — 發送了什麼，以及變更了什麼。
- **Private Notes** 與 **Public Notes** — 位於側邊選單的 **Notes** 區塊之下。
- **Custom Fields**、**Settings**、**Delete Incident** — 位於 **Advanced** 之下。**Settings** 頁面包含 **Visible on Status Page**、**Private Incident** 以及 **Reminders** 卡片。

[事件備註、負責人與動態](/docs/incidents/notes-owners-and-feed)深入介紹了這些協作頁面。

## 事件如何與 OneUptime 其餘部分搭配運作

- **監控器發現問題；事件記錄問題。** 監控器條件規則可以自動宣告事件，並預先填入標題、嚴重程度、待命政策、擁有者、標籤與補救備註。可用的變數請見[事件與警示範本](/docs/monitor/incident-alert-templating)。
- **待命政策負責呼叫。** 可以在宣告精靈的 **On-Call** 步驟、在範本上，或透過 **Incidents → Rules → On-Call Rules** 附加政策。每一條符合的規則都會觸發——最終執行的集合，是所有符合項目與任何直接附加項目的聯集，並經過去重。
- **運行手冊告訴人員該做什麼。** 運行手冊規則會在符合條件的事件建立時自動附加流程，應對人員也可以從事件中手動啟動一份。請見[運行手冊概觀](/docs/runbooks/index)。
- **狀態頁面告訴客戶。** 當頁面已啟用事件功能、該事件被標記為在狀態頁面上可見，且其目前狀態不是已解決狀態時，此事件就會出現在該狀態頁面的進行中清單裡。私人事件永遠會從所有狀態頁面隱藏。請見[狀態頁面概觀](/docs/status-pages/index)。
- **工作流程圍繞著它自動化。** **On Create Incident**、**On Update Incident** 與 **On Delete Incident** 觸發器讓您可以在事件生命週期之上建立無程式碼自動化。請見[工作流程概觀](/docs/workflows/index)。

## 接下來可以閱讀

- [宣告事件](/docs/incidents/declaring-incidents) — 精靈、範本、監控器條件與 API。
- [事件狀態與嚴重程度](/docs/incidents/states-and-severities) — 狀態旗標、自訂狀態與嚴重程度分類。
- [事件備註、負責人與動態](/docs/incidents/notes-owners-and-feed) — 公開與私人備註、擁有者，以及活動動態。
- [事件設定與自動化](/docs/incidents/settings) — 範本、自訂欄位、編號前綴與規則引擎。
- [狀態頁面概觀](/docs/status-pages/index) — 事件如何觸及您的客戶。
- [訂閱者與公告](/docs/status-pages/subscribers) — 事件變更時誰會收到通知。
