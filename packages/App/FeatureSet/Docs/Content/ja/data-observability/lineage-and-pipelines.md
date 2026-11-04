# リネージとパイプライン

リネージは、各テーブルがどのテーブルから作られ、どのパイプラインがそのテーブルに書き込んでいるかを示します。データオブザーバビリティは、OpenLineage のイベント、dbt、Fivetran と Airbyte の同期、ビュー、そして各データベース自身のクエリ履歴という 5 つの場所から同時にリネージを集め、それを使って、遅れたテーブルや壊れたテーブルをその背後にある実行に結び付けます。そのため、1 つの問題で開くアラートは 1 件だけです。

## リネージの取得元

| ソース | 得られるもの |
| --- | --- |
| **OpenLineage** | Airflow、Dagster、Spark、dbt、Flink のジョブのすべての実行と、その実行が読み書きしたテーブル |
| **dbt** | 各モデルが何から作られているか、1 回の実行としての各ビルド、そして各テストの結果 |
| **Fivetran と Airbyte** | コネクターの 1 回の実行としての各同期と、その同期がロードする生のテーブル |
| **ビュー** | ビューは、その定義に使われているテーブルから作られます (PostgreSQL、Redshift、MySQL 8、SQL Server、ClickHouse のマテリアライズドビュー、Databricks) |
| **クエリ履歴** | あるテーブルを読み取り、別のテーブルに書き込んだクエリ (BigQuery のジョブ、Redshift のクエリログ、ClickHouse のクエリログ、Databricks のリネージテーブル) |

テーブルの **リネージ** タブには、そのテーブルの作成元のテーブル、そのテーブルに書き込むパイプラインとその最新の実行、そしてそのテーブルから作られるテーブルが表示されます。各エッジには、それがどこで確認されたかが示されます。

## OpenLineage

テレメトリの [取り込みキー](/docs/telemetry/ingestion-keys) を使って、OpenLineage のイベントを変更せずにそのまま OneUptime に送信します:

- **URL:** `https://oneuptime.com/telemetry/openlineage` (セルフホストの OneUptime では、自分のアドレス)
- **エンドポイント:** `api/v1/lineage` (OpenLineage のデフォルト)
- **API キー:** 取り込みキー。 `Authorization: Bearer` として送るか、 `x-oneuptime-token` を設定します

Airflow の OpenLineage プロバイダーの場合:

```bash
AIRFLOW__OPENLINEAGE__TRANSPORT='{"type": "http", "url": "https://oneuptime.com/telemetry/openlineage", "endpoint": "api/v1/lineage", "auth": {"type": "api_key", "apiKey": "YOUR_INGESTION_KEY"}}'
```

ほかの OpenLineage クライアントでは、 `OPENLINEAGE_URL` と `OPENLINEAGE_API_KEY` を設定します。データセットは、OpenLineage の命名仕様に従ってテーブルに対応付けられます。たとえば `postgres://host:5432` と `database.schema.table`、 `snowflake://account` と `database.schema.table`、 `clickhouse://host:8443` と `database.table`、 `databricks://workspace-host` と `catalog.schema.table` です。

## dbt

`dbt build` (または run、test、seed、snapshot) の後、 [OneUptime CLI](/docs/cli/index) でプロジェクトのアーティファクトを送信します:

```bash
npm install -g @oneuptime/cli
export ONEUPTIME_URL=https://oneuptime.com
export ONEUPTIME_TELEMETRY_INGESTION_KEY=<ingestion key>
dbt build
oneuptime dbt upload
```

CI では、ビルドの次のステップとして、ビルドが失敗した場合でも `oneuptime dbt upload` を実行してください。そうすれば、失敗したテストが記録されます。dbt が作成する各テーブルには、概要に **dbt** カードが、そのモデルのリネージが、そして **チェック** タブにそのテストが表示されます。各ビルドは、プロジェクトのパイプラインの 1 回の実行です。

## Fivetran と Airbyte

それらの Webhook は、各同期がいつ始まり、いつ終わったかを伝えます。 **パイプライン > Fivetran または Airbyte を接続** では、取り込みキーの 1 つを使って URL が入力されます:

- **Fivetran:** Fivetran の REST API で作成する Webhook です。イベント `sync_start` と `sync_end` を対象とし、宛先は `https://oneuptime.com/telemetry/fivetran/v1/webhook/<ingestion key ID>`、シークレットは取り込みキーです。Fivetran はすべての配信にこのキーで署名するため、キーが URL に含まれて送られることはありません。
- **Airbyte:** ワークスペースの Webhook を `https://oneuptime.com/telemetry/airbyte/v1/webhook/<ingestion key>` に設定し、失敗した同期と成功した同期についてオンにします。Airbyte には専用のキーを渡してください。

API のレート制限によって再スケジュールされた Fivetran の同期は、 **再スケジュール** として終わります: 失敗ではないので、誰も呼び出されません。

## BI ツールのダッシュボード

不正なデータの本当の影響は、誰かが開くダッシュボードです。**BI ダッシュボード** で、ダッシュボードを読み取れる認証情報とともに BI ツールを追加します。データオブザーバビリティは毎時、各ダッシュボードとその背後のテーブルを読み取り、各テーブルを監視対象のテーブルと照合し、テーブルとそれから構築されるテーブルを基にしたダッシュボードを、その **リネージ** タブ、アラート、Production Review に表示します。

| ツール | 認証情報 |
| --- | --- |
| **Metabase** | `{ "apiKey": "mb_..." }` |
| **Superset** | `{ "username": "...", "password": "..." }` |
| **Tableau** | `{ "tokenName": "...", "tokenSecret": "...", "site": "acme" }` |
| **Looker** | `{ "clientId": "...", "clientSecret": "..." }` |
| **Power BI** | `{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }`, Power BI の管理 API の使用を許可されたサービス プリンシパル |

読み取るのはダッシュボードの名前とリンク、そしてクエリ対象のテーブルだけで、データは決して読み取りません。

## パイプライン

各ジョブ、dbt プロジェクト、同期は、その実行とともに **パイプライン** の下に表示されます: 各実行がいつ始まりいつ終わったか、どれだけかかったか、そして失敗した実行のエラーです。各パイプラインは、5 回の実行の後、自身の実行から、1 回の実行に通常どれだけかかるか、そしてスケジュール上で実行と実行の間がどれだけ空くかを学習します。パイプラインのページは、3 つのモニターを推奨します:

- **Pipeline Run Failed**: 実行が失敗した、または中止された。
- **Pipeline Run Unusually Long**: 実行に通常の 2 倍以上の時間がかかっている。実行中は 5 分ごとにチェックされるので、ハングした実行は終わる前に検知されます。
- **Pipeline Is Late**: スケジュールで許される時間を超えても、実行が始まっていない。

## 原因ごとに 1 件のアラート

テーブルが古くなると、そのテーブルから作られるすべてのテーブルも古くなります。データアラートが開く前に、OneUptime はリネージをたどり、そのテーブルやパイプラインの作成元ですでに開いているアラートを探します: 上流のテーブル、それらに書き込むパイプライン、そしてそれらがあるデータベースを、最大 5 段階さかのぼります。見つかった場合、新しいアラートはそのアラートの結果になります:

- 最初から **確認済み** の状態で始まるので、1 つの問題で誰かが 2 回呼び出されることはありません。データが回復すると、アラートも自動で回復します。
- そのフィードと **データ** カードに、どのアラートが原因かが示され、アラートは原因のエピソードに加わります。

原因の **データ** カードには、その **Downstream Impact** が一覧されます: それが引き起こしたすべてのアラートです。テーブルアラートのカードには、そのテーブルに書き込むサービスも、その失敗した書き込み、そしてアラートまでの 1 日間のデプロイやその他の変更とともに表示されます。

## 次のステップ

:::cards
- [データプロダクト](/docs/data-observability/data-products): 人が使うテーブルに対する鮮度 SLA。
- [OneUptime AI と API](/docs/data-observability/ai-and-api): テーブルの書き込み元と実行から始まる調査。
:::
