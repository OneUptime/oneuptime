# 管理資源

本頁介紹第一批資源執行起來之後，如何使用提供者的資源：種類和欄位如何命名，資源之間如何相互參照，如何納入專案中已有的內容，OneUptime 產生的機密，在 Kubernetes 之外所做的變更會怎樣，以及資源未就緒時該查看什麼。若要安裝提供者並建立第一批資源，請從 [Crossplane 概觀](/docs/crossplane/index) 開始。

:::cards
- [種類和欄位](#種類和欄位): 它們由哪些 Terraform 資源產生，以及如何命名。
- [參照其他資源](#參照其他資源): 用名稱取代 ID，監測器步驟的任何層級都適用。
- [匯入已有的內容](#匯入已有的內容): 依 ID 觀察一筆記錄，然後接管它。
- [資源疑難排解](#資源疑難排解): 資源的狀況和 Kubernetes 事件，以及提供者的日誌。
:::

## 種類和欄位

[Terraform 提供者](/docs/terraform/index) 的每個資源都是一個種類，以 CamelCase 命名：`oneuptime_status_page` 是 `StatusPage`，`oneuptime_on_call_policy` 是 `OnCallPolicy`。名稱若以 Spec、Status 或 List 結尾，會再加上 Definition，因此 `oneuptime_monitor_status` 是 `MonitorStatusDefinition`。部分種類如下：

| 種類 | 對應的記錄 | Terraform 資源 |
| --- | --- | --- |
| `Monitor` | 監測器 | `oneuptime_monitor` |
| `StatusPage` | 狀態頁面 | `oneuptime_status_page` |
| `OnCallPolicy` | 待命策略 | `oneuptime_on_call_policy` |
| `Team` | 團隊 | `oneuptime_team` |
| `Label` | 標籤 | `oneuptime_label` |
| `IncidentSeverity` | 事件嚴重程度 | `oneuptime_incident_severity` |
| `MonitorStatusDefinition` | 監測器狀態 | `oneuptime_monitor_status` |
| `TelemetryIngestionKey` | 遙測擷取金鑰 | `oneuptime_telemetry_ingestion_key` |

`kubectl api-resources --api-group=crossplane.oneuptime.com` 會列出叢集已啟用的所有種類。

種類的欄位就是 Terraform 資源的引數，改用 camelCase，寫在 `spec.forProvider` 下：`monitoring_interval` 寫成 `monitoringInterval`。在 Terraform 中用 `jsonencode()` 撰寫的欄位，在這裡接受 JSON 字串。`kubectl explain` 會像 Terraform 提供者那樣說明每個欄位，[Terraform 完整指南](/docs/terraform/complete-guide) 則示範了它們的用法：

```bash
kubectl explain monitors.spec.forProvider --api-version=crossplane.oneuptime.com/v1alpha1
```

`status.atProvider` 顯示記錄在 OneUptime 中的樣子，包括它的 `id`。你沒有設定、而由 OneUptime 填入的欄位（例如預設值），會在記錄建立後複製到 `spec.forProvider` 中，這樣下一次檢查就不會發現需要變更的內容。

## 參照其他資源

每個存放另一筆記錄 ID 的欄位，也可以改為參照代表該記錄的資源。`<field>Ref` 指定同一命名空間中的資源，`<field>Selector` 則依 Kubernetes 標籤選取一個資源。ID 清單（例如 `labels`）對應的是 `labelsRefs` 和 `labelsSelector`。提供者會等到被參照的資源在 OneUptime 中存在後，再填入它的 ID。

```yaml title="selector.yaml"
spec:
  forProvider:
    labelsSelector:
      matchLabels:
        tier: production
```

參照也能深入監測器的步驟：條件的狀態（`monitorStatusIdRef`），以及條件所建立的事件和警示的嚴重程度、擁有者團隊、待命策略和標籤（`incidentSeverityIdRef`、`alertSeverityIdRef`、`ownerTeamIdsRefs`、`onCallPolicyIdsRefs`、`labelIdsRefs`）。沒有代表人員的種類：欄位透過使用者 ID 指定某人，例如 `ownerUserIds`，許多種類還在旁邊接受此人的電子郵件地址，例如 `TeamMember` 的 `userEmail`（[人員與團隊](/docs/terraform/people-and-teams)）。

## 匯入已有的內容

觀察記錄的資源會依 ID 讀取記錄，從不變更或刪除它。把 ID 設為資源的外部名稱，並把 `Observe` 設為它唯一的管理策略：

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

記錄的 ID 就在儀表板中該記錄的 **開發者 → Terraform** 頁面寫出的 `import` 區塊裡；用 [OneUptime CLI](/docs/cli/resource-operations#列出記錄) 執行 `oneuptime <resource> list`，可以列出某種記錄的 ID。資源就緒後，`status.atProvider` 會顯示該記錄。若要從此管理它，請在 `spec.forProvider` 中寫入它的欄位，並把 `managementPolicies` 設為 `["*"]`。

## 機密

### OneUptime 產生的機密

有些記錄帶有 OneUptime 產生的機密，例如遙測擷取金鑰的機密。提供者從不把機密放進資源：它把機密寫入資源所在命名空間中由 `writeConnectionSecretToRef` 指定的 Secret，鍵名為 `attribute.` 加上 Terraform 屬性的名稱：

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

刪除資源也會刪除該 Secret。

### 你提供的機密

存放機密的欄位（例如監測器步驟中 TLS 用戶端私密金鑰的密碼短語）不接受值，而是接受資源所在命名空間中的 Secret：`tlsClientKeyPassphraseSecretRef`，寫明 Secret 的 `name` 和 `key`。

## 在 Kubernetes 之外所做的變更

提供者每 10 分鐘把每個資源與其記錄核對一次，並改回別人在 OneUptime 中所做的任何變更。若要更頻繁地檢查，請為提供者加上一個帶有 `--poll` 的執行階段設定：

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

若要在記錄建立後把某個欄位交給儀表板管理，請把它寫在 `spec.initProvider` 而不是 `spec.forProvider` 中：它只用於建立記錄，之後不會被改回。若要把整筆記錄交給儀表板管理，請從它的管理策略中拿掉 `Update`：`["Observe", "Create", "Delete", "LateInitialize"]`。

## 刪除資源

刪除資源會刪除它在 OneUptime 中的記錄。若要保留記錄，請在刪除資源之前，從它的管理策略中拿掉 `Delete`：`["Observe", "Create", "Update", "LateInitialize"]`。只做觀察的資源從不刪除它的記錄。

## 資源疑難排解

`kubectl -n team-a get managed` 會顯示每個資源的 `SYNCED` 和 `READY`。其中一個不是 `True` 時，資源的狀況和 Kubernetes 事件會說明原因；如果 API 拒絕了請求，還會附上 OneUptime 的回應：

```bash
kubectl -n team-a describe monitors.crossplane.oneuptime.com homepage
```

| 顯示的內容 | 要檢查的內容 |
| --- | --- |
| `cannot read the API key` | `ProviderConfig` 指定的 Secret，或其中的鍵。 |
| `cannot get referenced ProviderConfig` | 資源指定的 `ProviderConfig` 不在它的命名空間中。若要使用叢集層級的設定，請寫 `kind: ClusterProviderConfig`。 |
| 無法解析的參照 | 它指定的資源不在該命名空間中，或者尚未就緒。 |
| 來自 OneUptime API 的錯誤 | API 金鑰的權限，以及錯誤中提到的欄位的值。 |

提供者的日誌會有更多資訊；像上面加入 `--poll` 那樣，在它的 `args` 中加入 `--debug`，資訊還會更多：

```bash
kubectl -n crossplane-system logs -l pkg.crossplane.io/provider=provider-oneuptime
```

## 驗證套件

每次發行都會用 Sigstore 的 cosign 以無金鑰方式簽署套件，就像簽署 OneUptime 的映像檔一樣。若要在安裝套件之前檢查它：

```bash
cosign verify ghcr.io/oneuptime/provider-oneuptime:{{CROSSPLANE_PROVIDER_VERSION}} \
  --certificate-identity https://github.com/OneUptime/oneuptime/.github/workflows/release.yml@refs/heads/release \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```
