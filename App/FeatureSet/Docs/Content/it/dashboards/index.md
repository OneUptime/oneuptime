# Panoramica delle dashboard

Le dashboard sono il modo in cui trasformi la telemetria che OneUptime sta già raccogliendo — metriche, log, trace, incidenti, monitor, risorse Kubernetes e Docker — in una singola pagina su cui qualcuno può dare un'occhiata e capire la salute di un sistema.

Posiziona un grafico per la latenza delle richieste accanto a un elenco di incidenti aperti accanto a un indicatore per l'utilizzo CPU accanto a una frase di stato in inglese semplice. Salva. Condividi il link.

## A colpo d'occhio

- **Funzionalità di primo livello** nella dashboard OneUptime in **Dashboards**.
- **Canvas basato su griglia** — di default 12 unità di larghezza per 60 unità di altezza. Trascina dentro i widget, ridimensionali, snap alla griglia.
- **Più di 20 tipi di widget** — grafici, valori singoli, indicatori, tabelle, blocchi di testo, stream di log, elenchi di trace ed elenchi live di risorse per incidenti, allarmi, monitor, Kubernetes (pod, nodi, deployment, …), Docker e host.
- **Variabili e filtri** — trasforma una singola dashboard in una vista templatizzata da riutilizzare per ogni cluster, servizio, cliente o ambiente.
- **Condivisione pubblica** — attiva un interruttore e la dashboard è raggiungibile su un URL pubblico, con protezione opzionale tramite password e allowlist di IP.
- **Domini personalizzati** — ospita una dashboard pubblica su `status.your-domain.com` invece che su quello di OneUptime.

## Perché usare le dashboard?

Le dashboard si guadagnano il loro posto quando si verifica una delle seguenti situazioni:

- **Ti serve una pagina "va tutto bene?"** per un turno on-call, uno standup di team o un CEO che passa davanti al monitor a muro.
- **Devi correlare segnali** — un picco di CPU nello stesso minuto di un aumento della latenza dei trace e di un incidente aperto è molto più evidente su una sola dashboard che su tre schede separate.
- **Stai investigando** — una dashboard a forma libera che costruisci durante una sessione di debug è più veloce di lanciare dieci query a mano.
- **Stai pubblicando verso l'esterno** — una dashboard di performance rivolta ai clienti, un rollup per partner, una bacheca pubblica di salute per un servizio open-source.

## Concetti chiave

| Termine | Significato |
| --- | --- |
| **Dashboard** | Il canvas. Una vista riutilizzabile e con un nome che contiene un elenco di widget, un controllo per l'intervallo temporale e un set di variabili. |
| **Widget** | Un componente sul canvas — un grafico, un valore, una tabella, un blocco di testo, un elenco. Ognuno ha un tipo e una configurazione in stile JSON. |
| **Unità di dashboard** | La cella della griglia. I widget sono dimensionati in unità di dashboard (es. "4 di larghezza × 6 di altezza"). Le unità si convertono in pixel in base al viewport. |
| **Variabile** | Un valore con nome che il visualizzatore sceglie da un dropdown (o digita) e che la dashboard inietta nella query di ogni widget. Cluster, servizio, cliente, ambiente — qualunque cosa su cui filtreresti. |
| **Intervallo temporale** | La finestra temporale rispetto alla quale ogni widget esegue le proprie query. Scegli un preset ("ultime 24 ore") o un intervallo personalizzato. |
| **Intervallo di refresh** | Con quale frequenza i widget rieseguono la query in modalità **View**. Off, 5s, 10s, 30s, 1m, 5m, 15m. |
| **Modalità** | `Edit` (trascina, ridimensiona, configura) o `View` (sola lettura). Le due condividono lo stesso canvas. |

## Il catalogo dei widget

Una mappa non esaustiva di cosa puoi mettere su una dashboard:

| Categoria | Widget |
| --- | --- |
| **Serie temporali** | Chart |
| **Singolo numero** | Value, Gauge |
| **Tabellare** | Table |
| **Annotazione** | Text |
| **Log e trace** | LogStream, TraceList |
| **Elenchi operativi** | IncidentList, AlertList, MonitorList |
| **Kubernetes** | KubernetesPodList, KubernetesNodeList, KubernetesNamespaceList, KubernetesDeploymentList, KubernetesStatefulSetList, KubernetesDaemonSetList, KubernetesJobList, KubernetesCronJobList |
| **Docker** | DockerHostList, DockerContainerList, DockerImageList, DockerNetworkList, DockerVolumeList |
| **Infrastruttura** | HostList |

Per gli argomenti di ognuno e quando usarli, vedi [Widget](/docs/dashboards/widgets).

## Dove vivono le dashboard nella dashboard

| Pagina | Cosa fai lì |
| --- | --- |
| **Dashboards** | Sfogliare, creare, cercare ed etichettare le dashboard. |
| **Una dashboard → View** | Il canvas — modalità Edit per gli autori, modalità View per tutti gli altri. Si commuta tra le due nell'header. |
| **Una dashboard → Overview** | Descrizione, ownership, label. |
| **Una dashboard → Settings** | Condivisione pubblica, password master, allowlist di IP, domini personalizzati, branding (titolo della pagina, descrizione, logo, favicon). |
| **Una dashboard → Owners** | Utenti e team con ownership esplicita. |
| **Una dashboard → Delete** | Rimuovere la dashboard (irreversibile). |

## Il ciclo di vita di una dashboard

1. **Crea** — In **Dashboards → Create Dashboard**, dalle un nome. Il canvas si apre vuoto.
2. **Posiziona widget** — Dalla palette dei widget, scegli un tipo, configura la sua sorgente (una query metrica, un filtro per liste, un body di testo libero). Posiziona e ridimensiona.
3. **(Opzionale) Aggiungi variabili** — Definisci un dropdown come `cluster` o `service` così la stessa dashboard si renderizza per ogni valore.
4. **Imposta l'intervallo temporale e l'intervallo di refresh** — I default vanno bene; affinali in seguito.
5. **(Opzionale) Condividi pubblicamente** — In **Settings**, attiva **Public Dashboard**. Aggiungi una password master se vuoi un gate, oppure restringi per IP.
6. **(Opzionale) Dominio personalizzato** — Aggiungi un record `dashboard.your-domain.com` e verifica il DNS, poi servi la dashboard sul tuo URL.

## Un esempio concreto

Obiettivo: una pagina on-call per il servizio checkout con latenza, tasso di errore, incidenti aperti e un tail recente dei log.

1. Crea una dashboard "Checkout on-call".
2. Aggiungi una variabile `service` di tipo **Telemetry Attribute** legata alla chiave attributo `service.name`. Valore di default `checkout`.
3. Accanto, aggiungi un widget **Chart**: latenza P95 dalla tua metrica APM, filtrata da `service.name = {{service}}`. L'intervallo temporale segue la dashboard.
4. Aggiungi un widget **Value**: percentuale di tasso di errore con soglia di warning all'1% e soglia critica al 5%.
5. Sotto, aggiungi un widget **IncidentList** filtrato per label che includano `checkout`.
6. Sotto ancora, un widget **LogStream** filtrato per `service.name = {{service}}`.
7. Salva. Cambia il dropdown della variabile a `payments` — l'intera dashboard si ricalcola per il servizio payments. Stesso template, filtro diverso.

## Come le dashboard si integrano con il resto di OneUptime

- **Monitor e telemetria** alimentano le dashboard con dati grezzi — ogni metrica configurata, ogni riga di log ingerita, ogni span di trace è interrogabile su un widget.
- **Incidenti e allarmi** compaiono nei widget **IncidentList** e **AlertList** — le dashboard sono viste in sola lettura su di essi; crea/modifica quelle entità altrove.
- Le **status page** sono uno strumento di comunicazione rivolto ai clienti ("il sistema è su in questo momento?"). Le dashboard sono uno strumento analitico ("come si sta comportando il sistema nel dettaglio?"). I due sono complementari, non sostituti.
- I **workflow** sono il lato scrittura di OneUptime — le dashboard sono il lato lettura.

## Cosa leggere dopo

- [Creare una dashboard](/docs/dashboards/authoring) — usare il canvas, la griglia, modalità edit vs view.
- [Widget](/docs/dashboards/widgets) — il catalogo e la configurazione per ogni widget.
- [Variabili e filtri](/docs/dashboards/variables) — templatizzare una dashboard perché funzioni per molti servizi / clienti / cluster.
- [Condivisione e dashboard pubbliche](/docs/dashboards/sharing) — URL pubblici, password master, allowlist di IP, domini personalizzati.
- [Configurazione e permessi](/docs/dashboards/configuration) — ownership, label, retention, controllo accessi basato sui ruoli.
