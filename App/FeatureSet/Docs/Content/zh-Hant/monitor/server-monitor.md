# 服務器/虛擬機監控器

服務器和虛擬機監控允許您通過安裝一個輕量級 Agent 來監控服務器、虛擬機和其他基礎設施的健康狀況和性能，該 Agent 將系統指標上報給 OneUptime。

## 概述

服務器監控器使用安裝在服務器上的基礎設施 Agent 來收集和上報系統指標。這使您能夠：

- 監控服務器正常運行時間和可用性
- 跟蹤 CPU、內存和磁盤使用情況
- 監控運行中的進程
- 基於資源利用率閾值設置警報
- 在基礎設施問題影響服務之前檢測到它們

## 創建服務器監控器

1. 在 OneUptime 控制台中轉到 **監控器**
2. 點擊 **創建監控器**
3. 選擇 **服務器/虛擬機** 作爲監控器類型
4. 將爲此監控器生成一個 **密鑰** — 您需要它來配置 Agent
5. 按照安裝說明在服務器上設置 Agent

## 安裝基礎設施 Agent

OneUptime 基礎設施 Agent 是一個輕量級的 Go 語言守護進程，它每 30 秒收集系統指標併發送給 OneUptime。支持 Linux、macOS 和 Windows。

### Linux / macOS

```bash
# 安裝 Agent
curl -sSL https://oneuptime.com/docs/static/scripts/infrastructure-agent/install.sh | sudo bash

# 配置 Agent
sudo oneuptime-infrastructure-agent configure --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://oneuptime.com

# 啓動 Agent
sudo oneuptime-infrastructure-agent start
```

將 `YOUR_SECRET_KEY` 替換爲監控器設置中顯示的密鑰，如果是自託管，請將 `https://oneuptime.com` 替換爲您的 OneUptime 實例 URL。

### Windows

1. 從 [GitHub Releases](https://github.com/OneUptime/oneuptime/releases/latest) 下載最新版 Agent
   - `oneuptime-infrastructure-agent_windows_amd64.zip`（x64 系統）
   - `oneuptime-infrastructure-agent_windows_arm64.zip`（ARM64 系統）
2. 解壓 zip 文件
3. 以管理員身份打開命令提示符並運行：

```bash
# 配置 Agent
oneuptime-infrastructure-agent configure --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://oneuptime.com

# 啓動 Agent
oneuptime-infrastructure-agent start
```

### 代理支持

如果您的服務器通過代理連接到互聯網，可以配置 Agent 使用代理：

```bash
sudo oneuptime-infrastructure-agent configure --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://oneuptime.com --proxy-url=http://proxy.example.com:8080
```

## Agent 命令

基礎設施 Agent 支持以下命令：

| 命令 | 描述 |
|------|------|
| `configure` | 使用密鑰和 OneUptime URL 配置 Agent |
| `start` | 啓動 Agent 服務 |
| `stop` | 停止 Agent 服務 |
| `restart` | 重啓 Agent 服務 |
| `status` | 顯示當前服務狀態 |
| `logs` | 查看 Agent 日誌（使用 `-n` 指定行數，使用 `-f` 跟蹤） |
| `uninstall` | 卸載 Agent 服務 |

## 收集的指標

Agent 從服務器收集以下指標：

### CPU

- **CPU 使用率** — 整體 CPU 利用率百分比
- **CPU 核心數** — CPU 核心數量

### 內存

- **總內存** — 總可用內存
- **已用內存** — 當前使用的內存
- **可用內存** — 可用的空閒內存
- **內存使用率** — 內存利用率百分比

### 磁盤

對於每個掛載的磁盤/卷：

- **磁盤總空間** — 磁盤總容量
- **已用磁盤空間** — 當前使用的空間
- **可用磁盤空間** — 可用的空閒空間
- **磁盤使用率** — 磁盤利用率百分比
- **磁盤路徑** — 磁盤掛載路徑

### 進程

- **進程名稱** — 運行中進程的名稱
- **進程 ID（PID）** — 進程標識符
- **進程命令** — 啓動進程的完整命令

## 監控標準

您可以配置標準來判斷服務器何時處於在線、降級或離線狀態。

### 可用檢查類型

| 檢查類型 | 描述 |
|---------|------|
| 是否在線 | 服務器 Agent 是否正在上報（基於心跳） |
| CPU 使用率 | 當前 CPU 利用率百分比 |
| 內存使用率 | 當前內存利用率百分比 |
| 磁盤使用率 | 當前磁盤利用率百分比（針對特定磁盤路徑） |
| 服務器進程名稱 | 檢查特定名稱的進程是否正在運行 |
| 服務器進程命令 | 檢查使用特定命令的進程是否正在運行 |
| 服務器進程 PID | 檢查具有特定 PID 的進程是否正在運行 |

### 過濾類型

對於數值指標（CPU、內存、磁盤）：

- **大於** — 值超過閾值
- **小於** — 值低於閾值
- **大於或等於** — 值等於或超過閾值
- **小於或等於** — 值等於或低於閾值
- **隨時間評估** — 使用聚合（平均值、求和、最大值、最小值、所有值、任意值）在時間窗口內評估

對於進程檢查：

- **正在執行** — 進程當前正在運行
- **未在執行** — 進程未在運行

### 示例標準

#### 如果 Agent 停止上報則將服務器標記爲離線

- **檢查項**：是否在線
- **過濾類型**：False

#### 當 CPU 使用率超過 90% 時發出警報

- **檢查項**：CPU 使用率
- **過濾類型**：大於
- **值**：90

#### 當磁盤使用率超過 85% 時發出警報

- **檢查項**：磁盤使用率
- **磁盤路徑**：`/`
- **過濾類型**：大於
- **值**：85

#### 當內存使用率超過 80% 時發出警報

- **檢查項**：內存使用率
- **過濾類型**：大於
- **值**：80

#### 如果關鍵進程停止運行則發出警報

- **檢查項**：服務器進程名稱
- **過濾類型**：未在執行
- **值**：`nginx`

## 故障排查

### Agent 未上報

- 驗證 Agent 是否正在運行：`sudo oneuptime-infrastructure-agent status`
- 檢查 Agent 日誌：`sudo oneuptime-infrastructure-agent logs -n 50`
- 確認密鑰是否正確
- 確保服務器能夠訪問您的 OneUptime 實例 URL
- 檢查防火牆規則是否允許出站 HTTPS 連接

### Agent 資源佔用高

Agent 設計爲輕量級。如果您注意到資源佔用高：
- 重啓 Agent：`sudo oneuptime-infrastructure-agent restart`
- 檢查 Agent 日誌中的錯誤

### 代理問題

- 驗證代理 URL 和端口是否正確
- 確保代理允許連接到您的 OneUptime 實例
- 重新配置：`sudo oneuptime-infrastructure-agent configure --proxy-url=http://proxy:port --secret-key=YOUR_KEY --oneuptime-url=YOUR_URL`

## 最佳實踐

1. **設置有意義的閾值** — 配置與服務器正常運行範圍匹配的降級和離線標準
2. **監控關鍵進程** — 使用進程監控確保 Web 服務器和數據庫等關鍵服務始終在運行
3. **主動監控磁盤使用率** — 磁盤空間問題可能導致應用程序故障；在磁盤滿之前設置警報
4. **使用"隨時間評估"** — 對於 CPU 等可能短暫峯值的指標，使用基於時間的聚合以避免誤報
5. **保持 Agent 更新** — 定期更新基礎設施 Agent 以獲取最新改進和修復
