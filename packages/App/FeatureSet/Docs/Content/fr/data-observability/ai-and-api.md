# OneUptime AI et l'API

OneUptime AI connaît vos données : il examine une alerte de données en partant de ceux qui écrivent dans la table, de ses exécutions et de ses tables en amont, répond partout où on le lui demande si une table est fraîche, et écrit un contrôle à partir d'une règle exprimée en une phrase. Tout ce que montre Observabilité des données est aussi à la disposition de vos propres outils, via ses points de terminaison, ses métriques et le serveur MCP.

## OneUptime AI

- **Les investigations des alertes de données.** Quand OneUptime AI examine une alerte sur une table, un pipeline ou une base de données, il part de ce qui l'entoure : la fraîcheur et les alertes ouvertes de la table, l'alerte dont elle est la conséquence, les exécutions des pipelines qui y écrivent depuis la veille (une exécution en échec avec son erreur, ou l'exécution qui n'est jamais venue), les services qui y écrivent avec leurs écritures en échec, leurs déploiements et autres changements, et les tables à partir desquelles elle est construite. Il nomme l'exécution, le déploiement ou la table en amont à l'origine de l'alerte. Voir [AI SRE](/docs/ai/ai-sre).
- **Cette table est-elle fraîche ?** Posez la question dans [Demander à l'IA](/docs/ai/ask-ai), Slack ou Microsoft Teams : « la table orders est-elle fraîche ? ». La réponse donne la fraîcheur de la table selon son propre rythme, le moment de sa dernière modification, ses alertes ouvertes, les dernières exécutions de ceux qui y écrivent et les produits de données dont elle fait partie. Un nom que partagent plusieurs bases de données reçoit une réponse pour chacune, afin que personne ne s'entende dire que la mauvaise table est fraîche.
- **Un contrôle à partir d'une phrase.** Dans l'onglet **Vérifications** d'une table, **Écrire un contrôle à partir d'une phrase** transforme une règle en un contrôle SQL personnalisé dans le SQL de votre moteur. Voir [Contrôles et rapprochements](/docs/data-observability/checks).

Chacune de ces fonctions exige que OneUptime AI soit activé pour le projet, et agit avec les autorisations de la personne qui pose la question.

## Les agents IA et le serveur MCP

Les agents IA devraient vérifier que les données sont fraîches avant de les utiliser. Le [serveur MCP](/docs/ai/mcp-server) dispose pour cela d'un outil en lecture seule :

| Outil | Ce à quoi il répond |
| --- | --- |
| `get_data_table_freshness` | Si une table surveillée est fraîche, quand elle a changé pour la dernière fois, ses alertes ouvertes, les dernières exécutions de ceux qui y écrivent et ses produits de données. Donnez `table` sous la forme `schema.table`, du seul nom de la table, ou de son ID |

Il fonctionne avec une connexion en lecture seule, et répond au nom de la personne ou de la clé API qui s'est connectée.

## Points de terminaison

| Point de terminaison | À quoi il sert | Signé avec |
| --- | --- | --- |
| `POST /telemetry/openlineage/api/v1/lineage` | Les événements OpenLineage d'Airflow, Dagster, Spark, dbt ou Flink | Une clé d'ingestion de télémétrie |
| `POST /telemetry/dbt/v1/artifacts` | Le `manifest` et les `run_results` d'un build dbt | Une clé d'ingestion de télémétrie |
| `POST /telemetry/fivetran/v1/webhook/<ingestion key ID>` | Les webhooks de synchronisation de Fivetran | La clé d'ingestion, comme secret de signature de Fivetran |
| `POST /telemetry/airbyte/v1/webhook/<ingestion key>` | Les webhooks de synchronisation d'Airbyte | La clé d'ingestion dans l'URL |
| `POST /api/data-observability/tables/freshness` | La fraîcheur d'une table, telle que l'outil MCP la donne, avec `{ "table": "public.orders" }` | Une clé API |
| `GET /api/data-observability/data-products/<data product ID>/badge?token=<badge token>` | Le badge « data as of » d'un produit de données | Le jeton propre au badge |

Les tables, contrôles, rapprochements, pipelines et produits de données sont aussi des ressources ordinaires de l'[API](/docs/api-reference/api-reference), lues et modifiées avec une clé API qui dispose des autorisations correspondantes.

## Métriques

Chaque nombre que conserve Observabilité des données est une métrique que vous pouvez tracer, placer sur un tableau de bord ou utiliser pour déclencher une alerte : `oneuptime.data.table.*` pour chaque table, `oneuptime.data.check.value` pour chaque contrôle, `oneuptime.data.reconciliation.*` pour chaque rapprochement, `oneuptime.data.pipeline.*` pour chaque pipeline et `oneuptime.data.product.*` pour chaque produit de données. Ce sont des données opérationnelles propres à OneUptime, qui ne sont pas facturées comme de la télémétrie.

## Prochaines étapes

:::cards
- [Serveur MCP](/docs/ai/mcp-server): Connectez un agent IA à OneUptime.
- [Observabilité des données](/docs/data-observability/index): Retour à la vue d'ensemble.
:::
