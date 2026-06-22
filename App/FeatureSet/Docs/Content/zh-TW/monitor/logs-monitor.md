# 日誌監控器

日誌監控可讓您監控應用程式的日誌，並根據日誌模式、計數及嚴重性等級觸發警示。OneUptime 會評估來自您遙測服務的日誌，並依照您所設定的條件進行檢查。

## 概觀

日誌監控器會在某個時間範圍內搜尋並計算符合特定篩選條件的日誌。這讓您能夠：

- 在錯誤日誌激增時發出警示
- 監控特定的日誌模式或訊息
- 依嚴重性等級追蹤日誌量
- 依服務、屬性及內容篩選日誌
- 從日誌模式中偵測應用程式問題

## 建立日誌監控器

1. 前往 OneUptime Dashboard 中的 **Monitors**
2. 點選 **Create Monitor**
3. 選擇 **Logs** 作為監控器類型
4. 選取要監控的遙測服務
5. 視需要設定日誌篩選條件與條件

## 設定選項

### 遙測服務

選取一個或多個要監控其日誌的服務。服務必須透過 OpenTelemetry 將日誌傳送至 OneUptime。

### 日誌篩選條件

| 篩選條件        | 說明                                             | 是否必填 |
| --------------- | ------------------------------------------------ | -------- |
| Severity Levels | 依日誌嚴重性篩選（ERROR、WARN、INFO、DEBUG 等）  | 否       |
| Body            | 在日誌訊息內文中進行文字搜尋                     | 否       |
| Attributes      | 用於篩選自訂日誌屬性的鍵值對                     | 否       |
| Time Window     | 往回搜尋日誌的時間範圍（以秒為單位，預設值：60） | 否       |

### 嚴重性等級

依一個或多個嚴重性等級篩選日誌：

- **FATAL** / **EMERGENCY** / **CRITICAL**
- **ERROR**
- **WARN** / **WARNING**
- **INFO** / **INFORMATIONAL**
- **DEBUG**
- **TRACE**
- **UNSPECIFIED**

## 監控條件

### 可用的檢查類型

| 檢查類型  | 說明                                   |
| --------- | -------------------------------------- |
| Log Count | 在該時間範圍內符合您篩選條件的日誌數量 |

### 篩選類型

- **Greater Than** — 日誌計數超過某個門檻值
- **Less Than** — 日誌計數低於某個門檻值
- **Greater Than or Equal To** — 日誌計數等於或高於某個門檻值
- **Less Than or Equal To** — 日誌計數等於或低於某個門檻值
- **Equal To** — 日誌計數完全相符
- **Not Equal To** — 日誌計數不相符

### 條件範例

#### 在 60 秒內出現超過 100 筆錯誤日誌時發出警示

- **Severity Levels**：ERROR
- **Time Window**：60 秒
- **Check On**：Log Count
- **Filter Type**：Greater Than
- **Value**：100

#### 在出現任何嚴重（fatal）日誌時發出警示

- **Severity Levels**：FATAL
- **Time Window**：60 秒
- **Check On**：Log Count
- **Filter Type**：Greater Than
- **Value**：0

#### 監控包含特定錯誤訊息的日誌

- **Body**：`database connection timeout`
- **Time Window**：300 秒
- **Check On**：Log Count
- **Filter Type**：Greater Than
- **Value**：5

## 設定需求

日誌監控需要您的應用程式透過 OpenTelemetry 將日誌傳送至 OneUptime。如需設定說明，請參閱 [OpenTelemetry](/docs/telemetry/open-telemetry) 文件。
