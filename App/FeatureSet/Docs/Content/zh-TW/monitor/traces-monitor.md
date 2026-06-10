# 追蹤監控器

追蹤監控可讓您監控來自應用程式的分散式追蹤，並根據 span 模式、數量與狀態觸發警示。OneUptime 會在一段時間視窗內評估來自您遙測服務的追蹤資料。

## 概覽

追蹤監控器會搜尋並計算符合特定篩選條件的 span。這讓您能夠：

- 針對服務中的錯誤 span 激增發出警示
- 監控特定的作業與端點
- 追蹤 span 的數量與模式
- 依 span 狀態、名稱與自訂屬性進行篩選
- 從追蹤資料偵測效能與可靠性問題

## 建立追蹤監控器

1. 前往 OneUptime 儀表板中的 **Monitors**
2. 點選 **Create Monitor**
3. 選擇 **Traces** 作為監控器類型
4. 選擇要監控的遙測服務
5. 視需要設定 span 篩選條件與準則

## 設定選項

### 遙測服務

選擇一個或多個服務以監控其追蹤。服務必須透過 OpenTelemetry 將追蹤傳送至 OneUptime。

### Span 篩選條件

| 篩選條件 | 說明 | 必填 |
|--------|-------------|----------|
| Span Statuses | 依 span 狀態碼篩選（OK、ERROR、UNSET） | 否 |
| Span Name | 針對特定 span 名稱進行文字搜尋（例如作業或端點名稱） | 否 |
| Attributes | 用於篩選自訂 span 屬性的鍵值對 | 否 |
| Time Window | 往回搜尋 span 的時間範圍（以秒為單位，預設值：60） | 否 |

### Span 狀態碼

- **OK** — 作業已成功完成
- **ERROR** — 作業遇到錯誤
- **UNSET** — 未明確設定狀態

## 監控準則

### 可用的檢查類型

| 檢查類型 | 說明 |
|------------|-------------|
| Span Count | 在時間視窗內符合您篩選條件的 span 數量 |

### 篩選類型

- **Greater Than** — span 數量超過某個閾值
- **Less Than** — span 數量低於某個閾值
- **Greater Than or Equal To** — span 數量等於或高於某個閾值
- **Less Than or Equal To** — span 數量等於或低於某個閾值
- **Equal To** — span 數量完全相符
- **Not Equal To** — span 數量不相符

### 準則範例

#### 若 60 秒內錯誤 span 超過 50 個則發出警示

- **Span Statuses**：ERROR
- **Time Window**：60 秒
- **Check On**：Span Count
- **Filter Type**：Greater Than
- **Value**：50

#### 針對特定端點的錯誤發出警示

- **Span Name**：`POST /api/checkout`
- **Span Statuses**：ERROR
- **Time Window**：120 秒
- **Check On**：Span Count
- **Filter Type**：Greater Than
- **Value**：0

## 設定需求

追蹤監控需要您的應用程式透過 OpenTelemetry 將分散式追蹤傳送至 OneUptime。請參閱 [OpenTelemetry](/docs/telemetry/open-telemetry) 文件以取得設定說明。
