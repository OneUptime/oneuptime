# Kubernetes と Helm

Helm チャートを使って、自分の Kubernetes クラスターで OneUptime を動かします。このページは OneUptime サーバー自身が配信しているため、インターネットに出られなくても開け、実行中のバージョンのチャートについて説明しています。チャートが受け付ける値はすべて、[Artifact Hub](https://artifacthub.io/packages/helm/oneuptime/oneuptime) にあるチャート自身のドキュメントに載っています。

:::cards
- [チャートをインストールする](#チャートをインストールする): 値ファイル 1 つとコマンド 2 つ。
- [データをバックアップする](#データをバックアップする): PostgreSQL と ClickHouse を、クラスターの外のストレージへ。
- [キーを保管する](#キーを保管する): これがないとバックアップを読めないもの。
:::

## チャートをインストールする

利用者が使うドメイン名または IP アドレスを `http://` なしで書いた `values.yaml` を作成します:

```yaml title="values.yaml"
host: oneuptime.example.com
```

次にチャートをインストールします:

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime -f values.yaml
```

**うまくいったかどうか:** `kubectl get pods` がすべての Pod を `Running` と表示し、そのアドレスで OneUptime が開けば完了です。その先は [セルフホスティングガイド](/docs/installation/self-hosting-guide) に続きます: HTTPS、管理者アカウント、そしてメール、SMS、電話。

## データをバックアップする

OneUptime はデータをクラスターの永続ボリュームに保存します。PostgreSQL にはプロジェクト、モニター、インシデント、ステータスページ、ユーザーが、ClickHouse にはログ、トレース、メトリクスが入っています。次のいずれかの方法で、両方をクラスターの外のストレージにバックアップしてください:

- **エンタープライズ版のスケジュールバックアップ。** Admin Dashboard の **設定 > バックアップ** で設定します。[バックアップ](/docs/installation/backups) を参照してください。
- **クラウドプロバイダーによる永続ボリュームのバックアップ**。たとえば PostgreSQL と ClickHouse のディスクの定期スナップショットです。
- **CloudNativePG のボリュームスナップショットバックアップ**。PostgreSQL が CloudNativePG オペレーターで動いている場合に使えます。`values.yaml` で有効にしてから、変更を適用します:

```yaml title="values.yaml"
postgresOperator:
  cnpg:
    enabled: true
    backup:
      enabled: true
      schedule: "0 0 3 * * *"
```

```bash
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

このスケジュールでは、PostgreSQL が毎日 03:00 にバックアップされます。CloudNativePG は古いボリュームスナップショットを削除しないため、不要になったものは自分で削除してください。

OneUptime は、OneUptime の外で作られたバックアップを確認できません。バックアップが動き始めたら、Admin Dashboard の **サーバーの設定** ページで、バックアップの項目にある **このサーバーはバックアップされています** をクリックしてください。

## キーを保管する

OneUptime が暗号化したものは、暗号化に使った `encryptionSecret` でしか読めません。アップグレードで置き換えられないよう、`oneuptimeSecret` と `encryptionSecret` は `values.yaml` で自分で設定し、コピーをバックアップと一緒にクラスターの外に保管してください:

```yaml title="values.yaml"
oneuptimeSecret: <random string>
encryptionSecret: <random string>
```

## 次のステップ

:::cards
- [セルフホスティングガイド](/docs/installation/self-hosting-guide): 空のクラスターから、呼び出しを送れるサーバーまで。
- [アップグレード](/docs/installation/upgrading): アップグレードの前には必ずバックアップを取ります。
- [バックアップ](/docs/installation/backups): エンタープライズ版のスケジュールバックアップ。
:::
