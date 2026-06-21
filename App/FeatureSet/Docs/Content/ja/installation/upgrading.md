# OneUptime のアップグレード

このガイドでは、セルフホスト版 OneUptime インストールを安全にアップグレードする方法について説明します。

## 一般的なガイダンス

- メジャーバージョンを段階的にアップグレードします（例: 6 → 7 → 8）。メジャーバージョンをスキップしないでください。
- リリースノートに従う限り、マイナーバージョンやパッチバージョンはスキップできます（例: 8.1 → 8.4）。
- アップグレード前に必ずバックアップを取り、復元できることを確認してください。

## OneUptime 10 → 11 へのアップグレード

OneUptime 11 は ClickHouse のテレメトリーストレージを再構築します。このページでは、何が変わるのか、誰が対応する必要があるのか、そして過去のテレメトリーを引き継ぎたいインストール環境向けに、そのために必要なすべてのクエリを説明します。

### v11 で変わること

テレメトリー(ログ、トレース、メトリクス、例外、プロファイル、モニターログ、監査ログ)は、時間ベースのパーティショニング、列ごとの圧縮コーデック、新しいエンティティモデル列を備えた新しい ClickHouse テーブルへ移行します:

| 旧テーブル            | 新テーブル            |
| --------------------- | --------------------- |
| `LogItemV2`           | `LogItemV3`           |
| `MetricItemV2`        | `MetricItemV3`        |
| `SpanItemV2`          | `SpanItemV3`          |
| `ExceptionItemV2`     | `ExceptionItemV3`     |
| `ProfileItemV2`       | `ProfileItemV3`       |
| `ProfileSampleItemV2` | `ProfileSampleItemV3` |
| `MonitorLogV2`        | `MonitorLogV3`        |
| `AuditLogV1`          | `AuditLogV2`          |

すべてのテレメトリーテーブルで 2 つの列名が変更されます: `serviceId` → `primaryEntityId`、`serviceType` → `primaryEntityType`。これは厳格なリネームです — **OneUptime の analytics API を `serviceId`/`serviceType` フィルターで直接クエリしている場合は、新しい名前に更新してください。** OneUptime 内のダッシュボード、モニター、アラートは自動的に移行されます。

この切り替えは**前方専用**です: 新しいテーブルは空の状態で始まり、アップグレード後に取り込まれたテレメトリーはすぐにそこへ入り、履歴は時間の経過とともに自然に埋まっていきます。古いテーブルはディスクを解放するため、アップグレード中に**自動的に削除されます** — 履歴を引き継ぐ選択肢を残したい場合は、アップグレードの**前に**リネームしてください(下記の Step 0)。

> **すでに 11.0.0 または 11.0.1 をお使いですか?** これらのリリースでは古いテーブルは保持されていました(TTL によって徐々に空になり、コピーは「アップグレード後いつでも」実行できました)。それ以降のアップデートは**起動時にそれらを削除します**。履歴のコピーをまだ実行しておらず、これから行いたい場合は、アップデートを適用する前に下記の Step 0 を実行してください。

### 対応が必要なのは誰か

- **新規インストール:** 何もする必要はありません。
- **アップグレード前のテレメトリーを UI で見る必要がないアップグレード:** 何もする必要はありません。テレメトリーページはアップグレード時点以降のデータを表示するだけです。古いテーブルはアップグレード中に削除されます。
- **アップグレード前のテレメトリーを表示したいアップグレード:** アップグレードの**前に**古いテーブルをリネームし(下記の Step 0)、その後いつでも手動コピーを実行してください。

いつもどおり、メジャーバージョンは一つずつアップグレードし(10 → 11、飛ばさない)、アップグレード前に Postgres と ClickHouse のバックアップを取ってください。

### オプション: テレメトリー履歴の引き継ぎ

Step 0 は**アップグレード前**に実行します。Step 1 以降はすべて、**アップグレードが完全に起動した後**に実行します(新しいテーブルとそのマテリアライズドビューが存在している必要があります)。ClickHouse ホスト上で直接接続してください — ネイティブプロトコルには HTTP タイムアウトがないため、数時間かかるステートメントでも問題ありません:

```bash
clickhouse-client --database oneuptime
```

始める前に知っておくべきこと:

- コピーは OneUptime が稼働中でも安全に実行できます。新しいテレメトリーは独立して新しいテーブルに書き込まれ、コピーされた履歴はその背後で埋まっていきます。
- 大規模環境(数百 GB)では数時間かかると見込んでください。
- 以下の各ステートメントは `insert_deduplication_token` を持ち、新しいテーブルには重複排除ウィンドウが備わっています — そのため**途中で失敗したステートメントの再実行は安全です**(挿入済みのブロックはメトリクスのロールアップも含めてスキップされます)。ただし、それなりに早く再実行することが条件です。激しいライブ取り込みの下では、ウィンドウ(テーブルごとの直近 10,000 挿入ブロック)が最終的に古いトークンを追い出します。
- メトリクスのコピーは、事前集計されたダッシュボードのロールアップも自動的に再構築します(コピーされた各行がロールアップのマテリアライズドビューに再供給されます)— このためメトリクスのコピーは他より遅くなります。最後に実行してください。

#### Step 0 — アップグレード前に古いテーブルをリネームする

アップグレードは起動時に古いテーブルを削除するため、コピー元にしたいテーブルを先にその手の届かない場所へ移します。OneUptime を停止し(デプロイメントをゼロにスケール)、何もテーブルへ書き込んだり再作成したりできない状態にしてからリネームします — `RENAME TABLE` は瞬時のメタデータ操作で、`IF EXISTS` によりお使いの環境に存在しなかったテーブルはスキップされます(10.0.x 中盤より古いデプロイメントには `AuditLogV1` や一部の `…V2` テーブルがない場合があります — その場合、そのタイプのコピーすべき履歴は存在しません):

```sql
RENAME TABLE IF EXISTS LogItemV2 TO LogItemV2_backup;
RENAME TABLE IF EXISTS MetricItemV2 TO MetricItemV2_backup;
RENAME TABLE IF EXISTS SpanItemV2 TO SpanItemV2_backup;
RENAME TABLE IF EXISTS ExceptionItemV2 TO ExceptionItemV2_backup;
RENAME TABLE IF EXISTS ProfileItemV2 TO ProfileItemV2_backup;
RENAME TABLE IF EXISTS ProfileSampleItemV2 TO ProfileSampleItemV2_backup;
RENAME TABLE IF EXISTS MonitorLogV2 TO MonitorLogV2_backup;
RENAME TABLE IF EXISTS AuditLogV1 TO AuditLogV1_backup;
RENAME TABLE IF EXISTS MetricItemAggMV1mByHost TO MetricItemAggMV1mByHost_backup;
```

その後アップグレードし、続行する前に OneUptime が完全に起動するのを待ちます。

> リネーム後に v10 へロールバックする場合(v10 は起動時に旧名の空テーブルを再作成します)、v10 を再起動する前に `_backup` テーブルを元の名前に戻してください — そうしないと、ロールバック中に取り込まれたテレメトリーが再作成されたテーブルに入り、その後のアップグレードで削除されてしまいます。

#### Step 1 — コピー元のパーティションを列挙する

各旧テーブルのパーティションは最大 16 個です。各コピー元テーブルについて:

```sql
SELECT DISTINCT _partition_id FROM LogItemV2_backup ORDER BY _partition_id;
```

#### Step 2 — コピーステートメントを生成する

列の構成はインストール環境によって若干異なる場合があります(古いデプロイメントには最近追加された列がないことがあります)。固定のステートメントを貼り付けるのではなく、実際のスキーマからステートメントを生成してください。`WITH` 句の `src` と `dst` を上の表のテーブルペアのいずれかに設定し(コピー元には Step 0 の `_backup` サフィックスが付きます)、実行します:

```sql
WITH 'LogItemV2_backup' AS src, 'LogItemV3' AS dst
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

生成されたステートメントは、両テーブルが共有する列のみをコピーし(新しい列はデフォルト値になります)、`serviceId`/`serviceType` をその場でリネームし、再実行時に同一の重複排除可能なブロックが生成されるよう行を決定論的に並べ、このサイズのステートメントに必要な実行時間とパーティション数の制限を解除します。

#### Step 3 — パーティションごとに 1 つずつ実行する

生成されたステートメントの `{PARTITION}`(`WHERE` 内とトークン内の 2 か所に登場)を Step 1 の各パーティション ID に置き換えます。ステートメントを 1 つずつ実行し、その後テーブルペアごとに Step 1–3 を繰り返します。

> 注意: コピー元テーブルがお使いの環境に存在せず Step 0 でスキップされた場合、そのペアの Step 1 は `UNKNOWN_TABLE` で失敗します — そのペアは単にスキップしてください。そのタイプのコピーすべき履歴は存在しません。

ステートメントが途中で失敗した場合は、速やかに**同じ**ステートメントを再実行してください — コミット済みのブロックは重複排除されます。かなり後になってから再実行する場合は、先に行数を比較してください(Step 5)。

#### Step 4(オプション)— ホスト別メトリクスロールアップの履歴

コピーされた生のメトリクス行はサービスレベルのロールアップを自動的に再構築しますが、**ホスト別**ロールアップは再構築しません(古い行にはホストエンティティキーがありません)。Step 0 でリネームした古いロールアップテーブルがこの履歴の唯一のソースです。ホスト名から新しいキーを計算して引き継ぎます:

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
FROM MetricItemAggMV1mByHost_backup
ORDER BY projectId, name, hostIdentifier, bucketTime, _id
SETTINGS max_execution_time = 0, insert_deduplication_token = 'v3copy:MetricItemAggMV1mByHostV2:all';
```

`ORDER BY` は重要です: 再実行時に重複排除トークンが認識できる同一の挿入ブロックを生成します。これがないと、再実行が静かにスキップされたり二重にカウントされたりする可能性があります。(エッジケース: `\`、`|`、`=` を含むホスト名 — RFC 1123 で許可されないホスト名文字 — はアプリケーションと異なるキーを計算します。そのようなホストがあると分かっている場合を除き、無視してください。)

#### Step 5 — 検証する

テーブルペアごとに合計を比較します(新しいテーブルにはアップグレード後の行も含まれるため、古いテーブル以上になるはずです):

```sql
SELECT
  (SELECT count() FROM LogItemV2_backup) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### Step 6 — バックアップを削除する

リネームされたテーブルは保持期間の TTL を維持するため、自然に空になり縮小していきます — ただしコピーに満足したら、削除してディスクをすぐに解放してください:

```sql
DROP TABLE IF EXISTS LogItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MetricItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS SpanItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ExceptionItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ProfileItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ProfileSampleItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MonitorLogV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS AuditLogV1_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MetricItemAggMV1mByHost_backup SETTINGS max_table_size_to_drop = 0;
```

(`max_table_size_to_drop = 0` は、そのステートメントに限りサーバーの 50 GB 削除保護を解除します。)

> ヒント: 他のメジャーアップグレードと同様、まずステージング環境でテストし、本番でコピーに依存する前にテレメトリーが新しいテーブルへ流れていることを確認してください。


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
