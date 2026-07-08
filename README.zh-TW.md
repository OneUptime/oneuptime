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
    <img alt="OneUptime 標誌" width="55%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/OneUptimePNG/7.png"/>
  </a>

  <h3>整合正常運行時間、事件、待命、狀態頁面、日誌、追蹤、指標與 APM 的一站式開源平台。</h3>

  <p>監控、狀態頁面、待命、事件、日誌與 APM——用一個可免費自我託管的平台，取代一整櫃的 SaaS 工具。</p>

  <p>
    <a href="https://github.com/OneUptime/oneuptime/blob/master/LICENSE"><img src="https://img.shields.io/github/license/OneUptime/oneuptime?color=1a73e8" alt="License"></a>
    <a href="https://github.com/OneUptime/oneuptime/releases"><img src="https://img.shields.io/github/v/release/OneUptime/oneuptime" alt="Release"></a>
    <a href="https://github.com/OneUptime/oneuptime/stargazers"><img src="https://img.shields.io/github/stars/OneUptime/oneuptime?style=flat" alt="Stars"></a>
    <a href="https://artifacthub.io/packages/helm/oneuptime/oneuptime"><img src="https://img.shields.io/badge/Helm-Chart-0f1689" alt="Helm Chart"></a>
    <a href="https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA"><img src="https://img.shields.io/badge/Slack-Community-4A154B" alt="Slack"></a>
  </p>

  <p>
    <a href="https://oneuptime.com"><b>官方網站</b></a> &nbsp;•&nbsp;
    <a href="https://oneuptime.com/docs"><b>文件</b></a> &nbsp;•&nbsp;
    <a href="#quick-start"><b>快速開始</b></a> &nbsp;•&nbsp;
    <a href="https://oneuptime.com/pricing"><b>價格</b></a> &nbsp;•&nbsp;
    <a href="#contributing"><b>參與貢獻</b></a>
  </p>

  <a href="https://oneuptime.com"><b>🚀 試用 OneUptime Cloud——永久免費方案，無需信用卡 →</b></a>
</div>

<br/>

<div align="center">
  <img alt="OneUptime 儀表板" width="90%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/readme/monitoring.png"/>
</div>

---

## 取代你的整套可觀測性技術堆疊

OneUptime 將監控、警報、事件回應與可觀測性整合到單一開源應用程式中——讓你不必再為十幾個各自獨立的工具付費（並費心把它們拼湊在一起）。

| 不再需要… | 改用 OneUptime 來… |
|---|---|
| Pingdom / UptimeRobot | **正常運行時間監控**——來自全球各地的網站、API、ping、連接埠、SSL、DNS 及合成檢查 |
| StatusPage.io | **狀態頁面**——具品牌識別的公開與私人狀態頁面，並支援訂閱者 |
| PagerDuty / Opsgenie | **待命與警報**——排班、升級策略、SMS／通話／推播／Slack |
| Incident.io | **事件管理**——宣告、分級、溝通與事後檢討 |
| Datadog / New Relic | **APM 與指標**——追蹤、儀表板與服務效能 |
| Loggly | **日誌管理**——收集、搜尋日誌並針對日誌發出警報 |
| Sentry | **錯誤追蹤**——附完整堆疊追蹤與上下文的例外狀況 |

以上一切皆為 **100% 開源（Apache 2.0）**，可免費自我託管。

---

<a name="quick-start"></a>

## ⚡ 快速開始

### ☁️ OneUptime Cloud——最輕鬆的方式

無需設定、永遠保持最新，同時也支持開源專案。

**→ [在 oneuptime.com 免費註冊](https://oneuptime.com)**

### 🐳 使用 Docker Compose 自我託管

在單一伺服器上就能備妥你所需的一切（Debian／Ubuntu／RHEL、Docker + Docker Compose）。非常適合家庭實驗室與小型團隊——甚至一台 Raspberry Pi 也能執行。

```bash
# 1. Clone the release branch
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# 2. Create your config (then edit it — set strong, random secrets!)
cp config.example.env config.env

# 3. Start everything
npm start
```

OneUptime 現在已在 **http://localhost** 上執行——開啟它並建立你的第一個帳戶。

📖 完整指南：[Docker Compose 安裝](/App/FeatureSet/Docs/Content/en/installation/docker-compose.md) · [規格與需求](/App/FeatureSet/Docs/Content/en/installation/sizing.md)

### ☸️ 使用 Helm 在 Kubernetes 上部署——適用於正式環境

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm install oneuptime oneuptime/oneuptime
```

📖 完整安裝說明與參數值請見 [Artifact Hub →](https://artifacthub.io/packages/helm/oneuptime/oneuptime)

> **要升級既有的安裝嗎？** 請參閱[升級指南](/App/FeatureSet/Docs/Content/en/installation/upgrading.md)。

---

## ✨ 功能

| | 功能 | 用途 |
|---|---|---|
| 📊 | **正常運行時間監控** | 來自全球多個地區的網站、API、IP、連接埠、SSL、DNS 及合成監控。 |
| 📋 | **狀態頁面** | 精美的品牌狀態頁面、事件歷程、排定維護與訂閱者通知。 |
| 🚨 | **事件管理** | 端到端的事件工作流程：宣告、指派、溝通、解決並執行事後檢討。 |
| 📞 | **待命與警報** | 待命排班與升級策略，支援 SMS、電話、推播、電子郵件與 Slack 警報。 |
| 📝 | **日誌管理** | 透過 OpenTelemetry 擷取、儲存、搜尋日誌並發出警報。 |
| 🔍 | **APM 與追蹤** | 分散式追蹤、span 與效能儀表板，找出緩慢路徑與瓶頸。 |
| 📈 | **指標與儀表板** | 針對遙測資料自訂儀表板——打造團隊所需的檢視畫面。 |
| 🐛 | **錯誤追蹤** | 擷取例外狀況，附完整堆疊追蹤、上下文與版本追蹤。 |
| ⚡ | **工作流程** | 與 Slack、Jira、GitHub、Microsoft Teams 及 5,000 多個應用程式自動化整合。 |
| 🤖 | **AI Copilot** | 一個全天候運作的代理程式，能在日誌、追蹤與指標中找出異常、定位根本原因，並提出附修正的 PR。 |

### 🖥️ 基礎設施監控

只需複製貼上，便可部署**以 OpenTelemetry 為基礎**的代理程式，監控你的服務所運行的一切——並內建現成的警報範本：

- **伺服器與 VM**——來自 Linux、macOS 與 Windows 的 CPU、記憶體、磁碟、網路、程序與日誌。[文件 →](/App/FeatureSet/Docs/Content/en/telemetry/host-otel-collector.md)
- **Kubernetes**——一次 `helm install` 即可提供節點／pod／容器／叢集指標、事件、日誌，以及 eBPF 追蹤與服務地圖。[文件 →](/App/FeatureSet/Docs/Content/en/telemetry/kubernetes-agent.md)
- **Docker**——單一代理程式自動探索每個容器並傳送指標與日誌。[文件 →](/App/FeatureSet/Docs/Content/en/telemetry/docker-host.md)
- **Podman**——透過 Podman 的 Docker 相容通訊端，享有相同的單一代理程式自動探索。[文件 →](/App/FeatureSet/Docs/Content/en/telemetry/podman-host.md)
- **Proxmox**——節點、VM、容器、儲存、HA 狀態、備份涵蓋範圍與複寫健康度。[文件 →](/App/FeatureSet/Docs/Content/en/telemetry/proxmox.md)
- **Ceph**——叢集健康度、容量預測，以及 OSD／pool／PG／monitor 的可視性。[文件 →](/App/FeatureSet/Docs/Content/en/telemetry/ceph.md)

<details>
<summary><b>📸 查看螢幕截圖</b></summary>
<br/>

**正常運行時間監控**
![Monitoring](/Home/Static/img/readme/monitoring.png?raw=true)

**狀態頁面**
![Status Pages](/Home/Static/img/readme/statuspages.png?raw=true)

**事件管理**
![Incident Management](/Home/Static/img/readme/incident-management.png?raw=true)

**待命與警報**
![On Call and Alerts](/Home/Static/img/readme/on-call.png?raw=true)

**日誌管理**
![Logs Management](/Home/Static/img/readme/logs-management.png?raw=true)

**應用程式效能監控**
![APM](/Home/Static/img/readme/apm.png?raw=true)

**工作流程**
![Workflows](/Home/Static/img/readme/workflows.png?raw=true)

</details>

---

## 💼 社群版 vs. 企業版

| | **社群版** | **企業版** |
|---|---|---|
| **最適合** | 自我託管者與小型團隊 | 需要進階支援的受法規監管團隊 |
| **費用** | 免費且開源 | [聯絡銷售團隊](mailto:sales@oneuptime.com) |
| **功能** | 完整功能集 | 完整功能集，另加強化映像、優先支援、客製功能與資料落地 |

---

## 💡 為什麼選擇 OneUptime？

我們的使命很簡單：**減少停機時間，協助更多產品邁向成功。** 你不必再把七家廠商勉強拼湊在一起，而是擁有一個平台，幫助你理解事情*為何*出錯、快速回應事件並減少維運雜務——完全開源，讓你真正掌握自己的資料與技術堆疊。

---

<a name="contributing"></a>

## 🤝 參與貢獻

我們歡迎各種規模的貢獻。從這裡開始：

- 🐛 **[開放的 issue](https://github.com/OneUptime/oneuptime/issues)**——挑一個來處理，或[提交一個新的](https://github.com/OneUptime/oneuptime/issues/new)
- ✅ 為程式碼庫**[協助撰寫測試](https://github.com/OneUptime/oneuptime/issues?q=is%3Aopen+is%3Aissue+label%3A%22write+tests%22)**
- 🧑‍💻 依照**[本機開發指南](/App/FeatureSet/Docs/Content/en/installation/local-development.md)**完成環境設定
- 📖 閱讀**[貢獻準則](CONTRIBUTING.md)**
- 💬 在 **[開發者 Slack](https://join.slack.com/t/oneuptimedev/shared_invite/zt-17r8o7gkz-nITGan_PS9JYJV6WMm_TsQ)** 或 **[社群 Slack](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA)** 與我們交流

## ❤️ 支持這個專案

如果 OneUptime 對你有幫助：

- ⭐ **為這個儲存庫加星**——這確實有助於讓其他人找到我們
- 💵 **[贊助我們](https://github.com/sponsors/OneUptime)**——每一塊錢都會化為新功能
- 🛍️ **[選購週邊商品](https://shop.oneuptime.com)**——所有收益皆用於支持開源開發

---

## 📄 授權條款

OneUptime 採用 [Apache License 2.0](LICENSE) 授權。

<div align="center">
  <sub>由 <a href="https://oneuptime.com">OneUptime</a> 團隊與<a href="https://github.com/OneUptime/oneuptime/graphs/contributors">貢獻者</a>以 ❤️ 打造。</sub>
</div>
