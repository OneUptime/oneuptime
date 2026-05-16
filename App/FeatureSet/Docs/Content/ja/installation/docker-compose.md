# Docker Compose で OneUptime を完全無料でデプロイする

独自のサーバーで OneUptime をホストしたい場合、Docker Compose を使用して Debian、Ubuntu、または RHEL 上にシングルサーバーインスタンスをデプロイできます。このオプションでは、インスタンスをより細かく制御してカスタマイズできますが、デプロイとメンテナンスにはより高い技術スキルとリソースが必要です。

#### システム要件の選択
使用状況と予算に応じて、サーバーに異なるシステム要件を選択できます。最適なパフォーマンスのために、以下での OneUptime の使用をお勧めします。

- **推奨システム要件**
  - 16GB RAM
  - 8 コア
  - 400 GB ディスク
  - Ubuntu 22.04
  - Docker および Docker Compose インストール済み
- **ホームラボ / 最小要件**
  - 個人利用や実験的な使用（一部のユーザーは RaspberryPi にインストールしています）のために OneUptime をホームラボで実行したい場合は、最小要件を使用できます:
    - 8 GB RAM
    - 4 コア
    - 20 GB ディスク
    - Docker および Docker Compose インストール済み


#### シングルサーバーデプロイの前提条件

インストールチュートリアル: [https://youtu.be/j1SWmMW2oL4](https://youtu.be/j1SWmMW2oL4)

デプロイプロセスを開始する前に、以下を確認してください。

- Debian、Ubuntu、または RHEL 系を実行しているサーバー
- サーバーに Docker および Docker Compose がインストールされていること

OneUptime をインストールするには:

```
# リリースブランチのみでリポジトリをクローンして cd で移動します。
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# config.example.env を config.env にコピーします
cp config.example.env config.env

# 重要: config.env ファイルを編集してください。ランダムなシークレットが設定されていることを確認してください。

npm start
```

npm を使用したくない場合またはインストールされていない場合は、代わりに以下を実行します。

```
# config.env ファイルから環境変数を読み込み、docker compose up を実行します。
(export $(grep -v '^#' config.env | xargs) && docker compose up --remove-orphans -d)

# ポートバインディングに関する権限の問題がある場合は sudo を使用します。
sudo bash -c "(export $(grep -v '^#' config.env | xargs) && docker compose up --remove-orphans -d)"
```


### OneUptime へのアクセス

OneUptime は http://localhost で実行されます。使用を開始するには、インスタンスの新しいアカウントを登録する必要があります。

### TLS/SSL 証明書のセットアップ

OneUptime は SSL/TLS 証明書のセットアップを**サポートしていません**。SSL/TLS 証明書は独自に設定する必要があります。

SSL/TLS 証明書を使用する必要がある場合は、以下の手順に従ってください。

1. Nginx や Caddy などのリバースプロキシを使用します。
2. Let's Encrypt を使用して証明書をプロビジョニングします。
3. リバースプロキシを OneUptime サーバーにポイントします。
4. 以下の設定を更新します。
   - `HTTP_PROTOCOL` 環境変数を `https` に設定します。
   - `HOST` 環境変数をリバースプロキシがホストされているサーバーのドメイン名に変更します。

## 本番環境の準備チェックリスト

本番環境での docker-compose による OneUptime のデプロイは推奨しません。Kubernetes の使用を強くお勧めします。OneUptime の Helm チャートは[こちら](https://artifacthub.io/packages/helm/oneuptime/oneuptime)で提供されています。

それでも docker-compose で本番環境に OneUptime をデプロイしたい場合は、以下を考慮してください。

- **SSL/TLS**: SSL/TLS 証明書を設定してください。OneUptime は SSL/TLS 証明書のセットアップをサポートしていません。独自に設定する必要があります。上記を参照してください。
- **シークレット**: `config.env` ファイルにランダムなシークレットがあることを確認してください。そのファイルにはいくつかのデフォルトシークレットがあります。ランダムな長い文字列に置き換えてください。
- **バックアップ**: データベース（Clickhouse、Postgres）を定期的にバックアップしてください。Redis はキャッシュとして使用されており、ステートレスなので安全に無視できます。
- **更新**: OneUptime を定期的に更新してください。毎日アップデートをリリースしています。本番環境で実行している場合は、少なくとも週に 1 回はソフトウェアを更新することをお勧めします。

### OneUptime の更新

更新するには:

```
git checkout release # リリースブランチにいることを確認してください。
git pull
npm run update
```

### 注意事項

- Docker のセットアップでは、ローカルロギングドライバーを使用しています。OneUptime、特にプローブとインジェストコンテナは大量のログを生成します。ストレージが満杯になるのを防ぐために、Docker のロギングストレージを制限することが重要です。詳細な手順については、[こちら](https://docs.docker.com/config/containers/logging/local/)の公式 Docker ドキュメントを参照してください。


### OneUptime のアンインストール

OneUptime をアンインストールするには、以下のコマンドを実行します。

```
npm run down
```

これにより、OneUptime によって作成されたすべてのコンテナ、ネットワーク、ボリュームが停止され削除されます。`config.env` ファイルやクローンされたリポジトリは削除されません。
