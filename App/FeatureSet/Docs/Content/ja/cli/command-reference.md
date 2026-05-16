# コマンドリファレンス

OneUptime CLI の全コマンドの完全なリファレンスです。

## 認証コマンド

### `oneuptime login`

OneUptime インスタンスに認証します。

```bash
oneuptime login <api-key> <instance-url> [--context-name <name>]
```

| パラメータ | タイプ | 必須 | 説明 |
|-----------|------|----------|-------------|
| `<api-key>` | 引数 | はい | 認証用 API キー |
| `<instance-url>` | 引数 | はい | OneUptime インスタンス URL |
| `--context-name` | オプション | いいえ | コンテキスト名（デフォルト: `"default"`） |

---

### `oneuptime context list`

保存されているすべてのコンテキストを一覧表示します。

```bash
oneuptime context list
```

---

### `oneuptime context use`

名前付きコンテキストに切り替えます。

```bash
oneuptime context use <name>
```

| パラメータ | タイプ | 必須 | 説明 |
|-----------|------|----------|-------------|
| `<name>` | 引数 | はい | 有効化するコンテキスト名 |

---

### `oneuptime context current`

マスクされた API キーとともにアクティブなコンテキストを表示します。

```bash
oneuptime context current
```

---

### `oneuptime context delete`

保存されているコンテキストを削除します。

```bash
oneuptime context delete <name>
```

| パラメータ | タイプ | 必須 | 説明 |
|-----------|------|----------|-------------|
| `<name>` | 引数 | はい | 削除するコンテキスト名 |

---

## リソースコマンド

すべてのリソースコマンドは同じパターンに従います。`<resource>` をサポートされているリソース名（例: `incident`、`monitor`、`alert`、`status-page`）に置き換えてください。

### `oneuptime <resource> list`

フィルタリングとページネーションを使用してリソースを一覧表示します。

```bash
oneuptime <resource> list [options]
```

| オプション | タイプ | デフォルト | 説明 |
|--------|------|---------|-------------|
| `--query <json>` | 文字列 | なし | JSON 形式のフィルター条件 |
| `--limit <n>` | 数値 | `10` | 最大結果数 |
| `--skip <n>` | 数値 | `0` | スキップする結果数 |
| `--sort <json>` | 文字列 | なし | JSON 形式のソート順 |
| `-o, --output` | 文字列 | `table` | 出力フォーマット |

---

### `oneuptime <resource> get`

ID で単一のリソースを取得します。

```bash
oneuptime <resource> get <id> [-o <format>]
```

| パラメータ | タイプ | 必須 | 説明 |
|-----------|------|----------|-------------|
| `<id>` | 引数 | はい | リソース ID（UUID） |
| `-o, --output` | オプション | いいえ | 出力フォーマット |

---

### `oneuptime <resource> create`

新しいリソースを作成します。

```bash
oneuptime <resource> create [--data <json> | --file <path>] [-o <format>]
```

| オプション | タイプ | 必須 | 説明 |
|--------|------|----------|-------------|
| `--data <json>` | 文字列 | `--data` または `--file` のいずれか | JSON 形式のリソースデータ |
| `--file <path>` | 文字列 | `--data` または `--file` のいずれか | JSON ファイルへのパス |
| `-o, --output` | 文字列 | いいえ | 出力フォーマット |

---

### `oneuptime <resource> update`

既存のリソースを更新します。

```bash
oneuptime <resource> update <id> --data <json> [-o <format>]
```

| パラメータ | タイプ | 必須 | 説明 |
|-----------|------|----------|-------------|
| `<id>` | 引数 | はい | リソース ID |
| `--data <json>` | オプション | はい | JSON 形式の更新フィールド |
| `-o, --output` | オプション | いいえ | 出力フォーマット |

---

### `oneuptime <resource> delete`

リソースを削除します。

```bash
oneuptime <resource> delete <id> [--force]
```

| パラメータ | タイプ | 必須 | 説明 |
|-----------|------|----------|-------------|
| `<id>` | 引数 | はい | リソース ID |
| `--force` | オプション | いいえ | 確認プロンプトをスキップ |

---

### `oneuptime <resource> count`

フィルターに一致するリソースをカウントします。

```bash
oneuptime <resource> count [--query <json>]
```

| オプション | タイプ | デフォルト | 説明 |
|--------|------|---------|-------------|
| `--query <json>` | 文字列 | なし | JSON 形式のフィルター条件 |

---

## ユーティリティコマンド

### `oneuptime version`

CLI のバージョンを表示します。

```bash
oneuptime version
```

---

### `oneuptime whoami`

現在の認証情報を表示します。

```bash
oneuptime whoami
```

インスタンス URL とマスクされた API キーを表示します。保存されたコンテキストがアクティブな場合は、コンテキスト名も表示されます。

---

### `oneuptime resources`

利用可能なすべてのリソースタイプを一覧表示します。

```bash
oneuptime resources [--type <type>]
```

| オプション | タイプ | デフォルト | 説明 |
|--------|------|---------|-------------|
| `--type <type>` | 文字列 | なし | `database` または `analytics` でフィルター |

---

## グローバルオプション

以下のフラグはすべてのコマンドで使用できます。

| オプション | 説明 |
|--------|-------------|
| `--api-key <key>` | API キーを上書き |
| `--url <url>` | インスタンス URL を上書き |
| `--context <name>` | 特定のコンテキストを使用 |
| `-o, --output <format>` | 出力フォーマット: `json`、`table`、`wide` |
| `--no-color` | カラー出力を無効化 |
| `--help` | ヘルプを表示 |
| `--version` | バージョンを表示 |

## API ルート

参考として、CLI は以下の API エンドポイントにコマンドをマッピングしています。

| コマンド | メソッド | エンドポイント |
|---------|--------|----------|
| `list` | POST | `/api/<resource>/get-list` |
| `get` | POST | `/api/<resource>/<id>/get-item` |
| `create` | POST | `/api/<resource>` |
| `update` | PUT | `/api/<resource>/<id>/` |
| `delete` | DELETE | `/api/<resource>/<id>/` |
| `count` | POST | `/api/<resource>/count` |

すべてのリクエストには認証のための `APIKey` ヘッダーが含まれます。
