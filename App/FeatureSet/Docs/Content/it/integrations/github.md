# Integrazione con GitHub

Apri automaticamente un ticket [GitHub](https://github.com) quando viene creato un incidente OneUptime — in modo che il follow-up di engineering sia tracciato nel repository che gestisce il servizio interessato.

Questa integrazione è **in uscita**: OneUptime chiama la [GitHub REST API](https://docs.github.com/en/rest/issues/issues). Utilizza un **[Workflow](/docs/workflows/index)** di OneUptime con un trigger **Incident → On Create** e un **componente API**.

> **Stai cercando la connessione GitHub più approfondita?** OneUptime dispone anche di un'integrazione nativa **GitHub App** per collegare repository di codice (usata dall'agente AI e dalle funzionalità di codice). Questa viene configurata tramite variabili d'ambiente, non workflow — vedi [Integrazione GitHub (self-hosted)](/docs/self-hosted/github-integration). Questa pagina riguarda specificamente la _creazione di ticket dagli incidenti_.

```text
OneUptime Incident → On Create  ──►  API component (POST /repos/{owner}/{repo}/issues)  ──►  GitHub issue
```

## Prerequisiti

- Un repository GitHub in cui vuoi archiviare i ticket.
- Un token che possa creare ticket:

  - un **PAT fine-grained** con scope su quel repository con **Issues: Read and write**, oppure
  - un **PAT classico** con lo scope `repo`.

  Creane uno su [github.com/settings/tokens](https://github.com/settings/tokens).

- Un progetto OneUptime in cui puoi creare workflow.

## Passaggio 1 — Salva il token

1. Vai su **Workflows → Global Variables → Create**.
2. Chiamala `GITHUB_TOKEN`, incolla il token e attiva **Is Secret**.

## Passaggio 2 — Crea il workflow

1. Apri **Workflows → Create Workflow**, chiamalo `Incidents → GitHub Issues` e apri il **Builder**.
2. Aggiungi un trigger **Incident** impostato su **On Create**. Rinominalo `Incident`.
3. Aggiungi un blocco **API** collegato al trigger:

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

4. **Salva**, abilita e crea un incidente di test. Un `201 Created` nei log del workflow significa che il ticket è stato creato; il corpo della risposta contiene il suo `number` e `html_url`.

## Suggerimenti

- **GitHub Enterprise Server**: usa `https://your-host/api/v3/repos/{owner}/{repo}/issues`.
- **Assegnatari / milestone**: aggiungi `"assignees": ["octocat"]` o `"milestone": 3` al corpo.
- **Collegamento all'indietro**: leggi `{{CreateIssue.response-body.html_url}}` e salvalo sull'incidente con un blocco **Update Incident**.

## Risoluzione dei problemi

- **`401`** — il token è errato o scaduto. I PAT fine-grained devono concedere esplicitamente il repository e il permesso **Issues**.
- **`403` / limite di velocità** — includi l'header `User-Agent` (GitHub rifiuta le richieste senza di esso) e verifica di non aver superato il rate limit.
- **`404`** — il percorso `owner/repo` è errato, o il token non può vedere un repository privato.
- **`422`** — un'etichetta che non esiste va bene (GitHub crea le etichette referenziate), ma un corpo malformato no — controlla il tuo JSON.

## Dove leggere poi

- [Panoramica delle integrazioni](/docs/integrations/index) — pattern e guida rapida all'autenticazione.
- [GitLab](/docs/integrations/gitlab) — la stessa idea per GitLab.
- [Integrazione GitHub (self-hosted)](/docs/self-hosted/github-integration) — la connessione nativa GitHub App.
