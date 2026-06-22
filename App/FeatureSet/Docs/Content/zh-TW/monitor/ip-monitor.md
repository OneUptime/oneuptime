# IP 監控

IP 監控可讓您監控任何 IPv4 或 IPv6 位址的可用性與回應能力。OneUptime 會定期測試與目標 IP 位址的連線狀況，並回報其狀態。

## 概觀

IP 監控會驗證特定 IP 位址是否可連線且能夠回應。這可讓您：

- 監控 IPv4 與 IPv6 位址的可用性
- 追蹤回應時間與延遲
- 偵測網路連線問題
- 驗證基礎架構端點是否可連線

## 建立 IP 監控

1. 前往 OneUptime Dashboard 中的 **Monitors**
2. 點選 **Create Monitor**
3. 選擇 **IP** 作為監控類型
4. 輸入您想要監控的 IP 位址
5. 視需要設定監控條件

## 設定選項

### IP 位址

輸入您想要監控的 IPv4 或 IPv6 位址（例如 `192.168.1.1` 或 `2001:db8::1`）。此值必須是有效的 IP 位址格式。

## 監控條件

您可以設定條件，以根據下列項目判斷 IP 位址何時被視為上線、效能降級或離線：

### 可用的檢查類型

| 檢查類型              | 說明                   |
| --------------------- | ---------------------- |
| Is Online             | IP 位址是否可連線      |
| Response Time (in ms) | 以毫秒為單位的回應時間 |
| Is Request Timeout    | 請求是否逾時           |

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
- **Evaluate Over Time** — 在某個時間範圍內使用彙總方式（平均值、總和、最大值、最小值、所有值、任一值）進行評估

### 條件範例

#### 若 IP 無法連線則標記為離線

- **Check On**：Is Online
- **Filter Type**：False

#### 若延遲超過 100ms 則發出警示

- **Check On**：Response Time (in ms)
- **Filter Type**：Greater Than
- **Value**：100
