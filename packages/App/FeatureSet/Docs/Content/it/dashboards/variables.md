# Variabili e filtri della dashboard

Una variabile è un selettore nella barra degli strumenti della dashboard. Aggiungi una variabile `service` e gli stessi grafici mostrano `checkout`, `payments` o `search`: chi guarda sceglie dalla barra degli strumenti, invece di dover costruire tu tre dashboard quasi identiche.

:::cards
- [Aggiungere una variabile](#aggiungere-una-variabile): Dalle un nome, scegli da dove arrivano i suoi valori, salva.
- [Origini delle variabili](#origini-delle-variabili): Telemetry Attribute, Project Labels, Custom List e Text Input.
- [Come i widget usano una variabile](#come-i-widget-usano-una-variabile): Quali widget seguono quali variabili.
- [Link che conservano la selezione](#link-che-conservano-la-selezione): Invia un link che si apre sullo stesso servizio.
:::

## Come funziona una variabile

Definisci le variabili mentre modifichi la dashboard, e vengono salvate con essa. In modalità di lettura, ognuna è un selettore nella barra degli strumenti. Quando chi guarda sceglie un valore, ogni widget che segue la variabile rilegge i suoi dati, e il link della pagina conserva la scelta.

```mermaid title="Dalla definizione di una variabile alla scelta di chi guarda"
flowchart TB
    A["Modifica: Variabili,<br/>poi Aggiungi variabile"] --> B["Salva variabili,<br/>poi Salva modifiche"]
    B --> C["Lettura: un selettore<br/>nella barra degli<br/>strumenti"]
    C --> D["Chi guarda sceglie<br/>un valore"]
    D --> E["I widget che seguono<br/>la variabile rileggono"]
    D --> F["Il link della pagina<br/>conserva la scelta"]
```

## Aggiungere una variabile

:::steps
### Aprire la finestra delle variabili

Apri la dashboard, scegli **⋯ → Modifica dashboard** e fai clic su **Variabili** nella barra degli strumenti. La finestra **Variabili della dashboard** elenca le variabili della dashboard; il pulsante nella barra degli strumenti le conta.

### Aggiungerne una

Fai clic su **Aggiungi variabile**. Una nuova variabile legge un attributo di telemetria; scegli un'altra **Origine** se ti serve.

### Compilarla

Dalle un **Nome**, che usano i widget e i link, come `service`: lettere, cifre e trattini bassi, che inizi con una lettera o un trattino basso, e diverso dagli altri nomi della dashboard. Aggiungi un'**Etichetta** per la barra degli strumenti se vuoi, un valore **Predefinito** da cui partire, e spunta **Consenti selezione multipla** per permettere di scegliere più valori.

### Salvarla

Fai clic su **Salva variabili**, poi su **Salva modifiche** nella barra degli strumenti. Il selettore della variabile compare nella barra degli strumenti quando la dashboard torna in modalità di lettura.
:::

Per cambiare o rimuovere una variabile in seguito, riapri la finestra: cambia i suoi campi, oppure fai clic sul cestino accanto.

## Origini delle variabili

L'**Origine** decide da dove arrivano i valori di una variabile, e quali widget la seguono.

| Origine | Da dove arrivano i suoi valori | Selezione multipla |
| --- | --- | --- |
| Telemetry Attribute | I valori di una chiave di attributo nelle tue metriche, come `service.name` | Sì |
| Project Labels | Le etichette del progetto che consenti, da 1 a 1000 | Sì |
| Custom List | Valori che scrivi tu, separati da virgole, come `prod, staging` | Sì |
| Text Input | Qualsiasi cosa scriva chi guarda | No |

### Telemetry Attribute

Imposta la **Chiave attributo**, come `service.name`, `host.name` o `k8s.namespace.name`; il campo suggerisce le chiavi presenti nella tua telemetria. Il selettore offre fino a 100 valori di quella chiave, letti dalle tue metriche dell'ultimo giorno, quindi un nuovo servizio vi compare senza che tu debba modificare la dashboard.

È l'origine più comune, perché non ha bisogno di un elenco proprio: i valori sono quelli che già invii.

### Project Labels

Scegli etichette di progetto esistenti da offrire come menu a tendina della dashboard. Per esempio, crea una variabile chiamata `UNIT`, imposta la sua origine su **Etichette del progetto** e scegli le etichette `0660` e `0661`.

La dashboard salva gli ID e i nomi visualizzati delle etichette scelte. Il filtro usa gli ID, quindi rinominare un'etichetta del progetto non rompe il suo collegamento. I nomi visualizzati vengono salvati con la dashboard; riseleziona un'etichetta rinominata nell'editor delle variabili per aggiornarne il nome visualizzato. Le dashboard pubbliche mostrano queste stesse scelte salvate.

In un widget **Elenco monitor**, apri **Filtri → Variabile etichetta** e seleziona `UNIT`. Scegliendo `0660` vengono mostrati i monitor che hanno quell'etichetta. Gli altri widget non sono interessati, a meno che non supportino e colleghino esplicitamente la variabile: la **Elenco SLO** ha la stessa impostazione **Variabile etichetta**.

I filtri fissi del widget restano attivi. Per esempio, con un'etichetta fissa `network` e `UNIT` impostata su `0660`, un monitor deve avere entrambe le etichette. Più unità selezionate corrispondono a una qualsiasi di esse. Scegliere **Tutti** rimuove solo la condizione della variabile, e mantiene i filtri fissi su etichetta, stato e tipo di monitor.

Una variabile mancante o una selezione fuori dalle sue scelte configurate mostra un errore. Un'etichetta scelta senza monitor corrispondenti mostra l'elenco vuoto. Rimuovi esplicitamente il collegamento del widget quando non serve più.

### Custom List e Text Input

Una Custom List offre i valori che scrivi, separati da virgole. Un Text Input permette a chi guarda di scrivere qualsiasi valore, come un indirizzo IP o un ID di richiesta. Nessuna delle due filtra un widget da sola: i loro valori vanno dove scrivi `{{name}}` (vedi sotto).

Una variabile Query di una dashboard più vecchia viene conservata e mostra una casella di testo nella barra degli strumenti: OneUptime non carica più i suoi valori da una query.

## Selezione multipla e valori predefiniti

Con **Consenti selezione multipla** spuntato, chi guarda sceglie uno o più valori, e i widget mostrano uno qualsiasi di essi. Una selezione vuota significa **Tutti**, e una variabile a selezione multipla parte sempre da **Tutti**, quindi il suo valore **Predefinito** è disattivato.

Una variabile a selezione singola parte dal suo valore **Predefinito**, oppure da **Tutti** quando non ne ha. **Tutti** rimuove il filtro della variabile, quindi i widget mostrano tutto.

Usa la selezione multipla per confrontare "checkout e payments insieme" senza lasciare la dashboard. Evitala dove i numeri non si sommano tra i valori, come in una media di medie.

## Come i widget usano una variabile

Ogni origine raggiunge i widget a modo suo:

- Le variabili **Attributo di telemetria** filtrano i widget senza nulla da impostare su di essi: ogni grafico, valore, indicatore e tabella di metriche; il **Grafico dei log**, il **Flusso di log**, il **Grafico delle tracce** e la **Tabella delle tracce**; e gli elenchi dell'infrastruttura le cui risorse hanno l'attributo, come `host.name` negli elenchi degli host e `k8s.namespace.name` negli elenchi di Kubernetes. Il grafico di una metrica senza l'attributo non mostra dati mentre è scelto un valore: scegli **Tutti** per rivederlo. L'**Elenco delle tracce** e gli elenchi di incidenti e avvisi non le seguono.
- Le variabili **Etichette del progetto** filtrano un **Elenco monitor** o una **Elenco SLO** la cui **Variabile etichetta** le nomina.
- **Qualsiasi variabile** può essere scritta in un testo come `{{name}}`: in un [widget HTML](/docs/dashboards/widgets#html), nella query di una [fonte di dati esterna](/docs/dashboards/data-sources), e nel titolo di un **Elenco monitor** o di una **Elenco SLO**. Un titolo come `{{UNIT}} NETWORK` mostra `0660 NETWORK`, `0660, 0661 NETWORK` o `All NETWORK`. Un titolo controlla solo il testo visualizzato; configura **Variabile etichetta** per filtrare la query dei monitor.

Il [widget SLO](/docs/dashboards/widgets#slo) può seguire una variabile Telemetry Attribute sulla chiave `sloName`, così chi guarda sceglie quale SLO mostra.

## Link che conservano la selezione

Il link della pagina porta la scelta di ogni variabile come `?var-<name>=<value>`, con più valori separati da virgole, quindi un link che copi si apre con la stessa selezione, compreso un **Tutti** esplicito. Un link come questo si apre sul servizio payments:

```text title="A dashboard link with a variable"
https://oneuptime.com/dashboard/<project-id>/dashboards/<dashboard-id>?var-service=payments
```

Il link porta anche l'intervallo di tempo e l'aggiornamento automatico che hai scelto, come `range` e `refresh`, così chi lo riceve vede quello che vedi tu. [Inviare un link](/docs/dashboards/sharing#inviare-un-link) ne elenca i valori.

## Un esempio: una dashboard per ogni servizio

Una dashboard di servizio di solito ha:

1. Una variabile `service`, origine Telemetry Attribute, chiave di attributo `service.name`, con il tuo servizio più trafficato come valore predefinito. Lascia la selezione multipla disattivata, così i grafici mostrano un servizio alla volta.
2. Una variabile `namespace`, origine Telemetry Attribute, chiave di attributo `k8s.namespace.name`, con la selezione multipla attiva per confrontare i namespace.
3. Una variabile `environment`, origine Custom List, valori `prod, staging`, usata come `{{environment}}` nella query di una fonte di dati.
4. Widget che leggono quegli attributi: grafici e valori delle metriche del servizio, un flusso di log e un elenco dei pod di Kubernetes.

Il risultato: una dashboard per ogni servizio, con tre selettori in alto.

## Passaggi successivi

:::cards
- [Widget della dashboard](/docs/dashboards/widgets): Quali widget seguono quali variabili.
- [Fonti di dati esterne](/docs/dashboards/data-sources): Metti una variabile in una query PromQL o SQL.
- [Condivisione e dashboard pubbliche](/docs/dashboards/sharing): Le variabili su una dashboard pubblica.
- [Creare una dashboard](/docs/dashboards/authoring): La modalità di modifica, il salvataggio e l'intervallo di tempo.
:::
