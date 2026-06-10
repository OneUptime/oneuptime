# 伺服器 / 虛擬機監控

伺服器與虛擬機監控讓您能夠透過安裝一個輕量級代理程式，將系統指標回報給 OneUptime，藉此監控您的伺服器、虛擬機以及其他基礎設施的健康狀態與效能。

## 概觀

伺服器監控使用安裝在您伺服器上的基礎設施代理程式來收集並回報系統指標。這讓您能夠：

- 監控伺服器的正常運作時間與可用性
- 追蹤 CPU、記憶體與磁碟使用量
- 監控執行中的處理程序
- 根據資源使用率門檻設定警示
- 在基礎設施問題影響您的服務之前偵測它們

## 建立伺服器監控

1. 前往 OneUptime 儀表板中的 **Monitors**
2. 點擊 **Create Monitor**
3. 選擇 **Server / VM** 作為監控類型
4. 系統會為此監控產生一組 **Secret Key** — 您將需要它來設定代理程式
5. 依照安裝指示在您的伺服器上設定代理程式

## 安裝基礎設施代理程式

OneUptime 基礎設施代理程式是一個以 Go 為基礎的輕量級常駐程式，會收集系統指標並每 30 秒傳送給 OneUptime。它支援 Linux、macOS 與 Windows。

### Linux / macOS

```bash
# Install the agent
curl -sSL https://oneuptime.com/docs/static/scripts/infrastructure-agent/install.sh | sudo bash

# Configure the agent
sudo oneuptime-infrastructure-agent configure --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://oneuptime.com

# Start the agent
sudo oneuptime-infrastructure-agent start
```

將 `YOUR_SECRET_KEY` 替換為您監控設定中顯示的 secret key，若為自我託管（self-hosted），請將 `https://oneuptime.com` 替換為您的 OneUptime 執行個體 URL。

### Windows

1. 從 [GitHub Releases](https://github.com/OneUptime/oneuptime/releases/latest) 下載最新的代理程式
   - `oneuptime-infrastructure-agent_windows_amd64.zip` 適用於 x64 系統
   - `oneuptime-infrastructure-agent_windows_arm64.zip` 適用於 ARM64 系統
2. 解壓縮該 zip 檔案
3. 以系統管理員身分開啟命令提示字元（Command Prompt）並執行：

```bash
# Configure the agent
oneuptime-infrastructure-agent configure --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://oneuptime.com

# Start the agent
oneuptime-infrastructure-agent start
```

### Proxy 支援

如果您的伺服器透過 proxy 連接網際網路，您可以設定代理程式來使用它：

```bash
sudo oneuptime-infrastructure-agent configure --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://oneuptime.com --proxy-url=http://proxy.example.com:8080
```

## 代理程式指令

基礎設施代理程式支援以下指令：

| 指令 | 說明 |
|---------|-------------|
| `configure` | 使用您的 secret key 與 OneUptime URL 設定代理程式 |
| `start` | 啟動代理程式服務 |
| `stop` | 停止代理程式服務 |
| `restart` | 重新啟動代理程式服務 |
| `status` | 顯示目前的服務狀態 |
| `logs` | 檢視代理程式日誌（使用 `-n` 指定行數，`-f` 持續追蹤） |
| `uninstall` | 解除安裝代理程式服務 |

## 收集的指標

代理程式會從您的伺服器收集以下指標：

### CPU

- **CPU Usage Percent** — 整體 CPU 使用率（以百分比表示）
- **CPU Cores** — CPU 核心數量

### 記憶體

- **Total Memory** — 可用記憶體總量
- **Used Memory** — 目前使用中的記憶體
- **Free Memory** — 可用的閒置記憶體
- **Memory Usage Percent** — 記憶體使用率（以百分比表示）

### 磁碟

對於每個已掛載的磁碟／磁碟區：

- **Total Disk Space** — 磁碟的總容量
- **Used Disk Space** — 目前使用中的空間
- **Free Disk Space** — 可用的閒置空間
- **Disk Usage Percent** — 磁碟使用率（以百分比表示）
- **Disk Path** — 磁碟的掛載路徑

### 處理程序

- **Process Name** — 執行中處理程序的名稱
- **Process ID (PID)** — 處理程序識別碼
- **Process Command** — 用於啟動該處理程序的完整指令

## 監控條件

您可以設定條件來判定您的伺服器何時被視為線上（online）、降級（degraded）或離線（offline）。

### 可用的檢查類型

| 檢查類型 | 說明 |
|------------|-------------|
| Is Online | 伺服器代理程式是否正在回報（依據心跳訊號） |
| CPU Usage Percent | 目前的 CPU 使用率百分比 |
| Memory Usage Percent | 目前的記憶體使用率百分比 |
| Disk Usage Percent | 目前的磁碟使用率百分比（針對特定磁碟路徑） |
| Server Process Name | 檢查具有特定名稱的處理程序是否正在執行 |
| Server Process Command | 檢查具有特定指令的處理程序是否正在執行 |
| Server Process PID | 檢查具有特定 PID 的處理程序是否正在執行 |

### 篩選類型

對於數值型指標（CPU、記憶體、磁碟）：

- **Greater Than** — 數值超過某個門檻
- **Less Than** — 數值低於某個門檻
- **Greater Than or Equal To** — 數值等於或高於某個門檻
- **Less Than or Equal To** — 數值等於或低於某個門檻
- **Evaluate Over Time** — 在某個時間範圍內使用彙總方式（平均值、總和、最大值、最小值、所有數值、任一數值）進行評估

對於處理程序檢查：

- **Is Executing** — 該處理程序目前正在執行
- **Is Not Executing** — 該處理程序未在執行

### 條件範例

#### 當代理程式停止回報時將伺服器標示為離線

- **Check On**: Is Online
- **Filter Type**: False

#### 當 CPU 使用率超過 90% 時發出警示

- **Check On**: CPU Usage Percent
- **Filter Type**: Greater Than
- **Value**: 90

#### 當磁碟使用率超過 85% 時發出警示

- **Check On**: Disk Usage Percent
- **Disk Path**: `/`
- **Filter Type**: Greater Than
- **Value**: 85

#### 當記憶體使用率超過 80% 時發出警示

- **Check On**: Memory Usage Percent
- **Filter Type**: Greater Than
- **Value**: 80

#### 當某個關鍵處理程序停止執行時發出警示

- **Check On**: Server Process Name
- **Filter Type**: Is Not Executing
- **Value**: `nginx`

## 疑難排解

### 代理程式未回報

- 確認代理程式正在執行：`sudo oneuptime-infrastructure-agent status`
- 檢查代理程式日誌：`sudo oneuptime-infrastructure-agent logs -n 50`
- 確認 secret key 是否正確
- 確保伺服器能夠連接到您的 OneUptime 執行個體 URL
- 檢查防火牆規則是否允許對外的 HTTPS 連線

### 代理程式占用大量資源

此代理程式被設計為輕量級。如果您注意到資源使用量偏高：
- 重新啟動代理程式：`sudo oneuptime-infrastructure-agent restart`
- 檢查代理程式日誌中是否有錯誤

### Proxy 問題

- 確認 proxy URL 與連接埠是否正確
- 確保 proxy 允許連接到您的 OneUptime 執行個體
- 使用以下指令重新設定：`sudo oneuptime-infrastructure-agent configure --proxy-url=http://proxy:port --secret-key=YOUR_KEY --oneuptime-url=YOUR_URL`

## 最佳實務

1. **設定有意義的門檻** — 設定符合您伺服器正常運作範圍的降級與離線條件
2. **監控關鍵處理程序** — 使用處理程序監控以確保網頁伺服器、資料庫等必要服務始終保持執行
3. **主動監控磁碟使用量** — 磁碟空間問題可能連鎖引發應用程式故障；請在磁碟滿載之前及早設定警示
4. **使用「Evaluate Over Time」** — 對於像 CPU 這類可能短暫飆升的指標，請使用以時間為基礎的彙總方式以避免誤報警示
5. **保持代理程式為最新版本** — 定期更新基礎設施代理程式以取得最新的改善與修正
