# Contrôles et rapprochements

La santé des tables dit si une table change. Un **contrôle** dit si ce qu'elle contient est juste, un **rapprochement** dit si deux copies des données concordent, et les **tests de dbt** rendent compte des tables que dbt construit. Chacun s'exécute là où s'exécute la collecte de la base de données, chez OneUptime ou sur sa sonde, et seul un nombre quitte la base de données, sauf si un projet choisit de conserver un échantillon masqué des lignes en échec.

## Contrôles

Ajoutez un contrôle dans l'onglet **Vérifications** d'une table :

| Contrôle | Ce qu'il lit |
| --- | --- |
| **Pourcentage de NULL** | Pourcentage de lignes dont la colonne est vide |
| **Pourcentage de doublons** | Pourcentage de valeurs qui répètent celle d'une autre ligne |
| **Nombre de valeurs distinctes** | Nombre de valeurs différentes que contient la colonne |
| **Minimum**, **Maximum**, **Moyenne**, **Somme** | D'une colonne numérique (la somme de zéro ligne vaut 0) |
| **Pourcentage de valeurs invalides** | Pourcentage de valeurs hors d'une liste que vous fournissez |
| **Pourcentage d'erreurs de format** | Pourcentage de valeurs qui ne sont pas dans un format que vous choisissez, comme Email, UUID ou Country Code, ou qui ne correspondent pas à une expression régulière de votre choix (tous les moteurs sauf SQL Server et Dataverse) |
| **Nombre de lignes orphelines** | Lignes dont la valeur n'a aucune correspondance dans la colonne d'une autre table |
| **Nombre de lignes** | Lignes de la table, surtout utile avec **Segmenter par** |
| **SQL personnalisé** | Le nombre que renvoie l'un de vos SELECT en lecture seule, nommé `value` (sur MongoDB, celui d'un pipeline d'agrégation) |
| **Lignes en échec** | Combien de lignes renvoie l'un de vos SELECT en lecture seule : les lignes qui ne devraient pas exister. 0 est sain (sur MongoDB, les documents auxquels aboutit un pipeline) |

Chaque contrôle s'exécute toutes les 15 minutes, toutes les heures, toutes les 6 heures ou tous les jours, sous la forme d'une seule instruction d'agrégation dans une transaction en lecture seule avec un délai d'expiration d'instruction. Sa valeur est écrite comme `oneuptime.data.check.value`, avec `oneuptime.data.check.id`, `oneuptime.data.check.name` et `oneuptime.data.check.segment`.

## Contrôles suggérés

**Vérifications suggérées**, dans le même onglet, propose les contrôles qu'appellent les colonnes d'une table, d'après leurs seuls noms et types : un identifiant est unique, un `customer_id` a une ligne correspondante dans `customers`, une adresse e-mail en a bien la forme, un montant n'est pas négatif, un statut garde ses valeurs habituelles, et une table répartie par locataire est comptée par locataire. Une colonne dont Sécurité des données sait qu'elle contient une adresse e-mail, un numéro de téléphone ou une adresse IP est tenue à ce format, quel que soit son nom. Ajoutez-en un, ajoutez-les tous, ou écartez-en un définitivement.

## Un contrôle à partir d'une phrase

**Écrire un contrôle à partir d'une phrase** transforme une règle comme « les commandes n'ont jamais un total négatif » en un contrôle SQL personnalisé qui compte les lignes qui l'enfreignent, dans le SQL propre à votre moteur, avec une alerte dès qu'il y en a. Vous lisez la requête avant que **Ajouter le contrôle** ne l'ajoute, et elle est soumise aux mêmes règles que tout contrôle SQL personnalisé. Il faut pour cela que OneUptime AI soit activé pour le projet. Sur MongoDB, le résultat est un pipeline d'agrégation.

## Segments

**Segmenter par** exécute un contrôle une fois par valeur d'une colonne, comme un locataire ou une région : une série et une alerte pour chacune, pour les 100 segments les plus volumineux. Un nombre de lignes segmenté alerte quand un locataire cesse d'envoyer des données alors que les autres continuent.

## Alertes sur un contrôle

Renseignez **Alerter quand** pour déclencher une alerte sur un contrôle :

- **Anormalement haut** ou **Anormalement bas** compare chaque valeur à sa propre référence apprise pour cette heure de la semaine.
- **Au-dessus de** ou **En dessous de** la compare à un seuil.

L'enregistrement du contrôle crée un moniteur de métrique pour lui, en votre nom et avec vos autorisations. Vider la condition supprime le moniteur.

Le **Statut** d'un contrôle, dans **Vérifications** et dans l'onglet **Vérifications** de sa table, dit où il en est : **En échec** tant que son alerte est ouverte, **Réussi** tant qu'elle ne l'est pas, et **Exécution impossible** quand sa requête a échoué. Un contrôle sans alerte affiche seulement **Exécuté** : sa requête a fonctionné. Un contrôle en échec, et un contrôle qui n'a pas pu s'exécuter, figurent aussi dans la **Vue d'ensemble**.

## Ce que coûte un contrôle

Un contrôle se dispute la base de données avec votre application, et sur un entrepôt qui facture selon ce qu'une requête lit, il coûte de l'argent. Trois choses permettent de le maîtriser :

- **Pourcentage d'échantillon** lit une part des lignes au lieu de toutes, pour un contrôle qui lit un taux : Pourcentage de NULL, Moyenne, Pourcentage de valeurs invalides et Pourcentage d'erreurs de format. La plupart des moteurs sautent des pages entières de la table ; MySQL, Redshift, ClickHouse et MongoDB lisent encore chaque ligne, et s'épargnent le travail sur les autres. Dataverse ne prend aucun échantillon : un contrôle y lit chaque ligne. Une vue peut le refuser, et le contrôle l'indique.
- **Maximum lisible par une vérification (Go)**, sous **Paramètres**, arrête un contrôle sur BigQuery ou Athena avant qu'il ne lise plus de gigaoctets que cela. Il vaut 10 tant que vous ne le changez pas.
- **Attendre quand une base de données est occupée**, sous **Paramètres**, laisse les contrôles dus pour la prochaine collecte quand une base de données PostgreSQL, MySQL ou SQL Server semble occupée. Il est activé tant que vous ne le désactivez pas, et la base de données indique quand des contrôles ont attendu.

## Lignes en échec

Un nombre dit que quelque chose ne va pas ; quelques lignes disent quoi. **Conserver les Failing Rows** sous **Paramètres** conserve jusqu'à 20 des lignes qu'a trouvées un contrôle Lignes en échec, Pourcentage de valeurs invalides, Pourcentage d'erreurs de format ou Nombre de lignes orphelines, et **Lignes en échec** sur le contrôle les affiche. Ce réglage reste désactivé tant que vous ne l'activez pas. Les colonnes sensibles sont masquées à l'endroit où la ligne est lue, d'après ce que Sécurité des données y a trouvé ou d'après leurs noms, de sorte que ce qui quitte la base de données, ou une sonde, est déjà masqué. Une colonne sensible qu'aucune analyse n'a trouvée et dont le nom ne la trahit pas est conservée telle quelle.

Les lignes sont stockées dans OneUptime : sur les serveurs de OneUptime avec OneUptime Cloud, et sur les vôtres avec une installation auto-hébergée. Toute personne autorisée à lire les contrôles du projet peut les voir. Un contrôle ne conserve que les lignes de sa dernière exécution, et désactiver **Conserver les Failing Rows** supprime ce que chaque contrôle avait conservé.

## Des contrôles dans un fichier

Les contrôles écrits à la main dérivent du code qui modifie les tables. Gardez-les dans votre dépôt, relus dans la même pull request :

```yaml
checks:
  - name: Orders have a total
    table: public.orders
    type: Null Percent
    column: total
    every: 60
    alert: { when: Above, threshold: 1 }
  - name: Emails look right
    table: public.customers
    database: Orders database
    type: Format Mismatch Percent
    column: email
    format: Email
    sample_percent: 10
  - name: Orders have a customer
    table: public.orders
    type: Orphan Count
    column: customer_id
    references: public.customers.id
  - name: No negative totals
    table: public.orders
    type: Failing Rows
    query: SELECT id FROM orders WHERE total < 0
    alert: { when: Above, threshold: 0 }
```

Appliquez-le depuis la CI avec la [CLI OneUptime](/docs/cli/index) et une clé API :

```bash
oneuptime data-checks apply checks.yaml --dry-run
oneuptime data-checks apply checks.yaml --prune
```

Un contrôle est le même contrôle s'il porte le même nom sur la même table, donc appliquer un fichier deux fois ne change rien. Une erreur n'importe où dans le fichier n'applique rien et se termine par une erreur : lancez donc `--dry-run` sur la pull request et appliquez à la fusion. Avec `--prune`, un contrôle qu'un apply précédent a créé et que le fichier ne nomme plus est supprimé. Un contrôle que vous avez ajouté à la main ne l'est jamais. Un contrôle issu d'un fichier l'indique sur sa ligne, et son prochain apply écrase ce qui a été changé à la main.

Les clés sont `name`, `table`, `database`, `type`, `column`, `segment`, `accepted_values`, `format`, `pattern`, `references`, `query`, `sample_percent`, `every`, `alert`, `description` et `enabled`.

## Rapprochements

Les copies dérivent : l'entrepôt a moins de commandes que la base de données de l'application, ou une migration a perdu des lignes. Un rapprochement compare une mesure de deux tables, dans une même base de données ou dans deux, sous **Rapprochements** :

- **Nombre de lignes**
- **Somme** d'une colonne
- **Nombre de valeurs distinctes** d'une colonne
- **SQL personnalisé** : une requête en lecture seule qui renvoie un seul nombre, nommé `value`

Il a une tolérance : un montant fixe (**Absolue**) ou un pourcentage de la valeur de la source (**Pourcentage**). Chaque côté est lu par un contrôle qui lui est propre, que le rapprochement crée et maintient, avec la collecte de sa base de données : un rapprochement peut ainsi comparer une table PostgreSQL de votre réseau à sa copie dans Snowflake. Les deux valeurs sont comparées dès que les deux ont été lues à 15 minutes d'intervalle au plus. Un rapprochement écrit :

- `oneuptime.data.reconciliation.drifted` : 1 quand les deux ont dérivé au-delà de la tolérance, 0 quand elles concordent. Son moniteur lit cette valeur.
- `oneuptime.data.reconciliation.difference` : la valeur de la cible moins celle de la source.
- `oneuptime.data.reconciliation.difference_percent` : la différence en pourcentage de la valeur de la source.

Une copie chargée selon une planification est en retard sur sa source : comparez avec du SQL personnalisé une mesure sur laquelle les deux se sont stabilisées, comme les lignes de plus d'une heure, ou tenez compte du décalage dans la tolérance.

## Tests dbt

Après un build dbt, `oneuptime dbt upload` envoie les artefacts du projet (voir [Lignage et pipelines](/docs/data-observability/lineage-and-pipelines)). Chaque test d'une table surveillée apparaît alors dans son onglet **Vérifications**, avec son dernier résultat et les lignes qu'il a trouvées en échec. Choisissez **Alerter en cas d'échec** pour qu'un test en échec ouvre une alerte.

## Prochaines étapes

:::cards
- [Lignage et pipelines](/docs/data-observability/lineage-and-pipelines): Envoyez les artefacts de dbt, et voyez l'exécution à l'origine d'un contrôle en échec.
- [Produits de données](/docs/data-observability/data-products): Promettez aux personnes qui utilisent les données qu'elles sont fraîches.
:::
