# Jira-integratie

Open automatisch een [Jira](https://www.atlassian.com/software/jira)-issue wanneer een OneUptime-incident wordt aangemaakt — zodat engineeringwerk wordt bijgehouden waar je ontwikkelaars al werken, met een link terug naar het incident.

Deze integratie is **outbound**: OneUptime roept de REST API van Jira aan. Ze maakt gebruik van een OneUptime **[Workflow](/docs/workflows/index)** met een **Incident → On Create**-trigger en een **API-component**. Je kunt optioneel een **inbound**-pad toevoegen zodat het sluiten van de Jira-issue het OneUptime-incident oplost.

```text
OneUptime Incident → On Create  ──►  API component (POST /rest/api/3/issue)  ──►  Jira issue
```

## Vereisten

- Een Jira Cloud-site (`https://your-domain.atlassian.net`) en een project om issues in te registreren — noteer de **projectsleutel** (bijv. `OPS`).
- Een Jira-account dat issues kan aanmaken, en een **API-token** ervoor van [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
- Een OneUptime-project waar je workflows kunt aanmaken.

> Gebruik je **Jira Data Center / Server** (zelf beheerd)? De aanpak is identiek — gebruik je eigen basis-URL en een [Personal Access Token](https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html) met een `Bearer`-auth-header in plaats van Basic auth. Het eindpunt `/rest/api/2/issue` accepteert een beschrijving in platte tekst, waardoor templating eenvoudiger is.

## Stap 1 — Sla je Jira-gegevens op als een geheim

Jira Cloud gebruikt **Basic auth** met je e-mail en API-token, base64-gecodeerd.

1. Codeer `email:api_token` één keer in base64. Op macOS/Linux:

   ```bash
   printf '%s' 'you@example.com:your_api_token' | base64
   ```

2. Ga in OneUptime naar **Workflows → Global Variables → Create**.
3. Geef het de naam `JIRA_AUTH`, plak de base64-string als waarde, en zet **Is Secret** aan.

Nu kun je `Basic {{variable.JIRA_AUTH}}` gebruiken als auth-header en het token verschijnt nooit in de workflow of de logs.

## Stap 2 — Bouw de workflow

1. Open **Workflows → Create Workflow**, geef het de naam `Incidents → Jira`, en open de **Builder**.
2. Sleep een **Incident**-trigger op het canvas en kies het event **On Create**. Hernoem het naar `Incident`.
3. Sleep een **API**-blok en verbind de trigger ermee. Configureer:

   - **Method**: `POST`
   - **URL**: `https://your-domain.atlassian.net/rest/api/3/issue`
   - **Headers**:

     ```text
     Authorization: Basic {{variable.JIRA_AUTH}}
     Content-Type: application/json
     ```

   - **Body** (Jira Cloud v3 gebruikt het Atlassian Document Format voor de beschrijving):

     ```json
     {
       "fields": {
         "project": { "key": "OPS" },
         "issuetype": { "name": "Bug" },
         "summary": "OneUptime incident: {{Incident.title}}",
         "description": {
           "type": "doc",
           "version": 1,
           "content": [
             {
               "type": "paragraph",
               "content": [
                 { "type": "text", "text": "{{Incident.description}}" }
               ]
             }
           ]
         }
       }
     }
     ```

   Vervang `OPS` door je projectsleutel en `Bug` door een issuetype dat in dat project bestaat.

4. **Sla op.** Laat de workflow uitgeschakeld totdat je hem hebt getest.

## Stap 3 — Test het

1. Zet de workflow **Enabled** aan.
2. Maak een testincident aan in OneUptime (of trigger er één vanuit een monitor).
3. Open het tabblad **Logs** van de workflow. Het **API**-blok moet een status `201` tonen en een responsebody met de `key` van de nieuwe issue (bijvoorbeeld `OPS-1234`).
4. Controleer Jira — de issue is aangemaakt.

Als het API-blok een fout teruggeeft, vouw het dan uit in de logs — de respons van Jira legt precies uit welk veld werd afgewezen. Zie [Probleemoplossing](#probleemoplossing).

## Stap 4 — Koppel het incident terug aan de issue (aanbevolen)

Het is handig om de Jira-issuekey op het incident op te slaan zodat mensen ertussen kunnen springen.

- De respons van het API-blok is beschikbaar als `{{CreateIssue.response-body.key}}` (als je het blok `CreateIssue` hebt genoemd).
- Voeg een **Update Incident**-blok toe en schrijf de key naar een label, een aangepast veld of een notitie op het incident.

Dit maakt ook de optionele bidirectionele synchronisatie hieronder mogelijk.

## Bidirectionele synchronisatie (optioneel)

Om het OneUptime-incident op te lossen wanneer iemand de Jira-issue sluit, voeg je een **inbound**-workflow toe:

1. Maak een tweede workflow aan die start met een **Webhook**-trigger en kopieer de URL ervan.
2. Ga in Jira naar **Project settings → Automation → Create rule**:

   - **Trigger**: _Issue transitioned_ naar **Done** (of _Issue resolved_).
   - **Action**: _Send web request_ → methode `POST`, URL = je workflow-webhook-URL, body bevat de issuekey en het OneUptime-incident-id, bijv.:

     ```json
     { "issueKey": "{{issue.key}}", "status": "resolved" }
     ```

3. Gebruik in de workflow een **Find Incident**-blok om het incident op de opgeslagen key te vinden, gevolgd door een **Update Incident**-blok om het naar je opgeloste status te verplaatsen.

Als je de Jira-key op het incident hebt opgeslagen in Stap 4, is de koppeling eenvoudig. Zie [Componenten → OneUptime-datacomponenten](/docs/workflows/components#oneuptime-data-components).

## De issue aanpassen

Een paar veelgebruikte aanpassingen aan de body van het API-blok:

- **Priority** — voeg `"priority": { "name": "High" }` toe binnen `fields`. Je kunt op `{{Incident.incidentSeverity.name}}` vertakken met **Conditions** om OneUptime-severities naar Jira-prioriteiten te mappen.
- **Labels** — voeg `"labels": ["oneuptime", "incident"]` toe.
- **Assignee** — voeg `"assignee": { "id": "<accountId>" }` toe (Jira Cloud gebruikt account-ID's, geen gebruikersnamen).
- **Aangepaste velden** — voeg `"customfield_XXXXX": "..."` toe met het ID van het veld uit je Jira-beheer.

Om de exacte veldnamen te ontdekken die een project verwacht, roep je Jira's eindpunt `GET /rest/api/3/issue/createmeta` één keer aan vanuit je browser of `curl`.

## Probleemoplossing

**`401 Unauthorized`.**

- Hercodeer `email:api_token` en update de variabele `JIRA_AUTH`. Een afsluitende regelafbreking is de gebruikelijke boosdoener — gebruik `printf` (niet `echo`) bij het coderen.
- Bevestig dat het account waarvan de API-token afkomstig is issues kan aanmaken in het project.

**`400 Bad Request` met vermelding van een veld.**

- Het issuetype of een verplicht veld klopt niet. Controleer de naam van het **issuetype** van het project en of het verplichte aangepaste velden heeft. Gebruik `createmeta` (hierboven) om te zien wat verplicht is.

**`404 Not Found`.**

- Controleer nogmaals de basis-URL en of je `/rest/api/3/issue` (Cloud) of `/rest/api/2/issue` (Server/Data Center) aanroept.

**De beschrijving wordt als één regel weergegeven / ziet er vreemd uit.**

- v3 vereist het Atlassian Document Format zoals hierboven getoond. Als je liever platte tekst verstuurt, gebruik dan het eindpunt `/rest/api/2/issue` met `"description": "{{Incident.description}}"` als gewone string.

## Waar verder lezen

- [Integraties – Overzicht](/docs/integrations/index) — de inbound/outbound-patronen en het authenticatie-spiekbriefje.
- [API-component](/docs/workflows/components#api) — methoden, headers en de respons lezen.
- [Variabelen](/docs/workflows/variables) — geheimen en incidentvelden.
- [PagerDuty](/docs/integrations/pagerduty) en [ServiceNow](/docs/integrations/servicenow) — hetzelfde outbound-patroon voor andere tools.
