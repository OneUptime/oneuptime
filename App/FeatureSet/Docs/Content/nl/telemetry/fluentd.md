# Fluentd gebruiken om telemetriegegevens naar OneUptime te sturen

## Overzicht

U kunt de [Fluentd](https://www.fluentd.org/)-plugin gebruiken om logboeken en telemetriegegevens te verzamelen van uw applicaties en diensten. De plugin stuurt de telemetriegegevens naar de OneUptime HTTP-bron. U kunt de http-uitvoerplugin van Fluentd gebruiken om de telemetriegegevens naar de OneUptime HTTP-bron te sturen. Deze plugin is hier te vinden: https://docs.fluentd.org/output/http

## Aan de slag

Fluentd ondersteunt honderden gegevensbronnen en u kunt logboeken van elk van deze bronnen verwerken in OneUptime. Enkele populaire bronnen zijn:

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

U vindt de volledige lijst met ondersteunde bronnen [hier](https://www.fluentd.org/datasources)

## Vereisten

- **Stap 1: Fluentd installeren op uw systeem** - U kunt Fluentd installeren aan de hand van de instructies [hier](https://docs.fluentd.org/installation)
- **Stap 2: Een OneUptime-account aanmaken** - U kunt een gratis account aanmaken [hier](https://oneuptime.com). Houd er rekening mee dat hoewel het account gratis is, logboekingestie een betaalde functie is. U kunt meer informatie over de prijzen vinden [hier](https://oneuptime.com/pricing).
- **Stap 3: OneUptime-project aanmaken** - Zodra u het account heeft, kunt u een project aanmaken vanuit het OneUptime-dashboard. Als u hulp nodig heeft bij het aanmaken van een project of vragen heeft, neem dan contact op via support@oneuptime.com
- **Stap 4: Telemetrie-ingestietoken aanmaken** - Zodra u een OneUptime-account heeft aangemaakt, kunt u een telemetrie-ingestietoken aanmaken om logboeken, metrics en traces van uw applicatie te verwerken.

Nadat u zich hebt aangemeld bij OneUptime en een project hebt aangemaakt, klikt u op "Meer" in de navigatiebalk en vervolgens op "Projectinstellingen".

Klik op de pagina Telemetrie-ingestiesleutel op "Ingestiesleutel aanmaken" om een token aan te maken.

![Dienst aanmaken](/docs/static/images/TelemetryIngestionKeys.png)

Zodra u een token hebt aangemaakt, klikt u op "Bekijken" om het token te bekijken.

![Dienst bekijken](/docs/static/images/TelemetryIngestionKeyView.png)

## Configuratie

U kunt de volgende configuratie gebruiken om de telemetriegegevens naar de OneUptime HTTP-bron te sturen. U kunt deze configuratie toevoegen aan het Fluentd-configuratiebestand. Het configuratiebestand bevindt zich doorgaans op `/etc/fluentd/fluent.conf` of `/etc/td-agent/td-agent.conf`.

U moet `YOUR_SERVICE_TOKEN` vervangen door het token dat u in de vorige stap hebt aangemaakt. U moet ook `YOUR_SERVICE_NAME` vervangen door de naam van uw dienst. De naam van de dienst kan elke naam zijn die u wilt. Als de dienst niet bestaat in OneUptime, wordt deze automatisch aangemaakt.

```yaml
# Overeenkomt met alle patronen
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

Een voorbeeld van een volledig configuratiebestand wordt hieronder getoond:

```yaml
####
## Bronbeschrijvingen:
##

## ingebouwde TCP-invoer
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

**Als u OneUptime zelf host**: Als u OneUptime zelf host, kunt u de `endpoint_url` vervangen door de URL van uw OneUptime-instantie. `http(s)://YOUR_ONEUPTIME_HOST/fluentd/logs`

## Gebruik

Zodra u de configuratie aan het Fluentd-configuratiebestand hebt toegevoegd, kunt u de Fluentd-dienst herstarten. Zodra de dienst is herstart, worden de telemetriegegevens naar de OneUptime HTTP-bron gestuurd. U kunt nu de telemetriegegevens zien in het OneUptime-dashboard. Als u vragen heeft of hulp nodig heeft bij de configuratie, neem dan contact op via support@oneuptime.com
