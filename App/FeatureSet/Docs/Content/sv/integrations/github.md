# GitHub-integration

Öppna ett [GitHub](https://github.com)-ärende automatiskt när en OneUptime-incident skapas — så att ingenjörernas uppföljning spåras i det repo som äger den berörda tjänsten.

Den här integrationen är **utgående**: OneUptime anropar [GitHub REST API](https://docs.github.com/en/rest/issues/issues). Den använder ett OneUptime **[Arbetsflöde](/docs/workflows/index)** med en **Incident → On Create**-utlösare och en **API-komponent**.

> **Letar du efter den djupare GitHub-anslutningen?** OneUptime har också en inbyggd **GitHub App**-integration för att ansluta kodrepon (används av AI-agenten och kodfunktioner). Den konfigureras med miljövariabler, inte arbetsflöden — se [GitHub Integration (egenhostad)](/docs/self-hosted/github-integration). Den här sidan handlar specifikt om att *lägga ärenden från incidenter*.

```text
OneUptime Incident → On Create  ──►  API component (POST /repos/{owner}/{repo}/issues)  ──►  GitHub issue
```

## Förutsättningar

- Ett GitHub-repo där du vill att ärenden ska läggas.
- En token som kan skapa ärenden:
  - **Fine-grained PAT** scoped till det repot med **Issues: Read and write**, eller
  - en **klassisk PAT** med scopet `repo`.

  Skapa en på [github.com/settings/tokens](https://github.com/settings/tokens).
- Ett OneUptime-projekt där du kan skapa arbetsflöden.

## Steg 1 — Spara token

1. Gå till **Workflows → Global Variables → Create**.
2. Namnge det `GITHUB_TOKEN`, klistra in token och slå på **Is Secret**.

## Steg 2 — Bygg arbetsflödet

1. Öppna **Workflows → Create Workflow**, namnge det `Incidents → GitHub Issues` och öppna **Builder**.
2. Lägg till en **Incident**-utlösare inställd på **On Create**. Byt namn till `Incident`.
3. Lägg till ett **API**-block kopplat till utlösaren:
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

4. **Spara**, aktivera och skapa en testincident. `201 Created` i arbetsflödets loggar betyder att ärendet skapades; svars-bodyn innehåller dess `number` och `html_url`.

## Tips

- **GitHub Enterprise Server**: använd `https://your-host/api/v3/repos/{owner}/{repo}/issues`.
- **Tilldelade / milstolpe**: lägg till `"assignees": ["octocat"]` eller `"milestone": 3` i bodyn.
- **Länka tillbaka**: läs `{{CreateIssue.response-body.html_url}}` och spara det på incidenten med ett **Update Incident**-block.

## Felsökning

- **`401`** — token är fel eller har löpt ut. Fine-grained tokens måste explicit bevilja repot och **Issues**-behörigheten.
- **`403` / hastighetsgräns** — inkludera `User-Agent`-headern (GitHub avvisar förfrågningar utan en) och kontrollera att du inte är hastighetsbegränsad.
- **`404`** — `owner/repo`-sökvägen är fel, eller token kan inte se ett privat repo.
- **`422`** — en etikett som inte finns är okej (GitHub skapar refererade etiketter), men en felformaterad body är det inte — kontrollera din JSON.

## Läs vidare

- [Integrationsöversikt](/docs/integrations/index) — mönster och autentiseringsfuskbladet.
- [GitLab](/docs/integrations/gitlab) — samma idé för GitLab.
- [GitHub Integration (egenhostad)](/docs/self-hosted/github-integration) — den inbyggda GitHub App-anslutningen.
