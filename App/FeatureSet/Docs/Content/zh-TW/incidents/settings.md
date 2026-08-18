# 設定與自動化

事件設定並不在「Project Settings」中。它位於事件產品區域本身，在 **Incidents → Settings** 和 **Incidents → Rules** 之下，路由開頭為 `/dashboard/{projectId}/incidents/settings/`。如果您一直在「Project Settings」中尋找事件範本或自訂欄位卻遍尋不著,原因就在這裡。

事件側邊選單中的 **Rules** 和 **Settings** 區段預設都是收合的,所以您必須先展開它們,下方項目才會出現。這裡的一切都是專案範圍的:範本、角色、自訂欄位和規則都屬於單一專案,並套用到該專案中宣告的每一個事件。

本頁面是這些設定的參考資料——每個頁面包含什麼內容,以及其中哪些會在事件建立時自動執行。

## 事件設定的位置

在左側導覽開啟 **Incidents**,然後展開側邊選單底部的 **Settings**。

| 頁面                     | 您在這裡做什麼                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| **Incident State**       | 新增、重新命名、變更顏色並重新排序事件所經歷的狀態。                       |
| **Incident Severity**    | 新增、重新命名、變更顏色並重新排序嚴重性等級。                                            |
| **Incident Templates**   | 預先填寫整個事件——標題、描述、資源、待命政策、擁有者、標籤。 |
| **Note Templates**       | 供公開與私人備註使用的可重複使用文字。                                                  |
| **Postmortem Templates** | 可重複使用的事後分析結構。                                                              |
| **Custom Fields**        | 定義出現在每個事件上的額外欄位。                                                   |
| **Incident Roles**       | 定義您指派給應變人員的角色,例如 Incident Commander。                       |
| **More Settings**        | 事件與事件片段編號的前綴。                                                    |

**Incident State** 與 **Incident Severity** 在 [Incident States & Severities](/docs/incidents/states-and-severities) 中有詳細說明——本頁其餘部分從 **Incident Templates** 開始。

展開 **Rules**,您會看到另外八個頁面:**Grouping Rules**、**On-Call Rules**、**Owner Rules**、**Runbook Rules**、**Privacy Rules**、**Label Rules**、**SLA Rules** 與 **Reminder Rules**。這些會在後面說明。

## 事件範本

事件範本是已儲存的事件骨架。每次付款叢集出問題時,您不必重新輸入相同的標題、相同的監測器清單和相同的待命政策,只需儲存一次,之後就能從中宣告。

前往 **Incidents → Settings → Incident Templates**(`/dashboard/{projectId}/incidents/settings/templates`)。此卡片標題為 **Incident Templates**。建立一個範本會引導您完成六步驟精靈:

- **Template Info** —— **Template Name** 與 **Template Description**。這些是替範本本身命名;它們永遠不會出現在事件上。
- **Incident Details** —— **Title**、**Description**(Markdown)、**Incident Severity** 與 **Initial Incident State**。**Initial Incident State** 為選填,預設為空,其選項依狀態順序列出。留空的話,以此範本建立的事件會落在專案的建立狀態。
- **Resources Affected** —— 事件應附加的監測器、主機、叢集與服務,以及 **Change Monitor Status to**。
- **On-Call** —— **On-Call Policy**,即以此範本建立事件並宣告時要執行的政策。
- **Owners** —— **Owner - Teams** 與 **Owner - Users**。
- **Labels** —— **Labels**。

幾項快速規則:

- 範本清單只顯示 **Name** 與 **Description**。列項無法在清單中直接編輯或刪除——開啟範本(`/dashboard/{projectId}/incidents/settings/templates/{modelId}`)才能變更它。
- 範本支援 JSON 匯入與匯出,因此您可以在專案之間搬移範本。
- 空白狀態顯示「No incident templates found.」。

### 範本如何被套用

有兩種路徑,行為方式相同。

- **從儀表板**—— 事件清單上的 **Create from Template** 按鈕會開啟 **Select Incident Template** 選擇器,宣告頁面會從查詢字串參數 `incidentTemplateId` 讀取範本,然後用範本連同其擁有團隊與擁有使用者預先填寫表單。
- **從 API**—— 在 `POST /api/incident` 傳入 `createdIncidentTemplateId`,伺服器就會從範本填入事件。

重要的是合併規則:**範本只會填入您未定義的欄位**。標題、描述、事件嚴重性、初始事件狀態、**Change Monitor Status to** 背後的監測器狀態、監測器、主機、Kubernetes 叢集、Docker 主機、Podman 主機、服務、待命政策與標籤,只有在呼叫端或表單未提供任何內容時,才會從範本複製過來。您明確設定的任何內容永遠優先。

**空白狀態對話框指向錯誤的地方。** 如果您還沒有任何範本,**Create from Template** 按鈕會顯示 **No Incident Templates** 對話框。其文字指向 Project Settings,但按鈕實際上導向 **Incidents → Settings → Incident Templates**——那才是真正的位置。

## 備註範本

備註範本為應變人員提供事件更新的罐頭文字,讓凌晨三點的狀態頁面更新不必由半睡半醒的人從頭寫起。

前往 **Incidents → Settings → Note Templates**(`/dashboard/{projectId}/incidents/settings/note-templates`)。此卡片標題為 **Public or Private Note Templates for Incidents**——一個資料庫同時服務兩種備註類型。建立表單有兩個步驟:

- **Template Info** —— **Template Name** 與 **Template Description**,皆為必填。
- **Note Details** —— 備註內文本身,以 Markdown 撰寫,必填。

與事件範本一樣,列項是用來建立與檢視,而非就地編輯;開啟範本才能變更它。

備註範本會出現在您真正需要它們的地方:**Acknowledge Incident** 與 **Resolve Incident** 確認對話框都在 **Public Note** 欄位旁提供 **Select Note Template**。公開與私人備註的差異請參閱 [Incident Notes, Owners & Feed](/docs/incidents/notes-owners-and-feed)。

## 事後分析範本

事後分析範本是您在事件之後撰寫報告的骨架——您的標題、您的提示、您的固定問題——讓專案中的每次檢討都遵循相同的形式。

前往 **Incidents → Settings → Postmortem Templates**(`/dashboard/{projectId}/incidents/settings/postmortem-templates`)。此卡片標題為 **Postmortem Templates**。建立表單有兩個步驟:

- **Template Info** —— **Template Name** 與 **Template Description**,皆為必填。
- **Postmortem Details** —— **Postmortem Template**,即內文本身,以 Markdown 撰寫,必填。

您是從事件套用範本,而不是從設定套用。開啟一個事件,在其側邊選單中選擇 **Postmortem**(`/dashboard/{projectId}/incidents/{incidentId}/postmortem`),然後使用 **Apply Template**。這會開啟一個帶有 **Select Template** 下拉選單的 **Apply Postmortem Template** 對話框;選取一個範本會將範本內文載入 **Postmortem Note** 編輯器,您可以在儲存前編輯它。事件片段有相同的 **Postmortem** 頁面,並使用相同的範本庫。

## 自訂欄位

自訂欄位讓您在每個事件上攜帶自己的中繼資料——內部服務名稱、變更工單參照、客戶等級。

前往 **Incidents → Settings → Custom Fields**(`/dashboard/{projectId}/incidents/settings/custom-fields`)。此頁面標題為 **Incident Custom Fields**。每個定義包含:

- **Field Name** —— 必填,至少兩個字元。預留文字建議使用類似 slug 的名稱,例如 `internal-service`。
- **Field Description** —— 選填。
- **Field Type** —— 必填。這決定資料如何輸入。下拉選單類型還需要列出其選項。
- **Dropdown Options** —— 出現在下拉選單中的值,各自可有選填的顏色。

定義本身存在於自己的模型中;值則存在於事件本身的 `customFields` 欄位中。在單一事件上,您從事件側邊選單的 **Custom Fields**(`/dashboard/{projectId}/incidents/{incidentId}/custom-fields`)填入它們。

**有一點值得留意的落差。** 事件自訂欄位定義是事件家族中唯一沒有工作流程觸發器的部分——請見下方工作流程章節。

## 事件角色

事件角色是您在應變期間指派給人員的具名職務。在 **Incidents → Settings → Incident Roles**(`/dashboard/{projectId}/incidents/settings/roles`)定義它們;卡片描述以 Incident Commander 與 Responder 作為範例。

角色只是定義。您是逐一事件指派人員的——宣告精靈有一個 **Incident Roles** 步驟,其中含 **Assign Incident Roles** 欄位,且每個事件的側邊選單都有 **Roles** 頁面。

## 編號前綴

每個事件都會有一個編號。預設呈現為 `#42`。如果您的團隊口頭上說「INC-42」,那就讓產品也這樣說。

前往 **Incidents → Settings → More Settings**(`/dashboard/{projectId}/incidents/settings/more`)。此卡片為 **Number Prefix**,在專案上包含兩個欄位:

- **Incident Number Prefix** —— 最多 20 個字元,預留文字為 `INC-`。設定後,事件 `#42` 會顯示為 `INC-42`。
- **Incident Episode Number Prefix** —— 事件片段編號的相同概念,預留文字為 `IE-`。

留空任一欄位以保留預設的 `#` 前綴;未設定的欄位會顯示 `# (default)`。以 **Update** 儲存。加上前綴的值會以 `incidentNumberWithPrefix` 儲存在事件上,這就是事件清單與事件標頭所呈現的內容。

## 事件建立時執行的規則

**Incidents → Rules** 包含八個規則引擎。它們做的事都一樣——在事件建立的當下檢視事件,若符合條件就採取行動——但它們在做什麼,以及多個相符規則如何解決上有所不同。

- **Grouping Rules** —— 將相關事件分組為片段。規則依優先順序評估;較低的優先順序數字先執行。
- **On-Call Rules** —— 對相符的事件執行待命政策。詳見下方說明。
- **Owner Rules** —— 自動指派擁有者。
- **Runbook Rules** —— 當事件相符時啟動一份 [runbook](/docs/runbooks/index)。
- **Privacy Rules** —— 決定相符的事件是否為私人。
- **Label Rules** —— 自動套用標籤。
- **SLA Rules** —— 追蹤回應與解決時間。規則依順序評估;較低的順序數字先執行。
- **Reminder Rules** —— 在事件仍處於開啟狀態時,定期提醒事件擁有者。規則依順序評估,第一個相符的規則獲勝。

**順序語意並不一致。** Grouping Rules、SLA Rules 與 Reminder Rules 是依順序評估的。On-Call Rules 則不是——每個相符的規則都會觸發。請不要假設某一種模型適用於全部八種。

**On-Call Rules**、**Owner Rules**、**Label Rules** 與 **Privacy Rules** 頁面採用分頁式介面——一個 **Incident Rules** 分頁與一個 **Episode Rules** 分頁,各自有自己的表格。除非您特別指的是片段,否則請設定 **Incident Rules** 分頁。**Grouping Rules**、**Runbook Rules**、**SLA Rules** 與 **Reminder Rules** 則是單一表格。

## 事件待命規則

**Incidents → Rules → On-Call Rules**(`/dashboard/{projectId}/incidents/settings/on-call-rules`)是您讓呼叫自動化的地方。此卡片 **Incident On-Call Rules** 描述的是在相符事件建立時自動執行待命政策的規則。此頁面有兩個分頁:**Incident Rules** 與 **Episode Rules**。

建立表單有三個步驟:

- **Basic Info** —— **Name**(預留文字建議類似「為任何資料庫事件呼叫資料庫團隊」的內容)、**Description**,以及一個 **Enabled** 切換開關。清單會針對每條規則呈現綠色的 **Enabled** 或紅色的 **Disabled** 標籤。
- **Match Criteria** —— **Monitors**、**Incident Severities**、**Incident Labels**、**Monitor Labels**,加上針對事件標題、事件描述、監測器名稱與監測器描述的不區分大小寫正規表示式欄位。
- **On-Call Policies** —— 此規則要執行的政策。

### 相符如何被解決

此頁面內建的規則值得牢記:

- 只有當您填寫的**所有**條件都通過時,規則才會相符。您留空的條件會被略過,而非視為失敗。
- 在單一清單條件內——**Monitors**、**Incident Severities**、**Incident Labels**、**Monitor Labels**——比對方式是任一相符即可。
- 樣式欄位是不區分大小寫的正規表示式。
- **所有相符的規則都會觸發。** 沒有優先順序,也沒有短路機制。
- 實際執行的政策集合,是每個相符規則的政策的聯集,加上手動或透過範本附加到事件上的任何政策,並經過去重,讓每個政策最多執行一次。

嚴重性只有在這裡是比對條件,其他地方都不是。事件嚴重性上並沒有待命欄位——選取「Critical Incident」本身不會呼叫任何人。如果您希望嚴重性驅動呼叫,請撰寫一條依此比對的待命規則。

## 直接附加待命政策

規則並非唯一的途徑。每個事件都攜帶自己的待命政策清單,呈現為宣告精靈 **On-Call** 步驟上的 **On-Call Policy** 欄位,以及事件範本 **On-Call** 步驟上的同名欄位。欄位描述說得很清楚:這些是此事件建立時要執行的待命政策。

事件建立時,OneUptime 會依序執行標籤規則、待命規則(將其相符的政策合併到事件清單中)、再執行 runbook 規則——如果結果清單非空,其中每個政策都會被執行。執行是平行進行且各自獨立結算的,因此一個政策失敗不會阻止其他政策。每次執行都會標記觸發它的事件,以及事件建立通知事件類型。

若要查看發生了什麼,請開啟事件並在其側邊選單中選擇 **On-Call Executions**(`/dashboard/{projectId}/incidents/{incidentId}/on-call-policy-execution-logs`)。

## 以工作流程驅動事件

事件的工作流程觸發器並非手動撰寫——OneUptime 會從資料模型自動產生它們,因此每個事件家族模型都會取得 **On Create X**、**On Update X** 與 **On Delete X** 元件,以模型的單數名稱命名。最主要的三個是 **On Create Incident**、**On Update Incident** 與 **On Delete Incident**,它們位於 `/dashboard/{projectId}/workflows` **新增元件** 面板的 **Incident** 類別中。

同樣的產生機制也為設定本身提供觸發器:**On Create Incident State**、**On Update Incident Severity**、**On Create Incident Template**、**On Create Incident Note Template**、**On Create Incident State Timeline**、**On Create Incident Public Note**、**On Create Incident Internal Note**、**On Create Incident On-Call Rule**、**On Create Incident Role**、**On Create Incident Member** 等等。每個模型也會取得對應的動作元件——**Find One Incident**、**Create One Incident**、**Update One Incident**、**Delete One Incident** 及其多列版本——所以名稱相近的觸發器與動作會並列於同一類別中。**On Create Incident** 啟動一個工作流程;**Create One Incident** 則是開啟一個事件。

接線時需注意的幾個細節:

- **On Update X** 接受一個選填的 **Listen on** 參數,將觸發器限縮到觸及特定欄位的更新。留空則任何變更都會觸發。如果收到的更新沒有記錄哪些欄位發生變動,篩選會被略過,工作流程仍會執行。
- **On Create X** 與 **On Update X** 都需要一個必填的 **Select Fields** 參數;**On Delete X** 則不需要任何參數。
- 這三者都只公開一個 **Success** 輸出埠,且各自接受一個 ID 參數,讓您可以手動針對單一記錄執行工作流程。
- 名稱來自模型的單數名稱,而非其資料表名稱——這就是為什麼您看到的是 **On Create Incident Team Owner** 與 **On Create Incident User Owner**,而不是資料表形式的名稱。
- 事件自訂欄位定義沒有觸發器。該模型是事件家族中唯一停用工作流程的成員。

若要建立工作流程的其餘部分,請參閱 [Authoring a Workflow](/docs/workflows/authoring) 與 [Variables](/docs/workflows/variables)。

## 接下來可以閱讀

- [事件概觀](/docs/incidents/index) —— 事件功能如何組合在一起。
- [宣告事件](/docs/incidents/declaring-incidents) —— 宣告精靈、範本與 API。
- [事件狀態與嚴重程度](/docs/incidents/states-and-severities) —— 狀態與嚴重性設定頁面,以及各項旗標的作用。
- [事件備註、負責人與動態](/docs/incidents/notes-owners-and-feed) —— 備註範本的使用位置。
- [訂閱者與公告](/docs/status-pages/subscribers) —— 誰會在您團隊之外得知事件消息。
- [工作流程概觀](/docs/workflows/index) —— 在事件觸發器之上進行自動化。
- [Runbook 概觀](/docs/runbooks/index) —— runbook 規則所附加的程序。
