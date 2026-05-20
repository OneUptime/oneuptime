# Widget

Un widget è un tassello su una dashboard. Ogni widget ha un tipo (grafico, valore, lista, …), una posizione, una dimensione e una configurazione. Questa pagina è il catalogo — cosa mostra ciascun widget, cosa accetta in input, quando rivolgersi ad esso.

Per la meccanica del canvas, vedi [Creare una dashboard](/docs/dashboards/authoring).

## Widget di serie temporali

### Chart

Un grafico a linee / barre / aree di una o più serie metriche sull'intervallo temporale della dashboard.

**Configura**:

- Una o più query metriche (`metricQueryConfig` per una singola serie, `metricQueryConfigs` per più serie).
- Una **formula** opzionale che combini più query (es. `errors / total * 100`).
- Un **transformAsRate** opzionale per contatori cumulativi OpenTelemetry (es. `system.disk.io`) — il widget calcola `(value - previousValue) / Δt` per bucket.
- Visualizzazione: serie impilate vs. sovrapposte, unità dell'asse Y, legenda on/off, tipo di grafico.

Rivolgiti ad esso quando: i trend contano. Latenza delle richieste, conteggio errori nel tempo, profondità della coda, qualsiasi cosa dove la forma della curva ti dice qualcosa.

### Value

Un singolo numero grande con soglie opzionali e una sparkline opzionale.

**Configura**:

- Una query metrica (valore singolo — di solito `last`, `avg` o `max` sull'intervallo temporale).
- Una **soglia di warning** opzionale (giallo se sopra).
- Una **soglia critica** opzionale (rosso se sopra).
- Visualizzazione: formato numerico, suffisso unità.

Rivolgiti ad esso quando: un singolo numero risponde alla domanda. Tasso di errore corrente, latenza P95 in questo istante, conteggio incidenti aperti.

### Gauge

Un indicatore circolare con min, max, banda di warning e banda critica.

**Configura**: la query metrica e i quattro limiti (min, max, warning, critical).

Rivolgiti ad esso quando: il valore si trova dentro un intervallo noto. Utilizzo CPU (0–100%), riempimento del disco, capacità della coda.

### Table

Una visualizzazione tabellare dei risultati di una query metrica, una riga per gruppo.

**Configura**: la query metrica (tipicamente raggruppata per una label come `host.name` o `service.name`), le colonne da mostrare e un limite di righe.

Rivolgiti ad esso quando: vuoi la suddivisione invece del trend. Top 10 host più rumorosi, conteggio errori per servizio, tasso di richieste per endpoint.

## Widget di annotazione

### Text

Un blocco statico di Markdown.

**Configura**: il body Markdown. Intestazioni, elenchi, link, enfasi, code span, code block recintati vengono tutti renderizzati.

Rivolgiti ad esso quando: vuoi un'intestazione di sezione, un paragrafo di contesto ("questa dashboard copre il servizio checkout"), un elenco di link a runbook o dashboard correlate, oppure un banner temporaneo durante un incidente.

## Log e trace

### LogStream

Un tail live di righe di log che corrispondono a un filtro.

**Configura**: filtri di log (servizio, severità, match su attributo), le colonne da mostrare.

Rivolgiti ad esso quando: vuoi vedere cosa sta dicendo l'applicazione *in questo momento* su una dashboard, senza lasciare la pagina per aprire l'esploratore di log.

### TraceList

Un elenco di trace recenti che corrispondono a un filtro, con durata, stato e nome del servizio.

**Configura**: filtri di trace (servizio, stato, match su attributo).

Rivolgiti ad esso quando: vuoi una vista paginata dell'attività recente invece di un grafico. Accoppiamento comune: un Chart di latenza in cima, un TraceList di trace lenti sotto.

## Elenchi operativi

### IncidentList

Un elenco live di incidenti che corrispondono a un filtro.

**Configura**: filtri per stato, severità, label, monitor o team assegnato.

Rivolgiti ad esso quando: una dashboard è pensata per rispondere a "cosa è rotto in questo momento?"

### AlertList

Un elenco live di allarmi che corrispondono a un filtro.

**Configura**: filtri per stato, severità, label.

Rivolgiti ad esso quando: dashboard per workflow basati su allarmi (es. dashboard dei team di sviluppo che osservano gli allarmi del loro servizio).

### MonitorList

Un elenco live di monitor che corrispondono a un filtro, mostrando lo stato corrente di ciascuno.

**Configura**: filtri per tipo di monitor, label o stato corrente.

Rivolgiti ad esso quando: vuoi una vista a livello di flotta "tutti i siti web sono su?", o un elenco per-team di endpoint monitorati.

## Elenchi di risorse Kubernetes

Per i progetti con un [Agente Kubernetes](/docs/monitor/kubernetes-agent) installato, sono disponibili i seguenti widget di risorse live. Ognuno accetta filtri opzionali per `cluster`, `namespace` e label.

- **KubernetesPodList** — pod con fase, restart e assegnazione di nodo.
- **KubernetesNodeList** — nodi con condizioni, capacità e allocazioni.
- **KubernetesNamespaceList** — namespace e i loro conteggi di workload.
- **KubernetesDeploymentList** — deployment con repliche desiderate vs. pronte.
- **KubernetesStatefulSetList** — stateful set con repliche pronte.
- **KubernetesDaemonSetList** — daemon set con desiderate vs. pronte.
- **KubernetesJobList** — job con stato di completamento.
- **KubernetesCronJobList** — cron job con schedulazione e ultima esecuzione.

Rivolgiti ad essi quando: vuoi una singola dashboard che mescoli lo stato delle risorse Kubernetes con la telemetria proveniente da quei workload.

## Elenchi di risorse Docker

Per i progetti con un monitor Docker installato:

- **DockerHostList** — host che eseguono Docker, con conteggi di container.
- **DockerContainerList** — container con stato, immagine, host, uptime.
- **DockerImageList** — immagini e le loro dimensioni.
- **DockerNetworkList** — reti Docker e conteggi dei container connessi.
- **DockerVolumeList** — volumi Docker e il loro utilizzo.

## Infrastruttura

### HostList

Host monitorati dal monitor server di OneUptime — con stato corrente, CPU, memoria e uptime.

**Configura**: filtri per label o stato di salute corrente.

## Scegliere il widget giusto

Qualche regola pratica:

- **Trend nel tempo?** Chart.
- **Un numero che conta in questo momento?** Value (o Gauge se ha un intervallo naturale).
- **Suddivisione su molte cose?** Table.
- **Cosa sta succedendo nel sistema in questo momento?** LogStream, TraceList, IncidentList.
- **Stato di una specifica flotta di risorse?** Il widget di elenco risorse corrispondente.
- **Un'intestazione, un paragrafo o un link?** Text.

La maggior parte delle dashboard usa un mix — un Chart in cima, un Value o due al suo fianco, un divisore Text, poi uno o due elenchi sotto.

## Cosa leggere dopo

- [Variabili e filtri](/docs/dashboards/variables) — rendere i widget riutilizzabili tra servizi / clienti / cluster.
- [Creare una dashboard](/docs/dashboards/authoring) — il canvas, la griglia e la modalità di edit.
- [Condivisione e dashboard pubbliche](/docs/dashboards/sharing) — esporre una dashboard fuori dal team.
