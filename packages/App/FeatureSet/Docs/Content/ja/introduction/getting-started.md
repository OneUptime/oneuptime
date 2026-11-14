# はじめに

OneUptime はオープンソースのオブザーバビリティプラットフォームです。ウェブサイト、API、サーバーが動いていることを確認し、アプリが送るログ、メトリクス、トレースを集め、何かが壊れたときはオンコール担当者を呼び出し、ステータスページで顧客に知らせます。これらはすべて 1 つの製品の中で行われるため、問題に気づいたツールがそのままチームを呼び出します。OneUptime Cloud で使うことも、自分のサーバーで動かすこともできます。

## 何をしたいですか?

:::cards
- [ウェブサイトや API が落ちたときに知る](/docs/guides/website-down): 世界中のプローブからチェックし、障害時にメールや呼び出しを受け取ります。
- [電話、SMS、プッシュで呼び出しを受け、エスカレーションする](/docs/guides/paging): オンコール担当者を呼び出し、誰も応答しなければ次の人を呼び出します。
- [自分のドメインでステータスページを公開する](/docs/guides/status-page): 自分のアドレスで、何が起きているかを顧客に伝えます。
- [ログ、メトリクス、トレースを送る](/docs/telemetry/open-telemetry): OpenTelemetry でアプリのテレメトリを送信し、検索し、アラートを受け取ります。
- [サーバーを監視する](/docs/telemetry/hosts): 1 つのコマンドでホストを追加し、CPU、メモリ、ディスクを見守ります。
- [Kubernetes クラスターを監視する](/docs/telemetry/kubernetes-agent): Helm でエージェントをインストールし、すべてのノードと Pod を見守ります。
- [チームを招く](/docs/permissions/index): メンバーを招待し、チームにまとめ、誰が何をできるかを決めます。
- [インシデントを最初の呼び出しからポストモーテムまで進める](/docs/incidents/index): 宣言し、チームで対応し、顧客に状況を伝え、そこから学びます。
:::

## OneUptime は初めてですか?

:::cards
- [クイックスタート](/docs/introduction/quickstart): ウェブサイトを監視し、障害時に呼び出しを受け、ステータスページを公開します。
- [基本概念](/docs/introduction/core-concepts): ほかのすべての土台となるいくつかの考え方と、そのつながり。
- [用語集](/docs/introduction/glossary): OneUptime で使われるすべての言葉を、ほかの呼び名とともに 1〜2 文で。
- [どれを使うべきか](/docs/introduction/which-one): インシデントかアラートか、ワークフローか Runbook かなど、似たものを並べて比較します。
:::

自分のサーバーで OneUptime を動かしていますか? まず [セルフホスティングガイド](/docs/installation/self-hosting-guide) に沿って進めてください。空のサーバーから、メールを送り人を呼び出せるサーバーまで案内します。

## 他のツールから移行する

**プロジェクト設定 → 詳細 → 別のツールからインポート** は、他のツールの設定を API キーで（Uptime Kuma の場合はファイルで）読み取ります。見つかったものを表示し、チェックを入れたものを作成します。他のツール側は何も変わらず、インポートをもう一度実行しても同じものが 2 回作成されることはありません。

すでに Prometheus、Loki クライアント、Splunk フォワーダー、Datadog Agent、Sentry SDK でテレメトリを送っていますか？そのまま使い続け、取り込みキーを付けて OneUptime に向けるだけです。方法は [Prometheus, Loki, Splunk, Datadog & Sentry](/docs/telemetry/compatible-endpoints) を参照してください。

:::details インポートできる 11 のツール
| 移行元 | OneUptime が読み取るもの |
| --- | --- |
| [Opsgenie](/docs/moving-to-oneuptime/opsgenie) | ユーザー、チーム、スケジュール、エスカレーション、サービス |
| [PagerDuty](/docs/moving-to-oneuptime/pagerduty) | ユーザー、チーム、スケジュール、エスカレーションポリシー、サービス |
| [incident.io](/docs/moving-to-oneuptime/incident-io) | ユーザー、チーム、スケジュール、エスカレーションパス、サービス、インシデントの設定 |
| [Splunk On-Call](/docs/moving-to-oneuptime/splunk-on-call) | ユーザー、チーム、ローテーション、エスカレーションポリシー |
| [Grafana OnCall](/docs/moving-to-oneuptime/grafana-oncall) | ユーザー、チーム、スケジュール、エスカレーションチェーン |
| [UptimeRobot](/docs/moving-to-oneuptime/uptimerobot) | モニターと公開ステータスページ |
| [Atlassian Statuspage](/docs/moving-to-oneuptime/atlassian-statuspage) | ページ、そのコンポーネントとグループ、メールの購読者 |
| [Better Stack](/docs/moving-to-oneuptime/better-stack) | モニター、ハートビート、ステータスページ、メールの購読者 |
| [Pingdom](/docs/moving-to-oneuptime/pingdom) | 稼働時間のチェック |
| [StatusCake](/docs/moving-to-oneuptime/statuscake) | 稼働時間、SSL、ハートビートのチェック |
| [Uptime Kuma](/docs/moving-to-oneuptime/uptime-kuma) | モニター（バックアップまたはメトリクスページから） |
:::

:::details OneUptime が置き換えるもの
| 機能 | 内容 | 置き換えられるツールの例 |
| --- | --- | --- |
| 稼働監視 | 世界各地から可用性と応答時間をチェックします。 | Pingdom、UptimeRobot |
| ステータスページ | サービスの現在の状態と履歴を顧客に表示します。 | Atlassian Statuspage |
| インシデント管理 | メモ、所有者、タイムラインとともに、インシデントを最初から最後まで管理します。 | incident.io |
| オンコールとアラート | オンコールのシフトを組み、誰かが応答するまでエスカレーションします。 | PagerDuty、Opsgenie |
| ログ管理 | ログを収集、検索、可視化します。 | Loggly |
| ワークフロー | アクションを自動化し、OneUptime をすでに使っているツールとつなぎます。 | Zapier |
| アプリケーションパフォーマンス監視 | トレース、応答時間、スループット、エラー率を追跡します。 | New Relic、Datadog |
| エラートラッキング | 例外を、スタックトレースとコンテキストとともにグループ化します。 | Sentry |
:::

## OneUptime の全体像

すべては、あなたが見守る対象から始まります。モニターはそれを定期的にチェックするか、それが送るテレメトリを読み取ります。モニターの条件に一致すると、OneUptime はインシデントを宣言するかアラートを作成し、オンコール担当者を呼び出し、必要に応じてインシデントをステータスページに表示します。

```mermaid title="失敗したチェックから、呼び出されたチームと更新されたステータスページまで"
flowchart TB
    probes["プローブがサイトと<br/>API をチェック"] --> monitors["モニター"]
    telemetry["アプリとエージェントが<br/>テレメトリを送信"] --> monitors
    monitors -->|"条件に一致"| problems["インシデントとアラート"]
    problems --> oncall["オンコールポリシーが<br/>チームを呼び出す"]
    problems --> status["ステータスページが<br/>顧客に知らせる"]
```

- **インシデント** は、ユーザーに影響する問題です。オンコール担当者を呼び出し、ステータスページに表示できます。
- **アラート** は、ユーザーが気づく前にチームが調べるべき問題です。これもオンコール担当者を呼び出せますが、ステータスページには表示されません。

[基本概念](/docs/introduction/core-concepts) では、それぞれの要素を数文で説明しています。

## ドキュメントを探す

ドキュメントはサイドバーと同じく 9 つのセクションに分かれています。必要な部分を選んでください。

:::details モニタリング
:::cards
- [モニター](/docs/monitor/create-monitor): ウェブサイト、API、ポート、DNS、NTP サーバー、証明書などを、世界中のプローブからチェックします。
- [インフラストラクチャモニター](/docs/monitor/host-monitor): サーバー、Kubernetes、Docker、VMware、ネットワーク機器、ストレージを見守ります。
- [テレメトリモニター](/docs/monitor/logs-monitor): 送信したログ、メトリクス、トレース、例外、プロファイルに基づいてアラートを出します。
- [SLO](/docs/slo/introduction): 信頼性の目標、エラーバジェット、バーンレートを追跡します。
- [プローブ](/docs/probe/custom-probe): 自社ネットワークの内側からチェックを実行します。
- [OneUptime がデータを受信していないとき](/docs/monitor/when-oneuptime-is-not-receiving): OneUptime 側の空白が、あなたのダウンタイムとして数えられない理由。
:::
:::

:::details インシデント対応
:::cards
- [インシデント](/docs/incidents/index): インシデントを宣言、調整、解決し、完全なタイムラインを残します。
- [アラート](/docs/alerts/index): ユーザーが気付く前に問題を調べ、ノイズをエピソードにまとめます。
- [オンコール](/docs/on-call/index): ポリシー、エスカレーションルール、ローテーション、誰をいつ呼び出すか。
- [通知](/docs/notifications/index): OneUptime からの連絡の仕組み。通知方法、オンコールルール、通知設定。
- [ステータスページ](/docs/status-pages/index): 公開または非公開のステータスページで、顧客に状況を伝えます。
- [定期メンテナンス](/docs/scheduled-maintenance/index): 計画作業を前もって告知し、影響するモニターを一時停止します。
- [ワークスペース連携](/docs/workspace-connections/slack): Slack や Microsoft Teams からインシデントに対応します。
:::
:::

:::details オブザーバビリティ
:::cards
- [テレメトリ](/docs/telemetry/open-telemetry): OpenTelemetry でログ、メトリクス、トレースを送信し、検索します。
- [インフラストラクチャエージェント](/docs/telemetry/hosts): 1 つのコマンドでホストを追加し、Kubernetes、Docker、Proxmox、VMware などのエージェントをインストールします。
- [アプリプラットフォーム](/docs/telemetry/cloud-environments): ECS と Fargate、Cloud Run、App Service などのマネージドプラットフォームで実行しているアプリを監視します。
- [クラウド](/docs/telemetry/cloud-accounts): AWS、Azure、Google Cloud のアカウントを接続し、その中のすべてのリソースを監視します。
- [AI オブザーバビリティ](/docs/telemetry/ai-llm-observability): AI の会話を追い、回答の質が悪いときに知らせを受けます。
- [セキュリティ](/docs/telemetry/security-events): セキュリティイベントと脅威インテリジェンスを収集します。
- [データセキュリティ](/docs/data-security/index): バケット、データベース、テレメトリにある機密データを見つけ、その保管のしかたを改善します。
- [データオブザーバビリティ](/docs/data-observability/index): データベースやデータウェアハウスのデータが遅れている、誤っている、壊れているときにそれを知り、その原因となった実行、デプロイ、テーブルを特定します。
- [リアルユーザーモニタリング](/docs/rum/index): Core Web Vitals とセッションリプレイで、実際のユーザーの体験を測定します。
- [ダッシュボード](/docs/dashboards/index): メトリクス、ログ、モニターからダッシュボードを作成します。
- [インベントリ](/docs/inventory/overview): OneUptime が把握しているすべてのサービス、ホスト、デバイスを確認します。
:::
:::

:::details 自動化と AI
:::cards
- [Runbook](/docs/runbooks/index): 対応手順を、チームが実行できるステップに変えます。
- [フォーム](/docs/forms/index): 誰でもフォームから問題を報告でき、そのフォームがインシデントを開きます。
- [ワークフロー](/docs/workflows/index): OneUptime で何かが起きたときのアクションを自動化します。
- [AI](/docs/ai/ai-sre): OneUptime AI にインシデントとアラートを調査させ、システムについて質問します。
:::
:::

:::details インテグレーション
:::cards
- [インテグレーション](/docs/integrations/index): Jira、ServiceNow、Grafana、Datadog、Huntress、SIEM ツール、Discord、Telegram、IRC などと接続します。
:::
:::

:::details 開発者向け
:::cards
- [API リファレンス](/docs/api-reference/api-reference): REST API で OneUptime を自動化します。
- [CLI](/docs/cli/index): ターミナルや CI から OneUptime を管理します。
- [Terraform プロバイダー](/docs/terraform/index): モニター、ステータスページ、オンコールをコードとして管理します。
- [Crossplane プロバイダー](/docs/crossplane/index): Crossplane で Kubernetes からプロジェクトを管理します。
:::
:::

:::details 管理
:::cards
- [ユーザーと権限](/docs/permissions/index): メンバーを招待し、チームを編成し、できることを制御します。
- [ID 管理](/docs/identity/sso): SAML または OIDC のシングルサインオンでサインインし、SCIM でユーザーをプロビジョニングします。
- [設定](/docs/configuration/label-and-owner-rules): リソースに自動でラベルを付け、所有者を割り当てます。
- [メール](/docs/emails/smtp): OneUptime のメールを、自社の SMTP サーバー経由で送信します。
- [モバイル・デスクトップアプリ](/docs/mobile-desktop-apps/index): iOS、Android、macOS、Windows、Linux で呼び出しを受けて対応します。
:::
:::

:::details セルフホスティング
:::cards
- [インストール](/docs/installation/self-hosting-guide): 自分の OneUptime をインストールし、規模を見積もり、アップグレードします。
- [セルフホスト環境](/docs/self-hosted/architecture): 自分のインストールのアーキテクチャ、連携、Enterprise 機能。
:::
:::

## 次のステップ

:::cards
- [クイックスタート](/docs/introduction/quickstart): 最初のモニター、オンコールポリシー、ステータスページを設定します。
- [基本概念](/docs/introduction/core-concepts): ほかのすべてのページで使われる言葉を学びます。
- [ホーム画面とショートカット](/docs/introduction/home): ダッシュボードで、任意のページ、設定、アクションを見つけます。
- [Docker Compose](/docs/installation/docker-compose): 自分のサーバーで OneUptime を動かします。
:::
