# Dimensionnement et planification de la capacité

Ce guide vous aide à dimensionner un déploiement OneUptime auto-hébergé sur Kubernetes (Helm). Il couvre les trois magasins de données dont OneUptime dépend — **PostgreSQL**, **Redis** et **ClickHouse** — ainsi que la puissance de calcul de l'application, et propose des paliers de départ que vous pourrez ajuster une fois que vous disposerez de chiffres réels.

> **À lire en premier :** le chart Helm est livré avec **aucune requête ni limite de CPU/mémoire définie** et de petits volumes par défaut de **25 Gi** pour PostgreSQL et ClickHouse. Ces valeurs par défaut existent pour que le chart s'installe et fonctionne sur n'importe quel cluster — ce **n'est pas** un dimensionnement de production. Pour tout ce qui dépasse un essai rapide, définissez explicitement les ressources et le stockage à l'aide des chiffres ci-dessous.

Si vous exécutez plutôt l'installation Docker Compose sur un seul serveur, le dimensionnement est plus simple — voir [Docker Compose](/docs/installation/docker-compose) (recommandé : 16 GB RAM, 8 cœurs, 400 GB de disque).

## Ce qui détermine chaque magasin de données

OneUptime nécessite trois magasins de données en production. Ils évoluent selon des entrées complètement différentes, alors dimensionnez-les indépendamment.

| Magasin de données | Ce qu'il stocke                                                                                                                     | Ce qui détermine sa taille                                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **ClickHouse**     | Toute la télémétrie — logs, métriques, traces, exceptions, profils                                                                  | **Débit d'ingestion × rétention** de la télémétrie. Cela représente ~95 % de votre stockage et le coût dominant. |
| **PostgreSQL**     | Configuration et état — moniteurs, incidents, alertes, utilisateurs, équipes, projets, workflows, pages de statut, tableaux de bord | **Nombre d'entités et historique**, et non le volume de télémétrie. Croît lentement.                             |
| **Redis**          | Cache, files de travail et sessions                                                                                                 | **Profondeur des files et sessions actives**. Limité par la mémoire et modeste. Pas une source de vérité.        |

Le stockage objet (S3/MinIO) **n'est pas** requis pour faire fonctionner OneUptime. Il n'est utilisé que de manière optionnelle pour les **sauvegardes** de base de données (via le plugin Barman de CloudNativePG pour PostgreSQL, ou `clickhouse-backup` pour ClickHouse). OneUptime ne hiérarchise pas la télémétrie vers le stockage objet — voir la section « Rétention et son impact sur le stockage » ci-dessous.

## ClickHouse — le facteur dominant

La quasi-totalité de votre stockage et une grande part de votre RAM iront à ClickHouse, car chaque ligne de log, chaque point de métrique, chaque span de trace et chaque exception y résident.

### Formule de stockage

```
ClickHouse disk ≈ (daily raw telemetry GB ÷ compression) × retention days × replicas × 1.3 (headroom)
```

La compression dépend du signal :

- **Les logs** se compriment bien — environ **5:1**.
- **Les métriques** se compriment moins — environ **2:1** — et une **cardinalité** élevée des étiquettes gonfle le disque et la RAM plus vite que le volume brut. Gardez les étiquettes à faible cardinalité.
- **Les traces** se situent entre les deux, selon les attributs des spans.

### Exemple chiffré

Un parc de **10 clusters**, chacun ~10 nœuds / ~100 pods à un niveau de verbosité INFO, produit environ **50–150 GB de logs bruts par cluster sur 30 jours** (≈ 1.7–5 GB/day par cluster). Sur l'ensemble du parc, en ajoutant les métriques et les traces et après compression, prévoyez environ **5–15 GB/day de télémétrie compressée**.

| Rétention | Réplica unique | 2 réplicas + 30 % de marge |
| --------- | -------------- | -------------------------- |
| 30 days   | ~150–450 GB    | **~0.4–1.2 TB**            |
| 90 days   | ~0.45–1.35 TB  | **~1.2–3.5 TB**            |

Le stockage évolue **linéairement avec la rétention** — une fenêtre de 90 jours coûte ~3× une fenêtre de 30 jours.

### RAM et type de disque

- **Utilisez du NVMe/SSD.** La télémétrie est intensive en écriture avec des lectures d'agrégation en rafales ; ClickHouse sur disque mécanique aura du mal.
- **Donnez à ClickHouse une RAM généreuse.** Les requêtes d'agrégation sont gourmandes en mémoire. En règle générale, dimensionnez la RAM à une fraction significative (25–50 %) de votre jeu de données compressé _chaud_ (récemment interrogé), avec un plancher pratique de 16 GB pour tout parc de production réel.
- **Surveillez la cardinalité des métriques.** C'est le levier le plus important à la fois sur la RAM et le disque de ClickHouse. Imposez des conventions d'étiquettes à faible cardinalité à la couche de collecte et surveillez le nombre de séries actives.

## PostgreSQL — configuration et état

PostgreSQL stocke votre configuration et votre état opérationnel, et non la télémétrie, donc il croît lentement et reste petit par rapport à ClickHouse. Même les grands déploiements se situent généralement dans la dizaine de GB. Le volume par défaut de **25 Gi** convient aux petites installations ; prévoyez 50–100 GB pour les plus grandes avec une marge pour l'historique des incidents/alertes.

Si vous exécutez de nombreux réplicas d'application, de worker et de sonde, le nombre de connexions à la base de données peut devenir le goulot d'étranglement avant le stockage. Le chart Helm de OneUptime inclut un pooler de connexions **PgBouncer** optionnel (`pgbouncer.enabled`) exactement pour cela — activez-le pour les déploiements à fort nombre de réplicas.

## Redis — cache, files et sessions

Redis est utilisé comme cache, file de travail et magasin de sessions. Il est **limité par la mémoire** et la persistance est **désactivée par défaut** (Redis ici n'est pas une source de vérité — il peut être reconstruit). Dimensionnez-le selon la profondeur de file attendue et les sessions concurrentes ; 2–8 GB de mémoire couvrent la plupart des déploiements. Notez que la politique d'éviction par défaut est `noeviction`, donc si les files s'accumulent sous une surcharge soutenue, surveillez la mémoire de Redis.

## Puissance de calcul de l'application

Au-delà des magasins de données, dimensionnez les charges de travail sans état (ingress, web/API, workers et sondes). Toutes utilisent par défaut **1 réplica** sans limites de ressources — définissez-les explicitement. Le chart embarque **KEDA** afin que les workers et les sondes puissent s'autoscaler selon la profondeur des files ; activez-le pour les charges variables. Les workers évoluent avec le volume de traitement de télémétrie/ingestion, et les sondes évoluent avec le nombre de moniteurs actifs.

## Paliers de départ

Choisissez le palier le plus proche de votre environnement comme point de départ, puis surveillez l'utilisation réelle (`kubectl top pods`, croissance disque de ClickHouse/Postgres) et ajustez.

- **Petit / PoC** — 1–3 clusters, ≤30 nœuds, ≤5 GB/day de télémétrie brute, rétention de 30 jours.
- **Moyen / Parc de production** — ~10 clusters, ~100 nœuds, 10–30 GB/day de télémétrie brute, rétention de 30–90 jours.
- **Grand / Multi-parcs** — 50+ clusters, 500+ nœuds, 100+ GB/day de télémétrie brute, rétention de 90 jours.

|                        | Petit / PoC                  | Moyen / Parc de production   | Grand / Multi-parcs                             |
| ---------------------- | ---------------------------- | ---------------------------- | ----------------------------------------------- |
| **ClickHouse**         | 4 vCPU / 16 GB / 200 GB NVMe | 8 vCPU / 32 GB / 1–3 TB NVMe | 16+ vCPU / 64–128 GB / 5–15 TB NVMe, **shardé** |
| **PostgreSQL**         | 2 vCPU / 4 GB / 50 GB SSD    | 4 vCPU / 8 GB / 100 GB SSD   | 8 vCPU / 16–32 GB / 250 GB SSD (+ PgBouncer)    |
| **Redis**              | 1 vCPU / 2 GB                | 2 vCPU / 4 GB                | 4 vCPU / 8–16 GB                                |
| **Rétention supposée** | 30 days                      | 30–90 days                   | 90 days                                         |

Ces valeurs dimensionnent le **backend** de OneUptime. Les collecteurs OneUptime qui s'exécutent sur chaque cluster surveillé sont dimensionnés séparément — voir les paliers de dimensionnement de l'[Agent Kubernetes](/docs/telemetry/kubernetes-agent).

## Haute disponibilité

Les magasins de données intégrés au chart s'exécutent en **instances uniques** par défaut. Pour une HA en production :

- **PostgreSQL** — activez l'opérateur [CloudNativePG](https://cloudnative-pg.io) embarqué (`postgresOperator.cnpg.enabled`) avec **3 instances** (1 primaire + 2 standbys à chaud) pour un basculement automatique.
- **ClickHouse** — activez l'opérateur [Altinity](https://github.com/Altinity/clickhouse-operator) embarqué (`clickhouseOperator.altinity.enabled`) avec **≥2 réplicas par shard** et **3 nœuds ClickHouse Keeper** pour le quorum. Ajoutez des shards une fois que le disque ou la RAM d'un seul nœud devient la limite.
- **Redis** — le chart n'a pas de réplication intégrée. Pour la HA, pointez OneUptime vers un **Redis managé externe** (ou un déploiement Sentinel/cluster).

## Rétention et son impact sur le stockage

La rétention de la télémétrie est appliquée sous forme de **TTL ClickHouse configuré en jours**, défini **par projet** et affinable **par signal** (logs, métriques, traces, profils) et par bucket (par exemple par gravité de log). La valeur par défaut codée en dur est de 15 jours.

Comme la rétention multiplie directement le stockage de ClickHouse, décidez-la avant de dimensionner le disque. OneUptime n'archive ni ne hiérarchise **pas** automatiquement l'ancienne télémétrie vers le stockage objet — pour une rétention de conformité sur plusieurs années, étendez la fenêtre de rétention et dimensionnez le stockage de ClickHouse en conséquence (ou exportez vers une archive externe de votre choix).

## Mesurez avant de vous engager

Le volume de télémétrie varie énormément selon la verbosité des logs de l'application, le nombre de namespaces, l'intervalle de scrape, et selon que la journalisation DEBUG est activée quelque part. Traitez les paliers ci-dessus comme des points de départ : **instrumentez votre environnement pendant au moins quatre semaines**, mesurez les GB/day réels par signal, puis dimensionnez la rétention et le stockage à partir de données réelles.

## Pour aller plus loin

- [Docker Compose](/docs/installation/docker-compose) — dimensionnement sur un seul serveur
- [Architecture auto-hébergée](/docs/self-hosted/architecture) — comment les composants s'imbriquent
- [Agent Kubernetes](/docs/telemetry/kubernetes-agent) — dimensionnement du collecteur (plan de données)
- [Chart Helm sur Artifact Hub](https://artifacthub.io/packages/helm/oneuptime/oneuptime)
