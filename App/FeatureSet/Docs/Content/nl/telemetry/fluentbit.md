# FluentBit gebruiken om telemetriegegevens naar OneUptime te sturen

## Overzicht

U kunt de [FluentBit](https://docs.fluentbit.io/manual)-plugin gebruiken om logboeken en telemetriegegevens te verzamelen van uw applicaties en diensten. De plugin stuurt de telemetriegegevens naar de OneUptime OpenTelemetry HTTP Collector. U kunt de opentelemetry-uitvoerplugin van FluentBit gebruiken om de telemetriegegevens naar de OneUptime OpenTelemetry HTTP Collector te sturen. Deze plugin is hier te vinden: https://docs.fluentbit.io/manual/pipeline/outputs/opentelemetry

## Aan de slag

FluentBit ondersteunt honderden gegevensbronnen en u kunt logboeken en telemetrie van elk van deze bronnen verwerken in OneUptime. Enkele populaire bronnen zijn:

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

en nog veel meer.

U vindt de volledige lijst met ondersteunde bronnen [hier](https://docs.fluentbit.io/manual)

## Vereisten

- **Stap 1: FluentBit installeren op uw systeem** - U kunt FluentBit installeren aan de hand van de instructies [hier](https://docs.fluentbit.io/manual/installation/getting-started-with-fluent-bit)
- **Stap 2: Een OneUptime-account aanmaken** - U kunt een gratis account aanmaken [hier](https://oneuptime.com). Houd er rekening mee dat hoewel het account gratis is, logboekingestie een betaalde functie is. U kunt meer informatie over de prijzen vinden [hier](https://oneuptime.com/pricing).
- **Stap 3: OneUptime-project aanmaken** - Zodra u het account heeft, kunt u een project aanmaken vanuit het OneUptime-dashboard. Als u hulp nodig heeft bij het aanmaken van een project of vragen heeft, neem dan contact op via support@oneuptime.com
- **Stap 4: Telemetrie-ingestietoken aanmaken** - Zodra u een OneUptime-account heeft aangemaakt, kunt u een telemetrie-ingestietoken aanmaken om logboeken, metrics en traces van uw applicatie te verwerken.

Nadat u zich hebt aangemeld bij OneUptime en een project hebt aangemaakt, klikt u op "Meer" in de navigatiebalk en vervolgens op "Projectinstellingen".

Klik op de pagina Telemetrie-ingestiesleutel op "Ingestiesleutel aanmaken" om een token aan te maken.

![Dienst aanmaken](/docs/static/images/TelemetryIngestionKeys.png)

Zodra u een token hebt aangemaakt, klikt u op "Bekijken" om het token te bekijken.

![Dienst bekijken](/docs/static/images/TelemetryIngestionKeyView.png)

## Configuratie

U kunt de volgende configuratie gebruiken om de telemetriegegevens naar de OneUptime OpenTelemetry HTTP Collector te sturen. U kunt deze configuratie toevoegen aan het FluentBit-configuratiebestand. Het configuratiebestand bevindt zich doorgaans op `/etc/fluent-bit/fluent-bit.yaml`. Zo ziet een uitvoersectie van het configuratiebestand eruit:

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

Zorg dat u opentelemetry_envelope in uw invoersectie heeft. Hier is een voorbeeld van hoe de invoersectie eruit zou zien:

```yaml
pipeline:
  inputs:
    # Uw invoer

    processors:
      logs:
        - name: opentelemetry_envelope

        - name: content_modifier
          context: otel_resource_attributes
          action: upsert
          key: service.name
          # Vervang YOUR_SERVICE_NAME door de naam van uw dienst
          value: YOUR_SERVICE_NAME
```

Hier is het voorbeeld van een volledig configuratiebestand:

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

**Als u OneUptime zelf host**: Als u OneUptime zelf host, kunt u de `host` vervangen door de host van uw OneUptime-instantie. Als u op een http-server host en niet https, kunt u de `port` vervangen door de poort van uw OneUptime-instantie (waarschijnlijk poort 80).

In dat geval ziet de configuratie er als volgt uit:

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

## Gebruik

Zodra u de configuratie aan het FluentBit-configuratiebestand hebt toegevoegd, kunt u de FluentBit-dienst herstarten. Zodra de dienst is herstart, worden de telemetriegegevens naar de OneUptime HTTP-bron gestuurd. U kunt nu de telemetriegegevens zien in het OneUptime-dashboard. Als u vragen heeft of hulp nodig heeft bij de configuratie, neem dan contact op via support@oneuptime.com
