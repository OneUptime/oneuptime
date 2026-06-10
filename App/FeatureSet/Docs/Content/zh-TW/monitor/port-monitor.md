# 連接埠監控

連接埠監控可讓您監控主機上特定 TCP 或 UDP 連接埠的可用性。OneUptime 會定期嘗試連線至指定的連接埠，並檢查其是否處於開啟且可回應的狀態。

## 總覽

連接埠監控會測試特定的網路連接埠是否接受連線。這可讓您：

- 監控特定連接埠上的服務可用性
- 追蹤連接埠回應時間
- 驗證資料庫、郵件伺服器與應用程式伺服器等服務是否正在執行
- 在服務中斷影響使用者之前偵測到問題

## 建立連接埠監控

1. 在 OneUptime Dashboard 中前往 **Monitors**
2. 點擊 **Create Monitor**
3. 選擇 **Port** 作為監控類型
4. 輸入主機名稱或 IP 位址以及連接埠號碼
5. 視需要設定監控條件

## 設定選項

### 主機名稱或 IP 位址

輸入目標主機的主機名稱或 IP 位址（例如 `example.com` 或 `192.168.1.1`）。

### 連接埠

輸入要監控的連接埠號碼（1–65535）。常見範例：

| 連接埠 | 服務 |
|------|---------|
| 22 | SSH |
| 25 | SMTP |
| 80 | HTTP |
| 443 | HTTPS |
| 3306 | MySQL |
| 5432 | PostgreSQL |
| 6379 | Redis |
| 27017 | MongoDB |

## 監控條件

您可以設定條件，根據以下項目來判斷您的連接埠何時被視為上線、降級或離線：

### 可用的檢查類型

| 檢查類型 | 說明 |
|------------|-------------|
| Is Online | 連接埠是否開啟並接受連線 |
| Response Time (in ms) | 建立連線所需的時間（以毫秒為單位） |
| Is Request Timeout | 連線嘗試是否逾時 |

### 篩選類型

對於 **Is Online** 與 **Is Request Timeout**：

- **True** — 條件為真
- **False** — 條件為假

對於 **Response Time**：

- **Greater Than** — 回應時間超過某個閾值
- **Less Than** — 回應時間低於某個閾值
- **Greater Than or Equal To** — 回應時間等於或高於某個閾值
- **Less Than or Equal To** — 回應時間等於或低於某個閾值
- **Equal To** — 回應時間完全相符
- **Not Equal To** — 回應時間不相符
- **Evaluate Over Time** — 在某個時間範圍內使用彙總（平均值、總和、最大值、最小值、所有值、任意值）進行評估

### 範例條件

#### 若連接埠關閉則標示為離線

- **Check On**：Is Online
- **Filter Type**：False

#### 若連線時間超過 500 毫秒則發出警示

- **Check On**：Response Time (in ms)
- **Filter Type**：Greater Than
- **Value**：500

#### 若連線速度緩慢則標示為降級

- **Check On**：Response Time (in ms)
- **Filter Type**：Greater Than
- **Value**：200
