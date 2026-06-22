# Inviare Dati Syslog a OneUptime

## Panoramica

Il servizio di Ingest OpenTelemetry ora accetta payload Syslog nativi. È possibile inoltrare messaggi da qualsiasi sorgente compatibile RFC3164 o RFC5424 direttamente a OneUptime via HTTPS. OneUptime analizza la priorità syslog, la facility, la severità, i dati strutturati e il corpo del messaggio prima di archiviare tutto come log ricercabili.

## Prerequisiti

- **Token di Acquisizione Telemetria** – crearne uno da _Impostazioni Progetto → Chiavi di Acquisizione Telemetria_ e copiare il valore di `x-oneuptime-token`.
- **Forwarder Syslog** – qualsiasi strumento in grado di inviare richieste HTTP POST (ad esempio `curl`, `rsyslog` tramite `omhttp`, o `syslog-ng` con il plugin di destinazione HTTP).
- **Nome servizio (opzionale)** – impostare l'intestazione `x-oneuptime-service-name` per raggruppare i log in entrata sotto un servizio di telemetria specifico. Se omesso, OneUptime usa come fallback il syslog `APP-NAME`, l'hostname o `Syslog`.

## Endpoint

```
POST https://oneuptime.com/syslog/v1/logs
```

- Sostituire `oneuptime.com` con il proprio host se si ospita autonomamente OneUptime.
- Includere sempre l'intestazione `x-oneuptime-token` nella richiesta.

## Corpo della Richiesta

Inviare stringhe Syslog delimitate da newline o un payload JSON con un array `messages`. Sono supportati entrambi i formati RFC3164 (BSD) e RFC5424.

```json
{
  "messages": [
    "<34>1 2025-03-02T14:48:05.003Z web-01 nginx 7421 ID47 [env@32473 host=\"web-01\"] 502 on /api/login",
    "<13>Feb  5 17:32:18 db-01 postgres[2419]: connection received from 10.0.0.12"
  ]
}
```

### Content Type Supportati

- `application/json` – consigliato.
- `text/plain` – messaggi separati da newline.
- `application/octet-stream` – payload raw. È accettata anche la compressione Gzip (`Content-Encoding: gzip`).

## Test Rapido con curl

```bash
curl \
  -X POST https://oneuptime.com/syslog/v1/logs \
  -H "Content-Type: application/json" \
  -H "x-oneuptime-token: VOSTRA_CHIAVE_TELEMETRIA" \
  -H "x-oneuptime-service-name: production-web" \
  -d '{
    "messages": [
      "<34>1 2025-03-02T14:48:05.003Z web-01 nginx 7421 ID47 [env@32473 host=\"web-01\"] 502 on /api/login"
    ]
  }'
```

## Inoltro da rsyslog

1. Installare il modulo di output HTTP:
   ```bash
   sudo apt-get install rsyslog-omhttp
   ```
2. Aggiungere la destinazione a `/etc/rsyslog.d/oneuptime.conf`:

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
     header="x-oneuptime-token: VOSTRA_CHIAVE_TELEMETRIA"
     header="x-oneuptime-service-name: rsyslog-demo"
     template="OneUptimeJson"
   )
   ```

3. Riavviare rsyslog:
   ```bash
   sudo systemctl restart rsyslog
   ```

## Casi d'uso comuni già osservati

### 1. Apparecchi di rete e sicurezza

La maggior parte degli apparati di rete espone ancora modifiche di configurazione, hit ACL e rilevamenti di minacce esclusivamente via syslog. Puntare il proprio relay esistente (Palo Alto, Fortinet, Cisco ASA, Juniper, pfSense e altri) direttamente a OneUptime, oppure mantenere un relay interno e inoltrare via HTTPS:

```bash
# Snippet rsyslog che raggruppa i messaggi in JSON e li invia a OneUptime
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

### 2. Server Linux e cron job

Molti cron job e daemon legacy registrano ancora esclusivamente tramite la facility kernel/syslog. L'inoltro delle voci di `/var/log/syslog` o journald mantiene le tracce operative in un unico posto. Gli host systemd possono fare affidamento sul bridge journald → syslog:

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

Poiché vengono mappati i codici di severità, è possibile ricevere avvisi su `syslog.severity.name = "error"` o suddividere per `syslog.hostname` per isolare rapidamente gli host rumorosi.

### 3. Controller ingress Kubernetes e nodi edge

Se si esegue già Fluent Bit o Fluentd, mantenerli per i log dei container e aggiungere un sink syslog leggero per gli host o gli apparecchi edge. L'input `syslog` di Fluent Bit si abbina all'output HTTP:

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

Questa configurazione consente di acquisire syslog da worker bare-metal o load balancer hardware senza creare un altro stack di logging.

### 4. Archivi di conformità senza l'attesa

È necessario conservare i log del firewall per PCI o SOX? Inviarli direttamente a OneUptime, applicare una lunga policy di conservazione al servizio di telemetria ed esportare in cold storage da un unico posto. Non più esportazioni da più relay syslog.

## Attributi Analizzati

OneUptime aggiunge automaticamente i seguenti attributi a ciascuna voce di log:

- `syslog.priority`, `syslog.facility.code`, `syslog.facility.name`
- `syslog.severity.code`, `syslog.severity.name`
- `syslog.hostname`, `syslog.appName`, `syslog.processId`, `syslog.messageId`
- `syslog.structured.*` (dati strutturati RFC5424 appiattiti)
- `syslog.raw` (messaggio originale per la tracciabilità)

Questi attributi diventano ricercabili nell'explorer Telemetria → Log.

## Risoluzione dei Problemi

- **HTTP 401 o risultati vuoti** – verificare che l'intestazione `x-oneuptime-token` appartenga al progetto che riceve i log.
- **Nessun log appare** – confermare che il corpo della richiesta contenga effettivamente righe syslog. I corpi vuoti vengono rifiutati con HTTP 400.
- **Nome servizio imprevisto** – impostare `x-oneuptime-service-name` per sovrascrivere la logica di rilevamento predefinita.
- **Grandi burst** – il batch fino a 1.000 righe per richiesta è supportato. I burst più grandi vengono accodati ed elaborati in modo asincrono.
