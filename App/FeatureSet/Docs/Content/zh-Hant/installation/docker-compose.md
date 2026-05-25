# 使用 Docker Compose 完全免費部署 OneUptime

如果您希望在自己的服務器上託管 OneUptime，可以使用 Docker Compose 在 Debian、Ubuntu 或 RHEL 上部署單服務器實例。此選項讓您對實例擁有更多控制權和自定義能力，但也需要更多技術技能和資源來進行部署和維護。

#### 選擇您的系統要求
根據您的使用量和預算，您可以爲服務器選擇不同的系統要求。爲獲得最佳性能，我們建議 OneUptime 使用以下配置：

- **推薦系統要求**
  - 16GB 內存
  - 8 核 CPU
  - 400 GB 磁盤
  - Ubuntu 22.04
  - 已安裝 Docker 和 Docker Compose
- **家庭實驗室 / 最低要求**
  - 如果您想在家庭環境中用於個人或實驗目的運行 OneUptime（我們的一些用戶甚至將其安裝在 RaspberryPi 上），可以使用家庭實驗室要求：
    - 8 GB 內存
    - 4 核 CPU
    - 20 GB 磁盤
    - 已安裝 Docker 和 Docker Compose


#### 單服務器部署的前提條件

安裝教程：[https://youtu.be/j1SWmMW2oL4](https://youtu.be/j1SWmMW2oL4)

在開始部署流程之前，請確保您已準備好：

- 運行 Debian、Ubuntu 或 RHEL 衍生版本的服務器
- 在服務器上安裝了 Docker 和 Docker Compose

安裝 OneUptime：

```
# 僅克隆 release 分支並進入目錄
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# 將 config.example.env 複製爲 config.env
cp config.example.env config.env

# 重要：編輯 config.env 文件。請確保您使用了隨機密鑰。

npm start
```

如果您不想使用 npm 或未安裝 npm，請運行以下命令代替：

```
# 從 config.env 文件讀取環境變量並運行 docker compose up
(export $(grep -v '^#' config.env | xargs) && docker compose up --remove-orphans -d)

# 如果綁定端口時遇到權限問題，請使用 sudo
sudo bash -c "(export $(grep -v '^#' config.env | xargs) && docker compose up --remove-orphans -d)"
```


### 訪問 OneUptime

OneUptime 應運行在：http://localhost。您需要註冊一個新賬號才能開始使用您的實例。

### 設置 TLS/SSL 證書

OneUptime **不支持**自行設置 SSL/TLS 證書。您需要自行設置 SSL/TLS 證書。

如果您需要使用 SSL/TLS 證書，請按照以下步驟操作：

1. 使用反向代理，如 Nginx 或 Caddy。
2. 使用 Let's Encrypt 頒發證書。
3. 將反向代理指向 OneUptime 服務器。
4. 更新以下設置：
   - 將 `HTTP_PROTOCOL` 環境變量設置爲 `https`。
   - 將 `HOST` 環境變量更改爲託管反向代理的服務器域名。

## 生產就緒檢查清單

理想情況下，不要在生產環境中使用 docker-compose 部署 OneUptime。我們強烈建議使用 Kubernetes。OneUptime 有可用的 Helm 圖表，請查看[此處](https://artifacthub.io/packages/helm/oneuptime/oneuptime)。

如果您仍然希望在生產環境中使用 docker-compose 部署 OneUptime，請考慮以下事項：

- **SSL/TLS**：設置 SSL/TLS 證書。OneUptime 不支持自行設置 SSL/TLS 證書。您需要自行設置。請參閱上方說明。
- **密鑰**：確保您的 `config.env` 文件中包含隨機密鑰。該文件中有一些默認密鑰，請將它們替換爲隨機長字符串。
- **備份**：定期備份您的數據庫（Clickhouse、Postgres）。Redis 用作緩存，是無狀態的，可以安全地忽略。
- **更新**：請定期更新 OneUptime。我們每天發佈更新。如果在生產環境中運行，建議每週至少更新一次軟件。

### 更新 OneUptime

更新方法：

```
git checkout release # 請確保您在 release 分支上
git pull
npm run update
```

### 注意事項

- 在我們的 Docker 設置中，我們使用本地日誌驅動程序。OneUptime，尤其是探針和數據攝取容器，會生成大量日誌。爲防止儲存空間佔滿，限制 Docker 中的日誌儲存至關重要。有關詳細說明，請參閱 Docker 官方文檔[此處](https://docs.docker.com/config/containers/logging/local/)。


### 卸載 OneUptime

要卸載 OneUptime，請運行以下命令：

```
npm run down
```

這將停止並刪除 OneUptime 創建的所有容器、網絡和卷。它不會刪除 `config.env` 文件或克隆的代碼倉庫。
