# Send Syslog-data til OneUptime

## Oversikt

OpenTelemetry Ingest-tjenesten aksepterer nå native Syslog-nyttelaster. Du kan videresende meldinger fra enhver RFC3164- eller RFC5424-kompatibel kilde direkte til OneUptime over HTTPS. OneUptime analyserer syslog-prioritet, facility, alvorlighetsgrad, strukturerte data og meldingskropp før alt lagres som søkbare logger.

## Forutsetninger

- **Telemetriinnhentingstoken** – opprett ett fra *Project Settings → Telemetry Ingestion Keys* og kopier `x-oneuptime-token`-verdien.
- **Syslog-videresender** – et hvilket som helst verktøy som kan sende HTTP POST-forespørsler (for eksempel `curl`, `rsyslog` via `omhttp`, eller `syslog-ng` med HTTP-destinasjonspluginen).
- **Tjenestenavn (valgfritt)** – sett `x-oneuptime-service-name`-hodet for å gruppere innkommende logger under en spesifikk telemetritjeneste. Når utelatt, faller OneUptime tilbake til syslog `APP-NAME`, vertsnavn eller `Syslog`.

## Endepunkt

```
POST https://oneuptime.com/syslog/v1/logs
```

- Erstatt `oneuptime.com` med verten din hvis du selvhoster OneUptime.
- Inkluder alltid `x-oneuptime-token`-hodet i forespørselen.

## Forespørselskropp

Send linjeskift-separerte Syslog-strenger eller en JSON-nyttelast med en `messages`-array. Både RFC3164 (BSD) og RFC5424-formater støttes.

```json
{
  "messages": [
    "<34>1 2025-03-02T14:48:05.003Z web-01 nginx 7421 ID47 [env@32473 host=\"web-01\"] 502 on /api/login",
    "<13>Feb  5 17:32:18 db-01 postgres[2419]: connection received from 10.0.0.12"
  ]
}
```

### Støttede innholdstyper

- `application/json` – anbefalt.
- `text/plain` – linjeskift-separerte meldinger.
- `application/octet-stream` – rå nyttelaster. Gzip-komprimering (`Content-Encoding: gzip`) aksepteres også.

## Rask test med curl

```bash
curl \
  -X POST https://oneuptime.com/syslog/v1/logs \
  -H "Content-Type: application/json" \
  -H "x-oneuptime-token: YOUR_TELEMETRY_KEY" \
  -H "x-oneuptime-service-name: production-web" \
  -d '{
    "messages": [
      "<34>1 2025-03-02T14:48:05.003Z web-01 nginx 7421 ID47 [env@32473 host=\"web-01\"] 502 on /api/login"
    ]
  }'
```

## Videresending fra rsyslog

1. Installer HTTP-utdatamodulen:
   ```bash
   sudo apt-get install rsyslog-omhttp
   ```
2. Legg til destinasjonen i `/etc/rsyslog.d/oneuptime.conf`:
   ```
   module(load="omhttp")

   template(name="OneUptimeJson" type="list") {
     constant(value="{\"messages\":[\"")
     property(name="rawmsg")
     constant(value="\"]}")
   }

   action(
     type="omhttp"
     server="oneuptime.com"
     serverport="443"
     usehttps="on"
     endpoint="/syslog/v1/logs"
     header="Content-Type: application/json"
     header="x-oneuptime-token: YOUR_TELEMETRY_KEY"
     header="x-oneuptime-service-name: rsyslog-demo"
     template="OneUptimeJson"
   )
   ```
3. Start rsyslog på nytt:
   ```bash
   sudo systemctl restart rsyslog
   ```

## Vanlige brukstilfeller vi allerede ser

### 1. Nettverks- og sikkerhetsapparater

De fleste nettverksenheter eksponerer fortsatt konfigurasjonsendringer, ACL-treff og trusselsoppdagelser eksklusivt via syslog. Pek det eksisterende reléet (Palo Alto, Fortinet, Cisco ASA, Juniper, pfSense og mer) direkte til OneUptime, eller behold et internt relé og videresend over HTTPS:

```bash
# rsyslog-snippet som batcher meldinger til JSON og poster til OneUptime
module(load="omhttp")

template(name="OneUptimeJSON" type="list") {
  constant(value="{\"messages\":[\"")
  property(name="rawmsg")
  constant(value="\"]}")
}

action(
  type="omhttp"
  server="oneuptime.com"
  serverport="443"
  usehttps="on"
  endpoint="/syslog/v1/logs"
  header="Content-Type: application/json"
  header="x-oneuptime-token: <TOKEN>"
  header="x-oneuptime-service-name: perimeter-firewall"
  template="OneUptimeJSON"
)
```

### 2. Linux-servere og cron-jobber

Mange cron-jobber og eldre daemons logger fortsatt utelukkende gjennom kernel/syslog-faciliteten. Videresending av `/var/log/syslog` eller journald-oppføringer holder operasjonelle brødspor på ett sted. Systemd-verter kan bruke journald → syslog-broen:

```bash
# /etc/rsyslog.d/oneuptime.conf
module(load="imjournal" StateFile="imjournal.state")
module(load="omhttp")

action(
  type="omhttp"
  server="oneuptime.com"
  serverport="443"
  usehttps="on"
  endpoint="/syslog/v1/logs"
  header="Content-Type: application/json"
  header="x-oneuptime-token: <TOKEN>"
  header="x-oneuptime-service-name: linux-fleet"
  template="OneUptimeJSON"
)
```

Fordi vi mapper alvorlighetskoder, kan du varsle på `syslog.severity.name = "error"` eller skjære etter `syslog.hostname` for raskt å isolere støyende maskiner.

### 3. Kubernetes inngangs-kontrollere og kantnoder

Hvis du allerede kjører Fluent Bit eller Fluentd, behold dem for container-logger og legg til en lettvekts syslog-synke for verter eller apparater ved kanten. Fluent Bits `syslog`-inndata pares med HTTP-utdata:

```ini
[INPUT]
    Name              syslog
    Mode              tcp
    Listen            0.0.0.0
    Port              5140

[OUTPUT]
    Name              http
    Match             *
    Host              oneuptime.com
    Port              443
    URI               /syslog/v1/logs
    Format            json
    json_date_key     time
    Header            Content-Type application/json
    Header            x-oneuptime-token <TOKEN>
    Header            x-oneuptime-service-name edge-ingress
    tls               On
```

Dette oppsettet lar deg hente inn syslog fra bare-metal-arbeidere eller maskinvare-lastbalansere uten å opprette en ny loggingstakk.

### 4. Samsvararkiver uten ventetid

Trenger du å beholde brannmurlogger for PCI eller SOX? Send dem rett til OneUptime, bruk en lang oppbevaringspolicy for telemetritjenesten og eksporter til kaldlagring fra ett enkelt sted. Ingen mer eksportering fra flere syslog-reléer.

## Analyserte attributter

OneUptime legger automatisk til følgende attributter til hver loggoppføring:

- `syslog.priority`, `syslog.facility.code`, `syslog.facility.name`
- `syslog.severity.code`, `syslog.severity.name`
- `syslog.hostname`, `syslog.appName`, `syslog.processId`, `syslog.messageId`
- `syslog.structured.*` (flattet RFC5424-strukturerte data)
- `syslog.raw` (opprinnelig melding for sporbarhet)

Disse attributtene blir søkbare inne i Telemetry → Logs explorer.

## Feilsøking

- **HTTP 401 eller tomme resultater** – verifiser at `x-oneuptime-token`-hodet tilhører prosjektet som mottar loggene.
- **Ingen logger vises** – bekreft at forespørselskroppen faktisk inneholder syslog-linjer. Tomme kropper avvises med HTTP 400.
- **Uventet tjenestenavn** – sett `x-oneuptime-service-name` for å overstyre standard deteksjonslogikken.
- **Store burster** – batching av opptil 1 000 linjer per forespørsel støttes. Større burster settes i kø og behandles asynkront.
