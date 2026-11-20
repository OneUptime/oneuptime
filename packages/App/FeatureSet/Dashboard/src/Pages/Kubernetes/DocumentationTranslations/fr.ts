import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Kubernetes setup guide in French (#8341): each piece of the English
 * guide's markdown (Pages/Kubernetes/Utils/DocumentationMarkdown.ts) and its
 * French. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its French words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A Kubernetes cluster running v1.23 or later":
    "Un cluster Kubernetes en v1.23 ou ultérieure",
  "`kubectl` and `helm` (v3) installed on your machine":
    "`kubectl` et `helm` (v3) installés sur votre machine",
  "Wrong cluster? Switch with `kubectl config use-context <context-name>`.":
    "Mauvais cluster ? Changez-en avec `kubectl config use-context <context-name>`.",
  "Replace `my-cluster` with a name for this cluster, such as `prod-us-east-1`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "Remplacez `my-cluster` par un nom pour ce cluster, par exemple `prod-us-east-1`. C'est sous ce nom que le cluster apparaît dans OneUptime : gardez-le donc stable, car un nouveau nom enregistre un nouveau cluster.",
  "`--set aiAgent.enabled=true` turns **AI investigations** on, as the chart does by default: OneUptime AI investigates incidents and alerts on this cluster with read-only kubectl, through the Kubernetes AI agent.":
    "`--set aiAgent.enabled=true` active les **enquêtes IA**, comme le fait le chart par défaut : OneUptime AI enquête sur les incidents et les alertes de ce cluster avec kubectl en lecture seule, via l'agent IA Kubernetes.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Choisissez une clé d'ingestion à l'étape 1 pour remplir `<YOUR_API_KEY>`.",
  "You should see:": "Vous devriez voir :",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "Le collecteur et l'agent IA Kubernetes, plus un pod `-logs` et un pod `-ebpf` sur chaque nœud. Une fois qu'ils sont `Running`, le cluster apparaît automatiquement dans la section **Kubernetes**, généralement en une ou deux minutes.",
  "**Kubernetes AI agent (on by default, read-only).** The `kubernetes-agent-ai-agent` pod lets OneUptime AI investigate incidents and alerts on this cluster with read-only kubectl — `get`, `describe`, `logs`, `events`, `top` — using the same API key, and it can change nothing unless you give it write access later. Open the cluster and go to **AI → Agent** to see it. Don't want it? Install with `--set aiAgent.enabled=false` instead of `--set aiAgent.enabled=true`.":
    "**Agent IA Kubernetes (activé par défaut, en lecture seule).** Le pod `kubernetes-agent-ai-agent` permet à OneUptime AI d'enquêter sur les incidents et les alertes de ce cluster avec kubectl en lecture seule (`get`, `describe`, `logs`, `events`, `top`), avec la même clé d'API, et il ne peut rien modifier tant que vous ne lui donnez pas d'accès en écriture. Ouvrez le cluster et allez dans **IA → Agent** pour le voir. Vous n'en voulez pas ? Installez avec `--set aiAgent.enabled=false` au lieu de `--set aiAgent.enabled=true`.",
  "Namespace rules decide what the agent collects from each namespace. To collect pod logs and eBPF data only from `default`, `production` and `staging`:":
    "Les règles d'espaces de noms décident de ce que l'agent collecte dans chaque espace de noms. Pour ne collecter les journaux de pods et les données eBPF que de `default`, `production` et `staging` :",
  "To keep everything but stop the logs of noisy namespaces, exclude them from `podLogs` only:":
    "Pour tout garder mais couper les journaux des espaces de noms bruyants, excluez-les uniquement de `podLogs` :",
  "- **Scopes:** `podLogs` (container stdout/stderr), `ebpfDiscovery` (eBPF traces and metrics), `metrics` (namespaced metrics) and `traces` (every span).":
    "- **Portées :** `podLogs` (stdout/stderr des conteneurs), `ebpfDiscovery` (traces et métriques eBPF), `metrics` (métriques des espaces de noms) et `traces` (tous les spans).",
  "- **Patterns** match the whole namespace name and accept `*`, as in `team-*`. An `exclude` rule always wins over an `include` rule.":
    "- Les **motifs** portent sur le nom complet de l'espace de noms et acceptent `*`, comme dans `team-*`. Une règle `exclude` l'emporte toujours sur une règle `include`.",
  "- **Setting the rules replaces the default one**, which excludes `kube-system` from `podLogs` and `ebpfDiscovery`. Keep it in your list, as in the second example, if you still want that.":
    "- **Définir les règles remplace la règle par défaut**, qui exclut `kube-system` de `podLogs` et `ebpfDiscovery`. Gardez-la dans votre liste, comme dans le second exemple, si vous la voulez toujours.",
  "- Node and cluster metrics have no namespace, so they are always kept.":
    "- Les métriques de nœud et de cluster n'ont pas d'espace de noms : elles sont donc toujours conservées.",
  "- `--set-json` needs Helm 3.10 or later.":
    "- `--set-json` nécessite Helm 3.10 ou ultérieur.",
  "**Only send important lines.** Drop pod log lines below a severity before they leave the cluster:":
    "**N'envoyer que les lignes importantes.** Écartez les lignes de journal des pods sous une gravité donnée avant qu'elles ne quittent le cluster :",
  'Accepts `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` and `FATAL`: `WARN` keeps warnings, errors and fatal lines. The severity is read from the log line itself (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes events are never dropped by this.':
    'Accepte `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` et `FATAL` : `WARN` garde les avertissements, les erreurs et les lignes fatales. La gravité est lue dans la ligne de journal elle-même (`[ERROR]`, `level=warn`, `"level":"info"`). Les événements Kubernetes ne sont jamais écartés par ce réglage.',
  "**Turn pod logs off.** Metrics are not affected — the node collector keeps running for kubelet and cAdvisor metrics, it just stops reading pod logs:":
    "**Couper les journaux de pods.** Les métriques ne sont pas touchées : le collecteur de nœuds continue de tourner pour les métriques kubelet et cAdvisor, il cesse seulement de lire les journaux de pods :",
  "**Change how logs are read.** The preset picks this for you; an explicit `logs.mode` always wins over it:":
    "**Changer la façon dont les journaux sont lus.** Le preset choisit pour vous ; un `logs.mode` explicite l'emporte toujours :",
  "- `logs.mode=daemonset` — reads `/var/log/pods` on every node through hostPath (lowest overhead; needs hostPath).":
    "- `logs.mode=daemonset` : lit `/var/log/pods` sur chaque nœud via hostPath (surcoût le plus faible ; nécessite hostPath).",
  "- `logs.mode=api` — a Deployment tails pod logs through the Kubernetes API (works on any cluster).":
    "- `logs.mode=api` : un Deployment suit les journaux de pods via l'API Kubernetes (fonctionne sur tout cluster).",
  "- `logs.mode=disabled` — no pod logs.":
    "- `logs.mode=disabled` : aucun journal de pods.",
  "That reads the API server, where it answers inside the cluster. etcd, the scheduler and the controller manager answer on the control-plane nodes, which the agent's pod cannot guess, so it reads them once you list each node's address:":
    "Cela lit le serveur d'API, là où il répond à l'intérieur du cluster. etcd, le planificateur et le gestionnaire de contrôleurs répondent sur les nœuds du plan de contrôle, que le pod de l'agent ne peut pas deviner : il les lit donc dès que vous indiquez l'adresse de chaque nœud :",
  "- **The scheduler and the controller manager** serve HTTPS and accept the agent's token, but kubeadm binds them to `127.0.0.1`: give them a `--bind-address` the agent's pod can reach.":
    "- **Le planificateur et le gestionnaire de contrôleurs** servent du HTTPS et acceptent le jeton de l'agent, mais kubeadm les lie à `127.0.0.1` : donnez-leur une `--bind-address` que le pod de l'agent peut joindre.",
  "- **etcd** serves its metrics in plain HTTP on kubeadm's `--listen-metrics-urls` (port 2381, bound to `127.0.0.1` until you add the node's address), as above. Or scrape its HTTPS client port, 2379, with the client certificate it asks for: put `ca.crt`, `tls.crt` and `tls.key` in a Secret in `oneuptime-agent` and name it in `controlPlane.etcd.clientCertSecret`.":
    "- **etcd** sert ses métriques en HTTP simple sur les `--listen-metrics-urls` de kubeadm (port 2381, lié à `127.0.0.1` tant que vous n'ajoutez pas l'adresse du nœud), comme ci-dessus. Ou interrogez son port client HTTPS, 2379, avec le certificat client qu'il demande : placez `ca.crt`, `tls.crt` et `tls.key` dans un Secret de `oneuptime-agent` et indiquez-le dans `controlPlane.etcd.clientCertSecret`.",
  "Only for self-managed clusters: managed services (EKS, GKE, AKS) do not expose their control plane metrics.":
    "Uniquement pour les clusters autogérés : les services managés (EKS, GKE, AKS) n'exposent pas les métriques de leur plan de contrôle.",
  "Cost monitoring is on by default: the agent bundles the open-source OpenCost engine (plus the small Prometheus it needs), prices your nodes and volumes from your cloud provider's public list prices — no credentials required — and sends what each namespace and workload costs. The first data appears on the cluster's overview and Costs page after the first full hour.":
    "La surveillance des coûts est activée par défaut : l'agent embarque le moteur open source OpenCost (plus le petit Prometheus dont il a besoin), chiffre vos nœuds et vos volumes d'après les prix catalogue publics de votre fournisseur cloud, sans identifiants, et envoie ce que coûte chaque espace de noms et chaque charge de travail. Les premières données apparaissent sur la vue d'ensemble du cluster et sur sa page Coûts après la première heure complète.",
  "On an agent installed before it was on by default, upgrade it:":
    "Sur un agent installé avant qu'elle ne soit activée par défaut, mettez-le à niveau :",
  "- **Turn it off:** add `--set cost.enabled=false` to the same upgrade.":
    "- **Pour la désactiver :** ajoutez `--set cost.enabled=false` à la même mise à niveau.",
  "Cost monitoring is off by default on this platform: it bills every pod by what it requests, so the three cost pods would add to your bill, and OpenCost prices nodes rather than pods. To turn it on anyway:":
    "La surveillance des coûts est désactivée par défaut sur cette plateforme : celle-ci facture chaque pod selon ce qu'il demande, si bien que les trois pods de coûts alourdiraient votre facture, et OpenCost chiffre les nœuds plutôt que les pods. Pour l'activer malgré tout :",
  "That alone is a complete install: the chart bundles the open-source OpenCost engine (plus the small Prometheus it needs) and prices your nodes and volumes from your cloud provider's public list prices — no credentials required. It adds three small pods; the first data appears after the first full hour.":
    "Cela suffit pour une installation complète : le chart embarque le moteur open source OpenCost (plus le petit Prometheus dont il a besoin) et chiffre vos nœuds et vos volumes d'après les prix catalogue publics de votre fournisseur cloud, sans identifiants. Il ajoute trois petits pods ; les premières données apparaissent après la première heure complète.",
  "- **Already running Kubecost or OpenCost?** The agent finds it and reads it instead of the bundled engine, and the cluster's overview says so: add `--set cost.engine.url=auto` to stop bundling a second one.":
    "- **Vous utilisez déjà Kubecost ou OpenCost ?** L'agent le détecte et le lit à la place du moteur embarqué, et la vue d'ensemble du cluster l'indique : ajoutez `--set cost.engine.url=auto` pour ne plus en embarquer un second.",
  "- **On-prem or bare metal?** Set a rate card with `--set cost.opencost.customPricing.enabled=true` (USD per resource-hour — see the chart's `values.yaml`).":
    "- **Sur site ou bare metal ?** Définissez une grille tarifaire avec `--set cost.opencost.customPricing.enabled=true` (USD par heure de ressource, voir le `values.yaml` du chart).",
  "Full guide: [Kubernetes Cost Observability](/docs/telemetry/kubernetes-cost).":
    "Guide complet : [Observabilité des coûts Kubernetes](/docs/telemetry/kubernetes-cost).",
  "The agent runs [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) on every node. It captures HTTP/HTTPS, gRPC and SQL/Redis traffic from Go, .NET, Java, Node.js, Python, Ruby and Rust services — no SDK and no sidecar — and ships traces, request (RED) metrics and service-graph data through the collector.":
    "L'agent exécute [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) sur chaque nœud. Il capture le trafic HTTP/HTTPS, gRPC et SQL/Redis des services Go, .NET, Java, Node.js, Python, Ruby et Rust, sans SDK ni sidecar, et envoie les traces, les métriques de requêtes (RED) et les données du graphe de services via le collecteur.",
  "**Requirements:** Linux kernel **5.8+** with BTF (the default on Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). The eBPF pods run **privileged**, which they need to load eBPF programs.":
    "**Exigences :** noyau Linux **5.8+** avec BTF (par défaut sur Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). Les pods eBPF s'exécutent en mode **privilégié**, nécessaire pour charger des programmes eBPF.",
  "**Turn it off** if your nodes run an older kernel, if privileged pods are not allowed, or if your services already send traces with OpenTelemetry SDKs and you don't want duplicates:":
    "**Désactivez-le** si vos nœuds ont un noyau plus ancien, si les pods privilégiés ne sont pas autorisés, ou si vos services envoient déjà des traces avec des SDK OpenTelemetry et que vous ne voulez pas de doublons :",
  "**Choose the signals.** Each family is switched with `--set ebpf.features.<name>=false` (or `=true`):":
    "**Choisir les signaux.** Chaque famille s'active ou se désactive avec `--set ebpf.features.<name>=false` (ou `=true`) :",
  "| `ebpf.features.*` | Default | What it adds |":
    "| `ebpf.features.*` | Par défaut | Ce qu'elle ajoute |",
  "| `httpMetrics` | on | HTTP/gRPC request rate, errors and latency per service |":
    "| `httpMetrics` | activée | Débit de requêtes HTTP/gRPC, erreurs et latence par service |",
  "| `spanMetrics` | on | Span call count and duration (`traces.span.metrics.*`) |":
    "| `spanMetrics` | activée | Nombre d'appels et durée des spans (`traces.span.metrics.*`) |",
  "| `serviceGraph` | on | Caller → callee edges; drives the service map |":
    "| `serviceGraph` | activée | Arêtes appelant → appelé ; alimente la carte des services |",
  "| `networkMetrics` | on | Pod-to-pod TCP/UDP flow counters |":
    "| `networkMetrics` | activée | Compteurs de flux TCP/UDP de pod à pod |",
  "| `networkInterZoneMetrics` | off | Inter-zone network metrics (doubles their cardinality) |":
    "| `networkInterZoneMetrics` | désactivée | Métriques réseau entre zones (double leur cardinalité) |",
  "| `tcpStats` | on | Node-level TCP RTT, failed-connection and retransmit counters |":
    "| `tcpStats` | activée | RTT TCP et compteurs de connexions échouées et de retransmissions par nœud |",
  "**Cross-service trace propagation** — linking a request that crosses pod A → pod B into a single trace, on another node too — is **on by default**. It works by rewriting traffic that is already in flight (widening plaintext HTTP requests in the kernel, and appending a TCP option to TLS and raw TCP), and a mistake in that byte accounting desynchronizes the stream — the reported symptom is transfers through an L7 proxy such as nginx hanging once a response passes ~64KB. If you see that, or a service mesh starts failing pods, turn it off with `--set ebpf.contextPropagation=false`; an OpenTelemetry SDK propagates `traceparent` in userspace without any of that.":
    "La **propagation des traces entre services** (relier en une seule trace une requête qui va du pod A → pod B, y compris sur un autre nœud) est **activée par défaut**. Elle fonctionne en réécrivant le trafic déjà en cours (en élargissant les requêtes HTTP en clair dans le noyau et en ajoutant une option TCP au TLS et au TCP brut), et une erreur dans ce décompte d'octets désynchronise le flux : le symptôme signalé est un transfert via un proxy L7 comme nginx qui se bloque dès qu'une réponse dépasse ~64KB. Si vous le constatez, ou si un service mesh fait échouer des pods, désactivez-la avec `--set ebpf.contextPropagation=false` ; un SDK OpenTelemetry propage `traceparent` dans l'espace utilisateur sans rien de tout cela.",
  "Each `oneuptime.labels.<key>=<value>` becomes the label `<key>:<value>` on the cluster, and on the services and hosts it reports. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Chaque `oneuptime.labels.<key>=<value>` devient le label `<key>:<value>` sur le cluster, ainsi que sur les services et les hôtes qu'il signale. Les labels sont comparés sans tenir compte de la casse : un label `Production` existant est donc réutilisé ; les labels ajoutés dans l'interface de OneUptime ne sont jamais supprimés par l'agent.",
  "**Upgrade** to the latest chart. `--reset-then-reuse-values` (Helm 3.14+) keeps the values you set (preset, cluster name, filters) and takes everything else from the new chart; add any new `--set` flags on top of it:":
    "**Mettez à niveau** vers le dernier chart. `--reset-then-reuse-values` (Helm 3.14+) garde les valeurs que vous avez définies (preset, nom du cluster, filtres) et prend tout le reste dans le nouveau chart ; ajoutez par-dessus les nouveaux indicateurs `--set` :",
  "On Helm 3.13 and earlier, upgrade with the values you set instead:":
    "Avec Helm 3.13 et antérieur, mettez plutôt à niveau avec les valeurs que vous avez définies :",
  "Don't use `--reuse-values`: it also keeps the defaults of the chart you upgrade from, so a newer chart's defaults (its eBPF image among them) never apply.":
    "N'utilisez pas `--reuse-values` : il garde aussi les valeurs par défaut du chart d'origine, si bien que les valeurs par défaut d'un chart plus récent (dont son image eBPF) ne s'appliquent jamais.",
  "**Uninstall** the agent and its namespace:":
    "**Désinstallez** l'agent et son espace de noms :",
  "| Category | Data |": "| Catégorie | Données |",
  "| **Node metrics** | CPU, memory, filesystem and network usage |":
    "| **Métriques des nœuds** | Utilisation du CPU, de la mémoire, du système de fichiers et du réseau |",
  "| **Pod and container metrics** | CPU, memory, network I/O and restarts |":
    "| **Métriques des pods et des conteneurs** | CPU, mémoire, E/S réseau et redémarrages |",
  "| **Cluster metrics** | Node conditions, allocatable resources, pod and workload counts |":
    "| **Métriques du cluster** | État des nœuds, ressources allouables, nombre de pods et de charges de travail |",
  "| **Kubernetes events** | Warnings, errors and scheduling events |":
    "| **Événements Kubernetes** | Avertissements, erreurs et événements de planification |",
  "| **Pod logs** | stdout/stderr of every container, read from each node |":
    "| **Journaux de pods** | stdout/stderr de chaque conteneur, lus sur chaque nœud |",
  "| **Application traces** *(eBPF)* | HTTP, gRPC and SQL/Redis spans from every pod — no SDK or code changes |":
    "| **Traces applicatives** *(eBPF)* | Spans HTTP, gRPC et SQL/Redis de chaque pod, sans SDK ni modification du code |",
  "| **Request metrics and service graph** *(eBPF)* | Request rate, errors and latency per service, and caller → callee edges for the service map |":
    "| **Métriques de requêtes et graphe de services** *(eBPF)* | Débit de requêtes, erreurs et latence par service, et arêtes appelant → appelé pour la carte des services |",
  "| **Network flows** *(eBPF)* | Pod-to-pod TCP/UDP byte and packet counters |":
    "| **Flux réseau** *(eBPF)* | Compteurs d'octets et de paquets TCP/UDP de pod à pod |",
  "| **Workload costs** *(opt-in, `cost.enabled=true`)* | Spend per namespace, workload and pod, with idle capacity and efficiency |":
    "| **Coûts des charges de travail** *(facultatif, `cost.enabled=true`)* | Dépenses par espace de noms, charge de travail et pod, avec la capacité inutilisée et l'efficacité |",
  "| **Workload costs** *(on by default)* | Spend per namespace, workload and pod, with idle capacity and efficiency, also as metrics to alert on |":
    "| **Coûts des charges de travail** *(activés par défaut)* | Dépenses par espace de noms, charge de travail et pod, avec la capacité inutilisée et l'efficacité, également sous forme de métriques sur lesquelles déclencher des alertes |",
  "Your cluster blocks `hostPath` volumes or privileged pods. That is normal on **GKE Autopilot** and **EKS Fargate** — pick that platform at the top of this guide and follow its steps. On **OpenShift** the install succeeds instead, but the agent's node pods never start: pick **Red Hat OpenShift**.":
    "Votre cluster bloque les volumes `hostPath` ou les pods privilégiés. C'est normal sur **GKE Autopilot** et **EKS Fargate** : choisissez cette plateforme en haut de ce guide et suivez ses étapes. Sur **OpenShift**, l'installation réussit au contraire, mais les pods de nœud de l'agent ne démarrent jamais : choisissez **Red Hat OpenShift**.",
  "On any other cluster with a restrictive Pod Security policy, remove the failed release:":
    "Sur tout autre cluster doté d'une politique Pod Security restrictive, supprimez la release qui a échoué :",
  "Then run the install command again with `--set preset=gke-autopilot` added. That preset reads pod logs through the Kubernetes API instead of hostPath, applies a hardened security context, and leaves out the privileged eBPF and profiling pods.":
    "Relancez ensuite la commande d'installation en ajoutant `--set preset=gke-autopilot`. Ce preset lit les journaux de pods via l'API Kubernetes au lieu de hostPath, applique un contexte de sécurité renforcé et laisse de côté les pods privilégiés d'eBPF et de profilage.",
  "1. Check that the agent's pods are running: `kubectl get pods -n oneuptime-agent`":
    "1. Vérifiez que les pods de l'agent tournent : `kubectl get pods -n oneuptime-agent`",
  "2. Check the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "2. Consultez les journaux du collecteur : `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "3. Verify the OneUptime URL and ingestion key in the install command are correct.":
    "3. Vérifiez que l'URL OneUptime et la clé d'ingestion de la commande d'installation sont correctes.",
  "4. Make sure the cluster can reach your OneUptime instance over the network.":
    "4. Assurez-vous que le cluster peut joindre votre instance OneUptime par le réseau.",
  "1. Check the AI agent's pod: `kubectl get pods -n oneuptime-agent -l component=ai-agent`":
    "1. Vérifiez le pod de l'agent IA : `kubectl get pods -n oneuptime-agent -l component=ai-agent`",
  "2. Check its logs: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`":
    "2. Consultez ses journaux : `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`",
  "3. No pod? Upgrade the chart (see **Upgrade or uninstall the agent** under Advanced) and add `--set aiAgent.enabled=true`.":
    "3. Aucun pod ? Mettez à niveau le chart (voir **Mettre à niveau ou désinstaller l'agent** sous Avancé) et ajoutez `--set aiAgent.enabled=true`.",
  "1. Check that the cluster name matches: this guide installs **`my-cluster`**.":
    "1. Vérifiez que le nom du cluster correspond : ce guide installe **`my-cluster`**.",
  "2. Verify the agent's RBAC permissions: `kubectl get clusterrolebinding | grep kubernetes-agent`":
    "2. Vérifiez les permissions RBAC de l'agent : `kubectl get clusterrolebinding | grep kubernetes-agent`",
  "3. Look for export errors in the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. Cherchez des erreurs d'export dans les journaux du collecteur : `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "- **Kernel too old or no BTF.** eBPF needs Linux 5.8+ with BTF — check with `uname -r` on a node. If you can't upgrade, turn eBPF off with `--set ebpf.enabled=false`.":
    "- **Noyau trop ancien ou sans BTF.** eBPF nécessite Linux 5.8+ avec BTF ; vérifiez avec `uname -r` sur un nœud. Si vous ne pouvez pas mettre à niveau, désactivez eBPF avec `--set ebpf.enabled=false`.",
  "- **Privileged pods blocked.** Some locked-down clusters reject them. Turn eBPF off.":
    "- **Pods privilégiés bloqués.** Certains clusters verrouillés les refusent. Désactivez eBPF.",
  "- **`debugfs` / `tracefs` not available on the host.** Turn off just the TCP stats family: `--set ebpf.features.tcpStats=false`.":
    "- **`debugfs` / `tracefs` indisponibles sur l'hôte.** Désactivez seulement la famille des statistiques TCP : `--set ebpf.features.tcpStats=false`.",
  "1. Check the eBPF pods are healthy: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`":
    "1. Vérifiez que les pods eBPF sont en bonne santé : `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`",
  "2. Turn on OBI's debug output to confirm it sees traffic: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, then read `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.":
    "2. Activez la sortie de débogage d'OBI pour confirmer qu'il voit du trafic : `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, puis lisez `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.",
  "3. If spans show up there but not in OneUptime, check the collector's logs for export errors: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. Si des spans apparaissent là mais pas dans OneUptime, cherchez des erreurs d'export dans les journaux du collecteur : `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "This installs the agent for **`k8s-1`** — keep `clusterName` exactly as it is, or the data registers as a new cluster.":
    "Ceci installe l'agent pour **`k8s-1`** : gardez `clusterName` exactement tel quel, sinon les données sont enregistrées comme un nouveau cluster.",
  "The AWS CLI (`aws`), signed in to the cluster's account":
    "L'AWS CLI (`aws`), connectée au compte du cluster",
  "The Google Cloud CLI (`gcloud`) with the `gke-gcloud-auth-plugin` component":
    "La Google Cloud CLI (`gcloud`) avec le composant `gke-gcloud-auth-plugin`",
  "The Azure CLI (`az`), signed in to the cluster's subscription":
    "L'Azure CLI (`az`), connectée à l'abonnement du cluster",
  "OpenShift 4.11 or later, and the OpenShift CLI (`oc`) logged in with cluster-admin rights: the install creates security context constraints":
    "OpenShift 4.11 ou ultérieur, et l'OpenShift CLI (`oc`) connectée avec les droits cluster-admin : l'installation crée des security context constraints",
  "The web console gives the exact command, token included: **Copy login command**, under your user name. Log in as a cluster admin: the install creates security context constraints.":
    "La console web donne la commande exacte, jeton compris : **Copy login command**, sous votre nom d'utilisateur. Connectez-vous en tant qu'administrateur du cluster : l'installation crée des security context constraints.",
  "`preset=openshift` creates two security context constraints (SCCs), one for the node collector and one for the eBPF pods, each used only by its own service account. Every other pod runs under OpenShift's default `restricted-v2`, with the user ID OpenShift assigns.":
    "`preset=openshift` crée deux security context constraints (SCC), une pour le collecteur de nœuds et une pour les pods eBPF, chacune utilisée seulement par son propre compte de service. Tous les autres pods s'exécutent sous le `restricted-v2` par défaut d'OpenShift, avec l'ID utilisateur qu'OpenShift attribue.",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. The `-logs` and `-ebpf` pods run under the SCCs the chart created for them: `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf` lists both. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "Le collecteur et l'agent IA Kubernetes, plus un pod `-logs` et un pod `-ebpf` sur chaque nœud. Les pods `-logs` et `-ebpf` s'exécutent sous les SCC que le chart a créées pour eux : `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf` les liste toutes les deux. Une fois qu'ils sont `Running`, le cluster apparaît automatiquement dans la section **Kubernetes**, généralement en une ou deux minutes.",
  "OpenShift admits a pod only under a security context constraint (SCC) its service account may use, and the release installs either way, so a refused pod simply never appears. Look for the refusal:":
    "OpenShift n'admet un pod que sous une security context constraint (SCC) que son compte de service peut utiliser, et la release s'installe dans tous les cas : un pod refusé n'apparaît donc tout simplement jamais. Cherchez le refus :",
  "- **`unable to validate against any security context constraint`:** the release was installed without the openshift preset, so the chart created no SCCs. `helm get values kubernetes-agent --namespace oneuptime-agent` shows the values it was given. Add the preset:":
    "- **`unable to validate against any security context constraint` :** la release a été installée sans le preset openshift, si bien que le chart n'a créé aucune SCC. `helm get values kubernetes-agent --namespace oneuptime-agent` montre les valeurs qu'elle a reçues. Ajoutez le preset :",
  "- **The SCCs are missing:** check with `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf`. Creating them takes cluster-admin rights, so an install by anyone else fails when it gets to them.":
    "- **Les SCC manquent :** vérifiez avec `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf`. Les créer demande les droits cluster-admin : une installation faite par quelqu'un d'autre échoue donc en arrivant à elles.",
  "- **`violates PodSecurity`:** the namespace's Pod Security level is stricter than the eBPF pods, which run privileged, need. Label it `pod-security.kubernetes.io/enforce=privileged`, or turn eBPF off with `--set ebpf.enabled=false`.":
    "- **`violates PodSecurity` :** le niveau Pod Security de l'espace de noms est plus strict que ce dont ont besoin les pods eBPF, qui s'exécutent en mode privilégié. Ajoutez-lui le label `pod-security.kubernetes.io/enforce=privileged`, ou désactivez eBPF avec `--set ebpf.enabled=false`.",
  "- **Your cluster admin will not add SCCs:** use the `openshift-restricted` preset. The chart then creates no SCC and every pod runs under `restricted-v2`, so pod logs come through the Kubernetes API, and there are no host metrics, eBPF traces or profiles:":
    "- **Votre administrateur de cluster n'ajoutera pas de SCC :** utilisez le preset `openshift-restricted`. Le chart ne crée alors aucune SCC et tous les pods s'exécutent sous `restricted-v2` : les journaux de pods passent donc par l'API Kubernetes, et il n'y a ni métriques d'hôte, ni traces eBPF, ni profils :",
  "`preset=gke-autopilot` collects pod logs through the Kubernetes API instead of reading them from each node, and leaves out eBPF tracing and profiling, which need privileged pods that GKE Autopilot does not allow.":
    "`preset=gke-autopilot` collecte les journaux de pods via l'API Kubernetes au lieu de les lire sur chaque nœud, et laisse de côté le traçage et le profilage eBPF, qui nécessitent des pods privilégiés que GKE Autopilot n'autorise pas.",
  "The collector, the Kubernetes AI agent and the pod log reader, plus one node collector per node for kubelet metrics. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "Le collecteur, l'agent IA Kubernetes et le lecteur de journaux de pods, plus un collecteur de nœud par nœud pour les métriques kubelet. Une fois qu'ils sont `Running`, le cluster apparaît automatiquement dans la section **Kubernetes**, généralement en une ou deux minutes.",
  "On other clusters the agent runs [OpenTelemetry eBPF Instrumentation](https://opentelemetry.io/docs/zero-code/obi/) on every node to capture HTTP, gRPC and SQL traces with no code changes. Loading eBPF programs needs privileged pods, which this platform does not allow, so the platform's preset leaves it out, and the continuous profiler with it.":
    "Sur les autres clusters, l'agent exécute [OpenTelemetry eBPF Instrumentation](https://opentelemetry.io/docs/zero-code/obi/) sur chaque nœud pour capturer les traces HTTP, gRPC et SQL sans modification du code. Charger des programmes eBPF nécessite des pods privilégiés, que cette plateforme n'autorise pas : le preset de la plateforme le laisse donc de côté, et le profileur continu avec lui.",
  "To get traces here, instrument your services with an [OpenTelemetry SDK](/docs/telemetry/open-telemetry) and send them to OneUptime directly.":
    "Pour obtenir des traces ici, instrumentez vos services avec un [SDK OpenTelemetry](/docs/telemetry/open-telemetry) et envoyez-les directement à OneUptime.",
  "| **Pod logs** | stdout/stderr of every container, read through the Kubernetes API |":
    "| **Journaux de pods** | stdout/stderr de chaque conteneur, lus via l'API Kubernetes |",
  "Autopilot blocks hostPath, so node metrics that read the host's `/proc` and `/sys` (disk I/O, inodes, NIC errors) are not collected; kubelet and cAdvisor metrics are.":
    "Autopilot bloque hostPath : les métriques de nœud qui lisent `/proc` et `/sys` de l'hôte (E/S disque, inodes, erreurs de carte réseau) ne sont donc pas collectées ; les métriques kubelet et cAdvisor le sont.",
  "Pod logs are read through the Kubernetes API on this platform.":
    "Sur cette plateforme, les journaux de pods sont lus via l'API Kubernetes.",
  "1. Check that the log reader is ready: `kubectl get pods -n oneuptime-agent -l component=log-collector`":
    "1. Vérifiez que le lecteur de journaux est prêt : `kubectl get pods -n oneuptime-agent -l component=log-collector`",
  "3. Its `/healthz` endpoint reports the number of active log streams and the last export error.":
    "3. Son point de terminaison `/healthz` indique le nombre de flux de journaux actifs et la dernière erreur d'export.",
  "4. On very large clusters one reader can fall behind — split the namespaces across separate releases with `namespaceFilters`.":
    "4. Sur les très grands clusters, un lecteur peut prendre du retard : répartissez les espaces de noms entre des releases distinctes avec `namespaceFilters`.",
  "The AWS CLI (`aws`) and `eksctl`, signed in to the cluster's account":
    "L'AWS CLI (`aws`) et `eksctl`, connectés au compte du cluster",
  "Pods run on Fargate only in namespaces a Fargate profile selects. Create one for `oneuptime-agent` — without it the agent's pods stay `Pending`:":
    "Sur Fargate, les pods ne s'exécutent que dans les espaces de noms qu'un profil Fargate sélectionne. Créez-en un pour `oneuptime-agent` : sans lui, les pods de l'agent restent `Pending` :",
  "`preset=eks-fargate` collects pod logs through the Kubernetes API instead of reading them from each node, and leaves out eBPF tracing and profiling, which need privileged pods that EKS Fargate does not allow.":
    "`preset=eks-fargate` collecte les journaux de pods via l'API Kubernetes au lieu de les lire sur chaque nœud, et laisse de côté le traçage et le profilage eBPF, qui nécessitent des pods privilégiés qu'EKS Fargate n'autorise pas.",
  "Three Deployments — the collector, the Kubernetes AI agent and the pod log reader. Fargate never schedules DaemonSets, so there are no per-node pods. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "Trois Deployments : le collecteur, l'agent IA Kubernetes et le lecteur de journaux de pods. Fargate ne planifie jamais de DaemonSets : il n'y a donc pas de pods par nœud. Une fois qu'ils sont `Running`, le cluster apparaît automatiquement dans la section **Kubernetes**, généralement en une ou deux minutes.",
  "Then remove the Fargate profile: `eksctl delete fargateprofile --cluster <cluster-name> --name oneuptime-agent`.":
    "Supprimez ensuite le profil Fargate : `eksctl delete fargateprofile --cluster <cluster-name> --name oneuptime-agent`.",
  "Fargate never schedules DaemonSets, so node, pod and container metrics are not available there.":
    "Fargate ne planifie jamais de DaemonSets : les métriques de nœuds, de pods et de conteneurs n'y sont donc pas disponibles.",
  "Fargate only schedules pods in namespaces that a Fargate profile selects. Check that one exists for `oneuptime-agent`:":
    "Fargate ne planifie les pods que dans les espaces de noms qu'un profil Fargate sélectionne. Vérifiez qu'il en existe un pour `oneuptime-agent` :",
  "If there is none, create it. Fargate is chosen when a pod is created, so pods that were already pending stay pending — restart the agent's Deployments once the profile is active:":
    "S'il n'y en a pas, créez-le. Fargate est choisi à la création d'un pod : les pods déjà en attente le restent donc. Redémarrez les Deployments de l'agent une fois le profil actif :",
};

export default TRANSLATION;
