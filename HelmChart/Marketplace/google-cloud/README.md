# OneUptime Enterprise on Google Cloud Marketplace

This is the user guide of the OneUptime Enterprise Kubernetes app on
[Google Cloud Marketplace](https://console.cloud.google.com/marketplace/product/oneuptime-marketplace/oneuptime-enterprise).

It installs OneUptime Enterprise in your own Google Kubernetes Engine (GKE)
cluster, from the Google Cloud console or from the command line, and covers
using, backing up, updating, scaling and deleting it.

For billing, licensing and troubleshooting on every marketplace, see
[Cloud Marketplaces](https://oneuptime.com/docs/en/installation/cloud-marketplaces).

## Overview

OneUptime is one platform for the whole incident lifecycle: uptime
monitoring, status pages, on-call, incident management, logs, traces and
metrics. The Enterprise Edition adds SCIM provisioning, audit logs, team
compliance, backups and the instance health dashboards.

Google Cloud Marketplace bills every user of your installation by the hour on
your Google Cloud bill: USD 0.10 per user per hour. Your Marketplace purchase
is also your license. OneUptime reports its users with the reporting Secret
Marketplace creates for the deployment, and each report Google accepts
licenses the Enterprise features. There is no license key.

### What the app deploys

Every resource is named after the app instance (`<name>` below), in the
namespace you choose. The images come from Google's registry,
`marketplace.gcr.io/oneuptime-marketplace/oneuptime-enterprise`, tagged with
the version and its track (such as `15.0.0` and `15.0`).

<!-- TODO(identifiers): the path follows the listing's address (company `oneuptime-marketplace`, product `oneuptime-enterprise`), as Google's docs describe; confirm it here and in REGISTRY below once Google publishes the first version. -->

| Component                  | Kind                                     | Image                   | What it does                                                                         |
| -------------------------- | ---------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------ |
| `<name>-nginx`             | Deployment, and a `LoadBalancer` Service | `.../nginx`             | The ingress: terminates TLS and routes every request to the app                      |
| `<name>-app`               | Deployment                               | the primary image       | The Dashboard, status pages, API, ingest endpoints and background jobs               |
| `<name>-migrate-1`         | Job                                      | the primary image       | Migrates the database to the version installed                                       |
| `<name>-probe-one`         | Deployment                               | `.../probe`             | Runs monitor checks                                                                  |
| `<name>-global-runner`     | Deployment                               | `.../runner`            | Runs the JavaScript steps of projects that have no Runner of their own, in a sandbox |
| `<name>-postgresql`        | StatefulSet, with a 25 GiB volume        | `.../postgres`          | PostgreSQL: projects, monitors, incidents, users and settings                        |
| `<name>-clickhouse-shard0` | StatefulSet, with a 25 GiB volume        | `.../clickhouse-server` | ClickHouse: logs, metrics, traces and monitor logs                                   |
| `<name>-valkey`            | StatefulSet                              | `.../valkey`            | Valkey: the cache and job queues                                                     |

An `Application` resource named `<name>` groups them, so the console shows
them together under **Kubernetes Engine > Applications**. See
[Architecture](https://oneuptime.com/docs/en/self-hosted/architecture) for how
they fit together.

### Configuration

The deployment form in the Google Cloud console asks for:

| Field            | Chart value                                         | What to enter                                                                                                          |
| ---------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Name             | the release name                                    | The app instance's name. Every resource's name starts with it.                                                         |
| Namespace        | the release namespace                               | Where OneUptime runs.                                                                                                  |
| Reporting Secret | `enterpriseMarketplace.googleCloud.reportingSecret` | Filled in by Marketplace: the Secret OneUptime reports its users with.                                                 |
| Domain name      | `host`                                              | Where people will open OneUptime, such as `oneuptime.example.com`. You point it at the load balancer after installing. |
| Protocol         | `httpProtocol`                                      | `https` if a certificate is in front of OneUptime (see [TLS](#tls)), otherwise `http`.                                 |

A command-line installation passes the same values, and can set any other
value of the [OneUptime Helm chart](https://artifacthub.io/packages/helm/oneuptime/oneuptime)
too, except the bundled operators, whose images the listing does not ship.

### Requirements

- **A GKE Standard cluster.** Marketplace's Kubernetes apps cannot be
  installed on Autopilot clusters.
- **x86 nodes** (`linux/amd64`): at least 3 nodes of 2 vCPUs and 8 GiB of
  memory; 3 nodes of 4 vCPUs and 16 GiB are recommended. Size the databases
  with [Sizing & Capacity Planning](https://oneuptime.com/docs/en/installation/sizing).
- **A default StorageClass** and **`LoadBalancer` Services**, which GKE has.
- **Outbound HTTPS** to `servicecontrol.googleapis.com` and
  `oauth2.googleapis.com`, so OneUptime can report its users.

## One-time setup

A command-line installation needs these first. To install from the Google
Cloud console, go on to [Installation](#installation).

### Client tools

You need `gcloud`, `kubectl`, Helm 3, `git`, `python3` and `openssl`.
[Cloud Shell](https://docs.cloud.google.com/shell/docs) has them all. Connect `kubectl`
to your cluster:

```bash
gcloud container clusters get-credentials CLUSTER_NAME --location CLUSTER_LOCATION
```

### The Application resource definition

Install the `Application` CustomResourceDefinition, once per cluster:

```bash
kubectl apply -f "https://raw.githubusercontent.com/GoogleCloudPlatform/marketplace-k8s-app-tools/master/crd/app-crd.yaml"
```

### The license

Choose a name and a namespace for the installation, and create the
namespace:

```bash
export APP_INSTANCE_NAME=oneuptime
export NAMESPACE=oneuptime

kubectl create namespace "$NAMESPACE"
```

Open the listing in the Google Cloud console, select **Configure**, and on
the **Deploy via command line** tab download the license key: a Kubernetes
Secret holding the reporting credentials (`consumer-id`, `entitlement-id` and
`reporting-key`). Save it as `license.yaml`, apply it in the namespace, and
keep its name:

```bash
kubectl apply --namespace "$NAMESPACE" -f license.yaml
export REPORTING_SECRET="$(kubectl get --namespace "$NAMESPACE" -f license.yaml -o jsonpath='{.metadata.name}')"
```

## Installation

To install from the Google Cloud console instead, select **Configure** on the
listing, fill in the form and select **Deploy**, then go on to
[Basic usage](#basic-usage).

### Set the parameters

```bash
export TAG=15.0.0                                    # the version to install, as the listing shows it
export REGISTRY=marketplace.gcr.io/oneuptime-marketplace/oneuptime-enterprise   # the listing's registry path
export DOMAIN=oneuptime.example.com
export PROTOCOL=http                                 # https once a certificate is in front of OneUptime
```

### Get the chart

The chart is built from OneUptime's public repository, at the version's tag:

```bash
git clone --depth 1 --branch "$TAG" https://github.com/OneUptime/oneuptime.git "oneuptime-$TAG"
python3 "oneuptime-$TAG/HelmChart/Marketplace/build.py" --marketplace google-cloud --version "$TAG" --out "oneuptime-google-cloud-$TAG"
```

The chart is then in `oneuptime-google-cloud-$TAG/chart/oneuptime`.

### Pin the images to their digests

Each image of the version, by its immutable digest:

```bash
digest() {
  gcloud container images describe "$1:$TAG" --format='value(image_summary.fully_qualified_digest)'
}

export IMAGE_APP="$(digest "$REGISTRY")"
export IMAGE_NGINX="$(digest "$REGISTRY/nginx")"
export IMAGE_PROBE="$(digest "$REGISTRY/probe")"
export IMAGE_RUNNER="$(digest "$REGISTRY/runner")"
export IMAGE_POSTGRES="$(digest "$REGISTRY/postgres")"
export IMAGE_CLICKHOUSE="$(digest "$REGISTRY/clickhouse-server")"
export IMAGE_VALKEY="$(digest "$REGISTRY/valkey")"
```

### Generate the passwords and keys

The chart makes up its passwords and keys when it is not given them, and a
command-line installation renders the chart again for every change. Generate
them once, into a file you keep safe:

```bash
cat > "${APP_INSTANCE_NAME}-secrets.yaml" <<EOF
oneuptimeSecret: "$(openssl rand -hex 16)"
encryptionSecret: "$(openssl rand -hex 16)"
registerProbeKey: "$(openssl rand -hex 16)"
probes:
  one:
    key: "$(openssl rand -hex 16)"
globalRunner:
  key: "$(openssl rand -hex 16)"
postgresql:
  auth:
    postgresPassword: "$(openssl rand -hex 16)"
clickhouse:
  auth:
    password: "$(openssl rand -hex 16)"
valkey:
  auth:
    password: "$(openssl rand -hex 16)"
EOF
```

Every later render needs the same file. `encryptionSecret` encrypts the
credentials OneUptime stores, and restoring a backup needs the one it was
made with.

### Render and apply

Render the chart with every parameter, client-side:

```bash
helm template "$APP_INSTANCE_NAME" "oneuptime-google-cloud-$TAG/chart/oneuptime" \
  --namespace "$NAMESPACE" \
  --values "${APP_INSTANCE_NAME}-secrets.yaml" \
  --set enterpriseMarketplace.googleCloud.reportingSecret="$REPORTING_SECRET" \
  --set host="$DOMAIN" \
  --set httpProtocol="$PROTOCOL" \
  --set image.overrides.app="$IMAGE_APP" \
  --set image.overrides.nginx="$IMAGE_NGINX" \
  --set image.overrides.probe="$IMAGE_PROBE" \
  --set image.overrides.runner="$IMAGE_RUNNER" \
  --set image.overrides.postgres="$IMAGE_POSTGRES" \
  --set image.overrides.clickhouse="$IMAGE_CLICKHOUSE" \
  --set image.overrides.valkey="$IMAGE_VALKEY" \
  > "${APP_INSTANCE_NAME}_manifest.yaml"
```

Apply it, then label every resource with the instance's name, as the console
does, so the `Application` finds them:

```bash
kubectl apply --namespace "$NAMESPACE" -f "${APP_INSTANCE_NAME}_manifest.yaml"
kubectl label --overwrite --namespace "$NAMESPACE" -f "${APP_INSTANCE_NAME}_manifest.yaml" "app.kubernetes.io/name=$APP_INSTANCE_NAME"
```

### Wait for OneUptime

OneUptime migrates its database first, which takes a few minutes on a new
installation. It is ready when the app is:

```bash
kubectl rollout status deployment "${APP_INSTANCE_NAME}-app" --namespace "$NAMESPACE" --timeout=30m
```

## Basic usage

### Open OneUptime

OneUptime is reached through the external IP of its load balancer:

```bash
kubectl get service "${APP_INSTANCE_NAME}-nginx" --namespace "$NAMESPACE"
```

Create a DNS record that points your domain name at the `EXTERNAL-IP`, open
the domain name, and sign up. The first account on a new installation becomes
its master admin, who can open the Admin Dashboard at `/admin`. Within the
hour, the edition label in the Admin Dashboard's header shows the Enterprise
Edition, licensed through your marketplace.

### Usernames and passwords

There is no default account or password. Everyone signs up or is invited with
their own email address, and changes their password under
**Security > Password Management** in their account settings
([Change your password](https://oneuptime.com/docs/en/introduction/your-account#change-your-password)).
Master admins manage the installation's users in the Admin Dashboard.

To work with OneUptime from a terminal, see the
[OneUptime CLI](https://oneuptime.com/docs/en/cli/index).

### TLS

OneUptime's ingress terminates TLS itself. No Kubernetes Ingress is needed.

- **A Let's Encrypt certificate.** OneUptime orders one for its domain name.
  The domain name must point at the load balancer, and ports 80 and 443 must
  be reachable from the internet. On a command-line
  installation, render and apply again with `PROTOCOL=https` and
  `--set ssl.provision=true`.
- **Your own TLS in front.** End TLS at a load balancer or proxy of your own,
  in front of the `<name>-nginx` Service, and choose `https` as the protocol.

## Backup and restore

The Enterprise Edition backs up PostgreSQL and ClickHouse itself, on a
schedule, to Cloud Storage or any S3-compatible storage. In the Admin
Dashboard, open **Settings > Backups** and select **Set up backups**. For
Cloud Storage, create a bucket for backups only, and an HMAC key of a service
account with the Storage Object Admin role on it. ClickHouse writes its own
backup to the bucket, so it must reach `storage.googleapis.com` too.

To restore, select **Restore** on a backup on the same page. To move to a new
installation, set up the same destination there; it lists the backups to
restore. A restore needs the `encryptionSecret` the backup was made with.

See [Backups](https://oneuptime.com/docs/en/installation/backups) for every
option, the restore steps and troubleshooting.

## Image updates

Google Cloud Marketplace keeps a deployment on the images it installed, and
never updates it. A new version on the listing is for new deployments.

**A deployment made in the Google Cloud console:** contact
[support](https://oneuptime.com/support) before you move it to a new version.

**A deployment made from the command line:** install the new version over it,
with the same name, namespace, parameters and secrets file. The databases'
volumes are kept, and OneUptime migrates its database when the new version
starts.

1. Read the [upgrade notes](https://oneuptime.com/docs/en/installation/upgrading)
   of every version in between, and back up first.
2. Set `TAG` to the new version, then [get its chart](#get-the-chart) and
   [pin its images](#pin-the-images-to-their-digests).
3. Delete the previous migration Job. The new manifest has one with the same
   name, which `kubectl` cannot change:

   ```bash
   kubectl delete job "${APP_INSTANCE_NAME}-migrate-1" --namespace "$NAMESPACE" --ignore-not-found
   ```

4. [Render and apply](#render-and-apply) as before. The new pods wait,
   unready, until the migrations are done, while the old ones keep serving.

## Scaling

Billing does not change with scale: OneUptime is billed per user.

The app and the ingress are stateless. On a console deployment, scale them
with `kubectl`:

```bash
kubectl scale deployment "${APP_INSTANCE_NAME}-app" "${APP_INSTANCE_NAME}-nginx" --replicas=3 --namespace "$NAMESPACE"
```

On a command-line installation, render and apply again with
`--set app.replicaCount=3 --set nginx.replicaCount=3`, or with
`--set autoscaling.enabled=true` to scale the app, the ingress and the probe
by their CPU and memory.

PostgreSQL, ClickHouse and Valkey run one replica each: do not scale their
StatefulSets. For larger or highly available databases, point OneUptime at
managed ones with the chart's `externalPostgres`, `externalClickhouse` and
`externalValkey` values.

## Deletion

Deleting the installation stops its reports, so it is no longer billed.

**A deployment made in the Google Cloud console:** under
**Kubernetes Engine > Applications**, select it and **Delete**, or:

```bash
kubectl delete application "$APP_INSTANCE_NAME" --namespace "$NAMESPACE"
```

**A deployment made from the command line:**

```bash
kubectl delete --namespace "$NAMESPACE" --ignore-not-found -f "${APP_INSTANCE_NAME}_manifest.yaml"
kubectl delete --namespace "$NAMESPACE" -f license.yaml
```

The databases' volumes stay behind either way, with all of OneUptime's data.
Delete them once you no longer need the data; this cannot be undone:

```bash
kubectl delete persistentvolumeclaim --namespace "$NAMESPACE" \
  "data-${APP_INSTANCE_NAME}-postgresql-0" \
  "data-${APP_INSTANCE_NAME}-clickhouse-shard0-0"
```

Then check that nothing is left, and delete the namespace if OneUptime was
alone in it:

```bash
kubectl get all,persistentvolumeclaim,secret --namespace "$NAMESPACE"
kubectl delete namespace "$NAMESPACE"
```
