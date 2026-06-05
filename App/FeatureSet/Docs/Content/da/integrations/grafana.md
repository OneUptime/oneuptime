# Grafana-integration

Gør [Grafana](https://grafana.com)-alarmer til OneUptime-hændelser. Grafana evaluerer alarmreglerne på dine dashboards; OneUptime registrerer, eskalerer og sporer dem.

Denne integration er **indgående**: Grafanas alarmering poster til et OneUptime **[Workflow](/docs/workflows/index)**, der starter med en **Webhook-trigger**, ved hjælp af et Grafana **Webhook contact point**.

```text
Grafana alert rule fires  ──►  Webhook contact point  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## Forudsætninger

- Grafana 9+ med [unified alerting](https://grafana.com/docs/grafana/latest/alerting/) aktiveret (standarden på moderne Grafana).
- Grafana skal kunne nå din OneUptime-instans via HTTPS.
- Et OneUptime-projekt, hvor du kan oprette workflows.

## Trin 1 — Byg OneUptime-workflowet

1. Åbn **Workflows → Create Workflow**, navngiv det `Grafana → Incidents`, og åbn **Builder**.
2. Tilføj en **Webhook**-trigger og **kopiér dens URL**. Omdøb blokken til `Grafana`.
3. Tilføj en **Conditions**-blok forbundet til triggeren:
   - **Left**: `{{Grafana.Request Body.status}}`
   - **Operator**: `==`
   - **Right**: `firing`
4. Fra **Yes** tilføjer du en **Create Incident**-blok:
   - **Title**: `{{Grafana.Request Body.title}}`
   - **Description**: `{{Grafana.Request Body.message}}`
   - **Severity**: vælg én (eller forgren på `{{Grafana.Request Body.commonLabels.severity}}`).
5. **Gem** (lad det stå deaktiveret, indtil det er testet).

Grafanas webhook-payload følger Alertmanager-formen — den inkluderer `status`, et `alerts`-array, `commonLabels` og `commonAnnotations`, plus praktiske øverste-niveau-felter `title` og `message`.

## Trin 2 — Konfigurér Grafana contact point

1. I Grafana, gå til **Alerting → Contact points → Add contact point**.
2. **Name**: `OneUptime`. **Integration**: **Webhook**.
3. **URL**: indsæt din workflows webhook-URL. **HTTP Method**: `POST`.
4. Gem contact point'et.
5. Gå til **Alerting → Notification policies** og rut de alarmer, du ønsker (eller standardpolitikken), til **OneUptime**-contact point'et.

## Trin 3 — Test det

1. Aktivér workflowet.
2. I contact point-skærmen, brug **Test** til at sende en prøvenotifikation, eller lad en rigtig alarmregel udløse.
3. Tjek workflowets **Logs**-fane og din **Incidents**-liste.

## Løsning ved genopretning (valgfrit)

Når alarmen rydder, sender Grafana endnu en notifikation med `status: resolved`. Tilføj en anden **Conditions**-gren (`status == resolved`), find den matchende hændelse, og flyt den til din løste tilstand med **Update Incident**.

## Noter

- **Legacy alerting (Grafana 8 og tidligere)** sender en anden payload (`ruleName`, `state`, `evalMatches`). Hvis du er på legacy alerting, referer til `{{Grafana.Request Body.ruleName}}` og `{{Grafana.Request Body.state}}` i stedet, og forgren på `state == alerting`.
- Du kan også springe Grafanas alarmering over og lade OneUptime overvåge de samme metrikker direkte — se [Metrics Monitor](/docs/monitor/metrics-monitor).

## Fejlfinding

- **Ingen kørsel vises** — bekræft, at Grafana kan nå URL'en (tjek Grafanas serverlogfiler), og at workflowet er **Enabled**.
- **Tomme felter** — inspicér trigger-outputtet i **Logs**-fanen; referer til felter, der eksisterer for din alarmversion.

## Læs videre

- [Integrationsoversigt](/docs/integrations/index) — det indgående mønster.
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — tæt relateret payload.
- [Metrics Monitor](/docs/monitor/metrics-monitor) — overvåg metrikker i OneUptime direkte.
