# Integrazione con Prometheus Alertmanager

Trasforma le notifiche di [Prometheus Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/) in incidenti OneUptime. Prometheus valuta le tue regole di alerting, Alertmanager le instrada e OneUptime le registra e le gestisce.

Questa integrazione è **in entrata**: Alertmanager fa una POST a un **[Workflow](/docs/workflows/index)** di OneUptime che inizia con un **trigger Webhook**.

```text
Prometheus rule fires  ──►  Alertmanager webhook receiver  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## Prerequisiti

- Un'installazione di Prometheus + Alertmanager in cui puoi modificare `alertmanager.yml`.
- Alertmanager deve poter raggiungere la tua istanza OneUptime via HTTPS.
- Un progetto OneUptime in cui puoi creare workflow.

## Passaggio 1 — Crea il workflow OneUptime

1. Apri **Workflows → Create Workflow**, chiamalo `Alertmanager → Incidents` e apri il **Builder**.
2. Aggiungi un trigger **Webhook** e **copia il suo URL**. Rinomina il blocco in `Alertmanager`.
3. Aggiungi un blocco **Conditions** collegato al trigger:
   - **Left**: `{{Alertmanager.Request Body.status}}`
   - **Operator**: `==`
   - **Right**: `firing`
4. Da **Yes**, aggiungi un blocco **Create Incident**:
   - **Title**: `{{Alertmanager.Request Body.commonAnnotations.summary}}`
   - **Description**: `{{Alertmanager.Request Body.commonAnnotations.description}}\nAlert: {{Alertmanager.Request Body.commonLabels.alertname}}`
   - **Severity**: scegline una (o ramifica prima su `{{Alertmanager.Request Body.commonLabels.severity}}`).
5. **Salva** (lascia disabilitato finché non è testato).

> **Informazioni sugli allarmi raggruppati.** Alertmanager raggruppa gli allarmi e invia un array `alerts`. I `commonLabels` e `commonAnnotations` sopra sono i campi condivisi nell'intero gruppo — perfetti per un incidente per notifica. Se vuoi **un incidente per allarme**, aggiungi un blocco [Custom Code](/docs/workflows/components#custom-code) che itera su `Request Body.alerts` e crea un incidente per ciascuno. Regola il raggruppamento con `group_by` nel tuo route.

## Passaggio 2 — Configura Alertmanager

Aggiungi un receiver webhook che punta all'URL del workflow e instrada gli allarmi verso di esso. In `alertmanager.yml`:

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://<your-workflow-webhook-url>"
        send_resolved: true

route:
  receiver: oneuptime
  group_by: ["alertname"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 3h
```

Ricarica Alertmanager (`curl -X POST http://localhost:9093/-/reload` o riavvialo).

## Passaggio 3 — Testalo

1. Abilita il workflow.
2. Lancia un allarme di test — ad esempio, con `amtool`:

   ```bash
   amtool alert add test_alert severity=warning --annotation=summary="Test from Alertmanager" --alertmanager.url=http://localhost:9093
   ```

3. Controlla la scheda **Logs** del workflow e il tuo elenco **Incidents**.

## Risoluzione al ripristino (opzionale)

Con `send_resolved: true`, Alertmanager fa anche una POST quando un allarme si risolve, questa volta con `status: resolved`. Aggiungi un secondo ramo **Conditions** (`status == resolved`), trova l'incidente corrispondente (cerca per `commonLabels.alertname`) e spostalo nel tuo stato risolto con **Update Incident**.

## Risoluzione dei problemi

- **Nessuna esecuzione appare** — conferma che Alertmanager possa raggiungere l'URL (controlla i suoi log per gli errori di consegna) e che il workflow sia **Enabled**.
- **I campi degli incidenti sono vuoti** — regole diverse impostano annotazioni diverse. Ispeziona l'output del trigger nella scheda **Logs** e fai riferimento ai campi che esistono effettivamente (`commonAnnotations` vs `annotations` per singolo allarme).
- **Troppi incidenti** — aumenta `group_by`/`group_interval` in modo che Alertmanager raggruppi gli allarmi correlati.

## Dove leggere poi

- [Panoramica delle integrazioni](/docs/integrations/index) — il pattern in entrata.
- [Grafana](/docs/integrations/grafana) — la stessa idea, con alerting Grafana.
- [Trigger Webhook](/docs/workflows/triggers#webhook) — come funziona l'URL di ricezione.
