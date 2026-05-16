# Installer l'agent Kubernetes

L'agent Kubernetes OneUptime collecte les métriques du cluster, les événements et les journaux des pods de votre cluster Kubernetes et les envoie à OneUptime. Il est distribué sous forme de chart Helm.

## Démarrage rapide

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm repo update

helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<VOTRE_CLÉ_API> \
  --set clusterName=<UN_NOM_UNIQUE_POUR_CE_CLUSTER>
```

Votre cluster apparaîtra dans OneUptime en quelques minutes.

## Choisir le bon préréglage pour votre cluster

Les différentes distributions Kubernetes ont des contraintes différentes — notamment si les charges de travail peuvent monter des volumes `hostPath`. Plutôt que de vous obliger à lire la documentation de sécurité, le chart expose une seule option de premier niveau : `preset`.

| Préréglage | Utilisation | Collecte de journaux | Remarques |
| --- | --- | --- | --- |
| `standard` (par défaut) | Auto-géré, **EKS sur EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | DaemonSet lisant `/var/log/pods` via hostPath | Surcharge la plus faible. hostPath est disponible sur ces plateformes. |
| `gke-autopilot` | **GKE Autopilot** | Dispositif de suivi de l'API Kubernetes (Deployment) | hostPath est bloqué sur Autopilot. Définit un contexte de sécurité renforcé qui satisfait aux normes de sécurité des pods d'Autopilot. |
| `eks-fargate` | **EKS Fargate** | Dispositif de suivi de l'API Kubernetes (Deployment) | Identique à `gke-autopilot`. Fargate bloque hostPath et les DaemonSets. |

Si vous n'êtes pas sûr, laissez `preset` non défini — vous obtenez les valeurs par défaut `standard`. Si votre cluster rejette l'installation avec une erreur de politique de sécurité des pods mentionnant `hostPath`, passez à `gke-autopilot` (ou `eks-fargate` sur EKS Fargate) et réinstallez.

### Exemples

**GKE Standard, EKS sur EC2, auto-géré ou AKS :**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<VOTRE_CLÉ_API> \
  --set clusterName=prod
```

**GKE Autopilot :**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<VOTRE_CLÉ_API> \
  --set clusterName=prod-gke-autopilot \
  --set preset=gke-autopilot
```

**EKS Fargate :**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<VOTRE_CLÉ_API> \
  --set clusterName=prod-eks-fargate \
  --set preset=eks-fargate
```

## Différences entre les deux modes de collecte de journaux

En coulisse, `preset` définit `logs.mode` — vous pouvez également le définir directement si vous avez besoin de remplacer le défaut du préréglage.

### Mode DaemonSet (`logs.mode: daemonset`)

Un DaemonSet exécute un pod OpenTelemetry Collector par nœud. Il suit les fichiers journaux sous `/var/log/pods/` via un volume hostPath et les transmet via OTLP.

- **Avantages :** surcharge minimale, mise à l'échelle linéaire avec les nœuds, pas de charge sur le serveur API Kubernetes, gère la rotation des journaux.
- **Inconvénients :** nécessite hostPath, nécessite la capacité de planifier des DaemonSets — les deux étant indisponibles sur GKE Autopilot et EKS Fargate.

### Mode API (`logs.mode: api`)

Un Deployment à réplique unique (l'image `oneuptime/kubernetes-log-tailer`) utilise l'API Kubernetes pour diffuser les journaux des conteneurs — le même point d'accès que `kubectl logs -f` utilise. Pas de hostPath, pas d'accès à l'hôte, pas de DaemonSet.

- **Avantages :** fonctionne sur GKE Autopilot, EKS Fargate et tout cluster qui bloque hostPath ou applique la norme de sécurité des pods `restricted`.
- **Inconvénients :** chaque flux de conteneur est une connexion longue durée à `kube-apiserver`. En pratique, une réplique gère confortablement quelques milliers de conteneurs. Pour les très grands clusters, fragmentez par espace de noms en utilisant `logs.api.replicas` plus `namespaceFilters.include` sur chaque réplique.

### Lequel devriez-vous utiliser ?

Si hostPath fonctionne, utilisez DaemonSet. Partout ailleurs, utilisez le mode API. Le paramètre `preset` sélectionne le bon pour vous.

Vous pouvez également désactiver entièrement la collecte de journaux avec `--set logs.enabled=false` et envoyer les journaux d'application via les SDK OpenTelemetry à la place. Consultez la documentation [OpenTelemetry](/docs/telemetry/open-telemetry).

## Options courantes

| Option | Par défaut | Description |
| --- | --- | --- |
| `preset` | (vide — traité comme `standard`) | Voir le tableau ci-dessus. |
| `oneuptime.url` | *(obligatoire)* | URL de votre instance OneUptime. |
| `oneuptime.apiKey` | *(obligatoire)* | Clé API du projet (Paramètres → Clés API). |
| `clusterName` | *(obligatoire)* | Nom unique pour ce cluster. Apposé comme `k8s.cluster.name` sur chaque enregistrement. |
| `namespaceFilters.include` | `[]` | Si défini, seuls ces espaces de noms sont surveillés. |
| `namespaceFilters.exclude` | `["kube-system"]` | Espaces de noms à ignorer. |
| `logs.enabled` | `true` | Activer ou désactiver la collecte de journaux. |
| `logs.mode` | (dérivé de `preset`) | `daemonset`, `api` ou `disabled`. Remplace le préréglage. |
| `logs.api.replicas` | `1` | Nombre de répliques de Deployment du dispositif de suivi des journaux (uniquement en mode API). |
| `controlPlane.enabled` | `false` | Collecter des métriques etcd / api-server / scheduler / controller-manager. Clusters auto-gérés uniquement — les offres gérées (EKS/GKE/AKS) n'exposent généralement pas ces points d'accès. |

Consultez le fichier [`values.yaml` du chart](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/kubernetes-agent/values.yaml) pour la liste complète.

## Mise à jour

```bash
helm repo update
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values
```

`--reuse-values` conserve votre configuration existante ; ajoutez de nouveaux remplacements `--set` par-dessus.

## Désinstallation

```bash
helm uninstall oneuptime-agent --namespace oneuptime-kubernetes-agent
kubectl delete namespace oneuptime-kubernetes-agent
```

## Dépannage

### L'installation échoue avec "hostPath volumes are not allowed"

Votre cluster bloque hostPath. Passez à un préréglage en mode API :

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values \
  --set preset=gke-autopilot   # ou eks-fargate
```

### Aucun journal n'apparaît dans OneUptime

Vérifiez les pods de l'agent :

```bash
kubectl get pods -n oneuptime-kubernetes-agent
kubectl logs -n oneuptime-kubernetes-agent -l app.kubernetes.io/part-of=oneuptime --tail=200
```

En mode API, le pod du dispositif de suivi des journaux expose `/healthz` sur le port 13133 — accédez-y via `kubectl port-forward` pour un aperçu du statut d'exportation.

### Mon cluster a trop de pods pour une réplique du dispositif de suivi des journaux (mode API uniquement)

Effectuez une mise à l'échelle horizontale en fragmentant les espaces de noms. Déployez une fois par groupe d'espaces de noms :

```bash
helm install oneuptime-agent-ns-a oneuptime/kubernetes-agent \
  --set preset=gke-autopilot \
  --set namespaceFilters.include={app-a,app-b} \
  ...
```

Alternativement, augmentez `logs.api.replicas` — mais notez que chaque réplique traite tous les espaces de noms autorisés, donc pour la déduplication, vous avez quand même besoin de la fragmentation par espaces de noms.
