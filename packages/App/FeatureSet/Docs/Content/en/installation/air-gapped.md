# Air-Gapped Installation

Install OneUptime on a Kubernetes cluster that has no route to the internet. You carry a release's images and its signed Helm chart across, point the chart at your own registry, and license the Enterprise Edition offline. The images and the chart are the same as every other install's: there is no separate air-gapped edition.

:::cards
- [Bring the release across](#bring-the-release-across): One script saves every image and the chart, and loads them into your registry.
- [Install from your registry](#install-from-your-registry): The values that point the chart inward.
- [License the Enterprise Edition offline](#license-the-enterprise-edition-offline): A signed token, verified inside the install.
- [What still reaches out](#what-still-reaches-out): Every connection left, and what to use instead.
:::

## Before you begin

- **A connected machine** that reaches the internet, with [Helm 3](https://helm.sh/docs/intro/install/) and one of `crane`, `skopeo` or `docker` to copy images.
- **A registry inside the gap** that your cluster pulls from, and a Kubernetes pull secret for it if it asks for credentials.
- **A machine inside the gap** that reaches that registry, with the same image tool, and `helm` and `kubectl` for the cluster.

## Bring the release across

:::steps
### Download the script

On the connected machine, download the script every OneUptime serves, OneUptime Cloud among them:

```bash
curl -fsSL https://oneuptime.com/install/air-gapped -o air-gap.sh
```

### See what the release runs

```bash
bash air-gap.sh images --version 14.0.102
```

It downloads the release's chart and prints every image it runs: OneUptime's own, and the PostgreSQL, ClickHouse and Valkey images the chart deploys. Add `--values values.yaml` so the images of anything your values turn on, such as PgBouncer, vLLM or the database operators, are listed too, and `--edition enterprise` for the Enterprise Edition.

### Check the signatures

While Sigstore can still be reached, check that each image and the chart are the ones OneUptime published: see [Supply Chain Security](/docs/self-hosted/supply-chain-security).

### Save the bundle

```bash
bash air-gap.sh save --version 14.0.102 --values values.yaml
```

It writes the folder `oneuptime-air-gap-14.0.102`: every image as a file, the chart with its signature, and `SHA256SUMS`, a checksum for every file. It saves `linux/amd64` images; add `--platform linux/arm64` for an Arm cluster.

### Carry the folder across

Copy the whole folder into the gap, the way your network allows. Nothing in it needs the internet on the other side.

### Push it into your registry

On the machine inside the gap:

```bash
bash air-gap.sh push --bundle oneuptime-air-gap-14.0.102 --registry registry.example.com
```

It checks every file against `SHA256SUMS` first and stops, pushing nothing, if one differs. Then it pushes every image under your registry with the same name and tag, and prints the values that point the chart at it. Add `--insecure` if `crane` or `skopeo` should reach a registry with a certificate they do not trust.
:::

## Install from your registry

These values move every image to your registry with one setting, `global.imageRegistry`, and turn off each connection OneUptime makes on its own:

```yaml title="values.yaml"
global:
  imageRegistry: registry.example.com
image:
  tag: "14.0.102"
imagePullSecrets:
  - name: internal-registry
updateCheck:
  disabled: true
instanceCheckIn:
  disabled: true
dnsConfig:
  nameservers: []
probes:
  one:
    allowPrivateNetworkMonitors: true
webhooks:
  allowPrivateNetwork: true
```

| Setting | What it does |
| --- | --- |
| `global.imageRegistry` | Takes OneUptime's images, and the PostgreSQL, ClickHouse, Valkey, PgBouncer, vLLM and kubectl images, from your registry under the names `air-gap.sh push` used. |
| `image.tag` | Pins the release you carried across. |
| `imagePullSecrets` | Gives every pod the chart runs the pull secret for your registry. |
| `updateCheck.disabled` | Stops the daily check for new releases and security advisories against GitHub's API. See [Update and Security Checks](/docs/self-hosted/update-checks). |
| `instanceCheckIn.disabled` | Stops the daily check-in with `oneuptime.com`, and the sign-up form's offer of release emails from it. |
| `dnsConfig.nameservers` | Leaves out the public resolvers probes fall back to, so every lookup stays on your own DNS. |
| `probes.one.allowPrivateNetworkMonitors`, `webhooks.allowPrivateNetwork` | Lets monitors and webhooks reach private addresses, which every address inside the gap is. See [Private Network Access](/docs/self-hosted/private-network-access). |

For the Enterprise Edition, add `type: enterprise-edition` under `image`. Then install from the chart in the bundle:

```bash
helm install oneuptime oneuptime-air-gap-14.0.102/chart/oneuptime-14.0.102.tgz \
  --namespace oneuptime --create-namespace -f values.yaml
```

> [!NOTE]
> `global.imageRegistry` leaves an image whose name already includes a registry as it is, such as CloudNativePG's `ghcr.io/cloudnative-pg/postgresql`. `air-gap.sh push` lists those images: set the value that names each one, such as `postgresOperator.cnpg.imageName`, to its copy in your registry. The operators the chart can install (KEDA, CloudNativePG and Altinity's ClickHouse operator) take their registry from their own values.

## License the Enterprise Edition offline

An Enterprise Edition install with no route out activates with a signed license token instead of a license key. A master admin reads the **instance ID** on **Admin Dashboard > Settings > License**, and OneUptime issues a token for that instance. The install verifies the token against the signing keys built into the release and never contacts OneUptime. See [Offline activation](/docs/self-hosted/enterprise#offline-activation-air-gapped-installs).

## Upgrade

Upgrades take the same path. Save the next release's bundle with `air-gap.sh save --version`, carry it across, push it, change `image.tag`, and read that release's notes in [Upgrading](/docs/installation/upgrading) before you run `helm upgrade` with the new chart. The chart runs the database migrations in a job of its own, inside your cluster.

## What still reaches out

With the values above, OneUptime makes no connection out of your network on its own. What is left reaches out only when someone sets it up or uses it:

| Connection | When | Inside the gap |
| --- | --- | --- |
| Mobile app push | Someone signs in to the OneUptime mobile app on this server: push goes through OneUptime's push relay at `oneuptime.com`, or Expo with your own token. | Page people by email, webhook or a chat server on your network instead. See [Push Notifications](/docs/self-hosted/push-notifications). |
| DNSSEC checks of DNS monitors | A DNS monitor with no DNS server of its own checks DNSSEC against `8.8.8.8`. | Give each DNS monitor your own DNS server. |
| Domain monitors | They read registration data from the registries' RDAP servers, found through IANA. | Leave domain monitors out. |
| MCP sign-in | An MCP client that names its metadata by an address is read from that address. | Set `mcpOAuth.disableClientIdMetadataDocuments: true`. |
| Certificates | The install orders a certificate from Let's Encrypt for its own address when you turn on `ssl.provision`, and for a status page's own domain that has none uploaded. | Upload your own certificates. |
| Integrations | Email, SMS and calls, Slack and Microsoft Teams, hosted AI models: each only once you set it up. | Use your own mail server, an [SMS and Call Gateway](/docs/self-hosted/sms-and-call-gateway) and a [model you run](/docs/ai/llm-provider). |

[Connections out of your network](/docs/self-hosted/architecture#connections-out-of-your-network) lists every connection a self-hosted install makes, with the page for each.

## Troubleshooting

:::details push stops with "does not match SHA256SUMS"
A file changed on its way across. Copy the folder again; `push` pushes nothing until every file matches.
:::

:::details Pods stay in ImagePullBackOff
Check that `imagePullSecrets` names a secret that exists in the release's namespace, and that `kubectl describe pod` shows an image under your registry. An image that still names another registry is one `global.imageRegistry` leaves as written: see the note under [Install from your registry](#install-from-your-registry).
:::

## Next steps

:::cards
- [Supply Chain Security](/docs/self-hosted/supply-chain-security): Check every image and the chart before they cross.
- [Hardening Guide](/docs/self-hosted/hardening): Lock the install down for a regulated network.
- [NIST SP 800-53 Control Mapping](/docs/self-hosted/nist-800-53): What OneUptime covers, and what stays yours.
- [Enterprise Edition](/docs/self-hosted/enterprise): Editions, licensing and offline activation.
:::
