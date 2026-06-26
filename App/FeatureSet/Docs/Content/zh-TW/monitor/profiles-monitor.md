# Profiles 監控

Profiles 監控可讓您監控應用程式的持續剖析（continuous profiling）資料，並根據剖析計數與模式觸發警示。OneUptime 會在一段時間範圍內，評估來自您遙測服務的剖析資料。

## 概觀

Profiles 監控會計算並篩選符合特定條件的剖析資料。這讓您能夠：

- 監控應用程式的持續剖析資料
- 依類型（CPU、記憶體、goroutines 等）篩選剖析資料
- 追蹤剖析資料量與模式
- 針對剖析異常發出警示
- 依自訂剖析屬性篩選

## 建立 Profiles 監控

1. 在 OneUptime Dashboard 中前往 **Monitors**
2. 點擊 **Create Monitor**
3. 選擇 **Profiles** 作為監控類型
4. 選擇要監控的遙測服務
5. 視需要設定剖析篩選條件與準則

## 設定選項

### 遙測服務

選擇一個或多個服務以監控其剖析資料。服務必須透過 OpenTelemetry 將持續剖析資料傳送至 OneUptime。

### 剖析篩選條件

| 篩選條件      | 說明                                               | 必填 |
| ------------- | -------------------------------------------------- | ---- |
| Profile Types | 依剖析類型名稱（例如 CPU、記憶體、goroutines）篩選 | 否   |
| Attributes    | 用於篩選自訂剖析屬性的鍵值對                       | 否   |
| Time Window   | 往回搜尋剖析資料的範圍（以秒為單位，預設值：60）   | 否   |

## 監控準則

### 可用的檢查類型

| 檢查類型      | 說明                                     |
| ------------- | ---------------------------------------- |
| Profile Count | 在時間範圍內符合您篩選條件的剖析資料數量 |

### 篩選類型

- **Greater Than** — 剖析計數超過某個門檻
- **Less Than** — 剖析計數低於某個門檻
- **Greater Than or Equal To** — 剖析計數達到或高於某個門檻
- **Less Than or Equal To** — 剖析計數等於或低於某個門檻
- **Equal To** — 剖析計數完全相符
- **Not Equal To** — 剖析計數不相符

### 準則範例

#### 若 5 分鐘內未收到任何剖析資料則發出警示

- **Time Window**：300 秒
- **Check On**：Profile Count
- **Filter Type**：Equal To
- **Value**：0

## 設定需求

Profiles 監控需要您的應用程式透過 OpenTelemetry 將持續剖析資料傳送至 OneUptime。如需設定指示，請參閱 [OpenTelemetry](/docs/telemetry/open-telemetry) 文件。
