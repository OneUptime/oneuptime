# Ingrandire un intervallo di tempo

Trascinate su un grafico per ingrandire la pagina su quel momento, e fate doppio clic per tornare indietro. Questa pagina spiega i gesti, come si comporta uno zoom e quali grafici ingrandiscono cosa.

:::cards
- [Ingrandire e tornare indietro](#ingrandire-e-tornare-indietro): I due gesti e il pulsante Reset zoom.
- [Come si comporta lo zoom](#come-si-comporta-lo-zoom): Zoom annidati, aggiornamento automatico, clic e trascinamenti.
- [Dove funziona](#dove-funziona): Le pagine e i grafici di cui un trascinamento cambia l'intervallo.
- [Grafici senza zoom](#grafici-senza-zoom): Strisce, indicatori e sparkline.
:::

## Ingrandire e tornare indietro

Ogni grafico di serie temporali di OneUptime funziona anche da selettore dell'intervallo di tempo. Quando un grafico mostra un picco che volete esaminare, non dovete aprire il selettore e digitare date:

:::steps
1. **Trascinate sul picco** in un grafico qualsiasi. L'intervallo di tempo della pagina passa alla finestra che avete tracciato, esattamente come se l'aveste scelta nel selettore dell'intervallo. Ogni grafico, e ogni riquadro o tabella calcolato dall'intervallo della pagina, ripete la query per quella finestra, così leggete lo stesso momento ovunque.
2. **Fate doppio clic su un grafico qualsiasi** per tornare indietro. La pagina torna all'intervallo di tempo che aveva prima che iniziaste a ingrandire.
:::

I pannelli che mostrano lo stato attuale restano sul momento presente, come quando scegliete voi un intervallo: conteggi dell'inventario, stato di salute, principali consumatori di risorse, avvisi recenti, incidenti e allarmi aperti e gli elenchi in tempo reale di una dashboard.

Mentre è attivo uno zoom, accanto al selettore dell'intervallo di tempo della pagina compare un pulsante **Reset zoom**. Fa la stessa cosa di un doppio clic ed è il modo per tornare indietro da tastiera e sugli schermi touch.

```mermaid title="Cosa fanno un trascinamento, un doppio clic e il selettore all'intervallo della pagina"
stateDiagram-v2
    state "Intervallo dal selettore" as Picked
    state "Finestra ingrandita" as Zoomed
    [*] --> Picked
    Picked --> Zoomed: trascinare su un grafico
    Zoomed --> Zoomed: trascinare di nuovo
    Zoomed --> Picked: doppio clic o Reset zoom
    Zoomed --> Picked: scegliere un intervallo
```

## Come si comporta lo zoom

- **Ingrandite quanto volete; un solo ripristino risale fino in cima.** Dopo essere passati da «Past 1 Hour» a dieci minuti e poi a uno, un solo doppio clic (o **Reset zoom**) restituisce l'ora intera invece di risalire un livello alla volta.
- **Qualsiasi grafico può ripristinare qualsiasi zoom.** Trascinate sul grafico della CPU e fate doppio clic su quello della memoria: è la pagina a essere ingrandita, non il grafico.
- **Scegliere voi un intervallo ricomincia da capo.** Un intervallo predefinito o personalizzato nel selettore è un nuovo punto di partenza: lo zoom finisce e **Reset zoom** scompare.
- **Una finestra ingrandita è fissa.** «Past 30 Minutes» avanza con l'orologio; uno zoom è una finestra fissa, quindi smette di avanzare mentre l'aggiornamento automatico è attivo. Ripristinate lo zoom perché torni ad avanzare.
- **Uno zoom non va mai oltre il momento attuale.** Il bucket più recente di un grafico di solito si sta ancora riempiendo; un trascinamento che termina su di esso viene tagliato all'ora attuale.
- **Potete rilasciare il mouse fuori dal grafico**: il trascinamento conta comunque.
- **Non dovete aspettare che i grafici si carichino per tornare indietro.** Subito dopo uno zoom, mentre i grafici stanno ancora recuperando la finestra tracciata, o quando quella finestra risulta vuota, un doppio clic su un grafico ripristina subito lo zoom.
- **Fare doppio clic su una pagina non ingrandita non fa nulla.**

### Clic e trascinamenti

- **Nei grafici a linee, ad aree e a barre, un semplice clic non è uno zoom.** Ciò riguarda la maggior parte dei grafici: schede delle metriche ed explorer delle metriche, panoramiche delle risorse, SLO, monitor e ogni grafico di una dashboard. Solo un trascinamento su più bucket ingrandisce, quindi fare clic su un punto, una barra o una voce della legenda continua a fare quello che faceva prima. Mentre è attivo uno zoom, un clic sull'area del grafico ha effetto un istante dopo, così da distinguerlo dal doppio clic che ripristina. Anche la sequenza temporale dei modelli di errore negli Insights dei log e l'Occurrence Trend di un'eccezione ingrandiscono solo con un trascinamento.
- **Nei grafici di volume degli explorer, un clic su una barra ingrandisce quella barra.** I grafici di volume degli explorer di log, tracce, eccezioni ed eventi di sicurezza, e i grafici di analisi di log e tracce, ingrandiscono le barre su cui trascinate, o la singola barra su cui fate clic. Questi grafici mostrano **Click or drag to zoom**.

### Suggerimenti sui grafici

La maggior parte dei grafici che ingrandiscono indica il gesto sopra l'area del grafico, **Drag to zoom** oppure **Click or drag to zoom**, e, mentre è attivo uno zoom, aggiunge il promemoria **double-click to reset**. Le schede delle metriche, l'explorer delle metriche e i grafici di volume degli explorer mostrano sempre il suggerimento. Sulle schede dei grafici delle panoramiche delle risorse e degli SLO, e su alcuni widget delle dashboard, compare solo mentre puntate sulla scheda o ci entrate con il tasto Tab.

## Dove funziona

Lo zoom cambia l'intervallo dell'intera pagina in:

- panoramiche delle risorse e relative pagine di Insights: cluster Kubernetes, host Docker, Podman e Docker Swarm, host e relativi processi, servizi e unità systemd, VMware, Proxmox, Ceph, array di storage, database, risorse cloud e funzioni serverless;
- servizi e applicazioni RUM;
- metriche e traffico dei dispositivi di rete;
- schede delle metriche, compresa la scheda Metriche di una risorsa e le metriche di un monitor;
- l'explorer delle metriche;
- grafici della cronologia degli SLO;
- Insights dei log, compresa la sequenza temporale «Quando è successo» di un modello di errore, il cui pannello ha un proprio **Reset zoom** perché copre il selettore della pagina;
- grafici di volume di log, tracce, eccezioni ed eventi di sicurezza, e i grafici di analisi di log e tracce, che cambiano l'intervallo dell'explorer a cui appartengono;
- [dashboard](/docs/dashboards/authoring), dove un trascinamento cambia l'intervallo dell'intera dashboard.

I grafici con una finestra propria ingrandiscono solo quella finestra, quindi non cambiano mai nient'altro nella pagina. Ciò riguarda l'anteprima di una metrica nel modulo di un monitor (il monitor continua a valutare la propria finestra mobile), l'Occurrence Trend di un'eccezione, un grafico aperto in un popup o nel pannello di indagine e i grafici nelle risposte della chat IA. Un doppio clic su uno di essi, o il suo pulsante **Reset zoom**, ripristina la sua finestra.

Anche l'istantanea della telemetria nella pagina di un incidente, di un allarme o di un episodio ha una finestra propria. Un trascinamento sul suo grafico (il grafico della metrica, o il grafico di volume di log, tracce o eccezioni quando è questo che l'istantanea mostra) ingrandisce l'intera istantanea, così che le sue schede Metriche, Log, Tracce ed Eccezioni mostrino tutte la porzione tracciata. **Reset zoom** accanto al badge dell'istantanea, o un doppio clic su quel grafico, ripristina la finestra dell'istantanea.

## Grafici senza zoom

Alcune visualizzazioni non hanno un asse temporale su cui trascinare, sono troppo piccole per farlo o mostrano sempre una finestra fissa propria, quindi non ingrandiscono:

- strisce della cronologia di disponibilità (una barra al giorno), che non possono mostrare nulla di più fine di un giorno;
- barre di ripartizione e proporzione, indicatori e barre di avanzamento;
- flame graph, mappe dei servizi e diagrammi di flusso;
- le piccole sparkline di tendenza negli elenchi delle metriche, dove un clic apre la metrica: apritela per avere un grafico ingrandibile;
- piccole sparkline con una finestra fissa propria, come il tempo di andata e ritorno di un dispositivo di rete nell'ultima ora: il loro link **Open metrics** porta a grafici che potete ingrandire.

## Passaggi successivi

:::cards
- [Creare una dashboard](/docs/dashboards/authoring): Lo zoom funziona su ogni grafico di una dashboard.
- [Sintassi di ricerca](/docs/telemetry/search-syntax): Filtrare gli explorer una volta trovato il momento.
- [Monitor metriche](/docs/monitor/metrics-monitor): Ricevere un avviso sulla metrica che stavate guardando.
:::
