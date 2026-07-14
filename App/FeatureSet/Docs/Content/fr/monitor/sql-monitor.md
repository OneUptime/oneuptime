# Surveillance de requêtes SQL

La Surveillance de requêtes SQL exécute une requête SQL en lecture seule selon une planification, depuis une sonde, et déclenche des alertes en fonction du résultat — le nombre de lignes renvoyées, une valeur scalaire, la durée d'exécution de la requête ou une erreur de requête. Elle est conçue pour le cas d'usage « exécuter une requête et ouvrir un incident », par exemple pour alerter lorsque le nombre de commandes annulées au cours des cinq dernières minutes augmente brusquement, lorsqu'une table de file d'attente devient trop volumineuse, ou lorsqu'une ligne critique disparaît.

Comme la requête s'exécute depuis une sonde située à l'intérieur de votre réseau, OneUptime n'a jamais besoin d'une connexion directe à votre base de données, et l'ensemble complet des résultats ne quitte jamais la sonde — seule une petite projection bornée du résultat est renvoyée.

## Bases de données prises en charge

La Surveillance de requêtes SQL prend en charge les moteurs de base de données suivants :

- **PostgreSQL** (port par défaut `5432`)
- **MySQL** (port par défaut `3306`)
- **Microsoft SQL Server** (port par défaut `1433`)

Les moteurs compatibles MySQL et compatibles PostgreSQL qui utilisent le même protocole réseau et le même dialecte SQL fonctionnent généralement aussi, mais seuls les trois moteurs ci-dessus sont officiellement testés.

## Fonctionnement

À chaque vérification, la sonde se connecte à votre base de données, exécute votre requête dans un contexte en lecture seule, lit au plus un nombre borné de lignes, et renvoie une projection compacte à OneUptime. Les critères de votre moniteur sont ensuite évalués par rapport à cette projection.

La sonde ne renvoie que :

- **Nombre de lignes** — le nombre de lignes renvoyées par la requête (limité par la valeur Nombre maximal de lignes).
- **Valeur scalaire** — la première colonne de la première ligne. C'est la valeur naturelle pour une requête de type `SELECT COUNT(*)`.
- **Première ligne** — la première ligne sous forme d'ensemble de paires colonne/valeur, affichée dans le résumé de la vérification pour le contexte.
- **Temps d'exécution** — la durée d'exécution de la requête, en millisecondes.
- **Erreur de requête** — un message d'erreur nettoyé si la requête a échoué.

L'ensemble complet des résultats n'est jamais envoyé à OneUptime, de sorte que les données des clients ne sont pas répliquées dans le stockage de OneUptime.

## Modèle de sécurité

Exécuter une requête fournie par le client sur une base de données de production est une opération sensible ; c'est pourquoi la Surveillance de requêtes SQL est en lecture seule par conception et superpose plusieurs contrôles :

- **Utilisateur de base de données à privilèges minimaux (contrôle principal).** Vous devez toujours vous connecter avec un utilisateur de base de données dédié, en lecture seule, qui n'a accès qu'aux tables dont la requête a besoin. Il s'agit du contrôle le plus important — voir Créer un utilisateur en lecture seule ci-dessous.
- **Exécution en lecture seule.** Sur PostgreSQL et MySQL, la sonde ouvre une transaction `READ ONLY`, qui rejette toute écriture (y compris les CTE en écriture) quel que soit le texte de la requête. Sur Microsoft SQL Server, qui ne dispose pas de transaction en lecture seule, la sonde s'exécute au sein d'une transaction qui est toujours annulée (rollback).
- **Requêtes à instruction unique, sur liste d'autorisation.** La requête doit être une instruction unique qui commence par `SELECT`, `WITH`, `VALUES` ou `TABLE`. Les instructions empilées (`SELECT 1; DROP TABLE …`) ainsi que les écritures/DDL sont rejetées avant que la sonde ne se connecte. La vérification tient compte des commentaires et des littéraux de chaîne, de sorte qu'un mot-clé caché dans un commentaire ou une chaîne ne passe pas à travers.
- **Délai d'exécution de l'instruction.** Chaque requête a une limite de temps stricte. Une requête qui s'exécute trop longtemps est annulée.
- **Nombre de lignes borné.** Au plus le nombre défini par Nombre maximal de lignes (plus une, pour détecter la troncature) est lu, ce qui limite la mémoire de la sonde et la taille de la charge utile.
- **Masquage des identifiants.** Les erreurs de base de données sont nettoyées avant d'être stockées — le mot de passe et toute chaîne de connexion sont masqués, de sorte que les identifiants ne fuient jamais dans les messages d'erreur.

## Prérequis

- Une **sonde** disposant d'un accès réseau à l'hôte et au port de votre base de données. Il peut s'agir d'une sonde hébergée par OneUptime (si votre base de données est accessible depuis Internet) ou d'une sonde auto-hébergée s'exécutant à l'intérieur de votre réseau. Consultez la documentation des sondes pour savoir comment installer une sonde personnalisée.
- Un **utilisateur de base de données en lecture seule** ainsi que les détails de connexion (hôte, port, nom de la base de données, nom d'utilisateur, mot de passe).

## Configuration

Créez un nouveau moniteur et choisissez **Requête SQL** comme type de moniteur, puis renseignez les détails de connexion :

- **Type de base de données** — PostgreSQL, MySQL ou Microsoft SQL Server. Le choix d'un type définit le port par défaut.
- **Hôte** — l'hôte de la base de données accessible depuis la sonde (par exemple `db.internal`).
- **Port** — le port de la base de données.
- **Nom de la base de données** — la base de données sur laquelle exécuter la requête.
- **Nom d'utilisateur** — un utilisateur de base de données en lecture seule, à privilèges minimaux.
- **Mot de passe** — le mot de passe de la base de données. Nous recommandons vivement de référencer un [Secret de moniteur](/docs/monitor/monitor-secrets) avec `{{monitorSecrets.name}}` plutôt que de saisir le mot de passe en clair (voir ci-dessous).
- **Requête SQL** — la requête en lecture seule à exécuter (voir Rédaction de la requête).
- **Utiliser SSL/TLS** — activez cette option pour vous connecter via TLS. Lorsqu'elle est activée, vous pouvez désactiver **Vérifier le certificat du serveur** si la base de données utilise un certificat auto-signé.

### Options avancées

- **Délai de connexion (ms)** — le temps d'attente pour établir une connexion. Valeur par défaut `10000`, maximum `30000`.
- **Délai d'exécution de l'instruction (ms)** — la limite stricte de la durée d'exécution de la requête. Valeur par défaut `15000`, maximum `60000`.
- **Nombre maximal de lignes** — la limite supérieure du nombre de lignes lues depuis la base de données. Valeur par défaut `100`, maximum `1000`.

## Rédaction de la requête

La requête doit être une **instruction unique en lecture seule**. Elle doit commencer par l'un des mots-clés `SELECT`, `WITH`, `VALUES` ou `TABLE`. Un unique point-virgule final est autorisé ; plusieurs instructions ne le sont pas.

Gardez des requêtes peu coûteuses et bien délimitées — elles s'exécutent à chaque vérification, alors privilégiez les colonnes indexées et les fenêtres temporelles étroites.

```sql
-- Compter les annulations récentes (PostgreSQL)
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > NOW() - INTERVAL '5 minutes';
```

```sql
-- La même idée sur MySQL
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > NOW() - INTERVAL 5 MINUTE;
```

```sql
-- La même idée sur Microsoft SQL Server
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > DATEADD(minute, -5, GETDATE());
```

Pour une requête de type `COUNT(*)`, le décompte est disponible à la fois en tant que **Nombre de lignes** (qui vaut `1`, puisqu'une seule ligne est renvoyée) et en tant que **Valeur scalaire** (le décompte lui-même, issu de la première colonne). Pour alerter sur « combien », comparez avec la **Valeur scalaire**.

## Utiliser un secret de moniteur pour le mot de passe

Pour que le mot de passe de la base de données ne soit jamais stocké en clair sur le moniteur, créez un [Secret de moniteur](/docs/monitor/monitor-secrets) et référencez-le depuis le champ Mot de passe :

1. Accédez au Tableau de bord OneUptime → Paramètres du projet → Secrets de moniteur → Créer un secret de moniteur.
2. Créez un secret (par exemple `dbPassword`) et accordez à ce moniteur l'accès à celui-ci.
3. Dans le champ Mot de passe du moniteur, saisissez `{{monitorSecrets.dbPassword}}`.

OneUptime résout le secret côté serveur avant que la configuration ne soit transmise à la sonde. OneUptime ne crée jamais ces secrets à votre place — en référencer un relève de votre choix.

## Configuration des critères

Ajoutez des critères pour décider quand le moniteur est considéré comme en ligne, dégradé ou hors ligne. Les vérifications suivantes sont disponibles pour une Surveillance de requêtes SQL :

- **SQL en ligne** — indique si la base de données était accessible et si la requête a réussi.
- **Nombre de lignes de la requête SQL** — le nombre de lignes renvoyées. À comparer avec des opérateurs tels que supérieur à, inférieur à ou égal à.
- **Valeur scalaire de la requête SQL** — la première colonne de la première ligne. Comparée numériquement lorsque les deux côtés semblent numériques, sinon en tant que chaînes. C'est la vérification à utiliser pour les requêtes de type `COUNT(*)`.
- **Temps d'exécution de la requête SQL (en ms)** — la durée d'exécution de la requête. Utile pour détecter une base de données lente.
- **Erreur de la requête SQL** — le message d'erreur de la requête. Alertez lorsqu'il est (ou n'est pas) vide, ou lorsqu'il correspond à une chaîne spécifique.
- **Expression JavaScript** — évaluez une expression JavaScript personnalisée pour un contrôle total. Voir [Expressions JavaScript](/docs/monitor/javascript-expression).

### Exemple : alerter lorsque les annulations augmentent brusquement

En utilisant la requête ci-dessus :

- **Critère : Dégradé** — `Valeur scalaire de la requête SQL` est supérieure à `10`.
- **Critère : Hors ligne** — `Valeur scalaire de la requête SQL` est supérieure à `50`, ou `SQL en ligne` est `false`.

Associez une politique d'astreinte aux critères afin que les bonnes personnes soient alertées.

## Créer un utilisateur en lecture seule

Connectez-vous toujours avec un utilisateur dédié en lecture seule. Exemples :

```sql
-- PostgreSQL
CREATE USER oneuptime_ro WITH PASSWORD 'a-strong-password';
GRANT CONNECT ON DATABASE orders TO oneuptime_ro;
GRANT USAGE ON SCHEMA public TO oneuptime_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO oneuptime_ro;
-- Inclure les tables créées à l'avenir :
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO oneuptime_ro;
```

```sql
-- MySQL
CREATE USER 'oneuptime_ro'@'%' IDENTIFIED BY 'a-strong-password';
GRANT SELECT ON orders.* TO 'oneuptime_ro'@'%';
FLUSH PRIVILEGES;
```

```sql
-- Microsoft SQL Server
CREATE LOGIN oneuptime_ro WITH PASSWORD = 'a-strong-password';
USE orders;
CREATE USER oneuptime_ro FOR LOGIN oneuptime_ro;
ALTER ROLE db_datareader ADD MEMBER oneuptime_ro;
```

## Points à considérer

- La requête s'exécute à chaque vérification, alors gardez-la peu coûteuse. Utilisez des index et des fenêtres temporelles étroites, et appuyez-vous sur le Délai d'exécution de l'instruction comme filet de sécurité.
- Seuls le nombre de lignes, la première cellule (scalaire) et la première ligne sont renvoyés — concevez votre requête de sorte que la valeur sur laquelle vous souhaitez alerter soit la première colonne.
- Si le résultat est tronqué parce qu'il a dépassé le Nombre maximal de lignes, le résumé de la vérification le signale comme plafonné. N'augmentez le Nombre maximal de lignes que si nécessaire ; des ensembles de résultats plus volumineux consomment plus de mémoire sur la sonde.
- Les écritures et le DDL sont toujours rejetés. Si vous avez besoin de tester un chemin d'écriture, ce n'est pas l'objet de ce moniteur.
- Privilégiez un secret de moniteur plutôt qu'un mot de passe en clair afin que l'identifiant reste chiffré au repos.
