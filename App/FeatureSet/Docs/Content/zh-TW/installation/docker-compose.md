# 使用 Docker Compose 完全免費部署 OneUptime

如果您偏好在自己的伺服器上託管 OneUptime，您可以使用 Docker Compose 在 Debian、Ubuntu 或 RHEL 上部署單一伺服器的 OneUptime 執行個體。此選項讓您對執行個體擁有更多的控制權與自訂能力，但同時也需要更多的技術能力與資源來進行部署及維護。

#### 選擇您的系統需求
根據您的使用情況與預算，您可以為伺服器選擇不同的系統需求。為了獲得最佳效能，我們建議搭配以下配置使用 OneUptime：

- **建議的系統需求**
  - 16GB 記憶體
  - 8 核心
  - 400 GB 磁碟空間
  - Ubuntu 22.04
  - 已安裝 Docker 與 Docker Compose
- **家庭實驗室 / 最低需求**
  - 如果您想在家庭環境中將 OneUptime 用於個人或實驗用途（我們甚至有部分使用者將其安裝在 RaspberyPi 上），您可以使用家庭實驗室的需求配置：
    - 8 GB 記憶體
    - 4 核心
    - 20 GB 磁碟空間
    - 已安裝 Docker 與 Docker Compose


#### 單一伺服器部署的先決條件

安裝教學：[https://youtu.be/j1SWmMW2oL4](https://youtu.be/j1SWmMW2oL4)

在您開始部署程序之前，請確認您已具備：

- 一台執行 Debian、Ubuntu 或 RHEL 衍生版本的伺服器
- 伺服器上已安裝 Docker 與 Docker Compose

安裝 OneUptime：

```
# Clone this repo with just the release branch and cd into it.
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# Copy config.example.env to config.env
cp config.example.env config.env

# IMPORTANT: Edit config.env file. Please make sure you have random secrets.

npm start
```

如果您不喜歡使用 npm 或尚未安裝它，請改為執行以下指令：

```
# Read env vars from config.env file and run docker compose up.
(export $(grep -v '^#' config.env | xargs) && docker compose up --remove-orphans -d)

# Use sudo if you're having permission issues with binding ports. 
sudo bash -c "(export $(grep -v '^#' config.env | xargs) && docker compose up --remove-orphans -d)"
```


### 存取 OneUptime

OneUptime 應該會在以下位址執行：http://localhost。您需要為您的執行個體註冊一個新帳號才能開始使用。

### 設定 TLS/SSL 憑證

OneUptime **不**支援設定 SSL/TLS 憑證。您需要自行設定 SSL/TLS 憑證。

如果您需要使用 SSL/TLS 憑證，請依照以下步驟操作：

1. 使用反向代理伺服器，例如 Nginx 或 Caddy。
2. 使用 Let's Encrypt 來配發憑證。
3. 將反向代理伺服器指向 OneUptime 伺服器。
4. 更新以下設定：
   - 將 `HTTP_PROTOCOL` 環境變數設定為 `https`。
   - 將 `HOST` 環境變數變更為託管反向代理伺服器的網域名稱。

## 生產環境就緒檢查清單

理想情況下，請勿使用 docker-compose 將 OneUptime 部署於生產環境。我們強烈建議使用 Kubernetes。OneUptime 提供了一個 helm chart，請參閱[此處](https://artifacthub.io/packages/helm/oneuptime/oneuptime)。

如果您仍想使用 docker-compose 將 OneUptime 部署於生產環境，請考慮以下事項：

- **SSL/TLS**：設定 SSL/TLS 憑證。OneUptime 不支援設定 SSL/TLS 憑證。您需要自行設定 SSL/TLS 憑證。請參閱上方說明。
- **密鑰（Secrets）**：請確認您的 `config.env` 檔案中使用了隨機產生的密鑰。該檔案中有一些預設的密鑰，請將它們替換為隨機的長字串。
- **備份**：定期備份您的資料庫（Clickhouse、Postgres）。Redis 用作快取，是無狀態的，可以放心忽略。
- **更新**：請定期更新 OneUptime。我們每天都會發布更新。如果您在生產環境中執行，我們建議您至少每週更新一次軟體。

### 更新 OneUptime

更新方式：

```
git checkout release # Please make sure you're on release branch.
git pull
npm run update
```

### 需要考量的事項

- 在我們的 Docker 設定中，我們採用了本機日誌驅動程式（local logging driver）。OneUptime（特別是在 probe 與 ingest 容器內）會產生大量的日誌。為了避免您的儲存空間被填滿，務必要在 Docker 中限制日誌的儲存容量。如需如何進行此操作的詳細指示，請參閱 Docker 官方文件[此處](https://docs.docker.com/config/containers/logging/local/)。


### 解除安裝 OneUptime

若要解除安裝 OneUptime，請執行以下指令：

```
npm run down
```

這將會停止並移除由 OneUptime 建立的所有容器、網路與磁碟區（volumes）。它不會移除 `config.env` 檔案或已複製（clone）的儲存庫。
