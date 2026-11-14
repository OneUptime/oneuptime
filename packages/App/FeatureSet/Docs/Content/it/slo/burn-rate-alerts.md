# Avvisi e incidenti di tasso di consumo

I budget di errore ti dicono a che punto sei; le regole del tasso di consumo ti dicono quando alzarti dal letto. Quando uno SLO spende il suo budget di errore abbastanza in fretta da contare, una regola del tasso di consumo genera un avviso, dichiara un incidente o entrambe le cose, con titolo e descrizione tuoi, gravità, proprietari, etichette, escalation di reperibilità e notifiche dell'area di lavoro.

:::cards
- [Come decide una regola](#come-una-regola-decide-di-scattare): Due finestre, entrambe sopra la soglia.
- [Regole predefinite](#regole-predefinite): Fast burn, Slow burn e Slow leak, adattate alla finestra dello SLO.
- [Creare una regola](#creare-o-modificare-una-regola): Cinque passi nella pagina Burn Rate Rules dello SLO.
- [Variabili del modello](#cosa-dice-ogni-avviso-e-incidente): Scrivi titoli e descrizioni tuoi.
:::

## Cosa significa tasso di consumo

Il tasso di consumo è la velocità con cui spendi il budget di errore rispetto a un ritmo regolare:

```text
burn rate = (share of time that was bad) ÷ (share of time the target allows to be bad)
```

Con un tasso di consumo di 1 spendi il budget esattamente lungo la finestra e raggiungi l'obiettivo senza nulla di avanzo. Numeri più alti lo esauriscono prima. Per uno SLO al 99,9% su 30 giorni:

| Tasso di consumo, se dura | Budget esaurito in |
| --- | --- |
| 1 | 30 giorni |
| 2 | 15 giorni |
| 6 | 5 giorni |
| 14.4 | circa 2 giorni (50 ore) |

Il tasso di consumo non dipende da quanto budget resta. Risponde a «quanto è grave adesso?», ed è ciò che serve per decidere se avvisare qualcuno.

Per agire invece in base a quanto budget resta, per esempio rilasciando solo lavoro di affidabilità quando ne resta un quarto, dai allo SLO una [policy del budget di errore](/docs/slo/error-budget-policy).

## Come una regola decide di scattare

OneUptime controlla ogni regola del tasso di consumo abilitata a ogni valutazione dello SLO, ogni 5 minuti. Ogni regola misura il tasso di consumo su due finestre e scatta solo quando entrambe sono alla sua soglia o sopra:

- La **finestra lunga** (per esempio 1 ora) mostra che il consumo è prolungato e significativo, non un singolo controllo fallito.
- La **finestra breve** (per esempio 5 minuti) mostra che sta ancora succedendo. Senza di essa, un picco di un'ora fa continuerebbe ad avvisare molto dopo il recupero.

È lo schema a più finestre e più tassi di consumo del Google SRE Workbook, e quello che OneUptime imposta per te.

```mermaid title="Cosa fa una regola del tasso di consumo a ogni valutazione"
flowchart TB
    start["Lo SLO viene valutato"] --> long(["Finestra lunga<br/>alla soglia<br/>o sopra?"])
    long -->|"No"| recover["Risolvere ciò che è<br/>aperto, se la risoluzione<br/>automatica è attiva"]
    long -->|"Sì"| short(["Finestra breve<br/>alla soglia<br/>o sopra?"])
    short -->|"No"| hold["Lasciare aperto<br/>ciò che è aperto"]
    short -->|"Sì"| fire["Generare l'avviso,<br/>dichiarare l'incidente<br/>o entrambi"]
```

Una regola non può scattare finché lo SLO non ha una finestra lunga completa di cronologia di monitoraggio: altrimenti il primissimo controllo fallito di un monitor, diviso per pochi minuti di cronologia, darebbe un tasso di consumo enorme. Quindi un nuovo SLO non può far scattare la sua regola **Fast burn** nella prima ora, né la sua regola **Slow burn** nelle prime sei, né la sua regola **Slow leak** nei primi tre giorni. Se in seguito uno SLO non ha più tanta cronologia, per esempio dopo che i suoi monitor sono stati sostituiti con altri nuovi, la regola risolve ciò che ha aperto invece di lasciarlo in sospeso. Una regola non scatta nemmeno mentre uno dei monitor dello SLO è in una manutenzione pianificata: vedi [Manutenzione pianificata](#manutenzione-pianificata).

## Regole predefinite

Ogni nuovo SLO riceve tre regole del tasso di consumo. Per una finestra di 30 giorni:

| Regola | Soglia | Finestra lunga | Finestra breve | Scatta quando |
| --- | --- | --- | --- | --- |
| **Fast burn** | 14.4× | 1 ora | 5 minuti | Circa il 2% del budget si consuma in un'ora: finirebbe in circa 2 giorni. |
| **Slow burn** | 6× | 6 ore | 30 minuti | Circa il 5% del budget si consuma in sei ore: finirebbe in circa 5 giorni. |
| **Slow leak** | 1× | 3 giorni | 6 ore | Circa il 10% del budget si consuma in tre giorni: finirebbe entro la fine della finestra. |

Fast burn e Slow burn servono ad avvisare qualcuno: generano un avviso con la gravità di avviso più alta del progetto. Slow leak serve come ticket: genera il suo avviso con la gravità di avviso più bassa del progetto. Rileva un consumo costante che non raggiunge mai la soglia delle altre due: a 3×, il budget di uno SLO al 99,9% finisce in 10 giorni, eppure scatta solo Slow leak. Dopo che il suo avviso si è risolto, aspetta 24 ore, non la sua finestra lunga di 3 giorni, prima di generarne un altro.

Le soglie sono calcolate per un budget di 30 giorni, quindi OneUptime le adatta alla finestra del tuo SLO. Fast burn e Slow burn significano sempre «il 2% del budget in 1 ora» e «il 5% del budget in 6 ore»:

| Finestra dello SLO | Soglia di Fast burn | Soglia di Slow burn |
| --- | --- | --- |
| 7 giorni | 3.36× | 1.4× |
| 28 giorni | 13.44× | 5.6× |
| 30 giorni | 14.4× | 6× |
| 90 giorni | 43.2× | 18× |

Slow leak significa sempre «il 10% del budget nella sua finestra lunga». Su una finestra di 30 giorni o più, le sue finestre restano di 3 giorni e 6 ore e la sua soglia cresce con la finestra. Su una finestra più breve, la sua finestra lunga è un decimo della finestra dello SLO e la sua finestra breve un dodicesimo di questa, quindi la sua soglia resta a 1×. Se la sua finestra lunga restasse di 3 giorni, la soglia scenderebbe sotto 1× e la regola scatterebbe per uno SLO che è sulla buona strada per raggiungere il suo obiettivo.

| Finestra dello SLO | Soglia di Slow leak | Finestra lunga | Finestra breve |
| --- | --- | --- | --- |
| 7 giorni | 1× | 16,8 ore | 84 minuti |
| 28 giorni | 1× | 2,8 giorni | 5,6 ore |
| 30 giorni | 1× | 3 giorni | 6 ore |
| 90 giorni | 3× | 3 giorni | 6 ore |

Gli SLO a mese di calendario ricevono i valori di 30 giorni. Le regole usano il titolo e la descrizione predefiniti, risolvono automaticamente i loro avvisi e non aggiungono proprietari né etichette. Nessuna di esse dichiara un incidente, quindi aggiornare OneUptime non inizia mai a dichiarare incidenti al posto tuo. Modificale, eliminale o aggiungine di tue.

### Aggiungere le regole consigliate a uno SLO esistente

Gli SLO creati prima che esistesse Slow leak hanno solo Fast burn e Slow burn: aggiornare OneUptime non aggiunge mai da solo una regola che inizierebbe a generare avvisi. Finché a uno SLO manca una delle tre regole predefinite, la sua pagina **Regole di tasso di consumo** le nomina in una nota sopra la tabella. Fai clic su **Aggiungi regole consigliate** nella nota per vedere esattamente cosa aggiunge, adattato alla finestra dello SLO, e conferma. Aggiunge solo le regole mancanti, e un nuovo clic non aggiunge nulla.

Una regola conta come presente quando lo SLO ha una regola con lo stesso nome, o una con la stessa finestra lunga, che sia attiva o no. Così una regola predefinita che hai rinominato o regolato non viene mai aggiunta due volte. Perché la nota smetta di proporre una regola predefinita che non vuoi, tieni la regola e disabilitala invece di eliminarla. Ti serve il permesso di creare regole del tasso di consumo degli SLO. Ogni regola aggiunta così viene pubblicata nel feed dello SLO e registrata nei suoi registri di audit, come una regola che crei tu.

### Aggiungerle a molti SLO in una volta

Per dare le regole consigliate a molti SLO, parti dall'elenco degli SLO invece che dalla pagina di ogni singolo SLO.

:::steps
#### Selezionare gli SLO

Apri **SLOs** e seleziona gli SLO da aggiornare. Per prendere tutti gli SLO mostrati da un filtro, seleziona l'intera pagina, poi tutte le corrispondenze che l'elenco propone.

#### Scegliere l'azione di massa

Apri **Azioni di massa** e scegli **Aggiungi regole consigliate**.

#### Controllare cosa aggiunge e confermare

Prima di aggiungere qualsiasi cosa, la conferma conta quanti degli SLO selezionati ricevono ciascuna regola, adattata alle loro finestre. Quando più SLO con finestre diverse ricevono una regola in varianti diverse, come Slow leak su uno SLO di 7 giorni e su uno di 30 giorni, elenca ogni variante con la sua soglia, le sue finestre e gli SLO che la ricevono. Dice anche quanti hanno già tutte le regole consigliate e quanti non è stato possibile leggere. Fai clic su **Aggiungi regole consigliate** per aggiungerle.
:::

Ogni SLO riceve solo le regole che gli mancano, esattamente come le aggiungerebbe la sua pagina **Regole di tasso di consumo**: lo stesso controllo di cosa conta come presente, e un elemento del feed e una voce nei registri di audit per ogni regola. Il risultato dice, per ogni SLO, se sono state aggiunte regole, se aveva già tutte le regole consigliate oppure se non è stato modificato e perché, per esempio uno SLO che non puoi modificare. Uno SLO non modificato non blocca mai gli altri, e ripetere l'azione sugli stessi SLO non aggiunge nulla. Gli SLO archiviati non compaiono nell'elenco e le regole non vengono mai proposte per loro, perché non vengono valutati: prima annulla l'archiviazione dello SLO.

Gli script possono fare lo stesso tramite l'API, con una [chiave API](/docs/api-reference/api-reference) del progetto. Le richieste per un solo SLO accettano `{ "serviceLevelObjectiveId": "..." }` e rispondono con le regole in `rules`. Le richieste di massa accettano `{ "serviceLevelObjectiveIds": ["..."] }`, al massimo 100 SLO per richiesta, e rispondono con una voce per ogni SLO in `results`, nell'ordine richiesto:

| Richiesta | Cosa fa |
| --- | --- |
| `POST /api/service-level-objective-burn-rate-rule/recommended-rules` | Elenca le regole consigliate che mancano allo SLO. Non salva nulla. |
| `POST /api/service-level-objective-burn-rate-rule/recommended-rules/add` | Le aggiunge ed elenca cosa ha aggiunto. Ripetere la richiesta non aggiunge nulla. |
| `POST /api/service-level-objective-burn-rate-rule/recommended-rules/bulk` | Dice cosa manca a ogni SLO: `Missing` con le regole, `NothingMissing` o `Refused` per uno SLO che non puoi leggere. Non salva nulla. |
| `POST /api/service-level-objective-burn-rate-rule/recommended-rules/bulk/add` | Aggiunge ciò che manca a ogni SLO, uno SLO dopo l'altro: `Added` con le regole, `NothingMissing`, `Refused` o `Failed` con le regole aggiunte prima dell'errore. Ripetere la richiesta aggiunge solo ciò che manca ancora. |

## Creare o modificare una regola

Ti serve il permesso di creare regole del tasso di consumo degli SLO.

:::steps
### Aprire Burn Rate Rules

Apri lo SLO, vai a **Regole di tasso di consumo** nella sezione **Regole** del suo menu laterale e fai clic su **Crea: Regola di tasso di consumo dello SLO**, oppure modifica una delle regole predefinite.

### Dare un nome alla regola

In **Regola**, inserisci un **Nome**, come «Fast burn». Una nuova regola è attiva; per non farla più scattare in seguito, disattiva **Abilitato** nel suo modulo di modifica.

### Impostare la finestra di consumo

In **Finestra di consumo**, imposta la **Soglia del tasso di consumo** (per esempio `14.4`), la **Finestra lunga (minuti)** e la **Finestra breve (minuti)**, e se vuoi la **Soppressione della riattivazione (minuti)**.

### Scegliere cosa dichiara

In **Cosa dichiara**, rispondi a **Quando scatta**: **Crea un avviso**, la scelta predefinita, **Dichiara un incidente** o **Entrambi**. **Aggiungi i proprietari dello SLO come proprietari** rende anche i proprietari dello SLO proprietari di tutto ciò che la regola crea.

### Descrivere l'avviso e l'incidente

I passi **Avviso** e **Incidente** compaiono solo per ciò che la regola dichiara. Ognuno ha un titolo e una gravità, e sezioni chiuse: **Descrizione**, **Proprietà ed etichette**, **Reperibilità** e **Altri campi**, che contiene risoluzione automatica, privacy e note di correzione. Le nuove regole partono con il titolo e la descrizione predefiniti, pronti da modificare. Fai clic su **Crea: Regola di tasso di consumo dello SLO** nell'ultimo passo.
:::

OneUptime controlla i numeri di una regola quando la salvi:

| Impostazione | Deve essere |
| --- | --- |
| **Soglia del tasso di consumo** | Maggiore di 0. |
| **Finestra breve (minuti)** | Maggiore di 0. |
| **Finestra lunga (minuti)** | Più lunga della finestra breve. |
| **Soppressione della riattivazione (minuti)** | 0 o più. Vuoto significa la durata della finestra lunga. |

Ogni risposta a **Quando scatta** apre qualcosa. L'API rifiuta una regola che non creerebbe alcun avviso né dichiarerebbe alcun incidente, perché verrebbe controllata a ogni valutazione senza dichiarare mai nulla.

La tabella delle regole mostra per ogni regola la soglia, le finestre e la soppressione, cosa dichiara (e se l'avviso o l'incidente si risolve solo a mano, o è privato), le gravità, le politiche di reperibilità, i proprietari e le etichette.

> [!TIP]
> Un buon punto di partenza: tieni le tre regole predefinite, manda la regola di consumo rapido alla tua politica di reperibilità che avvisa, con gravità alta, lascia che la regola di consumo lento generi un avviso di gravità più bassa per l'orario di lavoro, e usa la regola di perdita lenta come ticket per il team responsabile. Se il tuo team gestisce tutto con gli incidenti, scegli **Dichiara un incidente** per la regola di consumo rapido, o **Entrambi** per ricevere anche un avviso.

## Cosa dichiara una regola

|  | **Avviso** | **Incidente** |
| --- | --- | --- |
| Aperto da | **Crea un avviso**, la scelta predefinita, o **Entrambi** | **Dichiara un incidente** o **Entrambi** |
| Cos'è | Il segnale leggero: finisce nell'elenco degli avvisi. | Il segnale pesante: prende un numero di incidente e avvia tutto il flusso di risposta. |
| Titolo e descrizione | I propri, o il testo predefinito | I propri, o il testo predefinito |
| Gravità | **Gravità avviso**: la più alta del progetto se vuota | **Gravità incidente**: la più alta del progetto se vuota |
| Escalation | **Policy di reperibilità dell'avviso** | **Policy di reperibilità dell'incidente** |
| Proprietari ed etichette | **Proprietari dell'avviso** e **Etichette dell'avviso** | **Proprietari dell'incidente** e **Etichette dell'incidente** |
| Privato | Disattivato | Disattivato |
| Risoluzione automatica | Attiva | Attiva |
| Pagine di stato | Mai pubblicato | Mai pubblicato |

Poiché ognuno si configura separatamente, puoi mandare un avviso breve alla rotazione del team responsabile e un incidente dettagliato alla tua rotazione per gli incidenti gravi. Vivono anche separatamente: ognuno viene deduplicato, risolto e soppresso per conto suo, quindi risolvere l'incidente non azzera la soppressione dell'avviso, né il contrario.

### Lo SLO è una risorsa interessata

Ogni avviso e incidente creato da una regola del tasso di consumo elenca il suo SLO in **Risorse interessate** e vi rimanda. Il filtro **Risorse interessate** degli elenchi di avvisi e incidenti li limita a uno SLO, e le pagine **Avvisi** e **Incidenti** dello SLO li elencano, con badge nel menu laterale che contano quelli aperti. OneUptime crea questo collegamento da solo, e modificare l'avviso o l'incidente non lo rimuove mai.

### Gli incidenti di tasso di consumo restano interni

Un budget di errore che si consuma in fretta è un segnale per l'ingegneria, non un'interruzione dichiarata. Un incidente di tasso di consumo non viene mai mostrato sulle pagine di stato e non avvisa mai gli iscritti alle pagine di stato. Non è nemmeno collegato a nessun monitor, perché risolverlo riscriverebbe altrimenti proprio la cronologia di stato dei monitor da cui si misura lo SLO.

Se risolvi un incidente del genere a mano, niente lo dichiara di nuovo finché il consumo non si è ripreso e la regola non scatta davvero di nuovo, così non ti ritrovi mai a lottare contro la regola mentre lavori a un incidente.

## Cosa dice ogni avviso e incidente

Le nuove regole partono con il titolo e la descrizione predefiniti, sia nell'avviso sia nell'incidente. Svuota un titolo o una descrizione per tornare al testo predefinito. Il titolo predefinito è:

```text
SLO burn rate: {{sloName}} — {{ruleName}}
```

La descrizione predefinita nomina la regola, indica il tasso di consumo di entrambe le finestre rispetto alla soglia e il budget di errore rimanente.

Per scrivere i tuoi, usa le variabili del modello nel titolo, nella descrizione e nelle note di correzione. Ognuno di questi campi le elenca in **Variabili del modello**: fai clic su una per inserirla dove si trova il cursore, oppure digita `{{` nel campo e scegline una. La descrizione e le note di correzione hanno anche **Inserisci variabile** nella barra degli strumenti. Le variabili vengono compilate quando la regola scatta:

| Variabile | Cosa contiene | Esempio |
| --- | --- | --- |
| `{{sloName}}` | Nome dello SLO. | `Checkout availability` |
| `{{sloId}}` | ID dello SLO. | `b7f4c2d8-1f3e-4a5b-9c6d-7e8f9a0b1c2d` |
| `{{sloLink}}` | Link allo SLO nella dashboard di OneUptime. | `https://oneuptime.com/dashboard/project-id/slos/slo-id` |
| `{{sloStatus}}` | Stato dello SLO dopo questa valutazione. | `At Risk` |
| `{{ruleName}}` | Nome della regola del tasso di consumo che è scattata. | `Fast burn` |
| `{{burnRateThreshold}}` | La soglia del tasso di consumo della regola (un multiplo del ritmo sostenibile). | `14.4` |
| `{{longWindowBurnRate}}` | Tasso di consumo misurato sulla finestra lunga della regola. | `21.5` |
| `{{shortWindowBurnRate}}` | Tasso di consumo misurato sulla finestra breve della regola. | `36` |
| `{{longWindowInMinutes}}` | Durata della finestra lunga della regola, in minuti. | `60` |
| `{{shortWindowInMinutes}}` | Durata della finestra breve della regola, in minuti. | `5` |
| `{{targetPercentage}}` | L'obiettivo dello SLO, in percentuale. | `99.9` |
| `{{currentSliPercentage}}` | Lo SLI misurato sulla finestra di conformità dello SLO, in percentuale. | `99.87` |
| `{{errorBudgetRemainingPercentage}}` | Quota del budget di errore ancora disponibile, in percentuale. Negativa quando il budget è superato. | `42.5` |
| `{{errorBudgetRemaining}}` | Budget di errore ancora disponibile, come durata. Inizia con un segno meno quando il budget è superato. | `18m 22s` |
| `{{errorBudgetRemainingMinutes}}` | Budget di errore ancora disponibile, in minuti. | `18.37` |
| `{{windowDescription}}` | La finestra di conformità dello SLO, a parole. | `rolling 30-day window` |
| `{{policyTier}}` | Nome del livello della policy del budget di errore in cui si trova lo SLO dopo questa valutazione. "None" quando non è in nessun livello. | `Reliability first` |
| `{{policyTierThresholdPercentage}}` | Soglia di budget rimanente di quel livello, in percentuale. Vuota quando lo SLO non è in nessun livello. | `25` |
| `{{policyTierWhatWeDo}}` | Cosa il team ha concordato di fare in quel livello, come è scritto nel livello. Vuoto quando lo SLO non è in nessun livello. | `Only reliability work and critical fixes ship.` |

Per esempio, il titolo `{{ruleName}}: {{sloName}} is burning {{longWindowBurnRate}}x` diventa `Fast burn: Checkout availability is burning 21.5x`.

:::details Come vengono compilate le variabili
- I numeri sono arrotondati a due decimali.
- Gli spazi dentro le parentesi graffe vanno bene: `{{ sloName }}` funziona.
- Una variabile scritta male resta esattamente com'è, così un errore di battitura si vede nell'avviso invece di sparire in silenzio.
- I titoli possono avere 500 caratteri, e le descrizioni e le note di correzione 50.000. Un titolo che supera i 500 caratteri dopo la compilazione delle variabili viene messo su una riga e accorciato con i puntini di sospensione, così l'avviso o l'incidente viene creato comunque.
- Se il link allo SLO non si può costruire quando la regola scatta, `{{sloLink}}` resta vuoto e l'avviso o l'incidente viene creato comunque.
:::

## Proprietari, etichette e privacy

- **Proprietari dell'avviso** e **Proprietari dell'incidente** sono persone e team, scelti da un solo elenco con **Aggiungi proprietario**. Vengono aggiunti all'avviso o all'incidente appena viene creato, e ricevono una notifica. Le persone devono essere membri del progetto.
- **Aggiungi i proprietari dello SLO come proprietari** aggiunge anche i proprietari dello SLO, i suoi utenti proprietari e i membri dei suoi team proprietari, a tutto ciò che la regola crea. I proprietari dello SLO sanno già dei cambi di stato dello SLO stesso, quindi questo può avvisarli due volte. È disattivato per impostazione predefinita.
- Ogni proprietario viene aggiunto una volta: un utente che è già proprietario dell'avviso o dell'incidente, per esempio tramite le regole del proprietario del progetto, o che è in un team proprietario aggiunto, non viene aggiunto di nuovo.
- **Etichette dell'avviso** e **Etichette dell'incidente** vengono aggiunte all'avviso o all'incidente, così filtri, regole del proprietario e regole di notifica dell'area di lavoro possono corrispondere.
- Un avviso o un incidente privato è visibile solo ai suoi proprietari, agli amministratori del progetto e ai proprietari del progetto.

Etichette, team proprietari e politiche di reperibilità devono appartenere al progetto dello SLO.

## Risoluzione e soppressione dei nuovi scatti

- **La risoluzione segue la finestra lunga.** Con la risoluzione automatica attiva (impostazione predefinita), OneUptime risolve l'avviso e l'incidente di una regola appena il tasso di consumo della finestra lunga scende sotto la soglia. Risolvere sulla finestra breve farebbe oscillare: un'interruzione ricorrente si risolverebbe dopo cinque minuti tranquilli e avviserebbe di nuovo tutta la notte.
- **Risoluzione automatica disattivata.** Disattiva **Risoluzione automatica dell'avviso** o **Risoluzione automatica dell'incidente** e quel record resta aperto finché qualcuno non lo risolve, anche dopo che il consumo si è ripreso. La regola non ne apre un altro sopra, e una volta risolto a mano e con la finestra lunga sotto la soglia, la regola può scattare di nuovo dopo la sua soppressione.
- **Soppressione dei nuovi scatti.** Dopo che un record si risolve, la regola non dichiara più quel tipo di record per il periodo di soppressione, per impostazione predefinita la durata della finestra lunga. Così un sistema che si sta riprendendo ha il tempo di farlo senza avvisare per il rumore che resta. Slow leak viene creata con 24 ore invece della sua finestra lunga di 3 giorni, così una perdita che si ripresenta viene segnalata di nuovo il giorno dopo.

Alcune modifiche risolvono sempre ciò che una regola ha aperto, qualunque cosa dicano le sue impostazioni di risoluzione automatica, così niente continua a scalare per una regola che non può più giustificarlo:

- cambiare **Quando scatta** per togliere l'avviso o l'incidente chiude ciò che quell'uscita aveva aperto;
- disattivare la regola o eliminarla;
- disattivare la valutazione dello SLO, archiviare lo SLO o eliminarlo;
- il passaggio dello SLO a **In pausa** o **Configurato male**, perché allora non misura nulla;
- la perdita della soglia o delle finestre della regola, o il fatto che lo SLO non abbia più una finestra lunga completa di cronologia.

## Manutenzione pianificata

Mentre un monitor dello SLO è in un evento di manutenzione in corso, le sue regole del tasso di consumo non generano avvisi né dichiarano incidenti: il lavoro pianificato non deve avvisare nessuno. Ciò che le regole hanno già aperto si risolve comunque come al solito. Il tempo conta comunque nel budget di errore, secondo gli stati di inattività dello SLO.

## Il feed dello SLO

Il **Feed** dello SLO pubblica ogni avviso generato da una regola e ogni incidente che dichiara, con un link e i tassi di consumo che lo spiegano, e quando ognuno si risolve, automaticamente o a mano. Un record che la regola riprende perché era ancora aperto non viene pubblicato due volte. Anche creare, modificare ed eliminare una regola viene pubblicato, e registrato nei **Registri di audit** dello SLO. Vedi [Feed e registri di audit degli SLO](/docs/slo/feed-and-audit-logs).

## Risoluzione dei problemi

:::details Una regola non è scattata subito dopo la creazione dello SLO
Una regola scatta solo quando lo SLO ha una finestra lunga completa di cronologia di monitoraggio: un'ora per la regola di consumo rapido predefinita, sei ore per quella di consumo lento e tre giorni per quella di perdita lenta, oppure un decimo della finestra dello SLO quando questa è più breve di 30 giorni.
:::

:::details Un avviso si è risolto mentre l'interruzione era ancora in corso
La risoluzione automatica segue la finestra lunga: appena il tasso di consumo della finestra lunga scende sotto la soglia, l'avviso si risolve. Dai alla regola una finestra lunga più lunga, oppure disattiva **Risoluzione automatica dell'avviso** e risolvi l'avviso a mano.
:::

:::details Non è scattato nulla durante un evento di manutenzione
Le regole del tasso di consumo restano in silenzio mentre uno dei monitor dello SLO è in un evento di manutenzione in corso. L'inattività conta comunque nel budget.
:::

:::details Esiste un numero minimo di campioni?
Non per gli SLO misurati dalla disponibilità dei monitor. La disponibilità si misura in secondi, quindi ogni secondo della finestra è un campione e non c'è un caso di traffico basso da cui proteggersi. Un numero minimo di campioni conta solo per gli SLI basati su eventi, che non sono ancora disponibili.
:::

## Passi successivi

:::cards
- [Budget di errore](/docs/slo/error-budget): Cos'è il budget e quanto dura.
- [Policy del budget di errore](/docs/slo/error-budget-policy): Agire in base a quanto budget resta, livello per livello.
- [Regole di escalation](/docs/on-call/escalation-rules): Chi viene avvisato, e in quale ordine.
- [Feed e registri di audit degli SLO](/docs/slo/feed-and-audit-logs): Ogni avviso e incidente generato da una regola.
:::
