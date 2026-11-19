# 血緣與管線

血緣說明每個資料表是由哪些資料表建置而成，以及哪些管線會寫入它。資料可觀測性會同時從六個地方收集血緣：OpenLineage 事件、dbt、Fivetran 和 Airbyte 的同步、你的追蹤中的作業、檢視，以及每個資料庫本身的查詢歷史，並用它把每個延遲或損壞的資料表連結到背後的執行，讓一個問題只開啟一個警示。

## 血緣的來源

| 來源 | 提供的內容 |
| --- | --- |
| **OpenLineage** | Airflow、Dagster、Spark、dbt 或 Flink 作業的每次執行，以及它讀取和寫入的資料表 |
| **dbt** | 每個模型由什麼建置而成、作為一次執行的每次建置，以及每個測試的結果 |
| **Fivetran 和 Airbyte** | 作為其連接器一次執行的每次同步，以及它載入的原始資料表 |
| **你的追蹤中的作業** | Kubernetes CronJob 或排程函式、它的執行，以及它的資料庫呼叫所讀取和寫入的資料表 |
| **檢視** | 檢視是由其定義所依據的資料表建置而成（PostgreSQL、Redshift、MySQL 8、SQL Server、Oracle、Snowflake、ClickHouse 具體化檢視、Databricks、MongoDB） |
| **查詢歷史** | 讀取一個資料表並寫入另一個資料表的查詢（Snowflake 的存取歷史、BigQuery 的作業、Redshift 的查詢記錄、ClickHouse 的查詢記錄、Databricks 的血緣資料表） |

資料表的 **血緣** 索引標籤會顯示建置它的資料表、寫入它的管線及其最新執行，以及由它建置的資料表。每條邊都會說明它是在哪裡觀察到的。

索引標籤頂端有一張圖，在每個方向上畫出幾步血緣（預設三步，也可以選 1、2 或 5 步）：左邊是建置該資料表的來源，右邊是由它建置的資料表和儀表板，從外部載入資料的管線則畫在資料進入的位置。每張卡片都會顯示目前狀態——延遲、開啟的警示、失敗的執行——當箭頭所屬管線的最新執行失敗時，箭頭會變成紅色，這樣就能從一張延遲的資料表一路追溯到造成它的那次執行。開啟任一資料表，圖就會以它為中心。

每張卡片在每個方向最多畫出十個資料表，其餘的以數字顯示，例如 **+14**。選取這個數字，即可在原處再畫出其中最多十個，有問題的排在前面，並畫出它們與已畫內容之間的每個箭頭。**重設圖** 會回到最初畫出的圖。當一側的資料表已達一張圖能容納的數量時，開啟某個資料表即可讓圖以它為中心。

當來源指出欄位時，資料表的 **欄位** 索引標籤會說明每個欄位來自哪裡以及它提供給什麼：Snowflake 的存取歷史（Enterprise 版，需要 `SNOWFLAKE` 資料庫上的 `IMPORTED PRIVILEGES`），以及 OpenLineage 的 `columnLineage` facet。

在 **血緣** 索引標籤上，於 **追蹤欄位** 中選擇該資料表的一個欄位，即可醒目提示它的來源與去向：沿圖向上到建置它的欄位，向下到由它建置的欄位，每個資料表上都會標出該欄位在那裡的名稱，即使它在途中被重新命名。如果某個箭頭的來源沒有指出欄位，該欄位可能會沿它延伸得比醒目提示的部分更遠，圖中會說明這一點。

每個血緣檢視 —— 資料表的 **血緣** 分頁、管道的、警示的、**血緣地圖**，以及 OneUptime AI 和 API 提供的內容 —— 只顯示你的角色可以讀取的資料表和管道。僅限其成員擁有的內容或某些標籤的角色，永遠看不到其他資料表或管道：它們不會被繪製，不會在任何箭頭上被命名，也不會被計入更遠處的資料表。

## 血緣地圖

**資料可觀測性 > 血緣地圖** 將你的專案已發現的每條資料流繪製在同一頁上，讓你無需先選擇某個資料表，就能看到誰在使用哪些資料以及資料流向哪裡。它顯示：

- 寫入和讀取資料表的 **服務**，來自追蹤中的資料庫跨度：這些跨度指出了它的資料表（`db.collection.name`，或較舊的 `db.sql.table`）和它的陳述式（`db.operation.name`），例如 `INSERT` 或 `SELECT`。
- 由其他資料表建置而成的 **資料表**，來自上述所有來源。
- 從 OneUptime 未監控的資料中載入資料表的 **管線**，例如 Fivetran 同步。在兩個受監控的資料表之間移動資料的管線，其名稱會顯示在兩者之間的箭頭上。
- BI 工具中的 **儀表板** 和反向 ETL 同步，它們讀取所建立在的資料表，即使沒有其他任何東西接觸這些資料表。不以任何受 OneUptime 監控的資料表為基礎的 Power BI 報表，會連同它所呈現的資料集以及這些資料集載入資料的資料來源一起繪製；當某個 BI 工具的儀表板都不在受監控的資料表上時，地圖會說明原因（[Power BI 血緣](#power-bi-血緣)）。

每個箭頭都是 OneUptime 記錄下來的，絕非猜測。卡片依資料流動的方向由左到右排列，並像資料表的圖一樣顯示它們的狀態：延遲的資料表、未關閉的警示或失敗的執行顯示為紅色。服務的追蹤發現過的箭頭顯示為青色。

搜尋資料表、服務、管線或儀表板，即可保留符合的內容及其所有上游和下游。選取一張卡片，可醒目提示其完整血緣，查看它來自哪裡、流向哪裡，並開啟它的頁面；**僅顯示其血緣** 會讓地圖上只留下這些內容。搜尋框旁的開關可以關閉服務、管線或儀表板的顯示。**清單** 將每個箭頭顯示為一行，手機上預設開啟的就是它。

一張地圖最多繪製 400 張卡片，優先繪製最近發現的資料流；當你的專案超出時，地圖會說明這一點。同一張地圖也可透過 `POST /api/data-observability/lineage/map` 取得，適用於有權讀取資料資產的使用者及其 API 金鑰。 超出時，地圖會說明它略去了多少個資料表（每個只計一次），還可以從別處開始：選擇一個資料庫，繪製其資料表的資料流以及這些資料流連接的卡片；或者輸入名稱並選擇 **搜尋整個專案**，繪製名稱中包含它的每個資料表、管道、服務和儀表板的資料流，無論多舊。**顯示整張地圖** 可返回。要讓 API 的地圖從別處開始，請傳送 `{ "dataStoreId": "<database ID>" }` 或 `{ "search": "orders" }`。

## OpenLineage

使用遙測 [擷取金鑰](/docs/telemetry/ingestion-keys)，將 OpenLineage 事件原封不動地傳送到 OneUptime：

- **URL：** `https://oneuptime.com/telemetry/openlineage`（在自行託管的 OneUptime 上，使用你自己的位址）
- **端點：** `api/v1/lineage`，即 OpenLineage 的預設值
- **API 金鑰：** 擷取金鑰，以 `Authorization: Bearer` 傳送，或設定 `x-oneuptime-token`

對於 Airflow 的 OpenLineage 提供者：

```bash
AIRFLOW__OPENLINEAGE__TRANSPORT='{"type": "http", "url": "https://oneuptime.com/telemetry/openlineage", "endpoint": "api/v1/lineage", "auth": {"type": "api_key", "apiKey": "YOUR_INGESTION_KEY"}}'
```

對於任何其他 OpenLineage 用戶端，請設定 `OPENLINEAGE_URL` 和 `OPENLINEAGE_API_KEY`。資料集會依 OpenLineage 命名規格對應到資料表，例如 `postgres://host:5432` 加上 `database.schema.table`、`snowflake://account` 加上 `database.schema.table`、`clickhouse://host:8443` 加上 `database.table`，以及 `databricks://workspace-host` 加上 `catalog.schema.table`。

## dbt

在 `dbt build`（或 run、test、seed、snapshot）之後，使用 [OneUptime CLI](/docs/cli/index) 傳送專案的建置成品：

```bash
npm install -g @oneuptime/cli
export ONEUPTIME_URL=https://oneuptime.com
export ONEUPTIME_TELEMETRY_INGESTION_KEY=<ingestion key>
dbt build
oneuptime dbt upload
```

在 CI 中，請把 `oneuptime dbt upload` 作為建置之後的步驟執行，即使建置失敗也要執行，這樣失敗的測試才會被記錄下來。dbt 建置的每個資料表，都會在其概覽上取得一張 **dbt** 卡片，取得其模型的血緣，並在 **檢查** 索引標籤上顯示其測試；每次建置都是該專案管線的一次執行。

## Fivetran 和 Airbyte

它們的 Webhook 會說明每次同步何時開始和結束。**管道 > 連接 Fivetran 或 Airbyte** 會以你的一個擷取金鑰填好 URL：

- **Fivetran：** 使用 Fivetran 的 REST API 建立的 Webhook，針對 `sync_start` 和 `sync_end` 事件，傳送到 `https://oneuptime.com/telemetry/fivetran/v1/webhook/<ingestion key ID>`，並以擷取金鑰作為它的簽署密碼。Fivetran 會用它為每次傳遞簽署，因此金鑰永遠不會出現在 URL 中。
- **Airbyte：** 將工作區的 Webhook 設為 `https://oneuptime.com/telemetry/airbyte/v1/webhook/<ingestion key>`，並為失敗和成功的同步開啟。請給 Airbyte 一個專用的金鑰。

因 API 速率限制而重新排程的 Fivetran 同步，會以 **已重新排程** 結束：這不是失敗，因此不會呼叫任何人。

## 你的追蹤中的作業

許多管線是 Kubernetes CronJob 或定時器上的函式，沒有排程器可以傳送血緣。它們的追蹤同樣能說明一切，不需安裝任何東西。每十五分鐘，帶有資源屬性 `k8s.cronjob.name` 或 `k8s.job.name` 的 Span，或帶有 `faas.name` 且 `faas.trigger` 為 `timer` 或 `datasource` 的 Span，都會成為 **管道** 下的一個管線：

- CronJob 的一次執行就是它的 Kubernetes Job，函式的一次執行就是它的 `faas.invocation_id`。
- 當位於其追蹤頂端的 Span 失敗時，該次執行即為失敗。在其內部失敗並被重試的呼叫不會使它失敗。
- 它寫入和讀取的資料表來自它的資料庫 Span。

每次執行都連結到它的追蹤和日誌。同樣的三個監測器也適用，因此停止執行的 CronJob 會被視為延遲。

## BI 工具中的儀表板

壞資料的真正影響是有人打開的儀表板。在 **BI 儀表板** 下，用可以讀取其儀表板的憑證新增你的 BI 工具。資料可觀測性每小時讀取每個儀表板及其背後的資料表，將每張資料表與受監控的資料表比對，並在資料表的 **血緣** 分頁、警示和 Production Review 中列出以該資料表以及由它建置的資料表為基礎的儀表板。

| 工具 | 憑證 |
| --- | --- |
| **Metabase** | `{ "apiKey": "mb_..." }` |
| **Superset** | `{ "username": "...", "password": "..." }` |
| **Tableau** | `{ "tokenName": "...", "tokenSecret": "...", "site": "acme" }` |
| **Looker** | `{ "clientId": "...", "clientSecret": "..." }` |
| **Power BI** | `{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }`, 獲准使用 Power BI 唯讀管理 API 的服務主體，並為每個報表背後的資料表開啟 [Power BI 血緣](#power-bi-血緣) 中的兩項中繼資料租用戶設定。報表和儀表板都會讀取，連同它們的檢視與重新整理（見下文） |
| **Hightouch** | `{ "apiKey": "..." }` |
| **Census** | `{ "apiKey": "...", "region": "us" }`（或 `eu`） |

Hightouch 和 Census 是反向 ETL 工具：把資料表複製到 CRM 的同步，和儀表板一樣依賴該資料表，因此會以同樣方式讀取，並列在資料表的警示上。

只讀取儀表板的名稱和連結、它們查詢的資料表，以及 Power BI 中誰開啟了它們和重新整理的結果，絕不讀取其資料。

### Power BI 中的檢視與重新整理

對於每個 Power BI 報表和儀表板，**BI 儀表板** 會先顯示它在過去 28 天內被開啟的次數、最後一次被開啟的時間，以及其資料最近一次重新整理的結果；重新整理失敗時也會顯示錯誤。開啟過它的人數、開啟最多的人以及它最近的重新整理，是可以開啟的欄。資料表的 **血緣** 索引標籤會對建立在該資料表之上的每個儀表板顯示相同內容，其擁有者與檢視者在 **更多** 底下。

- **檢視** 來自 Power BI 的活動記錄，透過其管理活動事件 API 讀取。Power BI 保留 28 天的記錄，每小時回應 200 個要求，並把每個要求拆成小時，因此 OneUptime 一次讀取一小時：每次每小時的讀取都會補上自上次以來的小時，再從最新的開始回溯 28 天，每次最多 100 個要求。新的 Power BI 工具會立即顯示最近幾天，並在一天內補齊全部 28 天；在此之前，檢視數會說明從何時開始計算。事件最多可能需要一小時才會進入記錄，因此檢視數最多落後兩小時。檢視者依 Power BI 的方式標示，也就是其電子郵件地址。
- 容量（Premium、Premium Per User 或 Fabric）上的資料集的 **重新整理** 來自 Power BI 的可重新整理項目管理清單：每個資料集最近一次重新整理及其錯誤，以及在 Power BI 保留的七天內執行和失敗的重新整理次數。
- **共用容量上的資料集的重新整理** 不在該清單中。Power BI 只會向可以變更資料集的人顯示其重新整理歷程記錄，因此請將服務主體以 **參與者**、**成員** 或 **系統管理員** 身分加入其工作區，並在 Fabric 系統管理入口網站的開發人員設定中為它開啟 **Service principals can call Fabric public APIs**。之後 OneUptime 會讀取每次重新整理及其錯誤。在此之前，BI 工具會說明有多少個資料集的重新整理無法讀取。
- 磚來自多個資料集的 Power BI 儀表板會顯示最近一次失敗的重新整理；若沒有失敗，則顯示最早的一次：其資料的新鮮程度僅止於此。

檢視以及容量上的重新整理，除了上述管理 API 存取權外不需要其他任何東西：服務主體位於 **Service principals can access read-only admin APIs** 允許的安全性群組中，且應用程式上沒有需要系統管理員同意的 Power BI 權限。無法讀取檢視或重新整理時，仍會讀取並保留儀表板，BI 工具會說明略過了什麼以及原因，下一次讀取會重試。

### 重新整理失敗的警示

在新增或編輯 Power BI 工具時開啟 **Alert on Failed Refreshes**（新工具預設為開啟），OneUptime 就會在 **監測器** 下為該工具保留一個以其命名的監測器。該監測器會為每個最近一次重新整理失敗或遭到取消的資料集開啟一個警示，在警示標題中標示資料集及其工作區，並在之後的某次重新整理完成時解決該警示。之後發佈的資料集一經讀取就會受到監測。關閉開關或移除該工具會一併移除監測器；在此之前，它是一個一般的監測器，有自己的擁有者、值班原則和維護時段。

重新整理失敗不使用管線的監測器。重新整理失敗的資料集會持續顯示其最近一次完成的重新整理的資料，直到之後的某次重新整理完成，因此它的警示會保持開啟直到那時；而失敗執行的警示會在執行一小時後清除。此外，重新整理每小時讀取一次：在結束後最多一小時才讀到的重新整理，常常會落在 **Pipeline Run Failed** 所看的那一小時之外；每半小時重新整理一次的資料集會反覆變成 **Pipeline Is Late**；已經結束但尚未讀到的重新整理會看起來像 **Pipeline Run Unusually Long**。

- 每小時的讀取會保留最近一次結束的重新整理失敗或遭到取消的資料集。每五分鐘，每個這樣的資料集會寫入 `oneuptime.data.bi.refresh_failed`：失敗期間為 1，之後的某次重新整理完成後的一小時內為 0。監測器會讀取該值，因此無論有多少次每小時讀取看到同一次失敗，都只會開啟一個警示。
- 失敗會在下一次每小時讀取時被發現：警示會在重新整理失敗後最多一小時開啟，並在之後的某次重新整理完成後最多一小時解決。
- 仍在執行的重新整理不會改變任何事：重新整理失敗的資料集的警示，在其下一次重新整理執行期間仍保持開啟，只有在某次重新整理完成後才會解決。
- 在容量上，Power BI 的可重新整理項目清單只會提供每個資料集最近一次的重新整理，因此若一次重新整理失敗後，同一小時內又有一次重新整理完成，這次失敗永遠不會被看到：那時資料已經恢復為最新。
- 共用容量上的資料集只有在其重新整理可以讀取時才會發出警示（見上文），而無法讀取重新整理的資料集會維持其警示原狀，直到可以讀取為止。

## 管線

每個作業、dbt 專案和同步都會連同其執行顯示在 **管道** 下：每次執行何時開始和結束、花了多久、排程器指出的第幾次嘗試（Airflow 的 try number），以及失敗執行的錯誤。累積五次執行後，每個管線都會從自己的執行中學習一次執行通常需要多久，以及依其排程兩次執行之間通常間隔多久。管線的頁面會建議三個監測器：

- **Pipeline Run Failed**：某次執行失敗或遭到中止。
- **Pipeline Run Unusually Long**：某次執行的時間已達其典型時間的兩倍或更多；執行期間每五分鐘檢查一次，因此停滯的執行在結束之前就會被發現。
- **Pipeline Is Late**：超過其排程所允許的時間，仍沒有任何執行開始。

管道的 **擁有者** 分頁列出負責它的人員和團隊，它的警示會傳給他們。**概覽** 和 **問題** 會列出失敗或延遲的管道的擁有者，或顯示 **無擁有者**，並提供新增擁有者的方式。

**擁有者規則** 可以替你指定管道的擁有者。在其 **管道規則** 分頁中，規則用規則運算式依管道的名稱（例如 `orders_daily.load_orders`）或命名空間（即它執行的位置，例如 `airflow://prod`）比對管道，並在 OneUptime 首次看到該管道時，把規則中的人員和團隊新增為管道的擁有者。若要把他們新增到既有的管道，請開啟該規則並選擇 **立即執行**。

管線的頁面有一張 **血緣** 卡片，是執行失敗或延遲時首先要看的地方：左邊是它讀取的資料表，右邊是它寫入的資料表，管線位於兩者之間，每張卡片都會顯示目前狀態。選擇更多步數，即可看到這些資料表由什麼建置，以及由它們建置了什麼；開啟任一資料表，即可查看它自己的 **血緣** 索引標籤。管線卡片或資料表卡片上未繪製資料表的數量，在這裡同樣可以在原處畫出更多。 選擇它寫入的某一欄位，即可跨管道追蹤該欄位：向上追蹤到它讀取的每個資料表中建置該欄位的欄位，向下追蹤到它寫入該欄位的每個資料表。

## 斷路器

檢查失敗或資料表延遲會通知其擁有者，但讀取該資料表的管道仍會照常執行，把錯誤的資料複製到下游。斷路器會搶先攔住它們：管道的第一步詢問 OneUptime 它讀取的資料表是否健康，只有答案為 go 時其餘步驟才會執行。

- 管道讀取的資料表有檢查失敗時，一律會停止該管道：警示處於開啟狀態的檢查，或失敗的 dbt 測試。
- 在管道的 **斷路器** 頁面開啟 **它讀取的資料表延遲時停止** 後，延遲的資料表也會停止它。每個管道預設都關閉此項，因為資料表延遲可能只代表今天比較清閒。
- 無法執行或尚未執行的檢查，以及沒有任何檢查的資料表，都不會停止任何東西。

該步驟使用可讀取資料可觀測性的專案 API 金鑰發出詢問，並以 `namespace/name`、僅名稱或 ID 指定管道。斷路器從管道的血緣中讀取它所讀取的資料表。請求也可以指定 `tables`，或只指定這些資料表，每張以 `schema.table`、僅名稱或 ID 表示；沒有比對到任何資料表的名稱會在 `notFound` 中傳回，絕不會被算作通過的資料表。只評判 API 金鑰可以讀取的資料表。

```bash
curl -sSf https://oneuptime.com/api/data-observability/circuit-breaker \
  -H "ApiKey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"pipeline": "airflow://prod/orders_daily.load_orders", "failWithStatusCode": true}'
```

回應中的 `verdict` 為 `go` 或 `stop`。`reasons` 列出每個失敗的檢查及其資料表，以及每張延遲的資料表及其延遲時長；`tables` 列出評判過的每張資料表；`answer` 用幾句話說明同樣的內容，供步驟的記錄使用。使用 `failWithStatusCode` 時，停止會以 HTTP 412 回應，因此 `curl -f` 會讓該步驟失敗。將 `stopsOnLateTables` 設為 `true` 或 `false` 可只為一次請求做決定，將 `dryRun` 設為 `true` 可在不保留回應的情況下詢問。

在 Airflow 中，把 `ShortCircuitOperator` 放在讀取這些資料表的工作之前：當它的函式傳回 false 時，其後的所有工作都會被略過。

```python title="orders_daily.py"
import os

import requests
from airflow.operators.python import ShortCircuitOperator


def inputs_are_healthy() -> bool:
    response = requests.post(
        "https://oneuptime.com/api/data-observability/circuit-breaker",
        headers={"ApiKey": os.environ["ONEUPTIME_API_KEY"]},
        json={"pipeline": "airflow://prod/orders_daily.load_orders"},
        timeout=30,
    )
    response.raise_for_status()
    answer = response.json()
    print(answer["answer"])
    return answer["verdict"] == "go"


check_inputs = ShortCircuitOperator(
    task_id="check_inputs",
    python_callable=inputs_are_healthy,
)

check_inputs >> load_orders
```

dbt 的 `on-run-start` 掛鉤在你的資料倉儲中執行 SQL，而不是發出網路請求，所以請在啟動 dbt 的步驟中詢問：CI 工作、cron 行或執行它的工作。dbt 專案的管道名稱是 `dbt/` 後接專案名稱。

```bash
curl -sSf https://oneuptime.com/api/data-observability/circuit-breaker \
  -H "ApiKey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"pipeline": "dbt/analytics", "failWithStatusCode": true}' \
  && dbt build
```

指定了管道的請求會保留在該管道上，除非它是試執行。在斷路器停止某個管道期間，該管道的 **斷路器** 頁面會說明從何時起以及為何停止，其 **概覽** 會以停止開頭，**需要處理** 和 **問題** 會將它列為已停止，取代其失敗或延遲的執行。當斷路器下一次回答 go，或在停止之後有執行開始時，停止就會結束。同一頁面還有 **立即測試**，它會詢問斷路器但不保留回應，以及已填好管道名稱的 curl、Airflow 和 dbt 步驟。

當伺服器上關閉了資料可觀測性時，斷路器會回答 go 並且不保留任何內容：關閉產品絕不會停止管道。

## 一個原因，一個警示

當一個資料表變得過時，由它建置的每個資料表也會變得過時。在資料警示開啟之前，OneUptime 會查詢血緣，看看該資料表或管線的上游是否已有開啟的警示：上游的資料表、寫入這些資料表的管線，以及這些資料表所在的資料庫，最多往上追溯五層。如果找到，新的警示就會成為該警示的後果：

- 它一開始就處於 **已確認** 狀態，因此不會有人因同一個問題被呼叫兩次；一旦其資料恢復，它也會自行恢復。
- 它的動態和 **資料** 卡片會說明是哪個警示造成了它，而且它會加入原因所在的片段。

原因的 **資料** 卡片會列出它的 **下游影響**：它造成的每個警示。資料表警示的卡片還會顯示寫入該資料表的服務，以及這些服務失敗的寫入、它們在警示前一天內的部署和其他變更。

警示的頁面在 **資料** 卡片下方有一張 **血緣** 卡片：圍繞其資料表的血緣（與該資料表的 **血緣** 索引標籤畫法相同），或圍繞其管線的血緣。往上通往造成它的警示、往下通往它造成的每個警示的路徑會被醒目標示——原因所在的資料表或管線標為 **原因**，它造成的每個警示所在的資料表標為 **後果**——其餘部分則會變淡，讓開啟它的人能看出問題從鏈條的哪裡開始。如果原因在畫在箭頭上的管線上，該箭頭會在管線名稱下方標出 **原因**。如果原因針對的是整個資料庫，或位於圖所能觸及的範圍之外的更上游，卡片會以文字說明。來自針對單一欄位的檢查（例如針對 `customer_id` 的 NULL 比例檢查）的警示，開啟時會在這些路徑旁追蹤該欄位，與該資料表的 **血緣** 索引標籤相同：它的來源與去向，以及它在每個資料表上的名稱。可以在那裡選擇該資料表的另一個欄位，或清除選擇以只查看路徑。**探索血緣** 會開啟該資料表的 **血緣** 索引標籤或該管線的頁面。 它引起的、位於箭頭上所繪管道的警示，同樣會在那裡顯示 **後果**；欄位選擇器會先列出檢查的欄位，再依資料表本身的順序列出資料表的其他欄位。

無權查看造成它的那個警示的人，既看不到 **資料** 卡片，也看不到血緣；它造成的警示中此人無權查看的那些，既不會醒目標示，也不會計入數量。

## Power BI 血緣

每個 BI 工具上的 **相符的資料表** 顯示其儀表板以多少張受監控的資料表為基礎，下方顯示阻止其餘資料表相符的第一個原因。**See Why** 列出上次讀取發現了什麼以及該怎麼做：你的儀表板讀取但未連線到 OneUptime 的資料庫，每個都只需按一下 **Connect Database**，類型和位址已經填好；已連線的資料庫未監控的資料表，它們可能被排除在掃描之外，或尚未收集；以及不是資料庫的來源，例如檔案和網頁。對於 Power BI，它還會指出已關閉的租用戶設定、從資料流程讀取的資料集，以及 Power BI 無法描述的資料集。每個儀表板的 **基於** 依 Power BI 的說法列出它呈現的資料集及其資料的來源。

OneUptime 從 Power BI 的中繼資料掃描中讀取每個 Power BI 資料集，以及其每張資料表背後的 Power Query：

- **連接器指定的資料庫**：SQL Server 和 Azure SQL（`Sql.Database`）、PostgreSQL、MySQL、Oracle、Amazon Redshift、Snowflake、Google BigQuery、Databricks、Amazon Athena 和 Microsoft Dataverse，以及其導覽選擇的結構描述和資料表。
- **查詢執行的 SQL**：連接器的 **SQL statement** 選項、`Value.NativeQuery` 和 `Odbc.Query`，以及每個 `FROM` 和 `JOIN` 之後的資料表。
- **參數和共用查詢**：參數在其被引用的任何位置都會代入，讀取暫存查詢的資料表會讀取該查詢所讀取的內容。
- **複合模型** 呈現其所建立在的資料集中的資料表。

報表呈現其資料集中的資料表，儀表板呈現其磚所用資料集中的資料表。資料來自哪裡（資料庫的伺服器和名稱、檔案的路徑、網址）取自掃描的資料來源，除上述管理 API 存取權外不需要其他任何東西。

只有在 Fabric 系統管理員於系統管理入口網站的 **Tenant settings > Admin API settings** 下，為包含該服務主體的安全性群組開啟兩項租用戶設定之後，Power BI 才會傳回資料集的資料表：

- **Enhance admin APIs responses with detailed metadata**：每個資料集的資料表。
- **Enhance admin APIs responses with DAX and mashup expressions**：載入這些資料表的查詢，它們說明讀取了哪些資料庫資料表。

之後，資料集經過重新整理或重新發佈後，Power BI 才會描述它；僅使用 DirectQuery 的資料集，要等有人開啟以它為基礎的報表之後。它從不描述即時資料集、即時連線到 Analysis Services 的資料集、Excel 活頁簿，或共用容量上超過 1 GB 的資料集。

每張資料表依名稱、結構描述和資料庫與受監控的資料表比對，伺服器則依短名稱或完整名稱比對。其他引擎的資料表從不比對，其他資料庫中的資料表也不比對：如果只監控 `Archive`，以 `Sales.dbo.Orders` 為基礎的報表不會與 `Archive.dbo.Orders` 關聯。

[重新整理](#power-bi-中的檢視與重新整理) 與資料表分開讀取：提示某些資料集的重新整理無法讀取的警告，並不說明它們的資料表的任何情況。

## 變更合併之前

當 pull request 變更受監看的資料表時，[Production Review](/docs/ai/ai-agent) 會在該 pull request 上說明有什麼依賴它：讀取它的服務、由它建置的資料表、以它為基礎的儀表板，以及它的資料產品。在標示為 Staging 的資料庫上有複本的資料表，還會說明該複本有何不同：它的列、它的欄，以及資料表的檢查在那裡讀到的內容，這些都是當場執行。在只有探測器能連上的資料庫上，檢查會被略過，並如實說明。

## 後續步驟

:::cards
- [資料產品](/docs/data-observability/data-products): 針對人們使用的資料表的新鮮度 SLA。
- [OneUptime AI 與 API](/docs/data-observability/ai-and-api): 從資料表的寫入者和執行開始的調查。在詢問 AI 中和透過 AI 代理，還能查詢某個資料表由什麼建置。
:::
