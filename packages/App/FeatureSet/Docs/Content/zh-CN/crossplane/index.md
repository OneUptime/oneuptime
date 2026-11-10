# Crossplane 概览

OneUptime 的 Crossplane 提供程序让你从 Kubernetes 管理 OneUptime 项目。把监视器、状态页面、值班策略、团队、标签以及项目中的其他记录声明为 Kubernetes 资源，Crossplane 就会让项目始终与它们的描述保持一致：创建新增的内容，更改你编辑过的内容，改回别人在别处所做的更改，并删除你移除的内容。Argo CD、Flux 以及其他任何应用清单的工具，同样可以应用这些资源。它既适用于 OneUptime Cloud，也适用于自托管的 OneUptime。

:::cards
- [提供程序的工作方式](#提供程序的工作方式): 类别、命名空间，以及它们背后的 API 密钥。
- [安装提供程序](#安装提供程序): 软件包，以及该选的版本。
- [为它配置 API 密钥](#为它配置-api-密钥): 你的命名空间中的一个 Secret 和一个 ProviderConfig。
- [创建你的第一批资源](#创建你的第一批资源): 一个监视器、它所带的标签，以及它设置的状态。
:::

## 提供程序的工作方式

提供程序是一个 Crossplane 软件包。安装后，它会在 `crossplane.oneuptime.com` API 组中为 OneUptime API 的每种记录添加一个类别：`Monitor`、`StatusPage`、`OnCallPolicy`、`Team`、`Label`，以及另外 400 多个。这些类别的每个资源都位于一个命名空间中，代表项目中的一条记录。提供程序使用项目的 API 密钥，通过 OneUptime REST API 读取和更改这条记录，并把读到的结果写入资源的状态。

提供程序的每个版本，都由同一版本的 [Terraform 提供程序](/docs/terraform/index) 生成：它的类别就是 Terraform 提供程序的资源，字段相同，背后的 API 请求也相同。

## 开始之前

- **Crossplane 2.0 或更高版本。** 提供程序的资源位于命名空间中，这是 Crossplane 2 才引入的。Crossplane 自己的文档介绍了如何在集群中安装它。
- **项目的 API 密钥。** Terraform 的 [快速开始](/docs/terraform/quick-start#创建项目-api-密钥) 介绍了如何在 **项目设置 → 高级 → API 密钥** 中创建。密钥决定资源属于哪个项目，以及提供程序可以在其中更改什么。
- **在 OneUptime Cloud 上，需要 Growth 套餐或更高。** 项目的 API 密钥只在这些套餐上有效。

## 安装提供程序

用一个 `Provider` 安装该软件包：

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

当 `INSTALLED` 和 `HEALTHY` 都显示 `True` 时，提供程序就在运行了。Docker Hub 上也有同一个软件包：`docker.io/oneuptime/provider-oneuptime`。

### 选择版本

软件包的版本号就是 OneUptime 的版本号：`{{CROSSPLANE_PROVIDER_VERSION}}` 由同一版本的 OneUptime 生成，也就是提供本页的这个版本。在 OneUptime Cloud 上，请使用最新版本。在自托管的 OneUptime 上，请使用与你的 OneUptime 相同的版本，这样提供程序认识的字段才与你的 OneUptime 的 API 一致。

### 只激活你用到的类别

Crossplane 的 Helm chart 默认会激活每个提供程序的每个类别（由它的 `provider.defaultActivations` 值决定），对这个提供程序来说，就是 400 多个自定义资源定义。要只激活你用到的类别，请用 `--set provider.defaultActivations={}` 安装 Crossplane，并在一个策略中列出这些类别：

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

## 为它配置 API 密钥

把密钥放进资源所在命名空间中的一个 Secret，并让该命名空间中的一个 `ProviderConfig` 指向它。用 `kubectl` 创建 Secret，密钥就不会出现在你的文件中：

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

`ProviderConfig` 只读取它自己所在命名空间中的 Secret，因此一个命名空间的密钥无法在另一个命名空间中使用。每个资源都在 `spec.providerConfigRef` 中指定它的 `ProviderConfig`。

### 使用自托管的 OneUptime

在 `ProviderConfig` 的 `url` 中填写你的 OneUptime 的地址，不要带 `/api`：

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

### 在多个命名空间之间共享一个密钥

`ClusterProviderConfig` 可以读取任何命名空间中的 Secret，所有命名空间中的资源都可以指定它。当由一个团队负责整个集群的密钥时，请使用它：

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

资源在它的 `providerConfigRef` 中用 `kind: ClusterProviderConfig` 指定它。Secret 中可以只有密钥，也可以是同时写明地址的 JSON：`{"api_key": "<your-api-key>", "oneuptime_url": "https://oneuptime.example.com"}`。`ClusterProviderConfig` 中的 `url` 优先于 JSON 中的地址。`ClusterProviderConfig` 还可以用 `source: Environment` 或 `source: Filesystem`，从提供程序 Pod 的环境变量或文件中读取密钥。

## 创建你的第一批资源

一个监视主页的监视器，带有一个标签，会设置项目的 **离线** 和 **运行正常** 状态。

:::steps
### 观察它设置的状态

OneUptime 在创建项目时就创建了项目的状态，因此要观察它们，而不是创建它们：提供程序按 ID 读取它们，从不更改或删除它们。用 [OneUptime CLI](/docs/cli/resource-operations#列出记录) 运行 `oneuptime monitor-status list --fields _id,name`，即可列出这些 ID。

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

### 创建标签和监视器

监视器用 Kubernetes 名称指定标签和状态，提供程序会填入它们的 ID：

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

### 在 OneUptime 中查看它们

```bash
kubectl apply -f statuses.yaml -f homepage.yaml
kubectl -n team-a get managed
```

当 `SYNCED` 和 `READY` 显示 `True` 时，记录就已在你的项目中。`EXTERNAL-NAME` 是它在 OneUptime 中的 ID。
:::

## 后续步骤

- [管理资源](/docs/crossplane/managing-resources) 介绍了类别及其字段、引用、如何导入已有的内容、OneUptime 生成的机密，以及资源未就绪时该查看什么。
- [Terraform 完整指南](/docs/terraform/complete-guide) 介绍了资源及其字段，提供程序的类别与它们相同。
