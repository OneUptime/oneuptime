# 事件狀態與嚴重程度

每個事件都帶有兩種分類：**狀態**（state）說明它目前處於回應流程的哪個階段，**嚴重程度**（severity）說明它造成的影響有多大。在儀表板中，兩者看起來很相似——都以彩色圓形標籤呈現在事件清單上，也都是可以重新命名與調整顏色的專案範圍清單。但它們扮演的角色截然不同。

狀態會驅動行為。狀態列上的三個布林旗標決定哪些事件被視為進行中、事件標題上會出現哪些按鈕、SLA 計時何時停止，以及事件何時從你的狀態頁上消失。嚴重程度本身不驅動任何事情——它們只是描述影響的標籤，供其他規則比對使用。

這兩份清單都會在建立專案時預先建立，並且都在 **Incidents → Settings** 下編輯。事件側邊選單中的該區段預設是收合的，所以要先展開 **Settings** 才找得到它。

## 狀態承載行為，嚴重程度承載意義

`IncidentState` 模型有 `name`、`description`、`color` 和 `order`，再加上三個布林值：`isCreatedState`、`isAcknowledgedState` 和 `isResolvedState`。產品中所有與狀態相關的行為都取決於這些布林值和 `order`——而不是狀態的名稱。這就是為什麼你可以把 **Resolved** 重新命名為「Closed」而不會壞掉：旗標會跟著這一列走。

`IncidentSeverity` 模型有 `name`、`description`、`color` 和 `order`，僅此而已。沒有旗標。OneUptime 中沒有任何東西會把 **Critical Incident** 與 **Minor Incident** 區別對待——嚴重程度只有在你把某項規則指向它時才有意義，例如待命規則上的 **Incident Severities** 比對條件。

幾條速記規則：

- **選擇嚴重程度來傳達影響**——它顯示在事件清單、事件的 **Overview** 上，並且在宣告事件時是必填欄位。
- **選擇狀態來塑造你的流程**——你實際走過的回應步驟，依實際順序排列。
- **不要把急迫性編碼進狀態裡**——一個名為「Critical」的狀態並不會呼叫任何人。嚴重程度加上待命規則才能做到這件事。

## 預先建立的狀態

專案建立時會依下列順序建立三個狀態。這個建立過程是幂等的——只有在同名狀態尚不存在時才會新增。

| 狀態             | `order` | 旗標                  | 顏色      | 代表意義                                       |
| ---------------- | ------- | --------------------- | --------- | ---------------------------------------------- |
| **Identified**   | `1`     | `isCreatedState`      | `#fd625e` | 新事件落入的狀態。                              |
| **Acknowledged** | `2`     | `isAcknowledgedState` | `#ffbf53` | 已有人接手處理該事件。                          |
| **Resolved**     | `3`     | `isResolvedState`     | `#2ab57d` | 事件已結束，不再計入進行中事件。                 |

留意這個名稱：第一個狀態是 **Identified**，儘管產品內部仍有多處描述稱它為「created」狀態。當文件或提示訊息說「created state」時，指的是持有 `isCreatedState` 的那個狀態——在全新的專案中，那就是 **Identified**。

## 每個狀態旗標實際做的事

| 旗標                  | 用途                                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `isCreatedState`      | 沒有人指定狀態時，事件會取得的狀態。若專案中沒有任何狀態帶有此旗標，建立事件會失敗，並顯示錯誤，要求你在設定中新增一個 created 事件狀態。 |
| `isAcknowledgedState` | 驅動事件 **Overview** 上的 **Acknowledge** 按鈕與「<狀態名稱> in」統計方塊。狀態變更為此狀態時，事件的 SLA 會被標記為已回應。 |
| `isResolvedState`     | 驅動 **Resolve** 按鈕與已解決統計方塊，定義 **Active Incidents** 清單，並且是將事件從狀態頁作用中區段移除的關鍵。會將 SLA 標記為已解決。 |

每個專案預期只有一個狀態持有各個旗標——查詢時只會抓取單一列。這三個帶旗標的狀態可以重新命名、調整顏色與重新排序，但設定頁面會拒絕刪除它們，並顯示錯誤指出 created、acknowledged 與 resolved 狀態的名稱。

因為介面是動態讀取狀態名稱的，重新命名一個狀態會改變你在各處看到的內容——統計方塊、確認彈窗標題，以及事件清單上的標籤，全都會跟著你為該列取的名稱。

## 新增你自己的狀態

前往 **Incidents → Settings → Incident State**。此頁面是依 `order` 遞增排序的有序清單，新狀態會附加在最後。拖曳一列可以改變它的位置。

**狀態上的欄位：**

- **Name**——必填，至少兩個字元。預留文字提示範例類似「Investigating」。
- **Description**——選填的自由文字，說明事件何時處於此狀態。
- **Color**——必填。從色彩選擇器中挑選；以十六進位值儲存，例如 `#fd625e`。

你無法從此表單設定那三個旗標——它們專屬於預先建立的列。因此你新增的狀態是未帶旗標的狀態，這帶來兩個值得事先規劃的後果：

- **它會被計入進行中。** **Active Incidents** 的定義是「目前狀態不是已解決狀態」，所以除了 resolved 狀態之外，你新增的任何狀態都會讓事件留在進行中清單與側邊欄計數中。
- **它的轉換按鈕是通用的。** 確認彈窗的標題不會是 **Acknowledge** 或 **Resolve**，而是 **Mark Incident as `<狀態名稱>`**，送出按鈕為 **Mark as `<狀態名稱>`**。

常見的做法是在 acknowledged 與 resolved 狀態之間插入一個分流或緩解步驟——例如拖曳一個新的「Mitigated」狀態，使它位於 **Acknowledged** 之後、**Resolved** 之前。

## Order 是真正的限制條件，不只是顯示上的偏好

`order` 欄位在狀態變更寫入時就會被強制檢查，而不僅是繪製清單時：

- **拒絕逆向轉換。** 把事件移動到排序上早於目前狀態的狀態會失敗，並顯示指出兩個狀態名稱的錯誤。
- **拒絕重新選擇目前狀態。** 把事件設定為它目前所在的狀態會失敗，並顯示「Incident state cannot be same as previous state.」。
- **回填的列不能與其相鄰列重複。** 插入一列狀態與其後方列相同的時間軸紀錄同樣會被拒絕。
- **標題按鈕會跟隨帶旗標狀態在排序中的位置。** **Acknowledge** 與 **Resolve** 是否出現，取決於目前狀態在依序排序清單中的位置。放在 resolved 狀態*之後*的自訂狀態永遠不會顯示 **Resolve** 按鈕，因為已經沒有更後面的狀態可以推進了。

所以當你新增一個狀態時，要把它放在事件真的會經過的位置。排序放錯不只是看起來怪——它會讓轉換變得不可能。

## 預先建立的嚴重程度

專案建立時會依下列順序建立三個嚴重程度：

- **Critical Incident**（`order` 1，`#b70400`）——對客戶造成極高影響、需要立即回應的問題。例如完全中斷或資料外洩。
- **Major Incident**（`order` 2，`#fd625e`）——顯著影響，通常需要立即回應，有時可透過緩解方案限制損害。例如重要子系統故障。
- **Minor Incident**（`order` 3，`#ffbf53`）——影響輕微，通常在上班時間內處理，大多數客戶不太可能察覺。例如應用程式效能略微下降。

宣告事件時嚴重程度是必填的，在監測器條件中的每個事件規格上也是必填的，所以每個事件——無論是手動還是自動建立——都會帶有嚴重程度。宣告流程請參見 [Declaring an Incident](/docs/incidents/declaring-incidents)，監測器驅動的路徑請參見 [Incident and Alert Templating](/docs/monitor/incident-alert-templating)。

## 編輯嚴重程度

前往 **Incidents → Settings → Incident Severity**。與狀態頁面形狀相同——依 `order` 排序的有序清單，可拖曳重新排序，新的嚴重程度會附加在最後，表單上有 **Name**、**Description** 與 **Color**。

與狀態有兩點不同：

- **沒有刪除防護。** 任何嚴重程度都可以刪除，包括三個預先建立的項目。
- **沒有可繼承的旗標。** 新的嚴重程度行為與預先建立的完全相同——它只是一個帶有顏色與位置的標籤。

**關於預留文字的說明。** 嚴重程度表單逐字沿用了狀態表單的範例文字，所以提示內容談的是事件狀態而非嚴重程度。忽略它們，寫下你自己的嚴重程度名稱與描述。

嚴重程度發揮更多作用的地方：在 **Incidents → Rules → On-Call Rules** 中，規則的 **Incident Severities** 欄位是一項比對條件。在那裡列出 **Critical Incident**，就是表達「任何危急事項都要呼叫資料庫團隊」的方式——待命政策存在於規則上，而不在嚴重程度上。

## 讓事件在各狀態間移動

有四種方式可以改變事件的狀態：

- **標題按鈕。** 開啟一個事件。如果目前狀態早於 acknowledged 狀態，你會看到 **Acknowledge** 與 **Resolve**；如果介於兩者之間，你會看到 **Resolve**。每個按鈕都會開啟確認彈窗——**Acknowledge Incident** 或 **Resolve Incident**——同時也提供 **Select Note Template**、**Public Note** 與 **Notify Status Page Subscribers**。
- **狀態時間軸。** 從事件的 **State Timeline** 頁面手動新增一列，填寫 **Incident Status**、**Starts At** 與 **Notify Status Page Subscribers**。
- **批次變更。** 事件清單上有 **Change State** 批次動作，可一次移動多個事件。
- **自動。** 啟用 **Auto Resolve Incident** 的監測器條件會在條件不再符合時解決其事件，API 也可以透過 `/api/incident-state-timeline` 更新狀態。

以上每一種方式都會寫入一列時間軸紀錄。狀態變更也會自動做幾件事，不需要你另外要求：它會在事件動態上發佈一則項目、若事件尚未指派事件指揮官則指派一位，並更新 SLA 計時。重新開啟一個已解決的事件會從重新開啟的時間點開始一份全新的 SLA 紀錄。

## 狀態時間軸

事件側邊選單中的事件 **State Timeline** 頁面是該事件所經歷過每個狀態的稽核軌跡。該頁面上的卡片標題為 **Status Timeline**，並依最新優先排序。

**欄位：**

- **Incident Status**——帶有狀態名稱與顏色的彩色圓形標籤。
- **Starts At**——事件進入此狀態的時間。
- **Ends At**——事件離開此狀態的時間。目前狀態顯示 `Currently Active`。
- **Duration**——在此狀態花費的時間，目前狀態則計算至現在。
- **Subscriber Notification Status**——此變更的狀態頁通知是否已傳送、已略過或仍在等待中，附有 **more details** 連結，若傳送失敗，還有 **Retry** 動作。

**列動作：**

- **View Cause**——開啟 **Root Cause** 彈窗，呈現該次狀態變更所記錄的 Markdown 內容。
- **View Logs**——開啟一個彈窗，說明狀態變更的原因，附有 **Incident State Log** 檢視器。

時間軸列可以新增與刪除，但不能編輯。刪除錯誤的列會改寫該事件的歷史，因此請把它當作更正工具，而不是清理習慣。

## Active Incidents 清單

**Incidents → Active Incidents** 是你在值班期間會盯著的清單。它的定義恰好只有一個條件：事件目前的狀態是 `isResolvedState` 為 false 的狀態。不考慮其他任何因素——不是嚴重程度、不是事件年齡，也不是是否有人確認過。

側邊選單項目使用相同的查詢顯示紅色計數徽章，所以徽章與清單永遠一致。當沒有任何內容時，頁面會如實顯示。

實際的影響是：你新增的任何自訂狀態都會讓事件留在這份清單裡。這通常正是你想要的——「Mitigated」不等於「done」——但這也表示，徽章只會在事件真正到達 resolved 狀態時才會清空。

## 通知狀態頁訂閱者狀態變更

狀態變更可以寄送電子郵件給你的狀態頁訂閱者，但必須通過好幾道關卡。理解這些關卡能省去很多「為什麼沒有人收到通知」的除錯時間。

通知是按每一列時間軸紀錄請求的，透過 **Notify Status Page Subscribers**（`shouldStatusPageSubscribersBeNotified`）——狀態變更彈窗與手動時間軸表單上的核取方塊。關閉時，該列會以已略過狀態儲存，並附上說明。開啟時，該列會被排入佇列，由背景工作接手處理——這個工作每分鐘執行一次，所以傳送速度很快，但不是即時的。

**在下列任一情況成立時，已排入佇列的列會被略過：**

- **新狀態是 created 狀態。** 訂閱者在事件宣告時已經被告知過，所以第一列時間軸紀錄刻意不再發第二則訊息。
- **事件沒有附加任何監測器。** 沒有資源，就沒有狀態頁可以對應到此事件。
- **事件在狀態頁上不可見**（`isVisibleOnStatusPage` 為關閉）。
- **狀態頁關閉了事件顯示**（`showIncidentsOnStatusPage` 為關閉）。這是以每個狀態頁為單位的——顯示同一個監測器的其他狀態頁仍會收到通知。

**還有一件事會改變結果。** 如果你在狀態變更彈窗中輸入了 **Public Note**，該列時間軸紀錄會被標記為已通知，而不會被排入佇列。備註本身才是傳達給訂閱者的內容，所以他們只會收到一則訊息，而不是兩則。純狀態變更訊息背後的事件類型是 `Subscriber Incident State Changed`。

關於誰會收到這些通知，以及範本如何選擇，請參見 [Subscribers & Announcements](/docs/status-pages/subscribers)。

## 讓事件不出現在狀態頁上

有三件各自獨立的事情決定一個事件是否會出現在公開頁面上，而且三者都必須成立：

- 狀態頁本身的 **Show Incidents**（`showIncidentsOnStatusPage`）。
- 事件上的 **Visible on Status Page**（`isVisibleOnStatusPage`）——位於事件 **Settings** 頁面上的一個開關。預設為開啟，且不在宣告精靈中；監測器條件可以透過 **Show Incident on Status Page** 來設定它。
- **目前狀態不是已解決狀態。** 這正是讓事件從作用中區段消失的原因：狀態頁查詢會抓取目前狀態為任何未解決狀態的事件。你不需要封存或關閉任何東西——你只需要解決它，它就會移入歷史紀錄。

**私人事件永遠不會顯示。** 開啟 **Private Incident** 會讓該事件在所有狀態頁上隱藏，無論上述開關為何，並將其限制為僅該事件的擁有者、擁有者團隊成員，以及專案管理員與擁有者可見。

頁面保留多少已解決的歷史紀錄，是狀態頁的設定，而不是事件的設定。關於頁面上的監測器如何決定哪些事件會出現，請參見 [Status Page Resources & Groups](/docs/status-pages/resources-and-groups)。

## 接下來可以閱讀

- [Incidents Overview](/docs/incidents/index)——事件功能各部分如何組合在一起。
- [Declaring an Incident](/docs/incidents/declaring-incidents)——宣告精靈、範本與 API。
- [Incident Notes, Owners & Feed](/docs/incidents/notes-owners-and-feed)——公開備註、私人備註與活動動態。
- [Incident Settings & Automation](/docs/incidents/settings)——範本、自訂欄位、規則與工作流程觸發器。
- [Subscribers & Announcements](/docs/status-pages/subscribers)——誰會收到狀態變更寄出的電子郵件。
- [Status Pages Overview](/docs/status-pages/index)——狀態頁顯示什麼內容、給誰看。
- [Workflows Overview](/docs/workflows/index)——用自動化回應狀態變更。
