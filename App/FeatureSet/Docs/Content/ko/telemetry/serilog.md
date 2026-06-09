# Serilog 로그를 OneUptime으로 전송하기

## 개요

[Serilog](https://serilog.net)는 .NET에서 가장 널리 사용되는 구조화된 로깅 라이브러리입니다. OneUptime은 공식 [`Serilog.Sinks.OpenTelemetry`](https://github.com/serilog/serilog-sinks-opentelemetry) 싱크를 사용하여 OpenTelemetry Protocol(OTLP)을 통해 Serilog 로그를 수집합니다. 일단 구성되면, 애플리케이션이 Serilog를 통해 기록하는 모든 로그 이벤트가 OneUptime으로 전송되며, **Telemetry → Logs**에서 구조화된 속성, 심각도, 트레이스/스팬 상관관계와 함께 검색할 수 있게 됩니다.

설치할 OneUptime 전용 패키지는 없습니다. 이 싱크는 OneUptime이 모든 OpenTelemetry 데이터를 위해 노출하는 것과 동일한 OTLP 엔드포인트와 통신합니다. 이는 콘솔 앱, 워커 서비스, ASP.NET Core 앱, 그리고 .NET에서 실행되는 그 밖의 모든 것에서 작동합니다.

## 사전 준비 사항

- **OneUptime 계정 가입** – [여기](https://oneuptime.com)에서 무료 계정에 가입할 수 있습니다. 계정은 무료이지만 로그 수집은 유료 기능이라는 점에 유의하세요. 가격에 대한 자세한 내용은 [여기](https://oneuptime.com/pricing)에서 확인할 수 있습니다.
- **OneUptime 프로젝트 생성** – 계정을 만든 후, OneUptime 대시보드에서 프로젝트를 생성하세요. 도움이 필요하면 support@oneuptime.com으로 연락해 주세요.
- **Telemetry 수집 토큰 생성** – 로그를 인증하려면 토큰이 필요합니다.

OneUptime에 가입하고 프로젝트를 생성한 후, 내비게이션 바에서 "More"를 클릭한 다음 "Project Settings"를 클릭하세요.

Telemetry Ingestion Key 페이지에서 "Create Ingestion Key"를 클릭하여 토큰을 생성하세요.

![Create Service](/docs/static/images/TelemetryIngestionKeys.png)

토큰을 생성한 후, "View"를 클릭하여 토큰을 확인하세요.

![View Service](/docs/static/images/TelemetryIngestionKeyView.png)

## OneUptime에서 필요한 것

| 설정 | 값 |
| --- | --- |
| OTLP 엔드포인트 | `https://oneuptime.com/otlp` |
| 인증 헤더 | `x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN` |
| 서비스 이름 | 서비스가 표시될 이름, 예: `my-service` |

> **OneUptime을 자체 호스팅하시나요?** `https://oneuptime.com/otlp`를 `https://YOUR-ONEUPTIME-HOST/otlp`로 교체하세요(TLS를 종료하지 않는 경우 `http://...`). 그 외 나머지는 모두 동일하게 유지됩니다.

이 싱크는 OTLP **HTTP/protobuf** 프로토콜을 사용하며 엔드포인트에 `/v1/logs` 경로를 자동으로 추가하므로, 최종적으로 게시되는 URL은 `https://oneuptime.com/otlp/v1/logs`가 됩니다. 기본 `/otlp` 엔드포인트만 제공하면 됩니다.

## 1단계 — NuGet 패키지 설치

프로젝트에 Serilog와 OpenTelemetry 싱크를 추가하세요:

```bash
dotnet add package Serilog
dotnet add package Serilog.Sinks.OpenTelemetry
```

`appsettings.json`에서 싱크를 구성하는 경우(아래 참조), 다음도 추가하세요:

```bash
dotnet add package Serilog.Settings.Configuration
```

ASP.NET Core 앱의 경우, `Serilog.AspNetCore` 패키지가 Serilog를 호스트 및 요청 파이프라인에 연결합니다:

```bash
dotnet add package Serilog.AspNetCore
```

## 2단계 — 코드에서 싱크 구성하기

가장 직접적인 방법은 애플리케이션 시작 시 Serilog를 구성하는 것입니다. 싱크가 OneUptime OTLP 엔드포인트를 가리키도록 하고, 프로토콜을 `HttpProtobuf`로 설정하고, 수집 토큰을 헤더로 전달하고, 로그에 `service.name`을 태그하세요.

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

> **중요:** 싱크는 로그 이벤트를 일괄 처리하여 비동기적으로 전송합니다. 애플리케이션이 종료되기 전에 항상 `Log.CloseAndFlush()`를 호출하거나(또는 로거를 dispose) 하세요. 그렇지 않으면 마지막 로그 배치가 손실될 수 있습니다. ASP.NET Core에서는 `Serilog.AspNetCore`가 정상 종료 시 이를 자동으로 처리합니다.

## 3단계 — appsettings.json에서 구성하기 (대안)

코드보다 구성을 선호한다면, `Serilog.Settings.Configuration`을 사용하여 싱크 설정을 `appsettings.json`에 넣으세요:

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

그런 다음 구성에서 로거를 빌드하세요:

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

> 토큰을 소스 제어에 두지 마세요. 환경 변수나 비밀 저장소에서 참조하여 시작 시 구성에 주입하고, `appsettings.json`에 커밋하지 마세요.

## ASP.NET Core 통합

ASP.NET Core(.NET 6+ 최소 호스팅)의 경우, `Serilog.AspNetCore`를 사용하여 Serilog가 기본 로거를 대체하고 프레임워크 + 요청 로그도 함께 캡처하도록 하세요:

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

## 로그 작성하기

일단 구성되면 평소처럼 Serilog를 사용하세요. 구조화된 속성이 보존되어 OneUptime에서 검색 가능한 속성이 됩니다:

```csharp
Log.Information("Order {OrderId} placed by {CustomerId} for {Amount:C}",
    orderId, customerId, amount);

Log.Warning("Payment gateway slow: {LatencyMs}ms", latencyMs);
```

각각의 이름 있는 속성(`OrderId`, `CustomerId`, `Amount`, `LatencyMs`)은 로그 속성으로 전송되므로, **Telemetry → Logs** 탐색기에서 이를 기준으로 필터링하고 검색할 수 있습니다.

## 예외

Serilog로 예외를 로깅하면, 싱크는 OpenTelemetry `exception.type`, `exception.message`, `exception.stacktrace` 속성을 로그 레코드에 첨부합니다:

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

OneUptime은 이러한 속성을 감지하여 오류를 자동으로 **Exceptions**(Issues) 뷰로 집계하고, 핑거프린트별로 그룹화하여 올바른 서비스에 귀속시킵니다. 트레이스와 로그 양쪽에서 보고된 오류는 하나의 이슈로 통합됩니다. 감지 방식에 대한 자세한 내용은 [로그로부터의 예외](/docs/telemetry/open-telemetry)를 참조하세요.

## 트레이스 상관관계

애플리케이션이 트레이스를 위해 OpenTelemetry .NET SDK로도 계측되어 있다면, 활성 스팬 내부에서 발생한 Serilog 로그 이벤트에는 현재 `TraceId`와 `SpanId`가 자동으로 찍힙니다(이는 싱크의 기본 `IncludedData`의 일부입니다). 이를 통해 OneUptime은 로그 라인을 그것이 발생한 트레이스에 직접 연결할 수 있으므로, 로그에서 주변 요청으로 이동했다가 다시 돌아올 수 있습니다.

## 검증

1. 애플리케이션을 실행하고 몇 개의 로그 이벤트를 생성하세요.
2. OneUptime을 열고 **Telemetry**로 이동하여 서비스(`my-service`)를 선택한 다음 **Logs**를 여세요.
3. 몇 초 이내에 Serilog 이벤트가 구조화된 속성을 필터로 사용할 수 있는 상태로 표시되어야 합니다.

## 문제 해결

- **로그가 표시되지 않음** – `x-oneuptime-token` 값을 다시 확인하고 그것이 보고 있는 프로젝트에 속하는지 확인하세요. 엔드포인트가 `https://oneuptime.com/otlp`인지 확인하세요(기본 경로만 사용 — `/v1/logs`를 직접 추가하지 마세요).
- **앱이 종료될 때만 로그가 표시되거나 마지막 로그가 누락됨** – 종료 시 `Log.CloseAndFlush()`가 실행되는지 확인하세요. 싱크는 이벤트를 일괄 처리하므로, 플러시 없이 프로세스가 종료되면 버퍼링된 로그가 손실됩니다.
- **`401 Unauthorized` / 아무것도 수집되지 않음** – 토큰이 누락되었거나 유효하지 않습니다. 헤더 키가 정확히 `x-oneuptime-token`인지 확인하세요.
- **잘못된 서비스 이름** – `ResourceAttributes`(코드) 또는 `resourceAttributes`(appsettings.json)에서 `service.name`을 설정하세요. 이를 설정하지 않으면 로그가 기본/알 수 없는 서비스로 대체됩니다.
- **자체 호스팅 인스턴스에 대한 연결 오류** – 프로토콜이 엔드포인트 스킴(`https://` 대 `http://`)과 일치하는지, 그리고 OneUptime 호스트가 애플리케이션에서 도달 가능한지 확인하세요.

질문이 있거나 도움이 필요하면 support@oneuptime.com으로 연락해 주세요.
