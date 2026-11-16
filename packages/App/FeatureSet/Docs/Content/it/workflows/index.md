# Panoramica dei flussi di lavoro

I flussi di lavoro automatizzano il lavoro in OneUptime senza codice. Metti dei blocchi su una tela, li colleghi, e il flusso di lavoro parte da solo ogni volta che scatta il suo trigger: viene creato un incidente, arriva l'ora di una pianificazione, un altro strumento chiama un URL o arriva un'email. Usali per collegare OneUptime al resto del tuo stack e per occuparti dei passaggi di routine mentre lavori al problema vero e proprio. Per scegliere tra un flusso di lavoro, un runbook, un playbook e una regola IA, vedi [Quale usare?](/docs/introduction/which-one#flussi-di-lavoro-runbook-playbook-o-regola-ia).

:::cards
- [Creare un flusso di lavoro](/docs/workflows/authoring): Crea un flusso di lavoro, poi aggiungi, collega e configura i suoi blocchi sulla tela.
- [Trigger](/docs/workflows/triggers): Avvia un flusso di lavoro a mano, con una pianificazione, da un webhook, da un'email o da un evento di OneUptime.
- [Componenti](/docs/workflows/components): Tutti i blocchi che puoi aggiungere, dalle chiamate API ai record di OneUptime.
- [Esecuzioni](/docs/workflows/runs-and-logs): Guarda cosa ha fatto ogni esecuzione, passo per passo.
:::

## Come funziona un flusso di lavoro

Ogni flusso di lavoro ha tre parti:

1. **Un trigger** — ciò che avvia il flusso di lavoro: un'esecuzione manuale, una pianificazione, una chiamata a un webhook, un'email in arrivo o un evento in OneUptime, come un nuovo incidente. Ogni flusso di lavoro ne ha esattamente uno.
2. **I componenti** — ciò che fa il flusso di lavoro: inviare un messaggio, chiamare un'API, verificare una condizione, creare o aggiornare un record di OneUptime.
3. **I collegamenti** — le linee che tracci da un blocco al successivo. Decidono cosa viene eseguito dopo cosa.

Quando scatta il trigger, OneUptime avvia un'**esecuzione**. Ogni blocco termina prendendo una delle sue uscite, ad esempio **Successo** o **Errore**, **Sì** o **No**, e vengono eseguiti solo i blocchi collegati a quell'uscita. Se all'uscita presa da un blocco non è collegato nessun blocco, quel percorso finisce lì. L'esecuzione viene salvata con il suo stato, il percorso seguito e ciò che ogni blocco ha ricevuto e restituito.

```mermaid title="Cosa succede quando un flusso di lavoro viene eseguito"
flowchart TB
    subgraph starts["Cosa avvia un'esecuzione"]
        direction LR
        manual["Esegui flusso di lavoro"]
        schedule["Pianificazione"]
        webhook["Chiamata al webhook"]
        email["Email in arrivo"]
        event["Evento di OneUptime"]
    end
    starts --> trigger["Blocco trigger"]
    trigger --> wired{"Uscita collegata a un blocco?"}
    wired -->|"Sì"| block["Quel blocco viene eseguito"]
    block -->|"prende una delle sue uscite"| wired
    wired -->|"No"| saved["Esecuzione salvata con i suoi passaggi e il registro"]
```

Costruisci tutto questo in modo visivo, su una tela. La maggior parte dei flussi di lavoro non richiede codice; quando serve, un blocco **Esegui JavaScript personalizzato** esegue qualche riga di JavaScript.

## Cosa puoi fare con i flussi di lavoro

- **Collegare OneUptime agli altri tuoi strumenti** — pubblicare su Slack, Microsoft Teams, Discord, Telegram, IRC o Mattermost, creare ticket Jira o inviare una richiesta a qualsiasi API del tuo stack.
- **Reagire a ciò che succede in OneUptime** — quando viene creato un incidente, avvisare il canale giusto e aprire automaticamente un ticket.
- **Eseguire lavori a intervalli regolari** — ogni cinque minuti, ogni notte, ogni lunedì mattina.
- **Ricevere dati dall'esterno** — lasciare che altri sistemi avviino un flusso di lavoro chiamando il suo URL o scrivendo al suo indirizzo email.
- **Riutilizzare automazioni comuni** — costruiscila una volta e avviala da qualsiasi altro flusso di lavoro con un blocco **Esegui un altro flusso di lavoro**.

## Termini chiave

Le parole usate in tutto OneUptime sono nel [Glossario](/docs/introduction/glossary).

| Termine                | Cosa significa                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Flusso di lavoro**           | L'intera automazione: un nome, una tela di blocchi e un interruttore per attivarla o disattivarla.                 |
| **Trigger**            | Il primo blocco. Decide quando viene eseguito il flusso di lavoro. Ogni flusso di lavoro ne ha esattamente uno.                    |
| **Componente**         | Qualsiasi altro blocco: invia un messaggio, fa una richiesta, verifica una condizione o modifica un record.        |
| **Uscita**             | Un punto sul fondo di un blocco, come **Successo** o **Errore**. Le linee che partono da lì portano ai blocchi successivi. |
| **Esecuzione**         | Un'esecuzione del flusso di lavoro, salvata con il suo stato, gli orari e ciò che ha fatto ogni blocco.                    |
| **Variabile globale**  | Un valore, come una chiave API, che salvi una volta e usi in qualsiasi flusso di lavoro del progetto.                      |

## Prima di iniziare

- **Un piano che includa i flussi di lavoro.** Su OneUptime Cloud i flussi di lavoro richiedono il piano **Growth** o superiore, e ogni piano consente un certo numero di esecuzioni ogni 30 giorni — vedi [Limiti di piano](/docs/workflows/configuration#limiti-di-piano). Le installazioni self-hosted senza fatturazione non hanno nessuno dei due limiti.
- **Il permesso di costruire.** Creare e modificare i flussi di lavoro richiede **Amministratore dei flussi di lavoro**, **Amministratore del progetto** o **Proprietario del progetto**, oppure un ruolo personalizzato con i permessi corrispondenti. Un **Membro dei flussi di lavoro** può aprire i flussi di lavoro ed eseguirli a mano, ma non modificarli. Vedi [Autorizzazioni](/docs/workflows/configuration#autorizzazioni).

## Dove trovare i flussi di lavoro in OneUptime

Apri **Prodotti** nella barra in alto e scegli **Flussi di lavoro**, in **Dashboard e automazione**. Il suo menu contiene:

- **Flussi di lavoro** — l'elenco dei tuoi flussi di lavoro. Creane uno nuovo o aprine uno esistente.
- **Variabili globali** — i valori condivisi da tutti i tuoi flussi di lavoro.
- **Log → Esecuzioni** — la cronologia delle esecuzioni di tutti i flussi di lavoro del progetto.
- **Impostazioni → Regole etichette** e **Regole del proprietario** — assegna automaticamente etichette e proprietari ai nuovi flussi di lavoro.
- **Avanzato → Archiviato** — i flussi di lavoro che hai archiviato. Non vengono mai eseguiti e non compaiono nell'elenco; da qui puoi ripristinarli. Vedi [Archiviare un flusso di lavoro](/docs/workflows/configuration#archiviare-un-flusso-di-lavoro).
- **Sviluppatori** — come gestire i flussi di lavoro con Terraform, l'API o un assistente IA.

Apri un singolo flusso di lavoro e il suo menu contiene:

- **Panoramica** — nome, descrizione, etichette e l'interruttore **Abilitato**.
- **Costruttore** — la tela su cui progetti il flusso di lavoro, con l'interruttore **Abilitato** in alto.
- **Variabili del flusso** — i valori che valgono solo per questo flusso di lavoro.
- **Log → Esecuzioni** — ogni esecuzione di questo flusso di lavoro, con i dettagli.
- **Proprietari** — le persone e i team responsabili del flusso di lavoro.
- **Sviluppatori** — come gestire questo flusso di lavoro con Terraform, l'API o un assistente IA.
- **Impostazioni** — duplicare, esportare e archiviare.

**Impostazioni** si trova nella sezione **Avanzato** del menu, insieme a **Log di audit** ed **Elimina flusso di lavoro**. **Avanzato** e **Sviluppatori** partono chiuse, in questo menu come in tutti gli altri, così le pagine che usi ogni giorno vengono per prime. Fai clic sul nome di una sezione per mostrarne le pagine. Si apre da sola quando ti trovi su una di esse.

## Costruisci il tuo primo flusso di lavoro

Ogni flusso di lavoro si costruisce allo stesso modo:

:::steps
1. **Crea** — scegli un punto di partenza, poi dai un nome al flusso di lavoro. Vedi [Creare un flusso di lavoro](/docs/workflows/authoring).
2. **Scegli un trigger** — manuale, pianificato, webhook, email in arrivo o un evento di OneUptime. Vedi [Trigger](/docs/workflows/triggers).
3. **Aggiungi componenti** — aggiungi azioni alla tela e collegale. Vedi [Componenti](/docs/workflows/components).
4. **Provalo** — fai clic su **Esegui flusso di lavoro** nel **Costruttore** e segui l'esecuzione mentre avviene. Funziona anche mentre il flusso di lavoro è ancora disattivato: è un'**Esecuzione di prova**.
5. **Attivalo** — attiva **Abilitato** in cima al **Costruttore** quando è pronto. Da quel momento lo avvia il suo trigger.
:::

L'esempio qui sotto segue questi passaggi per un flusso di lavoro reale.

## Esempio: inviare i nuovi incidenti a un webhook

Questo flusso di lavoro invia un riepilogo JSON di ogni nuovo incidente a un tuo URL — un sistema di ticketing, un data warehouse, qualsiasi cosa accetti un webhook — e scrive il motivo nel log dell'esecuzione quando la richiesta non va a buon fine.

```mermaid title="L'esempio completo"
flowchart TB
    trigger["Alla creazione: Incidente"] -->|"Successo"| post["Chiamata API POST (JSON)"]
    post -->|"Errore"| log["Log"]
    post -->|"Successo"| done["L'esecuzione termina"]
```

> [!TIP]
> Il modello **Forward new incidents to another system** costruisce per te questo flusso di lavoro, senza il blocco Log: senza nulla su **Errore**, una richiesta che fallisce fa fallire l'esecuzione, e i **Passaggi** dell'esecuzione dicono perché. Lo trovi in **Incidenti** quando crei un flusso di lavoro.

:::steps
### Crea il flusso di lavoro

Apri **Flussi di lavoro** e fai clic su **Crea flusso di lavoro**. Fai clic su **Parti da zero**, chiama il flusso di lavoro `Send new incidents to a webhook` e fai clic su **Crea flusso di lavoro**.

Il nuovo flusso di lavoro si apre nel **Costruttore**, disattivato.

### Aggiungi il trigger

Fai clic sul blocco tratteggiato **Scegli cosa avvia questo flusso di lavoro**, poi su **Alla creazione: Incidente** sotto **Popolari** nel pannello **Aggiungi trigger**.

Il trigger prende il posto del blocco tratteggiato. L'ID che compare su di esso, `incident-on-create-1`, è il modo in cui i blocchi successivi vi fanno riferimento.

### Scegli i campi dell'incidente

Fai clic sul trigger. **Campi da passare** parte con il titolo: fai clic su **Aggiungi campo**, seleziona la descrizione e ogni altro campo che la richiesta deve contenere, e fai clic su **Salva**.

Il trigger passa il nuovo incidente con quei campi. Un campo che non selezioni arriva vuoto.

### Aggiungi il blocco API

Fai clic su **Aggiungi componente**, poi su **Chiamata API POST (JSON)** sotto **Popolari**. Trascina dal punto **Successo** del trigger fino al punto superiore del nuovo blocco.

### Compila la richiesta

Fai clic sul blocco API, che mostra **Click to set up**. Inserisci il tuo endpoint in **URL**. In **Corpo della Richiesta**, scrivi il JSON da inviare, usando **{ }** per inserire i campi dell'incidente dove servono, e fai clic su **Salva**.

```json title="Request Body"
{
  "id": "{{local.components.incident-on-create-1.returnValues.model._id}}",
  "title": "{{local.components.incident-on-create-1.returnValues.model.title}}",
  "description": "{{local.components.incident-on-create-1.returnValues.model.description}}"
}
```

Ogni riferimento `{{…}}` viene sostituito con il valore dell'incidente quando il flusso di lavoro viene eseguito. Vedi [Variabili](/docs/workflows/variables) per la sintassi.

### Intercetta gli errori

Fai clic su **Aggiungi componente**, poi su **Log**. Collega a esso il punto **Errore** del blocco API, poi imposta il **Valore** del blocco Log su `Could not send the incident: {{local.components.api-post-1.returnValues.error}}`.

Una richiesta che non va a buon fine — un URL irraggiungibile o una risposta che non è 2xx — ora prende questo percorso, e il log dell'esecuzione dice perché.

### Provalo

Fai clic su **Esegui flusso di lavoro** e scegli un incidente di questo progetto sotto **Incidente**: sono elencati i più recenti, e digitando il suo numero o parte del suo titolo ne trovi un altro. Fai clic su **Esegui manualmente il flusso di lavoro** e conferma con **Esegui**. Il flusso di lavoro è ancora disattivato, quindi è un'**Esecuzione di prova**, e la richiesta viene inviata davvero.

Si apre un pannello **Esecuzione del flusso di lavoro** che segue l'esecuzione. Apri il passaggio **Chiamata API POST (JSON)** per vedere il corpo che ha inviato e la risposta che ha ricevuto.

### Attivalo

Attiva **Abilitato** in cima al **Costruttore**.
:::

Da ora in poi, ogni nuovo incidente del progetto avvia un'esecuzione. Le trovi tutte nelle [Esecuzioni](/docs/workflows/runs-and-logs) del flusso di lavoro.

> [!NOTE]
> La richiesta parte da OneUptime. Su OneUptime Cloud, l'URL deve essere raggiungibile da internet. Un'installazione self-hosted rifiuta gli indirizzi di rete privata a meno che un amministratore non li consenta — vedi [Accesso alla rete in uscita](/docs/workflows/configuration#accesso-alla-rete-in-uscita).

## Come si inseriscono i flussi di lavoro nel resto di OneUptime

- I **monitor** individuano il problema. Gli **incidenti** e gli **avvisi** lo registrano. I **flussi di lavoro** reagiscono.
- I **runbook** sono procedure di risposta che il tuo team segue durante un incidente, un avviso o un evento di manutenzione: passaggi manuali, approvazioni e script, con persone coinvolte. I flussi di lavoro girano senza supervisione. Usa un [runbook](/docs/runbooks/index) quando una persona deve prendere decisioni lungo il percorso, e un flusso di lavoro quando ogni passaggio è automatico.
- Le **connessioni dell'area di lavoro** collegano un progetto a Slack e Microsoft Teams per i canali degli incidenti e le notifiche. I blocchi Slack e Microsoft Teams dei flussi di lavoro non le usano: ogni blocco pubblica tramite un proprio URL di webhook in entrata.

## Prossimi passi

:::cards
- [Creare un flusso di lavoro](/docs/workflows/authoring): Lavora con la tela, i blocchi e le loro impostazioni.
- [Variabili](/docs/workflows/variables): Passa dati tra i blocchi e tieni i segreti fuori dai tuoi flussi di lavoro.
- [Configurazione e sicurezza](/docs/workflows/configuration): Autorizzazioni, limiti e sicurezza prima di andare in produzione.
:::
