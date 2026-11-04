# 血緣與管線

血緣說明每個資料表是由哪些資料表建置而成，以及哪些管線會寫入它。資料可觀測性會同時從五個地方收集血緣：OpenLineage 事件、dbt、Fivetran 和 Airbyte 的同步、檢視，以及每個資料庫本身的查詢歷史，並用它把每個延遲或損壞的資料表連結到背後的執行，讓一個問題只開啟一個警示。

## 血緣的來源

| 來源 | 提供的內容 |
| --- | --- |
| **OpenLineage** | Airflow、Dagster、Spark、dbt 或 Flink 作業的每次執行，以及它讀取和寫入的資料表 |
| **dbt** | 每個模型由什麼建置而成、作為一次執行的每次建置，以及每個測試的結果 |
| **Fivetran 和 Airbyte** | 作為其連接器一次執行的每次同步，以及它載入的原始資料表 |
| **檢視** | 檢視是由其定義所依據的資料表建置而成（PostgreSQL、Redshift、MySQL 8、SQL Server、ClickHouse 具體化檢視、Databricks） |
| **查詢歷史** | 讀取一個資料表並寫入另一個資料表的查詢（BigQuery 的作業、Redshift 的查詢記錄、ClickHouse 的查詢記錄、Databricks 的血緣資料表） |

資料表的 **血緣** 索引標籤會顯示建置它的資料表、寫入它的管線及其最新執行，以及由它建置的資料表。每條邊都會說明它是在哪裡觀察到的。

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

## 管線

每個作業、dbt 專案和同步都會連同其執行顯示在 **管道** 下：每次執行何時開始和結束、花了多久，以及失敗執行的錯誤。累積五次執行後，每個管線都會從自己的執行中學習一次執行通常需要多久，以及依其排程兩次執行之間通常間隔多久。管線的頁面會建議三個監測器：

- **Pipeline Run Failed**：某次執行失敗或遭到中止。
- **Pipeline Run Unusually Long**：某次執行的時間已達其典型時間的兩倍或更多；執行期間每五分鐘檢查一次，因此停滯的執行在結束之前就會被發現。
- **Pipeline Is Late**：超過其排程所允許的時間，仍沒有任何執行開始。

## 一個原因，一個警示

當一個資料表變得過時，由它建置的每個資料表也會變得過時。在資料警示開啟之前，OneUptime 會查詢血緣，看看該資料表或管線的上游是否已有開啟的警示：上游的資料表、寫入這些資料表的管線，以及這些資料表所在的資料庫，最多往上追溯五層。如果找到，新的警示就會成為該警示的後果：

- 它一開始就處於 **已確認** 狀態，因此不會有人因同一個問題被呼叫兩次；一旦其資料恢復，它也會自行恢復。
- 它的動態和 **資料** 卡片會說明是哪個警示造成了它，而且它會加入原因所在的片段。

原因的 **資料** 卡片會列出它的 **Downstream Impact**：它造成的每個警示。資料表警示的卡片還會顯示寫入該資料表的服務，以及這些服務失敗的寫入、它們在警示前一天內的部署和其他變更。

## 後續步驟

:::cards
- [資料產品](/docs/data-observability/data-products): 針對人們使用的資料表的新鮮度 SLA。
- [OneUptime AI 與 API](/docs/data-observability/ai-and-api): 從資料表的寫入者和執行開始的調查。
:::
