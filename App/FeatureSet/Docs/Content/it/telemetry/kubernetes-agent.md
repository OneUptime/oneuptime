# OneUptime Kubernetes Agent (Helm)

## Panoramica

OneUptime Kubernetes Agent è un chart Helm preconfezionato che installa una pipeline di raccolta basata su OpenTelemetry sul tuo cluster. Fornisce metriche di nodi, pod, container e cluster; eventi Kubernetes; log dei pod; e — con eBPF attivo per impostazione predefinita — tracce delle applicazioni, metriche HTTP RED, dati del grafo dei servizi e metriche di flusso di rete pod-a-pod. Nessuna modifica al codice, nessun SDK, un solo `helm install`.

Questa pagina è la **guida all'installazione**. Per configurare monitor e avvisi Kubernetes sopra i dati raccolti dall'agent, consulta [Kubernetes Agent (monitor)](/docs/monitor/kubernetes-agent).

## Prerequisiti

- Un cluster Kubernetes in esecuzione (v1.23+)
- `kubectl` configurato per accedere al tuo cluster
- `helm` v3 installato
- Una **chiave API di OneUptime** — creane una da *Project Settings → API Keys*

## Passo 1 — Aggiungi il repository Helm di OneUptime

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm repo update
```

## Passo 2 — Scegli un preset per il tuo cluster

Il chart espone una singola opzione di livello superiore — `preset` — che seleziona valori predefiniti compatibili per la tua distribuzione Kubernetes. Controlla aspetti che altrimenti dovresti regolare manualmente: se inviare i log tramite un DaemonSet hostPath o tramite l'API Kubernetes, e quale contesto di sicurezza applicare.

| `preset` | Usare per | Raccolta dei log |
|---|---|---|
| `standard` *(predefinito)* | Cluster autogestiti, **EKS su EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | DaemonSet che legge `/var/log/pods` tramite hostPath (overhead minimo) |
| `gke-autopilot` | **GKE Autopilot** | Deployment di tailer dei log tramite API Kubernetes (nessun hostPath, nessun accesso all'host) |
| `eks-fargate` | **EKS Fargate** | Deployment di tailer dei log tramite API Kubernetes (nessun hostPath, nessun accesso all'host) |

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

Per impostazione predefinita, `kube-system` è escluso. Per monitorare solo namespace specifici:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set "namespaceFilters.include={default,production,staging}"
```

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

| Categoria | Dati |
|----------|------|
| **Metriche dei nodi** | Utilizzo della CPU, uso della memoria, uso del filesystem, I/O di rete |
| **Metriche dei pod** | Uso della CPU, uso della memoria, I/O di rete, riavvii |
| **Metriche dei container** | Uso della CPU, uso della memoria per container |
| **Metriche del cluster** | Condizioni dei nodi, risorse allocabili, conteggi dei pod |
| **Eventi Kubernetes** | Avvisi, errori, eventi di scheduling |
| **Log dei pod** | Log stdout/stderr da tutti i container (tramite DaemonSet hostPath sui cluster standard, oppure tramite l'API Kubernetes su Autopilot / Fargate) |
| **Tracce delle applicazioni** *(tramite eBPF, attivo per impostazione predefinita)* | Span HTTP, gRPC, SQL/Redis da ogni pod — nessun SDK o modifica al codice |
| **Metriche HTTP RED** *(tramite eBPF)* | `http.server.request.duration`, dimensioni del corpo di richieste e risposte, per servizio |
| **Grafo dei servizi** *(tramite eBPF)* | Frequenza delle richieste chiamante → chiamato, latenza e archi di errore — alimenta la vista della mappa dei servizi |
| **Metriche di flusso di rete** *(tramite eBPF)* | Contatori di byte e pacchetti TCP/UDP pod-a-pod con metadati k8s |
| **Statistiche TCP** *(tramite eBPF)* | Contatori a livello di nodo di RTT, connessioni fallite e ritrasmissioni |

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

| `ebpf.features.*` | Predefinito | Cosa aggiunge |
|---|---|---|
| `httpMetrics` | attivo | Metriche HTTP/gRPC RED (frequenza delle richieste, latenza, errori) per servizio |
| `spanMetrics` | attivo | Dimensione e durata di richiesta/risposta per span |
| `serviceGraph` | attivo | Metriche degli archi chiamante → chiamato; alimenta la mappa dei servizi |
| `hostMetrics` | attivo | CPU e memoria per processo strumentato |
| `networkMetrics` | attivo | Contatori di flusso TCP/UDP pod-a-pod |
| `networkInterZoneMetrics` | disattivo | Variante inter-zona delle metriche di rete (raddoppia la cardinalità) |
| `tcpStats` | attivo | Contatori a livello di nodo di RTT TCP, connessioni fallite e ritrasmissioni |

Anche la propagazione del contesto delle tracce tra servizi è attiva per impostazione predefinita — OBI inietta il W3C `traceparent` nel traffico HTTP/TCP in uscita, così una richiesta che attraversa il pod A → pod B appare come un'unica traccia, senza modifiche all'SDK da nessuna parte. Disattivala con `--set ebpf.contextPropagation=false`.

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

   Se restituisce `401`, la chiave nella tua release è errata o è stata revocata. Copia una chiave attiva da *Project Settings → Telemetry Ingestion Keys* e riesegui il deploy:

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
