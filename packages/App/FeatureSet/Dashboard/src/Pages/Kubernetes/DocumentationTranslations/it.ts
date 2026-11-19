import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Kubernetes setup guide in Italian (#8341): each piece of the English
 * guide's markdown (Pages/Kubernetes/Utils/DocumentationMarkdown.ts) and its
 * Italian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Italian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A Kubernetes cluster running v1.23 or later":
    "Un cluster Kubernetes con v1.23 o successiva",
  "`kubectl` and `helm` (v3) installed on your machine":
    "`kubectl` e `helm` (v3) installati sul tuo computer",
  "Wrong cluster? Switch with `kubectl config use-context <context-name>`.":
    "Cluster sbagliato? Cambia con `kubectl config use-context <context-name>`.",
  "Replace `my-cluster` with a name for this cluster, such as `prod-us-east-1`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "Sostituisci `my-cluster` con un nome per questo cluster, ad esempio `prod-us-east-1`. È così che il cluster compare in OneUptime, quindi mantienilo stabile: un nuovo nome registra un nuovo cluster.",
  "`--set aiAgent.enabled=true` turns **AI investigations** on, as the chart does by default: OneUptime AI investigates incidents and alerts on this cluster with read-only kubectl, through the Kubernetes AI agent.":
    "`--set aiAgent.enabled=true` attiva le **indagini IA**, come fa il chart per impostazione predefinita: OneUptime AI indaga su incidenti e avvisi di questo cluster con kubectl in sola lettura, tramite l'agente IA di Kubernetes.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Scegli una chiave di acquisizione nel passaggio 1 per compilare `<YOUR_API_KEY>`.",
  "You should see:": "Dovresti vedere:",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "Il collector e l'agente IA di Kubernetes, più un pod `-logs` e un pod `-ebpf` su ogni nodo. Quando sono `Running`, il cluster compare automaticamente nella sezione **Kubernetes**, di solito entro un paio di minuti.",
  "**Kubernetes AI agent (on by default, read-only).** The `kubernetes-agent-ai-agent` pod lets OneUptime AI investigate incidents and alerts on this cluster with read-only kubectl — `get`, `describe`, `logs`, `events`, `top` — using the same API key, and it can change nothing unless you give it write access later. Open the cluster and go to **AI → Agent** to see it. Don't want it? Install with `--set aiAgent.enabled=false` instead of `--set aiAgent.enabled=true`.":
    "**Agente IA di Kubernetes (attivo per impostazione predefinita, in sola lettura).** Il pod `kubernetes-agent-ai-agent` permette a OneUptime AI di indagare su incidenti e avvisi di questo cluster con kubectl in sola lettura (`get`, `describe`, `logs`, `events`, `top`), con la stessa chiave API, e non può cambiare nulla a meno che in seguito tu non gli dia accesso in scrittura. Apri il cluster e vai in **IA → Agente** per vederlo. Non lo vuoi? Installa con `--set aiAgent.enabled=false` invece di `--set aiAgent.enabled=true`.",
  "Namespace rules decide what the agent collects from each namespace. To collect pod logs and eBPF data only from `default`, `production` and `staging`:":
    "Le regole dei namespace decidono cosa raccoglie l'agente da ogni namespace. Per raccogliere log dei pod e dati eBPF solo da `default`, `production` e `staging`:",
  "To keep everything but stop the logs of noisy namespaces, exclude them from `podLogs` only:":
    "Per tenere tutto ma fermare i log dei namespace rumorosi, escludili solo da `podLogs`:",
  "- **Scopes:** `podLogs` (container stdout/stderr), `ebpfDiscovery` (eBPF traces and metrics), `metrics` (namespaced metrics) and `traces` (every span).":
    "- **Ambiti:** `podLogs` (stdout/stderr dei container), `ebpfDiscovery` (tracce e metriche eBPF), `metrics` (metriche dei namespace) e `traces` (ogni span).",
  "- **Patterns** match the whole namespace name and accept `*`, as in `team-*`. An `exclude` rule always wins over an `include` rule.":
    "- I **pattern** corrispondono all'intero nome del namespace e accettano `*`, come in `team-*`. Una regola `exclude` prevale sempre su una regola `include`.",
  "- **Setting the rules replaces the default one**, which excludes `kube-system` from `podLogs` and `ebpfDiscovery`. Keep it in your list, as in the second example, if you still want that.":
    "- **Impostare le regole sostituisce quella predefinita**, che esclude `kube-system` da `podLogs` ed `ebpfDiscovery`. Tienila nel tuo elenco, come nel secondo esempio, se la vuoi ancora.",
  "- Node and cluster metrics have no namespace, so they are always kept.":
    "- Le metriche di nodo e di cluster non hanno namespace, quindi vengono sempre mantenute.",
  "- `--set-json` needs Helm 3.10 or later.":
    "- `--set-json` richiede Helm 3.10 o successivo.",
  "**Only send important lines.** Drop pod log lines below a severity before they leave the cluster:":
    "**Invia solo le righe importanti.** Scarta le righe di log dei pod sotto una certa gravità prima che lascino il cluster:",
  'Accepts `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` and `FATAL`: `WARN` keeps warnings, errors and fatal lines. The severity is read from the log line itself (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes events are never dropped by this.':
    'Accetta `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` e `FATAL`: `WARN` tiene avvisi, errori e righe fatali. La gravità viene letta dalla riga di log stessa (`[ERROR]`, `level=warn`, `"level":"info"`). Gli eventi di Kubernetes non vengono mai scartati da questa impostazione.',
  "**Turn pod logs off.** Metrics are not affected — the node collector keeps running for kubelet and cAdvisor metrics, it just stops reading pod logs:":
    "**Disattiva i log dei pod.** Le metriche non ne risentono: il collector dei nodi continua a funzionare per le metriche di kubelet e cAdvisor, smette solo di leggere i log dei pod:",
  "**Change how logs are read.** The preset picks this for you; an explicit `logs.mode` always wins over it:":
    "**Cambia il modo in cui vengono letti i log.** Il preset lo sceglie per te; un `logs.mode` esplicito prevale sempre:",
  "- `logs.mode=daemonset` — reads `/var/log/pods` on every node through hostPath (lowest overhead; needs hostPath).":
    "- `logs.mode=daemonset`: legge `/var/log/pods` su ogni nodo tramite hostPath (il minor overhead; richiede hostPath).",
  "- `logs.mode=api` — a Deployment tails pod logs through the Kubernetes API (works on any cluster).":
    "- `logs.mode=api`: un Deployment segue i log dei pod tramite l'API di Kubernetes (funziona su qualsiasi cluster).",
  "- `logs.mode=disabled` — no pod logs.":
    "- `logs.mode=disabled`: nessun log dei pod.",
  "That reads the API server, where it answers inside the cluster. etcd, the scheduler and the controller manager answer on the control-plane nodes, which the agent's pod cannot guess, so it reads them once you list each node's address:":
    "Così viene letto l'API server, dove risponde all'interno del cluster. etcd, lo scheduler e il controller manager rispondono sui nodi del control plane, che il pod dell'agente non può indovinare, quindi li legge appena indichi l'indirizzo di ogni nodo:",
  "- **The scheduler and the controller manager** serve HTTPS and accept the agent's token, but kubeadm binds them to `127.0.0.1`: give them a `--bind-address` the agent's pod can reach.":
    "- **Lo scheduler e il controller manager** servono HTTPS e accettano il token dell'agente, ma kubeadm li associa a `127.0.0.1`: dai loro un `--bind-address` raggiungibile dal pod dell'agente.",
  "- **etcd** serves its metrics in plain HTTP on kubeadm's `--listen-metrics-urls` (port 2381, bound to `127.0.0.1` until you add the node's address), as above. Or scrape its HTTPS client port, 2379, with the client certificate it asks for: put `ca.crt`, `tls.crt` and `tls.key` in a Secret in `oneuptime-agent` and name it in `controlPlane.etcd.clientCertSecret`.":
    "- **etcd** serve le sue metriche in HTTP semplice sulle `--listen-metrics-urls` di kubeadm (porta 2381, associata a `127.0.0.1` finché non aggiungi l'indirizzo del nodo), come sopra. Oppure interroga la sua porta client HTTPS, 2379, con il certificato client che richiede: metti `ca.crt`, `tls.crt` e `tls.key` in un Secret in `oneuptime-agent` e indicalo in `controlPlane.etcd.clientCertSecret`.",
  "Only for self-managed clusters: managed services (EKS, GKE, AKS) do not expose their control plane metrics.":
    "Solo per i cluster autogestiti: i servizi gestiti (EKS, GKE, AKS) non espongono le metriche del loro control plane.",
  "Cost monitoring is on by default: the agent bundles the open-source OpenCost engine (plus the small Prometheus it needs), prices your nodes and volumes from your cloud provider's public list prices — no credentials required — and sends what each namespace and workload costs. The first data appears on the cluster's overview and Costs page after the first full hour.":
    "Il monitoraggio dei costi è attivo per impostazione predefinita: l'agente include il motore open source OpenCost (più il piccolo Prometheus di cui ha bisogno), assegna un prezzo a nodi e volumi in base ai listini pubblici del tuo provider cloud, senza credenziali, e invia quanto costa ogni namespace e ogni workload. I primi dati compaiono nella panoramica del cluster e nella sua pagina Costi dopo la prima ora completa.",
  "On an agent installed before it was on by default, upgrade it:":
    "Se il tuo agente è stato installato prima che fosse attivo per impostazione predefinita, aggiornalo:",
  "- **Turn it off:** add `--set cost.enabled=false` to the same upgrade.":
    "- **Per disattivarlo:** aggiungi `--set cost.enabled=false` allo stesso aggiornamento.",
  "Cost monitoring is off by default on this platform: it bills every pod by what it requests, so the three cost pods would add to your bill, and OpenCost prices nodes rather than pods. To turn it on anyway:":
    "Su questa piattaforma il monitoraggio dei costi è disattivato per impostazione predefinita: la piattaforma fattura ogni pod in base a ciò che richiede, quindi i tre pod dei costi si aggiungerebbero alla tua fattura, e OpenCost assegna un prezzo ai nodi anziché ai pod. Per attivarlo comunque:",
  "That alone is a complete install: the chart bundles the open-source OpenCost engine (plus the small Prometheus it needs) and prices your nodes and volumes from your cloud provider's public list prices — no credentials required. It adds three small pods; the first data appears after the first full hour.":
    "Basta questo per un'installazione completa: il chart include il motore open source OpenCost (più il piccolo Prometheus di cui ha bisogno) e assegna un prezzo a nodi e volumi in base ai listini pubblici del tuo provider cloud, senza credenziali. Aggiunge tre piccoli pod; i primi dati compaiono dopo la prima ora completa.",
  "- **Already running Kubecost or OpenCost?** Point the agent at it instead, and nothing is bundled: add `--set cost.engine.url=http://opencost.opencost.svc.cluster.local:9003` (or your Kubecost service).":
    "- **Usi già Kubecost o OpenCost?** Punta invece l'agente su di esso, e non viene incluso nulla: aggiungi `--set cost.engine.url=http://opencost.opencost.svc.cluster.local:9003` (o il tuo servizio Kubecost).",
  "- **On-prem or bare metal?** Set a rate card with `--set cost.opencost.customPricing.enabled=true` (USD per resource-hour — see the chart's `values.yaml`).":
    "- **On-premise o bare metal?** Imposta un listino con `--set cost.opencost.customPricing.enabled=true` (USD per ora di risorsa; vedi il `values.yaml` del chart).",
  "Full guide: [Kubernetes Cost Observability](/docs/telemetry/kubernetes-cost).":
    "Guida completa: [Osservabilità dei costi di Kubernetes](/docs/telemetry/kubernetes-cost).",
  "The agent runs [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) on every node. It captures HTTP/HTTPS, gRPC and SQL/Redis traffic from Go, .NET, Java, Node.js, Python, Ruby and Rust services — no SDK and no sidecar — and ships traces, request (RED) metrics and service-graph data through the collector.":
    "L'agente esegue [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) su ogni nodo. Cattura il traffico HTTP/HTTPS, gRPC e SQL/Redis dei servizi Go, .NET, Java, Node.js, Python, Ruby e Rust, senza SDK né sidecar, e invia tracce, metriche delle richieste (RED) e dati del grafo dei servizi tramite il collector.",
  "**Requirements:** Linux kernel **5.8+** with BTF (the default on Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). The eBPF pods run **privileged**, which they need to load eBPF programs.":
    "**Requisiti:** kernel Linux **5.8+** con BTF (il predefinito su Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). I pod eBPF girano in modalità **privilegiata**, che serve loro per caricare programmi eBPF.",
  "**Turn it off** if your nodes run an older kernel, if privileged pods are not allowed, or if your services already send traces with OpenTelemetry SDKs and you don't want duplicates:":
    "**Disattivalo** se i tuoi nodi hanno un kernel più vecchio, se i pod privilegiati non sono consentiti o se i tuoi servizi inviano già tracce con gli SDK di OpenTelemetry e non vuoi duplicati:",
  "**Choose the signals.** Each family is switched with `--set ebpf.features.<name>=false` (or `=true`):":
    "**Scegli i segnali.** Ogni famiglia si attiva o disattiva con `--set ebpf.features.<name>=false` (o `=true`):",
  "| `ebpf.features.*` | Default | What it adds |":
    "| `ebpf.features.*` | Predefinito | Cosa aggiunge |",
  "| `httpMetrics` | on | HTTP/gRPC request rate, errors and latency per service |":
    "| `httpMetrics` | attivo | Frequenza delle richieste HTTP/gRPC, errori e latenza per servizio |",
  "| `spanMetrics` | on | Span call count and duration (`traces.span.metrics.*`) |":
    "| `spanMetrics` | attivo | Numero di chiamate e durata degli span (`traces.span.metrics.*`) |",
  "| `serviceGraph` | on | Caller → callee edges; drives the service map |":
    "| `serviceGraph` | attivo | Archi chiamante → chiamato; alimenta la mappa dei servizi |",
  "| `networkMetrics` | on | Pod-to-pod TCP/UDP flow counters |":
    "| `networkMetrics` | attivo | Contatori dei flussi TCP/UDP da pod a pod |",
  "| `networkInterZoneMetrics` | off | Inter-zone network metrics (doubles their cardinality) |":
    "| `networkInterZoneMetrics` | disattivo | Metriche di rete tra zone (ne raddoppia la cardinalità) |",
  "| `tcpStats` | on | Node-level TCP RTT, failed-connection and retransmit counters |":
    "| `tcpStats` | attivo | RTT TCP e contatori di connessioni non riuscite e ritrasmissioni per nodo |",
  "**Cross-service trace propagation** — linking a request that crosses pod A → pod B into a single trace, on another node too — is **on by default**. It works by rewriting traffic that is already in flight (widening plaintext HTTP requests in the kernel, and appending a TCP option to TLS and raw TCP), and a mistake in that byte accounting desynchronizes the stream — the reported symptom is transfers through an L7 proxy such as nginx hanging once a response passes ~64KB. If you see that, or a service mesh starts failing pods, turn it off with `--set ebpf.contextPropagation=false`; an OpenTelemetry SDK propagates `traceparent` in userspace without any of that.":
    "La **propagazione delle tracce tra servizi** (collegare in un'unica traccia una richiesta che va dal pod A → pod B, anche su un altro nodo) è **attiva per impostazione predefinita**. Funziona riscrivendo il traffico già in transito (ampliando nel kernel le richieste HTTP in chiaro e aggiungendo un'opzione TCP a TLS e al TCP grezzo), e un errore in questo conteggio dei byte desincronizza il flusso: il sintomo segnalato sono trasferimenti attraverso un proxy L7 come nginx che si bloccano appena una risposta supera ~64KB. Se lo vedi, o se una service mesh inizia a far fallire i pod, disattivala con `--set ebpf.contextPropagation=false`; un SDK di OpenTelemetry propaga `traceparent` nello spazio utente senza nulla di tutto ciò.",
  "Each `oneuptime.labels.<key>=<value>` becomes the label `<key>:<value>` on the cluster, and on the services and hosts it reports. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Ogni `oneuptime.labels.<key>=<value>` diventa l'etichetta `<key>:<value>` sul cluster e sui servizi e host che riporta. Le etichette vengono confrontate senza distinguere maiuscole e minuscole, quindi un'etichetta `Production` esistente viene riutilizzata; l'agente non rimuove mai le etichette aggiunte nell'interfaccia di OneUptime.",
  "**Upgrade** to the latest chart. `--reset-then-reuse-values` (Helm 3.14+) keeps the values you set (preset, cluster name, filters) and takes everything else from the new chart; add any new `--set` flags on top of it:":
    "**Aggiorna** al chart più recente. `--reset-then-reuse-values` (Helm 3.14+) mantiene i valori che hai impostato (preset, nome del cluster, filtri) e prende tutto il resto dal nuovo chart; aggiungi sopra eventuali nuovi flag `--set`:",
  "On Helm 3.13 and earlier, upgrade with the values you set instead:":
    "Con Helm 3.13 e precedenti, aggiorna invece con i valori che hai impostato:",
  "Don't use `--reuse-values`: it also keeps the defaults of the chart you upgrade from, so a newer chart's defaults (its eBPF image among them) never apply.":
    "Non usare `--reuse-values`: mantiene anche i valori predefiniti del chart da cui aggiorni, così i valori predefiniti di un chart più recente (tra cui la sua immagine eBPF) non si applicano mai.",
  "**Uninstall** the agent and its namespace:":
    "**Disinstalla** l'agente e il suo namespace:",
  "| Category | Data |": "| Categoria | Dati |",
  "| **Node metrics** | CPU, memory, filesystem and network usage |":
    "| **Metriche dei nodi** | Uso di CPU, memoria, filesystem e rete |",
  "| **Pod and container metrics** | CPU, memory, network I/O and restarts |":
    "| **Metriche di pod e container** | CPU, memoria, I/O di rete e riavvii |",
  "| **Cluster metrics** | Node conditions, allocatable resources, pod and workload counts |":
    "| **Metriche del cluster** | Condizioni dei nodi, risorse allocabili, numero di pod e workload |",
  "| **Kubernetes events** | Warnings, errors and scheduling events |":
    "| **Eventi di Kubernetes** | Avvisi, errori ed eventi di pianificazione |",
  "| **Pod logs** | stdout/stderr of every container, read from each node |":
    "| **Log dei pod** | stdout/stderr di ogni container, letti su ogni nodo |",
  "| **Application traces** *(eBPF)* | HTTP, gRPC and SQL/Redis spans from every pod — no SDK or code changes |":
    "| **Tracce delle applicazioni** *(eBPF)* | Span HTTP, gRPC e SQL/Redis da ogni pod, senza SDK né modifiche al codice |",
  "| **Request metrics and service graph** *(eBPF)* | Request rate, errors and latency per service, and caller → callee edges for the service map |":
    "| **Metriche delle richieste e grafo dei servizi** *(eBPF)* | Frequenza delle richieste, errori e latenza per servizio, e archi chiamante → chiamato per la mappa dei servizi |",
  "| **Network flows** *(eBPF)* | Pod-to-pod TCP/UDP byte and packet counters |":
    "| **Flussi di rete** *(eBPF)* | Contatori di byte e pacchetti TCP/UDP da pod a pod |",
  "| **Workload costs** *(opt-in, `cost.enabled=true`)* | Spend per namespace, workload and pod, with idle capacity and efficiency |":
    "| **Costi dei workload** *(facoltativo, `cost.enabled=true`)* | Spesa per namespace, workload e pod, con capacità inutilizzata ed efficienza |",
  "| **Workload costs** *(on by default)* | Spend per namespace, workload and pod, with idle capacity and efficiency, also as metrics to alert on |":
    "| **Costi dei workload** *(attivi per impostazione predefinita)* | Spesa per namespace, workload e pod, con capacità inutilizzata ed efficienza, anche come metriche su cui generare avvisi |",
  "Your cluster blocks `hostPath` volumes or privileged pods. That is normal on **GKE Autopilot** and **EKS Fargate** — pick that platform at the top of this guide and follow its steps. On **OpenShift** the install succeeds instead, but the agent's node pods never start: pick **Red Hat OpenShift**.":
    "Il tuo cluster blocca i volumi `hostPath` o i pod privilegiati. È normale su **GKE Autopilot** ed **EKS Fargate**: scegli quella piattaforma in cima a questa guida e segui i suoi passaggi. Su **OpenShift** invece l'installazione riesce, ma i pod di nodo dell'agente non si avviano mai: scegli **Red Hat OpenShift**.",
  "On any other cluster with a restrictive Pod Security policy, remove the failed release:":
    "Su qualsiasi altro cluster con una policy Pod Security restrittiva, rimuovi la release non riuscita:",
  "Then run the install command again with `--set preset=gke-autopilot` added. That preset reads pod logs through the Kubernetes API instead of hostPath, applies a hardened security context, and leaves out the privileged eBPF and profiling pods.":
    "Poi esegui di nuovo il comando di installazione aggiungendo `--set preset=gke-autopilot`. Quel preset legge i log dei pod tramite l'API di Kubernetes invece di hostPath, applica un contesto di sicurezza rafforzato e lascia fuori i pod privilegiati di eBPF e di profiling.",
  "1. Check that the agent's pods are running: `kubectl get pods -n oneuptime-agent`":
    "1. Verifica che i pod dell'agente siano in esecuzione: `kubectl get pods -n oneuptime-agent`",
  "2. Check the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "2. Controlla i log del collector: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "3. Verify the OneUptime URL and ingestion key in the install command are correct.":
    "3. Verifica che l'URL di OneUptime e la chiave di acquisizione nel comando di installazione siano corretti.",
  "4. Make sure the cluster can reach your OneUptime instance over the network.":
    "4. Assicurati che il cluster possa raggiungere la tua istanza di OneUptime attraverso la rete.",
  "1. Check the AI agent's pod: `kubectl get pods -n oneuptime-agent -l component=ai-agent`":
    "1. Controlla il pod dell'agente IA: `kubectl get pods -n oneuptime-agent -l component=ai-agent`",
  "2. Check its logs: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`":
    "2. Controlla i suoi log: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`",
  "3. No pod? Upgrade the chart (see **Upgrade or uninstall the agent** under Advanced) and add `--set aiAgent.enabled=true`.":
    "3. Nessun pod? Aggiorna il chart (vedi **Aggiorna o disinstalla l'agente** in Avanzato) e aggiungi `--set aiAgent.enabled=true`.",
  "1. Check that the cluster name matches: this guide installs **`my-cluster`**.":
    "1. Verifica che il nome del cluster corrisponda: questa guida installa **`my-cluster`**.",
  "2. Verify the agent's RBAC permissions: `kubectl get clusterrolebinding | grep kubernetes-agent`":
    "2. Verifica i permessi RBAC dell'agente: `kubectl get clusterrolebinding | grep kubernetes-agent`",
  "3. Look for export errors in the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. Cerca errori di esportazione nei log del collector: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "- **Kernel too old or no BTF.** eBPF needs Linux 5.8+ with BTF — check with `uname -r` on a node. If you can't upgrade, turn eBPF off with `--set ebpf.enabled=false`.":
    "- **Kernel troppo vecchio o senza BTF.** eBPF richiede Linux 5.8+ con BTF; verificalo con `uname -r` su un nodo. Se non puoi aggiornare, disattiva eBPF con `--set ebpf.enabled=false`.",
  "- **Privileged pods blocked.** Some locked-down clusters reject them. Turn eBPF off.":
    "- **Pod privilegiati bloccati.** Alcuni cluster blindati li rifiutano. Disattiva eBPF.",
  "- **`debugfs` / `tracefs` not available on the host.** Turn off just the TCP stats family: `--set ebpf.features.tcpStats=false`.":
    "- **`debugfs` / `tracefs` non disponibili sull'host.** Disattiva solo la famiglia delle statistiche TCP: `--set ebpf.features.tcpStats=false`.",
  "1. Check the eBPF pods are healthy: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`":
    "1. Verifica che i pod eBPF siano integri: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`",
  "2. Turn on OBI's debug output to confirm it sees traffic: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, then read `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.":
    "2. Attiva l'output di debug di OBI per confermare che veda traffico: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, poi leggi `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.",
  "3. If spans show up there but not in OneUptime, check the collector's logs for export errors: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. Se gli span compaiono lì ma non in OneUptime, cerca errori di esportazione nei log del collector: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "This installs the agent for **`k8s-1`** — keep `clusterName` exactly as it is, or the data registers as a new cluster.":
    "Così installi l'agente per **`k8s-1`**: lascia `clusterName` esattamente com'è, altrimenti i dati vengono registrati come un nuovo cluster.",
  "The AWS CLI (`aws`), signed in to the cluster's account":
    "La CLI di AWS (`aws`), con accesso all'account del cluster",
  "The Google Cloud CLI (`gcloud`) with the `gke-gcloud-auth-plugin` component":
    "La CLI di Google Cloud (`gcloud`) con il componente `gke-gcloud-auth-plugin`",
  "The Azure CLI (`az`), signed in to the cluster's subscription":
    "La CLI di Azure (`az`), con accesso alla sottoscrizione del cluster",
  "OpenShift 4.11 or later, and the OpenShift CLI (`oc`) logged in with cluster-admin rights: the install creates security context constraints":
    "OpenShift 4.11 o successivo, e la CLI di OpenShift (`oc`) con accesso effettuato con diritti di cluster-admin: l'installazione crea security context constraint",
  "The web console gives the exact command, token included: **Copy login command**, under your user name. Log in as a cluster admin: the install creates security context constraints.":
    "La console web fornisce il comando esatto, token compreso: **Copy login command**, sotto il tuo nome utente. Accedi come amministratore del cluster: l'installazione crea security context constraint.",
  "`preset=openshift` creates two security context constraints (SCCs), one for the node collector and one for the eBPF pods, each used only by its own service account. Every other pod runs under OpenShift's default `restricted-v2`, with the user ID OpenShift assigns.":
    "`preset=openshift` crea due security context constraint (SCC), una per il collector dei nodi e una per i pod eBPF, ciascuna usata solo dal proprio service account. Ogni altro pod gira sotto il `restricted-v2` predefinito di OpenShift, con l'ID utente che OpenShift assegna.",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. The `-logs` and `-ebpf` pods run under the SCCs the chart created for them: `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf` lists both. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "Il collector e l'agente IA di Kubernetes, più un pod `-logs` e un pod `-ebpf` su ogni nodo. I pod `-logs` e `-ebpf` girano sotto le SCC che il chart ha creato per loro: `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf` le elenca entrambe. Quando sono `Running`, il cluster compare automaticamente nella sezione **Kubernetes**, di solito entro un paio di minuti.",
  "OpenShift admits a pod only under a security context constraint (SCC) its service account may use, and the release installs either way, so a refused pod simply never appears. Look for the refusal:":
    "OpenShift ammette un pod solo sotto una security context constraint (SCC) che il suo service account può usare, e la release si installa comunque, quindi un pod rifiutato semplicemente non compare mai. Cerca il rifiuto:",
  "- **`unable to validate against any security context constraint`:** the release was installed without the openshift preset, so the chart created no SCCs. `helm get values kubernetes-agent --namespace oneuptime-agent` shows the values it was given. Add the preset:":
    "- **`unable to validate against any security context constraint`:** la release è stata installata senza il preset openshift, quindi il chart non ha creato nessuna SCC. `helm get values kubernetes-agent --namespace oneuptime-agent` mostra i valori che ha ricevuto. Aggiungi il preset:",
  "- **The SCCs are missing:** check with `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf`. Creating them takes cluster-admin rights, so an install by anyone else fails when it gets to them.":
    "- **Le SCC mancano:** verifica con `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf`. Crearle richiede diritti di cluster-admin, quindi un'installazione fatta da chiunque altro non riesce quando arriva a loro.",
  "- **`violates PodSecurity`:** the namespace's Pod Security level is stricter than the eBPF pods, which run privileged, need. Label it `pod-security.kubernetes.io/enforce=privileged`, or turn eBPF off with `--set ebpf.enabled=false`.":
    "- **`violates PodSecurity`:** il livello Pod Security del namespace è più rigido di quanto serva ai pod eBPF, che girano in modalità privilegiata. Assegnagli l'etichetta `pod-security.kubernetes.io/enforce=privileged`, oppure disattiva eBPF con `--set ebpf.enabled=false`.",
  "- **Your cluster admin will not add SCCs:** use the `openshift-restricted` preset. The chart then creates no SCC and every pod runs under `restricted-v2`, so pod logs come through the Kubernetes API, and there are no host metrics, eBPF traces or profiles:":
    "- **Il tuo amministratore del cluster non aggiungerà SCC:** usa il preset `openshift-restricted`. Il chart allora non crea nessuna SCC e ogni pod gira sotto `restricted-v2`, quindi i log dei pod arrivano tramite l'API di Kubernetes e non ci sono metriche dell'host, tracce eBPF né profili:",
  "`preset=gke-autopilot` collects pod logs through the Kubernetes API instead of reading them from each node, and leaves out eBPF tracing and profiling, which need privileged pods that GKE Autopilot does not allow.":
    "`preset=gke-autopilot` raccoglie i log dei pod tramite l'API di Kubernetes invece di leggerli su ogni nodo, e lascia fuori il tracing e il profiling eBPF, che richiedono pod privilegiati che GKE Autopilot non consente.",
  "The collector, the Kubernetes AI agent and the pod log reader, plus one node collector per node for kubelet metrics. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "Il collector, l'agente IA di Kubernetes e il lettore dei log dei pod, più un collector di nodo per nodo per le metriche di kubelet. Quando sono `Running`, il cluster compare automaticamente nella sezione **Kubernetes**, di solito entro un paio di minuti.",
  "On other clusters the agent runs [OpenTelemetry eBPF Instrumentation](https://opentelemetry.io/docs/zero-code/obi/) on every node to capture HTTP, gRPC and SQL traces with no code changes. Loading eBPF programs needs privileged pods, which this platform does not allow, so the platform's preset leaves it out, and the continuous profiler with it.":
    "Sugli altri cluster l'agente esegue [OpenTelemetry eBPF Instrumentation](https://opentelemetry.io/docs/zero-code/obi/) su ogni nodo per catturare tracce HTTP, gRPC e SQL senza modifiche al codice. Caricare programmi eBPF richiede pod privilegiati, che questa piattaforma non consente, quindi il preset della piattaforma lo lascia fuori, e con lui il profiler continuo.",
  "To get traces here, instrument your services with an [OpenTelemetry SDK](/docs/telemetry/open-telemetry) and send them to OneUptime directly.":
    "Per avere tracce qui, strumenta i tuoi servizi con un [SDK di OpenTelemetry](/docs/telemetry/open-telemetry) e inviale direttamente a OneUptime.",
  "| **Pod logs** | stdout/stderr of every container, read through the Kubernetes API |":
    "| **Log dei pod** | stdout/stderr di ogni container, letti tramite l'API di Kubernetes |",
  "Autopilot blocks hostPath, so node metrics that read the host's `/proc` and `/sys` (disk I/O, inodes, NIC errors) are not collected; kubelet and cAdvisor metrics are.":
    "Autopilot blocca hostPath, quindi le metriche di nodo che leggono `/proc` e `/sys` dell'host (I/O del disco, inode, errori delle NIC) non vengono raccolte; quelle di kubelet e cAdvisor sì.",
  "Pod logs are read through the Kubernetes API on this platform.":
    "Su questa piattaforma i log dei pod vengono letti tramite l'API di Kubernetes.",
  "1. Check that the log reader is ready: `kubectl get pods -n oneuptime-agent -l component=log-collector`":
    "1. Verifica che il lettore dei log sia pronto: `kubectl get pods -n oneuptime-agent -l component=log-collector`",
  "3. Its `/healthz` endpoint reports the number of active log streams and the last export error.":
    "3. Il suo endpoint `/healthz` riporta il numero di flussi di log attivi e l'ultimo errore di esportazione.",
  "4. On very large clusters one reader can fall behind — split the namespaces across separate releases with `namespaceFilters`.":
    "4. Sui cluster molto grandi un lettore può restare indietro: suddividi i namespace tra release separate con `namespaceFilters`.",
  "The AWS CLI (`aws`) and `eksctl`, signed in to the cluster's account":
    "La CLI di AWS (`aws`) ed `eksctl`, con accesso all'account del cluster",
  "Pods run on Fargate only in namespaces a Fargate profile selects. Create one for `oneuptime-agent` — without it the agent's pods stay `Pending`:":
    "Su Fargate i pod girano solo nei namespace selezionati da un profilo Fargate. Creane uno per `oneuptime-agent`: senza, i pod dell'agente restano in `Pending`:",
  "`preset=eks-fargate` collects pod logs through the Kubernetes API instead of reading them from each node, and leaves out eBPF tracing and profiling, which need privileged pods that EKS Fargate does not allow.":
    "`preset=eks-fargate` raccoglie i log dei pod tramite l'API di Kubernetes invece di leggerli su ogni nodo, e lascia fuori il tracing e il profiling eBPF, che richiedono pod privilegiati che EKS Fargate non consente.",
  "Three Deployments — the collector, the Kubernetes AI agent and the pod log reader. Fargate never schedules DaemonSets, so there are no per-node pods. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "Tre Deployment: il collector, l'agente IA di Kubernetes e il lettore dei log dei pod. Fargate non pianifica mai DaemonSet, quindi non ci sono pod per nodo. Quando sono `Running`, il cluster compare automaticamente nella sezione **Kubernetes**, di solito entro un paio di minuti.",
  "Then remove the Fargate profile: `eksctl delete fargateprofile --cluster <cluster-name> --name oneuptime-agent`.":
    "Poi rimuovi il profilo Fargate: `eksctl delete fargateprofile --cluster <cluster-name> --name oneuptime-agent`.",
  "Fargate never schedules DaemonSets, so node, pod and container metrics are not available there.":
    "Fargate non pianifica mai DaemonSet, quindi lì non sono disponibili metriche di nodi, pod e container.",
  "Fargate only schedules pods in namespaces that a Fargate profile selects. Check that one exists for `oneuptime-agent`:":
    "Fargate pianifica i pod solo nei namespace selezionati da un profilo Fargate. Verifica che ne esista uno per `oneuptime-agent`:",
  "If there is none, create it. Fargate is chosen when a pod is created, so pods that were already pending stay pending — restart the agent's Deployments once the profile is active:":
    "Se non c'è, crealo. Fargate viene scelto quando un pod viene creato, quindi i pod già in attesa restano in attesa: riavvia i Deployment dell'agente appena il profilo è attivo:",
};

export default TRANSLATION;
