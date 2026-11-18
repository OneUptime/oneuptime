/*
 * The Data Observability Documentation page in French: the
 * English text of Pages/DataObservability/Documentation.tsx, translated. Its
 * code, field names, metric names and product names are as the English
 * writes them, and it names what the product draws as the Dashboard's
 * French words it. Change it with the English, in the same pull
 * request (DataObservabilityDocumentationInLocale).
 */
const DOCUMENTATION: string = `
## Ce que surveille Data Observability

Chaque table et chaque vue de chaque base de données connectée, toutes les cinq minutes :

- **Nombre de lignes et taille**, d'après les statistiques propres au moteur.
- **Quand elle a changé pour la dernière fois** : MySQL et SQL Server l'indiquent ; pour PostgreSQL, OneUptime surveille les compteurs d'insertions, de mises à jour et de suppressions et note quand ils bougent.
- **Ses colonnes** : une colonne ajoutée, supprimée, renommée, changée de type ou rendue nullable apparaît dans la chronologie de la table et dans les modifications de schéma.
- **Son rythme habituel** : la fréquence à laquelle elle change d'habitude. Une table qui dépasse nettement son rythme apparaît comme **En retard**.

Seul le catalogue de la base de données est lu, et sur MongoDB les noms de champs des documents les plus récents d'une collection. Aucune valeur ne quitte la base de données.

Un catalogue peut dire qu'une table a changé alors que seule sa maintenance interne a changé, ou ne rien dire du tout. Dans les **Paramètres** d'une table, indiquez une **Colonne Freshness** comme \`updated_at\`, et sa dernière modification devient la valeur la plus récente de cette colonne. L'identifiant de connexion doit pouvoir lire la colonne, et elle devrait être indexée.

Un réplica en lecture PostgreSQL ou SQL Server ne fait pas bouger ses compteurs d'écriture ; OneUptime les ignore donc à cet endroit et le signale sur la base de données.

## La vue d'ensemble

La **Vue d'ensemble** indique où en sont vos données. Tant que le projet n'est pas configuré, elle liste les étapes restantes : des alertes sur chaque base de données, des propriétaires pour les tables, une vérification et les exécutions de vos pipelines. **À traiter** liste ce qui demande l'intervention de quelqu'un, le plus grave en premier : une base de données qui n'a pas pu être lue, une exécution de pipeline en échec ou en retard, une vérification en échec ou qui n'a pas pu s'exécuter, un rapprochement qui a divergé, et un produit de données ou une table en retard. Chaque élément indique à qui il appartient et si son alerte est ouverte, ou que personne n'est prévenu parce que sa base de données n'a aucune alerte activée, et ouvre la page où il se corrige. **Bases de données** montre comment s'est passée la dernière lecture de chaque base de données et si ses alertes sont activées. Le nombre à côté de **Vue d'ensemble** dans le menu compte ce qui demande quelqu'un, et **Problèmes**, juste en dessous, les liste tous, une page à la fois, filtrés par type, base de données, propriétaire (ou **Aucun propriétaire**) et selon qu'une alerte est ouverte. Chaque nombre de la **Vue d'ensemble** ouvre sa liste : **À traiter** ouvre **Problèmes**, **Tables en retard** ouvre **Tables** avec seulement les tables en retard, et **Vérifications en échec** ouvre **Vérifications** avec seulement les contrôles en échec.

## Connecter une base de données

Utilisez un **identifiant en lecture seule**. Dans la vue d'ensemble ou dans Bases de données, choisissez **Connecter une base de données**, puis l'une des deux options :

- **OneUptime se connecte** : collez une chaîne de connexion. Elle est stockée chiffrée et n'est plus jamais affichée.
- **Une sonde de mon réseau se connecte** : choisissez l'une des sondes de ce projet et indiquez la variable d'environnement de la sonde qui contient la chaîne de connexion (par exemple \`ORDERS_DB_URL\`). La chaîne de connexion ne quitte jamais votre réseau. Mettez d'abord la sonde à jour vers la dernière version.

Une base de données déjà connectée pour la Sécurité des données est également surveillée.

**Bases de données que vous pourriez connecter**, sur la même page, liste ce que votre projet connaît déjà et que personne n'a connecté : les bases de données auxquelles parlent vos traces, celles de vos comptes cloud et celles que surveille la Surveillance des bases de données. **Connecter** pré-remplit le formulaire avec ce que l'on sait de chacune. Rien n'est lu tant que vous ne la connectez pas.

## Chemins de stockage

Un export qui arrive chaque nuit dans un bucket est aussi en retard, ou aussi incomplet, que n'importe quelle table. Sous **Chemins de stockage**, choisissez **Modifier les chemins** pour un bucket trouvé par votre connexion cloud, sur Amazon S3, Google Cloud Storage ou un compte de stockage Azure, et indiquez les chemins qui comptent, un par ligne. Chacun apparaît sous **Tables** : son objet le plus récent indique sa dernière modification, ses objets sont ses lignes, et les mêmes alertes s'appliquent. Seuls les noms, tailles et dates sont lus, jamais un objet.

### Un identifiant en lecture seule, par moteur

PostgreSQL :

\`\`\`sql
CREATE ROLE oneuptime_reader LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE orders TO oneuptime_reader;
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
\`\`\`

MySQL et MariaDB (\`performance_schema\` permet à OneUptime de voir les écritures entre deux collectes) :

\`\`\`sql
CREATE USER 'oneuptime_reader'@'%' IDENTIFIED BY '...';
GRANT SHOW VIEW, REFERENCES ON orders.* TO 'oneuptime_reader'@'%';
GRANT SELECT ON performance_schema.table_io_waits_summary_by_table TO 'oneuptime_reader'@'%';
\`\`\`

SQL Server (\`VIEW DATABASE STATE\` permet à OneUptime de lire les tailles et les dernières mises à jour) :

\`\`\`sql
CREATE LOGIN oneuptime_reader WITH PASSWORD = '...';
CREATE USER oneuptime_reader FOR LOGIN oneuptime_reader;
GRANT VIEW DEFINITION TO oneuptime_reader;
GRANT VIEW DATABASE STATE TO oneuptime_reader;
\`\`\`

Amazon Redshift : connectez-vous avec une chaîne de connexion PostgreSQL au point de terminaison du cluster ou du groupe de travail, par exemple \`postgres://oneuptime_reader:...@cluster.abc123.us-east-1.redshift.amazonaws.com:5439/dev?sslmode=require\`. \`SYSLOG ACCESS UNRESTRICTED\` permet à OneUptime de lire le nombre de lignes et les tailles (\`svv_table_info\`), les dernières écritures et lectures des requêtes de chaque utilisateur (\`stl_insert\`, \`stl_delete\`, \`stl_scan\`, conservées quelques jours) et le lignage des requêtes de chaque utilisateur. Sans lui, le changement des lignes d'une table indique tout de même quand elle a changé.

\`\`\`sql
CREATE USER oneuptime_reader PASSWORD '...';
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
ALTER USER oneuptime_reader SYSLOG ACCESS UNRESTRICTED;
\`\`\`

Snowflake : créez un utilisateur avec une paire de clés (sans mot de passe), et connectez-vous avec un JSON indiquant l'identifiant du compte, l'utilisateur, la clé privée (PKCS#8 non chiffrée), la base de données et un entrepôt pour les vérifications :

\`\`\`json
{ "account": "myorg-myaccount", "user": "ONEUPTIME_READER", "privateKey": "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----", "database": "ANALYTICS", "warehouse": "CHECKS_WH", "role": "ONEUPTIME_READER" }
\`\`\`

La collecte lit le catalogue avec SHOW, qui n'a besoin d'aucun entrepôt, et ne coûte donc aucun crédit. Seules les vérifications de données s'exécutent sur l'entrepôt, selon le planning que vous leur donnez. Snowflake n'indique la dernière modification d'aucune table ; une table a donc changé quand ses lignes ou ses octets ont bougé.

\`\`\`sql
CREATE ROLE ONEUPTIME_READER;
GRANT USAGE ON DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT USAGE ON ALL SCHEMAS IN DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT REFERENCES ON ALL TABLES IN DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT USAGE ON WAREHOUSE CHECKS_WH TO ROLE ONEUPTIME_READER;
-- Warehouse spend reads SNOWFLAKE.ACCOUNT_USAGE.
GRANT IMPORTED PRIVILEGES ON DATABASE SNOWFLAKE TO ROLE ONEUPTIME_READER;
-- Checks read rows: SELECT on the tables they check.
CREATE USER ONEUPTIME_READER DEFAULT_ROLE = ONEUPTIME_READER RSA_PUBLIC_KEY = 'MIIBIjANBgkqh...';
GRANT ROLE ONEUPTIME_READER TO USER ONEUPTIME_READER;
\`\`\`

Google BigQuery : chaque jeu de données trouvé par votre connexion Google Cloud est déjà surveillé, avec le compte de service de cette connexion, sans rien à connecter. Donnez au compte de service **BigQuery Metadata Viewer** et **BigQuery Job User** sur le projet, et **BigQuery Data Viewer** sur les tables que lisent vos vérifications. Chaque collecte lit \`__TABLES__\` du jeu de données (lignes, octets et dernière modification, sans frais) et ses \`INFORMATION_SCHEMA.COLUMNS\` (facturées au minimum de 10 Mo de BigQuery). Ajoutez **BigQuery Resource Viewer** sur le projet pour le lignage issu de ses jobs, lu une fois par heure (voir Le lignage que donnent les bases de données). Pour connecter un jeu de données sans connexion Google Cloud, choisissez **Google BigQuery** et donnez un JSON avec une clé de compte de service :

\`\`\`json
{ "projectId": "my-project", "dataset": "analytics", "location": "US", "serviceAccountJson": { "type": "service_account", "...": "..." } }
\`\`\`

ClickHouse : connectez-vous via son interface HTTP, port 8443 avec TLS (ClickHouse Cloud) ou 8123 sans, par exemple \`clickhouse://oneuptime_reader:...@abc123.us-east-1.aws.clickhouse.cloud:8443/analytics\`. Indiquez une base de données pour ne surveiller qu'elle ; omettez-la pour surveiller toutes les bases de données sauf celles du serveur lui-même. \`system.parts\` permet à OneUptime de voir chaque insertion entre deux collectes (une fusion ne compte pas), \`system.part_log\`, là où le serveur le tient, donne l'heure de chaque insertion, et \`system.query_log\` donne la dernière lecture de chaque table et le lignage issu de \`INSERT ... SELECT\`, une fois par heure. Chaque instruction s'exécute avec \`readonly\` défini, si bien que même un identifiant qui pourrait écrire ne le peut pas.

\`\`\`sql
CREATE USER oneuptime_reader IDENTIFIED BY '...' SETTINGS readonly = 2;
GRANT SHOW TABLES, SHOW COLUMNS ON *.* TO oneuptime_reader;
GRANT SELECT ON system.parts TO oneuptime_reader;
GRANT SELECT ON system.part_log TO oneuptime_reader;
GRANT SELECT ON system.query_log TO oneuptime_reader;
-- Checks read rows: SELECT on the tables they check.
\`\`\`

Databricks : un catalogue Unity Catalog est une base de données. Ses schémas, tables, vues et colonnes, et le dernier commit de chaque table Delta, sont lus via l'API REST d'Unity Catalog sans entrepôt SQL ; la collecte ne coûte donc aucun calcul. Les vérifications de données, ainsi que le lignage, les dernières écritures et les dernières lectures issus de la table système \`system.access.table_lineage\` (une fois par heure), s'exécutent sur l'entrepôt SQL que vous indiquez. Connectez-vous avec un principal de service (ou un jeton d'accès personnel à la place de \`clientId\` et \`clientSecret\` : \`"token": "dapi..."\`) :

\`\`\`json
{ "host": "adb-1234567890123456.7.azuredatabricks.net", "clientId": "...", "clientSecret": "...", "catalog": "main", "warehouseId": "abc123def456" }
\`\`\`

\`\`\`sql
GRANT USE CATALOG, BROWSE ON CATALOG main TO \`oneuptime-reader\`;
GRANT USE SCHEMA ON CATALOG main TO \`oneuptime-reader\`;
GRANT USE CATALOG ON CATALOG system TO \`oneuptime-reader\`;
GRANT USE SCHEMA, SELECT ON SCHEMA system.access TO \`oneuptime-reader\`;
-- Checks read rows: SELECT on the tables they check. And CAN USE on the SQL warehouse.
\`\`\`

Oracle : connectez-vous avec \`oracle://oneuptime_reader:...@orders-db.internal:1521/ORCLPDB1\`, ou un JSON \`{ "user", "password", "connectString" }\`. La lecture passe par le protocole propre à Oracle, sans client Oracle à installer. L'identifiant voit les tables qu'il a le droit de lire : accordez \`READ\` sur chaque table à surveiller (il peut les interroger, jamais les verrouiller ni les modifier). \`SELECT_CATALOG_ROLE\` permet à OneUptime de lire la taille de chaque table ; sans lui, seules les tables propres à l'identifiant en ont une. \`ALL_TAB_MODIFICATIONS\` indique les insertions, mises à jour et suppressions de chaque table depuis ses dernières statistiques, et quand elle a changé pour la dernière fois.

\`\`\`sql
CREATE USER oneuptime_reader IDENTIFIED BY "...";
GRANT CREATE SESSION TO oneuptime_reader;
GRANT READ ON sales.orders TO oneuptime_reader;
GRANT SELECT_CATALOG_ROLE TO oneuptime_reader;
\`\`\`

Amazon Athena : une base de données Glue est une base de données. Ses tables et vues, leurs colonnes et statistiques, et le dernier commit de chaque table Iceberg proviennent de l'API du Glue Data Catalog, qui ne lit aucune donnée et ne coûte rien ; les vérifications s'exécutent comme des requêtes Athena dans le groupe de travail que vous indiquez. Connectez-vous avec les clés d'un utilisateur ou d'un rôle IAM autorisé à lire la base de données Glue et à exécuter des requêtes Athena :

\`\`\`json
{ "region": "us-east-1", "accessKeyId": "AKIA...", "secretAccessKey": "...", "database": "analytics", "workgroup": "primary", "outputLocation": "s3://acme-athena-results/oneuptime/" }
\`\`\`

Il lui faut \`glue:GetDatabase\` et \`glue:GetTables\` sur la base de données et ses tables, et pour les vérifications \`athena:StartQueryExecution\`, \`athena:GetQueryExecution\`, \`athena:GetQueryResults\` et \`athena:StopQueryExecution\` sur le groupe de travail, avec un accès en lecture aux données S3 des tables et en écriture à l'emplacement de sortie.

MongoDB : connectez-vous avec sa chaîne de connexion - \`mongodb+srv://oneuptime_reader:...@cluster0.example.mongodb.net/\`, ou \`mongodb://\` avec les hôtes d'un jeu de réplicas. Une base de données dans le chemin est la seule surveillée ; sans elle, toutes les bases de données que l'identifiant peut lire le sont. Les documents, la taille et les écritures de chaque collection proviennent de \`$collStats\`, et le moment où elle a reçu un document pour la dernière fois, de son \`_id\` le plus récent. Ses champs proviennent du schéma JSON de son validateur, ou à défaut des noms et types des champs de ses 100 documents les plus récents, calculés dans la base de données afin qu'aucune valeur ne la quitte. Les documents sont lus sur un secondaire s'il y en a un. La collection source d'une vue constitue du lignage, et une vérification personnalisée est un pipeline d'agrégation, en JSON.

\`\`\`javascript
use admin
db.createUser({
  user: "oneuptime_reader",
  pwd: "...",
  roles: [{ role: "readAnyDatabase", db: "admin" }]
})
\`\`\`

Pour ne surveiller qu'une base de données, accordez \`{ role: "read", db: "orders" }\` à la place de \`readAnyDatabase\`.

Microsoft Dataverse : un environnement est une base de données, ses tables dans \`dbo\`, comme les nomme son point de terminaison SQL. OneUptime se connecte en tant qu'application : enregistrez-en une dans Microsoft Entra ID avec un secret client, et ajoutez-la à l'environnement comme utilisateur d'application (Power Platform admin center > the environment > Settings > Users + permissions > Application users) avec un rôle de sécurité autorisé à lire les tables. Connectez-vous avec un JSON, ou avec une chaîne de connexion Dataverse qui indique \`AuthType=ClientSecret\`. Le locataire peut être omis : l'environnement indique dans lequel il se trouve.

\`\`\`json
{ "environmentUrl": "https://contoso.crm.dynamics.com", "tenantId": "...", "clientId": "...", "clientSecret": "..." }
\`\`\`

Toutes les cinq minutes, la Web API donne la définition de chaque table, ses lignes, issues de l'instantané que Dataverse prend une fois par jour (elles ont donc jusqu'à un jour de retard), et son \`modifiedon\` le plus récent, qui est le moment de sa dernière modification. Ses colonnes sont lues une fois par heure. Chaque lecture compte dans les limites de requêtes Dataverse de l'application, et une collecte à qui l'on demande de ralentir laisse le reste à la suivante. Un environnement contient des centaines de tables propres ; seules les tables métier principales (comptes, contacts, prospects, opportunités, devis, commandes, factures, produits, incidents, e-mails, appels téléphoniques, rendez-vous, tâches et notes) et vos propres tables personnalisées sont donc surveillées. Les tables des applications de Microsoft (\`msdyn_\`, \`adx_\` et les autres préfixes \`ms\`) sont exclues : indiquez toute autre table à surveiller, comme dans \`"tables": ["msdyn_workorder"]\`.

Les vérifications de données s'exécutent en SQL en lecture seule sur le point de terminaison TDS de l'environnement, sur le port 1433 ou 5558. Il est activé sauf si un administrateur l'a désactivé ; là où le contrôle d'accès au niveau utilisateur est activé pour lui, le rôle de l'application a besoin du privilège **Allow user to access TDS endpoint**. Son SQL n'a ni expressions régulières, ni \`WITH\`, ni échantillonnage.

## Les métriques qu'écrit chaque table

Chaque collecte les écrit pour chaque table, afin que vous puissiez les afficher en graphique, les mettre sur des tableaux de bord et créer des alertes dessus comme pour toute autre métrique :

| Métrique | Ce qu'elle est |
| --- | --- |
| \`oneuptime.data.table.row_count\` | Lignes de la table |
| \`oneuptime.data.table.size\` | Octets qu'occupent la table et ses index |
| \`oneuptime.data.table.seconds_since_change\` | Secondes depuis la dernière insertion, mise à jour ou suppression d'une ligne |
| \`oneuptime.data.table.overdue_seconds\` | Secondes de dépassement de la table par rapport au moment où elle change d'habitude ; 0 tant qu'elle est à l'heure. Écrite une fois son rythme appris |
| \`oneuptime.data.table.row_count_change_percent\` | De combien le nombre de lignes a bougé depuis la collecte précédente, en pourcentage (-50 signifie que la moitié des lignes a disparu). Les tables de moins de 1 000 lignes sont exclues |
| \`oneuptime.data.table.schema_changes\` | Colonnes modifiées depuis la collecte précédente |
| \`oneuptime.data.table.breaking_schema_changes\` | Colonnes supprimées, renommées ou changées de type depuis la collecte précédente |

Chaque ligne porte \`oneuptime.data.store.id\`, \`oneuptime.data.store.name\`, \`oneuptime.data.table.id\`, \`oneuptime.data.table.schema\`, \`oneuptime.data.table.name\` et \`oneuptime.data.table.key\` (\`schema.table\`). Un moniteur de métriques groupé par \`oneuptime.data.table.key\` alerte une fois par table, et ses filtres **Anormalement élevé** et **Anormalement bas** comparent chaque table à sa propre valeur habituelle pour cette heure de la semaine, sans qu'aucun seuil ne soit à définir.

## Alertes

Une base de données que vous connectez s'ouvre sur ses **Alertes recommandées** ; plus tard, choisissez-les pour elle dans **Bases de données**. Chaque recommandation est un moniteur de métriques pour toute la base de données qui alerte une fois par table, si bien qu'une table créée plus tard est surveillée elle aussi :

| Alerte | Se déclenche quand |
| --- | --- |
| **La table est en retard** | Une table reste au-delà du moment où elle change d'habitude pendant quinze minutes - la même règle que la pastille **En retard** |
| **Forte baisse du nombre de lignes** | Une table perd la moitié de ses lignes ou plus entre deux collectes |
| **Nombre de lignes anormalement bas** | Une table contient bien moins de lignes que d'habitude pour cette heure de la semaine (apprend sur deux semaines) |
| **Schéma modifié** | Des colonnes d'une table sont supprimées, renommées ou changées de type. Une colonne ajoutée ne casse rien et reste dans la chronologie |
| **L'état des tables ne remonte plus** | Aucune table de la base de données n'a été lue depuis quinze minutes |

Choisissez les sévérités, les politiques d'astreinte, les propriétaires et les étiquettes lorsque vous les créez. Ce sont ensuite des moniteurs ordinaires : modifiez-les, mettez-les en sourdine ou placez-les sur une page de statut comme n'importe quel autre.

Un backfill ou une migration ne devrait alerter personne. Indiquez la base de données sous **Bases de données Data Observability** dans un événement de maintenance, ou ajoutez-y son serveur de base de données, et ses alertes de données restent silencieuses tant que l'événement est en cours.

## Propriétaires et étiquettes

L'onglet **Propriétaires** d'une table indique les personnes et les équipes à qui elle appartient, et une alerte de la table leur est adressée ; à défaut, aux propriétaires de sa base de données. Les **Règles de propriétaire** et les **Règles d'étiquettes** s'appliquent à chaque table dès sa première apparition, selon ses étiquettes, ou une expression régulière sur son nom, son schéma ou sa base de données. Une autorisation limitée à \`Owned\` ne porte que sur les tables que son titulaire ou ses équipes possèdent, avec leurs vérifications, leur activité et les problèmes signalés. Posséder une base de données ne fait pas de quelqu'un le propriétaire de ses tables : utilisez une règle de propriétaire pour confier toute une base de données à une équipe.

## Quand une alerte s'ouvre

L'alerte d'une table a une carte **Données** qui indique pourquoi elle s'est très probablement produite, par ordre de probabilité : une alerte en amont, une exécution en échec, un déploiement d'un service qui y écrit, ses écritures en échec, une colonne qui a changé, la base de données ou le serveur sur lequel elle tourne. En dessous figure ce qui en dépend : les tables, les tableaux de bord, les services et les personnes à qui ils appartiennent. Comme la carte **Lignage** de l'alerte, elle ne parle que des tables et des pipelines que votre rôle peut lire.

Dites ce que vous en pensez : **Utile**, **Attendu** (un événement planifié : rien ne change) ou **Pas un problème** (la table reçoit plus de marge, afin que la même chose reste silencieuse la prochaine fois). Si une personne trouve un problème la première, **Signaler un problème** sur la table l'enregistre. La **Vue d'ensemble** montre le bilan : les alertes utiles par semaine, combien n'étaient pas du bruit, combien de fois un problème a été détecté avant que quelqu'un le signale, avec quelle rapidité, et combien de fois la cause probable était la vraie.


## Produits de données

Les personnes qui utilisent les données (analystes, finance, dirigeants, agents IA) pensent en termes de ce qu'elles utilisent : « les tables du tableau de bord du chiffre d'affaires », pas les bases de données. Un produit de données nomme ces tables, avec son propriétaire, ses consommateurs et son SLA de fraîcheur. Créez-en un sous **Produits de données**. Son SLA est l'un des deux, ou les deux :
- **Frais à une heure de la journée (UTC) :** les données de chaque jour arrivent ce jour-là, avant cette heure. À partir de cette heure, chaque table doit avoir changé ce jour-là ; d'ici là, le chargement de la veille fait foi. Un chargement qui a toujours une demi-heure de retard est en retard pendant cette demi-heure chaque jour.
- **Un âge maximal :** la dernière modification d'aucune table ne peut être plus ancienne que cela.

Toutes les cinq minutes, les tables de chaque produit sont comparées à son SLA. Le produit est **En retard** quand l'une de ses tables l'est, et ses données datent de la plus ancienne dernière modification parmi elles. Il écrit \`oneuptime.data.product.late_tables\` et \`oneuptime.data.product.data_age\`, afin que vous puissiez afficher côte à côte la fraîcheur de chaque produit.

L'enregistrement d'un produit crée aussi, en votre nom et avec vos autorisations :
- **Un moniteur**, qui représente le produit sur une page de statut. Il est dégradé tant qu'une table est en retard, et ouvre un incident et une alerte au niveau le moins grave de votre projet, qui se résolvent d'eux-mêmes. Ajoutez-le à une page de statut, privée ou publique, comme ressource : les consommateurs qui s'abonnent apprennent quand le produit est en retard, et quand il est de nouveau à jour.
- **Un SLO** sur ce moniteur : la part du temps pendant laquelle les données sont à l'heure, par rapport à l'objectif du SLA du produit sur 30 jours, avec les alertes de burn rate rapide et lent avec lesquelles commence chaque SLO.

Supprimer le produit supprime les deux. Chaque produit a aussi un **badge** qui indique la date de ses données, vert tant qu'il est à l'heure et ambre avec « late » sinon. Intégrez-le dans un tableau de bord BI, une page de wiki ou un README depuis la vue d'ensemble du produit. Son lien ne demande aucune connexion ; traitez-le donc comme un lien partagé ; **Réinitialiser le lien du badge** en crée un nouveau et désactive l'ancien.

## Les vérifications des valeurs d'une table

L'état d'une table dit si elle change. Une **vérification** dit si ce qu'elle contient est correct. Ajoutez-en une dans l'onglet **Vérifications** d'une table :

| Vérification | Ce qu'elle lit |
| --- | --- |
| **Pourcentage de NULL** | Pourcentage des lignes dont la colonne est vide |
| **Pourcentage de doublons** | Pourcentage des valeurs qui répètent celle d'une autre ligne |
| **Nombre de valeurs distinctes** | Combien de valeurs différentes contient la colonne |
| **Minimum**, **Maximum**, **Moyenne**, **Somme** | D'une colonne numérique (une somme sur aucune ligne vaut 0) |
| **Pourcentage de valeurs invalides** | Pourcentage des valeurs hors d'une liste que vous donnez |
| **Pourcentage d'erreurs de format** | Pourcentage des valeurs qui ne sont pas dans un format que vous choisissez, comme E-mail, UUID ou Code pays, ou qui ne correspondent pas à une expression régulière de votre choix (tous les moteurs sauf SQL Server) |
| **Nombre de lignes orphelines** | Lignes dont la valeur n'a aucune correspondance dans la colonne d'une autre table |
| **Nombre de lignes** | Lignes de la table, le plus utile avec **Segmenter par** |
| **SQL personnalisé** | Le nombre que renvoie un SELECT en lecture seule de votre choix |

Les **Vérifications suggérées**, dans le même onglet, proposent les vérifications qu'appellent les colonnes d'une table, d'après leurs seuls noms et types :
- Un identifiant est unique.
- Un \`customer_id\` a une ligne correspondante dans \`customers\`.
- Un e-mail ressemble à un e-mail, et un montant n'est pas négatif.
- Un statut garde ses valeurs habituelles.
- Une table répartie par locataire est comptée par locataire.

Ajoutez-en une, ajoutez-les toutes, ou écartez-en une définitivement.

**Segmenter par** exécute une vérification une fois par valeur d'une colonne, comme un locataire ou une région : une série et une alerte chacune, pour les 100 plus grands segments. Un nombre de lignes segmenté alerte quand un locataire cesse d'envoyer des données.

Les vérifications s'exécutent avec la collecte de la base de données, par OneUptime ou par sa sonde, toutes les 15 minutes, toutes les heures, toutes les 6 heures ou tous les jours. Chacune s'exécute comme une seule instruction d'agrégation dans une transaction en lecture seule avec un délai d'expiration d'instruction : seul le nombre quitte la base de données, sauf si un projet choisit de conserver un échantillon masqué de lignes en échec. La valeur est écrite comme \`oneuptime.data.check.value\`, avec \`oneuptime.data.check.id\`, \`oneuptime.data.check.name\` et \`oneuptime.data.check.segment\`.

Définissez **Alerter quand** pour alerter sur une vérification :
- **Anormalement haut** ou **Anormalement bas** compare chaque valeur à sa propre référence apprise pour cette heure de la semaine.
- **Au-dessus de** ou **En dessous de** la compare à un seuil.

L'enregistrement de la vérification crée un moniteur de métriques pour elle, en votre nom, avec vos autorisations. Effacer la condition supprime le moniteur.

**Lignes en échec** compte les lignes que renvoie un SELECT en lecture seule de votre choix : les lignes qui ne devraient pas exister. 0 signifie que tout va bien.

Trois choses maîtrisent le coût d'une vérification. **Pourcentage d'échantillon** lit une partie des lignes, pour une vérification qui lit un taux. **Maximum lisible par une vérification (Go)**, dans **Paramètres**, arrête une vérification sur BigQuery ou Athena avant qu'elle ne lise davantage. **Attendre quand une base de données est occupée**, au même endroit, laisse les vérifications dues pour la collecte suivante quand une base de données PostgreSQL, MySQL ou SQL Server semble occupée.

**Conserver les lignes en échec**, dans **Paramètres**, conserve jusqu'à 20 lignes en échec d'une vérification, les colonnes sensibles étant masquées avant de quitter la base de données. L'option est désactivée tant que vous ne l'activez pas. Les lignes sont stockées dans OneUptime, sur les serveurs de OneUptime avec OneUptime Cloud et sur les vôtres avec une installation auto-hébergée, et désactiver l'option les supprime.

Gardez les vérifications dans un fichier de votre dépôt, et appliquez-les depuis la CI avec \`oneuptime data-checks apply checks.yaml\`. Exécutez-le avec \`--dry-run\` sur une pull request. Une erreur n'importe où dans le fichier fait que rien n'est appliqué. Le format du fichier est décrit dans la documentation.


## Rapprochements

Les copies divergent : l'entrepôt a moins de commandes que la base de données de l'application, ou une migration a perdu des lignes. Un rapprochement compare une mesure de deux tables, dans une base de données ou dans deux :
- **Nombre de lignes**
- **Somme** d'une colonne
- **Nombre de valeurs distinctes** d'une colonne
- **SQL personnalisé** : une requête en lecture seule qui renvoie un nombre, nommé \`value\`.

Il a une tolérance, un montant **Absolue** ou un **Pourcentage** de la valeur de la source. Créez-en un sous **Rapprochements**.

Chaque côté est lu par une vérification de données qui lui est propre, que le rapprochement crée et entretient, avec la collecte de sa base de données : par OneUptime, ou par la sonde de la base de données. Un rapprochement peut donc comparer une table PostgreSQL de votre réseau à sa copie dans Snowflake ou BigQuery. Ses vérifications apparaissent dans l'onglet Vérifications de chaque table et ne se modifient que depuis le rapprochement.

Les deux valeurs sont comparées dès que les deux ont été lues à moins de 15 minutes d'intervalle, puis les deux côtés sont planifiés pour être lus de nouveau ensemble. Un rapprochement écrit :
- \`oneuptime.data.reconciliation.drifted\` : 1 quand les deux ont divergé au-delà de la tolérance, 0 quand ils concordent. Son moniteur le lit, et alerte quand ils divergent.
- \`oneuptime.data.reconciliation.difference\` : la valeur de la cible moins celle de la source.
- \`oneuptime.data.reconciliation.difference_percent\` : l'écart en pourcentage de la valeur de la source.

Un côté dont la vérification échoue en indique la raison. Une copie chargée selon un planning est en retard sur sa source : comparez une mesure sur laquelle les deux se sont stabilisées, comme les lignes de plus d'une heure, avec du SQL personnalisé, ou prévoyez le décalage dans la tolérance.

## Pipelines et lignage, depuis OpenLineage

Airflow, Dagster, Spark, dbt et Flink décrivent chaque exécution d'un job avec des événements [OpenLineage](https://openlineage.io). Envoyez-les à OneUptime, sans modification, avec une clé d'ingestion de télémétrie (Paramètres du projet > Télémétrie & APM > Clés d'ingestion) :

- **URL :** \`https://oneuptime.com/telemetry/openlineage\` (sur un OneUptime auto-hébergé, votre propre adresse)
- **Point de terminaison :** \`api/v1/lineage\`, la valeur par défaut d'OpenLineage
- **Clé API :** la clé d'ingestion. Elle est envoyée comme \`Authorization: Bearer\`, ou définissez \`x-oneuptime-token\`.

Pour le fournisseur OpenLineage d'Airflow :

\`\`\`bash
AIRFLOW__OPENLINEAGE__TRANSPORT='{"type": "http", "url": "https://oneuptime.com/telemetry/openlineage", "endpoint": "api/v1/lineage", "auth": {"type": "api_key", "apiKey": "YOUR_INGESTION_KEY"}}'
\`\`\`

Pour tout client OpenLineage, définissez \`OPENLINEAGE_URL\` et \`OPENLINEAGE_API_KEY\`.

Chaque job apparaît sous **Pipelines**, avec sa dernière exécution : quand elle a commencé et fini, combien de temps elle a duré, et l'erreur d'une exécution en échec. Une exécution qui lit et écrit des tables que surveille OneUptime devient du **lignage** : l'onglet **Lignage** d'une table montre les tables à partir desquelles elle est construite, les pipelines qui y écrivent avec leur dernière exécution, et les tables construites à partir d'elle.

Les jeux de données sont associés aux tables selon la spécification de nommage d'OpenLineage : \`postgres://host:5432\` avec \`database.schema.table\`, \`mysql://host:3306\` avec \`database.table\`, \`sqlserver://host:1433\` et \`redshift://cluster:5439\` avec \`database.schema.table\`, \`snowflake://account\` avec \`database.schema.table\`, \`bigquery\` avec \`project.dataset.table\`, \`clickhouse://host:8443\` avec \`database.table\`, et \`databricks://workspace-host\` avec \`catalog.schema.table\`.

Chaque pipeline apprend de ses propres exécutions combien de temps dure habituellement une exécution (la médiane de ses 20 dernières exécutions terminées) et combien de temps il s'écoule entre deux exécutions selon son planning (le plus long écart entre ses 50 derniers démarrages qui n'est pas un cas isolé). Les deux sont connus après cinq exécutions, et conviennent aussi bien à un job qui s'exécute toutes les cinq minutes qu'à un job nocturne. Quand votre planificateur envoie la facette \`nominalTime\` d'OpenLineage, comme le fait Airflow, l'heure planifiée d'une exécution tient lieu de son démarrage, si bien qu'un backfill se lit toujours comme le planning.

La page d'un pipeline recommande trois moniteurs, chacun créé en un clic :
- **Échec d'exécution du pipeline** : une exécution a échoué ou a été interrompue.
- **Exécution du pipeline anormalement longue** : une exécution a pris deux fois son temps habituel, ou plus. C'est vérifié toutes les cinq minutes pendant l'exécution, si bien qu'une exécution bloquée est repérée avant qu'elle ne se termine.
- **Le pipeline est en retard** : aucune exécution n'a démarré depuis plus longtemps que le planning ne le permet, avec un quart de l'intervalle et au moins quinze minutes de marge.

Ils lisent ces métriques, chacune étiquetée avec \`oneuptime.data.pipeline.id\` et \`oneuptime.data.pipeline.name\` :
- \`oneuptime.data.pipeline.run_failed\` : 1 ou 0, à la fin de chaque exécution.
- \`oneuptime.data.pipeline.run_duration\` : des secondes, à la fin de chaque exécution.
- \`oneuptime.data.pipeline.run_duration_ratio\` : la durée de l'exécution sur celle de l'exécution habituelle (comptée au moins une minute), à la fin de chaque exécution et toutes les cinq minutes pendant qu'elle tourne.
- \`oneuptime.data.pipeline.overdue_seconds\` : de combien la prochaine exécution dépasse son planning, toutes les cinq minutes ; 0 tant qu'elle est à l'heure.

La page d'un pipeline dessine son **Lignage**, le premier endroit où regarder quand une exécution échoue ou est en retard : les tables qu'il lit à gauche, les tables qu'il écrit à droite, et l'état actuel de chacune. Choisissez plus d'étapes pour voir à partir de quoi ces tables sont construites et ce qui est construit à partir d'elles ; un nombre de tables non dessinées, sur la carte du pipeline ou d'une table, en dessine davantage sur place. Le même lignage est disponible sur \`POST /api/data-observability/pipelines/lineage\`, pour vos propres outils. Choisissez l'une des colonnes qu'il écrit pour la suivre à travers le pipeline : en amont jusqu'à la colonne de chaque table lue à partir de laquelle elle a été construite, et en aval jusqu'à chaque table où il l'écrit. Pour vos propres outils, envoyez \`"withColumns": true\` pour les colonnes que ses exécutions ont déplacées.



## Synchronisations Fivetran et Airbyte

Fivetran et Airbyte chargent vos tables brutes et n'envoient aucun événement OpenLineage, mais leurs webhooks indiquent quand chaque synchronisation commence et se termine. Chaque connecteur Fivetran et chaque connexion Airbyte devient un pipeline sous **Pipelines**, et chaque synchronisation une exécution, avec le même historique d'exécutions, la même durée et le même planning appris, et les mêmes alertes que tout pipeline : une exécution en échec, une exécution anormalement longue et une en retard. **Pipelines > Connecter Fivetran ou Airbyte** remplit les URL ci-dessous avec l'une de vos clés d'ingestion.

- **Fivetran :** créez un webhook avec l'API REST de Fivetran, pour votre compte ou un groupe de destinations, avec les événements \`sync_start\` et \`sync_end\`. Son URL est \`https://oneuptime.com/telemetry/fivetran/v1/webhook/<ingestion key ID>\`, et son secret est cette clé d'ingestion. Fivetran signe chaque envoi avec le secret, si bien que la clé elle-même ne circule jamais dans l'URL, et un envoi qui n'est pas signé avec elle est refusé.
- **Airbyte :** dans les paramètres de notification de votre espace de travail, définissez le webhook sur \`https://oneuptime.com/telemetry/airbyte/v1/webhook/<ingestion key>\`, et activez-le pour les synchronisations en échec et les synchronisations réussies. Airbyte ne signe rien ; son URL porte donc la clé : donnez à Airbyte une clé qui lui soit propre.

Un pipeline porte le nom que l'outil donne au connecteur ou à la connexion, sous \`fivetran://<destination group>\` ou \`airbyte://<workspace>\`. L'exécution d'une synchronisation en échec montre l'erreur de l'outil. Une synchronisation Fivetran replanifiée à cause de la limite de débit d'une API se termine comme **Reprogrammée** : ce n'est pas un échec ; elle n'alerte donc personne, et sa durée n'enseigne aucune durée.

Un connecteur Fivetran charge le schéma de sa destination qui porte son nom. Quand une seule base de données surveillée a ce schéma, ses tables enregistrent le connecteur comme leur rédacteur : une table qui devient obsolète renvoie à la synchronisation qui aurait dû la charger, et l'alerte d'une synchronisation en échec est la cause des alertes des tables (voir Un seul problème par cause). Airbyte ne nomme aucune table.

## Tableaux de bord dans les outils BI

Le véritable impact de mauvaises données, c'est le tableau de bord que quelqu'un ouvre. Sous **Tableaux de bord BI**, ajoutez vos outils BI avec des identifiants autorisés à lire leurs tableaux de bord :

| Outil | Identifiants (JSON) |
| --- | --- |
| **Metabase** | \`{ "apiKey": "mb_..." }\` (ou le \`username\` et le \`password\` d'un utilisateur) |
| **Superset** | \`{ "username": "...", "password": "..." }\` |
| **Tableau** | \`{ "tokenName": "...", "tokenSecret": "...", "site": "acme" }\`, un jeton d'accès personnel |
| **Looker** | \`{ "clientId": "...", "clientSecret": "..." }\`, un client API |
| **Power BI** | \`{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }\`, un principal de service autorisé à utiliser les API d'administration de Power BI |
| **Hightouch** | \`{ "apiKey": "..." }\` : chaque synchronisation est lue comme une chose de plus qui dépend d'une table |
| **Census** | \`{ "apiKey": "...", "region": "us" }\` : chaque synchronisation est lue comme une chose de plus qui dépend d'une table |

Toutes les heures, et quand un outil est ajouté ou que vous choisissez **Lire maintenant**, OneUptime lit chaque tableau de bord et les tables qui se trouvent derrière : la table d'une carte et le SQL d'une question native (Metabase), la table d'un jeu de données ou le SQL d'un jeu de données virtuel (Superset), les tables en amont de la Metadata API (Tableau), l'explore de chaque tuile (Looker), et le jeu de données de chaque rapport (Power BI, à partir d'un scan d'espace de travail). Chaque table est associée à une table surveillée par sa base de données, son schéma et son nom ; un nom qui correspond encore à deux tables surveillées reste non associé. L'onglet **Lignage** d'une table, la carte **Données** de ses alertes et la Revue de production listent les tableaux de bord construits sur elle, et sur les tables construites à partir d'elle. Seuls les noms et les liens sont lus, jamais les données d'un tableau de bord.

Un outil Power BI peut aussi alerter sur les actualisations en échec de ses jeux de données. Avec **Alerte sur les actualisations en échec** activée, comme pour un outil ajouté maintenant, OneUptime tient un moniteur pour l'outil qui ouvre une alerte pour chaque jeu de données dont la dernière actualisation a échoué ou a été annulée, nommé dans le titre de l'alerte, et la résout dès qu'une actualisation ultérieure se termine. Il lit \`oneuptime.data.bi.refresh_failed\`, étiquetée avec \`oneuptime.data.bi.dataset.name\` et \`oneuptime.data.bi.workspace.name\` : toutes les cinq minutes, chaque jeu de données que la lecture horaire a trouvé en échec écrit 1, et 0 pendant l'heure qui suit une actualisation ultérieure terminée. Une actualisation encore en cours ne change rien ; un échec est donc une seule alerte, quel que soit le nombre de lectures horaires qui le voient.

## Les jobs dans vos traces

Un CronJob Kubernetes, ou une fonction déclenchée par un minuteur, n'a besoin de rien d'installé pour apparaître comme un pipeline : les spans avec \`k8s.cronjob.name\` ou \`k8s.job.name\`, ou \`faas.name\` avec un \`faas.trigger\` de \`timer\` ou \`datasource\`, en deviennent un, avec ses exécutions et les tables que ses appels de base de données ont touchées. Chaque exécution renvoie à sa trace et à ses logs, et un CronJob qui cesse de s'exécuter est repéré comme en retard.

## Le lignage que donnent les bases de données

Le lignage n'a pas besoin d'un pipeline qui envoie de l'OpenLineage. Chaque base de données en donne elle-même une partie, et OneUptime la lit avec la collecte de la base de données :
- **Vues :** une vue est construite à partir des tables sur lesquelles elle est définie, dans PostgreSQL, Redshift, MySQL 8 et SQL Server. Quand une vue est redéfinie ou supprimée, son ancien lignage disparaît avec elle.
- **Historique des requêtes :** une requête qui a lu une table et en a écrit une autre, comme une requête planifiée, un modèle dbt ou un MERGE, constitue aussi du lignage. Il provient des jobs de BigQuery (la vue \`INFORMATION_SCHEMA.JOBS\` du projet et de l'emplacement du jeu de données, qui demande **BigQuery Resource Viewer**) et du journal des requêtes de Redshift (\`stl_insert\` et \`stl_scan\`, qui demandent \`SYSLOG ACCESS UNRESTRICTED\`). Seuls les jobs exécutés dans le projet propre du jeu de données figurent dans sa vue des jobs.

Le lignage est lu une fois par heure, depuis la dernière lecture, et une semaine en arrière lors de la première collecte d'une base de données, si bien qu'il est là dès le départ. Une lecture BigQuery est facturée pour les heures de jobs qu'elle lit, le plus souvent au minimum de 10 Mo de BigQuery.

Chaque arête de l'onglet **Lignage** d'une table indique où elle a été vue : dans l'exécution d'un pipeline, dans l'historique des requêtes (avec un identifiant dont les requêtes ont déplacé les données), ou dans la définition d'une vue. Le lignage de toutes les sources compte pour **Un seul problème par cause**.

En haut de l'onglet **Lignage** d'une table, un diagramme dessine son lignage sur quelques étapes dans chaque sens (trois, ou choisissez 1, 2 ou 5) : ce à partir de quoi elle est construite à gauche, les tables et les tableaux de bord construits à partir d'elle à droite, et les pipelines qui chargent des données de l'extérieur là où elles entrent. Chaque carte indique son état actuel - en retard, une alerte ouverte, une exécution en échec - et une flèche devient rouge quand la dernière exécution de son pipeline a échoué, si bien qu'on peut remonter d'une table en retard jusqu'à l'exécution qui l'a cassée. Ouvrez n'importe quelle table pour centrer le diagramme sur elle. Une carte dessine au plus dix tables dans chaque sens et compte le reste, comme **+14** : sélectionnez le nombre pour dessiner les suivantes là où elles sont, et **Réinitialiser le diagramme** pour revenir en arrière. Là où les sources nomment des colonnes, choisissez l'une des colonnes de la table dans **Suivre une colonne** pour mettre en évidence d'où elle vient et où elle va, même là où elle est renommée en chemin. Le même lignage est disponible sur \`POST /api/data-observability/tables/lineage\`, pour vos propres outils : envoyez \`"withColumns": true\` pour les colonnes de chaque flèche, et demandez à \`POST /api/data-observability/lineage/expand\` les tables suivantes d'une carte. Le lignage ne montre que les tables et les pipelines que votre rôle peut lire : ce que vous ne pouvez pas lire n'est jamais dessiné, nommé sur une flèche ni compté.

## dbt

Après \`dbt build\` (ou run, test, seed ou snapshot), envoyez les artefacts du projet avec la CLI et une clé d'ingestion de télémétrie. Elle lit \`target/manifest.json\` et \`target/run_results.json\` et n'envoie que ce que Data Observability en lit :

\`\`\`bash
npm install -g @oneuptime/cli
export ONEUPTIME_URL=https://oneuptime.com
export ONEUPTIME_TELEMETRY_INGESTION_KEY=<ingestion key>
dbt build
oneuptime dbt upload
\`\`\`

En CI, exécutez \`oneuptime dbt upload\` comme étape après le build, même quand le build échoue, afin que les tests en échec soient enregistrés. Pour un job dbt Cloud, téléchargez ses artefacts avec l'API de dbt Cloud, puis envoyez-les avec \`--manifest\` et \`--run-results\`. Ou envoyez-les vous-même : \`POST /telemetry/dbt/v1/artifacts\` avec \`{ "manifest": ..., "run_results": ... }\` et la clé dans \`x-oneuptime-token\`.

Ce que fait chaque envoi :
- **Tables :** chaque modèle, seed, snapshot et source qui est une table surveillée par OneUptime reçoit une carte **dbt** dans sa vue d'ensemble : le nœud, sa matérialisation, son propriétaire, ses tags et son dernier build. Sa description dbt remplit la description de la table quand celle-ci est vide. Une table est associée par sa base de données, son schéma et son nom, pour PostgreSQL, MySQL, SQL Server, Redshift, Snowflake, BigQuery, ClickHouse et Databricks. dbt ne connaît pas l'hôte ; quand deux bases de données surveillées portent le même nom, leurs tables restent donc non associées, sauf si une seule d'entre elles contient la table.
- **Lignage :** ce à partir de quoi chaque modèle est construit devient du lignage dans l'onglet **Lignage** de la table, via le pipeline du projet.
- **Tests :** chaque test d'une table surveillée apparaît dans son onglet **Vérifications**, avec son dernier résultat et les lignes qu'il a trouvées en échec. Cliquez sur **Alerter en cas d'échec** pour qu'un test en échec ouvre une alerte.
- **Builds :** chaque build est une exécution du pipeline du projet sous **Pipelines** (espace de noms \`dbt\`). Un build avec une erreur ou un test en échec est une exécution en échec ; les alertes de pipeline fonctionnent donc aussi sur les builds dbt : en échec, anormalement long et en retard.

## Tables inutilisées

Chaque moteur compte les lectures de chaque table dans ses propres statistiques :
- PostgreSQL : ses scans.
- MySQL : les lectures de performance_schema.
- SQL Server : ses seeks, scans et lookups, avec l'heure du dernier.

Chaque collecte compare le compteur au dernier conservé, si bien que la **Dernière lecture** d'une table est connue à l'heure près, de même que le moment depuis lequel elle n'en a eu aucune. Un compteur à 0 lors de la première collecte d'une table signifie qu'elle n'a pas été lue depuis le début des statistiques du moteur ; une table inutilisée apparaît donc comme inutilisée dès le départ, et non après des mois de surveillance. Une lecture vue dans les spans de base de données d'un service compte aussi.

**Tables inutilisées** liste les tables que personne n'a lues depuis 90 jours, les plus grandes en premier, avec la date de la dernière écriture de chacune : une table encore écrite mais jamais lue coûte ses écritures et son stockage. La vue d'ensemble montre combien il y en a et ce qu'elles contiennent. Les vues n'ont pas de compteurs propres ; elles ne sont donc jamais listées. Quand l'identifiant de la base de données ne peut pas lire les compteurs, la dernière lecture d'une table n'est pas connue.

## Dépenses d'entrepôt

Une fois par heure, avec la collecte de chaque entrepôt, OneUptime lit ce que Snowflake et BigQuery ont dépensé au cours de la dernière journée, job par job : les crédits de calcul de Snowflake depuis \`QUERY_ATTRIBUTION_HISTORY\` (avec \`IMPORTED PRIVILEGES\` sur la base de données \`SNOWFLAKE\`, exécuté sur l'entrepôt de la connexion), et les octets facturés de BigQuery depuis sa vue des jobs (avec **BigQuery Resource Viewer**). Un job est une requête exécutée encore et encore - la requête paramétrée de Snowflake, la requête de BigQuery sans ses littéraux - nommée par son tag de requête ou son label, ou par ce qu'elle fait et la table qu'elle écrit, et jamais par le texte de sa requête.

**Dépenses d'entrepôt** montre les crédits et les octets facturés de la journée, par équipe (le \`team\` du tag de requête ou du label d'un job, sinon la personne qui l'exécute), les tables dont les écritures coûtent le plus (la dépense d'un job répartie entre les tables qu'il écrit, là où ACCESS_HISTORY de Snowflake ou la table de destination de BigQuery indique lesquelles), les jobs en échec, et ce qui part vers des jobs qui n'écrivent que des tables que personne n'a lues depuis 90 jours.

## Un seul problème par cause

Quand une table devient obsolète, chaque table construite à partir d'elle le devient aussi. Avant qu'une alerte de données ne s'ouvre, OneUptime cherche dans le lignage une alerte déjà ouverte sur ce à partir de quoi sa table ou son pipeline est construit : les tables en amont, les pipelines qui y écrivent, et les bases de données où elles se trouvent, jusqu'à cinq étapes en amont. Quand il en trouve une, la nouvelle alerte est la conséquence de cette alerte :
- Elle démarre **prise en compte**, afin que personne ne soit alerté deux fois pour un même problème. Elle se rétablit d'elle-même dès que ses données le font.
- Son fil indique quelle alerte l'a causée, et sa carte **Données** aussi.
- Elle rejoint l'épisode de la cause, quand la cause en fait partie.

La carte **Données** de la cause liste son **Impact en aval** : chaque alerte qu'elle a causée. La carte d'une alerte de table montre aussi les services qui écrivent dans la table, avec leurs écritures en échec, ainsi que leurs déploiements et autres changements dans la journée précédant l'alerte.

Sous la carte **Données**, la page d'une alerte dessine son **Lignage** : autour de sa table, comme le dessine l'onglet **Lignage** de la table, ou autour de son pipeline, avec en surbrillance le chemin qui remonte jusqu'à l'alerte qui l'a causée et celui qui descend jusqu'à chaque alerte qu'elle a causée, la cause marquée **Cause** et chaque alerte causée **Conséquence**. Quand la cause se trouve sur un pipeline dessiné sur une flèche, la flèche indique **Cause** sous le nom du pipeline. Une alerte issue d'une vérification sur une colonne, comme une vérification Pourcentage de NULL sur \`customer_id\`, s'ouvre avec cette colonne suivie à côté de ces chemins, comme dans l'onglet **Lignage** de la table ; choisissez-y une autre des colonnes de la table, ou effacez-la pour ne voir que les chemins. Une personne qui ne peut pas voir l'alerte qui l'a causée n'obtient ni la carte **Données** ni le lignage, et une alerte causée qu'elle ne peut pas voir n'est ni mise en surbrillance ni comptée. Le même lignage est disponible sur \`POST /api/data-observability/alerts/<alert ID>/lineage\`, avec la \`column\` que lit l'alerte d'une vérification de colonne et les colonnes que porte chaque flèche. Une alerte qu'elle a causée sur un pipeline dessiné sur une flèche y indique **Conséquence** de la même façon, et le sélecteur de colonnes propose d'abord la colonne du contrôle, puis les autres colonnes de la table dans son propre ordre.


## OneUptime AI

- **Enquêtes sur les alertes de données.** Quand OneUptime AI enquête sur une alerte concernant une table, un pipeline ou une base de données, il lit ce qui l'entoure : la fraîcheur de la table et ses alertes ouvertes, l'alerte dont elle est la conséquence, les exécutions des pipelines qui y écrivent depuis la veille (une exécution en échec avec son erreur), les services qui y écrivent avec leurs écritures en échec et leurs déploiements et autres changements, et son lignage : les tables à partir desquelles elle est construite et les tables construites à partir d'elle, celles qui ont un problème en premier, avec l'emplacement de l'alerte dont elle est la conséquence et les tables sur lesquelles se trouvent les alertes qu'elle a causées. Pour une alerte issue d'une vérification sur une colonne, il suit aussi cette colonne dans le lignage : les colonnes à partir desquelles elle est construite en amont et les colonnes construites à partir d'elle en aval, table par table. Il nomme l'exécution, le déploiement ou la table en amont à l'origine de l'alerte. Tous ceux qui peuvent voir l'alerte lisent son rapport, donc il ne lit que ce que tous peuvent lire : là où un rôle ne lit les tables ou les pipelines que selon les **Propriétaires** ou les **Étiquettes**, aucun de ceux qu'ils mettent à part, hormis la table ou le pipeline de l'alerte elle-même. Il n'en nomme ni n'en compte jamais d'autre, ni dans ce dont il part, ni dans ce qu'il demande en chemin.
- **Une vérification à partir d'une phrase.** Dans l'onglet Vérifications d'une table, **Écrire un contrôle à partir d'une phrase** transforme une règle comme « les commandes n'ont jamais un total négatif » en une vérification SQL personnalisé qui compte les lignes qui l'enfreignent, avec une alerte dès qu'il y en a. Vous lisez la requête avant que **Ajouter le contrôle** ne l'ajoute, et elle est soumise à tout ce à quoi est soumise une vérification SQL personnalisé : une seule instruction en lecture seule, exécutée dans une transaction en lecture seule.
- **Cette table est-elle à jour ?** Demandez à OneUptime AI dans Demander à l'IA, Slack ou Microsoft Teams (« la table orders est-elle à jour ? »). Il répond avec la fraîcheur de la table selon son propre rythme, quand elle a changé pour la dernière fois, ses alertes ouvertes, les dernières exécutions de ses rédacteurs et les produits de données dont elle fait partie. Les agents IA demandent la même chose via l'outil \`get_data_table_freshness\` du serveur MCP, avant d'utiliser les données.
- **À partir de quoi cette table est-elle construite ?** Demandez de la même façon (« qu'est-ce qui alimente la table revenue ? », « qu'est-ce qui casse si raw.orders cesse de se charger ? »). Il suit le lignage de la table sur trois étapes dans chaque sens, ou jusqu'à cinq si on le demande, et place en premier les tables en amont et en aval qui sont en retard, supprimées, qui ont des alertes ouvertes ou dont le pipeline a échoué à sa dernière exécution, les plus proches en premier, avec le nombre d'étapes qui les séparent et les tables intermédiaires ; puis le reste, les pipelines qui chargent ses sources depuis l'extérieur de ce que surveille OneUptime, et les tableaux de bord BI construits sur elle. Les alertes ouvertes sont comptées, jamais nommées, et seulement celles que la personne qui demande peut voir. Les agents IA demandent la même chose via l'outil \`get_data_table_lineage\` du serveur MCP, avant de modifier une table. Elle compte une seule fois chaque table au-delà de ce qu'elle dit, quel que soit le nombre de tables citées voisines. Ouvert sur la page d'une table, Demander à l'IA sait quelle table est « cette table » et interroge celle-là, même quand plusieurs bases de données ont une table de ce nom. Comme toute vue du lignage, elle ne parle que des tables et des pipelines que la personne qui demande peut lire.

## Les services qui utilisent chaque table

L'onglet **Services** d'une table liste les services vus en train d'y écrire et de la lire, avec les instructions que chacun a exécutées, ses appels et ses échecs de la dernière heure, et quand il a été vu pour la dernière fois. Cela provient des spans de base de données que vos services envoient déjà avec OpenTelemetry : un span client avec \`db.system.name\`, \`db.namespace\` et \`db.collection.name\` (ou \`db.sql.table\`, ou un span nommé comme \`INSERT orders\`). Rien de plus à installer. C'est mis à jour toutes les 15 minutes.

Chaque service montre aussi les points de terminaison qui font ses appels, et est marqué **Application IA** quand il appelle aussi un modèle. **Erreurs citant cette table** liste les exceptions ouvertes et les logs d'erreur de la dernière journée des services qui écrivent dans la table, quand ils la mentionnent par son nom.

Un span n'est rattaché à une table que lorsque sa base de données est celle qu'une collecte a lue, et, quand deux bases de données portent le même nom, seulement lorsque son \`server.address\` est l'une des leurs. En cas de doute, le span est laissé de côté.

Ces métriques sont les données opérationnelles propres à OneUptime et ne sont pas facturées comme de la télémétrie.
`;

export default DOCUMENTATION;
