/*
 * The Data Observability Documentation page in Traditional Chinese: the
 * English text of Pages/DataObservability/Documentation.tsx, translated. Its
 * code, field names, metric names and product names are as the English
 * writes them, and it names what the product draws as the Dashboard's
 * Traditional Chinese words it. Change it with the English, in the same pull
 * request (DataObservabilityDocumentationInLocale).
 */
const DOCUMENTATION: string = `
## Data Observability 監看哪些內容

每個已連線資料庫中的每個資料表和每個檢視表，每五分鐘一次：

- **資料列數和大小**：來自引擎本身的統計資訊。
- **上次變更的時間**：MySQL 和 SQL Server 會回報；對於 PostgreSQL，OneUptime 會觀察插入、更新和刪除計數器，並記錄它們變動的時間。
- **欄位**：被新增、移除、重新命名、變更類型或改為 nullable 的欄位，會記入資料表的時間軸和結構描述變更。
- **平常的節奏**：資料表通常多久變更一次。明顯超出自身節奏的資料表會顯示為 **延遲**。

只會讀取資料庫的目錄；在 MongoDB 上，還會讀取集合最新文件的欄位名稱。任何值都不會離開資料庫。

目錄可能在只有內部維護變動時回報資料表已變更，也可能什麼都不回報。在資料表的 **設定** 中指定一個 **Freshness 欄位**（例如 \`updated_at\`），資料表的上次變更就會變成該欄位的最新值。登入帳戶需要能讀取該欄位，而且該欄位最好建有索引。

PostgreSQL 或 SQL Server 的唯讀複本不會推動寫入計數器，因此 OneUptime 會在那裡不使用這些計數器，並在資料庫上註明這一點。

## 概覽

**概覽** 說明你的資料目前的狀況。在專案設定完成之前，它會列出剩下的步驟：每個資料庫的警示、資料表的擁有者、一項檢查，以及你的管道執行。**需要處理** 依嚴重程度由高到低列出需要有人處理的事項：無法讀取的資料庫、失敗或延遲的管道執行、失敗或無法執行的檢查、發生偏離的對帳，以及延遲的資料產品或資料表。每一項都會說明歸誰所有、其警示是否已開啟（或者因為其資料庫沒有開啟任何警示而沒有人會收到通知），並開啟可以修正它的頁面。**資料庫** 顯示每個資料庫上次讀取的情況，以及其警示是否已開啟。選單中 **概覽** 旁邊的數字統計需要處理的事項，它下面的 **問題** 會逐頁列出每一項，可依類型、資料庫、擁有者（或 **無擁有者**）以及是否有尚未解決的警示篩選。**概覽** 上的每個數字都會開啟對應的清單：**需要處理** 開啟 **問題**，**延遲的資料表** 開啟只顯示延遲資料表的 **資料表**，**失敗的檢查** 開啟只顯示失敗檢查的 **檢查**。

## 連接資料庫

請使用 **唯讀登入帳戶**。在概覽或資料庫頁面上選擇 **連接資料庫**，然後選擇以下其中一種：

- **由 OneUptime 連線**：貼上連線字串。它會加密儲存，而且不會再次顯示。
- **由我網路中的探測器連線**：選擇此專案的一個探測器，並指定探測器上保存連線字串的環境變數名稱（例如 \`ORDERS_DB_URL\`）。連線字串永遠不會離開你的網路。請先將探測器更新到最新版本。

已經為資料安全連線的資料庫也會被監看。

同一頁面上的 **可連接的資料庫** 列出你的專案已經知道、但還沒有人連線的資料庫：你的追蹤所存取的資料庫、你的雲端帳戶中的資料庫，以及資料庫監控正在監看的資料庫。**連線** 會用已知的資訊預先填寫表單。在你連線之前，不會讀取任何內容。

## 儲存路徑

每晚落入儲存桶的匯出檔案，也可能像任何資料表一樣延遲或不完整。在 **儲存路徑** 下，為你的雲端連線找到的儲存桶（Amazon S3、Google Cloud Storage 或 Azure 儲存體帳戶上的）選擇 **編輯路徑**，並填寫重要的路徑，每行一個。每條路徑都會顯示在 **資料表** 下：其最新的物件就是它的上次變更，其物件就是它的資料列，並適用相同的警示。只讀取名稱、大小和時間，從不讀取物件本身。

### 每種引擎的唯讀登入帳戶

PostgreSQL：

\`\`\`sql
CREATE ROLE oneuptime_reader LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE orders TO oneuptime_reader;
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
\`\`\`

MySQL 和 MariaDB（\`performance_schema\` 讓 OneUptime 能看到兩次收集之間的寫入）：

\`\`\`sql
CREATE USER 'oneuptime_reader'@'%' IDENTIFIED BY '...';
GRANT SHOW VIEW, REFERENCES ON orders.* TO 'oneuptime_reader'@'%';
GRANT SELECT ON performance_schema.table_io_waits_summary_by_table TO 'oneuptime_reader'@'%';
\`\`\`

SQL Server（\`VIEW DATABASE STATE\` 讓 OneUptime 能讀取大小和上次更新）：

\`\`\`sql
CREATE LOGIN oneuptime_reader WITH PASSWORD = '...';
CREATE USER oneuptime_reader FOR LOGIN oneuptime_reader;
GRANT VIEW DEFINITION TO oneuptime_reader;
GRANT VIEW DATABASE STATE TO oneuptime_reader;
\`\`\`

Amazon Redshift：使用 PostgreSQL 連線字串連線到叢集或工作群組的端點，例如 \`postgres://oneuptime_reader:...@cluster.abc123.us-east-1.redshift.amazonaws.com:5439/dev?sslmode=require\`。\`SYSLOG ACCESS UNRESTRICTED\` 讓 OneUptime 能讀取資料列數和大小（\`svv_table_info\`）、每個使用者查詢的最近寫入和讀取（\`stl_insert\`、\`stl_delete\`、\`stl_scan\`，保留幾天），以及每個使用者查詢的血緣。沒有它，資料表的資料列變動時仍然可以知道它何時變更。

\`\`\`sql
CREATE USER oneuptime_reader PASSWORD '...';
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
ALTER USER oneuptime_reader SYSLOG ACCESS UNRESTRICTED;
\`\`\`

Snowflake：建立一個使用金鑰組（無密碼）的使用者，並使用指定帳戶識別碼、使用者、私密金鑰（未加密的 PKCS#8）、資料庫和檢查用倉儲的 JSON 連線：

\`\`\`json
{ "account": "myorg-myaccount", "user": "ONEUPTIME_READER", "privateKey": "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----", "database": "ANALYTICS", "warehouse": "CHECKS_WH", "role": "ONEUPTIME_READER" }
\`\`\`

收集使用不需要倉儲的 SHOW 讀取目錄，因此不會消耗點數。只有資料檢查會在倉儲上執行，依你為它們設定的排程執行。Snowflake 不回報任何資料表的上次變更，因此當資料表的資料列或位元組有變動時，就視為資料表已變更。

\`\`\`sql
CREATE ROLE ONEUPTIME_READER;
GRANT USAGE ON DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT USAGE ON ALL SCHEMAS IN DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT REFERENCES ON ALL TABLES IN DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT USAGE ON WAREHOUSE CHECKS_WH TO ROLE ONEUPTIME_READER;
-- Warehouse spend reads SNOWFLAKE.ACCOUNT_USAGE.
GRANT IMPORTED PRIVILEGES ON DATABASE SNOWFLAKE TO ROLE ONEUPTIME_READER;
-- Checks read rows: SELECT on the tables they check.
CREATE USER ONEUPTIME_READER DEFAULT_ROLE = ONEUPTIME_READER RSA_PUBLIC_KEY = 'MIIBIjANBgkqh...';
GRANT ROLE ONEUPTIME_READER TO USER ONEUPTIME_READER;
\`\`\`

Google BigQuery：你的 Google Cloud 連線找到的每個資料集都已經使用該連線的服務帳戶監看中，不需要再連線。為服務帳戶授予專案上的 **BigQuery Metadata Viewer** 和 **BigQuery Job User**，以及檢查所讀取的資料表上的 **BigQuery Data Viewer**。每次收集會讀取資料集的 \`__TABLES__\`（資料列、位元組和上次變更，不收費）以及它的 \`INFORMATION_SCHEMA.COLUMNS\`（依 BigQuery 的 10 MB 最低計費）。在專案上新增 **BigQuery Resource Viewer**，即可取得來自其工作的血緣，每小時讀取一次（請參閱「資料庫本身提供的血緣」）。若要在沒有 Google Cloud 連線的情況下連接資料集，請選擇 **Google BigQuery**，並提供包含服務帳戶金鑰的 JSON：

\`\`\`json
{ "projectId": "my-project", "dataset": "analytics", "location": "US", "serviceAccountJson": { "type": "service_account", "...": "..." } }
\`\`\`

ClickHouse：透過其 HTTP 介面連線，使用 TLS 時為連接埠 8443（ClickHouse Cloud），不使用時為 8123，例如 \`clickhouse://oneuptime_reader:...@abc123.us-east-1.aws.clickhouse.cloud:8443/analytics\`。指定一個資料庫就只監看它；省略則監看伺服器本身資料庫以外的所有資料庫。\`system.parts\` 讓 OneUptime 能看到兩次收集之間的每次插入（合併不計入），\`system.part_log\`（如果伺服器保留它）提供每次插入的時間，\`system.query_log\` 每小時提供一次每個資料表的上次讀取以及來自 \`INSERT ... SELECT\` 的血緣。每個陳述式都在設定了 \`readonly\` 的情況下執行，因此即使登入帳戶原本可以寫入，也無法寫入。

\`\`\`sql
CREATE USER oneuptime_reader IDENTIFIED BY '...' SETTINGS readonly = 2;
GRANT SHOW TABLES, SHOW COLUMNS ON *.* TO oneuptime_reader;
GRANT SELECT ON system.parts TO oneuptime_reader;
GRANT SELECT ON system.part_log TO oneuptime_reader;
GRANT SELECT ON system.query_log TO oneuptime_reader;
-- Checks read rows: SELECT on the tables they check.
\`\`\`

Databricks：一個 Unity Catalog 目錄就是一個資料庫。它的結構描述、資料表、檢視表和欄位，以及每個 Delta 資料表的最後一次提交，都透過 Unity Catalog 的 REST API 讀取，不需要 SQL 倉儲，因此收集不會耗用運算資源。資料檢查，以及來自系統資料表 \`system.access.table_lineage\` 的血緣、最近寫入和最近讀取（每小時一次），會在你指定的 SQL 倉儲上執行。使用服務主體連線（也可以用個人存取權杖取代 \`clientId\` 和 \`clientSecret\`：\`"token": "dapi..."\`）：

\`\`\`json
{ "host": "adb-1234567890123456.7.azuredatabricks.net", "clientId": "...", "clientSecret": "...", "catalog": "main", "warehouseId": "abc123def456" }
\`\`\`

\`\`\`sql
GRANT USE CATALOG, BROWSE ON CATALOG main TO \`oneuptime-reader\`;
GRANT USE SCHEMA ON CATALOG main TO \`oneuptime-reader\`;
GRANT USE CATALOG ON CATALOG system TO \`oneuptime-reader\`;
GRANT USE SCHEMA, SELECT ON SCHEMA system.access TO \`oneuptime-reader\`;
-- Checks read rows: SELECT on the tables they check. And CAN USE on the SQL warehouse.
\`\`\`

Oracle：使用 \`oracle://oneuptime_reader:...@orders-db.internal:1521/ORCLPDB1\` 或 JSON \`{ "user", "password", "connectString" }\` 連線。透過 Oracle 自己的協定讀取，不需要安裝 Oracle 用戶端。登入帳戶能看到它有權讀取的資料表：對每個要監看的資料表授予 \`READ\`（它可以查詢這些資料表，但永遠無法鎖定或變更它們）。\`SELECT_CATALOG_ROLE\` 讓 OneUptime 能讀取每個資料表的大小；沒有它，只有登入帳戶自己的資料表才有大小。\`ALL_TAB_MODIFICATIONS\` 提供每個資料表自上次統計以來的插入、更新和刪除，以及它的上次變更時間。

\`\`\`sql
CREATE USER oneuptime_reader IDENTIFIED BY "...";
GRANT CREATE SESSION TO oneuptime_reader;
GRANT READ ON sales.orders TO oneuptime_reader;
GRANT SELECT_CATALOG_ROLE TO oneuptime_reader;
\`\`\`

Amazon Athena：一個 Glue 資料庫就是一個資料庫。它的資料表和檢視表、它們的欄位和統計資訊，以及每個 Iceberg 資料表的最後一次提交，都來自 Glue Data Catalog 的 API，該 API 不讀取資料，也不收費；檢查以 Athena 查詢的形式在你指定的工作群組中執行。使用有權讀取該 Glue 資料庫並執行 Athena 查詢的 IAM 使用者或角色的金鑰連線：

\`\`\`json
{ "region": "us-east-1", "accessKeyId": "AKIA...", "secretAccessKey": "...", "database": "analytics", "workgroup": "primary", "outputLocation": "s3://acme-athena-results/oneuptime/" }
\`\`\`

它需要資料庫及其資料表上的 \`glue:GetDatabase\` 和 \`glue:GetTables\`，檢查還需要工作群組上的 \`athena:StartQueryExecution\`、\`athena:GetQueryExecution\`、\`athena:GetQueryResults\` 和 \`athena:StopQueryExecution\`，以及對資料表 S3 資料的讀取權限和對輸出位置的寫入權限。

MongoDB：使用其連線字串連線 - \`mongodb+srv://oneuptime_reader:...@cluster0.example.mongodb.net/\`，或帶有複本集主機的 \`mongodb://\`。路徑中的資料庫是唯一被監看的資料庫；沒有指定時，會監看登入帳戶能讀取的每個資料庫。每個集合的文件數、大小和寫入來自 \`$collStats\`，它上次接收文件的時間來自其最新的 \`_id\`。它的欄位來自其驗證器的 JSON 結構描述，否則來自其最新 100 份文件的欄位名稱和類型，並在資料庫中計算，因此任何值都不會離開資料庫。如果有次要節點，就在次要節點上讀取文件。檢視表的來源集合屬於血緣，自訂檢查是一個 JSON 格式的彙總管道。

\`\`\`javascript
use admin
db.createUser({
  user: "oneuptime_reader",
  pwd: "...",
  roles: [{ role: "readAnyDatabase", db: "admin" }]
})
\`\`\`

如果只監看一個資料庫，請授予 \`{ role: "read", db: "orders" }\` 來取代 \`readAnyDatabase\`。

Microsoft Dataverse：一個環境就是一個資料庫，其資料表位於 \`dbo\`，與其 SQL 端點的命名一致。OneUptime 以應用程式的身分登入：在 Microsoft Entra ID 中註冊一個帶有用戶端密碼的應用程式，並將它以應用程式使用者的身分新增到環境中（Power Platform admin center > the environment > Settings > Users + permissions > Application users），同時賦予一個有權讀取這些資料表的安全性角色。使用 JSON，或使用寫明 \`AuthType=ClientSecret\` 的 Dataverse 連線字串連線。租用戶可以省略：環境會說明它屬於哪個租用戶。

\`\`\`json
{ "environmentUrl": "https://contoso.crm.dynamics.com", "tenantId": "...", "clientId": "...", "clientSecret": "..." }
\`\`\`

每五分鐘，Web API 會提供每個資料表的定義、來自 Dataverse 每天產生一次的快照中的資料列數（因此最多落後一天），以及它最新的 \`modifiedon\`，也就是它的上次變更時間。它的欄位每小時讀取一次。每次讀取都計入應用程式的 Dataverse 要求限制，被要求放慢速度的收集會把剩下的部分留給下一次。一個環境本身就有數百個資料表，因此只監看核心業務資料表（帳戶、連絡人、潛在客戶、商機、報價、訂單、發票、產品、案例、電子郵件、電話、約會、工作和附註）以及你自己的自訂資料表。Microsoft 應用程式的資料表（\`msdyn_\`、\`adx_\` 以及其他 \`ms\` 前置詞）會被排除：需要監看其他資料表時，請像 \`"tables": ["msdyn_workorder"]\` 這樣指定。

資料檢查以唯讀 SQL 的形式在環境的 TDS 端點上執行，連接埠為 1433 或 5558。除非系統管理員將其關閉，否則它是開啟的；如果為它開啟了使用者層級存取控制，應用程式的角色需要 **Allow user to access TDS endpoint** 權限。它的 SQL 不支援規則運算式、不支援 \`WITH\`，也不支援取樣。

## 每個資料表寫入的指標

每次收集都會為每個資料表寫入以下指標，因此你可以像使用其他指標一樣為它們繪製圖表、放到儀表板上並設定警示：

| 指標 | 意義 |
| --- | --- |
| \`oneuptime.data.table.row_count\` | 資料表中的資料列數 |
| \`oneuptime.data.table.size\` | 資料表及其索引佔用的位元組數 |
| \`oneuptime.data.table.seconds_since_change\` | 距離上次插入、更新或刪除一筆資料列經過的秒數 |
| \`oneuptime.data.table.overdue_seconds\` | 資料表超過其通常變更時間的秒數；準時時為 0。在學會其節奏後寫入 |
| \`oneuptime.data.table.row_count_change_percent\` | 自上一次收集以來資料列數變化的百分比（-50 表示一半的資料列不見了）。少於 1,000 筆資料列的資料表不計入 |
| \`oneuptime.data.table.schema_changes\` | 自上一次收集以來發生變更的欄位 |
| \`oneuptime.data.table.breaking_schema_changes\` | 自上一次收集以來被移除、重新命名或變更類型的欄位 |

每一筆資料列都帶有 \`oneuptime.data.store.id\`、\`oneuptime.data.store.name\`、\`oneuptime.data.table.id\`、\`oneuptime.data.table.schema\`、\`oneuptime.data.table.name\` 和 \`oneuptime.data.table.key\`（\`schema.table\`）。依 \`oneuptime.data.table.key\` 分組的指標監測器會對每個資料表各發出一次警示，它的 **異常偏高** 和 **異常偏低** 篩選條件會將每個資料表與它自己在一週中該時段的通常值比較，因此不需要設定閾值。

## 警示

你連接的資料庫會在其 **建議的警示** 上開啟；之後，你可以在 **資料庫** 中為它選擇這些警示。每項建議都是針對整個資料庫的一個指標監測器，會對每個資料表各發出一次警示，因此之後建立的資料表也會被監看：

| 警示 | 觸發條件 |
| --- | --- |
| **資料表延遲** | 資料表超過其通常變更時間達十五分鐘 - 與 **延遲** 標示的規則相同 |
| **資料列數驟降** | 資料表在兩次收集之間失去一半或更多的資料列 |
| **資料列數異常偏低** | 資料表的資料列數遠少於一週中該時段的通常值（用兩週時間學習） |
| **結構描述已變更** | 資料表的欄位被移除、重新命名或變更類型。新增的欄位不會破壞任何東西，只會留在時間軸上 |
| **資料表狀態停止回報** | 資料庫中沒有任何資料表在十五分鐘內被讀取 |

在建立時選擇嚴重性、值班原則、擁有者和標籤。之後它們就是一般的監測器：可以像其他監測器一樣編輯、靜音或放到狀態頁面上。

回填或移轉不應該驚動任何人。在維護事件的 **Data Observability 資料庫** 中指定該資料庫，或將其資料庫伺服器加入維護事件，在事件進行期間，其資料警示就會保持安靜。

## 擁有者和標籤

資料表的 **擁有者** 索引標籤列出它所屬的人員和團隊，資料表的警示會傳送給他們；沒有擁有者時，傳送給其資料庫的擁有者。**擁有者規則** 和 **標籤規則** 會在每個資料表首次出現時套用到它，依其標籤，或依對其名稱、結構描述或資料庫的規則運算式比對。範圍限定為 \`Owned\` 的權限只涵蓋其持有者或其團隊所擁有的資料表，以及這些資料表的檢查、活動和回報的問題。擁有一個資料庫並不會讓人成為其資料表的擁有者：若要把整個資料庫交給一個團隊，請使用擁有者規則。

## 警示開啟時

資料表的警示有一張 **資料** 卡片，依可能性高低說明它最可能發生的原因：上游的警示、失敗的執行、寫入它的服務的部署、它的寫入失敗、發生變動的欄位、資料庫或其所在的伺服器。下方列出依賴它的內容：資料表、儀表板、服務以及擁有它們的人。

請說說你的看法：**有用**、**符合預期**（計畫內的事件：不做任何變更）或 **不是問題**（給資料表更大的餘裕，這樣下次同樣的情況就不會再發出警示）。如果有人先發現問題，可以在資料表上用 **回報問題** 記錄下來。**概覽** 顯示彙總情況：每週有用的警示數、其中有多少不是雜訊、問題在有人回報之前被發現的頻率和速度，以及推測的原因有多少次就是真正的原因。


## 資料產品

使用資料的人（分析師、財務、管理階層、AI 代理程式）想到的是他們所使用的東西：「營收儀表板的資料表」，而不是資料庫。資料產品為這些資料表命名，並帶有其擁有者、使用者和新鮮度 SLA。在 **資料產品** 中建立。它的 SLA 是以下其中之一或兩者：
- **在一天中的某個時間（UTC）前保持最新：** 每天的資料在當天這個時間之前送達。從這個時間起，每個資料表都必須在當天發生過變更；在此之前，以昨天的載入為準。總是晚半小時的載入，每天都會在這半小時內處於延遲狀態。
- **最大時長：** 任何資料表的上次變更都不能早於這個時長。

每五分鐘，每個產品的資料表都會與其 SLA 比較。只要有任何一個資料表延遲，產品就處於 **延遲** 狀態，其資料的時間點是這些資料表中最早的上次變更。它會寫入 \`oneuptime.data.product.late_tables\` 和 \`oneuptime.data.product.data_age\`，因此你可以把所有產品的新鮮度並排繪製出來。

儲存產品時，還會以你的身分、用你的權限建立：
- **一個監測器**，在狀態頁面上代表該產品。只要有資料表延遲，它就處於降級狀態，並以專案中最低的嚴重性開啟一個事件和一個警示，它們會自行解決。將它作為資源新增到私人或公開的狀態頁面上：訂閱的使用者會在產品延遲以及恢復最新時收到通知。
- **一個 SLO**，建立在該監測器上：資料準時的時間比例，對照產品在 30 天內的 SLA 目標，並帶有每個 SLO 一開始就有的快速和慢速消耗率警示。

刪除產品會同時刪除這兩者。每個產品還有一個 **徽章**，說明其資料截至什麼時候：準時時為綠色，不再準時時變為琥珀色並帶有「late」。從產品的概覽中將其嵌入 BI 儀表板、Wiki 頁面或 README。它的連結不需要登入，因此請像對待共用連結一樣對待它；**重設徽章連結** 會產生新連結並停用舊連結。

## 對資料表中值的檢查

資料表的狀態說明它是否在變化。**檢查** 說明它所包含的內容是否正確。在資料表的 **檢查** 索引標籤上新增：

| 檢查 | 讀取的內容 |
| --- | --- |
| **NULL 比例** | 該欄位為空的資料列所佔的百分比 |
| **重複比例** | 與另一筆資料列的值重複的值所佔的百分比 |
| **去重計數** | 該欄位包含多少個不同的值 |
| **最小值**、**最大值**、**平均**、**總和** | 數值欄位的值（沒有資料列時總和為 0） |
| **無效值比例** | 不在你提供的清單中的值所佔的百分比 |
| **格式不符比例** | 不符合你選擇的格式（如電子郵件、UUID 或國家代碼）或不符合你自己的規則運算式的值所佔的百分比（SQL Server 以外的所有引擎） |
| **孤立資料列數** | 其值在另一個資料表的欄位中找不到對應的資料列 |
| **資料列數** | 資料表中的資料列數，與 **分群依據** 搭配使用最有用 |
| **自訂 SQL** | 你的一個唯讀 SELECT 傳回的數字 |

同一索引標籤上的 **建議的檢查** 僅根據欄位的名稱和類型，提供資料表的欄位所需要的檢查：
- id 是唯一的。
- \`customer_id\` 在 \`customers\` 中有對應的資料列。
- 電子郵件地址看起來像電子郵件地址，金額不為負數。
- 狀態維持其通常的值。
- 依租用戶分割的資料表依租用戶計數。

可以新增一項、全部新增，或永久忽略某一項。

**分群依據** 會針對某一欄位的每個值（如租用戶或區域）各執行一次檢查：為最大的 100 個分群各產生一個序列和一個警示。分群的資料列數會在某個租用戶停止傳送資料時發出警示。

檢查隨資料庫的收集一起執行，由 OneUptime 或其探測器執行，頻率為每 15 分鐘、每小時、每 6 小時或每天。每項檢查都在帶有陳述式逾時的唯讀交易中作為一個彙總陳述式執行：只有數字會離開資料庫，除非專案選擇保留失敗資料列的遮罩樣本。值寫入為 \`oneuptime.data.check.value\`，並帶有 \`oneuptime.data.check.id\`、\`oneuptime.data.check.name\` 和 \`oneuptime.data.check.segment\`。

設定 **警示條件** 即可對檢查發出警示：
- **異常偏高** 或 **異常偏低** 會將每個值與它在一週中該時段學到的基準比較。
- **高於** 或 **低於** 會將它與閾值比較。

儲存檢查時，會以你的身分、用你的權限為它建立一個指標監測器。清除條件會移除該監測器。

**失敗的資料列** 計算你的一個唯讀 SELECT 傳回的資料列：也就是不應該存在的資料列。0 表示正常。

有三項設定可以控制檢查的成本。**取樣百分比** 只讀取一部分資料列，適用於讀取比率的檢查。**設定** 下的 **單次檢查最多可讀取量 (GB)** 會在 BigQuery 或 Athena 上的檢查讀取超過該量之前停止它。同樣位於那裡的 **資料庫忙碌時等待** 會在 PostgreSQL、MySQL 或 SQL Server 資料庫看起來很忙碌時，把到期的檢查留給下一次收集。

**設定** 下的 **保留失敗的資料列** 最多為每項檢查保留 20 筆失敗的資料列，敏感欄位會在離開資料庫之前遮罩。在你開啟之前它是關閉的。這些資料列儲存在 OneUptime 中：在 OneUptime Cloud 上儲存在 OneUptime 的伺服器上，在自行託管的安裝中儲存在你自己的伺服器上；關閉它會刪除這些資料列。

把檢查保存在存放庫中的檔案裡，並在 CI 中用 \`oneuptime data-checks apply checks.yaml\` 套用它們。在提取要求中使用 \`--dry-run\` 執行它。檔案中任何地方有錯誤，都不會套用任何內容。檔案格式請參閱文件。


## 對帳

副本會逐漸偏離：倉儲中的訂單比應用程式資料庫中的少，或者一次移轉遺失了資料列。對帳會比較兩個資料表的一個量值，這兩個資料表可以在同一個資料庫中，也可以在兩個資料庫中：
- **資料列數**
- 某一欄位的 **總和**
- 某一欄位的 **去重計數**
- **自訂 SQL**：傳回一個名為 \`value\` 的數字的唯讀查詢。

它有一個容許範圍：**絕對值** 數量，或來源值的 **百分比**。在 **對帳** 中建立。

每一側都由一項專屬的資料檢查讀取，該檢查由對帳建立和維護，並隨其資料庫的收集一起執行：由 OneUptime 或由該資料庫的探測器執行。因此，對帳可以把你網路中的 PostgreSQL 資料表與它在 Snowflake 或 BigQuery 中的副本比較。它的檢查會顯示在每個資料表的檢查索引標籤上，而且只能在對帳中變更。

兩側都在彼此 15 分鐘以內被讀取後，就會比較這兩個值，然後排程兩側再次一起讀取。對帳會寫入：
- \`oneuptime.data.reconciliation.drifted\`：兩者的偏離超出容許範圍時為 1，一致時為 0。它的監測器讀取該指標，並在兩者偏離時發出警示。
- \`oneuptime.data.reconciliation.difference\`：目標的值減去來源的值。
- \`oneuptime.data.reconciliation.difference_percent\`：差值佔來源值的百分比。

檢查失敗的一側會說明原因。依排程載入的副本會落後於其來源：請用自訂 SQL 比較兩者都已穩定下來的量值（例如一小時以前的資料列），或在容許範圍中考慮這段落後。

## 來自 OpenLineage 的管道和血緣

Airflow、Dagster、Spark、dbt 和 Flink 用 [OpenLineage](https://openlineage.io) 事件描述工作的每次執行。使用遙測擷取金鑰把它們原封不動地傳送到 OneUptime（專案設定 > 遙測與 APM > 擷取金鑰）：

- **URL：** \`https://oneuptime.com/telemetry/openlineage\`（自行託管的 OneUptime 請使用你自己的位址）
- **端點：** \`api/v1/lineage\`，即 OpenLineage 的預設值
- **API 金鑰：** 擷取金鑰。它會以 \`Authorization: Bearer\` 傳送，也可以設定 \`x-oneuptime-token\`。

對於 Airflow 的 OpenLineage 提供者：

\`\`\`bash
AIRFLOW__OPENLINEAGE__TRANSPORT='{"type": "http", "url": "https://oneuptime.com/telemetry/openlineage", "endpoint": "api/v1/lineage", "auth": {"type": "api_key", "apiKey": "YOUR_INGESTION_KEY"}}'
\`\`\`

對於任何 OpenLineage 用戶端，設定 \`OPENLINEAGE_URL\` 和 \`OPENLINEAGE_API_KEY\`。

每個工作都會顯示在 **管道** 下，並帶有其最新一次執行：開始和結束時間、耗時，以及失敗執行的錯誤。讀取和寫入 OneUptime 所監看資料表的執行會成為 **血緣**：資料表的 **血緣** 索引標籤顯示建構它所用的資料表、寫入它的管道及其最新一次執行，以及由它建構的資料表。

資料集依 OpenLineage 命名規範與資料表比對：\`postgres://host:5432\` 對應 \`database.schema.table\`，\`mysql://host:3306\` 對應 \`database.table\`，\`sqlserver://host:1433\` 和 \`redshift://cluster:5439\` 對應 \`database.schema.table\`，\`snowflake://account\` 對應 \`database.schema.table\`，\`bigquery\` 對應 \`project.dataset.table\`，\`clickhouse://host:8443\` 對應 \`database.table\`，\`databricks://workspace-host\` 對應 \`catalog.schema.table\`。

每個管道都會從自己的執行中學習一次執行通常需要多長時間（最近 20 次已完成執行的中位數），以及依其排程兩次執行之間相隔多久（最近 50 次啟動之間不屬於偶發情況的最長間隔）。兩者在五次執行後即可確定，既適用於每五分鐘執行一次的工作，也適用於每晚執行的工作。當你的排程器像 Airflow 那樣傳送 OpenLineage 的 \`nominalTime\` facet 時，執行的排定時間會被視為其開始時間，因此回填仍會依排程解讀。

管道的頁面會建議三個監測器，每個都只需按一下即可建立：
- **管道執行失敗**：一次執行失敗或被中止。
- **管道執行時間異常長**：一次執行的耗時達到通常的兩倍或更多。執行期間每五分鐘檢查一次，因此卡住的執行會在結束之前被發現。
- **管道延遲**：在超過排程允許的時間內沒有任何執行開始，保留間隔的四分之一且至少十五分鐘的餘裕。

它們讀取以下指標，每個指標都帶有 \`oneuptime.data.pipeline.id\` 和 \`oneuptime.data.pipeline.name\` 標籤：
- \`oneuptime.data.pipeline.run_failed\`：每次執行結束時為 1 或 0。
- \`oneuptime.data.pipeline.run_duration\`：每次執行結束時的秒數。
- \`oneuptime.data.pipeline.run_duration_ratio\`：本次執行時間除以通常執行時間（至少以一分鐘計），在每次執行結束時以及執行期間每五分鐘寫入一次。
- \`oneuptime.data.pipeline.overdue_seconds\`：下一次執行超出其排程多久，每五分鐘一次；準時時為 0。

管道的頁面會繪製它的 **血緣**，這是執行失敗或延遲時首先要看的地方：左邊是它讀取的資料表，右邊是它寫入的資料表，以及每個資料表目前的狀況。選擇更多步數，就能看到這些資料表由什麼建構，以及由它們建構了什麼；點選管道或資料表卡片上未繪製的資料表數量，會在原處繪製更多資料表。同樣的血緣也可以透過 \`POST /api/data-observability/pipelines/lineage\` 取得，供你自己的工具使用。



## Fivetran 和 Airbyte 同步

Fivetran 和 Airbyte 載入你的原始資料表，而且不傳送 OpenLineage 事件，但它們的 webhook 會告知每次同步何時開始和結束。每個 Fivetran 連接器和每個 Airbyte 連線都會成為 **管道** 下的一個管道，每次同步成為一次執行，擁有與任何管道相同的執行歷史、學到的耗時和排程，以及相同的警示：失敗的執行、異常長的執行和延遲的執行。**管道 > 連接 Fivetran 或 Airbyte** 會用你的一個擷取金鑰填好下面的 URL。

- **Fivetran：** 使用 Fivetran 的 REST API，為你的帳戶或一個目的地群組建立 webhook，事件為 \`sync_start\` 和 \`sync_end\`。它的 URL 是 \`https://oneuptime.com/telemetry/fivetran/v1/webhook/<ingestion key ID>\`，它的密碼就是該擷取金鑰。Fivetran 會用密碼為每次傳遞簽署，因此金鑰本身永遠不會出現在 URL 中，未用它簽署的傳遞會被拒絕。
- **Airbyte：** 在工作區的通知設定中，將 webhook 設為 \`https://oneuptime.com/telemetry/airbyte/v1/webhook/<ingestion key>\`，並為失敗的同步和成功的同步開啟它。Airbyte 不做任何簽署，因此它的 URL 中帶有金鑰：請為 Airbyte 準備一把專用的金鑰。

管道的名稱就是工具為連接器或連線取的名稱，位於 \`fivetran://<destination group>\` 或 \`airbyte://<workspace>\` 之下。失敗同步的執行會顯示工具的錯誤。因 API 速率限制而被重新排程的 Fivetran 同步會以 **已重新排程** 結束：這不算失敗，因此不會驚動任何人，其耗時也不會用於學習。

Fivetran 連接器會載入其目的地中以它命名的結構描述。當恰好只有一個被監看的資料庫擁有該結構描述時，該資料庫的資料表會把該連接器記錄為其寫入者：變得過時的資料表會指向本應載入它的同步，失敗同步的警示就是這些資料表警示的原因（請參閱「一個原因一個問題」）。Airbyte 不提供資料表名稱。

## BI 工具中的儀表板

不良資料真正的影響，體現在有人開啟的儀表板上。在 **BI 儀表板** 下，用有權讀取其儀表板的認證新增你的 BI 工具：

| 工具 | 認證（JSON） |
| --- | --- |
| **Metabase** | \`{ "apiKey": "mb_..." }\`（或某個使用者的 \`username\` 和 \`password\`） |
| **Superset** | \`{ "username": "...", "password": "..." }\` |
| **Tableau** | \`{ "tokenName": "...", "tokenSecret": "...", "site": "acme" }\`，一個個人存取權杖 |
| **Looker** | \`{ "clientId": "...", "clientSecret": "..." }\`，一個 API 用戶端 |
| **Power BI** | \`{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }\`，一個有權使用 Power BI 管理 API 的服務主體 |
| **Hightouch** | \`{ "apiKey": "..." }\`：每次同步都被視為又一個依賴某個資料表的對象 |
| **Census** | \`{ "apiKey": "...", "region": "us" }\`：每次同步都被視為又一個依賴某個資料表的對象 |

每小時一次，以及在新增工具或你選擇 **立即讀取** 時，OneUptime 會讀取每個儀表板及其背後的資料表：卡片的資料表和原生問題的 SQL（Metabase）、資料集的資料表或虛擬資料集的 SQL（Superset）、Metadata API 的上游資料表（Tableau）、每個圖格的 explore（Looker），以及每個報表的資料集（Power BI，來自工作區掃描）。每個資料表都依其資料庫、結構描述和名稱與一個被監看的資料表比對；仍然同時符合兩個被監看資料表的名稱會維持未比對。資料表的 **血緣** 索引標籤、其警示的 **資料** 卡片和正式環境審查會列出建構在它上面的儀表板，以及建構在由它建構的資料表上的儀表板。只讀取名稱和連結，從不讀取儀表板的資料。

Power BI 工具還可以對其資料集的重新整理失敗發出警示。開啟 **重新整理失敗時發出警示** 後（現在新增的工具預設開啟），OneUptime 會為該工具維護一個監測器，為每個最近一次重新整理失敗或被取消的資料集開啟一個警示（資料集名稱會出現在警示標題中），並在之後的重新整理完成後解決它。它讀取 \`oneuptime.data.bi.refresh_failed\`，該指標帶有 \`oneuptime.data.bi.dataset.name\` 和 \`oneuptime.data.bi.workspace.name\` 標籤：每五分鐘，每小時讀取時發現失敗的每個資料集會寫入 1，在之後的重新整理完成後的一小時內寫入 0。仍在執行的重新整理不會改變任何內容，因此不論有多少次每小時讀取看到它，一次失敗就是一個警示。

## 追蹤中的工作

Kubernetes CronJob 或以計時器觸發的函式不需要安裝任何東西就會顯示為管道：帶有 \`k8s.cronjob.name\` 或 \`k8s.job.name\` 的 span，或帶有 \`faas.trigger\` 為 \`timer\` 或 \`datasource\` 的 \`faas.name\` 的 span，會成為一個管道，並帶有其執行以及其資料庫呼叫涉及的資料表。每次執行都連結到其追蹤和記錄，停止執行的 CronJob 會被視為延遲。

## 資料庫本身提供的血緣

血緣並不需要傳送 OpenLineage 的管道。每個資料庫本身就會提供一部分血緣，OneUptime 會隨資料庫的收集一起讀取：
- **檢視表：** 在 PostgreSQL、Redshift、MySQL 8 和 SQL Server 中，檢視表由定義它的資料表建構而成。檢視表被重新定義或刪除時，它舊的血緣也會隨之消失。
- **查詢歷史：** 讀取一個資料表並寫入另一個資料表的查詢，例如排程查詢、dbt 模型或 MERGE，也屬於血緣。它來自 BigQuery 的工作（資料集所在專案和位置的 \`INFORMATION_SCHEMA.JOBS\` 檢視表，需要 **BigQuery Resource Viewer**）以及 Redshift 的查詢記錄（\`stl_insert\` 和 \`stl_scan\`，需要 \`SYSLOG ACCESS UNRESTRICTED\`）。只有在資料集自己的專案中執行的工作才會出現在其工作檢視表中。

血緣每小時讀取一次，回溯到上一次讀取；在資料庫首次收集時回溯一週，因此從一開始就有血緣。BigQuery 的讀取依其讀取的工作小時數計費，大多數情況下是 BigQuery 的 10 MB 最低計費。

資料表的 **血緣** 索引標籤上的每條邊都會說明它是在哪裡看到的：管道的執行、查詢歷史（帶有其查詢搬移了資料的登入帳戶），或檢視表的定義。來自所有來源的血緣都會用於 **一個原因一個問題**。

在資料表的 **血緣** 索引標籤頂端，有一張圖會把它的血緣向兩個方向各繪製幾步（三步，或選擇 1、2 或 5）：左邊是建構它所用的內容，右邊是由它建構的資料表和儀表板，以及在資料進入的地方從外部載入資料的管道。每張卡片都會顯示目前狀況 - 延遲、未解決的警示、失敗的執行 - 當其管道最近一次執行失敗時，箭頭會變成紅色，因此可以從延遲的資料表一路追溯到造成它出問題的那次執行。開啟任一個資料表，就能讓圖以它為中心。每張卡片在每個方向上最多繪製十個資料表，其餘的會計數，例如 **+14**：選擇這個數字，就會在原處繪製接下來的資料表；選擇 **重設圖** 可以返回。在來源提供了欄位名稱的地方，在 **追蹤欄位** 中選擇資料表的一個欄位，就能醒目提示它從哪裡來、到哪裡去，即使它在途中被重新命名。同樣的血緣也可以透過 \`POST /api/data-observability/tables/lineage\` 取得，供你自己的工具使用：傳送 \`"withColumns": true\` 可以取得每個箭頭的欄位，向 \`POST /api/data-observability/lineage/expand\` 要求可以取得卡片的下一批資料表。

## dbt

在 \`dbt build\`（或 run、test、seed、snapshot）之後，使用 CLI 和遙測擷取金鑰傳送專案的構件。它會讀取 \`target/manifest.json\` 和 \`target/run_results.json\`，只傳送 Data Observability 從中讀取的內容：

\`\`\`bash
npm install -g @oneuptime/cli
export ONEUPTIME_URL=https://oneuptime.com
export ONEUPTIME_TELEMETRY_INGESTION_KEY=<ingestion key>
dbt build
oneuptime dbt upload
\`\`\`

在 CI 中，把 \`oneuptime dbt upload\` 作為建置之後的步驟執行，即使建置失敗也要執行，這樣失敗的測試才會被記錄下來。對於 dbt Cloud 工作，先用 dbt Cloud 的 API 下載其構件，再使用 \`--manifest\` 和 \`--run-results\` 上傳。也可以自己傳送：向 \`POST /telemetry/dbt/v1/artifacts\` 傳送 \`{ "manifest": ..., "run_results": ... }\`，並把金鑰放在 \`x-oneuptime-token\` 中。

每次上傳的作用：
- **資料表：** 每個屬於 OneUptime 所監看資料表的模型、seed、snapshot 和來源，都會在其概覽上取得一張 **dbt** 卡片：節點、其具體化方式、擁有者、標記和上一次建置。當資料表的描述為空白時，會用其 dbt 描述填寫。資料表依其資料庫、結構描述和名稱比對，支援 PostgreSQL、MySQL、SQL Server、Redshift、Snowflake、BigQuery、ClickHouse 和 Databricks。dbt 不知道主機，因此當兩個被監看的資料庫同名時，它們的資料表會維持未比對，除非只有其中一個包含該資料表。
- **血緣：** 每個模型由什麼建構，會透過專案的管道成為該資料表 **血緣** 索引標籤上的血緣。
- **測試：** 被監看資料表的每個測試都會顯示在其 **檢查** 索引標籤上，並帶有其最近的結果以及它發現失敗的資料列。按一下 **失敗時發出警示**，即可讓失敗的測試開啟警示。
- **建置：** 每次建置都是 **管道** 下專案管道（命名空間 \`dbt\`）的一次執行。帶有錯誤或失敗測試的建置就是一次失敗的執行，因此管道警示也適用於 dbt 建置：失敗、異常長和延遲。

## 未使用的資料表

每個引擎都會在自己的統計資訊中計算每個資料表的讀取：
- PostgreSQL：其掃描。
- MySQL：performance_schema 的讀取。
- SQL Server：其 seek、scan 和 lookup，以及最後一次的時間。

每次收集都會將計數器與上次保存的值比較，因此資料表的 **上次讀取** 可以精確到小時，從什麼時候開始沒有讀取也同樣可知。資料表首次收集時計數器為 0，表示自引擎統計開始以來它從未被讀取，因此未使用的資料表從一開始就會顯示為未使用，而不是在監看幾個月之後。在某個服務的資料庫 span 中看到的讀取也會計入。

**未使用的資料表** 列出 90 天內沒有人讀取過的資料表，從最大的開始，並顯示每個資料表上次被寫入的時間：仍在寫入卻從未被讀取的資料表，會產生寫入和儲存的成本。概覽顯示它們有多少以及包含什麼。檢視表沒有自己的計數器，因此永遠不會被列出。當資料庫登入帳戶無法讀取計數器時，資料表的上次讀取時間就無從得知。

## 倉儲支出

每小時一次，隨每個倉儲的收集，OneUptime 會逐個工作讀取 Snowflake 和 BigQuery 在過去一天的花費：Snowflake 的運算點數來自 \`QUERY_ATTRIBUTION_HISTORY\`（需要對 \`SNOWFLAKE\` 資料庫的 \`IMPORTED PRIVILEGES\`，在連線的倉儲上執行），BigQuery 的計費位元組來自其工作檢視表（需要 **BigQuery Resource Viewer**）。工作是一個被反覆執行的查詢 - Snowflake 的參數化查詢、去掉常值的 BigQuery 查詢 - 以其查詢標記或標籤命名，或以它做什麼以及寫入哪個資料表命名，絕不以其查詢文字命名。

**倉儲支出** 顯示當天的點數和計費位元組，依團隊劃分（工作的查詢標記或標籤中的 \`team\`，否則為執行它的人），寫入成本最高的資料表（在 Snowflake 的 ACCESS_HISTORY 或 BigQuery 的目的地資料表說明了是哪些資料表時，把工作的花費分攤到它寫入的資料表上），失敗的工作，以及花在只寫入 90 天內沒有人讀取過的資料表的工作上的費用。

## 一個原因一個問題

當一個資料表變得過時，由它建構的每個資料表也會變得過時。在開啟資料警示之前，OneUptime 會沿著血緣查找：建構其資料表或管道所用的內容上是否已經有一個開啟的警示，包括上游的資料表、寫入它們的管道以及它們所在的資料庫，最多向上五步。找到之後，新警示就是那個警示的後果：
- 它一開始就是 **已確認** 狀態，因此不會有人為同一個問題被驚動兩次。它的資料一旦恢復，它也會自行恢復。
- 它的動態會說明是哪個警示造成了它，它的 **資料** 卡片也會說明。
- 如果原因屬於某個片段，它會加入原因所在的片段。

原因的 **資料** 卡片會列出它的 **下游影響**：它造成的每個警示。資料表警示的卡片還會顯示寫入該資料表的服務、它們的寫入失敗，以及它們在警示前一天的部署和其他變更。

在 **資料** 卡片下方，警示的頁面會繪製它的 **血緣**：圍繞其資料表繪製（與資料表的 **血緣** 索引標籤的畫法相同），或圍繞其管道繪製，並醒目提示向上到造成它的警示、向下到它造成的每個警示的路徑，原因標示為 **原因**，它造成的每個警示標示為 **後果**。當原因位於畫在箭頭上的管道上時，箭頭會在管道名稱下方顯示 **原因**。來自針對某一欄位的檢查（例如針對 \`customer_id\` 的 NULL 比例檢查）的警示，開啟時會在這些路徑旁邊追蹤該欄位，與資料表的 **血緣** 索引標籤上相同；你可以在那裡選擇資料表的另一個欄位，或清除選擇以只查看路徑。無權查看造成它的警示的人，既看不到 **資料** 卡片，也看不到血緣；對於他們無權查看的被造成的警示，既不會醒目提示也不會計數。同樣的血緣也可以透過 \`POST /api/data-observability/alerts/<alert ID>/lineage\` 取得，其中包括欄位檢查的警示所讀取的 \`column\` 以及每個箭頭所攜帶的欄位。


## OneUptime AI

- **資料警示的調查。** 當 OneUptime AI 調查關於資料表、管道或資料庫的警示時，它會讀取與之相關的內容：資料表的新鮮度及其未解決的警示、造成此警示的那個警示、自前一天以來寫入該資料表的管道的執行（失敗的執行及其錯誤）、寫入該資料表的服務及其寫入失敗、部署和其他變更，以及它的血緣：建構它所用的資料表和由它建構的資料表（有問題的排在前面），並說明造成此警示的警示位於何處、它造成的警示位於哪些資料表上。對於來自針對某一欄位的檢查的警示，它還會沿著血緣追蹤該欄位：上游中建構它所用的欄位，以及下游中由它建構的欄位，逐一資料表進行。它會指出警示背後的執行、部署或上游資料表。
- **用一句話產生檢查。** 在資料表的檢查索引標籤上，**用一句話撰寫檢查** 會把「訂單的總額永遠不會是負數」這樣的規則，變成計算違反該規則的資料列的自訂 SQL 檢查，一旦有違反就發出警示。在 **新增檢查** 新增它之前，你可以先閱讀查詢，它和任何自訂 SQL 檢查一樣受到同樣的限制：一個唯讀陳述式，在唯讀交易中執行。
- **這個資料表是最新的嗎？** 在詢問 AI、Slack 或 Microsoft Teams 中詢問 OneUptime AI（「orders 資料表是最新的嗎？」）。它會根據資料表自己的節奏回答其新鮮度、上次變更的時間、未解決的警示、寫入者的最新執行，以及它所屬的資料產品。AI 代理程式在使用資料之前，會透過 MCP 伺服器的 \`get_data_table_freshness\` 工具詢問同樣的問題。
- **這個資料表是由什麼建構的？** 用同樣的方式詢問（「revenue 資料表的資料來自哪裡？」「如果 raw.orders 停止載入，會影響什麼？」）。它會沿著資料表的血緣向兩個方向各追蹤三步（應要求可達五步），並把延遲、已刪除、有未解決警示或其管道最近一次執行失敗的上游和下游資料表排在前面，由近到遠，同時說明每個資料表相隔幾步以及中間的資料表；接著是其餘部分：從 OneUptime 監看範圍之外載入其來源的管道，以及建構在它上面的 BI 儀表板。未解決的警示只計數、從不點名，而且只包括提問者有權查看的警示。AI 代理程式在變更資料表之前，會透過 MCP 伺服器的 \`get_data_table_lineage\` 工具詢問同樣的問題。

## 使用每個資料表的服務

資料表的 **服務** 索引標籤列出被看到寫入和讀取該資料表的服務，以及每個服務執行的陳述式、過去一小時內的呼叫和失敗，以及上次被看到的時間。這些資訊來自你的服務已經透過 OpenTelemetry 傳送的資料庫 span：帶有 \`db.system.name\`、\`db.namespace\` 和 \`db.collection.name\`（或 \`db.sql.table\`，或名稱類似 \`INSERT orders\` 的 span）的用戶端 span。不需要額外安裝任何東西。每 15 分鐘更新一次。

每個服務還會顯示發出其呼叫的端點，如果它也呼叫模型，則會標示為 **AI 應用程式**。**提及此資料表的錯誤** 列出寫入該資料表的服務中，以名稱提及該資料表的未解決例外狀況和過去一天的錯誤記錄。

只有當 span 的資料庫是某次收集所讀取的資料庫時，才會把它與資料表關聯；當兩個資料庫同名時，只有其 \`server.address\` 是其中之一時才會關聯。如果不確定，就不會計入該 span。

這些指標是 OneUptime 自己的營運資料，不會作為遙測計費。
`;

export default DOCUMENTATION;
