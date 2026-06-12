# Mise à niveau de OneUptime

Ce guide explique comment mettre à niveau en toute sécurité votre installation auto-hébergée de OneUptime.

## Conseils généraux

- Mettez à niveau étape par étape pour les versions majeures (par exemple, 6 → 7 → 8). Ne sautez pas les versions majeures.
- Vous pouvez passer directement d'une version mineure/corrective à une autre (par exemple, 8.1 → 8.4) tant que vous suivez les notes de version.
- Effectuez toujours des sauvegardes avant la mise à niveau et vérifiez que vous pouvez les restaurer.

## Mise à niveau de OneUptime 10 → 11

OneUptime 11 reconstruit le stockage de télémétrie ClickHouse. Cette page explique
ce qui change, qui doit agir et — pour les installations qui souhaitent conserver
leur historique de télémétrie — chaque requête nécessaire pour y parvenir.

### Ce qui change dans la v11

La télémétrie (journaux, traces, métriques, exceptions, profils, journaux de
moniteurs, journaux d'audit) est déplacée vers de nouvelles tables ClickHouse
avec un partitionnement temporel, des codecs de compression par colonne et les
nouvelles colonnes du modèle d'entités :

| Ancienne table        | Nouvelle table        |
| --------------------- | --------------------- |
| `LogItemV2`           | `LogItemV3`           |
| `MetricItemV2`        | `MetricItemV3`        |
| `SpanItemV2`          | `SpanItemV3`          |
| `ExceptionItemV2`     | `ExceptionItemV3`     |
| `ProfileItemV2`       | `ProfileItemV3`       |
| `ProfileSampleItemV2` | `ProfileSampleItemV3` |
| `MonitorLogV2`        | `MonitorLogV3`        |
| `AuditLogV1`          | `AuditLogV2`          |

Deux colonnes sont renommées sur chaque table de télémétrie : `serviceId` →
`primaryEntityId` et `serviceType` → `primaryEntityType`. Il s'agit d'un
renommage strict — **si vous interrogez directement l'API d'analytique de
OneUptime avec des filtres `serviceId`/`serviceType`, mettez-les à jour avec
les nouveaux noms.** Les tableaux de bord, les moniteurs et les alertes au
sein de OneUptime sont migrés automatiquement.

La bascule est **uniquement vers l'avant** : les nouvelles tables démarrent
vides, toute la télémétrie ingérée après la mise à niveau y atterrit
immédiatement, et l'historique se reconstitue naturellement au fil du temps.
Les anciennes tables sont **supprimées automatiquement** pendant la mise à
niveau afin de récupérer leur espace disque — si vous voulez garder la
possibilité de conserver l'historique, renommez-les **avant** la mise à
niveau (étape 0 ci-dessous).

> **Déjà en 11.0.0 ou 11.0.1 ?** Ces versions conservaient les anciennes
> tables (elles se vidaient via le TTL, et la copie pouvait être exécutée
> « à n'importe quel moment après la mise à niveau »). Toute mise à jour
> ultérieure **les supprime au démarrage**. Si vous souhaitez encore copier
> l'historique et ne l'avez pas encore fait, exécutez l'étape 0 ci-dessous
> avant d'appliquer la mise à jour.

### Qui doit agir

- **Nouvelles installations :** rien à faire.
- **Mises à niveau qui n'ont pas besoin de la télémétrie antérieure à la mise
  à niveau dans l'interface :** rien à faire. Les pages de télémétrie
  affichent simplement les données à partir du moment de la mise à niveau ;
  les anciennes tables sont supprimées pendant la mise à niveau.
- **Mises à niveau qui souhaitent rendre visible la télémétrie antérieure à la
  mise à niveau :** renommez les anciennes tables **avant** la mise à niveau
  (étape 0 ci-dessous), puis exécutez la copie manuelle à n'importe quel
  moment après celle-ci.

Comme toujours : mettez à niveau les versions majeures étape par étape
(10 → 11, sans sauter de version) et effectuez des sauvegardes de Postgres et
de ClickHouse avant la mise à niveau.

### Optionnel : conserver l'historique de télémétrie

L'étape 0 s'exécute **avant la mise à niveau** ; tout ce qui suit à partir de
l'étape 1 s'exécute **après le démarrage complet de la mise à niveau** (les
nouvelles tables et leurs vues matérialisées doivent exister). Connectez-vous
directement sur votre hôte ClickHouse — le protocole natif n'a pas de délais
d'expiration HTTP, donc des instructions de plusieurs heures ne posent aucun
problème :

```bash
clickhouse-client --database oneuptime
```

Bon à savoir avant de commencer :

- La copie peut être exécutée en toute sécurité pendant que OneUptime est en
  service. La nouvelle télémétrie s'écrit dans les nouvelles tables de manière
  indépendante ; l'historique copié se remplit en arrière-plan.
- Prévoyez plusieurs heures à grande échelle (centaines de Go).
- Chaque instruction ci-dessous porte un `insert_deduplication_token`, et les
  nouvelles tables sont livrées avec une fenêtre de déduplication — donc
  **réexécuter une instruction qui a échoué en cours de route est sans
  danger** (les blocs déjà insérés sont ignorés, y compris dans les agrégats
  de métriques), à condition de la réexécuter assez rapidement. Sous une forte
  ingestion en direct, la fenêtre (les 10 000 derniers blocs d'insertion par
  table) finit par évincer les anciens jetons.
- La copie des métriques reconstruit aussi automatiquement les agrégats
  pré-calculés des tableaux de bord (chaque ligne copiée réalimente les vues
  matérialisées d'agrégation) — cela rend la copie des métriques plus lente
  que les autres ; exécutez-la en dernier.

#### Étape 0 — avant la mise à niveau, renommer les anciennes tables

La mise à niveau supprime les anciennes tables au démarrage ; mettez donc
d'abord hors de sa portée celles depuis lesquelles vous voulez copier.
Arrêtez OneUptime (réduisez le déploiement à zéro) afin que rien n'y écrive
ni ne puisse les recréer, puis renommez-les — `RENAME TABLE` est une
opération de métadonnées instantanée, et `IF EXISTS` permet au lot d'ignorer
les tables que votre installation n'a jamais eues (les déploiements
antérieurs à la mi-10.0.x peuvent ne pas avoir `AuditLogV1` ou certaines
tables `…V2` du tout — il n'y a alors pas d'historique de ce type à copier) :

```sql
RENAME TABLE IF EXISTS LogItemV2 TO LogItemV2_backup;
RENAME TABLE IF EXISTS MetricItemV2 TO MetricItemV2_backup;
RENAME TABLE IF EXISTS SpanItemV2 TO SpanItemV2_backup;
RENAME TABLE IF EXISTS ExceptionItemV2 TO ExceptionItemV2_backup;
RENAME TABLE IF EXISTS ProfileItemV2 TO ProfileItemV2_backup;
RENAME TABLE IF EXISTS ProfileSampleItemV2 TO ProfileSampleItemV2_backup;
RENAME TABLE IF EXISTS MonitorLogV2 TO MonitorLogV2_backup;
RENAME TABLE IF EXISTS AuditLogV1 TO AuditLogV1_backup;
RENAME TABLE IF EXISTS MetricItemAggMV1mByHost TO MetricItemAggMV1mByHost_backup;
```

Ensuite, mettez à niveau et laissez OneUptime démarrer complètement avant de
continuer.

> Si vous revenez à la v10 après le renommage (la v10 recrée au démarrage des
> tables vides portant les anciens noms), renommez les tables `_backup` vers
> leurs noms d'origine avant de redémarrer la v10 — sinon la télémétrie
> ingérée pendant le retour en arrière atterrit dans les tables recréées et
> sera supprimée lors de la mise à niveau finale.

#### Étape 1 — lister les partitions sources

Chaque ancienne table compte au plus 16 partitions. Pour chaque table source :

```sql
SELECT DISTINCT _partition_id FROM LogItemV2_backup ORDER BY _partition_id;
```

#### Étape 2 — générer l'instruction de copie

Les jeux de colonnes peuvent différer légèrement d'une installation à l'autre
(les déploiements plus anciens peuvent ne pas avoir les colonnes ajoutées
récemment) ; générez donc l'instruction à partir de votre schéma réel plutôt
que de copier-coller une instruction figée. Définissez `src` et `dst` dans la
clause `WITH` avec l'une des paires de tables du tableau ci-dessus, puis
exécutez :

```sql
WITH 'LogItemV2' AS src, 'LogItemV3' AS dst
SELECT concat(
  'INSERT INTO ', dst, ' (`', arrayStringConcat(groupArray(name), '`, `'), '`)',
  ' SELECT ', arrayStringConcat(groupArray(selectExpr), ', '),
  ' FROM ', src,
  ' WHERE _partition_id = ''{PARTITION}''',
  ' ORDER BY ', (SELECT sorting_key FROM system.tables WHERE database = currentDatabase() AND name = dst), ', _id',
  ' SETTINGS max_execution_time = 0, max_partitions_per_insert_block = 0, insert_deduplication_token = ''v3copy:', dst, ':{PARTITION}'', deduplicate_blocks_in_dependent_materialized_views = 1'
) AS copy_sql
FROM (
  SELECT name,
    multiIf(name = 'primaryEntityId', 'serviceId', name = 'primaryEntityType', 'serviceType', name) AS srcName,
    if(srcName = name, concat('`', name, '`'), concat('`', srcName, '` AS `', name, '`')) AS selectExpr,
    position
  FROM system.columns
  WHERE database = currentDatabase() AND table = dst
    AND srcName IN (SELECT name FROM system.columns WHERE database = currentDatabase() AND table = src)
  ORDER BY position
);
```

L'instruction générée copie uniquement les colonnes communes aux deux tables
(les nouvelles colonnes prennent leurs valeurs par défaut), renomme
`serviceId`/`serviceType` à la volée, ordonne les lignes de manière
déterministe afin qu'une nouvelle tentative produise des blocs identiques et
dédupliquables, et lève les limites de temps d'exécution et de nombre de
partitions qu'une instruction de cette taille nécessite.

#### Étape 3 — exécuter, une partition à la fois

Prenez l'instruction générée et remplacez `{PARTITION}` (il apparaît deux
fois — dans le `WHERE` et dans le jeton) par chaque identifiant de partition
de l'étape 1. Exécutez les instructions une par une, puis répétez les
étapes 1 à 3 pour chaque paire de tables.

Si une instruction échoue en cours de route, réexécutez rapidement la
**même** instruction — les blocs déjà validés sont dédupliqués. Si la
réexécution intervient beaucoup plus tard, comparez d'abord les nombres de
lignes (étape 5).

#### Étape 4 (optionnelle) — historique des agrégats de métriques par hôte

Les lignes brutes de métriques copiées reconstruisent automatiquement les
agrégats au niveau service, mais pas l'agrégat **par hôte** (les anciennes
lignes n'ont pas de clé d'entité hôte). La mise à niveau laisse
volontairement l'ancienne table d'agrégats par hôte en place afin que vous
puissiez la reprendre, en calculant la nouvelle clé à partir du nom d'hôte :

```sql
INSERT INTO MetricItemAggMV1mByHostV2 (projectId, name, hostEntityKey, bucketTime, valueSumState, valueCountState, valueMinState, valueMaxState, retentionDate)
SELECT
  projectId,
  name,
  substring(lower(hex(SHA256(concat(projectId, '|host|host.name=', lower(trimBoth(hostIdentifier)))))), 1, 16) AS hostEntityKey,
  bucketTime,
  valueSumState,
  valueCountState,
  valueMinState,
  valueMaxState,
  retentionDate
FROM MetricItemAggMV1mByHost
SETTINGS max_execution_time = 0, insert_deduplication_token = 'v3copy:MetricItemAggMV1mByHostV2:all';
```

#### Étape 5 — vérifier

Comparez les totaux pour chaque paire de tables (la nouvelle table contient
aussi les lignes postérieures à la mise à niveau, elle doit donc être
supérieure ou égale à l'ancienne) :

```sql
SELECT
  (SELECT count() FROM LogItemV2) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### Étape 6 (optionnelle) — récupérer l'espace disque plus tôt

Les anciennes tables se vident d'elles-mêmes via le TTL, mais une fois que
vous êtes satisfait de la copie, vous pouvez les supprimer immédiatement :

```sql
DROP TABLE IF EXISTS LogItemV2;
DROP TABLE IF EXISTS MetricItemV2;
DROP TABLE IF EXISTS SpanItemV2;
DROP TABLE IF EXISTS ExceptionItemV2;
DROP TABLE IF EXISTS ProfileItemV2;
DROP TABLE IF EXISTS ProfileSampleItemV2;
DROP TABLE IF EXISTS MonitorLogV2;
DROP TABLE IF EXISTS AuditLogV1;
DROP TABLE IF EXISTS MetricItemAggMV1mByHost;
```

> Conseil : comme pour toute mise à niveau majeure, testez d'abord dans un
> environnement de staging et confirmez que la télémétrie arrive bien dans
> les nouvelles tables avant de vous fier à la copie en production.



## Mise à niveau de OneUptime 9 → 10

Aucun changement nécessitant une action manuelle. Suivez simplement le processus de mise à niveau standard.

## Mise à niveau de OneUptime 8 → 9

Le chart Helm ne provisionne plus de ressource Kubernetes Ingress. OneUptime inclut un conteneur de passerelle d'entrée qui termine déjà le TLS, gère les domaines des pages de statut et achemine le trafic pour la plateforme, de sorte qu'un contrôleur d'entrée de cluster n'est plus nécessaire.

- Supprimez les remplacements `oneuptimeIngress` de vos fichiers `values.yaml` personnalisés avant la mise à niveau. Ces clés sont désormais ignorées et provoqueront des erreurs de validation si elles sont laissées en place.
- Assurez-vous que `nginx.service.type` reflète la façon dont vous souhaitez exposer la passerelle d'entrée intégrée (par exemple `LoadBalancer`, `NodePort` ou `ClusterIP` avec un équilibreur de charge externe).
- Vérifiez que les enregistrements DNS pour les pages de statut ou les hôtes primaires pointent toujours vers le Service ou l'équilibreur de charge qui protège la passerelle d'entrée OneUptime.
- Après la mise à niveau, confirmez que les certificats TLS continuent d'être renouvelés via la passerelle intégrée et que les domaines des pages de statut se résolvent correctement.


## Mise à niveau de OneUptime 7 → 8

Si vous exécutez sur Kubernetes, il y a des changements importants avec rupture de compatibilité :

- Nous n'utilisons plus les charts Bitnami pour Postgres, Redis et ClickHouse en raison des [changements de licence Bitnami](https://github.com/bitnami/charts/issues/35164)
- Ces changements ne sont pas rétrocompatibles. Vous devez suivre la nouvelle structure dans le fichier `values.yaml` du chart Helm.
- Sauvegardez vos données (Postgres, ClickHouse et tout volume persistant) avant la mise à niveau.


> Conseil : Testez d'abord la mise à niveau dans un environnement de staging. Vérifiez que vos charges de travail sont saines et que les données sont intactes avant de mettre à niveau la production.
