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

當來源指出欄位時，資料表的 **欄位** 索引標籤會說明每個欄位來自哪裡以及它提供給什麼：Snowflake 的存取歷史（Enterprise 版，需要 `SNOWFLAKE` 資料庫上的 `IMPORTED PRIVILEGES`），以及 OpenLineage 的 `columnLineage` facet。

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
| **Power BI** | `{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }`, 獲准使用 Power BI 管理 API 的服務主體 |
| **Hightouch** | `{ "apiKey": "..." }` |
| **Census** | `{ "apiKey": "...", "region": "us" }`（或 `eu`） |

Hightouch 和 Census 是反向 ETL 工具：把資料表複製到 CRM 的同步，和儀表板一樣依賴該資料表，因此會以同樣方式讀取，並列在資料表的警示上。

只讀取儀表板的名稱和連結以及它們查詢的資料表，絕不讀取其資料。

## 管線

每個作業、dbt 專案和同步都會連同其執行顯示在 **管道** 下：每次執行何時開始和結束、花了多久、排程器指出的第幾次嘗試（Airflow 的 try number），以及失敗執行的錯誤。累積五次執行後，每個管線都會從自己的執行中學習一次執行通常需要多久，以及依其排程兩次執行之間通常間隔多久。管線的頁面會建議三個監測器：

- **Pipeline Run Failed**：某次執行失敗或遭到中止。
- **Pipeline Run Unusually Long**：某次執行的時間已達其典型時間的兩倍或更多；執行期間每五分鐘檢查一次，因此停滯的執行在結束之前就會被發現。
- **Pipeline Is Late**：超過其排程所允許的時間，仍沒有任何執行開始。

## 一個原因，一個警示

當一個資料表變得過時，由它建置的每個資料表也會變得過時。在資料警示開啟之前，OneUptime 會查詢血緣，看看該資料表或管線的上游是否已有開啟的警示：上游的資料表、寫入這些資料表的管線，以及這些資料表所在的資料庫，最多往上追溯五層。如果找到，新的警示就會成為該警示的後果：

- 它一開始就處於 **已確認** 狀態，因此不會有人因同一個問題被呼叫兩次；一旦其資料恢復，它也會自行恢復。
- 它的動態和 **資料** 卡片會說明是哪個警示造成了它，而且它會加入原因所在的片段。

原因的 **資料** 卡片會列出它的 **下游影響**：它造成的每個警示。資料表警示的卡片還會顯示寫入該資料表的服務，以及這些服務失敗的寫入、它們在警示前一天內的部署和其他變更。

## 變更合併之前

當 pull request 變更受監看的資料表時，[Production Review](/docs/ai/ai-agent) 會在該 pull request 上說明有什麼依賴它：讀取它的服務、由它建置的資料表、以它為基礎的儀表板，以及它的資料產品。在標示為 Staging 的資料庫上有複本的資料表，還會說明該複本有何不同：它的列、它的欄，以及資料表的檢查在那裡讀到的內容，這些都是當場執行。在只有探測器能連上的資料庫上，檢查會被略過，並如實說明。

## 後續步驟

:::cards
- [資料產品](/docs/data-observability/data-products): 針對人們使用的資料表的新鮮度 SLA。
- [OneUptime AI 與 API](/docs/data-observability/ai-and-api): 從資料表的寫入者和執行開始的調查。
:::
