# Esploratore metriche

Le metriche sono i numeri che i vostri servizi e la vostra infrastruttura riportano nel tempo: numero di richieste, latenze, CPU, profondità delle code. L'esploratore metriche elenca ogni metrica che il vostro progetto riceve, ne rappresenta qualsiasi in un grafico, le combina con formule e trasforma un grafico in un monitor o in un widget di dashboard.

:::cards
- [Trovare una metrica](#trovare-una-metrica): Cercare nell'elenco dei nomi delle metriche.
- [Rappresentare una metrica](#rappresentare-una-metrica): Aggregare, filtrare e raggruppare una query.
- [Combinare query con una formula](#combinare-query-con-una-formula): Tassi di errore e altri rapporti.
- [Usare ciò che avete rappresentato](#usare-ciò-che-avete-rappresentato): Un monitor, un widget di dashboard o un link.
- [Migliorare le metriche e aggiungere quelle mancanti con l'IA](#migliorare-le-metriche-e-aggiungere-quelle-mancanti-con-lia): Pull request che correggono le vostre metriche e aggiungono quelle che mancano a un servizio.
:::

## Come funziona l'esploratore

L'esploratore ha due livelli. La scheda **Visualizzatore** elenca le metriche che il vostro progetto riceve. Fate clic su una, e l'esploratore metriche si apre con una query per essa: una metrica, come aggregarla e come filtrarla e raggrupparla. Ogni query è una variabile, `a`, `b` e così via, che una formula può usare.

```mermaid title="Dalle query delle metriche a un grafico, un monitor o una dashboard"
flowchart TB
    a["Query a: richieste,<br/>aggregate con Sum"] --> f["Formula:<br/>$b / $a * 100"]
    b["Query b: errori,<br/>aggregati con Sum"] --> f
    f --> chart["Grafico: tasso di<br/>errore in percentuale"]
    chart --> monitor["Un monitor di metriche"]
    chart --> dash["Un widget di dashboard"]
```

L'esploratore ha cinque schede:

| Scheda | A cosa serve |
| --- | --- |
| **Visualizzatore** | L'elenco delle metriche, ciascuna con un piccolo grafico e il suo ultimo valore. Si apre sull'ultima ora. |
| **Informazioni** | Quali servizi riportano metriche, e quante. |
| **IA** | Le metriche che registrano troppi valori o i cui bucket non sono adatti, e le metriche mancanti, che OneUptime trova, e ciò che OneUptime AI ha fatto al riguardo. Vedete [Migliorare le metriche e aggiungere quelle mancanti con l'IA](#migliorare-le-metriche-e-aggiungere-quelle-mancanti-con-lia). |
| **Guida alla configurazione** | Come inviare metriche con OpenTelemetry, usando una delle vostre chiavi di ingestione. |
| **Impostazioni** | **Regole pipeline** e **Regole di registrazione**: che cosa succede alle metriche quando arrivano. |

## Prima di iniziare

- **Metriche in arrivo.** Inviatele con [OpenTelemetry](/docs/telemetry/open-telemetry), oppure da un agente come il [collector OpenTelemetry per host](/docs/telemetry/host-otel-collector) o l'[agente Kubernetes](/docs/telemetry/kubernetes-agent).
- **Un ruolo che può leggere la telemetria.** Project Owner, Project Admin, Project Member, Viewer, Telemetry Admin, Telemetry Member o Telemetry Viewer, oppure un ruolo personalizzato con il permesso Read Telemetry Service Metrics. Vedere [Telemetria](/docs/permissions/index#telemetria) per sapere quali metriche legge.

## Trovare una metrica

Aprite **Prodotti → Osservabilità → Metriche**. Il **Visualizzatore** elenca ogni metrica che il vostro progetto ha ricevuto, per nome, ciascuna con un piccolo grafico dell'intervallo di tempo e il suo ultimo valore.

- Cercate i nomi con parole semplici o `name:`, ad esempio `name:http.server` trova `http.server.request.duration`. Vedere [Sintassi di ricerca](/docs/telemetry/search-syntax#metriche).
- Filtrate per **Servizio** nella barra laterale per vedere solo le metriche riportate da un servizio.
- Fate clic su una metrica per rappresentarla nell'esploratore metriche.

## Rappresentare una metrica

:::steps
### Aprire la metrica

Fate clic sulla metrica nel **Visualizzatore**. L'esploratore si apre con una query, `a`, per l'intervallo di tempo e i filtri dell'elenco.

### Scegliere come aggregarla

In **Aggregate by**, scegliete come vengono combinati i valori di ogni punto del grafico: Avg, il predefinito, Sum, Min, Max, Count, oppure un percentile, P50, P75, P90, P95 o P99. Il percentile di una metrica istogramma, come la durata di una richiesta, viene calcolato dai suoi bucket.

### Filtrarla e raggrupparla

Aprite **Filters & grouping**. **Filter by attributes** conserva i punti dati i cui attributi corrispondono, come una determinata `http.route`, e **Group by** disegna una linea per ogni valore degli attributi scelti, come una linea per host.

### Regolare il grafico

Aprite **Display Settings** per scegliere il **Chart type** (linea, area o barre), tracciare un **Warning Threshold** e un **Critical Threshold** sul grafico, oppure attivare **Convert to per-second rate**.
:::

> [!TIP]
> Un contatore che cresce soltanto, come `system.disk.io`, si legge meglio come tasso. Attivate **Convert to per-second rate** per mostrare quanto velocemente cambia invece del suo totale progressivo; l'esploratore lo suggerisce quando riconosce un contatore del genere.

Ogni query disegna il proprio grafico. Per disegnare una query sullo stesso grafico della precedente, attivate **Overlay with previous query** nelle sue **Display Settings**.

## Combinare query con una formula

:::steps
### Aggiungere le query

Fate clic su **Aggiungi metrica** per ogni metrica che vi serve. Le nuove query sono `b`, `c` e così via.

### Aggiungere una formula

Fate clic su **Aggiungi formula** e scrivete la **Formula** con le variabili delle query, gli operatori `+`, `-`, `*`, `/`, `%` e `^`, e le parentesi. Per un tasso di errore in percentuale, scrivete `$b / $a * 100`.
:::

Una variabile si può scrivere con o senza il suo `$`, in maiuscolo o minuscolo. Una formula che nomina una query non definita lo segnala invece di disegnare.

## Esplorare intorno a un grafico

I pulsanti sopra i grafici lavorano sull'intervallo di tempo che state guardando:

| Pulsante | Cosa fa |
| --- | --- |
| **Registri** | Apre l'[Esploratore log](/docs/telemetry/logs-explorer) per questo intervallo di tempo e i vostri filtri. |
| **Tracce** | Apre l'[Esploratore tracce](/docs/telemetry/traces-explorer) per questo intervallo di tempo e i vostri filtri. |
| **Indagare** | Apre un pannello laterale con i log, le tracce e le eccezioni di questo intervallo di tempo. |
| **Eventi** | Segna sui grafici gli incidenti e gli avvisi di questo intervallo di tempo. |
| **Compare** | Disegna il periodo precedente su ogni grafico come linea tratteggiata, per vedere che cosa è cambiato. |

Trascinate su un grafico per ingrandire un momento, e fate doppio clic per tornare indietro: vedere [Ingrandire un intervallo di tempo](/docs/telemetry/charts-and-time-ranges).

## Usare ciò che avete rappresentato

- **Azioni → Crea monitor da questa vista** apre un nuovo monitor di metriche con queste query e formule già compilate. Vedere [Monitor metriche](/docs/monitor/metrics-monitor).
- **Azioni → Add to dashboard** aggiunge il grafico a una dashboard a vostra scelta. Vi serve il permesso di modificare quella dashboard.
- **Copia link** copia un link esattamente a questa vista: query, formule e intervallo di tempo.
- **Saved Views** conserva la vista sotto un nome per tutti nel progetto. Il **Visualizzatore** ha le sue viste salvate, per la sua ricerca e i suoi filtri. Le viste salvate funzionano come nell'[Esploratore log](/docs/telemetry/logs-explorer#salvare-una-vista).

## Informazioni sulle metriche

La scheda **Informazioni** conta le metriche di un intervallo di tempo: **Metriche attive**, **Servizi di reportistica** e la media per servizio. Raggruppa le metriche in categorie ed elenca i servizi che le riportano.

## Migliorare le metriche e aggiungere quelle mancanti con l'IA

Ogni ora OneUptime esamina le metriche che i vostri servizi hanno inviato nell'ultima ora alla ricerca di quelle che registrano troppi valori o i cui bucket dell'istogramma non sono adatti, e di servizi molto usati che non inviano metriche, e registra ciò che trova come insight IA, con le prove. Poi OneUptime AI analizza ciascuno e apre una pull request per correggerlo. Non viene mai unito nulla: il vostro team revisiona ogni pull request.

OneUptime legge con attenzione le 10 metriche per cui i vostri servizi hanno inviato più punti dati nell'ora, ciascuna con almeno 1.000 punti, e registra tre tipi di rilevamento:

| Rilevamento | Quando OneUptime lo registra | La pull request |
| --- | --- | --- |
| **Cardinalità elevata** | Un attributo che il codice imposta su una di queste metriche ha assunto 1.000 o più valori nell'ora, come ID utente o URL completi, così ogni valore è una serie a sé. Oppure 50 o più nomi di metriche di un servizio sono uno stesso nome con un ID diverso al suo interno. | Smette di registrare il valore sulla metrica, o toglie gli ID dai suoi nomi. |
| **Bucket dell'istogramma errati** | Una di queste metriche è un istogramma che ha registrato 1.000 o più valori, e il 90% o più è caduto nel suo bucket più piccolo o sopra il più grande, oppure non ha bucket, così i suoi percentili non si possono distinguere. | Dà all'istogramma bucket adatti ai suoi valori, o ne corregge l'unità. |
| **Metriche mancanti** | Un servizio ha inviato 1.000 o più span nell'ora e non ha mai inviato una metrica. | Aggiunge come metriche il numero di richieste, gli errori e la durata delle sue operazioni più usate. |

Un rilevamento non memorizza mai i valori di un attributo: solo il nome dell'attributo, quanti valori ha assunto e che aspetto hanno.

### Attivarlo

**Metriche → IA → Impostazioni** contiene l'interruttore **Migliora le metriche e aggiungi quelle mancanti**, attivo per i nuovi progetti. Con **Abilita IA** disattivato, i problemi nelle vostre metriche vengono ancora trovati, ma OneUptime AI non ne fa nulla. Per aprire pull request, OneUptime AI ha bisogno di un repository collegato in [Codice](/docs/ai/ai-agent): la pagina dice prima cosa manca. Il codice di ogni repository viene modificato sul Runner che il repository sceglie in Codice.

OneUptime AI apre da solo al massimo 5 pull request al giorno (UTC), una per rilevamento, e mai più del limite di pull request IA aperte di un repository.

### Regole IA

Senza regole, OneUptime AI analizza subito ogni problema che trova nelle vostre metriche e apre una pull request per ciascuno che può correggere. Le **Regole IA** in **Altre impostazioni** lo restringono, in tre passaggi:

| Passaggio | Cosa decide |
| --- | --- |
| **Corrispondenza** | Quali servizi: quelli scelti, quelli con determinate etichette o quelli il cui nome corrisponde a un modello. |
| **Indagare** | **Subito**, oppure **Solo se ancora trovato dopo un'attesa**: un problema che scompare durante l'attesa non viene analizzato. |
| **Correzione** | **Non correggere**, **Chiedi prima di correggere** o **Correggi senza chiedere**. Chiedere prima lascia la pull request a una persona: il rilevamento offre **Correggi con l'IA**. |

In **Altri campi** una regola sceglie i repository di codice, i server MCP e il provider LLM che OneUptime AI può usare per essa. Se non se ne sceglie nessuno, può usarli tutti, e il provider LLM predefinito del progetto.

### Vedere cosa ha fatto

- **Metriche → IA → Informazioni** elenca ciò che OneUptime ha trovato, ogni rilevamento con le sue prove e **Apri in Metriche**, che apre la sua metrica per il suo servizio, dell'ora in cui è stato trovato. Un servizio senza metriche offre invece **Apri in Tracce**: gli span che le sue metriche misurerebbero.
- **Metriche → IA → Registri** elenca ogni indagine e ogni pull request, dalla più recente, con lo stato di ciascuna.
- In Codice, l'attività indica che l'ha avviata OneUptime, con un link al suo rilevamento, e la pull request spiega perché è stata aperta.

## Che cosa succede alle metriche quando arrivano

**Metriche → Impostazioni → Regole pipeline** modifica le metriche quando arrivano, prima che vengano memorizzate. Le regole vengono eseguite nell'ordine dell'elenco, che cambiate trascinandole; una regola per un servizio viene eseguita prima delle regole per tutti i servizi.

| Tipo di regola | Cosa fa |
| --- | --- |
| Filtro (allowlist) | Conserva solo i punti dati che corrispondono e scarta il resto. |
| Scarta | Scarta i punti dati che corrispondono. |
| Rinomina metrica | Rinomina la metrica. |
| Rinomina attributo | Rinomina la chiave di un attributo sui punti dati che corrispondono. |
| Aggiungi attributo | Aggiunge un attributo ai punti dati che corrispondono. |
| Rimuovi attributo | Rimuove un attributo, ad esempio uno con troppi valori per essere utile. |
| Oscura attributo | Sostituisce il valore di un attributo con un segnaposto. |
| Campione | Conserva una percentuale dei punti dati che corrispondono. |

**Metriche → Impostazioni → Regole di registrazione** calcola ogni minuto nuove metriche a partire da altre metriche. Vedere [Regole di registrazione dei log](/docs/telemetry/log-recording-rules) per come funzionano le regole di registrazione.

## Risoluzione dei problemi

:::details Il grafico di un contatore sale soltanto
È un contatore cumulativo. Attivate **Convert to per-second rate** nelle **Display Settings** della query.
:::

:::details L'elenco dice che non sono state trovate metriche
Svuotate prima la ricerca e i chip di filtro. Se l'elenco resta vuoto, nessuna metrica ha ancora raggiunto OneUptime: confrontate la vostra configurazione con la **Guida alla configurazione**.
:::

:::details Mancano le metriche di un servizio
Filtrate il **Visualizzatore** per quel **Servizio** e ampliate l'intervallo di tempo. Se mancano ancora, l'ambito del vostro ruolo potrebbe escludere quel servizio: vedere [Telemetria](/docs/permissions/index#telemetria).
:::

## Passaggi successivi

:::cards
- [Monitor metriche](/docs/monitor/metrics-monitor): Ricevere un avviso quando una metrica supera una soglia.
- [Creare una dashboard](/docs/dashboards/authoring): Mettere i vostri grafici uno accanto all'altro.
- [Sintassi di ricerca](/docs/telemetry/search-syntax): Ogni filtro che la casella di ricerca comprende.
:::
