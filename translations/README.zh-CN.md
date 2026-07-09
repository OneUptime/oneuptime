<!-- markdownlint-disable MD033 MD041 -->
<p align="center">
  <a href="/README.md">English</a> ·
  <a href="/translations/README.zh-CN.md">简体中文</a> ·
  <a href="/translations/README.zh-TW.md">繁體中文</a> ·
  <a href="/translations/README.ja.md">日本語</a> ·
  <a href="/translations/README.ko.md">한국어</a> ·
  <a href="/translations/README.es.md">Español</a> ·
  <a href="/translations/README.fr.md">Français</a> ·
  <a href="/translations/README.de.md">Deutsch</a> ·
  <a href="/translations/README.pt.md">Português</a> ·
  <a href="/translations/README.it.md">Italiano</a> ·
  <a href="/translations/README.ru.md">Русский</a> ·
  <a href="/translations/README.hi.md">हिन्दी</a> ·
  <a href="/translations/README.nl.md">Nederlands</a> ·
  <a href="/translations/README.da.md">Dansk</a> ·
  <a href="/translations/README.sv.md">Svenska</a> ·
  <a href="/translations/README.no.md">Norsk</a>
</p>

<div align="center">
  <a href="https://oneuptime.com">
    <img alt="OneUptime 徽标" width="55%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/OneUptimePNG/7.png"/>
  </a>

  <h3>智能体式可观测性 —— 一个开源平台，涵盖可用性、事件、值班、状态页、日志、追踪、指标与 APM。</h3>

  <p><b>当出现问题时，第一个知道，也最快修复。</b></p>

  <p>OneUptime 用一个可免费自托管的平台，取代一整排 SaaS 工具。它能捕捉故障、呼叫合适的人、更新你的状态页、定位根因，甚至提交修复的 PR。</p>

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
    <a href="https://oneuptime.com/pricing"><b>定价</b></a> &nbsp;•&nbsp;
    <a href="#contributing"><b>参与贡献</b></a>
  </p>

  <a href="https://oneuptime.com"><b>🚀 试用 OneUptime Cloud —— 永久免费套餐，无需信用卡 →</b></a>
</div>

<br/>

<div align="center">
  <img alt="实时事件处理中的 OneUptime 指挥中心" width="92%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/readme/hero-command-center.png"/>
</div>

---

## 取代你的整套可观测性技术栈

OneUptime 将监控、告警、事件响应和可观测性整合到一个开源应用中 —— 从此你无需再为十多个各自独立的工具付费（并费力拼接它们）。

| 不再需要… | 改用 OneUptime 实现… |
|---|---|
| Pingdom / UptimeRobot | **可用性监控** —— 面向全球的网站、API、ping、端口、SSL、DNS 及合成检测 |
| StatusPage.io | **状态页** —— 带订阅者的品牌化公共与私有状态页 |
| PagerDuty / Opsgenie | **值班与告警** —— 排班、升级策略，短信 / 电话 / 推送 / Slack |
| Incident.io | **事件管理** —— 声明、分诊、沟通与复盘 |
| Datadog / New Relic | **APM 与指标** —— 追踪、仪表盘与服务性能 |
| Loggly | **日志管理** —— 采集、搜索并对日志告警 |
| Sentry | **错误追踪** —— 带完整堆栈跟踪和上下文的异常 |

以上一切均为 **100% 开源（Apache 2.0）**，可免费自托管。

---

<details>
<summary><b>🌙 一次事件，端到端全程处理</b></summary>

<br/>

现在是凌晨 2:47。结账开始超时。看看在多数工具还没发出第一条告警之前，OneUptime 就已经做了什么 —— 也正是下面这些截图真实呈现的内容。

### 1 · 检测 — *几秒内知晓*

分布在多个区域的探针发现结账延迟突破了你设定的 5 秒阈值，并自动开启一个事件 —— 赶在你的客户点击刷新之前。

![检测 —— 全球监控发现结账 API 性能下降](/Home/Static/img/readme/detect.png?raw=true)

### 2 · 响应 — *呼叫对的人*

Payments 策略的值班工程师被电话、短信和推送通知触达，并在有人确认之前自动升级到后备人员。

![响应 —— 事件被路由给值班人员并被确认](/Home/Static/img/readme/respond.png?raw=true)

### 3 · 沟通 — *让客户知情*

你的状态页自动更新，每一位订阅者都会收到邮件和短信通知 —— 无需任何人手动撰写更新内容。

![沟通 —— 公共状态页更新并通知订阅者](/Home/Static/img/readme/communicate.png?raw=true)

### 4 · 诊断 — *找到根因*

追踪、日志和指标被关联到精确的 span：`orders` 表上一条缓慢的 `SELECT … FOR UPDATE`，卡在了缺失的索引上。

![诊断 —— 追踪瀑布图精准定位到缓慢的数据库 span](/Home/Static/img/readme/diagnose.png?raw=true)

### 5 · 自动修复 — *修复方案已为你起草*

AI 智能体提交一个包含修复的拉取请求，关联到该事件，测试全部通过 —— 你只需审阅并合并。就像一位永不休息的 SRE。

![自动修复 —— AI 智能体提交包含修复的拉取请求](/Home/Static/img/readme/autofix.png?raw=true)

</details>

---

<a name="quick-start"></a>

## ⚡ 快速开始

### ☁️ OneUptime Cloud —— 最省心的方式

零配置、始终保持最新，还能为开源项目提供资金支持。

**→ [在 oneuptime.com 免费注册](https://oneuptime.com)**

### 🐳 使用 Docker Compose 自托管

单台服务器即可满足所需（Debian / Ubuntu / RHEL，Docker + Docker Compose）。非常适合家庭实验室和小型团队 —— 甚至一台 Raspberry Pi 也能跑起来。

```bash
# 1. Clone the release branch
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# 2. Create your config (then edit it — set strong, random secrets!)
cp config.example.env config.env

# 3. Start everything
npm start
```

OneUptime 现已运行在 **http://localhost** —— 打开它并创建你的第一个账户。

📖 完整指南：[Docker Compose 安装](/App/FeatureSet/Docs/Content/en/installation/docker-compose.md) · [规格与需求](/App/FeatureSet/Docs/Content/en/installation/sizing.md)

### ☸️ 使用 Helm 部署到 Kubernetes —— 面向生产环境

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm install oneuptime oneuptime/oneuptime
```

📖 完整安装说明与参数值见 [Artifact Hub →](https://artifacthub.io/packages/helm/oneuptime/oneuptime)

> **正在升级现有安装？** 请参阅[升级指南](/App/FeatureSet/Docs/Content/en/installation/upgrading.md)。

---

## ✨ 开箱即有的一切

| | 功能 | 作用 |
|---|---|---|
| 📊 | **可用性监控** | 面向多个全球区域的网站、API、IP、端口、SSL、DNS 及合成监控。 |
| 📋 | **状态页** | 精美的品牌化状态页、事件历史、计划维护以及订阅者通知。 |
| 🚨 | **事件管理** | 端到端的事件工作流：声明、指派、沟通、解决并进行复盘。 |
| 📞 | **值班与告警** | 值班排班与升级策略，支持短信、电话、推送、邮件和 Slack 告警。 |
| 📝 | **日志管理** | 通过 OpenTelemetry 采集、存储、搜索并对日志告警。 |
| 🔍 | **APM 与追踪** | 分布式追踪、span 与性能仪表盘，帮你找出慢路径和瓶颈。 |
| 📈 | **指标与仪表盘** | 基于你的遥测数据自定义仪表盘 —— 构建团队所需的视图。 |
| 🐛 | **错误追踪** | 捕获异常，含完整堆栈跟踪、上下文与发布版本追踪。 |
| ⚡ | **工作流** | 与 Slack、Jira、GitHub、Microsoft Teams 及 5,000 多个应用自动化集成。 |
| 🤖 | **AI Copilot** | 一个始终在线的智能体，在日志、追踪与指标间发现异常、定位根因，并提交带修复的 PR。 |

<details>
<summary><b>⚡ 让繁琐工作自动化</b></summary>

<br/>

在可视化的无代码画布上串联升级、工单和通知 —— 或直接嵌入自定义代码。上述事件在无人动手的情况下就呼叫了值班人员、开了一个 Jira 工单并发布到了 Slack。

![工作流 —— 用于事件升级的无代码自动化画布](/Home/Static/img/readme/workflows.png?raw=true)

</details>

### 🖥️ 基础设施监控

嵌入可复制粘贴的、**基于 OpenTelemetry** 的代理，即可监控你的服务所依赖的一切 —— 还内置了现成的告警模板：

- **服务器与 VM** —— 来自 Linux、macOS 与 Windows 的 CPU、内存、磁盘、网络、进程和日志。[文档 →](/App/FeatureSet/Docs/Content/en/telemetry/host-otel-collector.md)
- **Kubernetes** —— 一条 `helm install` 即可交付节点/Pod/容器/集群指标、事件、日志，以及 eBPF 追踪与服务地图。[文档 →](/App/FeatureSet/Docs/Content/en/telemetry/kubernetes-agent.md)
- **Docker** —— 单个代理自动发现每一个容器并交付指标与日志。[文档 →](/App/FeatureSet/Docs/Content/en/telemetry/docker-host.md)
- **Podman** —— 通过 Podman 兼容 Docker 的套接字，同样实现单代理自动发现。[文档 →](/App/FeatureSet/Docs/Content/en/telemetry/podman-host.md)
- **Proxmox** —— 节点、VM、容器、存储、HA 状态、备份覆盖率与复制健康状况。[文档 →](/App/FeatureSet/Docs/Content/en/telemetry/proxmox.md)
- **Ceph** —— 集群健康、容量预测，以及 OSD/存储池/PG/监视器的可见性。[文档 →](/App/FeatureSet/Docs/Content/en/telemetry/ceph.md)

---

## 💼 社区版 vs. 企业版

| | **社区版** | **企业版** |
|---|---|---|
| **适合谁** | 自托管用户与小型团队 | 需要高级支持的受监管团队 |
| **费用** | 免费且开源 | [联系销售](mailto:sales@oneuptime.com) |
| **功能** | 完整功能集 | 完整功能集 + 加固镜像、优先支持、定制功能与数据驻留 |

---

## 💡 为什么选择 OneUptime？

我们的使命很简单：**减少停机时间，助力更多产品取得成功。** 你不必再用胶带把七家供应商勉强拼在一起，而是获得一个平台，帮你理解事情*为何*出错、快速响应事件并削减运维琐务 —— 完全开源，让你真正拥有自己的数据和技术栈。

---

<a name="contributing"></a>

## 🤝 参与贡献

我们欢迎各种规模的贡献。从这里开始：

- 🐛 **[待处理的 issue](https://github.com/OneUptime/oneuptime/issues)** —— 认领一个，或[提交一个新的](https://github.com/OneUptime/oneuptime/issues/new)
- ✅ 为代码库 **[帮忙编写测试](https://github.com/OneUptime/oneuptime/issues?q=is%3Aopen+is%3Aissue+label%3A%22write+tests%22)**
- 🧑‍💻 **[本地开发指南](/App/FeatureSet/Docs/Content/en/installation/local-development.md)**，帮你完成环境搭建
- 📖 阅读 **[贡献指南](/CONTRIBUTING.md)**
- 💬 在 **[开发者 Slack](https://join.slack.com/t/oneuptimedev/shared_invite/zt-17r8o7gkz-nITGan_PS9JYJV6WMm_TsQ)** 或 **[社区 Slack](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA)** 与我们交流

## ❤️ 支持这个项目

如果 OneUptime 对你有帮助：

- ⭐ **给这个仓库点个 Star** —— 这真的能帮助更多人找到我们
- 💵 **[赞助我们](https://github.com/sponsors/OneUptime)** —— 每一分钱都会转化为新功能
- 🛍️ **[买点周边](https://shop.oneuptime.com)** —— 全部收益用于资助开源开发

---

## 📄 许可证

OneUptime 基于 [Apache License 2.0](/LICENSE) 授权。

<div align="center">
  <sub>由 <a href="https://oneuptime.com">OneUptime</a> 团队与<a href="https://github.com/OneUptime/oneuptime/graphs/contributors">贡献者们</a>用 ❤️ 打造。</sub>
</div>
