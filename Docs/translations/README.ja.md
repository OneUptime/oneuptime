<!-- markdownlint-disable MD033 MD041 -->
<p align="center">
  <a href="/README.md">English</a> ·
  <a href="/Docs/translations/README.zh-CN.md">简体中文</a> ·
  <a href="/Docs/translations/README.zh-TW.md">繁體中文</a> ·
  <a href="/Docs/translations/README.ja.md">日本語</a> ·
  <a href="/Docs/translations/README.ko.md">한국어</a> ·
  <a href="/Docs/translations/README.es.md">Español</a> ·
  <a href="/Docs/translations/README.fr.md">Français</a> ·
  <a href="/Docs/translations/README.de.md">Deutsch</a> ·
  <a href="/Docs/translations/README.pt.md">Português</a> ·
  <a href="/Docs/translations/README.it.md">Italiano</a> ·
  <a href="/Docs/translations/README.ru.md">Русский</a> ·
  <a href="/Docs/translations/README.hi.md">हिन्दी</a> ·
  <a href="/Docs/translations/README.fa.md">فارسی</a> ·
  <a href="/Docs/translations/README.nl.md">Nederlands</a> ·
  <a href="/Docs/translations/README.da.md">Dansk</a> ·
  <a href="/Docs/translations/README.sv.md">Svenska</a> ·
  <a href="/Docs/translations/README.no.md">Norsk</a>
</p>

<p align="center">
  <a href="https://oneuptime.com"><img alt="OneUptime" width="50%" src="/packages/Home/Static/img/OneUptimePNG/7.png"></a>
</p>

<p align="center">
  <a href="https://github.com/OneUptime/oneuptime/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0%20%2B%20Enterprise%20%28ee%2F%29-1a73e8" alt="License"></a>
  <a href="https://github.com/OneUptime/oneuptime/releases"><img src="https://img.shields.io/github/v/release/OneUptime/oneuptime" alt="Release"></a>
</p>

OneUptime はオープンソースのオブザーバビリティプラットフォームです。ウェブサイト、API、サーバーが動いていることを確認し、アプリが送るログ、メトリクス、トレースを集め、何かが壊れたときはオンコール担当者を呼び出し、ステータスページで顧客に知らせます。これらはすべて 1 つの製品の中で行われるため、問題に気づいたツールがそのままチームを呼び出します。

[OneUptime Cloud](https://oneuptime.com) で使うことも、自分のサーバーで動かすこともできます。

<p align="center">
  <img alt="インシデント中の OneUptime: タイムライン、オンコール担当者、ステータスページ、OneUptime AI の調査" width="100%" src="/packages/Home/Static/img/readme/hero-command-center.png">
</p>

## できること

- **[モニタリング](https://oneuptime.com/docs/ja/monitor/create-monitor)**: ウェブサイト、API、ポート、DNS、証明書を、世界中のプローブや自社ネットワークの内側からチェックします。サーバー、Kubernetes、Docker、VMware、データベース、ネットワーク機器も見守ります。
- **[インシデントとオンコール](https://oneuptime.com/docs/ja/incidents/index)**: 各インシデントを 1 つのタイムラインで扱います。オンコール担当者を電話、SMS、メール、プッシュ通知、Slack、Microsoft Teams で呼び出し、誰かが応答するまでエスカレーションします。
- **[ステータスページ](https://oneuptime.com/docs/ja/status-pages/index)**: 公開または非公開のステータスページで顧客に状況を伝え、予定メンテナンスもそこで告知します。
- **[ログ、メトリクス、トレース](https://oneuptime.com/docs/ja/telemetry/open-telemetry)**: OpenTelemetry で送信し、検索し、ダッシュボードを作れます。例外、プロファイル、リアルユーザーモニタリング、セキュリティイベントも同じ場所にあります。
- **[ワークフローと Runbook](https://oneuptime.com/docs/ja/workflows/index)**: 定型作業を自動化し、Jira、ServiceNow など、チームがすでに使っているツールと接続します。
- **[OneUptime AI](https://oneuptime.com/docs/ja/ai/ai-sre)**: 新しいインシデントやアラートを調査し、出典付きの根本原因分析を投稿します。修正をオンにすると、チームがレビューする修正のプルリクエストを開くこともできます。
- **[API、CLI、Terraform](https://oneuptime.com/docs/ja/api-reference/api-reference)**: スクリプトや CI から OneUptime を自動化し、モニター、ステータスページ、オンコールをコードとして管理します。

そのほかのことはすべて[ドキュメント](https://oneuptime.com/docs/ja/introduction/getting-started)にあります。

## 使い始める

### OneUptime Cloud

[サインアップ](https://oneuptime.com/accounts/register)してプロジェクトを作成します。無料プランにクレジットカードは不要です。

### Docker Compose でセルフホストする

8 GB 以上のメモリを持つ Linux サーバーと、Docker、Docker Compose、Git、Node.js が必要です。

```bash
# 1. Clone the release branch
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# 2. Create your config, with a random value for every secret
cp config.example.env config.env
while grep -q "please-change-this-to-random-value" config.env; do
  sed -i "0,/please-change-this-to-random-value/{s/please-change-this-to-random-value/$(openssl rand -hex 32)/}" config.env
done

# 3. Start everything
npm start
```

`npm start` が **OneUptime is up!** と表示したら、`http://localhost` を開いてサインアップします。最初のアカウントがインスタンスの管理者になります。サーバーでは、手順 3 の前に `config.env` の `HOST` をサーバーのドメイン名または IP アドレスにして、そのアドレスを開いてください。

サーバーのサイズ、HTTPS、バックアップ、更新については [Docker Compose ガイド](https://oneuptime.com/docs/ja/installation/docker-compose)を参照してください。

### Helm で Kubernetes にインストールする

大規模な本番環境や高可用性が必要なら、Helm チャートをインストールします。

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime --set host=oneuptime.example.com
```

`host` には、OneUptime にアクセスするときに使うドメイン名または IP アドレスを指定します。ストレージ、HTTPS、データベース、アップグレードについては[チャートの README](/HelmChart/Public/oneuptime/README.md) を参照してください。

## Community と Enterprise

- **Community Edition**: 無料のオープンソースで、ここまでに挙げたすべてと、SAML と OIDC のシングルサインオンを含みます。
- **Enterprise Edition**: SCIM プロビジョニング、監査ログ、チームコンプライアンス、インスタンスヘルスダッシュボードと優先サポートを追加します。本番環境で使うにはライセンスが必要です。詳しくは[営業にお問い合わせください](mailto:sales@oneuptime.com)。

2 つのエディションの比較は[ドキュメント](https://oneuptime.com/docs/ja/self-hosted/enterprise)にあります。

## サポート

- 質問は [Slack の OneUptime コミュニティ](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA)へどうぞ。
- バグの報告や機能の要望は [GitHub の Issues](https://github.com/OneUptime/oneuptime/issues) へお寄せください。
- セキュリティの脆弱性は、[SECURITY.md](/.github/SECURITY.md) の説明どおり非公開で報告してください。
- そのほかのことは [support@oneuptime.com](mailto:support@oneuptime.com) までメールでどうぞ。

## コントリビュート

バグ修正、機能、ドキュメント、テストのどれも歓迎します。ソースから OneUptime を動かす方法は[ローカル開発ガイド](https://oneuptime.com/docs/ja/installation/local-development)に、プルリクエストとライセンスの仕組みは[コントリビューションガイドライン](/.github/CONTRIBUTING.md)にあります。最初の一歩には [good first issue](https://github.com/OneUptime/oneuptime/labels/good%20first%20issue) ラベルの付いた Issue がおすすめです。

OneUptime が役に立ったら、このリポジトリにスターを付けるか、[プロジェクトをスポンサー](https://github.com/sponsors/OneUptime)してください。

## ライセンス

OneUptime は [Apache License 2.0](/LICENSE) のもとで公開されているオープンソースです。ただし [`ee/`](/ee) ディレクトリは例外です。このディレクトリには Enterprise Edition が含まれ、[OneUptime Enterprise License](/ee/LICENSE) のもとでライセンスされています。Community Edition のイメージには `ee/` のコードは一切含まれません。この区分は、リポジトリのルートにある [`LICENSE`](/LICENSE) ファイルに定められています。
