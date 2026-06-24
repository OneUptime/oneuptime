# Brug FluentBit til at sende telemetridata til OneUptime

## Oversigt

Du kan bruge [FluentBit](https://docs.fluentbit.io/manual)-pluginnet til at indsamle logs og telemetridata fra dine applikationer og tjenester. Pluginnet sender telemetridataene til OneUptime OpenTelemetry HTTP Collector. Du kan bruge opentelemetry-outputpluginnet til fluentbit til at sende telemetridataene til OneUptime OpenTelemetry HTTP Collector. Dette plugin kan findes her: https://docs.fluentbit.io/manual/pipeline/outputs/opentelemetry

## Kom i gang

FluentBit understøtter hundredvis af datakilder, og du kan indsamle logs og telemetri fra enhver af disse kilder til OneUptime. Nogle af de populære kilder inkluderer:

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

og mange flere.

Du kan finde den fulde liste over understøttede kilder [her](https://docs.fluentbit.io/manual)

## Forudsætninger

- **Trin 1: Installer FluentBit på dit system** – Du kan installere FluentBit ved hjælp af instruktionerne [her](https://docs.fluentbit.io/manual/installation/getting-started-with-fluent-bit)
- **Trin 2: Tilmeld dig OneUptime-konto** – Du kan tilmelde dig en gratis konto [her](https://oneuptime.com). Bemærk, at mens kontoen er gratis, er logindtagelse en betalt funktion. Du kan finde flere detaljer om priser [her](https://oneuptime.com/pricing).
- **Trin 3: Opret OneUptime-projekt** – Når du har kontoen, kan du oprette et projekt fra OneUptime-dashboardet. Hvis du har brug for hjælp til at oprette et projekt eller har spørgsmål, bedes du kontakte os på support@oneuptime.com
- **Trin 4: Opret Telemetry Ingestion Token** – Når du har oprettet en OneUptime-konto, kan du oprette et telemetriindtagelsestoken til at indsamle logs, metrikker og traces fra din applikation.

Når du har tilmeldt dig OneUptime og oprettet et projekt, skal du klikke på "Mere" i navigationslinjen og klikke på "Projektindstillinger".

På siden Telemetry Ingestion Key skal du klikke på "Opret indtagelsesnøgle" for at oprette et token.

![Opret tjeneste](/docs/static/images/TelemetryIngestionKeys.png)

Når du har oprettet et token, skal du klikke på "Vis" for at se tokenet.

![Vis tjeneste](/docs/static/images/TelemetryIngestionKeyView.png)

## Konfiguration

Du kan bruge følgende konfiguration til at sende telemetridataene til OneUptime OpenTelemetry HTTP Collector. Du kan tilføje denne konfiguration til fluentbit-konfigurationsfilen. Konfigurationsfilen er normalt placeret på `/etc/fluent-bit/fluent-bit.yaml`. Her er, hvordan et outputs-afsnit i konfigurationsfilen ville se ud:

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

Sørg for, at du har opentelemetry_envelope i dit input-afsnit. Her er et eksempel på, hvordan input-afsnittet ville se ud:

```yaml
pipeline:
  inputs:
    # Dine inputs

    processors:
      logs:
        - name: opentelemetry_envelope

        - name: content_modifier
          context: otel_resource_attributes
          action: upsert
          key: service.name
          # Erstat YOUR_SERVICE_NAME med navnet på din tjeneste
          value: YOUR_SERVICE_NAME
```

Her er den komplette eksempelkonfigurationsfil:

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

**Hvis du selvhoster OneUptime**: Hvis du selvhoster OneUptime, kan du erstatte `host` med hosten på din OneUptime-instans. Hvis du hoster på en HTTP-server og ikke HTTPS, kan du erstatte `port` med porten på din OneUptime-instans (sandsynligvis port 80).

I dette tilfælde ville konfigurationen se sådan ud:

```yaml
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
```

## Brug

Når du har tilføjet konfigurationen til fluentbit-konfigurationsfilen, kan du genstarte fluentbit-servicen. Når servicen er genstartet, sendes telemetridataene til OneUptime HTTP Source. Du kan nu begynde at se telemetridataene i OneUptime-dashboardet. Hvis du har spørgsmål eller brug for hjælp til konfigurationen, bedes du kontakte os på support@oneuptime.com
