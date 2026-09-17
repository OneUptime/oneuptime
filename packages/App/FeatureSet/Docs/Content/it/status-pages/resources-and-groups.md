# Risorse e gruppi

Una risorsa è una riga sulla tua pagina di stato — un monitor (o un gruppo di monitor) con un nome che i visitatori capiscono, uno stato attuale e, se vuoi, una percentuale di uptime e un grafico della cronologia. Un gruppo è una sezione che contiene risorse, così una pagina con quaranta monitor si legge come "API", "App web" e "Pipeline dati" invece che come un elenco infinito.

Costruisci entrambe le cose in un'unica schermata. Apri una pagina di stato e scegli **Risorse** nel menu laterale (la voce si legge **Monitor** nei progetti che non hanno i gruppi di monitor abilitati). I gruppi avevano una pagina tutta loro; non ce l'hanno più, e il vecchio URL `/groups` reindirizza qui.

Se questa parte viene bene, tutto il resto della pagina di stato è decorazione. I visitatori decidono "è un problema mio o loro?" leggendo queste righe, quindi chiamale come i clienti chiamano il tuo prodotto — **Checkout API**, non `prod-checkout-lb-healthcheck-us-east-1`.

## La schermata Risorse

La schermata è divisa in due. A sinistra c'è un navigatore che elenca tutti i gruppi della pagina; a destra c'è il contenuto del gruppo che hai selezionato.

- **Il navigatore dei gruppi (a sinistra)** — un albero di gruppi, con sopra una casella di ricerca (**Search groups...**) e sotto un conteggio aggiornato, tipo `3 groups · 12 resources`. Quando una pagina ha più gruppi di quanti ne stiano nello spazio, un pulsante **Show N more of M** mostra i restanti.
- **Top of page** — la prima riga del navigatore. Contiene le risorse che non stanno in nessun gruppo, e il suo tooltip dice esattamente che cosa significa: i visitatori vedono queste per prime, sopra ogni gruppo. Se la pagina non ha alcun gruppo, il riquadro di destra si intitola **All resources**.
- **Il riquadro delle risorse (a destra)** — porta il titolo del gruppo che hai selezionato. La sua intestazione contiene **Edit Group**, il pulsante principale **Aggiungi monitor** e un menu di overflow **More actions**.

Due pulsanti vivono nell'intestazione della scheda: **New Group** e un menu a tre puntini che contiene **Import groups from CSV** e **Aggiorna**.

La descrizione della scheda cambia con la forma della tua pagina. Con dei gruppi, dice che questo è tutto ciò che i visitatori vedono e che devi scegliere un gruppo a sinistra per modificarne il contenuto. Senza gruppi, ti invita a crearne uno per dividere in sezioni una pagina più lunga.

**Gli stati vuoti ti dicono cosa fare.** Un gruppo vuoto mostra **No monitors here yet** con **Aggiungi monitor**, **Add Multiple** e — solo quando la pagina di stato non ha alcun gruppo — **Create a Group**. Una ricerca che non trova nulla mostra **No resources match your search**. Un navigatore vuoto spiega che i gruppi dividono in sezioni una pagina di stato più lunga e che possono essere annidati.

## Aggiungere un monitor

Seleziona il gruppo in cui vuoi che la risorsa finisca (oppure **Top of page** per una riga senza gruppo), poi clicca **Aggiungi monitor**. La finestra si intitola **Add a monitor to {group}** e ha due passaggi: **Dettagli del monitor** e **Avanzato**.

In **Dettagli del monitor**:

- **Monitor** — il menu a discesa dei monitor del tuo progetto, segnaposto **Seleziona monitor**. Obbligatorio.
- **Nome visualizzato** — obbligatorio. È il testo che i visitatori leggono, ed è memorizzato separatamente dal nome del monitor, quindi puoi rinominarlo qui senza toccare il monitoraggio.
- **Descrizione** — markdown facoltativo mostrato sotto la riga. Utile per una frase che spieghi che cosa fa davvero quel servizio.

Se il tuo progetto ha i gruppi di monitor abilitati, sotto il menu a discesa compare un link **Add a Monitor Group instead.** — cliccalo e il menu **Monitor** viene sostituito da un menu **Monitor Gruppo** (**Seleziona gruppo di monitor**). Il link si trasforma allora in **Add a Monitor instead.** così puoi tornare indietro. Usa un gruppo di monitor quando vuoi che una singola riga della pagina rappresenti più controlli messi insieme.

### Aggiungerne diversi in una volta

**Add Multiple** (che nel menu **More actions** si chiama anche **Add multiple monitors**) apre **Add Multiple Monitors**. Ha gli stessi due passaggi, ma il primo è una selezione multipla **Monitor** invece di un singolo menu a discesa, e le opzioni di visualizzazione che scegli in **Avanzato** valgono per tutti i monitor selezionati. È il modo più veloce per popolare una pagina nuova.

## Le opzioni di visualizzazione di una risorsa

Il passaggio **Avanzato** è identico nel modulo di aggiunta singola e nella finestra di aggiunta multipla. Tutto qui è per singola risorsa — due righe nello stesso gruppo possono essere configurate in modo diverso.

| Campo                                                    | A che serve                                                                                            |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Tooltip** (`displayTooltip`)                           | Testo aggiuntivo mostrato accanto alla risorsa sulla tua pagina di stato. Usalo per l'ambito: "Clienti USA e UE". |
| **Mostra stato attuale della risorsa** (`showCurrentStatus`)   | Attivo per impostazione predefinita. Mostra lo stato in tempo reale — operativo, degradato, offline — accanto alla riga.           |
| **Mostra % di uptime** (`showUptimePercent`)                  | Disattivo per impostazione predefinita. Mostra una percentuale di uptime accanto alla risorsa.                                    |
| **Seleziona precisione del tempo di attività** (`uptimePercentPrecision`)   | Compare solo quando **Mostra % di uptime** è attivo. Obbligatorio, predefinito a un decimale.                              |
| **Mostra grafico cronologia stato** (`showStatusHistoryChart`) | Attivo per impostazione predefinita. Mostra il grafico a barre della cronologia di uptime giorno per giorno della risorsa.                     |

Anche **Nome visualizzato** (`displayName`) e **Descrizione** (`displayDescription`) del primo passaggio riguardano solo la visualizzazione — non cambiano mai il monitor vero e proprio.

## Percentuali di uptime e grafici cronologici

Sia **Mostra % di uptime** sia **Mostra grafico cronologia stato** dipendono da un'impostazione che sta da un'altra parte. La finestra temporale che coprono è **Mostra cronologia uptime (in giorni)**, in **Pagine di stato → la tua pagina → Avanzato → Impostazioni avanzate**, nella scheda **Impostazioni cronologia di disponibilità**. Accetta da 1 a 90 giorni e il valore predefinito è 90.

La sequenza quindi è: attivi gli interruttori risorsa per risorsa, poi imposti la finestra una volta sola per tutta la pagina.

**La precisione è una scelta di merito.** Il menu **Seleziona precisione del tempo di attività** offre `99% (No Decimal)`, `99.9% (One Decimal)`, `99.99% (Two Decimal)` e `99.999% (Three Decimal)`. Più decimali sembrano precisi e invitano a discutere sul terzo; se pubblichi uno SLA a tre nove, fermati lì.

I gruppi hanno le loro copie di questi interruttori — vedi più sotto — quindi un gruppo può mostrare una percentuale complessiva mentre i singoli monitor al suo interno restano silenziosi, o viceversa.

I colori delle barre del grafico cronologico, e quali stati del monitor contano come "down", si impostano nella schermata di branding **Pagina di panoramica**, trattata in [Branding e domini della pagina di stato](/docs/status-pages/branding-and-domains).

## Gruppi

Clicca **New Group** per aprire **Create New Status Page Group**. Il modulo ha tre passaggi: **Dettagli gruppo**, **Layout** e **Avanzato**.

**Dettagli gruppo**:

- **Nome gruppo** (`name`) — obbligatorio. È il titolo di sezione che i visitatori vedono.
- **Descrizione gruppo** (`description`) — markdown facoltativo, mostrato sotto il titolo.
- **Parent Group** (`parentStatusPageGroupId`) — facoltativo. Lascialo su **No parent group (top level)** per tenere il gruppo al livello superiore.
- **Espandi sulla pagina di stato per impostazione predefinita** (`isExpandedByDefault`) — se la sezione parte aperta o chiusa per i visitatori.

**Avanzato** rispecchia gli interruttori delle risorse a livello di gruppo:

- **Mostra stato attuale del gruppo** (`showCurrentStatus`) — attivo per impostazione predefinita. Mostra uno stato accanto al titolo del gruppo.
- **Mostra % di uptime** (`showUptimePercent`) — disattivo per impostazione predefinita, con **Seleziona precisione del tempo di attività** che compare una volta attivato.

La modifica funziona allo stesso modo: **Edit Group** nell'intestazione del riquadro, o **Edit group** nel menu della riga del navigatore, apre **Edit Status Page Group** con un pulsante **Salva modifiche**.

L'intestazione del riquadro mostra delle etichette per le impostazioni attive in quel momento — **Grid**, **Collapsed by default**, **Uptime %** — così vedi com'è configurato un gruppo senza aprire il modulo.

### Gestire un gruppo

Il menu della singola riga nel navigatore contiene **Edit group**, **Move up**, **Move down**, **Mostra ID** e **Delete group**. Il menu **More actions** del riquadro ha gli equivalenti in forma estesa — **Edit this group**, **Add a sub group**, **Move group up**, **Move group down**, **Show group ID**, **Aggiorna** e **Delete this group**. Un gruppo salvato senza nome viene mostrato come **Untitled group**, il che è un buon segnale che volevi scrivere qualcosa.

## Annidare i gruppi

I gruppi si annidano: imposta **Parent Group** sul figlio, oppure usa l'azione **Add a sub group inside this group** del navigatore. Il testo di aiuto del modulo descrive la struttura per cui è pensato — qualcosa come Unità aziendali › Regione › Mercato — e ricorda che ogni livello mostra lo stato e l'uptime complessivi di tutto ciò che sta sotto.

Quando un gruppo ha dei figli, il riquadro delle risorse mostra una riga di etichette **Sub groups** che porta direttamente a ciascun figlio, così puoi percorrere la gerarchia senza tornare al navigatore.

L'annidamento si ripaga sulle pagine grandi: un hosting provider con le regioni dentro i prodotti, o un retailer con i mercati dentro le unità di business. Su una pagina con dodici monitor, un solo livello piatto è più amichevole.

## Layout a elenco o a griglia

Il passaggio **Layout** imposta la **Modalità di visualizzazione** (`viewMode`) del gruppo, e cambia il modo in cui il gruppo viene mostrato al pubblico.

| Se vuoi…                                                     | Scegli                   |
| ------------------------------------------------------------- | ---------------------- |
| Mostrare un semplice elenco verticale di servizi, uno per riga                 | **List** (il valore predefinito) |
| Mostrare lo stesso servizio su più regioni o tenant come una matrice | **Grid**               |

Scegli **Grid** e compaiono altri quattro campi:

- **Etichetta dell'asse delle righe** — il nome della dimensione delle righe, segnaposto `Service`.
- **Valori dell'asse delle righe** — le righe vere e proprie, aggiunte una alla volta con **Add Row** (segnaposto `e.g. Auth`).
- **Etichetta dell'asse delle colonne** — la dimensione delle colonne, segnaposto `Region`.
- **Valori dell'asse delle colonne** — aggiunti con **Add Column** (segnaposto `e.g. US-East`).

Ogni monitor di un gruppo a griglia viene poi collocato in una cella, quindi la finestra di aggiunta multipla chiede la riga e la colonna insieme ai monitor, usando le etichette degli assi che hai scelto tu.

**Prepara gli assi prima di aggiungere i monitor.** Un gruppo a griglia senza righe né colonne mostra un avviso ambra che dice che non c'è dove mettere un monitor finché gli assi non esistono, con un pulsante **Set up the grid** — e il pulsante **Aggiungi monitor** resta nascosto finché non lo fai.

## Ordinare ciò che i visitatori vedono

L'ordine è esplicito, non alfabetico, e si imposta in tre posti:

- **Le risorse dentro un gruppo** — trascina una riga. Il riquadro lo dice: **Drag a row to change the order visitors see**.
- **I gruppi tra loro** — **Move up** / **Move down** nel menu della riga del navigatore, oppure **Move group up** / **Move group down** nel menu di overflow del riquadro.
- **Le risorse senza gruppo** — stanno in **Top of page** e compaiono sempre sopra ogni gruppo, quindi mettici la cosa che tutti controllano per prima.

**Due casi in cui il trascinamento è disattivato.** Filtrare il riquadro con la casella **Search in {group}...** disabilita il riordino — il riquadro te lo dice con `N of M shown · drag to reorder is off while filtering`, quindi svuota prima la ricerca. E i gruppi a griglia non supportano mai il riordino per trascinamento, perché lì la posizione viene dagli assi di righe e colonne.

Metti in cima il servizio di cui ti chiedono di più. Chi arriva sulla pagina durante un disservizio di solito smette di leggere dopo la prima schermata.

## Importare gruppi da CSV

Costruire a mano una gerarchia profonda è noioso. Il menu a tre puntini nell'intestazione della scheda ha **Import groups from CSV**, che apre la finestra **Import Groups from CSV**.

Il flusso è: **Download CSV Template** per ottenere `status-page-groups-template.csv`, lo compili, **Choose CSV File**, poi **Preview Import** per controllare che cosa verrà creato prima che venga scritto qualcosa. Poi una tabella **Import results** elenca ogni riga come **Created**, **Failed** o **Skipped** con il motivo, così una riga sbagliata non sparisce in silenzio.

Solo `name` è obbligatorio. Le colonne accettate sono:

| Colonna                   | Che cosa imposta                                         |
| ------------------------ | ---------------------------------------------------- |
| `name`                   | Il nome del gruppo. Obbligatorio.                            |
| `parentName`             | Il nome del gruppo dentro cui questo si annida.         |
| `description`            | La descrizione del gruppo.                                 |
| `isExpandedByDefault`    | Se la sezione parte aperta per i visitatori.        |
| `showCurrentStatus`      | Se accanto al titolo del gruppo compare uno stato.     |
| `showUptimePercent`      | Se accanto al gruppo compare una percentuale di uptime. |
| `uptimePercentPrecision` | Quanti decimali usa quella percentuale.        |
| `viewMode`               | `List` oppure `Grid`.                                    |
| `rowAxisLabel`           | Il nome della dimensione delle righe per un gruppo a griglia.                 |
| `rowAxisValues`          | I valori delle righe per un gruppo a griglia.                     |
| `columnAxisLabel`        | Il nome della dimensione delle colonne per un gruppo a griglia.              |
| `columnAxisValues`       | I valori delle colonne per un gruppo a griglia.                  |

L'importazione crea gruppi, non risorse — i monitor si aggiungono dopo, con **Aggiungi monitor** o **Add Multiple**.

## Dove leggere ora

- [Panoramica delle pagine di stato](/docs/status-pages/index) — che cos'è una pagina di stato e come si incastrano i pezzi.
- [Branding e domini della pagina di stato](/docs/status-pages/branding-and-domains) — logo, favicon, colori del grafico e come mettere la pagina sul tuo dominio.
- [Iscritti e annunci](/docs/status-pages/subscribers) — chi viene avvisato quando queste risorse cambiano.
- [API pubblica](/docs/status-pages/public-api) — leggere i dati della pagina di stato in modo programmatico.
- [Stati e gravità degli incidenti](/docs/incidents/states-and-severities) — che cosa fa comparire un incidente sulla pagina e che cosa lo fa sparire.
