# ServiceNow-integratie

Open automatisch een [ServiceNow](https://www.servicenow.com)-incident wanneer een OneUptime-incident wordt aangemaakt — zodat ITSM en monitoring gelijke tred houden.

Deze integratie is **outbound**: OneUptime roept de ServiceNow [Table API](https://docs.servicenow.com/bundle/utah-application-development/page/integrate/inbound-rest/concept/c_TableAPI.html) aan. Ze maakt gebruik van een OneUptime **[Workflow](/docs/workflows/index)** met een **Incident → On Create**-trigger en een **API-component**.

```text
OneUptime Incident → On Create  ──►  API component (POST /api/now/table/incident)  ──►  ServiceNow incident
```

## Vereisten

- Een ServiceNow-instantie (`https://your-instance.service-now.com`).
- Een ServiceNow-gebruiker met de rollen `rest_api_explorer` / `itil` (of voldoende rechten om `incident`-records aan te maken). Basic auth met de inloggegevens van deze gebruiker is de eenvoudigste start; OAuth is aanbevolen voor productie.
- Een OneUptime-project waar je workflows kunt aanmaken.

## Stap 1 — Sla gegevens op als een geheim

ServiceNow's Table API accepteert **Basic auth**.

1. Codeer `gebruikersnaam:wachtwoord` één keer in base64:

   ```bash
   printf '%s' 'integration_user:password' | base64
   ```

2. Ga in OneUptime naar **Workflows → Global Variables → Create**, geef het de naam `SERVICENOW_AUTH`, plak de base64-string, en zet **Is Secret** aan.

## Stap 2 — Bouw de workflow

1. Open **Workflows → Create Workflow**, geef het de naam `Incidents → ServiceNow`, en open de **Builder**.
2. Voeg een **Incident**-trigger toe ingesteld op **On Create**. Hernoem het naar `Incident`.
3. Voeg een **API**-blok toe verbonden met de trigger:
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

   `correlation_id` houdt een koppeling bij naar het OneUptime-incident — handig als je later een oplossen-stap toevoegt. ServiceNow `urgency`/`impact` gebruiken `1` (hoog), `2` (gemiddeld), `3` (laag).
4. **Sla op**, schakel in en maak een testincident aan. Een respons `201 Created` in de workflow-logs geeft de `sys_id` en het `number` van het nieuwe record terug (bijvoorbeeld `INC0012345`).

## Stap 3 — Oplossen bij OneUptime-oplossing (optioneel)

1. Maak een **tweede** workflow aan met een trigger **Incident → On Update** en een **Conditions**-blok dat controleert of het incident is opgelost.
2. Om het juiste ServiceNow-record bij te werken heb je de `sys_id` nodig. Sla hem op bij het OneUptime-incident in Stap 2 (lees `{{CreateRecord.response-body.result.sys_id}}` en schrijf hem naar een label met **Update Incident**), of zoek het record eerst op met een `GET` op `/api/now/table/incident?sysparm_query=correlation_id=oneuptime-{{Incident._id}}`.
3. Voeg een **API**-blok toe: **Method** `PATCH`, **URL** `https://your-instance.service-now.com/api/now/table/incident/<sys_id>`, body `{ "state": "6", "close_code": "Resolved by monitoring", "close_notes": "Resolved in OneUptime" }` (`state` `6` = Resolved in de standaard ITIL-workflow).

## Probleemoplossing

- **`401`** — hercodeer `gebruikersnaam:wachtwoord` met `printf` (niet `echo`, dat een regelafbreking toevoegt) en update `SERVICENOW_AUTH`.
- **`403`** — de gebruiker heeft geen rechten om de `incident`-tabel te schrijven; voeg de rol `itil` toe.
- **`400`** — een veldnaam of -waarde klopt niet voor de aanpassingen van je instantie. Controleer veldnamen in **System Definition → Tables → incident**.
- **De instantie weigert de aanroep** — sommige instanties beperken de Table API; bevestig dat REST is ingeschakeld en dat je IP niet door een ACL is geblokkeerd.

## Waar verder lezen

- [Integraties – Overzicht](/docs/integrations/index) — patronen en het authenticatie-spiekbriefje.
- [Jira](/docs/integrations/jira) — hetzelfde outbound-patroon voor Jira.
- [API-component](/docs/workflows/components#api) — de responsebody lezen.
