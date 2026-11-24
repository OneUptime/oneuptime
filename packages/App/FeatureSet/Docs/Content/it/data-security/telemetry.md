# Dati sensibili nella telemetria

La telemetria contiene tutto ciò che scrive il tuo codice: un indirizzo email in una riga di log, un numero di carta in un attributo di uno span, un token in uno stack trace, la domanda di un cliente in un prompt, l'indirizzo IP di un utente nell'etichetta di una metrica. Sicurezza dei dati tratta i log, le tracce, le metriche, le eccezioni e le conversazioni IA di ogni servizio, e le sessioni di ogni applicazione RUM, come archivi dati a sé stanti. Li campiona ogni ora, vi trova i dati sensibili come fa in un bucket, e **Ripulisci** trasforma un risultato in una regola che da quel momento in poi nasconde quei dati all'ingestione, nel servizio in cui sono stati trovati.

Non c'è nulla da configurare: la telemetria di ogni servizio viene scansionata ogni ora, a meno che **Scansiona telemetria** non sia disattivato nelle impostazioni del progetto. Per escludere i log, le tracce o un altro segnale di un servizio, disattiva **Scansiona contenuto** nelle **Impostazioni** di quell'archivio: dalla scansione successiva non se ne legge nulla.

:::cards
- [Cosa viene letto](#cosa-viene-letto): Gli attributi, i corpi, i messaggi e i prompt di ogni segnale.
- [Come campiona una scansione](#come-campiona-una-scansione): I record più recenti di ogni servizio, ogni ora.
- [Ripulisci](#ripulisci): Nascondi un risultato all'ingestione, nel servizio in cui è stato trovato.
- [Contenuto in autonomia](#contenuto-in-autonomia): Un segreto nascosto senza che nessuno prema nulla, dove è dimostrato che è sicuro.
- [Scarta questa metrica](#scarta-questa-metrica): Smetti di memorizzare le metriche il cui nome contiene dati sensibili.
- [Cosa conta come ripulito](#cosa-conta-come-ripulito): Quando una regola di pulizia copre già un risultato.
:::

## Come funziona

```mermaid title="Da una riga di log a una regola di pulizia"
flowchart TB
    code["Il tuo codice scrive<br/>un'email in una riga di log"] --> stored["OneUptime conserva<br/>il log"]
    stored --> scan["La scansione oraria<br/>campiona i log"]
    scan --> finding["Un risultato: Indirizzo email<br/>in attributes.user.email"]
    finding --> issue["Un problema sull'archivio<br/>Registri del servizio"]
    finding --> scrub["Ripulisci crea una<br/>regola di pulizia dei log"]
    scrub --> ingest["I nuovi log vengono mascherati<br/>prima di essere conservati"]
```

Un risultato coperto da una regola di pulizia viene contrassegnato come ripulito: ciò che OneUptime conserva di quei dati sono dati vecchi in attesa della fine della loro conservazione. Il codice però li scrive ancora, quindi i due controlli della telemetria lo contano come contenuto, non corretto: il loro problema si risolve come **Contenuto in fase di acquisizione** quando ogni risultato è ripulito, e come **Corretto nel codice** solo quando la nuova versione di una correzione del codice smette di scrivere i dati (vedi [Cosa succede a un problema](/docs/data-security/checks-and-issues#cosa-succede-a-un-problema)).

## Cosa viene letto

| Archivio | Cosa viene letto | Dove punta un risultato |
| --- | --- | --- |
| Log | Ogni attributo, e il corpo | `attributes.<key>`, `body` |
| Tracce | Ogni attributo degli span, e gli attributi di ogni evento degli span | `attributes.<key>`, `events.<event>.<key>` |
| Eccezioni | Il messaggio, lo stack trace e gli attributi | `message`, `stackTrace`, `attributes.<key>` |
| Conversazioni IA | I prompt e le risposte di ogni chiamata IA, sotto le chiavi in cui li mettono le convenzioni GenAI, e ogni altro attributo | La chiave in cui si trovano, come `gen_ai.input.messages` o `gen_ai.prompt[].content` |
| Session Replays | Gli attributi degli span e dei log di un'applicazione RUM, gli attributi delle sue sessioni, i tratti che `identify()` ha assegnato ai suoi utenti e il riferimento utente che ha ricevuto | `spans.attributes.<key>`, `logs.attributes.<key>`, `sessions.attributes.<key>`, `sessions.identifiedUserTraits.<key>`, `sessions.identifiedUserLabel` |
| Metriche | Ogni attributo di un punto dati, compresi quelli della sua risorsa, e i nomi delle metriche | `attributes.<key>`, `attributes.resource.<key>`, `name` |

Le chiavi numerate vengono raccolte in un'unica posizione: `gen_ai.prompt.3.content` diventa `gen_ai.prompt[].content`, così i venti messaggi di una chat sono un solo risultato, non venti. Gli attributi che OneUptime aggiunge da sé, che iniziano con `oneuptime.`, non vengono letti.

### Metriche

Gli attributi di una metrica sono le etichette delle sue serie. Sono gli stessi su ogni punto dati di una serie, quindi una metrica che scrive mille punti al minuto può contenere solo tre valori, e un'etichetta che espone l'email di un utente aggiunge una serie, non un punto. Per questo una metrica viene campionata per serie, non per punti:

- **Un punto di ogni serie.** Ogni metrica viene letta nel minuto più recente in cui ha scritto nell'ultima ora: un punto dati di ciascuna di al massimo 100 serie di quel minuto, con qualunque frequenza venga inviata la metrica, così una serie attiva non scavalca mai una serie tranquilla. Un valore viene classificato una sola volta, per quante serie lo ripetano, quindi un risultato conta i valori distinti nella sua posizione.
- **Prima le metriche nuove, poi le altre a turno.** Quali metriche ha scritto un servizio, e quando ciascuna ha scritto per la prima volta nell'ultimo giorno, si ricava dall'aggregazione al minuto che conserva la tabella delle metriche, mai dai suoi punti. Ogni scansione legge le metriche più attive di un servizio, quelle con più probabilità di avere molte serie. Poi vengono le metriche che ha iniziato a scrivere nelle ultime 2 ore, perché una nuova fuga di dati di solito nasce da codice nuovo, e poi le successive delle sue altre metriche, in un ordine fisso, da dove si è fermata l'ultima scansione. Le metriche nuove occupano al massimo metà di quei turni, così le altre conservano sempre i propri.
- **Ogni metrica entro un tempo fisso.** Una scansione dà a ogni servizio 10 delle sue letture, meno quando il progetto ha più di 10 servizi. Le letture che un servizio lascia inutilizzate, perché ha meno metriche, vanno una alla volta ai servizi che hanno ancora metriche in attesa del loro turno, così nessuna va sprecata e nessun servizio riceve meno della sua parte. Le 5 metriche più attive di un servizio occupano 5 delle sue letture, e il resto legge a turno le sue altre metriche: in un servizio di M metriche che riceve r letture a turno, ciascuna viene letta almeno una volta ogni M ÷ r ore, arrotondando per eccesso. Sono 60 ore per un servizio di 300 metriche che riceve solo le sue 5, e 11 ore quando altri due servizi di 300 metriche condividono il suo progetto, perché ognuno ne riceve allora 28 o 29. Finché continua ad avviare nuove metriche ogni ora, il tempo è al massimo il doppio.
- **L'intervallo proprio di ogni metrica.** Le metriche vengono lette insieme, ciascuna per il proprio intervallo della chiave primaria della tabella. Una metrica il cui minuto più recente contiene più di 16.384 punti, come una che ha come etichetta l'email di ogni utente, viene letta da sola, e la lettura si ferma ai suoi primi punti, così non costa più di qualsiasi altra metrica.

Un risultato indica l'attributo, come `attributes.user.email`, oppure `name` per i dati nel nome di una metrica. I suoi record sono i punti dati in cui è stato trovato: ognuno mostra la sua metrica e il valore dell'attributo, mascherato, e si apre in **Metriche** su quella metrica, raggruppata per quell'attributo. Quando il nome di una metrica contiene dati sensibili, anche il nome viene mascherato, e il record apre invece le metriche del servizio.

### Perché la registrazione di un replay non viene mai letta

La registrazione di un replay di sessione contiene il testo delle pagine che le persone hanno visto. Guardarla richiede un permesso a sé, e un risultato ricavato da essa mostrerebbe il testo mascherato delle pagine a chiunque possa leggere Sicurezza dei dati. Per questo di un replay si leggono solo gli attributi: gli span, i log e i dettagli della sessione accanto alla registrazione. Il registratore maschera già nel browser ciò che registra, e anche le regole di pulizia dei log vengono applicate alle registrazioni (vedi [Session Replay](/docs/telemetry/session-replay)).

### Conversazioni IA

Il prompt di una chiamata IA porta con sé l'intera chat che precede il messaggio più recente della persona, quindi di ogni valore di una chiamata IA vengono letti fino a 16.384 caratteri. Quando le conversazioni IA contengono dati sensibili, ne seguono altre due cose: il provider di IA a cui sono andate le chiamate è un flusso di quei dati, e [Dati sensibili vengono inviati a un provider di IA](/docs/data-security/checks-and-issues#ia) non viene superato sull'archivio.

Le conversazioni di uno [strumento di IA aziendale](/docs/telemetry/ai-company-tools) restano escluse. Solo i Proprietari del progetto e gli Amministratori del progetto possono leggerle, e un risultato finisce dove lo legge chiunque legga Sicurezza dei dati, quindi gli span di quei servizi non vengono mai letti, e le loro conversazioni IA vengono indicate come non lette.

## Come campiona una scansione

Ogni ora vengono letti i record più recenti dell'ultima ora di ogni segnale, e vengono classificati campo per campo come quelli di qualsiasi altro archivio (vedi [Campi e colonne](/docs/data-security/data-types#campi-e-colonne)):

| Limite | Valore |
| --- | --- |
| Record di ogni servizio e segnale | **Dimensione del campione di telemetria**, 500 per impostazione predefinita, mai più di 1.000 |
| Servizi o applicazioni RUM letti per segnale | I 200 più attivi |
| Record in una lettura | 5.000, condivisi tra i servizi; 500 per le chiamate IA |
| Caratteri del corpo di un log, del messaggio di un'eccezione o di uno stack trace | 8.192 |
| Caratteri del valore di un attributo | 4.096 |
| Caratteri di un valore di una chiamata IA | 16.384 |
| Attributi di un record | 128; 64 per una chiamata IA |
| Eventi di uno span, e attributi di un evento | 16 e 32 |
| Posizioni di un archivio | 500 |
| Metriche lette in una scansione | 100, condivise tra i servizi, almeno una per ciascuno; 10 di ogni servizio, metà tra le sue più attive e metà tra le nuove e le altre, a turno, e le letture che un servizio lascia inutilizzate vanno agli altri, a turno |
| Una metrica nuova | Una il cui primo punto delle ultime 24 ore è arrivato nelle ultime 2 ore |
| Serie di una metrica | Un punto dati di ciascuna, del suo minuto più recente, al massimo 100 |

Ogni valore viene troncato già nel database, così nessun valore lungo ne esce, e ogni lettura si ferma dopo 30 secondi. Una lettura non riuscita è un'avvertenza sugli archivi a cui era destinata; la scansione prosegue con la successiva.

Per escludere qualcosa, aggiungilo alle **Esclusioni dalla scansione** dell'archivio: una posizione indicata per intero (`attributes.http.url`), tutto ciò che sta sotto una posizione (`attributes.http`), o una chiave di attributo indicata da sola (`http.url`).

## Ripulisci

**Ripulisci** su un risultato crea la regola che da quel momento nasconde quel tipo di dati in quella posizione, oppure indica la regola abilitata che lo fa già:

:::steps
### Apri il risultato

Apri il problema - **Dove è stato trovato** elenca ogni risultato che lo causa - oppure **Sicurezza dei dati > Nella tua telemetria**, dove **Mostra i record** apre accanto all'elenco i record in cui è stato trovato un risultato.

### Premi Ripulisci

Fai clic su **Ripulisci**. Una finestra di dialogo dice cosa farebbe la regola prima che venga creato qualcosa: di chi sono i record che cambia, cosa fa con ciò che trova e cosa legge i valori che nasconderebbe. Fai clic su **Ripulisci** nella finestra per creare la regola. OneUptime crea una regola di pulizia dei log per i log e per i log di un'applicazione RUM, una regola di pulizia delle tracce per span, eccezioni e chiamate IA, sulla parte del record in cui si trova il risultato, e una regola della pipeline delle metriche per l'attributo di una metrica.

### Correggi anche il codice

La regola nasconde i nuovi dati prima che vengano conservati. I dati già conservati restano fino alla fine della loro conservazione, quindi correggi il codice che li scrive: il risultato indica il servizio e l'attributo.
:::

La regola prende il nome da ciò che nasconde, come «Data Security: Email address in log attributes of checkout», o «Data Security: Password or secret in db.password of checkout» per una regola che indica il suo attributo, ed è elencata con le altre tue regole di pulizia (vedi [Filtri di scarto e regole di pulizia](/docs/telemetry/drop-filters-and-scrub-rules#mascherare-i-dati-sensibili)). È la regola più ristretta che nasconde i dati del risultato, la prima di queste che si adatta:

| Risultato | Regola creata da Ripulisci |
| --- | --- |
| Indirizzo email, numero di carta, numero di Social Security USA, numero di telefono o indirizzo IP | Il pattern integrato di quel tipo, mascherato. Un indirizzo IP viene oscurato, oppure sottoposto a hash dove [Eventi di sicurezza](/docs/telemetry/security-events) legge quei record, così può ancora indicare l'indirizzo da bloccare. |
| Qualsiasi altro tipo di dati che un pattern trova da solo, come un token GitHub | Una regola **Regex personalizzata** creata dai pattern propri del tipo di dati. Un segreto viene oscurato. |
| Uno dei tuoi tipi di dati, con un pattern | Quel pattern, solo nell'attributo in cui è stato trovato |
| Un tipo di dati che si distingue per le parole che lo circondano, come un routing number | La sua forma, solo nell'attributo in cui è stato trovato |
| Un tipo di dati trovato dal nome del campo, come il nome di una persona sotto `customer_name`, o un valore sotto una chiave che indica un segreto | Una regola **Attributi indicati**, che nasconde l'intero valore di quell'attributo |
| Un valore sotto una chiave che sembra sensibile, dove nulla di più ristretto lo nasconde | Una regola **Chiavi di attributi sensibili**, che oscura l'intero valore di ogni attributo del genere |
| Qualsiasi tipo di dati nell'attributo di una metrica | Una regola della pipeline delle metriche **Oscura attributo** per il servizio, che sostituisce con `[REDACTED]` i valori dell'attributo con la forma del tipo di dati, oppure ogni valore dell'attributo quando nessun pattern trova il tipo di dati |

### Dimostrata sui record del risultato

Prima che la finestra di dialogo dica cosa farebbe la regola, OneUptime esegue ogni regola che potrebbe creare sui record in cui è stato visto il risultato, e sui record più recenti del suo servizio con un valore in quella posizione, con lo stesso codice che esegue l'ingestione, e chiede allo scanner cosa resta. La prima regola che nasconde i dati in ogni valore che li conteneva, e che modifica al massimo 5 su 100 degli altri valori in quel punto, è quella giusta. La finestra di dialogo dice su quanti record è stata eseguita, quanti valori contenevano i dati e quanti altri ne ha modificati. Un pattern che ne modificherebbe di più non viene mai offerto: viene offerta la regola che indica l'attributo, dicendo cos'altro modifica.

La prova viene conservata con la regola, e l'elenco delle regole di pulizia mostra **Dimostrato** nella sua riga finché la regola non viene modificata. Dove non resta alcun record su cui eseguire una regola, come per un'eccezione o un replay di sessione, o per record oltre la loro conservazione, la regola viene creata così come è pianificata, e la finestra di dialogo lo dice.

Una regola di log o di tracce vale per il servizio in cui è stato trovato il risultato: ripulisce i log o gli span di quel servizio, e quelli degli altri servizi restano come sono, così nulla di ciò che legge i loro cambia. La colonna **Ambito** dell'elenco delle regole di pulizia dice per quale servizio vale una regola. Un risultato nelle registrazioni di sessione di un'applicazione RUM crea una regola per tutti i servizi e le app del progetto, poiché le regole di log ripuliscono anche le registrazioni, e la finestra di dialogo lo dice. Se il servizio non esiste più, **Ripulisci** lo dice e non crea alcuna regola.

La finestra di dialogo nomina, ciascuno come link, i monitor, le dashboard con i loro widget, le viste salvate, le regole di registrazione e gli SLO che leggono i valori che la regola nasconderebbe, e cosa succede loro: un filtro su un valore nascosto smette di corrispondere, e un raggruppamento per esso non mostra più i valori reali. Dice anche cosa perderebbero gli [Eventi di sicurezza](/docs/telemetry/security-events) quando leggono quei record: con gli indirizzi IP nascosti, i loro eventi non possono indicare l'indirizzo da bloccare. Ciò che non puoi vedere viene contato, mai nominato. La finestra di dialogo non ferma mai la regola: lo dice, e decidi tu. I moduli delle regole di pulizia mostrano lo stesso prima che una regola venga salvata o attivata.

Alcuni risultati non possono essere ripuliti da una regola, e **Ripulisci** dice perché. L'attributo di una metrica può sempre esserlo, poiché la sua regola può nascondere ogni valore dell'attributo:

- Un tipo di dati trovato solo dai nomi dei campi nel corpo di un log, come il nome di una persona: nessuna regola può distinguerlo dal resto del messaggio. Invialo come attributo, che una regola **Attributi indicati** nasconde, oppure smetti di inviarlo.
- Ogni regola provata nascondeva molto più dei dati: ognuna è stata eseguita sui record in cui sono stati visti, e modificava troppi altri valori. Smetti di inviarli nel codice che li scrive.
- Una dicitura di classificazione di un documento: nascondere la parola non nasconderebbe il documento.
- I dettagli propri di una sessione (`sessions.*`): l'ingestione dei replay di sessione non esegue regole di pulizia.
- Il nome di una metrica (`name`): lo imposta il codice che crea la metrica, e una regola della pipeline può solo rinominare una metrica per intero. Rinomina la metrica e invia invece come attributo ciò che varia nel suo nome. Nel frattempo, **Scarta questa metrica** può smettere di memorizzare quelle metriche.

**Ripulisci** crea la regola a tuo nome, con i tuoi permessi: possono premerlo i Proprietari del progetto e gli Amministratori del progetto, e anche un team che può creare regole di pulizia dei log, regole di pulizia delle tracce per span, eccezioni e chiamate IA, e regole della pipeline delle metriche per le metriche.

## Contenuto in autonomia

Mentre OneUptime AI lavora sui problemi di Sicurezza dei dati (vedi [OneUptime AI in Sicurezza dei dati](/docs/data-security/ai)), un problema di telemetria viene contenuto senza che nessuno prema nulla, dove è dimostrato che è sicuro. Per ogni posizione che il problema conta, OneUptime AI pianifica la regola che creerebbe **Ripulisci**, dimostrata allo stesso modo, e la crea in autonomia solo quando valgono tutte queste condizioni:

- **I dati sono un segreto**, come una password, un token o una chiave.
- **La regola è dimostrata** sui record in cui sono stati visti i dati: ha nascosto i dati in ogni valore che li conteneva.
- **Non modifica nient'altro lì**: nessuno degli altri valori nella sua posizione.
- **Nulla legge ciò che nasconde**: nessun monitor, dashboard, vista salvata, regola di registrazione o SLO, e nulla di cui ha bisogno Eventi di sicurezza.
- **Vale per il servizio** in cui sono stati visti i dati.

Tutto il resto viene invece proposto, in **Sicurezza dei dati → IA** e nella pagina del problema, dicendo come è stata dimostrata la regola e cosa legge ciò che nasconderebbe: dati personali, una regola i cui valori sono letti da qualcosa, una che modifica altri valori, una per cui non restava alcun record su cui eseguirla, una per tutti i servizi, la regola della pipeline di una metrica, e qualsiasi posizione la cui regola precedente una persona ha annullato o ignorato. Una regola IA di Sicurezza dei dati che imposta **Contenimento** su **Automaticamente** per un problema permette di nascondere in autonomia anche i dati personali dimostrati. Nessuna regola permette di eseguire in autonomia una modifica che non è dimostrata sicura.

Dove nessuna delle regole di **Ripulisci** può nascondere i dati, come per uno dei tuoi tipi di dati senza pattern, OneUptime AI ne scrive una: un pattern per i dati, o l'attributo da nascondere per intero. Le vengono indicati il tipo di dati, dove si trova, i nomi degli attributi accanto e le forme dei valori, come `AA-9999` per `AB-1234`, mai un valore, e ciò che scrive viene dimostrato sui record come qualsiasi altra regola prima di essere proposto o creato.

Una modifica che OneUptime AI ha fatto in autonomia:

- **È nella cronologia del problema**, con le regole che ha creato, come è stata dimostrata ciascuna, e **Annulla**, che le elimina. **Sicurezza dei dati → IA** ha lo stesso **Annulla**. Una posizione di cui annulli la regola non viene mai più contenuta in autonomia: OneUptime AI la propone invece.
- **Viene inviata per email** ai proprietari dell'archivio e ai proprietari del servizio.
- **Dice di ruotare un segreto.** Nascondere un segreto ferma solo le nuove copie: il segreto funziona ancora, e i record memorizzati prima della regola lo mantengono fino alla fine della loro conservazione. La cronologia e l'email dicono dove è stato visto.

I nuovi risultati in un servizio il cui problema è già aperto vengono contenuti allo stesso modo, appena la scansione oraria li trova.

## Scarta questa metrica

Nessuna regola toglie i dati dal nome di una metrica, quindi finché il codice che dà il nome alla metrica non viene corretto, i dati continuano ad arrivare. **Scarta questa metrica** su un risultato nel nome di una metrica smette di memorizzare le metriche il cui nome li contiene, a costo dei loro dati, quindi avviene solo quando lo chiedi:

- **Le metriche di un servizio.** Crea una regola della pipeline delle metriche **Scarta** per il servizio del risultato: ogni nuovo punto dati di una metrica il cui nome contiene quel tipo di dati viene scartato prima di essere memorizzato. Il suo filtro è il pattern che **Ripulisci** usa per il tipo, quindi un tipo che nessun pattern può trovare, come il nome di una persona, non si può scartare, e la finestra di dialogo dice perché.
- **Detto prima di farlo.** La finestra di dialogo dice che quei punti dati vanno persi per sempre, quante delle metriche del servizio scritte nell'ultimo giorno hanno un nome simile, cosa le legge e quindi non riceve più nuovi dati, che ciò che è già memorizzato resta fino alla fine della sua conservazione, e come annullarlo. Non viene scartato nulla finché non spunti di aver capito.
- **Cosa le legge, e cosa gli succede.** La finestra di dialogo nomina, ciascuno come link, ogni monitor, ogni dashboard con i suoi widget che leggono quelle metriche, ogni SLO di metrica del servizio e ogni regola di registrazione delle metriche che le legge. I monitor non possono più generare avvisi sui loro valori, i widget non mostrano nuovi dati, gli SLO non contano più nuovi eventi da esse, e le metriche di output delle regole di registrazione non le includono più. Sotto ogni regola di registrazione, nomina anche ciò che legge la sua metrica di output, e ciò che legge le loro a sua volta, fino a tre metriche di output più avanti nella catena. Il link di un widget apre la sua dashboard su quel widget. Ciò che non puoi vedere viene contato, mai nominato.
- **A tuo nome, e registrato.** La regola viene creata con il tuo permesso di creare regole della pipeline delle metriche: possono crearla i Proprietari del progetto e gli Amministratori del progetto, e anche un team che può creare regole della pipeline delle metriche. I log di audit registrano chi l'ha creata.
- **Si annulla eliminando la regola.** La regola prende il nome da ciò che scarta, ad esempio «Data Security: drop metrics named with Email address», e compare con le altre regole della pipeline delle metriche in **Metriche → Impostazioni → Regole pipeline**. Eliminala o disattivala, e quelle metriche vengono di nuovo memorizzate da quel momento. Ciò che è stato scartato nel frattempo non torna.

Il risultato viene allora segnato come **Scartati**, e conta come ripulito: di quei dati non viene memorizzato più nulla.

## Cosa conta come ripulito

Un risultato viene contrassegnato come ripulito solo quando l'ingestione eseguirebbe su di esso una regola abilitata e la regola troverebbe il suo tipo di dati:

- **I record giusti.** Le regole dei log coprono i log e i log di un'applicazione RUM. Le regole delle tracce coprono span, eccezioni e chiamate IA: un'eccezione è una copia dell'evento di eccezione del suo span, quindi la ripuliscono le regole che ripuliscono gli eventi.
- **La parte giusta.** I **Campi da rimuovere** della regola includono la parte del record in cui si trova il risultato, oppure la regola li lascia al loro valore predefinito.
- **Il servizio giusto.** Una regola di log o di tracce per un servizio copre solo i risultati di quel servizio. Una regola senza servizio copre quelli di tutti i servizi.
- **Un pattern che trova il tipo.** Un **Tipo di pattern** integrato trova il proprio tipo di dati: **Indirizzo email** trova gli indirizzi email, **Numero di carta di credito** i numeri di carta, **SSN (numero di previdenza sociale USA)** i numeri di Social Security USA, **Numero di telefono** i numeri di telefono e **Indirizzo IP** gli indirizzi IP. **Chiavi di attributi sensibili** copre ogni valore sotto una chiave che sembra sensibile, qualunque sia il valore.
- **Una regola dimostrata sui record del risultato.** Una regola che OneUptime ha creato e dimostrato sui record in cui è stato visto un risultato copre quel risultato, qualunque sia il suo pattern, finché resta la regola che è stata dimostrata: modificane il pattern, gli attributi, l'azione, i campi o il servizio, e non lo copre più.
- **Una regola di attributi indicati** copre un risultato in un attributo che indica, o in uno annidato sotto di esso.
- **Altrimenti, i tuoi pattern personalizzati non contano mai.** Una **Regex personalizzata** che hai scritto tu copre un risultato solo quando è esattamente il pattern che **Ripulisci** crea per il suo tipo. Un risultato conserva solo campioni mascherati, su cui nessun pattern può essere provato, quindi OneUptime non potrebbe dimostrare che il tuo pattern nasconde i dati, e un risultato considerato ripulito per errore è una fuga che nessuno guarda.
- **L'attributo di una metrica.** Una regola della pipeline delle metriche **Oscura attributo** o **Rimuovi attributo** sulla chiave di quell'attributo, per il servizio del risultato o per l'intero progetto, lo copre quando non ha filtri, o ha esattamente il filtro che crea **Ripulisci**. Un filtro scritto da te non conta mai, per lo stesso motivo.
- **Il nome di una metrica.** Una regola della pipeline delle metriche **Scarta** per il servizio del risultato o per l'intero progetto lo copre quando ha esattamente il filtro che crea **Scarta questa metrica**, o nessun filtro, nel qual caso non memorizza nessuna metrica del servizio. Una regola così senza filtri copre ogni risultato in quelle metriche.

Una regola disattivata, o che non ripulisce nulla, non conta mai. La copertura viene ricalcolata dopo ogni scansione, quindi una regola che aggiungi o rimuovi a mano cambia ciò che è contrassegnato come ripulito entro un'ora.

## Passaggi successivi

:::cards
- [Filtri di scarto e regole di pulizia](/docs/telemetry/drop-filters-and-scrub-rules): Ogni opzione delle regole di pulizia, e le regole che scrivi tu.
- [Controlli e problemi di Sicurezza dei dati](/docs/data-security/checks-and-issues): I due controlli della telemetria e i controlli dell'IA.
- [Flussi di dati, accesso e residenza](/docs/data-security/flows-access-residency): I provider di IA e gli host a cui i tuoi servizi inviano dati.
:::
