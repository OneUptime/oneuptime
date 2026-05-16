# Installer l'agent Kubernetes

L'agent Kubernetes OneUptime collecte les métriques du cluster, les événements, les journaux de pods, les **traces d'applications (HTTP/gRPC via eBPF)**, les **flame graphs CPU continus (profileur eBPF)** et les **métriques des nœuds au niveau du système d'exploitation** depuis votre cluster Kubernetes et les transmet à OneUptime. Il est distribué sous forme de chart Helm et installé en une seule commande — l'auto-instrumentation eBPF et le profilage sont tous deux activés par défaut, vous voyez donc les traces au niveau du service, les métriques RED et les flame graphs sans modification de code.

## Démarrage rapide

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

Votre cluster apparaîtra dans OneUptime en quelques minutes.

## Choisissez le preset adapté à votre cluster

Les différentes distributions Kubernetes ont des contraintes différentes — notamment la possibilité pour les charges de travail de monter des volumes `hostPath`. Plutôt que de vous obliger à lire la documentation de sécurité, le chart expose une seule option de premier niveau : `preset`.

| Preset | À utiliser pour | Collecte de logs | Notes |
| --- | --- | --- | --- |
| `standard` (par défaut) | Auto-géré, **EKS sur EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | DaemonSet lisant `/var/log/pods` via hostPath | Surcharge la plus faible. hostPath est disponible sur ces plateformes. |
| `gke-autopilot` | **GKE Autopilot** | Lecteur d'API Kubernetes (Deployment) | hostPath est bloqué sur Autopilot. Définit un contexte de sécurité renforcé qui passe les Pod Security Standards d'Autopilot. |
| `eks-fargate` | **EKS Fargate** | Lecteur d'API Kubernetes (Deployment) | Identique à `gke-autopilot`. Fargate bloque hostPath et les DaemonSets. |

Si vous n'êtes pas sûr, laissez `preset` non défini — vous obtenez les valeurs par défaut `standard`. Si votre cluster rejette l'installation avec une erreur de politique de sécurité de Pod mentionnant `hostPath`, basculez vers `gke-autopilot` (ou `eks-fargate` sur EKS Fargate) et réinstallez.

### Exemples

**GKE Standard, EKS sur EC2, auto-géré ou AKS :**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod
```

**GKE Autopilot :**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod-gke-autopilot \
  --set preset=gke-autopilot
```

**EKS Fargate :**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod-eks-fargate \
  --set preset=eks-fargate
```

## En quoi les deux modes de collecte de logs diffèrent

Sous le capot, `preset` définit `logs.mode` — et vous pouvez également définir cela directement si vous devez remplacer la valeur par défaut du preset.

### Mode DaemonSet (`logs.mode: daemonset`)

Un DaemonSet exécute un pod OpenTelemetry Collector par nœud. Il lit les fichiers de logs sous `/var/log/pods/` via un volume hostPath et les transfère via OTLP.

- **Avantages :** surcharge la plus faible, mise à l'échelle linéaire avec les nœuds, aucune charge sur le serveur d'API Kubernetes, gère la rotation des logs.
- **Inconvénients :** nécessite hostPath, nécessite la capacité de planifier des DaemonSets — tous deux indisponibles sur GKE Autopilot et EKS Fargate.

### Mode API (`logs.mode: api`)

Un Deployment à réplique unique (l'image `oneuptime/kubernetes-log-tailer`) utilise l'API Kubernetes pour diffuser les logs des conteneurs — le même endpoint que `kubectl logs -f` utilise. Pas de hostPath, pas d'accès à l'hôte, pas de DaemonSet.

- **Avantages :** fonctionne sur GKE Autopilot, EKS Fargate et tout cluster qui bloque hostPath ou applique le Pod Security Standard `restricted`.
- **Inconvénients :** chaque flux de conteneur est une connexion de longue durée à `kube-apiserver`. En pratique, une seule réplique gère confortablement quelques milliers de conteneurs. Pour les très grands clusters, partitionnez par namespace en utilisant `logs.api.replicas` plus `namespaceFilters.include` sur chaque réplique.

### Lequel devez-vous utiliser ?

Si hostPath fonctionne, utilisez DaemonSet. Partout ailleurs, utilisez le mode API. Le paramètre `preset` choisit le bon pour vous.

Vous pouvez également désactiver entièrement la collecte de logs avec `--set logs.enabled=false` et envoyer les logs d'application via les SDK OpenTelemetry à la place. Consultez la documentation [OpenTelemetry](/docs/telemetry/open-telemetry).

## Traces d'applications et requêtes HTTP via eBPF (activé par défaut)

Le chart livre un DaemonSet exécutant [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) sur chaque nœud. OBI charge des programmes eBPF dans le noyau Linux et surveille le trafic au niveau des sockets pour reconstruire les appels HTTP/HTTPS, gRPC et SQL/Redis depuis chaque pod du nœud — pas de modification de code, pas de SDK, pas de sidecar. Le trafic capturé est exporté sous forme de traces OTLP et de métriques de requête/latence directement vers OneUptime.

Après l'installation, vos services commencent à apparaître sous **Telemetry → Traces** et dans la carte de services en une minute ou deux, avec `k8s.cluster.name` défini sur votre `clusterName` afin que vous puissiez filtrer par cluster.

### Quand le désactiver

eBPF est **activé par défaut**. Vous devez le désactiver (`--set ebpf.enabled=false`) si :

- Vous installez sur **GKE Autopilot** ou **EKS Fargate**. Ces plateformes bloquent les pods privilégiés, et OBI a besoin du mode privilégié pour charger les programmes eBPF.
- Vos nœuds exécutent un noyau plus ancien que **Linux 5.8** sans backports BTF. (Les distributions modernes — Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL/Stream 9+ — sont compatibles.)
- Vous expédiez déjà des traces via le SDK OpenTelemetry depuis vos applications et ne voulez pas de doublons.

### Ce qui est émis

OBI extrait plusieurs familles de signaux du trafic capturé. Toutes sont activées par défaut ; chacune peut être désactivée indépendamment avec `--set ebpf.features.<key>=false` :

| Signal | Par défaut | Ce qu'il ajoute |
| --- | --- | --- |
| `ebpf.features.httpMetrics` | activé | Métriques RED HTTP/gRPC — taux de requêtes, histogrammes de latence, comptages d'erreurs — par service. |
| `ebpf.features.spanMetrics` | activé | Métriques indexées par attribut de span : taille de requête, taille de réponse, durée ventilée par route/opération. |
| `ebpf.features.serviceGraph` | activé | Métriques de liens service-à-service (appelant → appelé, taux de requêtes + latence). Alimente la carte de services. |
| `ebpf.features.hostMetrics` | activé | CPU et mémoire par processus instrumenté — évite d'exécuter un profileur séparé pour les questions de capacité de base. |
| `ebpf.features.networkMetrics` | activé | Compteurs d'octets et de paquets de flux TCP/UDP pod-à-pod avec métadonnées k8s. Fait apparaître chaque paire de pods qui communiquent, y compris ceux exécutant des protocoles qu'OBI ne peut pas analyser. |
| `ebpf.features.networkInterZoneMetrics` | désactivé | Variante inter-zones des métriques réseau. Double la cardinalité ; ne vaut la peine d'être activé que si vous utilisez réellement la planification basée sur les zones. |
| `ebpf.features.tcpStats` | activé | Statistiques TCP au niveau du nœud : histogrammes RTT, comptages de connexions échouées, retransmissions. |

OBI propage également le contexte de trace au travers des frontières de services par défaut. Lorsque le pod A effectue une requête HTTP/gRPC vers le pod B, OBI injecte un en-tête W3C `traceparent` dans la requête sortante — de sorte que le span résultant côté pod B est lié à la même trace que la sortie du pod A. Aucune modification du SDK n'est nécessaire dans l'une ou l'autre des applications.

| Option | Par défaut | Description |
| --- | --- | --- |
| `ebpf.contextPropagation` | activé | Injecte W3C `traceparent` dans le trafic sortant (en-têtes HTTP + option TCP personnalisée). Définir sur `false` pour conserver les spans de chaque service en local. |
| `ebpf.trackRequestHeaders` | activé | Suivi des en-têtes de requête côté noyau pour que la propagation fonctionne également sur les serveurs HTTP simples (non-Go, non-TLS). Ne prend effet que lorsque `contextPropagation` est à true. |

### Corrélation log ↔ trace

Également activée par défaut. L'enrichisseur de logs d'OBI intercepte les écritures stdout des pods depuis les processus instrumentés et :

- Pour les **logs au format JSON** : injecte les champs `trace_id` et `span_id` dans la ligne (les valeurs existantes dans le log sont préservées). Le DaemonSet filelog élève ensuite ces champs vers les emplacements natifs trace_id/span_id du LogRecord, de sorte qu'un clic sur un span dans la vue de trace saute vers ses logs dans OneUptime — et qu'un clic sur une ligne de log saute vers sa trace parente.
- Pour les **logs non-JSON** : la ligne est préservée inchangée — toujours collectée, simplement non liée automatiquement.

| Option | Par défaut | Description |
| --- | --- | --- |
| `ebpf.logToTraceCorrelation` | activé | Active l'enrichisseur de logs OBI et l'élévation du trace_id du pipeline filelog. Définir sur `false` pour ignorer les deux. |

Mises en garde :

- **Les logs doivent être en JSON pour que trace_id apparaisse.** Basculez votre logger vers un formateur JSON — `structlog`, `pino`, `winston`, `serilog`, `logback-json`, klog `--logging-format=json`, etc.
- **Un stdout mis en mémoire tampon casse la corrélation** car l'appel système `write()` est déclenché sur un thread différent de celui qui a traité la requête. Corrections courantes :
  - **Python** : définir `PYTHONUNBUFFERED=1` (le runtime met stdout en buffer par blocs lorsqu'il n'est pas un TTY).
  - **.NET** : au démarrage, `Console.SetOut(new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true })`. Microsoft.Extensions.Logging `AddConsole()` et les sinks asynchrones de Serilog ne fonctionneront pas non plus — basculez vers un writer de console synchrone (le `WriteTo.Console()` par défaut de Serilog convient).
- Greenlet / gevent, Tornado, et autres runtimes asynchrones personnalisés ne sont pas couverts.

### Réglages

| Option | Par défaut | Description |
| --- | --- | --- |
| `ebpf.enabled` | `true` | Interrupteur principal. Définir sur `false` pour ignorer entièrement le DaemonSet eBPF. |
| `ebpf.image.tag` | `v0.9.0` | Tag d'image OBI. OBI est pré-1.0 ; épinglez à une version connue comme bonne et retestez lors des mises à jour. |
| `ebpf.autoTargetExe` | `*` | Glob des exécutables à instrumenter. Restreignez ceci (par exemple `*/python,*/java`) si vous voulez délimiter l'auto-instrumentation. |
| `ebpf.excludeExePaths` | (shells, kubelet, runc, containerd, otelcol, OBI lui-même) | Globs séparés par des virgules à ignorer. |
| `ebpf.logLevel` | `info` | `debug`, `info`, `warn` ou `error`. Définir sur `debug` lors du dépannage. |
| `ebpf.printTraces` | `false` | Imprime les spans sur le stdout d'OBI en plus de l'export OTLP — utile pour vérifier la capture pendant l'installation. |
| `ebpf.resources.*` | requêtes `100m / 256Mi`, limites `1000m / 1Gi` | Augmentez pour les clusters à fort trafic. |

Pour vérifier qu'OBI est en cours d'exécution et voit du trafic :

```bash
kubectl get pods -n oneuptime-kubernetes-agent -l component=ebpf-instrument
kubectl logs -n oneuptime-kubernetes-agent -l component=ebpf-instrument --tail=200
```

## Profilage CPU continu (activé par défaut)

Un DaemonSet séparé exécute le [profileur eBPF OpenTelemetry](https://github.com/open-telemetry/opentelemetry-ebpf-profiler) — empaqueté sous l'image `otel/opentelemetry-collector-ebpf-profiler`. Il échantillonne les piles on-CPU à 19Hz sur tous les runtimes supportés (Go, Java, .NET, Python, Ruby, Node.js, PHP, Perl, C/C++, Rust) et expédie des profils OTLP vers OneUptime, où ils apparaissent sous **Telemetry → Performance Profiles** et sous forme de flame graphs liés aux spans de trace individuels.

Lorsque l'auto-instrumentation eBPF est également activée (`ebpf.enabled: true`, la valeur par défaut), chaque échantillon CPU est corrélé avec le contexte de trace d'OBI via une carte bpffs partagée — de sorte que les flame graphs portent trace_id/span_id et que l'interface utilisateur OneUptime peut vous afficher un flame graph par span.

Prérequis :

- **Noyau Linux 5.10+** (légèrement plus récent que le 5.8 dont OBI a besoin).
- Pod privilégié avec hostPID — mêmes contraintes que le DaemonSet d'auto-instrumentation eBPF. Désactivez sur GKE Autopilot, EKS Fargate et les environnements verrouillés : `--set profiling.enabled=false`.

Réglages :

| Option | Par défaut | Description |
| --- | --- | --- |
| `profiling.enabled` | `true` | Interrupteur principal. |
| `profiling.image.tag` | `0.152.0` | Tag d'image `otel/opentelemetry-collector-ebpf-profiler`. Le profileur est pré-1.0 ; épinglez à une version connue comme bonne. |
| `profiling.samplesPerSecond` | `19` | Fréquence d'échantillonnage en Hz. Valeur par défaut amont ; évite l'aliasing accidentel avec les fréquences de minuteur courantes. |
| `profiling.offCpuThreshold` | `0` | (0–1] active le profilage off-CPU — diagnostique la contention de verrous et les E/S bloquantes. Désactivé par défaut car cela ajoute une surcharge de tracepoint. |
| `profiling.tracers` | `""` *(tous les runtimes)* | Liste séparée par des virgules de traceurs de langage à charger. |
| `profiling.obiProcessContext` | `true` | Corrèle les échantillons avec le contexte de trace d'OBI pour la liaison trace ↔ profil. |

## Autres collectes de données (métriques hôte, audit logs, CSI, CoreDNS)

Le chart peut également collecter :

| `<key>.enabled` | Par défaut | Ce qu'il ajoute |
| --- | --- | --- |
| `hostMetrics` | activé | Métriques OS par nœud depuis `/proc` et `/sys` — profondeur de file d'attente d'E/S de disque, utilisation des inodes du système de fichiers, compteurs d'erreurs NIC, statistiques de pagination, charge moyenne. Vit à l'intérieur du DaemonSet collecteur de logs (pas de pods supplémentaires). |
| `auditLogs` | désactivé | Lit `/var/log/kubernetes/audit.log` depuis l'hôte. Capture chaque requête de l'API Kubernetes — qui a fait quoi à quelle ressource. Clusters auto-gérés uniquement — K8s managés (EKS, GKE, AKS, DOKS) acheminent les audit logs vers le puits du fournisseur cloud. |
| `csi` | désactivé | Découvre automatiquement les pods étiquetés `app=csi-driver` (ou `app.kubernetes.io/component=csi-driver`) et scrape leur port Prometheus `metrics` — latence d'attachement/détachement de volume, échecs de provisionnement, IOPS. |
| `coreDns` | désactivé | Scrape le service CoreDNS du cluster sur `:9153/metrics`. Fait apparaître le taux de requêtes, la latence, le taux de hit cache, les comptages d'erreurs — coupables courants de la latence P99. |

## Options courantes

| Option | Par défaut | Description |
| --- | --- | --- |
| `preset` | (vide — traité comme `standard`) | Voir le tableau ci-dessus. |
| `oneuptime.url` | *(requis)* | URL de votre instance OneUptime. |
| `oneuptime.apiKey` | *(requis)* | Clé API du projet (Settings → API Keys). |
| `clusterName` | *(requis)* | Nom unique pour ce cluster. Estampillé comme `k8s.cluster.name` sur chaque enregistrement. |
| `namespaceFilters.include` | `[]` | Si défini, seuls ces namespaces sont surveillés. |
| `namespaceFilters.exclude` | `["kube-system"]` | Namespaces à ignorer. |
| `logs.enabled` | `true` | Activer ou désactiver la collecte de logs. |
| `logs.mode` | (dérivé de `preset`) | `daemonset`, `api` ou `disabled`. Remplace le preset. |
| `logs.api.replicas` | `1` | Nombre de répliques du Deployment de lecture de logs (mode API uniquement). |
| `ebpf.enabled` | `true` | Capture automatiquement les traces HTTP/gRPC depuis chaque pod via OpenTelemetry eBPF Instrumentation. Voir la section ci-dessus. |
| `profiling.enabled` | `true` | Flame graphs CPU continus via le profileur eBPF OpenTelemetry. Voir la section ci-dessus. |
| `hostMetrics.enabled` | `true` | Métriques OS par nœud. |
| `auditLogs.enabled` | `false` | Collecte des audit logs Kubernetes (clusters auto-gérés). |
| `csi.enabled` | `false` | Métriques Prometheus des pilotes CSI. |
| `coreDns.enabled` | `false` | Métriques Prometheus CoreDNS. |
| `controlPlane.enabled` | `false` | Scrape etcd / api-server / scheduler / controller-manager. Clusters auto-gérés uniquement — les offres managées (EKS/GKE/AKS) n'exposent généralement pas ces endpoints. |

Consultez le [`values.yaml` du chart](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/kubernetes-agent/values.yaml) pour la liste complète.

## Mise à niveau

```bash
helm repo update
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values
```

`--reuse-values` conserve votre configuration existante ; passez toute nouvelle redéfinition `--set` par-dessus.

> **Attention : `--reuse-values` ne fusionne pas les nouvelles valeurs par défaut du chart.** Helm réutilise vos valeurs précédemment rendues telles quelles — donc tout nouveau champ de premier niveau ajouté dans une version plus récente du chart (par exemple `profiling.*`, `ebpf.features.*`) reste non défini sur votre release existante et le template est rendu comme si vous l'aviez désactivé.
>
> **Helm 3.14+** — basculez vers `--reset-then-reuse-values`. Il relit les valeurs par défaut du chart pour les clés que vous n'avez pas redéfinies :
>
> ```bash
> helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
>   --namespace oneuptime-kubernetes-agent \
>   --reset-then-reuse-values
> ```
>
> **Helm 3.13 ou antérieur** — supprimez `--reuse-values` et passez vos drapeaux `--set` d'origine (ou `-f values.yaml`) explicitement. Les nouvelles valeurs par défaut du chart s'appliqueront à tout ce que vous ne redéfinissez pas.
>
> Si les pods d'une nouvelle fonctionnalité (par exemple `kubernetes-agent-profiling-*`) n'apparaissent pas après la mise à niveau, c'est presque toujours la raison. `helm get values <release>` montre ce que Helm a réellement — les champs absents de la sortie signifient que les valeurs par défaut n'ont pas été fusionnées pour eux.

## Désinstallation

```bash
helm uninstall oneuptime-agent --namespace oneuptime-kubernetes-agent
kubectl delete namespace oneuptime-kubernetes-agent
```

## Dépannage

### L'installation échoue avec « hostPath volumes are not allowed »

Votre cluster bloque hostPath. Basculez vers un preset en mode API :

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values \
  --set preset=gke-autopilot   # or eks-fargate
```

### Aucun log n'apparaît dans OneUptime

Vérifiez les pods de l'agent :

```bash
kubectl get pods -n oneuptime-kubernetes-agent
kubectl logs -n oneuptime-kubernetes-agent -l app.kubernetes.io/part-of=oneuptime --tail=200
```

En mode API, le pod log-tailer expose `/healthz` sur le port 13133 — interrogez-le via `kubectl port-forward` pour un instantané de statut d'export.

### Le pod du DaemonSet eBPF est en `CrashLoopBackOff` ou ne parvient pas à démarrer

Vérifiez les logs du pod OBI :

```bash
kubectl logs -n oneuptime-kubernetes-agent -l component=ebpf-instrument --tail=200
```

Causes courantes :

- **Noyau trop ancien ou BTF manquant.** OBI a besoin de Linux 5.8+ avec BTF. Vérifiez avec `uname -r` sur un nœud. Si vous ne pouvez pas mettre à niveau, désactivez eBPF : `--set ebpf.enabled=false`.
- **Les pods privilégiés sont bloqués.** Certains clusters rejettent les pods privilégiés même en dehors d'Autopilot/Fargate. Désactivez eBPF.
- **Pas de traces dans le tableau de bord mais OBI est en cours d'exécution.** Définissez `--set ebpf.printTraces=true` et vérifiez le stdout d'OBI — si vous y voyez des spans, le problème est la livraison OTLP (vérifiez `OTEL_EXPORTER_OTLP_ENDPOINT` et votre URL/clé API OneUptime). Si vous ne voyez pas de spans, le trafic qu'OBI surveille peut être entièrement chiffré par une bibliothèque TLS qu'OBI ne peut pas intercepter (par exemple, une implémentation TLS liée statiquement qu'il ne reconnaît pas).

### Mon cluster a trop de pods pour une seule réplique de log-tailer (mode API uniquement)

Mettez à l'échelle horizontalement en partitionnant les namespaces. Déployez une fois par groupe de namespaces :

```bash
helm install oneuptime-agent-ns-a oneuptime/kubernetes-agent \
  --set preset=gke-autopilot \
  --set namespaceFilters.include={app-a,app-b} \
  ...
```

Alternativement, augmentez `logs.api.replicas` — mais notez que chaque réplique traite tous les namespaces autorisés, donc pour la déduplication, vous avez toujours besoin du sharding par namespace.
