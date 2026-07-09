# Installation & Upgrades

How to install, upgrade, and uninstall the OneUptime Helm chart.

> New here? The [README Quick Start](../README.md#quick-start) is the fastest path. This page is the full reference.

## Prerequisites

- A Kubernetes cluster and [`kubectl`](../../../Docs/Kubernetes.md) configured to talk to it.
- [Helm 3](../../../Docs/Helm.md) installed.
- A hostname or IP address where OneUptime will be reachable.

## 1. Create a `values.yaml`

Create a `values.yaml` file and set your host:

```yaml
host: <ip-address-or-domain-of-server>

# If you are NOT using SSL/TLS, change this to http
httpProtocol: https
```

## 2. Pick a storage class

Storage classes differ between cloud providers, so pick the right one for your
cluster. List what's available:

```console
kubectl get storageclass
```

Then add it to `values.yaml`:

```yaml
global:
  storageClass: "your-storage-class"
```

## 3. Install the chart

```console
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime -f values.yaml
```

That's it — OneUptime will start up in your cluster. For the full list of
settings you can put in `values.yaml`, see the
[Configuration reference](configuration.md).

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
