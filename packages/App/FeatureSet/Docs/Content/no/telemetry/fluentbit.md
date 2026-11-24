# Fluent Bit

[Fluent Bit](https://docs.fluentbit.io/manual) er en lett agent som samler logger fra filer, systemd, containere, syslog, HTTP og mange andre kilder. [OpenTelemetry-outputen](https://docs.fluentbit.io/manual/pipeline/outputs/opentelemetry) sender det den samler, til OpenTelemetry-endepunktet (OTLP) i OneUptime, der loggene blir søkbare under **Produkter → Logger**.

:::cards
- [Konfigurer Fluent Bit](#konfigurer-fluent-bit): Legg til OpenTelemetry-outputen, og gi tjenesten din et navn.
- [Fullstendig eksempel](#fullstendig-eksempel): En hel konfigurasjonsfil å starte fra.
- [Selvhostet OneUptime](#selvhostet-oneuptime): Pek Fluent Bit mot din egen instans.
:::

## Slik fungerer det

```mermaid title="Fra Fluent Bit til OneUptime"
flowchart TB
    sources["Filer, containere, syslog, HTTP"] --> inputs["Fluent Bit-inputer"]
    inputs --> envelope["Prosessoren opentelemetry_envelope"]
    envelope --> name["content_modifier setter service.name"]
    name --> output["Outputen opentelemetry"]
    output -->|"OTLP/HTTP + inntaksnøkkel"| oneuptime["OneUptime /otlp/v1/logs"]
    oneuptime --> logs["Logger"]
```

Fluent Bit pakker hver post inn i en OpenTelemetry-konvolutt, slik at den kan bære ressursattributter som `service.name`. OpenTelemetry-outputen sender så postene til OneUptime med inntaksnøkkelen din i headeren `x-oneuptime-token`. OneUptime lagrer dem under tjenesten som `service.name` angir, og oppretter den tjenesten første gang den sender.

## Før du begynner

- **Installer Fluent Bit** – se [installasjonsveiledningen](https://docs.fluentbit.io/manual/installation/getting-started-with-fluent-bit). Konfigurasjonen på denne siden bruker YAML-formatet til Fluent Bit og prosessoren `opentelemetry_envelope`, så bruk en oppdatert versjon.
- **Et OneUptime-prosjekt.** I OneUptime Cloud faktureres telemetri per inntatt GB – se [priser](https://oneuptime.com/pricing) – og et prosjekt på Free-planen trenger en betalingsmetode før det kan sende telemetri.
- **En inntaksnøkkel for telemetri.** Hvis du ikke har en:

:::steps
### Åpne inntaksnøklene

Gå til **Produkter → Prosjektinnstillinger**, åpne **Telemetri og APM** i sidemenyen, og velg **Inntaksnøkler**.

![Listen «Inntaksnøkler», med «Opprett inntaksnøkkel» uthevet](screen:ingestion-keys)

### Opprett en nøkkel

Klikk på **Opprett inntaksnøkkel**. Dialogen har allerede fylt inn navnet på nøkkelen og valgt **Server** – den typen nøkkel en applikasjon eller en collector sender med – så klikk på **Opprett inntaksnøkkel** for å opprette den, eller gi den nytt navn først.

### Kopier hemmeligheten

Den nye nøkkelen åpnes på sin egen side. Kopier **Hemmelig nøkkel**: Det er `YOUR_TELEMETRY_INGESTION_TOKEN` i konfigurasjonen nedenfor.

![Siden for en inntaksnøkkel for telemetri, med den hemmelige nøkkelen](/docs/static/images/TelemetryIngestionKeyView.png)
:::

## Konfigurer Fluent Bit

Fluent Bit leser YAML-konfigurasjonen sin fra en fil som `/etc/fluent-bit/fluent-bit.yaml`.

:::steps
### Legg til OpenTelemetry-outputen

Legg til en `opentelemetry`-output som sender til OneUptime. Behold `stdout`-outputen mens du tester, hvis du vil se postene lokalt:

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

`retry_limit: 8640` sender en chunk på nytt når OneUptime har mye å gjøre (`429`) eller starter på nytt (`502`, `503`, `504`), omtrent hvert 30. sekund (`scheduler.base` og `scheduler.cap`), i omtrent 72 timer; standarden til Fluent Bit er å prøve én gang til og så kaste den. `storage.path` holder chunkene som ennå skal sendes på disken, så en omstart av Fluent Bit mister ingen av dem, for hver input med `storage.type: filesystem`, som i neste trinn. Fluent Bit må kunne skrive i mappen: tjenesten til pakken kjører som root, og for hånd kjører du den med `sudo`. `storage.total_limit_size: 512M` holder høyst 512 MB for outputen; når den er full, kastes de eldste chunkene.

### Pakk loggene inn i en OpenTelemetry-konvolutt, og gi tjenesten et navn

Legg prosessoren `opentelemetry_envelope` til hver input, etterfulgt av en `content_modifier` som setter `service.name`. Erstatt `YOUR_SERVICE_NAME` med navnet loggene skal vises under i OneUptime:

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

`db` holder på plassen til tailen i hver fil, så en omstart leser videre derfra; uten den begynner Fluent Bit på nytt ved slutten av hver fil, og linjene som ble skrevet mens den var nede, sendes aldri. `storage.type: filesystem` holder chunkene til inputen i `storage.path`.

### Start Fluent Bit på nytt

Tjenesten i pakken `fluent-bit` leser `/etc/fluent-bit/fluent-bit.conf`, pakkens eget eksempel, ikke denne filen. Pek den mot `/etc/fluent-bit/fluent-bit.yaml` med en drop-in, og start den så nå og ved hver oppstart:

```bash
sudo mkdir -p /etc/systemd/system/fluent-bit.service.d
printf '[Service]\nExecStart=\nExecStart=/opt/fluent-bit/bin/fluent-bit -c /etc/fluent-bit/fluent-bit.yaml\n' | sudo tee /etc/systemd/system/fluent-bit.service.d/fluent-bit-yaml.conf
sudo systemctl daemon-reload
sudo systemctl enable fluent-bit
sudo systemctl restart fluent-bit
```

Den tomme `ExecStart=` fjerner pakkens egen startlinje. For å prøve filen i forgrunnen først kjører du `sudo /opt/fluent-bit/bin/fluent-bit -c /etc/fluent-bit/fluent-bit.yaml`: pakken legger programmet i `/opt/fluent-bit/bin`, som ikke er i `PATH`. Etter noen sekunder vises loggene under **Produkter → Logger**, og tjenesten står under **Produkter → Tjenester**.
:::

## Fullstendig eksempel

Denne konfigurasjonen tar imot logger over HTTP på port `8888`, bare fra denne verten, og sender dem videre til OneUptime:

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

`listen: 127.0.0.1` tar bare imot logger fra denne verten: `http`-inputen ber ikke om noen nøkkel, så med `listen: 0.0.0.0` kan alle som når porten, sende logger til OneUptime under inntaksnøkkelen din. Erstatt `http`-inputen med inputene du trenger – for eksempel `tail` for loggfiler eller `systemd` for journalen – og behold de to prosessorene og `storage.type: filesystem` på hver av dem.

## Send med HTTP-outputen

[HTTP-outputen](https://docs.fluentbit.io/manual/pipeline/outputs/http) i Fluent Bit kan også sende til Fluentd-endepunktet i OneUptime, som leser hver post slik [Fluentd-siden](/docs/telemetry/fluentd) beskriver. Sett `format` til `json_lines`, som nedenfor, eller til `json`: OneUptime leser begge, komprimert med `compress: gzip` eller ikke. Standardformatet til Fluent Bit, `msgpack`, blir avvist.

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

## Selvhostet OneUptime

Sett `host` til verten for OneUptime-instansen din. Hvis den betjenes over vanlig HTTP i stedet for HTTPS, setter du også `port` til porten den lytter på (vanligvis `80`) og fjerner `tls`:

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

## Feilsøking

:::details Fluent Bit logger `401` fra OpenTelemetry-outputen
Inntaksnøkkelen mangler, er ukjent eller utløpt. Sjekk `header`-linjen: Den er `x-oneuptime-token`, et mellomrom og så nøkkelens **Hemmelig nøkkel**.
:::

:::details Fluent Bit logger `402` eller `422`
`402`: I OneUptime Cloud er prosjektet på Free-planen og har ingen betalingsmetode. Legg til en under **Prosjektinnstillinger → Fakturering og fakturaer → Fakturering**. `422`: Nøkkelen er deaktivert, eller det er en nettlesernøkkel. Slå **Aktivert** på igjen i nøkkelens innstillinger, eller opprett en **Server**-nøkkel.
:::

:::details Loggene kommer under en uventet tjeneste
Tjenesten kommer fra `service.name`. Sjekk at hver input har prosessoren `opentelemetry_envelope` etterfulgt av `content_modifier` som setter den.
:::

:::details Ingenting kommer frem, og Fluent Bit logger tilkoblingsfeil
Sjekk at `tls: On` og `port: 443` er satt for et HTTPS-endepunkt, og at verten som kjører Fluent Bit, når OneUptime-verten din på den porten.
:::

:::details Fluent Bit logger `cannot be retried`
Fluent Bit kastet en chunk den ikke kunne sende. Med `retry_limit: 8640`, som i konfigurasjonen ovenfor, sender den en chunk som OneUptime svarer `429`, `502`, `503` eller `504` på, på nytt omtrent hvert 30. sekund i omtrent 72 timer; med standarden til Fluent Bit prøver den bare én gang til. En `400`, `401`, `402`, `413`, `422` eller `500` kastes med en gang, siden svaret er det samme hver gang: sjekk nøkkelen, abonnementet og størrelsen på forespørselen.
:::

Har du spørsmål eller trenger hjelp med konfigurasjonen, kan du skrive til oss på support@oneuptime.com.

## Neste steg

:::cards
- [Loggpipelines](/docs/telemetry/log-pipelines): Tolk og berik loggene Fluent Bit sender.
- [Søkesyntaks](/docs/telemetry/search-syntax): Finn loggene i loggutforskeren.
- [OpenTelemetry](/docs/telemetry/open-telemetry): Endepunkter, nøkler og grenser for all telemetri.
- [Fluentd](/docs/telemetry/fluentd): Bruk Fluentd i stedet.
:::
