# Integrazione con Grafana

Trasforma gli allarmi di [Grafana](https://grafana.com) in incidenti OneUptime. Grafana valuta le regole di allarme sulle tue dashboard; OneUptime le registra, le escala e le traccia.

Questa integrazione è **in entrata**: un **contact point Webhook** di Grafana invia in POST a OneUptime. Ci sono due modi per riceverlo.

| Approccio                                                                                | Usalo quando                                                                                                                                    |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **[Monitor Richiesta In Entrata](/docs/monitor/incoming-request-monitor)** (consigliato) | Vuoi che gli allarmi diventino incidenti con escalation di reperibilità, un incidente per allarme e risoluzione automatica al ripristino.       |
| **[Workflow](/docs/workflows/index) con un trigger Webhook**                             | Ti serve logica di instradamento che OneUptime non offre nativamente — chiamare altri sistemi, rimodellare payload, ramificazioni condizionali. |

```text
Grafana alert rule fires  ──►  Webhook contact point  ──►  OneUptime  ──►  Incident + on-call
```

Il payload webhook di Grafana segue la struttura di Alertmanager — `status`, un array `alerts`, `commonLabels` e `commonAnnotations`, oltre ai pratici campi di primo livello `title` e `message`.

## Prerequisiti

- Grafana 9+ con [unified alerting](https://grafana.com/docs/grafana/latest/alerting/) abilitato (il predefinito su Grafana moderno).
- Grafana deve poter raggiungere la tua istanza OneUptime via HTTPS.
- Un progetto OneUptime in cui puoi creare monitor (o workflow).

## Opzione 1 — Monitor Richiesta In Entrata

1. Vai su **Monitor → Crea monitor** e scegli **Richiesta in entrata**. Aprilo e fai clic su **Documentation** nel menu di sinistra per copiare l'URL.
2. Apri i **Criteria** del monitor e imposta **Filter Type** su `JavaScript Expression` e **Value** su `"{{requestBody.status}}" === "firing"`.
3. Dichiara un incidente alla corrispondenza, scegli le **On-Call Policies** da allertare e attiva **Auto Resolve Incident** sotto **Advanced Options**.
4. Sotto **Settings**, attiva **Group incidents and alerts by a payload field** e imposta:

   | Campo                              | Valore                              |
   | ---------------------------------- | ----------------------------------- |
   | Open a separate incident for each… | `requestBody.alerts[*].fingerprint` |
   | Field that signals recovery        | `requestBody.alerts[*].status`      |
   | Value that means recovered         | `resolved`                          |

5. Intitola l'incidente `{{requestBody.commonLabels.alertname}}` e descrivilo con `{{requestBody.message}}` oppure `{{requestBody.commonAnnotations.summary}}`. (`{{fingerprint}}` contiene la chiave di raggruppamento stessa, ma è un hash — non qualcosa da mostrare a chi risponde.)
6. Punta il contact point di Grafana sull'URL del monitor (vedi i passaggi sul contact point più sotto).

Ogni valore di raggruppamento **distinto** diventa un incidente a sé, e ciascuno si chiude quando Grafana lo segnala risolto. Il `fingerprint` per singolo allarme di Grafana è univoco per il set di label di un allarme, ed è per questo che sopra è il percorso di raggruppamento. La pagina [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) illustra la stessa configurazione più nel dettaglio — la struttura del payload è la stessa, quindi ogni passaggio lì vale anche qui.

> **Warning:** Non raggruppare su una label costante all'interno di una notifica. La policy di notifica predefinita di Grafana raggruppa per `grafana_folder` e `alertname`, quindi tutti gli allarmi in un webhook condividono lo stesso alertname — raggruppare su `requestBody.alerts[*].labels.alertname` farebbe collassare l'intero payload in un unico incidente. I percorsi di raggruppamento devono inoltre iniziare con il letterale `requestBody.`, e solo il primo `[*]` di un percorso è un carattere jolly. Tutti questi errori falliscono in silenzio.

## Opzione 2 — Workflow

Usalo quando ti serve logica che va oltre "un allarme diventa un incidente".

### Passaggio 1 — Crea il workflow OneUptime

1. Apri **Flussi di lavoro → Crea flusso di lavoro**, chiamalo `Grafana → Incidents` e apri il **Costruttore**.
2. Aggiungi un trigger **Webhook** e **copia il suo URL**. Rinomina il blocco in `Grafana`.
3. Aggiungi un blocco **Condizioni** collegato al trigger:
   - **Left**: `{{Grafana.Request Body.status}}`
   - **Operator**: `==`
   - **Right**: `firing`
4. Da **Sì**, aggiungi un blocco **Crea incidente**:
   - **Titolo**: `{{Grafana.Request Body.title}}`
   - **Descrizione**: `{{Grafana.Request Body.message}}`
   - **Gravità**: scegline una (o ramifica su `{{Grafana.Request Body.commonLabels.severity}}`).
5. **Salva** (lascia disabilitato finché non è testato).

## Configura il contact point Grafana

1. In Grafana, vai su **Alerting → Contact points → Add contact point**.
2. **Name**: `OneUptime`. **Integration**: **Webhook**.
3. **URL**: incolla l'URL del monitor dell'Opzione 1, oppure l'URL del webhook del workflow dell'Opzione 2. **HTTP Method**: `POST`.
4. Salva il contact point.
5. Vai su **Alerting → Notification policies** e instrada gli allarmi che vuoi (o la policy predefinita) verso il contact point **OneUptime**.

## Testalo

1. Abilita il workflow, se ne hai creato uno.
2. Nella schermata del contact point, usa **Test** per inviare una notifica di esempio, oppure lascia scattare una regola di allarme reale.
3. Controlla il tuo elenco **Incidenti** — e la scheda **Log** del workflow se hai usato l'Opzione 2.

## Risoluzione al ripristino

Quando l'allarme rientra, Grafana invia un'altra notifica con `status: resolved`.

Con l'**Opzione 1**, il campo e il valore di ripristino configurati sopra chiudono automaticamente l'incidente corrispondente — a patto che **Auto Resolve Incident** sia attivo.

Con l'**Opzione 2**, aggiungi un secondo ramo **Condizioni** (`status == resolved`), trova l'incidente corrispondente e spostalo nel tuo stato risolto con **Update Incident**.

## Note

- **L'alerting legacy (Grafana 8 e precedenti)** invia un payload diverso (`ruleName`, `state`, `evalMatches`). Se usi l'alerting legacy, fai riferimento invece a `{{Grafana.Request Body.ruleName}}` e `{{Grafana.Request Body.state}}`, e ramifica su `state == alerting`.
- Puoi anche saltare del tutto l'alerting di Grafana e far monitorare le stesse metriche direttamente a OneUptime — vedi il [Monitor metriche](/docs/monitor/metrics-monitor).

## Risoluzione dei problemi

- **Non arriva nulla** — verifica che Grafana riesca a raggiungere l'URL (controlla i log del server Grafana) e, per l'Opzione 2, che il workflow sia **Abilitato**. OneUptime risponde a ogni richiesta in entrata con un `200` vuoto prima di validarla, quindi un `200` nei log di Grafana non conferma che il payload sia stato accettato.
- **Gli incidenti si aprono ma non si chiudono mai** — controlla il campo e il valore di ripristino nel criterio, e che **Auto Resolve Incident** sia attivo sotto le **Advanced Options** dell'incidente. Il confronto distingue maiuscole e minuscole.
- **Un solo incidente per un payload pieno di allarmi** — hai raggruppato su una label che non varia all'interno di una notifica. Raggruppa invece su `requestBody.alerts[*].fingerprint`.
- **Il testo dell'incidente mostra segnaposto `{{...}}` grezzi** — il percorso non si è risolto, e i segnaposto non risolti restano al loro posto anziché essere svuotati. Fai riferimento a campi che esistono per la tua versione di alerting; ispeziona l'output del trigger nella scheda **Log** se hai usato l'Opzione 2.

## Dove leggere poi

- [Monitor Richiesta In Entrata](/docs/monitor/incoming-request-monitor) — il tipo di monitor, i suoi criteri e il raggruppamento degli incidenti per esteso.
- [Panoramica delle integrazioni](/docs/integrations/index) — il pattern in entrata.
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — payload strettamente correlato.
- [Monitor metriche](/docs/monitor/metrics-monitor) — monitora le metriche direttamente in OneUptime.
