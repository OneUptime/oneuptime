# Brug Fluentd til at sende telemetridata til OneUptime

## Oversigt

Du kan bruge [Fluentd](https://www.fluentd.org/)-pluginnet til at indsamle logs og telemetridata fra dine applikationer og tjenester. Pluginnet sender telemetridataene til OneUptime HTTP Source. Du kan bruge http-outputpluginnet til fluentd til at sende telemetridataene til OneUptime HTTP Source. Dette plugin kan findes her: https://docs.fluentd.org/output/http

## Kom i gang

Fluentd understøtter hundredvis af datakilder, og du kan indsamle logs fra enhver af disse kilder til OneUptime. Nogle af de populære kilder inkluderer:

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

Du kan finde den fulde liste over understøttede kilder [her](https://www.fluentd.org/datasources)

## Forudsætninger

- **Trin 1: Installer Fluentd på dit system** – Du kan installere Fluentd ved hjælp af instruktionerne [her](https://docs.fluentd.org/installation)
- **Trin 2: Tilmeld dig OneUptime-konto** – Du kan tilmelde dig en gratis konto [her](https://oneuptime.com). Bemærk, at mens kontoen er gratis, er logindtagelse en betalt funktion. Du kan finde flere detaljer om priser [her](https://oneuptime.com/pricing).
- **Trin 3: Opret OneUptime-projekt** – Når du har kontoen, kan du oprette et projekt fra OneUptime-dashboardet. Hvis du har brug for hjælp til at oprette et projekt eller har spørgsmål, bedes du kontakte os på support@oneuptime.com
- **Trin 4: Opret Telemetry Ingestion Token** – Når du har oprettet en OneUptime-konto, kan du oprette et telemetriindtagelsestoken til at indsamle logs, metrikker og traces fra din applikation.

Når du har tilmeldt dig OneUptime og oprettet et projekt, skal du klikke på "Mere" i navigationslinjen og klikke på "Projektindstillinger".

På siden Telemetry Ingestion Key skal du klikke på "Opret indtagelsesnøgle" for at oprette et token.

![Opret tjeneste](/docs/static/images/TelemetryIngestionKeys.png)

Når du har oprettet et token, skal du klikke på "Vis" for at se tokenet.

![Vis tjeneste](/docs/static/images/TelemetryIngestionKeyView.png)

## Konfiguration

Du kan bruge følgende konfiguration til at sende telemetridataene til OneUptime HTTP Source. Du kan tilføje denne konfiguration til fluentd-konfigurationsfilen. Konfigurationsfilen er normalt placeret på `/etc/fluentd/fluent.conf` eller `/etc/td-agent/td-agent.conf`.

Du skal erstatte `YOUR_SERVICE_TOKEN` med det token, du oprettede i det forrige trin. Du skal også erstatte `YOUR_SERVICE_NAME` med navnet på din tjeneste. Tjenestenavnet kan være et hvilket som helst navn du ønsker. Hvis tjenesten ikke eksisterer i OneUptime, oprettes den automatisk.

```yaml
# Match alle mønstre
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

Et eksempel på en komplet konfigurationsfil er vist nedenfor:

```yaml
####
## Kildesbeskrivelser:
##

## Indbygget TCP-input
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

**Hvis du selvhoster OneUptime**: Hvis du selvhoster OneUptime, kan du erstatte `endpoint_url` med URL'en til din OneUptime-instans. `http(s)://YOUR_ONEUPTIME_HOST/fluentd/logs`

## Brug

Når du har tilføjet konfigurationen til fluentd-konfigurationsfilen, kan du genstarte fluentd-servicen. Når servicen er genstartet, sendes telemetridataene til OneUptime HTTP Source. Du kan nu begynde at se telemetridataene i OneUptime-dashboardet. Hvis du har spørgsmål eller brug for hjælp til konfigurationen, bedes du kontakte os på support@oneuptime.com
