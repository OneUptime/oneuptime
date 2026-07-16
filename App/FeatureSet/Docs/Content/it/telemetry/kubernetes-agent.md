# OneUptime Kubernetes Agent (Helm)

## Panoramica

OneUptime Kubernetes Agent è un chart Helm preconfezionato che installa una pipeline di raccolta basata su OpenTelemetry sul tuo cluster. Fornisce metriche di nodi, pod, container e cluster; eventi Kubernetes; log dei pod; e — con eBPF attivo per impostazione predefinita — tracce delle applicazioni, metriche HTTP RED, dati del grafo dei servizi e metriche di flusso di rete pod-a-pod. Nessuna modifica al codice, nessun SDK, un solo `helm install`.

Questa pagina è la **guida all'installazione**. Per configurare monitor e avvisi Kubernetes sopra i dati raccolti dall'agent, consulta [Kubernetes Agent (monitor)](/docs/monitor/kubernetes-agent).

## Prerequisiti

- Un cluster Kubernetes in esecuzione (v1.23+)
- `kubectl` configurato per accedere al tuo cluster
- `helm` v3 installato
- Una **chiave API di OneUptime** — creane una da _Project Settings → API Keys_

## Passo 1 — Aggiungi il repository Helm di OneUptime

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm repo update
```

## Passo 2 — Scegli un preset per il tuo cluster

Il chart espone una singola opzione di livello superiore — `preset` — che seleziona valori predefiniti compatibili per la tua distribuzione Kubernetes. Controlla aspetti che altrimenti dovresti regolare manualmente: se inviare i log tramite un DaemonSet hostPath o tramite l'API Kubernetes, e quale contesto di sicurezza applicare.

| `preset`                   | Usare per                                                                           | Raccolta dei log                                                                               |
| -------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `standard` _(predefinito)_ | Cluster autogestiti, **EKS su EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | DaemonSet che legge `/var/log/pods` tramite hostPath (overhead minimo)                         |
| `gke-autopilot`            | **GKE Autopilot**                                                                   | Deployment di tailer dei log tramite API Kubernetes (nessun hostPath, nessun accesso all'host) |
| `eks-fargate`              | **EKS Fargate**                                                                     | Deployment di tailer dei log tramite API Kubernetes (nessun hostPath, nessun accesso all'host) |

Se non sei sicuro, inizia con `standard`. Se l'installazione fallisce con un errore di Pod Security che menziona `hostPath`, riesegui con `preset=gke-autopilot` (o `eks-fargate` su Fargate) e funzionerà.

## Passo 3 — Installa il Kubernetes Agent

Sostituisci `YOUR_ONEUPTIME_URL`, `YOUR_ONEUPTIME_API_KEY` e il nome del cluster con i valori del tuo ambiente. Il nome del cluster è il modo in cui il cluster apparirà in OneUptime — scegli qualcosa di stabile come `prod-us-east-1`.

### Cluster standard (autogestiti, EKS su EC2, GKE Standard, AKS)

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster"
```

### GKE Autopilot

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set preset=gke-autopilot
```

### EKS Fargate

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set preset=eks-fargate
```

## Passo 4 — Verifica l'installazione

Controlla che i pod dell'agent siano in esecuzione:

```bash
kubectl get pods -n oneuptime-agent
```

Su un cluster **standard** vedrai un Deployment cluster-collector più un pod DaemonSet node-collector per nodo:

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-xxxxx                   1/1     Running   0          1m
kubernetes-agent-logs-yyyyy                   1/1     Running   0          1m
```

Su **GKE Autopilot** il node collector viene comunque eseguito — raccoglie le metriche di kubelet e cAdvisor senza aver bisogno di hostPath — e un Deployment aggiuntivo fa il tail dei log dei pod tramite l'API Kubernetes:

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-yyyyyyyyyy-yyyyy        1/1     Running   0          1m
kubernetes-agent-logs-xxxxx                   1/1     Running   0          1m
```

Su **EKS Fargate** vedrai due Deployment e nessun DaemonSet — Fargate assegna a ogni pod la propria micro-VM e non pianifica mai i DaemonSet, quindi le metriche a livello di nodo non sono disponibili lì:

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-yyyyyyyyyy-yyyyy        1/1     Running   0          1m
```

Una volta che l'agent si connette, il tuo cluster apparirà automaticamente nella sezione **Kubernetes** della dashboard di OneUptime.

## Opzioni di configurazione

### Filtraggio dei namespace

`namespaceFilters` limita i **log dei pod** (sia il DaemonSet hostPath sia il tailer dei log tramite API) e le **tracce eBPF** ai namespace che scegli. `kube-system` è escluso per impostazione predefinita. Per limitare quei segnali a namespace specifici:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set "namespaceFilters.include={default,production,staging}"
```

Per ignorare un singolo namespace rumoroso mantenendo tutti gli altri, usa invece `exclude`. `exclude` prevale sempre su `include`, e il valore predefinito fornito è `[kube-system]` — quindi elencalo di nuovo se vuoi che resti escluso:

```bash
  --set "namespaceFilters.exclude={kube-system,noisy-namespace}"
```

Per i **log dei pod e le tracce eBPF questo non costa nulla**: il namespace fa parte del percorso dei log dei pod e della discovery dei processi di OBI, quindi un namespace filtrato non viene proprio mai letto — nessuna CPU, nessun egress.

#### Applicare i filtri dei namespace a metriche e tracce

Per impostazione predefinita gli elenchi qui sopra coprono solo i log dei pod e le tracce eBPF. `applyTo` li estende ad altri segnali:

```bash
  --set namespaceFilters.applyTo.metrics=true \
  --set namespaceFilters.applyTo.traces=true
```

| Impostazione | Cosa copre |
| ------------ | ---------- |
| `applyTo.metrics` | Metriche per pod / per container da kubeletstats, cAdvisor e kube-state-metrics |
| `applyTo.traces` | Span che le tue applicazioni inviano all'endpoint OTLP dell'agent (gli span eBPF sono già circoscritti) |

Entrambe sono **disattivate per impostazione predefinita** di proposito. `exclude: [kube-system]` è fornito come valore predefinito, quindi attivarle automaticamente eliminerebbe silenziosamente le metriche di kube-system da ogni installazione esistente al momento dell'aggiornamento.

> **Le metriche a livello di nodo e di cluster vengono sempre mantenute.** Un namespace è una proprietà di un pod, non di un nodo, quindi serie come CPU del nodo, memoria del nodo e uso del filesystem non hanno nulla su cui corrispondere e non vengono mai eliminate. `applyTo.metrics` riduce la cardinalità per pod senza mai renderti cieco di fronte a un nodo che si sta guastando.

Gli **eventi** Kubernetes non sono filtrabili per namespace a livello di agent. Arrivano dal receiver `k8sobjects` senza un attributo `k8s.namespace.name` — il namespace si trova all'interno del corpo dell'evento — quindi non c'è nulla a cui un filtro possa corrispondere. Eliminali invece lato server (vedi sotto).

### Filtraggio per severità dei log

`filters.logs.minSeverity` elimina i record dei **log dei pod** al di sotto di una severità, a livello di agent, prima che venga inviato qualsiasi cosa:

```bash
  --set filters.logs.minSeverity=WARN
```

Accetta `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL`. `WARN` mantiene WARN, ERROR e FATAL ed elimina INFO, DEBUG e TRACE. Il valore predefinito (`""`) mantiene tutto. Si applica in **entrambe** le modalità di log — in modalità `daemonset` tramite il collector, in modalità `api` all'interno del tailer dei log stesso — quindi i preset non possono disattivarlo alle tue spalle.

I runtime dei container non registrano una severità sulla riga di log, quindi l'agent ne ricava una dal testo del log stesso (`[ERROR]`, `WARN:`, `level=info`, …).

> **Gli eventi Kubernetes e le specifiche delle risorse non vengono mai filtrati da questo.** Arrivano dall'API Kubernetes senza una severità propria, quindi una soglia eliminerebbe l'intero flusso invece di ridurlo — inclusi gli avvisi `FailedScheduling`, `BackOff` e `OOMKilling` che più ti interessano. Sono a basso volume e ad alto valore, quindi l'agent li invia sempre. Per ridurli, usa invece i **Logs → Settings → Drop Filters** lato server della dashboard.

**Cosa succede a una riga senza un livello riconoscibile dipende dalla modalità di log**, perché le due modalità hanno a disposizione informazioni diverse:

| Modalità | Riga senza etichetta | Perché |
| -------- | -------------------- | ------ |
| `daemonset` | `stderr` → trattata come ERROR (mantenuta), `stdout` → trattata come INFO (eliminata da una soglia WARN) | Il runtime dei container registra da quale stream proviene ogni riga. |
| `api` | Sempre **mantenuta** | L'API `pods/log` di Kubernetes unisce stdout e stderr in un unico stream senza alcun marcatore per riga. Invece di tirare a indovinare, l'agent mantiene la riga. |

> Quindi la modalità `api` elimina strettamente meno della modalità `daemonset`. È una scelta deliberata: un traceback Python o un `npm ERR!` non contiene alcuna parola chiave di severità, ed eliminarlo silenziosamente è esattamente il fallimento da cui una soglia di severità dovrebbe proteggerti.

Gli eventi multi-riga vengono ricomposti **prima** del filtraggio in entrambe le modalità, quindi uno stack trace Java viene valutato in base alla sua prima riga e mantenuto o eliminato per intero — non otterrai mai una riga `ERROR` isolata con i suoi frame rimossi.

### Includere o escludere le metriche per nome

`filters.metrics` regola quali metriche escono dal cluster, attraverso ogni receiver della pipeline.

**Elimina alcune metriche rumorose** (una denylist — di solito ciò che vuoi):

```bash
  --set-json 'filters.metrics.exclude=["k8s.volume.available","k8s.volume.capacity"]'
```

**Invia solo un insieme fisso** (una allowlist — tutto il resto viene eliminato):

```bash
  --set-json 'filters.metrics.include=["k8s.pod.cpu.usage","k8s.pod.memory.usage"]'
```

**Corrispondenza per pattern** invece che per nome esatto:

```bash
  --set filters.metrics.matchType=regexp \
  --set-json 'filters.metrics.exclude=["^container_network_"]'
```

| Chiave | Significato |
| ------ | ----------- |
| `filters.metrics.exclude` | Nomi delle metriche da eliminare. Applicato sopra `include`, quindi exclude prevale sempre. |
| `filters.metrics.include` | Quando non è vuoto, vengono inviate **solo** queste. |
| `filters.metrics.matchType` | `strict` (nome esatto, il valore predefinito) oppure `regexp` (RE2, **senza ancoraggio**). |

Note che ti eviteranno un incidente:

- `regexp` è **senza ancoraggio** — `system.cpu` corrisponde anche a `system.cpu.time`. Ancoralo (`^system\.cpu$`) quando intendi esattamente una metrica.
- RE2 **non ha lookahead**, quindi `^(?!container_)` non verrà compilato. Esprimi "tutto tranne" con `include`, non con una regex negativa.
- `include` si estende a tutti i receiver contemporaneamente. Una allowlist che dimentica una metrica rimuove silenziosamente i monitor costruiti su di essa. Preferisci `exclude` a meno che tu non voglia davvero un insieme chiuso.
- Usa `--set-json` (o un file di valori) per gli elenchi. Il semplice `--set` sostituisce un elenco invece di unirlo.

> **Testa una regex prima di distribuirla.** I pattern vengono compilati dal collector all'avvio, non per ogni record, quindi uno non valido non si comporta male in silenzio — il collector si rifiuta di avviarsi ed entra in CrashLoopBackOff, portandosi dietro anche i **log** di quel collector oltre alle sue metriche. Helm non è in grado di compilare RE2, quindi `helm upgrade` accetta un pattern errato senza protestare.

### Campionamento delle tracce

I filtri qui sopra rimuovono una **categoria** di telemetria — un namespace, una severità, un nome di metrica. Il campionamento è diverso: mantiene ogni categoria e riduce invece la popolazione. Imposta `sampling.traces.percentage` sulla quota di tracce che vuoi mantenere:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set sampling.traces.percentage=10
```

Questo mantiene una traccia su dieci ed elimina le altre nove a livello di agent, prima che lascino il tuo cluster.

**Ottieni tracce intere, non frammenti.** La decisione è un hash del trace ID invece di un lancio di moneta per ogni span, quindi ogni span di una traccia viene mantenuto o eliminato insieme agli altri — le tracce che sopravvivono sono complete e leggibili dall'inizio alla fine. È questa la proprietà che rende sicuro attivare il campionamento.

**I tuoi monitor basati sulle metriche non si spostano.** Le metriche RED di eBPF — frequenza delle richieste, frequenza degli errori, durata — sono una famiglia di *metriche*. OBI le calcola da ogni richiesta e viaggiano lungo la pipeline delle metriche, in cui il sampler non si trova. Con `percentage: 10` ottieni un decimo delle tracce e frequenza/errori/latenza accurati al 100%. Le dashboard e i monitor costruiti su quelle metriche non ne sono influenzati.

**I tuoi monitor basati sugli span invece sì.** Tutto ciò che OneUptime ricava dagli span stessi si riduce insieme alla frequenza — leggi l'avviso qui sotto prima di attivare questa opzione.

| Chiave | Significato |
| ------ | ----------- |
| `sampling.traces.percentage` | Percentuale di tracce da **mantenere**, 0-100. Predefinito `100` (mantiene tutto). |
| `sampling.traces.hashSeed` | Seed per l'hash del trace ID. Predefinito `22`. |

Note che ti eviteranno un incidente:

- **`0` non mantiene alcuna traccia.** È una frequenza, non un interruttore di spegnimento — elimina ogni traccia mentre il DaemonSet eBPF continua a funzionare e a costarti. Se non vuoi tracce, usa `ebpf.enabled=false`. Se non vuoi tracce ma vuoi *comunque* le metriche RED e la mappa dei servizi, lascia eBPF attivo e imposta deliberatamente questo valore a `0`.
- **Si applica solo quando `ebpf.enabled`.** Altrimenti la pipeline delle tracce non esiste, quindi con `ebpf.enabled=false` questo valore non fa nulla.
- **Solo tracce.** Non esiste `sampling.logs` né `sampling.metrics`, ed è deliberato — vedi la nota qui sotto.
- **Le frazioni richiedono `--set-json`, e hanno un limite inferiore.** `--set sampling.traces.percentage=0.5` fallisce, perché Helm legge `0.5` come una stringa. Usa `--set-json 'sampling.traces.percentage=0.5'` oppure un file di valori. I numeri interi funzionano bene con `--set`. Al di sotto di circa `0.0061` la frequenza viene quantizzata a zero e si comporta esattamente come `0` — ogni traccia eliminata, nessun errore. `0.01` (una su diecimila) è il valore più piccolo che fa ciò che dichiara.
- **Il multi-cluster funziona per impostazione predefinita.** Due agent mantengono la stessa traccia solo se concordano sia su `hashSeed` sia su `percentage`. Entrambi hanno lo stesso valore predefinito ovunque, quindi una traccia che attraversa due cluster sopravvive intera senza alcuna configurazione aggiuntiva. Cambia `hashSeed` solo per *decorrelare* deliberatamente due livelli di campionamento — poiché la decisione è una soglia sullo stesso hash, lo stesso seed a frequenze diverse si annida, quindi un secondo livello si limita a riscegliere le tracce che il primo aveva già mantenuto invece di estrarne di indipendenti.
- **I log dei pod non vengono mai campionati**, quindi con `ebpf.logToTraceCorrelation: true` ogni record di log continua a portare un trace ID mentre viene mantenuto solo il `percentage`% di quelle tracce. Circa il (100 − `percentage`)% dei record di log mostrerà un collegamento a una traccia che non porta da nessuna parte. La navigazione traccia → log non ne è influenzata; solo log → traccia può fallire.

> **Ritara i tuoi monitor basati sugli span quando imposti questo valore.** Il campionamento riduce gli span che raggiungono OneUptime, quindi tutto ciò che li conta ne conta di meno: un monitor **Traces** su `Span Count` e un monitor **Exceptions** su `Exception Count` vedranno circa il `percentage`% del volume di ieri. Una soglia tarata su traffico non campionato smette silenziosamente di essere superata — il monitor non va in errore, semplicemente resta muto. Dividi quelle soglie per lo stesso fattore quando imposti la frequenza; la frequenza vale per l'intero cluster, quindi non c'è modo di esentarne un singolo servizio. Il **raggruppamento** degli errori degrada peggio che linearmente: un'eccezione comune emerge comunque, ma un caso isolato e raro ha più probabilità di sparire del tutto che di apparire un decimo delle volte.

> **Perché qui non c'è campionamento di log o metriche.** Il sampler del collector non è affatto in grado di campionare le metriche. Può campionare i log, ma ricava la sua casualità dal trace ID — e i log dei pod non ne hanno uno. Ogni record privo di trace ID finisce poi nello stesso bucket dell'hash, quindi una frequenza per i log non ridurrebbe il flusso: lo manterrebbe tutto oppure lo eliminerebbe tutto a seconda del seed. Invece di fornire un parametro che elimina silenziosamente i tuoi log, il chart non ne offre nessuno. Riduci i log con [Filtraggio per severità dei log](#filtraggio-per-severità-dei-log) e [Filtraggio dei namespace](#filtraggio-dei-namespace), che sono precisi su ciò che rimuovono.

### Disabilita la raccolta dei log

Se non hai bisogno dei log dei pod:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set logs.enabled=false
```

Le tue metriche non vengono toccate: il node collector continua a funzionare per le metriche di kubelet, cAdvisor e host, si limita a smettere di leggere i log dei pod. Si fermano gli avvisi basati sui log, e nient'altro.

### Forza una modalità specifica di raccolta dei log

Gli utenti avanzati possono sovrascrivere la scelta del preset con `logs.mode`:

- `logs.mode=daemonset` — DaemonSet hostPath (overhead minimo, richiede hostPath)
- `logs.mode=api` — Deployment di tailer dei log tramite API Kubernetes (funziona su qualsiasi cluster)
- `logs.mode=disabled` — nessuna raccolta dei log

> La modalità di log decide soltanto da dove arrivano i **log dei pod**. Le metriche dei nodi vengono raccolte indipendentemente da essa, quindi `api` e `disabled` mantengono le tue metriche di kubelet, cAdvisor e host.
>
> L'unica eccezione riguarda la piattaforma, non la modalità: **EKS Fargate non può pianificare affatto i DaemonSet**, quindi lì non c'è alcun node collector e le metriche di nodo, pod e container non sono disponibili. GKE Autopilot esegue il node collector senza problemi, ma blocca `hostPath`, quindi raccoglie le metriche di kubelet e cAdvisor senza quelle di `hostmetrics` (I/O del disco, inode, errori delle NIC) che devono leggere `/proc` e `/sys` dell'host.

Il valore esplicito `logs.mode` prevale sempre sul valore predefinito del preset. Usalo se conosci il tuo cluster meglio del preset.

### Abilita il monitoraggio del control plane

Per i cluster autogestiti (non EKS / GKE / AKS), puoi abilitare le metriche del control plane:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set controlPlane.enabled=true
```

> I servizi Kubernetes gestiti (EKS, GKE, AKS) in genere non espongono le metriche del control plane. Abilita questa opzione solo per i cluster autogestiti.

### Tag automatici con etichette di progetto

Qualsiasi attributo di risorsa con prefisso `oneuptime.label.` viene promosso a un'etichetta (Label) di progetto e associato al cluster, ai servizi e agli host emessi da questo agent. Schema: `oneuptime.label.<dimension>=<value>` diventa un'etichetta denominata `<dimension>:<value>`.

Passa le etichette al momento dell'installazione con `--set oneuptime.labels.<key>=<value>`:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="prod" \
  --set oneuptime.labels.team=payments \
  --set oneuptime.labels.env=production \
  --set oneuptime.labels.region=us-east-1
```

Oppure mantienile in un file di valori:

```yaml
# values.yaml
oneuptime:
  url: YOUR_ONEUPTIME_URL
  apiKey: YOUR_ONEUPTIME_API_KEY
  labels:
    team: payments
    env: production
    region: us-east-1
clusterName: prod
```

Le etichette vengono confrontate senza distinzione tra maiuscole e minuscole, quindi un'etichetta `Production` esistente creata manualmente viene riutilizzata invece di essere duplicata. Le etichette aggiunte manualmente nell'interfaccia di OneUptime non vengono mai rimosse dall'agent.

## Aggiornamento dell'agent

```bash
helm repo update
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values
```

`--reuse-values` mantiene la tua configurazione esistente (preset, nome del cluster, filtri); applica eventuali nuove sovrascritture `--set` sopra di essa.

## Disinstallazione dell'agent

```bash
helm uninstall kubernetes-agent --namespace oneuptime-agent
kubectl delete namespace oneuptime-agent
```

## Cosa viene raccolto

| Categoria                                                                           | Dati                                                                                                                                             |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Metriche dei nodi**                                                               | Utilizzo della CPU, uso della memoria, uso del filesystem, I/O di rete                                                                           |
| **Metriche dei pod**                                                                | Uso della CPU, uso della memoria, I/O di rete, riavvii                                                                                           |
| **Metriche dei container**                                                          | Uso della CPU, uso della memoria per container                                                                                                   |
| **Metriche del cluster**                                                            | Condizioni dei nodi, risorse allocabili, conteggi dei pod                                                                                        |
| **Eventi Kubernetes**                                                               | Avvisi, errori, eventi di scheduling                                                                                                             |
| **Log dei pod**                                                                     | Log stdout/stderr da tutti i container (tramite DaemonSet hostPath sui cluster standard, oppure tramite l'API Kubernetes su Autopilot / Fargate) |
| **Tracce delle applicazioni** _(tramite eBPF, attivo per impostazione predefinita)_ | Span HTTP, gRPC, SQL/Redis da ogni pod — nessun SDK o modifica al codice                                                                         |
| **Metriche HTTP RED** _(tramite eBPF)_                                              | `http.server.request.duration`, dimensioni del corpo di richieste e risposte, per servizio                                                       |
| **Grafo dei servizi** _(tramite eBPF)_                                              | Frequenza delle richieste chiamante → chiamato, latenza e archi di errore — alimenta la vista della mappa dei servizi                            |
| **Metriche di flusso di rete** _(tramite eBPF)_                                     | Contatori di byte e pacchetti TCP/UDP pod-a-pod con metadati k8s                                                                                 |
| **Statistiche TCP** _(tramite eBPF)_                                                | Contatori a livello di nodo di RTT, connessioni fallite e ritrasmissioni                                                                         |

## Tracce delle applicazioni e metriche HTTP tramite eBPF (attivo per impostazione predefinita)

Il chart esegue un DaemonSet con [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) su ogni nodo. Carica programmi eBPF nel kernel e cattura automaticamente il traffico HTTP/HTTPS, gRPC e SQL/Redis da ogni runtime supportato (Go, .NET, Java, Node.js, Python, Ruby, Rust) — senza SDK e senza sidecar. Le tracce e le metriche delle richieste fluiscono poi attraverso il collector in-cluster verso OneUptime.

**Requisiti:** kernel Linux **5.8+** con BTF (predefinito su Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL/Stream 9+). Il DaemonSet eBPF viene eseguito in **modalità privilegiata** perché è necessario, per caricare i programmi eBPF.

### Disabilita l'auto-strumentazione eBPF

Dovresti disabilitarla quando:

- Installi su **GKE Autopilot** o **EKS Fargate** — quelle piattaforme bloccano i pod privilegiati (usa `preset=gke-autopilot` / `preset=eks-fargate` e abbinalo a `ebpf.enabled=false`).
- I nodi eseguono un kernel più vecchio di 5.8 senza i backport BTF.
- Invii già le tracce tramite SDK OpenTelemetry dalle tue applicazioni e non vuoi duplicati.

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set ebpf.enabled=false
```

### Attiva/disattiva singole famiglie di segnali

Tutte attive per impostazione predefinita. Disattivane una qualsiasi con `--set ebpf.features.<name>=false`:

| `ebpf.features.*`         | Predefinito | Cosa aggiunge                                                                    |
| ------------------------- | ----------- | -------------------------------------------------------------------------------- |
| `httpMetrics`             | attivo      | Metriche HTTP/gRPC RED (frequenza delle richieste, latenza, errori) per servizio |
| `spanMetrics`             | attivo      | Dimensione e durata di richiesta/risposta per span                               |
| `serviceGraph`            | attivo      | Metriche degli archi chiamante → chiamato; alimenta la mappa dei servizi         |
| `hostMetrics`             | attivo      | CPU e memoria per processo strumentato                                           |
| `networkMetrics`          | attivo      | Contatori di flusso TCP/UDP pod-a-pod                                            |
| `networkInterZoneMetrics` | disattivo   | Variante inter-zona delle metriche di rete (raddoppia la cardinalità)            |
| `tcpStats`                | attivo      | Contatori a livello di nodo di RTT TCP, connessioni fallite e ritrasmissioni     |

Anche la propagazione del contesto delle tracce tra servizi è attiva per impostazione predefinita — OBI inietta il W3C `traceparent` nel traffico HTTP/TCP in uscita, così una richiesta che attraversa il pod A → pod B appare come un'unica traccia, senza modifiche all'SDK da nessuna parte. Disattivala con `--set ebpf.contextPropagation=false`.

## Ridurre il volume dei dati raccolti

Di default l'agent è ottimizzato per la **copertura** — fornisce metriche, log dei pod e tracce eBPF dell'intero cluster, così ogni dashboard e monitor funziona fin dal primo giorno. Su cluster grandi o molto attivi questo può essere più telemetria di quella che ti serve, il che si traduce in un volume di ingestione più elevato (e, su OneUptime Cloud, in un costo più elevato). Niente di tutto ciò è obbligatorio, ma se un cluster invia più di quanto desideri, questi sono i parametri su cui intervenire — grosso modo in ordine di impatto.

Il trucco è **smettere di raccogliere ciò che non guarderai**, invece di raccogliere tutto e pagare per archiviarlo. Ogni leva qui sotto è un valore Helm, quindi puoi applicarla con `--set` su `helm upgrade --reuse-values` e annullarla allo stesso modo.

### Da dove proviene il volume

| Segnale                               | Fattore principale                                          | Riducilo con                                                                                 |
| ------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Log dei pod**                       | Ogni riga da ogni container, sull'intero cluster            | `namespaceFilters`, `filters.logs.minSeverity`, `logs.enabled`, `logs.mode`                  |
| **Tracce eBPF e metriche degli span** | Una traccia per richiesta da ogni processo strumentato      | `sampling.traces.percentage`, `ebpf.enabled`, `ebpf.features.*`, `ebpf.autoTargetExe`, `ebpf.excludeExePaths` |
| **Punti dati delle metriche**         | Frequenza di scraping × numero di pod/container             | `collectionInterval`, `hostMetrics.collectionInterval`, `cadvisor.scrapeInterval`            |
| **Cardinalità delle metriche**        | Numero di serie distinte (per container, per PVC, …)        | `filters.metrics.exclude`, `namespaceFilters.applyTo.metrics`, `cadvisor.metricsAllowlist`, `kubeletstats.volumeMetrics` |
| **Extra opzionali (opt-in)**          | Profiling, log di audit, control plane, metriche inter-zona | Lasciali disattivati (lo sono già per impostazione predefinita)                              |

Ci sono tre modi per ridurre il volume, e vale la pena sapere quale stai usando:

- **Al receiver** — i dati non vengono mai raccolti. `namespaceFilters` sui log dei pod, `cadvisor.metricsAllowlist`, un `collectionInterval` più lungo. Non costa nulla in esecuzione e fa risparmiare insieme CPU, egress e ingestione. Preferisci sempre questi quando coprono il tuo caso.
- **Al processor `filter`** — i dati vengono raccolti, poi eliminati prima dell'esportazione. `filters.logs.minSeverity`, `filters.metrics.*`, `namespaceFilters.applyTo.*`. Un po' più di CPU per il collector, ma funziona su tutti i receiver e può esprimere cose che un receiver non può.
- **Al sampler** — i dati vengono raccolti, poi ne viene mantenuta una frazione rappresentativa. `sampling.traces.percentage`. È quello anomalo: i due qui sopra rimuovono un'intera *categoria* di telemetria, quindi ciò che eliminano sparisce da ogni traccia. Il campionamento mantiene ogni categoria e riduce la popolazione, quindi ciò che sopravvive è comunque completo e rappresentativo.

Tutti e tre sono **irreversibili**: ciò che elimini qui non raggiunge mai OneUptime, e tutti e tre possono far restare muto un monitor. I primi due silenziano un monitor rimuovendo il segnale che osserva. Il campionamento è più circoscritto: le metriche RED di eBPF vengono calcolate prima che il sampler venga eseguito, quindi i monitor basati sulle metriche restano esatti — ma i monitor che contano gli *span* (**Traces** su `Span Count`, **Exceptions** su `Exception Count`) ne vedono proporzionalmente meno e hanno bisogno che le loro soglie vengano ritarate dello stesso fattore. Se preferisci decidere più tardi, OneUptime può invece eliminare i dati lato server (**Logs → Settings → Drop Filters**, **Metrics → Settings → Pipeline Rules**) — questo costa comunque egress, ma è un'impostazione che puoi cambiare senza un nuovo deploy.

### Leva 1 — I log dei pod sono di solito la singola fonte più grande

I log dei container sono quasi sempre la fetta più grande dell'ingestione, perché si tratta di un record per ogni riga di log da ogni container del cluster.

- **Vuoi i log solo da determinati namespace?** `namespaceFilters` limita i log dei pod in entrambe le modalità di log (e con essi le tracce eBPF). La corrispondenza avviene sul percorso dei log dei pod, quindi i namespace filtrati non vengono nemmeno letti — questa è la leva più economica di questo documento:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set "namespaceFilters.include={default,production}"
  ```

  (`kube-system` è già escluso per impostazione predefinita.) Per mantenere tutti i namespace tranne uno, usa `--set "namespaceFilters.exclude={kube-system,noisy-namespace}"`.

- **Ti interessano solo warning ed errori?** `filters.logs.minSeverity` elimina il resto a livello di agent. Su un cluster molto chiacchierone questa è spesso la singola riduzione più grande disponibile, perché INFO e DEBUG costituiscono il grosso dell'output della maggior parte delle applicazioni:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set filters.logs.minSeverity=WARN
  ```

  Consulta [Filtraggio per severità dei log](#filtraggio-per-severità-dei-log) per sapere come viene determinata la severità e cosa succede ai log che non è possibile classificare.

- **Non hai affatto bisogno dei log dei pod in OneUptime?** Disattivali:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set logs.enabled=false
  ```

  > Questo ferma soltanto i log dei pod. Le metriche di nodi, pod e container continuano a fluire, e i monitor costruiti su di esse (OOM kill, throttling della CPU, spazio su disco basso dei PVC) continuano a funzionare — il node collector resta, si limita a smettere di leggere `/var/log/pods`. Lo stesso vale per `logs.mode: api` e `logs.mode: disabled`.

### Leva 2 — Riduci l'auto-strumentazione eBPF

eBPF ti fornisce tracce, metriche RED, la mappa dei servizi e metriche di flusso di rete senza modifiche al codice — ma è anche la seconda fonte di dati più grande perché emette uno span per richiesta e diverse famiglie di metriche per servizio. Hai tre livelli di controllo:

- **Invii già le tracce dagli SDK OTel, o non vuoi le tracce automatiche?** Disattiva completamente eBPF:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.enabled=false
  ```

- **Mantieni le tracce, elimina le famiglie di metriche pesanti.** La [tabella delle famiglie di segnali qui sopra](#attivadisattiva-singole-famiglie-di-segnali) elenca ogni flag `ebpf.features.*`. Le famiglie con il volume più alto sono le metriche di rete e degli span — disattivandole lasci intatte le tracce, le metriche HTTP RED e la mappa dei servizi:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.features.networkMetrics=false \
    --set ebpf.features.tcpStats=false \
    --set ebpf.features.spanMetrics=false
  ```

  Lascia `ebpf.features.networkInterZoneMetrics` disattivato (il suo valore predefinito) — raddoppia la cardinalità del flusso di rete.

- **Strumenta solo i runtime che ti interessano.** Per impostazione predefinita OBI si aggancia a ogni processo che riconosce (`ebpf.autoTargetExe: "*"`). Restringilo a runtime specifici, oppure aggiungi binari alla lista di esclusione, per ridurre il numero di "servizi" e tracce che l'agent produce:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.autoTargetExe='*/python,*/java'
  ```

  Consulta [Attiva/disattiva singole famiglie di segnali](#attivadisattiva-singole-famiglie-di-segnali) e la nota su `excludeExePaths` nei valori del chart per i valori predefiniti completi.

### Leva 3 — Rallenta gli intervalli di scraping

Il volume delle metriche è direttamente proporzionale alla frequenza con cui l'agent esegue lo scraping. Raddoppiare un intervallo dimezza all'incirca il numero di punti dati che quella metrica produce, senza perdita di copertura — solo una risoluzione più grossolana. Se non ti serve una granularità di 30 secondi, 60s o 120s è una riduzione grande e sicura:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set collectionInterval=60s \
  --set hostMetrics.collectionInterval=60s \
  --set cadvisor.scrapeInterval=60s
```

- `collectionInterval` (predefinito `30s`) guida le metriche di nodi / pod / container (`kubeletstats`) e le metriche di stato del cluster (`k8s_cluster`) — la maggior parte del volume delle metriche.
- `hostMetrics.collectionInterval` e `cadvisor.scrapeInterval` coprono le metriche del sistema operativo per nodo e i contatori di throttling / OOM.
- `resourceSpecs.interval` (predefinito `300s`) controlla la frequenza con cui vengono recuperate le specifiche complete delle risorse (etichette, annotazioni, stato) — aumentalo se non hai bisogno che le modifiche alle specifiche vengano riflesse rapidamente.
- Se hai abilitato uno qualsiasi degli scraper opzionali, anche questi hanno i propri parametri: `kubeStateMetrics.scrapeInterval`, `serviceMesh.*.scrapeInterval`, `coreDns.scrapeInterval`, `csi.scrapeInterval`.

### Leva 4 — Mantieni limitata la cardinalità delle metriche

La cardinalità (il numero di serie temporali distinte) conta quanto la frequenza, perché ogni serie viene archiviata e fatturata separatamente.

- **cAdvisor è in allowlist di proposito.** Il receiver cAdvisor (attivo per impostazione predefinita) può emettere centinaia di metriche; il chart inoltra solo quelle poche che alimentano i monitor (`cadvisor.metricsAllowlist`). Mantieni la lista ristretta — **ogni voce viene mantenuta per container, quindi una metrica in più si moltiplica per il numero di container del cluster.** kube-state-metrics è disattivato per impostazione predefinita, ma se lo abiliti (`kubeStateMetrics.enabled=true`) il suo `kubeStateMetrics.metricsAllowlist` limita la cardinalità allo stesso modo.
- **Metriche di volume per PVC** (`kubeletstats.volumeMetrics.enabled`, attivo per impostazione predefinita) emettono una serie per PVC per pod. Va bene per la maggior parte dei cluster, ma può essere consistente su carichi di lavoro stateful (Kafka, database) con migliaia di PVC — disattivale in quel caso se non monitori lo spazio su disco dei PVC:

  ```bash
  --set kubeletstats.volumeMetrics.enabled=false
  ```

- **Metriche di saturazione** (`kubeletstats.utilizationMetrics.enabled`, attivo per impostazione predefinita) aggiungono 8 famiglie derivate "% di request/limit". Sono economiche (nessuno scraping aggiuntivo) ma se non usi i monitor CPU/Memoria-vs-limite puoi eliminarle con `--set kubeletstats.utilizationMetrics.enabled=false`.

- **Elimina metriche specifiche per nome.** Le allowlist qui sopra sono per receiver; `filters.metrics.exclude` le attraversa tutte, quindi usalo per qualsiasi cosa i parametri a livello di receiver non riescano a esprimere:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set filters.metrics.matchType=regexp \
    --set-json 'filters.metrics.exclude=["^container_network_"]'
  ```

  Consulta [Includere o escludere le metriche per nome](#includere-o-escludere-le-metriche-per-nome) per la corrispondenza esatta rispetto a quella con regex e per la forma allowlist.

- **Elimina le metriche di un intero namespace.** Se un namespace è rumoroso ma vuoi comunque che i suoi nodi siano sorvegliati, `namespaceFilters.applyTo.metrics=true` applica i tuoi elenchi di namespace esistenti alle serie per pod e per container. Le serie a livello di nodo e di cluster vengono sempre mantenute:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set namespaceFilters.applyTo.metrics=true
  ```

### Leva 5 — Lascia disattivate le pesanti funzionalità opt-in

Queste sono **disattivate per impostazione predefinita** proprio perché aggiungono carico — abilitane una solo quando usi attivamente ciò che alimenta, e disattivala di nuovo se la stavi solo provando:

| Valore                                                    | Aggiunge                                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `profiling.enabled`                                       | DaemonSet di profiling continuo della CPU — più pesante delle tracce eBPF                        |
| `auditLogs.enabled`                                       | Ogni richiesta all'API Kubernetes come record di log (volume elevato)                            |
| `controlPlane.enabled`                                    | Metriche di etcd / API-server / scheduler / controller-manager                                   |
| `kubeStateMetrics.enabled`                                | Metriche di CrashLoop / ImagePull / motivo di scheduling (aggiunge un Deployment KSM + scraping) |
| `ebpf.features.networkInterZoneMetrics`                   | Raddoppia la cardinalità delle metriche di flusso di rete                                        |
| `serviceMesh.enabled` / `csi.enabled` / `coreDns.enabled` | Job di scraping Prometheus aggiuntivi                                                            |

### Leva 6 — Campiona le tracce invece di eliminarle

Ogni leva qui sopra guadagna volume rinunciando a qualcosa: un namespace che smetti di sorvegliare, una severità che smetti di mantenere, una famiglia di metriche che smetti di raccogliere. Il campionamento è l'eccezione, e su un cluster molto attivo è spesso la riduzione più grande disponibile a fronte della perdita più piccola:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set sampling.traces.percentage=10
```

Si tratta di una riduzione del 90% del volume delle tracce, a fronte di una perdita più circoscritta di qualsiasi altra leva qui:

- Le tracce che mantieni sono **intere** — la decisione fa l'hash del trace ID, quindi tutti gli span di una traccia lo condividono. Ottieni meno tracce, non tracce spezzate.
- Le tue **metriche RED restano esatte**. Frequenza delle richieste, frequenza degli errori e durata vengono calcolate da OBI a partire da ogni richiesta e viaggiano lungo la pipeline delle metriche, in cui il sampler non si trova. Ogni dashboard e monitor costruito su di esse legge gli stessi valori di prima.

Ciò a cui rinunci sono per lo più le tracce di esempio: quando un monitor scatta, hai un decimo delle tracce da aprire. Su un cluster che gestisce migliaia di richieste identiche al secondo di solito è un buon compromesso — il centesimo span `/healthz` identico non ti insegna nulla che non ti avesse già insegnato il primo. Su un cluster tranquillo è un cattivo compromesso, perché potresti non avere alcun esempio della rara richiesta che si è rotta.

L'eccezione, e l'unica cosa da controllare prima di distribuire questa modifica: i monitor che **contano gli span** invece delle metriche — **Traces** su `Span Count`, **Exceptions** su `Exception Count` — ne vedono proporzionalmente meno, quindi le loro soglie vanno ritarate dello stesso fattore. Consulta [Campionamento delle tracce](#campionamento-delle-tracce).

Ricorri a questa leva quando le tracce eBPF sono una quota consistente della tua ingestione ma vuoi comunque la mappa dei servizi e le metriche RED intatte. Preferisci la Leva 2 quando vuoi smettere del tutto di strumentare qualcosa.

Consulta [Campionamento delle tracce](#campionamento-delle-tracce) per il comportamento completo, incluso il perché `0` sia una frequenza invece di un interruttore di spegnimento e il perché non esista un equivalente per log o metriche.

### Un punto di partenza minimale

Se vuoi un footprint più piccolo ma vuoi comunque che i monitor funzionino, questo profilo mantiene la **copertura completa delle metriche** e taglia le due cose che guidano davvero il volume — le righe di log e gli span eBPF:

```yaml
# lean-values.yaml
oneuptime:
  url: YOUR_ONEUPTIME_URL
  apiKey: YOUR_ONEUPTIME_API_KEY
clusterName: my-cluster

# Halve the metric data points. Coarser resolution, same coverage.
collectionInterval: 60s
hostMetrics:
  collectionInterval: 60s
cadvisor:
  scrapeInterval: 60s

# Keep pod logs, but only ship the ones worth alerting on. (Metrics do
# not depend on this — the node collector runs either way.)
logs:
  enabled: true
  mode: daemonset

filters:
  logs:
    minSeverity: WARN # drop INFO / DEBUG / TRACE at the agent

namespaceFilters:
  exclude:
    - kube-system
    - noisy-namespace

ebpf:
  enabled: true
  features:
    networkMetrics: false # the heaviest eBPF families
    tcpStats: false
    spanMetrics: false
```

```bash
helm upgrade --install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --create-namespace \
  -f lean-values.yaml
```

Restringi ulteriormente secondo necessità: alza `minSeverity` a `ERROR`, aggiungi `namespaceFilters.applyTo.metrics=true`, oppure imposta `ebpf.enabled=false` se invii già le tracce dagli SDK OTel.

> **Attenzione a cosa tagli.** Alcuni monitor dipendono da segnali specifici: disabilitare `cadvisor` rimuove i monitor di OOM-kill e CPU-throttling; disabilitare `kubeletstats.volumeMetrics` rimuove il monitor di spazio su disco basso dei PVC; disabilitare i log rimuove gli avvisi basati sui log; e `sampling.traces.percentage` non rimuove un monitor ma riduce quelli basati sugli span (**Traces** su `Span Count`, **Exceptions** su `Exception Count`), quindi ritara le loro soglie di conseguenza. Riduci i segnali su cui non intervieni, non quelli che un monitor sta osservando.

### Misura l'effetto

L'utilizzo della telemetria è aggregato per giorno, quindi controlla l'andamento su uno o due giorni in **Project Settings → Usage History** per confermare la riduzione — non cambierà nell'istante in cui applichi una modifica. Modifica una leva alla volta così puoi attribuire la differenza — log disattivati, poi intervallo aumentato, poi eBPF ridotto — invece di ridurre tutto in una volta e perdere un monitor su cui facevi effettivamente affidamento.

## Risoluzione dei problemi

> **Percorso più rapido — esegui lo script diagnostico.** Ispeziona lo stato dei pod, decodifica e convalida la chiave di ingestione, verifica che il tuo cluster possa raggiungere OneUptime e chiede a OneUptime se il tuo token è effettivamente accettato — poi stampa un unico verdetto sulla causa radice:
>
> ```bash
> curl -fsSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/HelmChart/Public/kubernetes-agent/troubleshoot.sh \
>   | bash -s -- -n oneuptime-agent
> ```
>
> Legge solo lo stato del cluster ed esegue un paio di sonde; non modifica nulla. Per il test di egress più accurato, installa prima con `--set debug.enabled=true` (questo aggiunge un piccolo sidecar di strumenti di rete ai pod dell'agent, così lo script testa l'esatto percorso di egress del collector), poi riesegui.

### L'installazione fallisce con "hostPath volumes are not allowed" o un errore di Pod Security admission

Il tuo cluster blocca `hostPath` — comune su **GKE Autopilot** e **EKS Fargate**. Passa al preset in modalità API:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set preset=gke-autopilot   # or eks-fargate
```

### L'agent mostra "Disconnected"

Lo stato di connessione di un cluster è determinato esclusivamente dall'arrivo di telemetria — se non arriva alcun dato, il cluster viene contrassegnato come disconnesso dopo circa 15 minuti. Quindi "disconnesso" e "nessuna metrica" hanno quasi sempre la **stessa** causa: la telemetria dell'agent non viene accettata.

Il motivo più comune — specialmente dopo una reinstallazione — è una **chiave di ingestione errata o revocata**. È facile da non notare perché gli endpoint di ingestione OTLP restituiscono deliberatamente HTTP `200` anche per un token non valido (così un collector configurato male non può sommergere il server di tentativi). Il risultato: il collector segnala il successo, i suoi log non mostrano errori e i dati vengono scartati silenziosamente.

1. Controlla che i pod dell'agent siano in esecuzione: `kubectl get pods -n oneuptime-agent`
2. Controlla i log del metrics-collector: `kubectl logs -n oneuptime-agent -l component=metrics-collector -c otel-collector` (l'assenza di errori qui **non** significa che i dati stanno arrivando — vedi sopra)
3. **Convalida la chiave di ingestione.** Chiedi direttamente a OneUptime se il tuo token è accettato (`200` = valido, `401` = sconosciuto/revocato):

   ```bash
   curl -i -H "x-oneuptime-token: <YOUR_API_KEY>" https://oneuptime.com/otlp/v1/validate
   ```

   Se restituisce `401`, la chiave nella tua release è errata o è stata revocata. Copia una chiave attiva da _Project Settings → Telemetry Ingestion Keys_ e riesegui il deploy:

   ```bash
   helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
     --namespace oneuptime-agent --reuse-values \
     --set oneuptime.apiKey=<LIVE_KEY>
   ```

4. Verifica che il tuo URL OneUptime sia corretto e che il tuo cluster possa raggiungerlo tramite la rete.
5. Se hai cambiato `clusterName` alla reinstallazione, l'agent appare come un cluster **nuovo** — la vecchia voce rimane "Disconnected" (è previsto; è obsoleta).

### Nessun log visualizzato (solo modalità API)

1. Conferma che il pod del tailer dei log sia Ready: `kubectl get pods -n oneuptime-agent -l component=log-collector`
2. Controlla il suo `/healthz` — riporta il numero di stream attivi e l'ultimo errore di esportazione
3. Controlla i log: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent-logs`
4. Per cluster molto grandi, una singola replica può essere un collo di bottiglia — suddividi per namespace usando `namespaceFilters.include` su release separate

### Nessuna metrica visualizzata

1. Escludi prima una chiave di ingestione rifiutata — è la causa più comune ed è invisibile dal lato dell'agent. Vedi [L'agent mostra "Disconnected"](#lagent-mostra-disconnected) sopra (o esegui semplicemente lo script diagnostico).
2. Controlla che l'identificatore del cluster corrisponda al valore che hai passato come `clusterName`
3. Verifica i permessi RBAC: `kubectl get clusterrolebinding | grep kubernetes-agent`
4. Controlla i log del collector OTel per eventuali errori di esportazione

### I pod eBPF sono in CrashLoopBackOff o non si avviano

```bash
kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200
```

Cause comuni:

- **Kernel troppo vecchio o BTF mancante.** OBI necessita di Linux 5.8+ con BTF. Esegui `uname -r` su un nodo. Se non puoi aggiornare, disabilita eBPF: `--set ebpf.enabled=false`.
- **Pod privilegiati bloccati.** Alcuni cluster rifiutano i pod privilegiati (GKE Autopilot, EKS Fargate e ambienti con restrizioni). Disabilita eBPF.
- **`debugfs` / `tracefs` non montati sull'host.** La funzionalità `tcpStats` si aggancia ai tracepoint del kernel che li richiedono. Il chart li monta entrambi tramite `hostPath` — ma se il tuo host non li espone, disabilita solo quella famiglia: `--set ebpf.features.tcpStats=false`.

### Nessuna traccia delle applicazioni visualizzata

1. Conferma che il DaemonSet eBPF sia integro: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`
2. Attiva lo stampatore di tracce di debug per confermare che OBI stia catturando traffico: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, poi controlla `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`
3. Se vedi gli span nello stdout di OBI ma non nella dashboard, il problema è l'esportazione collector → OneUptime — controlla i log del pod metrics-collector.

## Passi successivi

- Configura i **monitor Kubernetes** sopra le metriche raccolte da questo agent — vedi [Kubernetes Agent (monitor)](/docs/monitor/kubernetes-agent).
- Aggiungi **monitor dei log** per generare avvisi su pattern di log specifici (ad esempio conteggi di errori sopra una soglia per pod o per namespace).
- Per host non Kubernetes (VM Linux / macOS / Windows e bare metal), usa la pagina [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector).
