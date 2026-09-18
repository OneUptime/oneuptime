# Widget

Un widget e un tassello su una dashboard. Questa pagina elenca ogni widget che puoi aggiungere, cosa mostra e quando ricorrervi.

Per sapere come trascinare i widget sul canvas, vedi [Creazione di una dashboard](/docs/dashboards/authoring).

## Grafici e numeri

### Chart

Un grafico a linee, a barre o ad area di una o piu serie metriche sull'intervallo temporale della dashboard.

**Impostazioni**:

- Una o piu query di metrica.
- Una formula opzionale che combina due query (per esempio, `errors / total * 100` per ottenere un tasso di errore).
- Un'opzione "show as rate" per i contatori cumulativi che crescono senza essere azzerati.
- Opzioni di visualizzazione: impilato o sovrapposto, unita dell'asse Y, posizione della legenda, tipo di grafico.

Usalo quando: i trend contano. Latenza nel tempo, conteggio errori, profondita della coda, qualsiasi cosa in cui la forma della linea racconti la storia.

### Value

Un singolo grande numero con soglie colorate opzionali.

**Impostazioni**:

- Una query di metrica che restituisce un singolo numero (ultimo valore, media o massimo sull'intervallo temporale).
- Una soglia **warning** opzionale (giallo sopra).
- Una soglia **critical** opzionale (rosso sopra).
- Formato del numero e unita.

Usalo quando: un solo numero risponde alla domanda. Tasso di errore corrente, latenza P95 in questo momento, conteggio degli incidenti aperti.

### Gauge

Un indicatore circolare con minimo, massimo, banda warning e banda critical.

**Impostazioni**: una query di metrica e i quattro confini.

Usalo quando: il valore rientra in un intervallo noto. Percentuale CPU (0–100%), utilizzo del disco, capacita della coda.

### Table

Una tabella di risultati di metriche, una riga per gruppo.

**Impostazioni**: una query di metrica (tipicamente raggruppata per un'etichetta come host o servizio), le colonne da mostrare e un limite di righe.

Usalo quando: vuoi una scomposizione invece di un trend. Top 10 degli host piu rumorosi, conteggio errori per servizio, richieste per endpoint.

## Text

Un blocco statico di Markdown.

**Impostazioni**: il corpo Markdown. Vengono renderizzati intestazioni, elenchi, link, enfasi e blocchi di codice.

Usalo quando: vuoi un'intestazione di sezione, un paragrafo di contesto, un elenco di link ai runbook o un banner temporaneo durante un incidente.

## HTML

Il tuo HTML, CSS e JavaScript, renderizzati come widget.

**Impostazioni**: il corpo HTML, un foglio di stile opzionale, uno script opzionale e tre interruttori di permesso.

Usalo quando: ti serve qualcosa che nessun widget integrato copre — un badge di terze parti incorporato, una tabella estratta da un'API interna, una legenda personalizzata, un insieme di link con stile verso i tuoi strumenti.

### Cosa puo e cosa non puo fare

Il widget viene renderizzato in un frame in sandbox su una propria origine isolata. Dentro quel frame il tuo codice puo fare piu o meno qualsiasi cosa: costruire il DOM, eseguire timer, fare fetch da qualsiasi URL, disegnare su un canvas.

Cio che non puo fare e raggiungere la pagina OneUptime attorno a lui. Non ha accesso al DOM della dashboard, ai cookie, al local storage o alla sessione API, e non puo far navigare altrove la scheda del browser. Questo vale sia che la dashboard sia privata sia che sia condivisa pubblicamente.

Due conseguenze da conoscere prima di incollarci dentro qualcosa:

- Un `fetch` dal widget e una richiesta cross-origin da un'origine opaca, quindi il server che chiami deve consentirla con CORS. Chiamare l'API di OneUptime da qui non e supportato.
- Il widget parte trasparente. Imposta uno sfondo su `body` nel tuo CSS se vuoi che riempia il riquadro.

### Usare le variabili della dashboard

Scrivi `{{variableName}}` in qualsiasi punto dell'HTML, del CSS o del JavaScript e viene sostituito con il valore corrente di quella variabile prima che il widget venga renderizzato. Scegliere un nuovo valore ri-renderizza il widget. Un segnaposto che nomina una variabile inesistente viene lasciato invariato.

Gli script ricevono gli stessi valori, piu l'intervallo temporale della dashboard, su `window.ONEUPTIME`:

```javascript
window.ONEUPTIME.variables.environment; // valore corrente, o "" se non impostato
window.ONEUPTIME.startDate; // stringa ISO 8601, inizio dell'intervallo temporale della dashboard
window.ONEUPTIME.endDate; // stringa ISO 8601, fine dello stesso intervallo
```

Il widget viene ricaricato ogni volta che la dashboard si aggiorna, cosi un widget che recupera i propri dati resta al passo con l'intervallo di refresh.

### Permessi

**Run JavaScript** (esegui JavaScript, attivo per impostazione predefinita) esegue il tuo script. Disattivalo per renderizzare solo markup e stili — lo script viene allora escluso del tutto dal widget invece di essere semplicemente bloccato.

**Open links in a new tab** (apri i link in una nuova scheda, attivo per impostazione predefinita) permette a link e `window.open` di aprire una scheda del browser. I link si aprono sempre in una nuova scheda; il widget non puo mai far navigare altrove la dashboard stessa.

**Allow forms to submit** (consenti l'invio dei form, disattivo per impostazione predefinita) permette a un `<form>` dentro il widget di inviare i dati.

Chiunque possa modificare la dashboard decide cosa esegue questo widget, e chiunque visualizzi la dashboard lo esegue — su una dashboard pubblica, questo include i visitatori anonimi. Tratta l'accesso in modifica a una dashboard che contiene un widget HTML come tratteresti l'accesso a qualsiasi altro codice che rilasci.

## Log e trace

### Log Chart

Un grafico a serie temporali del volume di log sull'intervallo temporale della dashboard. Ogni serie rappresenta una severità, così i picchi di errore risaltano rispetto al traffico normale.

**Impostazioni**:

- Visualizzazione a barre, linee o aree. I grafici a barre e ad aree impilano le serie di severità.
- Filtri di severità opzionali.
- Ricerca testuale opzionale nel corpo del log.
- Filtri esatti sugli attributi OpenTelemetry tramite righe chiave/valore ricercabili. I nomi degli attributi e i valori noti vengono suggeriti mentre digiti, e i valori personalizzati restano supportati.
- Un titolo opzionale.

I controlli di intervallo temporale e di aggiornamento della dashboard rieseguono automaticamente la query del grafico. Anche le variabili di attributo telemetrico della dashboard si applicano al widget, comprese quelle a selezione multipla.

Log Chart richiede per ora una dashboard autenticata. Le dashboard pubbliche mostrano il widget come non disponibile anziché esporre in modo anonimo gli aggregati di log del progetto.

Usalo quando: vuoi cogliere i cambiamenti nel volume di log oppure confrontare errori, avvisi e messaggi informativi senza uscire dalla dashboard.

### Log Stream

Una coda live delle righe di log che corrispondono a un filtro.

**Impostazioni**: filtri sui log (servizio, severita, attributi) e le colonne da mostrare.

Usalo quando: vuoi vedere cosa sta dicendo l'applicazione in questo momento, senza uscire dalla dashboard.

### Trace List

Un elenco di trace recenti che corrispondono a un filtro, con durata, stato e servizio.

**Impostazioni**: filtri sui trace (servizio, stato, attributi).

Usalo quando: vuoi un elenco di attivita recenti invece di un grafico. Un pattern comune e un grafico di latenza in alto con un elenco di trace lenti sotto.

## Elenchi live

### Incident List

Un elenco live di incidenti che corrispondono a un filtro.

**Impostazioni**: filtri per stato, severita, etichette, monitor o team.

Usalo quando: la dashboard risponde alla domanda "cosa e rotto in questo momento?"

### Alert List

Un elenco live di allarmi che corrispondono a un filtro.

**Impostazioni**: filtri per stato, severita, etichette.

Usalo quando: una dashboard di team traccia gli allarmi sui propri servizi.

### Monitor List

Un elenco live di monitor con il loro stato corrente.

**Impostazioni**: filtri per tipo di monitor, etichette o stato corrente.

Usalo quando: vuoi una vista di flotta — "tutti i siti sono su?"

## Obiettivi di livello di servizio

### SLO

Un singolo obiettivo di livello di servizio, disegnato come numero singolo oppure come linea nel tempo.

**Impostazioni**: quale SLO, quale dei suoi tre numeri (SLI, Error Budget Remaining o Burn Rate), visualizzazione Tile o Chart e un titolo opzionale.

- **Tile** stampa il numero corrente e, dove c'è, una seconda riga: il target sotto lo SLI, i minuti rimasti sotto l'error budget. Una pillola di stato colora il tutto.
- **Chart** disegna lo stesso numero sull'intervallo temporale della dashboard, con il target segnato come linea tratteggiata sulla serie dello SLI. Lo storico viene scritto ogni pochi minuti dal worker di valutazione, quindi uno SLO appena creato appare vuoto finché non viene valutato per la prima volta.

Usalo quando: la dashboard risponde a "stiamo rispettando quello che abbiamo promesso?" piuttosto che a "cosa sta succedendo in questo momento?"

Il widget SLO funziona sulle [dashboard pubbliche](/docs/dashboards/sharing). Ciò che viene pubblicato sono i numeri principali dello SLO — nome, target, SLI corrente, error budget rimanente, burn rate e stato — indipendentemente da quale di essi il widget disegni. La sua definizione resta privata: i monitor che osserva, le sue etichette, la sua descrizione, la sua query e la sua pianificazione di valutazione non vengono mai inviati a un visitatore pubblico. Un widget Tile pubblica solo quei numeri correnti; un widget Chart pubblica anche lo storico dell'unica serie che disegna, e nulla di più.

## Elenchi di risorse Kubernetes

Per progetti con un [Kubernetes Agent](/docs/monitor/kubernetes-agent) installato. Ognuno accetta filtri opzionali per cluster, namespace ed etichette.

- **Kubernetes Pod List** — pod con la loro fase, riavvii e nodo.
- **Kubernetes Node List** — nodi con le loro condizioni e capacita.
- **Kubernetes Namespace List** — namespace e conteggi dei workload.
- **Kubernetes Deployment List** — deployment con repliche desiderate vs. pronte.
- **Kubernetes StatefulSet List** — stateful set con repliche pronte.
- **Kubernetes DaemonSet List** — daemon set con desiderati vs. pronti.
- **Kubernetes Job List** — job e il loro stato di completamento.
- **Kubernetes CronJob List** — cron job con pianificazione e ultima esecuzione.

Usali quando: vuoi un'unica dashboard che combini stato Kubernetes con la telemetria di quei workload.

## Elenchi di risorse Docker

Per progetti con il monitoraggio Docker configurato.

- **Docker Host List** — host che eseguono Docker, con conteggi dei container.
- **Docker Container List** — container con stato, immagine, host, uptime.
- **Docker Image List** — immagini e le loro dimensioni.
- **Docker Network List** — reti Docker e container connessi.
- **Docker Volume List** — volumi Docker e il loro utilizzo.

## Infrastruttura

### Host List

Host monitorati dal monitor server di OneUptime, con stato, CPU, memoria e uptime.

**Impostazioni**: filtri per etichette o stato corrente.

## Rete

### Network Map

I tuoi siti di rete disegnati sulla mappa del mondo, ciascuno fissato alla propria latitudine e longitudine e colorato in base allo stato dei monitor aggregato su di esso. I siti vicini tra loro condividono un indicatore con il conteggio scritto all'interno; un indicatore che rappresenta esattamente un sito apre quel sito quando lo si clicca.

La mappa si inquadra sui siti che ha disegnato — un parco all'interno di un solo paese riempie l'inquadratura con quel paese, uno distribuito tra continenti si apre sul mondo. Non ci sono controlli di zoom o di spostamento: una tile della dashboard è un'immagine, e la pagina Network Map sotto Network è il posto dove percorrere la gerarchia.

Sopra la mappa viene stampato quanti siti sono giù, perché un punto rosso di due pixel tra duecento verdi non è qualcosa che si legga a distanza di dashboard. Sotto, una riga di copertura dice cosa la mappa _non_ sta mostrando — i siti senza coordinate, e se è stato raggiunto il limite di righe.

**Impostazioni**: titolo, vista mappa o elenco, numero massimo di siti disegnati, se stampare i nomi dei siti, e filtri per tipo di sito e per stato. I nomi dei siti scompaiono automaticamente quando la mappa diventa troppo affollata perché siano leggibili; il tooltip continua a nominare ogni indicatore.

Un sito appare solo se ha le coordinate. Aggiungi latitudine e longitudine sul sito (o importale da CSV) per fissarlo.

## Quale widget usare?

Alcune regole rapide:

- **Trend nel tempo?** Chart.
- **Volume di log o picchi di errore nel tempo?** Log Chart.
- **Un solo numero che conta in questo momento?** Value (o Gauge se ha un chiaro min/max).
- **Scomposizione su molte cose?** Table.
- **Cosa sta succedendo nel sistema in questo momento?** Log Stream, Trace List, Incident List.
- **Lo stato di uno specifico gruppo di risorse?** Il widget di elenco corrispondente.
- **Stiamo rispettando l'affidabilità promessa?** SLO.
- **Dove si trova la tua rete nel mondo e cosa è rosso?** Network Map.
- **Un'intestazione, un paragrafo o un link?** Text.
- **Qualcosa che nessuno dei precedenti copre?** HTML — ma solo dopo aver verificato che un widget integrato davvero non sia in grado di farlo.

La maggior parte delle dashboard mescola alcuni di essi — un grafico in alto, uno o due valori a fianco, un divisore di testo e uno o due elenchi sotto.

## Letture successive

- [Variabili e filtri](/docs/dashboards/variables) — rendere i widget riutilizzabili per molti servizi o clienti.
- [Creazione di una dashboard](/docs/dashboards/authoring) — la meccanica del canvas.
- [Condivisione e dashboard pubbliche](/docs/dashboards/sharing) — condividere fuori dal tuo team.
