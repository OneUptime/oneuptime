## Configurazione di Probe Personalizzati

È possibile configurare probe personalizzati all'interno della propria rete per monitorare le risorse nella rete privata o le risorse protette da firewall.

Per iniziare è necessario creare un probe personalizzato nelle Impostazioni Progetto > Probe. Una volta creato il probe personalizzato nel Dashboard di OneUptime, si avrà il `PROBE_ID` e il `PROBE_KEY`.

### Distribuzione del Probe

#### Docker

Per eseguire un probe, assicurarsi di avere Docker installato. È possibile eseguire un probe personalizzato con:

```
docker run --name oneuptime-probe --network host -e PROBE_KEY=<probe-key> -e PROBE_ID=<probe-id> -e ONEUPTIME_URL=https://oneuptime.com -d oneuptime/probe:release
```

Se si ospita autonomamente OneUptime, è possibile cambiare `ONEUPTIME_URL` con la propria istanza self-hosted personalizzata.

##### Configurazione Proxy

Se il probe deve passare attraverso un server proxy per raggiungere OneUptime o monitorare risorse esterne, è possibile configurare le impostazioni proxy usando queste variabili d'ambiente:

```
# Per proxy HTTP
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTP_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release

# Per proxy HTTPS
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTPS_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release

# Con autenticazione proxy
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

È anche possibile eseguire il probe usando docker-compose. Creare un file `docker-compose.yml` con il seguente contenuto:

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

##### Con Configurazione Proxy

Se è necessario usare un server proxy, è possibile aggiungere le variabili d'ambiente del proxy:

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
      # Configurazione proxy (opzionale)
      - HTTP_PROXY_URL=http://proxy.example.com:8080
      - HTTPS_PROXY_URL=http://proxy.example.com:8080
      - NO_PROXY=localhost,.internal.example.com
      # Per proxy con autenticazione:
      # - HTTP_PROXY_URL=http://username:password@proxy.example.com:8080
      # - HTTPS_PROXY_URL=http://username:password@proxy.example.com:8080
      # - NO_PROXY=localhost,.internal.example.com
    network_mode: host
    restart: always
```

Quindi eseguire il comando seguente:

```
docker compose up -d
```

Se si ospita autonomamente OneUptime, è possibile cambiare `ONEUPTIME_URL` con la propria istanza self-hosted personalizzata.

#### Kubernetes

È anche possibile eseguire il probe usando Kubernetes. Creare un file `oneuptime-probe.yaml` con il seguente contenuto:

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

##### Con Configurazione Proxy

Se è necessario usare un server proxy, è possibile aggiungere le variabili d'ambiente del proxy:

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
            # Configurazione proxy (opzionale)
            - name: HTTP_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: HTTPS_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: NO_PROXY
              value: "localhost,.internal.example.com"
            # Per proxy con autenticazione, usare:
            # - name: HTTP_PROXY_URL
            #   value: "http://username:password@proxy.example.com:8080"
            # - name: HTTPS_PROXY_URL
            #   value: "http://username:password@proxy.example.com:8080"
            # - name: NO_PROXY
            #   value: "localhost,.internal.example.com"
```

Quindi eseguire il comando seguente:

```bash
kubectl apply -f oneuptime-probe.yaml
```

Se si ospita autonomamente OneUptime, è possibile cambiare `ONEUPTIME_URL` con la propria istanza self-hosted personalizzata.

### Variabili d'Ambiente

Il probe supporta le seguenti variabili d'ambiente:

#### Variabili Obbligatorie

- `PROBE_KEY` - La chiave del probe dal proprio dashboard OneUptime
- `PROBE_ID` - L'ID del probe dal proprio dashboard OneUptime
- `ONEUPTIME_URL` - L'URL della propria istanza OneUptime (predefinito: https://oneuptime.com)

#### Variabili Opzionali

- `HTTP_PROXY_URL` - URL del server proxy HTTP per le richieste HTTP
- `HTTPS_PROXY_URL` - URL del server proxy HTTP per le richieste HTTPS
- `NO_PROXY` - Host o domini separati da virgola che devono bypassare il proxy
- `PROBE_NAME` - Nome personalizzato per il probe
- `PROBE_DESCRIPTION` - Descrizione per il probe
- `PROBE_MONITORING_WORKERS` - Numero di worker di monitoraggio (predefinito: 1)
- `PROBE_MONITOR_FETCH_LIMIT` - Numero di monitor da recuperare alla volta (predefinito: 10)
- `PROBE_MONITOR_RETRY_LIMIT` - Numero di tentativi per monitor falliti (predefinito: 3)
- `PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS` - Timeout per gli script dei monitor sintetici in millisecondi (predefinito: 60000)
- `PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS` - Timeout per gli script dei monitor codice personalizzato in millisecondi (predefinito: 60000)
- `PROBE_API_REQUEST_TIMEOUT_IN_MS` - Tempo limite per ogni richiesta che il probe invia a OneUptime (predefinito: 45000)
- `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` - Registra un avviso per le richieste a OneUptime più lente di questo valore (predefinito: 10000)

#### Configurazione Proxy

Il probe supporta sia server proxy HTTP che HTTPS. Quando configurato, il probe instraderà tutto il traffico di monitoraggio attraverso i server proxy specificati. È anche possibile fornire un elenco `NO_PROXY` separato da virgole per bypassare il proxy per host o reti interne.

**Formato URL Proxy:**

```
http://[username:password@]proxy.server.com:port
```

**Esempi:**

- Proxy base: `http://proxy.example.com:8080`
- Con autenticazione: `http://username:password@proxy.example.com:8080`

**Funzionalità Supportate:**

- Supporto proxy HTTP e HTTPS
- Autenticazione proxy (username/password)
- Fallback automatico tra proxy HTTP e HTTPS
- Bypass selettivo del proxy usando `NO_PROXY`
- Funziona con tutti i tipi di monitor (Sito Web, API, SSL, Sintetico, ecc.)

**Nota:** Sia le variabili d'ambiente standard (`HTTP_PROXY_URL`, `HTTPS_PROXY_URL`, `NO_PROXY`) che le varianti in minuscolo (`http_proxy`, `https_proxy`, `no_proxy`) sono supportate per compatibilità.

### Verifica

Se il probe è in esecuzione correttamente, dovrebbe mostrare `Connected` nel dashboard di OneUptime. Se non appare come connesso, controllare i log del container. Se si hanno ancora problemi, creare un issue su [GitHub](https://github.com/oneuptime/oneuptime) o [contattare il supporto](https://oneuptime.com/support).

### Diagnosi di un Probe Disconnesso

Un probe viene contrassegnato come `Disconnected` quando le sue richieste a OneUptime smettono di andare a buon fine. Il log del probe indica dove si è bloccata ogni richiesta fallita, quindi raramente è necessario tirare a indovinare.

**1. Leggere il blocco di ambiente stampato all'avvio.** Ogni probe stampa all'avvio un unico blocco JSON con l'URL di OneUptime in uso, il tempo limite delle richieste, le impostazioni proxy, i resolver DNS ereditati, la versione di Node/OS e se la verifica TLS è stata disabilitata. Includere sempre questo blocco quando si segnala un problema.

**2. Individuare il report di errore.** Ogni richiesta a OneUptime fallita registra nel log un blocco contenente `stalledAt` e `whatThisMeans`. `stalledAt` è la fase che la richiesta non è mai riuscita a superare:

| `stalledAt` | Significato |
| --- | --- |
| `SocketAssignment` | Nulla ha lasciato la macchina. Il pool di socket era saturo, oppure un proxy configurato non ha mai completato il suo tunnel CONNECT. |
| `TcpConnect` | La macchina ha inviato il SYN e non ha ricevuto nulla in risposta — un firewall o un'appliance di sicurezza sta scartando i pacchetti, oppure l'host è irraggiungibile. |
| `TlsHandshake` | TCP si è connesso, ma TLS non è mai stato completato. Di solito si tratta di un middlebox che ispeziona il traffico TLS. |
| `RequestSend` | Connessione stabilita, ma la richiesta non è mai stata scritta per intero — l'altra estremità ha smesso di leggere. |
| `WaitingForServerResponse` | La richiesta è stata consegnata e il server non ha inviato alcuna risposta. **La rete del probe è a posto** — controllare il server OneUptime, il suo load balancer e il suo reverse proxy. |
| `ResponseBody` | Il server ha iniziato a rispondere e si è bloccato a metà. |

Lo stesso blocco riporta anche `deadlineOverrunInMs`. Se un tempo limite di 45000 ms ha impiegato molto più di 45000 ms di tempo reale, è stato il processo del probe stesso a bloccarsi: controllare `probeProcess.eventLoopMaxDriftInMs` nel blocco prima di indagare sulla rete.

**3. Leggere l'auto-test di connettività.** Dopo tre errori consecutivi il probe verifica lo stesso server un livello alla volta — prima DNS, poi TCP, poi TLS, infine un vero round trip HTTP — e registra ogni fase con i relativi tempi. La prima fase che fallisce è la risposta che si cerca. Quando è configurato un proxy, il probe verifica l'hop verso il proxy, perché è l'unico hop che effettua realmente.

**4. Tenere d'occhio le richieste lente prima che diventino errori.** Le richieste che vanno a buon fine ma impiegano più di `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` vengono registrate nel log con il tempo trascorso. Un probe che inizia a registrare richieste da 20 secondi è ormai prossimo a superare il tempo limite di 45 secondi.

Anche sul lato server di OneUptime viene registrata nel log una richiesta del probe a cui si risponde lentamente — o che il probe ha abbandonato prima che venisse inviata una risposta — insieme all'id del probe. Questi due log, letti insieme, indicano quale lato della connessione è all'origine del problema.
