<!-- markdownlint-disable MD033 MD041 -->
<p align="center">
  <a href="/README.md">English</a> ·
  <a href="/README.zh-CN.md">简体中文</a> ·
  <a href="/README.zh-TW.md">繁體中文</a> ·
  <a href="/README.ja.md">日本語</a> ·
  <a href="/README.ko.md">한국어</a> ·
  <a href="/README.es.md">Español</a> ·
  <a href="/README.fr.md">Français</a> ·
  <a href="/README.de.md">Deutsch</a> ·
  <a href="/README.pt.md">Português</a> ·
  <a href="/README.it.md">Italiano</a> ·
  <a href="/README.ru.md">Русский</a> ·
  <a href="/README.hi.md">हिन्दी</a> ·
  <a href="/README.nl.md">Nederlands</a> ·
  <a href="/README.da.md">Dansk</a> ·
  <a href="/README.sv.md">Svenska</a> ·
  <a href="/README.no.md">Norsk</a>
</p>

<div align="center">
  <a href="https://oneuptime.com">
    <img alt="OneUptime 徽标" width="55%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/OneUptimePNG/7.png"/>
  </a>

  <h3>一个开源平台，涵盖可用性监控、事故、值班、状态页、日志、追踪、指标与 APM。</h3>

  <p>监控、状态页、值班、事故、日志与 APM —— 用一个可免费自托管的平台，取代一整排 SaaS 工具。</p>

  <p>
    <a href="https://github.com/OneUptime/oneuptime/blob/master/LICENSE"><img src="https://img.shields.io/github/license/OneUptime/oneuptime?color=1a73e8" alt="License"></a>
    <a href="https://github.com/OneUptime/oneuptime/releases"><img src="https://img.shields.io/github/v/release/OneUptime/oneuptime" alt="Release"></a>
    <a href="https://github.com/OneUptime/oneuptime/stargazers"><img src="https://img.shields.io/github/stars/OneUptime/oneuptime?style=flat" alt="Stars"></a>
    <a href="https://artifacthub.io/packages/helm/oneuptime/oneuptime"><img src="https://img.shields.io/badge/Helm-Chart-0f1689" alt="Helm Chart"></a>
    <a href="https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA"><img src="https://img.shields.io/badge/Slack-Community-4A154B" alt="Slack"></a>
  </p>

  <p>
    <a href="https://oneuptime.com"><b>官网</b></a> &nbsp;•&nbsp;
    <a href="https://oneuptime.com/docs"><b>文档</b></a> &nbsp;•&nbsp;
    <a href="#quick-start"><b>快速开始</b></a> &nbsp;•&nbsp;
    <a href="https://oneuptime.com/pricing"><b>价格</b></a> &nbsp;•&nbsp;
    <a href="#contributing"><b>参与贡献</b></a>
  </p>

  <a href="https://oneuptime.com"><b>🚀 试用 OneUptime Cloud —— 永久免费套餐，无需信用卡 →</b></a>
</div>

<br/>

<div align="center">
  <img alt="OneUptime 仪表盘" width="90%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/readme/monitoring.png"/>
</div>

---

## 替换你的整套可观测性技术栈

OneUptime 将监控、告警、事故响应与可观测性整合进一个开源应用中 —— 让你不必再为十几个各自独立的工具付费（并费心把它们拼接起来）。

| 不再需要… | 用 OneUptime 来… |
|---|---|
| Pingdom / UptimeRobot | **可用性监控** —— 面向全球各地的网站、API、ping、端口、SSL、DNS 与合成检测 |
| StatusPage.io | **状态页** —— 带订阅者的品牌化公开与私有状态页 |
| PagerDuty / Opsgenie | **值班与告警** —— 排班、升级策略，SMS / 电话 / 推送 / Slack |
| Incident.io | **事故管理** —— 声明、分诊、沟通与事后复盘 |
| Datadog / New Relic | **APM 与指标** —— 追踪、仪表盘与服务性能 |
| Loggly | **日志管理** —— 收集、搜索并对日志告警 |
| Sentry | **错误追踪** —— 带完整堆栈追踪与上下文的异常捕获 |

以上一切均为 **100% 开源（Apache 2.0）**，可免费自托管。

---

<a name="quick-start"></a>

## ⚡ 快速开始

### ☁️ OneUptime Cloud —— 轻松上手之选

零配置、始终保持最新，还能为开源项目提供资金支持。

**→ [在 oneuptime.com 免费注册](https://oneuptime.com)**

### 🐳 使用 Docker Compose 自托管

在单台服务器上即可拥有你所需的一切（Debian / Ubuntu / RHEL，Docker + Docker Compose）。非常适合家庭实验室和小型团队 —— 甚至一台 Raspberry Pi 也能跑起来。

```bash
# 1. Clone the release branch
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# 2. Create your config (then edit it — set strong, random secrets!)
cp config.example.env config.env

# 3. Start everything
npm start
```

OneUptime 现已运行于 **http://localhost** —— 打开它并创建你的第一个账户。

📖 完整指南：[Docker Compose 安装](/App/FeatureSet/Docs/Content/en/installation/docker-compose.md) · [规格与需求](/App/FeatureSet/Docs/Content/en/installation/sizing.md)

### ☸️ 使用 Helm 部署 Kubernetes —— 面向生产环境

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm install oneuptime oneuptime/oneuptime
```

📖 完整安装说明与配置值请见 [Artifact Hub →](https://artifacthub.io/packages/helm/oneuptime/oneuptime)

> **升级现有安装？** 请参阅[升级指南](/App/FeatureSet/Docs/Content/en/installation/upgrading.md)。

---

## ✨ 功能特性

| | 功能 | 用途 |
|---|---|---|
| 📊 | **可用性监控** | 面向多个全球区域的网站、API、IP、端口、SSL、DNS 与合成监控。 |
| 📋 | **状态页** | 精美的品牌化状态页、事故历史、计划维护与订阅者通知。 |
| 🚨 | **事故管理** | 端到端的事故流程：声明、分派、沟通、解决并进行事后复盘。 |
| 📞 | **值班与告警** | 值班排班与升级策略，支持 SMS、电话、推送、邮件与 Slack 告警。 |
| 📝 | **日志管理** | 通过 OpenTelemetry 摄取、存储、搜索并对日志告警。 |
| 🔍 | **APM 与追踪** | 分布式追踪、span 与性能仪表盘，帮你找出慢路径与瓶颈。 |
| 📈 | **指标与仪表盘** | 基于你的遥测数据构建自定义仪表盘 —— 搭建团队所需的视图。 |
| 🐛 | **错误追踪** | 捕获异常，附带完整堆栈追踪、上下文与发布追踪。 |
| ⚡ | **工作流** | 与 Slack、Jira、GitHub、Microsoft Teams 及 5,000 多个应用实现自动化与集成。 |
| 🤖 | **AI Copilot** | 一个始终在线的智能体，跨日志、追踪与指标发现异常，定位根因，并提交带修复的 PR。 |

### 🖥️ 基础设施监控

只需复制粘贴、部署**基于 OpenTelemetry** 的探针，即可监视服务运行所依赖的一切 —— 并内置现成的告警模板：

- **服务器与 VM** —— 来自 Linux、macOS 与 Windows 的 CPU、内存、磁盘、网络、进程与日志。[文档 →](/App/FeatureSet/Docs/Content/en/telemetry/host-otel-collector.md)
- **Kubernetes** —— 一次 `helm install` 即可提供节点/Pod/容器/集群指标、事件、日志，以及 eBPF 追踪与服务映射。[文档 →](/App/FeatureSet/Docs/Content/en/telemetry/kubernetes-agent.md)
- **Docker** —— 单个探针自动发现每一个容器并推送指标与日志。[文档 →](/App/FeatureSet/Docs/Content/en/telemetry/docker-host.md)
- **Podman** —— 通过 Podman 兼容 Docker 的套接字，实现同样的单探针自动发现。[文档 →](/App/FeatureSet/Docs/Content/en/telemetry/podman-host.md)
- **Proxmox** —— 节点、VM、容器、存储、HA 状态、备份覆盖率与复制健康状况。[文档 →](/App/FeatureSet/Docs/Content/en/telemetry/proxmox.md)
- **Ceph** —— 集群健康、容量预测，以及 OSD/存储池/PG/监视器的可见性。[文档 →](/App/FeatureSet/Docs/Content/en/telemetry/ceph.md)

<details>
<summary><b>📸 查看截图</b></summary>
<br/>

**可用性监控**
![Monitoring](/Home/Static/img/readme/monitoring.png?raw=true)

**状态页**
![Status Pages](/Home/Static/img/readme/statuspages.png?raw=true)

**事故管理**
![Incident Management](/Home/Static/img/readme/incident-management.png?raw=true)

**值班与告警**
![On Call and Alerts](/Home/Static/img/readme/on-call.png?raw=true)

**日志管理**
![Logs Management](/Home/Static/img/readme/logs-management.png?raw=true)

**应用性能监控**
![APM](/Home/Static/img/readme/apm.png?raw=true)

**工作流**
![Workflows](/Home/Static/img/readme/workflows.png?raw=true)

</details>

---

## 💼 社区版 vs. 企业版

| | **社区版** | **企业版** |
|---|---|---|
| **适用对象** | 自托管用户与小型团队 | 需要高级支持的受监管团队 |
| **费用** | 免费且开源 | [联系销售](mailto:sales@oneuptime.com) |
| **功能** | 完整功能集 | 完整功能集 + 加固镜像、优先支持、定制功能与数据驻留 |

---

## 💡 为什么选择 OneUptime？

我们的使命很简单：**减少停机，帮助更多产品取得成功。** 你无需再把七家供应商勉强拼凑在一起，而是获得一个统一平台，帮你理解事情*为何*出错、快速响应事故并削减运维琐务 —— 完全开源，因此你的数据与技术栈都归你所有。

---

<a name="contributing"></a>

## 🤝 参与贡献

我们欢迎各种规模的贡献。从这里开始：

- 🐛 **[待处理 issue](https://github.com/OneUptime/oneuptime/issues)** —— 认领一个，或[新建一个](https://github.com/OneUptime/oneuptime/issues/new)
- ✅ **[帮忙为代码库编写测试](https://github.com/OneUptime/oneuptime/issues?q=is%3Aopen+is%3Aissue+label%3A%22write+tests%22)**
- 🧑‍💻 **[本地开发指南](/App/FeatureSet/Docs/Content/en/installation/local-development.md)**，帮你完成环境搭建
- 📖 阅读**[贡献指南](CONTRIBUTING.md)**
- 💬 在 **[开发者 Slack](https://join.slack.com/t/oneuptimedev/shared_invite/zt-17r8o7gkz-nITGan_PS9JYJV6WMm_TsQ)** 或 **[社区 Slack](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA)** 与我们交流

## ❤️ 支持本项目

如果 OneUptime 对你有帮助：

- ⭐ **给本仓库点个 Star** —— 这真的能帮助更多人发现我们
- 💵 **[赞助我们](https://github.com/sponsors/OneUptime)** —— 每一分钱都会催生新功能
- 🛍️ **[买点周边](https://shop.oneuptime.com)** —— 所有收益都用于支持开源开发

---

## 📄 许可证

OneUptime 采用 [Apache License 2.0](LICENSE) 授权。

<div align="center">
  <sub>由 <a href="https://oneuptime.com">OneUptime</a> 团队与<a href="https://github.com/OneUptime/oneuptime/graphs/contributors">贡献者们</a>用 ❤️ 打造。</sub>
</div>
