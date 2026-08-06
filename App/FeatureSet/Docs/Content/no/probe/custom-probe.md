## Sette opp egendefinerte prober

Du kan sette opp egendefinerte prober inne i nettverket ditt for å overvåke ressurser i ditt private nettverk eller ressurser som er bak brannmuren din.

For å begynne må du opprette en egendefinert probe i OneUptime Dashboard under Overvåkere > Innstillinger > Sonder. Når du har opprettet den egendefinerte proben på OneUptime-dashbordet, bør du ha `PROBE_ID` og `PROBE_KEY`.

### Distribuere probe

#### Docker

For å kjøre en probe, sørg for at du har Docker installert. Du kan kjøre egendefinert probe ved å:

```
docker run --name oneuptime-probe --network host -e PROBE_KEY=<probe-key> -e PROBE_ID=<probe-id> -e ONEUPTIME_URL=https://oneuptime.com -d oneuptime/probe:release
```

Hvis du selvhoster OneUptime, kan du endre `ONEUPTIME_URL` til din egendefinerte selvhostede instans.

##### Proxy-konfigurasjon

Hvis proben trenger å gå gjennom en proxy-server for å nå OneUptime eller overvåke eksterne ressurser, kan du konfigurere proxy-innstillinger ved hjelp av disse miljøvariablene:

```
# For HTTP-proxy
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTP_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release

# For HTTPS-proxy
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTPS_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release

# Med proxy-autentisering
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

Du kan også kjøre proben ved hjelp av docker-compose. Opprett en `docker-compose.yml`-fil med følgende innhold:

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

##### Med proxy-konfigurasjon

Hvis du trenger å bruke en proxy-server, kan du legge til proxy-miljøvariabler:

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
      # Proxy-konfigurasjon (valgfritt)
      - HTTP_PROXY_URL=http://proxy.example.com:8080
      - HTTPS_PROXY_URL=http://proxy.example.com:8080
      - NO_PROXY=localhost,.internal.example.com
      # For proxy med autentisering:
      # - HTTP_PROXY_URL=http://username:password@proxy.example.com:8080
      # - HTTPS_PROXY_URL=http://username:password@proxy.example.com:8080
      # - NO_PROXY=localhost,.internal.example.com
    network_mode: host
    restart: always
```

Kjør deretter følgende kommando:

```
docker compose up -d
```

Hvis du selvhoster OneUptime, kan du endre `ONEUPTIME_URL` til din egendefinerte selvhostede instans.

#### Kubernetes

Du kan også kjøre proben ved hjelp av Kubernetes. Opprett en `oneuptime-probe.yaml`-fil med følgende innhold:

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

##### Med proxy-konfigurasjon

Hvis du trenger å bruke en proxy-server, kan du legge til proxy-miljøvariabler:

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
            # Proxy-konfigurasjon (valgfritt)
            - name: HTTP_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: HTTPS_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: NO_PROXY
              value: "localhost,.internal.example.com"
            # For proxy med autentisering, bruk:
            # - name: HTTP_PROXY_URL
            #   value: "http://username:password@proxy.example.com:8080"
            # - name: HTTPS_PROXY_URL
            #   value: "http://username:password@proxy.example.com:8080"
            # - name: NO_PROXY
            #   value: "localhost,.internal.example.com"
```

Kjør deretter følgende kommando:

```bash
kubectl apply -f oneuptime-probe.yaml
```

Hvis du selvhoster OneUptime, kan du endre `ONEUPTIME_URL` til din egendefinerte selvhostede instans.

### Miljøvariabler

Proben støtter følgende miljøvariabler:

#### Påkrevde variabler

- `PROBE_KEY` – Probe-nøkkelen fra OneUptime-dashbordet ditt
- `PROBE_ID` – Probe-ID-en fra OneUptime-dashbordet ditt
- `ONEUPTIME_URL` – URL-en til din OneUptime-instans (standard: https://oneuptime.com)

#### Valgfrie variabler

- `HTTP_PROXY_URL` – HTTP-proxy-server-URL for HTTP-forespørsler
- `HTTPS_PROXY_URL` – HTTP-proxy-server-URL for HTTPS-forespørsler
- `NO_PROXY` – Kommaseparerte verter eller domener som skal omgå proxyen
- `PROBE_NAME` – Egendefinert navn for proben
- `PROBE_DESCRIPTION` – Beskrivelse for proben
- `PROBE_MONITORING_WORKERS` – Antall overvåkingsarbeidere (standard: 1)
- `PROBE_MONITOR_FETCH_LIMIT` – Antall monitorer som hentes om gangen (standard: 10)
- `PROBE_MONITOR_RETRY_LIMIT` – Antall nye forsøk for mislykkede monitorer (standard: 3)
- `PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS` – Tidsavbrudd for syntetiske monitorskript i millisekunder (standard: 60000)
- `PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS` – Tidsavbrudd for egendefinerte kode-monitorskript i millisekunder (standard: 60000)
- `PROBE_API_REQUEST_TIMEOUT_IN_MS` – Tidsfrist for hver forespørsel proben sender til OneUptime (standard: 45000)
- `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` – Logg en advarsel for forespørsler til OneUptime som er tregere enn dette (standard: 10000)

#### Proxy-konfigurasjon

Proben støtter både HTTP- og HTTPS-proxy-servere. Når konfigurert, vil proben rute all overvåkingstrafikk gjennom de angitte proxy-serverne. Du kan også oppgi en kommaseparert `NO_PROXY`-liste for å omgå proxyen for interne verter eller nettverk.

**Proxy-URL-format:**

```
http://[username:password@]proxy.server.com:port
```

**Eksempler:**

- Grunnleggende proxy: `http://proxy.example.com:8080`
- Med autentisering: `http://username:password@proxy.example.com:8080`

**Støttede funksjoner:**

- HTTP- og HTTPS-proxy-støtte
- Proxy-autentisering (brukernavn/passord)
- Automatisk fallback mellom HTTP- og HTTPS-proxyer
- Selektiv proxy-omgåelse ved hjelp av `NO_PROXY`
- Fungerer med alle monitortyper (nettsted, API, SSL, syntetisk, osv.)

**Merk:** Både standard miljøvariabler (`HTTP_PROXY_URL`, `HTTPS_PROXY_URL`, `NO_PROXY`) og varianter med små bokstaver (`http_proxy`, `https_proxy`, `no_proxy`) støttes for kompatibilitet.

### Verifisere

Hvis proben kjører vellykket, skal den vises som `Connected` på OneUptime-dashbordet. Hvis den ikke vises som tilkoblet, må du sjekke loggene til containeren. Hvis du fortsatt har problemer, vennligst opprett en sak på [GitHub](https://github.com/oneuptime/oneuptime) eller [kontakt støtte](https://oneuptime.com/support).

### Diagnostisere en frakoblet probe

En probe merkes som `Disconnected` når forespørslene den sender til OneUptime slutter å lykkes. Probeloggen forteller hvor hver mislykkede forespørsel satte seg fast, så du trenger sjelden å gjette.

**1. Les miljøblokken som skrives ut ved oppstart.** Hver probe skriver ut én JSON-blokk ved oppstart med OneUptime-URL-en den bruker, tidsfristen for forespørsler, proxy-innstillingene, DNS-resolverne den har arvet, Node/OS-versjonen, og om TLS-verifisering er deaktivert. Ta med denne blokken hver gang du rapporterer et problem.

**2. Finn feilrapporten.** Hver mislykkede forespørsel til OneUptime logger en blokk som inneholder `stalledAt` og `whatThisMeans`. `stalledAt` er fasen forespørselen aldri kom forbi:

| `stalledAt` | Hva det betyr |
| --- | --- |
| `SocketAssignment` | Ingenting forlot maskinen. Socket-poolen var mettet, eller en konfigurert proxy fullførte aldri CONNECT-tunnelen sin. |
| `TcpConnect` | Maskinen sendte SYN og fikk ingenting tilbake – en brannmur eller sikkerhetsenhet forkaster pakker, eller verten er utilgjengelig. |
| `TlsHandshake` | TCP koblet til, men TLS ble aldri fullført. Vanligvis en mellomboks som inspiserer TLS. |
| `RequestSend` | Tilkoblet, men forespørselen ble aldri skrevet ferdig – motparten sluttet å lese. |
| `WaitingForServerResponse` | Forespørselen ble levert, og serveren sendte ingenting tilbake. **Probens nettverk er i orden** – sjekk OneUptime-serveren, lastbalansereren og den omvendte proxyen. |
| `ResponseBody` | Serveren begynte å svare og stoppet opp underveis. |

Den samme blokken rapporterer også `deadlineOverrunInMs`. Hvis en tidsfrist på 45000 ms tok betydelig lengre tid enn 45000 ms målt i faktisk tid, var selve probeprosessen blokkert – sjekk `probeProcess.eventLoopMaxDriftInMs` i blokken før du undersøker nettverket.

**3. Les selvtesten av tilkoblingen.** Etter tre påfølgende feil tester proben den samme serveren ett lag om gangen – DNS, deretter TCP, deretter TLS, og til slutt en ekte HTTP-rundtur – og logger hvert trinn med tidsbruken. Det første trinnet som feiler, er svaret ditt. Når en proxy er konfigurert, tester proben hoppet til proxyen, fordi det er det eneste hoppet den faktisk gjør.

**4. Følg med på trege forespørsler før de blir til feil.** Forespørsler som lykkes, men som tar lengre tid enn `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS`, logges med tiden de brukte. En probe som begynner å logge forespørsler på 20 sekunder, er på vei mot å overskride tidsfristen på 45 sekunder.

På OneUptime-serversiden logges også en probeforespørsel som besvares sakte – eller som proben ga opp før et svar ble sendt – med probens ID. Til sammen forteller disse to loggene deg hvilken side av forbindelsen som er årsaken.
