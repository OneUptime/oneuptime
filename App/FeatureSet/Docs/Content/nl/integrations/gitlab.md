# GitLab-integratie

Open automatisch een [GitLab](https://gitlab.com)-issue wanneer een OneUptime-incident wordt aangemaakt — zodat de engineeringopvolging terechtkomt in het project dat eigenaar is van de getroffen service.

Deze integratie is **outbound**: OneUptime roept de [GitLab REST API](https://docs.gitlab.com/ee/api/issues.html) aan. Ze maakt gebruik van een OneUptime **[Workflow](/docs/workflows/index)** met een **Incident → On Create**-trigger en een **API-component**. Ze werkt hetzelfde op GitLab.com en zelf-beheerde GitLab.

```text
OneUptime Incident → On Create  ──►  API component (POST /projects/{id}/issues)  ──►  GitLab issue
```

## Vereisten

- Een GitLab-project en zijn **Project ID** (zichtbaar op de overzichtspagina van het project, onder de projectnaam).
- Een toegangstoken dat issues kan aanmaken — een **Project-**, **Group-** of **Personal Access Token** met het bereik `api`: **Settings → Access Tokens**.
- Een OneUptime-project waar je workflows kunt aanmaken.

## Stap 1 — Sla het token op

1. Ga naar **Workflows → Global Variables → Create**.
2. Geef het de naam `GITLAB_TOKEN`, plak het token, en zet **Is Secret** aan.

## Stap 2 — Bouw de workflow

1. Open **Workflows → Create Workflow**, geef het de naam `Incidents → GitLab Issues`, en open de **Builder**.
2. Voeg een **Incident**-trigger toe ingesteld op **On Create**. Hernoem het naar `Incident`.
3. Voeg een **API**-blok toe verbonden met de trigger:
   - **Method**: `POST`
   - **URL**: `https://gitlab.com/api/v4/projects/12345678/issues`  *(vervang `12345678` door je Project ID; gebruik voor zelf-beheerde GitLab je eigen host)*
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

4. **Sla op**, schakel in en maak een testincident aan. Een `201 Created` in de workflow-logs betekent dat de issue is aangemaakt; de responsebody bevat de `iid` en de `web_url`.

## Tips

- **Zelf-beheerde GitLab**: vervang `https://gitlab.com` door je instantie-URL; het pad `/api/v4/...` blijft hetzelfde.
- **Projectpad in plaats van ID**: je kunt het pad URL-coderen — bijv. `group%2Fproject` — in plaats van het numerieke ID.
- **Toegewezene / vervaldatum**: voeg `"assignee_ids": [42]` of `"due_date": "2026-01-31"` toe aan de body.
- **Terugkoppeling**: lees `{{CreateIssue.response-body.web_url}}` en sla het op bij het incident met een **Update Incident**-blok.

## Probleemoplossing

- **`401`** — het token is ongeldig of verlopen, of mist het bereik `api`.
- **`404`** — het Project ID is verkeerd, of het token heeft geen toegang tot een privéproject.
- **`400`** — een verplicht veld ontbreekt of is misvormd; `title` is verplicht.

## Waar verder lezen

- [Integraties – Overzicht](/docs/integrations/index) — patronen en het authenticatie-spiekbriefje.
- [GitHub](/docs/integrations/github) — hetzelfde idee voor GitHub.
- [API-component](/docs/workflows/components#api) — de responsebody lezen.
