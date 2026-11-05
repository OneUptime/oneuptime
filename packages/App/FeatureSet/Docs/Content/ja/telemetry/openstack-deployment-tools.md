# デプロイツール別の OpenStack

「OpenStack」そのものを運用している人はいません。実際に運用しているのは OpenStack をデプロイするツールであり、ツールごとにパス、ログ、すでに動いているものの捉え方が異なります。このページは、OneUptime のセットアップガイドが各ツールについて案内する内容です。**OpenStack → すべてのクラウド** を開き、クラウドを接続して、**OpenStack をどのようにデプロイしていますか？** に答えてください。

:::cards
- [各ガイドの検証範囲](#各ガイドの検証範囲): 最初にお読みください。Kolla-Ansible と OpenStack-Ansible のガイドは、実環境で実行済みです。その他は未実行です。
- [すでに発火しているアラートを転送する](#すでに発火しているアラートを転送する): エージェントなしで、最初の 1 時間からインシデントを作成します。
- [Kolla-Ansible](#kolla-ansible): すでに動いているエクスポーターを読み取ります。
- [OpenStack-Ansible](#openstack-ansible): Journald のログと、`user_variables.yml` の上書き設定。
- [OpenStack-Helm](#openstack-helm): Atmosphere にも使える、プローブと Kubernetes エージェント。
- [Canonical Sunbeam](#canonical-sunbeam): Canonical Observability Stack。
- [Red Hat OpenStack on OpenShift](#red-hat-openstack-on-openshift): OpenShift プリセットと Ceilometer。
- [Mirantis MOSK](#mirantis-mosk): StackLight のアラート。
- [すでに動かしているエクスポーターを使う](#すでに動かしているエクスポーターを使う): 1.7.0 でページに表示されないもの。
:::

## 各ガイドの検証範囲

以下のパス、ポート、変数はすべて、各ツール自身のソースまたはドキュメントから読み取ったものです。OneUptime のフィクスチャを記録する検証環境は、CI ランナー上に Kolla-Ansible と OpenStack-Ansible もデプロイし、各ガイドのコマンドをそこで実行します。その際、エージェントが送る内容を保持する OneUptime の代役を使っています。そのため、各ツールの実際のデプロイから稼働中の OneUptime に報告した実績のあるガイドは、ここには 1 つもありません。それぞれ何に対して確認したかは次のとおりです。

| ツール | 読み取り元 | 実際に実行したもの |
| --- | --- | --- |
| Kolla-Ansible | master と `stable/2026.1` のソース | `stable/2026.1` の Open vSwitch 構成の実際の all-in-one で、このガイドのコマンドを実行: 各クレデンシャルでのエージェント(Docker なし)、Kolla-Ansible 自身のエクスポーターと、固定バージョンおよび 1.7.0 での自前のエクスポーター、実際の `prometheus.yml` から読み取ったターゲット、ログプロファイル。一点だけうまくいかなかった点がある: Memcached と nova-compute を停止しても Alertmanager は何も送信しなかったため、Kolla-Ansible のスタックから OneUptime へアラートが届いたことはない。固定されているバージョンの Alertmanager が送信する内容をテストクラスターで記録したものは、稼働中の OneUptime で正しいクラウドのインシデントを作成し、解決した |
| OpenStack-Ansible | ソースとドキュメント | `stable/2026.1` の実際の all-in-one(LXC コンテナ)で、このガイドのコマンドを実行: 最初のクレデンシャルでのエージェント、二つ目のクレデンシャルでのエクスポーター(ポリシーのオーバーライド付き)、RabbitMQ と HAProxy の設定(エージェントがそれぞれを読み取る)、ジャーナルに対するログプロファイル |
| OpenStack-Helm | チャートの values | プローブと Kubernetes エージェントを、それぞれ単独で |
| Atmosphere | ドキュメントとソース | プローブと Kubernetes エージェントを、それぞれ単独で |
| Canonical Sunbeam | Canonical のドキュメントと、チャームのソース | Sunbeam 上では何も実行していない。Sunbeam 自身のドキュメントには、エクスポーターのチャームについての記載がない |
| Red Hat OpenStack on OpenShift | Telemetry Operator のソース | OpenShift プリセットと Ceilometer のエクスポーターを、それぞれ単独で |
| Mirantis MOSK | Mirantis のドキュメント。例には Webhook ではなく他のレシーバーが載っている | MOSK 上では何も実行していない |

各ガイドで**誰が何をしたか**が有効にするものは、検証環境が実行するすべてのリリースの DevStack で記録したもので、これらのツール上ではありません。各ツールでの設定方法は、そのツールのソースまたはドキュメントから読み取りました。

これらとは別に、Docker Compose が起動するのと同じ方法で起動し、アプリとプローブをこのコードからビルドした稼働中の OneUptime で、全体の流れを実行しました。これもこれらのツールではなく、実際の DevStack を使っています。ドキュメントのコマンドでインストールしたエージェントは、最初のデータからクラウドを登録し、すべてのインスタンス、ボリューム、ハイパーバイザーに、クラウド自身が返したステータスの行ができました。`nova-compute` を実際に停止すると、その行はダウンになり、Compute Service Down テンプレートのモニターが 746 秒後にホストを名指しするインシデントを 1 件作成し、サービスの再開から 48 秒後に解決しました。プロジェクトのプローブは、ダッシュボード自身のルートを通じて同じクラウドを接続して行を読み戻し、署名付きの起動で生じた 114 個のスパンが、トレースプロファイルを通じて各サービスから届きました。

また別に、実際のエージェントと実際の Alertmanager が送った内容を、DevStack とテストクラスターで記録しました。これらはこれらのツールがデプロイしたクラウドではありません。稼働中の OneUptime に送ると、発火の Webhook は正しいクラウドにのみインシデントを 1 件作成し、同じ Webhook をもう一度送っても何も作成されず、解決の Webhook でそのインシデントが解決されました。

## すでに発火しているアラートを転送する

Alertmanager があるツールなら、今日からインシデントを作成できます。発火したアラートがインシデントになり、最初の 1 時間からオンコールとステータスページが使え、アラートが解消すれば自動的に解決されます。インストールするものはなく、このページのほかの内容と併用できます。

:::steps
### モニターを作成する

[Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager#モニターでアラートを受け取る) の説明に従って Incoming Request モニターを作成し、その**ハートビート URL**をコピーします。これが、後述する各ツールのレシーバーにある `<secret key>` のアドレスです。

### クラウドに関連付ける

モニターの**概要 → リンクされたリソース** を開き、OpenStack クラウドを追加します。すると各インシデントは、そのクラウドの**インシデント**ページに表示されます。Incoming Request モニター自体の設定にはクラウドを指定する項目がないため、各クラウドの Alertmanager ごとに専用のモニターが必要です。クラウドは最初のデータが届くとこの一覧に表示されるので、以下の手順を終えてから行うか、先に **OpenStack → すべてのクラウド** でクラウドを追加してください。
:::

Alertmanager が正確にこの形式で送信する様子は、Kolla-Ansible が固定しているバージョンで `Tests/Ops/openstack-e2e` に記録してあります。この記録は実際の評価器で再生され、アラートごとに 1 件のインシデントが作成され、それぞれの `resolved` ステータスで解決されます。

## Kolla-Ansible

`/etc/kolla/globals.yml` で `enable_prometheus` を有効にすると(設定するまで Kolla-Ansible は無効のままです)、Prometheus、Alertmanager、およびクラウドの土台となる各要素用のエクスポーターが動作しますが、アラートルールは同梱されていません。このガイドは、2 つ目のコピーを起動するのではなく、それらが動かしているものを読み取ります。

### Kolla-Ansible で発火しているアラートを転送する

独自のルールを書いた場合のみ必要です。Kolla-Ansible はルールを同梱していないため、`/etc/kolla/config/prometheus/*.rules` にルールを置くまで何も発火しません。デプロイ元のホストで、Kolla-Ansible が自身の設定の代わりに読み込む `/etc/kolla/config/prometheus/prometheus-alertmanager.yml` を作成して、適用します。

```yaml title="/etc/kolla/config/prometheus/prometheus-alertmanager.yml"
global:
  resolve_timeout: 5m
route:
  receiver: oneuptime
  group_by: ["alertname", "instance"]
  group_wait: 10s
  group_interval: 5m
  repeat_interval: 3h
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/<secret key>"
        send_resolved: true
templates:
  - '/etc/prometheus/*.tmpl'
```

```bash
kolla-ansible reconfigure -i <inventory> --tags prometheus
```

### Kolla-Ansible のクレデンシャル

`kolla-ansible post-deploy` が書き出す `source /etc/kolla/admin-openrc.sh` で、admin としてログインします。

- **フルビュー**では、Cinder に 1 つ変更が必要です。Kolla-Ansible のテンプレートは、Nova、Neutron、Glance、Placement の `[keystone_authtoken]` に `service_type` をすでに設定していますが、Cinder は `volume` としており、カタログでは `block-storage` です。keystonemiddleware は、アクセスルールで制限されたクレデンシャルを、この 2 つが一致しない限り `401` で拒否します。`/etc/kolla/config/cinder.conf` の `[keystone_authtoken]` に `service_type = block-storage` を追加し、`kolla-ansible reconfigure -i <inventory> --tags cinder` を実行してください。
- **インフラのみ**では、上書き設定を `/etc/kolla/config/nova/policy.yaml` に置きます。`neutron`、`keystone`、`placement` も同様で、すでにあるものとマージされます。`kolla-ansible reconfigure -i <inventory> --tags nova,neutron,keystone,placement` で適用します。

### Kolla-Ansible のクラウドの土台を監視する

Kolla-Ansible の Prometheus を実行しているホストで、次のコマンドは Kolla-Ansible が生成したファイルからターゲットを読み取り、エージェント用の設定として出力します。

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/control-plane-targets.py
sudo cat /etc/kolla/prometheus-server/prometheus.yml | python3 control-plane-targets.py --region RegionOne
```

出力された内容をエージェントの `.env` に追加し、エージェントのフォルダーで `docker compose up -d` を実行します。各エクスポーターは API ネットワークで待ち受けているため、エージェントのマシンからそこへの経路が必要です。その後、クラウドの**コントロールプレーン**カードに各エクスポーターの状態が表示され、監視されていないものははっきりと示されます。

| 読み取り対象 | ポート | 設定 |
| --- | --- | --- |
| RabbitMQ の Prometheus プラグイン | `15692` | `OPENSTACK_RABBITMQ_TARGETS` |
| mysqld_exporter | `9104` | `OPENSTACK_MARIADB_TARGETS` |
| memcached_exporter | `9150` | `OPENSTACK_MEMCACHED_TARGETS` |
| HAProxy 自身のエクスポーター | `9101` | `OPENSTACK_HAPROXY_TARGETS` |
| OVN と Open vSwitch 用の openstack-network-exporter | `1981` | `OPENSTACK_NETWORK_EXPORTER_TARGETS` |
| prometheus-libvirt-exporter | `9177` | `OPENSTACK_LIBVIRT_HEALTH_TARGETS` |

- **OVN のデータベース:** Kolla-Ansible は 2026.1 から openstack-network-exporter を実行しますが、対象はコンピュートノードとネットワークノードだけで、OVN のデータベースは、それが動作するホストから読み取ります。コントロールノードがどちらでもない場合は、インベントリの `[prometheus-openstack-network-exporter:children]` にそれらを追加して reconfigure してください。そうしないと、Northbound と Southbound のデータベースは監視されていないと表示されます。
- **2026.1 より前**にはネットワークエクスポーターがないため、OVN と Open vSwitch は監視されていないと表示されます。

### Kolla-Ansible のサービスログ

エージェントのログプロファイルは各ノードで動作し、Kolla-Ansible のファイルを読み取ります。これによって、ログの行がクラウドのページと結び付けられます。

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/install-logs.sh
sudo bash install-logs.sh files
```

Kolla 自身の Fluentd からも転送できます。[Fluentd](/docs/telemetry/fluentd) の説明のとおり `/etc/kolla/config/fluentd/output/*.conf` に出力設定を置きますが、その記録はサービス名で**ログ**に届き、クラウドのページには表示されません。

### Kolla-Ansible で誰が何をしたか

Keystone の監査証跡と各 API の監査フィルターを、[セキュリティイベント](/docs/telemetry/openstack#誰が何をしたか)に取り込みます。どちらもサービス自身のログに書き込まれ、バスに消費者はいません。OneUptime は、**セキュリティイベント → 接続**で**ログからセキュリティイベントを見つける**を有効にすると、そこから読み取ります。エージェントのログプロファイルは、どちらも `/var/log/kolla` から読み取ります。

```ini title="/etc/kolla/config/keystone.conf"
[DEFAULT]
notification_format = cadf
notification_opt_out = identity.authenticate.pending

[oslo_messaging_notifications]
driver = log
```

```bash
kolla-ansible reconfigure -i <inventory> -t keystone
```

これでログインのたびに 1 行が出力され、**新しいアドレスから OpenStack の admin クレデンシャルが使用された**検知がそれを読み取ります。失敗したログインだけを出力するには、`notification_opt_out` に `identity.authenticate.success` を追加します。すると、その検知は監査フィルターが見た内容を読み取ります。

Nova、Neutron、Cinder、Glance で誰が何をしたかを記録するには、監査フィルターに設定が必要で、これはすべてのサービスの設定に一度に入れます。

```ini title="/etc/kolla/config/global.conf"
[audit_middleware_notifications]
driver = log
```

```bash
kolla-ansible reconfigure -i <inventory> -t nova,neutron,cinder,glance
```

さらに paste ファイルも必要ですが、Kolla-Ansible の設定タスクはこれらのサービスに paste ファイルをコピーしません。各 API ホストに自分のものを置き、`globals.yml` の `nova_api_extra_volumes`、`neutron_server_extra_volumes`、`cinder_api_extra_volumes`、`glance_api_extra_volumes` で、イメージ内のものに重ねてマウントしてください。pyCADF のマップファイルは、イメージ内の `/var/lib/kolla/venv/etc/pycadf` にあります。フィルターの行は[誰が何をしたか](/docs/telemetry/openstack#監査フィルターをオンにする)にあります。

## OpenStack-Ansible

OpenStack-Ansible は各サービスのログを journald に保持し、独自の Prometheus は実行しません。そのためエージェントが入り口となり、ログには専用の経路があります。

### OpenStack-Ansible のクレデンシャル

ユーティリティコンテナから admin としてログインします。`lxc-attach -n $(lxc-ls -1 | grep utility | head -n 1)` を実行し、続けて `. ~/openrc` を実行します。ここには以下のコマンドが使う `curl` がないため、先に `apt-get install -y curl` を実行してください。

- **フルビュー**では、Cinder に 1 つ変更が必要です。OpenStack-Ansible のロールは、`[keystone_authtoken]` の `service_type` をすでに設定していますが、Cinder は `volumev3` としており、カタログでは `block-storage` です。keystonemiddleware は、アクセスルールで制限されたクレデンシャルを、この 2 つが一致しない限り `401` で拒否します。`/etc/openstack_deploy/user_variables.yml` の `cinder_cinder_conf_overrides` 内にある `keystone_authtoken` に `service_type: block-storage` を設定し、`openstack-ansible openstack.osa.cinder --tags cinder-config` を実行してください。
- **インフラのみ**では、上書き設定を `/etc/openstack_deploy/user_variables.yml` の `nova_policy_overrides`、`neutron_policy_overrides`、`keystone_policy_overrides`、`placement_policy_overrides` に置きます。`openstack-ansible openstack.osa.nova --tags nova-policy-override` のように、それぞれ専用のプレイブックとタグで適用します。後で 1 つを削除すると、ファイルがなくなるのではなく空のファイルが残るので、何も失敗しません。

### OpenStack-Ansible のクラウドの土台を監視する

OpenStack-Ansible はこれらのエクスポーターを実行しないため、有効にしたものだけが監視されます。

**RabbitMQ:** Prometheus プラグインを有効にしてから、各コンテナのアドレスの `15692` を、エージェントの `.env` に `OPENSTACK_RABBITMQ_TARGETS` として指定します。

```yaml title="/etc/openstack_deploy/user_variables.yml"
rabbitmq_plugins:
  - name: rabbitmq_management,rabbitmq_prometheus
    state: enabled
```

```bash
openstack-ansible openstack.osa.rabbitmq_server --tags rabbitmq-config
```

**HAProxy:** エクスポーターは無効で、stats リスナーは TLS 付きの `127.0.0.1` にあり、エージェントは読み取れません。エージェントが到達できる場所で有効にしてから、そのアドレスの `1936` を `OPENSTACK_HAPROXY_TARGETS` として指定します。

```yaml title="/etc/openstack_deploy/user_variables.yml"
haproxy_stats_enabled: true
haproxy_stats_prometheus_enabled: true
haproxy_stats_bind_address: <an address the agent can reach>
haproxy_stats_ssl: false
```

```bash
openstack-ansible openstack.osa.haproxy
```

**MariaDB と Memcached:** OpenStack-Ansible はどちらのエクスポーターも同梱していません。[mysqld_exporter](https://github.com/prometheus/mysqld_exporter) と [memcached_exporter](https://github.com/prometheus/memcached_exporter) を自分で実行して `OPENSTACK_MARIADB_TARGETS` と `OPENSTACK_MEMCACHED_TARGETS` に指定するか、指定しないままにしてください。指定しない場合、クラウドの**コントロールプレーン**カードには、正常ではなく監視されていないと表示されます。

### OpenStack-Ansible のサービスログ

サービスを実行する各ホストの journald から読み取ります。コンテナは自分のジャーナルをホストに渡します。

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/install-logs.sh
sudo bash install-logs.sh journald
```

これはエージェントのログプロファイルを systemd サービスとして実行し、OpenStack-Ansible のコンテナのジャーナルが届く `/var/log/journal/` を読み取ります。

### OpenStack-Ansible で誰が何をしたか

Keystone の監査証跡と各 API の監査フィルターを、[セキュリティイベント](/docs/telemetry/openstack#誰が何をしたか)に取り込みます。どちらもサービス自身のログに書き込まれ、バスに消費者はいません。OneUptime は、**セキュリティイベント → 接続**で**ログからセキュリティイベントを見つける**を有効にすると、そこから読み取ります。エージェントのログプロファイルは、どちらもジャーナルから読み取ります。

```yaml title="/etc/openstack_deploy/user_variables.yml"
keystone_keystone_conf_overrides:
  DEFAULT:
    notification_format: cadf
    notification_opt_out: identity.authenticate.pending
  oslo_messaging_notifications:
    driver: log
```

```bash
openstack-ansible openstack.osa.keystone
```

これでログインのたびに 1 行が出力され、**新しいアドレスから OpenStack の admin クレデンシャルが使用された**検知がそれを読み取ります。失敗したログインだけを出力するには、`notification_opt_out` に `identity.authenticate.success` を追加します。すると、その検知は監査フィルターが見た内容を読み取ります。`notification_opt_out` に 2 つ目の値を入れる場合は、[config_template](https://docs.openstack.org/ansible-config_template/latest/) が繰り返しキーを書く方法に従い、YAML のセットとして指定します。

Nova、Neutron、Cinder、Glance で誰が何をしたかを記録するには、各 API の conf overrides にフィルターの設定を、paste overrides にフィルター自体を入れます。`audit` は各パイプラインの `authtoken` の直後、およびそれに続くコンテキストフィルターの前に置きます。次は Nova の例で、Neutron は `neutron_neutron_conf_overrides` と `neutron_api_paste_ini_overrides`、Cinder は `cinder_cinder_conf_overrides` と `cinder_api_paste_ini_overrides`、Glance は `glance_glance_api_conf_overrides` と `glance_glance_api_paste_ini_overrides` に同じように入れます。

```yaml title="/etc/openstack_deploy/user_variables.yml"
nova_nova_conf_overrides:
  audit_middleware_notifications:
    driver: log
nova_api_paste_ini_overrides:
  "filter:audit":
    paste.filter_factory: keystonemiddleware.audit:filter_factory
    audit_map_file: "/openstack/venvs/nova-{{ nova_venv_tag }}/etc/pycadf/nova_api_audit_map.conf"
```

```bash
openstack-ansible openstack.osa.nova
```

## OpenStack-Helm

OpenStack-Helm は Prometheus、Alertmanager、エクスポーターのチャートを提供していますが、それらを実行するかどうかはあなた次第です。コントロールプレーンは Kubernetes 上で動作するため、プローブが API を読み取り、Kubernetes エージェントがポッドを監視します。

### OpenStack-Helm で発火しているアラートを転送する

prometheus-alertmanager チャートを実行している場合は、チャートの values の `conf.alertmanager` にレシーバーを追加し、ルートをそこに向けます。

```yaml title="prometheus-alertmanager values"
conf:
  alertmanager: |
    global:
      resolve_timeout: 5m
    route:
      receiver: oneuptime
      group_by: ["alertname", "instance"]
    receivers:
      - name: oneuptime
        webhook_configs:
          - url: "https://oneuptime.com/heartbeat/<secret key>"
            send_resolved: true
```

### OpenStack-Helm で API を読み取り、ポッドを監視する

**OpenStack → すべてのクラウド** を開いて**クラウドを接続**をクリックし、Keystone のアドレス、アプリケーションクレデンシャル、使用するプローブを指定します。プローブがクラウドと通信するのは HTTPS のみです。続いて、チャートが動作するクラスターについて **Kubernetes → ドキュメント**に従ってください。ポッド、そのログ、ノードが Kubernetes のページに表示されます。

これらのサービスのログをこのクラウドの**ログ**ページにも表示し、スタックトレースを 1 件のレコードにまとめるには、サービスが動作する名前空間とともに、エージェントの values にクラウド名を指定します。

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### OpenStack-Helm で誰が何をしたか

Keystone の監査証跡と各 API の監査フィルターを、[セキュリティイベント](/docs/telemetry/openstack#誰が何をしたか)に取り込みます。どちらもサービス自身のログに書き込まれ、バスに消費者はいません。OneUptime は、**セキュリティイベント → 接続**で**ログからセキュリティイベントを見つける**を有効にすると、そこから読み取ります。Kubernetes エージェントは、values で指定したクラウドについて、どちらもポッドのログから読み取ります。

```yaml title="keystone's values.yaml"
conf:
  keystone:
    DEFAULT:
      notification_format: cadf
      notification_opt_out: identity.authenticate.pending
    oslo_messaging_notifications:
      driver: log
```

これでログインのたびに 1 行が出力され、**新しいアドレスから OpenStack の admin クレデンシャルが使用された**検知がそれを読み取ります。失敗したログインだけを出力するには、`notification_opt_out` に `identity.authenticate.success` を追加します。すると、その検知は監査フィルターが見た内容を読み取ります。

チャートの `logging.conf` はルートロガーを `WARNING` のままにしており、ログドライバーは専用のロガーの下に書き込むため、そのロガーを用意しないと何も書き込まれません。values のリストはチャートのリストを置き換えるので、`keys` にはチャートにあるものに加えて次を入れます。

```yaml title="keystone's values.yaml"
conf:
  logging:
    loggers:
      keys:
        - root
        - keystone
        - notifications
    logger_notifications:
      level: INFO
      handlers:
        - stdout
      qualname: oslo.messaging.notification
      propagate: 0
```

Nova、Neutron、Cinder で誰が何をしたかを記録する場合、それらのチャートの `conf.paste` には各パイプラインに監査フィルターがすでにあり、書き込み先を指定するだけです。それぞれ `conf.logging` に同じロガーが必要です。Glance のチャートにはマップはありますが、フィルターもパイプライン内のその置き場所もないため、その `conf.paste` に両方を追加してください。

```yaml title="nova's values.yaml"
conf:
  nova:
    audit_middleware_notifications:
      driver: log
```

## Atmosphere

Atmosphere は、独自のアラートルール付きの kube-prometheus-stack と、ログ用の Loki と Vector を実行します。まずそのアラートを転送し、次にプローブが API を読み取り、Kubernetes エージェントがポッドを監視します。

### Atmosphere で発火しているアラートを転送する

Atmosphere には実際に担当者を呼び出してきたアラートルールが同梱されているため、最初の 1 時間から機能します。すでにあるレシーバーと並べて Atmosphere の設定にレシーバーを追加し、デプロイします。

```yaml title="Atmosphere configuration"
kube_prometheus_stack_helm_values:
  alertmanager:
    config:
      route:
        receiver: oneuptime
      receivers:
        - name: oneuptime
          webhook_configs:
            - url: "https://oneuptime.com/heartbeat/<secret key>"
              send_resolved: true
```

### Atmosphere で API を読み取り、ポッドを監視する

**OpenStack → すべてのクラウド** を開いて**クラウドを接続**をクリックし、Keystone のアドレス、アプリケーションクレデンシャル、使用するプローブを指定します。プローブがクラウドと通信するのは HTTPS のみです。続いて、Atmosphere が動作するクラスターについて **Kubernetes → ドキュメント**に従ってください。

これらのサービスのログをこのクラウドの**ログ**ページにも表示し、スタックトレースを 1 件のレコードにまとめるには、サービスが動作する名前空間とともに、エージェントの values にクラウド名を指定します。

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### Atmosphere で誰が何をしたか

Keystone の監査証跡と各 API の監査フィルターを、[セキュリティイベント](/docs/telemetry/openstack#誰が何をしたか)に取り込みます。どちらもサービス自身のログに書き込まれ、バスに消費者はいません。OneUptime は、**セキュリティイベント → 接続**で**ログからセキュリティイベントを見つける**を有効にすると、そこから読み取ります。Kubernetes エージェントは、values で指定したクラウドについて、どちらもポッドのログから読み取ります。

```yaml title="your inventory's variables"
keystone_helm_values:
  conf:
    keystone:
      DEFAULT:
        notification_format: cadf
        notification_opt_out: identity.authenticate.pending
      oslo_messaging_notifications:
        driver: log
```

これでログインのたびに 1 行が出力され、**新しいアドレスから OpenStack の admin クレデンシャルが使用された**検知がそれを読み取ります。失敗したログインだけを出力するには、`notification_opt_out` に `identity.authenticate.success` を追加します。すると、その検知は監査フィルターが見た内容を読み取ります。

Nova、Neutron、Cinder で誰が何をしたかを記録する場合、Atmosphere がデプロイするチャートには各パイプラインに監査フィルターがすでにあり、`nova_helm_values`、`neutron_helm_values`、`cinder_helm_values` で書き込み先を指定するだけです。Glance のチャートにはフィルターもパイプライン内のその置き場所もないため、`glance_helm_values` の `conf.paste` に両方を追加してください。

```yaml title="your inventory's variables"
nova_helm_values:
  conf:
    nova:
      audit_middleware_notifications:
        driver: log
```

## Canonical Sunbeam

Sunbeam は `sunbeam enable observability embedded` で Canonical Observability Stack をデプロイできます。Canonical には `openstack-exporter` チャームもあり、実行していればエージェントがそれを読み取れます。Sunbeam 自身のドキュメントにはこのチャームの記載がなく、ここでは Sunbeam 上で何も実行していません。

### Sunbeam で発火しているアラートを転送する

Canonical Observability Stack を実行している場合は、その Alertmanager にレシーバーを含む設定を与えます。

```yaml title="alertmanager.yaml"
route:
  receiver: oneuptime
  group_by: ["alertname", "instance"]
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/<secret key>"
        send_resolved: true
```

```bash
juju config --model observability alertmanager config_file=@alertmanager.yaml
```

### エクスポーターのチャーム

Canonical の `openstack-exporter` チャームを実行している場合、エージェントは独自のクレデンシャルなしでそれを読み取れます。1 つのクラウドについて `/metrics` で応答し、`port` 設定を変更していなければポートは `9180` です。そのアドレスは `juju status openstack-exporter` で確認できます。

```bash
OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=<unit address>:9180 \
OPENSTACK_CONTROL_PLANE_REGION=RegionOne \
bash install.sh
```

どの系列が返るかは、そのスナップに含まれるエクスポーターのリリースによって異なり、ここでは記録していません。クラウドを読み取れているかどうかは `bash troubleshoot.sh` で確認できます。

### Sunbeam のサービスログ

observability を有効にすると、スタックの Loki にサービスのログが保存されます。OneUptime には Loki を読み取る手段がなく、エージェントのログプロファイルは Sunbeam のチャームでは試していないため、現時点ではここでログを収集するものはありません。

### Sunbeam で誰が何をしたか

まだ対応していません。Sunbeam のチャームは、各サービスの設定を独自のテンプレートから書き出し、Keystone のチャームには通知の送信先を指定する設定がありません。そのため、Keystone の監査証跡も監査フィルターも、チャームの外から有効にできず、ここからセキュリティイベントに届くものはありません。

## Red Hat OpenStack on OpenShift

Telemetry Operator は、Ceilometer の Prometheus エクスポーターと、OpenShift 上の Alertmanager を含む監視スタックを実行します。Kubernetes エージェントの OpenShift プリセットがコントロールプレーンを監視し、Ceilometer のエクスポーターがコンピュートノードの動作を伝えます。

### Red Hat OpenStack on OpenShift で発火しているアラートを転送する

`MetricStorage` で `alertingEnabled` が有効で、ルールを自分で書いたか適用している場合は、監視スタックが拾うレシーバーを適用します。

```yaml title="alertmanager-config.yaml"
apiVersion: monitoring.rhobs/v1alpha1
kind: AlertmanagerConfig
metadata:
  name: oneuptime
  labels:
    service: metricStorage
spec:
  route:
    receiver: oneuptime
    groupBy: ["alertname", "instance"]
  receivers:
    - name: oneuptime
      webhookConfigs:
        - url: "https://oneuptime.com/heartbeat/<secret key>"
          sendResolved: true
```

### API とコントロールプレーンを読み取る

**OpenStack → すべてのクラウド** を開いて**クラウドを接続**をクリックし、Keystone のアドレス、アプリケーションクレデンシャル、使用するプローブを指定します。プローブがクラウドと通信するのは HTTPS のみです。続いて、コントロールプレーンが動作するクラスターで **Kubernetes → ドキュメント**に従い、**Red Hat OpenShift** を選んでください。これで `preset=openshift` が設定されます。

これらのサービスのログをこのクラウドの**ログ**ページにも表示し、スタックトレースを 1 件のレコードにまとめるには、サービスが動作する名前空間とともに、エージェントの values にクラウド名を指定します。

```yaml title="Kubernetes agent values"
logs:
  openStack:
    cloudName: prod-eu
    namespaces:
      - openstack
```

### Ceilometer 経由でコンピュートノードを読み取る

プローブが伝えるのは割り当て済みの量であり、実際の使用状況ではありません。実際の使用量を読み取るには、コンピュートノードに到達できるマシンでエージェントを実行し、`OPENSTACK_CEILOMETER_EXPORTER_TARGETS` に Ceilometer のポート `9101` で各ノードを指定します。

### Red Hat OpenStack on OpenShift で誰が何をしたか

Keystone の監査証跡と各 API の監査フィルターを、[セキュリティイベント](/docs/telemetry/openstack#誰が何をしたか)に取り込みます。どちらもサービス自身のログに書き込まれ、バスに消費者はいません。OneUptime は、**セキュリティイベント → 接続**で**ログからセキュリティイベントを見つける**を有効にすると、そこから読み取ります。Kubernetes エージェントは、values で指定したクラウドについて、どちらもポッドのログから読み取ります。

```yaml title="your OpenStackControlPlane"
spec:
  keystone:
    template:
      customServiceConfig: |
        [DEFAULT]
        notification_format = cadf
        notification_opt_out = identity.authenticate.pending
        
        [oslo_messaging_notifications]
        driver = log
```

これでログインのたびに 1 行が出力され、**新しいアドレスから OpenStack の admin クレデンシャルが使用された**検知がそれを読み取ります。失敗したログインだけを出力するには、`notification_opt_out` に `identity.authenticate.success` を追加します。すると、その検知は監査フィルターが見た内容を読み取ります。

Nova と Neutron で誰が何をしたかを記録するには、それぞれ `customServiceConfig` にフィルターの設定を、`defaultConfigOverwrite` に paste ファイルを入れます。Cinder と Glance のオペレーターは paste ファイルを受け付けないため、ここからそれらに届くものはありません。

```yaml title="your OpenStackControlPlane"
spec:
  nova:
    template:
      apiServiceTemplate:
        customServiceConfig: |
          [audit_middleware_notifications]
          driver = log
```

## Mirantis MOSK

StackLight は、独自のアラートルールで、OpenStack のサービス、MariaDB、Memcached、RabbitMQ、libvirt をすでに監視しています。まずそのアラートを転送し、次にプローブが API を読み取ります。

### Mirantis MOSK で発火しているアラートを転送する

StackLight にはアラートルールが同梱されているため、最初の 1 時間から機能します。レシーバーとそのルートを StackLight の values に追加してください。Mirantis のドキュメントの例には Webhook ではなく他のレシーバーが載っており、MOSK 上では実行していません。

```yaml title="StackLight values"
alertmanagerSimpleConfig:
  genericReceivers:
    - name: oneuptime
      enabled: true
      webhook_configs:
        - url: "https://oneuptime.com/heartbeat/<secret key>"
          send_resolved: true
  genericRoutes:
    - receiver: oneuptime
      enabled: true
      matchers:
        - severity=~"warning|critical"
      continue: true
```

### API を読み取る

**OpenStack → すべてのクラウド** を開いて**クラウドを接続**をクリックし、Keystone のアドレス、アプリケーションクレデンシャル、使用するプローブを指定します。プローブがクラウドと通信するのは HTTPS のみです。

### Mirantis MOSK で誰が何をしたか

Nova、Neutron、Cinder、Glance で誰が何をしたかを記録するには、MOSK 独自の設定があり、監査フィルターはすでに組み込まれています。ログドライバーを使うと各サービスは標準出力に書き込み、Kubernetes エージェントは、values で指定したクラウドについて、それをポッドのログから読み取ります。どれもサービス自身のログに書き込まれ、バスに消費者はいません。OneUptime は、**セキュリティイベント → 接続**で**ログからセキュリティイベントを見つける**を有効にすると、そこから読み取ります。

```yaml title="your OpenStackDeployment"
spec:
  features:
    logging:
      cadf:
        enabled: true
        driver: log
```

この設定は Keystone を対象としません。Keystone 自身の監査証跡は `spec:services` で設定しますが、Mirantis はこれを検証せず、責任も負わないため、サポート契約を踏まえて検討してください。

```yaml title="your OpenStackDeployment"
spec:
  services:
    identity:
      keystone:
        values:
          conf:
            keystone:
              DEFAULT:
                notification_format: cadf
                notification_opt_out: identity.authenticate.pending
              oslo_messaging_notifications:
                driver: log
```

これでログインのたびに 1 行が出力され、**新しいアドレスから OpenStack の admin クレデンシャルが使用された**検知がそれを読み取ります。失敗したログインだけを出力するには、`notification_opt_out` に `identity.authenticate.success` を追加します。すると、その検知は監査フィルターが見た内容を読み取ります。

## すでに動かしているエクスポーターを使う

クレデンシャルも、新たに実行するものも不要です。エージェントは、すでにあるエクスポーターを読み取れます。方法は、そのエクスポーターの起動方法によって異なります。

- **`--multi-cloud` 付き**(エージェント自身のエクスポーターの場合): `OPENSTACK_EXPORTER_ADDRESS` を設定すると、エージェントは `/probe` で一度に 1 つのサービスについて問い合わせます。
- **指定なし**(Kolla-Ansible と Canonical のチャームの場合): `/probe` がないため、`OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` を設定すると、エージェントは `/metrics` ですべてを一度に、2 分ごとに問い合わせます。

Kolla-Ansible では、内部 VIP の `9198` がそれにあたります。

```bash
OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=<kolla_internal_vip_address>:9198 \
OPENSTACK_CONTROL_PLANE_REGION=RegionOne \
bash install.sh
```

この読み取りは、Kolla-Ansible 自身の Prometheus が毎分問い合わせているものに加わります。Kolla-Ansible はエクスポーター 1.7.0 を固定しており、その応答にはエージェントが固定しているエクスポーターより少ない内容しか含まれません。以下は 5 つの実際のクラウドでページに表示されなかったもので、テストがそれらの記録と照合しています。

| 表示されないもの | 理由 | 影響 |
| --- | --- | --- |
| Cinder に関するすべて | カタログに `volumev3` を問い合わせるが、Cinder が `block-storage` として登録されている環境では見つからない | **ボリューム**と**ストレージプール**が空のままになり、**サービス**に Block Storage API、`cinder-volume`、`cinder-scheduler` が表示されない。**Block Storage API Down**、**Block Storage Service Down**、**Storage Pool Warning**、**Storage Pool Critical**、**Volumes in Error**、**Volume Stuck** は発火しない |
| ハイパーバイザーが保持するインスタンス数と、そのアグリゲート | Kolla-Ansible が要求する最新のマイクロバージョンで、Nova のハイパーバイザー一覧が失敗する | **ハイパーバイザー**のこの二項目と、ホストを失ったときに一緒に失われるものの表示。vCPU、メモリ、ディスクは Placement から取得するため引き続き表示される |
| ドメイン | 該当する系列がない | **ドメイン**が空のままになる |
| イメージのステータス、公開範囲、作成日 | 該当するラベルがない | **イメージ**のそれらの列。**Image Stuck** は発火しないため、`active` に至る途中で止まったイメージに気付けない |
| ネットワークの MTU | 該当するラベルがない | ネットワークのページのその行 |

これらが必要な場合は、代わりにエージェント自身のエクスポーターを使ってください。後から変更することもできます。どちらで読み取っても、クラウドの名前は変わりません。
