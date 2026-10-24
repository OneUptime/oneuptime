# Installation & Upgrades

How to install, upgrade, and uninstall the OneUptime Helm chart.

> New here? The [README Quick Start](../README.md#quick-start) is the fastest path. This page is the full reference.

## Prerequisites

- A Kubernetes cluster and [`kubectl`](../../../Docs/Kubernetes.md) configured to talk to it.
- [Helm 3](../../../Docs/Helm.md) installed.
- A hostname or IP address where OneUptime will be reachable.

If you plan to turn on KEDA autoscaling (`keda.enabled: true`) on a cluster that
has never had KEDA, read [KEDA Ops](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Docs/Keda.md)
first — the bundled operator's CRDs have to reach the cluster before the chart's
`ScaledObject`s can, so the very first install takes one extra pass. Otherwise it
aborts with `no matches for kind "ScaledObject" in version "keda.sh/v1alpha1"`.
Autoscaling is off by default, so this does not apply to a stock install.

## 1. Create a `values.yaml`

Create a `values.yaml` file and set `host` to the domain name or IP address
people will use to open OneUptime, without `http://`:

```yaml
host: oneuptime.example.com
```

OneUptime serves its own pages only at `host`: any other address is taken for
a status page's custom domain, and shows a page that says which `host` to set.

Keep `httpProtocol: http`, the chart's default, until people reach OneUptime
over HTTPS. Then set it to `https`, so OneUptime builds HTTPS links and keeps
its sign-in cookies on HTTPS:

```yaml
httpProtocol: https
```

## 2. Pick a storage class, if your cluster has no default

The chart's PostgreSQL, ClickHouse and Valkey keep their data in volumes of
your cluster's default storage class. List the classes; the default is marked
`(default)`:

```console
kubectl get storageclass
```

Only when none is the default, add one to `values.yaml`:

```yaml
global:
  storageClass: "standard"
```

## 3. Install the chart

```console
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime -f values.yaml
```

`helm install` ends by printing the address to open. Once the pods are running
(`kubectl get pods`), open it and sign up: the first account becomes the admin
of this OneUptime. For the full list of settings you can put in `values.yaml`,
see the [Configuration reference](configuration.md).

## Upgrading

```console
# Refresh the chart repo
helm repo update

# Apply the upgrade
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

We release frequently — often several times a day — and upgrades are usually
safe. Always read the [release notes](https://github.com/OneUptime/oneuptime/releases)
and the [Upgrade notes](upgrade-notes.md) before upgrading, since breaking
changes are documented there.

## Uninstalling

To remove the `my-oneuptime` release:

```console
helm uninstall my-oneuptime
```

> **Heads up:** if you enabled a bundled operator (CloudNativePG or Altinity),
> `helm uninstall` can remove its cluster-scoped CRDs and cascade-delete your
> databases. Back up first. See [Databases](databases.md) for details.
