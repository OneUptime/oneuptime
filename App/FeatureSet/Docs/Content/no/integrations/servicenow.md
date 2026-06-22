# ServiceNow-integrasjon

Åpne en [ServiceNow](https://www.servicenow.com)-hendelse automatisk hver gang en OneUptime-hendelse opprettes — slik at ITSM og overvåking holder tritt.

Denne integrasjonen er **utgående**: OneUptime kaller ServiceNows [Table API](https://docs.servicenow.com/bundle/utah-application-development/page/integrate/inbound-rest/concept/c_TableAPI.html). Den bruker en OneUptime **[Arbeidsflyt](/docs/workflows/index)** med en **Incident → On Create**-trigger og en **API-komponent**.

```text
OneUptime Incident → On Create  ──►  API component (POST /api/now/table/incident)  ──►  ServiceNow incident
```

## Forutsetninger

- En ServiceNow-instans (`https://your-instance.service-now.com`).
- En ServiceNow-bruker med `rest_api_explorer` / `itil`-rollene (eller nok rettigheter til å opprette `incident`-poster). Basic auth med denne brukerens legitimasjon er den enkleste starten; OAuth anbefales for produksjon.
- Et OneUptime-prosjekt der du kan opprette arbeidsflyter.

## Steg 1 — Lagre legitimasjon som en hemmelighet

ServiceNows Table API godtar **Basic auth**.

1. Base64-koder `brukernavn:passord` én gang:

   ```bash
   printf '%s' 'integration_user:password' | base64
   ```

2. I OneUptime, gå til **Workflows → Global Variables → Create**, gi den navnet `SERVICENOW_AUTH`, lim inn base64-strengen, og slå på **Is Secret**.

## Steg 2 — Bygg arbeidsflyten

1. Åpne **Workflows → Create Workflow**, gi den navnet `Incidents → ServiceNow`, og åpne **Builder**.
2. Legg til en **Incident**-trigger satt til **On Create**. Gi den nytt navn `Incident`.
3. Legg til en **API**-blokk koblet til triggeren:

   - **Method**: `POST`
   - **URL**: `https://your-instance.service-now.com/api/now/table/incident`
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

   `correlation_id` holder en lenke tilbake til OneUptime-hendelsen — hendig hvis du senere legger til et løsningssteg. ServiceNow `urgency`/`impact` bruker `1` (høy), `2` (middels), `3` (lav).

4. **Lagre**, aktiver, og opprett en testhendelse. Et `201 Created`-svar i arbeidsflytloggene returnerer den nye postens `sys_id` og `number` (for eksempel `INC0012345`).

## Steg 3 — Løs ved OneUptime-løsning (valgfritt)

1. Opprett en **andre** arbeidsflyt med en **Incident → On Update**-trigger og en **Conditions**-blokk som sjekker at hendelsen er løst.
2. For å oppdatere riktig ServiceNow-post trenger du dens `sys_id`. Enten lagre den på OneUptime-hendelsen i Steg 2 (les `{{CreateRecord.response-body.result.sys_id}}` og skriv den til en kode med **Update Incident**), eller slå opp posten først med en `GET` på `/api/now/table/incident?sysparm_query=correlation_id=oneuptime-{{Incident._id}}`.
3. Legg til en **API**-blokk: **Method** `PATCH`, **URL** `https://your-instance.service-now.com/api/now/table/incident/<sys_id>`, body `{ "state": "6", "close_code": "Resolved by monitoring", "close_notes": "Resolved in OneUptime" }` (`state` `6` = Løst i standard ITIL-arbeidsflyten).

## Feilsøking

- **`401`** — rekod `brukernavn:passord` med `printf` (ikke `echo`, som legger til en nylinje) og oppdater `SERVICENOW_AUTH`.
- **`403`** — brukeren mangler rettigheter til å skrive til `incident`-tabellen; legg til `itil`-rollen.
- **`400`** — et feltnavn eller en verdi er feil for instansens tilpasninger. Sjekk feltnavn i **System Definition → Tables → incident**.
- **Instansen avviser kallet** — noen instanser begrenser Table API; bekreft at REST er aktivert og at IP-en din ikke er blokkert av en ACL.

## Hvor du leser videre

- [Oversikt over integrasjoner](/docs/integrations/index) — mønstre og autentiserings-juksearket.
- [Jira](/docs/integrations/jira) — det samme utgående mønsteret for Jira.
- [API-komponent](/docs/workflows/components#api) — å lese svar-body.
