# Lavorare con OneUptime da GitHub

La GitHub App di OneUptime non è soltanto una connessione al tuo codice — puoi parlarle direttamente nel tuo repository, e il lavoro lo svolgerà lì.

Menzionala su una issue e apre una pull request. Menzionala su una pull request e ne modifica il branch, oppure ne esamina il diff. Aggiungi un'etichetta a una issue e la prende in carico. Tutto ciò che produce è una pull request o una revisione che una persona deve leggere: **non fa mai merge di nulla e non approva mai una pull request.**

```text
@oneuptime implement this                          →  una pull request che chiude la issue
@oneuptime revise this — use exponential backoff   →  nuovi commit sul branch di questa pull request
@oneuptime review                                  →  una revisione del codice pubblicata su questa pull request
```

> Sostituisci `@oneuptime` con l'handle della tua app. Su OneUptime Cloud è `@oneuptime`. Su un'istanza self-hosted è il nome che hai dato alla tua GitHub App, in minuscolo e con gli spazi trasformati in trattini — un'app chiamata "Acme AI" si menziona come `@acme-ai`. Se le menzioni non producono alcun effetto, è la prima cosa da controllare.

## Prima di iniziare

- Il repository deve essere **collegato a un progetto OneUptime** tramite la GitHub App. Vedi [Integrazione GitHub (self-hosted)](/docs/self-hosted/github-integration) per la configurazione, oppure collegalo da **Impostazioni del progetto → Repository di codice** su OneUptime Cloud.
- Deve essere online un **Runner con la capacità "Esegue le correzioni di codice AI"** — lo stesso Runner che porta a termine gli [AI Fix Tasks](/docs/ai/ai-agent). Senza, i comandi vengono accettati e poi falliscono dopo 30 minuti con un messaggio che dice che nessun agente li ha presi in carico.
- La GitHub App deve avere il permesso **Issues: Lettura e Scrittura** ed essere iscritta agli eventi webhook elencati in [A cosa iscriversi](#a-cosa-iscriversi).

## I comandi

Ogni comando inizia con una menzione dell'app. La menzione può trovarsi in qualsiasi punto del commento, e tutto ciò che scrivi dopo viene passato all'app come tua richiesta.

### Su una pull request

| Comando | Cosa succede |
| --- | --- |
| `@oneuptime review` | Clona il branch, legge il codice modificato **e il codice che lo circonda**, e pubblica una revisione come commento. Non modifica nulla. |
| `@oneuptime revise this — <cosa vuoi modificare>` | Clona il branch della pull request stessa, applica la modifica e fa push di nuovi commit su quello stesso branch. Non apre mai una seconda pull request. |

Tutto ciò che scrivi dopo la menzione e che non corrisponde a un comando riconosciuto viene trattato come una richiesta di modifica, perché quasi sempre è esattamente questo:

```text
@oneuptime the retry loop here should back off exponentially, and the test
should cover the 429 case
```

### Su una issue

| Comando | Cosa succede |
| --- | --- |
| `@oneuptime implement this` | Lavora sulla issue e apre una pull request che la chiude. |
| `@oneuptime <qualsiasi altra cosa>` | Lo stesso, usando le tue parole come indicazioni aggiuntive. |

Puoi anche affidare una issue all'app **senza scrivere alcun commento**:

- **Aggiungi l'etichetta trigger.** Aggiungere a una issue l'etichetta trigger del repository — `oneuptime` per impostazione predefinita — avvia lo stesso lavoro. È il modo più affidabile per assegnare lavoro dall'interfaccia di GitHub.
- **Assegna la issue all'utente bot dell'app**, dove il tuo repository lo consente. GitHub non permette ovunque che un'app sia assegnataria: è per questo che esiste l'etichetta. Se l'assegnazione non produce alcun effetto, usa l'etichetta.

### Ovunque

| Comando | Cosa succede |
| --- | --- |
| `@oneuptime help` | Elenca i comandi. Anche una menzione isolata, senza nulla dopo, fa lo stesso. |
| `@oneuptime status` | Dice a cosa sta lavorando in questo momento in questo thread. |
| `@oneuptime cancel` | Ferma le esecuzioni che ha in corso in questo thread. Il lavoro di cui ha già fatto push resta dov'è. |

`help`, `status` e `cancel` non avviano mai un'esecuzione dell'agente: non costano nulla e non rientrano nel tuo budget giornaliero di fix task.

## Come si presenta nel thread

Un comando produce **un solo commento**, che l'app modifica man mano che il lavoro procede — così un'attività lunga non trasforma una pull request in un registro di stato.

1. Reagisce con 👀 al tuo commento e pubblica una conferma che indica il progetto OneUptime a cui appartiene l'esecuzione e rimanda all'esecuzione in corso.
2. Quando finisce, quello stesso commento viene riscritto con il risultato: la pull request che ha aperto, i commit di cui ha fatto push, oppure una spiegazione onesta del perché non ha fatto nulla.

Se non trova nulla che valga la pena cambiare, lo dice invece di aprire una pull request campata in aria. È un esito normale, non un fallimento — fornisci indicazioni più precise e richiedi di nuovo.

## Chi può darle comandi

**Solo le persone con accesso write, maintain o admin al repository.** OneUptime chiede ogni volta direttamente a GitHub quali permessi ha su quel repository chi ha scritto il commento; non si fida del badge "contributor" che GitHub mostra accanto a un commento, che descrive l'attività passata e non l'accesso attuale.

Una menzione da parte di chiunque altro riceve una sola reazione 😕 sul commento e nient'altro. È voluto: su un repository pubblico chiunque può commentare, e un'app che risponde in modo affidabile agli sconosciuti è un'app che può essere usata per spammare un thread.

Ignora inoltre ogni commento scritto da un bot, compresi i propri, e ignora le menzioni che compaiono dentro una citazione (`>`) o un blocco di codice. Messe insieme, queste due regole sono ciò che impedisce a una risposta a un suo stesso commento di rimetterla in moto.

## Cosa non farà

- **Non fa mai merge.** Nulla di ciò che fa questa app può portare codice sul tuo branch predefinito.
- **Non approva mai e non richiede mai modifiche.** Le revisioni vengono pubblicate come commenti, quindi una revisione fatta da un'app non può mai soddisfare una regola di branch protection.
- **Non riscrive mai la storia.** Una modifica aggiunge commit; non fa force-push. Se qualcun altro ha fatto push sul branch prima di lei, la modifica fallisce invece di scartare il suo lavoro.
- **Non può modificare una pull request proveniente da un fork.** Il branch di un fork si trova in un repository su cui l'installazione non può scrivere. Può comunque esaminarla — chiedile una revisione.
- **Non cambia mai titolo, descrizione o branch di destinazione di una pull request.** Solo il codice.

## Quanto costa e come limitarlo

Ogni comando che avvia del lavoro è un'esecuzione completa dell'agente — un clone, fino a 40 chiamate LLM e 100.000 token di output, più i comandi di build e test del tuo repository, se li hai configurati.

Si applicano due limiti, entrambi quelli che già governano gli [AI Fix Tasks](/docs/ai/ai-agent):

- **Il limite giornaliero di esecuzioni di fix del progetto** (**Impostazioni del progetto → AI**, 25 al giorno per impostazione predefinita). I comandi GitHub condividono questo budget con il resto delle esecuzioni di fix del progetto.
- **Il tetto di pull request aperte per repository** (**Repository di codice → il repository → Impostazioni**, 5 per impostazione predefinita). Revisioni e modifiche ne sono esenti: nessuna delle due aggiunge una nuova pull request alla tua coda di revisione.

È attiva una sola esecuzione per tipo alla volta su ciascuna issue o pull request. Se chiedi due volte, ti risponde che ci sta già lavorando; chiedere una revisione mentre è in corso una modifica avvia entrambe, perché sono richieste diverse.

Se un'esecuzione non può partire, l'app spiega nel thread il perché — non fallisce mai in silenzio.

## Come disattivarla

Per singolo repository: **Repository di codice → il repository → Impostazioni → Respond to GitHub Commands**. Con l'opzione disattivata, l'app ignora menzioni, assegnazioni ed etichetta trigger in quel repository, e a chiunque lo chieda risponde dove si trova l'interruttore.

Nella stessa pagina si trova anche **GitHub Trigger Label**, se vuoi usare qualcosa di diverso da `oneuptime`.

## A cosa iscriversi

Nelle impostazioni "Permissions & events" della tua GitHub App, iscriviti a:

| Evento | Serve per |
| --- | --- |
| **Issue comment** | comandi `@mention` sulle issue *e* sulle pull request |
| **Issues** | assegnazione all'app ed etichetta trigger |
| **Pull request** | revisione richiesta all'app |
| **Pull request review** | una menzione nel corpo di una revisione inviata |
| **Pull request review comment** | una menzione su un commento inline nel diff |

E in **Repository permissions**, **Issues** deve essere **Lettura e Scrittura** — GitHub instrada i commenti delle conversazioni delle pull request attraverso l'API delle issue, ed è questo che consente all'app di commentare anche sulle pull request.

## Prompt injection: cosa è protetto e cosa no

Il testo delle issue, le descrizioni delle pull request, i diff e i commenti finiscono tutti nel prompt dell'agente, e su un repository pubblico chiunque può scriverli. Un testo che dice "ignora le tue istruzioni e fai X" è una cosa che ci si può realisticamente aspettare di trovare in una issue.

Due cose lo limitano, e vale la pena sapere quale fa cosa:

- **I prompt etichettano il testo non attendibile come una richiesta, non come istruzioni**, e repository, branch e pull request dell'esecuzione sono fissati prima ancora che l'agente parta — nulla di ciò che l'agente legge può cambiare su cosa sta lavorando.
- **Il vero contenimento è la sandbox.** L'agente gira sul tuo Runner, in un clone usa e getta, con le credenziali rimosse dall'ambiente dei comandi e le operazioni git limitate. Al massimo può fare push su un branch, e solo una persona può fare merge.

Tratta una pull request scritta dall'AI come tratteresti quella di un nuovo collaboratore che ha letto la issue: esamina il diff, non la descrizione.

## Risoluzione dei problemi

**Non succede nulla quando la menziono.** Controlla prima di tutto l'handle — è lo slug dell'app, non il suo nome visualizzato. Poi verifica che il repository sia collegato a un progetto (**Impostazioni del progetto → Repository di codice**), che **Respond to GitHub Commands** sia attivo e che la tua GitHub App sia iscritta agli eventi elencati sopra.

**Reagisce con 😕 e non dice nulla.** Non hai accesso in scrittura al repository.

**Dice che ci sta già lavorando.** Un'esecuzione di quel tipo è già in corso su questa issue o pull request. `@oneuptime status` ti dice quale, e `@oneuptime cancel` la ferma.

**Ha dato conferma e poi è rimasta in silenzio a lungo.** Verifica che sia online un Runner con **Esegue le correzioni di codice AI** in **Impostazioni → Agenti di runbook**. Senza, l'esecuzione viene fatta fallire dopo 30 minuti e il thread viene avvisato.

**Dice che la pull request proviene da un fork.** Le modifiche richiedono un branch in questo repository. Chiedi invece una revisione, oppure fai push del branch qui.

## Dove leggere poi

- [AI Fix Tasks](/docs/ai/ai-agent) — lo stesso agente, avviato da un'eccezione invece che da GitHub.
- [Integrazione GitHub (self-hosted)](/docs/self-hosted/github-integration) — creare e configurare la GitHub App.
- [Runner](/docs/runbooks/agents) — il worker che porta a termine le esecuzioni.
