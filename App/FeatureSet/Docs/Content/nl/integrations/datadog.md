# Datadog-integratie

Zet [Datadog](https://www.datadoghq.com)-monitoralerts om in OneUptime-incidenten, zodat de detectie van Datadog de incidentrespons en statuspagina's van OneUptime voedt.

Deze integratie is **inbound**: Datadog's [Webhooks-integratie](https://docs.datadoghq.com/integrations/webhooks/) post naar een OneUptime **[Workflow](/docs/workflows/index)** die start met een **Webhook trigger**.

```text
Datadog monitor alerts  ──►  Webhook integration  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## Vereisten

- Een Datadog-account waar je integraties en monitors kunt configureren.
- Een OneUptime-project waar je workflows kunt aanmaken.

## Stap 1 — Bouw de OneUptime-workflow

1. Open **Workflows → Create Workflow**, geef het de naam `Datadog → Incidents`, en open de **Builder**.
2. Voeg een **Webhook**-trigger toe en **kopieer de URL**. Hernoem het blok naar `Datadog`.
3. Voeg een **Conditions**-blok toe verbonden met de trigger:
   - **Left**: `{{Datadog.Request Body.transition}}`
   - **Operator**: `==`
   - **Right**: `Triggered`
4. Voeg vanuit **Yes** een **Create Incident**-blok toe:
   - **Title**: `{{Datadog.Request Body.title}}`
   - **Description**: `{{Datadog.Request Body.body}}\nHost: {{Datadog.Request Body.host}}\n{{Datadog.Request Body.link}}`
   - **Severity**: kies er een.
5. **Sla op** (laat uitgeschakeld totdat getest).

## Stap 2 — Maak de Datadog-webhook aan

1. Ga in Datadog naar **Integrations → Webhooks** (installeer de **Webhooks**-integratie als je dat nog niet hebt gedaan).
2. **Voeg een webhook toe**:

   - **Name**: `oneuptime` (dit wordt `@webhook-oneuptime`).
   - **URL**: de webhook-URL van je workflow.
   - **Payload** — Datadog laat je de JSON-body definiëren met [sjabloonvariabelen](https://docs.datadoghq.com/integrations/webhooks/#usage):

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

3. Sla de webhook op.

## Stap 3 — Stuur de alerts van een monitor naar de webhook

Voeg de webhook-handle toe aan de monitors die je wilt doorsturen. Neem in het **notificatiebericht** van elke monitor het volgende op:

```text
{{#is_alert}}@webhook-oneuptime{{/is_alert}}
{{#is_recovery}}@webhook-oneuptime{{/is_recovery}}
```

Hiermee worden zowel de alert als het herstel naar OneUptime gestuurd. (Om alles door te sturen kun je ook onvoorwaardelijk `@webhook-oneuptime` toevoegen aan een monitor.)

## Stap 4 — Test het

1. Schakel de workflow in.
2. Gebruik vanuit een monitor **Test Notifications → Alert**, of laat een echte monitor afgaan.
3. Controleer het tabblad **Logs** van de workflow en je lijst met **Incidents**.

## Oplossen bij herstel (optioneel)

`$ALERT_TRANSITION` is `Recovered` wanneer een monitor zich herstelt. Voeg een tweede **Conditions**-tak toe (`transition == Recovered`), zoek het bijbehorende incident (match op het `id` dat je hebt gestuurd), en verplaats het naar je opgeloste status met **Update Incident**.

## Probleemoplossing

- **Er verschijnt geen run** — bevestig dat het bericht van de monitor `@webhook-oneuptime` bevat en dat de workflow **Enabled** is.
- **Velden zijn leeg** — Datadog vervangt alleen sjabloonvariabelen die van toepassing zijn op het event. Bekijk de triggeruitvoer in het tabblad **Logs** en pas je webhook-payload aan.
- **Dubbele incidenten** — een monitor die opnieuw alertt (renotify) stuurt meerdere `Triggered`-events; dedupliceer met een **Find Incident**-controle op het `id` vóór het aanmaken.

## Waar verder lezen

- [Integraties – Overzicht](/docs/integrations/index) — het inbound-patroon.
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) en [Grafana](/docs/integrations/grafana) — andere inbound-bronnen.
- [Webhook trigger](/docs/workflows/triggers#webhook) — hoe de ontvangende URL werkt.
