# Inkomend verzoek-ingress

Een aangepaste probe kan optioneel een **inkomende HTTP-listener** uitvoeren die `heartbeat`- en `incoming-request`-aanroepen accepteert vanuit uw privénetwerk en deze doorstuurt naar OneUptime. Hierdoor kunnen diensten die **geen uitgaande internettoegang hebben** toch rapporteren aan een [Inkomend verzoek-monitor](/docs/monitor/incoming-request-monitor) door het verzoek te sturen naar een probe op het lokale netwerk in plaats van rechtstreeks naar `oneuptime.com`.

## Overzicht

Wanneer `PROBE_INGRESS_PORT` is ingesteld, bindt de probe een extra HTTP-listener op die poort. De listener accepteert dezelfde `secretkey` URL-paden als de openbare OneUptime-eindpunten:

- `POST /heartbeat/:secretkey`
- `GET /heartbeat/:secretkey`
- `POST /incoming-request/:secretkey`
- `GET /incoming-request/:secretkey`

De probe proxieert vervolgens het verzoek naar uw OneUptime-instantie, waarbij de methode, het lichaam en de verzoekheaders behouden blijven (minus hop-by-hop-headers zoals `Host`, `Connection`, `Content-Length`, enz.). De probe voegt automatisch een `OneUptime-Probe-Id`-header toe zodat het verzoek wordt toegeschreven aan de doorsturende probe.

De listener draait op een **speciale poort**, gescheiden van de interne status-/metrics-eindpunten van de probe, zodat u deze kunt blootstellen aan uw privénetwerk zonder iets anders bloot te stellen.

## Wanneer dit gebruiken

Gebruik de ingress-listener wanneer:

- Uw diensten draaien in een geïsoleerd netwerksegment zonder uitgaande HTTPS-toegang
- U al het monitoringverkeer binnen uw VPC/on-premises netwerk wilt houden
- U een enkel uitgangspunt wilt — de probe — die OneUptime mag bereiken
- U al een [Aangepaste probe](/docs/probe/custom-probe) hebt geïmplementeerd en deze opnieuw wilt gebruiken voor inkomende heartbeats

Als uw diensten al rechtstreeks `https://oneuptime.com` (of uw zelf-gehoste URL) kunnen bereiken, hebt u deze functie **niet** nodig — roep de heartbeat-URL rechtstreeks aan vanuit de dienst.

## De ingress-listener inschakelen

Stel `PROBE_INGRESS_PORT` in op de poort waarop u de listener wilt binden. Elke waarde groter dan `0` schakelt de listener in; als u dit niet instelt (of `0`), wordt deze uitgeschakeld.

### Docker

```bash
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e PROBE_INGRESS_PORT=3875 \
  -d oneuptime/probe:release
```

Als u `--network host` niet gebruikt, publiceer de ingress-poort dan expliciet:

```bash
docker run --name oneuptime-probe \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e PROBE_INGRESS_PORT=3875 \
  -p 3875:3875 \
  -d oneuptime/probe:release
```

### Docker Compose

```yaml
version: "3"

services:
  oneuptime-probe:
    image: oneuptime/probe:release
    container_name: oneuptime-probe
    environment:
      - PROBE_KEY=<probe-key>
      - PROBE_ID=<probe-id>
      - ONEUPTIME_URL=https://oneuptime.com
      - PROBE_INGRESS_PORT=3875
    ports:
      - "3875:3875"
    restart: always
```

### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-probe
spec:
  selector:
    matchLabels:
      app: oneuptime-probe
  template:
    metadata:
      labels:
        app: oneuptime-probe
    spec:
      containers:
        - name: oneuptime-probe
          image: oneuptime/probe:release
          env:
            - name: PROBE_KEY
              value: "<probe-key>"
            - name: PROBE_ID
              value: "<probe-id>"
            - name: ONEUPTIME_URL
              value: "https://oneuptime.com"
            - name: PROBE_INGRESS_PORT
              value: "3875"
          ports:
            - name: ingress
              containerPort: 3875
---
apiVersion: v1
kind: Service
metadata:
  name: oneuptime-probe-ingress
spec:
  selector:
    app: oneuptime-probe
  ports:
    - name: ingress
      port: 3875
      targetPort: 3875
  type: ClusterIP
```

Interne diensten kunnen dan heartbeats sturen naar `http://oneuptime-probe-ingress.<namespace>.svc.cluster.local:3875/heartbeat/<secret-key>`.

## Verzoeken versturen naar de probe

Vervang de openbare heartbeat-URL:

```
https://oneuptime.com/heartbeat/<secret-key>
```

door de ingress-URL van de probe:

```
http://<probe-host>:<PROBE_INGRESS_PORT>/heartbeat/<secret-key>
```

Het pad, de methode, het lichaam en de headers zijn verder identiek, zodat bestaande clientcode alleen de basis-URL hoeft te wijzigen.

### Voorbeelden

```bash
# GET heartbeat
curl http://probe.internal:3875/heartbeat/YOUR_SECRET_KEY

# POST heartbeat met JSON-lichaam
curl -X POST http://probe.internal:3875/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{"status": "healthy", "version": "1.2.3"}'

# Cron-taak
*/5 * * * * curl -s http://probe.internal:3875/heartbeat/YOUR_SECRET_KEY > /dev/null
```

## Doorstuurgedrag

- **Synchrone respons, asynchrone doorsturing.** De probe bevestigt het inkomende verzoek onmiddellijk met een `200` en stuurt door naar OneUptime op de achtergrond. Uw dienst hoeft niet te wachten tot de doorsturing is voltooid.
- **Headers worden bewaard.** Alle headers behalve hop-by-hop-headers (`Host`, `Connection`, `Content-Length`, `Transfer-Encoding`, `Keep-Alive`, `Proxy-Authenticate`, `Proxy-Authorization`, `TE`, `Trailer`, `Upgrade`) worden doorgegeven. De probe voegt een `OneUptime-Probe-Id`-header toe die zichzelf identificeert.
- **Lichaam wordt bewaard.** JSON-, URL-gecodeerde en onbewerkte `application/octet-stream`-payloads tot **50 MB** worden geaccepteerd.
- **Nieuwe pogingen met backoff.** Als de doorsturing mislukt, probeert de probe opnieuw tot `PROBE_INGRESS_FORWARD_RETRY_LIMIT` keer met exponentiële backoff (2s, 4s, 8s, maximaal 15s).
- **Proxy-bewust.** Als de probe zelf is geconfigureerd met `HTTP_PROXY_URL` / `HTTPS_PROXY_URL`, gaan doorgestuurde verzoeken via de proxy.

## Omgevingsvariabelen

| Variabele                           | Standaard                        | Beschrijving                                                                                                             |
| ----------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `PROBE_INGRESS_PORT`                | _niet ingesteld_ (uitgeschakeld) | Poort waarop de inkomende listener bindt. Elke waarde `> 0` schakelt ingress in.                                         |
| `PROBE_INGRESS_FORWARD_TIMEOUT_MS`  | `10000`                          | Time-out (ms) voor elke doorstuurpoging naar OneUptime. Minimum `1000`.                                                  |
| `PROBE_INGRESS_FORWARD_RETRY_LIMIT` | `3`                              | Aantal nieuwe pogingen voordat de probe opgeeft met een doorsturing. Stel in op `0` om nieuwe pogingen uit te schakelen. |

De standaard probe-variabelen (`PROBE_KEY`, `PROBE_ID`, `ONEUPTIME_URL`, proxy-variabelen) zijn allemaal van toepassing — zie [Aangepaste probes](/docs/probe/custom-probe) voor de volledige lijst.

## Beveiligingsoverwegingen

- **Het eindpunt is ontworpen zonder authenticatie** — de geheime sleutel in het URL-pad _is_ de authenticatie, net als op het openbare `oneuptime.com`-eindpunt. Behandel de geheime sleutel als een inloggegevens.
- **Bind alleen aan een privé-interface.** De ingress-listener mag niet bereikbaar zijn vanaf het publieke internet. Gebruik een netwerkbeleid, firewallregel of `ClusterIP`-service om de toegang te beperken.
- **Gebruik HTTPS-beëindiging als u versleuteling in transit vereist.** De listener van de probe spreekt gewoon HTTP. Plaats hem achter een interne load balancer/ingress controller als u TLS op de inkomende hop nodig heeft. Het doorstuurgedeelte van probe → OneUptime gebruikt altijd HTTPS (aangenomen dat `ONEUPTIME_URL` `https://` is).
- **Resourcelimieten.** De listener accepteert verzoeklichamen tot 50 MB. Als u een strengere limiet nodig heeft, plaatst u een reverse proxy ervoor.

## Probleemoplossing

- **Probe logt `Probe ingress listener started on port <port>` bij opstarten** — bevestigt dat de listener actief is. Als u deze regel niet ziet, is `PROBE_INGRESS_PORT` niet ingesteld, `0` of ongeldig.
- **`Probe ingress: failed to forward to <url> after N attempts`** — de probe kon OneUptime niet bereiken. Controleer de uitgaande connectiviteit van de probe, de proxyinstellingen en de waarde van `ONEUPTIME_URL`.
- **`Probe ingress: probe ID not available, forwarding without it`** — de probe is nog niet geregistreerd. De doorsturing slaagt toch; de heartbeat wordt eenvoudigweg niet toegeschreven aan een probe.
- **Heartbeat verschijnt in OneUptime maar niet via de probe** — bevestig dat uw dienst `http://<probe-host>:<port>/...` aanroept en niet de openbare URL. Een onjuist geconfigureerde DNS- of `/etc/hosts`-vermelding is de gebruikelijke oorzaak.

## Gerelateerd

- [Aangepaste probes](/docs/probe/custom-probe)
- [Inkomend verzoek-monitor](/docs/monitor/incoming-request-monitor)
