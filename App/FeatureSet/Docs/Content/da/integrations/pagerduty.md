# PagerDuty-integration

Udløs en [PagerDuty](https://www.pagerduty.com)-hændelse, når en OneUptime-hændelse oprettes, og løs den, når OneUptime løser den. Nyttigt, når PagerDuty ejer din eskalering og vagtplaner, og du ønsker, at OneUptimes overvågning føder den.

Denne integration er **udgående**: OneUptime kalder PagerDutys [Events API v2](https://developer.pagerduty.com/docs/events-api-v2/overview/). Den bruger et OneUptime **[Workflow](/docs/workflows/index)** med en **Incident → On Create**-trigger og en **API-komponent**.

> OneUptime har sin egen vagtplan og eskalering indbygget — se [On Call](/docs/on-call/incoming-call-policy). Brug kun denne integration, hvis du specifikt ønsker, at events også lander i PagerDuty.

```text
OneUptime Incident → On Create  ──►  API component (POST /v2/enqueue)  ──►  PagerDuty incident
```

## Forudsætninger

- En PagerDuty-tjeneste med en **Events API v2**-integration. I PagerDuty: **Service → Integrations → Add integration → Events API v2**. Kopiér **Integration Key** (også kaldet *routing key*).
- Et OneUptime-projekt, hvor du kan oprette workflows.

## Trin 1 — Gem routing-nøglen

1. Gå til **Workflows → Global Variables → Create**.
2. Navngiv den `PAGERDUTY_ROUTING_KEY`, indsæt integrationsnøglen, og slå **Is Secret** til.

## Trin 2 — Byg "trigger"-workflowet

1. Åbn **Workflows → Create Workflow**, navngiv det `Incidents → PagerDuty`, og åbn **Builder**.
2. Tilføj en **Incident**-trigger sat til **On Create**. Omdøb den til `Incident`.
3. Tilføj en **API**-blok forbundet til triggeren:
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

   **`dedup_key`** knytter denne PagerDuty-hændelse til OneUptime-hændelsen, så du kan løse den senere. Brug af OneUptime-hændelsens id holder den unik og forudsigelig.
4. **Gem**, aktivér, og opret en testhændelse. Et `202`-svar i workflowets logfiler betyder, at PagerDuty accepterede eventet.

## Trin 3 — Løs ved OneUptime-løsning (anbefalet)

1. I det **samme** workflow, tilføj en anden **Incident**-trigger? Nej — et workflow har én trigger. Opret i stedet et **andet** workflow ved navn `Resolve PagerDuty` med en **Incident → On Update**-trigger.
2. Tilføj en **Conditions**-blok for at tjekke, om hændelsen nu er løst (forgren på hændelsens tilstand/`{{Incident.currentIncidentState.name}}` svarende til dit løste tilstandsnavn).
3. Fra **Yes** tilføjer du en **API**-blok til PagerDuty med den **samme `dedup_key`** og `event_action` sat til `resolve`:

   ```json
   {
     "routing_key": "{{variable.PAGERDUTY_ROUTING_KEY}}",
     "event_action": "resolve",
     "dedup_key": "oneuptime-{{Incident._id}}"
   }
   ```

PagerDuty matcher `dedup_key` og lukker den originale hændelse.

## Afbildning af alvorligheder (valgfrit)

PagerDutys `severity` accepterer `critical`, `error`, `warning` eller `info`. For at afbilde fra OneUptime-alvorligheder tilføjer du **Conditions**-grene på `{{Incident.incidentSeverity.name}}` før API-blokken og sender en anden body fra hver.

## Indgående (valgfrit)

For at gå den anden vej — åbn en OneUptime-hændelse fra et PagerDuty-event — tilføj et **Webhook**-trigger-workflow og peg et PagerDuty [V3 webhook](https://developer.pagerduty.com/docs/webhooks/v3-overview/) (eller en Events Orchestration) mod dens URL, og brug derefter **Create Incident**. Se det [indgående mønster](/docs/integrations/index#inbound-another-tool-sends-data-into-oneuptime).

## Fejlfinding

- **`400` med `"invalid routing key"`** — integrationen skal være **Events API v2**, ikke den ældre Events API v1 eller en anden integrationstype. Kopiér nøglen igen.
- **Løsning lukker ingenting** — `dedup_key` i løsningskaldet skal matche trigger-kaldet præcist.
- **Intet i logfilerne** — bekræft, at workflowet er **Enabled**, og triggeren er **On Create**.

## Læs videre

- [Integrationsoversigt](/docs/integrations/index) — mønstre og autentificeringsoversigten.
- [On Call](/docs/on-call/incoming-call-policy) — OneUptimes indbyggede eskalering.
- [Opsgenie](/docs/integrations/opsgenie) — den samme idé for Opsgenie.
