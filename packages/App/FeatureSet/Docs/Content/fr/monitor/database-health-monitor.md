# Surveillance de la santé des bases de données

Le moniteur de santé de base de données se connecte à PostgreSQL, MySQL ou Microsoft SQL Server selon un calendrier et remonte les signaux de santé du serveur lui-même — marge de connexions, sessions bloquées, retard de réplication, taux de succès du cache, taille de la base, rebouclage des identifiants de transaction et une trentaine d'autres — pour que vous puissiez alerter dessus comme vous alertez sur un site web en panne.

Vous n'écrivez pas de SQL. La sonde exécute un ensemble fixe de requêtes de catalogue en lecture seule, choisi selon le moteur, et remonte un petit ensemble de nombres nommés.

:::cards
- [Créer un utilisateur de surveillance](#créer-un-utilisateur-de-surveillance): Les droits dont chaque moteur a besoin. C'est l'étape qui compte le plus.
- [Créer le moniteur](#créer-un-moniteur-de-santé-de-base-de-données): Diriger une sonde vers la base et choisir ce qu'elle collecte.
- [Métriques collectées](#métriques-collectées): Chaque série, avec les moteurs qui la remontent.
- [Configurer les critères](#configurer-les-critères): Alerter sur les connexions, les blocages, le retard et le rebouclage.
:::

## Santé de la base de données ou requête SQL ?

Les deux types de moniteurs de base de données répondent à des questions différentes et sont faits pour être utilisés ensemble.

| | Santé de la base de données | [Requête SQL](/docs/monitor/sql-monitor) |
|---|---|---|
| Question posée | « La base de données elle-même est-elle en bonne santé ? » | « Mes données sont-elles celles que j'attends ? » |
| Requête | Intégrée, propre à chaque moteur, en lecture seule | La vôtre |
| Remonte | Des métriques numériques nommées (voir [Métriques collectées](#métriques-collectées)) | Nombre de lignes, valeur scalaire, première ligne, temps d'exécution |
| Alerte typique | Connexions utilisées au-dessus de 90 % | Plus de 50 commandes annulées au cours des cinq dernières minutes |
| Droits nécessaires | Lecture des statistiques/DMV — voir [Créer un utilisateur de surveillance](#créer-un-utilisateur-de-surveillance) | `SELECT` sur les tables que touche votre requête |

Si vous voulez alerter sur une condition métier, utilisez le moniteur de requête SQL. Si vous voulez savoir que le serveur manque de connexions avant même que la condition métier ait une chance d'échouer, utilisez celui-ci.

## Bases de données prises en charge

| Base de données | Port par défaut |
|---|---|
| **PostgreSQL** | `5432` |
| **MySQL** | `3306` |
| **Microsoft SQL Server** | `1433` |

Azure SQL Database et Azure SQL Managed Instance se connectent comme **Microsoft SQL Server**. Ils demandent d'autres droits — voir [Créer un utilisateur de surveillance](#créer-un-utilisateur-de-surveillance).

Les moteurs compatibles PostgreSQL et MySQL qui parlent le même protocole réseau fonctionnent généralement, mais ils peuvent exposer moins de vues de statistiques ; les métriques concernées sont alors signalées comme indisponibles au lieu d'être collectées. Seuls les trois moteurs ci-dessus sont officiellement testés.

Chaque base de données qu'utilisent vos applications, clusters et hôtes — ces trois moteurs et bien d'autres — a aussi sa propre page avec ses métriques de moteur, ses logs et les services qui l'appellent : voir [Bases de données](/docs/telemetry/databases). Quand l'hôte et le port auxquels se connecte un moniteur de santé de base de données sont l'un des points de terminaison d'une base, les alertes et incidents du moniteur apparaissent aussi sur la page de cette base (voir [Alertes sur une base de données](/docs/telemetry/databases#alerts-on-a-database)).

## Fonctionnement

À chaque vérification, une sonde :

1. Se connecte à la base de données avec les identifiants que vous configurez.
2. Exécute une requête de test légère. **C'est la seule instruction dont l'échec peut mettre le moniteur hors ligne.**
3. Exécute les requêtes de catalogue de chaque [groupe de métriques](#groupes-de-métriques) activé, une à la fois, chacune avec un délai d'exécution maximal.
4. Remonte les nombres collectés, plus une note pour chaque groupe qu'elle n'a pas pu collecter, avec la raison.

```mermaid title="Une vérification, et la seule étape qui peut mettre le moniteur hors ligne"
flowchart TB
    connect["Se connecter à la base"] --> probe{"Requête de test OK ?"}
    probe -->|"Non"| offline["Moniteur hors ligne"]
    probe -->|"Oui"| groups["Exécuter chaque groupe de métriques"]
    groups --> group{"Groupe collecté ?"}
    group -->|"Oui"| metrics["Métriques remontées"]
    group -->|"Non"| issue["Métriques absentes, problème noté"]
    metrics --> criteria["Critères évalués"]
    issue --> criteria
```

Seuls des agrégats numériques nommés sont envoyés à OneUptime. Aucun texte de requête, aucune ligne de vos tables et aucun nom de schéma ne quitte votre réseau — les requêtes lisent les vues de statistiques propres au moteur (`pg_stat_activity`, `performance_schema.global_status`, `sys.dm_exec_sessions` et consorts), jamais vos données.

Comme la vérification s'exécute depuis une sonde, la base de données n'a besoin d'être joignable que depuis la sonde. Placez une [sonde personnalisée](/docs/probe/custom-probe) dans votre réseau et OneUptime n'a besoin d'aucune route vers la base.

## Avant de commencer

- Une **sonde** ayant un accès réseau à l'hôte et au port de la base. Utilisez une sonde hébergée par OneUptime si la base est joignable depuis Internet, ou une [sonde personnalisée](/docs/probe/custom-probe) dans votre réseau sinon.
- Un **utilisateur de surveillance**, créé comme décrit dans la section suivante, et ses informations de connexion.

## Créer un utilisateur de surveillance

**C'est l'étape la plus importante.** Le moniteur lit des vues de statistiques que les connexions ordinaires n'ont pas le droit de voir, et une connexion aux droits insuffisants n'échoue pas toujours par une erreur — sur PostgreSQL, elle donne une mauvaise réponse. Créez une connexion dédiée avec exactement ces droits, et rien d'autre.

### PostgreSQL

```sql
CREATE USER oneuptime_health WITH PASSWORD 'a-strong-password';
GRANT CONNECT ON DATABASE mydb TO oneuptime_health;
-- The one grant that matters. Without it, see the note below.
GRANT pg_monitor TO oneuptime_health;
```

`pg_monitor` est un rôle intégré (PostgreSQL 10 et versions ultérieures) qui donne accès en lecture aux vues de statistiques et de surveillance. Il ne donne aucun accès à vos tables.

> [!IMPORTANT]
> **Pourquoi `pg_monitor` n'est pas facultatif sur PostgreSQL.** Sans ce rôle, `pg_stat_activity` n'échoue pas — la requête réussit et ne renvoie que la ligne de la session de surveillance elle-même. Le nombre de connexions afficherait `1`, les sessions bloquées `0` et le retard de réplication `0`, pour toujours, sur un serveur en réalité en feu. La sonde vérifie donc, **avant** d'exécuter ces requêtes, que la connexion est membre de `pg_monitor` (ou de `pg_read_all_stats`), ou superutilisateur. Si ce n'est pas le cas, la sonde signale les groupes Connections, Activity et Locks comme indisponibles, avec le `GRANT` dont vous avez besoin. Ne rien remonter est la réponse honnête ; remonter `1` ne l'est pas.

Sur un service managé où `pg_monitor` n'est pas disponible, `pg_read_all_stats` couvre les mêmes vues. Sur Amazon RDS, `GRANT rds_superuser` n'est pas nécessaire — `GRANT pg_monitor TO oneuptime_health;` fonctionne en tant que membre de `rds_superuser`.

### MySQL

```sql
CREATE USER 'oneuptime_health'@'%' IDENTIFIED BY 'a-strong-password';
-- INNODB_TRX (open transactions, longest query) and replication status.
GRANT PROCESS, REPLICATION CLIENT ON *.* TO 'oneuptime_health'@'%';
-- Status counters, server variables, and lock waits.
GRANT SELECT ON performance_schema.* TO 'oneuptime_health'@'%';
-- Database size: information_schema.TABLES only shows tables the login can see.
GRANT SELECT ON mydb.* TO 'oneuptime_health'@'%';
FLUSH PRIVILEGES;
```

Le `performance_schema` de MySQL doit être activé (`performance_schema = ON`, la valeur par défaut depuis la 5.6). S'il est désactivé, les groupes Connections, Throughput et Locks sont signalés comme indisponibles, et la solution est un redémarrage du serveur, pas un droit.

### Microsoft SQL Server et Azure SQL Managed Instance

```sql
-- A server-level grant only runs while the current database is master.
USE master;
CREATE LOGIN oneuptime_health WITH PASSWORD = 'a-strong-password';
-- Every DMV the monitor reads. On SQL Server 2022 and later,
-- VIEW SERVER PERFORMANCE STATE alone is also enough.
GRANT VIEW SERVER STATE TO oneuptime_health;

USE mydb;
CREATE USER oneuptime_health FOR LOGIN oneuptime_health;
```

Exécuté depuis toute autre base, `GRANT VIEW SERVER STATE` échoue avec Msg 4621, « Permissions at the server scope can only be granted when the current database is master ».

> [!WARNING]
> **L'accès en lecture à vos tables ne suffit pas.** Une connexion qui ne peut que lire des données — `db_datareader` ou tout autre rôle « d'accès en lecture » — peut se connecter et obtient la taille de la base, rien d'autre. SQL Server refuse les vues que lit le moniteur avec `The user does not have permission to perform this action.` (Msg 297). Le message qui le précède nomme ce qui a été refusé : Msg 300 `VIEW SERVER STATE` (`VIEW SERVER PERFORMANCE STATE` sur 2022) pour les vues serveur, y compris l'espace du journal des transactions et l'espace libre de tempdb, ou Msg 262 `VIEW DATABASE STATE` (`VIEW DATABASE PERFORMANCE STATE` sur 2022) pour la vue de réplication. Le moniteur reste en ligne, signale qu'il manque un droit aux groupes Connections, Activity, Throughput, Locks, Storage et Replication, et affiche à côté le `GRANT` ci-dessus. `VIEW SERVER STATE` les couvre tous.
>
> Deux vues ne refusent pas : sans le droit, `sys.dm_exec_sessions` et `sys.dm_exec_requests` ne montrent silencieusement que la session du moniteur. Le moniteur ne les lit jamais seules — toujours avec une vue qui, elle, refuse —, si bien qu'un droit manquant ne peut jamais être enregistré comme « 1 connexion ».

### Azure SQL Database

Azure SQL Database n'a pas d'autorisations au niveau du serveur — `GRANT VIEW SERVER STATE` y échoue —, ce sont donc des droits au niveau de la base qui ouvrent les mêmes vues. Créez une connexion dans `master`, donnez-lui un utilisateur dans la base que vous surveillez et accordez le droit là, pas dans `master` :

```sql
-- Connected to master, as the server admin:
CREATE LOGIN oneuptime_health WITH PASSWORD = 'a-strong-password';

-- Connected to the monitored database:
CREATE USER oneuptime_health FOR LOGIN oneuptime_health;
GRANT VIEW DATABASE STATE TO oneuptime_health;
```

Cela suffit pour les bases vCore et pour les bases DTU à partir de S2. En **Basic, S0 et S1**, et pour toute base d'un **pool élastique**, Azure ne laisse lire ces vues qu'à l'administrateur du serveur, à l'administrateur Microsoft Entra ou aux membres du rôle serveur `##MS_ServerStateReader##`, quels que soient les droits de la base. Dans ce cas, l'administrateur du serveur ajoute aussi la connexion à ce rôle :

```sql
-- Connected to master, as the server admin:
ALTER SERVER ROLE ##MS_ServerStateReader## ADD MEMBER oneuptime_health;
```

`##MS_ServerStateReader##` fonctionne à tous les niveaux de service ; c'est donc aussi la solution de repli si `VIEW DATABASE STATE` s'avère insuffisant. Une nouvelle appartenance à un rôle peut mettre quelques minutes à s'appliquer et ne concerne que les nouvelles connexions ; la sonde ouvre une nouvelle connexion à chaque vérification.

Un utilisateur de base de données autonome (`CREATE USER oneuptime_health WITH PASSWORD = '...'` dans la base surveillée, sans connexion) fonctionne avec `VIEW DATABASE STATE` à partir de S2, mais ne peut pas rejoindre `##MS_ServerStateReader##` : les rôles serveur n'acceptent que des connexions. Pour faire passer un utilisateur autonome dans le rôle, supprimez-le (`DROP USER oneuptime_health;`) et suivez les instructions ci-dessus.

La sonde reconnaît Azure SQL Database à `SERVERPROPERTY('EngineEdition')` plutôt qu'à sa version — Azure SQL Database renvoie `12.0.2000.8` quelle que soit la version réelle, ce qui se lit comme SQL Server 2014. Le **Moteur** du moniteur indique donc `Azure SQL Database 12.0.2000.8`, et un droit manquant est affiché sous la forme de l'instruction Azure ci-dessus, jamais sous la forme `VIEW SERVER STATE`.

- **La réplication n'est pas collectée sur Azure SQL Database.** Azure SQL Database n'a pas de `sys.dm_hadr_database_replica_states` ; le groupe Replication y est donc ignoré au lieu d'être signalé en échec à chaque vérification. Les vues de réplica propres à Azure (`sys.dm_database_replica_states`, `sys.dm_geo_replication_link_status`) ne sont pas encore lues.
- **Les connexions sont comptées par base.** Avec `VIEW DATABASE STATE`, Azure SQL Database ne montre que les sessions de la base surveillée ; Connections compte donc cette base plutôt que le serveur logique. Surveillez chaque base qui vous importe.
- **Dans un pool élastique, TempDB Free Space est celui du pool.** Les bases d'un pool partagent une même tempdb.

## Créer un moniteur de santé de base de données

:::steps
### Commencer un nouveau moniteur

Allez dans **Moniteurs** et cliquez sur **Créer un moniteur**. Sous **Type de moniteur**, cliquez sur **Plus de types de moniteurs** et choisissez **Santé de la base de données** sous **Database Monitoring**, ou tapez `health` dans le champ de recherche. Saisissez un **Nom**, puis cliquez sur **Suivant**.

### Saisir les informations de connexion

Choisissez le **Type de base de données**, puis renseignez l'hôte, le port, le nom de la base et les identifiants de l'utilisateur de surveillance. Faites référence au mot de passe sous forme de [secret de moniteur](#utiliser-un-secret-de-moniteur-pour-le-mot-de-passe) au lieu de le saisir. Chaque champ est décrit dans [Configuration](#configuration).

### Choisir ce qui est collecté

Laissez chaque groupe de **Groupes de métriques** activé, sauf si vous avez une raison d'en désactiver un — voir [Groupes de métriques](#groupes-de-métriques).

### Tester la connexion

Cliquez sur **Tester le moniteur** pour exécuter une vérification avant d'enregistrer, et lisez ce qu'elle a collecté.

### Définir les critères

Passez en revue les critères avec lesquels le moniteur démarre et ajoutez les vôtres — voir [Configurer les critères](#configurer-les-critères). Cliquez ensuite sur **Suivant**.

### Choisir les sondes et créer

Sélectionnez les **Sondes** qui peuvent joindre la base et un **Intervalle de surveillance**, puis cliquez sur **Créer un moniteur**.
:::

## Configuration

| Champ | Ce qu'il faut saisir |
|---|---|
| **Type de base de données** | PostgreSQL, MySQL ou Microsoft SQL Server. Le choix d'un type définit le port par défaut et décide des requêtes exécutées. |
| **Hôte** | L'hôte de la base joignable depuis la sonde (par exemple `db.internal`). |
| **Port** | Le port de la base. |
| **Nom de la base de données** | La base à laquelle se connecter. Les métriques propres à la base (taille, taux de succès du cache, débordement temporaire) sont remontées pour cette base ; les métriques propres au serveur (connexions, temps de fonctionnement, réplication) pour l'ensemble du serveur — sauf sur Azure SQL Database, où les connexions ne sont comptées que pour la base surveillée. |
| **Use Windows Integrated Authentication** | Microsoft SQL Server uniquement. S'authentifier avec l'identité du processus de la sonde au lieu d'un nom d'utilisateur et d'un mot de passe. Voir [Authentification Windows intégrée](/docs/monitor/sql-monitor) sur la page du moniteur de requête SQL — la configuration est identique. |
| **Nom d'utilisateur** | L'utilisateur de surveillance. Obligatoire, sauf si vous utilisez l'authentification Windows intégrée. |
| **Mot de passe** | Le mot de passe. Faites référence à un [secret de moniteur](/docs/monitor/monitor-secrets) avec `{{monitorSecrets.name}}` au lieu de le saisir en clair (voir [Utiliser un secret de moniteur](#utiliser-un-secret-de-moniteur-pour-le-mot-de-passe)). |
| **Use SSL/TLS** | Se connecter via TLS. Une fois activé, vous pouvez désactiver **Verify server certificate** pour un certificat auto-signé. |
| **Groupes de métriques** | Les groupes à exécuter : Connexions, Activité, Throughput, Locks and Blocking, Stockage, Replication et Maintenance. Tous sont activés par défaut ; voir [Groupes de métriques](#groupes-de-métriques). Les détails du moniteur les listent sous **Groupes de métriques collectés**. |

### Champs supplémentaires

| Champ | Par défaut | Maximum | Ce qu'il limite |
|---|---|---|---|
| **Délai de connexion (ms)** | `10000` | `30000` | Le temps d'attente pour établir une connexion. |
| **Statement Timeout (ms)** | `10000` | `60000` | Le plafond de chaque requête de catalogue. |

Le délai par défaut des instructions est volontairement plus court que celui du moniteur de requête SQL : ces requêtes répondent en quelques millisecondes sur un serveur sain, donc si `pg_stat_activity` met dix secondes, le signal utile est « ce serveur a un problème », pas une attente plus longue. Une valeur au-dessus du maximum est ramenée au maximum.

## Utiliser un secret de moniteur pour le mot de passe

Pour que le mot de passe ne soit jamais stocké en clair sur le moniteur :

:::steps
1. Allez dans **Moniteurs → Paramètres → Secrets** et créez un [secret de moniteur](/docs/monitor/monitor-secrets).
2. Nommez-le (par exemple `dbPassword`) et donnez à ce moniteur l'accès à ce secret.
3. Dans le champ **Mot de passe** du moniteur, saisissez `{{monitorSecrets.dbPassword}}`.
:::

Le secret est résolu côté serveur avant que la configuration soit transmise à une sonde. Les champs Hôte, Nom d'utilisateur et Nom de la base de données acceptent la même référence. Les identifiants ne sont jamais écrits dans les logs, les fils du moniteur ou les modèles d'alerte.

## Groupes de métriques

Un groupe est une unité que vous activez ou désactivez, et l'unité pour laquelle un droit manquant est signalé. Les groupes existent pour qu'un droit manquant vous coûte un groupe plutôt que tout le moniteur. Les instructions d'un groupe s'exécutent une à la fois, donc un groupe peut être collecté en partie : il apparaît alors à la fois dans `collectedGroups` et dans `unavailableGroups`. Le cas courant est le groupe Storage de SQL Server pour une connexion sans `VIEW SERVER STATE` — la taille de la base est collectée, l'espace du journal et l'espace libre de tempdb ne le sont pas.

| Groupe | Ce qu'il collecte | Nécessite |
|---|---|---|
| Connections | Nombre de connexions, plafond configuré, connexions avortées, temps de fonctionnement du serveur | PostgreSQL : `pg_monitor`. MySQL : `performance_schema`. SQL Server : `VIEW SERVER STATE` |
| Activity | Requête la plus longue en cours, transaction ouverte la plus longue, transactions ouvertes | PostgreSQL : `pg_monitor`. MySQL : `PROCESS`. SQL Server : `VIEW SERVER STATE` |
| Throughput | Transactions, requêtes, taux de succès du cache, lectures et écritures disque, temps d'E/S | PostgreSQL : rien au-delà de `CONNECT`. MySQL : `performance_schema`. SQL Server : `VIEW SERVER STATE` |
| Locks | Sessions bloquées, attentes de verrou, interblocages, attentes de verrou de table | PostgreSQL : `pg_monitor`. MySQL : `performance_schema`. SQL Server : `VIEW SERVER STATE` |
| Storage | Taille de la base, débordement temporaire, espace du journal, espace libre de tempdb | PostgreSQL : rien au-delà de `CONNECT`. MySQL : `SELECT` sur la base. SQL Server : rien pour la taille de la base ; `VIEW SERVER STATE` pour l'espace du journal et l'espace libre de tempdb |
| Replication | Réplicas connectés, retard de réplication en secondes et en octets, slots inactifs, état de récupération | PostgreSQL : `pg_monitor`. MySQL : `REPLICATION CLIENT`. SQL Server : `VIEW SERVER STATE` ; non collecté sur Azure SQL Database |
| Maintenance | Marge avant le rebouclage des identifiants de transaction, tuples morts, tables jamais traitées par l'autovacuum, checkpoints | PostgreSQL : `pg_monitor` |

Sur Azure SQL Database, lisez `VIEW DATABASE STATE` partout où ce tableau indique `VIEW SERVER STATE` — ou `##MS_ServerStateReader##` en Basic, S0, S1 et dans les pools élastiques. Voir [Azure SQL Database](#azure-sql-database).

Désactiver un groupe se fait en silence : pas de métriques, pas de problème de collecte, pas d'alerte. C'est la bonne décision dans deux cas :

- **Vous ne pouvez pas obtenir le droit.** Désactiver le groupe empêche le problème de collecte de se répéter à chaque vérification.
- **Les requêtes coûtent trop cher.** Sur MySQL, **Stockage** est le candidat habituel : la taille de la base est obtenue en additionnant `information_schema.TABLES`, ce qui n'est pas gratuit sur un schéma de plusieurs dizaines de milliers de tables et s'exécute à chaque vérification. Désactivez-le, ou passez ce moniteur à un intervalle de cinq minutes.

Décocher tous les groupes n'est pas une façon de ne rien collecter — une liste vide est ramenée à tous les groupes, si bien qu'un moniteur ne peut jamais être enregistré dans un état où il ne collecte silencieusement rien.

## Ce qui se passe quand une métrique ne peut pas être collectée

**Un droit manquant ne met jamais le moniteur hors ligne.** C'est le comportement le plus important de ce type de moniteur, et il mérite d'être décrit avec précision.

| Ce qui échoue | Statut du moniteur | Ce que vous voyez |
|---|---|---|
| **La connexion**, ou la requête de test — identifiants erronés, connexion refusée, échec TLS, délai de connexion dépassé | **Hors ligne** | `Database Is Online` vaut false, et l'incident et la politique d'astreinte que vous y avez rattachés se déclenchent. |
| **Un groupe** — un droit manquant, un `performance_schema` désactivé, un délai d'instruction dépassé | **Reste en ligne** | Les métriques que ce groupe n'a pas pu lire sont **absentes**, pas nulles. Aucune courbe n'est tracée, aucun seuil sur ces séries ne peut correspondre, et aucun incident ne peut en naître. La vérification enregistre un problème de collecte qui nomme le groupe, la raison et — quand il y en a un — le `GRANT` exact à exécuter ; il s'affiche dans le résumé du moniteur et est compté dans **Metric Groups Failed**. |
| **Le moteur ne peut pas produire la métrique du tout** — MySQL standard n'a pas de compteur d'interblocages ; SQL Server laisse son plafond de connexions illimité par défaut, si bien qu'un « pourcentage utilisé » n'aurait aucun sens | **Reste en ligne** | La métrique est simplement absente. Ce n'est **pas** un problème de collecte, cela ne compte pas dans Metric Groups Failed, et il n'y a rien à corriger. Voir la colonne Engines dans [Métriques collectées](#métriques-collectées). |

Absent veut toujours dire absent. Une valeur qui n'a pas été mesurée n'est jamais remontée comme `0`, car un graphique de zéros inventés est pire qu'un trou — un trou, vous pouvez le voir.

> [!TIP]
> Pour alerter sur une perte de visibilité, utilisez `Database Collection Error`, ou un seuil sur **Metric Groups Failed**. Faites-en des alertes plutôt que des incidents : un droit révoqué est un ticket, pas une astreinte.

### "The user does not have permission to perform this action"

C'est le message de SQL Server (Msg 297) pour une connexion qui peut se connecter mais ne peut pas lire les vues d'état du serveur. Il signifie toujours un droit manquant, jamais une panne de la base. SQL Server l'envoie en second, après un message qui nomme l'autorisation refusée, et le moniteur affiche les deux : par exemple `VIEW SERVER STATE permission was denied on object 'server', database 'master'. The user does not have permission to perform this action.` À côté figure l'instruction qui corrige le problème pour la plateforme à laquelle la sonde s'est connectée :

- **SQL Server ou Azure SQL Managed Instance** — `GRANT VIEW SERVER STATE TO oneuptime_health;`, exécuté dans `master` (le moniteur l'affiche sous la forme `GRANT VIEW SERVER STATE TO [<monitoring_login>]; -- run in master`).
- **Azure SQL Database** — `GRANT VIEW DATABASE STATE TO oneuptime_health;`, exécuté dans la base surveillée ; en Basic, S0, S1 et dans les pools élastiques, l'appartenance à `##MS_ServerStateReader##` à la place. Voir [Azure SQL Database](#azure-sql-database).

La taille de la base continue d'être collectée pendant ce temps, car c'est la seule métrique du groupe Storage que n'importe quelle connexion peut lire.

## Métriques collectées

Quarante et une séries réparties en huit catégories. Engines liste les moteurs qui peuvent réellement produire la série ; sur tout autre moteur, elle est simplement absente. Group est le groupe de collecte auquel appartient la série : c'est ce que vous activez ou désactivez, et ce qui se dégrade ensemble.

### Disponibilité

| Métrique | Série | Group | Engines |
|---|---|---|---|
| **Uptime** (s) | `oneuptime.monitor.database.uptime.seconds` | Connections | PostgreSQL, MySQL, SQL Server |
| **Metric Groups Failed** | `oneuptime.monitor.database.metric.groups.failed` | Connections | PostgreSQL, MySQL, SQL Server |

### Connexions

| Métrique | Série | Group | Engines |
|---|---|---|---|
| **Connections** | `oneuptime.monitor.database.connections.total` | Connections | PostgreSQL, MySQL, SQL Server |
| **Active Connections** | `oneuptime.monitor.database.connections.active` | Connections | PostgreSQL, MySQL, SQL Server |
| **Maximum Connections** | `oneuptime.monitor.database.connections.max` | Connections | PostgreSQL, MySQL |
| **Connections Used** (%) | `oneuptime.monitor.database.connections.used.percent` | Connections | PostgreSQL, MySQL |
| **Idle In Transaction** | `oneuptime.monitor.database.connections.idle.in.transaction` | Connections | PostgreSQL |
| **Aborted Connects** | `oneuptime.monitor.database.connections.aborted.total` | Connections | MySQL |

### Débit

| Métrique | Série | Group | Engines |
|---|---|---|---|
| **Transactions** | `oneuptime.monitor.database.transactions.total` | Throughput | PostgreSQL, SQL Server |
| **Queries** | `oneuptime.monitor.database.queries.total` | Throughput | MySQL, SQL Server |
| **Slow Queries** | `oneuptime.monitor.database.queries.slow.total` | Throughput | MySQL |
| **Rollback Ratio** (%) | `oneuptime.monitor.database.rollback.percent` | Throughput | PostgreSQL |
| **Longest Running Query** (s) | `oneuptime.monitor.database.query.longest.seconds` | Activity | PostgreSQL, MySQL, SQL Server |
| **Longest Open Transaction** (s) | `oneuptime.monitor.database.transaction.longest.seconds` | Activity | PostgreSQL, MySQL, SQL Server |
| **Open Transactions** | `oneuptime.monitor.database.transaction.open.count` | Activity | MySQL |

### Verrous et blocages

| Métrique | Série | Group | Engines |
|---|---|---|---|
| **Blocked Sessions** | `oneuptime.monitor.database.sessions.blocked` | Locks | PostgreSQL, MySQL, SQL Server |
| **Lock Waits** | `oneuptime.monitor.database.locks.waiting` | Locks | PostgreSQL, MySQL, SQL Server |
| **Deadlocks** | `oneuptime.monitor.database.deadlocks.total` | Locks | PostgreSQL, SQL Server |
| **Table Lock Waits** | `oneuptime.monitor.database.table.locks.waited.total` | Locks | MySQL |

MySQL standard n'expose aucun compteur d'interblocages, c'est pourquoi Deadlocks n'existe que sur PostgreSQL et SQL Server.

### Cache et E/S

| Métrique | Série | Group | Engines |
|---|---|---|---|
| **Cache Hit Ratio** (%) | `oneuptime.monitor.database.cache.hit.percent` | Throughput | PostgreSQL, MySQL, SQL Server |
| **Disk Reads** | `oneuptime.monitor.database.disk.reads.total` | Throughput | PostgreSQL, MySQL, SQL Server |
| **Disk Writes** | `oneuptime.monitor.database.disk.writes.total` | Throughput | MySQL, SQL Server |
| **I/O Read Time** (ms) | `oneuptime.monitor.database.io.read.time.ms` | Throughput | PostgreSQL, SQL Server |
| **I/O Write Time** (ms) | `oneuptime.monitor.database.io.write.time.ms` | Throughput | PostgreSQL, SQL Server |
| **Page Life Expectancy** (s) | `oneuptime.monitor.database.page.life.expectancy.seconds` | Throughput | SQL Server |
| **Memory Grants Pending** | `oneuptime.monitor.database.memory.grants.pending` | Throughput | SQL Server |

PostgreSQL ne mesure les temps de lecture et d'écriture d'E/S que lorsque `track_io_timing` est activé. Il est désactivé par défaut, et PostgreSQL remonte alors les deux à `0` — sur PostgreSQL, un zéro plat dans ces deux séries signifie donc généralement « non mesuré », pas « rapide ». C'est un réglage du serveur, pas un problème de droits.

### Stockage

| Métrique | Série | Group | Engines |
|---|---|---|---|
| **Database Size** (octets) | `oneuptime.monitor.database.size.bytes` | Storage | PostgreSQL, MySQL, SQL Server |
| **Temp Bytes Written** (octets) | `oneuptime.monitor.database.temp.bytes.total` | Storage | PostgreSQL |
| **Temp Disk Tables** | `oneuptime.monitor.database.temp.disk.tables.total` | Storage | MySQL |
| **Log Space Used** (%) | `oneuptime.monitor.database.log.space.used.percent` | Storage | SQL Server |
| **TempDB Free Space** (octets) | `oneuptime.monitor.database.tempdb.free.bytes` | Storage | SQL Server |

### Réplication

| Métrique | Série | Group | Engines |
|---|---|---|---|
| **Connected Replicas** | `oneuptime.monitor.database.replica.count` | Replication | PostgreSQL, SQL Server |
| **Replication Lag** (s) | `oneuptime.monitor.database.replication.lag.seconds` | Replication | PostgreSQL, MySQL |
| **Replication Lag (Bytes)** (octets) | `oneuptime.monitor.database.replication.lag.bytes` | Replication | PostgreSQL, SQL Server |
| **Is In Recovery** | `oneuptime.monitor.database.is.in.recovery` | Replication | PostgreSQL |
| **Inactive Replication Slots** | `oneuptime.monitor.database.replication.slots.inactive` | Replication | PostgreSQL |

Les métriques de réplication sont remontées depuis le côté du lien auquel le moniteur est connecté. Dirigez un moniteur vers le primaire pour voir les réplicas connectés et la file d'envoi ; dirigez-en un vers chaque standby pour voir le retard réel de ce standby.

Le retard en secondes affiche zéro sur un primaire inactif même quand un réplica est très en retard, car rien de nouveau n'a été écrit. **Replication Lag (Bytes)** n'a pas cet angle mort ; alertez donc sur les deux.

### Maintenance

| Métrique | Série | Group | Engines |
|---|---|---|---|
| **Transaction ID Used** (%) | `oneuptime.monitor.database.transaction.id.used.percent` | Maintenance | PostgreSQL |
| **Dead Tuples** | `oneuptime.monitor.database.dead.tuples` | Maintenance | PostgreSQL |
| **Tables Never Autovacuumed** | `oneuptime.monitor.database.tables.never.autovacuumed` | Maintenance | PostgreSQL |
| **Requested Checkpoints** | `oneuptime.monitor.database.checkpoints.requested.total` | Maintenance | PostgreSQL |
| **Timed Checkpoints** | `oneuptime.monitor.database.checkpoints.timed.total` | Maintenance | PostgreSQL |

> [!IMPORTANT]
> **Transaction ID Used** mérite un critère sur chaque moniteur PostgreSQL que vous créez. PostgreSQL refuse toutes les écritures quand il atteint 100 %, la récupération passe par un vacuum en mode mono-utilisateur avec la base arrêtée, et presque personne ne le surveille. Alertez bien avant la falaise — 80 % laisse des jours de marge pour la plupart des charges.

Les compteurs qui se terminent par `total` sont cumulés depuis le démarrage du serveur. Comparez deux instants pour obtenir un taux ; une valeur isolée n'a de sens que par rapport à son propre historique, et elle revient à zéro quand le serveur redémarre (ce que **Uptime** vous montrera).

## Configurer les critères

| Type de filtre | Ce qu'il vérifie |
|---|---|
| **Database Is Online** | Si la base était joignable et si la requête de test a réussi. C'est le critère hors ligne avec lequel le moniteur est créé, et la seule vérification qui reflète la joignabilité. |
| **Database Metric** | Choisissez une métrique, puis comparez-la : Greater Than, Less Than, Greater Than Or Equal To, Less Than Or Equal To, Equal To ou Not Equal To. Le sélecteur de métriques ne propose que les métriques que votre moteur peut produire, vous ne pouvez donc pas construire un critère qui resterait insatisfait en permanence (une exception : les métriques Replication proposées pour Microsoft SQL Server ne sont jamais collectées sur Azure SQL Database). Si la métrique n'a pas été collectée lors d'une vérification — le groupe a échoué, ou le moteur ne la remonte pas —, le filtre ne correspond pas, et ne correspond pas non plus comme « false » : il est ignoré. Un problème de droits ne peut appeler personne. |
| **Database Collection Error** | Le résumé des problèmes de collecte de la vérification, un « groupe : message » par groupe indisponible. Alertez quand il n'est pas vide pour détecter une perte de visibilité, ou utilisez Contains pour surveiller un groupe précis. |
| **JavaScript Expression** | Contrôle total. Voir [Expressions JavaScript](/docs/monitor/javascript-expression). |

Les seuils sont des nombres entiers. Écrivez `90`, pas `90.5` — les pourcentages et les secondes sont comparés comme des entiers.

**Database Is Online** et **Database Metric** peuvent être vérifiés dans la durée : cochez **Évaluer ce critère sur une période donnée**, puis choisissez comment **Évaluer** les valeurs (par exemple **All Values**) et **Pour les dernières (en minutes)**. Dans la durée, le réglage **En l'absence de données** du filtre décide de ce que signifie une valeur manquante ; laissez-le sur **Ignore** pour qu'un droit manquant ne puisse toujours appeler personne.

### Variables des expressions JavaScript

Pour un moniteur de santé de base de données, l'expression a accès à :

| Variable | Type | Description |
|---|---|---|
| `isOnline` | boolean | Si la connexion et la requête de test ont toutes deux réussi |
| `engineVersion` | string | La chaîne de version renvoyée par le serveur (sur SQL Server, la `ProductVersion` brute ; le résumé du moniteur nomme la plateforme à côté) |
| `connectionError` | string | Erreur de connexion assainie, vide s'il n'y en a pas eu |
| `collectedGroups` | array | Les groupes qui ont produit des valeurs lors de cette vérification |
| `unavailableGroups` | array | Les groupes dont une instruction n'a pas pu être collectée, chacun avec une raison et une correction. Un groupe collecté en partie figure dans les deux listes |
| `metrics` | object | Les valeurs collectées, indexées par nom de série ; une série non collectée est absente |

```javascript
{{isOnline}} === true && {{collectedGroups}}.length >= 5
```

Pour lire une métrique dans une expression, indexez l'objet `metrics` en entier — les noms de séries contiennent des points et ne peuvent donc pas aller entre les accolades :

```javascript
{{metrics}}['oneuptime.monitor.database.connections.used.percent'] > 90
```

Pour un seuil sur une seule métrique, préférez **Database Metric** à une expression : il résout la série pour vous, ne propose que ce que votre moteur peut produire, et ignore la vérification quand la valeur n'a pas été collectée au lieu de comparer avec rien.

### Exemple : un primaire PostgreSQL

| Ordre | Critère | Filtre |
|---|---|---|
| 1 | **Hors ligne** | `Database Is Online` vaut `false`. |
| 2 | **Dégradé** | `Database Metric` → Connections Used est supérieur à `90`, évalué sur 5 minutes avec All Values pour qu'un pic isolé n'appelle personne. |
| 3 | **Dégradé** | `Database Metric` → Transaction ID Used est supérieur à `80`. |
| 4 | **Dégradé** | `Database Metric` → Blocked Sessions est supérieur à `0`, sur 5 minutes. |
| 5 | **En ligne** | `Database Is Online` vaut `true`. |

Les critères sont évalués de haut en bas et la première correspondance l'emporte : placez donc les critères d'alerte en premier et le critère sain en dernier.

Rattachez une politique d'astreinte au critère hors ligne, et laissez tout ce qui découle de **Metric Groups Failed** ou de `Database Collection Error` sous forme d'alerte sans politique d'astreinte.

## Points à prendre en compte

- **Les requêtes s'exécutent à chaque vérification.** Elles sont peu coûteuses par conception, mais « peu coûteux » dépend de l'intervalle. Un intervalle d'une minute sur un serveur avec des milliers de sessions représente plus de parcours de `pg_stat_activity` que vous ne le souhaitez peut-être ; cinq minutes suffisent largement pour les métriques de capacité.
- **Dirigez le moniteur vers la base qui vous importe.** La taille, le taux de succès du cache et le débordement temporaire sont propres à chaque base. Les connexions, le temps de fonctionnement et la réplication sont propres au serveur et donnent la même valeur depuis n'importe quelle base de l'instance.
- **Un moniteur par instance, pas par base**, sauf si vous voulez précisément la taille et les métriques de cache par base — sinon vous multipliez les requêtes propres au serveur sans information nouvelle. Azure SQL Database fait exception : il compte les connexions par base, surveillez donc chaque base.
- **Alertez sur des taux, pas sur des compteurs.** Tout ce qui se termine par `total` ne fait que croître, donc un seuil « supérieur à » se déclenche une fois et ne revient jamais. Affichez-le en graphique, ou comparez-le sur une fenêtre de temps.
- **Préférez un secret de moniteur à un mot de passe en clair.** L'identifiant reste alors chiffré au repos et n'apparaît jamais sur le moniteur.
- **Le moniteur n'écrit jamais.** Chaque requête est une lecture d'une vue de statistiques — sur PostgreSQL dans une transaction en lecture seule, sur MySQL dans une session en lecture seule. Ce qu'il ne peut pas lire est signalé comme une métrique manquante, jamais comme une panne.

## Dépannage

:::details Le moniteur est hors ligne, mais la base fonctionne
Hors ligne signifie que la sonde n'a pas pu se connecter ou que la requête de test a échoué : l'hôte ou le port n'est pas joignable depuis la sonde, la connexion a été refusée, TLS a échoué, ou la connexion a dépassé son délai. Le résumé du moniteur affiche l'erreur. Vérifiez que la sonde peut joindre la base (une sonde hébergée par OneUptime a besoin d'une adresse publique ; sinon, utilisez une [sonde personnalisée](/docs/probe/custom-probe)), vérifiez le nom d'utilisateur et le mot de passe ou son secret de moniteur, et désactivez **Verify server certificate** pour un certificat auto-signé. Cliquez ensuite sur **Tester le moniteur** pour vérifier à nouveau.
:::

:::details Connections, Activity et Locks manquent sur PostgreSQL
La connexion n'est membre ni de `pg_monitor` ni de `pg_read_all_stats` et n'est pas superutilisateur ; la sonde ignore donc ces groupes au lieu d'enregistrer des nombres faux. Exécutez `GRANT pg_monitor TO oneuptime_health;` comme décrit dans [PostgreSQL](#postgresql).
:::

:::details Connections, Throughput et Locks manquent sur MySQL
Soit la connexion n'a pas `SELECT` sur `performance_schema`, soit `performance_schema` est désactivé sur le serveur ; le résumé du moniteur affiche le message de MySQL. Pour un droit manquant, exécutez les instructions de [MySQL](#mysql). Un `performance_schema` désactivé nécessite `performance_schema = ON` dans la configuration du serveur et un redémarrage.
:::

:::details I/O Read Time et I/O Write Time valent toujours 0 sur PostgreSQL
PostgreSQL ne les mesure que lorsque `track_io_timing` est activé, et il est désactivé par défaut. Activez-le dans la configuration du serveur, ou dans le groupe de paramètres de votre service managé, pour voir de vraies valeurs. Ce n'est pas un droit manquant.
:::

:::details Metric Groups Failed est au-dessus de 0 à chaque vérification
Un groupe ne peut être collecté à aucune vérification, donc le même problème de collecte se répète. Le résumé du moniteur nomme le groupe, la raison et le `GRANT` qui le corrige. Exécutez ce droit ou, si vous ne pouvez pas l'obtenir, désactivez ce groupe dans **Groupes de métriques** pour que le problème cesse de se répéter.
:::

## Étapes suivantes

:::cards
- [Surveillance de requêtes SQL](/docs/monitor/sql-monitor): Alerter sur le résultat de votre propre requête, à côté de la santé du serveur.
- [Bases de données](/docs/telemetry/databases): Voir les métriques, les logs et les appelants de chaque base sur une seule page.
- [Secrets de surveillance](/docs/monitor/monitor-secrets): Garder chiffré le mot de passe de l'utilisateur de surveillance.
- [Sondes personnalisées](/docs/probe/custom-probe): Joindre une base de données à l'intérieur de votre réseau.
:::
