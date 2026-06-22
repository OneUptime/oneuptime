# Jira-integration

Åbn automatisk en [Jira](https://www.atlassian.com/software/jira)-sag, når en OneUptime-hændelse oprettes — så ingeniørarbejdet spores, der hvor dine udviklere allerede er, med et link tilbage til hændelsen.

Denne integration er **udgående**: OneUptime kalder Jiras REST API. Den bruger et OneUptime **[Workflow](/docs/workflows/index)** med en **Incident → On Create**-trigger og en **API-komponent**. Du kan valgfrit tilføje en **indgående** sti, så lukning af Jira-sagen løser OneUptime-hændelsen.

```text
OneUptime Incident → On Create  ──►  API component (POST /rest/api/3/issue)  ──►  Jira issue
```

## Forudsætninger

- Et Jira Cloud-websted (`https://dit-domæne.atlassian.net`) og et projekt at oprette sager i — notér dets **projektnøgle** (f.eks. `OPS`).
- En Jira-konto, der kan oprette sager, og et **API-token** til den fra [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
- Et OneUptime-projekt, hvor du kan oprette workflows.

> Bruger du **Jira Data Center / Server** (selvadministreret)? Flowet er identisk — brug din egen basis-URL og et [Personal Access Token](https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html) med en `Bearer`-auth-header i stedet for Basic auth. Slutpunktet `/rest/api/2/issue` accepterer en almindelig tekstbeskrivelse, hvilket gør skabeloner enklere.

## Trin 1 — Gem dine Jira-legitimationsoplysninger som en hemmelighed

Jira Cloud bruger **Basic auth** med din email og API-token, base64-enkodede.

1. Base64-enkod `email:api_token` én gang. På macOS/Linux:

   ```bash
   printf '%s' 'you@example.com:your_api_token' | base64
   ```

2. I OneUptime, gå til **Workflows → Global Variables → Create**.
3. Navngiv den `JIRA_AUTH`, indsæt base64-strengen som værdien, og slå **Is Secret** til.

Nu kan du bruge `Basic {{variable.JIRA_AUTH}}` som en auth-header, og tokenet vises aldrig i workflowet eller dets logfiler.

## Trin 2 — Byg workflowet

1. Åbn **Workflows → Create Workflow**, navngiv det `Incidents → Jira`, og åbn **Builder**.
2. Træk en **Incident**-trigger ud på lærredet og vælg **On Create**-eventet. Omdøb det til `Incident`.
3. Træk en **API**-blok ud og forbind triggeren til den. Konfigurér:

   - **Method**: `POST`
   - **URL**: `https://dit-domæne.atlassian.net/rest/api/3/issue`
   - **Headers**:

     ```text
     Authorization: Basic {{variable.JIRA_AUTH}}
     Content-Type: application/json
     ```

   - **Body** (Jira Cloud v3 bruger Atlassian Document Format til beskrivelsen):

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

   Erstat `OPS` med din projektnøgle og `Bug` med en sagstype, der findes i det projekt.

4. **Gem.** Lad workflowet være deaktiveret, indtil du har testet det.

## Trin 3 — Test det

1. Slå workflowet **Enabled** til.
2. Opret en testhændelse i OneUptime (eller udløs en fra en monitor).
3. Åbn workflowets **Logs**-fane. **API**-blokken bør vise en `201`-status og en responsebody, der indeholder den nye sags `key` (for eksempel `OPS-1234`).
4. Tjek Jira — sagen er der.

Hvis API-blokken returnerer en fejl, udvid den i logfilerne — Jiras svar forklarer præcist, hvilket felt den afviste. Se [Fejlfinding](#fejlfinding).

## Trin 4 — Link hændelsen tilbage til sagen (anbefalet)

Det er nyttigt at gemme Jira-sagsnøglen på hændelsen, så folk kan hoppe mellem dem.

- API-blokkens svar er tilgængeligt som `{{CreateIssue.response-body.key}}` (hvis du navngav blokken `CreateIssue`).
- Tilføj en **Update Incident**-blok efter den og skriv nøglen ind i en label, et brugerdefineret felt eller en note på hændelsen.

Dette muliggør også den valgfrie tovejssynkronisering nedenfor.

## Tovejssynkronisering (valgfrit)

For at løse OneUptime-hændelsen, når nogen lukker Jira-sagen, tilføj et **indgående** workflow:

1. Opret et andet workflow, der starter med en **Webhook**-trigger, og kopiér dens URL.
2. I Jira, gå til **Project settings → Automation → Create rule**:

   - **Trigger**: _Issue transitioned_ til **Done** (eller _Issue resolved_).
   - **Action**: _Send web request_ → metode `POST`, URL = din workflow webhook-URL, body inkluderer sagsnøglen og OneUptime-hændelsens id, f.eks.:

     ```json
     { "issueKey": "{{issue.key}}", "status": "resolved" }
     ```

3. I workflowet bruger du en **Find Incident**-blok til at finde hændelsen med den gemte nøgle og derefter en **Update Incident**-blok til at flytte den til din løste tilstand.

Hvis du gemte Jira-nøglen på hændelsen i Trin 4, er matching ligetil. Se [Komponenter → OneUptime data-komponenter](/docs/workflows/components#oneuptime-data-components).

## Tilpasning af sagen

Nogle almindelige justeringer af API-blokkens body:

- **Prioritet** — tilføj `"priority": { "name": "High" }` inde i `fields`. Du kan forgrene på `{{Incident.incidentSeverity.name}}` med **Conditions** for at afbilde OneUptime-alvorligheder til Jira-prioriteter.
- **Labels** — tilføj `"labels": ["oneuptime", "incident"]`.
- **Ansvarlig** — tilføj `"assignee": { "id": "<accountId>" }` (Jira Cloud bruger konto-ID'er, ikke brugernavne).
- **Brugerdefinerede felter** — tilføj `"customfield_XXXXX": "..."` med feltets ID fra din Jira-administration.

For at opdage de præcise feltnavne, et projekt forventer, kald Jiras `GET /rest/api/3/issue/createmeta`-slutpunkt én gang fra din browser eller `curl`.

## Fejlfinding

**`401 Unauthorized`.**

- Genkod `email:api_token` og opdater `JIRA_AUTH`-variablen. Et efterfølgende linjeskift er den sædvanlige synder — brug `printf` (ikke `echo`) ved enkodning.
- Bekræft, at den konto, der ejer API-tokenet, kan oprette sager i projektet.

**`400 Bad Request` med mention af et felt.**

- Sagstypen eller et påkrævet felt er forkert. Tjek projektets **sagstype**-navn og om det har påkrævede brugerdefinerede felter. Brug `createmeta` (ovenfor) for at se, hvad der er obligatorisk.

**`404 Not Found`.**

- Dobbelttjek basis-URL'en og at du rammer `/rest/api/3/issue` (Cloud) eller `/rest/api/2/issue` (Server/Data Center).

**Beskrivelsen vises som én linje / ser mærkelig ud.**

- v3 kræver Atlassian Document Format som vist ovenfor. Hvis du hellere vil sende almindelig tekst, brug slutpunktet `/rest/api/2/issue` med `"description": "{{Incident.description}}"` som en almindelig streng.

## Læs videre

- [Integrationsoversigt](/docs/integrations/index) — de indgående/udgående mønstre og autentificeringsoversigten.
- [API-komponent](/docs/workflows/components#api) — metoder, headers og aflæsning af svaret.
- [Variabler](/docs/workflows/variables) — hemmeligheder og hændelsesfelter.
- [PagerDuty](/docs/integrations/pagerduty) og [ServiceNow](/docs/integrations/servicenow) — det samme udgående mønster for andre værktøjer.
