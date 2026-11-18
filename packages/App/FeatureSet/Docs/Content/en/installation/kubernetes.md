# Kubernetes and Helm

Run OneUptime on your own Kubernetes cluster with the Helm chart. Your OneUptime server serves this page itself, so it opens without a route to the internet and describes the chart of the version you run. Every value the chart takes is in the chart's own docs, on [Artifact Hub](https://artifacthub.io/packages/helm/oneuptime/oneuptime).

:::cards
- [Install the chart](#install-the-chart): One values file and two commands.
- [Back up your data](#back-up-your-data): PostgreSQL and ClickHouse, to storage outside the cluster.
- [Keep your keys](#keep-your-keys): What your backups cannot be read without.
:::

## Install the chart

Create a `values.yaml` with the domain name or IP address people will use, without `http://`:

```yaml title="values.yaml"
host: oneuptime.example.com
```

Then install the chart:

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime -f values.yaml
```

**It worked when** `kubectl get pods` shows every pod `Running` and the address opens OneUptime. The [Self-Hosting Guide](/docs/installation/self-hosting-guide) goes on from there: HTTPS, the admin account, and email, SMS and calls.

## Back up your data

OneUptime keeps its data on the cluster's persistent volumes: PostgreSQL holds your projects, monitors, incidents, status pages and users, and ClickHouse holds your logs, traces and metrics. Back both up to storage outside the cluster, in one of these ways:

- **Scheduled backups in the Enterprise Edition.** Set them up in the Admin Dashboard under **Settings > Backups**. See [Backups](/docs/installation/backups).
- **Your cloud provider's backups of the persistent volumes**, such as scheduled snapshots of the PostgreSQL and ClickHouse disks.
- **CloudNativePG's volume snapshot backups**, when PostgreSQL runs on the CloudNativePG operator. Turn them on in `values.yaml`, then apply the change:

```yaml title="values.yaml"
postgresOperator:
  cnpg:
    enabled: true
    backup:
      enabled: true
      schedule: "0 0 3 * * *"
```

```bash
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

The schedule above backs PostgreSQL up every day at 03:00. CloudNativePG does not delete old volume snapshots, so delete the ones you no longer need yourself.

OneUptime cannot see backups made outside it. Once yours run, click **This server is backed up** on the Backups item of the Admin Dashboard's **Server Setup** page.

## Keep your keys

What OneUptime encrypts can only be read with the `encryptionSecret` it was encrypted with. Set `oneuptimeSecret` and `encryptionSecret` yourself in `values.yaml`, so that no upgrade replaces them, and keep a copy with your backups, outside the cluster:

```yaml title="values.yaml"
oneuptimeSecret: <random string>
encryptionSecret: <random string>
```

## Next steps

:::cards
- [Self-Hosting Guide](/docs/installation/self-hosting-guide): From an empty cluster to a server that pages you.
- [Upgrading](/docs/installation/upgrading): Back up before every upgrade.
- [Backups](/docs/installation/backups): The Enterprise Edition's scheduled backups.
:::
