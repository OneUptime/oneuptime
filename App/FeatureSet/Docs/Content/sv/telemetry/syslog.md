# Skicka Syslog-data till OneUptime

## Översikt

OpenTelemetry Ingest-tjänsten accepterar nu inbyggda Syslog-nyttolaster. Du kan vidarebefordra meddelanden från valfri RFC3164- eller RFC5424-kompatibel källa direkt till OneUptime via HTTPS. OneUptime tolkar syslog-prioriteten, anläggningen, allvarlighetsgraden, strukturerad data och meddelandetexten innan allt lagras som sökbara loggar.

## Förutsättningar

- **Telemetriintagningstoken** – skapa en från *Projektinställningar → Telemetriintagningsnycklar* och kopiera `x-oneuptime-token`-värdet.
- **Syslog-vidarebefordrare** – vilket verktyg som helst som kan skicka HTTP POST-förfrågningar (t.ex. `curl`, `rsyslog` via `omhttp` eller `syslog-ng` med HTTP-destinationsplugin:et).
- **Tjänstnamn (valfritt)** – ange `x-oneuptime-service-name`-huvudet för att gruppera inkommande loggar under en specifik telemetritjänst. När det utelämnas faller OneUptime tillbaka på syslog `APP-NAME`, värdnamn eller `Syslog`.

## Slutpunkt

```
POST https://oneuptime.com/syslog/v1/logs
```

- Ersätt `oneuptime.com` med din värd om du egeninstallerar OneUptime.
- Inkludera alltid `x-oneuptime-token`-huvudet i förfrågan.

## Förfrågningsinnehåll

Skicka radavgränsade Syslog-strängar eller en JSON-nyttolast med en `messages`-array. Både RFC3164 (BSD)- och RFC5424-format stöds.

```json
{
  "messages": [
    "<34>1 2025-03-02T14:48:05.003Z web-01 nginx 7421 ID47 [env@32473 host=\"web-01\"] 502 on /api/login",
    "<13>Feb  5 17:32:18 db-01 postgres[2419]: connection received from 10.0.0.12"
  ]
}
```

### Innehållstyper som stöds

- `application/json` – rekommenderas.
- `text/plain` – radavgränsade meddelanden.
- `application/octet-stream` – råa nyttolaster. Gzip-komprimering (`Content-Encoding: gzip`) accepteras också.

## Snabbtest med curl

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

## Vidarebefordring från rsyslog

1. Installera HTTP-utdatamodulen:
   ```bash
   sudo apt-get install rsyslog-omhttp
   ```
2. Lägg till destinationen i `/etc/rsyslog.d/oneuptime.conf`:
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
3. Starta om rsyslog:
   ```bash
   sudo systemctl restart rsyslog
   ```

## Vanliga användningsfall

### 1. Nätverks- och säkerhetsapparater

De flesta nätverksutrustningar exponerar fortfarande konfigurationsändringar, ACL-träffar och hotidentifieringar uteslutande via syslog. Peka ditt befintliga relä (Palo Alto, Fortinet, Cisco ASA, Juniper, pfSense och mer) direkt till OneUptime, eller behåll ett internt relä och vidarebefordra via HTTPS.

### 2. Linux-servrar och cron-jobb

Många cron-jobb och äldre daemoner loggar fortfarande bara via kärnan/syslog-anläggningen. Vidarebefordring av `/var/log/syslog`- eller journald-poster håller operativa brödsmulor på ett ställe.

### 3. Kubernetes ingress-kontroller och edge-noder

Om du redan kör FluentBit eller Fluentd, behåll dem för containerloggar och lägg till en lätt syslog-sink för värdar eller apparater vid kanten.

### 4. Efterlevnadsarkiv utan väntan

Behöver du behålla brandväggsloggar för PCI eller SOX? Skicka dem direkt till OneUptime, tillämpa en lång lagringspolicy på telemetritjänsten och exportera till kall lagring från ett enda ställe.

## Tolkade attribut

OneUptime lägger automatiskt till följande attribut för varje loggpost:

- `syslog.priority`, `syslog.facility.code`, `syslog.facility.name`
- `syslog.severity.code`, `syslog.severity.name`
- `syslog.hostname`, `syslog.appName`, `syslog.processId`, `syslog.messageId`
- `syslog.structured.*` (tillplattad RFC5424-strukturerad data)
- `syslog.raw` (originalmeddelande för spårbarhet)

Dessa attribut blir sökbara inuti Telemetri → Loggar-utforskaren.

## Felsökning

- **HTTP 401 eller tomma resultat** – verifiera att `x-oneuptime-token`-huvudet tillhör projektet som tar emot loggarna.
- **Inga loggar visas** – bekräfta att förfrågningsinnehållet faktiskt innehåller syslog-rader. Tomma innehåll avvisas med HTTP 400.
- **Oväntat tjänstnamn** – ange `x-oneuptime-service-name` för att åsidosätta standardidentifieringslogiken.
- **Stora belastningstoppar** – batchning upp till 1 000 rader per förfrågan stöds. Större belastningstoppar köas och bearbetas asynkront.
