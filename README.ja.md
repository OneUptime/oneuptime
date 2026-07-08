<!-- markdownlint-disable MD033 MD041 -->
<p align="center">
  <a href="/README.md">English</a> ·
  <a href="/README.zh-CN.md">简体中文</a> ·
  <a href="/README.zh-TW.md">繁體中文</a> ·
  <a href="/README.ja.md">日本語</a> ·
  <a href="/README.ko.md">한국어</a> ·
  <a href="/README.es.md">Español</a> ·
  <a href="/README.fr.md">Français</a> ·
  <a href="/README.de.md">Deutsch</a> ·
  <a href="/README.pt.md">Português</a> ·
  <a href="/README.it.md">Italiano</a> ·
  <a href="/README.ru.md">Русский</a> ·
  <a href="/README.hi.md">हिन्दी</a> ·
  <a href="/README.nl.md">Nederlands</a> ·
  <a href="/README.da.md">Dansk</a> ·
  <a href="/README.sv.md">Svenska</a> ·
  <a href="/README.no.md">Norsk</a>
</p>

<div align="center">
  <a href="https://oneuptime.com">
    <img alt="OneUptime ロゴ" width="55%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/OneUptimePNG/7.png"/>
  </a>

  <h3>稼働監視、インシデント、オンコール、ステータスページ、ログ、トレース、メトリクス、APM のためのオープンソース統合プラットフォーム。</h3>

  <p>監視、ステータスページ、オンコール、インシデント、ログ、APM — 棚一杯の SaaS ツールを、無料でセルフホストできる一つのプラットフォームで置き換えましょう。</p>

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

  <a href="https://oneuptime.com"><b>🚀 OneUptime Cloud を試す — 永久無料プラン、クレジットカード不要 →</b></a>
</div>

<br/>

<div align="center">
  <img alt="OneUptime ダッシュボード" width="90%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/readme/monitoring.png"/>
</div>

---

## オブザーバビリティスタック全体を置き換える

OneUptime は、監視、アラート、インシデント対応、オブザーバビリティを一つのオープンソースアプリにまとめます — これにより、十数個もの個別ツールに料金を払い、それらをつなぎ合わせる作業から解放されます。

| 従来のツールの代わりに… | OneUptime で… |
|---|---|
| Pingdom / UptimeRobot | **稼働監視** — ウェブサイト、API、ping、ポート、SSL、DNS、および世界中からの合成監視チェック |
| StatusPage.io | **ステータスページ** — 購読者に対応したブランド付きの公開・非公開ステータスページ |
| PagerDuty / Opsgenie | **オンコールとアラート** — スケジュール、エスカレーションポリシー、SMS / 電話 / プッシュ / Slack |
| Incident.io | **インシデント管理** — 宣言、トリアージ、コミュニケーション、事後分析 |
| Datadog / New Relic | **APM とメトリクス** — トレース、ダッシュボード、サービスパフォーマンス |
| Loggly | **ログ管理** — ログの収集、検索、アラート |
| Sentry | **エラートラッキング** — 完全なスタックトレースとコンテキスト付きの例外 |

これらすべてが **100% オープンソース（Apache 2.0）** であり、無料でセルフホストできます。

---

<a name="quick-start"></a>

## ⚡ クイックスタート

### ☁️ OneUptime Cloud — 手軽な方法

セットアップ不要、常に最新の状態で、オープンソースプロジェクトの資金にもなります。

**→ [oneuptime.com で無料登録](https://oneuptime.com)**

### 🐳 Docker Compose でセルフホスト

必要なものすべてを単一のサーバー（Debian / Ubuntu / RHEL、Docker + Docker Compose）で。ホームラボや小規模チームに最適 — Raspberry Pi でも動作します。

```bash
# 1. Clone the release branch
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# 2. Create your config (then edit it — set strong, random secrets!)
cp config.example.env config.env

# 3. Start everything
npm start
```

OneUptime が **http://localhost** で稼働します — 開いて、最初のアカウントを作成しましょう。

📖 詳細ガイド: [Docker Compose インストール](/App/FeatureSet/Docs/Content/en/installation/docker-compose.md) · [サイジングと要件](/App/FeatureSet/Docs/Content/en/installation/sizing.md)

### ☸️ Helm を使った Kubernetes — 本番環境向け

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm install oneuptime oneuptime/oneuptime
```

📖 完全なインストール手順と values は [Artifact Hub →](https://artifacthub.io/packages/helm/oneuptime/oneuptime)

> **既存のインストールをアップグレードしますか？** [アップグレードガイド](/App/FeatureSet/Docs/Content/en/installation/upgrading.md) をご覧ください。

---

## ✨ 機能

| | 機能 | 内容 |
|---|---|---|
| 📊 | **稼働監視** | 複数のグローバルリージョンからの、ウェブサイト、API、IP、ポート、SSL、DNS、および合成監視。 |
| 📋 | **ステータスページ** | 美しいブランド付きステータスページ、インシデント履歴、計画メンテナンス、購読者通知。 |
| 🚨 | **インシデント管理** | エンドツーエンドのインシデントワークフロー: 宣言、割り当て、コミュニケーション、解決、事後分析の実施。 |
| 📞 | **オンコールとアラート** | SMS、電話、プッシュ、メール、Slack アラートに対応したオンコールスケジュールとエスカレーションポリシー。 |
| 📝 | **ログ管理** | OpenTelemetry を介したログの取り込み、保存、検索、アラート。 |
| 🔍 | **APM とトレース** | 分散トレース、スパン、パフォーマンスダッシュボードで、遅い経路やボトルネックを発見。 |
| 📈 | **メトリクスとダッシュボード** | テレメトリを対象としたカスタムダッシュボード — チームに必要なビューを構築。 |
| 🐛 | **エラートラッキング** | 完全なスタックトレース、コンテキスト、リリーストラッキング付きで例外を捕捉。 |
| ⚡ | **ワークフロー** | Slack、Jira、GitHub、Microsoft Teams、その他 5,000 以上のアプリと自動化・連携。 |
| 🤖 | **AI コパイロット** | ログ、トレース、メトリクス全体で異常を発見し、根本原因を突き止め、修正の PR を作成する常時稼働のエージェント。 |

### 🖥️ インフラ監視

コピー&ペーストするだけの **OpenTelemetry ベース** のエージェントを導入して、サービスが動作するあらゆる基盤を監視 — すぐに使えるアラートテンプレートも同梱:

- **サーバーと VM** — Linux、macOS、Windows からの CPU、メモリ、ディスク、ネットワーク、プロセス、ログ。[ドキュメント →](/App/FeatureSet/Docs/Content/en/telemetry/host-otel-collector.md)
- **Kubernetes** — 一度の `helm install` で、ノード / ポッド / コンテナ / クラスタのメトリクス、イベント、ログ、eBPF トレースおよびサービスマップを提供。[ドキュメント →](/App/FeatureSet/Docs/Content/en/telemetry/kubernetes-agent.md)
- **Docker** — 単一のエージェントがすべてのコンテナを自動検出し、メトリクスとログを送信。[ドキュメント →](/App/FeatureSet/Docs/Content/en/telemetry/docker-host.md)
- **Podman** — Podman の Docker 互換ソケットを介した、同じ 1 エージェントによる自動検出。[ドキュメント →](/App/FeatureSet/Docs/Content/en/telemetry/podman-host.md)
- **Proxmox** — ノード、VM、コンテナ、ストレージ、HA 状態、バックアップ範囲、レプリケーション健全性。[ドキュメント →](/App/FeatureSet/Docs/Content/en/telemetry/proxmox.md)
- **Ceph** — クラスタの健全性、容量予測、および OSD / プール / PG / モニターの可視化。[ドキュメント →](/App/FeatureSet/Docs/Content/en/telemetry/ceph.md)

<details>
<summary><b>📸 スクリーンショットを見る</b></summary>
<br/>

**稼働監視**
![Monitoring](/Home/Static/img/readme/monitoring.png?raw=true)

**ステータスページ**
![Status Pages](/Home/Static/img/readme/statuspages.png?raw=true)

**インシデント管理**
![Incident Management](/Home/Static/img/readme/incident-management.png?raw=true)

**オンコールとアラート**
![On Call and Alerts](/Home/Static/img/readme/on-call.png?raw=true)

**ログ管理**
![Logs Management](/Home/Static/img/readme/logs-management.png?raw=true)

**アプリケーションパフォーマンス監視**
![APM](/Home/Static/img/readme/apm.png?raw=true)

**ワークフロー**
![Workflows](/Home/Static/img/readme/workflows.png?raw=true)

</details>

---

## 💼 コミュニティ版とエンタープライズ版

| | **コミュニティ版** | **エンタープライズ版** |
|---|---|---|
| **最適な対象** | セルフホスターと小規模チーム | プレミアムサポートを必要とする規制対象チーム |
| **費用** | 無料・オープンソース | [営業に問い合わせ](mailto:sales@oneuptime.com) |
| **機能** | フル機能セット | フル機能セット + 堅牢化されたイメージ、優先サポート、カスタム機能、データレジデンシー |

---

## 💡 なぜ OneUptime なのか？

私たちの使命はシンプルです: **ダウンタイムを減らし、より多くのプロダクトを成功へと導くこと。** 7 つものベンダーを継ぎ接ぎする代わりに、障害が起きる *理由* を理解し、インシデントに迅速に対応し、運用の手間を削減できる一つのプラットフォームが手に入ります — 完全にオープンソースなので、データとスタックはあなた自身のものです。

---

<a name="contributing"></a>

## 🤝 コントリビュート

私たちはあらゆる規模のコントリビューションを歓迎します。ここから始めましょう:

- 🐛 **[オープンな issue](https://github.com/OneUptime/oneuptime/issues)** — 一つ手に取るか、[新しく登録](https://github.com/OneUptime/oneuptime/issues/new)しましょう
- ✅ コードベースの **[テスト作成を手伝う](https://github.com/OneUptime/oneuptime/issues?q=is%3Aopen+is%3Aissue+label%3A%22write+tests%22)**
- 🧑‍💻 環境構築のための **[ローカル開発ガイド](/App/FeatureSet/Docs/Content/en/installation/local-development.md)**
- 📖 **[コントリビューションガイドライン](CONTRIBUTING.md)** を読む
- 💬 **[開発者向け Slack](https://join.slack.com/t/oneuptimedev/shared_invite/zt-17r8o7gkz-nITGan_PS9JYJV6WMm_TsQ)** または **[コミュニティ Slack](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA)** で私たちと話しましょう

## ❤️ プロジェクトを応援する

OneUptime がお役に立てたなら:

- ⭐ **このリポジトリにスターを** — 他の人が私たちを見つける助けになります
- 💵 **[スポンサーになる](https://github.com/sponsors/OneUptime)** — いただいた 1 ドルごとに新機能が生まれます
- 🛍️ **[グッズを手に入れる](https://shop.oneuptime.com)** — 収益はすべてオープンソース開発に充てられます

---

## 📄 ライセンス

OneUptime は [Apache License 2.0](LICENSE) の下でライセンスされています。

<div align="center">
  <sub>Made with ❤️ by the <a href="https://oneuptime.com">OneUptime</a> team and <a href="https://github.com/OneUptime/oneuptime/graphs/contributors">contributors</a>.</sub>
</div>
