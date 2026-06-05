# ServiceNow-integration

Åbn automatisk en [ServiceNow](https://www.servicenow.com)-hændelse, når en OneUptime-hændelse oprettes — så ITSM og overvågning holder trit.

Denne integration er **udgående**: OneUptime kalder ServiceNow [Table API](https://docs.servicenow.com/bundle/utah-application-development/page/integrate/inbound-rest/concept/c_TableAPI.html). Den bruger et OneUptime **[Workflow](/docs/workflows/index)** med en **Incident → On Create**-trigger og en **API-komponent**.

```text
OneUptime Incident → On Create  ──►  API component (POST /api/now/table/incident)  ──►  ServiceNow incident
```

## Forudsætninger

- En ServiceNow-instans (`https://din-instans.service-now.com`).
- En ServiceNow-bruger med rollerne `rest_api_explorer` / `itil` (eller tilstrækkelige rettigheder til at oprette `incident`-poster). Basic auth med denne brugers legitimationsoplysninger er den enkleste start; OAuth anbefales til produktion.
- Et OneUptime-projekt, hvor du kan oprette workflows.

## Trin 1 — Gem legitimationsoplysninger som en hemmelighed

ServiceNows Table API accepterer **Basic auth**.

1. Base64-enkod `brugernavn:adgangskode` én gang:

   ```bash
   printf '%s' 'integration_user:password' | base64
   ```

2. I OneUptime, gå til **Workflows → Global Variables → Create**, navngiv den `SERVICENOW_AUTH`, indsæt base64-strengen, og slå **Is Secret** til.

## Trin 2 — Byg workflowet

1. Åbn **Workflows → Create Workflow**, navngiv det `Incidents → ServiceNow`, og åbn **Builder**.
2. Tilføj en **Incident**-trigger sat til **On Create**. Omdøb den til `Incident`.
3. Tilføj en **API**-blok forbundet til triggeren:
   - **Method**: `POST`
   - **URL**: `https://din-instans.service-now.com/api/now/table/incident`
   - **Headers**:

     ```text
     Authorization: Basic {{variable.SERVICENOW_AUTH}}
     Content-Type: application/json
     Accept: application/json
     ```

   - **Body**:

     ```json
     {
       "short_description": "OneUptime: {{Incident.title}}",
       "description": "{{Incident.description}}",
       "urgency": "1",
       "impact": "1",
       "correlation_id": "oneuptime-{{Incident._id}}"
     }
     ```

   `correlation_id` opretholder et link tilbage til OneUptime-hændelsen — praktisk, hvis du senere tilføjer et løsningstrin. ServiceNow `urgency`/`impact` bruger `1` (høj), `2` (medium), `3` (lav).
4. **Gem**, aktivér, og opret en testhændelse. Et `201 Created`-svar i workflowets logfiler returnerer den nye posts `sys_id` og `number` (for eksempel `INC0012345`).

## Trin 3 — Løs ved OneUptime-løsning (valgfrit)

1. Opret et **andet** workflow med en **Incident → On Update**-trigger og en **Conditions**-blok, der tjekker, om hændelsen er løst.
2. For at opdatere den rette ServiceNow-post skal du bruge dens `sys_id`. Gem den enten på OneUptime-hændelsen i Trin 2 (læs `{{CreateRecord.response-body.result.sys_id}}` og skriv den til en label med **Update Incident**), eller slå posten op først med en `GET` på `/api/now/table/incident?sysparm_query=correlation_id=oneuptime-{{Incident._id}}`.
3. Tilføj en **API**-blok: **Method** `PATCH`, **URL** `https://din-instans.service-now.com/api/now/table/incident/<sys_id>`, body `{ "state": "6", "close_code": "Resolved by monitoring", "close_notes": "Resolved in OneUptime" }` (`state` `6` = Resolved i standard ITIL-workflow'et).

## Fejlfinding

- **`401`** — genkod `brugernavn:adgangskode` med `printf` (ikke `echo`, som tilføjer et linjeskift) og opdater `SERVICENOW_AUTH`.
- **`403`** — brugeren mangler rettigheder til at skrive i `incident`-tabellen; tilføj `itil`-rollen.
- **`400`** — et feltnavn eller en feltværdi er forkert for din instans' tilpasninger. Tjek feltnavne i **System Definition → Tables → incident**.
- **Instansen afviser kaldet** — nogle instanser begrænser Table API; bekræft, at REST er aktiveret, og at din IP ikke er blokeret af en ACL.

## Læs videre

- [Integrationsoversigt](/docs/integrations/index) — mønstre og autentificeringsoversigten.
- [Jira](/docs/integrations/jira) — det samme udgående mønster for Jira.
- [API-komponent](/docs/workflows/components#api) — aflæsning af responsebodyen.
