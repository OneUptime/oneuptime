# Produits de données

Les personnes qui utilisent les données - analystes, équipe financière, dirigeants, agents IA - pensent en termes de ce qu'elles utilisent : « les tables du tableau de bord du chiffre d'affaires », pas en bases de données. Un **produit de données** nomme ces tables, avec son propriétaire, ses consommateurs et son SLA de fraîcheur, et indique à tous ceux qui en dépendent si les données du jour sont arrivées.

## Créer un produit de données

Sous **Observabilité des données > Produits de données**, créez un produit de données : nommez-le, choisissez ses tables, et donnez-lui un SLA fait de l'un de ces critères, ou des deux :

- **À jour avant une heure de la journée (UTC) :** les données de chaque jour arrivent ce jour-là, avant cette heure. À partir de cette heure, chaque table doit avoir changé dans la journée ; jusque-là, le chargement de la veille fait foi. Un chargement qui a toujours une demi-heure de retard est en retard pendant cette demi-heure, chaque jour.
- **Un âge maximal :** aucune table ne doit avoir une dernière modification plus ancienne que cette durée.

Toutes les cinq minutes, les tables de chaque produit sont vérifiées par rapport à son SLA. Le produit est **En retard** dès que l'une de ses tables l'est, et ses données datent de la plus ancienne dernière modification parmi elles. Il écrit `oneuptime.data.product.late_tables` et `oneuptime.data.product.data_age`, afin que vous puissiez tracer côte à côte la fraîcheur de tous les produits.

## Sur les pages de statut

L'enregistrement d'un produit crée aussi un **moniteur** pour lui, en votre nom et avec vos autorisations. Le moniteur est Dégradé tant qu'une table est en retard, et ouvre un incident et une alerte au niveau de gravité le plus faible de votre projet, qui se résolvent d'eux-mêmes. Ajoutez-le comme ressource à une page de statut, privée ou publique : les consommateurs abonnés sont prévenus quand le produit est en retard, et quand il redevient frais. Voir [Ressources de la page de statut](/docs/status-pages/resources-and-groups).

## Comme SLO

L'enregistrement d'un produit crée aussi un **SLO** sur son moniteur : la part du temps où les données sont à l'heure, par rapport à l'objectif du produit sur 30 jours, avec les alertes de taux d'épuisement rapide et lent avec lesquelles démarre chaque SLO. Voir [SLO](/docs/slo/introduction). Supprimer le produit supprime son moniteur et son SLO.

## Le badge « data as of »

Chaque produit a un **badge** qui indique de quand datent ses données, vert tant qu'elles sont à l'heure et orange avec « late » sinon. Intégrez-le dans un tableau de bord BI, une page de wiki ou un README depuis la **Vue d'ensemble** du produit :

```markdown
![Data as of](https://oneuptime.com/api/data-observability/data-products/<data product ID>/badge?token=<badge token>)
```

Son lien ne demande aucune connexion : traitez-le donc comme un lien partagé. **Réinitialiser le lien du badge** en crée un nouveau et désactive l'ancien.

## Prochaines étapes

:::cards
- [Santé des tables](/docs/data-observability/table-health): Comment la fraîcheur de chaque table est apprise.
- [OneUptime AI et l'API](/docs/data-observability/ai-and-api): Laissez les agents IA vérifier les tables d'un produit avant de les utiliser.
:::
