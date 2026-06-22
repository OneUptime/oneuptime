# 例外監控

例外監控可讓您監控應用程式的例外狀況與錯誤，當例外數量超過您所設定的閾值時觸發警示。OneUptime 會在某個時間範圍內評估來自您遙測服務的例外資料。

## 概觀

例外監控會計算並篩選符合特定條件的例外。這讓您能夠：

- 針對應用程式中的例外激增發出警示
- 監控特定的例外類型
- 依錯誤訊息搜尋例外
- 分別追蹤已解決與作用中的例外
- 從錯誤模式偵測應用程式的穩定性問題

## 建立例外監控

1. 在 OneUptime Dashboard 中前往 **Monitors**
2. 點選 **Create Monitor**
3. 選擇 **Exceptions** 作為監控類型
4. 選擇要監控的遙測服務
5. 視需要設定例外篩選條件與準則

## 設定選項

### 遙測服務

選擇一個或多個服務以監控其例外。服務必須透過 OpenTelemetry 將例外資料傳送至 OneUptime。

### 例外篩選條件

| 篩選條件         | 說明                                                           | 必填 |
| ---------------- | -------------------------------------------------------------- | ---- |
| Exception Types  | 依例外類型名稱篩選（例如 `NullPointerException`、`TypeError`） | 否   |
| Message          | 在例外訊息中進行文字搜尋                                       | 否   |
| Include Resolved | 納入已被標記為已解決的例外（預設值：false）                    | 否   |
| Include Archived | 納入已封存的例外（預設值：false）                              | 否   |
| Time Window      | 向前搜尋例外的時間範圍（以秒為單位，預設值：60）               | 否   |

## 監控準則

### 可用的檢查類型

| 檢查類型        | 說明                                 |
| --------------- | ------------------------------------ |
| Exception Count | 在時間範圍內符合您篩選條件的例外數量 |

### 篩選類型

- **Greater Than** — 例外數量超過某個閾值
- **Less Than** — 例外數量低於某個閾值
- **Greater Than or Equal To** — 例外數量等於或高於某個閾值
- **Less Than or Equal To** — 例外數量等於或低於某個閾值
- **Equal To** — 例外數量完全相符
- **Not Equal To** — 例外數量不相符

### 準則範例

#### 在 60 秒內超過 10 個例外時發出警示

- **Time Window**：60 秒
- **Check On**：Exception Count
- **Filter Type**：Greater Than
- **Value**：10

#### 針對任何 NullPointerException 發出警示

- **Exception Types**：`NullPointerException`
- **Time Window**：60 秒
- **Check On**：Exception Count
- **Filter Type**：Greater Than
- **Value**：0

#### 監控包含特定訊息的例外

- **Message**：`out of memory`
- **Time Window**：300 秒
- **Check On**：Exception Count
- **Filter Type**：Greater Than
- **Value**：0

## 設定需求

例外監控需要您的應用程式透過 OpenTelemetry 將例外資料傳送至 OneUptime。請參閱 [OpenTelemetry](/docs/telemetry/open-telemetry) 文件以取得設定說明。
