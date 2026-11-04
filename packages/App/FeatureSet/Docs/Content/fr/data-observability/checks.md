# Contrôles et rapprochements

La santé des tables dit si une table change. Un **contrôle** dit si ce qu'elle contient est juste, un **rapprochement** dit si deux copies des données concordent, et les **tests de dbt** rendent compte des tables que dbt construit. Chacun s'exécute là où s'exécute la collecte de la base de données, chez OneUptime ou sur sa sonde, et seul un nombre quitte jamais la base de données.

## Contrôles

Ajoutez un contrôle dans l'onglet **Vérifications** d'une table :

| Contrôle | Ce qu'il lit |
| --- | --- |
| **Null Percent** | Pourcentage de lignes dont la colonne est vide |
| **Duplicate Percent** | Pourcentage de valeurs qui répètent celle d'une autre ligne |
| **Distinct Count** | Nombre de valeurs différentes que contient la colonne |
| **Minimum**, **Maximum**, **Moyenne**, **Somme** | D'une colonne numérique (la somme de zéro ligne vaut 0) |
| **Invalid Percent** | Pourcentage de valeurs hors d'une liste que vous fournissez |
| **Format Mismatch Percent** | Pourcentage de valeurs qui ne correspondent pas à une expression régulière (tous les moteurs sauf SQL Server) |
| **Orphan Count** | Lignes dont la valeur n'a aucune correspondance dans la colonne d'une autre table |
| **Row Count** | Lignes de la table, surtout utile avec **Segment By** |
| **SQL personnalisé** | Le nombre que renvoie l'un de vos SELECT en lecture seule, nommé `value` (sur MongoDB, celui d'un pipeline d'agrégation) |

Chaque contrôle s'exécute toutes les 15 minutes, toutes les heures, toutes les 6 heures ou tous les jours, sous la forme d'une seule instruction d'agrégation dans une transaction en lecture seule avec un délai d'expiration d'instruction. Sa valeur est écrite comme `oneuptime.data.check.value`, avec `oneuptime.data.check.id`, `oneuptime.data.check.name` et `oneuptime.data.check.segment`.

## Contrôles suggérés

**Suggested Checks**, dans le même onglet, propose les contrôles qu'appellent les colonnes d'une table, d'après leurs seuls noms et types : un identifiant est unique, un `customer_id` a une ligne correspondante dans `customers`, une adresse e-mail en a bien la forme, un montant n'est pas négatif, un statut garde ses valeurs habituelles, et une table répartie par locataire est comptée par locataire. Ajoutez-en un, ajoutez-les tous, ou écartez-en un définitivement.

## Un contrôle à partir d'une phrase

**Écrire un contrôle à partir d'une phrase** transforme une règle comme « les commandes n'ont jamais un total négatif » en un contrôle SQL personnalisé qui compte les lignes qui l'enfreignent, dans le SQL propre à votre moteur, avec une alerte dès qu'il y en a. Vous lisez la requête avant que **Ajouter le contrôle** ne l'ajoute, et elle est soumise aux mêmes règles que tout contrôle SQL personnalisé. Il faut pour cela que OneUptime AI soit activé pour le projet.

## Segments

**Segment By** exécute un contrôle une fois par valeur d'une colonne, comme un locataire ou une région : une série et une alerte pour chacune, pour les 100 segments les plus volumineux. Un nombre de lignes segmenté alerte quand un locataire cesse d'envoyer des données alors que les autres continuent.

## Alertes sur un contrôle

Renseignez **Alert When** pour déclencher une alerte sur un contrôle :

- **Unusually High** ou **Unusually Low** compare chaque valeur à sa propre référence apprise pour cette heure de la semaine.
- **Au-dessus de** ou **En dessous de** la compare à un seuil.

L'enregistrement du contrôle crée un moniteur de métrique pour lui, en votre nom et avec vos autorisations. Vider la condition supprime le moniteur.

## Rapprochements

Les copies dérivent : l'entrepôt a moins de commandes que la base de données de l'application, ou une migration a perdu des lignes. Un rapprochement compare une mesure de deux tables, dans une même base de données ou dans deux, sous **Rapprochements** :

- **Row Count**
- **Somme** d'une colonne
- **Distinct Count** d'une colonne
- **SQL personnalisé** : une requête en lecture seule qui renvoie un seul nombre, nommé `value`

Il a une tolérance : un montant fixe (**Absolue**) ou un pourcentage de la valeur de la source (**Pourcentage**). Chaque côté est lu par un contrôle qui lui est propre, que le rapprochement crée et maintient, avec la collecte de sa base de données : un rapprochement peut ainsi comparer une table PostgreSQL de votre réseau à sa copie dans Snowflake. Les deux valeurs sont comparées dès que les deux ont été lues à 15 minutes d'intervalle au plus. Un rapprochement écrit :

- `oneuptime.data.reconciliation.drifted` : 1 quand les deux ont dérivé au-delà de la tolérance, 0 quand elles concordent. Son moniteur lit cette valeur.
- `oneuptime.data.reconciliation.difference` : la valeur de la cible moins celle de la source.
- `oneuptime.data.reconciliation.difference_percent` : la différence en pourcentage de la valeur de la source.

Une copie chargée selon une planification est en retard sur sa source : comparez avec du SQL personnalisé une mesure sur laquelle les deux se sont stabilisées, comme les lignes de plus d'une heure, ou tenez compte du décalage dans la tolérance.

## Tests dbt

Après un build dbt, `oneuptime dbt upload` envoie les artefacts du projet (voir [Lignage et pipelines](/docs/data-observability/lineage-and-pipelines)). Chaque test d'une table surveillée apparaît alors dans son onglet **Vérifications**, avec son dernier résultat et les lignes qu'il a trouvées en échec. Choisissez **Alert on Failures** pour qu'un test en échec ouvre une alerte.

## Prochaines étapes

:::cards
- [Lignage et pipelines](/docs/data-observability/lineage-and-pipelines): Envoyez les artefacts de dbt, et voyez l'exécution à l'origine d'un contrôle en échec.
- [Produits de données](/docs/data-observability/data-products): Promettez aux personnes qui utilisent les données qu'elles sont fraîches.
:::
