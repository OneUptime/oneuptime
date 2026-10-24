<!-- markdownlint-disable MD033 MD041 -->
<p align="center">
  <a href="/README.md">English</a>&nbsp;·
  <a href="/Docs/translations/README.zh-CN.md">简&#8288;体&#8288;中&#8288;文</a>&nbsp;·
  <a href="/Docs/translations/README.zh-TW.md">繁&#8288;體&#8288;中&#8288;文</a>&nbsp;·
  <a href="/Docs/translations/README.ja.md">日&#8288;本&#8288;語</a>&nbsp;·
  <a href="/Docs/translations/README.ko.md">한&#8288;국&#8288;어</a>&nbsp;·
  <a href="/Docs/translations/README.es.md">Español</a>&nbsp;·
  <a href="/Docs/translations/README.fr.md">Français</a>&nbsp;·
  <a href="/Docs/translations/README.de.md">Deutsch</a>&nbsp;·
  <a href="/Docs/translations/README.pt.md">Português</a>&nbsp;·
  <a href="/Docs/translations/README.it.md">Italiano</a>&nbsp;·
  <a href="/Docs/translations/README.ru.md">Русский</a>&nbsp;·
  <a href="/Docs/translations/README.hi.md">हिन्दी</a>&nbsp;·
  <a href="/Docs/translations/README.fa.md">فارسی</a>&nbsp;·
  <a href="/Docs/translations/README.nl.md">Nederlands</a>&nbsp;·
  <a href="/Docs/translations/README.da.md">Dansk</a>&nbsp;·
  <a href="/Docs/translations/README.sv.md">Svenska</a>&nbsp;·
  <a href="/Docs/translations/README.no.md">Norsk</a>
</p>

<p align="center">
  <a href="https://oneuptime.com"><picture><source media="(prefers-color-scheme: dark)" srcset="/packages/App/FeatureSet/Docs/Static/images/logo-dark.svg"><img alt="OneUptime" width="42%" src="/packages/App/FeatureSet/Docs/Static/images/logo-light.svg"></picture></a>
</p>

<p align="center">
  <a href="https://github.com/OneUptime/oneuptime/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0%20%2B%20Enterprise%20%28ee%2F%29-1a73e8" alt="License"></a>
  <a href="https://github.com/OneUptime/oneuptime/releases"><img src="https://img.shields.io/github/v/release/OneUptime/oneuptime" alt="Release"></a>
</p>

OneUptime is an open-source observability platform. It checks that your websites, APIs and servers work, collects the logs, metrics and traces your apps send, pages whoever is on call when something breaks, and tells your customers on a status page. It all happens in one product, so the tool that notices a problem is the one that pages your team.

You can use it on [OneUptime Cloud](https://oneuptime.com) or run it on your own servers.

<p align="center">
  <img alt="OneUptime during an incident: its timeline, who is on call, the status page and OneUptime AI's investigation" width="100%" src="/packages/Home/Static/img/readme/hero-command-center.png">
</p>

## What it does

- **[Monitoring](https://oneuptime.com/docs/monitor/create-monitor)**: Check websites, APIs, ports, DNS and certificates from probes around the world or from inside your own network. OneUptime also watches servers, Kubernetes, Docker, VMware, databases and network devices.
- **[Incidents and on-call](https://oneuptime.com/docs/incidents/index)**: Work each incident on one timeline. Page whoever is on call by phone, SMS, email, push, Slack or Microsoft Teams, and escalate until someone responds.
- **[Status pages](https://oneuptime.com/docs/status-pages/index)**: Keep customers informed on public or private status pages, and announce scheduled maintenance there.
- **[Logs, metrics and traces](https://oneuptime.com/docs/telemetry/open-telemetry)**: Send them with OpenTelemetry, search them and build dashboards. Exceptions, profiles, real user monitoring and security events live in the same place.
- **[Workflows and runbooks](https://oneuptime.com/docs/workflows/index)**: Automate routine work, and connect Jira, ServiceNow and the other tools your team already uses.
- **[OneUptime AI](https://oneuptime.com/docs/ai/ai-sre)**: Investigates new incidents and alerts and posts a root cause analysis with citations. When you turn fixing on, it can open a pull request with a fix for your team to review.
- **[API, CLI and Terraform](https://oneuptime.com/docs/api-reference/api-reference)**: Automate OneUptime from your scripts and CI, and manage monitors, status pages and on-call as code.

Everything else is in the [docs](https://oneuptime.com/docs/introduction/getting-started).

## Get started

### OneUptime Cloud

[Sign up](https://oneuptime.com/accounts/register) and create a project. The free plan needs no credit card.

### Self-host with Docker Compose

You need a Linux server with at least 8 GB of memory, and Docker, Docker Compose, Git and Node.js.

Before step 3, set `HOST` in `config.env` to the domain name or IP address people will use to reach OneUptime, without `http://`. Keep `localhost` only to try OneUptime on your own computer.

```bash
# 1. Clone the release branch
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# 2. Create your config
cp config.example.env config.env

# 3. Start everything
npm start
```

`npm start` checks the server, gives every secret in `config.env` its own random value and starts OneUptime. When it prints **OneUptime is up!**, open `http://localhost`, or your server's address, and sign up. The first account becomes the instance's admin.

The [Docker Compose guide](https://oneuptime.com/docs/installation/docker-compose) covers server sizes, HTTPS, backups and updates.

### Kubernetes with Helm

For production at scale, or high availability, install the Helm chart. Set `host` to the domain name or IP address people will use to reach OneUptime:

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime --set host=oneuptime.example.com
```

The [chart's README](/HelmChart/Public/oneuptime/README.md) covers storage, HTTPS, databases and upgrades.

## Community and Enterprise

- **Community Edition**: Free and open source, with everything above, including SAML and OIDC single sign-on.
- **Enterprise Edition**: Adds SCIM provisioning, audit logs, team compliance and instance health dashboards, with priority support. Production use needs a license: [contact sales](mailto:sales@oneuptime.com).

The docs [compare the two editions](https://oneuptime.com/docs/self-hosted/enterprise).

## Get help

- Ask questions in the [OneUptime community on Slack](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA).
- Report bugs and request features in [GitHub issues](https://github.com/OneUptime/oneuptime/issues).
- Report a security vulnerability privately, as [SECURITY.md](/.github/SECURITY.md) explains.
- Email [support@oneuptime.com](mailto:support@oneuptime.com) about anything else.

## Contributing

Bug fixes, features, docs and tests are all welcome. The [local development guide](https://oneuptime.com/docs/installation/local-development) shows how to run OneUptime from source, and the [contributing guidelines](/.github/CONTRIBUTING.md) explain how pull requests and licensing work. Issues labeled [good first issue](https://github.com/OneUptime/oneuptime/labels/good%20first%20issue) are a good place to start.

If OneUptime is useful to you, star this repository or [sponsor the project](https://github.com/sponsors/OneUptime).

## License

OneUptime is open source under the [Apache License 2.0](/LICENSE), except for the [`ee/`](/ee) directory. That directory holds the Enterprise Edition and is licensed under the [OneUptime Enterprise License](/ee/LICENSE). The Community Edition image contains no code from `ee/`. The root [`LICENSE`](/LICENSE) file sets out this split.
