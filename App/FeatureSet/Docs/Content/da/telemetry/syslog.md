# Send Syslog-data til OneUptime

## Oversigt

OpenTelemetry Ingest-servicen accepterer nu native Syslog-nyttelaster. Du kan videresende meddelelser fra enhver RFC3164- eller RFC5424-kompatibel kilde direkte til OneUptime over HTTPS. OneUptime analyserer syslog-prioritet, facilitet, alvorlighed, strukturerede data og meddelelseskrop, inden alt gemmes som søgbare logs.

## Forudsætninger

- **Telemetry Ingestion Token** – Opret et fra *Projektindstillinger → Telemetry Ingestion Keys* og kopiér `x-oneuptime-token`-værdien.
- **Syslog-videresender** – Ethvert værktøj, der kan sende HTTP POST-anmodninger (f.eks. `curl`, `rsyslog` via `omhttp` eller `syslog-ng` med HTTP-destinations-pluginnet).
- **Tjenestenavn (valgfrit)** – Indstil `x-oneuptime-service-name`-headeren for at gruppere indgående logs under en specifik telemetritjeneste. Når udeladt, falder OneUptime tilbage til syslog-`APP-NAME`, hostnavn eller `Syslog`.

## Endpoint

```
POST https://oneuptime.com/syslog/v1/logs
```

- Erstat `oneuptime.com` med din host, hvis du selvhoster OneUptime.
- Inkludér altid `x-oneuptime-token`-headeren i anmodningen.

## Anmodningsindhold

Send nylinjeafgrænsede Syslog-strenge eller en JSON-nyttelast med et `messages`-array. Både RFC3164 (BSD) og RFC5424-formater understøttes.

```json
{
  "messages": [
    "<34>1 2025-03-02T14:48:05.003Z web-01 nginx 7421 ID47 [env@32473 host=\"web-01\"] 502 on /api/login",
    "<13>Feb  5 17:32:18 db-01 postgres[2419]: connection received from 10.0.0.12"
  ]
}
```

### Understøttede indholdstyper

- `application/json` – Anbefalet.
- `text/plain` – Nylinjeadskilte meddelelser.
- `application/octet-stream` – Råe nyttelaster. Gzip-komprimering (`Content-Encoding: gzip`) accepteres også.

## Hurtig test med curl

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

## Videresendelse fra rsyslog

1. Installer HTTP-outputmodulet:
   ```bash
   sudo apt-get install rsyslog-omhttp
   ```
2. Tilføj destinationen til `/etc/rsyslog.d/oneuptime.conf`:
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
3. Genstart rsyslog:
   ```bash
   sudo systemctl restart rsyslog
   ```

## Almindelige brugsscenarier, vi allerede ser

### 1. Netværks- og sikkerhedsapparater

De fleste netværksenheder eksponerer stadig konfigurationsændringer, ACL-hits og trusselsdetektion udelukkende over syslog. Peg din eksisterende relay (Palo Alto, Fortinet, Cisco ASA, Juniper, pfSense og mere) direkte mod OneUptime, eller behold en intern relay og videresend over HTTPS:

```bash
# rsyslog-snippet, der batcher meddelelser til JSON og poster til OneUptime
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

### 2. Linux-servere og cron-jobs

Mange cron-jobs og ældre dæmoner logger stadig udelukkende via kernel/syslog-faciliteten. Videresendelse af `/var/log/syslog` eller journald-poster holder operationelle brødkrummer ét sted. Systemd-hosts kan stole på journald → syslog-broen:

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

Da vi mapper alvorlighedskoder, kan du advare på `syslog.severity.name = "error"` eller skære efter `syslog.hostname` for hurtigt at isolere støjende bokse.

### 3. Kubernetes ingress-controllere og edge-noder

Hvis du allerede kører Fluent Bit eller Fluentd, skal du holde dem til container-logs og tilføje en letvægts syslog-vask til hosts eller apparater ved kanten. Fluent Bits `syslog`-input parres med HTTP-outputtet:

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

Denne opsætning lader dig indsamle syslog fra bare-metal-arbejdere eller hardware load balancers uden at oprette en anden log-stak.

### 4. Compliance-arkiver uden ventetiden

Har du brug for at opbevare firewall-logs til PCI eller SOX? Send dem direkte til OneUptime, anvend en lang opbevaringsperiode på telemetritjenesten og eksporter til kold lagring fra ét sted. Ingen mere eksport fra flere syslog-relayer.

## Analyserede attributter

OneUptime tilføjer automatisk følgende attributter til hver logpost:

- `syslog.priority`, `syslog.facility.code`, `syslog.facility.name`
- `syslog.severity.code`, `syslog.severity.name`
- `syslog.hostname`, `syslog.appName`, `syslog.processId`, `syslog.messageId`
- `syslog.structured.*` (fladtrykt RFC5424 strukturerede data)
- `syslog.raw` (original meddelelse til sporbarhed)

Disse attributter bliver søgbare inde i Telemetri → Log-stifinder.

## Fejlfinding

- **HTTP 401 eller tomme resultater** – Bekræft, at `x-oneuptime-token`-headeren tilhører det projekt, der modtager loggene.
- **Ingen logs vises** – Bekræft, at anmodningsindholdet faktisk indeholder syslog-linjer. Tomme kroppe afvises med HTTP 400.
- **Uventet tjenestenavn** – Indstil `x-oneuptime-service-name` for at tilsidesætte standard-detektionslogikken.
- **Store burst** – Batching op til 1.000 linjer pr. anmodning er understøttet. Større burst sættes i kø og behandles asynkront.
