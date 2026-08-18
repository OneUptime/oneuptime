# Integrazione con Prometheus Alertmanager

Trasforma le notifiche di [Prometheus Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/) in incidenti OneUptime. Prometheus valuta le tue regole di alerting, Alertmanager le instrada, e OneUptime le registra e le escala.

Questa integrazione è **in entrata**, e ci sono due modi per realizzarla:

| Approccio                                                                                | Usalo quando                                                                                                                                                           |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[Monitor Richiesta In Entrata](/docs/monitor/incoming-request-monitor)** (consigliato) | Vuoi che gli allarmi diventino incidenti con escalation di reperibilità, un incidente per allarme e risoluzione automatica al ripristino. Nessuna logica da mantenere. |
| **[Workflow](/docs/workflows/index) con un trigger Webhook**                             | Ti serve logica di instradamento che OneUptime non offre nativamente — chiamare altri sistemi, rimodellare payload, ramificazioni condizionali.                        |

```text
Prometheus rule fires  ──►  Alertmanager webhook receiver  ──►  OneUptime  ──►  Incident + on-call
```

## Prerequisiti

- Un'installazione Prometheus + Alertmanager in cui puoi modificare `alertmanager.yml`.
- Alertmanager deve poter raggiungere la tua istanza OneUptime via HTTPS.
- Un progetto OneUptime in cui puoi creare monitor (o workflow).

## Opzione 1 — Monitor Richiesta In Entrata

### Passaggio 1 — Crea il monitor

1. Vai su **Monitor → Crea monitor** e scegli **Richiesta in entrata**.
2. Apri il monitor e fai clic su **Documentation** nel menu di sinistra. Copia l'URL:

   ```
   https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
   ```

   Usa il tuo host se è self-hosted. La chiave segreta nel percorso è l'unica credenziale.

### Passaggio 2 — Punta Alertmanager su di esso

In `alertmanager.yml`:

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/YOUR_SECRET_KEY"
        send_resolved: true

route:
  receiver: oneuptime
  group_by: ["alertname", "instance"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
```

`send_resolved: true` è obbligatorio: è ciò che comunica a OneUptime che un allarme è rientrato. Ricarica Alertmanager con `curl -X POST http://localhost:9093/-/reload`, oppure riavvialo.

Alertmanager invia `Content-Type: application/json`, di cui OneUptime ha bisogno per leggere i campi dal payload.

### Passaggio 3 — Configura i criteri

Apri i **Criteria** del monitor e modifica il primo criterio.

**Filtro**

- **Filter Type**: `JavaScript Expression`
- **Filter Condition**: `Evaluates To True`
- **Value**: `"{{requestBody.status}}" === "firing"`

  Le virgolette attorno al segnaposto sono necessarie per un confronto tra stringhe. Funziona anche un filtro `Request Body` / `Contains` / `"status":"firing"` se preferisci non usare un'espressione.

**Azioni**

- Attiva _When filters match, change monitor status_ e impostalo su **Offline** (o Degraded).
- Attiva _When filters match, declare an incident_. Imposta **Title**, **Severity** e le **On-Call Policies** da allertare.
- Sotto **Advanced Options** di quell'incidente, attiva **Auto Resolve Incident**. Senza questo, le notifiche di ripristino vengono ignorate e gli incidenti restano aperti per sempre.

**Settings → Group incidents and alerts by a payload field**

Attivalo così che un unico endpoint possa tenere più incidenti contemporanei — uno per allarme — invece di un singolo incidente per notifica.

| Campo                              | Valore                              |
| ---------------------------------- | ----------------------------------- |
| Open a separate incident for each… | `requestBody.alerts[*].fingerprint` |
| Field that signals recovery        | `requestBody.alerts[*].status`      |
| Value that means recovered         | `resolved`                          |
| Max incidents per request          | `100`                               |

`[*]` si espande sull'array `alerts` di Alertmanager, aprendo un incidente per ogni valore estratto **distinto**. Poiché entrambi i percorsi usano `[*]`, il ripristino viene giudicato per singolo allarme: in un payload dove un allarme è risolto e due sono ancora attivi, si chiude solo quello risolto.

> **Warning:** Raggruppa su qualcosa di davvero univoco per allarme. Il `fingerprint` di Alertmanager è un hash dell'intero set di label dell'allarme, quindi lo è sempre. Una label va bene solo se varia **all'interno** di una notifica — e qualsiasi label elencata nel `group_by` della tua route non varia mai, perché è proprio ciò che definisce il gruppo di aggregazione. Con il `group_by: ["alertname", "instance"]` sopra, raggruppare su `requestBody.alerts[*].labels.alertname` estrae lo stesso valore da ogni allarme del payload, quindi tutti si fondono in un unico incidente. Peggio ancora, dei valori duplicati resta solo la **prima** occorrenza, quindi un payload il cui primo allarme è `resolved` chiude quell'incidente mentre gli altri sono ancora attivi.

### Passaggio 4 — Scrivi titolo e descrizione dell'incidente

La chiave di raggruppamento è disponibile come variabile con il nome dell'ultimo segmento del percorso, quindi `requestBody.alerts[*].fingerprint` ti dà `{{fingerprint}}`. È un hash, non qualcosa da mostrare a chi risponde: intitola invece l'incidente con le label condivise dalla notifica. `commonLabels` contiene ogni label del `group_by` della tua route, quindi con la configurazione sopra sono disponibili sia `alertname` sia `instance`:

- **Title**: `{{requestBody.commonLabels.alertname}} on {{requestBody.commonLabels.instance}}`
- **Description**:

  ```
  {{requestBody.commonAnnotations.summary}}

  {{requestBody.commonAnnotations.description}}
  Severity: {{requestBody.commonLabels.severity}}
  Alertmanager: {{requestBody.externalURL}}
  ```

`commonLabels` e `commonAnnotations` contengono i campi condivisi dalla notifica. Un percorso per singolo allarme come `requestBody.alerts[0].annotations.summary` legge sempre il _primo_ allarme del payload, non quello per cui è stato aperto questo particolare incidente — quindi mantieni `group_by` stretto se vuoi che ogni incidente porti il proprio testo di annotazione. Un percorso che non si risolve viene stampato alla lettera, parentesi graffe comprese, anziché restare vuoto. Vedi [Modelli dinamici di incidenti e avvisi](/docs/monitor/incident-alert-templating) per l'elenco completo delle variabili.

### Passaggio 5 — Riporta il monitor a Operational (opzionale)

I criteri agiscono solo quando corrispondono, quindi aggiungi un secondo criterio perché il monitor non resti Offline dopo che tutto è rientrato:

- **Filter Type**: `JavaScript Expression`, **Value**: `"{{requestBody.status}}" === "resolved"`
- _Change monitor status to_ **Operational**, e non dichiarare alcun incidente.

### Passaggio 6 — Testalo

```bash
curl -X POST https://oneuptime.com/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{
    "version": "4",
    "status": "firing",
    "commonLabels": { "alertname": "HighCPU", "severity": "critical" },
    "commonAnnotations": { "summary": "CPU above 90% for 5m" },
    "externalURL": "http://alertmanager:9093",
    "alerts": [
      {
        "status": "firing",
        "labels": { "alertname": "HighCPU", "instance": "web-1" },
        "fingerprint": "a1b2c3d4e5f60001"
      },
      {
        "status": "firing",
        "labels": { "alertname": "HighCPU", "instance": "web-2" },
        "fingerprint": "a1b2c3d4e5f60002"
      }
    ]
  }'
```

Dovresti ottenere due incidenti — uno per `fingerprint`. Rinvia la richiesta con lo `status` di entrambi gli allarmi impostato su `resolved` ed entrambi dovrebbero chiudersi.

Puoi anche generare un allarme reale con `amtool`:

```bash
amtool alert add test_alert severity=warning \
  --annotation=summary="Test from Alertmanager" \
  --alertmanager.url=http://localhost:9093
```

## Opzione 2 — Workflow

Usalo quando ti serve logica che va oltre "un allarme diventa un incidente".

1. Apri **Flussi di lavoro → Crea flusso di lavoro**, chiamalo `Alertmanager → Incidents` e apri il **Costruttore**.
2. Aggiungi un trigger **Webhook** e **copia il suo URL**. Rinomina il blocco in `Alertmanager`.
3. Aggiungi un blocco **Condizioni** collegato al trigger:
   - **Left**: `{{Alertmanager.Request Body.status}}`
   - **Operator**: `==`
   - **Right**: `firing`
4. Da **Sì**, aggiungi un blocco **Crea incidente**:
   - **Titolo**: `{{Alertmanager.Request Body.commonAnnotations.summary}}`
   - **Descrizione**: `{{Alertmanager.Request Body.commonAnnotations.description}}\nAlert: {{Alertmanager.Request Body.commonLabels.alertname}}`
   - **Gravità**: scegline una (o ramifica prima su `{{Alertmanager.Request Body.commonLabels.severity}}`).
5. **Salva**, poi punta l'URL di `webhook_configs` del Passaggio 2 sopra sull'URL del workflow.

Per un incidente per allarme, aggiungi un blocco [Custom Code](/docs/workflows/components#custom-code) che itera su `Request Body.alerts`. Con `send_resolved: true`, aggiungi un secondo ramo **Condizioni** su `status == resolved` che trova l'incidente corrispondente e lo sposta nel tuo stato risolto con **Update Incident**.

## Interruttore dell'uomo morto

Nessuna delle due opzioni ti dice quando è Prometheus stesso a fermarsi: nessun allarme in arrivo somiglia esattamente a "va tutto bene". La risposta abituale è un allarme sempre attivo instradato verso un monitor che se lo aspetta secondo una pianificazione. [kube-prometheus-stack](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack) ne include uno chiamato `Watchdog`; su un Prometheus semplice, aggiungi una regola di alerting con un'espressione sempre vera (`vector(1)`).

Crea un **secondo** Monitor Richiesta In Entrata, instrada `Watchdog` verso di esso con un `repeat_interval` breve, e assegna a quel monitor un criterio **Filter Type: Incoming Request** / **Filter Condition: Not Recieved In Minutes**. È l'unico caso in cui un criterio di richiesta mancante ha senso su un ricevitore di allarmi.

Questa è la configurazione del Passaggio 2 con la route e il receiver del watchdog integrati — una sotto-route viene valutata prima del receiver della route padre, quindi `Watchdog` va al secondo monitor e tutto il resto continua ad andare al primo:

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/YOUR_SECRET_KEY"
        send_resolved: true

  - name: oneuptime-watchdog
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/WATCHDOG_SECRET_KEY"

route:
  receiver: oneuptime
  group_by: ["alertname", "instance"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - receiver: oneuptime-watchdog
      matchers:
        - alertname = "Watchdog"
      group_wait: 0s
      group_interval: 5m
      repeat_interval: 5m
```

## Risoluzione dei problemi

- **Non arriva nulla** — verifica che Alertmanager riesca a raggiungere l'URL; controlla i suoi log per errori di consegna. OneUptime risponde a ogni richiesta con un `200` vuoto prima di validare qualsiasi cosa, quindi un `200` non conferma che il payload sia stato accettato. Controlla invece la timeline del monitor.
- **Gli incidenti si aprono ma non si chiudono mai** — controlla `send_resolved: true` in Alertmanager, il campo e il valore di ripristino nel criterio (il confronto distingue maiuscole e minuscole) e **Auto Resolve Incident** sotto le **Advanced Options** dell'incidente. Due cause più sottili: un payload con più chiavi distinte di **Max incidents per request** nasconde al ripristino anche quelle oltre il limite; e se è proprio la notifica `resolved` a essere scartata dall'unificazione in ingest (sotto), l'incidente resta bloccato per sempre, perché Alertmanager ripete le notifiche di attivazione ma non quelle di risoluzione. Chiudi quelle a mano.
- **Nessun incidente, stato del monitor invariato** — il percorso di raggruppamento deve iniziare con il letterale `requestBody.`, e solo il primo `[*]` di un percorso è un carattere jolly. Entrambi gli errori falliscono in silenzio.
- **Il testo dell'incidente mostra segnaposto `{{...}}` grezzi** — il percorso non si è risolto, e OneUptime lascia i segnaposto non risolti al loro posto anziché svuotarli. Regole diverse impostano annotazioni diverse, quindi fai riferimento a campi che esistono davvero per le tue regole (`commonAnnotations` rispetto alle `annotations` del singolo allarme).
- **Un solo incidente per un payload pieno di allarmi** — hai raggruppato su una label che non varia all'interno di una notifica, molto spesso una che è anche nel `group_by` della tua route. Raggruppa invece su `requestBody.alerts[*].fingerprint`.
- **Troppi incidenti** — allarga `group_by` / `group_interval` così che Alertmanager raggruppi gli allarmi correlati. Abbassare **Max incidents per request** li limita, ma nasconde anche al ripristino le chiavi oltre il limite.
- **Alcune notifiche sembrano saltate durante raffiche intense** — le richieste allo stesso monitor vengono unificate in ingest così che un solo mittente non possa sovraccaricarlo, il che può scartare un payload intermedio quando le notifiche arrivano una dietro l'altra. Aumentare `group_wait` e `group_interval` le distanzia. L'unificazione è controllata dalla variabile d'ambiente `INCOMING_REQUEST_INGEST_COALESCE_ENABLED` del container dell'applicazione, attiva per impostazione predefinita; chi è in self-hosting e ha bisogno che ogni payload venga valutato può impostarla a `false` su quel container.

## Dove leggere poi

- [Monitor Richiesta In Entrata](/docs/monitor/incoming-request-monitor) — il tipo di monitor, i suoi criteri e il raggruppamento degli incidenti per esteso.
- [Panoramica delle integrazioni](/docs/integrations/index) — i pattern in entrata e in uscita.
- [Grafana](/docs/integrations/grafana) — stessa idea, con l'alerting di Grafana.
- [Trigger Webhook](/docs/workflows/triggers#webhook) — come funziona l'URL ricevente del workflow.
