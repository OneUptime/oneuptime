# 将 Serilog 日志发送到 OneUptime

## 概述

[Serilog](https://serilog.net) 是 .NET 中最流行的结构化日志库。OneUptime 使用官方的 [`Serilog.Sinks.OpenTelemetry`](https://github.com/serilog/serilog-sinks-opentelemetry) sink，通过 OpenTelemetry 协议（OTLP）接收 Serilog 日志。配置完成后，应用程序通过 Serilog 写入的每条日志事件都会被发送到 OneUptime，并在 **Telemetry → Logs** 中变得可搜索，同时包含结构化属性、严重级别以及 trace/span 关联信息。

无需安装任何 OneUptime 专用的包——该 sink 直接与 OneUptime 为所有 OpenTelemetry 数据提供的同一个 OTLP 端点通信。它适用于控制台应用、worker 服务、ASP.NET Core 应用以及任何运行在 .NET 上的程序。

## 前提条件

- **注册 OneUptime 账户** – 你可以在[此处](https://oneuptime.com)注册一个免费账户。请注意，虽然账户是免费的，但日志接收是付费功能。你可以在[此处](https://oneuptime.com/pricing)了解有关定价的更多详情。
- **创建 OneUptime 项目** – 拥有账户后，从 OneUptime 仪表板创建一个项目。如果需要帮助，请通过 support@oneuptime.com 联系我们。
- **创建遥测接收令牌（Telemetry Ingestion Token）** – 你需要一个令牌来对日志进行身份验证。

注册 OneUptime 并创建项目后，点击导航栏中的 "More"，然后点击 "Project Settings"。

在 Telemetry Ingestion Key 页面，点击 "Create Ingestion Key" 来创建一个令牌。

![Create Service](/docs/static/images/TelemetryIngestionKeys.png)

创建令牌后，点击 "View" 来查看该令牌。

![View Service](/docs/static/images/TelemetryIngestionKeyView.png)

## 你需要从 OneUptime 获取的信息

| 设置项 | 值 |
| --- | --- |
| OTLP 端点 | `https://oneuptime.com/otlp` |
| 认证请求头 | `x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN` |
| 服务名称 | 你的服务应显示的名称，例如 `my-service` |

> **自托管 OneUptime？** 将 `https://oneuptime.com/otlp` 替换为 `https://YOUR-ONEUPTIME-HOST/otlp`（如果你不进行 TLS 终止，则为 `http://...`）。其余所有内容保持不变。

该 sink 使用 OTLP **HTTP/protobuf** 协议，并会自动将 `/v1/logs` 路径追加到端点之后，因此它最终发送数据的完整 URL 为 `https://oneuptime.com/otlp/v1/logs`。你只需提供基础的 `/otlp` 端点即可。

## 步骤 1 — 安装 NuGet 包

将 Serilog 和 OpenTelemetry sink 添加到你的项目中：

```bash
dotnet add package Serilog
dotnet add package Serilog.Sinks.OpenTelemetry
```

如果你打算通过 `appsettings.json` 配置该 sink（见下文），还需添加：

```bash
dotnet add package Serilog.Settings.Configuration
```

对于 ASP.NET Core 应用，`Serilog.AspNetCore` 包会将 Serilog 接入主机和请求管道：

```bash
dotnet add package Serilog.AspNetCore
```

## 步骤 2 — 在代码中配置 sink

最直接的方式是在应用程序启动时配置 Serilog。将 sink 指向你的 OneUptime OTLP 端点，将协议设置为 `HttpProtobuf`，将你的接收令牌作为请求头传入，并使用 `service.name` 为日志打上标签。

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

> **重要提示：** 该 sink 会对日志事件进行批处理并异步发送。请始终在应用程序退出前调用 `Log.CloseAndFlush()`（或释放 logger），否则最后一批日志可能会丢失。在 ASP.NET Core 中，`Serilog.AspNetCore` 会在优雅关闭时为你处理这一点。

## 步骤 3 — 通过 appsettings.json 配置（替代方案）

如果你更倾向于使用配置而非代码，可以使用 `Serilog.Settings.Configuration`，并将 sink 设置放在 `appsettings.json` 中：

```json
{
  "Serilog": {
    "Using": [ "Serilog.Sinks.OpenTelemetry" ],
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

然后从配置构建 logger：

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

> 请将令牌排除在源代码版本控制之外。应从环境变量或密钥存储中引用它，并在启动时将其注入配置，而不是将其提交到 `appsettings.json` 中。

## ASP.NET Core 集成

对于 ASP.NET Core（.NET 6+ 最小化托管），使用 `Serilog.AspNetCore`，让 Serilog 替换默认的 logger，并同时捕获框架日志与请求日志：

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

## 写入日志

配置完成后，像平常一样使用 Serilog。结构化属性会被保留，并在 OneUptime 中成为可搜索的属性：

```csharp
Log.Information("Order {OrderId} placed by {CustomerId} for {Amount:C}",
    orderId, customerId, amount);

Log.Warning("Payment gateway slow: {LatencyMs}ms", latencyMs);
```

每个命名属性（`OrderId`、`CustomerId`、`Amount`、`LatencyMs`）都会作为日志属性发送，因此你可以在 **Telemetry → Logs** 浏览器中对它们进行筛选和搜索。

## 异常

当你使用 Serilog 记录异常时，该 sink 会将 OpenTelemetry 的 `exception.type`、`exception.message` 和 `exception.stacktrace` 属性附加到日志记录上：

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

OneUptime 会检测这些属性，并自动将该错误归入 **Exceptions**（Issues）视图，按指纹分组并归属到正确的服务。由 trace 和日志同时报告的错误会合并为单个 issue。有关检测原理的详情，请参阅[从日志中提取异常](/docs/telemetry/open-telemetry)。

## Trace 关联

如果你的应用程序还使用 OpenTelemetry .NET SDK 进行了 trace 插桩，那么在活动 span 内发出的 Serilog 日志事件会被自动标记上当前的 `TraceId` 和 `SpanId`（这是该 sink 默认 `IncludedData` 的一部分）。这使得 OneUptime 能够将一条日志行直接关联到它所发生的 trace，因此你可以从日志跳转到周围的请求，并再跳回来。

## 验证

1. 运行你的应用程序并生成几条日志事件。
2. 打开 OneUptime，前往 **Telemetry**，选择你的服务（`my-service`），然后打开 **Logs**。
3. 你应该会在几秒钟内看到你的 Serilog 事件出现，并且它们的结构化属性可作为筛选条件使用。

## 故障排查

- **没有日志出现** – 仔细检查 `x-oneuptime-token` 的值，并确认它属于你正在查看的项目。验证端点为 `https://oneuptime.com/otlp`（仅基础路径——不要自行追加 `/v1/logs`）。
- **仅在应用退出时才出现日志，或最后的日志丢失** – 确保在关闭时运行 `Log.CloseAndFlush()`。该 sink 会对事件进行批处理，因此如果进程在未刷新的情况下被终止，缓冲中的日志会丢失。
- **`401 Unauthorized` / 没有任何数据被接收** – 令牌缺失或无效。请确认请求头键名正好是 `x-oneuptime-token`。
- **服务名称错误** – 在 `ResourceAttributes`（代码中）或 `resourceAttributes`（appsettings.json 中）设置 `service.name`。如果不设置，日志会回退到默认/未知服务。
- **连接到自托管实例时出现错误** – 确保协议与你的端点方案（`https://` 与 `http://`）匹配，并且你的 OneUptime 主机可从应用程序访问。

如果你有任何疑问或需要帮助，请通过 support@oneuptime.com 联系我们。
