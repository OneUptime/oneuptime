# OneUptime AI et l'API

OneUptime AI connaît vos données : il examine une alerte de données en partant de ceux qui écrivent dans la table, de ses exécutions et de son lignage, répond partout où on le lui demande si une table est fraîche et à partir de quoi elle est construite, et écrit un contrôle à partir d'une règle exprimée en une phrase. Tout ce que montre Observabilité des données est aussi à la disposition de vos propres outils, via ses points de terminaison, ses métriques et le serveur MCP.

## OneUptime AI

- **Les investigations des alertes de données.** Quand OneUptime AI examine une alerte sur une table, un pipeline ou une base de données, il part de ce qui l'entoure : la fraîcheur et les alertes ouvertes de la table, l'alerte dont elle est la conséquence, les exécutions des pipelines qui y écrivent depuis la veille (une exécution en échec avec son erreur, ou l'exécution qui n'est jamais venue), les services qui y écrivent avec leurs écritures en échec, leurs déploiements et autres changements, son lignage (les tables à partir desquelles elle est construite et les tables construites à partir d'elle, celles qui ont un problème d'abord, la place qu'y occupe l'alerte dont elle est la conséquence, et les tables où se trouvent les alertes qu'elle a provoquées), et les colonnes qui ont changé. Pour une alerte issue d'un contrôle sur une seule colonne, il suit aussi cette colonne dans le lignage : les colonnes en amont à partir desquelles elle est construite et les colonnes en aval construites à partir d'elle, table par table, telles que les sources du lignage les nomment. Il nomme l'exécution, le déploiement ou la table en amont à l'origine de l'alerte. Voir [AI SRE](/docs/ai/ai-sre).
- **Cette table est-elle fraîche ?** Posez la question dans [Demander à l'IA](/docs/ai/ask-ai), Slack ou Microsoft Teams : « la table orders est-elle fraîche ? ». La réponse donne la fraîcheur de la table selon son propre rythme, le moment de sa dernière modification, ses alertes ouvertes, les dernières exécutions de ceux qui y écrivent et les produits de données dont elle fait partie. Un nom que partagent plusieurs bases de données reçoit une réponse pour chacune, afin que personne ne s'entende dire que la mauvaise table est fraîche.
- **À partir de quoi cette table est-elle construite ?** Demandez « qu'est-ce qui alimente la table revenue ? » ou « qu'est-ce qui casse si raw.orders ne se charge plus ? ». La réponse suit le lignage de la table sur trois étapes de chaque côté, ou jusqu'à cinq sur demande, et met d'abord ce qui ne va pas : les tables en amont et en aval qui sont en retard, supprimées, qui ont des alertes ouvertes ou dont le pipeline a échoué à sa dernière exécution, les plus proches d'abord, chacune avec le nombre d'étapes qui l'en séparent et les tables entre les deux. Viennent ensuite les autres, les pipelines qui chargent ses sources depuis l'extérieur de ce que OneUptime surveille, et les tableaux de bord BI construits dessus. Les alertes ouvertes sont comptées, jamais nommées, et seulement celles que la personne qui demande peut voir.
- **Un contrôle à partir d'une phrase.** Dans l'onglet **Vérifications** d'une table, **Écrire un contrôle à partir d'une phrase** transforme une règle en un contrôle SQL personnalisé dans le SQL de votre moteur. Voir [Contrôles et rapprochements](/docs/data-observability/checks).

- **Dérive lente.** Les lignes d'une table, ou la valeur d'un contrôle, qui bougent d'un cinquième ou plus en une semaine, trop lentement pour déclencher une alerte, vont dans AI Insights comme un point à regarder. Cela ne réveille personne.
- **Données obsolètes derrière les applications IA.** Un service qui appelle un modèle et lit une table est le consommateur IA de cette table. Quand une telle table prend du retard, la page **Conversations** du produit IA le signale : une application qui répond à partir de données anciennes n'a rien d'anormal dans ses propres traces.

Chacune de ces fonctions exige que OneUptime AI soit activé pour le projet, et agit avec les autorisations de la personne qui pose la question.

## Les agents IA et le serveur MCP

Les agents IA devraient vérifier que les données sont fraîches avant de les utiliser, et ce qui est construit à partir d'une table avant de la modifier. Le [serveur MCP](/docs/ai/mcp-server) dispose pour cela d'outils en lecture seule :

| Outil | Ce à quoi il répond |
| --- | --- |
| `get_data_table_freshness` | Si une table surveillée est fraîche, quand elle a changé pour la dernière fois, ses alertes ouvertes, les dernières exécutions de ceux qui y écrivent et ses produits de données. Donnez `table` sous la forme `schema.table`, du seul nom de la table, ou de son ID |
| `get_data_table_lineage` | À partir de quoi une table surveillée est construite et ce qui est construit à partir d'elle, sur trois étapes de chaque côté ou jusqu'à cinq : les tables qui ont un problème d'abord, les plus proches d'abord, puis les autres, les pipelines qui chargent ses sources depuis l'extérieur et les tableaux de bord BI construits dessus. Donnez `table` comme pour sa fraîcheur, et `depth` de 1 à 5 |

Ils fonctionnent avec une connexion en lecture seule, et répondent au nom de la personne ou de la clé API qui s'est connectée.

## Points de terminaison

| Point de terminaison | À quoi il sert | Signé avec |
| --- | --- | --- |
| `POST /telemetry/openlineage/api/v1/lineage` | Les événements OpenLineage d'Airflow, Dagster, Spark, dbt ou Flink | Une clé d'ingestion de télémétrie |
| `POST /telemetry/dbt/v1/artifacts` | Le `manifest` et les `run_results` d'un build dbt | Une clé d'ingestion de télémétrie |
| `POST /telemetry/fivetran/v1/webhook/<ingestion key ID>` | Les webhooks de synchronisation de Fivetran | La clé d'ingestion, comme secret de signature de Fivetran |
| `POST /telemetry/airbyte/v1/webhook/<ingestion key>` | Les webhooks de synchronisation d'Airbyte | La clé d'ingestion dans l'URL |
| `POST /api/data-observability/tables/freshness` | La fraîcheur d'une table, telle que l'outil MCP la donne, avec `{ "table": "public.orders" }` | Une clé API |
| `POST /api/data-observability/tables/lineage` | Le lignage d'une table sur quelques étapes de chaque côté, avec l'état de chaque table, tel que son onglet **Lignage** le dessine, avec `{ "dataAssetId": "<table ID>", "depth": 3 }`, et avec `"withColumns": true` les colonnes que porte chaque flèche | Une clé API |
| `POST /api/data-observability/tables/lineage/answer` | Le lignage d'une table raconté en mots, les tables qui ont un problème d'abord, tel que l'outil MCP le donne, avec `{ "table": "public.orders", "depth": 3 }` | Une clé API |
| `POST /api/data-observability/pipelines/lineage` | Les tables qu'un pipeline lit et écrit, avec l'état de chacune, telles que sa page les dessine, avec `{ "dataPipelineId": "<pipeline ID>", "depth": 1 }` | Une clé API |
| `POST /api/data-observability/alerts/<alert ID>/lineage` | Le lignage d'une alerte de données, tel que sa page le dessine, avec le chemin vers l'alerte qui l'a causée et vers les alertes qu'elle a causées, et pour une alerte issue d'un contrôle sur une seule colonne, sa `column` et les colonnes que porte chaque flèche | Une clé API |
| `POST /api/data-observability/lineage/expand` | Les tables suivantes qu'une carte d'un diagramme de lignage ne dessine pas, comme les dessine la sélection de son nombre : la carte en `nodeId` avec son `side`, et ce qui est dessiné en `focusNodeId`, `tables` et `dataDashboardIds` | Une clé API |
| `POST /api/data-observability/checks/apply` | Faire correspondre les contrôles du projet à un fichier, comme le fait `oneuptime data-checks apply`, avec `{ "manifest": "...", "isDryRun": true, "shouldPrune": false }` | Une clé API |
| `GET /api/data-observability/data-products/<data product ID>/badge?token=<badge token>` | Le badge « data as of » d'un produit de données | Le jeton propre au badge |

Les tables, contrôles, rapprochements, pipelines, produits de données, connexions BI et tâches d'entrepôt sont aussi des ressources ordinaires de l'[API](/docs/api-reference/api-reference), lues et modifiées avec une clé API qui dispose des autorisations correspondantes, ainsi que du serveur MCP et des workflows.

## Métriques

Chaque nombre que conserve Observabilité des données est une métrique que vous pouvez tracer, placer sur un tableau de bord ou utiliser pour déclencher une alerte : `oneuptime.data.table.*` pour chaque table, `oneuptime.data.check.value` pour chaque contrôle, `oneuptime.data.reconciliation.*` pour chaque rapprochement, `oneuptime.data.pipeline.*` pour chaque pipeline et `oneuptime.data.product.*` pour chaque produit de données. Ce sont des données opérationnelles propres à OneUptime, qui ne sont pas facturées comme de la télémétrie.

## Prochaines étapes

:::cards
- [Serveur MCP](/docs/ai/mcp-server): Connectez un agent IA à OneUptime.
- [Observabilité des données](/docs/data-observability/index): Retour à la vue d'ensemble.
:::
