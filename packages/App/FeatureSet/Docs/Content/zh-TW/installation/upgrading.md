# 升級 OneUptime

本指南說明如何安全地升級您自行託管的 OneUptime 安裝環境。

## 一般指引

- 跨主要版本時請逐步升級（例如 6 → 7 → 8）。請勿跳過主要版本。
- 只要您依循發行說明，便可跨越多個次要／修補版本（例如 8.1 → 8.4）。
- 升級前請務必進行備份，並驗證您能夠成功還原這些備份。

<!-- TODO(i18n): Translate this section. English source: en/installation/upgrading.md (added for the Community/Enterprise image split). -->

## Community and Enterprise Edition images

OneUptime now ships the app as two images. The **Community Edition** is open
source under the Apache License 2.0. The **Enterprise Edition** adds the
enterprise modules from the repository's `ee/` directory: SAML SSO, OIDC, SCIM,
team compliance, audit logs and the enterprise Health dashboards in the Admin
Dashboard. Before this change both editions ran the same code, and
`IS_ENTERPRISE_EDITION` decided which features were switched on. Now the image
decides, and the Community image does not contain the `ee/` directory.

The [Enterprise Edition](/docs/self-hosted/enterprise) page has the full
feature comparison, licensing details and what happens when you switch
editions.

### What to do before you upgrade

- **Community Edition without SSO, OIDC or SCIM:** nothing. Upgrade as usual.
- **Helm with `image.type: enterprise-edition`:** nothing. The chart already
  pulls the `enterprise-` images, which now contain the enterprise modules.
- **Docker Compose with `IS_ENTERPRISE_EDITION=true`:** switch to the
  Enterprise image when you upgrade by setting `APP_TAG=enterprise-release`
  (or `enterprise-<version>`) in `config.env`. `APP_TAG=release` is the
  Community image, and `IS_ENTERPRISE_EDITION=true` no longer switches anything
  on. `npm run update` makes this change for you while
  `IS_ENTERPRISE_EDITION=true` (`release` becomes `enterprise-release`, a
  pinned `13.0.7` becomes `enterprise-13.0.7`) and prints what it changed.
  The App now **refuses to start** when `IS_ENTERPRISE_EDITION=true` is set on
  the Community image, instead of silently no longer enforcing "Require SSO",
  SSO, SCIM and audit logging. The error says what to set:
  `APP_TAG=enterprise-<version>` to keep the Enterprise Edition, or
  `IS_ENTERPRISE_EDITION=false` to run the Community Edition.
- **Community image with SSO, OIDC or SCIM already configured:** SSO sign-in
  and SCIM provisioning stop with this upgrade, and "Require SSO for login" is
  no longer enforced. Switch to the Enterprise image to keep them. Otherwise,
  read [Switching from Enterprise to Community](/docs/self-hosted/enterprise#switching-from-enterprise-to-community)
  before you upgrade. It explains how users sign in afterwards and who to
  remove first. To run the Community Edition, also set
  `IS_ENTERPRISE_EDITION=false`.

Your configuration is never deleted, and no migration is needed to switch
editions in either direction.

### Licensing after the upgrade

The Enterprise Edition now checks its license:

- **An install with a license key** keeps working. It checks the license with
  OneUptime when it starts and once a day. If the license expires, everything
  keeps working for a 30-day grace period, and after that the same happens as
  for an install with no license.
- **An install with no license**, for example one that ran the Enterprise
  Edition on `IS_ENTERPRISE_EDITION=true` alone, gets a 14-day trial from the
  first start of this release. **If you use SSO, OIDC, SCIM or audit logging,
  activate a license before the trial ends.** After the trial, SSO and OIDC
  sign-in stop, "Require SSO for login" is no longer enforced (users sign in
  with their password), SCIM provisioning stops and audit logging stops
  recording. Enterprise configuration also becomes read-only and the
  enterprise Health dashboards are locked. Everything resumes, without a
  restart, as soon as you activate a license. The trial is for evaluation:
  production use of the Enterprise Edition requires a OneUptime Enterprise
  subscription. See
  [When a license expires or is missing](/docs/self-hosted/enterprise#when-a-license-expires-or-is-missing).
- **Air-gapped installs** can activate with a signed license token instead of
  a key. See [Offline activation](/docs/self-hosted/enterprise#offline-activation-air-gapped-installs).

### OneUptime Cloud customers

Nothing changes for you. OneUptime Cloud runs the Enterprise Edition, and your
plan still decides which features you get: SSO, OIDC, SCIM and team
compliance on the Scale plan and above, and audit logs on the Enterprise plan.
Projects on the Scale plan now see the SSO, OIDC, SCIM and team compliance
settings that used to show an upgrade prompt.

### API and endpoint changes

- `GET /api/global-config/license` returns the license key, the license token,
  the instance list, the instance ID and version details only to master
  admins. Other callers get the edition and the license status.
- Self-hosted installs no longer serve the license-server endpoints under
  `/api/enterprise-license/`. Only oneuptime.com uses them.
- The SSO, OIDC and SCIM endpoints keep their exact paths on the Enterprise
  Edition, so identity provider configuration does not change. On the
  Community Edition they return `404`. On the Enterprise Edition they refuse
  requests while the license is lapsed (after the trial or grace period), and
  answer again as soon as a license is activated.

## 從 OneUptime 13 升級到 14

OneUptime 14 將應用程式拆成兩個版本，實際執行哪一個由你拉取的映像決定。**Community Edition**（Apache-2.0，標籤 `release` 與 `<version>`）不包含儲存庫中的 `ee/` 目錄：SAML SSO、OpenID Connect、SCIM 佈建、團隊合規設定、稽核日誌、管理後台的 **Health** 儀表板與 **Query Console** 完全不在該映像中。**Enterprise Edition**（標籤 `enterprise-release` 與 `enterprise-<version>`）包含這些功能，並在執行期間檢查 Enterprise 授權——OneUptime 13 從未檢查過。

上方的 [Community and Enterprise Edition images](#community-and-enterprise-edition-images) 是本次變更的參考：各版本包含哪些功能、每種部署方式要設定什麼、授權的作用為何。本節說明升級本身。請從 13 升級；若仍在 12，請先完成 12 → 13。

兩個版本都不會刪除任何資料。你的 SSO、OIDC 與 SCIM 設定、"Require SSO for login" 設定，以及至今記錄的稽核日誌都會留在資料庫中。Community Edition 只是不提供也不強制這些功能，而切換版本在任一方向都不需要遷移。

### 你需要做的事

1. **決定這套部署要執行哪個版本。** 若你使用 SAML SSO、OpenID Connect、SCIM 佈建、團隊合規設定或稽核日誌，或需要管理後台的 **Health** 儀表板，那就是 Enterprise Edition。否則沒有什麼要決定：你現在用的就是 Community Edition。
2. **使用 Helm 時，在 values 檔案中指定版本：** `image.type: enterprise-edition`（預設值為 `community-edition`）。不要改 `image.tag`——Chart 會自行加上 `enterprise-` 前綴，因此 `image.tag: release` 會拉取 `oneuptime/app:enterprise-release`。這個值並非新增：若你已經執行 `enterprise-edition`，就無需變動，你原本拉取的標籤現在包含 `ee/`。
3. **使用 Docker Compose 時，在 `config.env` 中設定 `APP_TAG=enterprise-release`**（若要固定版本則用 `enterprise-<version>`）。`APP_TAG=release` 是 Community 映像。13 的部署就是卡在這一點：在 13 中，Compose 的 Enterprise 部署是 `APP_TAG=release` 加上 `IS_ENTERPRISE_EDITION=true`，而這個組合現在會**拒絕啟動**，不會以 Community Edition 悄悄啟動並且不再強制你的 SSO 設定。只要 `IS_ENTERPRISE_EDITION=true`，`npm run update` 就會替你改寫 `APP_TAG`（`release` 變成 `enterprise-release`，固定的 `13.0.8` 變成 `enterprise-13.0.8`），並印出所做的變更。若你手動拉取映像，請先自行設定 `APP_TAG`。
4. **在 Enterprise Edition 上啟用授權。** 沒有授權的部署可獲得 14 天試用期，從它首次啟動 Enterprise Edition 起算——對升級而言就是升級當天，而不是你最初安裝 OneUptime 的那天。主管理員可從管理後台頁首的版本標籤啟用；離線部署則以簽章權杖啟用。請參閱 [Licensing](/docs/self-hosted/enterprise#licensing)。
5. **若這套部署將在已設定強制 SSO 的情況下執行 Community Edition，請在升級前檢視誰還有存取權。** "Require SSO for login" 不再被強制，密碼登入會重新被接受，任何仍持有帳號且能存取其信箱的人都能透過「忘記密碼」設定密碼——包含你在身分提供者端已移除的人，因為 SCIM 的解除佈建也會停止。請先移除這些使用者：[Switching from Enterprise to Community](/docs/self-hosted/enterprise#switching-from-enterprise-to-community)。
6. **若你以 Ping、Port 或 SSL 監視器監控 IPv6 位址，升級後請重新儲存這些監視器。** 14 之前儲存的目標位址可能被截斷儲存——請見下文。

### 版本：哪些變了，哪些沒變

| | 13 以前 | 14 起 |
| --- | --- | --- |
| Enterprise 程式碼 | 存在於每個映像；由 `IS_ENTERPRISE_EDITION=true` 開啟 | 位於 `ee/`，僅存在於 `enterprise-` 映像 |
| Helm 的選擇方式 | `image.type` | `image.type` — 未變，但映像內容確實不同了 |
| Compose 的選擇方式 | `IS_ENTERPRISE_EDITION=true` | `APP_TAG=enterprise-release` |
| Enterprise 授權 | 執行期間從不檢查 | 啟動時與每日各檢查一次 |
| SSO、OIDC 與 SCIM 端點 | 兩個版本路徑相同 | Enterprise 路徑相同；Community 回傳 `404` |
| 你的 Enterprise 設定 | 已儲存、被強制 | 兩個版本都儲存，在 Enterprise 上被強制 |

會執行一次遷移：在只有一列資料的 `GlobalConfig` 資料表新增可為空的欄位 `enterpriseEditionFirstSeenAt`，瞬間完成。沒有 ClickHouse 遷移，不刪除任何內容，切換版本在任一方向都不需要遷移。

### Enterprise Edition 的授權時間軸

- **沒有授權的部署** 以 14 天試用期執行，從首次啟動 Enterprise Edition 起算。期間所有 Enterprise 功能都可使用，版本標籤會在結束前提出警告。試用僅供評估：在生產環境使用 Enterprise Edition 需要依 OneUptime Enterprise License 的訂閱。
- **即將到期的授權** 自到期日起獲得 30 天寬限期，期間所有 Enterprise 功能都可使用，版本標籤會提出警告。
- **試用期之後，或該寬限期之後**，在啟用授權之前：SSO 與 OIDC 登入會被拒絕，"Require SSO for login" 不再被強制（使用者改以密碼登入），身分提供者的 SCIM 請求會被拒絕，稽核日誌停止記錄。Enterprise 設定變成唯讀——你仍可檢視與刪除設定、停用某個 SSO 或 OIDC 提供者、重設 SCIM Bearer 權杖，這正是事件處理所需的操作——Health 儀表板與 Query Console 會被鎖定。
- **不會刪除任何內容，核心監控也從不受影響。** 監視器、警示、事件、值班、狀態頁與遙測都不在授權管轄範圍內，密碼登入對所有使用者（包含主管理員）始終可用。啟用授權後，SSO 登入、SSO 強制、SCIM 佈建與稽核日誌記錄會以你既有的設定恢復，且不需要重新啟動。
- **你已持有的授權金鑰仍會被接受**，視為 "unverified" 授權：到期日與席次上限取自授權伺服器先前告知這套部署的值，到期後同樣享有 30 天寬限期。從現在起簽發的授權都經過簽章，由應用程式自行驗證。本次升級不需要新的金鑰。
- **本部署從未記錄過到期日的金鑰** 會在試用期內繼續可用，而不是讓所有功能一起停止。授權伺服器會分別寫入金鑰與到期日，因此一套部署可能持有從未被告知到期日的金鑰。這樣的部署會與沒有授權的部署完全同等對待：從首次啟動 Enterprise Edition 起算的 14 天試用期內，所有 Enterprise 功能都可使用；試用期之後，發生的情況與上面相同。在這種狀態下不會強制席次上限，因為該部署持有的授權紀錄本身已經不完整。主管理員從版本標籤重新啟用授權，或每日授權同步從 oneuptime.com 取回到期日，都會在不需重新啟動的情況下恢復一切。

完整的狀態表請見 [When a license expires or is missing](/docs/self-hosted/enterprise#when-a-license-expires-or-is-missing)。

### Docker Compose：選擇映像標籤

```
git checkout release # 請確認你在 release 分支上。
git pull
npm run update
```

- **只要 `IS_ENTERPRISE_EDITION=true`，`npm run update` 就會把 `APP_TAG`** 換成同一發行版的 Enterprise 映像，並印出所做的變更。你的註解與引號會保留，已經是 `enterprise-` 標籤的 `APP_TAG` 不會被改動，再執行一次也不會有任何變化。
- **手動拉取映像會跳過這一步**，此時應用程式會在啟動時結束，並給出明確說明該設定什麼的錯誤：要保留 Enterprise Edition 就設 `APP_TAG=enterprise-<version>`，要執行 Community Edition 就設 `IS_ENTERPRISE_EDITION=false`。
- **若要刻意切換到 Community Edition**，請設定 `APP_TAG=release` 與 `IS_ENTERPRISE_EDITION=false`。若這套部署強制 SSO，請先閱讀上面的第 5 點。
- 本次發行版不需要在 `config.env` 中變更其他內容。

### Helm：選擇映像類型

```
helm repo update
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

- **已經執行 `image.type: enterprise-edition` 的部署不需要變更任何值。** Chart 很早就會為標籤加上前綴；新的是 `enterprise-` 映像裡包含 `ee/`。自本次發行版起，依上方時間軸對它們檢查授權。
- **`image.tag: release` 是預設值**，因此停留在這個浮動標籤的 Chart 會在下次升級時自動進入 14，完全不需要變更值。若該部署在 `community-edition` 上設定了 SSO、OIDC 或 SCIM，請在同一次升級中設定 `image.type: enterprise-edition`。
- **`IS_ENTERPRISE_EDITION` 仍由 Chart 輸出**，它由 `image.type` 推導而來，因此兩者不可能互相矛盾。這個變數不控制任何功能。在 Community 映像上以 `extraEnv` 強行設為 `true`，只會讓應用程式拒絕啟動。切勿透過 Chart 設定 `ONEUPTIME_EDITION`。
- **Chart 部署的探針重新遵守 `probes.<key>.allowPrivateNetworkMonitors`**（[#3879](https://github.com/OneUptime/oneuptime/issues/3879)）。不設定該值時不會有任何變化——它仍預設為 `false`——而由於 Chart 的探針是全域探針，一旦設定就會作用於實例上**所有專案**的監視器。無論該值為何，回送位址、連結本機位址與 `169.254.169.254` 一律仍被封鎖。

### 14 的其他變更

- **OTLP 擷取只在佇列接受之後才確認一批資料。** 13 會先回傳 `200`，之後才入列，因此被佇列拒絕的資料會無聲遺失。14 改為回傳 `503` 與 `Telemetry queue unavailable. Please retry.`，gRPC 端點則回傳 `UNAVAILABLE`；兩者都可重試，匯出器會重送。日誌、指標、追蹤與效能剖析皆適用。不需要任何操作，但匯出器的重試與佇列背壓現在會顯現出來，而以往資料是直接消失的——若你要估算擷取容量，這點值得知道。
- **管理後台的 Health 儀表板與 Query Console 需要 Enterprise Edition**，PostgreSQL 與 Valkey 的健康警示也一樣。在 13 上只要 `IS_ENTERPRISE_EDITION=true` 就能使用，因此對用過這些頁面的 Community 部署來說，這是可見的功能減少。ClickHouse 容量檢視與自動清理、遷移狀態、全域探針與支援包在兩個版本中都有。
- **透過探針代理連到 IP 位址的 HTTPS 監視器又能正常運作了。** 探針原本把 IP 當作 TLS 伺服器名稱送出，但 IP 不是合法的伺服器名稱，Node 會直接拒絕，因此從設定了 `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS` 的全域探針監控 `https://<私有 IP>` 會在交握階段失敗。現在目標是 IP 時，探針不再送出伺服器名稱，並直接以該 IP 驗證憑證。目標為主機名稱時行為不變。
- **`oneuptime` CLI 在 `--version` 會報告真實版本號**，不再是預留字串。
- 哪些端點移動或收緊了，包含 `GET /api/global-config/license` 以及自架部署不再提供的授權伺服器端點，請見上方的 [API and endpoint changes](#api-and-endpoint-changes)。

### IPv6 監視器：Ping、Port 與 SSL

貼上時前後帶有空白的 Ping 或 Port 目標——從 looking glass 或路由器設定複製位址就會這樣——過去會被截斷儲存：`2001:518:2800:9::2 ` 變成主機 `2001`、通訊埠 `518`。兩半都合法，所以不會失敗，也不會顯示任何錯誤；監視器只是在監看一個沒人輸入過的主機。IPv4 位址從未受影響，因為沒有冒號可供切分。14 修正了這個解析，同時修正了 IPv6 Ping 監視器在 macOS 與 FreeBSD 探針上立即且持續失敗（並被回報為真實故障），以及 IPv6 SSL 監視器以 `ENOTFOUND` 失敗的問題。

已儲存的目標沒有任何遷移，因此請在**升級後逐一開啟 Ping、Port 與 SSL 的 IPv6 監視器並重新儲存**，同時核對顯示的目標位址。請預期那些在 macOS 或 FreeBSD 探針上持續失敗的監視器將開始如實回報，這可能讓事件恢復，也可能新增事件。

### 檢查版本與授權

- **管理後台頁首的版本標籤** 會顯示正在執行的版本，在 Enterprise Edition 上還會顯示授權狀態。
- **Compose：** `docker compose images` 會列出正在執行的標籤——在 Enterprise Edition 上，每個 OneUptime 映像都帶有 `enterprise-` 前綴。
- **Helm：** `kubectl get pods -n <namespace> -o jsonpath='{..image}'` 會印出各 Pod 執行的映像；同樣適用前綴規則。
- SSO、OIDC 與 SCIM 端點可用來分辨兩種情況：`404` 表示該映像不含 `ee/`（Community Edition），而 `402` 或 `403` 表示 Enterprise Edition 正在執行，但授權需要處理。

### 回復到 13

- 兩個版本、兩個發行版讀取相同的資料，唯一的結構變更是一個 13 會忽略的可為空欄位，因此回復映像不需要任何資料庫作業。
- **Docker Compose：** 把 `APP_TAG` 改回你原本執行的 13 標籤（`13.0.8` 或 `enterprise-13.0.8`），再執行 `npm run update`。在 13 上是 `IS_ENTERPRISE_EDITION=true` 開啟 Enterprise 功能，若你原本有設定，請加回去。
- **Helm：** 執行 `helm rollback my-oneuptime`，或把 `image.tag` 固定為 `13.0.8`。
- 執行 14 不會變動你的 Enterprise 設定，所以回復後設定仍保持原樣。

> 提示：在 Enterprise Edition 上，請在升級當天啟用授權，而不是等到試用期結束。維持單一登入強制生效的正是啟用動作，而試用期是從本次升級起算，不是從你最初安裝的日期起算。

## 從 OneUptime 12 升級到 13

OneUptime 13 將內建的快取與佇列引擎由 Redis 換成 [Valkey](https://valkey.io)。Redis 7.4 已離開 BSD 授權，多數早期的 Redis 貢獻者轉而投入 Valkey，它是 Redis 7.2 的分支，使用相同的通訊協定。通訊端之上的一切都沒有改變，若你偏好如此，仍可讓 OneUptime 指向真正的 Redis 或代管的 Redis 相容服務。

你所設定的一切現在都以它命名：設定項為 `VALKEY_*`，Helm 取值為 `valkey:` / `externalValkey:`，Kubernetes 物件為 `<release>-valkey*`。**所有舊名稱仍然有效**，因此未經改動的 `config.env` 或 `values.yaml` 也能照常升級並繼續運作。沒有非改不可的設定，也沒有需要遷移的資料——快取並非真實來源，Postgres 與 ClickHouse 皆不受影響。

需要做什麼取決於你的部署方式：

- **Docker Compose：**照常更新，但有一個參數很重要——請參見[使用 Docker Compose 升級](#使用-docker-compose-升級)。
- **Helm：**不需更動取值，但快取 Pod 會被重建並以空的狀態回來——請參見[使用 Helm 升級](#使用-helm-升級)。
- **你讓 OneUptime 指向自行維運的快取**（代管 Redis、ElastiCache、Memorystore 或你自己的 Valkey）：請閱讀[如果你自行維運快取](#如果你自行維運快取)。這是唯一一種可能在毫無徵兆下再也連不上你伺服器的設定。
- **你有依賴 Kubernetes 物件名稱的儀表板、警示、網路原則或指令碼：**這些名稱會改變——請參見[使用 Helm 升級](#使用-helm-升級)。

### 哪些改了，哪些沒改

| | 12 以前 | 13 起 |
| --- | --- | --- |
| 引擎 | `redis:7.0.12` | `valkey/valkey:9.1-alpine` |
| 設定項 | `REDIS_*` | `VALKEY_*` —— `REDIS_*` 仍會被讀取 |
| Compose 服務 | `redis` | `valkey` —— 仍回應主機名稱 `redis` |
| Helm 取值 | `redis:`、`externalRedis:` | `valkey:`、`externalValkey:` —— 舊鍵仍然生效 |
| Kubernetes 物件 | `<release>-redis`、`<release>-redis-master` | `<release>-valkey`、`<release>-valkey-master` |
| 產生的 Secret | `<release>-redis` 中的 `redis-password` | `<release>-valkey` 中的 `valkey-password` |
| 外部快取 Secret | `<release>-external-redis` | `<release>-external-valkey` |

改名的十個設定項是 `VALKEY_HOST`、`VALKEY_PORT`、`VALKEY_DB`、`VALKEY_USERNAME`、`VALKEY_PASSWORD`、`VALKEY_IP_FAMILY`、`VALKEY_TLS_CA`、`VALKEY_TLS_CERT`、`VALKEY_TLS_KEY` 與 `VALKEY_TLS_SENTINEL_MODE`。當兩種寫法同時存在時，應用程式優先採用 `VALKEY_*`。Helm chart 的取捨恰好相反：舊的 `redis:` 鍵會蓋過新的預設值，因此你從未動過的取值檔行為與先前完全相同。

**快取會重新啟動一次。**兩種部署方式皆然，因為容器被替換了。它不會在磁碟上保存任何內容（`appendonly no`、`save ""`），所以回來時是空的：快取值全部消失，處於等待、延遲或退避狀態的 BullMQ 作業也會遺失。可重複作業與排程作業會在重新連線時自行註冊。若進行中的遙測資料或工作流程重試對你很重要，請挑離峰時段升級。

### 使用 Docker Compose 升級

照常更新即可：

```
git checkout release # 請確認你位於 release 分支。
git pull
npm run update
```

- **若你手動執行 Compose，請加上 `--remove-orphans`。** `npm run update` 與 `npm run start` 已經帶上它，正是它移除舊的 `redis` 容器。若放著繼續執行，就會有兩個容器回應主機名稱 `redis`，連線會隨機落到過時的那一個。
- **你的 `config.env` 不會被改寫。** `npm run update` 通常會補上 `config.example.env` 裡有、而你檔案裡沒有的設定項，但它會把這十項辨識為改名，將你的取值——包含你的 `REDIS_PASSWORD`——原封不動留在原處，並列出保留了哪些。
- 把自己的鍵改成 `VALKEY_*` 是選用的，晚點再做也沒有風險。每個設定項只保留一種寫法。
- **若你在 `docker-compose.override.yml` 中設定快取變數，請改成 `VALKEY_*`。**基礎檔現在會依你的 `REDIS_HOST` 來設定 `VALKEY_HOST`，而應用程式優先讀取 `VALKEY_HOST`，因此只設定 `REDIS_HOST` 的覆寫不再勝出。

### 使用 Helm 升級

```
helm repo update
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

- **不需要更動取值。** `redis:` 與 `externalRedis:` 仍然可用——你在其下設定的內容會疊在 `valkey:` / `externalValkey:` 的新預設值之上——而 `helm upgrade` 會印出 `DEPRECATED VALUES` 提示，列出它找到的舊鍵。方便時再改名即可。
- **不會輪替任何憑證。**chart 會從你既有的 `<release>-redis` Secret 讀出密碼並帶入 `<release>-valkey`，而不是重新產生。
- **兩個舊 Secret 都會保留。** `<release>-redis`，以及你自備快取時的 `<release>-external-redis`，都標註了 `helm.sh/resource-policy: keep`，因此會留下已不再使用的副本。升級穩定後可以刪除，但請先閱讀[回復到 12](#回復到-12)。
- **物件名稱會改變。**請更新所有依賴 `<release>-redis` 或 `<release>-redis-master` 的內容：Grafana 儀表板、警示規則、NetworkPolicy、ServiceMonitor、備份作業。
- Service 也會以舊名稱 `<release>-redis-master` 發布，讓尚未輪替的 Pod 能自行重新連線，而不是在整段輪替期間解析不到任何位址。所有工作負載輪替完成後，設定 `valkey.legacyServiceAlias: false` 即可移除。
- **若你原本設定 `persistence.enabled: true`**，新的 StatefulSet 會索取全新的磁碟區 `data-<release>-valkey-0`。舊的 `data-<release>-redis-0` 從未存放過任何東西，刪掉即可停止為它付費。

### 如果你自行維運快取

讓 OneUptime 指向並非由它啟動的快取仍完全受支援，另一端的伺服器可以是 Valkey、Redis 或代管的 Redis 相容服務。改變的只是設定它的那個區塊名稱。

- 將取值檔中的 `externalRedis:` 改成 `externalValkey:`。這是選用的——舊鍵仍然生效——但這是 chart 現在所記載的寫法。
- chart 會以新名稱 `<release>-external-valkey` 重新產生該 Secret。舊的 `<release>-external-redis` 會保留但不再更新，因此若你自己的資源清單以名稱參照它，請改指向新的。
- **`extraEnv` 覆寫不再能作用到快取——而且是無聲失敗。**若你用 `extraEnv: [{name: REDIS_HOST, ...}]` 而非 `externalValkey:` 區塊來指向代管快取，你的項目仍會占住 `REDIS_HOST` 的位置，但應用程式會先讀 `VALKEY_HOST`，而 chart 會把它設成叢集內自帶的快取。換句話說，你的覆寫仍在 Pod 規格中，卻被忽略了。請把那些項目改成 `VALKEY_*`，或將設定移入受支援的 `externalValkey:` 區塊。`helm upgrade` 會針對 chart 層級的 `extraEnv` 項目提出警告；它看不到各服務的 `<service>.extraEnv` 清單，那些要你自己檢查。Compose 的對應情況是只設定 `REDIS_HOST` 的覆寫檔。

### 驗證升級結果

- **管理後台 → Health → Valkey** 應顯示「Connected」以及一個記憶體數值。這與健康警示郵件所用的可達性檢查完全相同。
- **Compose：**`docker compose ps` 會列出 `valkey` 服務，且不再有 `redis` 容器。
- **Helm：**`kubectl get pods,svc -n <namespace>` 會顯示 `<release>-valkey-0` 為 Running，以及 Service `<release>-valkey-master`。用 `helm get notes my-oneuptime` 可重新檢視升級時印出的提示。
- 若要更深入檢查，`HelmChart/Public/diagnose.sh` 會回報快取記憶體、逐出次數與連線狀況，而且新舊物件名稱它都認得。

### 回復到 12

- **Helm：**`helm rollback` 可以正常運作，因為 12 版 chart 會發現它當初建立的 `<release>-redis` Secret 仍在，並沿用其中的密碼。這正是保留舊 Secret 的用意——在你確定會留在 13 之前，別把它們刪掉。
- **Docker Compose：**在你確定之前，請讓 `config.env` 維持 `REDIS_*` 寫法。OneUptime 12 只讀取 `REDIS_*`，因此用已改名的 `config.env` 回復，會讓快取在沒有設定密碼的情況下啟動，在 Compose 網路上門戶大開，而應用程式又無法通過驗證。兩種寫法都保留、取值一致，同樣可行。
- 回復也會再次重新啟動快取，冷啟動的代價相同。

### 刻意維持為 Redis 的名稱

這些不是疏漏，也都不需要你做任何處理：

- **API 的結構維持不變。**執行個體健康回應中的 `components.redis` 與 `summary.redis`、路由 `/api/admin/health/redis`，以及管理端查詢主控台的引擎取值 `redis`，都是協定鍵而非顯示文字。你依此撰寫的指令碼可以繼續運作。
- **Redis 協定相關用語：**`redis-cli`、`INFO` 中的 `redis_version` 欄位，以及健康通知用來比對的已儲存記憶體基準值。改掉那個鍵會丟棄每個執行個體的歷史資料。
- **預設主機名稱仍是 `redis`**，這是為手寫資源清單與純 `docker run` 部署保留的。只有在 `VALKEY_HOST` 與 `REDIS_HOST` 都未設定時才會用到，而我們自己的 Compose 與 Helm 從不會出現這種情況。
- 內部類別名稱與 Postgres 欄位名稱，沒有人會看到，改名只會多付出一次遷移的成本。

## 從 OneUptime 11 升級到 12

<!-- TODO(i18n): Translate this section. English source: en/installation/upgrading.md (added for the v12 Runner merge). -->

OneUptime 12 merges two components into one. The **Runbook Agent** (the
container you installed on your own hosts to execute runbook steps) and the
**AI Agent** (the service that worked on AI code fixes) are now a single
component: the **OneUptime Runner**, shipped as the `oneuptime/runner`
Docker image. The old `oneuptime/runbook-agent` and `oneuptime/ai-agent`
images are no longer built or published — existing tags remain pullable,
but they will never receive another update.

A Runner is one installed container that can hold several **capabilities**,
toggled per Runner in the dashboard: **Runs Runbooks** (on by default),
**Runs AI Code Fixes** (off by default), and **Runs AI Remediation Commands** (off by
default). Capability changes are adopted on the Runner's next heartbeat —
no restart needed. See [Runners](/docs/runbooks/agents) for how the
component works day to day.

What you need to do depends on how you deployed:

- **Everyone:** read [What happens automatically](#what-happens-automatically)
  and [Dashboard pages moved](#dashboard-pages-moved).
- **You installed Runbook Agents on your hosts:** redeploy them onto the new
  image — see [Redeploy your Runbook Agents](#redeploy-your-runbook-agents).
- **Docker Compose:** environment variable renames plus **one
  security-relevant step** — see [Docker Compose deployments](#docker-compose-deployments).
- **Helm:** a values-file rename that fails validation if skipped — see
  [Helm deployments](#helm-deployments).
- **API keys that were granted agent permissions directly:** re-grant them —
  see [Permissions: teams migrate, API keys do not](#permissions-teams-migrate-api-keys-do-not).

### What happens automatically

No manual database work. On first boot, v12 runs a migration that:

- Renames the Postgres tables and columns (`RunbookAgent` → `Runner`,
  `RunbookAgentJob` → `RunnerJob`, plus the owner, label, and join tables to
  match). Runner ids, keys, and job history are untouched — this is a
  rename, not a re-registration.
- Migrates every **team** permission grant from the old `…RunbookAgent…`
  permission names to the new `…Runner…` names, so team roles keep working
  without reassignment. (Direct API-key grants are the exception — see below.)

The API stays compatible too:

- Requests to `/api/runbook-agent`, `/api/runbook-agent-job`,
  `/api/runbook-agent-owner-team`, and `/api/runbook-agent-owner-user` are
  rewritten server-side onto their `/runner…` equivalents, so existing
  scripts keep working.
- The agent-facing ingest path `/runbook-agent-ingest` is still served
  alongside the new `/runner-ingest`, so **Runbook Agent containers you have
  not redeployed yet keep heartbeating and executing Bash and JavaScript
  steps** against a v12 server. Each one logs a deprecation warning on the
  server naming the agent that should be redeployed.

### Redeploy your Runbook Agents

Your existing agents keep running Bash and JavaScript steps unchanged, so
this does not block the upgrade — but do it soon after:

- **SSH and Kubernetes steps (new in v12) fail on old agents.** The server
  does not exclude old agents from claiming them: an agent still on the
  `runbook-agent` image will claim an SSH or Kubernetes job and fail it with
  `Unsupported step type` — typically mid-incident, when the runbook runs.
  Redeploy the agent **before** authoring SSH or Kubernetes steps that
  target it.
- The old image receives no further updates of any kind.

Redeploying means re-running the install command with the new image and
variable names. The agent's id and key are **unchanged** (same database
row) — swap the names, keep the values:

```bash
docker rm -f oneuptime-runbook-agent

docker run --name oneuptime-runner --restart unless-stopped \
  -e ONEUPTIME_RUNNER_ID=<agent-id> \
  -e ONEUPTIME_RUNNER_KEY=<agent-key> \
  -e ONEUPTIME_URL=https://oneuptime.yourdomain.com \
  -d oneuptime/runner:release
```

(Or open the Runner in **Settings → Runners** and use **Show setup
instructions** for a pre-filled command.)

If you tuned the agent with environment variables, rename them — the old
names are **silently ignored** by the new image:

| Old (Runbook Agent)                     | New (Runner)                              |
| --------------------------------------- | ----------------------------------------- |
| `RUNBOOK_AGENT_ID`                       | `ONEUPTIME_RUNNER_ID`                     |
| `RUNBOOK_AGENT_KEY`                      | `ONEUPTIME_RUNNER_KEY`                    |
| `RUNBOOK_AGENT_POLL_INTERVAL_MS`         | `ONEUPTIME_RUNNER_POLL_INTERVAL_MS`       |
| `RUNBOOK_AGENT_HEARTBEAT_INTERVAL_MS`    | `ONEUPTIME_RUNNER_HEARTBEAT_INTERVAL_MS`  |
| `RUNBOOK_AGENT_JOB_HEARTBEAT_INTERVAL_MS`| `ONEUPTIME_RUNNER_JOB_HEARTBEAT_INTERVAL_MS` |
| `RUNBOOK_AGENT_CONCURRENCY`              | `ONEUPTIME_RUNNER_CONCURRENCY`            |

### If you ran the standalone AI Agent

The **Settings → AI → AI Agents** page is gone and the `oneuptime/ai-agent`
image is no longer built. If you had installed an AI Agent container
yourself, replace it with a Runner:

1. Create a Runner under **Settings → Runners** and install it with the
   command from **Show setup instructions**.
2. Enable **Runs AI Code Fixes** on it. The change is picked up on the next
   heartbeat.

Old AI Agent credentials still boot the new `oneuptime/runner` image
through a legacy fallback (code fixes only, with a logged warning telling
you to create a real Runner) — treat that as a bridge during the migration,
not a destination.

### Docker Compose deployments

The compose service `ai-agent` is now `runner`. If you upgrade with the
standard `npm run update` flow, the new variables are appended to your
`config.env` automatically and the stack boots — but read the key warning
below. The renames, if you manage `config.env` or overrides by hand:

| Old                              | New                                |
| -------------------------------- | ---------------------------------- |
| `AI_AGENT_KEY`                   | `ONEUPTIME_RUNNER_KEY`             |
| `AI_AGENT_ONEUPTIME_URL`         | `ONEUPTIME_RUNNER_ONEUPTIME_URL`   |
| `AI_AGENT_PORT`                  | `ONEUPTIME_RUNNER_PORT`            |
| `DISABLE_TELEMETRY_FOR_AI_AGENT` | `DISABLE_TELEMETRY_FOR_RUNNER`     |
| `ENABLE_PROFILING_FOR_AI_AGENT`  | `ENABLE_PROFILING_FOR_RUNNER`      |

The old `AI_AGENT_*` lines can stay in `config.env`; nothing reads them
anymore.

**Important — set `ONEUPTIME_RUNNER_KEY` to a random value.** The template
merge appends it with the literal placeholder
`please-change-this-to-random-value`; your old `AI_AGENT_KEY` value is
**not** carried over. This key registers the instance-wide Runner and
authenticates the AI code-fix protocol — including minting repository
access tokens — so leaving the publicly known placeholder in place is a
security hole. Before starting v12, set it to a long random value (reusing
your old `AI_AGENT_KEY` value is fine).

**Remove the orphaned `ai-agent` container.** `npm start` runs compose with
`--remove-orphans` and cleans it up. If you run `docker compose up -d` by
hand, add `--remove-orphans` (or `docker rm -f` the old container) —
otherwise the old AI Agent keeps running and keeps claiming code-fix work
alongside the new Runner.

### Helm deployments

- Rename the `aiAgent:` block in your values overrides to `runner:`. All
  subkeys (`enabled`, `replicaCount`, `resources`, `keda`, and so on) are
  unchanged. This is a hard break: the chart schema rejects unknown keys,
  so `helm upgrade` **fails validation** while an `aiAgent:` block remains.
- Workload names change from `<release>-ai-agent` to `<release>-runner` —
  update anything keyed on the old names (dashboards, alerts, network
  policies).
- The release secret key changes from `ai-agent-key` to `runner-key`. A
  fresh key is generated on upgrade and the in-cluster Runner re-registers
  itself automatically, so there is nothing to do unless something external
  referenced the old secret value.
- Deliberately unchanged: the KEDA scaling metric is still named
  `oneuptime_ai_agent_queue_size` — do not rename it in custom scalers.

### Permissions: teams migrate, API keys do not

Twelve permissions were renamed (`CreateRunbookAgent` → `CreateRunner`,
`EditRunbookAgent` → `EditRunner`, `DeleteRunbookAgent` → `DeleteRunner`,
`ReadRunbookAgent` → `ReadRunner`, and the same four verbs for
`…RunbookAgentOwnerTeam` → `…RunnerOwnerTeam` and
`…RunbookAgentOwnerUser` → `…RunnerOwnerUser`). Grants held through
**teams** are migrated automatically. Grants attached **directly to an API
key** are not — a key that held one of these twelve permissions loses that
access after the upgrade. Re-grant the new `…Runner…` permissions on those
keys in the dashboard. The `RunbookSecret`, `RunbookCredential`, and
`RunbookExecution` permission families kept their names.

Separately, v12 closes a hole: starting a runbook execution now requires
an authenticated caller with `ProjectOwner`, `ProjectAdmin`,
`ProjectMember`, `CreateRunbookExecution`, `RunbookAdmin`, or
`RunbookMember` — advancing or cancelling one also accepts
`EditRunbookExecution`. Unauthenticated triggering no longer works, and
read-only roles (for example `RunbookViewer`) can no longer start runs —
API automation that triggers runbooks needs `CreateRunbookExecution`.

### Dashboard pages moved

There are no redirects from the old URLs — update bookmarks and internal
wiki links:

| Page                    | Old location                             | New location                              |
| ----------------------- | ---------------------------------------- | ----------------------------------------- |
| Runners (was "Agents")  | Runbooks → Settings → Agents (`…/runbooks/settings/agents`) | Settings → Runners (`…/settings/runners`) |
| Runner Credentials      | Runbooks → Settings → Credentials (`…/runbooks/settings/credentials`) | Settings → Runner Credentials (`…/settings/runner-credentials`) |
| AI Agents               | Settings → AI → AI Agents (`…/settings/ai-agents`) | Removed — Runners with the **Runs AI Code Fixes** capability replace it |

Runbook Secrets stays where it was, under Runbooks → Settings → Secrets.

### New in 12, nothing to enable by accident

v12 adds AI-composed remediation commands: the AI can propose a command
plan and hand it to a Runner for execution. Everything about it is off by
default and stays off until you opt in twice — the project-level **AI
command execution** setting and the per-Runner **Runs AI Remediation Commands**
capability must both be enabled, and only runbooks/rules you configure for
it participate. Upgrading changes nothing here.

> Tip: as with every major upgrade, back up Postgres before upgrading (a
> rollback to v11 means restoring that backup), test in staging first, and
> upgrade step-by-step — 11 → 12, do not skip from older majors.

## 從 OneUptime 10 升級到 11

<!-- TODO(i18n): Translate this section. English source: en/installation/upgrading.md (added for v11 SSO->Enterprise change). -->

### Identity features (SSO, OIDC, SCIM) now require the Enterprise Edition

In v11, the following authentication and access-management features moved to
the **OneUptime Enterprise Edition** and are no longer part of the free,
open-source (Community) build:

- **SAML SSO** — both project login and status-page login
- **OpenID Connect (OIDC)** — both project login and status-page login
- **SCIM user provisioning** — project and status page
- **Global (instance-wide) SSO / OIDC**
- **Team compliance settings**

**What you'll see after upgrading:** if you configured any of these on a
Community Edition build, the settings pages show an upgrade prompt instead of
the configuration form, and the configuration can no longer be changed. Until
the Community and Enterprise images were split, providers you had already
configured could keep signing users in on a Community build, because it still
contained the sign-in code. The Community image no longer contains any SSO,
OIDC or SCIM code, so sign-in through them stops once you upgrade to it — see
[Community and Enterprise Edition images](#community-and-enterprise-edition-images).
Your existing provider records are **preserved in the database** — nothing is
deleted — and they work again as soon as the instance runs the Enterprise
Edition.

**Availability:**

- **Self-hosted:** requires the **Enterprise Edition** build.
- **OneUptime Cloud:** requires the **Scale** plan (or above).

**If you rely on SSO and self-host**, email
[support@oneuptime.com](mailto:support@oneuptime.com) for an Enterprise Edition
license so you can restore SSO/OIDC/SCIM. Mention that you upgraded from v10 to
v11 and we'll help you get it back online. If your team is mid-upgrade and this
is blocking sign-in, contact us before upgrading production so we can plan it
with you.

OneUptime 11 重建了 ClickHouse 遙測儲存。本頁說明有哪些變更、誰需要採取行動,以及——對於想保留歷史遙測資料的安裝環境——完成這件事所需的每一條查詢。

### v11 的變更

遙測資料(日誌、追蹤、指標、例外、效能分析、監控日誌、稽核日誌)遷移到新的 ClickHouse 資料表,新表採用基於時間的分割、逐欄壓縮編解碼器以及新的實體模型欄位:

| 舊資料表              | 新資料表              |
| --------------------- | --------------------- |
| `LogItemV2`           | `LogItemV3`           |
| `MetricItemV2`        | `MetricItemV3`        |
| `SpanItemV2`          | `SpanItemV3`          |
| `ExceptionItemV2`     | `ExceptionItemV3`     |
| `ProfileItemV2`       | `ProfileItemV3`       |
| `ProfileSampleItemV2` | `ProfileSampleItemV3` |
| `MonitorLogV2`        | `MonitorLogV3`        |
| `AuditLogV1`          | `AuditLogV2`          |

所有遙測資料表中有兩個欄位被重新命名:`serviceId` → `primaryEntityId`,`serviceType` → `primaryEntityType`。這是硬性重新命名——**如果你直接以 `serviceId`/`serviceType` 篩選條件查詢 OneUptime analytics API,請更新為新名稱。** OneUptime 內部的儀表板、監控器和警示會自動遷移。

這次切換**只向前進行**:新表從空白開始,升級後攝入的所有遙測資料會立即寫入新表,歷史資料隨時間自然回填。舊表會在升級過程中**自動刪除**以回收磁碟空間——如果你想保留遷移歷史資料的選項,請在升級**之前**重新命名它們(見下方步驟 0)。

> **已經在使用 11.0.0 或 11.0.1?** 這些版本會保留舊表(它們透過 TTL 逐漸清空,複製可以「升級後隨時」執行)。之後的任何更新都會**在啟動時刪除它們**。如果你仍想進行歷史資料複製且尚未完成,請在套用更新之前執行下方的步驟 0。

### 誰需要採取行動

- **全新安裝:** 無需任何操作。
- **介面中不需要升級前遙測資料的升級:** 無需任何操作。遙測頁面只顯示升級時刻之後的資料;舊表會在升級過程中被刪除。
- **希望看到升級前遙測資料的升級:** 在升級**之前**重新命名舊表(見下方步驟 0),然後在升級後隨時執行手動複製。

一如既往:主版本要逐級升級(10 → 11,不要跳版),並在升級前備份 Postgres 和 ClickHouse。

### 選用:遷移遙測歷史資料

步驟 0 在**升級之前**執行;從步驟 1 開始的所有操作都在**升級完全啟動之後**執行(新表及其物化檢視必須已存在)。請直接在 ClickHouse 主機上連線——原生協定沒有 HTTP 逾時,因此執行數小時的陳述式也沒有問題:

```bash
clickhouse-client --database oneuptime
```

開始之前需要瞭解:

- 複製可以在 OneUptime 上線運行時安全執行。新的遙測資料獨立寫入新表;複製的歷史資料在其後填充。
- 大規模資料(數百 GB)預計需要數小時。
- 下面每條陳述式都帶有 `insert_deduplication_token`,且新表內建去重視窗——因此**重新執行中途失敗的陳述式是安全的**(已插入的區塊會被跳過,包括指標彙總中的區塊),前提是盡快重試。在高強度即時攝入下,視窗(每表最近 10,000 個插入區塊)最終會淘汰舊權杖。
- 複製指標還會自動重建預先彙總的儀表板彙總(每條複製的列都會重新饋入彙總物化檢視)——這使得指標複製比其他複製更慢;請最後執行。

#### 步驟 0——升級前重新命名舊表

升級會在啟動時刪除舊表,所以請先把你要作為複製來源的表移出它的影響範圍。停止 OneUptime(將部署縮減到零),確保沒有任何程序寫入或能重建這些表,然後重新命名——`RENAME TABLE` 是瞬時的中繼資料操作,`IF EXISTS` 讓整個區塊跳過你的安裝環境從未有過的表(早於 10.0.x 中期的部署可能沒有 `AuditLogV1` 或某些 `…V2` 表——那就沒有該類型的歷史資料可複製):

```sql
RENAME TABLE IF EXISTS LogItemV2 TO LogItemV2_backup;
RENAME TABLE IF EXISTS MetricItemV2 TO MetricItemV2_backup;
RENAME TABLE IF EXISTS SpanItemV2 TO SpanItemV2_backup;
RENAME TABLE IF EXISTS ExceptionItemV2 TO ExceptionItemV2_backup;
RENAME TABLE IF EXISTS ProfileItemV2 TO ProfileItemV2_backup;
RENAME TABLE IF EXISTS ProfileSampleItemV2 TO ProfileSampleItemV2_backup;
RENAME TABLE IF EXISTS MonitorLogV2 TO MonitorLogV2_backup;
RENAME TABLE IF EXISTS AuditLogV1 TO AuditLogV1_backup;
RENAME TABLE IF EXISTS MetricItemAggMV1mByHost TO MetricItemAggMV1mByHost_backup;
```

然後執行升級,等 OneUptime 完全啟動後再繼續。

> 如果在重新命名後回滾到 v10(v10 啟動時會以舊名稱重建空表),請在重新啟動 v10 之前把 `_backup` 表改回原名——否則回滾期間攝入的遙測資料會進入重建的表,並在之後的升級中被刪除。

#### 步驟 1——列出來源分割區

每張舊表最多有 16 個分割區。對每張來源表執行:

```sql
SELECT DISTINCT _partition_id FROM LogItemV2_backup ORDER BY _partition_id;
```

#### 步驟 2——產生複製陳述式

不同安裝環境的欄位集合可能略有差異(較舊的部署可能缺少最近新增的欄位),因此請基於你的實際 schema 產生陳述式,而不是照搬固定陳述式。把 `WITH` 子句中的 `src` 和 `dst` 設定為上表中的一對表(來源表帶有步驟 0 的 `_backup` 後綴),然後執行:

```sql
WITH 'LogItemV2_backup' AS src, 'LogItemV3' AS dst
SELECT concat(
  'INSERT INTO ', dst, ' (`', arrayStringConcat(groupArray(name), '`, `'), '`)',
  ' SELECT ', arrayStringConcat(groupArray(selectExpr), ', '),
  ' FROM ', src,
  ' WHERE _partition_id = ''{PARTITION}''',
  ' ORDER BY ', (SELECT sorting_key FROM system.tables WHERE database = currentDatabase() AND name = dst), ', _id',
  ' SETTINGS max_execution_time = 0, max_partitions_per_insert_block = 0, insert_deduplication_token = ''v3copy:', dst, ':{PARTITION}'', deduplicate_blocks_in_dependent_materialized_views = 1'
) AS copy_sql
FROM (
  SELECT name,
    multiIf(name = 'primaryEntityId', 'serviceId', name = 'primaryEntityType', 'serviceType', name) AS srcName,
    if(srcName = name, concat('`', name, '`'), concat('`', srcName, '` AS `', name, '`')) AS selectExpr,
    position
  FROM system.columns
  WHERE database = currentDatabase() AND table = dst
    AND srcName IN (SELECT name FROM system.columns WHERE database = currentDatabase() AND table = src)
  ORDER BY position
);
```

產生的陳述式只複製兩張表共有的欄位(新欄位取預設值),即時重新命名 `serviceId`/`serviceType`,對列進行確定性排序以便重試產生完全相同、可去重的區塊,並解除這種規模的陳述式所需的執行時間和分割區數量限制。

#### 步驟 3——逐一分割區執行

取產生的陳述式,將 `{PARTITION}`(出現兩次——在 `WHERE` 和權杖中)替換為步驟 1 得到的每個分割區 id。逐條執行陳述式,然後對每對表重複步驟 1–3。

> 注意:如果某張來源表因在你的安裝環境中不存在而在步驟 0 被跳過,該表對的步驟 1 會以 `UNKNOWN_TABLE` 失敗——直接跳過該表對即可;沒有該類型的歷史資料可複製。

如果陳述式中途失敗,請盡快重新執行**同一條**陳述式——已提交的區塊會被去重。如果間隔很久才重試,請先比較列數(步驟 5)。

#### 步驟 4(選用)——按主機的指標彙總歷史

複製的原始指標列會自動重建服務層級彙總,但不會重建**按主機**的彙總(舊列沒有主機實體鍵)。步驟 0 重新命名的舊彙總表是這部分歷史的唯一來源;透過從主機名稱計算新鍵來遷移它:

```sql
INSERT INTO MetricItemAggMV1mByHostV2 (projectId, name, hostEntityKey, bucketTime, valueSumState, valueCountState, valueMinState, valueMaxState, retentionDate)
SELECT
  projectId,
  name,
  substring(lower(hex(SHA256(concat(projectId, '|host|host.name=', lower(trimBoth(hostIdentifier)))))), 1, 16) AS hostEntityKey,
  bucketTime,
  valueSumState,
  valueCountState,
  valueMinState,
  valueMaxState,
  retentionDate
FROM MetricItemAggMV1mByHost_backup
ORDER BY projectId, name, hostIdentifier, bucketTime, _id
SETTINGS max_execution_time = 0, insert_deduplication_token = 'v3copy:MetricItemAggMV1mByHostV2:all';
```

`ORDER BY` 很重要:它確保重試產生完全相同的插入區塊,從而能被去重權杖識別。沒有它,重試可能被悄悄跳過或重複計算。(邊緣情況:包含 `\`、`|` 或 `=` 的主機名稱——這些不是合法的 RFC 1123 主機名稱字元——計算出的鍵會與應用程式不同;除非你確定有這樣的主機,否則可以忽略。)

#### 步驟 5——驗證

按表對比較總數(新表還包含升級後的列,因此應大於或等於舊表):

```sql
SELECT
  (SELECT count() FROM LogItemV2_backup) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### 步驟 6——刪除備份表

重新命名後的表保留其保留期 TTL,因此會自行清空和縮小——但一旦你對複製結果滿意,就刪除它們以立即回收磁碟:

```sql
DROP TABLE IF EXISTS LogItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MetricItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS SpanItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ExceptionItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ProfileItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ProfileSampleItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MonitorLogV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS AuditLogV1_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MetricItemAggMV1mByHost_backup SETTINGS max_table_size_to_drop = 0;
```

(`max_table_size_to_drop = 0` 僅為該條陳述式解除伺服器 50 GB 的刪除保護。)

> 提示:與所有主版本升級一樣,請先在預備環境中測試,並確認遙測資料正流入新表,再於正式環境依賴複製結果。

## 從 OneUptime 9 升級至 10

沒有需要手動處理的變更。只需依循標準升級程序即可。

## 從 OneUptime 8 升級至 9

Helm chart 不再佈建 Kubernetes Ingress 資源。OneUptime 隨附一個 ingress gateway 容器，該容器已負責終止 TLS、管理狀態頁面網域，並為平台路由流量，因此不再需要叢集 ingress controller。

- 升級前，請從您自訂的 `values.yaml` 檔案中移除任何 `oneuptimeIngress` 覆寫設定。這些鍵值現已被忽略，若保留將會造成驗證錯誤。
- 確保 `nginx.service.type` 反映您希望如何公開內建的 ingress gateway（例如 `LoadBalancer`、`NodePort`，或搭配外部負載平衡器的 `ClusterIP`）。
- 確認狀態頁面或主要主機的任何 DNS 記錄仍指向位於 OneUptime ingress gateway 前端的 Service 或負載平衡器。
- 升級後，請確認 TLS 憑證持續透過內嵌 gateway 進行更新，且狀態頁面網域可正確解析。

## 從 OneUptime 7 升級至 8

如果您在 Kubernetes 上執行，將會有重要的破壞性變更：

- 由於 [Bitnami 授權變更](https://github.com/bitnami/charts/issues/35164)，我們不再為 Postgres、Redis 與 ClickHouse 使用 Bitnami charts
- 這些變更不向下相容。您必須依循 Helm chart `values.yaml` 中的新結構。
- 升級前請備份您的資料（Postgres、ClickHouse，以及任何持久性磁碟區）。

> 提示：請先在預備（staging）環境中測試升級。在升級正式環境之前，請確認您的工作負載正常且資料完整無損。
