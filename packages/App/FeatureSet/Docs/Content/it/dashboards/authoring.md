# Creare una dashboard

Per creare una dashboard, apri **Prodotti → Dashboard** e fai clic su **Crea dashboard**. La finestra di dialogo **Crea una dashboard** ti chiede come vuoi iniziare, poi un nome. **Parti da zero** ti dà una dashboard vuota; un modello crea per te i suoi widget, e spesso le sue variabili, e ne compila il nome (numerato, come "Kubernetes Dashboard 2", se il progetto ne ha già una). Fai clic su **Crea dashboard** e la nuova dashboard si apre. Una dashboard vuota si apre sul suo canvas, con un pulsante **Aggiungi widget** per il primo widget.

:::cards
- [Creare la dashboard](#creare-la-dashboard): Partire da zero o da un modello.
- [Modificare e salvare](#modificare-e-salvare): Non cambia nulla per nessuno finché non fai clic su Salva modifiche.
- [Aggiungere un widget](#aggiungere-un-widget): Sceglierlo dal catalogo, configurarlo e posizionarlo.
- [Ingrandire un picco](#ingrandire-un-picco): Trascina su un grafico per leggere tutta la dashboard in quel momento.
:::

## Prima di iniziare

I proprietari e gli amministratori del progetto possono creare e modificare tutte le dashboard. Tutti gli altri hanno bisogno di un'autorizzazione del team: `CreateDashboard` per creare dashboard ed `EditDashboard` per modificarle. I membri e i visualizzatori del progetto possono leggere le dashboard senza nessuna delle due. Chi non può modificare una dashboard apre comunque il suo menu **⋯**, dove **Modifica dashboard** è bloccato e indica l'autorizzazione necessaria.

## Creare la dashboard

:::steps
### Scegliere come iniziare

Apri **Prodotti → Dashboard** e fai clic su **Crea dashboard**. La finestra di dialogo **Crea una dashboard** si apre su **Parti da zero**, una dashboard vuota per i tuoi widget. Sotto, **Oppure parti da un modello** elenca sei modelli **Consigliati**.

### Scegliere un modello

Fai clic su un modello per vedere cosa aggiunge: i suoi widget, chiamati come in **Aggiungi widget**, e le variabili con cui lo restringi nella sua barra degli strumenti. Per gli altri, scegli una categoria accanto alla casella di ricerca, oppure **Tutti i modelli**, o digita in **Cerca modelli…**: ogni parola che digiti deve corrispondere. Poi fai clic su **Usa questo modello**, oppure fai doppio clic sul modello. Nella casella di ricerca, le frecce scelgono un modello e **Enter** lo usa.

### Dare un nome alla dashboard

Il nome di un modello è già compilato, numerato oltre i nomi che il progetto ha già. **Parti da zero** lo lascia vuoto: scrivine uno. La descrizione è facoltativa, si trova chiusa in **Altri campi**, e puoi aggiungerla in seguito nella pagina **Panoramica** della dashboard. **Indietro** ti riporta ai modelli come li avevi lasciati.

### Crearla

Fai clic su **Crea dashboard**. La nuova dashboard si apre: subito con i widget di un modello, oppure con un canvas vuoto con **Aggiungi widget** sopra.
:::

I modelli, in base alla categoria sotto cui li elenca il selettore:

| Categoria | Modelli |
| --- | --- |
| Monitoraggio e APM | Monitor Dashboard, Metrics Dashboard, Real User Monitoring Dashboard, SLO Dashboard |
| Risposta agli incidenti | Incident Dashboard, Alert Dashboard |
| Infrastruttura | Kubernetes Dashboard, Kubernetes Cost Dashboard, Hosts Dashboard, Proxmox Dashboard, VMware Dashboard, Ceph Dashboard, Storage Array Dashboard, Docker Swarm Dashboard, Network Dashboard |

**Consigliati** contiene Monitor Dashboard, Incident Dashboard, Alert Dashboard, Kubernetes Dashboard, Hosts Dashboard e Metrics Dashboard. Un modello è un punto di partenza, non un collegamento: una volta creata la dashboard, modificala come vuoi. Il modello non la aggiorna più in seguito.

## Modificare e salvare

Una dashboard si apre in modalità di lettura. Per cambiarla, apri il menu **⋯** nella sua barra degli strumenti e scegli **Modifica dashboard**. La barra degli strumenti mostra **Modifica in corso** accanto al nome, e sostituisce l'intervallo di tempo e gli altri controlli con **Aggiungi widget**, **Variabili**, **Annulla** e **Salva modifiche**, con sotto una riga per l'**Intervallo di tempo predefinito** e l'**Aggiornamento automatico predefinito** della dashboard.

```mermaid title="Dalla lettura di una dashboard alla sua modifica, e ritorno"
flowchart TB
    view["Lettura: la dashboard<br/>si apre qui"] -->|"⋯ → Edit Dashboard"| edit["Modifica: aggiungere,<br/>cambiare, spostare e<br/>ridimensionare i widget"]
    edit -->|"Salva modifiche"| saved["Tutti vedono<br/>le modifiche"]
    edit -->|"Annulla, poi<br/>Annulla modifiche"| dropped["Non cambia nulla"]
    saved --> back["Di nuovo<br/>in lettura"]
    dropped --> back
```

Le tue modifiche restano solo tue finché non le salvi. Durante la modifica non viene salvato nulla, quindi gli altri continuano a vedere la dashboard com'era.

- **Salva modifiche** salva i widget, le loro posizioni e dimensioni, le variabili, e l'intervallo di tempo e l'aggiornamento automatico predefiniti, tutto insieme, e torna in modalità di lettura. Se il salvataggio viene rifiutato, per esempio perché nel frattempo hai perso l'autorizzazione, resti in modifica con le tue modifiche e il motivo sopra la griglia.
- **Annulla** chiede prima conferma, perché butta via le tue modifiche: **Annulla modifiche** torna alla dashboard com'era salvata, e **Continua a modificare** ti riporta al tuo lavoro.

Durante la modifica, l'aggiornamento automatico è in pausa, e un intervallo di tempo ingrandito torna all'intervallo che avevi scelto.

## Aggiungere un widget

:::steps
### Aprire il catalogo dei widget

Fai clic su **Aggiungi widget**: nella barra degli strumenti durante la modifica, oppure sul canvas di una dashboard vuota. Il catalogo raggruppa i suoi widget in base a ciò che mostrano. Scrivi nella sua casella di ricerca per trovarne uno per nome o per scopo ("error budget", "pods"), e premi Invio per aggiungere il primo risultato.

### Scegliere un widget

Fai clic su di esso. Il widget si posiziona nel primo spazio libero della griglia in cui entra, e si aprono le sue impostazioni.

### Impostare cosa mostra

La finestra delle impostazioni mostra una **Live Preview** del widget sopra le sue impostazioni, e l'anteprima segue ogni modifica che fai. Scegli che cosa legge il widget (una query di metriche, un filtro, un testo) e il suo aspetto, poi fai clic su **Fatto**.

### Metterlo al suo posto

Trascina il widget per spostarlo, e trascina i suoi bordi o angoli per ridimensionarlo. Vedi [I widget sulla griglia](#i-widget-sulla-griglia).
:::

[Widget della dashboard](/docs/dashboards/widgets) elenca ogni widget e le sue impostazioni.

## I widget sulla griglia

Il canvas è una griglia larga dodici colonne. I widget si agganciano a essa, e la pagina cresce verso il basso man mano che aggiungi righe. Mentre trascini un widget, un contorno tratteggiato mostra dove andrà a finire, con la sua colonna e la sua riga; mentre ne ridimensioni uno, il contorno mostra la sua dimensione in unità della griglia. I widget d'intralcio si spostano, quindi due widget non si sovrappongono mai.

Ogni tipo di widget ha una dimensione minima, perché ciò che disegna resti leggibile: un grafico è largo almeno sei colonne e alto tre righe, mentre un singolo numero sta in una cella.

Per cambiare un widget in seguito, fai clic su di esso durante la modifica. Le sue impostazioni si riaprono, con due pulsanti in più in fondo:

- **Duplicate Widget** aggiunge una copia, con le stesse impostazioni, nel primo spazio libero.
- **Elimina widget** lo rimuove, una volta che confermi.

## Intervallo di tempo e aggiornamento automatico

In modalità di lettura, il selettore dell'intervallo di tempo nella barra degli strumenti imposta la finestra che leggono tutti i widget di grafici, numeri, log e tracce. Scegli un'impostazione predefinita, dagli ultimi 5 minuti agli ultimi 3 mesi, oppure un inizio e una fine personalizzati. La dashboard si apre sul suo intervallo di tempo predefinito: l'ultima ora, a meno che chi la modifica non ne imposti un altro.

Gli elenchi di incidenti, avvisi, monitor e risorse mostrano il loro stato attuale, qualunque sia l'intervallo di tempo.

Accanto all'intervallo di tempo, il menu dell'aggiornamento automatico rilegge ogni widget ogni 5 secondi, 10 secondi, 30 secondi, 1 minuto, 5 minuti o 15 minuti, con un conto alla rovescia fino al prossimo aggiornamento. Lascialo disattivato mentre indaghi, così la vista resta ferma. La dashboard si apre con il suo aggiornamento automatico predefinito: disattivato, a meno che chi la modifica non ne imposti un altro.

Il selettore dell'intervallo di tempo, le variabili e l'aggiornamento automatico compaiono non appena la dashboard ha un widget.

### I valori predefiniti della dashboard

Mentre modifichi la dashboard, la riga sotto i pulsanti della barra degli strumenti imposta ciò su cui tutti la aprono: **Intervallo di tempo predefinito**, un'impostazione predefinita dagli ultimi 5 minuti agli ultimi 3 mesi, e **Aggiornamento automatico predefinito**. **Salva modifiche** li salva con il resto della dashboard, per il tuo team come per i visitatori del suo link pubblico. Un inizio e una fine personalizzati non possono essere un valore predefinito: la dashboard resterebbe per sempre su quel momento. La riga compare non appena la dashboard ha un widget.

Le dashboard salvate prima di queste impostazioni si aprono sull'ultima ora, con l'aggiornamento automatico che avevano. Tramite l'API e Terraform, entrambi stanno nel `dashboardViewConfig` della dashboard: `timeRange`, un'impostazione predefinita scritta come nel riferimento dell'API, per esempio `Past 1 Day`, e `refreshInterval`, per esempio `1m`. Qualsiasi altro valore viene rifiutato.

### Le tue scelte

L'intervallo di tempo e l'aggiornamento automatico che scegli in modalità di lettura sono solo tuoi, e il tuo browser li ricorda per ogni dashboard: un ricaricamento, un riavvio del browser o quello di uno schermo a parete riapre la dashboard come l'avevi lasciata. Viene ricordata solo un'impostazione predefinita. Un intervallo personalizzato o uno zoom dura finché non lasci la pagina, così la dashboard non resta mai ferma su un momento passato.

La prima voce di ogni selettore indica il valore predefinito della dashboard, come in Predefinito (Past 1 Day). Sceglila per tornare al valore predefinito: il browser dimentica la tua scelta e la dashboard torna a seguire il suo valore predefinito, anche quando qualcuno lo cambia in seguito. Quando salvi tu nuovi valori predefiniti, li vedi subito.

### Ingrandire un picco

Non devi ricorrere al selettore dell'intervallo di tempo per esaminare un picco. Trascina sul tratto interessante di un qualsiasi grafico a linee o ad aree e **tutta la dashboard** passa a quella finestra, esattamente come se l'avessi scelta nel selettore dell'intervallo di tempo: ogni widget che usa l'intervallo di tempo riesegue la query insieme, così leggi un unico momento su tutta la dashboard invece di un grafico a una scala diversa dai suoi vicini. Gli elenchi in tempo reale continuano a mostrare ciò che sta succedendo adesso, come sempre.

**Fai doppio clic su un grafico qualsiasi** per annullare: la dashboard torna all'intervallo che aveva prima che iniziassi a ingrandire, per quante volte tu abbia approfondito. Un pulsante **Reimposta lo zoom** compare accanto al selettore dell'intervallo di tempo mentre uno zoom è attivo, e fare doppio clic su una dashboard non ingrandita non fa nulla.

Una finestra ingrandita è fissa, quindi smette di avanzare mentre l'aggiornamento automatico è attivo; è voluto, perché una finestra che ti scivolasse via a metà indagine sarebbe peggio. Reimposta lo zoom per farla avanzare di nuovo.

Lo zoom funziona solo in modalità di lettura; in modalità di modifica, trascinare sposta e ridimensiona i widget. I grafici a barre si ingrandiscono allo stesso modo (trascina sulle barre), e fare doppio clic su uno di essi reimposta la dashboard come qualsiasi altro grafico. Solo un trascinamento ingrandisce: un semplice clic su un grafico non cambia mai l'intervallo della dashboard. Gli stessi gesti funzionano sui grafici di tutto OneUptime; vedi [Ingrandire un intervallo di tempo](/docs/telemetry/charts-and-time-ranges).

## Schermo intero

**⋯ → Schermo intero** mostra i widget della dashboard su tutto lo schermo, per un display a parete o una riunione. Premi Esc per uscire.

## Consigli per dashboard che invecchiano bene

- **Un argomento per dashboard.** Poche dashboard mirate valgono più di una pagina con tutto ciò che osservi.
- **Metti in alto il widget più importante.** Si legge dall'alto verso il basso, quindi fai in modo che la prima cosa che si vede risponda a "è tutto a posto?"
- **Dai un nome alle sezioni con i widget Testo.** Un breve titolo ogni poche righe ("Latenza", "Errori", "Capacità") rende la pagina facile da scorrere anche dall'altra parte della stanza.
- **Usa le variabili invece delle copie.** Se stai per creare la stessa dashboard per un secondo servizio, aggiungi invece una variabile `service`. Vedi [Variabili e filtri della dashboard](/docs/dashboards/variables).
- **Fai una copia prima di un grande cambiamento.** **Duplica: Dashboard**, nella pagina **Impostazioni** della dashboard, crea una copia sicura su cui provare le tue idee.

## Passaggi successivi

:::cards
- [Widget della dashboard](/docs/dashboards/widgets): Ogni widget, le sue impostazioni, e quale scegliere.
- [Variabili e filtri della dashboard](/docs/dashboards/variables): Una dashboard per ogni servizio, host o cliente.
- [Condivisione e dashboard pubbliche](/docs/dashboards/sharing): Condividi la dashboard fuori dal tuo team.
- [Configurazione e permessi della dashboard](/docs/dashboards/configuration): Proprietari, etichette, archiviazione e chi può fare cosa.
:::
