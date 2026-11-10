# 管理资源

本页介绍第一批资源运行起来之后，如何使用提供程序的资源：类别和字段如何命名，资源之间如何相互引用，如何纳入项目中已有的内容，OneUptime 生成的机密，在 Kubernetes 之外所做的更改会怎样，以及资源未就绪时该查看什么。要安装提供程序并创建第一批资源，请从 [Crossplane 概览](/docs/crossplane/index) 开始。

:::cards
- [类别和字段](#类别和字段): 它们由哪些 Terraform 资源生成，以及如何命名。
- [引用其他资源](#引用其他资源): 用名称代替 ID，监视器步骤的任何层级都适用。
- [导入已有的内容](#导入已有的内容): 按 ID 观察一条记录，然后接管它。
- [排查资源问题](#排查资源问题): 资源的状况和 Kubernetes 事件，以及提供程序的日志。
:::

## 类别和字段

[Terraform 提供程序](/docs/terraform/index) 的每个资源都是一个类别，以 CamelCase 命名：`oneuptime_status_page` 是 `StatusPage`，`oneuptime_on_call_policy` 是 `OnCallPolicy`。名称若以 Spec、Status 或 List 结尾，会再加上 Definition，因此 `oneuptime_monitor_status` 是 `MonitorStatusDefinition`。部分类别如下：

| 类别 | 对应的记录 | Terraform 资源 |
| --- | --- | --- |
| `Monitor` | 监视器 | `oneuptime_monitor` |
| `StatusPage` | 状态页面 | `oneuptime_status_page` |
| `OnCallPolicy` | 值班策略 | `oneuptime_on_call_policy` |
| `Team` | 团队 | `oneuptime_team` |
| `Label` | 标签 | `oneuptime_label` |
| `IncidentSeverity` | 事件严重程度 | `oneuptime_incident_severity` |
| `MonitorStatusDefinition` | 监视器状态 | `oneuptime_monitor_status` |
| `TelemetryIngestionKey` | 遥测摄取密钥 | `oneuptime_telemetry_ingestion_key` |

`kubectl api-resources --api-group=crossplane.oneuptime.com` 会列出集群已激活的所有类别。

类别的字段就是 Terraform 资源的参数，改用 camelCase，写在 `spec.forProvider` 下：`monitoring_interval` 写作 `monitoringInterval`。在 Terraform 中用 `jsonencode()` 书写的字段，在这里接受 JSON 字符串。`kubectl explain` 会像 Terraform 提供程序那样描述每个字段，[Terraform 完整指南](/docs/terraform/complete-guide) 则展示了它们的用法：

```bash
kubectl explain monitors.spec.forProvider --api-version=crossplane.oneuptime.com/v1alpha1
```

`status.atProvider` 显示记录在 OneUptime 中的样子，包括它的 `id`。你没有设置、而由 OneUptime 填入的字段（例如默认值），会在记录创建后复制到 `spec.forProvider` 中，这样下一次检查就不会发现需要更改的内容。

## 引用其他资源

每个存放另一条记录 ID 的字段，也可以改为引用代表该记录的资源。`<field>Ref` 指定同一命名空间中的资源，`<field>Selector` 则按 Kubernetes 标签选出一个资源。ID 列表（例如 `labels`）对应的是 `labelsRefs` 和 `labelsSelector`。提供程序会等到被引用的资源在 OneUptime 中存在后，再填入它的 ID。

```yaml title="selector.yaml"
spec:
  forProvider:
    labelsSelector:
      matchLabels:
        tier: production
```

引用也能深入监视器的步骤：条件的状态（`monitorStatusIdRef`），以及条件所创建的事件和警报的严重程度、所有者团队、值班策略和标签（`incidentSeverityIdRef`、`alertSeverityIdRef`、`ownerTeamIdsRefs`、`onCallPolicyIdsRefs`、`labelIdsRefs`）。没有代表人员的类别：字段通过用户 ID 指定某人，例如 `ownerUserIds`，许多类别还在旁边接受此人的电子邮件地址，例如 `TeamMember` 的 `userEmail`（[人员与团队](/docs/terraform/people-and-teams)）。

## 导入已有的内容

观察记录的资源会按 ID 读取记录，从不更改或删除它。把 ID 设为资源的外部名称，并把 `Observe` 设为它唯一的管理策略：

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

记录的 ID 就在仪表板中该记录的 **开发者 → Terraform** 页面写出的 `import` 块里；用 [OneUptime CLI](/docs/cli/resource-operations#列出记录) 运行 `oneuptime <resource> list`，可以列出某种记录的 ID。资源就绪后，`status.atProvider` 会显示该记录。要从此管理它，请在 `spec.forProvider` 中写入它的字段，并把 `managementPolicies` 设为 `["*"]`。

## 机密

### OneUptime 生成的机密

有些记录带有 OneUptime 生成的机密，例如遥测摄取密钥的机密。提供程序从不把机密放进资源：它把机密写入资源所在命名空间中由 `writeConnectionSecretToRef` 指定的 Secret，键名为 `attribute.` 加上 Terraform 属性的名称：

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

删除资源也会删除该 Secret。

### 你提供的机密

存放机密的字段（例如监视器步骤中 TLS 客户端私钥的密码短语）不接受值，而是接受资源所在命名空间中的 Secret：`tlsClientKeyPassphraseSecretRef`，写明 Secret 的 `name` 和 `key`。

## 在 Kubernetes 之外所做的更改

提供程序每 10 分钟把每个资源与其记录核对一次，并改回别人在 OneUptime 中所做的任何更改。要更频繁地检查，请为提供程序添加一个带有 `--poll` 的运行时配置：

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

要在记录创建后把某个字段交给仪表板管理，请把它写在 `spec.initProvider` 而不是 `spec.forProvider` 中：它只用于创建记录，之后不会被改回。要把整条记录交给仪表板管理，请从它的管理策略中去掉 `Update`：`["Observe", "Create", "Delete", "LateInitialize"]`。

## 删除资源

删除资源会删除它在 OneUptime 中的记录。要保留记录，请在删除资源之前，从它的管理策略中去掉 `Delete`：`["Observe", "Create", "Update", "LateInitialize"]`。只做观察的资源从不删除它的记录。

## 排查资源问题

`kubectl -n team-a get managed` 会显示每个资源的 `SYNCED` 和 `READY`。其中一个不是 `True` 时，资源的状况和 Kubernetes 事件会说明原因；如果 API 拒绝了请求，还会附上 OneUptime 的答复：

```bash
kubectl -n team-a describe monitors.crossplane.oneuptime.com homepage
```

| 显示的内容 | 要检查的内容 |
| --- | --- |
| `cannot read the API key` | `ProviderConfig` 指定的 Secret，或其中的键。 |
| `cannot get referenced ProviderConfig` | 资源指定的 `ProviderConfig` 不在它的命名空间中。要使用集群级的配置，请写 `kind: ClusterProviderConfig`。 |
| 无法解析的引用 | 它指定的资源不在该命名空间中，或者尚未就绪。 |
| 来自 OneUptime API 的错误 | API 密钥的权限，以及错误中提到的字段的值。 |

提供程序的日志会给出更多信息；像上面添加 `--poll` 那样，在它的 `args` 中添加 `--debug`，信息还会更多：

```bash
kubectl -n crossplane-system logs -l pkg.crossplane.io/provider=provider-oneuptime
```

## 验证软件包

每次发布都会用 Sigstore 的 cosign 以无密钥方式为软件包签名，就像为 OneUptime 的镜像签名一样。要在安装软件包之前检查它：

```bash
cosign verify ghcr.io/oneuptime/provider-oneuptime:{{CROSSPLANE_PROVIDER_VERSION}} \
  --certificate-identity https://github.com/OneUptime/oneuptime/.github/workflows/release.yml@refs/heads/release \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```
