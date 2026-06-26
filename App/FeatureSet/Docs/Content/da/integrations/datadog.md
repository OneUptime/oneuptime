# Datadog-integration

Gør [Datadog](https://www.datadoghq.com)-monitoralarmer til OneUptime-hændelser, så Datadogs detektion føder OneUptimes hændelsesrespons og statussider.

Denne integration er **indgående**: Datadogs [Webhooks-integration](https://docs.datadoghq.com/integrations/webhooks/) poster til et OneUptime **[Workflow](/docs/workflows/index)**, der starter med en **Webhook-trigger**.

```text
Datadog monitor alerts  ──►  Webhook integration  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## Forudsætninger

- En Datadog-konto, hvor du kan konfigurere integrationer og monitorer.
- Et OneUptime-projekt, hvor du kan oprette workflows.

## Trin 1 — Byg OneUptime-workflowet

1. Åbn **Workflows → Create Workflow**, navngiv det `Datadog → Incidents`, og åbn **Builder**.
2. Tilføj en **Webhook**-trigger og **kopiér dens URL**. Omdøb blokken til `Datadog`.
3. Tilføj en **Conditions**-blok forbundet til triggeren:
   - **Left**: `{{Datadog.Request Body.transition}}`
   - **Operator**: `==`
   - **Right**: `Triggered`
4. Fra **Yes** tilføjer du en **Create Incident**-blok:
   - **Title**: `{{Datadog.Request Body.title}}`
   - **Description**: `{{Datadog.Request Body.body}}\nHost: {{Datadog.Request Body.host}}\n{{Datadog.Request Body.link}}`
   - **Severity**: vælg én.
5. **Gem** (lad det stå deaktiveret, indtil det er testet).

## Trin 2 — Opret Datadog-webhook'en

1. I Datadog, gå til **Integrations → Webhooks** (installér **Webhooks**-integrationen, hvis du ikke allerede har gjort det).
2. **Tilføj en webhook**:

   - **Name**: `oneuptime` (dette bliver `@webhook-oneuptime`).
   - **URL**: din workflows webhook-URL.
   - **Payload** — Datadog lader dig definere JSON-bodyen ved hjælp af [skabelonvariabler](https://docs.datadoghq.com/integrations/webhooks/#usage):

     ```json
     {
       "title": "$EVENT_TITLE",
       "body": "$TEXT_ONLY_MSG",
       "alert_type": "$ALERT_TYPE",
       "transition": "$ALERT_TRANSITION",
       "id": "$ALERT_ID",
       "host": "$HOSTNAME",
       "link": "$LINK",
       "priority": "$PRIORITY"
     }
     ```

3. Gem webhook'en.

## Trin 3 — Send en monitors alarmer til webhook'en

Tilføj webhook-håndtaget til de monitorer, du ønsker at videresende. I hver monitors **notifikationsbesked**, inkludér:

```text
{{#is_alert}}@webhook-oneuptime{{/is_alert}}
{{#is_recovery}}@webhook-oneuptime{{/is_recovery}}
```

Dette sender både alarmen og genopretningen til OneUptime. (For at videresende alt kan du også tilføje `@webhook-oneuptime` til en monitor ubetinget.)

## Trin 4 — Test det

1. Aktivér workflowet.
2. Fra en monitor, brug **Test Notifications → Alert**, eller lad en rigtig monitor udløse.
3. Tjek workflowets **Logs**-fane og din **Incidents**-liste.

## Løsning ved genopretning (valgfrit)

`$ALERT_TRANSITION` er `Recovered`, når en monitor rydder. Tilføj en anden **Conditions**-gren (`transition == Recovered`), find den matchende hændelse (match på det `id`, du sendte), og flyt den til din løste tilstand med **Update Incident**.

## Fejlfinding

- **Ingen kørsel vises** — bekræft, at monitorens besked inkluderer `@webhook-oneuptime`, og at workflowet er **Enabled**.
- **Felter er tomme** — Datadog erstatter kun skabelonvariabler, der gælder for eventet. Inspicér trigger-outputtet i **Logs**-fanen og justér din webhook-payload.
- **Duplikerede hændelser** — en monitor, der re-alarmer (renotify), sender flere `Triggered`-events; dedupliker med en **Find Incident**-kontrol på `id`'et, før du opretter.

## Læs videre

- [Integrationsoversigt](/docs/integrations/index) — det indgående mønster.
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) og [Grafana](/docs/integrations/grafana) — andre indgående kilder.
- [Webhook-trigger](/docs/workflows/triggers#webhook) — hvordan den modtagende URL fungerer.
