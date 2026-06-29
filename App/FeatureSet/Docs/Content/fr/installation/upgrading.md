# Mise à niveau de OneUptime

Ce guide explique comment mettre à niveau en toute sécurité votre installation auto-hébergée de OneUptime.

## Conseils généraux

- Mettez à niveau étape par étape pour les versions majeures (par exemple, 6 → 7 → 8). Ne sautez pas les versions majeures.
- Vous pouvez passer directement d'une version mineure/corrective à une autre (par exemple, 8.1 → 8.4) tant que vous suivez les notes de version.
- Effectuez toujours des sauvegardes avant la mise à niveau et vérifiez que vous pouvez les restaurer.

## Mise à niveau de OneUptime 10 → 11

<!-- TODO(i18n): Translate this section. English source: en/installation/upgrading.md (added for v11 SSO->Enterprise change). -->

### Identity features (SSO, OIDC, SCIM) now require the Enterprise Edition

In v11, the following authentication and access-management features moved to
the **OneUptime Enterprise Edition** and are no longer part of the free,
open-source (Community) build:

- **SAML SSO** — both project login and status-page login
- **OpenID Connect (OIDC)** — both project login and status-page login
- **SCIM user provisioning** — project and status page
- **Global (instance-wide) SSO / OIDC**
- **Team compliance settings**

**What you'll see after upgrading:** if you configured any of these on a
Community Edition build, sign-in through them is disabled after the upgrade,
and the settings pages show an upgrade prompt instead of the configuration
form. Your existing provider records are **preserved in the database** —
nothing is deleted — they simply become inactive until the instance runs the
Enterprise Edition.

**Availability:**

- **Self-hosted:** requires the **Enterprise Edition** build.
- **OneUptime Cloud:** requires the **Scale** plan (or above).

**If you rely on SSO and self-host**, email
[support@oneuptime.com](mailto:support@oneuptime.com) for an Enterprise Edition
license so you can restore SSO/OIDC/SCIM. Mention that you upgraded from v10 to
v11 and we'll help you get it back online. If your team is mid-upgrade and this
is blocking sign-in, contact us before upgrading production so we can plan it
with you.

OneUptime 11 reconstruit le stockage de télémétrie ClickHouse. Cette page explique ce qui change, qui doit agir et — pour les installations qui souhaitent conserver la télémétrie historique — chaque requête nécessaire pour le faire.

### Ce qui change dans la v11

La télémétrie (logs, traces, métriques, exceptions, profils, logs de monitors, logs d'audit) est déplacée vers de nouvelles tables ClickHouse avec un partitionnement temporel, des codecs de compression par colonne et les nouvelles colonnes du modèle d'entités :

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

Deux colonnes sont renommées dans chaque table de télémétrie : `serviceId` → `primaryEntityId` et `serviceType` → `primaryEntityType`. C'est un renommage strict — **si vous interrogez directement l'API analytics de OneUptime avec des filtres `serviceId`/`serviceType`, mettez-les à jour vers les nouveaux noms.** Les tableaux de bord, monitors et alertes au sein de OneUptime sont migrés automatiquement.

La bascule est **uniquement vers l'avant** : les nouvelles tables démarrent vides, toute la télémétrie ingérée après la mise à niveau y atterrit immédiatement, et l'historique se reconstitue naturellement avec le temps. Les anciennes tables sont **supprimées automatiquement** pendant la mise à niveau afin de récupérer leur espace disque — si vous voulez garder la possibilité de reprendre l'historique, renommez-les **avant** la mise à niveau (étape 0 ci-dessous).

> **Déjà en 11.0.0 ou 11.0.1 ?** Ces versions conservaient les anciennes tables (elles se vidaient via la TTL, et la copie pouvait être lancée « à tout moment après la mise à niveau »). Toute mise à jour ultérieure **les supprime au démarrage**. Si vous souhaitez encore effectuer la copie de l'historique et ne l'avez pas encore faite, exécutez l'étape 0 ci-dessous avant d'appliquer la mise à jour.

### Qui doit agir

- **Nouvelles installations :** rien à faire.
- **Mises à niveau qui n'ont pas besoin de la télémétrie antérieure dans l'interface :** rien à faire. Les pages de télémétrie affichent simplement les données à partir du moment de la mise à niveau ; les anciennes tables sont supprimées pendant la mise à niveau.
- **Mises à niveau qui veulent voir la télémétrie antérieure :** renommez les anciennes tables **avant** la mise à niveau (étape 0 ci-dessous), puis lancez la copie manuelle à tout moment après celle-ci.

Comme toujours : montez les versions majeures une par une (10 → 11, sans en sauter) et faites des sauvegardes de Postgres et de ClickHouse avant la mise à niveau.

### Optionnel : reprendre l'historique de télémétrie

L'étape 0 s'exécute **avant la mise à niveau** ; tout ce qui suit à partir de l'étape 1 s'exécute **après que la mise à niveau a complètement démarré** (les nouvelles tables et leurs vues matérialisées doivent exister). Connectez-vous directement sur votre hôte ClickHouse — le protocole natif n'a pas de timeouts HTTP, donc des requêtes de plusieurs heures ne posent pas de problème :

```bash
clickhouse-client --database oneuptime
```

Bon à savoir avant de commencer :

- La copie peut être lancée en toute sécurité pendant que OneUptime est en production. La nouvelle télémétrie s'écrit indépendamment dans les nouvelles tables ; l'historique copié se remplit derrière.
- Comptez plusieurs heures à grande échelle (centaines de Go).
- Chaque requête ci-dessous porte un `insert_deduplication_token`, et les nouvelles tables sont livrées avec une fenêtre de déduplication — **relancer une requête qui a échoué en cours de route est donc sûr** (les blocs déjà insérés sont ignorés, y compris dans les rollups de métriques), à condition de la relancer rapidement. Sous forte ingestion en continu, la fenêtre (les 10 000 derniers blocs d'insertion par table) finit par évincer les anciens tokens.
- La copie des métriques reconstruit aussi automatiquement les rollups pré-agrégés des tableaux de bord (chaque ligne copiée réalimente les vues matérialisées de rollup) — la copie des métriques est donc plus lente que les autres ; lancez-la en dernier.

#### Étape 0 — avant la mise à niveau, renommer les anciennes tables

La mise à niveau supprime les anciennes tables au démarrage : mettez d'abord hors de sa portée celles depuis lesquelles vous voulez copier. Arrêtez OneUptime (réduisez le déploiement à zéro) pour que plus rien n'y écrive ni ne puisse les recréer, puis renommez — `RENAME TABLE` est une opération de métadonnées instantanée, et `IF EXISTS` permet au bloc d'ignorer les tables que votre installation n'a jamais eues (les déploiements antérieurs à la mi-10.0.x peuvent ne pas avoir `AuditLogV1` ou certaines tables `…V2` — il n'y a alors pas d'historique de ce type à copier) :

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

Effectuez ensuite la mise à niveau et laissez OneUptime démarrer complètement avant de continuer.

> Si vous revenez à la v10 après le renommage (la v10 recrée au démarrage des tables vides avec les anciens noms), renommez les tables `_backup` vers leurs noms d'origine avant de redémarrer la v10 — sinon la télémétrie ingérée pendant le retour arrière atterrit dans les tables recréées et sera supprimée lors de la future mise à niveau.

#### Étape 1 — lister les partitions sources

Chaque ancienne table compte au plus 16 partitions. Pour chaque table source :

```sql
SELECT DISTINCT _partition_id FROM LogItemV2_backup ORDER BY _partition_id;
```

#### Étape 2 — générer la requête de copie

Les jeux de colonnes peuvent légèrement différer entre installations (les déploiements plus anciens peuvent ne pas avoir les colonnes ajoutées récemment) : générez donc la requête depuis votre schéma réel plutôt que de copier-coller une requête figée. Renseignez `src` et `dst` dans la clause `WITH` avec l'une des paires de tables du tableau ci-dessus (la source porte le suffixe `_backup` de l'étape 0), puis exécutez :

```sql
WITH 'LogItemV2_backup' AS src, 'LogItemV3' AS dst
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

La requête générée ne copie que les colonnes communes aux deux tables (les nouvelles colonnes prennent leurs valeurs par défaut), renomme `serviceId`/`serviceType` à la volée, ordonne les lignes de manière déterministe pour qu'une relance produise des blocs identiques et dédupliquables, et lève les limites de temps d'exécution et de nombre de partitions dont une requête de cette taille a besoin.

#### Étape 3 — exécuter, une partition à la fois

Prenez la requête générée et remplacez `{PARTITION}` (présent deux fois — dans le `WHERE` et dans le token) par chaque identifiant de partition de l'étape 1. Exécutez les requêtes une par une, puis répétez les étapes 1 à 3 pour chaque paire de tables.

> Remarque : si une table source a été ignorée à l'étape 0 parce qu'elle n'existait pas sur votre installation, l'étape 1 échoue avec `UNKNOWN_TABLE` pour cette paire — ignorez simplement la paire ; il n'y a pas d'historique de ce type à copier.

Si une requête échoue en cours de route, relancez rapidement **la même** requête — les blocs déjà validés sont dédupliqués. Si la relance intervient bien plus tard, comparez d'abord les nombres de lignes (étape 5).

#### Étape 4 (optionnelle) — historique du rollup de métriques par hôte

Les lignes de métriques brutes copiées reconstruisent automatiquement les rollups au niveau service, mais pas le rollup **par hôte** (les anciennes lignes n'ont pas de clé d'entité hôte). L'ancienne table de rollup renommée à l'étape 0 est la seule source pour cet historique ; reprenez-le en calculant la nouvelle clé à partir du nom d'hôte :

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
FROM MetricItemAggMV1mByHost_backup
ORDER BY projectId, name, hostIdentifier, bucketTime, _id
SETTINGS max_execution_time = 0, insert_deduplication_token = 'v3copy:MetricItemAggMV1mByHostV2:all';
```

Le `ORDER BY` est important : il fait qu'une relance produit des blocs d'insertion identiques que le token de déduplication peut reconnaître. Sans lui, une relance pourrait être silencieusement ignorée ou comptée deux fois. (Cas limite : des noms d'hôte contenant `\`, `|` ou `=` — caractères non autorisés par la RFC 1123 — calculeraient une clé différente de celle de l'application ; ignorez ce point sauf si vous savez que vous avez de tels hôtes.)

#### Étape 5 — vérifier

Comparez les totaux par paire de tables (la nouvelle table contient aussi les lignes postérieures à la mise à niveau, elle doit donc être supérieure ou égale à l'ancienne) :

```sql
SELECT
  (SELECT count() FROM LogItemV2_backup) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### Étape 6 — supprimer les sauvegardes

Les tables renommées conservent leur TTL de rétention : elles se vident et rétrécissent donc d'elles-mêmes — mais une fois satisfait de la copie, supprimez-les pour récupérer l'espace disque immédiatement :

```sql
DROP TABLE IF EXISTS LogItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MetricItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS SpanItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ExceptionItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ProfileItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ProfileSampleItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MonitorLogV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS AuditLogV1_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MetricItemAggMV1mByHost_backup SETTINGS max_table_size_to_drop = 0;
```

(`max_table_size_to_drop = 0` lève la protection de suppression de 50 Go du serveur pour cette seule requête.)

> Astuce : comme pour toute mise à niveau majeure, testez d'abord dans un environnement de staging et confirmez que la télémétrie arrive bien dans les nouvelles tables avant de vous appuyer sur la copie en production.

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
