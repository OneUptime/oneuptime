# Syslog-gegevens naar OneUptime sturen

## Overzicht

De OpenTelemetry Ingest-dienst accepteert nu native Syslog-payloads. U kunt berichten van elke RFC3164- of RFC5424-compatibele bron rechtstreeks naar OneUptime sturen via HTTPS. OneUptime parseert de syslog-prioriteit, faciliteit, ernst, gestructureerde gegevens en berichtinhoud voordat alles als doorzoekbare logboeken wordt opgeslagen.

## Vereisten

- **Telemetrie-ingestietoken** — maak er een aan via *Projectinstellingen → Telemetrie-ingestiesleutels* en kopieer de `x-oneuptime-token`-waarde.
- **Syslog-forwarder** — elk hulpmiddel dat HTTP POST-verzoeken kan sturen (bijvoorbeeld `curl`, `rsyslog` via `omhttp`, of `syslog-ng` met de HTTP-bestemmingsplugin).
- **Dienstnaam (optioneel)** — stel de `x-oneuptime-service-name`-header in om inkomende logboeken te groeperen onder een specifieke telemetriedienst. Indien weggelaten valt OneUptime terug op de syslog `APP-NAME`, hostnaam of `Syslog`.

## Eindpunt

```
POST https://oneuptime.com/syslog/v1/logs
```

- Vervang `oneuptime.com` door uw host als u OneUptime zelf host.
- Voeg altijd de `x-oneuptime-token`-header toe aan het verzoek.

## Verzoeklichaam

Stuur door regeleinden gescheiden Syslog-tekenreeksen of een JSON-payload met een `messages`-array. Zowel RFC3164 (BSD)- als RFC5424-formaten worden ondersteund.

```json
{
  "messages": [
    "<34>1 2025-03-02T14:48:05.003Z web-01 nginx 7421 ID47 [env@32473 host=\"web-01\"] 502 on /api/login",
    "<13>Feb  5 17:32:18 db-01 postgres[2419]: connection received from 10.0.0.12"
  ]
}
```

### Ondersteunde inhoudstypen

- `application/json` — aanbevolen.
- `text/plain` — door regeleinden gescheiden berichten.
- `application/octet-stream` — ruwe payloads. Gzip-compressie (`Content-Encoding: gzip`) wordt ook geaccepteerd.

## Snelle test met curl

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

## Doorsturen vanuit rsyslog

1. Installeer de HTTP-uitvoermodule:
   ```bash
   sudo apt-get install rsyslog-omhttp
   ```
2. Voeg de bestemming toe aan `/etc/rsyslog.d/oneuptime.conf`:
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
3. Herstart rsyslog:
   ```bash
   sudo systemctl restart rsyslog
   ```

## Veelgebruikte toepassingen die we al zien

### 1. Netwerk- en beveiligingsapparaten

De meeste netwerkapparatuur stelt configuratiewijzigingen, ACL-treffers en bedreigingsdetecties nog steeds uitsluitend beschikbaar via syslog. Wijs uw bestaande relay (Palo Alto, Fortinet, Cisco ASA, Juniper, pfSense en meer) rechtstreeks naar OneUptime, of houd een interne relay aan en stuur door via HTTPS:

```bash
# rsyslog-fragment dat berichten batcht in JSON en naar OneUptime post
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

### 2. Linux-servers en cron-taken

Veel cron-taken en verouderde daemons loggen nog uitsluitend via de kernel/syslog-faciliteit. Het doorsturen van `/var/log/syslog` of journald-vermeldingen houdt operationele sporen op één plek. Systemd-hosts kunnen vertrouwen op de journald → syslog-brug:

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

Omdat we ernstnummers mappen, kunt u meldingen instellen voor `syslog.severity.name = "error"` of filteren op `syslog.hostname` om lawaaierige servers snel te isoleren.

### 3. Kubernetes ingress controllers en edge-nodes

Als u al FluentBit of Fluentd gebruikt, houd die dan voor containerlogboeken en voeg een lichtgewicht syslog-sink toe voor hosts of apparaten aan de rand. FluentBit's `syslog`-invoer werkt goed samen met de HTTP-uitvoer:

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

Deze instelling stelt u in staat syslog te verwerken van bare-metal workers of hardware load balancers zonder een extra logging-stack aan te maken.

### 4. Compliance-archieven zonder het wachten

Moet u firewalllogboeken bewaren voor PCI of SOX? Stuur ze rechtstreeks naar OneUptime, pas een lang bewaarbeleid toe op de telemetriedienst en exporteer naar koude opslag vanuit één plek. Geen exporteren meer vanuit meerdere syslog-relays.

## Geparseerde attributen

OneUptime voegt automatisch de volgende attributen toe aan elk logboekvermeldingen:

- `syslog.priority`, `syslog.facility.code`, `syslog.facility.name`
- `syslog.severity.code`, `syslog.severity.name`
- `syslog.hostname`, `syslog.appName`, `syslog.processId`, `syslog.messageId`
- `syslog.structured.*` (afgevlakte RFC5424 gestructureerde gegevens)
- `syslog.raw` (origineel bericht voor traceerbaarheid)

Deze attributen worden doorzoekbaar in de Telemetrie → Logboeken verkenner.

## Probleemoplossing

- **HTTP 401 of lege resultaten** — verifieer dat de `x-oneuptime-token`-header behoort tot het project dat de logboeken ontvangt.
- **Geen logboeken verschijnen** — bevestig dat het verzoeklichaam daadwerkelijk syslog-regels bevat. Lege lichamen worden geweigerd met HTTP 400.
- **Onverwachte dienstnaam** — stel `x-oneuptime-service-name` in om de standaarddetectielogica te overschrijven.
- **Grote bursts** — batching tot 1.000 regels per verzoek wordt ondersteund. Grotere bursts worden in de wachtrij geplaatst en asynchroon verwerkt.
