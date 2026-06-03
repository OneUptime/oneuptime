# ServiceNow-integration

Öppna en [ServiceNow](https://www.servicenow.com)-incident automatiskt när en OneUptime-incident skapas — så att ITSM och övervakning hålls i takt.

Den här integrationen är **utgående**: OneUptime anropar ServiceNows [Table API](https://docs.servicenow.com/bundle/utah-application-development/page/integrate/inbound-rest/concept/c_TableAPI.html). Den använder ett OneUptime **[Arbetsflöde](/docs/workflows/index)** med en **Incident → On Create**-utlösare och en **API-komponent**.

```text
OneUptime Incident → On Create  ──►  API component (POST /api/now/table/incident)  ──►  ServiceNow incident
```

## Förutsättningar

- En ServiceNow-instans (`https://your-instance.service-now.com`).
- En ServiceNow-användare med rollerna `rest_api_explorer` / `itil` (eller tillräckliga rättigheter för att skapa `incident`-poster). Basic auth med den här användarens inloggningsuppgifter är det enklaste att börja med; OAuth rekommenderas för produktion.
- Ett OneUptime-projekt där du kan skapa arbetsflöden.

## Steg 1 — Spara inloggningsuppgifter som en hemlighet

ServiceNows Table API accepterar **Basic auth**.

1. Base64-koda `username:password` en gång:

   ```bash
   printf '%s' 'integration_user:password' | base64
   ```

2. Gå i OneUptime till **Workflows → Global Variables → Create**, namnge det `SERVICENOW_AUTH`, klistra in base64-strängen och slå på **Is Secret**.

## Steg 2 — Bygg arbetsflödet

1. Öppna **Workflows → Create Workflow**, namnge det `Incidents → ServiceNow` och öppna **Builder**.
2. Lägg till en **Incident**-utlösare inställd på **On Create**. Byt namn till `Incident`.
3. Lägg till ett **API**-block kopplat till utlösaren:
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

   `correlation_id` håller en länk tillbaka till OneUptime-incidenten — praktiskt om du senare lägger till ett lösningssteg. ServiceNow `urgency`/`impact` använder `1` (hög), `2` (medel), `3` (låg).
4. **Spara**, aktivera och skapa en testincident. Ett `201 Created`-svar i arbetsflödets loggar returnerar den nya postens `sys_id` och `number` (till exempel `INC0012345`).

## Steg 3 — Lös vid OneUptime-lösning (valfritt)

1. Skapa ett **andra** arbetsflöde med en **Incident → On Update**-utlösare och ett **Conditions**-block som kontrollerar att incidenten är löst.
2. För att uppdatera rätt ServiceNow-post behöver du dess `sys_id`. Antingen sparar du den på OneUptime-incidenten i Steg 2 (läs `{{CreateRecord.response-body.result.sys_id}}` och skriv den till en etikett med **Update Incident**), eller slår du upp posten först med en `GET` på `/api/now/table/incident?sysparm_query=correlation_id=oneuptime-{{Incident._id}}`.
3. Lägg till ett **API**-block: **Method** `PATCH`, **URL** `https://your-instance.service-now.com/api/now/table/incident/<sys_id>`, body `{ "state": "6", "close_code": "Resolved by monitoring", "close_notes": "Resolved in OneUptime" }` (`state` `6` = Löst i det standardmässiga ITIL-arbetsflödet).

## Felsökning

- **`401`** — koda om `username:password` med `printf` (inte `echo`, som lägger till en radbrytning) och uppdatera `SERVICENOW_AUTH`.
- **`403`** — användaren saknar rättigheter att skriva till `incident`-tabellen; lägg till rollen `itil`.
- **`400`** — ett fältnamn eller -värde är fel för din instans anpassningar. Kontrollera fältnamn i **System Definition → Tables → incident**.
- **Instansen avvisar anropet** — vissa instanser begränsar Table API; bekräfta att REST är aktiverat och att din IP inte är blockerad av en ACL.

## Läs vidare

- [Integrationsöversikt](/docs/integrations/index) — mönster och autentiseringsfuskbladet.
- [Jira](/docs/integrations/jira) — samma utgående mönster för Jira.
- [API-komponent](/docs/workflows/components#api) — läsa svars-bodyn.
