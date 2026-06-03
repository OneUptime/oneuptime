# GitLab-integration

Öppna ett [GitLab](https://gitlab.com)-ärende automatiskt när en OneUptime-incident skapas — så att ingenjörernas uppföljning hamnar i det projekt som äger den berörda tjänsten.

Den här integrationen är **utgående**: OneUptime anropar [GitLab REST API](https://docs.gitlab.com/ee/api/issues.html). Den använder ett OneUptime **[Arbetsflöde](/docs/workflows/index)** med en **Incident → On Create**-utlösare och en **API-komponent**. Det fungerar likadant på GitLab.com och egenhostad GitLab.

```text
OneUptime Incident → On Create  ──►  API component (POST /projects/{id}/issues)  ──►  GitLab issue
```

## Förutsättningar

- Ett GitLab-projekt och dess **Project ID** (visas på projektets översiktssida, under projektnamnet).
- En åtkomsttoken som kan skapa ärenden — en **Project-**, **Group-** eller **Personal Access Token** med scopet `api`: **Settings → Access Tokens**.
- Ett OneUptime-projekt där du kan skapa arbetsflöden.

## Steg 1 — Spara token

1. Gå till **Workflows → Global Variables → Create**.
2. Namnge det `GITLAB_TOKEN`, klistra in token och slå på **Is Secret**.

## Steg 2 — Bygg arbetsflödet

1. Öppna **Workflows → Create Workflow**, namnge det `Incidents → GitLab Issues` och öppna **Builder**.
2. Lägg till en **Incident**-utlösare inställd på **On Create**. Byt namn till `Incident`.
3. Lägg till ett **API**-block kopplat till utlösaren:
   - **Method**: `POST`
   - **URL**: `https://gitlab.com/api/v4/projects/12345678/issues`  *(ersätt `12345678` med ditt Project ID; för egenhostad, använd din egen host)*
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

4. **Spara**, aktivera och skapa en testincident. `201 Created` i arbetsflödets loggar betyder att ärendet skapades; svars-bodyn innehåller dess `iid` och `web_url`.

## Tips

- **Egenhostad GitLab**: ersätt `https://gitlab.com` med din instans-URL; `/api/v4/...`-sökvägen förblir densamma.
- **Projektsökväg i stället för ID**: du kan URL-koda sökvägen — t.ex. `group%2Fproject` — i stället för det numeriska ID:t.
- **Tilldelad / förfallodatum**: lägg till `"assignee_ids": [42]` eller `"due_date": "2026-01-31"` i bodyn.
- **Länka tillbaka**: läs `{{CreateIssue.response-body.web_url}}` och spara det på incidenten med ett **Update Incident**-block.

## Felsökning

- **`401`** — token är ogiltig eller har löpt ut, eller saknar scopet `api`.
- **`404`** — Project ID är fel, eller token kan inte komma åt ett privat projekt.
- **`400`** — ett obligatoriskt fält saknas eller är felformaterat; `title` är obligatoriskt.

## Läs vidare

- [Integrationsöversikt](/docs/integrations/index) — mönster och autentiseringsfuskbladet.
- [GitHub](/docs/integrations/github) — samma idé för GitHub.
- [API-komponent](/docs/workflows/components#api) — läsa svars-bodyn.
