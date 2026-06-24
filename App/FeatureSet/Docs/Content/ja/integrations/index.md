# 連携 概要

OneUptime はチームがすでに使っているツール — Zabbix、Jira、PagerDuty、Slack など多数 — を **[ワークフロー](/docs/workflows/index)** という組み込みの自動化エンジンで接続します。別のプラグインをインストールする必要はありません。ドラッグ＆ドロップのキャンバス上で連携を組み立てれば、何か起きるたびに自動で動きます。

このページでは、すべての連携が使う 2 つのパターンを説明します。この 2 つを理解すれば、専用ページのないツールも含め、ほぼあらゆるものと OneUptime を接続できます。

## 2 つのパターン

すべての連携はデータを 2 つの方向のどちらかに動かします (多くは両方を使います)。

### インバウンド — 別のツールが OneUptime にデータを送る

外部システムが OneUptime に何かを*作成または更新*する必要がある場合 — 通常は問題を検知したときにインシデントやアラートを開く場合 — に使います。

1. **[Webhook トリガー](/docs/workflows/triggers#webhook)** で始まるワークフローを作ります。OneUptime が固有の URL を発行します。
2. 別のツール側で、何かが起きたときにその URL に POST するよう Webhook / 通知アクションを設定します。
3. ワークフロー内で受信ペイロードを読み取り、**Create Incident** (または Create Alert) コンポーネントで記録します。

```text
Zabbix / Prometheus / Grafana / Datadog  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

### アウトバウンド — OneUptime が別のツールにデータを送る

OneUptime で起きたことを*別のツールに反映*させる場合 — Jira チケットを開く、PagerDuty で誰かに連絡する、Slack に投稿する — に使います。

1. **[OneUptime イベントトリガー](/docs/workflows/triggers#oneuptime-event-triggers)** で始まるワークフローを作ります。たとえば **Incident → On Create**。
2. **[API コンポーネント](/docs/workflows/components#api)** を追加して、インシデントの詳細を持つ別のツールの REST API を呼び出します。
3. API キーはすべて**シークレット [グローバル変数](/docs/workflows/variables#global-variables)** として保存し、ワークフローやそのログに絶対に表示されないようにします。

```text
OneUptime Incident → On Create  ──►  API component  ──►  Jira / PagerDuty / ServiceNow / GitHub
```

## カタログ

| ツール                                                                | 方向                            | 内容                                                                    |
| --------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------- |
| [Zabbix](/docs/integrations/zabbix)                                   | インバウンド                    | Zabbix の問題を OneUptime のインシデントに変換 (回復時に解決)。         |
| [Jira](/docs/integrations/jira)                                       | アウトバウンド (+ インバウンド) | インシデントごとに Jira の課題を開く。ステータスを同期する。            |
| [PagerDuty](/docs/integrations/pagerduty)                             | アウトバウンド (+ インバウンド) | OneUptime のインシデントから PagerDuty のイベントをトリガー・解決する。 |
| [Opsgenie](/docs/integrations/opsgenie)                               | アウトバウンド (+ インバウンド) | Opsgenie のアラートを作成・クローズする。                               |
| [ServiceNow](/docs/integrations/servicenow)                           | アウトバウンド (+ インバウンド) | OneUptime から ServiceNow のインシデントを開く。                        |
| [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) | インバウンド                    | Alertmanager の通知をインシデントに変換する。                           |
| [Grafana](/docs/integrations/grafana)                                 | インバウンド                    | Grafana のアラートをインシデントに変換する。                            |
| [Datadog](/docs/integrations/datadog)                                 | インバウンド                    | Datadog のモニターアラートをインシデントに変換する。                    |
| [GitHub](/docs/integrations/github)                                   | アウトバウンド                  | インシデントに対して GitHub の Issue を開く。                           |
| [GitLab](/docs/integrations/gitlab)                                   | アウトバウンド                  | インシデントに対して GitLab の Issue を開く。                           |
| [Discord](/docs/integrations/discord)                                 | アウトバウンド                  | インシデントの更新を Discord チャンネルに投稿する。                     |
| [Telegram](/docs/integrations/telegram)                               | アウトバウンド                  | インシデントの更新を Telegram チャットに送信する。                      |
| [Slack](/docs/workspace-connections/slack)                            | 双方向                          | ネイティブのワークスペース接続 — チャンネル、アラート、オンコール。     |
| [Microsoft Teams](/docs/workspace-connections/microsoft-teams)        | 双方向                          | ネイティブのワークスペース接続。                                        |

> **Slack と Microsoft Teams** はワークフローを超えたより深いネイティブ接続を持っています — 自動インシデントチャンネル、双方向アクション、オンコール通知。これらについてはワークフローを作らず、[Slack](/docs/workspace-connections/slack) および [Microsoft Teams](/docs/workspace-connections/microsoft-teams) のワークスペース接続を使ってください。

## シークレットの扱い方

API キーやトークンをブロックに直接貼り付けないでください。代わりに:

1. **Workflows → Global Variables** を開きます。
2. 変数を作成します。たとえば `JIRA_AUTH` という名前にして **Is Secret** をオンにします。
3. どこからでも `{{variable.JIRA_AUTH}}` で参照できます。

シークレット変数は保存後に UI 上では非表示となり、実行ログからも除外されます。詳しくは [変数](/docs/workflows/variables#global-variables) を参照してください。

## 認証クイックリファレンス

アウトバウンド連携のほとんどは API ブロックに `Authorization` ヘッダーが必要です。よく使われる形式:

| 方式                         | ヘッダーの値                               | 使用先                   |
| ---------------------------- | ------------------------------------------ | ------------------------ |
| Bearer トークン              | `Bearer {{variable.TOKEN}}`                | GitHub、多くのモダン API |
| Basic 認証                   | `Basic {{variable.BASE64_USER_PASS}}`      | Jira、ServiceNow         |
| API キーヘッダー             | `GenieKey {{variable.OPSGENIE_KEY}}`       | Opsgenie                 |
| ボディ内トークン             | JSON ボディの `routing_key` フィールド     | PagerDuty Events API     |
| プライベートトークンヘッダー | `PRIVATE-TOKEN: {{variable.GITLAB_TOKEN}}` | GitLab                   |

Basic 認証では `username:password` (または `email:api_token`) を**一度だけ** base64 エンコードし、その結果をシークレットとして保存してください。macOS/Linux では:

```bash
printf '%s' 'you@example.com:your_api_token' | base64
```

## 対応するツールが見つからない場合

ほぼすべてのツールは上記 2 つのパターンのどちらかに当てはまります:

- ツールが何かが起きたとき**Webhook を送信**できるなら、**インバウンド**パターンを使います — そのツールの Webhook を OneUptime の Webhook トリガーに向けます。
- ツールが **REST API** を持つなら、**アウトバウンド**パターンを使います — **API コンポーネント**から呼び出します。
- 2 つの間でデータを加工する必要がある場合は **[Custom Code](/docs/workflows/components#custom-code)** ブロックを追加します。

これで Zendesk、AWS CloudWatch (SNS 経由)、New Relic、Splunk、StatusCake など幅広いツールに対応できます。やり方は同じで、URL とペイロードが異なるだけです。

## 次に読むべきページ

- [ワークフロー 概要](/docs/workflows/index) — 自動化エンジンの仕組み。
- [トリガー](/docs/workflows/triggers) — Webhook と OneUptime イベントトリガーの詳細。
- [コンポーネント](/docs/workflows/components) — API、Webhook、データコンポーネント。
- [変数](/docs/workflows/variables) — シークレットとブロック間のデータの受け渡し。
- [Zabbix](/docs/integrations/zabbix) と [Jira](/docs/integrations/jira) — 完全なハンズオン例。
