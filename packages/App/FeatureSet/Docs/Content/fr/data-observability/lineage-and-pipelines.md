# Lignage et pipelines

Le lignage indique à partir de quelles tables chaque table est construite, et quels pipelines y écrivent. Observabilité des données le rassemble depuis six sources à la fois - les événements OpenLineage, dbt, les synchronisations Fivetran et Airbyte, les jobs de vos traces, les vues et l'historique des requêtes de chaque base de données - et s'en sert pour relier chaque table en retard ou cassée à l'exécution qui en est la cause, pour qu'un problème ne donne lieu qu'à un seul signalement.

## D'où vient le lignage

| Source | Ce qu'elle apporte |
| --- | --- |
| **OpenLineage** | Chaque exécution d'un job Airflow, Dagster, Spark, dbt ou Flink, avec les tables qu'il a lues et écrites |
| **dbt** | Ce à partir de quoi chaque modèle est construit, chaque build comme une exécution, et le résultat de chaque test |
| **Fivetran et Airbyte** | Chaque synchronisation comme une exécution de son connecteur, et les tables brutes qu'elle charge |
| **Jobs de vos traces** | Un CronJob Kubernetes ou une fonction planifiée, ses exécutions, et les tables que ses appels de base de données ont lues et écrites |
| **Vues** | Une vue est construite à partir des tables sur lesquelles elle est définie (PostgreSQL, Redshift, MySQL 8, SQL Server, Oracle, Snowflake, vues matérialisées ClickHouse, Databricks, MongoDB) |
| **Historique des requêtes** | Une requête qui a lu une table et en a écrit une autre (l'historique d'accès de Snowflake, les jobs de BigQuery, le journal des requêtes de Redshift, le journal des requêtes de ClickHouse, la table de lignage de Databricks) |

L'onglet **Lignage** d'une table montre les tables à partir desquelles elle est construite, les pipelines qui y écrivent avec leur dernière exécution, et les tables construites à partir d'elle. Chaque lien indique où il a été observé.

En haut de l'onglet, un diagramme dessine ce lignage sur quelques étapes de chaque côté (trois, ou choisissez 1, 2 ou 5) : à gauche ce à partir de quoi la table est construite, à droite les tables et les tableaux de bord construits à partir d'elle, et les pipelines qui chargent des données venues de l'extérieur, là où elles entrent. Chaque carte indique son état actuel - en retard, une alerte ouverte, une exécution en échec - et une flèche devient rouge quand la dernière exécution de son pipeline a échoué, si bien qu'on peut remonter d'une table en retard jusqu'à l'exécution qui l'a bloquée. Ouvrez n'importe quelle table pour centrer le diagramme sur elle.

Une carte dessine au plus dix tables de chaque côté et compte les autres, par exemple **+14**. Sélectionnez ce nombre pour en dessiner jusqu'à dix de plus là où elles se trouvent, les problèmes d'abord, avec chaque flèche entre elles et ce qui est déjà dessiné. **Réinitialiser le diagramme** revient au diagramme tel qu'il a été dessiné au départ. Quand un côté contient autant de tables qu'un diagramme peut en contenir, ouvrez une table pour centrer le diagramme sur elle.

Lorsque la source nomme des colonnes, l'onglet **Colonnes** d'une table indique d'où vient chaque colonne et ce qu'elle alimente : l'historique d'accès de Snowflake (édition Enterprise, qui demande `IMPORTED PRIVILEGES` sur la base de données `SNOWFLAKE`), et la facette `columnLineage` d'OpenLineage.

Dans l'onglet **Lignage**, choisissez une colonne de la table dans **Suivre une colonne** pour mettre en évidence d'où elle vient et où elle va : en remontant le diagramme jusqu'aux colonnes à partir desquelles elle est construite, en descendant jusqu'aux colonnes construites à partir d'elle, chacune nommée sur sa table, même là où elle a été renommée en chemin. Une flèche dont les sources ne nomment aucune colonne peut la porter plus loin que ce qui est mis en évidence, et le diagramme le signale.

## OpenLineage

Envoyez les événements OpenLineage à OneUptime, tels quels, avec une [clé d'ingestion](/docs/telemetry/ingestion-keys) de télémétrie :

- **URL :** `https://oneuptime.com/telemetry/openlineage` (sur un OneUptime auto-hébergé, votre propre adresse)
- **Point de terminaison :** `api/v1/lineage`, la valeur par défaut d'OpenLineage
- **Clé API :** la clé d'ingestion, envoyée comme `Authorization: Bearer`, ou définissez `x-oneuptime-token`

Pour le fournisseur OpenLineage d'Airflow :

```bash
AIRFLOW__OPENLINEAGE__TRANSPORT='{"type": "http", "url": "https://oneuptime.com/telemetry/openlineage", "endpoint": "api/v1/lineage", "auth": {"type": "api_key", "apiKey": "YOUR_INGESTION_KEY"}}'
```

Pour tout autre client OpenLineage, définissez `OPENLINEAGE_URL` et `OPENLINEAGE_API_KEY`. Les jeux de données sont associés aux tables selon la convention de nommage d'OpenLineage, comme `postgres://host:5432` avec `database.schema.table`, `snowflake://account` avec `database.schema.table`, `clickhouse://host:8443` avec `database.table`, et `databricks://workspace-host` avec `catalog.schema.table`.

## dbt

Après `dbt build` (ou run, test, seed ou snapshot), envoyez les artefacts du projet avec la [CLI OneUptime](/docs/cli/index) :

```bash
npm install -g @oneuptime/cli
export ONEUPTIME_URL=https://oneuptime.com
export ONEUPTIME_TELEMETRY_INGESTION_KEY=<ingestion key>
dbt build
oneuptime dbt upload
```

En CI, exécutez `oneuptime dbt upload` comme étape suivant le build, même quand le build échoue, pour que les tests en échec soient enregistrés. Chaque table que dbt construit reçoit une carte **dbt** sur sa vue d'ensemble, le lignage de ses modèles, et ses tests dans son onglet **Vérifications** ; chaque build est une exécution du pipeline du projet.

## Fivetran et Airbyte

Leurs webhooks indiquent quand chaque synchronisation commence et se termine. **Pipelines > Connecter Fivetran ou Airbyte** remplit les URL avec l'une de vos clés d'ingestion :

- **Fivetran :** un webhook créé avec l'API REST de Fivetran, pour les événements `sync_start` et `sync_end`, vers `https://oneuptime.com/telemetry/fivetran/v1/webhook/<ingestion key ID>`, avec la clé d'ingestion comme secret. Fivetran signe chaque envoi avec elle, si bien que la clé ne circule jamais dans l'URL.
- **Airbyte :** le webhook de l'espace de travail réglé sur `https://oneuptime.com/telemetry/airbyte/v1/webhook/<ingestion key>`, activé pour les synchronisations en échec et réussies. Donnez à Airbyte une clé qui lui est propre.

Une synchronisation Fivetran reprogrammée à cause de la limite de débit d'une API se termine en **Reprogrammée** : ce n'est pas un échec, donc elle ne prévient personne.

## Jobs de vos traces

Beaucoup de pipelines sont un CronJob Kubernetes, ou une fonction sur minuteur, sans planificateur pour envoyer du lignage. Leurs traces disent tout de même tout, sans rien à installer. Toutes les quinze minutes, les spans dont l'attribut de ressource est `k8s.cronjob.name` ou `k8s.job.name`, ou `faas.name` avec un `faas.trigger` valant `timer` ou `datasource`, deviennent un pipeline sous **Pipelines** :

- Une exécution de CronJob est son Job Kubernetes, et une exécution de fonction est son `faas.invocation_id`.
- Une exécution a échoué quand le span au sommet de sa trace a échoué. Un appel qui a échoué puis a été retenté à l'intérieur ne la fait pas échouer.
- Les tables qu'il a écrites et lues viennent de ses spans de base de données.

Chaque exécution renvoie vers sa trace, avec ses journaux. Les trois mêmes moniteurs s'appliquent, si bien qu'un CronJob qui cesse de s'exécuter est vu comme en retard.

## Tableaux de bord des outils BI

Le véritable impact de données erronées, c'est le tableau de bord que quelqu'un ouvre. Dans **Tableaux de bord BI**, ajoutez vos outils BI avec des identifiants autorisés à lire leurs tableaux de bord. Toutes les heures, l'Observabilité des données lit chaque tableau de bord et les tables qui le sous-tendent, associe chaque table à une table surveillée et affiche les tableaux de bord construits sur une table, et sur les tables construites à partir d'elle, dans son onglet **Lignage**, sur ses alertes et dans Production Review.

| Outil | Identifiants |
| --- | --- |
| **Metabase** | `{ "apiKey": "mb_..." }` |
| **Superset** | `{ "username": "...", "password": "..." }` |
| **Tableau** | `{ "tokenName": "...", "tokenSecret": "...", "site": "acme" }` |
| **Looker** | `{ "clientId": "...", "clientSecret": "..." }` |
| **Power BI** | `{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }`, un principal de service autorisé à utiliser les API d'administration en lecture seule de Power BI. Les rapports et les tableaux de bord sont lus tous les deux, avec leurs vues et leurs actualisations (ci-dessous) |
| **Hightouch** | `{ "apiKey": "..." }` |
| **Census** | `{ "apiKey": "...", "region": "us" }` (ou `eu`) |

Hightouch et Census sont des outils d'ETL inversé : une synchronisation qui copie une table dans un CRM dépend de cette table comme un tableau de bord, elle est donc lue de la même façon et nommée sur les alertes de la table.

Seuls les noms et liens des tableaux de bord, les tables qu'ils interrogent et, pour Power BI, qui les ouvre et comment leurs actualisations se sont passées sont lus : jamais leurs données.

### Vues et actualisations dans Power BI

Pour chaque rapport et tableau de bord Power BI, **Tableaux de bord BI** indique d'abord combien de fois il a été ouvert au cours des 28 derniers jours, quand il a été ouvert pour la dernière fois et comment s'est passée la dernière actualisation de ses données, avec l'erreur d'une actualisation en échec. Le nombre de personnes qui l'ont ouvert, qui l'a ouvert le plus et ses dernières actualisations sont des colonnes que vous pouvez afficher. L'onglet **Lignage** d'une table dit la même chose de chaque tableau de bord construit sur elle, avec son propriétaire et ses lecteurs sous **Plus**.

- Les **vues** viennent du journal d'activité de Power BI, lu par son API d'administration des événements d'activité. Power BI en conserve 28 jours, répond à 200 requêtes par heure et découpe chaque requête en heures ; OneUptime le lit donc une heure à la fois : chaque lecture horaire ajoute les heures écoulées depuis la précédente, puis remonte les 28 jours, des plus récentes aux plus anciennes, avec au plus 100 requêtes. Un nouvel outil Power BI affiche tout de suite les derniers jours, et les 28 jours en moins d'une journée ; d'ici là, les vues indiquent depuis quand elles sont comptées. Un événement peut mettre jusqu'à une heure pour arriver dans le journal, les vues ont donc jusqu'à deux heures de retard. Les lecteurs sont nommés comme Power BI les nomme, par leur adresse e-mail.
- Les **actualisations** des jeux de données sur une capacité (Premium, Premium par utilisateur ou Fabric) viennent de la liste d'administration des éléments actualisables de Power BI : la dernière actualisation de chaque jeu de données avec son erreur, et combien d'actualisations ont été exécutées et ont échoué au cours des sept jours que Power BI conserve.
- Les **actualisations des jeux de données sur une capacité partagée** ne figurent pas dans cette liste. Power BI ne montre l'historique d'actualisation d'un jeu de données qu'aux personnes qui peuvent le modifier : ajoutez donc le principal de service à son espace de travail comme **Contributeur**, **Membre** ou **Administrateur**, et activez pour lui **Service principals can call Fabric public APIs** dans les paramètres développeur du portail d'administration Fabric. OneUptime lit alors chaque actualisation, avec son erreur. D'ici là, l'outil BI indique pour combien de jeux de données il n'a pas pu lire les actualisations.
- Un tableau de bord Power BI dont les vignettes viennent de plusieurs jeux de données affiche la dernière actualisation en échec ou, si aucune n'a échoué, la plus ancienne : ses données ne sont pas plus fraîches que celle-ci.

Les vues, et les actualisations sur les capacités, ne demandent rien de plus que l'accès aux API d'administration ci-dessus : le principal de service dans un groupe de sécurité autorisé par **Service principals can access read-only admin APIs**, sans autorisation Power BI nécessitant le consentement d'un administrateur sur l'application. Quand les vues ou les actualisations ne peuvent pas être lues, les tableaux de bord sont tout de même lus et conservés, l'outil BI indique ce qui a été ignoré et pourquoi, et la lecture suivante réessaie.

### Alertes sur les actualisations en échec

Activez **Alert on Failed Refreshes** quand vous ajoutez ou modifiez un outil Power BI (un nouvel outil commence avec cette option activée), et OneUptime tient pour l'outil un moniteur sous **Moniteurs**, qui porte son nom. Le moniteur ouvre une alerte pour chaque jeu de données dont la dernière actualisation a échoué ou a été annulée, avec le jeu de données et son espace de travail dans le titre de l'alerte, et la résout dès qu'une actualisation ultérieure aboutit. Un jeu de données publié plus tard est surveillé dès qu'il est lu. Désactiver l'interrupteur, ou retirer l'outil, supprime le moniteur ; jusque-là, c'est un moniteur ordinaire, avec ses propriétaires, ses politiques d'astreinte et ses fenêtres de maintenance.

Les actualisations en échec n'utilisent pas les moniteurs de pipeline. Un jeu de données dont l'actualisation a échoué continue d'afficher les données de sa dernière actualisation réussie jusqu'à ce qu'une actualisation ultérieure aboutisse : son alerte reste donc ouverte jusque-là, alors que l'alerte d'une exécution en échec se referme une heure après l'exécution. Et les actualisations sont lues une fois par heure : une actualisation lue jusqu'à une heure après sa fin tomberait souvent hors de l'heure que regarde **Pipeline Run Failed**, un jeu de données actualisé toutes les demi-heures passerait sans cesse en **Pipeline Is Late**, et une actualisation terminée mais pas encore lue aurait l'air d'un **Pipeline Run Unusually Long**.

- Chaque lecture horaire conserve les jeux de données dont la dernière actualisation terminée a échoué ou a été annulée. Toutes les cinq minutes, chacun écrit `oneuptime.data.bi.refresh_failed`, 1 tant qu'il échoue et 0 pendant l'heure qui suit l'aboutissement d'une actualisation ultérieure, et le moniteur le lit : un échec ouvre ainsi une seule alerte, quel que soit le nombre de lectures horaires qui le voient.
- Un échec est vu à la lecture horaire suivante : son alerte s'ouvre jusqu'à une heure après l'échec de l'actualisation, et se résout jusqu'à une heure après l'aboutissement d'une actualisation ultérieure.
- Une actualisation encore en cours ne change rien : l'alerte d'un jeu de données dont l'actualisation a échoué reste ouverte pendant que sa prochaine actualisation tourne, et ne se résout qu'une fois qu'une actualisation aboutit.
- Sur une capacité, la liste des éléments actualisables de Power BI ne donne que la dernière actualisation de chaque jeu de données : une actualisation qui a échoué et a été suivie d'une actualisation réussie dans la même heure n'est donc jamais vue, mais d'ici là les données sont de nouveau à jour.
- Les jeux de données sur une capacité partagée ne donnent d'alerte que là où leurs actualisations peuvent être lues (ci-dessus), et un jeu de données dont les actualisations n'ont pas pu être lues garde son alerte telle quelle jusqu'à ce qu'elles puissent l'être.

## Pipelines

Chaque job, projet dbt et synchronisation apparaît sous **Pipelines**, avec ses exécutions : quand chacune a commencé et s'est terminée, combien de temps elle a duré, quelle tentative c'était là où le planificateur l'indique (le numéro d'essai d'Airflow), et l'erreur d'une exécution en échec. Après cinq exécutions, chaque pipeline apprend de ses propres exécutions combien de temps dure habituellement une exécution et combien de temps s'écoule entre deux exécutions selon sa planification. La page d'un pipeline recommande trois moniteurs :

- **Pipeline Run Failed** : une exécution a échoué ou a été interrompue.
- **Pipeline Run Unusually Long** : une exécution a pris deux fois sa durée habituelle ou plus, vérifié toutes les cinq minutes pendant qu'elle tourne, si bien qu'une exécution bloquée est repérée avant qu'elle ne se termine.
- **Pipeline Is Late** : aucune exécution n'a démarré depuis plus longtemps que sa planification ne le permet.

La page d'un pipeline dessine son **Lignage**, le premier endroit où regarder quand une exécution échoue ou est en retard : à gauche les tables qu'il lit, à droite les tables qu'il écrit, le pipeline entre les deux, et chaque carte indique son état actuel. Choisissez plus d'étapes pour voir à partir de quoi ces tables sont construites et ce qui est construit à partir d'elles, et ouvrez n'importe quelle table pour voir son propre onglet **Lignage**. Un nombre de tables non dessinées, sur la carte du pipeline ou sur celle d'une table, en dessine d'autres sur place ici aussi.

## Un seul signalement par cause

Quand une table devient obsolète, chaque table construite à partir d'elle le devient aussi. Avant qu'une alerte de données ne s'ouvre, OneUptime cherche dans le lignage une alerte déjà ouverte sur ce à partir de quoi sa table ou son pipeline est construit : les tables en amont, les pipelines qui y écrivent, et les bases de données où elles se trouvent, jusqu'à cinq niveaux plus haut. S'il en trouve une, la nouvelle alerte est une conséquence de cette alerte :

- Elle démarre à l'état **Pris en compte**, pour que personne ne soit prévenu deux fois pour un même problème, et se rétablit d'elle-même dès que ses données se rétablissent.
- Son fil d'activité et sa carte **Données** indiquent quelle alerte l'a causée, et elle rejoint l'épisode de la cause.

La carte **Données** de la cause liste son **Impact en aval** : chaque alerte qu'elle a causée. La carte d'une alerte de table montre aussi les services qui écrivent dans la table, avec leurs écritures en échec, ainsi que leurs déploiements et autres changements dans la journée précédant l'alerte.

Sous la carte **Données**, la page d'une alerte dessine son **Lignage** : autour de sa table, tel que l'onglet **Lignage** de la table le dessine, ou autour de son pipeline. Le chemin qui remonte jusqu'à l'alerte qui l'a causée et qui descend jusqu'à chaque alerte qu'elle a causée est mis en évidence - la table ou le pipeline de la cause marqué **Cause**, ceux de chaque alerte causée marqués **Conséquence** - et le reste s'estompe, si bien que quiconque l'ouvre voit où, dans la chaîne, le problème a commencé. Quand la cause porte sur un pipeline dessiné sur une flèche, la flèche indique **Cause** sous le nom du pipeline. Quand la cause porte sur une base de données entière, ou se trouve plus haut que ne remonte le diagramme, la carte le dit en toutes lettres. Une alerte issue d'un contrôle sur une seule colonne, comme un contrôle Pourcentage de NULL sur `customer_id`, s'ouvre avec cette colonne suivie à côté de ces chemins, comme dans l'onglet **Lignage** de la table : d'où elle vient et où elle va, nommée sur chaque table. Choisissez-y une autre colonne de la table, ou effacez-la pour ne voir que les chemins. **Explorer le lignage** ouvre l'onglet **Lignage** de la table, ou la page du pipeline.

Une personne qui ne peut pas voir l'alerte qui l'a causée n'a ni la carte **Données** ni le lignage, et une alerte causée qu'elle ne peut pas voir n'est ni mise en évidence ni comptée.

## Avant qu'un changement ne soit fusionné

Quand une pull request modifie une table surveillée, [Production Review](/docs/ai/ai-agent) indique sur la pull request ce qui en dépend : les services qui la lisent, les tables construites à partir d'elle, les tableaux de bord qui s'appuient sur elle, et ses produits de données. Une table dont une copie se trouve sur une base de données marquée Préproduction indique aussi en quoi la copie diffère : ses lignes, ses colonnes, et ce que les contrôles de la table y lisent, exécutés sur le champ. Sur une base de données que seule une sonde peut atteindre, les contrôles sont omis, et il le dit.

## Prochaines étapes

:::cards
- [Produits de données](/docs/data-observability/data-products): Des SLA de fraîcheur sur les tables qu'utilisent les gens.
- [OneUptime AI et l'API](/docs/data-observability/ai-and-api): Des investigations qui partent de ceux qui écrivent dans une table et de ses exécutions. Dans Demander à l'IA et via des agents IA, on peut demander à partir de quoi une table est construite.
:::
