## Konfigurera anpassade sonder

Du kan konfigurera anpassade sonder inuti ditt nätverk för att övervaka resurser i ditt privata nätverk eller resurser som befinner sig bakom din brandvägg.

För att börja behöver du skapa en anpassad sond i dina Projektinställningar > Sond. När du har skapat den anpassade sonden på din OneUptime-instrumentpanel bör du ha `PROBE_ID` och `PROBE_KEY`.

### Distribuera sond

#### Docker

För att köra en sond, se till att du har Docker installerat. Du kan köra en anpassad sond med:

```
docker run --name oneuptime-probe --network host -e PROBE_KEY=<probe-key> -e PROBE_ID=<probe-id> -e ONEUPTIME_URL=https://oneuptime.com -d oneuptime/probe:release
```

Om du egeninstallerar OneUptime kan du ändra `ONEUPTIME_URL` till din anpassade egeninstallerade instans.

##### Proxykonfiguration

Om din sond behöver gå via en proxyserver för att nå OneUptime eller övervaka externa resurser kan du konfigurera proxyinställningar med dessa miljövariabler:

```
# För HTTP-proxy
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTP_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release

# För HTTPS-proxy
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTPS_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release

# Med proxyautentisering
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTP_PROXY_URL=http://username:password@proxy.example.com:8080 \
  -e HTTPS_PROXY_URL=http://username:password@proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release
```

#### Docker Compose

Du kan också köra sonden med docker-compose. Skapa en `docker-compose.yml`-fil med följande innehåll:

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
    network_mode: host
    restart: always
```

##### Med proxykonfiguration

Om du behöver använda en proxyserver kan du lägga till proxymiljövariabler:

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
      # Proxykonfiguration (valfritt)
      - HTTP_PROXY_URL=http://proxy.example.com:8080
      - HTTPS_PROXY_URL=http://proxy.example.com:8080
      - NO_PROXY=localhost,.internal.example.com
      # För proxy med autentisering:
      # - HTTP_PROXY_URL=http://username:password@proxy.example.com:8080
      # - HTTPS_PROXY_URL=http://username:password@proxy.example.com:8080
      # - NO_PROXY=localhost,.internal.example.com
    network_mode: host
    restart: always
```

Kör sedan följande kommando:

```
docker compose up -d
```

Om du egeninstallerar OneUptime kan du ändra `ONEUPTIME_URL` till din anpassade egeninstallerade instans.

#### Kubernetes

Du kan också köra sonden med Kubernetes. Skapa en `oneuptime-probe.yaml`-fil med följande innehåll:

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
```

Kör sedan följande kommando:

```bash
kubectl apply -f oneuptime-probe.yaml
```

Om du egeninstallerar OneUptime kan du ändra `ONEUPTIME_URL` till din anpassade egeninstallerade instans.

### Miljövariabler

Sonden stöder följande miljövariabler:

#### Obligatoriska variabler

- `PROBE_KEY` – Sondnyckeln från din OneUptime-instrumentpanel
- `PROBE_ID` – Sond-ID:t från din OneUptime-instrumentpanel
- `ONEUPTIME_URL` – URL:en till din OneUptime-instans (standard: https://oneuptime.com)

#### Valfria variabler

- `HTTP_PROXY_URL` – HTTP-proxyserverns URL för HTTP-förfrågningar
- `HTTPS_PROXY_URL` – HTTP-proxyserverns URL för HTTPS-förfrågningar
- `NO_PROXY` – Kommaseparerade värdar eller domäner som ska kringgå proxyn
- `PROBE_NAME` – Anpassat namn för sonden
- `PROBE_DESCRIPTION` – Beskrivning av sonden
- `PROBE_MONITORING_WORKERS` – Antal övervakningsarbetare (standard: 1)
- `PROBE_MONITOR_FETCH_LIMIT` – Antal monitorer att hämta åt gången (standard: 10)
- `PROBE_MONITOR_RETRY_LIMIT` – Antal försök för misslyckade monitorer (standard: 3)
- `PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS` – Timeout för syntetiska monitorskript i millisekunder (standard: 60000)
- `PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS` – Timeout för anpassade kodmonitorskript i millisekunder (standard: 60000)
- `PROBE_API_REQUEST_TIMEOUT_IN_MS` – Tidsgräns för varje förfrågan som sonden skickar till OneUptime (standard: 45000)
- `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` – Logga en varning för förfrågningar till OneUptime som är långsammare än detta (standard: 10000)

#### Proxykonfiguration

Sonden stöder både HTTP- och HTTPS-proxyservrar. När den är konfigurerad dirigerar sonden all övervakningsrafik genom de angivna proxyservrarna. Du kan också ange en kommaseparerad `NO_PROXY`-lista för att kringgå proxyn för interna värdar eller nätverk.

**Proxy-URL-format:**

```
http://[username:password@]proxy.server.com:port
```

**Stödda funktioner:**

- HTTP- och HTTPS-proxystöd
- Proxyautentisering (användarnamn/lösenord)
- Automatisk fallback mellan HTTP- och HTTPS-proxyservrar
- Selektiv proxy-bypass med `NO_PROXY`
- Fungerar med alla monitortyper (Webbplats, API, SSL, Syntetisk etc.)

### Verifiera

Om sonden körs framgångsrikt bör den visas som `Connected` på din OneUptime-instrumentpanel. Om den inte visas som ansluten behöver du kontrollera containerns loggar. Om du fortfarande har problem kan du skapa ett ärende på [GitHub](https://github.com/oneuptime/oneuptime) eller [kontakta supporten](https://oneuptime.com/support).

### Diagnostisera en sond med statusen Disconnected

En sond flaggas som `Disconnected` när dess förfrågningar till OneUptime slutar lyckas. Sondens logg anger var varje misslyckad förfrågan fastnade, så du behöver sällan gissa.

**1. Läs miljöblocket som skrivs ut vid start.** Varje sond skriver ut ett JSON-block vid uppstart med den OneUptime-URL den använder, sin tidsgräns för förfrågningar, sina proxyinställningar, de DNS-resolvrar den har ärvt, Node-/OS-versionen och huruvida TLS-verifiering har inaktiverats. Bifoga alltid detta block när du rapporterar ett problem.

**2. Hitta felrapporten.** Varje misslyckad förfrågan till OneUptime loggar ett block som innehåller `stalledAt` och `whatThisMeans`. `stalledAt` är den fas som förfrågan aldrig tog sig förbi:

| `stalledAt` | Vad det betyder |
| --- | --- |
| `SocketAssignment` | Ingenting lämnade maskinen. Socketpoolen var mättad, eller så slutförde en konfigurerad proxy aldrig sin CONNECT-tunnel. |
| `TcpConnect` | Maskinen skickade SYN och fick inget svar – en brandvägg eller säkerhetsapparat kastar paketen, eller så är värden onåbar. |
| `TlsHandshake` | TCP anslöt, men TLS slutfördes aldrig. Vanligtvis en TLS-inspekterande mellanbox. |
| `RequestSend` | Anslutningen upprättades, men förfrågan skrevs aldrig färdigt – motparten slutade läsa. |
| `WaitingForServerResponse` | Förfrågan levererades och servern skickade ingenting tillbaka. **Sondens nätverk fungerar som det ska** – kontrollera OneUptime-servern, dess lastbalanserare och dess omvända proxy. |
| `ResponseBody` | Servern började svara och stannade av halvvägs. |

Samma block rapporterar även `deadlineOverrunInMs`. Om en tidsgräns på 45000 ms tog betydligt längre tid än 45000 ms i verklig tid var själva sondprocessen blockerad – kontrollera `probeProcess.eventLoopMaxDriftInMs` i blocket innan du undersöker nätverket.

**3. Läs självtestet av anslutningen.** Efter tre misslyckanden i rad testar sonden samma server ett lager i taget – DNS, sedan TCP, sedan TLS, sedan en riktig HTTP-tur och retur – och loggar varje steg med dess tidtagning. Det första steget som misslyckas är ditt svar. När en proxy är konfigurerad testar sonden hoppet till proxyn, eftersom det är det enda hopp den faktiskt gör.

**4. Håll utkik efter långsamma förfrågningar innan de blir fel.** Förfrågningar som lyckas men tar längre tid än `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` loggas tillsammans med sin förflutna tid. En sond som börjar logga 20 sekunder långa förfrågningar är på väg att överskrida tidsgränsen på 45 sekunder.

På OneUptime-serversidan loggas också en sondförfrågan som besvaras långsamt – eller som sonden gav upp innan ett svar hann skickas – där, med sondens ID. Tillsammans visar dessa två loggar vilken sida av anslutningen som är felkällan.
