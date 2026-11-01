# コマンド リファレンス

`oneuptime` CLI のすべてのコマンドと、その引数、オプション、既定値です。どのコマンドにも `--help` を付けると、同じ内容をターミナルで確認できます。

:::cards
- [グローバルオプション](#グローバルオプション): すべてのコマンドが受け付けるオプション。
- [ログインとコンテキスト](#ログインとコンテキスト): login と context のコマンド。
- [リソースのコマンド](#リソースのコマンド): list、get、create、update、delete、count。
- [その他のコマンド](#その他のコマンド): deploy、whoami、resources、version、help。
:::

## コマンドの全体像

```mermaid title="oneuptime CLI のコマンド"
flowchart LR
    O["oneuptime"] --> L["login"]
    O --> C["context"]
    C --> C1["list<br/>use<br/>current<br/>delete"]
    O --> R["incident、monitor<br/>など各リソース"]
    R --> R1["list<br/>get<br/>create<br/>update<br/>delete<br/>count"]
    O --> U["deploy<br/>whoami<br/>resources<br/>version<br/>help"]
```

## グローバルオプション

| オプション | 内容 | 既定値 |
| --- | --- | --- |
| `--api-key <key>` | このコマンドで使う API キー | `ONEUPTIME_API_KEY`、次にコンテキストのキー |
| `--url <url>` | このコマンドで使う OneUptime のアドレス | `ONEUPTIME_URL`、次にコンテキストの URL |
| `--context <name>` | このコマンドで使う保存済みコンテキスト | 現在のコンテキスト |
| `-o, --output <format>` | `json`、`table`、`wide` | ターミナルでは `table`、パイプでは `json` |
| `--no-color` | 色なしで出力します | 色あり(`NO_COLOR` が設定されていない場合) |
| `-V, --version` | CLI のバージョンを表示します | |
| `-h, --help` | コマンドのヘルプを表示します | |

オプションはコマンドの前後どちらにも書けます。`oneuptime --context staging incident list` と `oneuptime incident list --context staging` は同じ動作をします。

## ログインとコンテキスト

### `oneuptime login`

API キーとアドレスをコンテキストとして保存し、現在のコンテキストにします。[ログインする](/docs/cli/authentication#ログインする)を参照してください。

```bash
oneuptime login <api-key> <instance-url> [--context-name <name>]
```

| 引数またはオプション | 必須 | 内容 | 既定値 |
| --- | --- | --- | --- |
| `<api-key>` | はい | プロジェクトの API キー | |
| `<instance-url>` | はい | OneUptime のアドレス(`https://oneuptime.com` など) | |
| `--context-name <name>` | いいえ | コンテキストを保存する名前 | `default` |

### `oneuptime context list`

保存したコンテキストを一覧表示します。`*` が現在のものを示します。API キーが一覧に表示されることはありません。

```bash
oneuptime context list [-o <format>]
```

| オプション | 必須 | 内容 |
| --- | --- | --- |
| `-o, --output <format>` | いいえ | `json`、`table`、`wide`。JSON では各コンテキストの `name`、`apiUrl`、`isCurrent` を出力します |

### `oneuptime context use`

保存したコンテキストを現在のコンテキストにします。

```bash
oneuptime context use <name>
```

| 引数 | 必須 | 内容 |
| --- | --- | --- |
| `<name>` | はい | 保存したコンテキストの名前 |

### `oneuptime context current`

現在のコンテキストの名前と URL、そして先頭 4 文字と末尾 4 文字以外を伏せた API キーを表示します。

```bash
oneuptime context current
```

### `oneuptime context delete`

保存したコンテキストを削除します。それが現在のコンテキストだった場合は、残ったうち最初のコンテキストが現在のコンテキストになります。

```bash
oneuptime context delete <name>
```

| 引数 | 必須 | 内容 |
| --- | --- | --- |
| `<name>` | はい | 保存したコンテキストの名前 |

## リソースのコマンド

`<resource>` は、[リソース](#リソース)の表にあるレコードの種類のコマンド(`incident` や `monitor` など)です。例は[リソース操作](/docs/cli/resource-operations)を参照してください。

### `oneuptime <resource> list`

レコードを新しい順に一覧表示します。ラベルは代わりに名前順で、番号付きのラベルが先に並びます（`2. Team` は `10. Owner` の前）。

```bash
oneuptime <resource> list [--query <json>] [--limit <n>] [--skip <n>] [--sort <json>] [-o <format>]
```

| オプション | 内容 | 既定値 |
| --- | --- | --- |
| `--query <json>` | JSON で書いたフィルター | キーが読み取れるすべてのレコード |
| `--limit <n>` | 返すレコードの最大件数(最大 10,000) | `10` |
| `--skip <n>` | 最初に飛ばすレコードの件数 | `0` |
| `--sort <json>` | JSON で書いた順序: `{"<field>":"ASC"}` または `{"<field>":"DESC"}` | 新しい順 |
| `-o, --output <format>` | `json`、`table`、`wide` | ターミナルでは `table`、パイプでは `json` |

### `oneuptime <resource> get`

レコードを一件読み取ります。レコードのみ: テレメトリには `get` がありません。

```bash
oneuptime <resource> get <id> [-o <format>]
```

| 引数またはオプション | 必須 | 内容 |
| --- | --- | --- |
| `<id>` | はい | レコードの ID(UUID) |
| `-o, --output <format>` | いいえ | `json`、`table`、`wide` |

### `oneuptime <resource> create`

レコードを作成して表示します。

```bash
oneuptime <resource> create (--data <json> | --file <path>) [-o <format>]
```

| オプション | 必須 | 内容 |
| --- | --- | --- |
| `--data <json>` | 二つのうち一つ | JSON で書いたレコード |
| `--file <path>` | 二つのうち一つ | レコードを含む JSON ファイル。`--data` と一緒に指定するとファイルが使われます |
| `-o, --output <format>` | いいえ | `json`、`table`、`wide` |

### `oneuptime <resource> update`

指定したフィールドを変更します。レコードのみ: テレメトリには `update` がありません。

```bash
oneuptime <resource> update <id> --data <json> [-o <format>]
```

| 引数またはオプション | 必須 | 内容 |
| --- | --- | --- |
| `<id>` | はい | レコードの ID |
| `--data <json>` | はい | JSON で書いた、変更するフィールド |
| `-o, --output <format>` | いいえ | `json`、`table`、`wide` |

### `oneuptime <resource> delete`

確認せずにすぐレコードを削除します。レコードのみ: テレメトリには `delete` がありません。

```bash
oneuptime <resource> delete <id> [--force]
```

| 引数またはオプション | 必須 | 内容 |
| --- | --- | --- |
| `<id>` | はい | レコードの ID |
| `--force` | いいえ | 受け付けますが何も変わりません: `delete` は確認を求めません |

### `oneuptime <resource> count`

レコードの件数を数えて表示します。

```bash
oneuptime <resource> count [--query <json>] [-o <format>]
```

| オプション | 必須 | 内容 |
| --- | --- | --- |
| `--query <json>` | いいえ | JSON で書いたフィルター。指定しなければ、キーが読み取れるすべてのレコード |
| `-o, --output <format>` | いいえ | `json`、`table`、`wide` |

### リソース

レコードは `list`、`get`、`create`、`update`、`delete`、`count` を受け付けます。

| 分野 | コマンド |
| --- | --- |
| 監視 | `monitor`, `monitor-status`, `monitor-status-event` |
| インシデント | `incident`, `incident-state`, `incident-severity`, `incident-state-timeline`, `incident-public-note`, `incident-internal-note`, `incident-alert`, `postmortem-status` |
| アラート | `alert`, `alert-state`, `alert-severity`, `alert-state-timeline`, `alert-internal-note` |
| ステータスページ | `status-page`, `status-page-announcement` |
| 計画メンテナンス | `scheduled-maintenance-event`, `scheduled-maintenance-state`, `scheduled-maintenance-state-timeline` |
| チームとオンコール | `team`, `on-call-policy` |
| セキュリティ | `security-case`, `security-case-evidence`, `security-case-note`, `security-case-priority`, `security-case-status`, `security-case-task`, `security-detection`, `security-playbook` |
| データセキュリティ | `data-store`, `data-store-finding`, `data-store-access-entry`, `data-flow`, `data-security-issue`, `data-security-scan`, `custom-data-type`, `check-setting`, `residency-rule`, `data-security-setting` |
| ラベル | `label` |

テレメトリは `list`、`create`、`count` を受け付けます。

| 分野 | コマンド |
| --- | --- |
| オブザーバビリティ | `log`, `metric`, `span`, `exception-instance`, `monitor-log` |
| セキュリティ | `security-event`, `threat-intel-indicator` |
| 変更とコスト | `change-event`, `kubernetes-cost-allocation` |

CLI は OneUptime と一緒にリリースされるため、`oneuptime resources` はインストールしたバージョンのコマンドを一覧表示します。

### API リクエスト

各操作は API への 1 回のリクエストで、キーは `APIKey` ヘッダーで送られます。`<path>` は `oneuptime resources` が示すリソースの API パスです。`incident` なら `/incident`、`on-call-policy` なら `/on-call-duty-policy` です。

| 操作 | リクエスト | 本文 |
| --- | --- | --- |
| `list` | `POST /api/<path>/get-list` | `query`、`select`、`skip`、`limit`、`sort` |
| `get` | `POST /api/<path>/<id>/get-item` | `select` |
| `create` | `POST /api/<path>` | `{"data": ...}` |
| `update` | `PUT /api/<path>/<id>/` | `{"data": ...}` |
| `delete` | `DELETE /api/<path>/<id>/` | なし |
| `count` | `POST /api/<path>/count` | `query` |

## その他のコマンド

### `oneuptime deploy`

パイプラインから、デプロイやその他の変更を記録します。記録した変更はサービスのグラフに描かれ、OneUptime AI がインシデントを調査するときに読み取ります。書き込みには、API キーではなくテレメトリ取り込みキーを使います。[デプロイと変更](/docs/telemetry/change-events)を参照してください。

```bash
oneuptime deploy [--service <name>] [--service-version <version>] [--previous-version <version>] [--commit <sha>] [--repository <url>] [--branch <name>] [--pull-request <number>] [--environment <name>] [--title <title>] [--description <text>] [--type <type>] [--time <time>] [--attribute <key=value...>] [--ingestion-key <key>]
```

| オプション | 必須 | 内容 | 既定値 |
| --- | --- | --- | --- |
| `--service <name>` | いいえ | デプロイされたサービス | プロジェクト全体の変更 |
| `--service-version <version>` | いいえ | デプロイされたバージョン | |
| `--previous-version <version>` | いいえ | 置き換えられたバージョン | |
| `--commit <sha>` | いいえ | デプロイされたコミット | |
| `--repository <url>` | いいえ | コミットがあるリポジトリ | |
| `--branch <name>` | いいえ | デプロイされたブランチ | |
| `--pull-request <number>` | いいえ | デプロイされたプルリクエスト | |
| `--environment <name>` | いいえ | デプロイ先の環境 | |
| `--title <title>` | いいえ | 変更のタイトル。デプロイ以外の種類の変更では必須です | `Deploy <version>` |
| `--description <text>` | いいえ | 変更の詳細 | |
| `--type <type>` | いいえ | 変更の種類(`config-change` や `rollback` など) | `deployment` |
| `--time <time>` | いいえ | 発生した日時(`2026-10-19T10:00:00Z` など) | 現在 |
| `--attribute <key=value...>` | いいえ | 追加の属性。`key=value` の形式で一つ以上 | |
| `--ingestion-key <key>` | いいえ | プロジェクトのテレメトリ取り込みキー | `ONEUPTIME_TELEMETRY_INGESTION_KEY` |

### `oneuptime whoami`

次のコマンドが使う URL と API キー(キーは伏せた形)と、それらの取得元のコンテキストを表示します。OneUptime は呼び出しません。[CLI が使う値を確認する](/docs/cli/authentication#cli-が使う値を確認する)を参照してください。

```bash
oneuptime whoami
```

### `oneuptime resources`

CLI にコマンドがあるレコードの種類をすべて一覧表示します。コマンド、単数形と複数形の名前、タイプ、API パス、そして合計数を表示します。

```bash
oneuptime resources [--type <type>] [-o <format>]
```

| オプション | 必須 | 内容 | 既定値 |
| --- | --- | --- | --- |
| `--type <type>` | いいえ | レコードなら `database`、テレメトリなら `analytics` | 両方 |
| `-o, --output <format>` | いいえ | `json`、`table`、`wide`。JSON ではそれぞれの `name`、`singularName`、`pluralName`、`modelType`、`apiPath` を出力します | ターミナルでは `table`、パイプでは `json` |

### `oneuptime version`

`oneuptime --version` と同じく、CLI のバージョンを表示します。

```bash
oneuptime version
```

### `oneuptime help`

CLI またはコマンドのヘルプを表示します。

```bash
oneuptime help [command]
```

## 環境変数

| 変数 | 内容 |
| --- | --- |
| `ONEUPTIME_API_KEY` | `--api-key` フラグで指定されていないときの API キー |
| `ONEUPTIME_URL` | `--url` フラグで指定されていないときの OneUptime のアドレス |
| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | `--ingestion-key` フラグで指定されていないときに `oneuptime deploy` が書き込みに使うテレメトリ取り込みキー |
| `NO_COLOR` | 任意の値を設定すると色が消えます |

## ファイル

| ファイル | 内容 |
| --- | --- |
| `~/.oneuptime/config.json` | 保存したコンテキスト、その API キー、現在のコンテキスト |

## 終了コード

| コード | 意味 |
| --- | --- |
| `0` | 成功した |
| `1` | 失敗した: OneUptime がリクエストを拒否したか、コマンドが誤っていた |
| `2` | 使える API キーがない: 見つからない、無効、またはプラン未満 |
| `3` | 見つからない: OneUptime が `404` を返した |

例は[終了コード](/docs/cli/scripting#終了コード)を参照してください。

## 次のステップ

:::cards
- [CLI 概要](/docs/cli/index): CLI をインストールし、最初のコマンドを実行します。
- [リソース操作](/docs/cli/resource-operations): 各操作の例。
- [スクリプト & CI/CD](/docs/cli/scripting): スクリプトとパイプラインでの CLI。
:::
