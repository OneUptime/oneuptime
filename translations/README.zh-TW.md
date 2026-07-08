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
    <img alt="OneUptime 標誌" width="55%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/OneUptimePNG/7.png"/>
  </a>

  <h3>代理式可觀測性 — 一個開源平台，涵蓋正常運行時間、事件、待命、狀態頁、日誌、追蹤、指標與 APM。</h3>

  <p><b>當狀況發生時，第一時間掌握 — 也最快完成修復。</b></p>

  <p>OneUptime 用一個可免費自架的平台，取代整櫃的 SaaS 工具。它能捕捉服務中斷、呼叫對的人、更新你的狀態頁、找出根本原因，甚至開出修復用的 PR。</p>

  <p>
    <a href="https://github.com/OneUptime/oneuptime/blob/master/LICENSE"><img src="https://img.shields.io/github/license/OneUptime/oneuptime?color=1a73e8" alt="License"></a>
    <a href="https://github.com/OneUptime/oneuptime/releases"><img src="https://img.shields.io/github/v/release/OneUptime/oneuptime" alt="Release"></a>
    <a href="https://github.com/OneUptime/oneuptime/stargazers"><img src="https://img.shields.io/github/stars/OneUptime/oneuptime?style=flat" alt="Stars"></a>
    <a href="https://artifacthub.io/packages/helm/oneuptime/oneuptime"><img src="https://img.shields.io/badge/Helm-Chart-0f1689" alt="Helm Chart"></a>
    <a href="https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA"><img src="https://img.shields.io/badge/Slack-Community-4A154B" alt="Slack"></a>
  </p>

  <p>
    <a href="https://oneuptime.com"><b>網站</b></a> &nbsp;•&nbsp;
    <a href="https://oneuptime.com/docs"><b>文件</b></a> &nbsp;•&nbsp;
    <a href="#quick-start"><b>快速開始</b></a> &nbsp;•&nbsp;
    <a href="https://oneuptime.com/pricing"><b>定價</b></a> &nbsp;•&nbsp;
    <a href="#contributing"><b>參與貢獻</b></a>
  </p>

  <a href="https://oneuptime.com"><b>🚀 試用 OneUptime Cloud — 永久免費方案，無需信用卡 →</b></a>
</div>

<br/>

<div align="center">
  <img alt="OneUptime 在真實事件期間的指揮中心" width="92%" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/readme/hero-command-center.png"/>
</div>

---

## 取代你的整套可觀測性堆疊

OneUptime 將監控、警示、事件回應與可觀測性整合到一個開源應用程式中 — 讓你不必再為十幾個各自獨立的工具付費（並費心把它們拼湊在一起）。

| 不必再用… | 改用 OneUptime 來… |
|---|---|
| Pingdom / UptimeRobot | **正常運行時間監控** — 從世界各地進行網站、API、ping、連接埠、SSL、DNS 及合成檢查 |
| StatusPage.io | **狀態頁** — 具品牌形象的公開與私有狀態頁，並支援訂閱者 |
| PagerDuty / Opsgenie | **待命與警示** — 排班、升級策略、SMS／通話／推播／Slack |
| Incident.io | **事件管理** — 宣告、分流、溝通與事後檢討 |
| Datadog / New Relic | **APM 與指標** — 追蹤、儀表板與服務效能 |
| Loggly | **日誌管理** — 收集、搜尋日誌並設定警示 |
| Sentry | **錯誤追蹤** — 具備完整堆疊追蹤與上下文的例外狀況 |

以上一切皆為 **100% 開源（Apache 2.0）**，可免費自架。

---

<details>
<summary><b>🌙 一場事件，從頭到尾一手包辦</b></summary>

<br/>

現在是凌晨 2:47。結帳開始逾時。以下是 OneUptime 在多數工具連第一則警示都還沒發出前就完成的事 — 以及下方截圖實際呈現的內容。

### 1 · 偵測 — *在數秒內掌握*

多個區域的探針捕捉到結帳延遲飆破你設定的 5 秒門檻，並自動開立事件 — 趕在你的客戶按下重新整理之前。

![偵測 — 全球監控捕捉到結帳 API 效能劣化](/Home/Static/img/readme/detect.png?raw=true)

### 2 · 回應 — *呼叫對的人*

Payments 策略的待命工程師會接到來電、簡訊與推播通知，並在有人確認之前自動升級至後備人員。

![回應 — 事件被路由給待命人員並獲得確認](/Home/Static/img/readme/respond.png?raw=true)

### 3 · 溝通 — *讓客戶隨時了解*

你的狀態頁會自動更新，每位訂閱者都會收到電子郵件與 SMS 通知 — 無須任何人手動撰寫更新內容。

![溝通 — 公開狀態頁更新並通知訂閱者](/Home/Static/img/readme/communicate.png?raw=true)

### 4 · 診斷 — *找出根本原因*

追蹤、日誌與指標會被關聯到精確的 span：`orders` 上一個緩慢的 `SELECT … FOR UPDATE`，卡在一個缺失的索引上。

![診斷 — 追蹤瀑布圖精準定位緩慢的資料庫 span](/Home/Static/img/readme/diagnose.png?raw=true)

### 5 · 自動修復 — *為你草擬好修復方案*

AI 代理開出一個包含修復內容的拉取請求，連結到該事件，測試全數通過 — 你只需審查並合併。就像一位永不睡覺的 SRE。

![自動修復 — AI 代理開出包含修復內容的拉取請求](/Home/Static/img/readme/autofix.png?raw=true)

</details>

---

<a name="quick-start"></a>

## ⚡ 快速開始

### ☁️ OneUptime Cloud — 最輕鬆的方式

零設定、永遠保持最新，還能支持這個開源專案。

**→ [在 oneuptime.com 免費註冊](https://oneuptime.com)**

### 🐳 使用 Docker Compose 自架

在單一伺服器上就備妥你所需的一切（Debian／Ubuntu／RHEL、Docker + Docker Compose）。非常適合自架實驗室與小型團隊 — 連 Raspberry Pi 都能跑。

```bash
# 1. Clone the release branch
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# 2. Create your config (then edit it — set strong, random secrets!)
cp config.example.env config.env

# 3. Start everything
npm start
```

OneUptime 現在已運行於 **http://localhost** — 打開它並建立你的第一個帳號。

📖 完整指南：[Docker Compose 安裝](/App/FeatureSet/Docs/Content/en/installation/docker-compose.md) · [規格與需求](/App/FeatureSet/Docs/Content/en/installation/sizing.md)

### ☸️ 使用 Helm 部署 Kubernetes — 適用於生產環境

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm install oneuptime oneuptime/oneuptime
```

📖 完整安裝說明與參數值請見 [Artifact Hub →](https://artifacthub.io/packages/helm/oneuptime/oneuptime)

> **要升級既有的安裝？** 請參閱[升級指南](/App/FeatureSet/Docs/Content/en/installation/upgrading.md)。

---

## ✨ 盒子裡的一切

| | 功能 | 它能做什麼 |
|---|---|---|
| 📊 | **正常運行時間監控** | 從多個全球區域進行網站、API、IP、連接埠、SSL、DNS 及合成監控。 |
| 📋 | **狀態頁** | 精美的品牌狀態頁、事件歷史、排定維護與訂閱者通知。 |
| 🚨 | **事件管理** | 端到端的事件工作流程：宣告、指派、溝通、解決並進行事後檢討。 |
| 📞 | **待命與警示** | 待命排班與升級策略，支援 SMS、電話、推播、電子郵件與 Slack 警示。 |
| 📝 | **日誌管理** | 透過 OpenTelemetry 攝取、儲存、搜尋日誌並設定警示。 |
| 🔍 | **APM 與追蹤** | 分散式追蹤、span 與效能儀表板，找出緩慢路徑與瓶頸。 |
| 📈 | **指標與儀表板** | 針對你的遙測資料自訂儀表板 — 打造團隊所需的檢視畫面。 |
| 🐛 | **錯誤追蹤** | 擷取例外狀況，附帶完整堆疊追蹤、上下文與版本追蹤。 |
| ⚡ | **工作流程** | 與 Slack、Jira、GitHub、Microsoft Teams 及 5,000+ 個應用程式自動化整合。 |
| 🤖 | **AI 副駕駛** | 一個永不停歇的代理，在日誌、追蹤與指標中找出異常、定位根本原因，並開出包含修復的 PR。 |

<details>
<summary><b>⚡ 讓繁瑣工作自動化</b></summary>

<br/>

在視覺化、無需編碼的畫布上串接升級、工單與通知 — 或直接嵌入自訂程式碼。上述那場事件呼叫了待命人員、開立了 Jira 工單並發佈到 Slack，全程無須任何人動手。

![工作流程 — 用於事件升級的無代碼自動化畫布](/Home/Static/img/readme/workflows.png?raw=true)

</details>

### 🖥️ 基礎設施監控

嵌入可複製貼上、**以 OpenTelemetry 為基礎**的代理，監看你的服務所依賴的一切 — 並內附現成的警示範本：

- **伺服器與 VM** — 來自 Linux、macOS 與 Windows 的 CPU、記憶體、磁碟、網路、程序與日誌。[文件 →](/App/FeatureSet/Docs/Content/en/telemetry/host-otel-collector.md)
- **Kubernetes** — 一道 `helm install` 即可交付節點／pod／容器／叢集指標、事件、日誌，以及 eBPF 追蹤與服務地圖。[文件 →](/App/FeatureSet/Docs/Content/en/telemetry/kubernetes-agent.md)
- **Docker** — 單一代理自動探索每個容器並交付指標與日誌。[文件 →](/App/FeatureSet/Docs/Content/en/telemetry/docker-host.md)
- **Podman** — 透過 Podman 的 Docker 相容通訊端，享有同樣的單一代理自動探索。[文件 →](/App/FeatureSet/Docs/Content/en/telemetry/podman-host.md)
- **Proxmox** — 節點、VM、容器、儲存、HA 狀態、備份覆蓋率與複寫健康狀態。[文件 →](/App/FeatureSet/Docs/Content/en/telemetry/proxmox.md)
- **Ceph** — 叢集健康狀態、容量預測，以及 OSD／pool／PG／monitor 的可視性。[文件 →](/App/FeatureSet/Docs/Content/en/telemetry/ceph.md)

---

## 💼 社群版 vs. 企業版

| | **社群版** | **企業版** |
|---|---|---|
| **最適合** | 自架者與小型團隊 | 需要進階支援的受監管團隊 |
| **費用** | 免費且開源 | [聯絡銷售](mailto:sales@oneuptime.com) |
| **功能** | 完整功能集 | 完整功能集 + 加固映像、優先支援、客製功能與資料落地 |

---

## 💡 為什麼選擇 OneUptime？

我們的使命很簡單：**減少停機時間，幫助更多產品邁向成功。** 你不必再用膠帶把七家廠商拼湊在一起，而是擁有一個平台，協助你理解事情*為何*出錯、迅速回應事件並削減營運雜務 — 完全開源，讓你完全掌握自己的資料與堆疊。

---

<a name="contributing"></a>

## 🤝 參與貢獻

我們歡迎各種規模的貢獻。從這裡開始：

- 🐛 **[待處理的 issue](https://github.com/OneUptime/oneuptime/issues)** — 挑一個來處理，或[建立一個新的](https://github.com/OneUptime/oneuptime/issues/new)
- ✅ **[協助撰寫測試](https://github.com/OneUptime/oneuptime/issues?q=is%3Aopen+is%3Aissue+label%3A%22write+tests%22)** 為程式碼庫
- 🧑‍💻 **[本機開發指南](/App/FeatureSet/Docs/Content/en/installation/local-development.md)** 協助你完成環境設定
- 📖 閱讀**[貢獻準則](/CONTRIBUTING.md)**
- 💬 在 **[開發者 Slack](https://join.slack.com/t/oneuptimedev/shared_invite/zt-17r8o7gkz-nITGan_PS9JYJV6WMm_TsQ)** 或 **[社群 Slack](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA)** 與我們交流

## ❤️ 支持這個專案

如果 OneUptime 對你有幫助：

- ⭐ **為這個 repo 加星** — 這確實能幫助其他人找到我們
- 💵 **[贊助我們](https://github.com/sponsors/OneUptime)** — 每一塊錢都能推出新功能
- 🛍️ **[選購週邊商品](https://shop.oneuptime.com)** — 所有收益都用於資助開源開發

---

## 📄 授權條款

OneUptime 採用 [Apache License 2.0](/LICENSE) 授權。

<div align="center">
  <sub>由 <a href="https://oneuptime.com">OneUptime</a> 團隊與<a href="https://github.com/OneUptime/oneuptime/graphs/contributors">貢獻者</a>用 ❤️ 打造。</sub>
</div>
