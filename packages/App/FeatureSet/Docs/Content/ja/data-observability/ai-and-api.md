# OneUptime AI と API

OneUptime AI はデータを知っています: テーブルの書き込み元、実行、上流のテーブルからデータアラートを調査し、どこで尋ねられてもテーブルが新しいかどうかに答え、1 文で述べたルールからチェックを作成します。データオブザーバビリティが表示するものはすべて、そのエンドポイント、メトリクス、MCP サーバーを通じて、独自のツールからも利用できます。

## OneUptime AI

- **データアラートの調査。** OneUptime AI がテーブル、パイプライン、データベースのアラートを調査するときは、その周辺から始めます: テーブルの鮮度と開いているアラート、そのアラートを引き起こした元のアラート、前日以降にそのテーブルに書き込んだパイプラインの実行 (エラー付きの失敗した実行や、来なかった実行)、そのテーブルに書き込むサービスとその失敗した書き込み、デプロイ、その他の変更、そしてそのテーブルの作成元のテーブルです。アラートの背後にある実行、デプロイ、上流のテーブルを特定します。 [AI SRE](/docs/ai/ai-sre) を参照してください。
- **このテーブルは新しい？** [AI に質問](/docs/ai/ask-ai)、Slack、Microsoft Teams で「orders テーブルは新しい？」と尋ねてください。回答には、テーブル自身のリズムに基づく鮮度、最後に変更された日時、開いているアラート、書き込み元の最新の実行、そしてそのテーブルが属するデータプロダクトが含まれます。複数のデータベースが同じ名前を持つ場合はそれぞれについて答えるので、間違ったテーブルが新しいと伝えられることはありません。
- **1 文からのチェック。** テーブルの **チェック** タブで **文からチェックを作成** を使うと、ルールを、エンジンの SQL によるカスタム SQL チェックに変換できます。 [チェックと照合](/docs/data-observability/checks) を参照してください。

どれも、プロジェクトで OneUptime AI がオンになっている必要があり、尋ねた人の権限で動作します。

## AI エージェントと MCP サーバー

AI エージェントは、データを使う前に、それが新しいことを確認するべきです。 [MCP サーバー](/docs/ai/mcp-server) には、そのための読み取り専用のツールがあります:

| ツール | 答える内容 |
| --- | --- |
| `get_data_table_freshness` | 監視対象のテーブルが新しいかどうか、最後に変更された日時、開いているアラート、書き込み元の最新の実行、そしてデータプロダクト。 `table` には `schema.table`、テーブル名だけ、またはその ID を指定します |

読み取り専用のサインインで動作し、サインインした人または API キーとして答えます。

## エンドポイント

| エンドポイント | 用途 | 署名に使うもの |
| --- | --- | --- |
| `POST /telemetry/openlineage/api/v1/lineage` | Airflow、Dagster、Spark、dbt、Flink からの OpenLineage のイベント | テレメトリの取り込みキー |
| `POST /telemetry/dbt/v1/artifacts` | dbt のビルドの `manifest` と `run_results` | テレメトリの取り込みキー |
| `POST /telemetry/fivetran/v1/webhook/<ingestion key ID>` | Fivetran の同期の Webhook | Fivetran の署名シークレットとしての取り込みキー |
| `POST /telemetry/airbyte/v1/webhook/<ingestion key>` | Airbyte の同期の Webhook | URL に含めた取り込みキー |
| `POST /api/data-observability/tables/freshness` | MCP ツールが答えるのと同じ、テーブルの鮮度。 `{ "table": "public.orders" }` を送ります | API キー |
| `GET /api/data-observability/data-products/<data product ID>/badge?token=<badge token>` | データプロダクトの「data as of」バッジ | バッジ専用のトークン |

テーブル、チェック、照合、パイプライン、データプロダクトは、 [API](/docs/api-reference/api-reference) の通常のリソースでもあり、対応する権限を持つ API キーで読み取りや変更ができます。

## メトリクス

データオブザーバビリティが保持するすべての数値はメトリクスであり、グラフにしたり、ダッシュボードに置いたり、アラートを設定したりできます: 各テーブルの `oneuptime.data.table.*`、各チェックの `oneuptime.data.check.value`、各照合の `oneuptime.data.reconciliation.*`、各パイプラインの `oneuptime.data.pipeline.*`、各データプロダクトの `oneuptime.data.product.*` です。これらは OneUptime 自身の運用データであり、テレメトリとして課金されません。

## 次のステップ

:::cards
- [MCP サーバー](/docs/ai/mcp-server): AI エージェントを OneUptime に接続します。
- [データオブザーバビリティ](/docs/data-observability/index): 概要に戻ります。
:::
