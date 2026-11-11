# Crossplane 概要

OneUptime の Crossplane プロバイダーは、OneUptime プロジェクトを Kubernetes から管理します。モニター、ステータスページ、オンコールポリシー、チーム、ラベルなど、プロジェクトのレコードを Kubernetes リソースとして宣言すると、Crossplane はプロジェクトを宣言どおりの状態に保ちます。新しいものは作成し、編集したものは変更し、誰かがほかの場所で変更したものは元に戻し、取り除いたものは削除します。Argo CD や Flux をはじめ、マニフェストを適用するツールなら、これらのリソースも同じように適用できます。OneUptime Cloud でもセルフホストの OneUptime でも動作します。

:::cards
- [プロバイダーのしくみ](#プロバイダーのしくみ): kind、Namespace、そしてその裏にある API キー。
- [プロバイダーをインストールする](#プロバイダーをインストールする): パッケージと、選ぶべきバージョン。
- [プロバイダーに API キーを渡す](#プロバイダーに-api-キーを渡す): Namespace に置く Secret と ProviderConfig。
- [最初のリソースを作成する](#最初のリソースを作成する): モニター、それに付けるラベル、そしてモニターが設定するステータス。
:::

## プロバイダーのしくみ

プロバイダーは Crossplane のパッケージです。インストールすると、OneUptime API のレコードの種類ごとに kind を 1 つずつ `crossplane.oneuptime.com` API グループに追加します。`Monitor`、`StatusPage`、`OnCallPolicy`、`Team`、`Label` のほか、400 を超える kind があります。これらの kind のリソースはそれぞれ 1 つの Namespace に属し、プロジェクトの 1 つのレコードを表します。プロバイダーは、プロジェクトの API キーを使って OneUptime REST API でレコードを読み取って変更し、確認した内容をリソースの status に書き込みます。

プロバイダーは、[Terraform プロバイダー](/docs/terraform/index) からリリースごとに作られます。その kind は Terraform プロバイダーのリソースそのもので、フィールドも、その裏で送られる API リクエストも同じです。

## はじめる前に

- **Crossplane 2.0 以降。** プロバイダーのリソースは Namespace に属します。Namespace に属するリソースは Crossplane 2 で導入されました。クラスターへのインストール方法は、Crossplane 自身のドキュメントで説明されています。
- **プロジェクトの API キー。** Terraform の [クイック スタート](/docs/terraform/quick-start#プロジェクトの-api-キーを作成する) で、**プロジェクト設定 → 詳細 → API キー** での作成方法を説明しています。このキーによって、リソースがどのプロジェクトに属し、プロバイダーがそのプロジェクトで何を変更できるかが決まります。
- **OneUptime Cloud では Growth プラン以上。** プロジェクトの API キーはこのプランでのみ動作します。

## プロバイダーをインストールする

`Provider` でパッケージをインストールします。

```yaml title="provider.yaml"
apiVersion: pkg.crossplane.io/v1
kind: Provider
metadata:
  name: provider-oneuptime
spec:
  package: ghcr.io/oneuptime/provider-oneuptime:{{CROSSPLANE_PROVIDER_VERSION}}
```

```bash
kubectl apply -f provider.yaml
kubectl get providers.pkg.crossplane.io provider-oneuptime
```

`INSTALLED` と `HEALTHY` の両方が `True` になれば、プロバイダーは動作しています。同じパッケージは Docker Hub でも `docker.io/oneuptime/provider-oneuptime` として公開されています。

### バージョンを選ぶ

パッケージのバージョンは OneUptime のバージョンと同じです。`{{CROSSPLANE_PROVIDER_VERSION}}` は、このページを配信している OneUptime のリリースから作られています。OneUptime Cloud では最新のバージョンを使ってください。セルフホストの OneUptime では、お使いの OneUptime と同じバージョンを使ってください。そうすれば、プロバイダーが知っているフィールドが、お使いの OneUptime の API のフィールドと一致します。

### 使う kind だけを有効にする

Crossplane の Helm チャートは、既定ですべてのプロバイダーのすべての kind を有効にします (`provider.defaultActivations` の値)。このプロバイダーでは 400 を超えるカスタムリソース定義になります。使う kind だけを有効にするには、`--set provider.defaultActivations={}` を付けて Crossplane をインストールし、使う kind をポリシーに列挙します。

```yaml title="activation-policy.yaml"
apiVersion: apiextensions.crossplane.io/v1alpha1
kind: ManagedResourceActivationPolicy
metadata:
  name: oneuptime
spec:
  activate:
    - monitors.crossplane.oneuptime.com
    - monitorstatusdefinitions.crossplane.oneuptime.com
    - labels.crossplane.oneuptime.com
    - statuspages.crossplane.oneuptime.com
```

## プロバイダーに API キーを渡す

リソースを置く Namespace の Secret にキーを入れ、同じ Namespace の `ProviderConfig` からその Secret を参照します。Secret を `kubectl` で作成すれば、キーがファイルに残りません。

```bash
kubectl create namespace team-a
kubectl -n team-a create secret generic oneuptime --from-literal=api-key="<your-api-key>"
```

```yaml title="provider-config.yaml"
apiVersion: crossplane.oneuptime.com/v1beta1
kind: ProviderConfig
metadata:
  name: default
  namespace: team-a
spec:
  credentials:
    secretRef:
      name: oneuptime
      key: api-key
```

`ProviderConfig` は自身の Namespace の Secret しか読み取らないため、ある Namespace のキーを別の Namespace から使うことはできません。各リソースは、使う `ProviderConfig` を `spec.providerConfigRef` で指定します。

### セルフホストの OneUptime を使う

`ProviderConfig` の `url` に、お使いの OneUptime のアドレスを `/api` を付けずに指定します。

```yaml title="provider-config.yaml"
apiVersion: crossplane.oneuptime.com/v1beta1
kind: ProviderConfig
metadata:
  name: default
  namespace: team-a
spec:
  url: https://oneuptime.example.com
  credentials:
    secretRef:
      name: oneuptime
      key: api-key
```

### 1 つのキーを複数の Namespace で共有する

`ClusterProviderConfig` はどの Namespace の Secret でも読み取ることができ、すべての Namespace のリソースから指定できます。1 つのチームがクラスター全体のキーを管理する場合に使います。

```yaml title="cluster-provider-config.yaml"
apiVersion: crossplane.oneuptime.com/v1beta1
kind: ClusterProviderConfig
metadata:
  name: oneuptime
spec:
  credentials:
    source: Secret
    secretRef:
      namespace: crossplane-system
      name: oneuptime
      key: credentials
```

リソースは、`providerConfigRef` に `kind: ClusterProviderConfig` と書いてこれを指定します。Secret にはキーだけを入れるか、アドレスも含めた JSON を入れます: `{"api_key": "<your-api-key>", "oneuptime_url": "https://oneuptime.example.com"}`。`ClusterProviderConfig` に `url` を書くと、JSON のアドレスより優先されます。`ClusterProviderConfig` は、`source: Environment` または `source: Filesystem` を使って、プロバイダーの Pod の環境変数やファイルからキーを読み取ることもできます。

## 最初のリソースを作成する

ラベルを付けたホームページのモニターで、プロジェクトの **オフライン** と **稼働中** のステータスを設定します。

:::steps
### モニターが設定するステータスを観測する

プロジェクトのステータスは、プロジェクトの作成時に OneUptime が作ったものです。そのため、作成するのではなく観測します。プロバイダーは ID でステータスを読み取り、変更も削除もしません。ID は [OneUptime CLI](/docs/cli/resource-operations#レコードを一覧表示する) の `oneuptime monitor-status list --fields _id,name` で一覧表示できます。

```yaml title="statuses.yaml"
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: MonitorStatusDefinition
metadata:
  name: offline
  namespace: team-a
  annotations:
    crossplane.io/external-name: "<the Offline status's ID>"
spec:
  managementPolicies: ["Observe"]
  providerConfigRef:
    kind: ProviderConfig
    name: default
  forProvider: {}
---
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: MonitorStatusDefinition
metadata:
  name: operational
  namespace: team-a
  annotations:
    crossplane.io/external-name: "<the Operational status's ID>"
spec:
  managementPolicies: ["Observe"]
  providerConfigRef:
    kind: ProviderConfig
    name: default
  forProvider: {}
```

### ラベルとモニターを作成する

モニターはラベルとステータスを Kubernetes での名前で指定し、プロバイダーがそれらの ID を埋めます。

```yaml title="homepage.yaml"
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: Label
metadata:
  name: production
  namespace: team-a
spec:
  providerConfigRef:
    kind: ProviderConfig
    name: default
  forProvider:
    name: Production
    color: "#16a34a"
---
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: Monitor
metadata:
  name: homepage
  namespace: team-a
spec:
  providerConfigRef:
    kind: ProviderConfig
    name: default
  forProvider:
    name: Homepage
    description: Checks that the homepage responds
    monitorType: Website
    monitoringInterval: "*/5 * * * *"
    labelsRefs:
      - name: production
    monitorSteps:
      - monitorDestination: https://example.com
        monitorDestinationType: URL
        requestType: GET
        criteria:
          - name: Offline
            description: The homepage does not respond
            filterCondition: Any
            changeMonitorStatus: true
            monitorStatusIdRef:
              name: offline
            filters:
              - checkOn: Is Online
                filterType: "False"
          - name: Online
            description: The homepage responds
            filterCondition: All
            changeMonitorStatus: true
            monitorStatusIdRef:
              name: operational
            filters:
              - checkOn: Is Online
                filterType: "True"
```

### OneUptime で確認する

```bash
kubectl apply -f statuses.yaml -f homepage.yaml
kubectl -n team-a get managed
```

`SYNCED` と `READY` が `True` になれば、レコードはプロジェクトに入っています。`EXTERNAL-NAME` は OneUptime でのレコードの ID です。
:::

## 次のステップ

- [リソースの管理](/docs/crossplane/managing-resources) では、kind とそのフィールド、参照、すでにあるもののインポート、OneUptime が作るシークレット、そしてリソースの準備ができていないときに確認することを説明しています。
- [Terraform 完全ガイド](/docs/terraform/complete-guide) では、プロバイダーの kind と共通する、リソースとそのフィールドを説明しています。
