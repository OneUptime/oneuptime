## Aangepaste probes instellen

U kunt aangepaste probes instellen binnen uw netwerk om resources in uw privénetwerk of resources achter uw firewall te bewaken.

Om te beginnen moet u een aangepaste probe aanmaken in uw Projectinstellingen > Probe. Zodra u de aangepaste probe hebt aangemaakt op uw OneUptime-dashboard, beschikt u over de `PROBE_ID` en `PROBE_KEY`.

### Probe implementeren

#### Docker

Om een probe uit te voeren, zorg ervoor dat docker is geïnstalleerd. U kunt de aangepaste probe uitvoeren met:

```
docker run --name oneuptime-probe --network host -e PROBE_KEY=<probe-key> -e PROBE_ID=<probe-id> -e ONEUPTIME_URL=https://oneuptime.com -d oneuptime/probe:release
```

Als u OneUptime zelf host, kunt u `ONEUPTIME_URL` wijzigen naar uw aangepaste zelf-gehoste instantie.

##### Proxyconfiguratie

Als uw probe via een proxyserver moet gaan om OneUptime te bereiken of externe resources te bewaken, kunt u proxyinstellingen configureren met deze omgevingsvariabelen:

```
# Voor HTTP-proxy
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTP_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release

# Voor HTTPS-proxy
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTPS_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release

# Met proxyauthenticatie
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

U kunt de probe ook uitvoeren via docker-compose. Maak een `docker-compose.yml`-bestand aan met de volgende inhoud:

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

##### Met proxyconfiguratie

Als u een proxyserver wilt gebruiken, kunt u proxy-omgevingsvariabelen toevoegen:

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
      # Proxyconfiguratie (optioneel)
      - HTTP_PROXY_URL=http://proxy.example.com:8080
      - HTTPS_PROXY_URL=http://proxy.example.com:8080
      - NO_PROXY=localhost,.internal.example.com
      # Voor proxy met authenticatie:
      # - HTTP_PROXY_URL=http://username:password@proxy.example.com:8080
      # - HTTPS_PROXY_URL=http://username:password@proxy.example.com:8080
      # - NO_PROXY=localhost,.internal.example.com
    network_mode: host
    restart: always
```

Voer vervolgens de volgende opdracht uit:

```
docker compose up -d
```

Als u OneUptime zelf host, kunt u `ONEUPTIME_URL` wijzigen naar uw aangepaste zelf-gehoste instantie.

#### Kubernetes

U kunt de probe ook uitvoeren via Kubernetes. Maak een `oneuptime-probe.yaml`-bestand aan met de volgende inhoud:

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

##### Met proxyconfiguratie

Als u een proxyserver wilt gebruiken, kunt u proxy-omgevingsvariabelen toevoegen:

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
          # Proxyconfiguratie (optioneel)
          - name: HTTP_PROXY_URL
            value: "http://proxy.example.com:8080"
          - name: HTTPS_PROXY_URL
            value: "http://proxy.example.com:8080"
          - name: NO_PROXY
            value: "localhost,.internal.example.com"
          # Voor proxy met authenticatie, gebruik:
          # - name: HTTP_PROXY_URL
          #   value: "http://username:password@proxy.example.com:8080"
          # - name: HTTPS_PROXY_URL
          #   value: "http://username:password@proxy.example.com:8080"
          # - name: NO_PROXY
          #   value: "localhost,.internal.example.com"
```

Voer vervolgens de volgende opdracht uit:

```bash
kubectl apply -f oneuptime-probe.yaml
```

Als u OneUptime zelf host, kunt u `ONEUPTIME_URL` wijzigen naar uw aangepaste zelf-gehoste instantie.

### Omgevingsvariabelen

De probe ondersteunt de volgende omgevingsvariabelen:

#### Verplichte variabelen
- `PROBE_KEY` - De probesleutel van uw OneUptime-dashboard
- `PROBE_ID` - Het probe-ID van uw OneUptime-dashboard
- `ONEUPTIME_URL` - De URL van uw OneUptime-instantie (standaard: https://oneuptime.com)

#### Optionele variabelen
- `HTTP_PROXY_URL` - HTTP-proxyserver-URL voor HTTP-verzoeken
- `HTTPS_PROXY_URL` - HTTP-proxyserver-URL voor HTTPS-verzoeken
- `NO_PROXY` - Door komma's gescheiden hosts of domeinen die de proxy moeten omzeilen
- `PROBE_NAME` - Aangepaste naam voor de probe
- `PROBE_DESCRIPTION` - Beschrijving voor de probe
- `PROBE_MONITORING_WORKERS` - Aantal monitoringwerkers (standaard: 1)
- `PROBE_MONITOR_FETCH_LIMIT` - Aantal monitors om tegelijk op te halen (standaard: 10)
- `PROBE_MONITOR_RETRY_LIMIT` - Aantal nieuwe pogingen voor mislukte monitors (standaard: 3)
- `PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS` - Time-out voor synthetische monitorscripts in milliseconden (standaard: 60000)
- `PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS` - Time-out voor aangepaste code-monitorscripts in milliseconden (standaard: 60000)

#### Proxyconfiguratie

De probe ondersteunt zowel HTTP- als HTTPS-proxyservers. Wanneer geconfigureerd, zal de probe al het monitoringverkeer via de opgegeven proxyservers routeren. U kunt ook een door komma's gescheiden `NO_PROXY`-lijst opgeven om de proxy te omzeilen voor interne hosts of netwerken.

**Proxy-URL-formaat:**
```
http://[gebruikersnaam:wachtwoord@]proxy.server.com:poort
```

**Voorbeelden:**
- Basisproxy: `http://proxy.example.com:8080`
- Met authenticatie: `http://username:password@proxy.example.com:8080`

**Ondersteunde functies:**
- HTTP- en HTTPS-proxyondersteuning
- Proxyauthenticatie (gebruikersnaam/wachtwoord)
- Automatische terugvaloptie tussen HTTP- en HTTPS-proxy's
- Selectief omzeilen van proxy met `NO_PROXY`
- Werkt met alle monitortypen (Website, API, SSL, Synthetisch, enz.)

**Opmerking:** Zowel standaard omgevingsvariabelen (`HTTP_PROXY_URL`, `HTTPS_PROXY_URL`, `NO_PROXY`) als kleinelettersvarianten (`http_proxy`, `https_proxy`, `no_proxy`) worden ondersteund voor compatibiliteit.

### Verifiëren

Als de probe succesvol wordt uitgevoerd, dient deze op uw OneUptime-dashboard de status `Verbonden` te tonen. Als deze niet als verbonden wordt weergegeven, moet u de logboeken van de container controleren. Als u nog steeds problemen ondervindt, maak dan een issue aan op [GitHub](https://github.com/oneuptime/oneuptime) of [neem contact op met ondersteuning](https://oneuptime.com/support).
