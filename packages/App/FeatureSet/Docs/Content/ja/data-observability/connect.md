# データベースを接続する

データオブザーバビリティは、カタログだけを読み取るログインで各データベースを読み取ります: どのテーブルとビューがあるか、その列、行数、サイズ、そしていつ変更されたかです。このページでは、各エンジンに最低限必要なものと、プローブを使って接続文字列をネットワークの内側に保つ方法を説明します。

## 始める前に

- **データベースを接続できるロール**: Project Owner、Project Admin、または Telemetry Admin。
- **読み取り専用のログイン**。下のステートメントで作成します。後から追加するチェックは、チェック対象のテーブルの行を読み取ります。そのため、それらのテーブルに対する `SELECT` をログインに付与するのは、チェックを追加するときだけにしてください。

## 接続する側を選ぶ

**データオブザーバビリティ > データベース** で **Connect a Database** を選び、次のどちらかを選びます。

- **OneUptime connects**: 接続文字列を貼り付けます。接続文字列は暗号化して保存され、OneUptime のワーカーだけが使い、二度と表示されません。
- **A probe in my network connects**: プローブを 1 つ選び、そのプローブ上で接続文字列を保持している環境変数の名前を指定します ( `ORDERS_DB_URL` など)。接続文字列がネットワークの外に出ることはありません。 [カスタムプローブ](/docs/probe/custom-probe) を参照してください。

データセキュリティ用にすでに接続されているデータベースも、接続作業なしで監視されます。 [クラウド接続](/docs/telemetry/cloud-accounts) が見つけたすべての BigQuery データセットも同様です。

## エンジンごとの読み取り専用ログイン

:::tabs
@tab PostgreSQL
```sql
CREATE ROLE oneuptime_reader LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE orders TO oneuptime_reader;
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
```

接続文字列は `postgres://oneuptime_reader:...@orders-db.internal:5432/orders?sslmode=require` です。OneUptime は `pg_class`、`pg_stat_user_tables`、`pg_attribute` を読み取ります: 挿入、更新、削除のカウンターが動いたときにテーブルが変更されたとみなし、スキャンのカウンターが動いたときに読み取られたとみなします。
@tab MySQL and MariaDB
```sql
CREATE USER 'oneuptime_reader'@'%' IDENTIFIED BY '...';
GRANT SHOW VIEW ON orders.* TO 'oneuptime_reader'@'%';
GRANT SELECT ON performance_schema.table_io_waits_summary_by_table TO 'oneuptime_reader'@'%';
```

`performance_schema` があれば、OneUptime は収集と収集の間の書き込みと読み取りを把握できます。ない場合でも、 `information_schema.TABLES` から各テーブルが最後に変更された日時はわかります。
@tab SQL Server
```sql
CREATE LOGIN oneuptime_reader WITH PASSWORD = '...';
CREATE USER oneuptime_reader FOR LOGIN oneuptime_reader;
GRANT VIEW DEFINITION TO oneuptime_reader;
GRANT VIEW DATABASE STATE TO oneuptime_reader;
```

`VIEW DATABASE STATE` があれば、OneUptime はサイズ、最終更新、最終読み取りを読み取れます。
@tab Amazon Redshift
```sql
CREATE USER oneuptime_reader PASSWORD '...';
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
ALTER USER oneuptime_reader SYSLOG ACCESS UNRESTRICTED;
```

クラスターまたはワークグループのエンドポイントに、 `postgres://oneuptime_reader:...@cluster.abc123.us-east-1.redshift.amazonaws.com:5439/dev?sslmode=require` のような PostgreSQL の接続文字列で接続します。 `SYSLOG ACCESS UNRESTRICTED` があれば、OneUptime は行数とサイズ、すべてのユーザーの最終書き込みと最終読み取り、そしてクエリログからのリネージを読み取れます。これがなくても、テーブルの行数が変われば、いつ変更されたかはわかります。
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

Snowflake は、キーペア認証を使って SQL API 経由で読み取ります。JSON で接続します:

```json
{ "account": "myorg-myaccount", "user": "ONEUPTIME_READER", "privateKey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----", "database": "ANALYTICS", "warehouse": "CHECKS_WH", "role": "ONEUPTIME_READER" }
```

カタログは `SHOW` で読み取ります。これはウェアハウスを必要としないので、収集にクレジットはかかりません。ウェアハウスで実行されるのはチェックだけで、指定したスケジュールで実行されます。
@tab Google BigQuery
クラウド接続が見つけたすべてのデータセットは、その接続のサービスアカウントで監視されます。カタログを読み取るために、プロジェクトに対する **BigQuery Metadata Viewer** と **BigQuery Job User** を、チェックが読み取るテーブルに対する **BigQuery Data Viewer** を、そしてジョブからのリネージのために **BigQuery Resource Viewer** を付与してください。

各収集では、データセットの `__TABLES__` (行数、バイト数、最終変更を無料で取得) と `INFORMATION_SCHEMA.COLUMNS` (BigQuery の最小課金量である 10 MB 分を課金) を読み取ります。クラウド接続なしでデータセットを接続するには、サービスアカウントキーを含む JSON を指定します:

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

ClickHouse は HTTP インターフェース経由で読み取ります。ポートは TLS ありなら 8443 (ClickHouse Cloud)、なしなら 8123 です: `clickhouse://oneuptime_reader:...@abc123.us-east-1.aws.clickhouse.cloud:8443/analytics`。データベース名を指定するとそのデータベースだけを監視し、省略するとサーバー自身のもの以外のすべてのデータベースを監視します。 `system.parts` によって OneUptime は各挿入を把握でき (マージは数えません)、サーバーが保持していれば `system.part_log` から各挿入の時刻が、 `system.query_log` から最終読み取りとリネージが 1 時間に 1 回得られます。すべてのステートメントは読み取り専用で実行されるため、書き込みができるログインであっても書き込むことはできません。
@tab Databricks
```sql
GRANT USE CATALOG, BROWSE ON CATALOG main TO `oneuptime-reader`;
GRANT USE SCHEMA ON CATALOG main TO `oneuptime-reader`;
GRANT USE CATALOG ON CATALOG system TO `oneuptime-reader`;
GRANT USE SCHEMA, SELECT ON SCHEMA system.access TO `oneuptime-reader`;
```

Unity Catalog のカタログ 1 つが 1 つのデータベースです。サービスプリンシパルで接続するか、 `clientId` と `clientSecret` の代わりに個人用アクセストークンを `"token"` として指定して接続します:

```json
{ "host": "adb-1234567890123456.7.azuredatabricks.net", "clientId": "...", "clientSecret": "...", "catalog": "main", "warehouseId": "abc123def456" }
```

カタログ、その列、各 Delta テーブルの最後のコミットは、SQL ウェアハウスを使わずに Unity Catalog の REST API から取得するため、収集にコンピュートのコストはかかりません。チェック、そして `system.access.table_lineage` からのリネージと最終読み取り (1 時間に 1 回) は、指定した SQL ウェアハウスで実行されます。サービスプリンシパルに、そのウェアハウスに対する **Can use** を付与してください。
:::

## 読み取る内容と頻度

| 内容 | タイミング |
| --- | --- |
| テーブル、ビュー、列、行数、サイズ、最終変更 | 5 分ごと |
| チェック | 各チェックの指定に従い、15 分、1 時間、6 時間、または 1 日ごと |
| クエリ履歴からのリネージと最終読み取り | 1 時間に 1 回、前回の読み取りの時点までさかのぼって |

すべてのステートメントは読み取り専用で実行され、エンジンが対応していれば、ステートメントとロックのタイムアウトが設定されます。接続文字列がログに記録されることはなく、すべてのエラーから取り除かれます。ログインが読み取れない統計情報は、収集の失敗にはせず、データベースに警告を出したうえで省きます。

## トラブルシューティング

- **データベースに「失敗」と表示される。** メッセージに理由が示されます: OneUptime から到達できないホスト、拒否されたログイン、サーバーが受け付けない TLS モードなどです。ネットワーク内のデータベースは、プローブ経由で接続してください。
- **テーブルに最終変更が表示されない。** ログインがエンジンの統計情報を読み取れません: エンジンのタブに記載されている権限を付与するか、テーブルの行数が 2 回変わるまで待ってください。
- **テーブルが見つからない。** ログインが使えないスキーマにあるか、データベースで除外されています。そのスキーマに対する `USAGE` を付与するか、除外を解除してください。

## 次のステップ

:::cards
- [テーブルの健全性](/docs/data-observability/table-health): 各収集がすべてのテーブルについて把握すること、そして推奨されるアラート。
- [チェックと照合](/docs/data-observability/checks): テーブルの中身に対するルール。
:::
