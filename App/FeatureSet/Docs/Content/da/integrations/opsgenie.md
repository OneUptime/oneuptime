# Opsgenie-integration

Opret en [Opsgenie](https://www.atlassian.com/software/opsgenie)-alarm, når en OneUptime-hændelse oprettes, og luk den, når OneUptime løser den.

Denne integration er **udgående**: OneUptime kalder [Opsgenie Alert API](https://docs.opsgenie.com/docs/alert-api). Den bruger et OneUptime **[Workflow](/docs/workflows/index)** med en **Incident → On Create**-trigger og en **API-komponent**.

```text
OneUptime Incident → On Create  ──►  API component (POST /v2/alerts)  ──►  Opsgenie alert
```

## Forudsætninger

- En Opsgenie **API-nøgle** fra en API-integration: **Settings → Integrations → Add → API**. Kopiér nøglen.
- Kend din region. Standard API-vært er `https://api.opsgenie.com`; EU-konti bruger `https://api.eu.opsgenie.com`.
- Et OneUptime-projekt, hvor du kan oprette workflows.

## Trin 1 — Gem API-nøglen

1. Gå til **Workflows → Global Variables → Create**.
2. Navngiv den `OPSGENIE_KEY`, indsæt API-nøglen, og slå **Is Secret** til.

## Trin 2 — Byg "opret alarm"-workflowet

1. Åbn **Workflows → Create Workflow**, navngiv det `Incidents → Opsgenie`, og åbn **Builder**.
2. Tilføj en **Incident**-trigger sat til **On Create**. Omdøb den til `Incident`.
3. Tilføj en **API**-blok forbundet til triggeren:
   - **Method**: `POST`
   - **URL**: `https://api.opsgenie.com/v2/alerts`  *(brug `api.eu.opsgenie.com` for EU)*
   - **Headers**:

     ```text
     Authorization: GenieKey {{variable.OPSGENIE_KEY}}
     Content-Type: application/json
     ```

   - **Body**:

     ```json
     {
       "message": "{{Incident.title}}",
       "alias": "oneuptime-{{Incident._id}}",
       "description": "{{Incident.description}}",
       "priority": "P1",
       "source": "OneUptime"
     }
     ```

   **`alias`** knytter denne Opsgenie-alarm til OneUptime-hændelsen, så du kan lukke den senere via alias. Bemærk, at Opsgenie auth-skemaet er det bogstavelige ord `GenieKey` efterfulgt af et mellemrum og din nøgle.
4. **Gem**, aktivér, og opret en testhændelse. Et `202 Accepted`-svar i workflowets logfiler betyder, at Opsgenie satte alarmen i kø.

## Trin 3 — Luk ved OneUptime-løsning (anbefalet)

1. Opret et **andet** workflow ved navn `Close Opsgenie` med en **Incident → On Update**-trigger.
2. Tilføj en **Conditions**-blok, der tjekker, om hændelsen nu er løst (forgren på `{{Incident.currentIncidentState.name}}`).
3. Fra **Yes** tilføjer du en **API**-blok:
   - **Method**: `POST`
   - **URL**: `https://api.opsgenie.com/v2/alerts/oneuptime-{{Incident._id}}/close?identifierType=alias`
   - **Headers**: samme `Authorization: GenieKey {{variable.OPSGENIE_KEY}}`
   - **Body**: `{ "source": "OneUptime", "note": "Resolved in OneUptime" }`

Opsgenie slår alarmen op via alias og lukker den.

## Afbildning af prioriteter (valgfrit)

Opsgenie-prioriteter går fra `P1`–`P5`. Afbild fra OneUptime-alvorligheder med **Conditions**-grene på `{{Incident.incidentSeverity.name}}` før API-blokken.

## Fejlfinding

- **`401`/`403`** — forkert nøgle, forkert regionsvært, eller integrationen mangler tilladelse til at oprette alarmer. Bekræft, at du bruger en **API**-integrationsnøgle og den tilsvarende `api`/`api.eu`-vært.
- **Luk returnerer `404`** — `alias` i lukkekaldet skal matche oprettekaldet præcist, og `identifierType=alias` skal være i forespørgselsstrengen.
- **Intet sker** — bekræft, at workflowet er **Enabled**.

## Læs videre

- [Integrationsoversigt](/docs/integrations/index) — mønstre og autentificeringsoversigten.
- [PagerDuty](/docs/integrations/pagerduty) — den samme idé for PagerDuty.
- [On Call](/docs/on-call/incoming-call-policy) — OneUptimes indbyggede eskalering.
