# Agent Kubernetes OneUptime (Helm)

## Aperçu

L'agent Kubernetes OneUptime est un chart Helm préconçu qui installe un pipeline de collecte basé sur OpenTelemetry sur votre cluster. Il fournit les métriques de nœuds, de pods, de conteneurs et de cluster ; les événements Kubernetes ; les journaux de pods ; et — avec eBPF activé par défaut — les traces d'applications, les métriques HTTP RED, les données de graphe de services et les métriques de flux réseau de pod à pod. Aucune modification de code, aucun SDK, un seul `helm install`.

Cette page est le **guide d'installation**. Pour configurer des moniteurs et des alertes Kubernetes par-dessus les données collectées par l'agent, consultez [Agent Kubernetes (moniteurs)](/docs/monitor/kubernetes-agent).

## Prérequis

- Un cluster Kubernetes en cours d'exécution (v1.23+)
- `kubectl` configuré pour accéder à votre cluster
- `helm` v3 installé
- Une **clé d'API OneUptime** — créez-en une depuis *Project Settings → API Keys*

## Étape 1 — Ajouter le dépôt Helm OneUptime

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm repo update
```

## Étape 2 — Choisir un préréglage pour votre cluster

Le chart expose une seule option de premier niveau — `preset` — qui sélectionne des valeurs par défaut compatibles avec votre distribution Kubernetes. Elle contrôle des éléments que vous devriez sinon ajuster manuellement : envoyer les journaux via un DaemonSet hostPath ou via l'API Kubernetes, et quel contexte de sécurité appliquer.

| `preset` | À utiliser pour | Collecte des journaux |
|---|---|---|
| `standard` *(par défaut)* | Clusters auto-gérés, **EKS sur EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | DaemonSet lisant `/var/log/pods` via hostPath (surcharge la plus faible) |
| `gke-autopilot` | **GKE Autopilot** | Déploiement de collecte des journaux via l'API Kubernetes (pas de hostPath, pas d'accès à l'hôte) |
| `eks-fargate` | **EKS Fargate** | Déploiement de collecte des journaux via l'API Kubernetes (pas de hostPath, pas d'accès à l'hôte) |

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

Par défaut, `kube-system` est exclu. Pour surveiller uniquement des espaces de noms spécifiques :

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set "namespaceFilters.include={default,production,staging}"
```

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

| Catégorie | Données |
|----------|------|
| **Métriques de nœuds** | Utilisation du CPU, utilisation de la mémoire, utilisation du système de fichiers, E/S réseau |
| **Métriques de pods** | Utilisation du CPU, utilisation de la mémoire, E/S réseau, redémarrages |
| **Métriques de conteneurs** | Utilisation du CPU, utilisation de la mémoire par conteneur |
| **Métriques de cluster** | Conditions des nœuds, ressources allouables, nombres de pods |
| **Événements Kubernetes** | Avertissements, erreurs, événements de planification |
| **Journaux de pods** | Journaux stdout/stderr de tous les conteneurs (via DaemonSet hostPath sur les clusters standard, ou via l'API Kubernetes sur Autopilot / Fargate) |
| **Traces d'applications** *(via eBPF, activé par défaut)* | Spans HTTP, gRPC, SQL/Redis de chaque pod — aucun SDK ni modification de code |
| **Métriques HTTP RED** *(via eBPF)* | `http.server.request.duration`, tailles des corps de requête et de réponse, par service |
| **Graphe de services** *(via eBPF)* | Taux de requêtes, latence et arêtes d'erreur entre appelant → appelé — alimente la vue de carte des services |
| **Métriques de flux réseau** *(via eBPF)* | Compteurs d'octets et de paquets TCP/UDP de pod à pod avec métadonnées k8s |
| **Statistiques TCP** *(via eBPF)* | Compteurs de RTT, de connexions échouées et de retransmissions au niveau des nœuds |

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

| `ebpf.features.*` | Par défaut | Ce que cela ajoute |
|---|---|---|
| `httpMetrics` | activé | Métriques HTTP/gRPC RED (taux de requêtes, latence, erreurs) par service |
| `spanMetrics` | activé | Taille et durée des requêtes/réponses par span |
| `serviceGraph` | activé | Métriques d'arêtes entre appelant → appelé ; alimente la carte des services |
| `hostMetrics` | activé | CPU et mémoire par processus instrumenté |
| `networkMetrics` | activé | Compteurs de flux TCP/UDP de pod à pod |
| `networkInterZoneMetrics` | désactivé | Variante inter-zones des métriques réseau (double la cardinalité) |
| `tcpStats` | activé | Compteurs de RTT TCP, de connexions échouées et de retransmissions au niveau des nœuds |

La propagation du contexte de trace entre services est également activée par défaut — OBI injecte le `traceparent` W3C dans le trafic HTTP/TCP sortant, de sorte qu'une requête traversant le pod A → pod B apparaisse comme une seule trace, sans aucune modification de SDK où que ce soit. Désactivez avec `--set ebpf.contextPropagation=false`.

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

L'état de connexion d'un cluster est déterminé uniquement par l'arrivée de la télémétrie — si aucune donnée n'arrive, le cluster est marqué comme déconnecté après environ 5 minutes. Ainsi, « disconnected » et « no metrics » ont presque toujours la **même** cause : la télémétrie de l'agent n'est pas acceptée.

La raison la plus courante — en particulier après une réinstallation — est une **clé d'ingestion incorrecte ou révoquée**. Cela passe facilement inaperçu, car les points de terminaison d'ingestion OTLP renvoient délibérément un HTTP `200` même pour un jeton incorrect (afin qu'un collecteur mal configuré ne puisse pas saturer le serveur de nouvelles tentatives). Résultat : le collecteur signale un succès, ses journaux ne montrent aucune erreur, et les données sont silencieusement abandonnées.

1. Vérifiez que les pods de l'agent sont en cours d'exécution : `kubectl get pods -n oneuptime-agent`
2. Vérifiez les journaux du metrics-collector : `kubectl logs -n oneuptime-agent -l component=metrics-collector -c otel-collector` (l'absence d'erreurs ici ne signifie **pas** que les données arrivent — voir ci-dessus)
3. **Validez la clé d'ingestion.** Demandez directement à OneUptime si votre jeton est accepté (`200` = valide, `401` = inconnu/révoqué) :

   ```bash
   curl -i -H "x-oneuptime-token: <YOUR_API_KEY>" https://oneuptime.com/otlp/v1/validate
   ```

   S'il renvoie `401`, la clé de votre version est incorrecte ou a été révoquée. Copiez une clé active depuis *Project Settings → Telemetry Ingestion Keys* et redéployez :

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
