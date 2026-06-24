# Ping 監測

Ping 監測可讓您監測任何主機或 IP 位址的可用性與回應能力。OneUptime 會定期向您的目標傳送 ping 請求，並檢查它是否正確回應。

## 概觀

Ping 監測器透過向主機傳送 ICMP ping 請求來測試基本的網路連線。這讓您能夠：

- 監測主機的正常運作時間與可用性
- 追蹤網路延遲與回應時間
- 在連線問題影響您的服務之前偵測出來
- 驗證伺服器與網路裝置是否可連線

## 建立 Ping 監測器

1. 前往 OneUptime Dashboard 中的 **Monitors**
2. 點選 **Create Monitor**
3. 選擇 **Ping** 作為監測器類型
4. 輸入您想要監測的主機名稱或 IP 位址
5. 視需要設定監測條件

## 設定選項

### Ping 主機名稱或 IP 位址

輸入您想要監測的目標的主機名稱或 IP 位址（例如 `example.com` 或 `192.168.1.1`）。主機名稱與 IP 位址皆可接受。

## 監測條件

您可以設定條件，根據以下項目來判斷您的主機被視為線上、效能降低或離線：

### 可用的檢查類型

| 檢查類型              | 說明                                |
| --------------------- | ----------------------------------- |
| Is Online             | 主機是否回應 ping 請求              |
| Response Time (in ms) | ping 請求的往返時間（以毫秒為單位） |
| Is Request Timeout    | ping 請求是否逾時                   |

### 篩選類型

對於 **Is Online** 與 **Is Request Timeout**：

- **True** — 條件為真
- **False** — 條件為假

對於 **Response Time**：

- **Greater Than** — 回應時間超過某個門檻
- **Less Than** — 回應時間低於某個門檻
- **Greater Than or Equal To** — 回應時間等於或高於某個門檻
- **Less Than or Equal To** — 回應時間等於或低於某個門檻
- **Equal To** — 回應時間完全相符
- **Not Equal To** — 回應時間不相符
- **Evaluate Over Time** — 在一個時間範圍內使用彙總（平均值、總和、最大值、最小值、所有值、任何值）進行評估

### 範例條件

#### 若主機無法連線則標記為離線

- **Check On**：Is Online
- **Filter Type**：False

#### 若回應時間超過 200ms 則發出警示

- **Check On**：Response Time (in ms)
- **Filter Type**：Greater Than
- **Value**：200
