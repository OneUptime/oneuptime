# Integrazione con Jira

Apri automaticamente un ticket [Jira](https://www.atlassian.com/software/jira) ogni volta che viene creato un incidente OneUptime — in modo che il lavoro di engineering sia tracciato dove i tuoi sviluppatori già lavorano, con un link all'incidente.

Questa integrazione è **in uscita**: OneUptime chiama la REST API di Jira. Utilizza un **[Workflow](/docs/workflows/index)** di OneUptime con un trigger **Incident → On Create** e un **componente API**. Puoi facoltativamente aggiungere un percorso **in entrata** in modo che la chiusura del ticket Jira risolva l'incidente OneUptime.

```text
OneUptime Incident → On Create  ──►  API component (POST /rest/api/3/issue)  ──►  Jira issue
```

## Prerequisiti

- Un sito Jira Cloud (`https://your-domain.atlassian.net`) e un progetto in cui archiviare i ticket — nota la sua **project key** (es. `OPS`).
- Un account Jira che può creare ticket e un **API token** da [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
- Un progetto OneUptime in cui puoi creare workflow.

> Usi **Jira Data Center / Server** (self-managed)? Il flusso è identico — usa il tuo URL di base e un [Personal Access Token](https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html) con un header di autenticazione `Bearer` al posto della Basic auth. L'endpoint `/rest/api/2/issue` accetta una descrizione in testo semplice, il che semplifica i template.

## Passaggio 1 — Salva le tue credenziali Jira come segreto

Jira Cloud usa la **Basic auth** con la tua email e il token API, codificati in base64.

1. Codifica una volta in base64 `email:api_token`. Su macOS/Linux:

   ```bash
   printf '%s' 'you@example.com:your_api_token' | base64
   ```

2. In OneUptime, vai su **Workflows → Global Variables → Create**.
3. Chiamala `JIRA_AUTH`, incolla la stringa base64 come valore e attiva **Is Secret**.

Ora puoi usare `Basic {{variable.JIRA_AUTH}}` come header di autenticazione e il token non apparirà mai nel workflow o nei suoi log.

## Passaggio 2 — Crea il workflow

1. Apri **Workflows → Create Workflow**, chiamalo `Incidents → Jira` e apri il **Builder**.
2. Trascina un trigger **Incident** sul canvas e scegli l'evento **On Create**. Rinominalo `Incident`.
3. Trascina un blocco **API** e collegalo al trigger. Configura:
   - **Method**: `POST`
   - **URL**: `https://your-domain.atlassian.net/rest/api/3/issue`
   - **Headers**:

     ```text
     Authorization: Basic {{variable.JIRA_AUTH}}
     Content-Type: application/json
     ```

   - **Body** (Jira Cloud v3 utilizza l'Atlassian Document Format per la descrizione):

     ```json
     {
       "fields": {
         "project": { "key": "OPS" },
         "issuetype": { "name": "Bug" },
         "summary": "OneUptime incident: {{Incident.title}}",
         "description": {
           "type": "doc",
           "version": 1,
           "content": [
             {
               "type": "paragraph",
               "content": [
                 { "type": "text", "text": "{{Incident.description}}" }
               ]
             }
           ]
         }
       }
     }
     ```

   Sostituisci `OPS` con la tua project key e `Bug` con un tipo di ticket che esiste in quel progetto.
4. **Salva.** Lascia il workflow disabilitato finché non lo hai testato.

## Passaggio 3 — Testalo

1. Attiva **Enabled** nel workflow.
2. Crea un incidente di test in OneUptime (o attivane uno da un monitor).
3. Apri la scheda **Logs** del workflow. Il blocco **API** dovrebbe mostrare uno stato `201` e un corpo della risposta contenente la `key` del nuovo ticket (ad esempio `OPS-1234`).
4. Controlla Jira — il ticket è lì.

Se il blocco API restituisce un errore, espandilo nei log — la risposta di Jira spiega esattamente quale campo ha rifiutato. Vedi [Risoluzione dei problemi](#risoluzione-dei-problemi).

## Passaggio 4 — Collega l'incidente al ticket (consigliato)

È utile salvare la chiave del ticket Jira sull'incidente in modo che le persone possano passare facilmente dall'uno all'altro.

- La risposta del blocco API è disponibile come `{{CreateIssue.response-body.key}}` (se hai chiamato il blocco `CreateIssue`).
- Aggiungi un blocco **Update Incident** dopo di esso e scrivi la chiave in un'etichetta, un campo personalizzato o una nota sull'incidente.

Questo rende possibile anche la sincronizzazione bidirezionale opzionale descritta di seguito.

## Sincronizzazione bidirezionale (opzionale)

Per risolvere l'incidente OneUptime quando qualcuno chiude il ticket Jira, aggiungi un workflow **in entrata**:

1. Crea un secondo workflow che inizia con un trigger **Webhook** e copia il suo URL.
2. In Jira, vai su **Project settings → Automation → Create rule**:
   - **Trigger**: *Issue transitioned* a **Done** (o *Issue resolved*).
   - **Action**: *Send web request* → metodo `POST`, URL = l'URL webhook del tuo workflow, il corpo include la chiave del ticket e l'id dell'incidente OneUptime, es.:

     ```json
     { "issueKey": "{{issue.key}}", "status": "resolved" }
     ```

3. Nel workflow, usa un blocco **Find Incident** per localizzare l'incidente tramite la chiave salvata, poi un blocco **Update Incident** per spostarlo nel tuo stato risolto.

Se hai salvato la chiave Jira sull'incidente nel Passaggio 4, la corrispondenza è immediata. Vedi [Componenti → Componenti per i dati di OneUptime](/docs/workflows/components#oneuptime-data-components).

## Personalizzare il ticket

Alcune modifiche comuni al corpo del blocco API:

- **Priorità** — aggiungi `"priority": { "name": "High" }` dentro `fields`. Puoi ramificare su `{{Incident.incidentSeverity.name}}` con **Conditions** per mappare le severità OneUptime alle priorità Jira.
- **Etichette** — aggiungi `"labels": ["oneuptime", "incident"]`.
- **Assegnatario** — aggiungi `"assignee": { "id": "<accountId>" }` (Jira Cloud usa gli ID account, non i nomi utente).
- **Campi personalizzati** — aggiungi `"customfield_XXXXX": "..."` usando l'ID del campo dal tuo admin Jira.

Per scoprire i nomi esatti dei campi che un progetto si aspetta, chiama l'endpoint `GET /rest/api/3/issue/createmeta` di Jira una volta dal tuo browser o con `curl`.

## Risoluzione dei problemi

**`401 Unauthorized`.**
- Ricodifica `email:api_token` e aggiorna la variabile `JIRA_AUTH`. Un carattere di nuova riga finale è il colpevole abituale — usa `printf` (non `echo`) durante la codifica.
- Conferma che l'account proprietario del token API possa creare ticket nel progetto.

**`400 Bad Request` con menzione di un campo.**
- Il tipo di ticket o un campo obbligatorio è errato. Controlla il nome del **tipo di ticket** del progetto e se ha campi personalizzati obbligatori. Usa `createmeta` (sopra) per vedere cosa è obbligatorio.

**`404 Not Found`.**
- Verifica l'URL di base e che stai usando `/rest/api/3/issue` (Cloud) o `/rest/api/2/issue` (Server/Data Center).

**La descrizione appare su una sola riga / ha un aspetto strano.**
- La v3 richiede l'Atlassian Document Format mostrato sopra. Se preferisci inviare testo semplice, usa l'endpoint `/rest/api/2/issue` con `"description": "{{Incident.description}}"` come stringa semplice.

## Dove leggere poi

- [Panoramica delle integrazioni](/docs/integrations/index) — i pattern in entrata/uscita e la guida rapida all'autenticazione.
- [Componente API](/docs/workflows/components#api) — metodi, header e lettura della risposta.
- [Variabili](/docs/workflows/variables) — segreti e campi degli incidenti.
- [PagerDuty](/docs/integrations/pagerduty) e [ServiceNow](/docs/integrations/servicenow) — lo stesso pattern in uscita per altri strumenti.
