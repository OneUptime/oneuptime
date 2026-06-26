# Prometheus Alertmanager-integration

Gør [Prometheus Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/)-notifikationer til OneUptime-hændelser. Prometheus evaluerer dine alarmregler, Alertmanager ruter dem, og OneUptime registrerer og eskalerer dem.

Denne integration er **indgående**: Alertmanager POSTer til et OneUptime **[Workflow](/docs/workflows/index)**, der starter med en **Webhook-trigger**.

```text
Prometheus rule fires  ──►  Alertmanager webhook receiver  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## Forudsætninger

- En Prometheus + Alertmanager-opsætning, hvor du kan redigere `alertmanager.yml`.
- Alertmanager skal kunne nå din OneUptime-instans via HTTPS.
- Et OneUptime-projekt, hvor du kan oprette workflows.

## Trin 1 — Byg OneUptime-workflowet

1. Åbn **Workflows → Create Workflow**, navngiv det `Alertmanager → Incidents`, og åbn **Builder**.
2. Tilføj en **Webhook**-trigger og **kopiér dens URL**. Omdøb blokken til `Alertmanager`.
3. Tilføj en **Conditions**-blok forbundet til triggeren:
   - **Left**: `{{Alertmanager.Request Body.status}}`
   - **Operator**: `==`
   - **Right**: `firing`
4. Fra **Yes** tilføjer du en **Create Incident**-blok:
   - **Title**: `{{Alertmanager.Request Body.commonAnnotations.summary}}`
   - **Description**: `{{Alertmanager.Request Body.commonAnnotations.description}}\nAlert: {{Alertmanager.Request Body.commonLabels.alertname}}`
   - **Severity**: vælg én (eller forgren på `{{Alertmanager.Request Body.commonLabels.severity}}` først).
5. **Gem** (lad det stå deaktiveret, indtil det er testet).

> **Om grupperede alarmer.** Alertmanager grupperer alarmer og sender et `alerts`-**array**. `commonLabels` og `commonAnnotations` ovenfor er de felter, der deles på tværs af gruppen — perfekt til én hændelse per notifikation. Hvis du ønsker **én hændelse per alarm**, tilføj en [Custom Code](/docs/workflows/components#custom-code)-blok, der løber over `Request Body.alerts` og opretter en hændelse for hver. Juster grupperingen med `group_by` i din rute.

## Trin 2 — Konfigurér Alertmanager

Tilføj en webhook-modtager, der peger på workflow-URL'en, og rut alarmer til den. I `alertmanager.yml`:

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

Genindlæs Alertmanager (`curl -X POST http://localhost:9093/-/reload` eller genstart den).

## Trin 3 — Test det

1. Aktivér workflowet.
2. Udløs en testalarm — for eksempel med `amtool`:

   ```bash
   amtool alert add test_alert severity=warning --annotation=summary="Test from Alertmanager" --alertmanager.url=http://localhost:9093
   ```

3. Tjek workflowets **Logs**-fane og din **Incidents**-liste.

## Løsning ved genopretning (valgfrit)

Med `send_resolved: true` POSTer Alertmanager også, når en alarm rydder, denne gang med `status: resolved`. Tilføj en anden **Conditions**-gren (`status == resolved`), find den matchende hændelse (match på `commonLabels.alertname`), og flyt den til din løste tilstand med **Update Incident**.

## Fejlfinding

- **Ingen kørsel vises** — bekræft, at Alertmanager kan nå URL'en (tjek dens logfiler for leveringsfejl), og at workflowet er **Enabled**.
- **Hændelsesfelter er tomme** — forskellige regler sætter forskellige annotationer. Inspicér trigger-outputtet i **Logs**-fanen og referer til felter, der faktisk eksisterer (`commonAnnotations` vs. per-alarm `annotations`).
- **For mange hændelser** — øg `group_by`/`group_interval`, så Alertmanager samler relaterede alarmer.

## Læs videre

- [Integrationsoversigt](/docs/integrations/index) — det indgående mønster.
- [Grafana](/docs/integrations/grafana) — samme idé, Grafana-alarmering.
- [Webhook-trigger](/docs/workflows/triggers#webhook) — hvordan den modtagende URL fungerer.
