# Installare l'agente Kubernetes

L'agente Kubernetes di OneUptime raccoglie metriche del cluster, eventi, log dei pod, **trace delle applicazioni (HTTP/gRPC tramite eBPF)**, **flame graph CPU continui (profiler eBPF)** e **metriche dei nodi a livello di sistema operativo** dal vostro cluster Kubernetes e li invia a OneUptime. È distribuito come chart Helm e si installa con un solo comando — l'auto-strumentazione eBPF e il profiling sono entrambi attivi per impostazione predefinita, quindi vedrete trace a livello di servizio, metriche RED e flame graph senza alcuna modifica al codice.

## Avvio rapido

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm repo update

helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=<A_UNIQUE_NAME_FOR_THIS_CLUSTER>
```

Il vostro cluster apparirà in OneUptime entro pochi minuti.

## Scegliere il preset giusto per il cluster

Le diverse distribuzioni Kubernetes hanno vincoli differenti — in particolare, se i workload possono montare volumi `hostPath`. Invece di farvi leggere documentazione sulla sicurezza, il chart espone un'unica opzione di alto livello: `preset`.

| Preset | Da usare per | Raccolta log | Note |
| --- | --- | --- | --- |
| `standard` (predefinito) | Self-managed, **EKS su EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | DaemonSet che legge `/var/log/pods` tramite hostPath | Overhead minimo. hostPath è disponibile su queste piattaforme. |
| `gke-autopilot` | **GKE Autopilot** | Tailer Kubernetes API (Deployment) | hostPath è bloccato su Autopilot. Imposta un security context rinforzato che supera i Pod Security Standards di Autopilot. |
| `eks-fargate` | **EKS Fargate** | Tailer Kubernetes API (Deployment) | Come `gke-autopilot`. Fargate blocca hostPath e i DaemonSet. |

Se non siete sicuri, lasciate `preset` non impostato — otterrete i valori predefiniti di `standard`. Se il cluster rifiuta l'installazione con un errore di Pod Security policy che menziona `hostPath`, passate a `gke-autopilot` (o `eks-fargate` su EKS Fargate) e reinstallate.

### Esempi

**GKE Standard, EKS su EC2, self-managed o AKS:**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod
```

**GKE Autopilot:**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod-gke-autopilot \
  --set preset=gke-autopilot
```

**EKS Fargate:**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod-eks-fargate \
  --set preset=eks-fargate
```

## Differenze tra le due modalità di raccolta log

Sotto il cofano, `preset` imposta `logs.mode` — potete impostarlo anche direttamente se dovete sovrascrivere il valore predefinito del preset.

### Modalità DaemonSet (`logs.mode: daemonset`)

Un DaemonSet esegue un pod OpenTelemetry Collector per nodo. Esso segue i file di log sotto `/var/log/pods/` tramite un volume hostPath e li inoltra via OTLP.

- **Vantaggi:** overhead minimo, scala linearmente con i nodi, nessun carico sul Kubernetes API server, gestisce la rotazione dei log.
- **Svantaggi:** richiede hostPath, richiede la capacità di pianificare DaemonSet — entrambi non disponibili su GKE Autopilot ed EKS Fargate.

### Modalità API (`logs.mode: api`)

Un Deployment a replica singola (l'immagine `oneuptime/kubernetes-log-tailer`) utilizza l'API di Kubernetes per trasmettere in streaming i log dei container — lo stesso endpoint utilizzato da `kubectl logs -f`. Nessun hostPath, nessun accesso all'host, nessun DaemonSet.

- **Vantaggi:** funziona su GKE Autopilot, EKS Fargate e qualsiasi cluster che blocchi hostPath o imponga il Pod Security Standard `restricted`.
- **Svantaggi:** ogni stream di container è una connessione a lunga durata verso `kube-apiserver`. Nella pratica una singola replica gestisce comodamente alcune migliaia di container. Per cluster molto grandi, suddividete per namespace usando `logs.api.replicas` insieme a `namespaceFilters.include` su ciascuna replica.

### Quale dovreste usare?

Se hostPath funziona, usate DaemonSet. In tutti gli altri casi, usate la modalità API. L'impostazione `preset` sceglie quella giusta al posto vostro.

Potete anche disabilitare del tutto la raccolta log con `--set logs.enabled=false` e inviare i log applicativi tramite gli SDK OpenTelemetry. Consultate la documentazione [OpenTelemetry](/docs/telemetry/open-telemetry).

## Trace delle applicazioni e richieste HTTP tramite eBPF (attivo per impostazione predefinita)

Il chart distribuisce un DaemonSet che esegue [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) su ogni nodo. OBI carica programmi eBPF nel kernel Linux e osserva il traffico a livello di socket per ricostruire chiamate HTTP/HTTPS, gRPC e SQL/Redis da ogni pod del nodo — nessuna modifica al codice, nessun SDK, nessun sidecar. Il traffico catturato viene esportato come trace OTLP e metriche di richiesta/latenza direttamente a OneUptime.

Dopo l'installazione, i vostri servizi inizieranno ad apparire sotto **Telemetry → Traces** e nella service map entro un paio di minuti, con `k8s.cluster.name` impostato al vostro `clusterName` in modo da poter filtrare per cluster.

### Quando disattivarlo

eBPF è **abilitato per impostazione predefinita**. Dovreste disabilitarlo (`--set ebpf.enabled=false`) se:

- State installando su **GKE Autopilot** o **EKS Fargate**. Queste piattaforme bloccano i pod privilegiati, e OBI ha bisogno della modalità privilegiata per caricare i programmi eBPF.
- I vostri nodi eseguono un kernel più vecchio di **Linux 5.8** senza i backport BTF. (Le distribuzioni moderne — Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL/Stream 9+ — sono adatte.)
- State già inviando trace tramite OpenTelemetry SDK dalle vostre applicazioni e non volete duplicati.

### Cosa viene emesso

OBI estrae diverse famiglie di segnali dal traffico catturato. Sono tutte attive per impostazione predefinita; ciascuna può essere disabilitata indipendentemente con `--set ebpf.features.<key>=false`:

| Segnale | Predefinito | Cosa aggiunge |
| --- | --- | --- |
| `ebpf.features.httpMetrics` | on | Metriche RED HTTP/gRPC — frequenza delle richieste, istogrammi di latenza, conteggio errori — per servizio. |
| `ebpf.features.spanMetrics` | on | Metriche indicizzate per attributi di span: dimensione della richiesta, dimensione della risposta, durata suddivisa per rotta/operazione. |
| `ebpf.features.serviceGraph` | on | Metriche degli archi servizio-a-servizio (frequenza richieste chiamante → chiamato + latenza). Alimenta la service map. |
| `ebpf.features.hostMetrics` | on | CPU e memoria per processo strumentato — evita di eseguire un profiler separato per le domande di base sulla capacità. |
| `ebpf.features.networkMetrics` | on | Contatori di byte e pacchetti dei flussi TCP/UDP pod-a-pod con metadati k8s. Espone ogni coppia di pod che comunicano, inclusi quelli che usano protocolli che OBI non sa interpretare. |
| `ebpf.features.networkInterZoneMetrics` | off | Variante inter-zona delle metriche di rete. Raddoppia la cardinalità; vale la pena abilitarla solo se utilizzate effettivamente la pianificazione basata su zone. |
| `ebpf.features.tcpStats` | on | Statistiche TCP a livello di nodo: istogrammi RTT, conteggio connessioni fallite, ritrasmissioni. |

OBI propaga inoltre il contesto delle trace attraverso i confini dei servizi per impostazione predefinita. Quando il pod A effettua una richiesta HTTP/gRPC al pod B, OBI inietta un header W3C `traceparent` nella richiesta in uscita — così lo span risultante sul lato del pod B viene collegato alla stessa trace dell'uscita del pod A. Nessuna modifica all'SDK necessaria in nessuna delle due applicazioni.

| Opzione | Predefinito | Descrizione |
| --- | --- | --- |
| `ebpf.contextPropagation` | on | Inietta W3C `traceparent` nel traffico in uscita (header HTTP + opzione TCP personalizzata). Impostare a `false` per mantenere locali gli span di ciascun servizio. |
| `ebpf.trackRequestHeaders` | on | Tracciamento degli header di richiesta lato kernel in modo che la propagazione funzioni anche su server HTTP semplici (non-Go, non-TLS). Ha effetto solo quando `contextPropagation` è true. |

### Correlazione log ↔ trace

Anch'essa attiva per impostazione predefinita. L'arricchitore di log di OBI intercetta le scritture su stdout dei pod dai processi strumentati e:

- Per i **log in formato JSON**: inietta i campi `trace_id` e `span_id` nella riga (i valori già presenti nel log vengono preservati). Il DaemonSet filelog quindi solleva quei campi negli slot nativi trace_id/span_id del LogRecord, in modo che cliccare uno span nella vista trace salti ai suoi log in OneUptime — e cliccare una riga di log salti alla sua trace genitore.
- Per i **log non-JSON**: la riga viene preservata invariata — comunque raccolta, ma non collegata automaticamente.

| Opzione | Predefinito | Descrizione |
| --- | --- | --- |
| `ebpf.logToTraceCorrelation` | on | Abilita l'arricchitore di log OBI e l'innesto del trace_id nella pipeline filelog. Impostare a `false` per saltare entrambi. |

Avvertenze:

- **I log devono essere in JSON perché trace_id appaia.** Cambiate il vostro logger con un formatter JSON — `structlog`, `pino`, `winston`, `serilog`, `logback-json`, klog `--logging-format=json`, ecc.
- **Lo stdout bufferizzato interrompe la correlazione** perché la chiamata di sistema `write()` viene attivata su un thread diverso da quello che ha gestito la richiesta. Soluzioni comuni:
  - **Python**: impostare `PYTHONUNBUFFERED=1` (il runtime utilizza la bufferizzazione a blocchi su stdout quando non è una TTY).
  - **.NET**: all'avvio, `Console.SetOut(new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true })`. Microsoft.Extensions.Logging `AddConsole()` e i sink asincroni di Serilog non funzioneranno — passate a un writer di console sincrono (il `WriteTo.Console()` predefinito di Serilog va bene).
- Greenlet / gevent, Tornado e altri runtime asincroni personalizzati non sono supportati.

### Ottimizzazione

| Opzione | Predefinito | Descrizione |
| --- | --- | --- |
| `ebpf.enabled` | `true` | Interruttore principale. Impostare a `false` per saltare interamente il DaemonSet eBPF. |
| `ebpf.image.tag` | `v0.9.0` | Tag immagine OBI. OBI è pre-1.0; fissate una versione nota funzionante e ritestate ad ogni aggiornamento. |
| `ebpf.autoTargetExe` | `*` | Glob degli eseguibili da strumentare. Restringete questo (es. `*/python,*/java`) se volete limitare l'ambito dell'auto-strumentazione. |
| `ebpf.excludeExePaths` | (shell, kubelet, runc, containerd, otelcol, OBI stesso) | Glob separati da virgole da saltare. |
| `ebpf.logLevel` | `info` | `debug`, `info`, `warn` o `error`. Impostare a `debug` durante la risoluzione dei problemi. |
| `ebpf.printTraces` | `false` | Stampa gli span su stdout di OBI oltre all'export OTLP — utile per verificare la cattura durante l'installazione. |
| `ebpf.resources.*` | richieste `100m / 256Mi`, limiti `1000m / 1Gi` | Aumentate per cluster con traffico elevato. |

Per verificare che OBI sia in esecuzione e veda traffico:

```bash
kubectl get pods -n oneuptime-kubernetes-agent -l component=ebpf-instrument
kubectl logs -n oneuptime-kubernetes-agent -l component=ebpf-instrument --tail=200
```

## Profiling CPU continuo (attivo per impostazione predefinita)

Un DaemonSet separato esegue il [profiler eBPF OpenTelemetry](https://github.com/open-telemetry/opentelemetry-ebpf-profiler) — pacchettizzato come immagine `otel/opentelemetry-collector-ebpf-profiler`. Campiona gli stack on-CPU a 19Hz su ogni runtime supportato (Go, Java, .NET, Python, Ruby, Node.js, PHP, Perl, C/C++, Rust) e invia profili OTLP a OneUptime, dove appaiono sotto **Telemetry → Performance Profiles** e come flame graph collegati dai singoli span delle trace.

Quando l'auto-strumentazione eBPF è anch'essa attiva (`ebpf.enabled: true`, il valore predefinito), ogni campione CPU viene correlato con il contesto di trace di OBI tramite una mappa bpffs condivisa — così i flame graph riportano trace_id/span_id e l'interfaccia di OneUptime può mostrarvi un flame graph per ciascuno span.

Requisiti:

- **Kernel Linux 5.10+** (leggermente più recente del 5.8 richiesto da OBI).
- Pod privilegiato con hostPID — stessi vincoli del DaemonSet di auto-strumentazione eBPF. Disabilitate su GKE Autopilot, EKS Fargate e ambienti vincolati: `--set profiling.enabled=false`.

Ottimizzazione:

| Opzione | Predefinito | Descrizione |
| --- | --- | --- |
| `profiling.enabled` | `true` | Interruttore principale. |
| `profiling.image.tag` | `0.152.0` | Tag dell'immagine `otel/opentelemetry-collector-ebpf-profiler`. Il profiler è pre-1.0; fissate una versione nota funzionante. |
| `profiling.samplesPerSecond` | `19` | Frequenza di campionamento in Hz. Valore predefinito upstream; evita accidentalmente l'aliasing con frequenze di timer comuni. |
| `profiling.offCpuThreshold` | `0` | (0–1] abilita il profiling off-CPU — diagnostica la contesa dei lock e l'I/O bloccante. Disattivato per impostazione predefinita perché aggiunge overhead dei tracepoint. |
| `profiling.tracers` | `""` *(tutti i runtime)* | Elenco separato da virgole dei tracer di linguaggio da caricare. |
| `profiling.obiProcessContext` | `true` | Correla i campioni con il contesto di trace di OBI per il collegamento trace ↔ profilo. |

## Altra raccolta dati (host metrics, audit log, CSI, CoreDNS)

Il chart può anche raccogliere:

| `<key>.enabled` | Predefinito | Cosa aggiunge |
| --- | --- | --- |
| `hostMetrics` | on | Metriche del sistema operativo per nodo da `/proc` e `/sys` — profondità della coda I/O del disco, utilizzo degli inode del filesystem, contatori di errori NIC, statistiche di paging, load average. Risiede all'interno del DaemonSet del raccoglitore di log (nessun pod aggiuntivo). |
| `auditLogs` | off | Segue `/var/log/kubernetes/audit.log` dall'host. Cattura ogni richiesta dell'API Kubernetes — chi ha fatto cosa a quale risorsa. Solo cluster self-managed — i K8s gestiti (EKS, GKE, AKS, DOKS) instradano gli audit log al sink del cloud provider. |
| `csi` | off | Auto-rileva i pod etichettati `app=csi-driver` (o `app.kubernetes.io/component=csi-driver`) e raschia la loro porta `metrics` Prometheus — latenza di attach/detach volume, fallimenti di provisioning, IOPS. |
| `coreDns` | off | Raschia il servizio CoreDNS del cluster su `:9153/metrics`. Espone frequenza delle query, latenza, tasso di hit della cache, conteggio errori — comuni colpevoli della latenza P99. |

## Opzioni comuni

| Opzione | Predefinito | Descrizione |
| --- | --- | --- |
| `preset` | (vuoto — trattato come `standard`) | Vedere la tabella sopra. |
| `oneuptime.url` | *(obbligatorio)* | URL della vostra istanza OneUptime. |
| `oneuptime.apiKey` | *(obbligatorio)* | Chiave API del progetto (Settings → API Keys). |
| `clusterName` | *(obbligatorio)* | Nome univoco per questo cluster. Marchiato come `k8s.cluster.name` su ogni record. |
| `namespaceFilters.include` | `[]` | Se impostato, solo questi namespace vengono monitorati. |
| `namespaceFilters.exclude` | `["kube-system"]` | Namespace da saltare. |
| `logs.enabled` | `true` | Attiva o disattiva la raccolta log. |
| `logs.mode` | (derivato da `preset`) | `daemonset`, `api` o `disabled`. Sovrascrive il preset. |
| `logs.api.replicas` | `1` | Numero di repliche del Deployment log-tailer (solo in modalità API). |
| `ebpf.enabled` | `true` | Cattura automaticamente le trace HTTP/gRPC da ogni pod tramite OpenTelemetry eBPF Instrumentation. Vedere la sezione sopra. |
| `profiling.enabled` | `true` | Flame graph CPU continui tramite il profiler eBPF OpenTelemetry. Vedere la sezione sopra. |
| `hostMetrics.enabled` | `true` | Metriche del sistema operativo per nodo. |
| `auditLogs.enabled` | `false` | Raccolta degli audit log Kubernetes (cluster self-managed). |
| `csi.enabled` | `false` | Metriche Prometheus del driver CSI. |
| `coreDns.enabled` | `false` | Metriche Prometheus di CoreDNS. |
| `controlPlane.enabled` | `false` | Raschia etcd / api-server / scheduler / controller-manager. Solo cluster self-managed — le offerte gestite (EKS/GKE/AKS) tipicamente non espongono questi endpoint. |

Consultate il file [`values.yaml` del chart](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/kubernetes-agent/values.yaml) per l'elenco completo.

## Aggiornamento

```bash
helm repo update
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values
```

`--reuse-values` mantiene la configurazione esistente; passate eventuali nuove sovrascritture `--set` oltre ad essa.

> **Attenzione: `--reuse-values` non unisce i nuovi valori predefiniti del chart.** Helm riutilizza i valori precedentemente renderizzati alla lettera — quindi qualsiasi nuovo campo di alto livello aggiunto in una versione più recente del chart (es. `profiling.*`, `ebpf.features.*`) rimane non impostato nella vostra release esistente e il template viene renderizzato come se l'aveste disabilitato.
>
> **Helm 3.14+** — passate a `--reset-then-reuse-values`. Rilegge i valori predefiniti del chart per le chiavi che non avete sovrascritto:
>
> ```bash
> helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
>   --namespace oneuptime-kubernetes-agent \
>   --reset-then-reuse-values
> ```
>
> **Helm 3.13 o precedenti** — eliminate `--reuse-values` e passate esplicitamente i vostri flag originali `--set` (o `-f values.yaml`). I nuovi valori predefiniti del chart si applicheranno a tutto ciò che non sovrascrivete.
>
> Se i pod di una nuova feature (es. `kubernetes-agent-profiling-*`) non compaiono dopo l'aggiornamento, è quasi sempre questo il motivo. `helm get values <release>` mostra ciò che Helm ha effettivamente — i campi mancanti dall'output significano che i predefiniti non sono stati uniti per essi.

## Disinstallazione

```bash
helm uninstall oneuptime-agent --namespace oneuptime-kubernetes-agent
kubectl delete namespace oneuptime-kubernetes-agent
```

## Risoluzione dei problemi

### L'installazione fallisce con "hostPath volumes are not allowed"

Il vostro cluster blocca hostPath. Passate a un preset in modalità API:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values \
  --set preset=gke-autopilot   # or eks-fargate
```

### Nessun log appare in OneUptime

Controllate i pod dell'agente:

```bash
kubectl get pods -n oneuptime-kubernetes-agent
kubectl logs -n oneuptime-kubernetes-agent -l app.kubernetes.io/part-of=oneuptime --tail=200
```

In modalità API, il pod log-tailer espone `/healthz` sulla porta 13133 — raggiungetelo tramite `kubectl port-forward` per uno snapshot dello stato di export.

### Il pod DaemonSet eBPF è in `CrashLoopBackOff` o non riesce ad avviarsi

Controllate i log del pod OBI:

```bash
kubectl logs -n oneuptime-kubernetes-agent -l component=ebpf-instrument --tail=200
```

Cause comuni:

- **Kernel troppo vecchio o BTF mancante.** OBI richiede Linux 5.8+ con BTF. Verificate con `uname -r` su un nodo. Se non potete aggiornare, disabilitate eBPF: `--set ebpf.enabled=false`.
- **I pod privilegiati sono bloccati.** Alcuni cluster rifiutano i pod privilegiati anche al di fuori di Autopilot/Fargate. Disabilitate eBPF.
- **Nessuna trace nella dashboard ma OBI è in esecuzione.** Impostate `--set ebpf.printTraces=true` e controllate lo stdout di OBI — se vedete span lì, il problema è la consegna OTLP (controllate `OTEL_EXPORTER_OTLP_ENDPOINT` e l'URL/chiave API di OneUptime). Se non vedete span, il traffico che OBI sta osservando potrebbe essere tutto cifrato da una libreria TLS che OBI non riesce a intercettare (es. un'implementazione TLS collegata staticamente che non riconosce).

### Il mio cluster ha troppi pod per una sola replica log-tailer (solo modalità API)

Scalate orizzontalmente suddividendo i namespace. Effettuate il deploy una volta per ciascun gruppo di namespace:

```bash
helm install oneuptime-agent-ns-a oneuptime/kubernetes-agent \
  --set preset=gke-autopilot \
  --set namespaceFilters.include={app-a,app-b} \
  ...
```

In alternativa, aumentate `logs.api.replicas` — ma notate che ciascuna replica elabora tutti i namespace consentiti, quindi per la deduplicazione vi serve comunque lo sharding per namespace.
