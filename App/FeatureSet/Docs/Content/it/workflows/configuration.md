# Configurazione e sicurezza

Questa pagina raccoglie le impostazioni e i limiti di sicurezza che vale la pena conoscere prima di puntare un workflow sul traffico reale.

## Attivare o disattivare un workflow

Ogni workflow ha un interruttore **Enabled** in **Settings**. Quando e disattivato, il workflow non viene eseguito — le chiamate webhook, gli orari pianificati e gli eventi OneUptime vengono tutti ignorati. I nuovi workflow partono disabilitati.

Usa questo interruttore come tuo punto di "pronto per partire":

1. Costruisci il workflow.
2. Clicca su **Run Manually** con un payload realistico.
3. Controlla i **Logs** — verifica che ogni blocco abbia seguito il percorso atteso.
4. Sposta **Enabled** su attivo.

Disattivare un workflow non interrompe le esecuzioni gia in corso; impedisce solo l'avvio di nuove esecuzioni.

## Proprietari ed etichette

- **Proprietari** — utenti e team elencati come proprietari ottengono l'accesso al workflow e possono scegliere di ricevere notifiche quando fallisce. Impostali sotto **Settings → Owners**.
- **Etichette** — tag per raggruppare i workflow. L'elenco dei workflow ti permette di filtrare per etichetta, il che rende molto piu navigabile un progetto affollato. Utile quando hai workflow organizzati per team, integrazione o ambiente.
- **Regole sulle etichette** — sotto **Workflows → Settings → Label Rules**, applica automaticamente etichette ai nuovi workflow in base a schemi di nome o descrizione.
- **Regole sui proprietari** — sotto **Workflows → Settings → Owner Rules**, assegna automaticamente i proprietari ai nuovi workflow.

## Segreti

Contrassegna una variabile globale come **secret** se contiene qualcosa di sensibile. Il valore viene cifrato, nascosto nell'interfaccia dopo il salvataggio e nei log delle esecuzioni (mostrato come `[REDACTED]`).

Usa variabili segrete per:

- Chiavi API per servizi esterni.
- Token di autenticazione.
- Chiavi di firma webhook.
- Qualsiasi cosa che non vorresti far vedere a chi ha accesso in sola lettura.

Non incollare un segreto direttamente in un blocco — valori come `Authorization: Bearer eyJh...` finirebbero visibili nel workflow e nei log. Usa invece `{{variable.MY_SECRET}}`.

## Quanto puo durare un'esecuzione

Ogni esecuzione ha una durata massima. Se non si conclude in tempo, viene contrassegnata come **Timeout** e il blocco in corso viene annullato. Il valore predefinito e generoso — sufficiente per le normali chiamate HTTP e catene di blocchi.

Anche i singoli blocchi hanno i propri limiti di tempo al loro interno — per esempio, un blocco API si arrende su una richiesta in uscita bloccata ben prima che lo faccia l'intera esecuzione.

## Limite sulle chiamate ad altri workflow

Il componente **Execute Workflow** permette a un workflow di chiamarne un altro. Per evitare cicli accidentali in cui il workflow A chiama B, che chiama di nuovo A, c'e un limite alla profondita della catena. Un'esecuzione che supera il limite termina con un errore chiaro.

Se hai una vera necessita di una catena lunga (come un job che elabora un elemento per esecuzione), di solito e piu semplice fare un ciclo all'interno di un singolo workflow usando **Custom Code**.

## Sicurezza dei webhook

I trigger webhook ti forniscono un URL univoco. Chiunque lo conosca puo invocarlo. Per proteggerti da chiamanti accidentali o indesiderati:

- Tratta l'URL come una password. Non condividerlo pubblicamente e non commitarlo in un repository pubblico.
- Per workflow sensibili, chiedi al sistema chiamante di inviare un token condiviso come header (per esempio `X-Webhook-Token`) e verificalo con un blocco **Conditions** prima di fare qualcosa di importante. Salva il token atteso come variabile segreta.
- Per workflow molto sensibili, preferisci un trigger su evento di OneUptime con un passaggio di import manuale invece di un webhook pubblico.

## Accesso di rete in uscita

I blocchi API e gli altri blocchi HTTP effettuano le proprie richieste da OneUptime. Se utilizzi un'installazione self-hosted, assicurati che la tua installazione possa raggiungere i servizi che chiami. Se utilizzi OneUptime Cloud, gli intervalli IP in uscita sono elencati in [Indirizzi IP](/docs/configuration/ip-addresses) in modo che tu possa autorizzarli dall'altro lato.

## Permessi

I workflow rispettano il controllo accessi basato sui ruoli del tuo progetto. I permessi rilevanti:

- **Create / Read / Edit / Delete Workflow** — i permessi di base sul workflow stesso.
- **Run Workflow** — necessario per cliccare **Run Manually** o per attivare un workflow tramite API.
- **Read Workflow Log** — necessario per visualizzare le esecuzioni.
- **Read / Create / Edit / Delete Workflow Variable** — controllo sull'elenco delle variabili globali.

La maggior parte degli ingegneri dovrebbe avere create/edit/read sui workflow ma non sulle variabili. Riserva l'accesso in modifica alle variabili alle persone che gestiscono i segreti del tuo progetto.

## Limiti di piano

OneUptime Cloud limita il numero di esecuzioni mensili sui piani piu piccoli. Il tuo limite attuale e mostrato sotto **Project Settings → Billing**. Quando lo raggiungi, i nuovi trigger vengono rifiutati fino al ciclo di fatturazione successivo. Le installazioni self-hosted non hanno questo limite.

## Quando i workflow non sono lo strumento giusto

Alcuni casi in cui dovresti scegliere qualcos'altro:

- **Calcoli pesanti o dataset grandi** — i workflow sono pensati per lavori di collegamento leggeri, non per elaborazioni intensive. Esegui il lavoro pesante nella tua infrastruttura e lascia che un workflow lo avvii.
- **Processi di lunga durata che si estendono per ore** — una singola esecuzione e pensata per concludersi rapidamente. Se devi "fare A, attendere due ore, fare B," usa uno scheduler esterno che invii un webhook a OneUptime quando e il momento.
- **Risposta agli incidenti passo passo con persone coinvolte** — per quello esistono i [Runbook](/docs/runbooks/index). I workflow sono per automazione non presidiata.

## Letture successive

- [Panoramica dei workflow](/docs/workflows/index) — il quadro generale.
- [Componenti](/docs/workflows/components) — riferimento blocco per blocco.
- [Runbook](/docs/runbooks/index) — quando usare un runbook al posto di un workflow.
