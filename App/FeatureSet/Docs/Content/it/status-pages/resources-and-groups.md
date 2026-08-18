# Risorse e Gruppi

Una risorsa è una riga sulla tua pagina di stato — un monitor (o un gruppo di monitor) con un nome comprensibile per i visitatori, uno stato attuale e, facoltativamente, un numero di uptime e un grafico della cronologia. Un gruppo è una sezione che contiene risorse, così una pagina con quaranta monitor si presenta come "API", "Web app" e "Data pipeline" invece che come un unico elenco infinito.

Costruisci entrambi su un'unica schermata. Apri una pagina di stato e seleziona **Resources** nel menu laterale (la voce si legge **Monitors** nei progetti che non hanno i gruppi di monitor abilitati). I gruppi un tempo vivevano in una pagina a sé; ora non più, e il vecchio URL `/groups` reindirizza semplicemente qui.

Fai bene questa parte e il resto della pagina di stato è decorazione. I visitatori giudicano "sono io o è colpa loro?" da queste righe, quindi chiamale come i tuoi clienti parlano del tuo prodotto — **Checkout API**, non `prod-checkout-lb-healthcheck-us-east-1`.

## La schermata Resources

La schermata è divisa in due. A sinistra c'è un navigatore che elenca ogni gruppo della pagina; a destra c'è il contenuto del gruppo selezionato.

- **Il navigatore dei gruppi (sinistra)** — un albero di gruppi, con una casella di ricerca (**Search groups...**) sopra e un conteggio in tempo reale sotto, come `3 groups · 12 resources`. Quando una pagina ha più gruppi di quanti ne entrino, un pulsante **Show N more of M** rivela il resto.
- **Top of page** — la prima riga nel navigatore. Contiene le risorse che non appartengono a nessun gruppo, e il suo tooltip spiega esattamente cosa significa: i visitatori le vedono per prime, sopra ogni gruppo. Se la pagina non ha alcun gruppo, il riquadro a destra si intitola invece **All resources**.
- **Il riquadro delle risorse (destra)** — intitolato con il gruppo selezionato. La sua intestazione porta **Edit Group**, il pulsante primario **Add Monitor** e un menu a comparsa **More actions**.

Due pulsanti vivono nell'intestazione della card stessa: **New Group**, e un menu a tre puntini che contiene **Import groups from CSV** e **Refresh**.

La descrizione della card cambia in base alla forma della tua pagina. Con dei gruppi, indica che questo è tutto ciò che vedono i visitatori e di scegliere un gruppo a sinistra per modificarne il contenuto. Senza ancora gruppi, ti spinge a crearne uno per dividere una pagina lunga in sezioni.

**Gli stati vuoti ti dicono cosa fare.** Un gruppo vuoto mostra **No monitors here yet** con **Add Monitor**, **Add Multiple** e — solo quando la pagina di stato non ha alcun gruppo — **Create a Group**. Una ricerca che non trova nulla mostra **No resources match your search**. Un navigatore vuoto dice che i gruppi dividono una pagina di stato più lunga in sezioni e che possono essere annidati.

## Aggiungere un monitor

Seleziona il gruppo in cui vuoi che finisca la risorsa (oppure **Top of page** per una riga senza gruppo), quindi fai clic su **Add Monitor**. La finestra modale si intitola **Add a monitor to {group}** e ha due passaggi: **Monitor Details** e **Advanced**.

Su **Monitor Details**:

- **Monitor** — il menu a tendina dei monitor nel tuo progetto, segnaposto **Select Monitor**. Obbligatorio.
- **Display Name** — obbligatorio. Questo è il testo che leggono i visitatori, ed è memorizzato separatamente dal nome del monitor stesso, così puoi rinominarlo qui senza toccare il monitoraggio.
- **Description** — markdown facoltativo mostrato sotto la riga. Utile per una frase che spieghi cosa fa davvero il servizio.

Se il tuo progetto ha i gruppi di monitor abilitati, un collegamento sotto il menu a tendina si legge **Add a Monitor Group instead.** — fai clic e il menu a tendina **Monitor** viene sostituito da un menu a tendina **Monitor Group** (**Select Monitor Group**). Il collegamento passa poi a **Add a Monitor instead.** così puoi tornare indietro. Usa un gruppo di monitor quando vuoi che una riga della pagina rappresenti più controlli riuniti insieme.

### Aggiungerne diversi in una volta

**Add Multiple** (anche **Add multiple monitors** nel menu **More actions**) apre **Add Multiple Monitors**. Ha gli stessi due passaggi, ma il primo è una selezione multipla **Monitors** invece di un unico menu a tendina, e le opzioni di visualizzazione scelte su **Advanced** si applicano a ogni monitor selezionato. È il modo più veloce per popolare una nuova pagina.

## Opzioni di visualizzazione su una risorsa

Il passaggio **Advanced** è lo stesso nel modulo di aggiunta singola e nella finestra modale in blocco. Tutto qui è per singola risorsa — due righe nello stesso gruppo possono essere configurate diversamente.

| Campo                                                     | Scopo                                                                                                     |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Tooltip** (`displayTooltip`)                              | Testo aggiuntivo mostrato accanto alla risorsa sulla tua pagina di stato. Usalo per l'ambito: "US and EU customers". |
| **Show Current Resource Status** (`showCurrentStatus`)      | Attivo per impostazione predefinita. Mostra lo stato in tempo reale — operativo, degradato, offline — accanto alla riga. |
| **Show Uptime %** (`showUptimePercent`)                     | Disattivo per impostazione predefinita. Mostra una percentuale di uptime accanto alla risorsa.               |
| **Select Uptime Precision** (`uptimePercentPrecision`)      | Appare solo quando **Show Uptime %** è attivo. Obbligatorio, predefinito a un decimale.                      |
| **Show Status History Chart** (`showStatusHistoryChart`)    | Attivo per impostazione predefinita. Mostra il grafico a barre della cronologia uptime giorno per giorno per la risorsa. |

Anche **Display Name** (`displayName`) e **Description** (`displayDescription`) del primo passaggio sono solo di visualizzazione — non modificano mai il monitor stesso.

## Percentuali di uptime e grafici della cronologia

Sia **Show Uptime %** che **Show Status History Chart** dipendono da un'impostazione che vive altrove. La finestra temporale che coprono è **Show Uptime History (in days)** sotto **Status Pages → your page → Advanced → Advanced Settings**, nella card **Uptime History Settings**. Accetta da 1 a 90 giorni e il valore predefinito è 90.

Quindi la sequenza è: attiva gli interruttori per singola risorsa, poi imposta la finestra temporale una sola volta per l'intera pagina.

**La precisione è una scelta di giudizio.** Il menu a tendina **Select Uptime Precision** offre `99% (No Decimal)`, `99.9% (One Decimal)`, `99.99% (Two Decimal)` e `99.999% (Three Decimal)`. Più decimali sembrano più precisi e invitano a discussioni sul terzo; se pubblichi un SLA a tre nove, allinea a quello e non oltre.

I gruppi hanno le proprie copie di questi interruttori — vedi sotto — così un gruppo può mostrare una percentuale aggregata mentre i singoli monitor al suo interno restano silenziosi, o viceversa.

I colori delle barre del grafico della cronologia, e quali stati dei monitor contano come "down", si impostano nella schermata di branding **Overview Page**, trattata in [Branding e domini della pagina di stato](/docs/status-pages/branding-and-domains).

## Gruppi

Fai clic su **New Group** per aprire **Create New Status Page Group**. Il modulo ha tre passaggi: **Group Details**, **Layout** e **Advanced**.

**Group Details**:

- **Group Name** (`name`) — obbligatorio. È il titolo di sezione che vedono i visitatori.
- **Group Description** (`description`) — markdown facoltativo, mostrato sotto il titolo.
- **Parent Group** (`parentStatusPageGroupId`) — facoltativo. Lascialo su **No parent group (top level)** per mantenere il gruppo al livello superiore.
- **Expand on Status Page by Default** (`isExpandedByDefault`) — se la sezione si apre espansa o compressa per i visitatori.

**Advanced** rispecchia gli interruttori delle risorse a livello di gruppo:

- **Show Current Group Status** (`showCurrentStatus`) — attivo per impostazione predefinita. Mostra uno stato accanto al titolo del gruppo.
- **Show Uptime %** (`showUptimePercent`) — disattivo per impostazione predefinita, con **Select Uptime Precision** che appare una volta attivato.

La modifica funziona allo stesso modo: **Edit Group** nell'intestazione del riquadro, oppure **Edit group** nel menu della riga del navigatore, apre **Edit Status Page Group** con un pulsante **Save Changes**.

L'intestazione del riquadro mostra dei chip per le impostazioni attualmente attive — **Grid**, **Collapsed by default**, **Uptime %** — così puoi vedere come è configurato un gruppo senza aprire il modulo.

### Gestire un gruppo

Il menu per riga del navigatore contiene **Edit group**, **Move up**, **Move down**, **Show ID** e **Delete group**. Il menu **More actions** del riquadro ha gli equivalenti in forma estesa — **Edit this group**, **Add a sub group**, **Move group up**, **Move group down**, **Show group ID**, **Refresh** e **Delete this group**. Un gruppo salvato senza nome viene reso come **Untitled group**, un buon segnale che intendevi digitare qualcosa.

## Annidare i gruppi

I gruppi possono essere annidati: imposta **Parent Group** sul gruppo figlio, oppure usa l'azione **Add a sub group inside this group** del navigatore. Il testo di aiuto del modulo descrive la forma per cui è pensato — qualcosa come Corporate Units › Region › Market — e nota che ogni livello mostra lo stato e l'uptime aggregati di tutto ciò che sta sotto.

Quando un gruppo ha dei figli, il riquadro delle risorse mostra una riga di chip **Sub groups** che collega direttamente a ciascun figlio, così puoi percorrere la gerarchia senza tornare al navigatore.

L'annidamento si dimostra utile sulle pagine grandi: un provider di hosting con regioni dentro i prodotti, o un rivenditore con mercati dentro le unità di business. Su una pagina con dodici monitor, un unico livello piatto è più amichevole.

## Layout a elenco contro layout a griglia

Il passaggio **Layout** imposta **View Mode** (`viewMode`) per il gruppo, e cambia il modo in cui il gruppo viene reso pubblicamente.

| Se vuoi...                                                              | Scegli                  |
| -------------------------------------------------------------------------- | -------------------------- |
| Mostrare un semplice elenco verticale di servizi, uno per riga             | **List** (l'impostazione predefinita) |
| Mostrare lo stesso servizio su più regioni o tenant come una matrice       | **Grid**                   |

Scegli **Grid** e appaiono altri quattro campi:

- **Row Axis Label** — il nome della dimensione riga, segnaposto `Service`.
- **Row Axis Values** — le righe stesse, aggiunte una alla volta con **Add Row** (segnaposto `e.g. Auth`).
- **Column Axis Label** — la dimensione colonna, segnaposto `Region`.
- **Column Axis Values** — aggiunte con **Add Column** (segnaposto `e.g. US-East`).

Ogni monitor in un gruppo a griglia viene quindi posizionato in una cella, così la finestra modale in blocco richiede la riga e la colonna insieme ai monitor, usando le tue etichette degli assi.

**Configura gli assi prima di aggiungere i monitor.** Un gruppo a griglia senza righe o colonne mostra un avviso ambrato che dice che non c'è dove posizionare un monitor finché gli assi non esistono, con un pulsante **Set up the grid** — e il pulsante **Add Monitor** viene ritirato finché non lo fai.

## Ordinare ciò che vedono i visitatori

L'ordine è esplicito, non alfabetico, e si imposta in tre punti:

- **Risorse all'interno di un gruppo** — trascina una riga. Il riquadro lo dice: **Drag a row to change the order visitors see**.
- **Gruppi l'uno rispetto all'altro** — **Move up** / **Move down** nel menu della riga del navigatore, oppure **Move group up** / **Move group down** nel menu del riquadro.
- **Risorse senza gruppo** — vivono in **Top of page** e vengono sempre rese sopra ogni gruppo, quindi metti lì la cosa che tutti controllano per prima.

**Due casi in cui il trascinamento è disattivato.** Filtrare il riquadro con la casella **Search in {group}...** disabilita il riordino — il riquadro ti dice `N of M shown · drag to reorder is off while filtering`, quindi cancella prima la ricerca. E i gruppi a griglia non supportano mai l'ordinamento tramite trascinamento, perché la posizione deriva invece dagli assi di riga e colonna.

Metti in alto il servizio più richiesto. I visitatori che arrivano sulla pagina durante un'interruzione di solito smettono di leggere dopo la prima schermata.

## Importare gruppi da CSV

Costruire una gerarchia profonda a mano è tedioso. Il menu a tre puntini nell'intestazione della card ha **Import groups from CSV**, che apre la finestra modale **Import Groups from CSV**.

Il flusso è: **Download CSV Template** per ottenere `status-page-groups-template.csv`, compilarlo, **Choose CSV File**, poi **Preview Import** per controllare cosa verrà creato prima che qualcosa venga scritto. Il risultato si divide in **Groups Imported** e **Some Groups Could Not Be Imported**, così una riga errata non scompare in silenzio.

Solo `name` è obbligatorio. Le colonne accettate sono:

| Colonna                  | Cosa imposta                                              |
| ------------------------- | ------------------------------------------------------------ |
| `name`                    | Il nome del gruppo. Obbligatorio.                              |
| `parentName`              | Il nome del gruppo in cui questo si annida.                   |
| `description`             | La descrizione del gruppo.                                    |
| `isExpandedByDefault`     | Se la sezione si apre espansa per i visitatori.                |
| `showCurrentStatus`       | Se uno stato appare accanto al titolo del gruppo.              |
| `showUptimePercent`       | Se una percentuale di uptime appare accanto al gruppo.         |
| `uptimePercentPrecision`  | Quanti decimali usa quella percentuale.                        |
| `viewMode`                | `List` o `Grid`.                                               |
| `rowAxisLabel`            | Nome della dimensione riga per un gruppo a griglia.            |
| `rowAxisValues`           | I valori delle righe per un gruppo a griglia.                  |
| `columnAxisLabel`         | Nome della dimensione colonna per un gruppo a griglia.         |
| `columnAxisValues`        | I valori delle colonne per un gruppo a griglia.                |

L'importazione crea gruppi, non risorse — aggiungi i monitor in seguito con **Add Monitor** o **Add Multiple**.

## Dove leggere dopo

- [Status Pages Overview](/docs/status-pages/index) — cos'è una pagina di stato e come si incastrano i pezzi.
- [Branding e domini della pagina di stato](/docs/status-pages/branding-and-domains) — logo, favicon, colori del grafico e mettere la pagina sul tuo dominio.
- [Iscritti e annunci](/docs/status-pages/subscribers) — chi viene avvisato quando queste risorse cambiano.
- [Public API](/docs/status-pages/public-api) — leggere programmaticamente i dati della pagina di stato.
- [Stati e gravità degli incidenti](/docs/incidents/states-and-severities) — cosa fa apparire, e scomparire, un incidente dalla pagina.
