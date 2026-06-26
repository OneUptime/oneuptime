# 將 Serilog 日誌傳送至 OneUptime

## 概觀

[Serilog](https://serilog.net) 是 .NET 上最受歡迎的結構化日誌函式庫。OneUptime 使用官方的 [`Serilog.Sinks.OpenTelemetry`](https://github.com/serilog/serilog-sinks-opentelemetry) sink，透過 OpenTelemetry Protocol (OTLP) 來擷取 Serilog 日誌。設定完成後，您的應用程式透過 Serilog 寫入的每一筆日誌事件都會被傳送到 OneUptime，並在 **Telemetry → Logs** 中變成可搜尋的內容，包含結構化屬性、嚴重程度，以及 trace/span 關聯。

不需要安裝任何 OneUptime 專屬套件 — 此 sink 與 OneUptime 為所有 OpenTelemetry 資料所公開的同一個 OTLP 端點溝通。這適用於主控台應用程式、worker 服務、ASP.NET Core 應用程式，以及任何在 .NET 上執行的程式。

## 先決條件

- **註冊 OneUptime 帳號** – 您可以在[這裡](https://oneuptime.com)註冊免費帳號。請注意，雖然帳號是免費的，但日誌擷取是付費功能。您可以在[這裡](https://oneuptime.com/pricing)找到更多關於定價的詳細資訊。
- **建立 OneUptime 專案** – 擁有帳號後，從 OneUptime 儀表板建立一個專案。如果您需要協助，請透過 support@oneuptime.com 與我們聯絡。
- **建立 Telemetry 擷取權杖（Ingestion Token）** – 您需要一個權杖來驗證您的日誌。

註冊 OneUptime 並建立專案後，點選導覽列中的「More」，再點選「Project Settings」。

在 Telemetry Ingestion Key 頁面上，點選「Create Ingestion Key」以建立權杖。

![Create Service](/docs/static/images/TelemetryIngestionKeys.png)

建立權杖後，點選「View」以檢視該權杖。

![View Service](/docs/static/images/TelemetryIngestionKeyView.png)

## 您需要從 OneUptime 取得的內容

| 設定      | 值                                                  |
| --------- | --------------------------------------------------- |
| OTLP 端點 | `https://oneuptime.com/otlp`                        |
| 驗證標頭  | `x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN` |
| 服務名稱  | 您的服務應顯示的名稱，例如 `my-service`             |

> **自行託管 OneUptime？** 請將 `https://oneuptime.com/otlp` 替換為 `https://YOUR-ONEUPTIME-HOST/otlp`（如果您沒有終止 TLS，則為 `http://...`）。其餘的一切維持不變。

此 sink 使用 OTLP 的 **HTTP/protobuf** 協定，並會自動將 `/v1/logs` 路徑附加到端點上，因此它最終 POST 的 URL 為 `https://oneuptime.com/otlp/v1/logs`。您只需要提供基礎的 `/otlp` 端點。

## 步驟 1 — 安裝 NuGet 套件

將 Serilog 與 OpenTelemetry sink 加入您的專案：

```bash
dotnet add package Serilog
dotnet add package Serilog.Sinks.OpenTelemetry
```

如果您要透過 `appsettings.json` 設定此 sink（見下方），請同時加入：

```bash
dotnet add package Serilog.Settings.Configuration
```

對於 ASP.NET Core 應用程式，`Serilog.AspNetCore` 套件會將 Serilog 接入主機與請求管線：

```bash
dotnet add package Serilog.AspNetCore
```

## 步驟 2 — 在程式碼中設定此 sink

最直接的方式是在應用程式啟動時設定 Serilog。將此 sink 指向您的 OneUptime OTLP 端點，將協定設定為 `HttpProtobuf`，將您的擷取權杖以標頭形式傳入，並使用 `service.name` 為日誌加上標籤。

```csharp
using Serilog;
using Serilog.Sinks.OpenTelemetry;

Log.Logger = new LoggerConfiguration()
    .MinimumLevel.Information()
    .Enrich.FromLogContext()
    .WriteTo.Console() // optional: keep local logs too
    .WriteTo.OpenTelemetry(options =>
    {
        // Base OTLP endpoint. The sink appends /v1/logs automatically.
        options.Endpoint = "https://oneuptime.com/otlp";
        options.Protocol = OtlpProtocol.HttpProtobuf;

        // Authenticate with your OneUptime telemetry ingestion token.
        options.Headers = new Dictionary<string, string>
        {
            ["x-oneuptime-token"] = "YOUR_TELEMETRY_INGESTION_TOKEN"
        };

        // Identify your service in OneUptime.
        options.ResourceAttributes = new Dictionary<string, object>
        {
            ["service.name"] = "my-service",
            ["deployment.environment"] = "production"
        };
    })
    .CreateLogger();

try
{
    Log.Information("Application starting up");
    // ... your application code ...
}
finally
{
    // Flush any buffered logs before the process exits.
    Log.CloseAndFlush();
}
```

> **重要：** 此 sink 會將日誌事件分批並以非同步方式傳送。請務必在應用程式結束前呼叫 `Log.CloseAndFlush()`（或處置該 logger），否則最後一批日誌可能會遺失。在 ASP.NET Core 中，`Serilog.AspNetCore` 會在正常關閉時為您處理此事。

## 步驟 3 — 從 appsettings.json 設定（替代方案）

如果您偏好以設定檔取代程式碼，請使用 `Serilog.Settings.Configuration`，並將 sink 設定放在 `appsettings.json` 中：

```json
{
  "Serilog": {
    "Using": ["Serilog.Sinks.OpenTelemetry"],
    "MinimumLevel": "Information",
    "WriteTo": [
      {
        "Name": "OpenTelemetry",
        "Args": {
          "endpoint": "https://oneuptime.com/otlp",
          "protocol": "HttpProtobuf",
          "headers": {
            "x-oneuptime-token": "YOUR_TELEMETRY_INGESTION_TOKEN"
          },
          "resourceAttributes": {
            "service.name": "my-service",
            "deployment.environment": "production"
          }
        }
      }
    ]
  }
}
```

然後從設定檔建立 logger：

```csharp
using Serilog;
using Microsoft.Extensions.Configuration;

IConfiguration configuration = new ConfigurationBuilder()
    .AddJsonFile("appsettings.json")
    .Build();

Log.Logger = new LoggerConfiguration()
    .ReadFrom.Configuration(configuration)
    .CreateLogger();
```

> 請將權杖排除在原始碼控制之外。請從環境變數或機密儲存區參照它，並在啟動時將其注入設定中，而不要將其提交到 `appsettings.json`。

## ASP.NET Core 整合

對於 ASP.NET Core（.NET 6+ 最小化主機），請使用 `Serilog.AspNetCore`，讓 Serilog 取代預設 logger，並同時擷取框架與請求日誌：

```csharp
using Serilog;
using Serilog.Sinks.OpenTelemetry;

var builder = WebApplication.CreateBuilder(args);

builder.Host.UseSerilog((context, services, configuration) =>
{
    configuration
        .ReadFrom.Configuration(context.Configuration)
        .Enrich.FromLogContext()
        .WriteTo.OpenTelemetry(options =>
        {
            options.Endpoint = "https://oneuptime.com/otlp";
            options.Protocol = OtlpProtocol.HttpProtobuf;
            options.Headers = new Dictionary<string, string>
            {
                ["x-oneuptime-token"] = "YOUR_TELEMETRY_INGESTION_TOKEN"
            };
            options.ResourceAttributes = new Dictionary<string, object>
            {
                ["service.name"] = "my-service"
            };
        });
});

// Logs one summary event per HTTP request.
var app = builder.Build();
app.UseSerilogRequestLogging();

app.MapGet("/", () => "Hello World");
app.Run();
```

## 寫入日誌

設定完成後，像平常一樣使用 Serilog。結構化屬性會被保留，並在 OneUptime 中變成可搜尋的屬性：

```csharp
Log.Information("Order {OrderId} placed by {CustomerId} for {Amount:C}",
    orderId, customerId, amount);

Log.Warning("Payment gateway slow: {LatencyMs}ms", latencyMs);
```

每個具名屬性（`OrderId`、`CustomerId`、`Amount`、`LatencyMs`）都會以日誌屬性的形式傳送，因此您可以在 **Telemetry → Logs** 探索器中對它們進行篩選與搜尋。

## 例外狀況

當您使用 Serilog 記錄例外狀況時，此 sink 會將 OpenTelemetry 的 `exception.type`、`exception.message` 與 `exception.stacktrace` 屬性附加到該日誌記錄上：

```csharp
try
{
    ProcessPayment();
}
catch (Exception ex)
{
    Log.Error(ex, "Failed to process payment for order {OrderId}", orderId);
}
```

OneUptime 會偵測這些屬性，並自動將該錯誤匯整到 **Exceptions**（Issues）檢視中，依指紋（fingerprint）分組並歸屬到正確的服務。由 trace 與 log 同時回報的錯誤會合併成單一 issue。如需了解偵測的運作方式，請參閱[從日誌偵測的例外狀況](/docs/telemetry/open-telemetry)。

## Trace 關聯

如果您的應用程式同時也透過 OpenTelemetry .NET SDK 進行 trace 檢測，那麼在使用中 span 內發出的 Serilog 日誌事件，會自動標記上目前的 `TraceId` 與 `SpanId`（這是此 sink 預設 `IncludedData` 的一部分）。這讓 OneUptime 能夠將一行日誌直接連結到它發生時所在的 trace，因此您可以從日誌跳轉到周邊的請求，再跳回來。

## 驗證

1. 執行您的應用程式並產生幾筆日誌事件。
2. 開啟 OneUptime，前往 **Telemetry**，選擇您的服務（`my-service`），並開啟 **Logs**。
3. 您應該會在幾秒內看到您的 Serilog 事件出現，並可使用其結構化屬性作為篩選條件。

## 疑難排解

- **沒有任何日誌出現** – 仔細檢查 `x-oneuptime-token` 的值，並確認它屬於您正在檢視的專案。確認端點為 `https://oneuptime.com/otlp`（僅基礎路徑 — 請勿自行附加 `/v1/logs`）。
- **日誌只在應用程式結束時才出現，或最後幾筆日誌遺失** – 請確保 `Log.CloseAndFlush()` 會在關閉時執行。此 sink 會將事件分批，因此若行程在未清空（flush）的情況下被終止，緩衝中的日誌就會遺失。
- **`401 Unauthorized` / 沒有任何內容被擷取** – 權杖遺漏或無效。請確認標頭鍵正好是 `x-oneuptime-token`。
- **服務名稱錯誤** – 請在 `ResourceAttributes`（程式碼）或 `resourceAttributes`（appsettings.json）中設定 `service.name`。若未設定，日誌會回退到預設／未知的服務。
- **連線到自行託管執行個體時發生連線錯誤** – 請確認協定與您的端點配置（scheme）相符（`https://` 對比 `http://`），且您的 OneUptime 主機可從應用程式連線到。

如果您有任何問題或需要協助，請透過 support@oneuptime.com 與我們聯絡。
