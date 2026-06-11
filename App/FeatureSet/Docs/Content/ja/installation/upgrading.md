# OneUptime のアップグレード

このガイドでは、セルフホスト版 OneUptime インストールを安全にアップグレードする方法について説明します。

## 一般的なガイダンス

- メジャーバージョンを段階的にアップグレードします（例: 6 → 7 → 8）。メジャーバージョンをスキップしないでください。
- リリースノートに従う限り、マイナーバージョンやパッチバージョンはスキップできます（例: 8.1 → 8.4）。
- アップグレード前に必ずバックアップを取り、復元できることを確認してください。

## OneUptime 10 → 11 へのアップグレード

OneUptime 11 では ClickHouse のテレメトリーストレージが再構築されます。このページでは、何が変わるのか、誰が対応する必要があるのか、そして過去のテレメトリーデータを引き継ぎたいインストール環境向けに、そのために必要なすべてのクエリを説明します。

### v11 での変更点

テレメトリー（ログ、トレース、メトリクス、例外、プロファイル、モニターログ、監査ログ）は、時間ベースのパーティショニング、列ごとの圧縮コーデック、新しいエンティティモデル列を備えた新しい ClickHouse テーブルに移行します。

| 旧テーブル             | 新テーブル             |
| --------------------- | --------------------- |
| `LogItemV2`           | `LogItemV3`           |
| `MetricItemV2`        | `MetricItemV3`        |
| `SpanItemV2`          | `SpanItemV3`          |
| `ExceptionItemV2`     | `ExceptionItemV3`     |
| `ProfileItemV2`       | `ProfileItemV3`       |
| `ProfileSampleItemV2` | `ProfileSampleItemV3` |
| `MonitorLogV2`        | `MonitorLogV3`        |
| `AuditLogV1`          | `AuditLogV2`          |

すべてのテレメトリーテーブルで 2 つの列名が変更されます: `serviceId` → `primaryEntityId` および `serviceType` → `primaryEntityType`。これは後方互換性のないリネームです — **OneUptime の分析 API を `serviceId`/`serviceType` フィルターで直接クエリしている場合は、新しい列名に更新してください。** OneUptime 内のダッシュボード、モニター、アラートは自動的に移行されます。

この切り替えは**前方のみ（forward-only）**です。新しいテーブルは空の状態で始まり、アップグレード後に取り込まれたすべてのテレメトリーは即座に新テーブルに書き込まれ、履歴は時間の経過とともに自然に埋まっていきます。旧テーブルは保持され、保持期間の TTL によって徐々に自動削除されていきます。

### 対応が必要なケース

- **新規インストール:** 対応は不要です。
- **アップグレード前のテレメトリーを UI に表示する必要がないアップグレード:** 対応は不要です。テレメトリーページにはアップグレード時点以降のデータのみが表示され、古いデータは表示されないまま旧テーブルから期限切れで消えていきます。
- **アップグレード前のテレメトリーを表示したいアップグレード:** アップグレード後の任意のタイミングで、以下の手動コピーを実行してください。

これまでどおり、メジャーバージョンは段階的にアップグレードし（10 → 11 のようにスキップせず）、アップグレード前に Postgres と ClickHouse のバックアップを取ってください。

### オプション: テレメトリー履歴の引き継ぎ

以下は**アップグレードが完全に起動した後**に実行してください（新しいテーブルとそのマテリアライズドビューが存在している必要があります）。ClickHouse ホスト上で直接接続してください — ネイティブプロトコルには HTTP のタイムアウトがないため、数時間かかるステートメントでも問題ありません。

```bash
clickhouse-client --database oneuptime
```

開始前に知っておくべきこと:

- このコピーは OneUptime の稼働中でも安全に実行できます。新しいテレメトリーは独立して新テーブルに書き込まれ、コピーされた履歴はその背後で埋まっていきます。
- 大規模な環境（数百 GB）では数時間かかることを見込んでください。
- 以下の各ステートメントには `insert_deduplication_token` が付与されており、新しいテーブルには重複排除ウィンドウが備わっています。そのため、**途中で失敗したステートメントの再実行は安全です**（メトリクスのロールアップを含め、挿入済みのブロックはスキップされます）。ただし、合理的に早いうちに再実行することが前提です。ライブインジェストの負荷が高い場合、ウィンドウ（テーブルごとに直近 10,000 挿入ブロック）から古いトークンが最終的に追い出されます。
- メトリクスをコピーすると、事前集計されたダッシュボード用ロールアップも自動的に再構築されます（コピーされた各行がロールアップのマテリアライズドビューに再投入されます）。このためメトリクスのコピーは他よりも時間がかかるので、最後に実行してください。

#### ステップ 1 — ソースパーティションの一覧取得

各旧テーブルのパーティション数は最大 16 です。各ソーステーブルに対して次を実行します。

```sql
SELECT DISTINCT _partition_id FROM LogItemV2 ORDER BY _partition_id;
```

#### ステップ 2 — コピーステートメントの生成

列の構成はインストール環境によってわずかに異なる場合があります（古いデプロイメントでは最近追加された列が存在しないことがあります）。そのため、固定のステートメントをコピー＆ペーストするのではなく、稼働中のスキーマからステートメントを生成してください。`WITH` 句の `src` と `dst` を上記の表のテーブルペアのいずれかに設定し、次を実行します。

```sql
WITH 'LogItemV2' AS src, 'LogItemV3' AS dst
SELECT concat(
  'INSERT INTO ', dst, ' (`', arrayStringConcat(groupArray(name), '`, `'), '`)',
  ' SELECT ', arrayStringConcat(groupArray(selectExpr), ', '),
  ' FROM ', src,
  ' WHERE _partition_id = ''{PARTITION}''',
  ' ORDER BY ', (SELECT sorting_key FROM system.tables WHERE database = currentDatabase() AND name = dst), ', _id',
  ' SETTINGS max_execution_time = 0, max_partitions_per_insert_block = 0, insert_deduplication_token = ''v3copy:', dst, ':{PARTITION}'', deduplicate_blocks_in_dependent_materialized_views = 1'
) AS copy_sql
FROM (
  SELECT name,
    multiIf(name = 'primaryEntityId', 'serviceId', name = 'primaryEntityType', 'serviceType', name) AS srcName,
    if(srcName = name, concat('`', name, '`'), concat('`', srcName, '` AS `', name, '`')) AS selectExpr,
    position
  FROM system.columns
  WHERE database = currentDatabase() AND table = dst
    AND srcName IN (SELECT name FROM system.columns WHERE database = currentDatabase() AND table = src)
  ORDER BY position
);
```

生成されたステートメントは、両テーブルが共有する列のみをコピーし（新しい列はデフォルト値になります）、`serviceId`/`serviceType` を実行時にリネームし、再試行時に同一の重複排除可能なブロックが生成されるよう行を決定的に並べ替え、この規模のステートメントに必要となる実行時間とパーティション数の制限を解除します。

#### ステップ 3 — パーティションごとに 1 つずつ実行

生成されたステートメントの `{PARTITION}`（`WHERE` 句とトークン内の 2 か所に現れます）を、ステップ 1 で取得した各パーティション ID に置き換えます。ステートメントを 1 つずつ実行し、各テーブルペアについてステップ 1〜3 を繰り返します。

ステートメントが途中で失敗した場合は、**同じ**ステートメントを速やかに再実行してください — コミット済みのブロックは重複排除されます。かなり時間が経ってから再実行する場合は、先に行数を比較してください（ステップ 5）。

#### ステップ 4（オプション） — ホスト単位のメトリクスロールアップ履歴

コピーされた生のメトリクス行はサービスレベルのロールアップを自動的に再構築しますが、**ホスト単位**のロールアップは再構築されません（旧テーブルの行にはホストのエンティティキーがないためです）。アップグレードでは旧のホスト単位ロールアップテーブルを意図的に残してあるため、ホスト名から新しいキーを計算して引き継ぐことができます。

```sql
INSERT INTO MetricItemAggMV1mByHostV2 (projectId, name, hostEntityKey, bucketTime, valueSumState, valueCountState, valueMinState, valueMaxState, retentionDate)
SELECT
  projectId,
  name,
  substring(lower(hex(SHA256(concat(projectId, '|host|host.name=', lower(trimBoth(hostIdentifier)))))), 1, 16) AS hostEntityKey,
  bucketTime,
  valueSumState,
  valueCountState,
  valueMinState,
  valueMaxState,
  retentionDate
FROM MetricItemAggMV1mByHost
SETTINGS max_execution_time = 0, insert_deduplication_token = 'v3copy:MetricItemAggMV1mByHostV2:all';
```

#### ステップ 5 — 検証

テーブルペアごとに合計行数を比較します（新テーブルにはアップグレード後の行も含まれるため、旧テーブル以上の行数になるはずです）。

```sql
SELECT
  (SELECT count() FROM LogItemV2) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### ステップ 6（オプション） — ディスク領域の早期回収

旧テーブルは TTL によって自動的に縮小していきますが、コピーの結果に問題がないことを確認できたら、すぐに削除しても構いません。

```sql
DROP TABLE IF EXISTS LogItemV2;
DROP TABLE IF EXISTS MetricItemV2;
DROP TABLE IF EXISTS SpanItemV2;
DROP TABLE IF EXISTS ExceptionItemV2;
DROP TABLE IF EXISTS ProfileItemV2;
DROP TABLE IF EXISTS ProfileSampleItemV2;
DROP TABLE IF EXISTS MonitorLogV2;
DROP TABLE IF EXISTS AuditLogV1;
DROP TABLE IF EXISTS MetricItemAggMV1mByHost;
```

> ヒント: すべてのメジャーアップグレードと同様に、まずステージング環境でテストし、本番環境でコピーに依存する前に、テレメトリーが新しいテーブルに流れ込んでいることを確認してください。



## OneUptime 9 → 10 へのアップグレード

手動の対応が必要な変更はありません。標準のアップグレード手順に従ってください。

## OneUptime 8 → 9 へのアップグレード

Helm チャートで Kubernetes Ingress リソースのプロビジョニングが不要になりました。OneUptime は TLS の終端、ステータスページドメインの管理、プラットフォームのトラフィックルーティングをすでに処理する Ingress ゲートウェイコンテナを含んでいるため、クラスター Ingress コントローラーは不要になりました。

- アップグレード前に、カスタムの `values.yaml` ファイルから `oneuptimeIngress` のオーバーライドを削除してください。これらのキーは無視されるようになり、残っている場合は検証エラーが発生します。
- `nginx.service.type` が、バンドルされた Ingress ゲートウェイを公開する方法を反映していることを確認してください（例: `LoadBalancer`、`NodePort`、または外部ロードバランサーを持つ `ClusterIP`）。
- ステータスページまたはプライマリホストの DNS レコードが、OneUptime Ingress ゲートウェイの前面にあるサービスまたはロードバランサーを引き続き指していることを確認してください。
- アップグレード後、TLS 証明書が組み込みゲートウェイ経由で更新され続け、ステータスページのドメインが正しく解決されることを確認してください。


## OneUptime 7 → 8 へのアップグレード

Kubernetes で実行している場合、重要な破壊的変更があります。

- [Bitnami ライセンス変更](https://github.com/bitnami/charts/issues/35164) のため、Postgres、Redis、ClickHouse に Bitnami チャートを使用しなくなりました
- これらの変更は後方互換性がありません。Helm チャートの `values.yaml` の新しい構造に従う必要があります。
- アップグレード前にデータ（Postgres、ClickHouse、および永続ボリューム）をバックアップしてください。


> ヒント: まずステージング環境でアップグレードをテストしてください。本番環境をアップグレードする前に、ワークロードが正常であり、データが完全であることを確認してください。
