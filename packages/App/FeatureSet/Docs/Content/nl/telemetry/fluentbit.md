# Fluent Bit

[Fluent Bit](https://docs.fluentbit.io/manual) is een lichte agent die logs verzamelt uit bestanden, systemd, containers, syslog, HTTP en vele andere bronnen. De [OpenTelemetry-output](https://docs.fluentbit.io/manual/pipeline/outputs/opentelemetry) stuurt wat hij verzamelt naar het OpenTelemetry-endpoint (OTLP) van OneUptime, waar de logs doorzoekbaar worden onder **Producten → Logboeken**.

:::cards
- [Fluent Bit configureren](#fluent-bit-configureren): De OpenTelemetry-output toevoegen en je service een naam geven.
- [Volledig voorbeeld](#volledig-voorbeeld): Een compleet configuratiebestand om mee te beginnen.
- [Zelf gehoste OneUptime](#zelf-gehoste-oneuptime): Fluent Bit op je eigen instantie richten.
:::

## Hoe het werkt

```mermaid title="Van Fluent Bit naar OneUptime"
flowchart TB
    sources["Bestanden, containers, syslog, HTTP"] --> inputs["Fluent Bit-inputs"]
    inputs --> envelope["Processor opentelemetry_envelope"]
    envelope --> name["content_modifier zet service.name"]
    name --> output["Output opentelemetry"]
    output -->|"OTLP/HTTP + ingestiesleutel"| oneuptime["OneUptime /otlp/v1/logs"]
    oneuptime --> logs["Logs"]
```

Fluent Bit verpakt elk record in een OpenTelemetry-envelop, zodat het resource-attributen zoals `service.name` kan dragen. De OpenTelemetry-output stuurt de records daarna naar OneUptime, met je ingestiesleutel in de header `x-oneuptime-token`. OneUptime slaat ze op onder de service die `service.name` noemt, en maakt die service aan zodra hij voor het eerst stuurt.

## Voordat je begint

- **Fluent Bit installeren**: zie de [installatiehandleiding](https://docs.fluentbit.io/manual/installation/getting-started-with-fluent-bit). De configuratie op deze pagina gebruikt het YAML-formaat van Fluent Bit en de processor `opentelemetry_envelope`, dus gebruik een recente versie.
- **Een OneUptime-project.** In OneUptime Cloud wordt telemetrie per opgenomen GB gefactureerd (zie de [prijzen](https://oneuptime.com/pricing)), en een project op het Free-abonnement heeft een betaalmethode nodig voordat het telemetrie kan sturen.
- **Een telemetrie-ingestiesleutel.** Heb je er nog geen:

:::steps
### De ingestiesleutels openen

Ga naar **Producten → Projectinstellingen**, open **Telemetrie & APM** in het zijmenu en kies **Ingestiesleutels**.

![De lijst "Ingestiesleutels", met "Ingestiesleutel aanmaken" omcirkeld](screen:ingestion-keys)

### Een sleutel maken

Klik op **Ingestiesleutel aanmaken**. In het dialoogvenster is de naam van de sleutel al ingevuld en **Server** gekozen, het soort sleutel waarmee een applicatie of een collector stuurt. Klik dus op **Ingestiesleutel aanmaken** om hem te maken, of geef hem eerst een andere naam.

### Het geheim kopiëren

De nieuwe sleutel opent op een eigen pagina. Kopieer de **Geheime sleutel**: dat is het `YOUR_TELEMETRY_INGESTION_TOKEN` in de configuratie hieronder.

![De pagina van een telemetrie-ingestiesleutel, met de geheime sleutel](/docs/static/images/TelemetryIngestionKeyView.png)
:::

## Fluent Bit configureren

Fluent Bit leest zijn YAML-configuratie uit een bestand zoals `/etc/fluent-bit/fluent-bit.yaml`.

:::steps
### De OpenTelemetry-output toevoegen

Voeg een `opentelemetry`-output toe die naar OneUptime stuurt. Houd tijdens het testen de `stdout`-output aan als je de records lokaal wilt zien:

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

`retry_limit: 8640` stuurt een chunk opnieuw als OneUptime het druk heeft (`429`) of herstart (`502`, `503`, `504`), ongeveer elke 30 seconden (`scheduler.base` en `scheduler.cap`), ongeveer 72 uur lang; standaard probeert Fluent Bit het één keer opnieuw en gooit hem dan weg. `storage.path` bewaart de chunks die nog verstuurd moeten worden op schijf, zodat een herstart van Fluent Bit er geen verliest, voor elke input met `storage.type: filesystem`, zoals in de volgende stap. Fluent Bit moet in die map kunnen schrijven: de service van het pakket draait als root, en met de hand start je het met `sudo`. `storage.total_limit_size: 512M` bewaart hooguit 512 MB voor de output; is dat vol, dan worden de oudste chunks weggegooid.

### Logs in een OpenTelemetry-envelop verpakken en de service een naam geven

Voeg de processor `opentelemetry_envelope` aan elke input toe, gevolgd door een `content_modifier` die `service.name` zet. Vervang `YOUR_SERVICE_NAME` door de naam waaronder de logs in OneUptime moeten verschijnen:

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

`db` onthoudt de plek van de tail in elk bestand, zodat een herstart daar verder leest; zonder begint Fluent Bit opnieuw aan het eind van elk bestand, en de regels die geschreven werden terwijl het niet draaide, worden nooit verstuurd. `storage.type: filesystem` bewaart de chunks van de input in `storage.path`.

### Fluent Bit herstarten

De service van het pakket `fluent-bit` leest `/etc/fluent-bit/fluent-bit.conf`, het eigen voorbeeld van het pakket, niet dit bestand. Richt hem met een drop-in op `/etc/fluent-bit/fluent-bit.yaml` en start hem dan nu en bij elke opstart:

```bash
sudo mkdir -p /etc/systemd/system/fluent-bit.service.d
printf '[Service]\nExecStart=\nExecStart=/opt/fluent-bit/bin/fluent-bit -c /etc/fluent-bit/fluent-bit.yaml\n' | sudo tee /etc/systemd/system/fluent-bit.service.d/fluent-bit-yaml.conf
sudo systemctl daemon-reload
sudo systemctl enable fluent-bit
sudo systemctl restart fluent-bit
```

De lege `ExecStart=` wist de eigen startregel van het pakket. Wil je het bestand eerst op de voorgrond proberen, voer dan `sudo /opt/fluent-bit/bin/fluent-bit -c /etc/fluent-bit/fluent-bit.yaml` uit: het pakket zet het programma in `/opt/fluent-bit/bin`, dat niet in het `PATH` staat. Binnen enkele seconden verschijnen de logs onder **Producten → Logboeken**, en staat de service onder **Producten → Services**.
:::

## Volledig voorbeeld

Deze configuratie ontvangt logs via HTTP op poort `8888`, alleen van deze host, en stuurt ze door naar OneUptime:

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

`listen: 127.0.0.1` neemt alleen logs van deze host aan: de `http`-input vraagt om geen sleutel, dus met `listen: 0.0.0.0` kan iedereen die de poort bereikt logs naar OneUptime sturen onder je ingestiesleutel. Vervang de `http`-input door de inputs die je nodig hebt (bijvoorbeeld `tail` voor logbestanden of `systemd` voor het journal) en houd op elk ervan de twee processors en `storage.type: filesystem`.

## Versturen met de HTTP-output

De [HTTP-output](https://docs.fluentbit.io/manual/pipeline/outputs/http) van Fluent Bit kan ook naar het Fluentd-endpoint van OneUptime sturen, dat elk record leest zoals de [Fluentd-pagina](/docs/telemetry/fluentd) beschrijft. Zet `format` op `json_lines`, zoals hieronder, of op `json`: OneUptime leest beide, gecomprimeerd met `compress: gzip` of niet. Het standaardformaat van Fluent Bit, `msgpack`, wordt geweigerd.

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

## Zelf gehoste OneUptime

Zet `host` op de host van je OneUptime-instantie. Wordt die via gewone HTTP in plaats van HTTPS aangeboden, zet dan ook `port` op de poort waarop hij luistert (meestal `80`) en verwijder `tls`:

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

## Problemen oplossen

:::details Fluent Bit logt `401` van de OpenTelemetry-output
De ingestiesleutel ontbreekt, is onbekend of verlopen. Controleer de regel `header`: die is `x-oneuptime-token`, een spatie en dan de **Geheime sleutel** van de sleutel.
:::

:::details Fluent Bit logt `402` of `422`
`402`: in OneUptime Cloud zit het project op het Free-abonnement en heeft het geen betaalmethode. Voeg er een toe onder **Projectinstellingen → Facturering en facturen → Facturering**. `422`: de sleutel is uitgeschakeld, of het is een browsersleutel. Zet **Ingeschakeld** weer aan in de instellingen van de sleutel, of maak een **Server**-sleutel.
:::

:::details Logs komen binnen onder een onverwachte service
De service komt uit `service.name`. Controleer of elke input de processor `opentelemetry_envelope` heeft, gevolgd door de `content_modifier` die hem zet.
:::

:::details Er komt niets binnen en Fluent Bit logt verbindingsfouten
Controleer of `tls: On` en `port: 443` zijn ingesteld voor een HTTPS-endpoint, en of de host waarop Fluent Bit draait je OneUptime-host op die poort kan bereiken.
:::

:::details Fluent Bit logt `cannot be retried`
Fluent Bit heeft een chunk weggegooid die het niet kon versturen. Met `retry_limit: 8640`, zoals in de configuratie hierboven, stuurt het een chunk waarop OneUptime `429`, `502`, `503` of `504` antwoordt ongeveer elke 30 seconden opnieuw, ongeveer 72 uur lang; standaard probeert Fluent Bit het nog maar één keer. Een `400`, `401`, `402`, `413`, `422` of `500` wordt meteen weggegooid, omdat het antwoord elke keer hetzelfde is: controleer de sleutel, het abonnement en de grootte van het verzoek.
:::

Heb je vragen of hulp nodig bij de configuratie, mail ons dan op support@oneuptime.com.

## Volgende stappen

:::cards
- [Logboekpipelines](/docs/telemetry/log-pipelines): De logs die Fluent Bit stuurt parsen en verrijken.
- [Zoeksyntaxis](/docs/telemetry/search-syntax): De logs vinden in de logboekexplorer.
- [OpenTelemetry](/docs/telemetry/open-telemetry): Endpoints, sleutels en limieten voor alle telemetrie.
- [Fluentd](/docs/telemetry/fluentd): In plaats daarvan Fluentd gebruiken.
:::
