<!-- markdownlint-disable MD033 -->
<h1 align="center"><img alt="oneuptime logo" width=50% src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/OneUptimePNG/7.png"/></h1>
<!-- markdownlint-enable MD033 -->

# OneUptime Helm Chart

OneUptime is a comprehensive solution for monitoring and managing your online
services — availability monitoring, status pages, incident management, on-call
rotations, log/performance/error analysis, and more. This Helm chart deploys the
full OneUptime platform on Kubernetes.

- **Website:** [oneuptime.com](http://www.oneuptime.com)
- **Video tutorial:** [youtu.be/Ho5WyPHExTU](https://youtu.be/Ho5WyPHExTU)

## Quick Start

1. **Create a `values.yaml`** and set your host:

   ```yaml
   host: <ip-address-or-domain-of-server>
   httpProtocol: https   # use http if you are not using SSL/TLS

   global:
     storageClass: "your-storage-class"   # run: kubectl get storageclass
   ```

2. **Install the chart:**

   ```console
   helm repo add oneuptime https://helm-chart.oneuptime.com/
   helm install my-oneuptime oneuptime/oneuptime -f values.yaml
   ```

That's the whole happy path. For details, prerequisites, and upgrades, see the
[Installation guide](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/installation.md).

## Documentation

The docs are split into focused guides:

| Guide | What's inside |
|-------|---------------|
| [Installation & Upgrades](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/installation.md) | Prerequisites, install, upgrade, and uninstall. |
| [Configuration reference](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md) | Every `values.yaml` setting, grouped by topic. |
| [Databases](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/databases.md) | PostgreSQL, Redis, and ClickHouse — built-in, external, and HA operators. |
| [Local AI with vLLM](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/ai-vllm.md) | Run local LLMs in-cluster for OneUptime's AI features. |
| [Custom domains](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/custom-domains.md) | Custom status page domains and Let's Encrypt. |
| [Production checklist](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/production-checklist.md) | Harden your install for production. |
| [Troubleshooting](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/troubleshooting.md) | Diagnose performance and health issues. |
| [Releases & upgrade notes](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/upgrade-notes.md) | Release cadence, breaking changes, and chart dependencies. |

### Database migration runbooks

- [PostgreSQL: Standalone → CloudNativePG operator](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Docs/MigratePostgresStandaloneToOperator.md)
- [ClickHouse: Standalone → Altinity operator](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Docs/MigrateClickhouseStandaloneToOperator.md)

## Community vs. Enterprise

| Edition            | Best for                                             | Included                                                                                             | Requirements  |
|--------------------|-------------------------------------------------------|------------------------------------------------------------------------------------------------------|---------------|
| Community Edition  | Getting started, small self-hosted deployments        | Fully featured OneUptime platform with the standard security posture.                                | None          |
| Enterprise Edition | Regulated industries, teams with strict compliance    | Hardened container images with additional security controls; custom features and roadmap input; a dedicated engineer with 1-hour priority phone support; custom data residency and retention; private cloud or SaaS with annual invoicing. | Valid license |

Select the edition with `image.type` (`community-edition` or
`enterprise-edition`) — see the [Configuration reference](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#images).

## Uninstalling

```console
helm uninstall my-oneuptime
```

See [Installation & Upgrades](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/installation.md#uninstalling) for caveats
(especially if you enabled a bundled database operator).

## Contributing

We <3 contributions big and small.
[github.com/OneUptime/helm-chart](https://github.com/OneUptime/helm-chart) is the
read-only release repository. Please direct contributions to
[github.com/OneUptime/oneuptime](https://github.com/OneUptime/oneuptime).
