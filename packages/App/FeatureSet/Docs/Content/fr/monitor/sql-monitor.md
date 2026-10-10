# Surveillance de requêtes SQL

Le moniteur de requêtes SQL exécute selon un calendrier une requête SQL en lecture seule depuis une sonde et alerte sur le résultat — le nombre de lignes renvoyées, une valeur scalaire, la durée de la requête ou une erreur de requête. Il est conçu pour le cas « exécuter une requête et ouvrir un incident », par exemple alerter quand le nombre de commandes annulées dans les cinq dernières minutes s'envole, quand une table de file d'attente grossit trop, ou quand une ligne essentielle disparaît.

:::cards
- [Créer un utilisateur en lecture seule](#créer-un-utilisateur-en-lecture-seule): La connexion à la base de données que le moniteur doit utiliser.
- [Créer le moniteur](#créer-un-moniteur-de-requête-sql): Connecter une sonde et saisir la requête.
- [Écrire la requête](#écrire-la-requête): Placer la valeur sur laquelle vous alertez dans la première colonne.
- [Configurer les critères](#configurer-les-critères): Alerter sur un nombre, une valeur, une requête lente ou une erreur.
:::

## Fonctionnement

À chaque vérification, la sonde se connecte à votre base de données, exécute votre requête dans un contexte en lecture seule, relit au plus un nombre borné de lignes, et rapporte une projection compacte à OneUptime. Les critères de votre moniteur sont ensuite évalués sur cette projection.

Comme la requête s'exécute depuis une sonde à l'intérieur de votre réseau, OneUptime n'a jamais besoin d'une connexion directe à votre base de données, et le jeu de résultats complet ne quitte jamais la sonde — seule une petite projection bornée du résultat est rapportée.

```mermaid title="Seule une petite projection du résultat quitte votre réseau"
sequenceDiagram
    participant O as OneUptime
    participant P as Sonde
    participant D as Votre base de données
    O->>P: Paramètres du moniteur, secrets résolus
    P->>D: Votre requête, en lecture seule
    D-->>P: Jusqu'à Lignes max + 1 lignes
    P->>O: Nombre de lignes, scalaire, première ligne, durée, erreur
    O->>O: Évaluer les critères
```

La sonde ne rapporte que :

| Valeur | Ce que c'est |
|---|---|
| **Row Count** | Le nombre de lignes renvoyées par la requête (borné par la limite Lignes max). |
| **Valeur scalaire** | La première colonne de la première ligne. C'est la valeur naturelle d'une requête de type `SELECT COUNT(*)`. |
| **Première ligne** | La première ligne sous forme de paires colonne/valeur, affichée dans le résumé de la vérification pour le contexte. |
| **Durée d'exécution** | La durée de la vérification, en millisecondes — connexion comprise, pas seulement la requête. |
| **Erreur de requête** | Un message d'erreur assaini si la requête a échoué. |

Le jeu de résultats complet n'est jamais envoyé à OneUptime : les données de vos clients ne sont donc pas répliquées dans le stockage de OneUptime.

## Bases de données prises en charge

| Base de données | Port par défaut |
|---|---|
| **PostgreSQL** | `5432` |
| **MySQL** | `3306` |
| **Microsoft SQL Server** | `1433` |

Les moteurs compatibles MySQL et PostgreSQL qui parlent le même protocole réseau et le même dialecte SQL fonctionnent généralement aussi, mais seuls les trois moteurs ci-dessus sont officiellement testés.

Quand l'hôte et le port auxquels le moniteur se connecte sont l'un des points de terminaison d'une base de données de la page [Bases de données](/docs/telemetry/databases), ses alertes et incidents apparaissent aussi sur la page de cette base de données (voir [Alertes sur une base de données](/docs/telemetry/databases#alerts-on-a-database)). Un hôte donné comme référence à un secret de moniteur n'est pas rapproché.

## Modèle de sécurité

Exécuter une requête fournie par un client sur une base de données de production est délicat, c'est pourquoi le moniteur de requêtes SQL est en lecture seule par conception et empile plusieurs contrôles :

| Contrôle | Ce qu'il fait |
|---|---|
| **Utilisateur de base de données à privilèges minimaux** (contrôle principal) | Connectez-vous toujours avec un utilisateur de base de données dédié, en lecture seule, qui n'a accès qu'aux tables dont la requête a besoin. C'est le contrôle le plus important — voir [Créer un utilisateur en lecture seule](#créer-un-utilisateur-en-lecture-seule). |
| **Exécution en lecture seule** | Sur PostgreSQL et MySQL, la sonde ouvre une transaction `READ ONLY`, qui rejette toute écriture (y compris les CTE d'écriture) quel que soit le texte de la requête. Sur Microsoft SQL Server, qui n'a pas de transaction en lecture seule, la sonde s'exécute dans une transaction toujours annulée. |
| **Une seule instruction, requêtes autorisées** | La requête doit être une seule instruction qui commence par `SELECT`, `WITH`, `VALUES` ou `TABLE`. Les instructions empilées (`SELECT 1; DROP TABLE …`) et les mots-clés d'écriture ou de DDL comme `INSERT`, `UPDATE`, `DELETE`, `DROP`, `EXEC` et `INTO` sont rejetés par la sonde avant qu'elle ne se connecte. Cette vérification est un filet de sécurité, pas la frontière : la frontière, c'est l'utilisateur en lecture seule. |
| **Délai d'instruction** | Chaque requête a une limite de temps stricte. Une requête trop longue est annulée. |
| **Lignes bornées** | Au plus Lignes max (plus une, pour détecter une troncature) lignes sont relues, ce qui plafonne la mémoire de la sonde et la taille des données envoyées. |
| **Masquage des identifiants** | Les erreurs de base de données sont assainies avant d'être stockées — le mot de passe, l'hôte, le nom d'utilisateur et le nom de la base de données, ainsi que toute chaîne de connexion, sont masqués, pour que les identifiants ne fuient jamais dans les messages d'erreur. |

## Avant de commencer

- Une **sonde** ayant un accès réseau à l'hôte et au port de votre base de données. Ce peut être une sonde hébergée par OneUptime (si votre base de données est joignable depuis Internet) ou une [sonde personnalisée](/docs/probe/custom-probe) qui tourne dans votre réseau.
- Un **utilisateur de base de données en lecture seule** et les informations de connexion (hôte, port, nom de la base, nom d'utilisateur, mot de passe), ou une identité Windows/de domaine en lecture seule avec l'authentification intégrée de SQL Server.

## Créer un utilisateur en lecture seule

Connectez-vous toujours avec un utilisateur dédié en lecture seule. Exécutez les instructions de votre moteur en tant qu'administrateur, en remplaçant `orders` par votre base de données :

:::tabs
@tab PostgreSQL
```sql
-- PostgreSQL
CREATE USER oneuptime_ro WITH PASSWORD 'a-strong-password';
GRANT CONNECT ON DATABASE orders TO oneuptime_ro;
GRANT USAGE ON SCHEMA public TO oneuptime_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO oneuptime_ro;
-- Include tables created in the future:
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO oneuptime_ro;
```
@tab MySQL
```sql
-- MySQL
CREATE USER 'oneuptime_ro'@'%' IDENTIFIED BY 'a-strong-password';
GRANT SELECT ON orders.* TO 'oneuptime_ro'@'%';
FLUSH PRIVILEGES;
```
@tab Microsoft SQL Server
```sql
-- Microsoft SQL Server
CREATE LOGIN oneuptime_ro WITH PASSWORD = 'a-strong-password';
USE orders;
CREATE USER oneuptime_ro FOR LOGIN oneuptime_ro;
ALTER ROLE db_datareader ADD MEMBER oneuptime_ro;
```
:::

Pour un octroi plus restreint, donnez à l'utilisateur `SELECT` sur les seules tables que lit votre requête.

## Créer un moniteur de requête SQL

:::steps
### Commencer un nouveau moniteur

Allez dans **Moniteurs** et cliquez sur **Créer un moniteur**. Sous **Type de moniteur**, cliquez sur **Plus de types de moniteurs** et choisissez **SQL Query** sous **Database Monitoring**, ou tapez `query` dans le champ de recherche. Saisissez un **Nom**, puis cliquez sur **Suivant**.

### Saisir les informations de connexion

Choisissez le **Type de base de données** — le port passe à la valeur par défaut de ce moteur — puis renseignez l'hôte, le nom de la base de données et les identifiants de l'utilisateur en lecture seule. Faites référence au mot de passe par un [secret de moniteur](#utiliser-un-secret-de-moniteur-pour-le-mot-de-passe) plutôt que de le saisir. Chaque champ est décrit dans [Configuration](#configuration).

### Saisir la requête

Tapez une seule instruction en lecture seule dans **SQL Query** (voir [Écrire la requête](#écrire-la-requête)).

### La tester

Cliquez sur **Tester le moniteur** pour exécuter la requête une fois depuis une sonde avant d'enregistrer.

### Définir les critères

Passez en revue les critères de départ du moniteur et ajoutez les vôtres — voir [Configurer les critères](#configurer-les-critères). Cliquez ensuite sur **Suivant**.

### Choisir les sondes et créer

Sélectionnez les **Sondes** qui atteignent la base de données et un **Intervalle de surveillance**, puis cliquez sur **Créer un moniteur**.
:::

## Configuration

| Champ | Ce qu'il faut saisir |
|---|---|
| **Type de base de données** | PostgreSQL, MySQL ou Microsoft SQL Server. Choisir un type définit le port par défaut. |
| **Hôte** | L'hôte de la base de données joignable depuis la sonde (par exemple `db.internal`). |
| **Port** | Le port de la base de données. |
| **Nom de la base de données** | La base de données sur laquelle exécuter la requête. |
| **Use Windows Integrated Authentication** | Microsoft SQL Server uniquement. S'authentifier avec le compte qui exécute la sonde au lieu d'un nom d'utilisateur et d'un mot de passe SQL. Voir [Authentification Windows intégrée](#authentification-windows-intégrée). |
| **Nom d'utilisateur** | Un utilisateur de base de données en lecture seule, à privilèges minimaux. |
| **Mot de passe** | Le mot de passe de la base de données. Nous recommandons vivement de faire référence à un [secret de moniteur](/docs/monitor/monitor-secrets) avec `{{monitorSecrets.name}}` plutôt que de saisir le mot de passe en clair (voir [Utiliser un secret de moniteur pour le mot de passe](#utiliser-un-secret-de-moniteur-pour-le-mot-de-passe)). |
| **SQL Query** | La requête en lecture seule à exécuter (voir [Écrire la requête](#écrire-la-requête)). |
| **Use SSL/TLS** | Activez-le pour vous connecter en TLS. Une fois activé, vous pouvez désactiver **Verify server certificate** si la base de données utilise un certificat auto-signé. |

### Plus de champs

| Champ | Par défaut | Maximum | Ce qu'il limite |
|---|---|---|---|
| **Délai de connexion (ms)** | `10000` | `30000` | Le temps d'attente pour établir une connexion. |
| **Statement Timeout (ms)** | `15000` | `60000` | La limite stricte de durée d'exécution de la requête. |
| **Lignes max** | `100` | `1000` | Le plafond de lignes relues depuis la base de données. |

Une valeur au-dessus du maximum est ramenée au maximum.

### Authentification Windows intégrée

Pour Microsoft SQL Server, activez **Use Windows Integrated Authentication** pour ouvrir une connexion approuvée avec l'identité du processus de la sonde. Les champs Nom d'utilisateur et Mot de passe sont ignorés dans ce mode et ne sont pas transmis au pilote. Comme la sonde a besoin d'une identité approuvée par votre domaine, utilisez une sonde auto-hébergée pour ce mode d'authentification.

| La sonde s'exécute sur | Ce qu'il faut configurer |
|---|---|
| **Windows** | Exécuter le service de la sonde sous un compte de domaine qui dispose d'une connexion SQL Server en lecture seule. |
| **Linux ou macOS** | Configurer Kerberos pour le domaine SQL Server et donner au processus de la sonde un ticket valide (par exemple via un keytab). L'image Linux officielle de la sonde inclut Microsoft ODBC Driver 18, unixODBC et le client Kerberos. Montez la configuration Kerberos et le cache de tickets dans le conteneur, rendez-les lisibles par le processus de la sonde, et définissez `KRB5_CONFIG` ou `KRB5CCNAME` quand leurs emplacements ne sont pas ceux par défaut. |

La sonde a besoin d'un Microsoft ODBC Driver for SQL Server installé sur l'hôte qui l'exécute. L'image officielle de la sonde embarque **ODBC Driver 18**. Quand vous exécutez une sonde auto-hébergée ou personnalisée, elle détecte et utilise automatiquement le plus récent `ODBC Driver N for SQL Server` enregistré sur l'hôte (par exemple Driver 17 si c'est celui installé) — il n'est pas nécessaire d'avoir exactement Driver 18. Pour imposer un pilote précis, définissez la variable d'environnement `SQL_SERVER_ODBC_DRIVER` de la sonde avec le nom exact du pilote (par exemple `ODBC Driver 17 for SQL Server`).

SQL Server doit avoir un nom de principal de service `MSSQLSvc` approprié, les horloges de la sonde et du contrôleur de domaine doivent être synchronisées, et la sonde doit résoudre et atteindre SQL Server par le nom d'hôte couvert par ce principal de service. N'accordez à l'identité approuvée que les permissions de base de données dont la requête de surveillance a besoin.

## Écrire la requête

La requête doit être une **instruction unique en lecture seule**. Elle doit commencer par `SELECT`, `WITH`, `VALUES` ou `TABLE`. Un point-virgule final est autorisé ; plusieurs instructions ne le sont pas. Les mots-clés d'écriture et de DDL sont rejetés n'importe où dans la requête — y compris `INTO`, donc `SELECT … INTO` est refusé aussi.

La sonde vérifie la requête à chaque vérification, pas à l'enregistrement. Une requête qui enfreint ces règles s'enregistre, puis chaque vérification échoue avec "Only read-only queries are allowed (must start with SELECT, WITH, VALUES, or TABLE)." — les critères par défaut mettent le moniteur hors ligne.

Gardez des requêtes peu coûteuses et bien ciblées — elles s'exécutent à chaque vérification, alors privilégiez les colonnes indexées et des fenêtres de temps étroites. Cette requête compte les commandes annulées dans les cinq dernières minutes :

:::tabs
@tab PostgreSQL
```sql
-- Count recent cancellations (PostgreSQL)
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > NOW() - INTERVAL '5 minutes';
```
@tab MySQL
```sql
-- The same idea on MySQL
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > NOW() - INTERVAL 5 MINUTE;
```
@tab Microsoft SQL Server
```sql
-- The same idea on Microsoft SQL Server
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > DATEADD(minute, -5, GETDATE());
```
:::

> [!TIP]
> Pour une requête de type `COUNT(*)`, le nombre est disponible à la fois comme **Row Count** (qui vaut `1`, puisqu'une ligne est renvoyée) et comme **Valeur scalaire** (le nombre lui-même, tiré de la première colonne). Pour alerter sur « combien », comparez à la **Valeur scalaire**.

## Utiliser un secret de moniteur pour le mot de passe

Pour que le mot de passe de la base de données ne soit jamais stocké en clair sur le moniteur, créez un [secret de moniteur](/docs/monitor/monitor-secrets) et faites-y référence depuis le champ Mot de passe :

:::steps
1. Allez dans **Moniteurs → Paramètres → Secrets** et créez un secret de moniteur.
2. Nommez-le (par exemple `dbPassword`) et donnez à ce moniteur l'accès à ce secret.
3. Dans le champ **Mot de passe** du moniteur, saisissez `{{monitorSecrets.dbPassword}}`.
:::

OneUptime résout le secret côté serveur avant de remettre la configuration à la sonde. OneUptime ne crée jamais ces secrets à votre place — y faire référence est votre choix. Les champs **Nom d'utilisateur**, **Hôte**, **Nom de la base de données** et **SQL Query** acceptent aussi les références à des secrets ; **Port** non.

## Configurer les critères

Ajoutez des critères pour décider quand le moniteur est considéré comme en ligne, dégradé ou hors ligne. Ces vérifications sont disponibles pour un moniteur de requête SQL :

| Type de filtre | Ce qu'il vérifie |
|---|---|
| **SQL Is Online** | Si la base de données était joignable et si la requête a réussi. |
| **SQL Query Row Count** | Le nombre de lignes renvoyées. Comparez avec des opérateurs comme supérieur à, inférieur à ou égal à. |
| **SQL Query Scalar Value** | La première colonne de la première ligne. Comparée comme un nombre quand la valeur saisie est un nombre, sinon comme une chaîne. C'est la vérification à utiliser pour les requêtes de type `COUNT(*)`. |
| **SQL Query Execution Time (in ms)** | La durée de la requête. Utile pour repérer une base de données lente. |
| **SQL Query Error** | Le message d'erreur de la requête. Alertez quand il est vide (ou non), ou quand il correspond à une chaîne précise. |
| **JavaScript Expression** | Évaluer une expression JavaScript personnalisée sur `rowCount`, `scalarValue`, `firstRow`, `executionTimeInMs`, `queryError` et `isOnline`. Voir [Expressions JavaScript](/docs/monitor/javascript-expression#moniteurs-de-requêtes-sql). |

Les seuils numériques sont des nombres entiers : écrivez `10`, pas `10.5`. Les filtres SQL Query ne peuvent pas être évalués sur une période ; chaque vérification est indépendante.

Un nouveau moniteur de requête SQL commence avec deux critères : **SQL Is Online** est faux — le moniteur passe hors ligne et déclare un incident qui se résout de lui-même — et **SQL Is Online** est vrai, ce qui le marque en ligne. **Ajouter un critère** en ajoute un en bas de la liste ; faites-le glisser au-dessus du critère en ligne, car les critères sont vérifiés depuis le haut et le premier qui correspond décide.

### Exemple : alerter quand les annulations s'envolent

Avec la requête ci-dessus :

| Critère | Filtre |
|---|---|
| **Dégradé** | `SQL Query Scalar Value` est supérieur à `10`. |
| **Hors ligne** | `SQL Query Scalar Value` est supérieur à `50`, ou `SQL Is Online` est `false`. |

Associez une politique d'astreinte au critère pour que les bonnes personnes soient appelées. Un moniteur de requête SQL n'a pas de variables de modèle propres : le titre d'un incident peut nommer le moniteur avec `{{monitorName}}`, mais ne peut pas citer le résultat de la requête.

## Points à considérer

- La requête s'exécute à chaque vérification, alors gardez-la peu coûteuse. Utilisez des index et des fenêtres de temps étroites, et comptez sur le délai d'instruction comme filet de sécurité.
- Seuls le nombre de lignes, la première cellule (scalaire) et la première ligne sont rapportés — concevez votre requête pour que la valeur sur laquelle vous voulez alerter soit dans la première colonne.
- Si le résultat est tronqué parce qu'il dépassait Lignes max, le résumé de la vérification affiche **Rows Truncated** : "Yes (result capped)". N'augmentez Lignes max qu'en cas de besoin ; des jeux de résultats plus grands coûtent plus de mémoire sur la sonde.
- Les écritures et le DDL sont toujours rejetés. Si vous devez tester un chemin d'écriture, ce n'est pas le rôle de ce moniteur.
- Préférez un secret de moniteur à un mot de passe en clair pour que l'identifiant reste chiffré au repos.
- Une vérification dont la requête échoue est retentée une seconde plus tard, jusqu'à trois fois de plus, avant de rapporter l'erreur, pour qu'une brève coupure de connexion ne mette pas le moniteur hors ligne. Sur une sonde auto-hébergée, `PROBE_MONITOR_RETRY_LIMIT` définit le nombre de tentatives.

## Dépannage

:::details Chaque vérification échoue avec "Only read-only queries are allowed"
La requête ne commence pas par `SELECT`, `WITH`, `VALUES` ou `TABLE`. Un commentaire avant elle ne pose pas de problème ; un `SET` ou un `DECLARE`, si. Réécrivez-la en une seule instruction en lecture seule.
:::

:::details Une vérification échoue avec "Disallowed SQL keyword"
Un mot-clé d'écriture, de DDL ou d'exécution apparaît quelque part dans la requête, même à l'intérieur d'un `SELECT`, comme `INTO` ou `EXEC`. Les mots entre guillemets et dans les commentaires ne comptent pas. Retirez le mot-clé, ou placez la logique dans une vue que l'utilisateur en lecture seule peut lire.
:::

:::details La vérification expire
La sonde n'a pas pu se connecter dans le **Délai de connexion (ms)**, ou la requête a duré plus longtemps que **Statement Timeout (ms)**. Vérifiez que la sonde atteint l'hôte et le port, puis rendez la requête moins coûteuse : filtrez sur des colonnes indexées dans une courte fenêtre de temps.
:::

:::details La connexion échoue avec une erreur de certificat
Le certificat de la base de données est auto-signé, ou la sonde ne lui fait pas confiance. Désactivez **Verify server certificate**, qui apparaît une fois **Use SSL/TLS** activé, ou donnez à la base de données un certificat auquel la sonde fait confiance.
:::

:::details L'authentification Windows intégrée échoue
La sonde a besoin d'un Microsoft ODBC Driver for SQL Server et d'une identité approuvée par votre domaine. Exécutez l'image officielle de la sonde, ou installez le pilote, puis vérifiez la configuration dans [Authentification Windows intégrée](#authentification-windows-intégrée).
:::

## Prochaines étapes

:::cards
- [Surveillance de la santé des bases de données](/docs/monitor/database-health-monitor): Surveiller connexions, verrous et réplication sans écrire de SQL.
- [Secrets de surveillance](/docs/monitor/monitor-secrets): Garder le mot de passe de la base de données chiffré.
- [Expressions JavaScript](/docs/monitor/javascript-expression): Écrire des critères qui combinent plusieurs valeurs.
- [Sondes personnalisées](/docs/probe/custom-probe): Exécuter des vérifications depuis votre réseau.
:::
