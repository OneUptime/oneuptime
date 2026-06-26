# Usar o FluentBit para enviar dados de telemetria para o OneUptime

## Visão Geral

Você pode usar o plugin [FluentBit](https://docs.fluentbit.io/manual) para coletar logs e dados de telemetria dos seus aplicativos e serviços. O plugin envia os dados de telemetria para o Coletor HTTP OpenTelemetry do OneUptime. Você pode usar o plugin de saída opentelemetry do fluentbit para enviar os dados de telemetria para o Coletor HTTP OpenTelemetry do OneUptime. Este plugin pode ser encontrado aqui: https://docs.fluentbit.io/manual/pipeline/outputs/opentelemetry

## Primeiros Passos

O FluentBit suporta centenas de fontes de dados e você pode ingerir logs e telemetria de qualquer uma dessas fontes no OneUptime. Algumas das fontes populares incluem:

- Docker
- Syslog
- Apache
- Nginx
- MySQL
- PostgreSQL
- MongoDB
- NodeJS
- Ruby
- Python
- Java
- PHP
- Go
- Rust

e muitas mais.

Você pode encontrar a lista completa de fontes suportadas [aqui](https://docs.fluentbit.io/manual)

## Pré-requisitos

- **Passo 1: Instalar o FluentBit no seu sistema** - Você pode instalar o FluentBit usando as instruções fornecidas [aqui](https://docs.fluentbit.io/manual/installation/getting-started-with-fluent-bit)
- **Passo 2: Registrar-se para uma conta do OneUptime** - Você pode se registrar para uma conta gratuita [aqui](https://oneuptime.com). Observe que enquanto a conta é gratuita, a ingestão de logs é um recurso pago. Você pode encontrar mais detalhes sobre os preços [aqui](https://oneuptime.com/pricing).
- **Passo 3: Criar Projeto do OneUptime** - Depois de ter a conta, você pode criar um projeto no painel do OneUptime. Se precisar de ajuda para criar um projeto ou tiver alguma dúvida, entre em contato conosco em support@oneuptime.com
- **Passo 4: Criar Token de Ingestão de Telemetria** - Depois de criar uma conta do OneUptime, você pode criar um token de ingestão de telemetria para ingerir logs, métricas e rastreamentos do seu aplicativo.

Depois de se registrar no OneUptime e criar um projeto. Clique em "More" na barra de navegação e clique em "Project Settings".

Na página de Chaves de Ingestão de Telemetria, clique em "Create Ingestion Key" para criar um token.

![Create Service](/docs/static/images/TelemetryIngestionKeys.png)

Depois de criar um token, clique em "View" para visualizá-lo.

![View Service](/docs/static/images/TelemetryIngestionKeyView.png)

## Configuração

Você pode usar a seguinte configuração para enviar os dados de telemetria para o Coletor HTTP OpenTelemetry do OneUptime. Você pode adicionar esta configuração ao arquivo de configuração do fluentbit. O arquivo de configuração geralmente está localizado em `/etc/fluent-bit/fluent-bit.yaml`. Veja como a seção outputs do arquivo de configuração ficaria:

```yaml
outputs:
  - name: stdout
    match: "*"
  - name: opentelemetry
    match: "*"
    host: "oneuptime.com"
    port: 443
    metrics_uri: "/otlp/v1/metrics"
    logs_uri: "/otlp/v1/logs"
    traces_uri: "/otlp/v1/traces"
    tls: On
    header:
      - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
```

Certifique-se de ter opentelemetry_envelope na sua seção de input. Veja um exemplo de como a seção de input ficaria:

```yaml
pipeline:
  inputs:
    # Suas entradas

    processors:
      logs:
        - name: opentelemetry_envelope

        - name: content_modifier
          context: otel_resource_attributes
          action: upsert
          key: service.name
          # Por favor, substitua YOUR_SERVICE_NAME pelo nome do seu serviço
          value: YOUR_SERVICE_NAME
```

Aqui está o exemplo do arquivo de configuração completo:

```yaml
service:
  flush: 1
  log_level: info

pipeline:
  inputs:
    - name: http
      listen: 0.0.0.0
      port: 8888

      processors:
        logs:
          - name: opentelemetry_envelope

          - name: content_modifier
            context: otel_resource_attributes
            action: upsert
            key: service.name
            value: YOUR_SERVICE_NAME

  outputs:
    - name: stdout
      match: "*"
    - name: opentelemetry
      match: "*"
      host: "oneuptime.com"
      port: 443
      metrics_uri: "/otlp/v1/metrics"
      logs_uri: "/otlp/v1/logs"
      traces_uri: "/otlp/v1/traces"
      tls: On
      header:
        - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
```

**Se você estiver auto-hospedando o OneUptime**: Se você estiver auto-hospedando o OneUptime, pode substituir o `host` pelo host da sua instância do OneUptime. Se você estiver hospedando em um servidor http e não https, pode substituir a `port` pela porta da sua instância do OneUptime (provavelmente porta 80).

Neste caso, a configuração ficaria assim:

```yaml
outputs:
  - name: stdout
    match: "*"
  - name: opentelemetry
    match: "*"
    host: "sua-instancia-oneuptime.com"
    port: 80
    metrics_uri: "/otlp/v1/metrics"
    logs_uri: "/otlp/v1/logs"
    traces_uri: "/otlp/v1/traces"
    header:
      - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
```

## Uso

Depois de adicionar a configuração ao arquivo de configuração do fluentbit, você pode reiniciar o serviço fluentbit. Depois que o serviço for reiniciado, os dados de telemetria serão enviados para a Fonte HTTP do OneUptime. Agora você pode começar a ver os dados de telemetria no painel do OneUptime. Se tiver alguma dúvida ou precisar de ajuda com a configuração, entre em contato conosco em support@oneuptime.com
