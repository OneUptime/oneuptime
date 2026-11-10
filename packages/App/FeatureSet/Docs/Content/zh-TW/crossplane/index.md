# Crossplane 概觀

OneUptime 的 Crossplane 提供者讓你從 Kubernetes 管理 OneUptime 專案。把監測器、狀態頁面、待命策略、團隊、標籤以及專案中的其他記錄宣告為 Kubernetes 資源，Crossplane 就會讓專案始終與它們的描述保持一致：建立新增的內容，變更你編輯過的內容，改回別人在別處所做的變更，並刪除你移除的內容。Argo CD、Flux 以及其他任何套用資訊清單的工具，同樣可以套用這些資源。它既適用於 OneUptime Cloud，也適用於自行託管的 OneUptime。

:::cards
- [提供者的運作方式](#提供者的運作方式): 種類、命名空間，以及它們背後的 API 金鑰。
- [安裝提供者](#安裝提供者): 套件，以及該選的版本。
- [為它設定 API 金鑰](#為它設定-api-金鑰): 你的命名空間中的一個 Secret 和一個 ProviderConfig。
- [建立你的第一批資源](#建立你的第一批資源): 一個監測器、它所帶的標籤，以及它設定的狀態。
:::

## 提供者的運作方式

提供者是一個 Crossplane 套件。安裝後，它會在 `crossplane.oneuptime.com` API 群組中為 OneUptime API 的每種記錄新增一個種類：`Monitor`、`StatusPage`、`OnCallPolicy`、`Team`、`Label`，以及另外 400 多個。這些種類的每個資源都位於一個命名空間中，代表專案中的一筆記錄。提供者使用專案的 API 金鑰，透過 OneUptime REST API 讀取和變更這筆記錄，並把讀到的結果寫入資源的狀態。

提供者的每個版本，都由同一版本的 [Terraform 提供者](/docs/terraform/index) 產生：它的種類就是 Terraform 提供者的資源，欄位相同，背後的 API 請求也相同。

## 開始之前

- **Crossplane 2.0 或更新版本。** 提供者的資源位於命名空間中，這是 Crossplane 2 才引入的。Crossplane 自己的文件說明了如何在叢集中安裝它。
- **專案的 API 金鑰。** Terraform 的 [快速入門](/docs/terraform/quick-start#建立專案-api-金鑰) 介紹了如何在 **專案設定 → 進階 → API 金鑰** 中建立。金鑰決定資源屬於哪個專案，以及提供者可以在其中變更什麼。
- **在 OneUptime Cloud 上，需要 Growth 方案或更高方案。** 專案的 API 金鑰只在這些方案上有效。

## 安裝提供者

用一個 `Provider` 安裝該套件：

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

當 `INSTALLED` 和 `HEALTHY` 都顯示 `True` 時，提供者就在執行了。Docker Hub 上也有同一個套件：`docker.io/oneuptime/provider-oneuptime`。

### 選擇版本

套件的版本號就是 OneUptime 的版本號：`{{CROSSPLANE_PROVIDER_VERSION}}` 由同一版本的 OneUptime 產生，也就是提供本頁的這個版本。在 OneUptime Cloud 上，請使用最新版本。在自行託管的 OneUptime 上，請使用與你的 OneUptime 相同的版本，這樣提供者認得的欄位才會與你的 OneUptime 的 API 一致。

### 只啟用你用到的種類

Crossplane 的 Helm chart 預設會啟用每個提供者的每個種類（由它的 `provider.defaultActivations` 值決定），對這個提供者來說，就是 400 多個自訂資源定義。若要只啟用你用到的種類，請用 `--set provider.defaultActivations={}` 安裝 Crossplane，並在一個策略中列出這些種類：

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

## 為它設定 API 金鑰

把金鑰放進資源所在命名空間中的一個 Secret，並讓該命名空間中的一個 `ProviderConfig` 指向它。用 `kubectl` 建立 Secret，金鑰就不會出現在你的檔案中：

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

`ProviderConfig` 只讀取它自己所在命名空間中的 Secret，因此一個命名空間的金鑰無法在另一個命名空間中使用。每個資源都在 `spec.providerConfigRef` 中指定它的 `ProviderConfig`。

### 使用自行託管的 OneUptime

在 `ProviderConfig` 的 `url` 中填入你的 OneUptime 的位址，不要帶 `/api`：

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

### 在多個命名空間之間共用一個金鑰

`ClusterProviderConfig` 可以讀取任何命名空間中的 Secret，所有命名空間中的資源都可以指定它。當由一個團隊負責整個叢集的金鑰時，請使用它：

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

資源在它的 `providerConfigRef` 中用 `kind: ClusterProviderConfig` 指定它。Secret 中可以只有金鑰，也可以是同時寫明位址的 JSON：`{"api_key": "<your-api-key>", "oneuptime_url": "https://oneuptime.example.com"}`。`ClusterProviderConfig` 中的 `url` 優先於 JSON 中的位址。`ClusterProviderConfig` 也可以用 `source: Environment` 或 `source: Filesystem`，從提供者 Pod 的環境變數或檔案中讀取金鑰。

## 建立你的第一批資源

一個監測首頁的監測器，帶有一個標籤，會設定專案的 **離線** 和 **運作中** 狀態。

:::steps
### 觀察它設定的狀態

OneUptime 在建立專案時就建立了專案的狀態，因此要觀察它們，而不是建立它們：提供者依 ID 讀取它們，從不變更或刪除它們。用 [OneUptime CLI](/docs/cli/resource-operations#列出記錄) 執行 `oneuptime monitor-status list --fields _id,name`，即可列出這些 ID。

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

### 建立標籤和監測器

監測器用 Kubernetes 名稱指定標籤和狀態，提供者會填入它們的 ID：

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

### 在 OneUptime 中檢視它們

```bash
kubectl apply -f statuses.yaml -f homepage.yaml
kubectl -n team-a get managed
```

當 `SYNCED` 和 `READY` 顯示 `True` 時，記錄就已在你的專案中。`EXTERNAL-NAME` 是它在 OneUptime 中的 ID。
:::

## 後續步驟

- [管理資源](/docs/crossplane/managing-resources) 介紹了種類及其欄位、參照、如何匯入已有的內容、OneUptime 產生的機密，以及資源未就緒時該查看什麼。
- [Terraform 完整指南](/docs/terraform/complete-guide) 介紹了資源及其欄位，提供者的種類與它們相同。
