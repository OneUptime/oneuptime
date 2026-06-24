# Jira-integrasjon

Åpne en [Jira](https://www.atlassian.com/software/jira)-sak automatisk hver gang en OneUptime-hendelse opprettes — slik at ingeniørarbeid spores der utviklerne dine allerede jobber, med en lenke tilbake til hendelsen.

Denne integrasjonen er **utgående**: OneUptime kaller Jiras REST API. Den bruker en OneUptime **[Arbeidsflyt](/docs/workflows/index)** med en **Incident → On Create**-trigger og en **API-komponent**. Du kan eventuelt legge til en **innkommende** sti slik at lukking av Jira-saken løser OneUptime-hendelsen.

```text
OneUptime Incident → On Create  ──►  API component (POST /rest/api/3/issue)  ──►  Jira issue
```

## Forutsetninger

- Et Jira Cloud-nettsted (`https://your-domain.atlassian.net`) og et prosjekt å registrere saker i — noter **prosjektnøkkelen** (f.eks. `OPS`).
- En Jira-konto som kan opprette saker, og et **API-token** for den fra [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
- Et OneUptime-prosjekt der du kan opprette arbeidsflyter.

> Bruker du **Jira Data Center / Server** (selvadministrert)? Flyten er identisk — bruk din egen basis-URL og et [Personal Access Token](https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html) med en `Bearer`-auth-header i stedet for Basic auth. `/rest/api/2/issue`-endepunktet godtar en klartekstbeskrivelse, noe som gjør maling enklere.

## Steg 1 — Lagre Jira-legitimasjonen som en hemmelighet

Jira Cloud bruker **Basic auth** med e-post og API-token, base64-kodet.

1. Base64-koder `e-post:api_token` én gang. På macOS/Linux:

   ```bash
   printf '%s' 'you@example.com:your_api_token' | base64
   ```

2. I OneUptime, gå til **Workflows → Global Variables → Create**.
3. Gi den navnet `JIRA_AUTH`, lim inn base64-strengen som verdi, og slå på **Is Secret**.

Nå kan du bruke `Basic {{variable.JIRA_AUTH}}` som en auth-header, og tokenet vises aldri i arbeidsflyten eller dens logger.

## Steg 2 — Bygg arbeidsflyten

1. Åpne **Workflows → Create Workflow**, gi den navnet `Incidents → Jira`, og åpne **Builder**.
2. Dra en **Incident**-trigger inn på lerretet og velg **On Create**-hendelsen. Gi den nytt navn `Incident`.
3. Dra en **API**-blokk og koble triggeren til den. Konfigurer:

   - **Method**: `POST`
   - **URL**: `https://your-domain.atlassian.net/rest/api/3/issue`
   - **Headers**:

     ```text
     Authorization: Basic {{variable.JIRA_AUTH}}
     Content-Type: application/json
     ```

   - **Body** (Jira Cloud v3 bruker Atlassian Document Format for beskrivelsen):

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

   Erstatt `OPS` med prosjektnøkkelen din og `Bug` med en sagstype som finnes i det prosjektet.

4. **Lagre.** La arbeidsflyten stå deaktivert til du har testet den.

## Steg 3 — Test det

1. Slå på **Enabled** for arbeidsflyten.
2. Opprett en testhendelse i OneUptime (eller utløs en fra en monitor).
3. Åpne arbeidsflytens **Logs**-fane. **API**-blokken bør vise en `201`-status og en respons-body som inneholder den nye sakens `key` (for eksempel `OPS-1234`).
4. Sjekk Jira — saken er der.

Hvis API-blokken returnerer en feil, utvid den i loggene — Jiras svar forklarer nøyaktig hvilket felt det avviste. Se [Feilsøking](#feilsøking).

## Steg 4 — Lenk hendelsen tilbake til saken (anbefalt)

Det er nyttig å lagre Jira-saksnøkkelen på hendelsen slik at folk kan hoppe mellom dem.

- API-blokkens svar er tilgjengelig som `{{CreateIssue.response-body.key}}` (hvis du navnga blokken `CreateIssue`).
- Legg til en **Update Incident**-blokk etter den og skriv nøkkelen inn i et kodeord, et egendefinert felt eller et notat på hendelsen.

Dette gjør også den valgfrie toveissynkroniseringen nedenfor mulig.

## Toveissynkronisering (valgfritt)

For å løse OneUptime-hendelsen når noen lukker Jira-saken, legg til en **innkommende** arbeidsflyt:

1. Opprett en ny arbeidsflyt som starter med en **Webhook**-trigger og kopier URL-en.
2. I Jira, gå til **Project settings → Automation → Create rule**:

   - **Trigger**: _Issue transitioned_ til **Done** (eller _Issue resolved_).
   - **Action**: _Send web request_ → metode `POST`, URL = arbeidsflyt-webhook-URL-en din, body inkluderer saksnøkkelen og OneUptime-hendelse-ID-en, f.eks.:

     ```json
     { "issueKey": "{{issue.key}}", "status": "resolved" }
     ```

3. I arbeidsflyten, bruk en **Find Incident**-blokk til å finne hendelsen via den lagrede nøkkelen, deretter en **Update Incident**-blokk for å flytte den til din løste tilstand.

Hvis du lagret Jira-nøkkelen på hendelsen i Steg 4, er matching enkelt. Se [Komponenter → OneUptime-datakomponenter](/docs/workflows/components#oneuptime-data-components).

## Tilpasse saken

Noen vanlige justeringer i API-blokkens body:

- **Prioritet** — legg til `"priority": { "name": "High" }` inne i `fields`. Du kan forgrene på `{{Incident.incidentSeverity.name}}` med **Conditions** for å mappe OneUptime-alvorlighetsgrader til Jira-prioriteter.
- **Koder** — legg til `"labels": ["oneuptime", "incident"]`.
- **Ansvarlig** — legg til `"assignee": { "id": "<accountId>" }` (Jira Cloud bruker konto-ID-er, ikke brukernavn).
- **Egendefinerte felt** — legg til `"customfield_XXXXX": "..."` ved å bruke feltets ID fra Jira-admin.

For å oppdage de eksakte feltnavnene et prosjekt forventer, kall Jiras `GET /rest/api/3/issue/createmeta`-endepunkt én gang fra nettleseren din eller `curl`.

## Feilsøking

**`401 Unauthorized`.**

- Rekod `e-post:api_token` og oppdater `JIRA_AUTH`-variabelen. En etterfølgende nylinje er den vanlige syndebukken — bruk `printf` (ikke `echo`) ved koding.
- Bekreft at kontoen som eier API-tokenet kan opprette saker i prosjektet.

**`400 Bad Request` som nevner et felt.**

- Sakstypen eller et obligatorisk felt er feil. Sjekk prosjektets **issue type**-navn og om det har obligatoriske egendefinerte felt. Bruk `createmeta` (ovenfor) for å se hva som er påkrevd.

**`404 Not Found`.**

- Dobbeltsjekk basis-URL-en og at du treffer `/rest/api/3/issue` (Cloud) eller `/rest/api/2/issue` (Server/Data Center).

**Beskrivelsen vises som én linje / ser merkelig ut.**

- v3 krever Atlassian Document Format vist ovenfor. Hvis du heller vil sende klartekst, bruk `/rest/api/2/issue`-endepunktet med `"description": "{{Incident.description}}"` som en vanlig streng.

## Hvor du leser videre

- [Oversikt over integrasjoner](/docs/integrations/index) — de innkommende/utgående mønstrene og autentiserings-juksearket.
- [API-komponent](/docs/workflows/components#api) — metoder, headere og å lese svaret.
- [Variabler](/docs/workflows/variables) — hemmeligheter og hendelsesfelt.
- [PagerDuty](/docs/integrations/pagerduty) og [ServiceNow](/docs/integrations/servicenow) — det samme utgående mønsteret for andre verktøy.
