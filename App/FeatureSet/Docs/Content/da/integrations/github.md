# GitHub-integration

Åbn automatisk en [GitHub](https://github.com)-sag, når en OneUptime-hændelse oprettes — så ingeniørernes opfølgning spores i det repo, der ejer den berørte tjeneste.

Denne integration er **udgående**: OneUptime kalder [GitHub REST API](https://docs.github.com/en/rest/issues/issues). Den bruger et OneUptime **[Workflow](/docs/workflows/index)** med en **Incident → On Create**-trigger og en **API-komponent**.

> **Leder du efter den dybere GitHub-forbindelse?** OneUptime har også en native **GitHub App**-integration til at forbinde kode-repositories (brugt af AI-agenten og kodefunktioner). Den konfigureres med miljøvariabler, ikke workflows — se [GitHub-integration (selvhostet)](/docs/self-hosted/github-integration). Denne side handler specifikt om _oprettelse af sager fra hændelser_.

```text
OneUptime Incident → On Create  ──►  API component (POST /repos/{owner}/{repo}/issues)  ──►  GitHub issue
```

## Forudsætninger

- Et GitHub-repository, hvor du ønsker sager oprettet.
- Et token, der kan oprette sager:

  - **Finkornede PAT** scoped til det repo med **Issues: Read and write**, eller
  - et **klassisk PAT** med `repo`-scopet.

  Opret et på [github.com/settings/tokens](https://github.com/settings/tokens).

- Et OneUptime-projekt, hvor du kan oprette workflows.

## Trin 1 — Gem tokenet

1. Gå til **Workflows → Global Variables → Create**.
2. Navngiv det `GITHUB_TOKEN`, indsæt tokenet, og slå **Is Secret** til.

## Trin 2 — Byg workflowet

1. Åbn **Workflows → Create Workflow**, navngiv det `Incidents → GitHub Issues`, og åbn **Builder**.
2. Tilføj en **Incident**-trigger sat til **On Create**. Omdøb den til `Incident`.
3. Tilføj en **API**-blok forbundet til triggeren:

   - **Method**: `POST`
   - **URL**: `https://api.github.com/repos/din-org/dit-repo/issues`
   - **Headers**:

     ```text
     Authorization: Bearer {{variable.GITHUB_TOKEN}}
     Accept: application/vnd.github+json
     X-GitHub-Api-Version: 2022-11-28
     User-Agent: OneUptime
     ```

   - **Body**:

     ```json
     {
       "title": "OneUptime incident: {{Incident.title}}",
       "body": "{{Incident.description}}\n\nFiled automatically from OneUptime.",
       "labels": ["incident", "oneuptime"]
     }
     ```

4. **Gem**, aktivér, og opret en testhændelse. Et `201 Created` i workflowets logfiler betyder, at sagen blev oprettet; responsebodyen indeholder dens `number` og `html_url`.

## Tips

- **GitHub Enterprise Server**: brug `https://din-vært/api/v3/repos/{owner}/{repo}/issues`.
- **Ansvarlige / milepæl**: tilføj `"assignees": ["octocat"]` eller `"milestone": 3` til bodyen.
- **Link tilbage**: læs `{{CreateIssue.response-body.html_url}}` og gem det på hændelsen med en **Update Incident**-blok.

## Fejlfinding

- **`401`** — tokenet er forkert eller udløbet. Finkornede tokens skal eksplicit give adgang til repo'et og **Issues**-tilladelsen.
- **`403` / hastighedsgrænse** — inkludér `User-Agent`-headeren (GitHub afviser anmodninger uden én) og tjek, at du ikke er hastighedsbegrænset.
- **`404`** — `owner/repo`-stien er forkert, eller tokenet kan ikke se et privat repo.
- **`422`** — en label, der ikke eksisterer, er fint (GitHub opretter refererede labels), men en misdannet body er ikke — tjek din JSON.

## Læs videre

- [Integrationsoversigt](/docs/integrations/index) — mønstre og autentificeringsoversigten.
- [GitLab](/docs/integrations/gitlab) — den samme idé for GitLab.
- [GitHub-integration (selvhostet)](/docs/self-hosted/github-integration) — den native GitHub App-forbindelse.
