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

Om sonden körs framgångsrikt bör den visas som `Ansluten` på din OneUptime-instrumentpanel. Om den inte visas som ansluten behöver du kontrollera containerns loggar. Om du fortfarande har problem kan du skapa ett ärende på [GitHub](https://github.com/oneuptime/oneuptime) eller [kontakta supporten](https://oneuptime.com/support).
