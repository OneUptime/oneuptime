# PagerDuty-integratie

Trigger een [PagerDuty](https://www.pagerduty.com)-incident telkens wanneer een OneUptime-incident wordt aangemaakt, en los het op wanneer OneUptime oplost. Handig wanneer PagerDuty je escalatie en oncall-roosters beheert en je OneUptime's monitoring daarin wilt voeden.

Deze integratie is **outbound**: OneUptime roept PagerDuty's [Events API v2](https://developer.pagerduty.com/docs/events-api-v2/overview/) aan. Ze maakt gebruik van een OneUptime **[Workflow](/docs/workflows/index)** met een **Incident → On Create**-trigger en een **API-component**.

> OneUptime heeft zijn eigen ingebouwde oncall en escalatie — zie [On Call](/docs/on-call/incoming-call-policy). Gebruik deze integratie alleen als je events specifiek ook in PagerDuty wilt laten landen.

```text
OneUptime Incident → On Create  ──►  API component (POST /v2/enqueue)  ──►  PagerDuty incident
```

## Vereisten

- Een PagerDuty-service met een **Events API v2**-integratie. In PagerDuty: **Service → Integrations → Add integration → Events API v2**. Kopieer de **Integration Key** (ook wel de _routing key_ genoemd).
- Een OneUptime-project waar je workflows kunt aanmaken.

## Stap 1 — Sla de routing key op

1. Ga naar **Workflows → Global Variables → Create**.
2. Geef het de naam `PAGERDUTY_ROUTING_KEY`, plak de integratiesleutel, en zet **Is Secret** aan.

## Stap 2 — Bouw de "trigger"-workflow

1. Open **Workflows → Create Workflow**, geef het de naam `Incidents → PagerDuty`, en open de **Builder**.
2. Voeg een **Incident**-trigger toe ingesteld op **On Create**. Hernoem het naar `Incident`.
3. Voeg een **API**-blok toe verbonden met de trigger:

   - **Method**: `POST`
   - **URL**: `https://events.pagerduty.com/v2/enqueue`
   - **Headers**: `Content-Type: application/json`
   - **Body**:

     ```json
     {
       "routing_key": "{{variable.PAGERDUTY_ROUTING_KEY}}",
       "event_action": "trigger",
       "dedup_key": "oneuptime-{{Incident._id}}",
       "payload": {
         "summary": "{{Incident.title}}",
         "source": "OneUptime",
         "severity": "critical",
         "custom_details": {
           "description": "{{Incident.description}}"
         }
       }
     }
     ```

   De **`dedup_key`** koppelt dit PagerDuty-incident aan het OneUptime-incident zodat je het later kunt oplossen. Het gebruik van het OneUptime-incident-id maakt het uniek en voorspelbaar.

4. **Sla op**, schakel in en maak een testincident aan. Een respons `202` in de workflow-logs betekent dat PagerDuty het event heeft geaccepteerd.

## Stap 3 — Oplossen bij OneUptime-oplossing (aanbevolen)

1. In **dezelfde** workflow een tweede **Incident**-trigger toevoegen? Nee — een workflow heeft één trigger. Maak in plaats daarvan een **tweede** workflow aan met de naam `Resolve PagerDuty` met een trigger **Incident → On Update**.
2. Voeg een **Conditions**-blok toe om te controleren of het incident nu is opgelost (vertak op de status/`{{Incident.currentIncidentState.name}}` van het incident gelijk aan de naam van je opgeloste status).
3. Voeg vanuit **Yes** een **API**-blok toe naar PagerDuty met dezelfde **`dedup_key`** en `event_action` ingesteld op `resolve`:

   ```json
   {
     "routing_key": "{{variable.PAGERDUTY_ROUTING_KEY}}",
     "event_action": "resolve",
     "dedup_key": "oneuptime-{{Incident._id}}"
   }
   ```

PagerDuty matcht de `dedup_key` en sluit het originele incident.

## Severitymapping (optioneel)

PagerDuty's `severity` accepteert `critical`, `error`, `warning` of `info`. Om te mappen vanuit OneUptime-severities voeg je **Conditions**-takken toe op `{{Incident.incidentSeverity.name}}` vóór het API-blok en stuur je vanuit elke tak een andere body.

## Inbound (optioneel)

Om het omgekeerde te doen — een OneUptime-incident openen vanuit een PagerDuty-event — voeg je een workflow met **Webhook**-trigger toe en wijs je een PagerDuty [V3-webhook](https://developer.pagerduty.com/docs/webhooks/v3-overview/) (of een Events Orchestration) naar de URL ervan, gevolgd door **Create Incident**. Zie het [inbound-patroon](/docs/integrations/index#inbound-another-tool-sends-data-into-oneuptime).

## Probleemoplossing

- **`400` met `"invalid routing key"`** — de integratie moet **Events API v2** zijn, niet de oudere Events API v1 of een ander integratietype. Kopieer de sleutel opnieuw.
- **Oplossen sluit niets** — de `dedup_key` bij de resolve-aanroep moet precies overeenkomen met die van de trigger-aanroep.
- **Niets in de logs** — bevestig dat de workflow **Enabled** is en de trigger op **On Create** staat.

## Waar verder lezen

- [Integraties – Overzicht](/docs/integrations/index) — patronen en het authenticatie-spiekbriefje.
- [On Call](/docs/on-call/incoming-call-policy) — de ingebouwde escalatie van OneUptime.
- [Opsgenie](/docs/integrations/opsgenie) — hetzelfde idee voor Opsgenie.
