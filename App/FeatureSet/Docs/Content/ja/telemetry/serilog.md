# Serilog ログを OneUptime に送信する

## 概要

[Serilog](https://serilog.net) は .NET 向けで最も人気のある構造化ロギングライブラリです。OneUptime は、公式の [`Serilog.Sinks.OpenTelemetry`](https://github.com/serilog/serilog-sinks-opentelemetry) シンクを使用して、OpenTelemetry Protocol (OTLP) 経由で Serilog ログを取り込みます。設定が完了すると、アプリケーションが Serilog を通じて書き込むすべてのログイベントが OneUptime に送信され、**Telemetry → Logs** で検索可能になります。構造化されたプロパティ、重大度、トレース/スパンの相関も含まれます。

インストールが必要な OneUptime 固有のパッケージはありません。シンクは、OneUptime がすべての OpenTelemetry データ向けに公開しているのと同じ OTLP エンドポイントと通信します。これは、コンソールアプリ、ワーカーサービス、ASP.NET Core アプリ、その他 .NET 上で動作するあらゆるものに対して機能します。

## 前提条件

- **OneUptime アカウントにサインアップする** – 無料アカウントは[こちら](https://oneuptime.com)からサインアップできます。アカウント自体は無料ですが、ログの取り込みは有料機能であることにご注意ください。料金の詳細は[こちら](https://oneuptime.com/pricing)でご確認いただけます。
- **OneUptime プロジェクトを作成する** – アカウントを取得したら、OneUptime ダッシュボードからプロジェクトを作成します。サポートが必要な場合は、support@oneuptime.com までお問い合わせください。
- **Telemetry Ingestion Token を作成する** – ログを認証するためにトークンが必要です。

OneUptime にサインアップしてプロジェクトを作成したら、ナビゲーションバーの「More」をクリックし、「Project Settings」をクリックします。

Telemetry Ingestion Key ページで「Create Ingestion Key」をクリックしてトークンを作成します。

![Create Service](/docs/static/images/TelemetryIngestionKeys.png)

トークンを作成したら、「View」をクリックしてトークンを表示します。

![View Service](/docs/static/images/TelemetryIngestionKeyView.png)

## OneUptime から必要なもの

| 設定                | 値                                                  |
| ------------------- | --------------------------------------------------- |
| OTLP エンドポイント | `https://oneuptime.com/otlp`                        |
| 認証ヘッダー        | `x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN` |
| サービス名          | サービスが表示される名前。例: `my-service`          |

> **OneUptime をセルフホストしていますか？** `https://oneuptime.com/otlp` を `https://YOUR-ONEUPTIME-HOST/otlp` に置き換えてください（TLS を終端していない場合は `http://...`）。それ以外はすべて同じままです。

シンクは OTLP の **HTTP/protobuf** プロトコルを使用し、エンドポイントに `/v1/logs` パスを自動的に付加します。そのため、最終的にポストする URL は `https://oneuptime.com/otlp/v1/logs` となります。指定する必要があるのはベースの `/otlp` エンドポイントだけです。

## ステップ 1 — NuGet パッケージをインストールする

Serilog と OpenTelemetry シンクをプロジェクトに追加します。

```bash
dotnet add package Serilog
dotnet add package Serilog.Sinks.OpenTelemetry
```

シンクを `appsettings.json` から設定する場合（後述）は、次も追加します。

```bash
dotnet add package Serilog.Settings.Configuration
```

ASP.NET Core アプリの場合、`Serilog.AspNetCore` パッケージは Serilog をホストおよびリクエストパイプラインに組み込みます。

```bash
dotnet add package Serilog.AspNetCore
```

## ステップ 2 — コードでシンクを設定する

最も直接的な方法は、アプリケーション起動時に Serilog を設定することです。シンクを OneUptime の OTLP エンドポイントに向け、プロトコルを `HttpProtobuf` に設定し、取り込みトークンをヘッダーとして渡し、`service.name` でログにタグを付けます。

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

> **重要:** シンクはログイベントをバッチ処理し、非同期で送信します。アプリケーションが終了する前に必ず `Log.CloseAndFlush()` を呼び出す（またはロガーを破棄する）ようにしてください。そうしないと、最後のログのバッチが失われる可能性があります。ASP.NET Core では、`Serilog.AspNetCore` がグレースフルシャットダウン時にこれを自動的に処理します。

## ステップ 3 — appsettings.json から設定する（代替方法）

コードよりも設定ファイルを好む場合は、`Serilog.Settings.Configuration` を使用し、シンクの設定を `appsettings.json` に記述します。

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

次に、設定からロガーをビルドします。

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

> トークンはソース管理の外に保管してください。`appsettings.json` にコミットするのではなく、環境変数やシークレットストアから参照し、起動時に設定へ注入するようにしてください。

## ASP.NET Core との統合

ASP.NET Core（.NET 6 以降の最小ホスティング）の場合は、`Serilog.AspNetCore` を使用して Serilog がデフォルトのロガーを置き換え、フレームワークとリクエストのログも併せてキャプチャするようにします。

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

## ログの書き込み

設定が完了したら、通常どおり Serilog を使用します。構造化されたプロパティは保持され、OneUptime で検索可能な属性になります。

```csharp
Log.Information("Order {OrderId} placed by {CustomerId} for {Amount:C}",
    orderId, customerId, amount);

Log.Warning("Payment gateway slow: {LatencyMs}ms", latencyMs);
```

名前付きの各プロパティ（`OrderId`、`CustomerId`、`Amount`、`LatencyMs`）はログ属性として送信されるため、**Telemetry → Logs** エクスプローラーでそれらをフィルタリングおよび検索できます。

## 例外

Serilog で例外をログに記録すると、シンクは OpenTelemetry の `exception.type`、`exception.message`、`exception.stacktrace` 属性をログレコードに付加します。

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

OneUptime はこれらの属性を検出し、エラーを **Exceptions**（Issues）ビューに自動的にまとめます。フィンガープリントごとにグループ化され、適切なサービスに紐付けられます。トレースとログの両方から報告されたエラーは、単一の Issue にまとめられます。検出の仕組みの詳細については、[ログからの例外](/docs/telemetry/open-telemetry)を参照してください。

## トレースの相関

アプリケーションがトレース用に OpenTelemetry .NET SDK でも計装されている場合、アクティブなスパン内で発行された Serilog ログイベントには、現在の `TraceId` と `SpanId` が自動的に刻印されます（これはシンクのデフォルトの `IncludedData` の一部です）。これにより、OneUptime はログ行を、それが発生したトレースに直接リンクできるため、ログから周囲のリクエストへ、そしてその逆へとジャンプできます。

## 検証

1. アプリケーションを実行し、いくつかのログイベントを生成します。
2. OneUptime を開き、**Telemetry** に移動して、サービス（`my-service`）を選択し、**Logs** を開きます。
3. 数秒以内に Serilog のイベントが表示され、その構造化プロパティがフィルターとして利用できるはずです。

## トラブルシューティング

- **ログが表示されない** – `x-oneuptime-token` の値を再確認し、表示しているプロジェクトに属していることを確認してください。エンドポイントが `https://oneuptime.com/otlp` であることを確認してください（ベースパスのみ。自分で `/v1/logs` を付加しないでください）。
- **アプリ終了時にのみログが表示される、または最後のログが欠落する** – シャットダウン時に `Log.CloseAndFlush()` が実行されることを確認してください。シンクはイベントをバッチ処理するため、フラッシュせずにプロセスが終了されると、バッファされたログは失われます。
- **`401 Unauthorized` / 何も取り込まれない** – トークンが欠落しているか無効です。ヘッダーキーが正確に `x-oneuptime-token` であることを確認してください。
- **サービス名が誤っている** – `ResourceAttributes`（コード）または `resourceAttributes`（appsettings.json）に `service.name` を設定してください。設定しないと、ログはデフォルト/不明なサービスにフォールバックします。
- **セルフホストインスタンスへの接続エラー** – プロトコルがエンドポイントのスキーム（`https://` か `http://` か）と一致していること、およびアプリケーションから OneUptime ホストに到達可能であることを確認してください。

ご質問やサポートが必要な場合は、support@oneuptime.com までお問い合わせください。
