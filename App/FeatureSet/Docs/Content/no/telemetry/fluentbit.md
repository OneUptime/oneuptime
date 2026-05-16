# Bruk FluentBit til å sende telemetridata til OneUptime

## Oversikt

Du kan bruke [FluentBit](https://docs.fluentbit.io/manual)-pluginen til å samle logger og telemetridata fra applikasjonene og tjenestene dine. Pluginen sender telemetridataene til OneUptime OpenTelemetry HTTP Collector. Du kan bruke opentelemetry-utdatapluginen til FluentBit for å sende telemetridataene til OneUptime OpenTelemetry HTTP Collector. Denne pluginen finner du her: https://docs.fluentbit.io/manual/pipeline/outputs/opentelemetry

## Kom i gang

FluentBit støtter hundrevis av datakilder, og du kan hente inn logger og telemetri fra hvilken som helst av disse kildene til OneUptime. Noen av de populære kildene inkluderer:

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

Du finner den fullstendige listen over støttede kilder [her](https://docs.fluentbit.io/manual)

## Forutsetninger

- **Trinn 1: Installer FluentBit på systemet ditt** – Du kan installere FluentBit ved hjelp av instruksjonene gitt [her](https://docs.fluentbit.io/manual/installation/getting-started-with-fluent-bit)
- **Trinn 2: Registrer deg for OneUptime-konto** – Du kan registrere deg for en gratis konto [her](https://oneuptime.com). Merk at selv om kontoen er gratis, er logginnhenting en betalt funksjon. Du finner mer detaljer om prissetting [her](https://oneuptime.com/pricing).
- **Trinn 3: Opprett OneUptime-prosjekt** – Når du har kontoen, kan du opprette et prosjekt fra OneUptime-dashbordet. Hvis du trenger hjelp med å opprette et prosjekt eller har spørsmål, ta kontakt med oss på support@oneuptime.com
- **Trinn 4: Opprett telemetriinnhentingstoken** – Når du har opprettet en OneUptime-konto, kan du opprette et telemetriinnhentingstoken for å hente inn logger, metrikker og spor fra applikasjonen din.

Etter at du har registrert deg for OneUptime og opprettet et prosjekt, klikker du på "More" i navigasjonslinjen og klikker på "Project Settings".

På siden for Telemetry Ingestion Key, klikk på "Create Ingestion Key" for å opprette et token.

![Opprett tjeneste](/docs/static/images/TelemetryIngestionKeys.png)

Når du har opprettet et token, klikker du på "View" for å se tokenet.

![Vis tjeneste](/docs/static/images/TelemetryIngestionKeyView.png)


## Konfigurasjon

Du kan bruke følgende konfigurasjon for å sende telemetridata til OneUptime OpenTelemetry HTTP Collector. Du kan legge til denne konfigurasjonen i FluentBit-konfigurasjonsfilen. Konfigurasjonsfilen befinner seg vanligvis på `/etc/fluent-bit/fluent-bit.yaml`. Her er hvordan en outputs-seksjon i konfigurasjonsfilen ville sett ut:


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
      - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN

```

Sørg for at du har opentelemetry_envelope i inputs-seksjonen. Her er et eksempel på hvordan inputs-seksjonen ville sett ut:

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
            # Erstatt YOUR_SERVICE_NAME med navnet på tjenesten din
            value: YOUR_SERVICE_NAME
```

Her er et eksempel på en fullstendig konfigurasjonsfil:

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
        - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
```


**Hvis du selvhoster OneUptime**: Hvis du selvhoster OneUptime kan du erstatte `host` med verten til OneUptime-instansen din. Hvis du hostes på en HTTP-server og ikke HTTPS, kan du erstatte `port` med porten til OneUptime-instansen din (sannsynligvis port 80).

I så fall ville konfigurasjonen sett slik ut:

```yaml
outputs:
  - name: stdout
    match: '*'
  - name: opentelemetry
    match: '*'
    host: 'your-oneuptime-instance.com'
    port: 80
    metrics_uri: '/otlp/v1/metrics'
    logs_uri: '/otlp/v1/logs'
    traces_uri: '/otlp/v1/traces'
    header:
      - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
```

## Bruk

Når du har lagt til konfigurasjonen i FluentBit-konfigurasjonsfilen, kan du starte FluentBit-tjenesten på nytt. Når tjenesten er startet på nytt, vil telemetridataene sendes til OneUptime HTTP Source. Du kan nå begynne å se telemetridataene i OneUptime-dashbordet. Hvis du har spørsmål eller trenger hjelp med konfigurasjonen, ta kontakt med oss på support@oneuptime.com
