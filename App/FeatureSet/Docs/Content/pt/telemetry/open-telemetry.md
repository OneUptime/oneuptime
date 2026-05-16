# Integrar o OpenTelemetry (logs, métricas e rastreamentos) com o OneUptime.

### Passo 1 - Criar Token de Ingestão de Telemetria.

Depois de criar uma conta do OneUptime, você pode criar um token de ingestão de telemetria para ingerir logs, métricas e rastreamentos do seu aplicativo.

Depois de se registrar no OneUptime e criar um projeto. Clique em "More" na barra de navegação e clique em "Project Settings".

Na página de Chaves de Ingestão de Telemetria, clique em "Create Ingestion Key" para criar um token.

![Create Service](/docs/static/images/TelemetryIngestionKeys.png)

Depois de criar um token, clique em "View" para visualizá-lo.

![View Service](/docs/static/images/TelemetryIngestionKeyView.png)


### Passo 2

#### Configurar o serviço de telemetria no seu aplicativo.

#### Logs de Aplicativo

Usamos o OpenTelemetry para coletar logs de aplicativos. O OneUptime atualmente suporta ingestão de logs desses SDKs do OpenTelemetry. Siga as instruções para configurar o serviço de telemetria no seu aplicativo.

- [C++](https://opentelemetry.io/docs/instrumentation/cpp/)
- [Go](https://opentelemetry.io/docs/instrumentation/go/)
- [Java](https://opentelemetry.io/docs/instrumentation/java/)
- [JavaScript / Typescript / NodeJS / Browser](https://opentelemetry.io/docs/instrumentation/js/)
- [Python](https://opentelemetry.io/docs/instrumentation/python/)
- [Ruby](https://opentelemetry.io/docs/instrumentation/ruby/)
- [PHP](https://opentelemetry.io/docs/instrumentation/php/)
- [Erlang](https://opentelemetry.io/docs/instrumentation/erlang/)
- [Rust](https://opentelemetry.io/docs/instrumentation/rust/)
- [.NET / C#](https://opentelemetry.io/docs/instrumentation/net/)
- [Swift](https://opentelemetry.io/docs/instrumentation/swift/)


**Integrar com o OneUptime**

Depois de configurar o serviço de telemetria no seu aplicativo, você pode integrar com o OneUptime definindo as seguintes variáveis de ambiente.

| Variável de Ambiente | Valor |
| --- | --- |
| OTEL_EXPORTER_OTLP_HEADERS | x-oneuptime-token=YOUR_ONEUPTIME_SERVICE_TOKEN |
| OTEL_EXPORTER_OTLP_ENDPOINT | https://oneuptime.com/otlp |
| OTEL_SERVICE_NAME | NAME_OF_YOUR_SERVICE |


**Exemplo**

```bash
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=9c8806e0-a4aa-11ee-be95-010d5967b068
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_SERVICE_NAME=my-service
```


**OneUptime Auto-Hospedado**

Se você estiver auto-hospedando o OneUptime, isso pode ser alterado para o endpoint do coletor OpenTelemetry auto-hospedado (ex.: `http(s)://SEU-HOST-ONEUPTIME/otlp`)

Depois de executar seu aplicativo, você deve ver os logs na página do serviço de telemetria do OneUptime. Entre em contato com support@oneuptime.com se precisar de ajuda.


#### Usando o Coletor OpenTelemetry

Você também pode usar o coletor OpenTelemetry em vez de enviar dados de telemetria diretamente do seu aplicativo.
Se você estiver usando o Coletor OpenTelemetry, pode configurar o exportador do OneUptime no arquivo de configuração do coletor.

Aqui está a configuração de exemplo para o Coletor OpenTelemetry.

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

exporters:

  # Export over HTTP
  otlphttp:
    endpoint: "https://oneuptime.com/otlp"
    # Requires use JSON encoder insted of default Proto(buf)
    encoding: json
    headers:
      "Content-Type": "application/json"
      "x-oneuptime-token": "ONEUPTIME_TOKEN" # Your OneUptime token

service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [otlphttp]
    metrics:
      receivers: [otlp]
      exporters: [otlphttp]
    logs:
      receivers: [otlp]
      exporters: [otlphttp]
```
