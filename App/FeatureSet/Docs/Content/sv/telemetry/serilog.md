# Skicka Serilog-loggar till OneUptime

## Översikt

[Serilog](https://serilog.net) är det mest populära biblioteket för strukturerad loggning för .NET. OneUptime tar emot Serilog-loggar över OpenTelemetry Protocol (OTLP) med hjälp av den officiella sinken [`Serilog.Sinks.OpenTelemetry`](https://github.com/serilog/serilog-sinks-opentelemetry). När den väl är konfigurerad skickas varje logghändelse som din applikation skriver via Serilog till OneUptime, där den blir sökbar i **Telemetry → Logs**, komplett med strukturerade egenskaper, allvarlighetsgrad och trace-/span-korrelation.

Det finns inget OneUptime-specifikt paket att installera — sinken kommunicerar med samma OTLP-slutpunkt som OneUptime exponerar för all OpenTelemetry-data. Detta fungerar för konsolappar, worker-tjänster, ASP.NET Core-appar och allt annat som körs på .NET.

## Förutsättningar

- **Registrera ett OneUptime-konto** – Du kan registrera ett gratiskonto [här](https://oneuptime.com). Observera att även om kontot är gratis är logginmatning en betald funktion. Du hittar mer information om prissättningen [här](https://oneuptime.com/pricing).
- **Skapa ett OneUptime-projekt** – När du har ett konto skapar du ett projekt från OneUptime-instrumentpanelen. Om du behöver hjälp, kontakta oss på support@oneuptime.com.
- **Skapa en Telemetry Ingestion Token** – Du behöver en token för att autentisera dina loggar.

När du har registrerat dig på OneUptime och skapat ett projekt klickar du på "More" i navigeringsfältet och klickar på "Project Settings".

På sidan Telemetry Ingestion Key klickar du på "Create Ingestion Key" för att skapa en token.

![Create Service](/docs/static/images/TelemetryIngestionKeys.png)

När du har skapat en token klickar du på "View" för att visa den.

![View Service](/docs/static/images/TelemetryIngestionKeyView.png)

## Vad du behöver från OneUptime

| Inställning    | Värde                                                     |
| -------------- | --------------------------------------------------------- |
| OTLP-slutpunkt | `https://oneuptime.com/otlp`                              |
| Auth-header    | `x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN`       |
| Tjänstnamn     | Namnet som din tjänst ska visas under, t.ex. `my-service` |

> **Kör du självhostad OneUptime?** Ersätt `https://oneuptime.com/otlp` med `https://YOUR-ONEUPTIME-HOST/otlp` (eller `http://...` om du inte avslutar TLS). Allt annat förblir detsamma.

Sinken använder OTLP-protokollet **HTTP/protobuf** och lägger automatiskt till sökvägen `/v1/logs` till slutpunkten, så den slutliga URL:en den postar till är `https://oneuptime.com/otlp/v1/logs`. Du behöver bara ange bas-slutpunkten `/otlp`.

## Steg 1 — Installera NuGet-paketen

Lägg till Serilog och OpenTelemetry-sinken i ditt projekt:

```bash
dotnet add package Serilog
dotnet add package Serilog.Sinks.OpenTelemetry
```

Om du konfigurerar sinken från `appsettings.json` (se nedan), lägg även till:

```bash
dotnet add package Serilog.Settings.Configuration
```

För ASP.NET Core-appar kopplar paketet `Serilog.AspNetCore` in Serilog i hosten och request-pipelinen:

```bash
dotnet add package Serilog.AspNetCore
```

## Steg 2 — Konfigurera sinken i kod

Det mest direkta sättet är att konfigurera Serilog vid applikationsstart. Peka sinken mot din OneUptime OTLP-slutpunkt, ställ in protokollet till `HttpProtobuf`, skicka din ingestion-token som en header och tagga loggarna med ett `service.name`.

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

> **Viktigt:** Sinken samlar logghändelser i batchar och skickar dem asynkront. Anropa alltid `Log.CloseAndFlush()` (eller frigör loggern) innan din applikation avslutas, annars kan den sista batchen med loggar gå förlorad. I ASP.NET Core hanterar `Serilog.AspNetCore` detta åt dig vid en kontrollerad nedstängning.

## Steg 3 — Konfigurera från appsettings.json (alternativ)

Om du föredrar konfiguration framför kod, använd `Serilog.Settings.Configuration` och lägg sink-inställningarna i `appsettings.json`:

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

Bygg sedan loggern från konfigurationen:

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

> Håll token utanför källkontrollen. Referera till den från en miljövariabel eller ett secrets-lager och injicera den i konfigurationen vid start istället för att checka in den i `appsettings.json`.

## ASP.NET Core-integration

För ASP.NET Core (.NET 6+ minimal hosting), använd `Serilog.AspNetCore` så att Serilog ersätter standardloggern och även fångar framework- och request-loggar:

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

## Skriva loggar

När konfigurationen är klar använder du Serilog som du normalt skulle göra. Strukturerade egenskaper bevaras och blir sökbara attribut i OneUptime:

```csharp
Log.Information("Order {OrderId} placed by {CustomerId} for {Amount:C}",
    orderId, customerId, amount);

Log.Warning("Payment gateway slow: {LatencyMs}ms", latencyMs);
```

Varje namngiven egenskap (`OrderId`, `CustomerId`, `Amount`, `LatencyMs`) skickas som ett loggattribut, så att du kan filtrera och söka på dem i utforskaren **Telemetry → Logs**.

## Undantag

När du loggar ett undantag med Serilog bifogar sinken OpenTelemetry-attributen `exception.type`, `exception.message` och `exception.stacktrace` till loggposten:

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

OneUptime upptäcker dessa attribut och samlar automatiskt felet i vyn **Exceptions** (Issues), grupperat efter fingeravtryck och tillskrivet rätt tjänst. Ett fel som rapporteras av både en trace och en logg slås samman till ett enda ärende. Se [Undantag från loggar](/docs/telemetry/open-telemetry) för information om hur upptäckten fungerar.

## Trace-korrelation

Om din applikation även är instrumenterad med OpenTelemetry .NET SDK för traces, märks Serilog-logghändelser som genereras inuti ett aktivt span automatiskt med det aktuella `TraceId` och `SpanId` (detta är en del av sinkens standard-`IncludedData`). Det låter OneUptime länka en loggrad direkt till den trace den inträffade i, så att du kan hoppa från en logg till den omgivande requesten och tillbaka.

## Verifiera

1. Kör din applikation och generera några logghändelser.
2. Öppna OneUptime, gå till **Telemetry**, välj din tjänst (`my-service`) och öppna **Logs**.
3. Du bör se dina Serilog-händelser dyka upp inom några sekunder, med sina strukturerade egenskaper tillgängliga som filter.

## Felsökning

- **Inga loggar visas** – Dubbelkolla värdet på `x-oneuptime-token` och bekräfta att det tillhör projektet du tittar på. Verifiera att slutpunkten är `https://oneuptime.com/otlp` (endast bas-sökvägen — lägg inte till `/v1/logs` själv).
- **Loggar visas bara när appen avslutas, eller de sista loggarna saknas** – Säkerställ att `Log.CloseAndFlush()` körs vid nedstängning. Sinken samlar händelser i batchar, så buffrade loggar går förlorade om processen avslutas utan att tömmas.
- **`401 Unauthorized` / inget tas emot** – Token saknas eller är ogiltig. Bekräfta att header-nyckeln är exakt `x-oneuptime-token`.
- **Fel tjänstnamn** – Ange `service.name` i `ResourceAttributes` (kod) eller `resourceAttributes` (appsettings.json). Utan det faller loggarna tillbaka till en standard-/okänd tjänst.
- **Anslutningsfel till en självhostad instans** – Se till att protokollet matchar slutpunktens schema (`https://` vs `http://`) och att din OneUptime-host är nåbar från applikationen.

Om du har några frågor eller behöver hjälp, kontakta oss på support@oneuptime.com.
