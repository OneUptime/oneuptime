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

Hvis proben kører succesfuldt, bør den vise som `Forbundet` på dit OneUptime-dashboard. Hvis den ikke viser som forbundet, skal du kontrollere containerloggene. Hvis du stadig har problemer, bedes du oprette et issue på [GitHub](https://github.com/oneuptime/oneuptime) eller [kontakte support](https://oneuptime.com/support)
