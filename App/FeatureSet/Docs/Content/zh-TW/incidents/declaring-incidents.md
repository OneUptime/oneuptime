# 宣告事件

宣告一起事件，就是 OneUptime 開始記分的那一刻。一筆記錄被建立、一個編號被蓋在上面、待命政策被觸發，並且——除非您另外指示——您的狀態頁面訂閱者會聽到消息。事件生命週期中的其餘一切，都繫於那第一次寫入。

事件進入 OneUptime 有四種方式，而它們最終都會落在同一個地方：`Incident` 資料表中的一列，具有嚴重程度、目前狀態，以及受影響資源的清單。差別只在於是誰填寫這些欄位——是您在凌晨 3 點、一份已儲存的範本、監控器的條件，還是您自己呼叫 API 的程式碼。

本頁將逐一、逐欄位地說明這四種方式，接著介紹伺服器會為您填入哪些內容，以及事件一旦存在會觸發哪些動作。

## 事件被宣告的四種方式

| 如果您想要……                                              | 選擇                                                                        |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| 手動開啟一起事件，自行填寫所有內容              | **Declare Incident** 精靈                                                             |
| 開啟一種欄位已預先填好的重複發生類型事件 | **Create from Template**                                                    |
| 在監控器檢查失敗時自動開啟一起事件               | 帶有 **When filters match, declare an incident.** 的監控器條件篩選器 |
| 從您自己的程式碼、指令碼或其他工具開啟一起事件       | `POST /api/incident`                                                        |

這四種方式都會寫入同一個模型，因此由探測器開啟的事件，看起來和應對人員手動開啟的事件一模一樣——除了伺服器在自動事件上設定的少數幾個記帳用欄位之外。

## 手動宣告事件

開啟 **Incidents → All Incidents**，然後點擊 **Incidents** 清單右上方的 **Declare Incident**。這會帶您進入一張標題為 **Declare New Incident** 的卡片，將表單分散在五個步驟中：**Incident Details**、**Resources Affected**、**Incident Roles**、**On-Call** 和 **More**。最後的提交按鈕文字同樣是 **Declare Incident**。

只有第一個步驟有必填欄位。如果您時間緊迫，只需填寫 **Incident Details** 並提交——之後可以從事件自己的頁面附加資源、指派角色和新增待命政策。

### 步驟 1 — Incident Details

- **Title** — 必填。所有人都會在清單、Slack 以及（若事件可見）您的狀態頁面上看到的單行摘要。預留位置文字：`Incident Title`。
- **Description** — 選填，以 Markdown 撰寫。這是會呈現在狀態頁面上的欄位，因此請以客戶為對象撰寫，而不是為您的團隊撰寫。您稍後可以從事件側邊選單中的 **Description** 編輯它。
- **Declared At** — 表單中為必填，預設為現在時間。這是事件上所有持續時間計算的起始時間戳記，因此如果您在記錄較早發生的事情，請將其回填為較早的時間。
- **Incident Severity** — 必填。從您專案設定的嚴重程度中選一個；新專案會預先建立 **Critical Incident**、**Major Incident** 和 **Minor Incident**。
- **Incident State** — 選填。不去理會它，事件就會落入標記為 `isCreatedState` 的狀態，新專案將其預先建立為 **Identified**。只有在您記錄的事件已經超過那個階段時，才需要設定它。

**如果狀態下拉選單出現問題。** 如果您的專案沒有帶有 `isCreatedState` 旗標的狀態，建立呼叫就會失敗，並提示您從設定中新增一個建立狀態。這通常只會發生在狀態被大量修改過的專案上——請見[事件狀態與嚴重程度](/docs/incidents/states-and-severities)。

### 步驟 2 — Resources Affected

- **Resources Affected** — 一個單一搜尋方塊，可附加監控器、主機、Kubernetes 叢集、Docker 主機、Podman 主機與服務。在底層，這些是事件上各自獨立的關聯（`monitors`、`hosts`、`kubernetesClusters`、`dockerHosts`、`podmanHosts`、`services` 等等），但表單將它們收合成單一挑選器。
- **Change Monitor Status to** — 選填。選擇一個監控器狀態，套用到附加至這起事件的每一個監控器，讓宣告事件與將監控器標記為降級這兩件事一次完成，而非分成兩步。

**即使感覺多餘，也要附加監控器。** 事件與狀態頁面之間的連結，是透過事件的監控器來建立的：當狀態頁面的某項資源同時也是該事件的監控器之一時，狀態頁面就會顯示該事件。當事件沒有附加任何監控器時，發送給訂閱者的狀態變更通知會被直接略過。請見[狀態頁面資源與群組](/docs/status-pages/resources-and-groups)。

### 步驟 3 — Incident Roles

- **Assign Incident Roles** — 將團隊成員指派到您專案定義的角色。有些角色可以接受一位以上的使用者。

角色本身是在 **Incidents → Settings → Incident Roles** 中設定的，您可以在那裡定義應對過程中可指派的角色——事件指揮官（Incident Commander）、應對人員（Responder），以及您流程所需的其他角色。如果您跳過此步驟，在第一次狀態變更時，若尚未有人擔任 Incident Commander 角色，系統會自動指派一位。

### 步驟 4 — On-Call

- **On-Call Policy** — 多選欄位，選擇此事件建立時要執行的待命輪值政策。這對應到事件上的 `onCallDutyPolicies`。

這是唯一能將待命政策直接附加到事件上的地方。嚴重程度本身並不帶有待命政策——嚴重程度是一個標籤，只在待命規則中作為*比對條件*來影響呼叫。在 **Incidents → Rules → On-Call Rules** 設定的規則，會把它們的政策疊加到您在此處選擇的政策之上；最終執行的集合，是兩者去重後的聯集。

### 步驟 5 — More

- **Labels** — 選填，屬於進階功能：能夠存取這些標籤的團隊成員，才是能夠存取此事件的人。
- **Notify Status Page Subscribers** — 核取方塊，預設開啟。控制是否要以電子郵件通知訂閱者事件已建立（`shouldStatusPageSubscribersBeNotifiedOnIncidentCreated`）。若是您仍想記錄但不想對外聲張的內部雜訊，可以將其關閉。
- **Private Incident** — 核取方塊，預設關閉（`isPrivate`）。私人事件僅對其擁有者使用者、擁有者團隊的成員、專案管理員與專案擁有者可見——並且無論其他設定為何，一律會從所有狀態頁面隱藏。事件清單會以紅色的 **Private** 圓標標示這些事件。

**Should be visible on status page?** 旗標（`isVisibleOnStatusPage`）不在精靈中；它預設為 true。之後可以從事件側邊選單中的 **Settings** 變更它，該處標示為 **Visible on Status Page**。

## 從範本宣告事件

如果您不斷宣告相同類型的事件——相同的標題模式、相同的嚴重程度、相同的待命政策——不妨把它儲存成一份範本，一次搞定。

點擊 **Create from Template**（**Declare Incident** 旁的外框按鈕），會開啟一個 **Create Incident from Template** 彈出視窗，內有 **Select Incident Template** 下拉選單。選擇一份範本，建立表單就會以預先填好的內容開啟；提交前您仍然可以修改任何欄位。如果您的專案還沒有任何範本，您會看到一個 **No Incident Templates** 彈出視窗，其中的 **Create Template** 按鈕會帶您前往 **Incidents → Settings → Incident Templates**。

範本本身是用另一個六步驟精靈建立的——**Template Info**、**Incident Details**、**Resources Affected**、**On-Call**、**Owners**、**Labels**——包含以下欄位：

| 欄位                        | 用途                                                |
| ---------------------------- | ------------------------------------------------------ |
| **Template Name**            | 在挑選器中如何識別這份範本。          |
| **Template Description**     | 給未來的自己的備忘，說明何時該用它。 |
| **Title**                    | 預先填入事件的標題。                    |
| **Description**              | 預先填入事件的 Markdown 描述。     |
| **Incident Severity**        | 預先填入事件的嚴重程度。               |
| **Initial Incident State**   | 由此範本建立的事件所啟始的狀態。       |
| **Resources Affected**       | 要附加的監控器、主機、叢集與服務。      |
| **Change Monitor Status to** | 要套用到已附加監控器的監控器狀態。      |
| **On-Call Policy**           | 事件建立時要執行的政策。      |
| **Owner - Teams**            | 擁有由此範本建立之事件的團隊。   |
| **Owner - Users**            | 擁有由此範本建立之事件的使用者。   |
| **Labels**                   | 套用到事件上的標籤。               |

幾條快速規則：

- 範本無法直接在範本清單上編輯——您先建立一份，之後再開啟它來修改。
- 範本只會填入您留空的欄位。在建立頁面上，範本會作為您可以覆寫的預先填入內容；透過 API 時，只有當請求中該欄位為 `undefined` 時，伺服器才會用範本填入該欄位。呼叫方所提供的內容永遠優先。

## 由監控器條件自動宣告

大多數事件都不應該需要人工輸入。在監控器的條件編輯器中，開啟 **When filters match, declare an incident.** 切換開關，就會出現一個 **Create Incident** 區塊，內有 **Add Incident** 按鈕——一條條件篩選器可以宣告不只一起事件。

每個項目包含：

- **Incident Title** — 支援範本語法；預留位置文字建議類似 `{{monitorName}} is down` 的格式。
- **Severity** — 必填。
- **Incident Description** — 同樣支援範本語法。
- **On-Call → On-Call Policies** — 此事件建立時要執行的政策。
- **Incident Roles** — 預先將團隊成員指派到角色。
- **Ownership & Labels → Owner Teams**、**Owner Users**、**Labels**。
- **Advanced Options → Auto Resolve Incident**（當條件不再符合時自動解決事件）、**Show Incident on Status Page**、**Private Incident** 和 **Remediation Notes**。

您可以在標題、描述與補救備註中使用的 `{{variable}}` 完整預留位置清單，請見[事件與警示範本](/docs/monitor/incident-alert-templating)。

以這種方式建立的事件會由伺服器加上標記：設定 `isCreatedAutomatically`、`createdCriteriaId` 記錄是哪一條條件篩選器觸發的，`createdByProbe` 記錄是哪一個探測器發現的。除此之外，它們的行為與手動宣告的事件完全相同。

## 透過 API 宣告

事件模型公開了一個標準的 CRUD 端點，因此 `POST /api/incident` 就能建立一起事件。使用在 **Project Settings → API Keys** 產生的 API 金鑰進行驗證，並透過 `apikey` 標頭傳送——該金鑰即可識別專案，因此您不需要另外傳送專案 ID。

```bash
curl -X POST https://oneuptime.com/api/incident \
  -H "apikey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "title": "Checkout latency above SLO",
      "description": "Investigating elevated p99 latency on the checkout service.",
      "incidentSeverityId": "<incident-severity-id>"
    }
  }'
```

請求主體上一些有用的欄位：

- `title` — 您真正必須提供的唯一欄位。
- `declaredAt` — 此處為選填，即使表單要求它是必填的。省略它，伺服器就會使用目前時間。
- `incidentSeverityId` 與 `currentIncidentStateId` — 伺服器會檢查這兩者是否都屬於與該 API 金鑰相同的專案，若不屬於則拒絕該請求。**Change Monitor Status to** 背後的監控器狀態也適用相同的檢查。
- `createdIncidentTemplateId` — 套用一份已儲存的範本。您省略的任何欄位都會由範本填入；您傳送的任何欄位則保持原樣。

相關端點還有 `/api/incident-state`、`/api/incident-severity` 和 `/api/incident-state-timeline`。自動產生的 [API 參考文件](/reference)提供了每個端點確切的請求與回應格式，包括監控器等關聯欄位的表示方式。

## 事件編號與前綴

每起事件都會從一個依專案計數的計數器中，取得一個由伺服器在建立時指派的循序編號。有兩個欄位保存它：`incidentNumber`（原始整數）和 `incidentNumberWithPrefix`（您實際看到的內容）。在未設定前綴的情況下，顯示值為 `#42`。

若要更改，請前往 **Incidents → Settings → More Settings**。**Number Prefix** 卡片中有一個 **Incident Number Prefix** 欄位（最多 20 個字元，預留位置文字為 `INC-`）——設定它之後，同一起事件就會呈現為 `INC-42`。留空則保留預設的 `#`。該卡片上也有 **Incident Episode Number Prefix**，用於事件片段編號。

該編號會出現在事件清單的第一欄，連結至該事件，並在事件的 **Overview** 上顯示為 **Incident Number**。

## 事件宣告當下發生的事

建立呼叫做的事，不只是寫入一列資料。依序如下：

1. **伺服器補齊空白欄位。** `declaredAt` 預設為現在時間，目前狀態預設為專案的 `isCreatedState` 狀態，事件編號與帶前綴的編號則由專案計數器指派。
2. **套用範本**（如果提供了 `createdIncidentTemplateId`）——只填入呼叫方留白的欄位。
3. **執行隱私規則**，若有符合的規則，會將該事件標記為私人。這是第一個執行的規則引擎，因此其後的每個步驟看到的都是正確的隱私設定。
4. **執行擁有者規則**，加入符合規則所指定的擁有者使用者與團隊。
5. **執行標籤規則**，加入與該事件相符的標籤。
6. **執行待命規則。** 在 **Incidents → Rules → On-Call Rules** 中，每一條已啟用且條件符合的規則，都會將其政策加入該事件。沒有優先順序，也沒有短路機制——所有符合的規則都會觸發，政策會經過去重。
7. **執行運行手冊規則**，附加並啟動符合條件的運行手冊。請見[運行手冊](/docs/runbooks/index)。
8. **執行待命政策。** 事件上的每一項政策——無論是在精靈中挑選、從範本繼承，或由規則加入——都會以 `IncidentCreated` 事件類型並行執行。一項政策失敗不會阻止其他政策執行。
9. **訂閱者被排入佇列**，前提是 **Notify Status Page Subscribers** 保持開啟，且該事件在狀態頁面上可見。發送作業是由背景工作處理，而非在您的請求中同步完成。
10. **觸發工作流程。** **On Create Incident** 觸發器會啟動任何建立在它之上的工作流程。請見[工作流程概觀](/docs/workflows/index)。

從那一刻起，這起事件就是進行中的：它會計入 Incidents 側邊選單中的 **Active Incidents** 徽章（任何未標記 `isResolvedState` 的狀態都計為進行中）、出現在帶有其某個監控器的狀態頁面上，並且它的 **State Timeline** 開始記錄。

## 接下來可以閱讀

- [事件概觀](/docs/incidents/index) — 事件模型如何組合在一起。
- [事件狀態與嚴重程度](/docs/incidents/states-and-severities) — 狀態旗標的作用，以及如何新增自己的狀態。
- [事件備註、負責人與動態](/docs/incidents/notes-owners-and-feed) — 公開備註、私人備註、擁有者與活動動態。
- [事件設定與自動化](/docs/incidents/settings) — 範本、自訂欄位、角色、規則與工作流程觸發器。
- [訂閱者與公告](/docs/status-pages/subscribers) — 誰會聽到您剛剛宣告的這起事件。
- [事件與警示範本](/docs/monitor/incident-alert-templating) — 自動宣告事件可用的變數。
