# Fluent Bit

[Fluent Bit](https://docs.fluentbit.io/manual) är en lätt agent som samlar in loggar från filer, systemd, containrar, syslog, HTTP och många andra källor. Dess [OpenTelemetry-output](https://docs.fluentbit.io/manual/pipeline/outputs/opentelemetry) skickar det den samlar in till OneUptimes OpenTelemetry-endpoint (OTLP), där loggarna blir sökbara under **Produkter → Loggar**.

:::cards
- [Konfigurera Fluent Bit](#konfigurera-fluent-bit): Lägg till OpenTelemetry-outputen och namnge din tjänst.
- [Fullständigt exempel](#fullständigt-exempel): En hel konfigurationsfil att utgå från.
- [OneUptime i egen drift](#oneuptime-i-egen-drift): Peka Fluent Bit mot din egen instans.
:::

## Så fungerar det

```mermaid title="Från Fluent Bit till OneUptime"
flowchart TB
    sources["Filer, containrar, syslog, HTTP"] --> inputs["Fluent Bit-inputs"]
    inputs --> envelope["Processorn opentelemetry_envelope"]
    envelope --> name["content_modifier sätter service.name"]
    name --> output["Outputen opentelemetry"]
    output -->|"OTLP/HTTP + intagningsnyckel"| oneuptime["OneUptime /otlp/v1/logs"]
    oneuptime --> logs["Loggar"]
```

Fluent Bit packar in varje post i ett OpenTelemetry-kuvert, så att den kan bära resursattribut som `service.name`. OpenTelemetry-outputen skickar sedan posterna till OneUptime med din intagningsnyckel i headern `x-oneuptime-token`. OneUptime sparar dem under den tjänst som `service.name` anger och skapar tjänsten första gången den skickar.

## Innan du börjar

- **Installera Fluent Bit** – se [installationsguiden](https://docs.fluentbit.io/manual/installation/getting-started-with-fluent-bit). Konfigurationen på den här sidan använder Fluent Bits YAML-format och processorn `opentelemetry_envelope`, så använd en aktuell version.
- **Ett OneUptime-projekt.** I OneUptime Cloud debiteras telemetri per intagen GB – se [priser](https://oneuptime.com/pricing) – och ett projekt på Free-planen behöver en betalningsmetod innan det kan skicka telemetri.
- **En intagningsnyckel för telemetri.** Om du inte har någon:

:::steps
### Öppna intagningsnycklarna

Gå till **Produkter → Projektinställningar**, öppna **Telemetri och APM** i sidomenyn och välj **Intagningsnycklar**.

![Listan ”Intagningsnycklar”, med ”Skapa intagningsnyckel” markerad](screen:ingestion-keys)

### Skapa en nyckel

Klicka på **Skapa intagningsnyckel**. Dialogen har redan fyllt i nyckelns namn och valt **Server** – den sortens nyckel som en applikation eller en collector skickar med – så klicka på **Skapa intagningsnyckel** för att skapa den, eller byt namn på den först.

### Kopiera hemligheten

Den nya nyckeln öppnas på en egen sida. Kopiera dess **Hemlig nyckel**: det är `YOUR_TELEMETRY_INGESTION_TOKEN` i konfigurationen nedan.

![Sidan för en intagningsnyckel för telemetri, med dess hemliga nyckel](/docs/static/images/TelemetryIngestionKeyView.png)
:::

## Konfigurera Fluent Bit

Fluent Bit läser sin YAML-konfiguration från en fil som `/etc/fluent-bit/fluent-bit.yaml`.

:::steps
### Lägg till OpenTelemetry-outputen

Lägg till en `opentelemetry`-output som skickar till OneUptime. Behåll `stdout`-outputen medan du testar om du vill se posterna lokalt:

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

`retry_limit: 8640` skickar en chunk igen när OneUptime är upptaget (`429`) eller startar om (`502`, `503`, `504`), ungefär var 30:e sekund (`scheduler.base` och `scheduler.cap`), i ungefär 72 timmar; Fluent Bits standard är att försöka en gång till och sedan kasta den. `storage.path` håller de chunks som ännu ska skickas på disken, så att en omstart av Fluent Bit inte förlorar någon av dem, för varje input med `storage.type: filesystem`, som i nästa steg. Fluent Bit måste kunna skriva i mappen: paketets tjänst körs som root, och för hand kör du den med `sudo`. `storage.total_limit_size: 512M` håller högst 512 MB för outputen; när det är fullt kastas de äldsta chunkarna.

### Packa in loggarna i ett OpenTelemetry-kuvert och namnge tjänsten

Lägg till processorn `opentelemetry_envelope` på varje input, följd av en `content_modifier` som sätter `service.name`. Ersätt `YOUR_SERVICE_NAME` med namnet som loggarna ska visas under i OneUptime:

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

`db` håller tailens plats i varje fil, så att en omstart läser vidare därifrån; utan den börjar Fluent Bit om vid slutet av varje fil, och de rader som skrevs medan den var nere skickas aldrig. `storage.type: filesystem` håller inputens chunks i `storage.path`.

### Starta om Fluent Bit

Tjänsten i paketet `fluent-bit` läser `/etc/fluent-bit/fluent-bit.conf`, paketets eget exempel, inte den här filen. Peka den mot `/etc/fluent-bit/fluent-bit.yaml` med en drop-in, och starta den sedan nu och vid varje uppstart:

```bash
sudo mkdir -p /etc/systemd/system/fluent-bit.service.d
printf '[Service]\nExecStart=\nExecStart=/opt/fluent-bit/bin/fluent-bit -c /etc/fluent-bit/fluent-bit.yaml\n' | sudo tee /etc/systemd/system/fluent-bit.service.d/fluent-bit-yaml.conf
sudo systemctl daemon-reload
sudo systemctl enable fluent-bit
sudo systemctl restart fluent-bit
```

Den tomma `ExecStart=` tar bort paketets egen startrad. För att först prova filen i förgrunden kör du `sudo /opt/fluent-bit/bin/fluent-bit -c /etc/fluent-bit/fluent-bit.yaml`: paketet lägger programmet i `/opt/fluent-bit/bin`, som inte finns i `PATH`. Efter några sekunder visas loggarna under **Produkter → Loggar**, och tjänsten finns under **Produkter → Tjänster**.
:::

## Fullständigt exempel

Den här konfigurationen tar emot loggar över HTTP på port `8888`, bara från den här värden, och vidarebefordrar dem till OneUptime:

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

`listen: 127.0.0.1` tar bara emot loggar från den här värden: `http`-inputen ber inte om någon nyckel, så med `listen: 0.0.0.0` kan alla som når porten skicka loggar till OneUptime under din intagningsnyckel. Ersätt `http`-inputen med de inputs du behöver – till exempel `tail` för loggfiler eller `systemd` för journalen – och behåll de två processorerna och `storage.type: filesystem` på var och en av dem.

## Skicka med HTTP-outputen

Fluent Bits [HTTP-output](https://docs.fluentbit.io/manual/pipeline/outputs/http) kan också skicka till OneUptimes Fluentd-endpoint, som läser varje post så som [Fluentd-sidan](/docs/telemetry/fluentd) beskriver. Sätt `format` till `json_lines`, som nedan, eller till `json`: OneUptime läser båda, komprimerade med `compress: gzip` eller inte. Fluent Bits standardformat, `msgpack`, avvisas.

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

## OneUptime i egen drift

Sätt `host` till värden för din OneUptime-instans. Om den serveras över vanlig HTTP i stället för HTTPS sätter du också `port` till porten den lyssnar på (vanligtvis `80`) och tar bort `tls`:

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

## Felsökning

:::details Fluent Bit loggar `401` från OpenTelemetry-outputen
Intagningsnyckeln saknas, är okänd eller har gått ut. Kontrollera `header`-raden: den är `x-oneuptime-token`, ett mellanslag och sedan nyckelns **Hemlig nyckel**.
:::

:::details Fluent Bit loggar `402` eller `422`
`402`: i OneUptime Cloud har projektet Free-planen och ingen betalningsmetod. Lägg till en under **Projektinställningar → Fakturering och fakturor → Fakturering**. `422`: nyckeln är inaktiverad, eller så är det en webbläsarnyckel. Slå på **Aktiverad** igen i nyckelns inställningar, eller skapa en **Server**-nyckel.
:::

:::details Loggarna kommer under en oväntad tjänst
Tjänsten kommer från `service.name`. Kontrollera att varje input har processorn `opentelemetry_envelope` följd av den `content_modifier` som sätter den.
:::

:::details Inget kommer fram, och Fluent Bit loggar anslutningsfel
Kontrollera att `tls: On` och `port: 443` är satta för en HTTPS-endpoint, och att värden som kör Fluent Bit når din OneUptime-värd på den porten.
:::

:::details Fluent Bit loggar `cannot be retried`
Fluent Bit kastade en chunk som den inte kunde skicka. Med `retry_limit: 8640`, som i konfigurationen ovan, skickar den en chunk som OneUptime svarar `429`, `502`, `503` eller `504` på igen ungefär var 30:e sekund, i ungefär 72 timmar; med Fluent Bits standard försöker den bara en gång till. En `400`, `401`, `402`, `413`, `422` eller `500` kastas direkt, eftersom svaret är detsamma varje gång: kontrollera nyckeln, abonnemanget och storleken på begäran.
:::

Har du frågor eller behöver hjälp med konfigurationen kan du skriva till oss på support@oneuptime.com.

## Nästa steg

:::cards
- [Loggpipelines](/docs/telemetry/log-pipelines): Tolka och berika loggarna som Fluent Bit skickar.
- [Söksyntax](/docs/telemetry/search-syntax): Hitta loggarna i loggutforskaren.
- [OpenTelemetry](/docs/telemetry/open-telemetry): Endpoints, nycklar och gränser för all telemetri.
- [Fluentd](/docs/telemetry/fluentd): Använd Fluentd i stället.
:::
