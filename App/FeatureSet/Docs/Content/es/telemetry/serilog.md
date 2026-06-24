# Enviar registros de Serilog a OneUptime

## Descripción general

[Serilog](https://serilog.net) es la biblioteca de registro estructurado más popular para .NET. OneUptime ingiere los registros de Serilog a través del OpenTelemetry Protocol (OTLP) mediante el sink oficial [`Serilog.Sinks.OpenTelemetry`](https://github.com/serilog/serilog-sinks-opentelemetry). Una vez configurado, cada evento de registro que tu aplicación escribe a través de Serilog se envía a OneUptime, donde se puede buscar en **Telemetry → Logs**, junto con sus propiedades estructuradas, gravedad y correlación de traza/span.

No hay ningún paquete específico de OneUptime que instalar: el sink se comunica con el mismo endpoint OTLP que OneUptime expone para todos los datos de OpenTelemetry. Esto funciona para aplicaciones de consola, servicios de worker, aplicaciones ASP.NET Core y cualquier otra cosa que se ejecute en .NET.

## Requisitos previos

- **Regístrate para obtener una cuenta de OneUptime** – Puedes registrarte para obtener una cuenta gratuita [aquí](https://oneuptime.com). Ten en cuenta que, si bien la cuenta es gratuita, la ingesta de registros es una función de pago. Puedes encontrar más detalles sobre los precios [aquí](https://oneuptime.com/pricing).
- **Crea un proyecto de OneUptime** – Una vez que tengas una cuenta, crea un proyecto desde el panel de OneUptime. Si necesitas ayuda, contáctanos en support@oneuptime.com.
- **Crea un token de ingesta de telemetría** – Necesitas un token para autenticar tus registros.

Después de registrarte en OneUptime y crear un proyecto, haz clic en "More" en la barra de navegación y luego en "Project Settings".

En la página Telemetry Ingestion Key, haz clic en "Create Ingestion Key" para crear un token.

![Create Service](/docs/static/images/TelemetryIngestionKeys.png)

Una vez que hayas creado un token, haz clic en "View" para ver el token.

![View Service](/docs/static/images/TelemetryIngestionKeyView.png)

## Lo que necesitas de OneUptime

| Configuración               | Valor                                                               |
| --------------------------- | ------------------------------------------------------------------- |
| Endpoint OTLP               | `https://oneuptime.com/otlp`                                        |
| Encabezado de autenticación | `x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN`                 |
| Nombre del servicio         | El nombre con el que debe aparecer tu servicio, p. ej. `my-service` |

> **¿Alojas OneUptime por tu cuenta?** Reemplaza `https://oneuptime.com/otlp` por `https://YOUR-ONEUPTIME-HOST/otlp` (o `http://...` si no estás terminando TLS). Todo lo demás permanece igual.

El sink utiliza el protocolo OTLP **HTTP/protobuf** y agrega automáticamente la ruta `/v1/logs` al endpoint, por lo que la URL final a la que realiza el POST es `https://oneuptime.com/otlp/v1/logs`. Solo necesitas proporcionar el endpoint base `/otlp`.

## Paso 1 — Instala los paquetes NuGet

Agrega Serilog y el sink de OpenTelemetry a tu proyecto:

```bash
dotnet add package Serilog
dotnet add package Serilog.Sinks.OpenTelemetry
```

Si vas a configurar el sink desde `appsettings.json` (ver más abajo), agrega también:

```bash
dotnet add package Serilog.Settings.Configuration
```

Para aplicaciones ASP.NET Core, el paquete `Serilog.AspNetCore` integra Serilog en el host y en el pipeline de solicitudes:

```bash
dotnet add package Serilog.AspNetCore
```

## Paso 2 — Configura el sink en código

La forma más directa es configurar Serilog al iniciar la aplicación. Apunta el sink a tu endpoint OTLP de OneUptime, establece el protocolo en `HttpProtobuf`, pasa tu token de ingesta como encabezado y etiqueta los registros con un `service.name`.

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

> **Importante:** El sink agrupa los eventos de registro en lotes y los envía de forma asíncrona. Llama siempre a `Log.CloseAndFlush()` (o libera el logger) antes de que tu aplicación finalice; de lo contrario, el último lote de registros podría perderse. En ASP.NET Core, `Serilog.AspNetCore` se encarga de esto por ti durante un apagado controlado.

## Paso 3 — Configura desde appsettings.json (alternativa)

Si prefieres la configuración antes que el código, usa `Serilog.Settings.Configuration` y coloca los ajustes del sink en `appsettings.json`:

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

Luego construye el logger a partir de la configuración:

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

> Mantén el token fuera del control de versiones. Referéncialo desde una variable de entorno o un almacén de secretos e inyéctalo en la configuración al iniciar, en lugar de incluirlo en `appsettings.json`.

## Integración con ASP.NET Core

Para ASP.NET Core (hosting mínimo de .NET 6+), usa `Serilog.AspNetCore` para que Serilog reemplace el logger predeterminado y capture también los registros del framework y de las solicitudes:

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

## Escritura de registros

Una vez configurado, usa Serilog como lo harías normalmente. Las propiedades estructuradas se conservan y se convierten en atributos sobre los que se puede buscar en OneUptime:

```csharp
Log.Information("Order {OrderId} placed by {CustomerId} for {Amount:C}",
    orderId, customerId, amount);

Log.Warning("Payment gateway slow: {LatencyMs}ms", latencyMs);
```

Cada propiedad con nombre (`OrderId`, `CustomerId`, `Amount`, `LatencyMs`) se envía como un atributo de registro, de modo que puedes filtrarlas y buscarlas en el explorador **Telemetry → Logs**.

## Excepciones

Cuando registras una excepción con Serilog, el sink adjunta al registro los atributos de OpenTelemetry `exception.type`, `exception.message` y `exception.stacktrace`:

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

OneUptime detecta estos atributos y agrupa automáticamente el error en la vista de **Exceptions** (Issues), agrupado por huella digital y atribuido al servicio correcto. Un error reportado tanto por una traza como por un registro se colapsa en un único problema. Consulta [Excepciones desde registros](/docs/telemetry/open-telemetry) para obtener detalles sobre cómo funciona la detección.

## Correlación de trazas

Si tu aplicación también está instrumentada con el SDK de OpenTelemetry para .NET para trazas, los eventos de registro de Serilog emitidos dentro de un span activo se marcan automáticamente con el `TraceId` y el `SpanId` actuales (esto forma parte del `IncludedData` predeterminado del sink). Eso permite que OneUptime vincule una línea de registro directamente con la traza en la que ocurrió, de modo que puedas saltar de un registro a la solicitud circundante y viceversa.

## Verificación

1. Ejecuta tu aplicación y genera algunos eventos de registro.
2. Abre OneUptime, ve a **Telemetry**, selecciona tu servicio (`my-service`) y abre **Logs**.
3. Deberías ver tus eventos de Serilog aparecer en unos segundos, con sus propiedades estructuradas disponibles como filtros.

## Solución de problemas

- **No aparece ningún registro** – Verifica nuevamente el valor de `x-oneuptime-token` y confirma que pertenece al proyecto que estás visualizando. Comprueba que el endpoint sea `https://oneuptime.com/otlp` (solo la ruta base; no agregues `/v1/logs` tú mismo).
- **Los registros solo aparecen cuando la aplicación finaliza, o faltan los últimos registros** – Asegúrate de que `Log.CloseAndFlush()` se ejecute durante el apagado. El sink agrupa los eventos en lotes, por lo que los registros almacenados en búfer se pierden si el proceso se detiene sin vaciarlos.
- **`401 Unauthorized` / nada se ingiere** – El token falta o no es válido. Confirma que la clave del encabezado sea exactamente `x-oneuptime-token`.
- **Nombre de servicio incorrecto** – Establece `service.name` en `ResourceAttributes` (código) o `resourceAttributes` (appsettings.json). Sin él, los registros recurren a un servicio predeterminado/desconocido.
- **Errores de conexión a una instancia autoalojada** – Asegúrate de que el protocolo coincida con el esquema de tu endpoint (`https://` frente a `http://`) y de que tu host de OneUptime sea accesible desde la aplicación.

Si tienes alguna pregunta o necesitas ayuda, contáctanos en support@oneuptime.com.
