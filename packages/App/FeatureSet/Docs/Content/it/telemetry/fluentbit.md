# Fluent Bit

[Fluent Bit](https://docs.fluentbit.io/manual) è un agente leggero che raccoglie log da file, systemd, container, syslog, HTTP e molte altre sorgenti. Il suo [output OpenTelemetry](https://docs.fluentbit.io/manual/pipeline/outputs/opentelemetry) invia ciò che raccoglie all'endpoint OpenTelemetry (OTLP) di OneUptime, dove i log diventano ricercabili in **Prodotti → Log**.

:::cards
- [Configurare Fluent Bit](#configurare-fluent-bit): Aggiungi l'output OpenTelemetry e dai un nome al tuo servizio.
- [Esempio completo](#esempio-completo): Un intero file di configurazione da cui partire.
- [OneUptime self-hosted](#oneuptime-self-hosted): Punta Fluent Bit alla tua istanza.
:::

## Come funziona

```mermaid title="Da Fluent Bit a OneUptime"
flowchart TB
    sources["File, container, syslog, HTTP"] --> inputs["Input di Fluent Bit"]
    inputs --> envelope["Processore opentelemetry_envelope"]
    envelope --> name["content_modifier imposta service.name"]
    name --> output["Output opentelemetry"]
    output -->|"OTLP/HTTP + chiave di acquisizione"| oneuptime["OneUptime /otlp/v1/logs"]
    oneuptime --> logs["Log"]
```

Fluent Bit avvolge ogni record in una busta OpenTelemetry, così può portare attributi di risorsa come `service.name`. L'output OpenTelemetry invia poi i record a OneUptime con la tua chiave di acquisizione nell'header `x-oneuptime-token`. OneUptime li archivia sotto il servizio indicato da `service.name` e crea quel servizio la prima volta che invia.

## Prima di iniziare

- **Installare Fluent Bit**: vedi la [guida all'installazione](https://docs.fluentbit.io/manual/installation/getting-started-with-fluent-bit). La configurazione di questa pagina usa il formato YAML di Fluent Bit e il processore `opentelemetry_envelope`, quindi usa una versione recente.
- **Un progetto OneUptime.** Su OneUptime Cloud la telemetria si paga per GB acquisito (vedi i [prezzi](https://oneuptime.com/pricing)) e un progetto con il piano Free ha bisogno di un metodo di pagamento prima di poter inviare telemetria.
- **Una chiave di acquisizione della telemetria.** Se non ne hai una:

:::steps
### Aprire le chiavi di acquisizione

Vai a **Prodotti → Impostazioni del progetto**, apri **Telemetria e APM** nel menu laterale e seleziona **Chiavi di acquisizione**.

![L'elenco «Chiavi di acquisizione», con «Crea chiave di acquisizione» evidenziato](screen:ingestion-keys)

### Creare una chiave

Fai clic su **Crea chiave di acquisizione**. La finestra ha già il nome della chiave compilato e **Server** scelto (il tipo di chiave con cui invia un'applicazione o un collector), quindi fai clic su **Crea chiave di acquisizione** per crearla, oppure rinominala prima.

### Copiare il segreto

La nuova chiave si apre nella sua pagina. Copia la sua **Chiave segreta**: è lo `YOUR_TELEMETRY_INGESTION_TOKEN` della configurazione qui sotto.

![La pagina di una chiave di acquisizione della telemetria, con la sua chiave segreta](/docs/static/images/TelemetryIngestionKeyView.png)
:::

## Configurare Fluent Bit

Fluent Bit legge la sua configurazione YAML da un file come `/etc/fluent-bit/fluent-bit.yaml`.

:::steps
### Aggiungere l'output OpenTelemetry

Aggiungi un output `opentelemetry` che invia a OneUptime. Mantieni l'output `stdout` mentre fai le prove, se vuoi vedere i record in locale:

```yaml title="fluent-bit.yaml"
service:
  # Keep the chunks still to send on disk: a restart of Fluent Bit loses none
  storage.path: /var/lib/fluent-bit/buffer
  storage.sync: normal
  # Try a chunk again about every 30 seconds
  scheduler.base: 30
  scheduler.cap: 30

pipeline:
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
      # Send a chunk again when OneUptime is busy or restarting, for about 72 hours
      retry_limit: 8640
      # At most 512 MB on disk: when it is full, the oldest chunks are dropped
      storage.total_limit_size: 512M
```

`retry_limit: 8640` invia di nuovo un chunk quando OneUptime è sovraccarico (`429`) o si sta riavviando (`502`, `503`, `504`), circa ogni 30 secondi (`scheduler.base` e `scheduler.cap`), per circa 72 ore; l'impostazione predefinita di Fluent Bit è riprovare una volta e poi scartarlo. `storage.path` tiene su disco i chunk ancora da inviare, così un riavvio di Fluent Bit non ne perde nessuno, per ogni input con `storage.type: filesystem`, come nel passo successivo. Fluent Bit deve poter scrivere in quella cartella: il servizio del pacchetto gira come root, e a mano avvialo con `sudo`. `storage.total_limit_size: 512M` tiene al massimo 512 MB per l'output; quando è pieno, i chunk più vecchi vengono scartati.

### Avvolgere i log in una busta OpenTelemetry e dare un nome al servizio

Aggiungi il processore `opentelemetry_envelope` a ogni input, seguito da un `content_modifier` che imposta `service.name`. Sostituisci `YOUR_SERVICE_NAME` con il nome con cui i log devono comparire in OneUptime:

```yaml title="fluent-bit.yaml"
pipeline:
  inputs:
    - name: tail # or any other input
      path: /var/log/my-app/*.log
      # Keep its place in each file, so a restart reads on from there
      db: /var/lib/fluent-bit/tail.db
      # Keep its chunks on disk until OneUptime takes them
      storage.type: filesystem

      processors:
        logs:
          - name: opentelemetry_envelope

          - name: content_modifier
            context: otel_resource_attributes
            action: upsert
            key: service.name
            value: YOUR_SERVICE_NAME
```

`db` tiene la posizione del tail in ogni file, così un riavvio riprende a leggere da lì; senza, Fluent Bit ricomincia dalla fine di ogni file, e le righe scritte mentre era fermo non vengono mai inviate. `storage.type: filesystem` tiene i chunk dell'input in `storage.path`.

### Riavviare Fluent Bit

Il servizio del pacchetto `fluent-bit` legge `/etc/fluent-bit/fluent-bit.conf`, l'esempio del pacchetto stesso, non questo file. Puntalo su `/etc/fluent-bit/fluent-bit.yaml` con un drop-in, poi avvialo ora e a ogni avvio:

```bash
sudo mkdir -p /etc/systemd/system/fluent-bit.service.d
printf '[Service]\nExecStart=\nExecStart=/opt/fluent-bit/bin/fluent-bit -c /etc/fluent-bit/fluent-bit.yaml\n' | sudo tee /etc/systemd/system/fluent-bit.service.d/fluent-bit-yaml.conf
sudo systemctl daemon-reload
sudo systemctl enable fluent-bit
sudo systemctl restart fluent-bit
```

L'`ExecStart=` vuoto cancella la riga di avvio del pacchetto. Per provare prima il file in primo piano, esegui `sudo /opt/fluent-bit/bin/fluent-bit -c /etc/fluent-bit/fluent-bit.yaml`: il pacchetto mette il programma in `/opt/fluent-bit/bin`, che non è nel `PATH`. In pochi secondi i log compaiono in **Prodotti → Log** e il servizio è elencato in **Prodotti → Servizi**.
:::

## Esempio completo

Questa configurazione riceve log via HTTP sulla porta `8888`, solo da questo host, e li inoltra a OneUptime:

```yaml title="fluent-bit.yaml"
service:
  flush: 1
  log_level: info
  # Keep the chunks still to send on disk: a restart of Fluent Bit loses none
  storage.path: /var/lib/fluent-bit/buffer
  storage.sync: normal
  # Try a chunk again about every 30 seconds
  scheduler.base: 30
  scheduler.cap: 30

pipeline:
  inputs:
    - name: http
      # This host alone may send here
      listen: 127.0.0.1
      port: 8888
      storage.type: filesystem

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
      # Send a chunk again when OneUptime is busy or restarting, for about 72 hours
      retry_limit: 8640
      # At most 512 MB on disk: when it is full, the oldest chunks are dropped
      storage.total_limit_size: 512M
```

`listen: 127.0.0.1` accetta log solo da questo host: l'input `http` non chiede alcuna chiave, quindi con `listen: 0.0.0.0` chiunque raggiunga la porta può inviare log a OneUptime con la tua chiave di acquisizione. Sostituisci l'input `http` con gli input che ti servono (ad esempio `tail` per i file di log o `systemd` per il journal) e mantieni i due processori e `storage.type: filesystem` su ciascuno di essi.

## Inviare con l'output HTTP

L'[output HTTP](https://docs.fluentbit.io/manual/pipeline/outputs/http) di Fluent Bit può anche inviare all'endpoint Fluentd di OneUptime, che legge ogni record come descrive la [pagina di Fluentd](/docs/telemetry/fluentd). Imposta `format` su `json_lines`, come qui sotto, o su `json`: OneUptime li legge entrambi, compressi con `compress: gzip` o no. Il formato predefinito di Fluent Bit, `msgpack`, viene rifiutato.

```yaml title="fluent-bit.yaml"
pipeline:
  outputs:
    - name: http
      match: "*"
      host: "oneuptime.com"
      port: 443
      uri: "/fluentd/logs"
      format: json_lines
      # Send each record's time where OneUptime reads it
      json_date_key: timestamp
      tls: On
      header:
        - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
        - x-oneuptime-service-name YOUR_SERVICE_NAME
      # Send a chunk again when OneUptime is busy or restarting, for about 72 hours
      retry_limit: 8640
      # At most 512 MB on disk: when it is full, the oldest chunks are dropped
      storage.total_limit_size: 512M
```

## OneUptime self-hosted

Imposta `host` sull'host della tua istanza OneUptime. Se è servita in HTTP semplice anziché in HTTPS, imposta anche `port` sulla porta su cui è in ascolto (di solito `80`) e rimuovi `tls`:

```yaml title="fluent-bit.yaml"
pipeline:
  outputs:
    - name: stdout
      match: "*"
    - name: opentelemetry
      match: "*"
      host: "your-oneuptime-instance.com"
      port: 80
      metrics_uri: "/otlp/v1/metrics"
      logs_uri: "/otlp/v1/logs"
      traces_uri: "/otlp/v1/traces"
      header:
        - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
      # Send a chunk again when OneUptime is busy or restarting, for about 72 hours
      retry_limit: 8640
      # At most 512 MB on disk: when it is full, the oldest chunks are dropped
      storage.total_limit_size: 512M
```

## Risoluzione dei problemi

:::details Fluent Bit registra `401` dall'output OpenTelemetry
La chiave di acquisizione manca, è sconosciuta o è scaduta. Controlla la riga `header`: è `x-oneuptime-token`, uno spazio, poi la **Chiave segreta** della chiave.
:::

:::details Fluent Bit registra `402` o `422`
`402`: su OneUptime Cloud il progetto ha il piano Free e nessun metodo di pagamento. Aggiungine uno in **Impostazioni del progetto → Fatturazione e fatture → Fatturazione**. `422`: la chiave è disattivata, oppure è una chiave Browser. Riattiva **Abilitato** nelle impostazioni della chiave, oppure crea una chiave **Server**.
:::

:::details I log arrivano sotto un servizio inatteso
Il servizio viene da `service.name`. Verifica che ogni input abbia il processore `opentelemetry_envelope` seguito dal `content_modifier` che lo imposta.
:::

:::details Non arriva nulla e Fluent Bit registra errori di connessione
Verifica che per un endpoint HTTPS siano impostati `tls: On` e `port: 443`, e che l'host su cui gira Fluent Bit raggiunga l'host di OneUptime su quella porta.
:::

:::details Fluent Bit registra `cannot be retried`
Fluent Bit ha scartato un chunk che non è riuscito a inviare. Con `retry_limit: 8640`, come nella configurazione qui sopra, invia di nuovo un chunk a cui OneUptime risponde `429`, `502`, `503` o `504` circa ogni 30 secondi, per circa 72 ore; con l'impostazione predefinita di Fluent Bit riprova una volta sola. Un `400`, `401`, `402`, `413`, `422` o `500` viene scartato subito, perché la risposta è la stessa ogni volta: controlla la chiave, il piano e la dimensione della richiesta.
:::

Per qualsiasi domanda o se ti serve aiuto con la configurazione, scrivici a support@oneuptime.com.

## Passaggi successivi

:::cards
- [Pipeline dei log](/docs/telemetry/log-pipelines): Analizza e arricchisci i log che invia Fluent Bit.
- [Sintassi di ricerca](/docs/telemetry/search-syntax): Trova i log nell'explorer dei log.
- [OpenTelemetry](/docs/telemetry/open-telemetry): Endpoint, chiavi e limiti per tutta la telemetria.
- [Fluentd](/docs/telemetry/fluentd): Usa invece Fluentd.
:::
