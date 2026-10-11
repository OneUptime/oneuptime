# Panoramica dei moduli

Un modulo è una pagina che chiunque abbia il suo link può compilare, senza un account OneUptime. Ogni invio crea qualcosa nel tuo progetto: un **incidente**, per le segnalazioni di problemi, oppure un **evento di manutenzione programmata**, per le richieste di modifica e di manutenzione. Costruisci le domande del modulo in un editor drag-and-drop, decidi come le risposte diventano il record e condividi il link con le persone che devono usarlo.

Usa un modulo quando chi nota un problema, o ha bisogno di una modifica, non è chi gestisce i tuoi incidenti e le tue manutenzioni: addetti al supporto, colleghi di un altro reparto, il responsabile di un negozio, il team operativo di un cliente. Aprono il link, rispondono alle tue domande e premono **Invia**. Il tuo team riceve un normale incidente o evento, con le risposte nei suoi campi e una nota privata che registra chi l'ha inviato.

:::cards
- [Creare il primo modulo](#creare-il-primo-modulo): Da un modulo vuoto a un link che puoi condividere.
- [Creare un modulo](/docs/forms/building): Domande, tipi di risposta, domande nascoste, modelli e branding.
- [Cosa crea un invio](/docs/forms/on-submit): Come le risposte e le impostazioni diventano un incidente o un evento di manutenzione.
- [Condivisione e sicurezza](/docs/forms/sharing-and-security): Il link, la lista degli IP consentiti, i limiti di frequenza e la risoluzione dei problemi.
:::

## Come funziona un modulo

```mermaid title="Da un modulo compilato a un incidente o un evento di manutenzione"
flowchart TB
    submitter["Qualcuno con il link,<br/>senza account"] --> page["La pagina del modulo"]
    page -->|Invia| checks["Protezioni e<br/>controllo delle risposte"]
    checks --> submission["Invio, conservato<br/>con il modulo"]
    submission --> target{"Ogni invio crea"}
    target -->|Incidente| incident["Incidente, nascosto<br/>dalle pagine di stato"]
    target -->|Manutenzione programmata| event["Evento di manutenzione,<br/>nascosto salvo impostazione"]
    incident --> response["Si eseguono le policy di<br/>reperibilità e le regole"]
    incident --> note["Nota privata: chi l'ha inviato,<br/>altre risposte"]
    event --> note
```

Ogni richiesta passa prima per le protezioni del modulo: la sua pagina, i limiti di frequenza, la lista degli IP consentiti e il captcha. Un invio le cui risposte sono valide viene conservato e crea un record, compilato con le risposte, con le impostazioni **All'invio** del modulo e, per un incidente, con il suo modello di incidente. Nulla di ciò che crea arriva su una pagina di stato finché il tuo team non lo decide.

## In breve

- **Un prodotto a sé**: **Moduli** si trova nel menu dei prodotti, in `/dashboard/{projectId}/forms`. Ogni modulo ha un proprio link, per esempio `https://oneuptime.com/accounts/form/<share-key>` su OneUptime Cloud.
- **Nessun account necessario**: chiunque abbia il link può aprire il modulo e inviarlo, senza accedere.
- **Un editor, non una pagina di impostazioni**: aggiungi domande tue (risposte brevi, paragrafi, menu a discesa, date, caselle di controllo e altro), i campi di ciò che il modulo crea (titolo, descrizione, gravità, monitor, etichette, inizio e fine), i tuoi campi personalizzati e il nome e l'e-mail di chi invia. Trascinali nell'ordine giusto, guarda l'anteprima del modulo, salva.
- **Decidi tu da dove viene ogni valore**: la pagina **All'invio** elenca ogni campo del nuovo incidente o evento accanto alla sua origine: una risposta, un valore predefinito, un'impostazione che vale sempre o il modello di incidente.
- **Nascosto finché qualcuno non lo pubblica**: gli incidenti di un modulo non vengono mai mostrati sulle pagine di stato né inviati agli iscritti quando vengono dichiarati; nemmeno gli eventi di manutenzione, a meno che il modulo non lo preveda.
- **Protetto a più livelli**: un interruttore **Accetta invii**, una **Lista IP consentiti** facoltativa, il rifiuto delle richieste da altri siti, limiti di frequenza, il captcha dell'istanza e limiti di dimensione su ogni risposta.
- **Ogni invio conservato**: la pagina **Invii** di ogni modulo, e **Moduli → Invii** per tutti, elencano le risposte e rimandano a ciò che ogni invio ha creato.
- **Il tuo branding**: carica un logo per la parte alta della pagina del modulo e una favicon per la scheda del browser, nella sezione **Branding** della pagina **Costruisci**. Fino ad allora il modulo mostra quelli di OneUptime.
- **Modelli per i casi frequenti**: salva insiemi di risposte con un nome, come **Interruzione dell'applicazione** o **Manutenzione pianificata**, e le persone ne scelgono uno in cima al modulo per compilarlo, oppure aprono il suo link. Ogni modello può anche rendere una domanda obbligatoria, facoltativa o nascosta per il suo caso. Un solo modulo, e un solo segnalibro, serve un intero team.
- **Domande nascoste**: nascondi una domanda a cui nessuno dovrebbe dover rispondere, come la descrizione dell'incidente, e lascia che ogni modello risponda al suo posto, oppure la ponga, nei casi che ne hanno bisogno.
- **Duplica modulo**: avvia un modulo per un altro team partendo da uno che funziona, con le sue domande, i suoi modelli e le sue impostazioni.

## Cosa può creare un modulo

Quando crei un modulo scegli cosa **Ogni invio crea**. Puoi cambiarlo in seguito nella pagina **All'invio** del modulo.

| Ogni invio crea | Da usare per | Cosa succede |
| --- | --- | --- |
| **Incidente** | Segnalazioni di problemi | Un incidente viene dichiarato subito, così le tue policy di reperibilità e le tue regole vengono eseguite e le persone reperibili vengono avvisate. Resta fuori dalle pagine di stato finché qualcuno che interviene non lo pubblica. |
| **Manutenzione programmata** | Richieste di modifica e di manutenzione | Un evento di manutenzione viene programmato per la finestra richiesta da chi invia. Salvo diversa indicazione del modulo, resta fuori dalle sue pagine di stato e non avvisa alcun iscritto. |

I moduli partono con questi due, e seguiranno altri tipi di record.

## Prima di iniziare

- **Un piano che includa i moduli.** Su OneUptime Cloud, i moduli richiedono il piano **Growth** o superiore. Vedi [Piano](#piano).
- **L'autorizzazione a creare moduli.** **Create Form** spetta ai proprietari e agli amministratori del progetto, e ai ruoli a cui la assegni. Vedi [Autorizzazioni](#autorizzazioni).
- **Per un modulo di incidenti, una gravità.** Ogni incidente ne richiede una: da una domanda, dalle impostazioni del modulo o dal suo modello di incidente. Senza, ogni invio viene rifiutato. Vedi [Cosa crea un invio](/docs/forms/on-submit#how-a-submission-becomes-an-incident).

## Creare il primo modulo

:::steps
### Creare il modulo

Apri **Moduli** dal menu dei prodotti e fai clic su **Crea modulo**. Dai al modulo un nome (il titolo della sua pagina pubblica, univoco nel progetto), scegli cosa **Ogni invio crea** e, se vuoi, una descrizione in Markdown, mostrata in cima alla pagina pubblica.

### Costruire le domande

Il modulo si apre sulla pagina **Costruisci**, che chiede già un titolo, una descrizione e chi invia (e, per un modulo di manutenzione, quando la manutenzione inizia e finisce). Aggiungi, rimuovi e riordina le domande, poi fai clic su **Salva modifiche**. Vedi [Creare un modulo](/docs/forms/building).

### Decidere cosa crea un invio

In **All'invio**, controlla come un invio diventa un incidente o un evento, e fai clic su **Modifica impostazioni** per assegnargli valori predefiniti: una gravità, un modello di incidente, monitor ed etichette da allegare sempre, proprietari da avvisare. Vedi [Cosa crea un invio](/docs/forms/on-submit).

### Aggiungere modelli se le persone segnalano gli stessi casi

In **Modelli**, salva un modello per ogni caso segnalato spesso: il modulo li elenca sopra le domande, si compila a partire da quello scelto e pone le domande come dice quel modello; una domanda che serve a un caso può essere obbligatoria nel suo modello e nascosta negli altri. Vedi [Modelli](/docs/forms/building#templates).

### Condividere il link

In **Condividi**, copia il link e invialo alle persone che devono usare il modulo. Vedi [Condivisione e sicurezza](/docs/forms/sharing-and-security).
:::

> [!IMPORTANT]
> Un nuovo modulo **Accetta invii** non appena viene creato, ma nessuno può raggiungerlo finché non condividi il suo link. Configura prima le sue domande e le sue protezioni.

## Le pagine di un modulo

| Pagina | Cosa contiene |
| --- | --- |
| **Costruisci** | Il nome e la descrizione del modulo, il suo **Branding** (logo e favicon, ripiegati) e l'editor: le sue domande, la tavolozza delle domande e l'**Anteprima**. |
| **Modelli** | Insiemi di risposte con un nome da cui si può iniziare il modulo, come ognuno pone le domande, quello con cui il modulo si apre e il link proprio di ciascuno. |
| **All'invio** | Cosa crea ogni invio e come viene compilato ognuno dei suoi campi. **Modifica impostazioni** cambia i valori predefiniti e ciò che vale sempre. |
| **Condividi** | **Accetta invii**, il **Link di condivisione**, il messaggio mostrato dopo l'invio e la **Lista IP consentiti**. |
| **Invii** | Ogni invio fatto tramite il modulo, il più recente per primo, con le sue risposte e ciò che ha creato. |
| **Duplica modulo** | In **Avanzato**: una copia del modulo, con un nome scelto per te, con le sue domande, i modelli, le impostazioni All'invio, il branding, il messaggio di ringraziamento e la lista degli IP consentiti, e un link proprio. La copia parte disattivata e si apre nel suo editor. |
| **Elimina modulo** | L'eliminazione del modulo, in **Avanzato**. I suoi invii vengono eliminati con lui; gli incidenti e gli eventi che ha creato no. |

La sezione **Sviluppatori** del menu del modulo contiene le sue pagine Terraform, API e assistente AI, come per ogni altra risorsa.

## Moduli e modelli di incidente

Un modello e un modulo ti evitano entrambi di digitare due volte lo stesso incidente, ma servono persone diverse:

| | Modello di incidente | Modulo |
| --- | --- | --- |
| Chi lo usa | Il tuo team, con accesso a OneUptime | Chiunque abbia il link, senza account |
| Dove | **Crea da modello** nell'elenco degli incidenti | Una pagina a sé, al link del modulo |
| Cosa si può cambiare | Ogni campo dell'incidente, prima di dichiararlo | Solo le risposte alle domande che hai scelto |
| Cosa si vede | I tuoi monitor, le policy, i proprietari e ogni campo | Il nome, la descrizione e le domande del modulo, e solo le opzioni che hai scelto di offrire |
| Pagine di stato | Ciò che dicono il modello e il modulo di dichiarazione | Nascosto finché qualcuno che interviene non pubblica l'incidente |

Funzionano insieme. Assegna a un modulo di incidenti un **Incidente Modello** nella sua pagina **All'invio**, e ogni incidente che dichiara viene dichiarato da quel modello: costruisci il modello per ciò che serve al tuo team sull'incidente, e il modulo per ciò che vuoi chiedere a chi invia.

## Invii

La pagina **Invii** di un modulo elenca ogni invio fatto tramite il modulo, il più recente per primo, con **Inviato il**, **Inviato da** (il nome e l'e-mail che ha dato chi invia, oppure **Anonimo**) e **Creato**, un link all'incidente o all'evento creato. **Visualizza risposte** mostra ogni risposta come l'ha data chi invia. **Moduli → Invii** elenca gli invii di tutti i moduli del progetto.

Gli invii li scrive il modulo, mai una persona, e non si possono modificare. Eliminarne uno toglie dall'elenco le sue risposte e il nome e l'e-mail di chi ha inviato; l'incidente o l'evento creato resta, così come la nota privata che contiene, che ripete i dati di chi ha inviato e le risposte. Quando l'incidente o l'evento viene eliminato, il suo invio resta e la sua colonna **Creato** indica **Eliminato in seguito**.

> [!WARNING]
> Quando rimuovi i dati personali di qualcuno, eliminare l'invio non basta: modifica o elimina anche la nota privata sull'incidente o sull'evento che ha creato.

## Autorizzazioni

I moduli permettono a persone esterne al tuo team di creare incidenti ed eventi di manutenzione nel tuo progetto, quindi sono gestiti dai proprietari e dagli amministratori del progetto, e dai ruoli a cui assegni le autorizzazioni **Form**. Si trovano nel gruppo **Form** del [Riferimento autorizzazioni](/docs/permissions/reference):

| Autorizzazione | Cosa consente | Chi ce l'ha per impostazione predefinita |
| --- | --- | --- |
| **Create Form** | Creare moduli e duplicarli. | Project Owner, Project Admin |
| **Edit Form** | Modificare un modulo: le sue domande, il branding, i modelli, le impostazioni All'invio, **Accetta invii**, il suo link e la **Lista IP consentiti**. | Project Owner, Project Admin |
| **Delete Form** | Eliminare un modulo e con lui i suoi invii. | Project Owner, Project Admin |
| **Read Form** | Vedere i moduli, le loro domande, le impostazioni e i link. | I precedenti, più Project Member, Viewer e i ruoli di incidenti e manutenzione programmata |
| **Read Form Submission** | Vedere gli invii e le loro risposte. | Project Owner, Project Admin |
| **Delete Form Submission** | Eliminare gli invii. | Project Owner, Project Admin |

Gli invii contengono ciò che hanno scritto degli sconosciuti (nomi, indirizzi e-mail e risposte che forse non arrivano mai al record), quindi li vedono solo i proprietari e gli amministratori del progetto, a meno che tu non conceda **Read Form Submission**. Chi può leggere un modulo può vederne e condividerne il link. Inviare un modulo non richiede alcuna autorizzazione. Per come si combinano ruoli e autorizzazioni granulari, vedi [Utenti, team e autorizzazioni](/docs/permissions/index).

## Piano

Su OneUptime Cloud, i moduli richiedono il piano **Growth** o superiore, e la **Lista IP consentiti** di un modulo richiede **Scale**, sia che venga impostata alla creazione del modulo sia che venga modificata in seguito. I link di un progetto sotto il piano **Growth**, o con l'abbonamento non pagato, mostrano il messaggio di non disponibilità, e non viene creato nulla.

## I moduli tramite l'API

I moduli sono una normale risorsa API in `/api/form`, e i loro invii in `/api/form-submission`, che puoi leggere ed eliminare ma non creare né modificare. Il [riferimento API](/reference) contiene la forma completa di richieste e risposte.

### Domande e impostazioni

Le domande di un modulo sono la sua colonna `fields`, un elenco JSON nell'ordine in cui il modulo le pone, e le sue impostazioni All'invio sono i suoi `targetSettings`:

```json
{
  "data": {
    "targetType": "Incident",
    "fields": [
      {
        "id": "what",
        "source": "TargetField",
        "targetField": "title",
        "label": "What is wrong?",
        "isRequired": true
      },
      {
        "id": "office",
        "source": "Question",
        "type": "Dropdown",
        "label": "Which office are you in?",
        "dropdownOptions": "Berlin\nLondon",
        "isRequired": false
      },
      {
        "id": "email",
        "source": "Submitter",
        "submitterField": "Email",
        "label": "Your Email",
        "isRequired": true
      }
    ],
    "targetSettings": {
      "incidentSeverityId": "<severity-id>",
      "labelIds": ["<label-id>"]
    }
  }
}
```

Ogni domanda ha un proprio `id` (lettere, cifre, `-` e `_`), una `source`, un `label`, e facoltativamente `helpText` e `isRequired`:

| `source` | Cosa chiede |
| --- | --- |
| `Question` | Una domanda propria del modulo, a cui si risponde secondo il `type`: `Text`, `LongText`, `Markdown`, `Number`, `Dropdown`, `MultiSelectDropdown`, `Boolean`, `Date` o `DateTime`. Un menu a discesa elenca le sue `dropdownOptions`, una per riga. |
| `TargetField` | Un campo di ciò che il modulo crea, indicato da `targetField`: `title`, `description`, `incidentSeverityId`, `monitors`, `labels` e `impactStartedAt` per un incidente; `title`, `description`, `startsAt`, `endsAt`, `monitors`, `statusPages` e `labels` per un evento di manutenzione. Un campo a cui si risponde scegliendo elenca i record che offre in `allowedOptionIds`. |
| `TargetCustomField` | Uno dei campi personalizzati dell'incidente o dell'evento, indicato da `customFieldId`. |
| `Submitter` | Il `Name` o l'`Email` di chi invia, indicato da `submitterField`. |

Una domanda con `isHidden` impostato su `true` non viene mostrata nella pagina pubblica, non è mai obbligatoria e riceve risposta solo dal modello indicato da un invio, a meno che quel modello non la ponga. `isRequired` e `isHidden` sono il valore predefinito del modulo; ogni modello può porre una domanda a modo suo.

### I modelli nell'API

I modelli di un modulo sono la sua colonna `templates`, un elenco JSON nell'ordine in cui il modulo li elenca. Ogni modello ha un proprio `id` (lettere, cifre, `-` e `_`), un `name` di massimo 100 caratteri, univoco nel modulo, e `answers` indicizzate per id della domanda, ognuna come la invia un invio: testo, un numero, `true` o `false`, il valore di un'opzione o un elenco di valori per una selezione multipla. `isDefault` impostato su `true` lo rende il modello con cui il modulo si apre; un modulo ne ha al massimo uno, e fino a 50 modelli.

`fieldSettings`, anch'esso indicizzato per id della domanda, dice come il modello pone una domanda: `Required`, `Optional` o `Hidden`. Una domanda che non elenca (o che elenca come `null`) viene posta come la pone il modulo, e le domande `startsAt` ed `endsAt` di un evento di manutenzione possono essere solo `Required`:

```json
{
  "data": {
    "templates": [
      {
        "id": "outage",
        "name": "Application Outage",
        "isDefault": true,
        "answers": {
          "what": "The application is down",
          "office": "Berlin"
        },
        "fieldSettings": {
          "office": "Required",
          "email": "Optional"
        }
      }
    ]
  }
}
```

Domande, modelli e impostazioni vengono controllati a ogni salvataggio (dalla dashboard, dall'API, da Terraform o da un workflow), e un elenco che viola una regola viene rifiutato con un messaggio che indica cosa non va. `shareKey`, la chiave nel link del modulo, viene impostata da OneUptime alla creazione del modulo, e cambiarla è ciò che fa **Reimposta link**.

### Il branding nell'API

Il branding di un modulo sono i suoi `logoFileId`, `logoAltText` e `faviconFileId`. Carica prima l'immagine con `POST /api/file`, nel progetto del modulo (con una chiave API di quel progetto, oppure con l'accesso come membro e il suo id nell'intestazione `tenantid`), inviando il suo `name`, il suo `fileType`, per esempio `image/png`, e i byte in base64 in `file`, e imposta l'`_id` che restituisce. Un caricamento in un progetto di cui non sei membro viene rifiutato con "You can upload files only to a project you are a member of." Ogni caricamento è privato: `isPublic` lo imposta OneUptime, qualunque cosa dica la richiesta. Ogni immagine viene controllata al salvataggio del modulo: deve essere stata caricata nel progetto del modulo, e un logo deve essere un'immagine PNG, JPEG, GIF, WebP o SVG di al massimo 512 KB, una favicon una di queste o un ICO di al massimo 128 KB. Imposta un id su `null` per tornare a quelli di OneUptime. Vedi [Branding](/docs/forms/building#branding).

### Leggere gli invii

Per elencare gli invii di un modulo:

```bash
curl -X POST https://oneuptime.com/api/form-submission/get-list \
  -H "apikey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": { "formId": "<form-id>" },
    "select": { "submitterName": true, "submitterEmail": true, "answers": true, "incidentId": true, "scheduledMaintenanceId": true, "createdAt": true },
    "limit": 50,
    "skip": 0
  }'
```

### Workflow

I moduli hanno i componenti di workflow generati: **On Create Form**, **On Update Form** e così via. Per agire su ciò che un modulo ha creato, usa **On Create Incident** o **On Create Scheduled Maintenance**.

### Gli endpoint propri della pagina pubblica

La pagina pubblica comunica con due route che non richiedono una chiave API: `GET /api/form/public/<shareKey>`, che restituisce il nome, la descrizione e le domande del modulo (e il suo logo, il testo alternativo del logo e la sua favicon, le immagini in base64, quando li ha, e i suoi modelli, con le loro risposte alle domande che la pagina pone), e `POST /api/form/public/<shareKey>/submit`, che lo invia indicando in `templateId` il modello da cui chi invia è partito. Sono gli endpoint propri della pagina, non un'API su cui costruire: ogni chiamata passa per le protezioni del modulo (vedi [Condivisione e sicurezza](/docs/forms/sharing-and-security)) e cambiano insieme alla pagina. Per creare incidenti dal tuo codice, usa `POST /api/incident` con una chiave API: vedi [Dichiarare un incidente](/docs/incidents/declaring-incidents).

## Dove sono finiti i tuoi moduli di incidente

I moduli sostituiscono gli **Incident Forms** che si trovavano in **Incidenti → Impostazioni → Moduli**. Ogni modulo di incidente è stato trasferito con l'aggiornamento, con lo stesso link e gli stessi invii:

- Le sue domande sono diventate quelle dell'editor: il titolo, la descrizione se non era nascosta, la gravità quando chi inviava poteva sceglierla, ogni campo personalizzato che chiedeva (nell'ordine dei campi personalizzati), e **Your Name** e **Your Email**, obbligatori a meno che il modulo non consentisse segnalazioni anonime.
- La sua gravità e il suo modello di incidente sono diventati i suoi valori predefiniti **All'invio**.
- Il suo interruttore **Abilitato**, il messaggio di conferma e la **Lista IP consentiti** sono invariati, così come il suo link: i vecchi link `/accounts/incident-form/<share-key>` aprono il modulo al suo nuovo indirizzo.
- Le autorizzazioni **Incident Form** sono diventate le autorizzazioni **Form**, per ogni team e chiave API che le aveva.

Le vecchie pagine della dashboard reindirizzano a quelle nuove.

## Passaggi successivi

:::cards
- [Creare un modulo](/docs/forms/building): Domande, tipi di risposta, campi collegati, campi personalizzati e l'anteprima.
- [Cosa crea un invio](/docs/forms/on-submit): Come le risposte e le impostazioni All'invio diventano un incidente o un evento di manutenzione.
- [Condivisione e sicurezza](/docs/forms/sharing-and-security): Il link, la lista degli IP consentiti, i limiti di frequenza, il captcha e la risoluzione dei problemi.
- [Dichiarare un incidente](/docs/incidents/declaring-incidents): Gli altri modi di dichiarare gli incidenti.
:::
