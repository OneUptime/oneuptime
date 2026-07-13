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

Su un cluster **standard** vedrai un Deployment metrics-collector più un pod DaemonSet log-collector per nodo:

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-xxxxx                   1/1     Running   0          1m
kubernetes-agent-logs-yyyyy                   1/1     Running   0          1m
```

Su **GKE Autopilot** o **EKS Fargate** vedrai invece due Deployment (nessun DaemonSet):

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

> Questi filtri **non** riducono le **metriche** di nodi / pod / container — queste vengono raccolte per nodo dal kubelet e sono sempre raccolte a livello di cluster (le serie a livello di nodo e di cluster non hanno un namespace su cui filtrare). `exclude` prevale sempre su `include`. Consulta [Ridurre il volume dei dati raccolti](#reducing-the-volume-of-data-collected) per l'insieme completo dei controlli del volume.

### Disabilita la raccolta dei log

Se hai bisogno solo di metriche ed eventi (nessun log dei pod):

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set logs.enabled=false
```

### Forza una modalità specifica di raccolta dei log

Gli utenti avanzati possono sovrascrivere la scelta del preset con `logs.mode`:

- `logs.mode=daemonset` — DaemonSet hostPath (overhead minimo, richiede hostPath)
- `logs.mode=api` — Deployment di tailer dei log tramite API Kubernetes (funziona su qualsiasi cluster)
- `logs.mode=disabled` — nessuna raccolta dei log

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
| **Log dei pod**                       | Ogni riga da ogni container, sull'intero cluster            | `logs.enabled`, `logs.mode`, `namespaceFilters`                                              |
| **Tracce eBPF e metriche degli span** | Una traccia per richiesta da ogni processo strumentato      | `ebpf.enabled`, `ebpf.features.*`, `ebpf.autoTargetExe`, `ebpf.excludeExePaths`              |
| **Punti dati delle metriche**         | Frequenza di scraping × numero di pod/container             | `collectionInterval`, `hostMetrics.collectionInterval`, `cadvisor.scrapeInterval`            |
| **Cardinalità delle metriche**        | Numero di serie distinte (per container, per PVC, …)        | `cadvisor.metricsAllowlist`, `kubeletstats.volumeMetrics`, `kubeletstats.utilizationMetrics` |
| **Extra opzionali (opt-in)**          | Profiling, log di audit, control plane, metriche inter-zona | Lasciali disattivati (lo sono già per impostazione predefinita)                              |

### Leva 1 — I log dei pod sono di solito la singola fonte più grande

I log dei container sono quasi sempre la fetta più grande dell'ingestione, perché si tratta di un record per ogni riga di log da ogni container del cluster.

- **Non hai affatto bisogno dei log in OneUptime?** Disattivali completamente — mantieni tutte le metriche, gli eventi e le tracce:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set logs.enabled=false
  ```

- **Vuoi i log solo da determinati namespace?** `namespaceFilters.include` limita i log dei pod in entrambe le modalità di log (e con essi le tracce eBPF). La corrispondenza avviene sul percorso dei log dei pod, quindi i namespace filtrati non vengono nemmeno letti:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set "namespaceFilters.include={default,production}"
  ```

  (`kube-system` è già escluso per impostazione predefinita.)

### Leva 2 — Riduci l'auto-strumentazione eBPF

eBPF ti fornisce tracce, metriche RED, la mappa dei servizi e metriche di flusso di rete senza modifiche al codice — ma è anche la seconda fonte di dati più grande perché emette uno span per richiesta e diverse famiglie di metriche per servizio. Hai tre livelli di controllo:

- **Invii già le tracce dagli SDK OTel, o non vuoi le tracce automatiche?** Disattiva completamente eBPF:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.enabled=false
  ```

- **Mantieni le tracce, elimina le famiglie di metriche pesanti.** La [tabella delle famiglie di segnali qui sopra](#toggle-individual-signal-families) elenca ogni flag `ebpf.features.*`. Le famiglie con il volume più alto sono le metriche di rete e degli span — disattivandole lasci intatte le tracce, le metriche HTTP RED e la mappa dei servizi:

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

  Consulta [Attiva/disattiva singole famiglie di segnali](#toggle-individual-signal-families) e la nota su `excludeExePaths` nei valori del chart per i valori predefiniti completi.

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

### Un punto di partenza minimale

Se vuoi un footprint minimo e aggiungerai i segnali man mano che ti servono, questo profilo **solo metriche + eventi** elimina i log ed eBPF e dimezza la frequenza di scraping:

```yaml
# lean-values.yaml
oneuptime:
  url: YOUR_ONEUPTIME_URL
  apiKey: YOUR_ONEUPTIME_API_KEY
clusterName: my-cluster

collectionInterval: 60s

logs:
  enabled: false # no pod logs

ebpf:
  enabled: false # no auto-traces

hostMetrics:
  collectionInterval: 60s

cadvisor:
  scrapeInterval: 60s
```

```bash
helm upgrade --install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --create-namespace \
  -f lean-values.yaml
```

Da lì, riabilita ciò che ti serve: `logs.enabled=true` per alcuni namespace in modalità API, oppure `ebpf.enabled=true` con un `autoTargetExe` ristretto.

> **Attenzione a cosa tagli.** Alcuni monitor dipendono da segnali specifici: disabilitare `cadvisor` rimuove i monitor di OOM-kill e CPU-throttling; disabilitare `kubeletstats.volumeMetrics` rimuove il monitor di spazio su disco basso dei PVC; disabilitare i log rimuove gli avvisi basati sui log. Riduci i segnali su cui non intervieni, non quelli che un monitor sta osservando.

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

1. Escludi prima una chiave di ingestione rifiutata — è la causa più comune ed è invisibile dal lato dell'agent. Vedi [L'agent mostra "Disconnected"](#agent-shows-disconnected) sopra (o esegui semplicemente lo script diagnostico).
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
