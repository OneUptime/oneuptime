# Crossplane Overview

The OneUptime Crossplane provider manages your OneUptime project from Kubernetes. Declare monitors, status pages, on-call policies, teams, labels and the other records of your project as Kubernetes resources, and Crossplane keeps your project the way they say: it creates what is new, changes what you edit, puts back what someone changed elsewhere, and deletes what you remove. Argo CD, Flux and any other tool that applies manifests apply these too. It works with OneUptime Cloud and with a self-hosted OneUptime.

:::cards
- [How the provider works](#how-the-provider-works): Kinds, namespaces, and the API key behind them.
- [Install the provider](#install-the-provider): The package, and the version to pick.
- [Give it your API key](#give-it-your-api-key): A Secret and a ProviderConfig in your namespace.
- [Create your first resources](#create-your-first-resources): A monitor, the label it carries and the statuses it sets.
:::

## How the provider works

The provider is a Crossplane package. Installed, it adds a kind for each type of record of the OneUptime API to the `crossplane.oneuptime.com` API group: `Monitor`, `StatusPage`, `OnCallPolicy`, `Team`, `Label` and over 400 more. Each resource of these kinds lives in a namespace and stands for one record of your project. The provider reads and changes the record through the OneUptime REST API, with an API key of your project, and writes what it finds to the resource's status.

The provider is made from the [Terraform provider](/docs/terraform/index), release by release: its kinds are the Terraform provider's resources, with the same fields and the same API requests behind them.

## Before you begin

- **Crossplane 2.0 or later.** The provider's resources live in namespaces, which Crossplane 2 brought. Crossplane's own documentation shows how to install it in your cluster.
- **An API key of your project.** The Terraform [Quick Start](/docs/terraform/quick-start#create-a-project-api-key) shows how to create one in **Project Settings → Advanced → API Keys**. The key decides which project the resources belong to and what the provider may change in it.
- **On OneUptime Cloud, the Growth plan or above.** A project's API keys work only on it.

## Install the provider

Install the package with a `Provider`:

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

When `INSTALLED` and `HEALTHY` both say `True`, the provider is running. The same package is on Docker Hub, as `docker.io/oneuptime/provider-oneuptime`.

### Pick a version

The package's versions are OneUptime's: `{{CROSSPLANE_PROVIDER_VERSION}}` is made from that release of OneUptime, the one serving this page. On OneUptime Cloud, use the newest. On a self-hosted OneUptime, use the version of your OneUptime, so that the provider knows the fields your OneUptime's API does.

### Activate only the kinds you use

Crossplane's Helm chart activates every kind of every provider by default (its `provider.defaultActivations` value), which for this provider is over 400 custom resource definitions. To activate only the kinds you use, install Crossplane with `--set provider.defaultActivations={}` and name the kinds in a policy:

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

## Give it your API key

Put the key in a Secret of the namespace your resources will live in, and point a `ProviderConfig` of that namespace at it. Creating the Secret with `kubectl` keeps the key out of your files:

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

A `ProviderConfig` reads Secrets of its own namespace only, so one namespace's key cannot be used from another. Each resource names its `ProviderConfig` in `spec.providerConfigRef`.

### Use a self-hosted OneUptime

Give the `ProviderConfig` your OneUptime's address as `url`, without `/api`:

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

### Share one key across namespaces

A `ClusterProviderConfig` reads a Secret of any namespace, and resources of every namespace may name it. Use one when a single team looks after the key for the whole cluster:

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

A resource names it with `kind: ClusterProviderConfig` in its `providerConfigRef`. The Secret holds the key alone, or JSON that names the address as well: `{"api_key": "<your-api-key>", "oneuptime_url": "https://oneuptime.example.com"}`. A `url` in the `ClusterProviderConfig` wins over the JSON's. A `ClusterProviderConfig` can also read the key from an environment variable or a file of the provider's pod, with `source: Environment` or `source: Filesystem`.

## Create your first resources

A monitor of your homepage, with a label, that sets your project's **Offline** and **Operational** statuses.

:::steps
### Observe the statuses it sets

OneUptime made your project's statuses with the project, so they are observed rather than created: the provider reads them by their IDs and never changes or deletes them. `oneuptime monitor-status list --fields _id,name` lists the IDs, with the [OneUptime CLI](/docs/cli/resource-operations#list-records).

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

### Create the label and the monitor

The monitor names the label and the statuses by their Kubernetes names, and the provider fills in their IDs:

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

### See them in OneUptime

```bash
kubectl apply -f statuses.yaml -f homepage.yaml
kubectl -n team-a get managed
```

When `SYNCED` and `READY` say `True`, the record is in your project. `EXTERNAL-NAME` is its ID in OneUptime.
:::

## Next steps

- [Managing Resources](/docs/crossplane/managing-resources) explains the kinds and their fields, references, importing what you already have, the Secrets OneUptime makes, and what to look at when a resource is not ready.
- The [Terraform Complete Guide](/docs/terraform/complete-guide) describes the resources and their fields, which the provider's kinds share.
