# Jira-integration

Öppna ett [Jira](https://www.atlassian.com/software/jira)-ärende automatiskt när en OneUptime-incident skapas — så att ingenjörsarbetet spåras där dina utvecklare redan befinner sig, med en länk tillbaka till incidenten.

Den här integrationen är **utgående**: OneUptime anropar Jiras REST API. Den använder ett OneUptime **[Arbetsflöde](/docs/workflows/index)** med en **Incident → On Create**-utlösare och en **API-komponent**. Du kan valfritt lägga till en **inkommande** väg så att stänga Jira-ärendet löser OneUptime-incidenten.

```text
OneUptime Incident → On Create  ──►  API component (POST /rest/api/3/issue)  ──►  Jira issue
```

## Förutsättningar

- En Jira Cloud-sajt (`https://your-domain.atlassian.net`) och ett projekt att lägga ärenden i — notera dess **projektnyckel** (t.ex. `OPS`).
- Ett Jira-konto som kan skapa ärenden, och en **API-token** för det från [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
- Ett OneUptime-projekt där du kan skapa arbetsflöden.

> Använder du **Jira Data Center / Server** (egenhostat)? Flödet är identiskt — använd din egen bas-URL och en [Personal Access Token](https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html) med en `Bearer`-auth-header i stället för Basic auth. Slutpunkten `/rest/api/2/issue` accepterar en vanlig textbeskrivning, vilket gör mallar enklare.

## Steg 1 — Spara dina Jira-uppgifter som en hemlighet

Jira Cloud använder **Basic auth** med din e-post och API-token, base64-kodad.

1. Base64-koda `email:api_token` en gång. På macOS/Linux:

   ```bash
   printf '%s' 'you@example.com:your_api_token' | base64
   ```

2. Gå i OneUptime till **Workflows → Global Variables → Create**.
3. Namnge det `JIRA_AUTH`, klistra in base64-strängen som värde och slå på **Is Secret**.

Nu kan du använda `Basic {{variable.JIRA_AUTH}}` som en auth-header och token visas aldrig i arbetsflödet eller dess loggar.

## Steg 2 — Bygg arbetsflödet

1. Öppna **Workflows → Create Workflow**, namnge det `Incidents → Jira` och öppna **Builder**.
2. Dra en **Incident**-utlösare till arbetsytan och välj händelsen **On Create**. Byt namn till `Incident`.
3. Dra ett **API**-block och koppla utlösaren till det. Konfigurera:
   - **Method**: `POST`
   - **URL**: `https://your-domain.atlassian.net/rest/api/3/issue`
   - **Headers**:

     ```text
     Authorization: Basic {{variable.JIRA_AUTH}}
     Content-Type: application/json
     ```

   - **Body** (Jira Cloud v3 använder Atlassian Document Format för beskrivningen):

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

   Ersätt `OPS` med din projektnyckel och `Bug` med en ärendetyp som finns i det projektet.
4. **Spara.** Lämna arbetsflödet inaktiverat tills du har testat det.

## Steg 3 — Testa det

1. Slå på arbetsflödet **Enabled**.
2. Skapa en testincident i OneUptime (eller utlös en från en monitor).
3. Öppna arbetsflödets flik **Logs**. **API**-blocket bör visa en `201`-status och en svars-body som innehåller det nya ärendets `key` (till exempel `OPS-1234`).
4. Kontrollera Jira — ärendet finns där.

Om API-blocket returnerar ett fel, expandera det i loggarna — Jiras svar förklarar exakt vilket fält det avvisade. Se [Felsökning](#felsökning).

## Steg 4 — Länka incidenten tillbaka till ärendet (rekommenderas)

Det är användbart att spara Jira-ärendenyckeln på incidenten så att folk kan hoppa mellan dem.

- API-blockets svar finns tillgängligt som `{{CreateIssue.response-body.key}}` (om du namngav blocket `CreateIssue`).
- Lägg till ett **Update Incident**-block efter det och skriv nyckeln till en etikett, ett anpassat fält eller en notering på incidenten.

Detta möjliggör också den valfria tvåvägssynkroniseringen nedan.

## Tvåvägssynkronisering (valfritt)

För att lösa OneUptime-incidenten när någon stänger Jira-ärendet, lägg till ett **inkommande** arbetsflöde:

1. Skapa ett andra arbetsflöde som börjar med en **Webhook**-utlösare och kopiera dess URL.
2. Gå i Jira till **Project settings → Automation → Create rule**:
   - **Trigger**: *Issue transitioned* till **Done** (eller *Issue resolved*).
   - **Action**: *Send web request* → method `POST`, URL = din arbetsflödes webhook-URL, body innehåller ärendenyckeln och OneUptime-incidentens id, t.ex.:

     ```json
     { "issueKey": "{{issue.key}}", "status": "resolved" }
     ```

3. I arbetsflödet, använd ett **Find Incident**-block för att hitta incidenten via den sparade nyckeln, sedan ett **Update Incident**-block för att flytta den till ditt lösta tillstånd.

Om du sparade Jira-nyckeln på incidenten i Steg 4 är matchningen enkel. Se [Komponenter → OneUptime-datakomponenter](/docs/workflows/components#oneuptime-data-components).

## Anpassa ärendet

Några vanliga justeringar av API-blockets body:

- **Prioritet** — lägg till `"priority": { "name": "High" }` inuti `fields`. Du kan förgrena på `{{Incident.incidentSeverity.name}}` med **Conditions** för att mappa OneUptime-allvarlighetsgrader till Jira-prioriteter.
- **Etiketter** — lägg till `"labels": ["oneuptime", "incident"]`.
- **Tilldelad** — lägg till `"assignee": { "id": "<accountId>" }` (Jira Cloud använder konto-ID:n, inte användarnamn).
- **Anpassade fält** — lägg till `"customfield_XXXXX": "..."` med fältets ID från din Jira-administration.

För att ta reda på exakt vilka fältnamn ett projekt förväntar sig, anropa Jiras `GET /rest/api/3/issue/createmeta`-slutpunkt en gång från din webbläsare eller `curl`.

## Felsökning

**`401 Unauthorized`.**
- Koda om `email:api_token` och uppdatera `JIRA_AUTH`-variabeln. En avslutande radbrytning är den vanliga boven — använd `printf` (inte `echo`) vid kodning.
- Bekräfta att kontot som äger API-token kan skapa ärenden i projektet.

**`400 Bad Request` som nämner ett fält.**
- Ärendetypen eller ett obligatoriskt fält är fel. Kontrollera projektets **ärendetypnamn** och om det har obligatoriska anpassade fält. Använd `createmeta` (ovan) för att se vad som är obligatoriskt.

**`404 Not Found`.**
- Dubbelkolla bas-URL:en och att du träffar `/rest/api/3/issue` (Cloud) eller `/rest/api/2/issue` (Server/Data Center).

**Beskrivningen visas som en enda rad / ser konstig ut.**
- v3 kräver Atlassian Document Format som visas ovan. Om du hellre vill skicka vanlig text, använd slutpunkten `/rest/api/2/issue` med `"description": "{{Incident.description}}"` som en vanlig sträng.

## Läs vidare

- [Integrationsöversikt](/docs/integrations/index) — de inkommande/utgående mönstren och autentiseringsfuskbladet.
- [API-komponent](/docs/workflows/components#api) — metoder, headers och att läsa svaret.
- [Variabler](/docs/workflows/variables) — hemligheter och incidentfält.
- [PagerDuty](/docs/integrations/pagerduty) och [ServiceNow](/docs/integrations/servicenow) — samma utgående mönster för andra verktyg.
