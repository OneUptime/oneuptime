# Integrazione con GitLab

Apri automaticamente un ticket [GitLab](https://gitlab.com) quando viene creato un incidente OneUptime — in modo che il follow-up di engineering finisca nel progetto che gestisce il servizio interessato.

Questa integrazione è **in uscita**: OneUptime chiama la [GitLab REST API](https://docs.gitlab.com/ee/api/issues.html). Utilizza un **[Workflow](/docs/workflows/index)** di OneUptime con un trigger **Incident → On Create** e un **componente API**. Funziona allo stesso modo su GitLab.com e su GitLab self-managed.

```text
OneUptime Incident → On Create  ──►  API component (POST /projects/{id}/issues)  ──►  GitLab issue
```

## Prerequisiti

- Un progetto GitLab e il suo **Project ID** (mostrato nella pagina panoramica del progetto, sotto il nome del progetto).
- Un token di accesso che possa creare ticket — un **Project**, **Group** o **Personal Access Token** con lo scope `api`: **Settings → Access Tokens**.
- Un progetto OneUptime in cui puoi creare workflow.

## Passaggio 1 — Salva il token

1. Vai su **Workflows → Global Variables → Create**.
2. Chiamala `GITLAB_TOKEN`, incolla il token e attiva **Is Secret**.

## Passaggio 2 — Crea il workflow

1. Apri **Workflows → Create Workflow**, chiamalo `Incidents → GitLab Issues` e apri il **Builder**.
2. Aggiungi un trigger **Incident** impostato su **On Create**. Rinominalo `Incident`.
3. Aggiungi un blocco **API** collegato al trigger:
   - **Method**: `POST`
   - **URL**: `https://gitlab.com/api/v4/projects/12345678/issues`  *(sostituisci `12345678` con il tuo Project ID; per self-managed, usa il tuo host)*
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

4. **Salva**, abilita e crea un incidente di test. Un `201 Created` nei log del workflow significa che il ticket è stato creato; il corpo della risposta contiene il suo `iid` e `web_url`.

## Suggerimenti

- **GitLab self-managed**: sostituisci `https://gitlab.com` con l'URL della tua istanza; il percorso `/api/v4/...` rimane invariato.
- **Percorso del progetto invece dell'ID**: puoi codificare il percorso in URL — es. `group%2Fproject` — al posto dell'ID numerico.
- **Assegnatario / data di scadenza**: aggiungi `"assignee_ids": [42]` o `"due_date": "2026-01-31"` al corpo.
- **Collegamento all'indietro**: leggi `{{CreateIssue.response-body.web_url}}` e salvalo sull'incidente con un blocco **Update Incident**.

## Risoluzione dei problemi

- **`401`** — il token non è valido o è scaduto, oppure manca dello scope `api`.
- **`404`** — il Project ID è errato, o il token non può accedere a un progetto privato.
- **`400`** — un campo obbligatorio è mancante o malformato; `title` è obbligatorio.

## Dove leggere poi

- [Panoramica delle integrazioni](/docs/integrations/index) — pattern e guida rapida all'autenticazione.
- [GitHub](/docs/integrations/github) — la stessa idea per GitHub.
- [Componente API](/docs/workflows/components#api) — lettura del corpo della risposta.
