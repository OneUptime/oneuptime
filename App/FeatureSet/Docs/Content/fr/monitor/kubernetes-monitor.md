# Moniteur Kubernetes

La surveillance Kubernetes vous permet de surveiller la santé et les performances de vos clusters Kubernetes, notamment les nœuds, les pods, les charges de travail et les composants du plan de contrôle. OneUptime collecte des métriques de votre cluster et les évalue en fonction de vos critères configurés.

## Vue d'ensemble

Les moniteurs Kubernetes utilisent les métriques de votre cluster pour offrir une visibilité approfondie sur votre infrastructure. Cela vous permet de :

- Surveiller la santé du cluster, des espaces de noms, des charges de travail, des nœuds et des pods
- Suivre l'utilisation du CPU, de la mémoire, du disque et du réseau sur les ressources
- Détecter les pannes de pods, les redémarrages et les échecs de planification
- Surveiller la disponibilité des répliques de déploiement
- Alerter sur les problèmes du plan de contrôle (etcd, serveur API, scheduleur)
- Suivre les demandes et limites de ressources

## Création d'un moniteur Kubernetes

1. Allez dans **Moniteurs** dans le tableau de bord OneUptime
2. Cliquez sur **Créer un moniteur**
3. Sélectionnez **Kubernetes** comme type de moniteur
4. Sélectionnez le cluster et la portée de ressources à surveiller
5. Configurez les filtres de ressources et les requêtes de métriques
6. Configurez les critères de surveillance selon vos besoins

## Options de configuration

### Cluster

Sélectionnez le cluster Kubernetes à surveiller. Les clusters doivent être intégrés à OneUptime via OpenTelemetry.

### Portée de la ressource

Choisissez le niveau auquel surveiller les ressources :

| Portée | Description |
|--------|-------------|
| Cluster | Surveiller l'ensemble du cluster |
| Espace de noms | Surveiller les ressources dans un espace de noms spécifique |
| Charge de travail | Surveiller un déploiement, statefulset, daemonset, job ou cronjob spécifique |
| Nœud | Surveiller un nœud de cluster spécifique |
| Pod | Surveiller un pod spécifique |

### Filtres de ressources

Affinez la portée avec des filtres optionnels :

| Filtre | Description | Portées applicables |
|--------|-------------|---------------------|
| Espace de noms | Espace de noms Kubernetes | Espace de noms, Charge de travail, Pod |
| Type de charge de travail | deployment, statefulset, daemonset, job, cronjob | Charge de travail |
| Nom de la charge de travail | Nom de la charge de travail | Charge de travail |
| Nom du nœud | Nom du nœud | Nœud |
| Nom du pod | Nom du pod | Pod |

### Requêtes de métriques

Configurez une ou plusieurs requêtes de métriques à évaluer. Chaque requête spécifie :

- **Nom de la métrique** — La métrique Kubernetes à interroger
- **Agrégation** — Comment agréger les valeurs des métriques
- **Filtres** — Filtrage supplémentaire basé sur les attributs

Vous pouvez également créer des **formules** qui combinent plusieurs requêtes de métriques à l'aide d'expressions mathématiques.

### Fenêtre temporelle glissante

Sélectionnez la fenêtre temporelle pour l'évaluation des métriques :

- 1 dernière minute
- 5 dernières minutes
- 10 dernières minutes
- 15 dernières minutes
- 30 dernières minutes
- 60 dernières minutes

## Métriques Kubernetes courantes

### Métriques de pod

| Métrique | Description |
|----------|-------------|
| Utilisation CPU du pod | Consommation CPU par les pods |
| Utilisation mémoire du pod | Consommation mémoire par les pods |
| Utilisation du système de fichiers du pod | Utilisation du disque par les pods |
| Réception/transmission réseau du pod | Trafic réseau |
| Phase du pod | Phase actuelle du pod (En cours d'exécution, En attente, Échoué, etc.) |

### Métriques de nœud

| Métrique | Description |
|----------|-------------|
| Utilisation CPU du nœud | Utilisation CPU par nœud |
| Utilisation mémoire du nœud | Utilisation mémoire par nœud |
| Utilisation du système de fichiers du nœud | Utilisation du disque par nœud |
| E/S disque du nœud | Opérations de lecture/écriture |
| Condition de disponibilité du nœud | Si le nœud est prêt |

### Métriques de conteneur

| Métrique | Description |
|----------|-------------|
| Redémarrages du conteneur | Nombre de redémarrages du conteneur |
| Limites CPU/mémoire du conteneur | Limites de ressources |
| Demandes CPU/mémoire du conteneur | Demandes de ressources |
| Statut de disponibilité du conteneur | Si les conteneurs sont prêts |

### Métriques de charge de travail

| Métrique | Description |
|----------|-------------|
| Répliques disponibles/indisponibles du déploiement | Comptages des répliques |
| Nœuds mal planifiés du DaemonSet | Problèmes de planification |
| Répliques prêtes du StatefulSet | Nombre de répliques prêtes |
| Pods actifs/échoués/réussis du job | Statut du job |

## Critères de surveillance

### Types de vérifications disponibles

| Type de vérification | Description |
|----------------------|-------------|
| Valeur de métrique | La valeur de la requête de métrique ou formule configurée |

### Types d'agrégation

| Agrégation | Description |
|------------|-------------|
| Moyenne | Valeur moyenne sur la fenêtre temporelle |
| Somme | Somme de toutes les valeurs |
| Valeur maximale | Valeur la plus élevée dans la fenêtre temporelle |
| Valeur minimale | Valeur la plus basse dans la fenêtre temporelle |
| Toutes les valeurs | Toutes les valeurs doivent correspondre aux critères |
| N'importe quelle valeur | Au moins une valeur doit correspondre |

### Types de filtres

- **Supérieur à**, **Inférieur à**, **Supérieur ou égal à**, **Inférieur ou égal à**, **Égal à**, **Différent de**

## Modèles d'alertes préconfigurés

OneUptime fournit des modèles pour les scénarios courants de surveillance Kubernetes :

| Modèle | Description | Seuil |
|--------|-------------|-------|
| Détection de CrashLoopBackOff | Nombre de redémarrages du conteneur | > 5 redémarrages |
| Pod bloqué en attente | Pods en phase En attente | > 0 pods |
| Nœud non prêt | Condition de disponibilité du nœud | = 0 (non prêt) |
| CPU élevé du nœud | Utilisation CPU du nœud | > 90% |
| Mémoire élevée du nœud | Utilisation mémoire du nœud | > 85% |
| Inadéquation des répliques de déploiement | Répliques indisponibles | > 0 répliques |
| Échecs de job | Pods échoués dans un job | > 0 échecs |
| etcd sans leader | Leader du cluster etcd manquant | = 0 (pas de leader) |
| Limitation du serveur API | Requêtes API abandonnées | > 0 requêtes |
| File d'attente du scheduleur | Pods en attente dans le scheduleur | > 0 pods |
| Utilisation élevée du disque du nœud | Utilisation du système de fichiers du nœud | > 90% |
| DaemonSet indisponible | Nœuds mal planifiés | > 0 nœuds |

## Prérequis d'installation

Pour utiliser la surveillance Kubernetes, vous devez installer l'agent Kubernetes OneUptime dans votre cluster. L'agent envoie les métriques du cluster, les événements et les journaux des pods à OneUptime via OTLP.

Consultez le guide [Installer l'agent Kubernetes](/docs/monitor/kubernetes-agent) — il couvre l'installation Helm en une commande et l'option `preset` pour choisir la bonne configuration pour votre cluster (standard, GKE Autopilot, EKS Fargate).
