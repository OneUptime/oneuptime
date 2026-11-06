# 連接資料庫

資料可觀測性會使用只讀取目錄的登入來讀取每個資料庫：其中有哪些資料表和檢視、它們的欄、列數和大小，以及它們何時變更。本頁說明每種引擎至少需要的權限，以及如何透過探測器把連線字串留在你的網路內部。

## 開始之前

- **能連接資料庫的角色**：Project Owner、Project Admin 或 Telemetry Admin。
- **唯讀登入**，以下方的陳述式建立。你日後新增的檢查會讀取它們所檢查的資料表中的列，因此只有在新增檢查時，才授予該登入對這些資料表的 `SELECT` 權限。

## 選擇由誰連接

在 **資料可觀測性 > 資料庫** 上，選擇 **連接資料庫**，然後：

- **由 OneUptime 連線**：貼上連線字串。它會以加密形式儲存，只由 OneUptime 的工作程序使用，而且不會再次顯示。
- **由我網路中的探測器連線**：選擇你的一個探測器，並指定該探測器上保存連線字串的環境變數名稱，例如 `ORDERS_DB_URL`。連線字串永遠不會離開你的網路。請參閱 [自訂探測器](/docs/probe/custom-probe)。

已經為資料安全連接的資料庫也會受到監看，不需再次連接；你的 [雲端連線](/docs/telemetry/cloud-accounts) 找到的每個 BigQuery 資料集也是如此。

## 可以連接的資料庫

**資料庫** 下的 **可連接的資料庫** 會列出你的專案已經知道、但還沒有人連接的資料庫：你的追蹤所呼叫的資料庫、你的雲端帳戶中的資料庫，以及資料庫監控所監看的資料庫。**連線** 會根據每個資料庫已知的資訊開啟表單，並附上一個要填寫的連線字串。**隱藏** 可以讓某一個不再出現。在你連接它之前，不會讀取任何內容。

## 每種引擎的唯讀登入

:::tabs
@tab PostgreSQL
```sql
CREATE ROLE oneuptime_reader LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE orders TO oneuptime_reader;
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
```

連線字串：`postgres://oneuptime_reader:...@orders-db.internal:5432/orders?sslmode=require`。OneUptime 會讀取 `pg_class`、`pg_stat_user_tables` 和 `pg_attribute`：資料表的插入、更新或刪除計數器有所變動時，資料表即為已變更；掃描計數器有所變動時，資料表即為已讀取。
@tab MySQL and MariaDB
```sql
CREATE USER 'oneuptime_reader'@'%' IDENTIFIED BY '...';
GRANT SHOW VIEW, REFERENCES ON orders.* TO 'oneuptime_reader'@'%';
GRANT SELECT ON performance_schema.table_io_waits_summary_by_table TO 'oneuptime_reader'@'%';
```

`performance_schema` 讓 OneUptime 能看到兩次收集之間的寫入和讀取；即使沒有它，`information_schema.TABLES` 仍會說明每個資料表最後一次變更的時間。
@tab SQL Server
```sql
CREATE LOGIN oneuptime_reader WITH PASSWORD = '...';
CREATE USER oneuptime_reader FOR LOGIN oneuptime_reader;
GRANT VIEW DEFINITION TO oneuptime_reader;
GRANT VIEW DATABASE STATE TO oneuptime_reader;
```

`VIEW DATABASE STATE` 讓 OneUptime 能讀取大小、最後更新時間和最後讀取時間。
@tab Amazon Redshift
```sql
CREATE USER oneuptime_reader PASSWORD '...';
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
ALTER USER oneuptime_reader SYSLOG ACCESS UNRESTRICTED;
```

使用 PostgreSQL 連線字串連接到叢集或工作群組的端點，例如 `postgres://oneuptime_reader:...@cluster.abc123.us-east-1.redshift.amazonaws.com:5439/dev?sslmode=require`。`SYSLOG ACCESS UNRESTRICTED` 讓 OneUptime 能讀取列數和大小、每個使用者最後的寫入和讀取，以及來自查詢記錄的血緣。即使沒有它，資料表的列數有所變動時，仍能得知它何時變更。
@tab Snowflake
```sql
CREATE ROLE ONEUPTIME_READER;
GRANT USAGE ON DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT USAGE ON ALL SCHEMAS IN DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT REFERENCES ON ALL TABLES IN DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT USAGE ON WAREHOUSE CHECKS_WH TO ROLE ONEUPTIME_READER;
GRANT IMPORTED PRIVILEGES ON DATABASE SNOWFLAKE TO ROLE ONEUPTIME_READER;
CREATE USER ONEUPTIME_READER DEFAULT_ROLE = ONEUPTIME_READER RSA_PUBLIC_KEY = 'MIIBIjANBgkqh...';
GRANT ROLE ONEUPTIME_READER TO USER ONEUPTIME_READER;
```

Snowflake 透過其 SQL API 讀取，並使用金鑰組驗證。以 JSON 連接：

```json
{ "account": "myorg-myaccount", "user": "ONEUPTIME_READER", "privateKey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----", "database": "ANALYTICS", "warehouse": "CHECKS_WH", "role": "ONEUPTIME_READER" }
```

目錄是以 `SHOW` 讀取，它不需要倉儲，因此收集不會耗用任何點數。只有檢查會在倉儲上執行，並依你設定的排程進行。
@tab Google BigQuery
你的雲端連線找到的每個資料集，都會以該連線的服務帳戶進行監看。請在專案上授予它 **BigQuery Metadata Viewer** 和 **BigQuery Job User** 以讀取目錄，在你的檢查所讀取的資料表上授予 **BigQuery Data Viewer**，並授予 **BigQuery Resource Viewer** 以取得來自其作業的血緣。

每次收集都會讀取資料集的 `__TABLES__`（列數、位元組數和最後變更時間，不需費用）以及它的 `INFORMATION_SCHEMA.COLUMNS`（依 BigQuery 的 10 MB 最低計費量計費）。若要在沒有雲端連線的情況下連接資料集，請提供包含服務帳戶金鑰的 JSON：

```json
{ "projectId": "my-project", "dataset": "analytics", "location": "US", "serviceAccountJson": { "type": "service_account", "...": "..." } }
```
@tab ClickHouse
```sql
CREATE USER oneuptime_reader IDENTIFIED BY '...' SETTINGS readonly = 2;
GRANT SHOW TABLES, SHOW COLUMNS ON *.* TO oneuptime_reader;
GRANT SELECT ON system.parts TO oneuptime_reader;
GRANT SELECT ON system.part_log TO oneuptime_reader;
GRANT SELECT ON system.query_log TO oneuptime_reader;
```

ClickHouse 透過其 HTTP 介面讀取，使用 TLS 時連接埠為 8443（ClickHouse Cloud），不使用時為 8123：`clickhouse://oneuptime_reader:...@abc123.us-east-1.aws.clickhouse.cloud:8443/analytics`。指定一個資料庫就只監看它，省略則監看伺服器本身資料庫以外的所有資料庫。`system.parts` 讓 OneUptime 能看到每次插入（合併不計入）；在伺服器保留 `system.part_log` 的情況下，它會提供每次插入的時間；`system.query_log` 則每小時提供一次最後讀取時間和血緣。每個陳述式都以唯讀方式執行，因此即使登入本身能夠寫入，也無法寫入。
@tab Databricks
```sql
GRANT USE CATALOG, BROWSE ON CATALOG main TO `oneuptime-reader`;
GRANT USE SCHEMA ON CATALOG main TO `oneuptime-reader`;
GRANT USE CATALOG ON CATALOG system TO `oneuptime-reader`;
GRANT USE SCHEMA, SELECT ON SCHEMA system.access TO `oneuptime-reader`;
```

一個 Unity Catalog 目錄就是一個資料庫。使用服務主體連接，或以個人存取權杖作為 `"token"` 取代 `clientId` 和 `clientSecret` 來連接：

```json
{ "host": "adb-1234567890123456.7.azuredatabricks.net", "clientId": "...", "clientSecret": "...", "catalog": "main", "warehouseId": "abc123def456" }
```

目錄、其欄以及每個 Delta 資料表的最後一次提交，都來自 Unity Catalog 的 REST API，不需 SQL 倉儲，因此收集不會耗用運算資源。檢查，以及每小時一次來自 `system.access.table_lineage` 的血緣和最後讀取時間，都在你指定的 SQL 倉儲上執行；請在該倉儲上授予服務主體 **Can use** 權限。
@tab Oracle
```sql
CREATE USER oneuptime_reader IDENTIFIED BY "...";
GRANT CREATE SESSION TO oneuptime_reader;
GRANT READ ON sales.orders TO oneuptime_reader;
GRANT SELECT_CATALOG_ROLE TO oneuptime_reader;
```

Oracle 透過其自有協定讀取，無需安裝 Oracle 用戶端：`oracle://oneuptime_reader:...@orders-db.internal:1521/ORCLPDB1`。該登入只能看到它有權讀取的資料表：為每個要監控的資料表授予 `READ`，這樣它可以查詢這些資料表，但永遠不能鎖定或變更它們。`SELECT_CATALOG_ROLE` 讓 OneUptime 讀取每個資料表的大小，`ALL_TAB_MODIFICATIONS` 提供每個資料表自上次統計以來的插入、更新和刪除，以及最後一次變化的時間。
@tab Amazon Athena
一個 Glue 資料庫就是一個資料庫。它的資料表和檢視、欄位和統計資訊，以及每個 Iceberg 資料表的最後一次提交都來自 Glue Data Catalog 的 API，不讀取任何資料，也不產生費用。檢查會以 Athena 查詢在你指定的工作群組中執行。使用一個 IAM 使用者或角色的金鑰連接，它需要能呼叫 `glue:GetDatabase` 和 `glue:GetTables`，並且為了檢查，能在工作群組中以對資料表資料的讀取權限執行 Athena 查詢：

```json
{ "region": "us-east-1", "accessKeyId": "AKIA...", "secretAccessKey": "...", "database": "analytics", "workgroup": "primary", "outputLocation": "s3://acme-athena-results/oneuptime/" }
```
@tab MongoDB
```javascript
use admin
db.createUser({
  user: "oneuptime_reader",
  pwd: "...",
  roles: [{ role: "readAnyDatabase", db: "admin" }]
})
```

MongoDB 透過其自有驅動程式讀取：`mongodb+srv://oneuptime_reader:...@cluster0.example.mongodb.net/`，或帶有複本集主機清單的 `mongodb://`。路徑中指定的資料庫是唯一受監控的；未指定時，監控該登入可讀取的每個資料庫，以 `{ role: "read", db: "orders" }` 取代 `readAnyDatabase` 可將其限制為一個。每個集合的文件、大小和寫入來自 `$collStats`，最後一次收到文件的時間來自其最新的 `_id`。欄位來自其驗證器的 JSON 結構描述，否則來自其最新 100 份文件的欄位名稱和類型，皆在資料庫內計算，任何值都不會離開資料庫。有次要節點時在次要節點上讀取文件，自訂檢查是 JSON 格式的聚合管線。
:::

## 讀取的內容和頻率

| 內容 | 時間 |
| --- | --- |
| 資料表、檢視、欄、列數、大小和最後變更時間 | 每五分鐘 |
| 檢查 | 每 15 分鐘、每小時、每 6 小時或每天，依各檢查的設定而定 |
| 來自查詢歷史的血緣和最後讀取時間 | 每小時一次，回溯到上次讀取的位置 |

每個陳述式都以唯讀方式執行，並在引擎支援的情況下設定陳述式逾時和鎖定逾時。連線字串從不寫入記錄，並會從每個錯誤中移除。登入無權讀取的統計資料會被略過，並在資料庫上顯示一則警告，而不會導致收集失敗。在 OneUptime Cloud 上，連到私人位址的連線會被拒絕：請使用探測器。

## 唯讀複本

PostgreSQL 或 SQL Server 的唯讀複本不會更新其寫入計數器，因此其中的資料表可能在變更時看起來卻沒有變。OneUptime 會發現它是複本，略過這些計數器，並在資料庫上說明這一點，然後改用資料表的大小和列數。請盡可能連接主要節點，或為重要的資料表指定 [freshness 欄位](/docs/data-observability/table-health)。

## 儲存路徑

你所倚賴的並非全都在資料庫裡。每晚送進儲存貯體的匯出檔，也會和任何資料表一樣延遲或短少。在 **儲存路徑** 下，針對你的 [雲端連線](/docs/telemetry/cloud-accounts) 找到的儲存貯體（位於 Amazon S3、Google Cloud Storage 或 Azure 儲存體帳戶）選擇 **編輯路徑**，並指定重要的路徑，每行一個。在 Azure 上，每個路徑都以其容器名稱開頭。

之後每個路徑都會顯示在 **資料表** 下：它最新的物件就是它最後一次變更的時間，它的物件就是它的列，它們的大小就是它的大小，並適用相同的警示。只讀取名稱、大小和時間，絕不讀取物件本身。包含超過 10000 個物件的路徑沒有精確的數量、大小或最新物件，並且會如實說明：請指定範圍更窄的路徑。

## 疑難排解

- **資料庫顯示「失敗」。** 它的訊息會說明原因：OneUptime 無法連上的主機、遭拒的登入、伺服器不接受的 TLS 模式。對於你網路內部的資料庫，請透過探測器連接。
- **資料表沒有顯示最後變更時間。** 該登入無法讀取引擎的統計資料：請授予你的引擎索引標籤中列出的權限，或等待資料表的列數變更兩次。
- **缺少某個資料表。** 它位於該登入無法使用的結構描述中，或在該資料庫上遭到排除。請授予對其結構描述的 `USAGE` 權限，或移除該排除項目。
- **MySQL 資料表沒有欄位。** 該登入需要 `REFERENCES`，如上所述：它能顯示資料表的欄位，卻不會授予讀取其列的權限。

## 後續步驟

:::cards
- [資料表健康](/docs/data-observability/table-health): 每次收集對每個資料表所了解的資訊，以及它建議的警示。
- [檢查與對帳](/docs/data-observability/checks): 針對資料表內容的規則。
:::
