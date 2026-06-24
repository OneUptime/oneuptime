# Bruk Fluentd til å sende telemetridata til OneUptime

## Oversikt

Du kan bruke [Fluentd](https://www.fluentd.org/)-pluginen til å samle logger og telemetridata fra applikasjonene og tjenestene dine. Pluginen sender telemetridataene til OneUptime HTTP Source. Du kan bruke http-utdatapluginen til Fluentd for å sende telemetridataene til OneUptime HTTP Source. Denne pluginen finner du her: https://docs.fluentd.org/output/http

## Kom i gang

Fluentd støtter hundrevis av datakilder, og du kan hente inn logger fra hvilken som helst av disse kildene til OneUptime. Noen av de populære kildene inkluderer:

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

Du finner den fullstendige listen over støttede kilder [her](https://www.fluentd.org/datasources)

## Forutsetninger

- **Trinn 1: Installer Fluentd på systemet ditt** – Du kan installere Fluentd ved hjelp av instruksjonene gitt [her](https://docs.fluentd.org/installation)
- **Trinn 2: Registrer deg for OneUptime-konto** – Du kan registrere deg for en gratis konto [her](https://oneuptime.com). Merk at selv om kontoen er gratis, er logginnhenting en betalt funksjon. Du finner mer detaljer om prissetting [her](https://oneuptime.com/pricing).
- **Trinn 3: Opprett OneUptime-prosjekt** – Når du har kontoen, kan du opprette et prosjekt fra OneUptime-dashbordet. Hvis du trenger hjelp med å opprette et prosjekt eller har spørsmål, ta kontakt med oss på support@oneuptime.com
- **Trinn 4: Opprett telemetriinnhentingstoken** – Når du har opprettet en OneUptime-konto, kan du opprette et telemetriinnhentingstoken for å hente inn logger, metrikker og spor fra applikasjonen din.

Etter at du har registrert deg for OneUptime og opprettet et prosjekt, klikker du på "More" i navigasjonslinjen og klikker på "Project Settings".

På siden for Telemetry Ingestion Key, klikk på "Create Ingestion Key" for å opprette et token.

![Opprett tjeneste](/docs/static/images/TelemetryIngestionKeys.png)

Når du har opprettet et token, klikker du på "View" for å se tokenet.

![Vis tjeneste](/docs/static/images/TelemetryIngestionKeyView.png)

## Konfigurasjon

Du kan bruke følgende konfigurasjon for å sende telemetridata til OneUptime HTTP Source. Du kan legge til denne konfigurasjonen i Fluentd-konfigurasjonsfilen. Konfigurasjonsfilen befinner seg vanligvis på `/etc/fluentd/fluent.conf` eller `/etc/td-agent/td-agent.conf`.

Du må erstatte `YOUR_SERVICE_TOKEN` med tokenet du opprettet i forrige trinn. Du må også erstatte `YOUR_SERVICE_NAME` med navnet på tjenesten din. Tjenestens navn kan være et hvilket som helst navn du liker. Hvis tjenesten ikke eksisterer i OneUptime, vil den opprettes automatisk.

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

Et eksempel på en fullstendig konfigurasjonsfil er vist nedenfor:

```yaml
####
## Kildebeskrivelser:
##

## innebygd TCP-inndata
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

**Hvis du selvhoster OneUptime**: Hvis du selvhoster OneUptime kan du erstatte `endpoint_url` med URL-en til din OneUptime-instans. `http(s)://YOUR_ONEUPTIME_HOST/fluentd/logs`

## Bruk

Når du har lagt til konfigurasjonen i Fluentd-konfigurasjonsfilen, kan du starte Fluentd-tjenesten på nytt. Når tjenesten er startet på nytt, vil telemetridataene sendes til OneUptime HTTP Source. Du kan nå begynne å se telemetridataene i OneUptime-dashbordet. Hvis du har spørsmål eller trenger hjelp med konfigurasjonen, ta kontakt med oss på support@oneuptime.com
