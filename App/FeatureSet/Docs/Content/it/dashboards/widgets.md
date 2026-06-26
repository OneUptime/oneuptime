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

## Log e trace

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

## Quale widget usare?

Alcune regole rapide:

- **Trend nel tempo?** Chart.
- **Un solo numero che conta in questo momento?** Value (o Gauge se ha un chiaro min/max).
- **Scomposizione su molte cose?** Table.
- **Cosa sta succedendo nel sistema in questo momento?** Log Stream, Trace List, Incident List.
- **Lo stato di uno specifico gruppo di risorse?** Il widget di elenco corrispondente.
- **Un'intestazione, un paragrafo o un link?** Text.

La maggior parte delle dashboard mescola alcuni di essi — un grafico in alto, uno o due valori a fianco, un divisore di testo e uno o due elenchi sotto.

## Letture successive

- [Variabili e filtri](/docs/dashboards/variables) — rendere i widget riutilizzabili per molti servizi o clienti.
- [Creazione di una dashboard](/docs/dashboards/authoring) — la meccanica del canvas.
- [Condivisione e dashboard pubbliche](/docs/dashboards/sharing) — condividere fuori dal tuo team.
