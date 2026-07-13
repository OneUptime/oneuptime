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

> Ces filtres ne réduisent **pas** les **métriques** de nœuds / pods / conteneurs — celles-ci sont récupérées par scraping sur chaque nœud depuis le kubelet et sont toujours collectées à l'échelle du cluster (les séries au niveau des nœuds et du cluster n'ont aucun espace de noms sur lequel filtrer). `exclude` l'emporte toujours sur `include`. Consultez [Réduction du volume de données collectées](#reducing-the-volume-of-data-collected) pour l'ensemble complet des contrôles de volume.

### Désactiver la collecte des journaux

Si vous n'avez besoin que des métriques et des événements (pas des journaux de pods) :

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set logs.enabled=false
```

### Forcer un mode de collecte des journaux spécifique

Les utilisateurs avancés peuvent remplacer le choix du préréglage avec `logs.mode` :

- `logs.mode=daemonset` — DaemonSet hostPath (surcharge la plus faible, nécessite hostPath)
- `logs.mode=api` — Déploiement de collecte des journaux via l'API Kubernetes (fonctionne sur n'importe quel cluster)
- `logs.mode=disabled` — pas de collecte des journaux

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
| **Journaux de pods**                  | Chaque ligne de chaque conteneur, à l'échelle du cluster             | `logs.enabled`, `logs.mode`, `namespaceFilters`                                              |
| **Traces eBPF et métriques de spans** | Une trace par requête de chaque processus instrumenté                | `ebpf.enabled`, `ebpf.features.*`, `ebpf.autoTargetExe`, `ebpf.excludeExePaths`              |
| **Points de données de métriques**    | Fréquence de scraping × nombre de pods/conteneurs                    | `collectionInterval`, `hostMetrics.collectionInterval`, `cadvisor.scrapeInterval`            |
| **Cardinalité des métriques**         | Nombre de séries distinctes (par conteneur, par PVC, …)              | `cadvisor.metricsAllowlist`, `kubeletstats.volumeMetrics`, `kubeletstats.utilizationMetrics` |
| **Extras opt-in**                     | Profilage, journaux d'audit, plan de contrôle, métriques inter-zones | Laissez-les désactivés (ils le sont déjà par défaut)                                         |

### Levier 1 — Les journaux de pods sont généralement la plus grande source

Les journaux de conteneurs constituent presque toujours la plus grande part de l'ingestion, car il s'agit d'un enregistrement par ligne de journal de chaque conteneur du cluster.

- **Vous n'avez pas du tout besoin des journaux dans OneUptime ?** Désactivez-les complètement — vous conservez toutes les métriques, tous les événements et toutes les traces :

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set logs.enabled=false
  ```

- **Vous ne voulez les journaux que de certains espaces de noms ?** `namespaceFilters.include` limite les journaux de pods dans les deux modes de journalisation (ainsi que les traces eBPF qui les accompagnent). La correspondance s'effectue sur le chemin des journaux de pods, de sorte que les espaces de noms filtrés ne sont même jamais lus :

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set "namespaceFilters.include={default,production}"
  ```

  (`kube-system` est déjà exclu par défaut.)

### Levier 2 — Réduire l'auto-instrumentation eBPF

eBPF vous fournit les traces, les métriques RED, la carte des services et les métriques de flux réseau sans aucune modification de code — mais c'est aussi la deuxième plus grande source de données car il émet un span par requête et plusieurs familles de métriques par service. Vous disposez de trois niveaux de contrôle :

- **Vous envoyez déjà des traces depuis les SDK OTel, ou vous ne voulez pas de traces automatiques ?** Désactivez entièrement eBPF :

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.enabled=false
  ```

- **Conservez les traces, supprimez les familles de métriques lourdes.** Le [tableau des familles de signaux ci-dessus](#toggle-individual-signal-families) répertorie chaque indicateur `ebpf.features.*`. Les familles au plus gros volume sont les métriques réseau et de spans — les désactiver laisse intactes les traces, les métriques HTTP RED et la carte des services :

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

  Consultez [Activer/désactiver des familles de signaux individuelles](#toggle-individual-signal-families) et la note `excludeExePaths` dans les valeurs du chart pour l'ensemble complet des valeurs par défaut.

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

Si vous souhaitez une empreinte minimale et que vous rajouterez des signaux au fur et à mesure de vos besoins, ce profil **métriques + événements uniquement** supprime les journaux et eBPF et réduit de moitié la fréquence de scraping :

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

À partir de là, réactivez ce dont vous avez besoin : `logs.enabled=true` pour quelques espaces de noms en mode API, ou `ebpf.enabled=true` avec un `autoTargetExe` restreint.

> **Faites attention à ce que vous supprimez.** Certains moniteurs dépendent de signaux spécifiques : désactiver `cadvisor` supprime les moniteurs d'OOM-kill et de throttling CPU ; désactiver `kubeletstats.volumeMetrics` supprime le moniteur de disque faible des PVC ; désactiver les journaux supprime les alertes basées sur les journaux. Réduisez les signaux sur lesquels vous n'agissez pas, pas ceux qu'un moniteur surveille.

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

1. Excluez d'abord une clé d'ingestion rejetée — c'est la cause la plus courante et elle est invisible du côté de l'agent. Consultez [L'agent affiche « Disconnected »](#agent-shows-disconnected) ci-dessus (ou exécutez simplement le script de diagnostic).
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
