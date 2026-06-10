# Enviar logs do Serilog para o OneUptime

## Visão geral

O [Serilog](https://serilog.net) é a biblioteca de logging estruturado mais popular para .NET. O OneUptime ingere logs do Serilog por meio do OpenTelemetry Protocol (OTLP) usando o sink oficial [`Serilog.Sinks.OpenTelemetry`](https://github.com/serilog/serilog-sinks-opentelemetry). Uma vez configurado, cada evento de log que sua aplicação escreve por meio do Serilog é enviado ao OneUptime, onde se torna pesquisável em **Telemetry → Logs**, completo com propriedades estruturadas, severidade e correlação de trace/span.

Não há nenhum pacote específico do OneUptime para instalar — o sink se comunica com o mesmo endpoint OTLP que o OneUptime expõe para todos os dados do OpenTelemetry. Isso funciona para aplicações de console, worker services, aplicações ASP.NET Core e qualquer outra coisa que rode em .NET.

## Pré-requisitos

- **Cadastre-se para uma conta OneUptime** – Você pode se cadastrar para uma conta gratuita [aqui](https://oneuptime.com). Observe que, embora a conta seja gratuita, a ingestão de logs é um recurso pago. Você pode encontrar mais detalhes sobre os preços [aqui](https://oneuptime.com/pricing).
- **Crie um Projeto OneUptime** – Uma vez que você tenha uma conta, crie um projeto a partir do dashboard do OneUptime. Se precisar de ajuda, entre em contato conosco em support@oneuptime.com.
- **Crie um Token de Ingestão de Telemetria** – Você precisa de um token para autenticar seus logs.

Depois de se cadastrar no OneUptime e criar um projeto, clique em "More" na barra de navegação e clique em "Project Settings".

Na página Telemetry Ingestion Key, clique em "Create Ingestion Key" para criar um token.

![Create Service](/docs/static/images/TelemetryIngestionKeys.png)

Uma vez que você tenha criado um token, clique em "View" para visualizar o token.

![View Service](/docs/static/images/TelemetryIngestionKeyView.png)

## O que você precisa do OneUptime

| Configuração | Valor |
| --- | --- |
| Endpoint OTLP | `https://oneuptime.com/otlp` |
| Cabeçalho de autenticação | `x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN` |
| Nome do serviço | O nome sob o qual seu serviço deve aparecer, por exemplo, `my-service` |

> **Hospedando o OneUptime por conta própria?** Substitua `https://oneuptime.com/otlp` por `https://YOUR-ONEUPTIME-HOST/otlp` (ou `http://...` se você não estiver encerrando TLS). Todo o resto permanece o mesmo.

O sink usa o protocolo OTLP **HTTP/protobuf** e anexa automaticamente o caminho `/v1/logs` ao endpoint, de modo que a URL final para a qual ele envia é `https://oneuptime.com/otlp/v1/logs`. Você só precisa fornecer o endpoint base `/otlp`.

## Passo 1 — Instale os pacotes NuGet

Adicione o Serilog e o sink do OpenTelemetry ao seu projeto:

```bash
dotnet add package Serilog
dotnet add package Serilog.Sinks.OpenTelemetry
```

Se você estiver configurando o sink a partir do `appsettings.json` (veja abaixo), adicione também:

```bash
dotnet add package Serilog.Settings.Configuration
```

Para aplicações ASP.NET Core, o pacote `Serilog.AspNetCore` integra o Serilog ao host e ao pipeline de requisições:

```bash
dotnet add package Serilog.AspNetCore
```

## Passo 2 — Configure o sink no código

A maneira mais direta é configurar o Serilog na inicialização da aplicação. Aponte o sink para o seu endpoint OTLP do OneUptime, defina o protocolo como `HttpProtobuf`, passe seu token de ingestão como um cabeçalho e marque os logs com um `service.name`.

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

> **Importante:** O sink agrupa eventos de log em lotes e os envia de forma assíncrona. Sempre chame `Log.CloseAndFlush()` (ou descarte o logger) antes que sua aplicação encerre, caso contrário o último lote de logs pode ser perdido. No ASP.NET Core, o `Serilog.AspNetCore` cuida disso por você no encerramento gracioso.

## Passo 3 — Configure a partir do appsettings.json (alternativa)

Se você prefere configuração em vez de código, use o `Serilog.Settings.Configuration` e coloque as configurações do sink no `appsettings.json`:

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

Em seguida, construa o logger a partir da configuração:

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

> Mantenha o token fora do controle de versão. Referencie-o a partir de uma variável de ambiente ou de um cofre de segredos e injete-o na configuração na inicialização, em vez de fazer commit dele no `appsettings.json`.

## Integração com ASP.NET Core

Para o ASP.NET Core (.NET 6+ com minimal hosting), use o `Serilog.AspNetCore` para que o Serilog substitua o logger padrão e capture também os logs do framework e das requisições:

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

## Escrevendo logs

Uma vez configurado, use o Serilog como você normalmente faria. As propriedades estruturadas são preservadas e se tornam atributos pesquisáveis no OneUptime:

```csharp
Log.Information("Order {OrderId} placed by {CustomerId} for {Amount:C}",
    orderId, customerId, amount);

Log.Warning("Payment gateway slow: {LatencyMs}ms", latencyMs);
```

Cada propriedade nomeada (`OrderId`, `CustomerId`, `Amount`, `LatencyMs`) é enviada como um atributo de log, então você pode filtrar e pesquisar por elas no explorador **Telemetry → Logs**.

## Exceções

Quando você registra uma exceção com o Serilog, o sink anexa os atributos `exception.type`, `exception.message` e `exception.stacktrace` do OpenTelemetry ao registro de log:

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

O OneUptime detecta esses atributos e agrega o erro à visualização **Exceptions** (Issues) automaticamente, agrupado por fingerprint e atribuído ao serviço correto. Um erro reportado tanto por um trace quanto por um log é consolidado em um único issue. Consulte [Exceções a partir de logs](/docs/telemetry/open-telemetry) para detalhes sobre como a detecção funciona.

## Correlação de traces

Se sua aplicação também estiver instrumentada com o OpenTelemetry .NET SDK para traces, os eventos de log do Serilog emitidos dentro de um span ativo são automaticamente marcados com o `TraceId` e `SpanId` atuais (isso faz parte do `IncludedData` padrão do sink). Isso permite que o OneUptime vincule uma linha de log diretamente ao trace em que ela ocorreu, para que você possa pular de um log para a requisição circundante e voltar.

## Verifique

1. Execute sua aplicação e gere alguns eventos de log.
2. Abra o OneUptime, vá para **Telemetry**, selecione seu serviço (`my-service`) e abra **Logs**.
3. Você deverá seus eventos do Serilog aparecerem em alguns segundos, com suas propriedades estruturadas disponíveis como filtros.

## Solução de problemas

- **Nenhum log aparece** – Verifique novamente o valor de `x-oneuptime-token` e confirme que ele pertence ao projeto que você está visualizando. Verifique se o endpoint é `https://oneuptime.com/otlp` (apenas o caminho base — não anexe `/v1/logs` você mesmo).
- **Os logs aparecem apenas quando a aplicação encerra, ou os últimos logs estão faltando** – Garanta que `Log.CloseAndFlush()` seja executado no encerramento. O sink agrupa eventos em lotes, então os logs em buffer são perdidos se o processo for encerrado sem fazer o flush.
- **`401 Unauthorized` / nada ingerido** – O token está faltando ou é inválido. Confirme que a chave do cabeçalho é exatamente `x-oneuptime-token`.
- **Nome de serviço errado** – Defina `service.name` em `ResourceAttributes` (código) ou `resourceAttributes` (appsettings.json). Sem isso, os logs recorrem a um serviço padrão/desconhecido.
- **Erros de conexão com uma instância auto-hospedada** – Certifique-se de que o protocolo corresponda ao esquema do seu endpoint (`https://` vs `http://`) e que seu host do OneUptime esteja acessível a partir da aplicação.

Se você tiver alguma dúvida ou precisar de ajuda, entre em contato conosco em support@oneuptime.com.
