<!-- markdownlint-disable MD033 MD041 -->
<p align="center">
  <a href="/README.md">English</a> ·
  <a href="/translations/README.zh-CN.md">简体中文</a> ·
  <a href="/translations/README.zh-TW.md">繁體中文</a> ·
  <a href="/translations/README.ja.md">日本語</a> ·
  <a href="/translations/README.ko.md">한국어</a> ·
  <a href="/translations/README.es.md">Español</a> ·
  <a href="/translations/README.fr.md">Français</a> ·
  <a href="/translations/README.de.md">Deutsch</a> ·
  <a href="/translations/README.pt.md">Português</a> ·
  <a href="/translations/README.it.md">Italiano</a> ·
  <a href="/translations/README.ru.md">Русский</a> ·
  <a href="/translations/README.hi.md">हिन्दी</a> ·
  <a href="/translations/README.nl.md">Nederlands</a> ·
  <a href="/translations/README.da.md">Dansk</a> ·
  <a href="/translations/README.sv.md">Svenska</a> ·
  <a href="/translations/README.no.md">Norsk</a>
</p>

<div align="center">
  <a href="https://oneuptime.com">
    <img alt="OneUptime ロゴ" width="55%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/OneUptimePNG/7.png"/>
  </a>

  <h3>エージェント型オブザーバビリティ — 稼働監視、インシデント、オンコール、ステータスページ、ログ、トレース、メトリクス、APM をひとつにまとめたオープンソースプラットフォーム。</h3>

  <p><b>障害が起きたとき、いち早く気づき、誰よりも速く直す。</b></p>

  <p>OneUptime は、無料でセルフホストできるひとつのプラットフォームで、棚いっぱいの SaaS ツールを置き換えます。障害を検知し、適切な担当者を呼び出し、ステータスページを更新し、根本原因を突き止め、さらには修正用の PR まで作成します。</p>

  <p>
    <a href="https://github.com/OneUptime/oneuptime/blob/master/LICENSE"><img src="https://img.shields.io/github/license/OneUptime/oneuptime?color=1a73e8" alt="License"></a>
    <a href="https://github.com/OneUptime/oneuptime/releases"><img src="https://img.shields.io/github/v/release/OneUptime/oneuptime" alt="Release"></a>
    <a href="https://github.com/OneUptime/oneuptime/stargazers"><img src="https://img.shields.io/github/stars/OneUptime/oneuptime?style=flat" alt="Stars"></a>
    <a href="https://artifacthub.io/packages/helm/oneuptime/oneuptime"><img src="https://img.shields.io/badge/Helm-Chart-0f1689" alt="Helm Chart"></a>
    <a href="https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA"><img src="https://img.shields.io/badge/Slack-Community-4A154B" alt="Slack"></a>
  </p>

  <p>
    <a href="https://oneuptime.com"><b>ウェブサイト</b></a> &nbsp;•&nbsp;
    <a href="https://oneuptime.com/docs"><b>ドキュメント</b></a> &nbsp;•&nbsp;
    <a href="#quick-start"><b>クイックスタート</b></a> &nbsp;•&nbsp;
    <a href="https://oneuptime.com/pricing"><b>料金</b></a> &nbsp;•&nbsp;
    <a href="#contributing"><b>コントリビュート</b></a>
  </p>

  <a href="https://oneuptime.com"><b>🚀 OneUptime Cloud を試す — ずっと無料のプラン、クレジットカード不要 →</b></a>
</div>

<br/>

<div align="center">
  <img alt="ライブインシデント中の OneUptime コマンドセンター" width="92%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/readme/hero-command-center.png"/>
</div>

---

## オブザーバビリティスタックをまるごと置き換える

OneUptime は、監視、アラート、インシデント対応、オブザーバビリティをひとつのオープンソースアプリに統合します。だから、十数個もの別々のツールに支払い続けたり、それらをつなぎ合わせたりする必要はもうありません。

| 従来のツール… | OneUptime でできること… |
|---|---|
| Pingdom / UptimeRobot | **稼働監視** — 世界中の拠点からのウェブサイト、API、ping、ポート、SSL、DNS、シンセティックチェック |
| StatusPage.io | **ステータスページ** — サブスクライバー対応の、ブランドを反映した公開・非公開ステータスページ |
| PagerDuty / Opsgenie | **オンコールとアラート** — スケジュール、エスカレーションポリシー、SMS / 通話 / プッシュ / Slack |
| Incident.io | **インシデント管理** — 宣言、トリアージ、コミュニケーション、ポストモーテム |
| Datadog / New Relic | **APM とメトリクス** — トレース、ダッシュボード、サービスパフォーマンス |
| Loggly | **ログ管理** — ログの収集、検索、アラート |
| Sentry | **エラートラッキング** — 完全なスタックトレースとコンテキストを備えた例外 |

これらすべてが **100% オープンソース（Apache 2.0）** で、無料でセルフホストできます。

---

## 🌙 ひとつのインシデントを、最初から最後まで対応

時刻は午前 2:47。チェックアウトがタイムアウトし始めます。ほとんどのツールが最初のアラートを発するより前に OneUptime が行うこと、そして下のスクリーンショットが実際に示していることを紹介します。

### 1 · 検知 — *数秒で気づく*

複数リージョンのプローブが、チェックアウトのレイテンシが 5 秒のしきい値を突破したことを検知し、自動的にインシデントを作成します。お客様が更新ボタンを押すよりも前に。

![検知 — グローバル監視がチェックアウト API の劣化を捉える](/Home/Static/img/readme/detect.png?raw=true)

### 2 · 対応 — *適切な担当者を呼び出す*

Payments ポリシーのオンコールエンジニアに、通話、テキスト、プッシュ通知で連絡が入り、誰かが確認するまで自動的にバックアップへエスカレーションします。

![対応 — インシデントがオンコールに振り分けられ確認される](/Home/Static/img/readme/respond.png?raw=true)

### 3 · 周知 — *お客様に状況を共有*

ステータスページは自動で更新され、すべてのサブスクライバーにメールと SMS で通知されます。誰も更新内容を手で書く必要はありません。

![周知 — 公開ステータスページが更新されサブスクライバーに通知される](/Home/Static/img/readme/communicate.png?raw=true)

### 4 · 診断 — *根本原因を突き止める*

トレース、ログ、メトリクスが、正確なスパンまで相関付けられます。原因は `orders` テーブルに対する遅い `SELECT … FOR UPDATE` で、インデックスの欠落によって滞っていました。

![診断 — トレースウォーターフォールが遅いデータベーススパンを特定する](/Home/Static/img/readme/diagnose.png?raw=true)

### 5 · 自動修正 — *修正案まで下書き済み*

AI エージェントが、インシデントに紐付いた修正内容のプルリクエストを、テストがグリーンの状態で作成します。あなたはレビューしてマージするだけ。まるで決して眠らない SRE のように。

![自動修正 — AI エージェントが修正のプルリクエストを作成する](/Home/Static/img/readme/autofix.png?raw=true)

---

<a name="quick-start"></a>

## ⚡ クイックスタート

### ☁️ OneUptime Cloud — 手軽な方法

セットアップ不要、常に最新、そしてオープンソースプロジェクトの支援にもなります。

**→ [oneuptime.com で無料登録](https://oneuptime.com)**

### 🐳 Docker Compose でセルフホスト

必要なものすべてを 1 台のサーバーに（Debian / Ubuntu / RHEL、Docker + Docker Compose）。ホームラボや小規模チームに最適で、Raspberry Pi でも動作します。

```bash
# 1. Clone the release branch
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# 2. Create your config (then edit it — set strong, random secrets!)
cp config.example.env config.env

# 3. Start everything
npm start
```

OneUptime は **http://localhost** で起動しました。開いて最初のアカウントを作成してください。

📖 詳しいガイド: [Docker Compose インストール](/App/FeatureSet/Docs/Content/en/installation/docker-compose.md) · [サイジングと要件](/App/FeatureSet/Docs/Content/en/installation/sizing.md)

### ☸️ Helm を使った Kubernetes — 本番環境向け

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm install oneuptime oneuptime/oneuptime
```

📖 詳しいインストール手順と values は [Artifact Hub →](https://artifacthub.io/packages/helm/oneuptime/oneuptime)

> **既存のインストールをアップグレードしますか？** [アップグレードガイド](/App/FeatureSet/Docs/Content/en/installation/upgrading.md) を参照してください。

---

## ✨ すべてが揃っている

| | 機能 | できること |
|---|---|---|
| 📊 | **稼働監視** | 複数のグローバルリージョンからのウェブサイト、API、IP、ポート、SSL、DNS、シンセティックモニター。 |
| 📋 | **ステータスページ** | 美しくブランドを反映したステータスページ、インシデント履歴、計画メンテナンス、サブスクライバー通知。 |
| 🚨 | **インシデント管理** | 宣言、割り当て、周知、解決、ポストモーテムまで、エンドツーエンドのインシデントワークフロー。 |
| 📞 | **オンコールとアラート** | SMS、電話、プッシュ、メール、Slack アラートに対応したオンコールスケジュールとエスカレーションポリシー。 |
| 📝 | **ログ管理** | OpenTelemetry によるログの取り込み、保存、検索、アラート。 |
| 🔍 | **APM とトレース** | 遅いパスやボトルネックを見つける分散トレース、スパン、パフォーマンスダッシュボード。 |
| 📈 | **メトリクスとダッシュボード** | テレメトリを対象にしたカスタムダッシュボード — チームに必要なビューを構築。 |
| 🐛 | **エラートラッキング** | 完全なスタックトレース、コンテキスト、リリーストラッキングとともに例外を捕捉。 |
| ⚡ | **ワークフロー** | Slack、Jira、GitHub、Microsoft Teams、そして 5,000 以上のアプリと自動化・連携。 |
| 🤖 | **AI コパイロット** | ログ、トレース、メトリクスを横断して異常を見つけ、根本原因を突き止め、修正の PR を作成する常時稼働のエージェント。 |

### ⚡ 面倒な作業を自動化する

エスカレーション、チケット管理、通知を、ビジュアルなノーコードのキャンバス上で組み立てられます。カスタムコードを差し込むことも可能です。上記のインシデントでは、誰も手を動かすことなく、オンコールを呼び出し、Jira チケットを作成し、Slack に投稿しました。

![ワークフロー — インシデントエスカレーションのためのノーコード自動化キャンバス](/Home/Static/img/readme/workflows.png?raw=true)

### 🖥️ インフラ監視

コピー＆ペーストで導入できる **OpenTelemetry ベース** のエージェントを差し込むだけで、サービスが動作するあらゆる基盤を監視できます。すぐに使えるアラートテンプレートも同梱されています。

- **サーバーと VM** — Linux、macOS、Windows の CPU、メモリ、ディスク、ネットワーク、プロセス、ログ。[ドキュメント →](/App/FeatureSet/Docs/Content/en/telemetry/host-otel-collector.md)
- **Kubernetes** — 1 回の `helm install` で、ノード / Pod / コンテナ / クラスターのメトリクス、イベント、ログ、eBPF トレース、サービスマップを提供。[ドキュメント →](/App/FeatureSet/Docs/Content/en/telemetry/kubernetes-agent.md)
- **Docker** — 単一のエージェントがすべてのコンテナを自動検出し、メトリクスとログを送信。[ドキュメント →](/App/FeatureSet/Docs/Content/en/telemetry/docker-host.md)
- **Podman** — Podman の Docker 互換ソケットを介した、同じワンエージェントによる自動検出。[ドキュメント →](/App/FeatureSet/Docs/Content/en/telemetry/podman-host.md)
- **Proxmox** — ノード、VM、コンテナ、ストレージ、HA 状態、バックアップの網羅状況、レプリケーションの健全性。[ドキュメント →](/App/FeatureSet/Docs/Content/en/telemetry/proxmox.md)
- **Ceph** — クラスターの健全性、容量予測、OSD / プール / PG / モニターの可視化。[ドキュメント →](/App/FeatureSet/Docs/Content/en/telemetry/ceph.md)

---

## 💼 Community と Enterprise

| | **Community** | **Enterprise** |
|---|---|---|
| **こんな方に** | セルフホスターと小規模チーム | プレミアムサポートを必要とする規制対象チーム |
| **費用** | 無料＆オープンソース | [営業に問い合わせ](mailto:sales@oneuptime.com) |
| **機能** | フル機能セット | フル機能セット + 堅牢化イメージ、優先サポート、カスタム機能、データレジデンシー |

---

## 💡 なぜ OneUptime なのか？

私たちのミッションはシンプルです。**ダウンタイムを減らし、より多くのプロダクトの成功を後押しする** こと。7 つものベンダーをつぎはぎするのではなく、なぜ障害が起きるのかを *理解* し、インシデントに素早く対応し、運用の負担を削減する助けとなるひとつのプラットフォームが手に入ります。完全にオープンソースなので、データもスタックもあなたのものです。

---

<a name="contributing"></a>

## 🤝 コントリビュート

大小を問わず、あらゆる貢献を歓迎します。まずはこちらから。

- 🐛 **[未解決の Issue](https://github.com/OneUptime/oneuptime/issues)** — ひとつ選んで取り組むか、[新しく起票](https://github.com/OneUptime/oneuptime/issues/new)してください
- ✅ コードベースの **[テスト作成を手伝う](https://github.com/OneUptime/oneuptime/issues?q=is%3Aopen+is%3Aissue+label%3A%22write+tests%22)**
- 🧑‍💻 環境構築のための **[ローカル開発ガイド](/App/FeatureSet/Docs/Content/en/installation/local-development.md)**
- 📖 **[コントリビューションガイドライン](/CONTRIBUTING.md)** を読む
- 💬 **[Developer Slack](https://join.slack.com/t/oneuptimedev/shared_invite/zt-17r8o7gkz-nITGan_PS9JYJV6WMm_TsQ)** または **[Community Slack](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA)** で私たちとチャット

## ❤️ プロジェクトを支援する

OneUptime がお役に立っているなら:

- ⭐ **このリポジトリにスターを** — 他の人が私たちを見つける助けに本当になります
- 💵 **[スポンサーになる](https://github.com/sponsors/OneUptime)** — いただいた 1 ドルごとが新機能の開発につながります
- 🛍️ **[グッズを手に入れる](https://shop.oneuptime.com)** — 収益はすべてオープンソース開発の資金になります

---

## 📄 ライセンス

OneUptime は [Apache License 2.0](/LICENSE) のもとでライセンスされています。

<div align="center">
  <sub><a href="https://oneuptime.com">OneUptime</a> チームと <a href="https://github.com/OneUptime/oneuptime/graphs/contributors">コントリビューター</a> が ❤️ を込めて制作しました。</sub>
</div>
