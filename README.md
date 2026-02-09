<!-- markdownlint-disable MD033 -->
<h1 align="center"><img alt="oneuptime logo" width=50% src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/OneUptimePNG/7.png"/></h1>

<p align="center">
  <strong>The Complete Open-Source Observability Platform</strong>
</p>

<p align="center">
  <a href="https://github.com/OneUptime/oneuptime/blob/master/LICENSE"><img src="https://img.shields.io/github/license/OneUptime/oneuptime" alt="License"></a>
  <a href="https://github.com/OneUptime/oneuptime/releases"><img src="https://img.shields.io/github/v/release/OneUptime/oneuptime" alt="Release"></a>
  <a href="https://github.com/OneUptime/oneuptime/stargazers"><img src="https://img.shields.io/github/stars/OneUptime/oneuptime" alt="Stars"></a>
  <a href="https://artifacthub.io/packages/helm/oneuptime/oneuptime"><img src="https://img.shields.io/badge/Helm-Chart-blue" alt="Helm Chart"></a>
  <a href="https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA"><img src="https://img.shields.io/badge/Slack-Community-4A154B" alt="Slack"></a>
</p>

<p align="center">
  <a href="https://oneuptime.com">Website</a> •
  <a href="https://oneuptime.com/docs">Documentation</a> •
  <a href="https://oneuptime.com/pricing">Pricing</a> •
  <a href="#installation">Installation</a> •
  <a href="#contributing">Contributing</a>
</p>
<!-- markdownlint-enable MD033 -->

---

## What is OneUptime?

OneUptime is a comprehensive solution for monitoring and managing your online services. Whether you need to check the availability of your website, dashboard, API, or any other online resource, OneUptime can alert your team when downtime happens and keep your customers informed with a status page.

**OneUptime replaces multiple tools with one integrated platform:**

| Replace | With OneUptime |
|---------|----------------|
| Pingdom | Uptime Monitoring |
| StatusPage.io | Status Pages |
| PagerDuty | On-Call & Alerts |
| Incident.io | Incident Management |
| Loggly | Logs Management |
| New Relic / Datadog | Application Performance Monitoring |
| Sentry | Error Tracking |

---

## ✨ Features

### 📊 Uptime Monitoring

Monitor the availability and response time of your online services from multiple locations around the world. Get notified via email, SMS, Slack, or other channels when something goes wrong.

![Monitoring](/Home/Static/img/readme/monitoring.png?raw=true)

### 📋 Status Pages

Communicate with your customers and stakeholders during downtime or maintenance. Create a custom-branded status page that shows the current status and history of your services.

![Status Pages](/Home/Static/img/readme/statuspages.png?raw=true)

### 🚨 Incident Management

Manage incidents from start to finish with a collaborative workflow. Create incident reports, assign tasks, update stakeholders, and document resolutions.

![Incident Management](/Home/Static/img/readme/incident-management.png?raw=true)

### 📞 On-Call & Alerts

Schedule on-call shifts for your team and define escalation policies. Ensure that the right person is notified at the right time when an incident occurs.

![On Call and Alerts](/Home/Static/img/readme/on-call.png?raw=true)

### 📝 Logs Management

Collect, store, and analyze logs from your online services. Search, filter, and visualize log data to gain insights and troubleshoot issues.

![Logs Management](/Home/Static/img/readme/logs-management.png?raw=true)

### ⚡ Workflows

Integrate OneUptime with your existing tools and automate your workflows. Connect with Slack, Jira, GitHub, and 5000+ more applications.

![Workflows](/Home/Static/img/readme/workflows.png?raw=true)

### 🔍 Application Performance Monitoring

Measure and optimize the performance of your online apps and services. Track key metrics such as traces, response time, throughput, error rate, and user satisfaction.

![APM](/Home/Static/img/readme/apm.png?raw=true)

### 🐛 Error Tracking

Detect and diagnose errors in your online services. Get detailed error reports with stack traces, context, and user feedback.

### 🤖 AI Copilot

OneUptime's AI agent monitors your services 24/7, detects anomalies across logs, traces, and metrics, identifies root causes, and opens pull requests with code fixes — automatically. Like having an SRE that never sleeps.

- **Auto-instrument** — Add tracing, metrics, and logging with one click
- **Fix exceptions** — AI catches errors in production and generates fixes before users notice
- **Optimize performance** — Identifies slow traces and submits optimized code
- **Security patches** — Detects vulnerable dependencies and creates PRs with safe upgrades

---

## 🚀 Get Started

### OneUptime Cloud (Recommended)

The easiest and fastest way to get started. Sign up for free at [oneuptime.com](https://oneuptime.com) and enjoy the full benefits of OneUptime without any installation or maintenance.

By using OneUptime Cloud, you also support the continued development of the open-source project.

**[Get Started Free →](https://oneuptime.com)**

### Self-Hosted Installation

- **[Kubernetes with Helm](https://artifacthub.io/packages/helm/oneuptime/oneuptime)** - Recommended for production
- **[Docker Compose](/Docs/Content/installation/docker-compose.md)** - Single-node install (not recommended for production)
- **[Local Development](/Docs/Content/installation/local-development.md)** - For contributors
- **[Upgrade Guide](/Docs/Content/installation/upgrading.md)** - Upgrade existing installations

---

## 💼 Community vs. Enterprise Editions

| Edition | Ideal For | Highlights |
|---------|-----------|------------|
| **Community** | Self-hosters and small teams | Full feature set • Community support • Open-source |
| **Enterprise** | Regulated teams needing premium support | Hardened images • Priority support • Custom features • Data residency options |

> 📧 For Enterprise licensing, contact `sales@oneuptime.com`

---

## 🛠️ Installation

```bash
# Quick start with one command
curl -L https://oneuptime.com/install.sh | bash
```

For detailed installation guides, see:
- [Kubernetes with Helm](https://artifacthub.io/packages/helm/oneuptime/oneuptime) (recommended for production)
- [Docker Compose](/Docs/Content/installation/docker-compose.md)
- [Local Development](/Docs/Content/installation/local-development.md)
- [Upgrade Guide](/Docs/Content/installation/upgrading.md)

---

## 💡 Philosophy

Our mission is to **reduce downtime and increase the number of successful products in the world**. We built a platform that helps you understand the causes of downtime, manage incidents effectively, and reduce operational toil.

OneUptime is 100% open-source, free, and available for everyone to use.

---

## 🤝 Contributing

We love contributions big and small! Here's how you can help:

| Priority | How to Contribute |
|----------|-------------------|
| 🗣️ | Share feedback in our [Customer Slack](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA) |
| 💬 | Chat with developers in our [Developer Slack](https://join.slack.com/t/oneuptimedev/shared_invite/zt-17r8o7gkz-nITGan_PS9JYJV6WMm_TsQ) |
| ✅ | [Write tests](https://github.com/OneUptime/oneuptime/issues?q=is%3Aopen+is%3Aissue+label%3A%22write+tests%22) for our codebase |
| 🔧 | Work on [open issues](https://github.com/OneUptime/oneuptime/issues) |
| 💡 | [Open new issues](https://github.com/OneUptime/oneuptime/issues/new) with feature requests |

---

## ❤️ Support OneUptime

If you find OneUptime useful, consider supporting its development:

- ⭐ **Star this repo** - It helps others discover OneUptime
- 💵 **[Sponsor us](https://github.com/sponsors/OneUptime)** - Every dollar goes to shipping new features
- 🛍️ **[Shop merch](https://shop.oneuptime.com)** - All revenue supports open-source development

---

## 📄 License

OneUptime is licensed under the [Apache License 2.0](LICENSE).

---

<p align="center">
  Made with ❤️ by the OneUptime team and contributors
</p>


