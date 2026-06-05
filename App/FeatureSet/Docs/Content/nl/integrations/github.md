# GitHub-integratie

Open automatisch een [GitHub](https://github.com)-issue wanneer een OneUptime-incident wordt aangemaakt — zodat de engineeringopvolging wordt bijgehouden in de repository die eigenaar is van de getroffen service.

Deze integratie is **outbound**: OneUptime roept de [GitHub REST API](https://docs.github.com/en/rest/issues/issues) aan. Ze maakt gebruik van een OneUptime **[Workflow](/docs/workflows/index)** met een **Incident → On Create**-trigger en een **API-component**.

> **Op zoek naar de diepere GitHub-verbinding?** OneUptime heeft ook een native **GitHub App**-integratie voor het koppelen van coderepositories (gebruikt door de AI-agent en codefuncties). Die wordt geconfigureerd met omgevingsvariabelen, niet met workflows — zie [GitHub Integration (self-hosted)](/docs/self-hosted/github-integration). Deze pagina gaat specifiek over *issues aanmaken vanuit incidenten*.

```text
OneUptime Incident → On Create  ──►  API component (POST /repos/{owner}/{repo}/issues)  ──►  GitHub issue
```

## Vereisten

- Een GitHub-repository waar je issues wilt aanmaken.
- Een token dat issues kan aanmaken:
  - Een **fine-grained PAT** beperkt tot die repository met **Issues: Read and write**, of
  - een **classic PAT** met het `repo`-bereik.

  Maak er een aan op [github.com/settings/tokens](https://github.com/settings/tokens).
- Een OneUptime-project waar je workflows kunt aanmaken.

## Stap 1 — Sla het token op

1. Ga naar **Workflows → Global Variables → Create**.
2. Geef het de naam `GITHUB_TOKEN`, plak het token, en zet **Is Secret** aan.

## Stap 2 — Bouw de workflow

1. Open **Workflows → Create Workflow**, geef het de naam `Incidents → GitHub Issues`, en open de **Builder**.
2. Voeg een **Incident**-trigger toe ingesteld op **On Create**. Hernoem het naar `Incident`.
3. Voeg een **API**-blok toe verbonden met de trigger:
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

4. **Sla op**, schakel in en maak een testincident aan. Een `201 Created` in de workflow-logs betekent dat de issue is aangemaakt; de responsebody bevat het `number` en de `html_url`.

## Tips

- **GitHub Enterprise Server**: gebruik `https://your-host/api/v3/repos/{owner}/{repo}/issues`.
- **Toegewezenen / mijlpaal**: voeg `"assignees": ["octocat"]` of `"milestone": 3` toe aan de body.
- **Terugkoppeling**: lees `{{CreateIssue.response-body.html_url}}` en sla het op bij het incident met een **Update Incident**-blok.

## Probleemoplossing

- **`401`** — het token is verkeerd of verlopen. Fine-grained tokens moeten expliciet de repository en de **Issues**-toestemming verlenen.
- **`403` / snelheidsbeperking** — voeg de `User-Agent`-header toe (GitHub weigert verzoeken zonder) en controleer of je niet wordt beperkt.
- **`404`** — het pad `owner/repo` is verkeerd, of het token heeft geen toegang tot een privérepository.
- **`422`** — een label dat niet bestaat is prima (GitHub maakt labels aan), maar een misvormde body niet — controleer je JSON.

## Waar verder lezen

- [Integraties – Overzicht](/docs/integrations/index) — patronen en het authenticatie-spiekbriefje.
- [GitLab](/docs/integrations/gitlab) — hetzelfde idee voor GitLab.
- [GitHub Integration (self-hosted)](/docs/self-hosted/github-integration) — de native GitHub App-verbinding.
