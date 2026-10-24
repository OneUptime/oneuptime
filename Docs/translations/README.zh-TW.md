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

OneUptime 是一個開源的可觀測性平台。它檢查你的網站、API 和伺服器是否正常運作，收集你的應用程式傳送的日誌、指標和追蹤，在發生故障時呼叫待命人員，並透過狀態頁面告知你的客戶。這一切都在同一個產品中完成，因此發現問題的工具，也正是呼叫你團隊的工具。

你可以使用 [OneUptime Cloud](https://oneuptime.com)，也可以在自己的伺服器上執行它。

<p align="center">
  <img alt="事件期間的 OneUptime：事件的時間軸、待命人員、狀態頁面和 OneUptime AI 的調查" width="100%" src="/packages/Home/Static/img/readme/hero-command-center.png">
</p>

## 它能做什麼

- **[監控](https://oneuptime.com/docs/zh-TW/monitor/create-monitor)**：從全球各地的探測器或你自己的網路內部檢查網站、API、連接埠、DNS 和憑證。OneUptime 也會監看伺服器、Kubernetes、Docker、VMware、資料庫和網路設備。
- **[事件與待命](https://oneuptime.com/docs/zh-TW/incidents/index)**：在同一條時間軸上處理每個事件。透過電話、簡訊、電子郵件、推播通知、Slack 或 Microsoft Teams 呼叫待命人員，並持續上報直到有人回應。
- **[狀態頁面](https://oneuptime.com/docs/zh-TW/status-pages/index)**：透過公開或私人的狀態頁面讓客戶掌握狀況，並在上面公告排定維護。
- **[日誌、指標和追蹤](https://oneuptime.com/docs/zh-TW/telemetry/open-telemetry)**：用 OpenTelemetry 傳送、搜尋它們，並建立儀表板。例外狀況、效能剖析、真實使用者監控和安全性事件也都在同一個地方。
- **[工作流程和運行手冊](https://oneuptime.com/docs/zh-TW/workflows/index)**：把例行工作自動化，並連接 Jira、ServiceNow 以及你的團隊已在使用的其他工具。
- **[OneUptime AI](https://oneuptime.com/docs/zh-TW/ai/ai-sre)**：調查新的事件和警示，並發布附有出處的根本原因分析。開啟修正後，它可以開啟一個包含修正的拉取請求，交給你的團隊審查。
- **[API、CLI 和 Terraform](https://oneuptime.com/docs/zh-TW/api-reference/api-reference)**：從你的指令碼和 CI 自動化 OneUptime，並以程式碼管理監測器、狀態頁面和待命。

其餘內容都在[文件](https://oneuptime.com/docs/zh-TW/introduction/getting-started)中。

## 開始使用

### OneUptime Cloud

[註冊](https://oneuptime.com/accounts/register)並建立一個專案。免費方案不需要信用卡。

### 用 Docker Compose 自行託管

你需要一台記憶體至少 8 GB 的 Linux 伺服器，並裝有 Docker、Docker Compose、Git 和 Node.js。

在第 3 步之前，把 `config.env` 中的 `HOST` 設為大家連到 OneUptime 時使用的網域名稱或 IP 位址，不要加上 `http://`。只有在自己的電腦上試用 OneUptime 時才保留 `localhost`。

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

當 `npm start` 輸出 **OneUptime is up!** 後，開啟 `http://localhost` 或伺服器的位址並註冊。第一個帳號會成為這個執行個體的管理員。

[Docker Compose 指南](https://oneuptime.com/docs/zh-TW/installation/docker-compose)介紹了伺服器規格、HTTPS、備份和更新。

### 用 Helm 部署到 Kubernetes

如需大規模正式環境或高可用性，請安裝 Helm chart。把 `host` 設為大家連線到 OneUptime 時使用的網域名稱或 IP 位址：

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime --set host=oneuptime.example.com
```

[chart 的 README](/HelmChart/Public/oneuptime/README.md) 介紹了儲存、HTTPS、資料庫和升級。

## Community 與 Enterprise

- **Community Edition**：免費且開源，包含以上全部功能，也包括 SAML 和 OIDC 單一登入。
- **Enterprise Edition**：加入 SCIM 佈建、稽核日誌、團隊合規和執行個體健康儀表板，並提供優先支援。在正式環境中使用需要授權：[聯絡銷售](mailto:sales@oneuptime.com)。

兩個版本的比較請見[文件](https://oneuptime.com/docs/zh-TW/self-hosted/enterprise)。

## 取得協助

- 在 [Slack 上的 OneUptime 社群](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA)提問。
- 在 [GitHub issues](https://github.com/OneUptime/oneuptime/issues) 中回報錯誤、提出功能需求。
- 請依 [SECURITY.md](/.github/SECURITY.md) 的說明私下回報安全性漏洞。
- 其他問題請寄信到 [support@oneuptime.com](mailto:support@oneuptime.com)。

## 參與貢獻

歡迎修正錯誤、開發功能、改善文件和撰寫測試。[本機開發指南](https://oneuptime.com/docs/zh-TW/installation/local-development)介紹了如何從原始碼執行 OneUptime，[貢獻指南](/.github/CONTRIBUTING.md)說明了拉取請求和授權的規則。帶有 [good first issue](https://github.com/OneUptime/oneuptime/labels/good%20first%20issue) 標籤的 issue 很適合作為起點。

如果 OneUptime 對你有幫助，請為這個儲存庫加星，或[贊助這個專案](https://github.com/sponsors/OneUptime)。

## 授權條款

OneUptime 以 [Apache License 2.0](/LICENSE) 開源，[`ee/`](/ee) 目錄除外。該目錄包含 Enterprise Edition，採用 [OneUptime Enterprise License](/ee/LICENSE) 授權。Community Edition 映像不包含任何來自 `ee/` 的程式碼。儲存庫根目錄下的 [`LICENSE`](/LICENSE) 檔案規定了這項劃分。
