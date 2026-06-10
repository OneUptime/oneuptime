# Serilog-Logs an OneUptime senden

## Überblick

[Serilog](https://serilog.net) ist die beliebteste Bibliothek für strukturiertes Logging in .NET. OneUptime nimmt Serilog-Logs über das OpenTelemetry Protocol (OTLP) entgegen und verwendet dafür den offiziellen [`Serilog.Sinks.OpenTelemetry`](https://github.com/serilog/serilog-sinks-opentelemetry)-Sink. Sobald die Konfiguration abgeschlossen ist, wird jedes Log-Ereignis, das Ihre Anwendung über Serilog schreibt, an OneUptime übermittelt und dort unter **Telemetry → Logs** durchsuchbar – inklusive strukturierter Eigenschaften, Schweregrad und Trace-/Span-Korrelation.

Es gibt kein OneUptime-spezifisches Paket zu installieren – der Sink kommuniziert mit demselben OTLP-Endpunkt, den OneUptime für alle OpenTelemetry-Daten bereitstellt. Das funktioniert für Konsolenanwendungen, Worker-Dienste, ASP.NET Core-Anwendungen und alles andere, was auf .NET läuft.

## Voraussetzungen

- **Registrieren Sie sich für ein OneUptime-Konto** – Ein kostenloses Konto können Sie [hier](https://oneuptime.com) anlegen. Bitte beachten Sie, dass das Konto zwar kostenlos ist, die Log-Erfassung jedoch eine kostenpflichtige Funktion darstellt. Weitere Details zur Preisgestaltung finden Sie [hier](https://oneuptime.com/pricing).
- **Erstellen Sie ein OneUptime-Projekt** – Sobald Sie ein Konto haben, erstellen Sie ein Projekt über das OneUptime-Dashboard. Wenn Sie Hilfe benötigen, kontaktieren Sie uns unter support@oneuptime.com.
- **Erstellen Sie ein Telemetry-Ingestion-Token** – Sie benötigen ein Token, um Ihre Logs zu authentifizieren.

Nachdem Sie sich bei OneUptime registriert und ein Projekt erstellt haben, klicken Sie in der Navigationsleiste auf "More" und anschließend auf "Project Settings".

Klicken Sie auf der Seite "Telemetry Ingestion Key" auf "Create Ingestion Key", um ein Token zu erstellen.

![Create Service](/docs/static/images/TelemetryIngestionKeys.png)

Sobald Sie ein Token erstellt haben, klicken Sie auf "View", um das Token anzuzeigen.

![View Service](/docs/static/images/TelemetryIngestionKeyView.png)

## Was Sie von OneUptime benötigen

| Einstellung | Wert |
| --- | --- |
| OTLP-Endpunkt | `https://oneuptime.com/otlp` |
| Auth-Header | `x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN` |
| Dienstname | Der Name, unter dem Ihr Dienst erscheinen soll, z. B. `my-service` |

> **Sie hosten OneUptime selbst?** Ersetzen Sie `https://oneuptime.com/otlp` durch `https://YOUR-ONEUPTIME-HOST/otlp` (oder `http://...`, falls Sie TLS nicht terminieren). Alles andere bleibt gleich.

Der Sink verwendet das OTLP-Protokoll **HTTP/protobuf** und hängt automatisch den Pfad `/v1/logs` an den Endpunkt an, sodass die endgültige URL, an die er postet, `https://oneuptime.com/otlp/v1/logs` lautet. Sie müssen lediglich den Basis-Endpunkt `/otlp` angeben.

## Schritt 1 — Installieren Sie die NuGet-Pakete

Fügen Sie Serilog und den OpenTelemetry-Sink zu Ihrem Projekt hinzu:

```bash
dotnet add package Serilog
dotnet add package Serilog.Sinks.OpenTelemetry
```

Wenn Sie den Sink über `appsettings.json` konfigurieren (siehe unten), fügen Sie außerdem hinzu:

```bash
dotnet add package Serilog.Settings.Configuration
```

Für ASP.NET Core-Anwendungen bindet das Paket `Serilog.AspNetCore` Serilog in den Host und die Request-Pipeline ein:

```bash
dotnet add package Serilog.AspNetCore
```

## Schritt 2 — Konfigurieren Sie den Sink im Code

Am direktesten ist es, Serilog beim Anwendungsstart zu konfigurieren. Richten Sie den Sink auf Ihren OneUptime-OTLP-Endpunkt aus, setzen Sie das Protokoll auf `HttpProtobuf`, übergeben Sie Ihr Ingestion-Token als Header und versehen Sie die Logs mit einem `service.name`.

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

> **Wichtig:** Der Sink fasst Log-Ereignisse zu Batches zusammen und sendet sie asynchron. Rufen Sie immer `Log.CloseAndFlush()` auf (oder verwerfen Sie den Logger), bevor Ihre Anwendung beendet wird, andernfalls kann der letzte Batch an Logs verloren gehen. In ASP.NET Core übernimmt `Serilog.AspNetCore` dies bei einem ordnungsgemäßen Herunterfahren für Sie.

## Schritt 3 — Konfiguration über appsettings.json (Alternative)

Wenn Sie Konfiguration gegenüber Code bevorzugen, verwenden Sie `Serilog.Settings.Configuration` und legen Sie die Sink-Einstellungen in `appsettings.json` ab:

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

Erstellen Sie anschließend den Logger aus der Konfiguration:

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

> Halten Sie das Token aus der Versionsverwaltung heraus. Referenzieren Sie es über eine Umgebungsvariable oder einen Secrets-Store und injizieren Sie es beim Start in die Konfiguration, anstatt es in `appsettings.json` einzuchecken.

## ASP.NET Core-Integration

Für ASP.NET Core (.NET 6+ Minimal Hosting) verwenden Sie `Serilog.AspNetCore`, damit Serilog den Standard-Logger ersetzt und auch Framework- und Request-Logs erfasst:

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

## Logs schreiben

Sobald die Konfiguration abgeschlossen ist, verwenden Sie Serilog wie gewohnt. Strukturierte Eigenschaften bleiben erhalten und werden in OneUptime zu durchsuchbaren Attributen:

```csharp
Log.Information("Order {OrderId} placed by {CustomerId} for {Amount:C}",
    orderId, customerId, amount);

Log.Warning("Payment gateway slow: {LatencyMs}ms", latencyMs);
```

Jede benannte Eigenschaft (`OrderId`, `CustomerId`, `Amount`, `LatencyMs`) wird als Log-Attribut gesendet, sodass Sie im Explorer unter **Telemetry → Logs** danach filtern und suchen können.

## Ausnahmen (Exceptions)

Wenn Sie eine Ausnahme mit Serilog protokollieren, hängt der Sink die OpenTelemetry-Attribute `exception.type`, `exception.message` und `exception.stacktrace` an den Log-Datensatz an:

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

OneUptime erkennt diese Attribute und überträgt den Fehler automatisch in die Ansicht **Exceptions** (Issues), gruppiert nach Fingerprint und dem richtigen Dienst zugeordnet. Ein Fehler, der sowohl von einem Trace als auch von einem Log gemeldet wird, wird zu einem einzigen Issue zusammengeführt. Details dazu, wie die Erkennung funktioniert, finden Sie unter [Exceptions from logs](/docs/telemetry/open-telemetry).

## Trace-Korrelation

Wenn Ihre Anwendung zusätzlich mit dem OpenTelemetry .NET SDK für Traces instrumentiert ist, werden Serilog-Log-Ereignisse, die innerhalb eines aktiven Spans ausgegeben werden, automatisch mit der aktuellen `TraceId` und `SpanId` versehen (dies ist Teil der Standard-`IncludedData` des Sinks). Dadurch kann OneUptime eine Log-Zeile direkt mit dem Trace verknüpfen, in dem sie aufgetreten ist, sodass Sie von einem Log zum umgebenden Request und wieder zurück springen können.

## Überprüfen

1. Führen Sie Ihre Anwendung aus und erzeugen Sie einige Log-Ereignisse.
2. Öffnen Sie OneUptime, gehen Sie zu **Telemetry**, wählen Sie Ihren Dienst aus (`my-service`) und öffnen Sie **Logs**.
3. Ihre Serilog-Ereignisse sollten innerhalb weniger Sekunden erscheinen, wobei ihre strukturierten Eigenschaften als Filter verfügbar sind.

## Fehlerbehebung

- **Es erscheinen keine Logs** – Überprüfen Sie den Wert von `x-oneuptime-token` genau und stellen Sie sicher, dass er zu dem Projekt gehört, das Sie gerade ansehen. Vergewissern Sie sich, dass der Endpunkt `https://oneuptime.com/otlp` lautet (nur der Basispfad – hängen Sie nicht selbst `/v1/logs` an).
- **Logs erscheinen erst beim Beenden der Anwendung oder die letzten Logs fehlen** – Stellen Sie sicher, dass `Log.CloseAndFlush()` beim Herunterfahren ausgeführt wird. Der Sink fasst Ereignisse zu Batches zusammen, sodass gepufferte Logs verloren gehen, wenn der Prozess ohne vorheriges Flushen beendet wird.
- **`401 Unauthorized` / nichts wird erfasst** – Das Token fehlt oder ist ungültig. Stellen Sie sicher, dass der Header-Schlüssel exakt `x-oneuptime-token` lautet.
- **Falscher Dienstname** – Legen Sie `service.name` in `ResourceAttributes` (Code) bzw. `resourceAttributes` (appsettings.json) fest. Ohne diese Angabe fallen Logs auf einen Standard-/unbekannten Dienst zurück.
- **Verbindungsfehler zu einer selbst gehosteten Instanz** – Stellen Sie sicher, dass das Protokoll zum Schema Ihres Endpunkts passt (`https://` vs. `http://`) und dass Ihr OneUptime-Host von der Anwendung aus erreichbar ist.

Wenn Sie Fragen haben oder Hilfe benötigen, kontaktieren Sie uns bitte unter support@oneuptime.com.
