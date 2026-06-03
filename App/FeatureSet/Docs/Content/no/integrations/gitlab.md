# GitLab-integrasjon

Åpne en [GitLab](https://gitlab.com)-sak automatisk når en OneUptime-hendelse opprettes — slik at ingeniøroppfølging lander i prosjektet som eier den berørte tjenesten.

Denne integrasjonen er **utgående**: OneUptime kaller [GitLab REST API](https://docs.gitlab.com/ee/api/issues.html). Den bruker en OneUptime **[Arbeidsflyt](/docs/workflows/index)** med en **Incident → On Create**-trigger og en **API-komponent**. Den fungerer likt på GitLab.com og selvadministrert GitLab.

```text
OneUptime Incident → On Create  ──►  API component (POST /projects/{id}/issues)  ──►  GitLab issue
```

## Forutsetninger

- Et GitLab-prosjekt og dets **Project ID** (vises på prosjektets oversiktsside, under prosjektnavnet).
- Et tilgangstoken som kan opprette saker — et **Project**-, **Group**- eller **Personal Access Token** med `api`-omfanget: **Settings → Access Tokens**.
- Et OneUptime-prosjekt der du kan opprette arbeidsflyter.

## Steg 1 — Lagre tokenet

1. Gå til **Workflows → Global Variables → Create**.
2. Gi det navnet `GITLAB_TOKEN`, lim inn tokenet, og slå på **Is Secret**.

## Steg 2 — Bygg arbeidsflyten

1. Åpne **Workflows → Create Workflow**, gi den navnet `Incidents → GitLab Issues`, og åpne **Builder**.
2. Legg til en **Incident**-trigger satt til **On Create**. Gi den nytt navn `Incident`.
3. Legg til en **API**-blokk koblet til triggeren:
   - **Method**: `POST`
   - **URL**: `https://gitlab.com/api/v4/projects/12345678/issues`  *(erstatt `12345678` med din Project ID; for selvadministrert, bruk din egen vert)*
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

4. **Lagre**, aktiver, og opprett en testhendelse. Et `201 Created` i arbeidsflytloggene betyr at saken ble opprettet; svar-body-en inneholder dens `iid` og `web_url`.

## Tips

- **Selvadministrert GitLab**: erstatt `https://gitlab.com` med instans-URL-en din; `/api/v4/...`-stien forblir den samme.
- **Prosjektsti i stedet for ID**: du kan URL-kode stien — f.eks. `group%2Fproject` — i stedet for den numeriske ID-en.
- **Ansvarlig / forfallsdato**: legg til `"assignee_ids": [42]` eller `"due_date": "2026-01-31"` i body-en.
- **Lenk tilbake**: les `{{CreateIssue.response-body.web_url}}` og lagre det på hendelsen med en **Update Incident**-blokk.

## Feilsøking

- **`401`** — tokenet er ugyldig eller utløpt, eller mangler `api`-omfanget.
- **`404`** — Project ID er feil, eller tokenet har ikke tilgang til et privat prosjekt.
- **`400`** — et obligatorisk felt mangler eller er misformet; `title` er påkrevd.

## Hvor du leser videre

- [Oversikt over integrasjoner](/docs/integrations/index) — mønstre og autentiserings-juksearket.
- [GitHub](/docs/integrations/github) — det samme for GitHub.
- [API-komponent](/docs/workflows/components#api) — å lese svar-body.
