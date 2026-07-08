<!-- markdownlint-disable MD033 MD041 -->
<div align="center">
  <a href="https://oneuptime.com">
    <img alt="OneUptime logo" width="55%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/OneUptimePNG/7.png"/>
  </a>

  <h3>One open-source platform for uptime, incidents, on-call, status pages, logs, traces, metrics & APM.</h3>

  <p>Monitoring, StatusPage, On-Call, Incidents, Logs, and APM — replace a whole shelf of SaaS tools with one platform you can self-host for free.</p>

  <p>
    <a href="https://github.com/OneUptime/oneuptime/blob/master/LICENSE"><img src="https://img.shields.io/github/license/OneUptime/oneuptime?color=1a73e8" alt="License"></a>
    <a href="https://github.com/OneUptime/oneuptime/releases"><img src="https://img.shields.io/github/v/release/OneUptime/oneuptime" alt="Release"></a>
    <a href="https://github.com/OneUptime/oneuptime/stargazers"><img src="https://img.shields.io/github/stars/OneUptime/oneuptime?style=flat" alt="Stars"></a>
    <a href="https://artifacthub.io/packages/helm/oneuptime/oneuptime"><img src="https://img.shields.io/badge/Helm-Chart-0f1689" alt="Helm Chart"></a>
    <a href="https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA"><img src="https://img.shields.io/badge/Slack-Community-4A154B" alt="Slack"></a>
  </p>

  <p>
    <a href="https://oneuptime.com"><b>Website</b></a> &nbsp;•&nbsp;
    <a href="https://oneuptime.com/docs"><b>Docs</b></a> &nbsp;•&nbsp;
    <a href="#-quick-start"><b>Quick Start</b></a> &nbsp;•&nbsp;
    <a href="https://oneuptime.com/pricing"><b>Pricing</b></a> &nbsp;•&nbsp;
    <a href="#-contributing"><b>Contribute</b></a>
  </p>

  <a href="https://oneuptime.com"><b>🚀 Try OneUptime Cloud — free forever plan, no credit card →</b></a>
</div>

<br/>

<div align="center">
  <img alt="OneUptime dashboard" width="90%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/readme/monitoring.png"/>
</div>

---

## Replace your whole observability stack

OneUptime brings monitoring, alerting, incident response, and observability into a single open-source app — so you stop paying for (and stitching together) a dozen separate tools.

| Instead of… | Use OneUptime for… |
|---|---|
| Pingdom / UptimeRobot | **Uptime Monitoring** — website, API, ping, port, SSL, DNS & synthetic checks from around the world |
| StatusPage.io | **Status Pages** — branded public & private status pages with subscribers |
| PagerDuty / Opsgenie | **On-Call & Alerts** — schedules, escalation policies, SMS / call / push / Slack |
| Incident.io | **Incident Management** — declare, triage, communicate, and post-mortem |
| Datadog / New Relic | **APM & Metrics** — traces, dashboards, and service performance |
| Loggly | **Log Management** — collect, search, and alert on logs |
| Sentry | **Error Tracking** — exceptions with full stack traces and context |

All of it is **100% open source (Apache 2.0)** and free to self-host.

---

## ⚡ Quick Start

### ☁️ OneUptime Cloud — the easy way

Zero setup, always up to date, and it funds the open-source project.

**→ [Sign up free at oneuptime.com](https://oneuptime.com)**

### 🐳 Self-host with Docker Compose

Everything you need on a single server (Debian / Ubuntu / RHEL, Docker + Docker Compose). Great for homelabs and small teams — a Raspberry Pi even works.

```bash
# 1. Clone the release branch
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# 2. Create your config (then edit it — set strong, random secrets!)
cp config.example.env config.env

# 3. Start everything
npm start
```

OneUptime is now running at **http://localhost** — open it and create your first account.

📖 Full guide: [Docker Compose install](/App/FeatureSet/Docs/Content/en/installation/docker-compose.md) · [Sizing & requirements](/App/FeatureSet/Docs/Content/en/installation/sizing.md)

### ☸️ Kubernetes with Helm — for production

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm install oneuptime oneuptime/oneuptime
```

📖 Full install instructions & values on [Artifact Hub →](https://artifacthub.io/packages/helm/oneuptime/oneuptime)

> **Upgrading an existing install?** See the [upgrade guide](/App/FeatureSet/Docs/Content/en/installation/upgrading.md).

---

## ✨ Features

| | Feature | What it does |
|---|---|---|
| 📊 | **Uptime Monitoring** | Website, API, IP, port, SSL, DNS, and synthetic monitors from multiple global regions. |
| 📋 | **Status Pages** | Beautiful branded status pages, incident history, scheduled maintenance, and subscriber notifications. |
| 🚨 | **Incident Management** | End-to-end incident workflow: declare, assign, communicate, resolve, and run post-mortems. |
| 📞 | **On-Call & Alerts** | On-call schedules and escalation policies with SMS, phone call, push, email, and Slack alerts. |
| 📝 | **Log Management** | Ingest, store, search, and alert on logs via OpenTelemetry. |
| 🔍 | **APM & Traces** | Distributed traces, spans, and performance dashboards to find slow paths and bottlenecks. |
| 📈 | **Metrics & Dashboards** | Custom dashboards over your telemetry — build the views your team needs. |
| 🐛 | **Error Tracking** | Capture exceptions with full stack traces, context, and release tracking. |
| ⚡ | **Workflows** | Automate and integrate with Slack, Jira, GitHub, Microsoft Teams, and 5,000+ apps. |
| 🤖 | **AI Copilot** | An always-on agent that finds anomalies across logs, traces & metrics, spots root causes, and opens PRs with fixes. |

### 🖥️ Infrastructure Monitoring

Drop in copy-paste, **OpenTelemetry-based** agents to watch everything your services run on — with ready-made alert templates included:

- **Servers & VMs** — CPU, memory, disk, network, processes, and logs from Linux, macOS & Windows. [Docs →](/App/FeatureSet/Docs/Content/en/telemetry/host-otel-collector.md)
- **Kubernetes** — one `helm install` ships node/pod/container/cluster metrics, events, logs, and eBPF traces & service maps. [Docs →](/App/FeatureSet/Docs/Content/en/telemetry/kubernetes-agent.md)
- **Docker** — a single agent auto-discovers every container and ships metrics & logs. [Docs →](/App/FeatureSet/Docs/Content/en/telemetry/docker-host.md)
- **Podman** — same one-agent auto-discovery via Podman's Docker-compatible socket. [Docs →](/App/FeatureSet/Docs/Content/en/telemetry/podman-host.md)
- **Proxmox** — nodes, VMs, containers, storage, HA state, backup coverage & replication health. [Docs →](/App/FeatureSet/Docs/Content/en/telemetry/proxmox.md)
- **Ceph** — cluster health, capacity forecasts, and OSD/pool/PG/monitor visibility. [Docs →](/App/FeatureSet/Docs/Content/en/telemetry/ceph.md)

<details>
<summary><b>📸 See the screenshots</b></summary>
<br/>

**Uptime Monitoring**
![Monitoring](/Home/Static/img/readme/monitoring.png?raw=true)

**Status Pages**
![Status Pages](/Home/Static/img/readme/statuspages.png?raw=true)

**Incident Management**
![Incident Management](/Home/Static/img/readme/incident-management.png?raw=true)

**On-Call & Alerts**
![On Call and Alerts](/Home/Static/img/readme/on-call.png?raw=true)

**Log Management**
![Logs Management](/Home/Static/img/readme/logs-management.png?raw=true)

**Application Performance Monitoring**
![APM](/Home/Static/img/readme/apm.png?raw=true)

**Workflows**
![Workflows](/Home/Static/img/readme/workflows.png?raw=true)

</details>

---

## 💼 Community vs. Enterprise

| | **Community** | **Enterprise** |
|---|---|---|
| **Best for** | Self-hosters & small teams | Regulated teams needing premium support |
| **Cost** | Free & open source | [Contact sales](mailto:sales@oneuptime.com) |
| **Features** | Full feature set | Full feature set + hardened images, priority support, custom features & data residency |

---

## 💡 Why OneUptime?

Our mission is simple: **reduce downtime and help more products succeed.** Instead of duct-taping seven vendors together, you get one platform that helps you understand *why* things break, respond to incidents fast, and cut operational toil — fully open source, so you own your data and your stack.

---

## 🤝 Contributing

We welcome contributions of every size. Start here:

- 🐛 **[Open issues](https://github.com/OneUptime/oneuptime/issues)** — pick one up, or [file a new one](https://github.com/OneUptime/oneuptime/issues/new)
- ✅ **[Help write tests](https://github.com/OneUptime/oneuptime/issues?q=is%3Aopen+is%3Aissue+label%3A%22write+tests%22)** for the codebase
- 🧑‍💻 **[Local development guide](/App/FeatureSet/Docs/Content/en/installation/local-development.md)** to get set up
- 📖 Read the **[contributing guidelines](CONTRIBUTING.md)**
- 💬 Chat with us in the **[Developer Slack](https://join.slack.com/t/oneuptimedev/shared_invite/zt-17r8o7gkz-nITGan_PS9JYJV6WMm_TsQ)** or **[Community Slack](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA)**

## ❤️ Support the project

If OneUptime is useful to you:

- ⭐ **Star this repo** — it genuinely helps others find us
- 💵 **[Sponsor us](https://github.com/sponsors/OneUptime)** — every dollar ships new features
- 🛍️ **[Grab some merch](https://shop.oneuptime.com)** — all proceeds fund open-source development

---

## 📄 License

OneUptime is licensed under the [Apache License 2.0](LICENSE).

<div align="center">
  <sub>Made with ❤️ by the <a href="https://oneuptime.com">OneUptime</a> team and <a href="https://github.com/OneUptime/oneuptime/graphs/contributors">contributors</a>.</sub>
</div>
