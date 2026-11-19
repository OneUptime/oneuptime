# Configurazione e sicurezza del flusso di lavoro

Cosa sapere prima di mettere un flusso di lavoro davanti al traffico reale: come attivarlo in sicurezza, chi può fare cosa, come segreti e URL restano privati, cosa possono modificare i passaggi di un flusso di lavoro e i limiti entro cui lavora ogni esecuzione.

:::cards
- [Andare in produzione](#accendere-o-spegnere-un-flusso-di-lavoro): Prova con Esegui flusso di lavoro mentre è spento, poi accendilo.
- [Autorizzazioni](#autorizzazioni): I ruoli dei flussi di lavoro e i singoli permessi che li compongono.
- [Cosa possono fare i passaggi](#cosa-possono-fare-i-passaggi-di-un-flusso-di-lavoro): I passaggi agiscono come Amministratore del progetto nel progetto del flusso di lavoro.
- [Limiti](#limiti-di-piano): Esecuzioni per piano, durata di un'esecuzione e chiamate tra flussi di lavoro.
:::

## Accendere o spegnere un flusso di lavoro

Ogni flusso di lavoro ha un interruttore **Abilitato** in cima al suo **Costruttore** e nella sua pagina **Panoramica**. Quando è spento, il suo trigger è in pausa: chiamate webhook, email in arrivo, orari pianificati, eventi di OneUptime e i passaggi **Esegui un altro flusso di lavoro** di altri flussi di lavoro non lo avviano. **Esegui flusso di lavoro** e **Run just this step** invece sì: un'esecuzione che avvii tu stesso mentre il flusso di lavoro è spento è un'**Esecuzione di prova**. I nuovi flussi di lavoro partono disabilitati.

Usa questo interruttore come via libera per la produzione:

:::steps
1. Costruisci il flusso di lavoro.
2. Fai clic su **Esegui flusso di lavoro** nel **Costruttore** con valori realistici, mentre il flusso di lavoro è ancora spento. L'esecuzione è un'**Esecuzione di prova**: ogni blocco viene eseguito davvero, quindi puntalo prima su un canale di prova o su un record di prova.
3. Apri l'esecuzione e verifica che ogni blocco sia andato dove ti aspettavi. Vedi [Esecuzioni](/docs/workflows/runs-and-logs).
4. Accendi **Abilitato** quando è pronto: da quel momento, il suo trigger scatta sugli eventi reali.
:::

Spegnere un flusso di lavoro impedisce al suo trigger di avviare nuove esecuzioni. Un'esecuzione già in corso termina, ma un'esecuzione avviata dal suo trigger e in attesa su un blocco **Pausa** viene annullata al risveglio. Le esecuzioni di prova continuano. Per accenderne o spegnerne diversi insieme, selezionali nell'elenco **Flussi di lavoro** e scegli **Attiva** o **Disattiva** in **Azioni di massa**.

## Archiviare un flusso di lavoro

Archivia un flusso di lavoro che non ti serve più ma che vuoi conservare. Un flusso di lavoro archiviato:

- **Non viene mai eseguito**, da nessun trigger. Le esecuzioni manuali e **Run just this step**, le chiamate webhook, le pianificazioni, gli eventi di OneUptime, le email in arrivo e i passaggi **Esegui un altro flusso di lavoro** di altri flussi di lavoro vengono tutti rifiutati. Una chiamata webhook a un flusso di lavoro archiviato riceve un errore che dice che il flusso di lavoro è archiviato.
- **Ferma le esecuzioni in attesa.** Un'esecuzione in pausa in un passaggio **Pausa** viene annullata al risveglio, e un'esecuzione in coda non ancora avviata termina con "Workflow was archived before this run started, so it did not run."
- **Esce dall'elenco dei flussi di lavoro.** Lo trovi in **Flussi di lavoro → Avanzato → Archiviato**.
- **Conserva tutto.** I suoi passaggi, variabili, proprietari, etichette e la cronologia delle esecuzioni restano com'erano.

Per archiviare un flusso di lavoro, aprilo, vai in **Impostazioni** e fai clic su **Archivia**. Per archiviarne diversi, selezionali nell'elenco **Flussi di lavoro** e scegli **Archivia**.

Per recuperare un flusso di lavoro, apri **Flussi di lavoro → Avanzato → Archiviato**, selezionalo e scegli **Annulla archiviazione**, oppure aprilo e fai clic su **Annulla archiviazione** nel banner in cima alle sue pagine.

L'archiviazione e l'interruttore **Abilitato** sono indipendenti. Archiviare non tocca l'interruttore, quindi un flusso di lavoro che era acceso torna a essere eseguito appena viene ripristinato, e uno che era spento resta spento. La pagina **Archiviato** mostra qual è quale nella colonna **Annullata l'archiviazione**.

Un flusso di lavoro esportato non porta mai con sé lo stato di archiviazione, quindi una copia importata non è mai archiviata.

## Proprietari ed etichette

| Cosa                          | Dove                                                          | Cosa fa                                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Proprietari**               | La pagina **Proprietari** del flusso di lavoro                        | Gli utenti e i team responsabili del flusso di lavoro. Un ruolo limitato a ciò che possiede il proprio team raggiunge i flussi di lavoro di quel team.               |
| **Etichette**                 | La pagina **Panoramica** del flusso di lavoro                         | Etichette per raggruppare i flussi di lavoro, per team, integrazione o ambiente. Filtra l'elenco **Flussi di lavoro** per etichetta, e limita un ruolo ad alcune etichette. |
| **Regole etichette**          | **Flussi di lavoro → Impostazioni → Regole etichette**        | Etichetta automaticamente i nuovi flussi di lavoro in base a schemi nel nome o nella descrizione.                                                           |
| **Regole del proprietario**   | **Flussi di lavoro → Impostazioni → Regole del proprietario** | Assegna automaticamente i proprietari ai nuovi flussi di lavoro.                                                                                             |

Vedi [Regole di etichette e proprietari](/docs/configuration/label-and-owner-rules) per come corrispondono le regole.

## Segreti

Contrassegna una variabile come **segreta** se contiene qualcosa di sensibile: il suo valore viene allora eliminato dai log delle esecuzioni e dalle tracce dei passaggi. Il valore di nessuna variabile può essere riletto una volta salvato, segreta o no, né nella dashboard né tramite l'API, e una variabile diventata segreta resta segreta.

Usa le variabili segrete per:

- Chiavi API di servizi esterni.
- Token di autenticazione.
- Chiavi di firma dei webhook.
- Qualsiasi cosa che non vorresti far vedere a chi ha solo accesso in lettura.

Non incollare un segreto direttamente in un blocco: valori come `Authorization: Bearer eyJh...` finiscono visibili nel flusso di lavoro e nei log. Usa invece `{{global.variables.MY_SECRET}}`.

Se il segreto è un token di accesso OAuth che scade, trasforma la variabile in una [variabile OAuth 2.0](/docs/workflows/variables#variabili-oauth-20-token-che-si-rinnovano-da-soli). OneUptime recupera allora il token dal tuo provider di identità e lo rinnova ogni volta che un flusso di lavoro sta per usarne uno scaduto. Le variabili OAuth 2.0 sono sempre segrete, e le loro credenziali sono cifrate nel database.

## Esportare e importare i flussi di lavoro

Puoi spostare un flusso di lavoro tra progetti, o tra un'installazione self-hosted e OneUptime Cloud, come file JSON.

:::tabs
@tab Esportare
Apri il flusso di lavoro, vai in **Impostazioni** e fai clic su **Esporta: Flusso di lavoro**. Per mettere più flussi di lavoro in un unico file, selezionali nell'elenco **Flussi di lavoro** e scegli **Esporta JSON**.
@tab Importare
Nell'elenco **Flussi di lavoro**, fai clic su **Importa JSON** e scegli un file esportato da qualsiasi progetto OneUptime. Un flusso di lavoro il cui nome è già presente nel progetto viene importato con "(Imported)" dopo il nome.
:::

Il file contiene il nome del flusso di lavoro, la descrizione, lo stato di attivazione e il grafo. Volutamente non contiene:

- **La chiave segreta del webhook.** Quando il flusso di lavoro viene creato se ne genera una nuova, quindi un flusso di lavoro importato ha un URL di webhook diverso: copialo dal trigger Webhook del nuovo flusso di lavoro. Tutto ciò che chiamava l'originale va reindirizzato.
- **L'indirizzo email in arrivo.** Un flusso di lavoro importato con un trigger Email in arrivo riceve un indirizzo tutto suo: copialo dal trigger del nuovo flusso di lavoro. A tutto ciò che scriveva all'originale va dato il nuovo indirizzo.
- **Le variabili globali.** Un blocco che legge `{{global.variables.MY_SECRET}}` mantiene quel riferimento, ma il valore non è nel file. Crea le variabili nel progetto di destinazione prima di eseguire il flusso di lavoro importato.
- **I proprietari e le etichette.** Le regole di etichette e proprietari del tuo progetto si applicano al flusso di lavoro importato, come se lo avessi creato a mano.

Un flusso di lavoro importato viene sempre creato **disabilitato**, anche se era abilitato dove è stato esportato: il suo grafo può puntare a monitor, policy di reperibilità o altri flussi di lavoro che non esistono nel progetto di destinazione. Rivedilo, provalo con **Esegui flusso di lavoro** e poi accendilo. Duplicare un flusso di lavoro funziona allo stesso modo, così una copia non inizia mai a scattare accanto all'originale prima che tu l'abbia modificata.

Poiché il grafo viaggia così com'è, tutto ciò che è scritto direttamente in un blocco viaggia con esso. È il motivo pratico per tenere le credenziali in variabili segrete: esportare un flusso di lavoro con un token scritto a mano consegna quel token a chiunque riceva il file.

## Sicurezza dei webhook

I trigger webhook ti danno un URL univoco. Chiunque conosca l'URL può chiamarlo. Per proteggerti da chiamate accidentali o indesiderate:

- Tratta l'URL come una password. Non condividerlo pubblicamente e non inserirlo in un repository pubblico. Il trigger Webhook nasconde la chiave segreta dell'URL finché non fai clic su **Mostra**, e **Copia URL** copia l'URL senza mostrarlo.
- Se l'URL trapela, fai clic sul trigger Webhook nel **Costruttore** e poi su **Reimposta URL**. Il flusso di lavoro riceve un nuovo URL e quello vecchio smette subito di funzionare.
- Se il trigger dice che il suo URL termina con l'ID del flusso di lavoro, reimpostalo. I flussi di lavoro creati prima che gli URL di webhook avessero una propria chiave segreta usano invece l'ID del flusso di lavoro, che chiunque possa aprire il flusso di lavoro può vedere.
- Per i flussi di lavoro sensibili, chiedi al sistema chiamante di inviare un token condiviso in un header (come `X-Webhook-Token`) e verificalo con un blocco **Se / Altrimenti** prima di fare qualcosa di importante. Salva il token atteso come variabile segreta.
- Per i flussi di lavoro molto sensibili, preferisci un trigger di evento OneUptime e un passaggio di importazione manuale a un webhook pubblico.

Solo le persone che possono modificare il flusso di lavoro — **Proprietario del progetto**, **Amministratore del progetto**, **Amministratore dei flussi di lavoro** o **Edit Workflow** — possono vedere o reimpostare il suo URL di webhook. Chiunque abbia l'URL può avviare il flusso di lavoro da qualsiasi luogo, senza accedere, quindi tutti gli altri vedono una nota che dice a chi chiederlo. Questo include un **Membro dei flussi di lavoro**, che esegue il flusso di lavoro a mano dal **Costruttore**.

## Sicurezza delle email in arrivo

Il trigger Email in arrivo dà al flusso di lavoro un indirizzo tutto suo, e chiunque conosca l'indirizzo può scrivergli. La parte prima della `@` è la chiave segreta del flusso di lavoro, quindi tratta l'indirizzo come una password:

- Non pubblicarlo e non inserirlo in un repository pubblico. Il trigger nasconde la chiave finché non fai clic su **Mostra**, e **Copia indirizzo** copia l'indirizzo senza mostrarlo.
- Se l'indirizzo trapela, fai clic sul trigger Email in arrivo nel **Costruttore** e poi su **Reimposta indirizzo**. Il flusso di lavoro riceve un nuovo indirizzo, e da quel momento le email al vecchio vengono ignorate.
- Chiunque può mettere qualsiasi mittente su un'email, quindi **Da** non prova chi l'ha inviata. Prima che un flusso di lavoro faccia qualcosa di importante, verifica qualcosa che conosce solo il vero mittente — un token nell'oggetto o in un header — con un blocco **Se / Altrimenti**. Salva il token atteso come variabile segreta.
- La chiave viene nascosta in tutto ciò che l'esecuzione riceve — **A**, **CC**, gli header e i corpi — perché il log dell'esecuzione è visibile a chiunque possa leggere le esecuzioni del flusso di lavoro.

Solo le persone che possono modificare il flusso di lavoro — **Proprietario del progetto**, **Amministratore del progetto**, **Amministratore dei flussi di lavoro** o **Edit Workflow** — possono vedere o reimpostare il suo indirizzo. Tutti gli altri vedono una nota che dice a chi chiederlo.

## Accesso alla rete in uscita

I blocchi API e gli altri blocchi HTTP fanno le loro richieste da OneUptime, e il blocco IRC si collega da OneUptime alla porta del server IRC. Se usi il self-hosting, assicurati che la tua installazione possa raggiungere i servizi che chiami. Se usi OneUptime Cloud, i nostri intervalli di IP in uscita sono elencati in [Indirizzi IP](/docs/configuration/ip-addresses), così puoi consentirli dall'altra parte.

Gli indirizzi che un blocco può raggiungere dipendono dal blocco:

| Blocchi                                                    | Loopback, link-local, metadati cloud                                          | Indirizzi di rete privata                                                                                                                 |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| I blocchi **API** e **Mattermost**, e le richieste di **Esegui JavaScript personalizzato** | Rifiutati, a meno che l'host esatto non sia indicato in `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` | Rifiutati, a meno che un amministratore self-hosted non li consenta con `ALLOW_PRIVATE_NETWORK_WEBHOOKS` o `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` |
| **Invia email**, **IRC** e gli URL dei token OAuth 2.0      | Rifiutati                                                                     | Rifiutati su OneUptime Cloud. Consentiti su un'installazione self-hosted, a meno che `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` non sia `true` |
| Slack, Microsoft Teams, Discord e Telegram                 | Rifiutati                                                                     | Rifiutati: ognuno invia solo agli indirizzi del proprio servizio                                                                          |

Vedi [Accesso alla rete privata](/docs/self-hosted/private-network-access) per come un amministratore self-hosted li apre.

## Componenti IA

**Genera testo con l'IA** invia una richiesta a un LLM: il provider LLM predefinito del progetto, o il provider globale dell'installazione quando il progetto non ne ha uno. Configura i provider in **Impostazioni del progetto → IA → Provider LLM**, e non mettere mai la chiave API di un provider o un tuo endpoint in un flusso di lavoro.

Cosa riceve il provider, e cosa può farne il modello:

- **Solo ciò che metti nel blocco.** OneUptime invia un'istruzione di sicurezza fissa, poi le **Istruzioni di sistema**, il **Prompt** e il **Contesto** del blocco, con i riferimenti compilati. **Contesto** viene per ultimo, dopo un marcatore, e l'istruzione di sicurezza dice al modello che tutto ciò che segue il marcatore sono dati non attendibili, anche un testo che sembra un'istruzione.
- **Nient'altro.** I dati del trigger, la cronologia del flusso di lavoro, gli output degli altri blocchi, i record del progetto, la telemetria e i segreti non vengono mai allegati. Lasciano OneUptime solo quando vi fai riferimento in una di quelle tre impostazioni.
- **Testo, e nessuno strumento.** Il modello non può interrogare OneUptime, fare richieste HTTP o modificare dati. I parametri aggiuntivi di un provider lasciano passare solo un elenco consentito di campi di regolazione della generazione: non possono sostituire i messaggi, aggiungere strumenti, ricerca web o altre fonti di dati, chiedere altro che testo o più risposte, attivare lo streaming, far conservare la richiesta al provider o alzare il limite di output del blocco. I campi che OneUptime non conosce vengono scartati.
- **Il modello lo sceglie il tuo amministratore.** Se la generazione deve restare offline, scegli un modello che non recuperi nulla da solo dal lato del provider.

Cosa viene registrato:

- Il log dell'esecuzione nasconde le **Istruzioni di sistema**, il **Prompt**, il **Contesto** e la **Risposta** del blocco. I blocchi successivi possono comunque usarli durante l'esecuzione, e un blocco in cui ne inserisci uno lo registra secondo le proprie regole, quindi inserirlo è una scelta di mostrarlo.
- Il provider, il modello, il numero di token, il **ID del log LLM** e un messaggio di errore sicuro restano visibili, per l'operatività e la fatturazione. L'errore grezzo di un provider resta fuori da ogni log, perché un provider può ripetervi la richiesta.
- Ogni chiamata compare in **Impostazioni del progetto → IA → Log IA** con provider, modello, stato, token, costo e fatturazione, senza il prompt, la risposta o l'errore grezzo.

Di cosa ha bisogno il blocco, e quanto costa:

- **Abilita IA** deve essere acceso, in **Impostazioni del progetto → IA → Funzionalità IA**. Su OneUptime Cloud il progetto ha bisogno anche del piano Growth o superiore e di un abbonamento pagato. Le installazioni self-hosted senza fatturazione non hanno vincoli di piano.
- Le chiamate tramite un provider globale a pagamento usano i crediti IA del progetto.
- Ogni chiamata conta nei [limiti giornalieri di IA del progetto](/docs/ai/ai-sre#i-limiti-giornalieri-del-progetto-stesso), quando un Proprietario del progetto li imposta. Una volta raggiunto un limite, il blocco prende **Errore** senza contattare il modello, fino alla mezzanotte UTC.

| Limite                                                       | Valore                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| **Istruzioni di sistema**, **Prompt** e **Contesto** insieme    | 50.000 caratteri                                                          |
| **Temperatura**                                              | Da `0` a `1`                                                              |
| **Numero massimo di token di output**                                    | Da `1` a `4096`, `1024` per impostazione predefinita                      |
| Una richiesta                                                | Un solo tentativo, al massimo 60 secondi                                  |
| Chiamate contemporanee                                       | 3 per progetto. Le altre prendono **Errore**, e un'esecuzione successiva può riprovare. |

Gli errori di convalida, configurazione, accesso, limite, crediti, concorrenza, provider e timeout prendono tutti il percorso **Errore**, con il motivo in **Errore**. Collega quel percorso prima che il flusso di lavoro vada in produzione.

> [!WARNING]
> Ogni valore a cui fai riferimento è un dato che invii al provider. Non mettere una variabile segreta nel prompt o nel contesto, a meno che il provider non sia approvato per riceverla. Un provider locale self-hosted come Ollama tiene le richieste all'interno della tua infrastruttura; un provider ospitato le riceve secondo le proprie condizioni di trattamento dei dati.

## Autorizzazioni

I flussi di lavoro rispettano il controllo degli accessi basato sui ruoli del tuo progetto. I tre ruoli dei flussi di lavoro:

- **Amministratore dei flussi di lavoro** — costruisce i flussi di lavoro: li crea, li modifica, li esegue e li elimina, e gestisce le variabili che usano.
- **Membro dei flussi di lavoro** — li usa: apre i flussi di lavoro e le loro esecuzioni, ed esegue un flusso di lavoro a mano con **Esegui flusso di lavoro**. Un membro non può creare, modificare o eliminare un flusso di lavoro, né eseguire da solo uno dei suoi passaggi. Il **Costruttore** mostra loro un flusso di lavoro così com'è, contrassegnato **Sola lettura**: un passaggio si apre per essere letto, e nulla di ciò che vi fanno viene salvato.
- **Visualizzatore dei flussi di lavoro** — legge i flussi di lavoro e le loro esecuzioni.

**Proprietario del progetto** e **Amministratore del progetto** possono fare tutto ciò che può fare un Amministratore dei flussi di lavoro. **Membro del progetto** può creare ed eliminare flussi di lavoro, ma non modificarli né eseguirli.

I singoli permessi, per un team o una chiave API che ha bisogno di una sola cosa:

- **Create / Read / Edit / Delete Workflow** — i permessi di base sul flusso di lavoro stesso. Modificare un flusso di lavoro, compreso accenderlo, spegnerlo o archiviarlo, richiede **Edit Workflow**; **Delete Workflow** serve solo a eliminare.
- **Edit Workflow** — è anche ciò che serve per eseguire un singolo passaggio con **Run just this step**, e per vedere o reimpostare l'URL del webhook e l'indirizzo email in arrivo di un flusso di lavoro. Eseguire un intero flusso di lavoro a mano richiede **Edit Workflow**, **Amministratore dei flussi di lavoro** o **Membro dei flussi di lavoro**.
- **Read Workflow Log** — necessario per vedere le esecuzioni.
- **Create / Read / Edit / Delete Workflow Variables** — gestire le variabili globali e del flusso di lavoro.

Un'esecuzione a mano raggiunge solo i flussi di lavoro che puoi aprire: un ruolo limitato ad alcune etichette, o ai flussi di lavoro posseduti dal tuo team, esegue solo quelli. Chi non può eseguire un flusso di lavoro vede **Esegui flusso di lavoro** disattivato, con il motivo nel tooltip.

Un flusso di lavoro che viene eseguito come **Proprietario del progetto** o come un ruolo personalizzato viene modificato ed eseguito a mano solo da persone che hanno esse stesse quei permessi; gli altri possono solo consultarlo nel **Costruttore**. Vedi [Run As](#run-as).

Assegna **Amministratore dei flussi di lavoro** alle persone che costruiscono l'automazione, e **Membro dei flussi di lavoro** a quelle che si limitano ad avviarla. Riserva l'accesso in modifica alle variabili alle persone che gestiscono i segreti del progetto. Vedi [Utenti, team e autorizzazioni](/docs/permissions/index) per come vengono assegnati i ruoli.

## Cosa possono fare i passaggi di un flusso di lavoro

I passaggi che leggono e modificano i record di OneUptime — i componenti Find, Create, Update e Delete, e i trigger On Create, On Update, On Create or Update e On Delete — agiscono come **Amministratore del progetto** del progetto del flusso di lavoro. Chiunque abbia costruito il flusso di lavoro, un passaggio supera gli stessi controlli che supera un Amministratore del progetto nella dashboard e nell'API:

- **Solo il progetto del flusso di lavoro.** Un passaggio legge e scrive i record del progetto a cui appartiene il flusso di lavoro e di nessun altro, e un Update non sposta mai un record in un altro progetto.
- **Solo ciò che può fare un Project Admin.** Un passaggio non può fare ciò che solo **Proprietario del progetto** e i permessi di fatturazione o di eliminazione del progetto consentono, e non può leggere chi ha creato una sonda o un agente IA, cosa che vedono solo i Proprietari del progetto.
- **Non chi ha accesso.** Con i permessi predefiniti, un passaggio non crea, non modifica e non elimina team, membri dei team, permessi dei team o ruoli personalizzati, anche se un Amministratore del progetto può farlo. Chi costruisce un flusso di lavoro decide cosa fanno i suoi passaggi, e può essere un **Membro del progetto**, quindi un passaggio che potesse farlo darebbe a chi lo ha costruito un accesso che non gli è stato dato, come **Amministratore del progetto**. Il passaggio viene rifiutato, e il log dell'esecuzione nomina il permesso che serve alla modifica e dice di scegliere **Run As** nelle **Impostazioni** del flusso di lavoro: un flusso di lavoro che viene eseguito come **Proprietario del progetto**, o come un ruolo personalizzato che ha quel permesso, può fare la modifica (vedi [Run As](#run-as)). Nessun passaggio di un flusso di lavoro modifica le chiavi API, il single sign-on o le impostazioni SCIM, con qualunque permesso venga eseguito. I trigger e i passaggi Find su questi record continuano a funzionare.
- **Non la lettura delle impostazioni che contengono credenziali.** Un Amministratore del progetto può leggere server SMTP, fornitori di chiamate e SMS, credenziali SNMP, connessioni per videochiamate e chiavi API, ma questo non viene mai prestato a un passaggio, chiunque abbia costruito o salvato il flusso di lavoro. Un passaggio non può indicare una di queste impostazioni, come il server SMTP con cui una pagina di stato invia email o la chiave API a cui viene concesso un permesso. Il passaggio viene rifiutato, e il suo log di esecuzione dice che deve fare la modifica una persona che può leggerle (il permesso di lettura di quel tipo di impostazione, oppure un Proprietario del progetto o un Amministratore del progetto). Un passaggio che mantiene l'impostazione che un record indica già, o la svuota, non viene rifiutato.
- **Non incidenti, avvisi ed episodi privati.** Un Amministratore del progetto vede ogni incidente, avviso ed episodio privato, ma questo non viene mai prestato a un passaggio, chiunque abbia costruito o salvato il flusso di lavoro. Un passaggio non trova alcun record privato, non ne modifica nessuno e non vi aggiunge nulla, e un flusso di lavoro non parte da uno di essi né da qualcosa che gli appartiene, che lo avvii un evento di un record o **Esegui flusso di lavoro**. Chi costruisce un flusso di lavoro decide dove va ciò che i suoi passaggi leggono — un webhook, un'email, una chat, il log dell'esecuzione — e può essere un **Membro del progetto** che non può vedere un record privato. Vedi [Incidenti, avvisi ed episodi privati](/docs/permissions/index#incidenti-avvisi-ed-episodi-privati).
- **Solo ciò che il tuo piano include.** Su OneUptime Cloud, un passaggio che crea o modifica qualcosa che il tuo piano non include viene rifiutato indicando il piano necessario, proprio come nella dashboard. Le installazioni self-hosted senza fatturazione non hanno limiti di piano.
- **Niente di ciò che OneUptime tiene per sé.** Questo viene rifiutato a tutti, flussi di lavoro compresi:
  - modificare o eliminare una voce del feed (i feed di incidenti, avvisi, episodi, monitor, policy di reperibilità e manutenzione programmata);
  - scrivere un log delle notifiche (i log di SMS, chiamate, email, WhatsApp, Telegram, notifiche push, webhook e messaggi dell'area di lavoro);
  - i valori che OneUptime imposta man mano che le cose accadono: se il CNAME di un dominio personalizzato è verificato, gli interruttori di protezione di un team (**Is Team Editable**, **Is Team Deleteable**, **Is Permissions Editable**, **Should Have At Least One Member**), quale ruolo di incidente è quello principale e se può essere eliminato, se un proprietario o un membro è stato avvisato, gli orari e il numero dei promemoria, chi è reperibile ora e dopo in un calendario, l'avanzamento di un'esecuzione di reperibilità, il tasso di consumo e l'error budget attuali di uno SLO, un monitor messo in pausa da un incidente o da un evento di manutenzione, il token di reimpostazione della password e l'ultimo accesso di un utente privato di una pagina di stato, i dati che un servizio riporta su sé stesso (versione, runtime, cloud) e l'ultima esecuzione di una regola di rilevamento o di un feed di minacce;
  - dichiarare un incidente da un modello inviando `createdIncidentTemplateId` a **Crea: Incidente (un record)** — scegli invece il modello nell'impostazione **Modello di incidente** del passaggio: il passaggio dichiara allora l'incidente da esso, come Amministratore del progetto, e registra il modello;
  - cambiare il record a cui appartiene un record dopo la sua creazione, come il monitor a cui si riferisce una riga di proprietario o l'incidente su cui si trova una nota.
- **Come nessuno.** Un record creato da un flusso di lavoro non indica alcun creatore, e il log di audit nomina il flusso di lavoro, con il nome che aveva in quel momento, come autore della modifica.

Quando un controllo rifiuta un passaggio, il passaggio prende la sua uscita **Errore** senza fare la modifica rifiutata, e il log dell'esecuzione nomina il passaggio e il motivo con parole semplici, ad esempio *"Find One Probe" was refused. Workflow steps can do only what a Project Admin of this project can do: …*. Leggilo nelle [Esecuzioni](/docs/workflows/runs-and-logs) del flusso di lavoro. Un passaggio Create Many crea i suoi record uno alla volta e si ferma al primo rifiutato: i record creati prima di quello vengono conservati.

I passaggi che parlano con altri sistemi — API, Email, Slack, Microsoft Teams, Discord, Telegram, IRC, Mattermost, Custom Code e Generate Text with AI — non leggono né modificano record di OneUptime, quindi niente di tutto questo li riguarda.

### Run As

Per impostazione predefinita, un flusso di lavoro viene eseguito con i permessi descritti sopra, e la maggior parte dei flussi di lavoro non ha mai bisogno di altro. Quando uno ne ha bisogno, ad esempio un flusso di lavoro che dà un ruolo personalizzato a ogni nuovo team, apri le sue **Impostazioni**, poi **Altre impostazioni**, e scegli **Change Run As**:

- Predefinito: i permessi descritti sopra.
- Proprietario del progetto: quello che un **Proprietario del progetto** può fare in questo progetto, compreso cambiare chi fa parte di un team e cosa può fare un team. Solo un Proprietario del progetto può sceglierlo.
- Un ruolo personalizzato: esattamente quello che consente uno dei ruoli personalizzati del progetto. Solo chi potrebbe dare quel ruolo a un team può sceglierlo.

Con qualunque permesso venga eseguito, un passaggio non legge mai le impostazioni che contengono credenziali, non vede mai incidenti, avvisi o episodi privati e non modifica mai le chiavi API, il single sign-on o le impostazioni SCIM. Quando dà a un team un permesso o un ruolo, può dare solo quello che ha esso stesso, e se gli manca qualcosa, il log dell'esecuzione nomina il permesso.

Un flusso di lavoro che viene eseguito con più dei permessi predefiniti viene eseguito con i permessi della persona che glieli ha dati: chi ha scelto per ultimo il suo **Run As**, o ha salvato i suoi passaggi o le sue variabili. Perché nessuno ottenga attraverso di esso più di quello che ha:

- Solo le persone che hanno quei permessi possono modificare il flusso di lavoro o le sue variabili, archiviarlo o eliminarlo, eseguire a mano il flusso di lavoro o uno dei suoi passaggi, o vedere il suo URL del webhook e il suo indirizzo email in entrata. Chiunque possa modificarlo può comunque disattivarlo. Quando passa a essere eseguito con più dei permessi predefiniti, o cambia come viene eseguito, riceve un nuovo URL del webhook e un nuovo indirizzo email in entrata, così le copie dei vecchi non lo avviano più.
- Solo una persona può darli, mai una chiave API.
- Ogni esecuzione controlla prima che la persona che li ha dati li abbia ancora. Se non è così, l'esecuzione si ferma prima del suo primo passaggio, e il suo log dice perché e chi può darli di nuovo.
- Non legge le variabili globali del progetto, che chiunque possa modificare le variabili dei flussi di lavoro può cambiare.
- Il passaggio **Esegui un altro flusso di lavoro** di un altro flusso di lavoro può avviarlo solo se quel flusso di lavoro viene eseguito con gli stessi permessi o di più.

Ogni esecuzione registra come è stata eseguita e con i permessi di chi, come mostrano la finestra dell'esecuzione e un log scaricato, e il [log di audit](/docs/configuration/audit-logs) registra chi ha cambiato il **Run As** di un flusso di lavoro.

## Limiti di piano

Su OneUptime Cloud i flussi di lavoro richiedono il piano Growth o superiore, e ogni piano consente un certo numero di esecuzioni in qualsiasi periodo di 30 giorni:

| Piano      | Esecuzioni negli ultimi 30 giorni |
| ---------- | --------------------------------- |
| Growth     | 500                               |
| Scale      | 2.000                             |
| Enterprise | Nessun limite pratico             |

La finestra scorre: ogni esecuzione registrata dal progetto, a mano o da un trigger, conta per 30 giorni. Sui piani Growth e Scale, la pagina **Flussi di lavoro** mostra una scheda **Esecuzioni del flusso di lavoro** con quante ne ha usate il progetto. Una volta raggiunto il limite, le nuove esecuzioni vengono registrate con lo stato **Esecuzione oltre il piano attuale** e non vengono eseguite, e lo stesso accade finché l'abbonamento non è pagato. Le installazioni self-hosted senza fatturazione non hanno limiti. Su un piano che non esegue flussi di lavoro, il **Costruttore** e la pagina **Flussi di lavoro** lo dicono, con un link per passare a un piano superiore.

## Quanto può durare un'esecuzione

| Limite                                                       | Predefinito        | Impostazione self-hosted        |
| ------------------------------------------------------------ | ------------------ | ------------------------------- |
| Un'esecuzione, dal suo avvio o dal risveglio dopo uno **Pausa** | 2 minuti        | `WORKFLOW_TIMEOUT_IN_MS`        |
| Un blocco **Esegui JavaScript personalizzato**                          | 5 secondi          | `WORKFLOW_SCRIPT_TIMEOUT_IN_MS` |
| Un blocco **Pausa**                                          | Al massimo 30 giorni | —                             |

L'esecutore controlla la scadenza prima e dopo ogni blocco, e segna un'esecuzione in ritardo come **Tempo scaduto** non appena riprende il controllo. Non può interrompere un blocco a metà, quindi i blocchi che attendono la rete hanno limiti di tempo propri: una richiesta di Generate Text with AI si arrende dopo al massimo 60 secondi, e una richiesta di token OAuth 2.0 dopo 20. Un'attesa su un blocco **Pausa** non conta nel tempo di un'esecuzione: l'esecuzione viene messa da parte e riceve 2 nuovi minuti al risveglio.

## Limite alle chiamate tra flussi di lavoro

Il componente **Esegui un altro flusso di lavoro** permette a un flusso di lavoro di avviarne un altro. Per evitare cicli in cui il flusso di lavoro A avvia B, che avvia di nuovo A, una catena di flussi di lavoro che si avviano a vicenda viene rifiutata quando tornerebbe a un flusso di lavoro che ne fa già parte, o supererebbe i 10 flussi di lavoro di profondità. Il blocco **Esegui un altro flusso di lavoro** prende allora la sua uscita **Errore**, e l'errore mostra la catena.

Se ti serve davvero una catena lunga (come un job che elabora un elemento per esecuzione), di solito è più semplice ciclare all'interno di un solo flusso di lavoro con **Esegui JavaScript personalizzato**.

## Quando i flussi di lavoro non sono lo strumento giusto

Alcuni casi in cui conviene usare altro:

- **Calcoli pesanti o grandi volumi di dati** — i flussi di lavoro sono pensati per un lavoro di collegamento leggero, non per macinare numeri. Esegui il lavoro pesante nella tua infrastruttura e lascia che un flusso di lavoro lo avvii.
- **Calcoli attivi di lunga durata** — un'esecuzione ha 2 minuti per impostazione predefinita. Per un'attesa passiva come «fai A, aspetta due ore, fai B», usa il componente **Pausa**; mette da parte l'esecuzione e la riprende più tardi senza occupare un worker.
- **Risposta agli incidenti passo per passo con persone coinvolte** — a questo servono i [Runbook](/docs/runbooks/index). I flussi di lavoro servono all'automazione senza supervisione.

## Prossimi passi

:::cards
- [Panoramica dei flussi di lavoro](/docs/workflows/index): Il quadro d'insieme e un primo flusso di lavoro dall'inizio alla fine.
- [Componenti](/docs/workflows/components): Di cosa ha bisogno ogni blocco, cosa restituisce e cosa può raggiungere.
- [Runbook](/docs/runbooks/index): Quando le persone devono prendere le decisioni lungo il percorso.
:::
