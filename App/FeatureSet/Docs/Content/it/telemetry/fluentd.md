# Usare Fluentd per inviare dati di telemetria a OneUptime

## Panoramica

È possibile usare il plugin [Fluentd](https://www.fluentd.org/) per raccogliere log e dati di telemetria dalle proprie applicazioni e servizi. Il plugin invia i dati di telemetria alla Sorgente HTTP di OneUptime. È possibile usare il plugin di output http di Fluentd per inviare i dati di telemetria alla Sorgente HTTP di OneUptime. Questo plugin è disponibile qui: https://docs.fluentd.org/output/http

## Per Iniziare

Fluentd supporta centinaia di sorgenti dati ed è possibile acquisire log da qualsiasi di queste sorgenti in OneUptime. Alcune delle sorgenti più popolari includono:

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

È possibile trovare l'elenco completo delle sorgenti supportate [qui](https://www.fluentd.org/datasources)

## Prerequisiti

- **Fase 1: Installare Fluentd sul proprio sistema** - È possibile installare Fluentd seguendo le istruzioni fornite [qui](https://docs.fluentd.org/installation)
- **Fase 2: Registrarsi per un account OneUptime** - È possibile registrarsi per un account gratuito [qui](https://oneuptime.com). Si noti che mentre l'account è gratuito, l'acquisizione dei log è una funzionalità a pagamento. Ulteriori dettagli sui prezzi sono disponibili [qui](https://oneuptime.com/pricing).
- **Fase 3: Creare un Progetto OneUptime** - Una volta ottenuto l'account, è possibile creare un progetto dal dashboard di OneUptime. Per qualsiasi aiuto nella creazione di un progetto o domande, contattare support@oneuptime.com
- **Fase 4: Creare un Token di Acquisizione Telemetria** - Una volta creato un account OneUptime, è possibile creare un token di acquisizione telemetria per acquisire log, metriche e tracce dall'applicazione.

Dopo aver effettuato la registrazione a OneUptime e creato un progetto, fare clic su "Altro" nella barra di navigazione e fare clic su "Impostazioni Progetto".

Nella pagina Chiave di Acquisizione Telemetria, fare clic su "Crea Chiave di Acquisizione" per creare un token. 

![Crea Servizio](/docs/static/images/TelemetryIngestionKeys.png)

Una volta creato il token, fare clic su "Visualizza" per vederlo.

![Visualizza Servizio](/docs/static/images/TelemetryIngestionKeyView.png)


## Configurazione

È possibile usare la seguente configurazione per inviare i dati di telemetria alla Sorgente HTTP di OneUptime. È possibile aggiungere questa configurazione al file di configurazione di Fluentd. Il file di configurazione si trova solitamente in `/etc/fluentd/fluent.conf` o `/etc/td-agent/td-agent.conf`. 

È necessario sostituire `YOUR_SERVICE_TOKEN` con il token creato nel passaggio precedente. È anche necessario sostituire `YOUR_SERVICE_NAME` con il nome del proprio servizio. Il nome del servizio può essere qualsiasi nome desiderato. Se il servizio non esiste in OneUptime, verrà creato automaticamente.

```yaml
# Corrisponde a tutti i pattern 
<match **>
  @type http

  endpoint https://oneuptime.com/fluentd/logs
  open_timeout 2

  headers {"x-oneuptime-token":"YOUR_SERVICE_TOKEN", "x-oneuptime-service-name":"YOUR_SERVICE_NAME"}

  content_type application/json
  json_array true

  <format>
    @type json
  </format>
  <buffer>
    flush_interval 10s
  </buffer>
</match>
```


Un esempio di file di configurazione completo è mostrato di seguito:

```yaml
####
## Descrizioni sorgente:
##

## input TCP integrato
## @see https://docs.fluentd.org/input/forward
<source>
  @type forward
  port 24224
  bind 0.0.0.0
</source>

<match **>
  @type http

  endpoint https://oneuptime.com/fluentd/logs
  open_timeout 2

  headers {"x-oneuptime-token":"YOUR_SERVICE_TOKEN", "x-oneuptime-service-name":"YOUR_SERVICE_NAME"}

  content_type application/json
  json_array true

  <format>
    @type json
  </format>
  <buffer>
    flush_interval 10s
  </buffer>
</match>
```

**Se si ospita autonomamente OneUptime**: Se si ospita autonomamente OneUptime, è possibile sostituire `endpoint_url` con l'URL della propria istanza OneUptime. `http(s)://VOSTRO_HOST_ONEUPTIME/fluentd/logs`

## Utilizzo

Una volta aggiunta la configurazione al file di configurazione di Fluentd, è possibile riavviare il servizio Fluentd. Una volta riavviato il servizio, i dati di telemetria verranno inviati alla Sorgente HTTP di OneUptime. Ora è possibile iniziare a vedere i dati di telemetria nel dashboard di OneUptime. Per domande o aiuto con la configurazione, contattare support@oneuptime.com
