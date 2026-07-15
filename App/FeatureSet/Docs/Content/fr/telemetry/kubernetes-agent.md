# Agent Kubernetes OneUptime (Helm)

## Aperçu

L'agent Kubernetes OneUptime est un chart Helm préconçu qui installe un pipeline de collecte basé sur OpenTelemetry sur votre cluster. Il fournit les métriques de nœuds, de pods, de conteneurs et de cluster ; les événements Kubernetes ; les journaux de pods ; et — avec eBPF activé par défaut — les traces d'applications, les métriques HTTP RED, les données de graphe de services et les métriques de flux réseau de pod à pod. Aucune modification de code, aucun SDK, un seul `helm install`.

Cette page est le **guide d'installation**. Pour configurer des moniteurs et des alertes Kubernetes par-dessus les données collectées par l'agent, consultez [Agent Kubernetes (moniteurs)](/docs/monitor/kubernetes-agent).

## Prérequis

- Un cluster Kubernetes en cours d'exécution (v1.23+)
- `kubectl` configuré pour accéder à votre cluster
- `helm` v3 installé
- Une **clé d'API OneUptime** — créez-en une depuis _Project Settings → API Keys_

## Étape 1 — Ajouter le dépôt Helm OneUptime

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm repo update
```

## Étape 2 — Choisir un préréglage pour votre cluster

Le chart expose une seule option de premier niveau — `preset` — qui sélectionne des valeurs par défaut compatibles avec votre distribution Kubernetes. Elle contrôle des éléments que vous devriez sinon ajuster manuellement : envoyer les journaux via un DaemonSet hostPath ou via l'API Kubernetes, et quel contexte de sécurité appliquer.

| `preset`                  | À utiliser pour                                                                      | Collecte des journaux                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `standard` _(par défaut)_ | Clusters auto-gérés, **EKS sur EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | DaemonSet lisant `/var/log/pods` via hostPath (surcharge la plus faible)                          |
| `gke-autopilot`           | **GKE Autopilot**                                                                    | Déploiement de collecte des journaux via l'API Kubernetes (pas de hostPath, pas d'accès à l'hôte) |
| `eks-fargate`             | **EKS Fargate**                                                                      | Déploiement de collecte des journaux via l'API Kubernetes (pas de hostPath, pas d'accès à l'hôte) |

Si vous n'êtes pas sûr, commencez avec `standard`. Si l'installation échoue avec une erreur Pod Security mentionnant `hostPath`, relancez avec `preset=gke-autopilot` (ou `eks-fargate` sur Fargate) et cela fonctionnera.

## Étape 3 — Installer l'agent Kubernetes

Remplacez `YOUR_ONEUPTIME_URL`, `YOUR_ONEUPTIME_API_KEY` et le nom du cluster par les valeurs propres à votre environnement. Le nom du cluster est la façon dont le cluster apparaîtra dans OneUptime — choisissez quelque chose de stable comme `prod-us-east-1`.

### Clusters standard (auto-gérés, EKS sur EC2, GKE Standard, AKS)

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

## Étape 4 — Vérifier l'installation

Vérifiez que les pods de l'agent sont en cours d'exécution :

```bash
kubectl get pods -n oneuptime-agent
```

Sur un cluster **standard**, vous verrez un Deployment metrics-collector ainsi qu'un pod DaemonSet log-collector par nœud :

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-xxxxx                   1/1     Running   0          1m
kubernetes-agent-logs-yyyyy                   1/1     Running   0          1m
```

Sur **GKE Autopilot** ou **EKS Fargate**, vous verrez deux Deployments à la place (pas de DaemonSet) :

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-yyyyyyyyyy-yyyyy        1/1     Running   0          1m
```

Une fois que l'agent se connecte, votre cluster apparaîtra automatiquement dans la section **Kubernetes** du tableau de bord OneUptime.

## Options de configuration

### Filtrage des espaces de noms

`namespaceFilters` limite les **journaux de pods** (à la fois le DaemonSet hostPath et le collecteur de journaux via l'API) et les **traces eBPF** aux espaces de noms de votre choix. Par défaut, `kube-system` est exclu. Pour restreindre ces signaux à des espaces de noms spécifiques :

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set "namespaceFilters.include={default,production,staging}"
```

Pour ignorer un seul espace de noms bruyant tout en conservant tous les autres, utilisez plutôt `exclude`. `exclude` l'emporte toujours sur `include`, et la valeur par défaut livrée est `[kube-system]` — indiquez-le donc de nouveau si vous voulez qu'il reste exclu :

```bash
  --set "namespaceFilters.exclude={kube-system,noisy-namespace}"
```

Pour les **journaux de pods et les traces eBPF, cela ne coûte rien** : l'espace de noms fait partie du chemin des journaux de pods et de la découverte de processus d'OBI, de sorte qu'un espace de noms filtré n'est jamais lu au départ — pas de CPU, pas de trafic sortant.

#### Appliquer les filtres d'espaces de noms aux métriques et aux traces

Par défaut, les listes ci-dessus ne couvrent que les journaux de pods et les traces eBPF. `applyTo` les étend à d'autres signaux :

```bash
  --set namespaceFilters.applyTo.metrics=true \
  --set namespaceFilters.applyTo.traces=true
```

| Paramètre         | Ce que cela couvre                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| `applyTo.metrics` | Métriques par pod / par conteneur provenant de kubeletstats, cAdvisor et kube-state-metrics                        |
| `applyTo.traces`  | Spans que vos applications envoient au point de terminaison OTLP de l'agent (les spans eBPF sont déjà délimités)   |

Les deux sont **désactivés par défaut**, à dessein. `exclude: [kube-system]` est livré comme valeur par défaut ; les activer automatiquement supprimerait donc silencieusement les métriques de kube-system de chaque installation existante lors d'une mise à niveau.

> **Les métriques au niveau des nœuds et du cluster sont toujours conservées.** Un espace de noms est une propriété d'un pod, pas d'un nœud ; ainsi, des séries comme le CPU d'un nœud, la mémoire d'un nœud et l'utilisation du système de fichiers n'ont rien sur quoi établir une correspondance et ne sont jamais supprimées. `applyTo.metrics` réduit la cardinalité par pod sans jamais vous rendre aveugle à la défaillance d'un nœud.

Les **événements** Kubernetes ne sont pas filtrables par espace de noms au niveau de l'agent. Ils arrivent depuis le récepteur `k8sobjects` sans attribut `k8s.namespace.name` — l'espace de noms se trouve à l'intérieur du corps de l'événement — il n'y a donc rien sur quoi un filtre puisse établir une correspondance. Supprimez-les plutôt côté serveur (voir ci-dessous).

### Filtrage par gravité des journaux

`filters.logs.minSeverity` supprime les enregistrements de **journaux de pods** en dessous d'une gravité, au niveau de l'agent, avant que quoi que ce soit ne soit envoyé :

```bash
  --set filters.logs.minSeverity=WARN
```

Accepte `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL`. `WARN` conserve WARN, ERROR et FATAL et supprime INFO, DEBUG et TRACE. La valeur par défaut (`""`) conserve tout. Cela s'applique dans les **deux** modes de journalisation — en mode `daemonset` via le collecteur, en mode `api` à l'intérieur du collecteur de journaux lui-même — de sorte que les préréglages ne peuvent pas le désactiver à votre insu.

Les runtimes de conteneurs n'enregistrent pas de gravité sur la ligne de journal ; l'agent en extrait donc une du texte du journal lui-même (`[ERROR]`, `WARN:`, `level=info`, …).

> **Les événements Kubernetes et les spécifications de ressources ne sont jamais filtrés par ce paramètre.** Ils arrivent depuis l'API Kubernetes sans gravité propre ; un seuil supprimerait donc l'intégralité du flux au lieu de l'alléger — y compris les avertissements `FailedScheduling`, `BackOff` et `OOMKilling` qui vous intéressent le plus. Ils sont peu volumineux et à forte valeur, c'est pourquoi l'agent les transmet toujours. Pour les alléger, utilisez plutôt les **Logs → Settings → Drop Filters** côté serveur du tableau de bord.

**Ce qu'il advient d'une ligne sans niveau reconnaissable dépend du mode de journalisation**, car les deux modes ne disposent pas des mêmes informations :

| Mode        | Ligne sans niveau                                                                                                    | Pourquoi                                                                                                                                                                        |
| ----------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `daemonset` | `stderr` → traitée comme ERROR (conservée), `stdout` → traitée comme INFO (supprimée par un seuil WARN)               | Le runtime de conteneurs enregistre de quel flux provient chaque ligne.                                                                                                          |
| `api`       | Toujours **conservée**                                                                                                | L'API Kubernetes `pods/log` fusionne stdout et stderr en un seul flux, sans marqueur par ligne. Plutôt que de deviner, l'agent conserve la ligne.                                |

> Le mode `api` supprime donc strictement moins que le mode `daemonset`. C'est délibéré : une trace d'appels Python ou un `npm ERR!` ne comporte aucun mot-clé de gravité, et le supprimer silencieusement est exactement le type de défaillance contre lequel un seuil de gravité est censé vous protéger.

Les événements multilignes sont recombinés **avant** le filtrage dans les deux modes ; ainsi, une trace d'appels Java est jugée sur sa première ligne et conservée ou supprimée d'un bloc — vous n'obtiendrez jamais une simple ligne `ERROR` amputée de ses frames.

### Inclure ou exclure des métriques par nom

`filters.metrics` contrôle quelles métriques quittent le cluster, à travers chaque récepteur du pipeline.

**Supprimer quelques métriques bruyantes** (une liste de refus — généralement ce que vous voulez) :

```bash
  --set-json 'filters.metrics.exclude=["k8s.volume.available","k8s.volume.capacity"]'
```

**N'envoyer qu'un ensemble fixe** (une liste d'autorisation — tout le reste est supprimé) :

```bash
  --set-json 'filters.metrics.include=["k8s.pod.cpu.usage","k8s.pod.memory.usage"]'
```

**Établir une correspondance par motif** plutôt que par nom exact :

```bash
  --set filters.metrics.matchType=regexp \
  --set-json 'filters.metrics.exclude=["^container_network_"]'
```

| Clé                         | Signification                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| `filters.metrics.exclude`   | Noms de métriques à supprimer. Appliqué par-dessus `include`, donc exclude l'emporte toujours.      |
| `filters.metrics.include`   | Lorsqu'elle n'est pas vide, **seules** celles-ci sont envoyées.                                     |
| `filters.metrics.matchType` | `strict` (nom exact, la valeur par défaut) ou `regexp` (RE2, **non ancré**).                        |

Des remarques qui vous éviteront un incident :

- `regexp` est **non ancré** — `system.cpu` correspond aussi à `system.cpu.time`. Ancrez-le (`^system\.cpu$`) lorsque vous visez exactement une métrique.
- RE2 n'a **pas de lookahead**, donc `^(?!container_)` ne compilera pas. Exprimez « tout sauf » avec `include`, pas avec une regex négative.
- `include` s'applique à tous les récepteurs à la fois. Une liste d'autorisation qui oublie une métrique supprime silencieusement les moniteurs construits dessus. Préférez `exclude`, sauf si vous voulez véritablement un ensemble fermé.
- Utilisez `--set-json` (ou un fichier de valeurs) pour les listes. Un simple `--set` remplace une liste au lieu de la fusionner.

> **Testez une regex avant de la déployer.** Les motifs sont compilés par le collecteur au démarrage, et non pour chaque enregistrement ; un motif invalide ne se contente donc pas de mal se comporter en silence — le collecteur refuse de démarrer et part en CrashLoopBackOff, entraînant avec lui les **journaux** de ce collecteur en plus de ses métriques. Helm ne sait pas compiler RE2 : `helm upgrade` accepte donc un motif erroné sans broncher.

### Désactiver la collecte des journaux

Si vous n'avez pas besoin des journaux de pods :

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set logs.enabled=false
```

> **Cela supprime également vos métriques de nœuds.** Les récepteurs kubelet, cAdvisor et hostmetrics résident à l'intérieur du DaemonSet collecteur de journaux ; désactiver les journaux de pods les supprime donc aussi — de même que les moniteurs d'OOM kill, de limitation CPU et d'espace disque faible des PVC. Vous conservez les métriques au niveau du cluster et les événements Kubernetes, mais pas celles par nœud ou par conteneur. Pour réduire le volume de journaux tout en conservant les métriques, utilisez plutôt [`filters.logs.minSeverity`](#filtrage-par-gravit-des-journaux) ou [`namespaceFilters`](#filtrage-des-espaces-de-noms).

### Forcer un mode de collecte des journaux spécifique

Les utilisateurs avancés peuvent remplacer le choix du préréglage avec `logs.mode` :

- `logs.mode=daemonset` — DaemonSet hostPath (surcharge la plus faible, nécessite hostPath)
- `logs.mode=api` — Déploiement de collecte des journaux via l'API Kubernetes (fonctionne sur n'importe quel cluster)
- `logs.mode=disabled` — pas de collecte des journaux

> `api` et `disabled` suppriment tous deux le DaemonSet collecteur de journaux, et avec lui les métriques de nœuds, de pods, de conteneurs et d'hôtes décrites ci-dessus — le même compromis qu'avec `logs.enabled=false`. Seul le mode `daemonset` les collecte. C'est la raison pour laquelle les préréglages GKE Autopilot et EKS Fargate, qui forcent le mode `api`, ne remontent pas de métriques kubelet.

Le `logs.mode` explicite l'emporte toujours sur la valeur par défaut du préréglage. Utilisez ceci si vous connaissez votre cluster mieux que le préréglage.

### Activer la surveillance du plan de contrôle

Pour les clusters auto-gérés (pas EKS / GKE / AKS), vous pouvez activer les métriques du plan de contrôle :

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set controlPlane.enabled=true
```

> Les services Kubernetes gérés (EKS, GKE, AKS) n'exposent généralement pas les métriques du plan de contrôle. N'activez ceci que pour les clusters auto-gérés.

### Étiquetage automatique avec des labels de projet

Tout attribut de ressource préfixé par `oneuptime.label.` est promu en Label de projet et attaché au cluster, aux services et aux hôtes émis par cet agent. Modèle : `oneuptime.label.<dimension>=<value>` devient un label nommé `<dimension>:<value>`.

Transmettez des labels au moment de l'installation avec `--set oneuptime.labels.<key>=<value>` :

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

Ou conservez-les dans un fichier de valeurs :

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

Les labels sont mis en correspondance sans tenir compte de la casse, de sorte qu'un label `Production` existant créé manuellement est réutilisé plutôt que dupliqué. Les labels ajoutés manuellement dans l'interface OneUptime ne sont jamais supprimés par l'agent.

## Mise à niveau de l'agent

```bash
helm repo update
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values
```

`--reuse-values` conserve votre configuration existante (préréglage, nom du cluster, filtres) ; transmettez par-dessus tout nouveau remplacement `--set`.

## Désinstallation de l'agent

```bash
helm uninstall kubernetes-agent --namespace oneuptime-agent
kubectl delete namespace oneuptime-agent
```

## Ce qui est collecté

| Catégorie                                                 | Données                                                                                                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Métriques de nœuds**                                    | Utilisation du CPU, utilisation de la mémoire, utilisation du système de fichiers, E/S réseau                                                     |
| **Métriques de pods**                                     | Utilisation du CPU, utilisation de la mémoire, E/S réseau, redémarrages                                                                           |
| **Métriques de conteneurs**                               | Utilisation du CPU, utilisation de la mémoire par conteneur                                                                                       |
| **Métriques de cluster**                                  | Conditions des nœuds, ressources allouables, nombres de pods                                                                                      |
| **Événements Kubernetes**                                 | Avertissements, erreurs, événements de planification                                                                                              |
| **Journaux de pods**                                      | Journaux stdout/stderr de tous les conteneurs (via DaemonSet hostPath sur les clusters standard, ou via l'API Kubernetes sur Autopilot / Fargate) |
| **Traces d'applications** _(via eBPF, activé par défaut)_ | Spans HTTP, gRPC, SQL/Redis de chaque pod — aucun SDK ni modification de code                                                                     |
| **Métriques HTTP RED** _(via eBPF)_                       | `http.server.request.duration`, tailles des corps de requête et de réponse, par service                                                           |
| **Graphe de services** _(via eBPF)_                       | Taux de requêtes, latence et arêtes d'erreur entre appelant → appelé — alimente la vue de carte des services                                      |
| **Métriques de flux réseau** _(via eBPF)_                 | Compteurs d'octets et de paquets TCP/UDP de pod à pod avec métadonnées k8s                                                                        |
| **Statistiques TCP** _(via eBPF)_                         | Compteurs de RTT, de connexions échouées et de retransmissions au niveau des nœuds                                                                |

## Traces d'applications et métriques HTTP via eBPF (activé par défaut)

Le chart exécute un DaemonSet avec [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) sur chaque nœud. Il charge des programmes eBPF dans le noyau et capture automatiquement le trafic HTTP/HTTPS, gRPC et SQL/Redis de chaque runtime pris en charge (Go, .NET, Java, Node.js, Python, Ruby, Rust) — aucun SDK ni sidecar requis. Les traces et les métriques de requêtes transitent ensuite par le collecteur intra-cluster vers OneUptime.

**Exigences :** noyau Linux **5.8+** avec BTF (par défaut sur Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL/Stream 9+). Le DaemonSet eBPF s'exécute en **mode privilégié** parce qu'il le doit, pour charger les programmes eBPF.

### Désactiver l'auto-instrumentation eBPF

Vous devez la désactiver lorsque :

- Vous installez sur **GKE Autopilot** ou **EKS Fargate** — ces plateformes bloquent les pods privilégiés (utilisez `preset=gke-autopilot` / `preset=eks-fargate` et associez avec `ebpf.enabled=false`).
- Les nœuds exécutent un noyau antérieur à 5.8 sans rétroportages BTF.
- Vous envoyez déjà des traces via les SDK OpenTelemetry depuis vos applications et vous ne voulez pas de doublons.

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set ebpf.enabled=false
```

### Activer/désactiver des familles de signaux individuelles

Toutes activées par défaut. Désactivez-en une avec `--set ebpf.features.<name>=false` :

| `ebpf.features.*`         | Par défaut | Ce que cela ajoute                                                                     |
| ------------------------- | ---------- | -------------------------------------------------------------------------------------- |
| `httpMetrics`             | activé     | Métriques HTTP/gRPC RED (taux de requêtes, latence, erreurs) par service               |
| `spanMetrics`             | activé     | Taille et durée des requêtes/réponses par span                                         |
| `serviceGraph`            | activé     | Métriques d'arêtes entre appelant → appelé ; alimente la carte des services            |
| `hostMetrics`             | activé     | CPU et mémoire par processus instrumenté                                               |
| `networkMetrics`          | activé     | Compteurs de flux TCP/UDP de pod à pod                                                 |
| `networkInterZoneMetrics` | désactivé  | Variante inter-zones des métriques réseau (double la cardinalité)                      |
| `tcpStats`                | activé     | Compteurs de RTT TCP, de connexions échouées et de retransmissions au niveau des nœuds |

La propagation du contexte de trace entre services est également activée par défaut — OBI injecte le `traceparent` W3C dans le trafic HTTP/TCP sortant, de sorte qu'une requête traversant le pod A → pod B apparaisse comme une seule trace, sans aucune modification de SDK où que ce soit. Désactivez avec `--set ebpf.contextPropagation=false`.

## Réduction du volume de données collectées

Par défaut, l'agent est réglé pour la **couverture** — il fournit les métriques, les journaux de pods et les traces eBPF de l'ensemble du cluster afin que chaque tableau de bord et chaque moniteur fonctionne dès le premier jour. Sur les clusters volumineux ou très sollicités, cela peut représenter plus de télémétrie que nécessaire, ce qui se traduit par un volume d'ingestion plus élevé (et, sur OneUptime Cloud, un coût plus élevé). Rien ici n'est obligatoire, mais si un cluster envoie plus que ce que vous souhaitez, voici les leviers à actionner — approximativement par ordre d'impact.

L'astuce consiste à **cesser de collecter ce que vous ne consulterez pas**, plutôt que de tout collecter et de payer pour le stocker. Chaque levier ci-dessous est une valeur Helm, vous pouvez donc l'appliquer avec `--set` sur `helm upgrade --reuse-values` et l'annuler de la même manière.

### D'où provient le volume

| Signal                                | Principal facteur                                                    | Réduire avec                                                                                 |
| ------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Journaux de pods**                  | Chaque ligne de chaque conteneur, à l'échelle du cluster             | `namespaceFilters`, `filters.logs.minSeverity`, `logs.enabled`, `logs.mode`                  |
| **Traces eBPF et métriques de spans** | Une trace par requête de chaque processus instrumenté                | `ebpf.enabled`, `ebpf.features.*`, `ebpf.autoTargetExe`, `ebpf.excludeExePaths`              |
| **Points de données de métriques**    | Fréquence de scraping × nombre de pods/conteneurs                    | `collectionInterval`, `hostMetrics.collectionInterval`, `cadvisor.scrapeInterval`            |
| **Cardinalité des métriques**         | Nombre de séries distinctes (par conteneur, par PVC, …)              | `filters.metrics.exclude`, `namespaceFilters.applyTo.metrics`, `cadvisor.metricsAllowlist`, `kubeletstats.volumeMetrics` |
| **Extras opt-in**                     | Profilage, journaux d'audit, plan de contrôle, métriques inter-zones | Laissez-les désactivés (ils le sont déjà par défaut)                                         |

Il existe deux façons de réduire le volume, et il vaut la peine de savoir laquelle vous utilisez :

- **Au niveau du récepteur** — les données ne sont jamais collectées. `namespaceFilters` sur les journaux de pods, `cadvisor.metricsAllowlist`, un `collectionInterval` plus long. Cela ne coûte rien à l'exécution et économise à la fois le CPU, le trafic sortant et l'ingestion. Préférez toujours ces options lorsqu'elles couvrent votre cas.
- **Au niveau du processeur de filtrage** — les données sont collectées, puis supprimées avant l'export. `filters.logs.minSeverity`, `filters.metrics.*`, `namespaceFilters.applyTo.*`. Un peu plus de CPU pour le collecteur, mais cela fonctionne à travers les récepteurs et permet d'exprimer des choses qu'un récepteur ne peut pas.

Les deux sont **irréversibles** : ce que vous supprimez ici n'atteint jamais OneUptime, et tout moniteur construit dessus devient silencieux. Si vous préférez décider plus tard, OneUptime peut à la place supprimer les données côté serveur (**Logs → Settings → Drop Filters**, **Metrics → Settings → Pipeline Rules**) — cela coûte toujours du trafic sortant, mais c'est un réglage que vous pouvez modifier sans redéploiement.

### Levier 1 — Les journaux de pods sont généralement la plus grande source

Les journaux de conteneurs constituent presque toujours la plus grande part de l'ingestion, car il s'agit d'un enregistrement par ligne de journal de chaque conteneur du cluster.

- **Vous ne voulez les journaux que de certains espaces de noms ?** `namespaceFilters` limite les journaux de pods dans les deux modes de journalisation (ainsi que les traces eBPF qui les accompagnent). La correspondance s'effectue sur le chemin des journaux de pods, de sorte que les espaces de noms filtrés ne sont même jamais lus — c'est le levier le moins coûteux de ce document :

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set "namespaceFilters.include={default,production}"
  ```

  (`kube-system` est déjà exclu par défaut.) Pour conserver tous les espaces de noms sauf un, utilisez `--set "namespaceFilters.exclude={kube-system,noisy-namespace}"`.

- **Vous ne vous souciez que des avertissements et des erreurs ?** `filters.logs.minSeverity` supprime le reste au niveau de l'agent. Sur un cluster bavard, c'est souvent la plus importante réduction disponible, car INFO et DEBUG constituent l'essentiel de la sortie de la plupart des applications :

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set filters.logs.minSeverity=WARN
  ```

  Consultez [Filtrage par gravité des journaux](#filtrage-par-gravit-des-journaux) pour savoir comment la gravité est déterminée et ce qu'il advient des journaux qu'elle ne parvient pas à classifier.

- **Vous n'avez pas du tout besoin des journaux de pods dans OneUptime ?** Désactivez-les :

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set logs.enabled=false
  ```

  > **Cela désactive également les métriques de nœuds, de pods, de conteneurs et d'hôtes.** Les récepteurs kubelet, cAdvisor et hostmetrics vivent tous dans le même DaemonSet log-collector : désactiver les journaux de pods les supprime donc eux aussi — ainsi que les moniteurs d'OOM-kill, de throttling CPU et de disque faible des PVC. Il en va de même pour `logs.mode: api` et `logs.mode: disabled`.
  >
  > Si vous voulez moins de journaux mais souhaitez conserver vos métriques, restez sur `logs.mode: daemonset` et utilisez plutôt `namespaceFilters` ou `filters.logs.minSeverity` ci-dessus.

### Levier 2 — Réduire l'auto-instrumentation eBPF

eBPF vous fournit les traces, les métriques RED, la carte des services et les métriques de flux réseau sans aucune modification de code — mais c'est aussi la deuxième plus grande source de données car il émet un span par requête et plusieurs familles de métriques par service. Vous disposez de trois niveaux de contrôle :

- **Vous envoyez déjà des traces depuis les SDK OTel, ou vous ne voulez pas de traces automatiques ?** Désactivez entièrement eBPF :

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.enabled=false
  ```

- **Conservez les traces, supprimez les familles de métriques lourdes.** Le [tableau des familles de signaux ci-dessus](#activerdsactiver-des-familles-de-signaux-individuelles) répertorie chaque indicateur `ebpf.features.*`. Les familles au plus gros volume sont les métriques réseau et de spans — les désactiver laisse intactes les traces, les métriques HTTP RED et la carte des services :

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.features.networkMetrics=false \
    --set ebpf.features.tcpStats=false \
    --set ebpf.features.spanMetrics=false
  ```

  Laissez `ebpf.features.networkInterZoneMetrics` désactivé (sa valeur par défaut) — il double la cardinalité des flux réseau.

- **N'instrumentez que les runtimes qui vous intéressent.** Par défaut, OBI s'attache à chaque processus qu'il reconnaît (`ebpf.autoTargetExe: "*"`). Restreignez-le à des runtimes spécifiques, ou ajoutez des binaires à la liste d'exclusion, pour réduire le nombre de « services » et de traces que l'agent produit :

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.autoTargetExe='*/python,*/java'
  ```

  Consultez [Activer/désactiver des familles de signaux individuelles](#activerdsactiver-des-familles-de-signaux-individuelles) et la note `excludeExePaths` dans les valeurs du chart pour l'ensemble complet des valeurs par défaut.

### Levier 3 — Ralentir les intervalles de scraping

Le volume de métriques est directement proportionnel à la fréquence à laquelle l'agent effectue le scraping. Doubler un intervalle réduit environ de moitié le nombre de points de données que cette métrique produit, sans perte de couverture — juste une résolution plus grossière. Si vous n'avez pas besoin d'une granularité de 30 secondes, 60s ou 120s constitue une réduction importante et sûre :

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set collectionInterval=60s \
  --set hostMetrics.collectionInterval=60s \
  --set cadvisor.scrapeInterval=60s
```

- `collectionInterval` (par défaut `30s`) pilote les métriques de nœuds / pods / conteneurs (`kubeletstats`) et les métriques d'état du cluster (`k8s_cluster`) — la majeure partie du volume de métriques.
- `hostMetrics.collectionInterval` et `cadvisor.scrapeInterval` couvrent les métriques du système d'exploitation par nœud et les compteurs de throttling / OOM.
- `resourceSpecs.interval` (par défaut `300s`) contrôle la fréquence à laquelle les spécifications complètes des ressources (labels, annotations, statut) sont récupérées — augmentez-le si vous n'avez pas besoin que les modifications de spécifications soient reflétées rapidement.
- Si vous avez activé l'un des scrapers optionnels, ils ont eux aussi leurs propres réglages : `kubeStateMetrics.scrapeInterval`, `serviceMesh.*.scrapeInterval`, `coreDns.scrapeInterval`, `csi.scrapeInterval`.

### Levier 4 — Maintenir la cardinalité des métriques bornée

La cardinalité (le nombre de séries temporelles distinctes) compte autant que la fréquence, car chaque série est stockée et facturée séparément.

- **cAdvisor est sur liste d'autorisation à dessein.** Le récepteur cAdvisor (activé par défaut) peut émettre des centaines de métriques ; le chart n'en transmet que la poignée qui alimente les moniteurs (`cadvisor.metricsAllowlist`). Gardez la liste réduite — **chaque entrée est conservée par conteneur, de sorte qu'une métrique supplémentaire se multiplie par le nombre de conteneurs du cluster.** kube-state-metrics est désactivé par défaut, mais si vous l'activez (`kubeStateMetrics.enabled=true`), son `kubeStateMetrics.metricsAllowlist` limite la cardinalité de la même manière.
- **Les métriques de volume par PVC** (`kubeletstats.volumeMetrics.enabled`, activé par défaut) émettent une série par PVC par pod. C'est acceptable pour la plupart des clusters mais cela peut être important sur les charges de travail avec état (Kafka, bases de données) comptant des milliers de PVC — désactivez-les dans ce cas si vous ne surveillez pas l'espace disque des PVC :

  ```bash
  --set kubeletstats.volumeMetrics.enabled=false
  ```

- **Les métriques de saturation** (`kubeletstats.utilizationMetrics.enabled`, activé par défaut) ajoutent 8 familles dérivées « % de la requête/limite ». Elles sont peu coûteuses (pas de scrape supplémentaire) mais si vous n'utilisez pas les moniteurs CPU/Mémoire par rapport à la limite, vous pouvez les supprimer avec `--set kubeletstats.utilizationMetrics.enabled=false`.

- **Supprimez des métriques spécifiques par nom.** Les listes d'autorisation ci-dessus sont propres à chaque récepteur ; `filters.metrics.exclude` les couvre toutes, utilisez-la donc pour tout ce que les réglages au niveau des récepteurs ne peuvent pas exprimer :

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set filters.metrics.matchType=regexp \
    --set-json 'filters.metrics.exclude=["^container_network_"]'
  ```

  Consultez [Inclure ou exclure des métriques par nom](#inclure-ou-exclure-des-mtriques-par-nom) pour la correspondance exacte ou par regex et pour la forme en liste d'autorisation.

- **Supprimez les métriques de tout un espace de noms.** Si un espace de noms est bruyant mais que vous voulez tout de même surveiller ses nœuds, `namespaceFilters.applyTo.metrics=true` applique vos listes d'espaces de noms existantes aux séries par pod et par conteneur. Les séries au niveau des nœuds et du cluster sont toujours conservées :

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set namespaceFilters.applyTo.metrics=true
  ```

### Levier 5 — Laissez désactivées les fonctionnalités opt-in lourdes

Elles sont **désactivées par défaut** précisément parce qu'elles ajoutent de la charge — n'en activez une que lorsque vous utilisez activement ce qu'elle alimente, et désactivez-la de nouveau si vous ne faisiez que l'essayer :

| Valeur                                                    | Ajoute                                                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `profiling.enabled`                                       | DaemonSet de profilage CPU continu — plus lourd que les traces eBPF                              |
| `auditLogs.enabled`                                       | Chaque requête de l'API Kubernetes en tant qu'enregistrement de journal (volume élevé)           |
| `controlPlane.enabled`                                    | Métriques etcd / API-server / scheduler / controller-manager                                     |
| `kubeStateMetrics.enabled`                                | Métriques CrashLoop / ImagePull / raison de planification (ajoute un Deployment KSM + un scrape) |
| `ebpf.features.networkInterZoneMetrics`                   | Double la cardinalité des métriques de flux réseau                                               |
| `serviceMesh.enabled` / `csi.enabled` / `coreDns.enabled` | Tâches de scraping Prometheus supplémentaires                                                    |

### Un point de départ minimal

Si vous souhaitez une empreinte plus réduite mais voulez tout de même que les moniteurs fonctionnent, ce profil conserve une **couverture complète des métriques** et supprime les deux éléments qui génèrent réellement du volume — les lignes de journaux et les spans eBPF :

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

# Keep the DaemonSet — it is what collects kubelet, cAdvisor and host
# metrics as well as logs — but only ship logs worth alerting on.
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

Resserrez davantage selon vos besoins : portez `minSeverity` à `ERROR`, ajoutez `namespaceFilters.applyTo.metrics=true`, ou définissez `ebpf.enabled=false` si vous envoyez déjà des traces depuis les SDK OTel.

> **Faites attention à ce que vous supprimez.** Certains moniteurs dépendent de signaux spécifiques : désactiver `cadvisor` supprime les moniteurs d'OOM-kill et de throttling CPU ; désactiver `kubeletstats.volumeMetrics` supprime le moniteur de disque faible des PVC ; désactiver les journaux (ou couper le DaemonSet) supprime les alertes basées sur les journaux *ainsi que* vos métriques de nœuds. Réduisez les signaux sur lesquels vous n'agissez pas, pas ceux qu'un moniteur surveille.

### Mesurer l'effet

L'utilisation de la télémétrie est agrégée par jour, alors observez la tendance sur un jour ou deux dans **Project Settings → Usage History** pour confirmer la baisse — elle ne bougera pas à l'instant où vous appliquez un changement. Modifiez un levier à la fois afin de pouvoir attribuer la différence — journaux désactivés, puis intervalle augmenté, puis eBPF réduit — plutôt que de tout réduire d'un coup et de perdre un moniteur sur lequel vous comptiez réellement.

## Dépannage

> **Chemin le plus rapide — exécutez le script de diagnostic.** Il inspecte la santé des pods, décode et valide la clé d'ingestion, vérifie que votre cluster peut atteindre OneUptime, et demande à OneUptime si votre jeton est réellement accepté — puis affiche un seul verdict de cause racine :
>
> ```bash
> curl -fsSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/HelmChart/Public/kubernetes-agent/troubleshoot.sh \
>   | bash -s -- -n oneuptime-agent
> ```
>
> Il lit uniquement l'état du cluster et exécute quelques sondes ; il ne change rien. Pour le test de sortie réseau le plus précis, installez d'abord avec `--set debug.enabled=true` (cela ajoute un petit sidecar d'outils réseau aux pods de l'agent afin que le script teste le chemin de sortie exact du collecteur), puis relancez.

### L'installation échoue avec « hostPath volumes are not allowed » ou une erreur d'admission Pod Security

Votre cluster bloque `hostPath` — courant sur **GKE Autopilot** et **EKS Fargate**. Basculez vers le préréglage en mode API :

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set preset=gke-autopilot   # or eks-fargate
```

### L'agent affiche « Disconnected »

L'état de connexion d'un cluster est déterminé uniquement par l'arrivée de la télémétrie — si aucune donnée n'arrive, le cluster est marqué comme déconnecté après environ 15 minutes. Ainsi, « disconnected » et « no metrics » ont presque toujours la **même** cause : la télémétrie de l'agent n'est pas acceptée.

La raison la plus courante — en particulier après une réinstallation — est une **clé d'ingestion incorrecte ou révoquée**. Cela passe facilement inaperçu, car les points de terminaison d'ingestion OTLP renvoient délibérément un HTTP `200` même pour un jeton incorrect (afin qu'un collecteur mal configuré ne puisse pas saturer le serveur de nouvelles tentatives). Résultat : le collecteur signale un succès, ses journaux ne montrent aucune erreur, et les données sont silencieusement abandonnées.

1. Vérifiez que les pods de l'agent sont en cours d'exécution : `kubectl get pods -n oneuptime-agent`
2. Vérifiez les journaux du metrics-collector : `kubectl logs -n oneuptime-agent -l component=metrics-collector -c otel-collector` (l'absence d'erreurs ici ne signifie **pas** que les données arrivent — voir ci-dessus)
3. **Validez la clé d'ingestion.** Demandez directement à OneUptime si votre jeton est accepté (`200` = valide, `401` = inconnu/révoqué) :

   ```bash
   curl -i -H "x-oneuptime-token: <YOUR_API_KEY>" https://oneuptime.com/otlp/v1/validate
   ```

   S'il renvoie `401`, la clé de votre version est incorrecte ou a été révoquée. Copiez une clé active depuis _Project Settings → Telemetry Ingestion Keys_ et redéployez :

   ```bash
   helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
     --namespace oneuptime-agent --reuse-values \
     --set oneuptime.apiKey=<LIVE_KEY>
   ```

4. Vérifiez que votre URL OneUptime est correcte et que votre cluster peut l'atteindre sur le réseau.
5. Si vous avez modifié `clusterName` lors de la réinstallation, l'agent apparaît comme un **nouveau** cluster — l'ancienne entrée reste « Disconnected » (c'est attendu ; elle est obsolète).

### Aucun journal n'apparaît (mode API uniquement)

1. Confirmez que le pod de collecte des journaux est Ready : `kubectl get pods -n oneuptime-agent -l component=log-collector`
2. Vérifiez son `/healthz` — il signale le nombre de flux actifs et la dernière erreur d'export
3. Vérifiez les journaux : `kubectl logs -n oneuptime-agent deployment/kubernetes-agent-logs`
4. Pour de très grands clusters, un seul réplica peut constituer un goulot d'étranglement — répartissez par espace de noms à l'aide de `namespaceFilters.include` sur des versions distinctes

### Aucune métrique n'apparaît

1. Excluez d'abord une clé d'ingestion rejetée — c'est la cause la plus courante et elle est invisible du côté de l'agent. Consultez [L'agent affiche « Disconnected »](#lagent-affiche-disconnected) ci-dessus (ou exécutez simplement le script de diagnostic).
2. Vérifiez que l'identifiant du cluster correspond à la valeur que vous avez transmise comme `clusterName`
3. Vérifiez les autorisations RBAC : `kubectl get clusterrolebinding | grep kubernetes-agent`
4. Vérifiez les journaux du collecteur OTel pour repérer des erreurs d'export

### Les pods eBPF sont en CrashLoopBackOff ou ne démarrent pas

```bash
kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200
```

Causes courantes :

- **Noyau trop ancien ou BTF manquant.** OBI nécessite Linux 5.8+ avec BTF. Exécutez `uname -r` sur un nœud. Si vous ne pouvez pas mettre à niveau, désactivez eBPF : `--set ebpf.enabled=false`.
- **Pods privilégiés bloqués.** Certains clusters rejettent les pods privilégiés (GKE Autopilot, EKS Fargate et les environnements verrouillés). Désactivez eBPF.
- **`debugfs` / `tracefs` non monté sur l'hôte.** La fonctionnalité `tcpStats` s'attache à des points de trace du noyau qui en ont besoin. Le chart monte les deux via `hostPath` — mais si votre hôte ne les expose pas, désactivez uniquement cette famille : `--set ebpf.features.tcpStats=false`.

### Aucune trace d'application n'apparaît

1. Confirmez que le DaemonSet eBPF est sain : `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`
2. Activez l'imprimeur de traces de débogage pour confirmer qu'OBI capture le trafic : `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, puis vérifiez `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`
3. Si vous voyez des spans dans la sortie standard d'OBI mais pas dans le tableau de bord, le problème vient de l'export collecteur → OneUptime — vérifiez les journaux du pod metrics-collector.

## Étapes suivantes

- Configurez des **moniteurs Kubernetes** par-dessus les métriques collectées par cet agent — consultez [Agent Kubernetes (moniteurs)](/docs/monitor/kubernetes-agent).
- Ajoutez des **moniteurs de journaux** pour alerter sur des modèles de journaux spécifiques (par exemple, des nombres d'erreurs dépassant un seuil par pod ou par espace de noms).
- Pour les hôtes non-Kubernetes (VM Linux / macOS / Windows et serveurs physiques), utilisez la page [Collecteur OpenTelemetry pour hôtes](/docs/telemetry/host-otel-collector).
