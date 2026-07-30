## Opsætning af brugerdefinerede prober

Du kan opsætte brugerdefinerede prober inde i dit netværk for at overvåge ressourcer i dit private netværk eller ressourcer, der er bag din firewall.

For at begynde skal du oprette en brugerdefineret probe i dine Projektindstillinger > Probe. Når du har oprettet den brugerdefinerede probe på dit OneUptime-dashboard, bør du have `PROBE_ID` og `PROBE_KEY`.

### Deploy Probe

#### Docker

For at køre en probe skal du sørge for, at docker er installeret. Du kan køre en brugerdefineret probe med:

```
docker run --name oneuptime-probe --network host -e PROBE_KEY=<probe-key> -e PROBE_ID=<probe-id> -e ONEUPTIME_URL=https://oneuptime.com -d oneuptime/probe:release
```

Hvis du selvhoster OneUptime, kan du ændre `ONEUPTIME_URL` til din brugerdefinerede selvhostede instans.

##### Proxykonfiguration

Hvis din probe skal gå gennem en proxyserver for at nå OneUptime eller overvåge eksterne ressourcer, kan du konfigurere proxyindstillinger ved hjælp af disse miljøvariabler:

```
# Til HTTP-proxy
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTP_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release

# Til HTTPS-proxy
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTPS_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release

# Med proxyautentificering
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

Du kan også køre proben ved hjælp af docker-compose. Opret en `docker-compose.yml`-fil med følgende indhold:

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

Hvis du har behov for at bruge en proxyserver, kan du tilføje proxymiljøvariabler:

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
      # Proxykonfiguration (valgfrit)
      - HTTP_PROXY_URL=http://proxy.example.com:8080
      - HTTPS_PROXY_URL=http://proxy.example.com:8080
      - NO_PROXY=localhost,.internal.example.com
      # Til proxy med autentificering:
      # - HTTP_PROXY_URL=http://username:password@proxy.example.com:8080
      # - HTTPS_PROXY_URL=http://username:password@proxy.example.com:8080
      # - NO_PROXY=localhost,.internal.example.com
    network_mode: host
    restart: always
```

Kør derefter følgende kommando:

```
docker compose up -d
```

Hvis du selvhoster OneUptime, kan du ændre `ONEUPTIME_URL` til din brugerdefinerede selvhostede instans.

#### Kubernetes

Du kan også køre proben ved hjælp af Kubernetes. Opret en `oneuptime-probe.yaml`-fil med følgende indhold:

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

##### Med proxykonfiguration

Hvis du har behov for at bruge en proxyserver, kan du tilføje proxymiljøvariabler:

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
            # Proxykonfiguration (valgfrit)
            - name: HTTP_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: HTTPS_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: NO_PROXY
              value: "localhost,.internal.example.com"
            # Til proxy med autentificering:
            # - name: HTTP_PROXY_URL
            #   value: "http://username:password@proxy.example.com:8080"
            # - name: HTTPS_PROXY_URL
            #   value: "http://username:password@proxy.example.com:8080"
            # - name: NO_PROXY
            #   value: "localhost,.internal.example.com"
```

Kør derefter følgende kommando:

```bash
kubectl apply -f oneuptime-probe.yaml
```

Hvis du selvhoster OneUptime, kan du ændre `ONEUPTIME_URL` til din brugerdefinerede selvhostede instans.

### Miljøvariabler

Proben understøtter følgende miljøvariabler:

#### Påkrævede variabler

- `PROBE_KEY` – Probe-nøglen fra dit OneUptime-dashboard
- `PROBE_ID` – Probe-ID'et fra dit OneUptime-dashboard
- `ONEUPTIME_URL` – URL'en til din OneUptime-instans (standard: https://oneuptime.com)

#### Valgfrie variabler

- `HTTP_PROXY_URL` – HTTP-proxyserver-URL til HTTP-anmodninger
- `HTTPS_PROXY_URL` – HTTP-proxyserver-URL til HTTPS-anmodninger
- `NO_PROXY` – Kommaseparerede hosts eller domæner, der bør omgå proxyen
- `PROBE_NAME` – Brugerdefineret navn til proben
- `PROBE_DESCRIPTION` – Beskrivelse af proben
- `PROBE_MONITORING_WORKERS` – Antal overvågningsmedarbejdere (standard: 1)
- `PROBE_MONITOR_FETCH_LIMIT` – Antal monitorer der hentes ad gangen (standard: 10)
- `PROBE_MONITOR_RETRY_LIMIT` – Antal genforsøg for mislykkede monitorer (standard: 3)
- `PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS` – Timeout for syntetiske monitorscripts i millisekunder (standard: 60000)
- `PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS` – Timeout for brugerdefinerede kodemonitorscripts i millisekunder (standard: 60000)
- `PROBE_API_REQUEST_TIMEOUT_IN_MS` – Tidsfrist for hver anmodning, proben sender til OneUptime (standard: 45000)
- `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` – Log en advarsel for anmodninger til OneUptime, der er langsommere end dette (standard: 10000)

#### Proxykonfiguration

Proben understøtter både HTTP- og HTTPS-proxyservere. Når konfigureret, dirigerer proben al overvågningstrafik gennem de angivne proxyservere. Du kan også angive en kommasepareret `NO_PROXY`-liste for at omgå proxyen til interne hosts eller netværk.

**Proxy-URL-format:**

```
http://[username:password@]proxy.server.com:port
```

**Eksempler:**

- Grundlæggende proxy: `http://proxy.example.com:8080`
- Med autentificering: `http://username:password@proxy.example.com:8080`

**Understøttede funktioner:**

- HTTP- og HTTPS-proxyunderstøttelse
- Proxyautentificering (brugernavn/adgangskode)
- Automatisk fallback mellem HTTP- og HTTPS-proxyer
- Selektiv proxyomgåelse ved hjælp af `NO_PROXY`
- Fungerer med alle monitortyper (Website, API, SSL, Synthetic osv.)

**Bemærk:** Både standard-miljøvariabler (`HTTP_PROXY_URL`, `HTTPS_PROXY_URL`, `NO_PROXY`) og små bogstav-varianter (`http_proxy`, `https_proxy`, `no_proxy`) understøttes for kompatibilitet.

### Bekræftelse

Hvis proben kører succesfuldt, bør den vise som `Connected` på dit OneUptime-dashboard. Hvis den ikke viser som forbundet, skal du kontrollere containerloggene. Hvis du stadig har problemer, bedes du oprette et issue på [GitHub](https://github.com/oneuptime/oneuptime) eller [kontakte support](https://oneuptime.com/support)

### Diagnosticering af en frakoblet probe

En probe markeres som `Disconnected`, når dens anmodninger til OneUptime holder op med at lykkes. Probens log fortæller, hvor hver mislykket anmodning gik i stå, så du sjældent behøver at gætte.

**1. Læs miljøblokken, der udskrives ved opstart.** Hver probe udskriver én JSON-blok ved opstart med den OneUptime-URL, den bruger, dens tidsfrist for anmodninger, dens proxyindstillinger, de DNS-resolvere, den har arvet, Node-/OS-versionen, og om TLS-verificering er deaktiveret. Vedlæg altid denne blok, når du rapporterer et problem.

**2. Find fejlrapporten.** Hver mislykket anmodning til OneUptime logger en blok, der indeholder `stalledAt` og `whatThisMeans`. `stalledAt` er den fase, anmodningen aldrig kom forbi:

| `stalledAt` | Hvad det betyder |
| --- | --- |
| `SocketAssignment` | Intet forlod maskinen. Socket-puljen var mættet, eller en konfigureret proxy fuldførte aldrig sin CONNECT-tunnel. |
| `TcpConnect` | Maskinen sendte SYN og fik intet retur – en firewall eller en sikkerhedsenhed dropper pakker, eller værten kan ikke nås. |
| `TlsHandshake` | TCP blev forbundet, men TLS blev aldrig fuldført. Som regel et TLS-inspicerende mellemled. |
| `RequestSend` | Forbindelsen blev oprettet, men anmodningen blev aldrig skrevet helt færdig – modparten holdt op med at læse. |
| `WaitingForServerResponse` | Anmodningen blev leveret, og serveren sendte intet retur. **Probens netværk fejler ikke** – kontrollér OneUptime-serveren, dens load balancer og dens reverse proxy. |
| `ResponseBody` | Serveren begyndte at svare og gik i stå undervejs. |

Den samme blok rapporterer også `deadlineOverrunInMs`. Hvis en tidsfrist på 45000 ms tog væsentligt længere end 45000 ms målt i reel tid, var selve probe-processen blokeret – kontrollér `probeProcess.eventLoopMaxDriftInMs` i blokken, før du undersøger netværket.

**3. Læs selvtesten af forbindelsen.** Efter tre fejl i træk tester proben den samme server ét lag ad gangen – først DNS, så TCP, så TLS og til sidst en rigtig HTTP-tur-retur – og logger hvert trin med dets tidsforbrug. Det første trin, der fejler, er dit svar. Når der er konfigureret en proxy, tester proben hoppet til proxyen, fordi det er det eneste hop, den reelt foretager.

**4. Hold øje med langsomme anmodninger, før de bliver til fejl.** Anmodninger, der lykkes, men tager længere tid end `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS`, logges med deres forbrugte tid. En probe, der begynder at logge anmodninger på 20 sekunder, er på vej til at overskride tidsfristen på 45 sekunder.

På OneUptime-serversiden logges en probe-anmodning, der besvares langsomt – eller som proben opgav, før der blev sendt et svar – også dér sammen med probens id. Tilsammen fortæller de to logposter dig, hvilken side af forbindelsen der er skyld i problemet.
