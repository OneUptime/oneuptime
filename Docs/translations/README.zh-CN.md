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

OneUptime 是一个开源的可观测性平台。它检查你的网站、API 和服务器是否正常工作，收集你的应用发送的日志、指标和追踪，在出现故障时呼叫值班人员，并通过状态页面告知你的客户。这一切都在同一个产品中完成，因此发现问题的工具也正是呼叫你团队的工具。

你可以使用 [OneUptime Cloud](https://oneuptime.com)，也可以在自己的服务器上运行它。

<p align="center">
  <img alt="事件期间的 OneUptime：事件的时间线、值班人员、状态页面和 OneUptime AI 的调查" width="100%" src="/packages/Home/Static/img/readme/hero-command-center.png">
</p>

## 它能做什么

- **[监控](https://oneuptime.com/docs/zh-CN/monitor/create-monitor)**：从全球各地的探测器或你自己的网络内部检查网站、API、端口、DNS 和证书。OneUptime 还会监控服务器、Kubernetes、Docker、VMware、数据库和网络设备。
- **[事件与值班](https://oneuptime.com/docs/zh-CN/incidents/index)**：在同一条时间线上处理每个事件。通过电话、短信、电子邮件、推送通知、Slack 或 Microsoft Teams 呼叫值班人员，并持续升级直到有人响应。
- **[状态页面](https://oneuptime.com/docs/zh-CN/status-pages/index)**：通过公开或私有的状态页面让客户了解情况，并在上面公告计划维护。
- **[日志、指标和追踪](https://oneuptime.com/docs/zh-CN/telemetry/open-telemetry)**：用 OpenTelemetry 发送、搜索它们，并构建仪表板。异常、性能剖析、真实用户监控和安全事件也都在同一个地方。
- **[工作流和运行手册](https://oneuptime.com/docs/zh-CN/workflows/index)**：把例行工作自动化，并连接 Jira、ServiceNow 以及你的团队已经在用的其他工具。
- **[OneUptime AI](https://oneuptime.com/docs/zh-CN/ai/ai-sre)**：调查新的事件和告警，并发布带出处的根本原因分析。开启修复后，它可以打开一个包含修复的拉取请求，交给你的团队审查。
- **[API、CLI 和 Terraform](https://oneuptime.com/docs/zh-CN/api-reference/api-reference)**：从你的脚本和 CI 自动化 OneUptime，并以代码方式管理监视器、状态页面和值班。

其余内容都在[文档](https://oneuptime.com/docs/zh-CN/introduction/getting-started)中。

## 开始使用

### OneUptime Cloud

[注册](https://oneuptime.com/accounts/register)并创建一个项目。免费计划无需信用卡。

### 用 Docker Compose 自托管

你需要一台内存至少 8 GB 的 Linux 服务器，并装有 Docker、Docker Compose、Git 和 Node.js。

在第 3 步之前，把 `config.env` 中的 `HOST` 设为人们访问 OneUptime 时使用的域名或 IP 地址，不要带 `http://`。只有在自己的电脑上试用 OneUptime 时才保留 `localhost`。

```bash
# 1. Clone the release branch
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# 2. Create your config, with a random value for every secret
cp config.example.env config.env
while grep -q "please-change-this-to-random-value" config.env; do
  sed -i "0,/please-change-this-to-random-value/{s/please-change-this-to-random-value/$(openssl rand -hex 32)/}" config.env
done

# 3. Start everything
npm start
```

当 `npm start` 输出 **OneUptime is up!** 后，打开 `http://localhost` 或服务器的地址并注册。第一个账号会成为该实例的管理员。

[Docker Compose 指南](https://oneuptime.com/docs/zh-CN/installation/docker-compose)介绍了服务器规格、HTTPS、备份和更新。

### 用 Helm 部署到 Kubernetes

如需大规模生产环境或高可用，请安装 Helm chart。把 `host` 设为人们访问 OneUptime 时使用的域名或 IP 地址：

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime --set host=oneuptime.example.com
```

[chart 的 README](/HelmChart/Public/oneuptime/README.md) 介绍了存储、HTTPS、数据库和升级。

## Community 与 Enterprise

- **Community Edition**：免费且开源，包含以上全部功能，也包括 SAML 和 OIDC 单点登录。
- **Enterprise Edition**：增加 SCIM 预配、审计日志、团队合规和实例健康仪表板，并提供优先支持。在生产环境中使用需要许可证：[联系销售](mailto:sales@oneuptime.com)。

两个版本的对比见[文档](https://oneuptime.com/docs/zh-CN/self-hosted/enterprise)。

## 获取帮助

- 在 [Slack 上的 OneUptime 社区](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA)提问。
- 在 [GitHub issues](https://github.com/OneUptime/oneuptime/issues) 中报告缺陷、提出功能需求。
- 请按 [SECURITY.md](/.github/SECURITY.md) 的说明私下报告安全漏洞。
- 其他问题请发邮件到 [support@oneuptime.com](mailto:support@oneuptime.com)。

## 参与贡献

欢迎修复缺陷、开发功能、完善文档和编写测试。[本地开发指南](https://oneuptime.com/docs/zh-CN/installation/local-development)介绍了如何从源码运行 OneUptime，[贡献指南](/.github/CONTRIBUTING.md)说明了拉取请求和许可证的规则。带有 [good first issue](https://github.com/OneUptime/oneuptime/labels/good%20first%20issue) 标签的 issue 适合作为起点。

如果 OneUptime 对你有帮助，请为这个仓库点个星，或[赞助这个项目](https://github.com/sponsors/OneUptime)。

## 许可证

OneUptime 基于 [Apache License 2.0](/LICENSE) 开源，[`ee/`](/ee) 目录除外。该目录包含 Enterprise Edition，采用 [OneUptime Enterprise License](/ee/LICENSE) 授权。Community Edition 镜像不包含任何来自 `ee/` 的代码。仓库根目录下的 [`LICENSE`](/LICENSE) 文件规定了这一划分。
