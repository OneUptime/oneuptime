# OneUptime CLI

OneUptime CLI は、ターミナルから OneUptime リソースを直接管理するためのコマンドラインインターフェースです。モニター、インシデント、アラート、ステータスページなどに対する完全な CRUD 操作をサポートしています。

## 機能

- 本番、ステージング、開発環境のための名前付きコンテキストによる**マルチ環境サポート**
- OneUptime インスタンスから利用可能なリソースを自動検出する**オート検出**
- CLI フラグ、環境変数、または保存されたコンテキスト経由の**柔軟な認証**
- JSON、テーブル、ワイド表示モードを備えた**スマートな出力フォーマット**
- CI/CD パイプラインと自動化ワークフロー向けに**スクリプト対応**

## インストール

```bash
npm install -g @oneuptime/cli
```

## クイックスタート

```bash
# OneUptime インスタンスに認証する
oneuptime login <your-api-key> https://oneuptime.com

# モニターを一覧表示する
oneuptime monitor list

# 特定のインシデントを表示する
oneuptime incident get <incident-id>

# 利用可能なすべてのリソースを確認する
oneuptime resources
```

## ドキュメント

| ガイド                                         | 説明                                             |
| ---------------------------------------------- | ------------------------------------------------ |
| [認証](./authentication.md)                    | ログイン、コンテキスト、認証情報の管理           |
| [リソース操作](./resource-operations.md)       | モニター、インシデント、アラートなどの CRUD 操作 |
| [出力フォーマット](./output-formats.md)        | JSON、テーブル、ワイド出力モード                 |
| [スクリプトと CI/CD](./scripting.md)           | 自動化、環境変数、パイプラインの使用             |
| [コマンドリファレンス](./command-reference.md) | すべてのコマンドとオプションの完全なリファレンス |

## グローバルオプション

以下のフラグはすべてのコマンドで使用できます。

| フラグ                  | 説明                                      |
| ----------------------- | ----------------------------------------- |
| `--api-key <key>`       | このコマンドの API キーを上書き           |
| `--url <url>`           | このコマンドのインスタンス URL を上書き   |
| `--context <name>`      | 特定の名前付きコンテキストを使用          |
| `-o, --output <format>` | 出力フォーマット: `json`、`table`、`wide` |
| `--no-color`            | カラー出力を無効化                        |
| `--help`                | コマンドヘルプを表示                      |
| `--version`             | CLI バージョンを表示                      |

## ヘルプの取得

```bash
# 一般的なヘルプ
oneuptime --help

# 特定のコマンドのヘルプ
oneuptime monitor --help
oneuptime monitor list --help
```
