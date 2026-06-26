# 指標監測器

指標監測讓您能夠監測透過 OpenTelemetry 收集的自訂應用程式與基礎設施指標。OneUptime 會在一段時間範圍內評估指標值，並根據您設定的條件觸發警示。

## 概觀

指標監測器會查詢並評估來自您遙測服務的數值指標。這讓您能夠：

- 監測自訂應用程式指標（請求速率、佇列深度、錯誤率等）
- 追蹤基礎設施指標（CPU、記憶體、磁碟、網路）
- 使用篩選條件與彙總來建立複雜的指標查詢
- 使用數學公式結合多個指標
- 根據指標閾值設定警示

## 建立指標監測器

1. 前往 OneUptime 儀表板中的 **Monitors**
2. 點擊 **Create Monitor**
3. 選擇 **Metrics** 作為監測器類型
4. 設定指標查詢與選用的公式
5. 選擇彙總策略
6. 視需要設定監測條件

## 設定選項

### 指標查詢

定義一個或多個指標查詢。每個查詢包含：

| 欄位             | 說明                                            | 必填 |
| ---------------- | ----------------------------------------------- | ---- |
| Metric Name      | 要查詢的指標名稱                                | 是   |
| Aggregation Type | 如何彙總原始指標值（sum、avg、min、max、count） | 是   |
| Attributes       | 用於縮小指標資料範圍的鍵值篩選條件              | 否   |
| Aggregate By     | 用於分組指標的維度                              | 否   |

每個查詢會被指派一個別名（例如 `a`、`b`、`c`），以供公式中使用。

### 公式

使用數學運算式結合多個指標查詢。例如：

- `a / b * 100` — 從兩個查詢計算百分比
- `a + b` — 加總兩個指標
- `a - b` — 兩個指標之間的差值

### 滾動時間範圍

選擇用於指標評估的時間範圍：

- 過去 1 分鐘
- 過去 5 分鐘
- 過去 10 分鐘
- 過去 15 分鐘
- 過去 30 分鐘
- 過去 60 分鐘

### 彙總策略

選擇如何彙總指標值以進行評估：

| 策略          | 說明                 |
| ------------- | -------------------- |
| Average       | 時間範圍內的平均值   |
| Sum           | 所有值的總和         |
| Maximum Value | 時間範圍內的最高值   |
| Minimum Value | 時間範圍內的最低值   |
| All Values    | 所有值都必須符合條件 |
| Any Value     | 至少一個值符合條件   |

## 監測條件

### 可用的檢查類型

| 檢查類型     | 說明                         |
| ------------ | ---------------------------- |
| Metric Value | 所設定指標查詢或公式的彙總值 |

### 篩選類型

- **Greater Than** — 指標值超過閾值
- **Less Than** — 指標值低於閾值
- **Greater Than or Equal To** — 指標值等於或高於閾值
- **Less Than or Equal To** — 指標值等於或低於閾值
- **Equal To** — 指標值完全符合
- **Not Equal To** — 指標值不符合

### 條件範例

#### 當錯誤率超過 5% 時發出警示

- **Query a**：`http_requests_total`，以 `status=5xx` 篩選
- **Query b**：`http_requests_total`
- **Formula**：`a / b * 100`
- **Check On**：Metric Value
- **Filter Type**：Greater Than
- **Value**：5

#### 當請求佇列深度過高時發出警示

- **Query**：`request_queue_size`，彙總方式：Maximum Value
- **Check On**：Metric Value
- **Filter Type**：Greater Than
- **Value**：1000

## 設定需求

指標監測需要您的應用程式或基礎設施透過 OpenTelemetry 將指標傳送至 OneUptime。設定說明請參閱 [OpenTelemetry](/docs/telemetry/open-telemetry) 文件。
