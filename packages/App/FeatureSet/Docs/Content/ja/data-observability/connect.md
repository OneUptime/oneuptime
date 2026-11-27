# データベースを接続する

データオブザーバビリティは、カタログだけを読み取るログインで各データベースを読み取ります: どのテーブルとビューがあるか、その列、行数、サイズ、そしていつ変更されたかです。このページでは、各エンジンに最低限必要なもの、プローブまたはすでに実行している Database Agent を使って接続文字列をネットワークの内側に保つ方法、そして後からデータベースを変更する方法、データオブザーバビリティから削除する方法、OneUptime から削除する方法を説明します。

## 始める前に

- **データベースを接続できるロール**: プロジェクト所有者、プロジェクト管理者、またはテレメトリ管理者。
- **読み取り専用のログイン**。下のステートメントで作成します。後から追加するチェックは、チェック対象のテーブルの行を読み取ります。そのため、それらのテーブルに対する `SELECT` をログインに付与するのは、チェックを追加するときだけにしてください。

## 接続する側を選ぶ

**データオブザーバビリティ > データベース** で **データベースを接続** を選び、次のいずれかを選びます。

- **OneUptime が接続**: 接続文字列を貼り付けます。接続文字列は暗号化して保存され、OneUptime のワーカーだけが使い、二度と表示されません。
- **自社ネットワーク内のプローブが接続**: プローブを 1 つ選び、そのプローブ上で接続文字列を保持している環境変数の名前を指定します ( `ORDERS_DB_URL` など)。接続文字列がネットワークの外に出ることはありません。 [カスタムプローブ](/docs/probe/custom-probe) を参照してください。
- **自社のデータベースエージェントが接続**: [Database Agent](/docs/telemetry/databases) がすでに横で動いているデータベースサーバーを選び、そのサーバー上で読み取るデータベースの名前を指定します。エージェントは自身の環境のログインでデータベースを読み取るため、OneUptime にログインは保存されません。 [Database Agent 経由](#database-agent-経由) を参照してください。

データセキュリティ用にすでに接続されているデータベースも、接続作業なしで監視されます。 [クラウド接続](/docs/telemetry/cloud-accounts) が見つけたすべての BigQuery データセットも同様です。

## 接続できるデータベース

**データベース** の **接続できるデータベース** には、プロジェクトがすでに把握していて、まだ誰も接続していないものが一覧表示されます。トレースが通信しているデータベース、クラウドアカウント内のデータベース、データベースモニタリングが監視しているデータベースです。**接続** を選ぶと、それぞれについて分かっている情報からフォームが開き、接続文字列を入力するだけで済みます。**非表示** を選ぶと、そのデータベースは再表示されません。接続するまでは何も読み取りません。

## Database Agent 経由

Database Agent はすでにデータベースサーバーに到達し、そのメトリクスを送信しています。所有者が有効にすれば、そのサーバーの PostgreSQL、MySQL、MariaDB のデータベースをデータオブザーバビリティ用に読み取ることもできます: エージェントの `.env` に `ONEUPTIME_DATA_OBSERVABILITY=true` を追加し、 `docker compose up -d` を実行してください。それまでは、エージェントは **データオブザーバビリティがオフ** と表示され、エージェント経由で接続したデータベースには必要な対処が表示されます。

OneUptime はエージェントに、読み取るデータベースと実行時期が来たチェックを、それぞれの種類と、読み取るテーブルと列とともに伝えます。ステートメントやログインを送ることはありません。エージェントは、OneUptime 自身のコレクターが使うのと同じ固定の形から、すべてのステートメントを自分で組み立て、それぞれを 30 秒の制限付きの読み取り専用トランザクションで実行します。チェックが参照するすべてのテーブルと列が直前に読み取ったカタログにある場合にだけそのチェックを実行し、チェックが比較に使うすべての値をバインドし、チェックごとに数値を 1 つだけ返します。行を返すことはありません。 **カスタム SQL** と **失敗した行** のチェックは、エージェントの所有者が `ONEUPTIME_DATA_OBSERVABILITY_ALLOW_CUSTOM_SQL=true` を設定した場所でだけ実行されます。それ以外の場所ではその旨が表示され、他のチェックはすべて実行されます。

エージェントは `ONEUPTIME_DATA_OBSERVABILITY_DATABASE_USERNAME` (またはコレクターのログイン) でカタログを読み取り、 `ONEUPTIME_DATA_OBSERVABILITY_CHECKS_USERNAME` (またはカタログのログイン) でチェックを実行します。それぞれには、下のタブに記載されている権限だけを付与してください。エージェントの README にすべての変数が記載されています。

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
GRANT SHOW VIEW, REFERENCES ON orders.* TO 'oneuptime_reader'@'%';
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
@tab Oracle
```sql
CREATE USER oneuptime_reader IDENTIFIED BY "...";
GRANT CREATE SESSION TO oneuptime_reader;
GRANT READ ON sales.orders TO oneuptime_reader;
GRANT SELECT_CATALOG_ROLE TO oneuptime_reader;
```

Oracle は Oracle クライアントをインストールせずに独自のプロトコルで読み取ります: `oracle://oneuptime_reader:...@orders-db.internal:1521/ORCLPDB1`。ログインは読み取り可能なテーブルだけを参照できます。監視する各テーブルに `READ` を付与してください。クエリはできますが、ロックや変更はできません。`SELECT_CATALOG_ROLE` で OneUptime は各テーブルのサイズを読み取り、`ALL_TAB_MODIFICATIONS` は各テーブルの最後の統計以降の挿入、更新、削除と、最後に変更された時刻を示します。
@tab Amazon Athena
1 つの Glue データベースが 1 つのデータベースです。テーブルとビュー、その列と統計、各 Iceberg テーブルの最後のコミットは Glue Data Catalog の API から読み取り、データは読まず、費用もかかりません。チェックは指定したワークグループで Athena クエリとして実行されます。`glue:GetDatabase` と `glue:GetTables` を呼び出せ、チェックのためにテーブルのデータへの読み取りアクセスを持ってワークグループで Athena クエリを実行できる IAM ユーザーまたはロールのキーで接続します:

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

MongoDB は独自のドライバーで読み取ります: `mongodb+srv://oneuptime_reader:...@cluster0.example.mongodb.net/`、またはレプリカセットのホストを指定した `mongodb://`。パスにデータベースがあれば、監視するのはそのデータベースだけです。ない場合はログインが読み取れるすべてのデータベースを監視し、`readAnyDatabase` の代わりに `{ role: "read", db: "orders" }` を付与するとひとつに限定できます。各コレクションのドキュメント、サイズ、書き込みは `$collStats` から、最後にドキュメントを受け取った時刻は最新の `_id` から取得します。フィールドはバリデーターの JSON スキーマから、ない場合は最新の 100 件のドキュメントのフィールド名と型から取得します。これらはデータベース内で算出されるため、値が外に出ることはありません。ドキュメントはセカンダリがあればセカンダリで読み取り、カスタムチェックは JSON 形式の集計パイプラインです。
@tab Microsoft Dataverse
OneUptime はアプリとして環境にサインインします。Microsoft Entra ID でアプリを登録し、クライアントシークレットを作成します。次に、そのアプリをアプリケーションユーザーとして環境に追加します: Power Platform admin center で環境を開き、**Settings** > **Users + permissions** > **Application users** > **New app user** を選びます。監視するテーブルを読み取れるセキュリティロールを割り当ててください。

JSON で接続します:

```json
{ "environmentUrl": "https://contoso.crm.dynamics.com", "tenantId": "72f988bf-86f1-41af-91ab-2d7cd011db47", "clientId": "11111111-2222-3333-4444-555555555555", "clientSecret": "..." }
```

または、Dataverse の SDK が受け付ける形式の Dataverse 接続文字列で接続します: `AuthType=ClientSecret;Url=https://contoso.crm.dynamics.com;ClientId=...;ClientSecret=...`。テナントを省略すると、環境がどのテナントにあるかを示します。

環境にはもともと数百のテーブルがあるため、監視するのは次のテーブルだけです: 主要な業務テーブル (`account`、`contact`、`lead`、`opportunity`、`quote`、`salesorder`、`invoice`、`product`、`incident`、`email`、`phonecall`、`appointment`、`task`、`annotation`) と、独自のカスタムテーブルです。Microsoft のアプリのテーブルは除外されます。これらの名前は `msdyn_`、`adx_`、またはその他の `ms` プレフィックスで始まります。ほかのテーブルも監視するには、論理名で指定します: `"tables": ["msdyn_workorder", "systemuser"]`。

Web API は 5 分ごとに、各テーブルの定義、行数、最新の `modifiedon` を返します。これが最後に変更された時刻です。行数は Dataverse が 1 日に 1 回行うカウントに基づくため、最大で 1 日遅れます。列は 1 時間に 1 回読み取ります。各収集では 2 件のリクエストに加えて、監視するテーブルごとに 1 件のリクエストを送ります。これらはアプリの上限である 5 分あたり 6,000 件のリクエストに数えられます。Dataverse で一時的に失敗したリクエストや、Dataverse から数秒待つよう求められたリクエストは、最大 2 回まで再送します。それより長く待つよう求められた場合、残りの読み取りは次の収集まで待ちます。Dataverse が読み取れないテーブルは、Dataverse 自身のエラーコードとメッセージを添えてそのテーブルだけが除外され、次の試行までスキップされます。次の試行は 1 時間後で、その後は 2 時間後、4 時間後と間隔が延び、最長で 1 日になります。スキップ中のテーブルは、データベースのページの **スキップ中のテーブル** に一覧表示されます。**今すぐ収集** を押すと、それらすべてにすぐ再度問い合わせます。環境のテーブルや、それらを読み取るアプリが変更された場合も同様です。テーブルの読み取りを止めるには、そのテーブルを除外してください。

チェックは、同じアプリとしてサインインし、環境の TDS エンドポイント (ポート 1433 または 5558) で読み取り専用の SQL として実行されます。TDS エンドポイントは、管理者がオフにしていない限りオンです。そのエンドポイントでユーザーレベルのアクセス制御がオンになっている場合は、アプリのロールに **Allow user to access TDS endpoint** 特権が必要です。その SQL は正規表現、`WITH`、サンプリングに対応していないため、Dataverse のチェックはすべての行を読み取ります。
:::

## 読み取る内容と頻度

| 内容 | タイミング |
| --- | --- |
| テーブル、ビュー、列、行数、サイズ、最終変更 | 5 分ごと |
| チェック | 各チェックの指定に従い、15 分、1 時間、6 時間、または 1 日ごと |
| クエリ履歴からのリネージと最終読み取り | 1 時間に 1 回、前回の読み取りの時点までさかのぼって |

すべてのステートメントは読み取り専用で実行され、エンジンが対応していれば、ステートメントとロックのタイムアウトが設定されます。Snowflake、Databricks、BigQuery、Athena、ClickHouse、Dataverse が 429、503、または混雑しているという独自の応答で一時的に拒否したり失敗したりしたリクエストは、収集ごとに合計 1 分以内の待ち時間で最大 2 回まで再送されますが、ステートメントが 2 回実行されうる方法で再送されることはありません。接続文字列がログに記録されることはなく、すべてのエラーから取り除かれます。ログインが読み取れない統計情報は、収集の失敗にはせず、データベースに警告を出したうえで省きます。OneUptime Cloud では、プライベートアドレスへの接続は拒否されます。その場合はプローブを使ってください。

## データベースを管理する

各データベースには **設定** ページがあります。 **データベース** の行、またはそのメニューで **設定** を選びます。

- **詳細を編集** で名前を変更します。データセキュリティにも同じ名前が表示されます。
- **接続を変更** で、新しいログイン、別のプローブ、または Database Agent を指定します。保存された接続文字列は二度と表示されません。保持するにはフィールドを空のままにしてください。データベースを Database Agent に切り替えると、保存された接続文字列は削除されます。ただし、データセキュリティがその接続文字列でデータベースの内容をサンプリングしている場合は削除されません。
- **概要** の **監視を停止** は、しばらくの間読み取りを止め、テーブルとその履歴を残します。 **監視を再開** で再開します。
- **データオブザーバビリティから削除** は、読み取りを止め、テーブル、そのチェック、履歴を破棄します。データセキュリティはデータベース、その接続、スキャンで見つかった内容を保持し、データベースは **接続できるデータベース** に再び表示されます。
- **データベースを削除** は、データオブザーバビリティとデータセキュリティが保持している内容とともに、データベースを OneUptime から削除します。確認画面には、削除されるものが先に一覧表示されます。

ここでのデータベースは、データセキュリティのデータストアでもあります。データセキュリティがそのデータベースを利用している間 (データセキュリティがデータベースを見つけた、誰かがデータセキュリティに追加した、またはデータベースに関する検出結果、問題、スキャン、所有者、処理記録がある場合)、データベースを削除できるのはデータセキュリティのデータストアを削除できるユーザーだけで、データセキュリティが内容のサンプリングに使う接続を変更できるのはデータストアを編集できるユーザーだけです。設定ページでは、該当するボタンのところにその旨が表示されます。データベースを監視しているモニターは、データベースがなくなっても残ります。 **モニター** で削除してください。

## リードレプリカ

PostgreSQL または SQL Server のリードレプリカは書き込みカウンターが動かないため、テーブルが変更されていても変更なしに見えることがあります。OneUptime はレプリカであることを検出すると、カウンターを使わず、そのことをデータベースに表示し、テーブルのサイズと行数にフォールバックします。可能であればプライマリを接続するか、重要なテーブルには [鮮度列](/docs/data-observability/table-health) を指定してください。

## ストレージパス

あなたが頼りにしているものすべてがデータベースにあるわけではありません。毎晩バケットに届くエクスポートも、どのテーブルとも同じように遅れたり、不足したりします。**ストレージパス** で、 [クラウド接続](/docs/telemetry/cloud-accounts) が見つけた Amazon S3、Google Cloud Storage、または Azure ストレージアカウントのバケットに対して **パスを編集** を選び、重要なパスを、行を分けて指定します。Azure では、各パスをコンテナー名から始めます。

各パスは **テーブル** に表示されます。最新のオブジェクトがその最終変更、オブジェクトが行、そのサイズがサイズとなり、同じアラートが適用されます。読み取るのは名前、サイズ、時刻のみで、オブジェクトの中身は読みません。10000 個を超えるオブジェクトを持つパスは、正確な数、サイズ、最新のオブジェクトを得られず、その旨が表示されます。より狭いパスを指定してください。

## トラブルシューティング

- **データベースに「データベースエージェントの準備未完了」と表示される。** エージェントは現在データベースを読み取れません。理由はデータベースのページに表示されます: サーバーに Database Agent が接続されていない、エージェントがデータオブザーバビリティに対してオフになっている (`ONEUPTIME_DATA_OBSERVABILITY=true` で有効になります)、応答がない、古すぎる ( `install.sh` を再実行してください)、または PostgreSQL でも MySQL でもないサーバー上にある、のいずれかです。
- **データベースに「失敗」と表示される。** メッセージに理由が示されます: OneUptime から到達できないホスト、拒否されたログイン、サーバーが受け付けない TLS モードなどです。ネットワーク内のデータベースは、プローブ経由で接続してください。Snowflake、Databricks、BigQuery、Athena、ClickHouse、Dataverse の場合は、読み取っていた対象、サービス自身のエラーコードとメッセージ、そしてサービスが返す場合は、そのサポートが追跡できるリクエスト ID またはクエリ ID も示されます。**今すぐ収集** を押すとすぐに再試行され、ページに結果が表示されます。
- **テーブルに最終変更が表示されない。** ログインがエンジンの統計情報を読み取れません: エンジンのタブに記載されている権限を付与するか、テーブルの行数が 2 回変わるまで待ってください。
- **テーブルが見つからない。** ログインが使えないスキーマにあるか、データベースで除外されています。そのスキーマに対する `USAGE` を付与するか、除外を解除してください。
- **MySQL のテーブルに列がない。** ログインには上記のとおり `REFERENCES` が必要です。これは、テーブルの行を読み取る権限を与えずに、テーブルの列を表示できるようにします。
- **Dataverse 環境がアプリを拒否したと表示される。** Microsoft Dataverse のタブのとおり、テーブルを読み取れるセキュリティロールを付けて、アプリをアプリケーションユーザーとして環境に追加してください。
- **Dataverse のテーブルがスキップされる。** Dataverse がそのテーブルを読み取れませんでした。データベースのページの **スキップ中のテーブル** に、その理由が Dataverse 自身の言葉で示されます。アプリのセキュリティロールがそのテーブルを読み取れない場合は、読み取りアクセス権を付与してから **今すぐ収集** を選んでください: スキップ中のすべてのテーブルにすぐ再度問い合わせます。
- **Dataverse のテーブルが見つからない。** 監視するのは、主要な業務テーブルと独自のカスタムテーブルだけです。そのテーブルを論理名で `tables` に指定してください。

## 次のステップ

:::cards
- [テーブルのヘルス](/docs/data-observability/table-health): 各収集がすべてのテーブルについて把握すること、そして推奨されるアラート。
- [チェックと照合](/docs/data-observability/checks): テーブルの中身に対するルール。
:::
