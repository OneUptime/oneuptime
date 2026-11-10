# リソースの管理

このページでは、最初のリソースが動き始めた後のプロバイダーのリソースについて説明します。kind とフィールドの名前の付け方、リソースどうしの参照のしかた、プロジェクトにすでにあるものの取り込み方、OneUptime が作るシークレット、Kubernetes の外で行われた変更がどうなるか、そしてリソースの準備ができていないときに確認することです。プロバイダーをインストールして最初のリソースを作成するには、[Crossplane 概要](/docs/crossplane/index) から始めてください。

:::cards
- [kind とフィールド](#kind-とフィールド): 元になる Terraform のリソースと、名前の付け方。
- [ほかのリソースを参照する](#ほかのリソースを参照する): ID の代わりに名前で参照します。モニターのステップのどの階層でも使えます。
- [すでにあるものをインポートする](#すでにあるものをインポートする): レコードを ID で観測してから、管理を引き継ぎます。
- [リソースのトラブルシューティング](#リソースのトラブルシューティング): Condition、イベント、プロバイダーのログ。
:::

## kind とフィールド

[Terraform プロバイダー](/docs/terraform/index) の各リソースは、CamelCase で名前を付けた kind になります。`oneuptime_status_page` は `StatusPage`、`oneuptime_on_call_policy` は `OnCallPolicy` です。Spec、Status、List で終わることになる名前には Definition が付くため、`oneuptime_monitor_status` は `MonitorStatusDefinition` になります。kind の一部を次に示します。

| kind | 表すレコード | Terraform リソース |
| --- | --- | --- |
| `Monitor` | モニター | `oneuptime_monitor` |
| `StatusPage` | ステータスページ | `oneuptime_status_page` |
| `OnCallPolicy` | オンコールポリシー | `oneuptime_on_call_policy` |
| `Team` | チーム | `oneuptime_team` |
| `Label` | ラベル | `oneuptime_label` |
| `IncidentSeverity` | インシデントの重大度 | `oneuptime_incident_severity` |
| `MonitorStatusDefinition` | モニターステータス | `oneuptime_monitor_status` |
| `TelemetryIngestionKey` | テレメトリ取り込みキー | `oneuptime_telemetry_ingestion_key` |

`kubectl api-resources --api-group=crossplane.oneuptime.com` で、クラスターで有効になっているすべての kind を一覧表示できます。

kind のフィールドは Terraform リソースの引数を camelCase にしたもので、`spec.forProvider` の下に置きます。たとえば `monitoring_interval` は `monitoringInterval` です。Terraform で `jsonencode()` を使って書くフィールドは、JSON 文字列を受け取ります。`kubectl explain` は各フィールドを Terraform プロバイダーと同じように説明し、[Terraform 完全ガイド](/docs/terraform/complete-guide) ではその使い方を示しています。

```bash
kubectl explain monitors.spec.forProvider --api-version=crossplane.oneuptime.com/v1alpha1
```

`status.atProvider` には、OneUptime にあるとおりのレコードが `id` とともに表示されます。省略したフィールドを OneUptime が既定値などで埋めた場合、その値はレコードの作成後に `spec.forProvider` へコピーされます。そのため、次のチェックでは変更するものが見つかりません。

## ほかのリソースを参照する

別のレコードの ID を保持するフィールドはどれも、そのレコードを表すリソースへの参照も受け取ります。`<field>Ref` は同じ Namespace のリソースを名前で指定し、`<field>Selector` は Kubernetes のラベルでリソースを選びます。`labels` のような ID のリストには、`labelsRefs` と `labelsSelector` を使います。プロバイダーは、参照先のリソースが OneUptime に作成されるまで待ってから、その ID を埋めます。

```yaml title="selector.yaml"
spec:
  forProvider:
    labelsSelector:
      matchLabels:
        tier: production
```

参照はモニターのステップの中でも使えます。条件のステータス (`monitorStatusIdRef`) や、条件が作成するインシデントとアラートの重大度、オーナーチーム、オンコールポリシー、ラベル (`incidentSeverityIdRef`、`alertSeverityIdRef`、`ownerTeamIdsRefs`、`onCallPolicyIdsRefs`、`labelIdsRefs`) です。人を表す kind はありません。フィールドは `ownerUserIds` のようにユーザー ID で人を指定し、多くの kind では、`TeamMember` の `userEmail` のように、その横にメールアドレスも指定できます ([ユーザーとチーム](/docs/terraform/people-and-teams))。

## すでにあるものをインポートする

レコードを観測するリソースは、ID でレコードを読み取り、変更も削除もしません。ID をリソースの外部名に設定し、管理ポリシーには `Observe` だけを設定します。

```yaml title="team.yaml"
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: Team
metadata:
  name: sre
  namespace: team-a
  annotations:
    crossplane.io/external-name: "<the team's ID>"
spec:
  managementPolicies: ["Observe"]
  providerConfigRef:
    kind: ProviderConfig
    name: default
  forProvider: {}
```

レコードの ID は、ダッシュボードでそのレコードの **開発者 → Terraform** ページが書き出す `import` ブロックにあります。また、[OneUptime CLI](/docs/cli/resource-operations#レコードを一覧表示する) の `oneuptime <resource> list` で、ある種類のレコードの ID を一覧表示できます。リソースの準備ができると、`status.atProvider` にレコードが表示されます。それ以降このレコードを管理するには、フィールドを `spec.forProvider` に書き、`managementPolicies` を `["*"]` に設定します。

## シークレット

### OneUptime が作るシークレット

テレメトリ取り込みキーのシークレットのように、OneUptime が作るシークレットを伴うレコードがあります。プロバイダーがそれをリソースに入れることはありません。代わりに、リソースの Namespace にある、`writeConnectionSecretToRef` で指定した名前の Secret に書き込みます。キーは `attribute.` に Terraform の属性名を続けたものです。

```yaml title="telemetry-key.yaml"
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: TelemetryIngestionKey
metadata:
  name: collector
  namespace: team-a
spec:
  providerConfigRef:
    kind: ProviderConfig
    name: default
  writeConnectionSecretToRef:
    name: collector-telemetry-key
  forProvider:
    name: Collector
```

```bash
kubectl -n team-a get secret collector-telemetry-key -o jsonpath='{.data.attribute\.secret_key}' | base64 -d
```

リソースを削除すると、その Secret も削除されます。

### 自分で渡すシークレット

モニターステップの TLS クライアントキーのパスフレーズのように、シークレットを保持するフィールドは、値の代わりにリソースの Namespace の Secret を受け取ります。`tlsClientKeyPassphraseSecretRef` に、Secret の `name` と `key` を指定します。

## Kubernetes の外で行われた変更

プロバイダーは 10 分ごとに各リソースをそのレコードと照らし合わせ、誰かが OneUptime で変更したものを元に戻します。より頻繁にチェックするには、`--poll` を指定したランタイム構成をプロバイダーに渡します。

```yaml title="runtime-config.yaml"
apiVersion: pkg.crossplane.io/v1beta1
kind: DeploymentRuntimeConfig
metadata:
  name: oneuptime
spec:
  deploymentTemplate:
    spec:
      selector: {}
      template:
        spec:
          containers:
            - name: package-runtime
              args:
                - --poll=1m
---
apiVersion: pkg.crossplane.io/v1
kind: Provider
metadata:
  name: provider-oneuptime
spec:
  package: ghcr.io/oneuptime/provider-oneuptime:{{CROSSPLANE_PROVIDER_VERSION}}
  runtimeConfigRef:
    name: oneuptime
```

レコードの作成後にフィールドをダッシュボードに任せるには、そのフィールドを `spec.forProvider` ではなく `spec.initProvider` に書きます。この値はレコードの作成に使われ、その後は元に戻されません。レコード全体をダッシュボードに任せるには、管理ポリシーから `Update` を外します: `["Observe", "Create", "Delete", "LateInitialize"]`。

## リソースを削除する

リソースを削除すると、OneUptime のそのレコードも削除されます。レコードを残すには、リソースを削除する前に、その管理ポリシーから `Delete` を外します: `["Observe", "Create", "Update", "LateInitialize"]`。観測するだけのリソースが、そのレコードを削除することはありません。

## リソースのトラブルシューティング

`kubectl -n team-a get managed` は、各リソースの `SYNCED` と `READY` を表示します。どちらかが `True` でない場合は、そのリソースの Condition とイベントに理由が示されます。API がリクエストを拒否した場合は、OneUptime の応答も示されます。

```bash
kubectl -n team-a describe monitors.crossplane.oneuptime.com homepage
```

| 表示される内容 | 確認すること |
| --- | --- |
| `cannot read the API key` | `ProviderConfig` が指定している Secret、またはその中のキー。 |
| `cannot get referenced ProviderConfig` | リソースが、自身の Namespace にない `ProviderConfig` を指定しています。クラスター全体のものを使うには `kind: ClusterProviderConfig` を指定します。 |
| 解決できない参照 | 参照先のリソースが Namespace にないか、まだ準備ができていません。 |
| OneUptime API からのエラー | API キーの権限と、エラーが示しているフィールドの値。 |

プロバイダーのログにはさらに詳しい情報があります。上の `--poll` と同じように `args` に `--debug` を追加すると、さらに詳しくなります。

```bash
kubectl -n crossplane-system logs -l pkg.crossplane.io/provider=provider-oneuptime
```

## パッケージを検証する

各リリースは、OneUptime のイメージと同じように、Sigstore の cosign を使ってキーレスでパッケージに署名します。インストールする前にパッケージを確認するには、次を実行します。

```bash
cosign verify ghcr.io/oneuptime/provider-oneuptime:{{CROSSPLANE_PROVIDER_VERSION}} \
  --certificate-identity https://github.com/OneUptime/oneuptime/.github/workflows/release.yml@refs/heads/release \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```
