# PagerDuty-integrasjon

Utløs en [PagerDuty](https://www.pagerduty.com)-hendelse hver gang en OneUptime-hendelse opprettes, og løs den når OneUptime løser. Nyttig når PagerDuty eier eskalerings- og vaktordningsplanene dine og du vil at OneUptime-overvåkingen skal mate inn i den.

Denne integrasjonen er **utgående**: OneUptime kaller PagerDutys [Events API v2](https://developer.pagerduty.com/docs/events-api-v2/overview/). Den bruker en OneUptime **[Arbeidsflyt](/docs/workflows/index)** med en **Incident → On Create**-trigger og en **API-komponent**.

> OneUptime har sin egen vaktordning og eskalering innebygd — se [On Call](/docs/on-call/incoming-call-policy). Bruk denne integrasjonen bare hvis du spesifikt vil at hendelser skal lande i PagerDuty i tillegg.

```text
OneUptime Incident → On Create  ──►  API component (POST /v2/enqueue)  ──►  PagerDuty incident
```

## Forutsetninger

- En PagerDuty-tjeneste med en **Events API v2**-integrasjon. I PagerDuty: **Service → Integrations → Add integration → Events API v2**. Kopier **Integration Key** (også kalt _routing key_).
- Et OneUptime-prosjekt der du kan opprette arbeidsflyter.

## Steg 1 — Lagre routing key-en

1. Gå til **Workflows → Global Variables → Create**.
2. Gi den navnet `PAGERDUTY_ROUTING_KEY`, lim inn integrasjonsnøkkelen, og slå på **Is Secret**.

## Steg 2 — Bygg "trigger"-arbeidsflyten

1. Åpne **Workflows → Create Workflow**, gi den navnet `Incidents → PagerDuty`, og åpne **Builder**.
2. Legg til en **Incident**-trigger satt til **On Create**. Gi den nytt navn `Incident`.
3. Legg til en **API**-blokk koblet til triggeren:

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

   **`dedup_key`** knytter denne PagerDuty-hendelsen til OneUptime-hendelsen slik at du kan løse den senere. Å bruke OneUptime-hendelse-ID-en holder den unik og forutsigbar.

4. **Lagre**, aktiver, og opprett en testhendelse. Et `202`-svar i arbeidsflytloggene betyr at PagerDuty aksepterte hendelsen.

## Steg 3 — Løs ved OneUptime-løsning (anbefalt)

1. I den **samme** arbeidsflyten, legge til en ny **Incident**-trigger? Nei — en arbeidsflyt har én trigger. Opprett i stedet en **andre** arbeidsflyt kalt `Resolve PagerDuty` med en **Incident → On Update**-trigger.
2. Legg til en **Conditions**-blokk for å sjekke at hendelsen nå er løst (forgren på hendelsens tilstand/`{{Incident.currentIncidentState.name}}` lik ditt løste tilstandsnavn).
3. Fra **Yes**, legg til en **API**-blokk til PagerDuty med den **samme `dedup_key`** og `event_action` satt til `resolve`:

   ```json
   {
     "routing_key": "{{variable.PAGERDUTY_ROUTING_KEY}}",
     "event_action": "resolve",
     "dedup_key": "oneuptime-{{Incident._id}}"
   }
   ```

PagerDuty matcher `dedup_key` og lukker den opprinnelige hendelsen.

## Alvorlighetsgrads-mapping (valgfritt)

PagerDutys `severity` godtar `critical`, `error`, `warning` eller `info`. For å mappe fra OneUptime-alvorlighetsgrader, legg til **Conditions**-grener på `{{Incident.incidentSeverity.name}}` før API-blokken og send en annen body fra hver.

## Innkommende (valgfritt)

For å gå den andre veien — åpne en OneUptime-hendelse fra en PagerDuty-hendelse — legg til en **Webhook**-trigger-arbeidsflyt og pek en PagerDuty [V3-webhook](https://developer.pagerduty.com/docs/webhooks/v3-overview/) (eller en Events Orchestration) mot URL-en, og bruk deretter **Create Incident**. Se [det innkommende mønsteret](/docs/integrations/index#inbound-another-tool-sends-data-into-oneuptime).

## Feilsøking

- **`400` med `"invalid routing key"`** — integrasjonen må være **Events API v2**, ikke den eldre Events API v1 eller en annen integrasjonstype. Kopier nøkkelen på nytt.
- **Løsning lukker ingenting** — `dedup_key` på løsningskallet må matche trigger-kallet nøyaktig.
- **Ingenting i loggene** — bekreft at arbeidsflyten er **Enabled** og at triggeren er **On Create**.

## Hvor du leser videre

- [Oversikt over integrasjoner](/docs/integrations/index) — mønstre og autentiserings-juksearket.
- [On Call](/docs/on-call/incoming-call-policy) — OneUptime-s innebygde eskalering.
- [Opsgenie](/docs/integrations/opsgenie) — det samme for Opsgenie.
