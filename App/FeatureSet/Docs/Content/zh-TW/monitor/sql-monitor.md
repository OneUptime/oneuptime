# SQL 查詢監控器

SQL 查詢監控器會依排程從探針（probe）執行唯讀 SQL 查詢，並根據結果發出警示——回傳的資料列數量、純量值、查詢所花費的時間，或查詢錯誤。它是為「執行查詢並開立事件」的使用情境而打造的，例如當過去五分鐘內取消的訂單數量突然激增、佇列資料表成長過大，或某個關鍵資料列消失時發出警示。

由於查詢是從您網路內部的探針執行，OneUptime 從不需要直接連線到您的資料庫，完整的結果集也絕不會離開探針——只有結果的一小部分、有界限的投影會回報回來。

## 支援的資料庫

SQL 查詢監控器支援以下資料庫引擎：

- **PostgreSQL**（預設連接埠 `5432`）
- **MySQL**（預設連接埠 `3306`）
- **Microsoft SQL Server**（預設連接埠 `1433`）

只要使用相同傳輸協定與 SQL 方言的 MySQL 相容與 PostgreSQL 相容引擎，通常也能運作，但只有上述三種引擎經過官方測試。

## 運作方式

在每次檢查時，探針會連線到您的資料庫，在唯讀的環境中執行您的查詢，讀回最多有界限數量的資料列，並向 OneUptime 回報一份精簡的投影。接著會依據該投影評估您監控器的條件。

探針僅回報：

- **Row Count** — 查詢回傳的資料列數量（受 Max Rows 上限所約束）。
- **Scalar Value** — 第一列的第一個欄位。對於 `SELECT COUNT(*)` 這類查詢，這是最自然的值。
- **First Row** — 第一列，以欄位/值配對的形式呈現，會顯示在檢查摘要中以提供上下文。
- **Execution Time** — 查詢花費的時間，以毫秒為單位。
- **Query Error** — 若查詢失敗，則為經過淨化的錯誤訊息。

完整的結果集絕不會傳送至 OneUptime，因此客戶資料不會被複製到 OneUptime 的儲存空間中。

## 安全模型

針對正式環境資料庫執行由客戶提供的查詢屬於敏感操作，因此 SQL 查詢監控器在設計上即為唯讀，並疊加了多層控管：

- **最小權限資料庫使用者（主要控管）。** 您應該一律使用專屬的唯讀資料庫使用者連線，且該使用者只能存取查詢所需的資料表。這是最重要的控管——請參閱下方的建立唯讀使用者。
- **唯讀執行。** 在 PostgreSQL 與 MySQL 上，探針會開啟一個 `READ ONLY` 交易，無論查詢文字為何，都會拒絕任何寫入（包括可寫入的 CTE）。在沒有唯讀交易的 Microsoft SQL Server 上，探針會在一個一律會被回復（rollback）的交易中執行。
- **單一陳述式、採用允許清單的查詢。** 查詢必須是以 `SELECT`、`WITH`、`VALUES` 或 `TABLE` 開頭的單一陳述式。堆疊的陳述式（`SELECT 1; DROP TABLE …`）以及寫入／DDL 都會在探針連線之前被拒絕。此檢查能辨識註解與字串常值，因此隱藏在註解或字串中的關鍵字並不會蒙混過關。
- **陳述式逾時。** 每個查詢都有硬性的時間上限。執行過久的查詢會被取消。
- **有界限的資料列。** 最多只會讀回 Max Rows（再加一列，用以偵測是否被截斷）數量的資料列，藉此限制探針的記憶體與酬載大小。
- **憑證遮蔽。** 資料庫錯誤在儲存前會經過淨化——密碼與任何連線字串都會被遮蔽，因此憑證絕不會洩漏到錯誤訊息中。

## 先決條件

- 一個對您的資料庫主機與連接埠具有網路存取權的**探針**。這可以是 OneUptime 託管的探針（如果您的資料庫可從網際網路存取），或是在您網路內部執行的自我託管探針。關於如何安裝自訂探針，請參閱探針說明文件。
- 一個**唯讀資料庫使用者**以及連線詳細資訊（主機、連接埠、資料庫名稱、使用者名稱、密碼）。

## 設定

建立一個新的監控器，並選擇 **SQL Query** 作為監控器類型，然後填入連線詳細資訊：

- **Database Type** — PostgreSQL、MySQL 或 Microsoft SQL Server。選擇類型會設定預設的連接埠。
- **Host** — 探針可連線到的資料庫主機（例如 `db.internal`）。
- **Port** — 資料庫連接埠。
- **Database Name** — 要執行查詢的資料庫。
- **Username** — 一個唯讀、最小權限的資料庫使用者。
- **Password** — 資料庫密碼。我們強烈建議以 `{{monitorSecrets.name}}` 引用[監控器密鑰](/docs/monitor/monitor-secrets)，而非以純文字輸入密碼（見下方說明）。
- **SQL Query** — 要執行的唯讀查詢（請參閱撰寫查詢）。
- **Use SSL/TLS** — 啟用以透過 TLS 連線。啟用後，如果資料庫使用自我簽署的憑證，您可以關閉 **Verify server certificate**。

### 進階選項

- **Connection Timeout (ms)** — 建立連線時的等待時間。預設 `10000`，最大 `30000`。
- **Statement Timeout (ms)** — 查詢可執行時間的硬性上限。預設 `15000`，最大 `60000`。
- **Max Rows** — 從資料庫讀回的資料列數量上限。預設 `100`，最大 `1000`。

## 撰寫查詢

查詢必須是**單一的唯讀陳述式**。它必須以 `SELECT`、`WITH`、`VALUES` 或 `TABLE` 其中之一開頭。允許結尾有單一分號；不允許多個陳述式。

讓查詢保持輕量且範圍明確——它們會在每次檢查時執行，因此請優先使用有索引的欄位與較窄的時間範圍。

```sql
-- 計算近期的取消數量（PostgreSQL）
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > NOW() - INTERVAL '5 minutes';
```

```sql
-- 在 MySQL 上的相同做法
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > NOW() - INTERVAL 5 MINUTE;
```

```sql
-- 在 Microsoft SQL Server 上的相同做法
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > DATEADD(minute, -5, GETDATE());
```

對於 `COUNT(*)` 這類查詢，計數同時可作為 **Row Count**（由於只會回傳一列，因此為 `1`）以及 **Scalar Value**（來自第一個欄位的計數本身）取得。若要針對「數量多少」發出警示，請與 **Scalar Value** 進行比較。

## 使用監控器密鑰儲存密碼

為了讓資料庫密碼絕不會以純文字儲存在監控器上，請建立一個[監控器密鑰](/docs/monitor/monitor-secrets)，並從 Password 欄位引用它：

1. 前往 OneUptime Dashboard → Project Settings → Monitor Secrets → Create Monitor Secret。
2. 建立一個密鑰（例如 `dbPassword`），並授予此監控器存取它的權限。
3. 在監控器的 Password 欄位中，輸入 `{{monitorSecrets.dbPassword}}`。

OneUptime 會在設定交給探針之前於伺服器端解析該密鑰。OneUptime 絕不會為您建立這些密鑰——是否引用密鑰由您自行決定。

## 設定條件

新增條件以決定何時將監控器視為線上、效能降低或離線。SQL 查詢監控器可使用以下檢查：

- **SQL Is Online** — 資料庫是否可連線且查詢是否成功。
- **SQL Query Row Count** — 回傳的資料列數量。可搭配大於、小於或等於等運算子進行比較。
- **SQL Query Scalar Value** — 第一列的第一個欄位。當兩邊看起來都是數值時以數值比較，否則以字串比較。這是用於 `COUNT(*)` 這類查詢的檢查。
- **SQL Query Execution Time (in ms)** — 查詢花費的時間。適用於偵測資料庫變慢的情況。
- **SQL Query Error** — 查詢錯誤訊息。可在其為空（或不為空），或符合特定字串時發出警示。
- **JavaScript Expression** — 評估自訂的 JavaScript 運算式以完全掌控。請參閱 [JavaScript 運算式](/docs/monitor/javascript-expression)。

### 範例：當取消數量激增時發出警示

使用上方的查詢：

- **條件：效能降低** — `SQL Query Scalar Value` 大於 `10`。
- **條件：離線** — `SQL Query Scalar Value` 大於 `50`，或 `SQL Is Online` 為 `false`。

將待命政策附加至條件，以便正確的人員收到呼叫。

## 建立唯讀使用者

請一律使用專屬的唯讀使用者連線。範例：

```sql
-- PostgreSQL
CREATE USER oneuptime_ro WITH PASSWORD 'a-strong-password';
GRANT CONNECT ON DATABASE orders TO oneuptime_ro;
GRANT USAGE ON SCHEMA public TO oneuptime_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO oneuptime_ro;
-- 一併涵蓋未來建立的資料表：
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO oneuptime_ro;
```

```sql
-- MySQL
CREATE USER 'oneuptime_ro'@'%' IDENTIFIED BY 'a-strong-password';
GRANT SELECT ON orders.* TO 'oneuptime_ro'@'%';
FLUSH PRIVILEGES;
```

```sql
-- Microsoft SQL Server
CREATE LOGIN oneuptime_ro WITH PASSWORD = 'a-strong-password';
USE orders;
CREATE USER oneuptime_ro FOR LOGIN oneuptime_ro;
ALTER ROLE db_datareader ADD MEMBER oneuptime_ro;
```

## 須考量的事項

- 查詢會在每次檢查時執行，因此請讓它保持輕量。使用索引與較窄的時間範圍，並倚賴陳述式逾時作為後盾。
- 只會回報資料列數量、第一個儲存格（純量值）與第一列——請設計您的查詢，讓您想要發出警示的值位於第一個欄位。
- 如果結果因超過 Max Rows 而被截斷，檢查摘要會將其標記為已達上限。只在您有需要時才提高 Max Rows；較大的結果集會在探針上耗用更多記憶體。
- 寫入與 DDL 一律會被拒絕。如果您需要測試寫入路徑，這個監控器並非為此而設計。
- 相較於純文字密碼，請優先使用監控器密鑰，讓憑證在靜態時保持加密。
