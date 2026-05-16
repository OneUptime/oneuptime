# Usare FluentBit per inviare dati di telemetria a OneUptime

## Panoramica

È possibile usare il plugin [FluentBit](https://docs.fluentbit.io/manual) per raccogliere log e dati di telemetria dalle proprie applicazioni e servizi. Il plugin invia i dati di telemetria al Collector HTTP OpenTelemetry di OneUptime. È possibile usare il plugin di output opentelemetry di FluentBit per inviare i dati di telemetria al Collector HTTP OpenTelemetry di OneUptime. Questo plugin è disponibile qui: https://docs.fluentbit.io/manual/pipeline/outputs/opentelemetry

## Per Iniziare

FluentBit supporta centinaia di sorgenti dati ed è possibile acquisire log e telemetria da qualsiasi di queste sorgenti in OneUptime. Alcune delle sorgenti più popolari includono:

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

e molte altre. 

È possibile trovare l'elenco completo delle sorgenti supportate [qui](https://docs.fluentbit.io/manual)

## Prerequisiti

- **Fase 1: Installare FluentBit sul proprio sistema** - È possibile installare FluentBit seguendo le istruzioni fornite [qui](https://docs.fluentbit.io/manual/installation/getting-started-with-fluent-bit)
- **Fase 2: Registrarsi per un account OneUptime** - È possibile registrarsi per un account gratuito [qui](https://oneuptime.com). Si noti che mentre l'account è gratuito, l'acquisizione dei log è una funzionalità a pagamento. Ulteriori dettagli sui prezzi sono disponibili [qui](https://oneuptime.com/pricing).
- **Fase 3: Creare un Progetto OneUptime** - Una volta ottenuto l'account, è possibile creare un progetto dal dashboard di OneUptime. Per qualsiasi aiuto nella creazione di un progetto o domande, contattare support@oneuptime.com
- **Fase 4: Creare un Token di Acquisizione Telemetria** - Una volta creato un account OneUptime, è possibile creare un token di acquisizione telemetria per acquisire log, metriche e tracce dall'applicazione.

Dopo aver effettuato la registrazione a OneUptime e creato un progetto, fare clic su "Altro" nella barra di navigazione e fare clic su "Impostazioni Progetto".

Nella pagina Chiave di Acquisizione Telemetria, fare clic su "Crea Chiave di Acquisizione" per creare un token. 

![Crea Servizio](/docs/static/images/TelemetryIngestionKeys.png)

Una volta creato il token, fare clic su "Visualizza" per vederlo.

![Visualizza Servizio](/docs/static/images/TelemetryIngestionKeyView.png)


## Configurazione

È possibile usare la seguente configurazione per inviare i dati di telemetria al Collector HTTP OpenTelemetry di OneUptime. È possibile aggiungere questa configurazione al file di configurazione di FluentBit. Il file di configurazione si trova solitamente in `/etc/fluent-bit/fluent-bit.yaml`. Ecco come apparirebbe una sezione outputs del file di configurazione:


```yaml


outputs:
  - name: stdout
    match: '*'
  - name: opentelemetry
    match: '*'
    host: 'oneuptime.com'
    port: 443
    metrics_uri: '/otlp/v1/metrics'
    logs_uri: '/otlp/v1/logs'
    traces_uri: '/otlp/v1/traces'
    tls: On
    header:
      - x-oneuptime-token VOSTRO_TOKEN_ACQUISIZIONE_TELEMETRIA

```

Assicurarsi di avere opentelemetry_envelope nella propria sezione input. Ecco un esempio di come apparirebbe la sezione input:

```yaml
pipeline:
  inputs:
      # I propri input

      processors:
        logs:
          - name: opentelemetry_envelope

          - name: content_modifier
            context: otel_resource_attributes
            action: upsert
            key: service.name
            # Sostituire NOME_VOSTRO_SERVIZIO con il nome del proprio servizio
            value: NOME_VOSTRO_SERVIZIO
```

Ecco il file di configurazione completo di esempio:

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
            value: NOME_VOSTRO_SERVIZIO

  outputs:
    - name: stdout
      match: '*'
    - name: opentelemetry
      match: '*'
      host: 'oneuptime.com'
      port: 443
      metrics_uri: '/otlp/v1/metrics'
      logs_uri: '/otlp/v1/logs'
      traces_uri: '/otlp/v1/traces'
      tls: On
      header:
        - x-oneuptime-token VOSTRO_TOKEN_ACQUISIZIONE_TELEMETRIA
```


**Se si ospita autonomamente OneUptime**: Se si ospita autonomamente OneUptime, è possibile sostituire `host` con l'host della propria istanza OneUptime. Se si ospita su un server http e non https, è possibile sostituire `port` con la porta della propria istanza OneUptime (probabilmente la porta 80).

In tal caso la configurazione apparirebbe così:

```yaml
outputs:
  - name: stdout
    match: '*'
  - name: opentelemetry
    match: '*'
    host: 'vostra-istanza-oneuptime.com'
    port: 80
    metrics_uri: '/otlp/v1/metrics'
    logs_uri: '/otlp/v1/logs'
    traces_uri: '/otlp/v1/traces'
    header:
      - x-oneuptime-token VOSTRO_TOKEN_ACQUISIZIONE_TELEMETRIA
```

## Utilizzo

Una volta aggiunta la configurazione al file di configurazione di FluentBit, è possibile riavviare il servizio FluentBit. Una volta riavviato il servizio, i dati di telemetria verranno inviati alla Sorgente HTTP di OneUptime. Ora è possibile iniziare a vedere i dati di telemetria nel dashboard di OneUptime. Per domande o aiuto con la configurazione, contattare support@oneuptime.com
