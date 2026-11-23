# Fluent Bit

[Fluent Bit](https://docs.fluentbit.io/manual) er en let agent, der indsamler logs fra filer, systemd, containere, syslog, HTTP og mange andre kilder. Dens [OpenTelemetry-output](https://docs.fluentbit.io/manual/pipeline/outputs/opentelemetry) sender det indsamlede til OneUptimes OpenTelemetry-endpoint (OTLP), hvor loggene bliver søgbare under **Produkter → Protokoller**.

:::cards
- [Konfigurér Fluent Bit](#konfigurér-fluent-bit): Tilføj OpenTelemetry-outputtet, og navngiv din tjeneste.
- [Komplet eksempel](#komplet-eksempel): En hel konfigurationsfil at starte fra.
- [Selvhostet OneUptime](#selvhostet-oneuptime): Peg Fluent Bit på din egen instans.
:::

## Sådan virker det

```mermaid title="Fra Fluent Bit til OneUptime"
flowchart TB
    sources["Filer, containere, syslog, HTTP"] --> inputs["Fluent Bit-inputs"]
    inputs --> envelope["Processoren opentelemetry_envelope"]
    envelope --> name["content_modifier sætter service.name"]
    name --> output["Outputtet opentelemetry"]
    output -->|"OTLP/HTTP + indtagelsesnøgle"| oneuptime["OneUptime /otlp/v1/logs"]
    oneuptime --> logs["Logs"]
```

Fluent Bit pakker hver post ind i en OpenTelemetry-konvolut, så den kan bære ressourceattributter som `service.name`. OpenTelemetry-outputtet sender derefter posterne til OneUptime med din indtagelsesnøgle i headeren `x-oneuptime-token`. OneUptime gemmer dem under den tjeneste, `service.name` angiver, og opretter tjenesten første gang, den sender.

## Før du begynder

- **Installér Fluent Bit** – se [installationsvejledningen](https://docs.fluentbit.io/manual/installation/getting-started-with-fluent-bit). Konfigurationen på denne side bruger Fluent Bits YAML-format og processoren `opentelemetry_envelope`, så brug en aktuel version.
- **Et OneUptime-projekt.** I OneUptime Cloud afregnes telemetri pr. indtaget GB – se [priser](https://oneuptime.com/pricing) – og et projekt på Free-planen skal have en betalingsmetode, før det kan sende telemetri.
- **En indtagelsesnøgle til telemetri.** Hvis du ikke har en:

:::steps
### Åbn indtagelsesnøglerne

Gå til **Produkter → Projektindstillinger**, åbn **Telemetri og APM** i sidemenuen, og vælg **Indtagelsesnøgler**.

![Listen »Indtagelsesnøgler«, med »Opret indtagelsesnøgle« fremhævet](screen:ingestion-keys)

### Opret en nøgle

Klik på **Opret indtagelsesnøgle**. Dialogen har allerede udfyldt nøglens navn og valgt **Server** – den slags nøgle, en applikation eller en collector sender med – så klik på **Opret indtagelsesnøgle** for at oprette den, eller omdøb den først.

### Kopiér hemmeligheden

Den nye nøgle åbner på sin egen side. Kopiér dens **Hemmelig nøgle**: Det er `YOUR_TELEMETRY_INGESTION_TOKEN` i konfigurationen nedenfor.

![Siden for en telemetri-indtagelsesnøgle med dens hemmelige nøgle](/docs/static/images/TelemetryIngestionKeyView.png)
:::

## Konfigurér Fluent Bit

Fluent Bit læser sin YAML-konfiguration fra en fil som `/etc/fluent-bit/fluent-bit.yaml`.

:::steps
### Tilføj OpenTelemetry-outputtet

Tilføj et `opentelemetry`-output, der sender til OneUptime. Behold `stdout`-outputtet, mens du tester, hvis du vil se posterne lokalt:

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

`retry_limit: 8640` sender en chunk igen, når OneUptime har travlt (`429`) eller genstarter (`502`, `503`, `504`), cirka hvert 30. sekund (`scheduler.base` og `scheduler.cap`), i cirka 72 timer; Fluent Bits standard er at prøve én gang til og så smide den væk. `storage.path` gemmer de chunks, der endnu skal sendes, på disken, så en genstart af Fluent Bit ikke mister nogen af dem, for hvert input med `storage.type: filesystem`, som i næste trin. Fluent Bit skal kunne skrive i den mappe: pakkens tjeneste kører som root, og i hånden kører du den med `sudo`. `storage.total_limit_size: 512M` gemmer højst 512 MB til outputtet; når det er fuldt, smides de ældste chunks væk.

### Pak logs ind i en OpenTelemetry-konvolut, og navngiv tjenesten

Tilføj processoren `opentelemetry_envelope` til hvert input, efterfulgt af en `content_modifier`, der sætter `service.name`. Erstat `YOUR_SERVICE_NAME` med det navn, loggene skal vises under i OneUptime:

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

`db` gemmer tailens plads i hver fil, så en genstart læser videre derfra; uden den starter Fluent Bit forfra ved slutningen af hver fil, og de linjer, der blev skrevet, mens den var nede, sendes aldrig. `storage.type: filesystem` gemmer inputtets chunks i `storage.path`.

### Genstart Fluent Bit

Tjenesten i pakken `fluent-bit` læser `/etc/fluent-bit/fluent-bit.conf`, pakkens eget eksempel, ikke denne fil. Peg den på `/etc/fluent-bit/fluent-bit.yaml` med en drop-in, og start den så nu og ved hver opstart:

```bash
sudo mkdir -p /etc/systemd/system/fluent-bit.service.d
printf '[Service]\nExecStart=\nExecStart=/opt/fluent-bit/bin/fluent-bit -c /etc/fluent-bit/fluent-bit.yaml\n' | sudo tee /etc/systemd/system/fluent-bit.service.d/fluent-bit-yaml.conf
sudo systemctl daemon-reload
sudo systemctl enable fluent-bit
sudo systemctl restart fluent-bit
```

Den tomme `ExecStart=` rydder pakkens egen startlinje. Vil du først prøve filen i forgrunden, så kør `sudo /opt/fluent-bit/bin/fluent-bit -c /etc/fluent-bit/fluent-bit.yaml`: pakken lægger programmet i `/opt/fluent-bit/bin`, som ikke er på `PATH`. Efter få sekunder vises loggene under **Produkter → Protokoller**, og tjenesten står under **Produkter → Tjenester**.
:::

## Komplet eksempel

Denne konfiguration modtager logs over HTTP på port `8888`, kun fra denne vært, og sender dem videre til OneUptime:

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

`listen: 127.0.0.1` tager kun imod logs fra denne vært: `http`-inputtet beder ikke om nogen nøgle, så med `listen: 0.0.0.0` kan alle, der kan nå porten, sende logs til OneUptime under din indtagelsesnøgle. Erstat `http`-inputtet med de inputs, du har brug for – for eksempel `tail` til logfiler eller `systemd` til journalen – og behold de to processorer og `storage.type: filesystem` på hvert af dem.

## Send med HTTP-outputtet

Fluent Bits [HTTP-output](https://docs.fluentbit.io/manual/pipeline/outputs/http) kan også sende til OneUptimes Fluentd-endpoint, som læser hver post, som [Fluentd-siden](/docs/telemetry/fluentd) beskriver. Sæt `format` til `json_lines`, som nedenfor, eller til `json`: OneUptime læser begge, komprimeret med `compress: gzip` eller ej. Fluent Bits standardformat, `msgpack`, afvises.

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

Sæt `host` til værten for din OneUptime-instans. Hvis den betjenes over almindelig HTTP i stedet for HTTPS, skal du også sætte `port` til den port, den lytter på (normalt `80`), og fjerne `tls`:

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

## Fejlfinding

:::details Fluent Bit logger `401` fra OpenTelemetry-outputtet
Indtagelsesnøglen mangler, er ukendt eller udløbet. Tjek `header`-linjen: Den er `x-oneuptime-token`, et mellemrum og derefter nøglens **Hemmelig nøgle**.
:::

:::details Fluent Bit logger `402` eller `422`
`402`: I OneUptime Cloud er projektet på Free-planen og har ingen betalingsmetode. Tilføj en under **Projektindstillinger → Fakturering og fakturaer → Fakturering**. `422`: Nøglen er deaktiveret, eller det er en browsernøgle. Slå **Aktiveret** til igen i nøglens indstillinger, eller opret en **Server**-nøgle.
:::

:::details Logs ankommer under en uventet tjeneste
Tjenesten kommer fra `service.name`. Tjek, at hvert input har processoren `opentelemetry_envelope` efterfulgt af den `content_modifier`, der sætter den.
:::

:::details Intet ankommer, og Fluent Bit logger forbindelsesfejl
Tjek, at `tls: On` og `port: 443` er sat for et HTTPS-endpoint, og at værten, der kører Fluent Bit, kan nå din OneUptime-vært på den port.
:::

:::details Fluent Bit logger `cannot be retried`
Fluent Bit smed en chunk væk, som den ikke kunne sende. Med `retry_limit: 8640`, som i konfigurationen ovenfor, sender den en chunk, som OneUptime svarer `429`, `502`, `503` eller `504` på, igen cirka hvert 30. sekund i cirka 72 timer; med Fluent Bits standard prøver den én gang til. En `400`, `401`, `402`, `413`, `422` eller `500` smides væk med det samme, da svaret er det samme hver gang: tjek nøglen, abonnementet og anmodningens størrelse.
:::

Har du spørgsmål eller brug for hjælp med konfigurationen, så skriv til os på support@oneuptime.com.

## Næste trin

:::cards
- [Logpipelines](/docs/telemetry/log-pipelines): Fortolk og berig de logs, Fluent Bit sender.
- [Søgesyntaks](/docs/telemetry/search-syntax): Find loggene i log-exploreren.
- [OpenTelemetry](/docs/telemetry/open-telemetry): Endpoints, nøgler og grænser for al telemetri.
- [Fluentd](/docs/telemetry/fluentd): Brug Fluentd i stedet.
:::
