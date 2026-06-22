# Moniteur Kubernetes

La surveillance Kubernetes vous permet de surveiller la santé et les performances de vos clusters Kubernetes, y compris les nœuds, les pods, les charges de travail et les composants du plan de contrôle. OneUptime collecte les métriques de votre cluster et les évalue par rapport aux critères que vous avez configurés.

## Vue d'ensemble

Les moniteurs Kubernetes utilisent les métriques de votre cluster pour fournir une visibilité approfondie sur votre infrastructure. Cela vous permet de :

- Surveiller la santé du cluster, du namespace, de la charge de travail, du nœud et du pod
- Suivre l'utilisation du CPU, de la mémoire, du disque et du réseau à travers les ressources
- Détecter les crashs de pods, les redémarrages et les échecs de planification
- Surveiller la disponibilité des répliques de Deployment
- Alerter sur les problèmes du plan de contrôle (etcd, serveur d'API, scheduler)
- Suivre les requêtes et les limites de ressources

## Créer un moniteur Kubernetes

1. Allez dans **Monitors** dans le tableau de bord OneUptime
2. Cliquez sur **Create Monitor**
3. Sélectionnez **Kubernetes** comme type de moniteur
4. Sélectionnez le cluster et la portée des ressources à surveiller
5. Configurez les filtres de ressources et les requêtes de métriques
6. Configurez les critères de surveillance selon vos besoins

## Options de configuration

### Cluster

Sélectionnez le cluster Kubernetes à surveiller. Les clusters doivent être intégrés à OneUptime via OpenTelemetry.

### Portée des ressources

Choisissez le niveau auquel surveiller les ressources :

| Portée    | Description                                                                |
| --------- | -------------------------------------------------------------------------- |
| Cluster   | Surveille l'ensemble du cluster                                            |
| Namespace | Surveille les ressources au sein d'un namespace spécifique                 |
| Workload  | Surveille un Deployment, statefulset, daemonset, job ou cronjob spécifique |
| Nœud      | Surveille un nœud de cluster spécifique                                    |
| Pod       | Surveille un pod spécifique                                                |

### Filtres de ressources

Restreignez la portée avec des filtres optionnels :

| Filtre        | Description                                      | Portées applicables      |
| ------------- | ------------------------------------------------ | ------------------------ |
| Namespace     | Namespace Kubernetes                             | Namespace, Workload, Pod |
| Workload Type | deployment, statefulset, daemonset, job, cronjob | Workload                 |
| Workload Name | Nom de la charge de travail                      | Workload                 |
| Node Name     | Nom du nœud                                      | Nœud                     |
| Pod Name      | Nom du pod                                       | Pod                      |

### Requêtes de métriques

Configurez une ou plusieurs requêtes de métriques à évaluer. Chaque requête spécifie :

- **Nom de la métrique** — La métrique Kubernetes à interroger
- **Agrégation** — Comment agréger les valeurs de métrique
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

### Métriques des pods

| Métrique                     | Description                                            |
| ---------------------------- | ------------------------------------------------------ |
| Pod CPU Usage                | Consommation CPU par les pods                          |
| Pod Memory Usage             | Consommation mémoire par les pods                      |
| Pod Filesystem Usage         | Utilisation disque par les pods                        |
| Pod Network Receive/Transmit | Trafic réseau                                          |
| Pod Phase                    | Phase actuelle du pod (Running, Pending, Failed, etc.) |

### Métriques des nœuds

| Métrique              | Description                    |
| --------------------- | ------------------------------ |
| Node CPU Usage        | Utilisation CPU par nœud       |
| Node Memory Usage     | Utilisation mémoire par nœud   |
| Node Filesystem Usage | Utilisation disque par nœud    |
| Node Disk I/O         | Opérations de lecture/écriture |
| Node Ready Condition  | Si le nœud est prêt            |

### Métriques des conteneurs

| Métrique                      | Description                         |
| ----------------------------- | ----------------------------------- |
| Container Restarts            | Nombre de redémarrages de conteneur |
| Container CPU/Memory Limits   | Limites de ressources               |
| Container CPU/Memory Requests | Requêtes de ressources              |
| Container Ready Status        | Si les conteneurs sont prêts        |

### Métriques des charges de travail

| Métrique                                  | Description                |
| ----------------------------------------- | -------------------------- |
| Deployment Available/Unavailable Replicas | Nombre de répliques        |
| DaemonSet Misscheduled Nodes              | Problèmes de planification |
| StatefulSet Ready Replicas                | Nombre de répliques prêtes |
| Job Active/Failed/Succeeded Pods          | Statut des jobs            |

## Critères de surveillance

### Types de vérification disponibles

| Type de vérification | Description                                                     |
| -------------------- | --------------------------------------------------------------- |
| Metric Value         | La valeur de la requête de métrique ou de la formule configurée |

### Types d'agrégation

| Agrégation         | Description                                          |
| ------------------ | ---------------------------------------------------- |
| Moyenne            | Valeur moyenne sur la fenêtre temporelle             |
| Somme              | Somme de toutes les valeurs                          |
| Valeur maximale    | Valeur la plus élevée dans la fenêtre temporelle     |
| Valeur minimale    | Valeur la plus basse dans la fenêtre temporelle      |
| Toutes les valeurs | Toutes les valeurs doivent correspondre aux critères |
| Toute valeur       | Au moins une valeur doit correspondre                |

### Types de filtres

- **Supérieur à**, **Inférieur à**, **Supérieur ou égal à**, **Inférieur ou égal à**, **Égal à**, **Différent de**

## Modèles d'alertes préconfigurés

OneUptime fournit des modèles pour les scénarios de surveillance Kubernetes courants :

| Modèle                      | Description                                | Seuil               |
| --------------------------- | ------------------------------------------ | ------------------- |
| CrashLoopBackOff Detection  | Nombre de redémarrages de conteneur        | > 5 redémarrages    |
| Pod Stuck in Pending        | Pods en phase Pending                      | > 0 pods            |
| Node Not Ready              | Condition de disponibilité du nœud         | = 0 (non prêt)      |
| High Node CPU               | Utilisation CPU du nœud                    | > 90%               |
| High Node Memory            | Utilisation mémoire du nœud                | > 85%               |
| Deployment Replica Mismatch | Répliques indisponibles                    | > 0 répliques       |
| Job Failures                | Pods en échec dans un job                  | > 0 échecs          |
| etcd No Leader              | Leader du cluster etcd manquant            | = 0 (pas de leader) |
| API Server Throttling       | Requêtes d'API abandonnées                 | > 0 requêtes        |
| Scheduler Backlog           | Pods en attente dans le scheduler          | > 0 pods            |
| High Node Disk Usage        | Utilisation du système de fichiers du nœud | > 90%               |
| DaemonSet Unavailable       | Nœuds mal planifiés                        | > 0 nœuds           |

## Prérequis d'installation

Pour utiliser la surveillance Kubernetes, vous devez installer l'agent Kubernetes OneUptime dans votre cluster. L'agent expédie les métriques du cluster, les événements, les journaux de pods et — par défaut — les **traces d'applications et les métriques RED HTTP capturées via eBPF** à OneUptime via OTLP. Aucune modification de code ni SDK par application n'est requis pour voir le trafic au niveau du service.

Consultez le guide [Installer l'agent Kubernetes](/docs/monitor/kubernetes-agent) — il couvre l'installation Helm en une commande, l'option `preset` pour choisir la bonne configuration pour votre cluster (standard, GKE Autopilot, EKS Fargate) et les bascules `ebpf.features.*` pour les familles de signaux individuelles (métriques RED HTTP, graphe de services, flux réseau, statistiques TCP).
