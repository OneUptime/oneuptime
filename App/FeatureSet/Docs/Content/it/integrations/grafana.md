# Integrazione con Grafana

Trasforma gli allarmi di [Grafana](https://grafana.com) in incidenti OneUptime. Grafana valuta le regole di allarme nelle tue dashboard; OneUptime li registra, gestisce e traccia.

Questa integrazione è **in entrata**: l'alerting di Grafana fa una POST a un **[Workflow](/docs/workflows/index)** di OneUptime che inizia con un **trigger Webhook**, utilizzando un **Webhook contact point** di Grafana.

```text
Grafana alert rule fires  ──►  Webhook contact point  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## Prerequisiti

- Grafana 9+ con [unified alerting](https://grafana.com/docs/grafana/latest/alerting/) abilitato (impostazione predefinita nelle versioni moderne di Grafana).
- Grafana deve poter raggiungere la tua istanza OneUptime via HTTPS.
- Un progetto OneUptime in cui puoi creare workflow.

## Passaggio 1 — Crea il workflow OneUptime

1. Apri **Workflows → Create Workflow**, chiamalo `Grafana → Incidents` e apri il **Builder**.
2. Aggiungi un trigger **Webhook** e **copia il suo URL**. Rinomina il blocco in `Grafana`.
3. Aggiungi un blocco **Conditions** collegato al trigger:
   - **Left**: `{{Grafana.Request Body.status}}`
   - **Operator**: `==`
   - **Right**: `firing`
4. Da **Yes**, aggiungi un blocco **Create Incident**:
   - **Title**: `{{Grafana.Request Body.title}}`
   - **Description**: `{{Grafana.Request Body.message}}`
   - **Severity**: scegline una (o ramifica su `{{Grafana.Request Body.commonLabels.severity}}`).
5. **Salva** (lascia disabilitato finché non è testato).

Il payload webhook di Grafana segue la struttura di Alertmanager — include `status`, un array `alerts`, `commonLabels` e `commonAnnotations`, oltre ai pratici campi di primo livello `title` e `message`.

## Passaggio 2 — Configura il contact point Grafana

1. In Grafana, vai su **Alerting → Contact points → Add contact point**.
2. **Name**: `OneUptime`. **Integration**: **Webhook**.
3. **URL**: incolla l'URL webhook del tuo workflow. **HTTP Method**: `POST`.
4. Salva il contact point.
5. Vai su **Alerting → Notification policies** e instrada gli allarmi che vuoi (o la policy predefinita) verso il contact point **OneUptime**.

## Passaggio 3 — Testalo

1. Abilita il workflow.
2. Nella schermata del contact point, usa **Test** per inviare una notifica di esempio, o lascia che scatti una vera regola di allarme.
3. Controlla la scheda **Logs** del workflow e il tuo elenco **Incidents**.

## Risoluzione al ripristino (opzionale)

Quando l'allarme si risolve, Grafana invia un'altra notifica con `status: resolved`. Aggiungi un secondo ramo **Conditions** (`status == resolved`), trova l'incidente corrispondente e spostalo nel tuo stato risolto con **Update Incident**.

## Note

- **Alerting legacy (Grafana 8 e versioni precedenti)** invia un payload diverso (`ruleName`, `state`, `evalMatches`). Se usi l'alerting legacy, fai riferimento a `{{Grafana.Request Body.ruleName}}` e `{{Grafana.Request Body.state}}` e ramifica su `state == alerting`.
- Puoi anche saltare l'alerting di Grafana e far monitorare le stesse metriche direttamente a OneUptime — vedi il [Monitor delle metriche](/docs/monitor/metrics-monitor).

## Risoluzione dei problemi

- **Nessuna esecuzione appare** — conferma che Grafana possa raggiungere l'URL (controlla i log del server Grafana) e che il workflow sia **Enabled**.
- **Campi vuoti** — ispeziona l'output del trigger nella scheda **Logs**; fai riferimento ai campi che esistono per la tua versione di alerting.

## Dove leggere poi

- [Panoramica delle integrazioni](/docs/integrations/index) — il pattern in entrata.
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — payload strettamente correlato.
- [Monitor delle metriche](/docs/monitor/metrics-monitor) — monitora le metriche direttamente in OneUptime.
