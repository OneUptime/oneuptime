# Ingress Richiesta In Entrata

Un Probe Personalizzato può opzionalmente eseguire un **listener HTTP inbound** che accetta chiamate `heartbeat` e `incoming-request` dall'interno della propria rete privata e le inoltra a OneUptime. Questo permette ai servizi che non hanno **accesso internet in uscita** di segnalare comunque a un [Monitor Richiesta In Entrata](/docs/monitor/incoming-request-monitor) inviando la richiesta a un probe sulla rete locale invece che direttamente a `oneuptime.com`.

## Panoramica

Quando `PROBE_INGRESS_PORT` è impostato, il probe vincola un listener HTTP aggiuntivo su quella porta. Il listener accetta gli stessi percorsi URL con `secretkey` degli endpoint pubblici di OneUptime:

- `POST /heartbeat/:secretkey`
- `GET /heartbeat/:secretkey`
- `POST /incoming-request/:secretkey`
- `GET /incoming-request/:secretkey`

Il probe poi fa da proxy alla richiesta verso la propria istanza OneUptime, preservando il metodo, il corpo e le intestazioni della richiesta (escluse le intestazioni hop-by-hop come `Host`, `Connection`, `Content-Length`, ecc.). Il probe aggiunge automaticamente un'intestazione `OneUptime-Probe-Id` in modo che la richiesta sia attribuita al probe di inoltro.

Il listener viene eseguito su una **porta dedicata**, separata dagli endpoint interni di stato/metriche del probe, così è possibile esporla alla propria rete privata senza esporre altro.

## Quando Usarlo

Usare il listener ingress quando:

- I propri servizi vengono eseguiti in un segmento di rete isolato senza accesso HTTPS in uscita
- Si vuole mantenere tutto il traffico di monitoraggio all'interno del proprio VPC / rete on-premise
- Si vuole un unico punto di uscita — il probe — autorizzato a raggiungere OneUptime
- Si ha già distribuito un [Probe Personalizzato](/docs/probe/custom-probe) e si vuole riutilizzarlo per heartbeat inbound

Se i propri servizi possono già raggiungere `https://oneuptime.com` (o il proprio URL self-hosted) direttamente, **non** è necessaria questa funzionalità — chiamare l'URL heartbeat direttamente dal servizio.

## Abilitazione del Listener Ingress

Impostare `PROBE_INGRESS_PORT` alla porta su cui si vuole far ascoltare il listener. Qualsiasi valore maggiore di `0` abilita il listener; lasciarlo non impostato (o `0`) lo disabilita.

### Docker

```bash
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e PROBE_INGRESS_PORT=3875 \
  -d oneuptime/probe:release
```

Se non si usa `--network host`, pubblicare esplicitamente la porta ingress:

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

I servizi interni possono quindi inviare heartbeat a `http://oneuptime-probe-ingress.<namespace>.svc.cluster.local:3875/heartbeat/<secret-key>`.

## Invio di Richieste al Probe

Sostituire l'URL heartbeat pubblico:

```
https://oneuptime.com/heartbeat/<secret-key>
```

con l'URL ingress del probe:

```
http://<probe-host>:<PROBE_INGRESS_PORT>/heartbeat/<secret-key>
```

Il percorso, il metodo, il corpo e le intestazioni sono altrimenti identici, quindi il codice client esistente deve solo cambiare l'URL base.

### Esempi

```bash
# GET heartbeat
curl http://probe.internal:3875/heartbeat/VOSTRA_CHIAVE_SEGRETA

# POST heartbeat con corpo JSON
curl -X POST http://probe.internal:3875/heartbeat/VOSTRA_CHIAVE_SEGRETA \
  -H "Content-Type: application/json" \
  -d '{"status": "healthy", "version": "1.2.3"}'

# Cron job
*/5 * * * * curl -s http://probe.internal:3875/heartbeat/VOSTRA_CHIAVE_SEGRETA > /dev/null
```

## Comportamento di Inoltro

- **Risposta sincrona, inoltro asincrono.** Il probe accetta immediatamente la richiesta inbound con un `200` e inoltra a OneUptime in background. Il servizio non deve attendere il completamento dell'inoltro.
- **Le intestazioni vengono preservate.** Tutte le intestazioni tranne quelle hop-by-hop (`Host`, `Connection`, `Content-Length`, `Transfer-Encoding`, `Keep-Alive`, `Proxy-Authenticate`, `Proxy-Authorization`, `TE`, `Trailer`, `Upgrade`) vengono passate. Il probe aggiunge un'intestazione `OneUptime-Probe-Id` che lo identifica.
- **Il corpo viene preservato.** I payload JSON, URL-encoded e raw `application/octet-stream` fino a **50 MB** sono accettati.
- **Tentativi con backoff.** Se l'inoltro fallisce, il probe riprova fino a `PROBE_INGRESS_FORWARD_RETRY_LIMIT` volte con backoff esponenziale (2s, 4s, 8s, con massimo a 15s).
- **Consapevole del proxy.** Se il probe stesso è configurato con `HTTP_PROXY_URL` / `HTTPS_PROXY_URL`, le richieste inoltrate passeranno attraverso il proxy.

## Variabili d'Ambiente

| Variabile | Predefinito | Descrizione |
|---|---|---|
| `PROBE_INGRESS_PORT` | _non impostato_ (disabilitato) | Porta su cui il listener inbound si vincola. Qualsiasi valore `> 0` abilita l'ingress. |
| `PROBE_INGRESS_FORWARD_TIMEOUT_MS` | `10000` | Timeout (ms) per ogni tentativo di inoltro a OneUptime. Minimo `1000`. |
| `PROBE_INGRESS_FORWARD_RETRY_LIMIT` | `3` | Numero di tentativi prima che il probe rinunci a un inoltro. Impostare a `0` per disabilitare i tentativi. |

Le variabili standard del probe (`PROBE_KEY`, `PROBE_ID`, `ONEUPTIME_URL`, variabili proxy) si applicano tutte — vedere [Probe Personalizzati](/docs/probe/custom-probe) per l'elenco completo.

## Considerazioni sulla Sicurezza

- **L'endpoint è non autenticato by design** — la chiave segreta nel percorso URL *è* l'autenticazione, proprio come avviene sull'endpoint pubblico di `oneuptime.com`. Trattare la chiave segreta come una credenziale.
- **Vincolare solo a un'interfaccia privata.** Il listener ingress non dovrebbe essere raggiungibile da Internet pubblico. Usare una network policy, una regola firewall o un servizio `ClusterIP` per limitare l'accesso.
- **Usare la terminazione HTTPS se si richiede crittografia in transito.** Il listener del probe parla HTTP semplice. Metterlo dietro un load balancer interno / ingress controller se si necessita di TLS sul hop inbound. Il leg di inoltro dal probe a OneUptime usa sempre HTTPS (assumendo che `ONEUPTIME_URL` sia `https://`).
- **Limiti di risorse.** Il listener accetta corpi di richiesta fino a 50 MB. Se si necessita di un limite più stretto, porre un reverse proxy davanti.

## Risoluzione dei Problemi

- **Il probe registra `Probe ingress listener started on port <port>` all'avvio** — conferma che il listener è attivo. Se non si vede questa riga, `PROBE_INGRESS_PORT` non è impostato, è `0` o non è valido.
- **`Probe ingress: failed to forward to <url> after N attempts`** — il probe non è riuscito a raggiungere OneUptime. Controllare la connettività in uscita del probe, le impostazioni proxy e il valore di `ONEUPTIME_URL`.
- **`Probe ingress: probe ID not available, forwarding without it`** — il probe non si è ancora registrato. L'inoltro ha comunque successo; l'heartbeat semplicemente non sarà attribuito a un probe.
- **L'heartbeat appare in OneUptime ma non tramite il probe** — confermare che il servizio stia raggiungendo `http://<probe-host>:<porta>/...` e non l'URL pubblico. Una voce DNS o `/etc/hosts` mal configurata è la causa più comune.

## Correlati

- [Probe Personalizzati](/docs/probe/custom-probe)
- [Monitor Richiesta In Entrata](/docs/monitor/incoming-request-monitor)
