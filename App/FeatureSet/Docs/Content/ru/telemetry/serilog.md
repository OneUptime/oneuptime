# Отправка логов Serilog в OneUptime

## Обзор

[Serilog](https://serilog.net) — это самая популярная библиотека структурированного логирования для .NET. OneUptime принимает логи Serilog по протоколу OpenTelemetry Protocol (OTLP) с помощью официального приёмника [`Serilog.Sinks.OpenTelemetry`](https://github.com/serilog/serilog-sinks-opentelemetry). После настройки каждое событие лога, которое ваше приложение записывает через Serilog, отправляется в OneUptime, где становится доступным для поиска в разделе **Telemetry → Logs**, вместе со структурированными свойствами, уровнем серьёзности и корреляцией с трассировками/спанами.

Нет специального пакета OneUptime, который нужно устанавливать, — приёмник обращается к тому же эндпоинту OTLP, который OneUptime предоставляет для всех данных OpenTelemetry. Это работает для консольных приложений, фоновых служб (worker services), приложений ASP.NET Core и всего остального, что работает на .NET.

## Предварительные требования

- **Зарегистрируйте учётную запись OneUptime** – Вы можете зарегистрировать бесплатную учётную запись [здесь](https://oneuptime.com). Обратите внимание, что хотя учётная запись бесплатна, приём логов является платной функцией. Подробнее о ценах можно узнать [здесь](https://oneuptime.com/pricing).
- **Создайте проект OneUptime** – После создания учётной записи создайте проект в панели управления OneUptime. Если вам нужна помощь, свяжитесь с нами по адресу support@oneuptime.com.
- **Создайте токен приёма телеметрии** – Вам нужен токен для аутентификации ваших логов.

После регистрации в OneUptime и создания проекта нажмите «More» в панели навигации, а затем нажмите «Project Settings».

На странице Telemetry Ingestion Key нажмите «Create Ingestion Key», чтобы создать токен.

![Create Service](/docs/static/images/TelemetryIngestionKeys.png)

После создания токена нажмите «View», чтобы просмотреть токен.

![View Service](/docs/static/images/TelemetryIngestionKeyView.png)

## Что вам нужно от OneUptime

| Настройка | Значение |
| --- | --- |
| Эндпоинт OTLP | `https://oneuptime.com/otlp` |
| Заголовок аутентификации | `x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN` |
| Имя сервиса | Имя, под которым должен отображаться ваш сервис, например `my-service` |

> **Используете самостоятельно размещённый OneUptime?** Замените `https://oneuptime.com/otlp` на `https://YOUR-ONEUPTIME-HOST/otlp` (или `http://...`, если вы не используете TLS). Всё остальное остаётся прежним.

Приёмник использует протокол OTLP **HTTP/protobuf** и автоматически добавляет путь `/v1/logs` к эндпоинту, поэтому итоговый URL, на который он отправляет данные, — `https://oneuptime.com/otlp/v1/logs`. Вам нужно указать только базовый эндпоинт `/otlp`.

## Шаг 1 — Установите пакеты NuGet

Добавьте Serilog и приёмник OpenTelemetry в ваш проект:

```bash
dotnet add package Serilog
dotnet add package Serilog.Sinks.OpenTelemetry
```

Если вы настраиваете приёмник из `appsettings.json` (см. ниже), также добавьте:

```bash
dotnet add package Serilog.Settings.Configuration
```

Для приложений ASP.NET Core пакет `Serilog.AspNetCore` интегрирует Serilog в хост и конвейер обработки запросов:

```bash
dotnet add package Serilog.AspNetCore
```

## Шаг 2 — Настройте приёмник в коде

Самый прямой способ — настроить Serilog при запуске приложения. Укажите приёмнику ваш эндпоинт OTLP в OneUptime, установите протокол `HttpProtobuf`, передайте токен приёма в виде заголовка и пометьте логи атрибутом `service.name`.

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

> **Важно:** Приёмник группирует события логов в пакеты и отправляет их асинхронно. Всегда вызывайте `Log.CloseAndFlush()` (или освобождайте логгер) перед завершением приложения, иначе последний пакет логов может быть потерян. В ASP.NET Core пакет `Serilog.AspNetCore` делает это за вас при корректном завершении работы.

## Шаг 3 — Настройка из appsettings.json (альтернатива)

Если вы предпочитаете конфигурацию вместо кода, используйте `Serilog.Settings.Configuration` и поместите настройки приёмника в `appsettings.json`:

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

Затем создайте логгер из конфигурации:

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

> Не храните токен в системе контроля версий. Ссылайтесь на него из переменной окружения или хранилища секретов и внедряйте его в конфигурацию при запуске, а не фиксируйте в `appsettings.json`.

## Интеграция с ASP.NET Core

Для ASP.NET Core (.NET 6+ с минимальным хостингом) используйте `Serilog.AspNetCore`, чтобы Serilog заменил логгер по умолчанию и также захватывал логи фреймворка и запросов:

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

## Запись логов

После настройки используйте Serilog как обычно. Структурированные свойства сохраняются и становятся атрибутами, доступными для поиска в OneUptime:

```csharp
Log.Information("Order {OrderId} placed by {CustomerId} for {Amount:C}",
    orderId, customerId, amount);

Log.Warning("Payment gateway slow: {LatencyMs}ms", latencyMs);
```

Каждое именованное свойство (`OrderId`, `CustomerId`, `Amount`, `LatencyMs`) отправляется как атрибут лога, поэтому вы можете фильтровать и искать по ним в обозревателе **Telemetry → Logs**.

## Исключения

Когда вы логируете исключение с помощью Serilog, приёмник присоединяет к записи лога атрибуты OpenTelemetry `exception.type`, `exception.message` и `exception.stacktrace`:

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

OneUptime обнаруживает эти атрибуты и автоматически добавляет ошибку в представление **Exceptions** (Issues), группируя её по отпечатку и привязывая к нужному сервису. Ошибка, о которой сообщают и трассировка, и лог, объединяется в одну проблему. Подробнее о том, как работает обнаружение, см. в разделе [Исключения из логов](/docs/telemetry/open-telemetry).

## Корреляция с трассировками

Если ваше приложение также инструментировано с помощью OpenTelemetry .NET SDK для трассировок, события логов Serilog, создаваемые внутри активного спана, автоматически помечаются текущими `TraceId` и `SpanId` (это часть `IncludedData` приёмника по умолчанию). Это позволяет OneUptime связывать строку лога непосредственно с трассировкой, в которой она произошла, чтобы вы могли перейти от лога к соответствующему запросу и обратно.

## Проверка

1. Запустите ваше приложение и сгенерируйте несколько событий логов.
2. Откройте OneUptime, перейдите в **Telemetry**, выберите ваш сервис (`my-service`) и откройте **Logs**.
3. Вы должны увидеть события Serilog в течение нескольких секунд, а их структурированные свойства будут доступны в качестве фильтров.

## Устранение неполадок

- **Логи не появляются** – Перепроверьте значение `x-oneuptime-token` и убедитесь, что оно принадлежит проекту, который вы просматриваете. Проверьте, что эндпоинт — `https://oneuptime.com/otlp` (только базовый путь — не добавляйте `/v1/logs` самостоятельно).
- **Логи появляются только при выходе из приложения, или последние логи отсутствуют** – Убедитесь, что `Log.CloseAndFlush()` выполняется при завершении работы. Приёмник группирует события в пакеты, поэтому буферизованные логи теряются, если процесс завершается без сброса буфера.
- **`401 Unauthorized` / ничего не принимается** – Токен отсутствует или недействителен. Убедитесь, что ключ заголовка — это в точности `x-oneuptime-token`.
- **Неправильное имя сервиса** – Установите `service.name` в `ResourceAttributes` (код) или `resourceAttributes` (appsettings.json). Без него логи будут отнесены к сервису по умолчанию/неизвестному сервису.
- **Ошибки подключения к самостоятельно размещённому экземпляру** – Убедитесь, что протокол соответствует схеме вашего эндпоинта (`https://` или `http://`) и что ваш хост OneUptime доступен из приложения.

Если у вас есть вопросы или нужна помощь, пожалуйста, свяжитесь с нами по адресу support@oneuptime.com.
