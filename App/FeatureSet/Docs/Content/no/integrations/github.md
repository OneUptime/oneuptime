# GitHub-integrasjon

Åpne en [GitHub](https://github.com)-sak automatisk når en OneUptime-hendelse opprettes — slik at ingeniøroppfølging spores i repoet som eier den berørte tjenesten.

Denne integrasjonen er **utgående**: OneUptime kaller [GitHub REST API](https://docs.github.com/en/rest/issues/issues). Den bruker en OneUptime **[Arbeidsflyt](/docs/workflows/index)** med en **Incident → On Create**-trigger og en **API-komponent**.

> **Ser du etter den dypere GitHub-tilkoblingen?** OneUptime har også en innebygd **GitHub App**-integrasjon for tilkobling av kodelagre (brukt av AI-agenten og kodefunksjoner). Den konfigureres med miljøvariabler, ikke arbeidsflyter — se [GitHub-integrasjon (selvhostet)](/docs/self-hosted/github-integration). Denne siden handler spesifikt om *å opprette saker fra hendelser*.

```text
OneUptime Incident → On Create  ──►  API component (POST /repos/{owner}/{repo}/issues)  ──►  GitHub issue
```

## Forutsetninger

- Et GitHub-repo der du vil at saker skal opprettes.
- Et token som kan opprette saker:
  - **Finkornet PAT** begrenset til det repoet med **Issues: Read and write**, eller
  - et **klassisk PAT** med `repo`-omfanget.

  Opprett ett på [github.com/settings/tokens](https://github.com/settings/tokens).
- Et OneUptime-prosjekt der du kan opprette arbeidsflyter.

## Steg 1 — Lagre tokenet

1. Gå til **Workflows → Global Variables → Create**.
2. Gi det navnet `GITHUB_TOKEN`, lim inn tokenet, og slå på **Is Secret**.

## Steg 2 — Bygg arbeidsflyten

1. Åpne **Workflows → Create Workflow**, gi den navnet `Incidents → GitHub Issues`, og åpne **Builder**.
2. Legg til en **Incident**-trigger satt til **On Create**. Gi den nytt navn `Incident`.
3. Legg til en **API**-blokk koblet til triggeren:
   - **Method**: `POST`
   - **URL**: `https://api.github.com/repos/your-org/your-repo/issues`
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

4. **Lagre**, aktiver, og opprett en testhendelse. Et `201 Created` i arbeidsflytloggene betyr at saken ble opprettet; svar-body-en inneholder dens `number` og `html_url`.

## Tips

- **GitHub Enterprise Server**: bruk `https://your-host/api/v3/repos/{owner}/{repo}/issues`.
- **Ansvarlige / milepæl**: legg til `"assignees": ["octocat"]` eller `"milestone": 3` i body-en.
- **Lenk tilbake**: les `{{CreateIssue.response-body.html_url}}` og lagre det på hendelsen med en **Update Incident**-blokk.

## Feilsøking

- **`401`** — tokenet er feil eller utløpt. Finkornede tokens må eksplisitt gi tilgang til repoet og **Issues**-rettigheten.
- **`403` / hastighetsbegrensning** — inkluder `User-Agent`-headeren (GitHub avviser forespørsler uten en) og sjekk at du ikke er hastighetsbegrenset.
- **`404`** — `owner/repo`-stien er feil, eller tokenet kan ikke se et privat repo.
- **`422`** — en kode som ikke eksisterer er greit (GitHub oppretter refererte koder), men en misformet body er det ikke — sjekk JSON-en din.

## Hvor du leser videre

- [Oversikt over integrasjoner](/docs/integrations/index) — mønstre og autentiserings-juksearket.
- [GitLab](/docs/integrations/gitlab) — det samme for GitLab.
- [GitHub-integrasjon (selvhostet)](/docs/self-hosted/github-integration) — den innebygde GitHub App-tilkoblingen.
