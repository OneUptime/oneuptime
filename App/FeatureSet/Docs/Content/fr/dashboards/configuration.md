# Configuration et permissions

Cette page rassemble les paramètres et les boutons de contrôle d'accès qu'il vaut la peine de connaître une fois que vous avez un tableau de bord que vous voulez réellement garder.

## Propriété

Les **propriétaires** d'un tableau de bord sont les utilisateurs et équipes à qui sont accordées des permissions explicites dessus (distinctes du rôle à l'échelle du projet).

Sous **Tableau de bord → Owners** :

- Ajoutez un **propriétaire utilisateur** pour accorder à une personne spécifique un accès supplémentaire à ce tableau de bord.
- Ajoutez un **propriétaire équipe** pour accorder la même chose à chaque membre d'une équipe.

Utilisez la propriété lorsque le rôle de lecture à l'échelle du projet est trop large — par exemple, un tableau de bord avec des détails sensibles au niveau client qui ne devrait être visible que par l'équipe customer-success.

## Étiquettes

Les étiquettes sont des tags plusieurs-à-plusieurs pour organiser les tableaux de bord. Appliquez-les sous **Tableau de bord → Overview**.

Motifs d'étiquettes courants :

- **Par équipe** : `team:platform`, `team:checkout`, `team:growth`.
- **Par environnement** : `env:prod`, `env:staging`.
- **Par objectif** : `purpose:oncall`, `purpose:exec`, `purpose:investigation`.

La liste **Tableaux de bord** vous permet de filtrer par étiquette, ce qui est le moyen le plus rapide de trouver un tableau de bord dans un projet qui en a accumulé des dizaines.

## Permissions

Les tableaux de bord sont des ressources de première classe dans le contrôle d'accès basé sur les rôles de OneUptime. Les permissions pertinentes :

| Permission | Autorise |
| --- | --- |
| `CreateDashboard` | Créer de nouveaux tableaux de bord dans le projet. |
| `ReadDashboard` | Voir les tableaux de bord (en mode privé). |
| `EditDashboard` | Modifier les widgets, variables, paramètres sur un tableau de bord. |
| `DeleteDashboard` | Supprimer un tableau de bord. |

Il y a des permissions correspondantes pour les entités de support : les propriétaires de tableau de bord (utilisateur / équipe) et les domaines personnalisés ont leurs propres paires create / read / edit / delete afin que vous puissiez accorder « gérer les propriétaires » sans accorder « éditer le tableau de bord lui-même ».

Attribuez-les sur les rôles de projet sous **Project Settings → Teams & Roles**.

## Contrôle d'accès en mode public

L'accès en mode public (voir [Partage et tableaux de bord publics](/docs/dashboards/sharing)) est régi par trois couches, dans l'ordre :

1. Bascule **Public Dashboard** — si désactivée, l'URL publique retourne un 404.
2. **Master Password** — si défini, les visiteurs doivent l'entrer avant que le tableau de bord ne se rende.
3. **IP Whitelist** (plan Scale) — si défini, les requêtes depuis des IP non listées reçoivent un 403.

Un tableau de bord peut avoir n'importe quelle combinaison. La configuration la plus défensive est « Public activé, mot de passe défini, liste blanche d'IP active » — utile pour les portails partenaires où vous voulez les trois.

## Rétention

Les tableaux de bord eux-mêmes n'expirent pas. Les données qu'ils affichent suivent la rétention de télémétrie du projet — les métriques, journaux et traces sont interrogeables tant que votre plan les conserve. Un widget pointant sur « les 90 derniers jours » sur un plan avec 30 jours de rétention rendra ce qui reste dans le stockage.

## Cloner un tableau de bord

Pour dupliquer un tableau de bord existant, ouvrez-le et utilisez l'action **Duplicate** depuis la liste des tableaux de bord. La copie inclut chaque widget, variable et paramètre sauf la configuration en mode public (qui commence toujours désactivée — vous décidez s'il faut la réactiver sur la copie).

C'est le motif approprié quand vous voulez forker un template (« notre tableau de bord d'astreinte ») en une version spécifique à un service.

## Supprimer un tableau de bord

Sous **Tableau de bord → Delete**. Ceci est irréversible — la configuration du canevas et tous les bindings de domaines personnalisés sont supprimés. Les données de télémétrie ne sont pas affectées (elles vivent dans les stockages de métriques / journaux / traces, pas sur le tableau de bord).

Si un tableau de bord est publié publiquement avec un domaine personnalisé, l'URL publique cesse de résoudre au moment où vous le supprimez. Retirez d'abord le domaine si vous devez le repointer.

## Migration et sauvegarde

Pour les installations auto-hébergées : la configuration complète du tableau de bord (widgets, variables, paramètres) vit dans la table `Dashboard` dans Postgres. Une sauvegarde régulière de la base de données est suffisante — il n'y a pas de format d'export de tableau de bord séparé.

Pour OneUptime Cloud : les sauvegardes régulières sont gérées pour vous. Si vous voulez une copie locale de la configuration d'un tableau de bord, utilisez l'[API OneUptime](/docs/api-reference/api-reference) pour lire l'enregistrement `Dashboard`.

## Où lire ensuite

- [Partage et tableaux de bord publics](/docs/dashboards/sharing) — le côté public du contrôle d'accès.
- [Variables et filtres](/docs/dashboards/variables) — templating.
- [Widgets](/docs/dashboards/widgets) — le catalogue de widgets.
- [Présentation des tableaux de bord](/docs/dashboards/index) — la carte conceptuelle.
