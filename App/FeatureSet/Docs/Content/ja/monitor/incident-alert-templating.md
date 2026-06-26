# インシデント・アラートの動的テンプレート

JavaScriptエクスプレッションの監視条件と同じ `{{variable}}` プレースホルダー構文を使用して、モニター条件から自動作成されるインシデントおよびアラートのタイトル、説明、修復メモを動的に設定できます。

## サポートされるモニタータイプと変数

以下のモニタータイプが、それぞれの変数による動的テンプレートをサポートしています。

- **ウェブサイト・APIモニター**：レスポンスデータ、ヘッダー、ステータスコード、タイミング
- **受信リクエストモニター**：リクエストデータ、ヘッダー、メソッド、タイミング
- **Pingモニター**：接続ステータス、レスポンスタイム、障害原因
- **ポートモニター**：ポート接続性、レスポンスタイム、タイムアウトステータス
- **IPモニター**：IPの到達可能性、Pingタイム、障害情報
- **SSL証明書モニター**：証明書の詳細、検証ステータス、有効期限情報
- **サーバー/VMモニター**：システムメトリクス（CPU、メモリ、ディスク）、プロセス、ホスト名
- **合成モニター**：スクリプト実行結果、スクリーンショット、ブラウザの詳細
- **カスタムJavaScriptコードモニター**：実行結果、タイミング、エラーメッセージ
- **SNMPモニター**：デバイスステータス、レスポンスタイム、OID値

> **注意**：ログ、トレース、メトリクスモニターは、異なるトリガーメカニズムを使用するため、現在インシデント/アラートテンプレートをサポートしていません。

## サポートされるモニタータイプと変数

### ウェブサイト・APIモニター

| 変数                 | 説明                                                                                 | 型                     |
| -------------------- | ------------------------------------------------------------------------------------ | ---------------------- |
| `responseBody`       | レスポンスボディオブジェクト。HTML/XMLの場合は文字列、JSONの場合はJSONオブジェクト。 | `string` または `JSON` |
| `responseHeaders`    | レスポンスヘッダーオブジェクト（キーは小文字）。                                     | `Dictionary<string>`   |
| `responseStatusCode` | HTTPレスポンスステータスコード。                                                     | `number`               |
| `responseTimeInMs`   | レスポンスタイム（ミリ秒）。                                                         | `number`               |
| `isOnline`           | モニターがオンラインと判定されているか。                                             | `boolean`              |

### 受信リクエストモニター

| 変数                        | 説明                                             | 型                     |
| --------------------------- | ------------------------------------------------ | ---------------------- |
| `requestBody`               | リクエストボディオブジェクト。                   | `string` または `JSON` |
| `requestHeaders`            | リクエストヘッダーオブジェクト（キーは小文字）。 | `Dictionary<string>`   |
| `requestMethod`             | 受信リクエストのHTTPメソッド（GET、POSTなど）。  | `string`               |
| `incomingRequestReceivedAt` | 受信リクエストを受け取った日時。                 | `Date`                 |

### Pingモニター

| 変数               | 説明                                           | 型        |
| ------------------ | ---------------------------------------------- | --------- |
| `isOnline`         | Pingターゲットがオンラインと判定されているか。 | `boolean` |
| `responseTimeInMs` | Pingのレスポンスタイム（ミリ秒）。             | `number`  |
| `failureCause`     | Pingが失敗した場合の原因。                     | `string`  |
| `isTimeout`        | Pingリクエストがタイムアウトしたか。           | `boolean` |

### ポートモニター

| 変数               | 説明                                                | 型        |
| ------------------ | --------------------------------------------------- | --------- |
| `isOnline`         | ポートがオンライン/アクセス可能と判定されているか。 | `boolean` |
| `responseTimeInMs` | 接続のレスポンスタイム（ミリ秒）。                  | `number`  |
| `failureCause`     | ポートチェックが失敗した場合の原因。                | `string`  |
| `isTimeout`        | ポート接続がタイムアウトしたか。                    | `boolean` |

### IPモニター

| 変数               | 説明                                       | 型        |
| ------------------ | ------------------------------------------ | --------- |
| `isOnline`         | IPアドレスがオンラインと判定されているか。 | `boolean` |
| `responseTimeInMs` | Pingのレスポンスタイム（ミリ秒）。         | `number`  |
| `failureCause`     | IPチェックが失敗した場合の原因。           | `string`  |
| `isTimeout`        | IP Pingリクエストがタイムアウトしたか。    | `boolean` |

### SSL証明書モニター

| 変数                 | 説明                                | 型        |
| -------------------- | ----------------------------------- | --------- |
| `isOnline`           | SSL証明書チェックが成功したか。     | `boolean` |
| `isSelfSigned`       | SSL証明書が自己署名であるか。       | `boolean` |
| `createdAt`          | SSL証明書が作成された日付。         | `Date`    |
| `expiresAt`          | SSL証明書の有効期限日。             | `Date`    |
| `commonName`         | 証明書のコモンネーム（CN）。        | `string`  |
| `organizationalUnit` | 証明書の組織単位（OU）。            | `string`  |
| `organization`       | 証明書の組織（O）。                 | `string`  |
| `locality`           | 証明書の地域（L）。                 | `string`  |
| `state`              | 証明書の都道府県（ST）。            | `string`  |
| `country`            | 証明書の国（C）。                   | `string`  |
| `serialNumber`       | 証明書のシリアル番号。              | `string`  |
| `fingerprint`        | 証明書のSHA-1フィンガープリント。   | `string`  |
| `fingerprint256`     | 証明書のSHA-256フィンガープリント。 | `string`  |
| `failureCause`       | SSLチェックが失敗した場合の原因。   | `string`  |

### サーバー/VMモニター

| 変数                         | 説明                                               | 型              |
| ---------------------------- | -------------------------------------------------- | --------------- |
| `hostname`                   | 監視対象サーバーのホスト名。                       | `string`        |
| `requestReceivedAt`          | サーバーモニターリクエストを受け取った日時。       | `Date`          |
| `cpuUsagePercent`            | CPU使用率（パーセント）。                          | `number`        |
| `cpuCores`                   | CPUコア数。                                        | `number`        |
| `memoryUsagePercent`         | メモリ使用率（パーセント）。                       | `number`        |
| `memoryFreePercent`          | メモリ空き率（パーセント）。                       | `number`        |
| `memoryTotalBytes`           | 合計メモリ（バイト）。                             | `number`        |
| `diskMetrics`                | すべてのマウント済みディスクのメトリクス配列。     | `Array<Object>` |
| `diskMetrics[].diskPath`     | ディスクマウントポイントのパス。                   | `string`        |
| `diskMetrics[].usagePercent` | このマウントポイントのディスク使用率。             | `number`        |
| `diskMetrics[].freePercent`  | このマウントポイントのディスク空き率。             | `number`        |
| `diskMetrics[].totalBytes`   | このマウントポイントの合計ディスク容量（バイト）。 | `number`        |
| `processes`                  | サーバーで実行中のプロセス配列。                   | `Array<Object>` |
| `processes[].pid`            | プロセスID。                                       | `number`        |
| `processes[].name`           | プロセス名。                                       | `string`        |
| `processes[].command`        | プロセスを起動したコマンド。                       | `string`        |
| `failureCause`               | サーバーチェックが失敗した場合の原因。             | `string`        |

### 合成モニター

合成モニターは複数のブラウザ（Chromium、Firefox、Webkit）と画面サイズ（モバイル、タブレット、デスクトップ）でスクリプトを実行し、設定ごとに1つのレスポンスを生成します。各実行は `syntheticResponses` 配列を通じてアクセスできます。インデックスで特定の実行にアクセスする（`{{syntheticResponses[0].browserType}}`）か、`{{#each syntheticResponses}}` でイテレートします。

| 変数                                     | 説明                                                                             | 型                                           |
| ---------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------- |
| `failureCause`                           | 合成チェックが失敗した場合の原因。                                               | `string`                                     |
| `syntheticResponses`                     | スクリプトが実行されたブラウザ/画面サイズの組み合わせごとに1エントリを含む配列。 | `Array<Object>`                              |
| `syntheticResponses[].executionTimeInMs` | この実行の実行時間（ミリ秒）。                                                   | `number`                                     |
| `syntheticResponses[].result`            | この実行が返した結果。                                                           | `string`、`number`、`boolean`、または `JSON` |
| `syntheticResponses[].scriptError`       | この実行中に発生したエラー。                                                     | `string`                                     |
| `syntheticResponses[].logMessages`       | この実行中に生成されたログメッセージ。                                           | `Array<string>`                              |
| `syntheticResponses[].screenshots`       | この実行中にキャプチャされたスクリーンショット。                                 | `Object`                                     |
| `syntheticResponses[].browserType`       | この実行に使用されたブラウザ。                                                   | `string`                                     |
| `syntheticResponses[].screenSizeType`    | この実行に使用された画面サイズ。                                                 | `string`                                     |

### カスタムJavaScriptコードモニター

| 変数                | 説明                                           | 型                                           |
| ------------------- | ---------------------------------------------- | -------------------------------------------- |
| `executionTimeInMs` | カスタムコードの実行にかかった時間（ミリ秒）。 | `number`                                     |
| `result`            | カスタムコードが返した結果。                   | `string`、`number`、`boolean`、または `JSON` |
| `scriptError`       | コード実行中に発生したエラー。                 | `string`                                     |
| `logMessages`       | 実行中に生成されたログメッセージの配列。       | `Array<string>`                              |

### SNMPモニター

| 変数                   | 説明                                                         | 型                       |
| ---------------------- | ------------------------------------------------------------ | ------------------------ |
| `isOnline`             | SNMPデバイスがオンラインで応答しているか。                   | `boolean`                |
| `responseTimeInMs`     | SNMPクエリのレスポンスタイム（ミリ秒）。                     | `number`                 |
| `failureCause`         | SNMPクエリが失敗した場合の原因。                             | `string`                 |
| `isTimeout`            | SNMPクエリがタイムアウトしたか。                             | `boolean`                |
| `oidResponses`         | OID、名前、値、タイプを持つOIDレスポンスオブジェクトの配列。 | `Array<Object>`          |
| `oidResponses[].oid`   | 照会されたOID。                                              | `string`                 |
| `oidResponses[].name`  | OIDのフレンドリーネーム（指定されている場合）。              | `string`                 |
| `oidResponses[].value` | OIDが返した値。                                              | `string` または `number` |
| `oidResponses[].type`  | 値のSNMPデータ型。                                           | `string`                 |
| `{{OID_NAME}}`         | 名前でOID値に直接アクセス（例：`{{sysUpTime}}`）。           | `string` または `number` |

## 基本的な使用方法

モニター条件インスタンス内のインシデント/アラートフォームで、以下のように記述できます。

```
APIは{{responseTimeInMs}}ミリ秒で{{responseStatusCode}}を返しました
```

モニターのレスポンスステータスコードが `502`、タイムが `842` の場合、保存されるタイトルは次のようになります。

```
APIは842ミリ秒で502を返しました
```

ネストされたJSONアクセスはJavaScriptエクスプレッションと同じように機能します。

```
問題ID: {{responseBody.error.id}}
メッセージ: {{responseBody.error.message}}
```

配列インデックスもサポートされています。

```
最初のユーザー: {{responseBody.users[0].name}}
```

パスが存在しない場合、デフォルトで空文字列として解決されます。

## 高度な使用方法

### 配列要素へのアクセス

```
最初のディスク使用率: {{diskMetrics[0].usagePercent}}%
最後のプロセス: {{processes[-1].name}}
```

### ネストされたオブジェクトへのアクセス

```
エラーメッセージ: {{responseBody.error.details.message}}
サーバーの場所: {{sslCertificate.locality}} {{sslCertificate.country}}
```

### `{{#each}}` を使った配列のループ処理

`{{#each path}}...{{/each}}` ブロック構文を使ってデータに含まれるリストの各アイテムをインシデントやアラートの説明に含めることができます。

**構文：**

```
{{#each arrayPath}}
  ...各要素の{{property}}を使った本文...
{{/each}}
```

ループ本文内：

- `{{propertyName}}` は現在の配列要素を基準に解決されます
- `{{nested.property}}` のドット記法は現在の要素で機能します
- `{{@index}}` は現在のイテレーションの0始まりのインデックスとして解決されます
- `{{this}}` は現在の要素の値として解決されます（文字列/数値の配列で有用）
- 現在の要素に見つからない変数は親のストレージマップにフォールバックします

**例 — アラート配列を含む受信リクエスト（Grafanaウェブフックなど）：**

受信リクエストのボディが以下の場合：

```json
{
  "status": "firing",
  "alerts": [
    { "status": "firing", "labels": { "label": "Coralpay" } },
    { "status": "firing", "labels": { "label": "capitecpay" } },
    { "status": "resolved", "labels": { "label": "capricorn" } }
  ]
}
```

次のようなテンプレートを記述できます：

```
アラートラベル:
{{#each requestBody.alerts}}
- {{labels.label}} ({{status}})
{{/each}}
```

出力結果：

```
アラートラベル:
- Coralpay (firing)
- capitecpay (firing)
- capricorn (resolved)
```

**例 — サーバーのディスクメトリクス：**

```
ディスク使用率:
{{#each diskMetrics}}
- {{diskPath}}: {{usagePercent}}% 使用
{{/each}}
```

**例 — `{{@index}}` の使用：**

```
プロセス:
{{#each processes}}
{{@index}}. {{name}} (PID: {{pid}})
{{/each}}
```

**例 — `{{this}}` を使ったプリミティブ配列：**

```
ログメッセージ:
{{#each logMessages}}
- {{this}}
{{/each}}
```

**例 — ネストされたループ：**

多段階の配列に対して `{{#each}}` ブロックをネストできます：

```
{{#each requestBody.groups}}
グループ: {{name}}
{{#each members}}
  - {{id}}: {{role}}
{{/each}}
{{/each}}
```

> **注意**：パスが配列として解決されない場合、`{{#each}}...{{/each}}` ブロック全体が出力から削除されます。空の配列はブロックの出力を生成しません。

## 使用例

### ウェブサイト/APIモニターのインシデントタイトル

```
高遅延: {{responseTimeInMs}}ms（> しきい値）
```

### ウェブサイト/APIモニターのインシデント説明

```
### APIエラー
ステータス: **{{responseStatusCode}}**
遅延: **{{responseTimeInMs}}ms**
ボディの抜粋: `{{responseBody.error.message}}`
```

### 受信リクエストのアラートタイトル

```
不正な受信リクエスト: method={{requestMethod}} auth={{requestHeaders.authorization}}
```

### SSL証明書のアラートタイトル

```
SSL証明書の有効期限が近づいています: {{commonName}} は {{expiresAt}} に期限切れ
```

### サーバーモニターのアラート説明

```
### サーバーアラート: {{hostname}}
CPU使用率: **{{cpuUsagePercent}}%**
メモリ使用率: **{{memoryUsagePercent}}%**
最初のディスク使用率: **{{diskMetrics[0].usagePercent}}%**
最終確認: {{requestReceivedAt}}
```

### PingモニターのアラートタイトルN

```
ターゲットのPing失敗: {{failureCause}} ({{responseTimeInMs}}ms)
```

### ポートモニターのアラート説明

```
ポート接続の問題
ターゲットポートのステータス: {{isOnline}}
レスポンスタイム: {{responseTimeInMs}}ms
障害の原因: {{failureCause}}
```

### 合成モニターのアラート

インデックスで特定のブラウザ/画面サイズの実行にアクセス：

```
最初の実行: {{syntheticResponses[0].browserType}} / {{syntheticResponses[0].screenSizeType}}
結果: {{syntheticResponses[0].result}} - {{syntheticResponses[0].executionTimeInMs}}ms
```

`{{#each}}` を使ってすべてのブラウザ/画面サイズの組み合わせをイテレート：

```
### 合成モニターの結果
{{#each syntheticResponses}}
- **{{browserType}} / {{screenSizeType}}**: {{result}} - {{executionTimeInMs}}ms
  - スクリプトエラー: {{scriptError}}
  - 最初のログ: {{logMessages[0]}}
{{/each}}
```

### カスタムコードモニターのアラート

```
カスタムコードの実行: {{executionTimeInMs}}ms
ログ出力: {{logMessages[0]}}
```

### SNMPモニターのアラートタイトル

```
SNMPデバイスがオフライン: {{failureCause}} ({{responseTimeInMs}}ms)
```

### SNMPモニターのアラート説明

```
### SNMPデバイスアラート
ステータス: **{{isOnline}}**
レスポンスタイム: **{{responseTimeInMs}}ms**
システム稼働時間: {{sysUpTime}}
システム名: {{sysName}}
最初のOID値: {{oidResponses[0].value}}
```

### 配列ループを使った受信リクエスト（Grafanaウェブフック）

タイトル：

```
[{{requestBody.status}}] {{requestBody.receiver}}
```

説明：

```
### {{requestBody.receiver}} からのアラート

{{#each requestBody.alerts}}
**アラート {{@index}}**: {{labels.alertname}}
- ラベル: {{labels.label}}
- ステータス: {{status}}
- 値: {{valueString}}
- ソース: {{generatorURL}}
{{/each}}
```

### ディスクループを使ったサーバーモニター

説明：

```
### サーバーアラート: {{hostname}}
CPU使用率: **{{cpuUsagePercent}}%**
メモリ使用率: **{{memoryUsagePercent}}%**

**ディスク使用率:**
{{#each diskMetrics}}
- {{diskPath}}: {{usagePercent}}% 使用 ({{freePercent}}% 空き)
{{/each}}

**実行中のプロセス:**
{{#each processes}}
- [{{pid}}] {{name}}: {{command}}
{{/each}}
```

### OIDループを使ったSNMPモニター

説明：

```
### SNMPデバイスステータス
オンライン: {{isOnline}}
レスポンス: {{responseTimeInMs}}ms

**OID値:**
{{#each oidResponses}}
- {{name}} ({{oid}}): {{value}}
{{/each}}
```
