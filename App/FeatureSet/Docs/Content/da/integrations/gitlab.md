# GitLab-integration

Åbn automatisk en [GitLab](https://gitlab.com)-sag, når en OneUptime-hændelse oprettes — så ingeniørernes opfølgning lander i det projekt, der ejer den berørte tjeneste.

Denne integration er **udgående**: OneUptime kalder [GitLab REST API](https://docs.gitlab.com/ee/api/issues.html). Den bruger et OneUptime **[Workflow](/docs/workflows/index)** med en **Incident → On Create**-trigger og en **API-komponent**. Den fungerer på samme måde på GitLab.com og selvadministreret GitLab.

```text
OneUptime Incident → On Create  ──►  API component (POST /projects/{id}/issues)  ──►  GitLab issue
```

## Forudsætninger

- Et GitLab-projekt og dets **Projekt-ID** (vises på projektets oversigtside, under projektnavnet).
- Et adgangstoken, der kan oprette sager — et **Projekt**-, **Gruppe**- eller **Personligt adgangstoken** med `api`-scopet: **Settings → Access Tokens**.
- Et OneUptime-projekt, hvor du kan oprette workflows.

## Trin 1 — Gem tokenet

1. Gå til **Workflows → Global Variables → Create**.
2. Navngiv det `GITLAB_TOKEN`, indsæt tokenet, og slå **Is Secret** til.

## Trin 2 — Byg workflowet

1. Åbn **Workflows → Create Workflow**, navngiv det `Incidents → GitLab Issues`, og åbn **Builder**.
2. Tilføj en **Incident**-trigger sat til **On Create**. Omdøb den til `Incident`.
3. Tilføj en **API**-blok forbundet til triggeren:

   - **Method**: `POST`
   - **URL**: `https://gitlab.com/api/v4/projects/12345678/issues` _(erstat `12345678` med dit Projekt-ID; brug din egen vært for selvadministreret)_
   - **Headers**:

     ```text
     PRIVATE-TOKEN: {{variable.GITLAB_TOKEN}}
     Content-Type: application/json
     ```

   - **Body**:

     ```json
     {
       "title": "OneUptime incident: {{Incident.title}}",
       "description": "{{Incident.description}}\n\nFiled automatically from OneUptime.",
       "labels": "incident,oneuptime"
     }
     ```

4. **Gem**, aktivér, og opret en testhændelse. Et `201 Created` i workflowets logfiler betyder, at sagen blev oprettet; responsebodyen indeholder dens `iid` og `web_url`.

## Tips

- **Selvadministreret GitLab**: erstat `https://gitlab.com` med din instans-URL; stien `/api/v4/...` forbliver den samme.
- **Projektsti i stedet for ID**: du kan URL-enkode stien — f.eks. `group%2Fproject` — i stedet for det numeriske ID.
- **Ansvarlig / forfaldsdato**: tilføj `"assignee_ids": [42]` eller `"due_date": "2026-01-31"` til bodyen.
- **Link tilbage**: læs `{{CreateIssue.response-body.web_url}}` og gem det på hændelsen med en **Update Incident**-blok.

## Fejlfinding

- **`401`** — tokenet er ugyldigt eller udløbet, eller mangler `api`-scopet.
- **`404`** — Projekt-ID'et er forkert, eller tokenet kan ikke tilgå et privat projekt.
- **`400`** — et påkrævet felt mangler eller er misdannet; `title` er påkrævet.

## Læs videre

- [Integrationsoversigt](/docs/integrations/index) — mønstre og autentificeringsoversigten.
- [GitHub](/docs/integrations/github) — den samme idé for GitHub.
- [API-komponent](/docs/workflows/components#api) — aflæsning af responsebodyen.
