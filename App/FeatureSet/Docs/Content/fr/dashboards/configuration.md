# Configuration et permissions

Cette page couvre les paramètres et les contrôles d'accès qu'il convient de connaître une fois que vous avez un tableau de bord que vous souhaitez conserver.

## Propriétaires

Les **propriétaires** d'un tableau de bord sont les utilisateurs et équipes auxquels vous avez accordé un accès explicite (en plus de leur rôle dans le projet).

Sous **Dashboard → Owners** :

- Ajoutez un **propriétaire utilisateur** pour donner à une personne un accès supplémentaire à ce tableau de bord.
- Ajoutez un **propriétaire équipe** pour donner le même accès à tous les membres d'une équipe.

Utilisez les propriétaires lorsque le rôle de lecture général du projet est trop large — par exemple, un tableau de bord contenant des détails au niveau du client qui ne devrait être visible que par l'équipe de succès client.

## Étiquettes

Les étiquettes sont des balises pour organiser les tableaux de bord. Appliquez-les sous **Dashboard → Overview**.

Schémas courants :

- **Par équipe** : `team:platform`, `team:checkout`, `team:growth`.
- **Par environnement** : `env:prod`, `env:staging`.
- **Par objectif** : `purpose:oncall`, `purpose:exec`, `purpose:investigation`.

La liste **Dashboards** vous permet de filtrer par étiquette, ce qui est le moyen le plus rapide de retrouver un tableau de bord dans un projet qui en a accumulé beaucoup.

## Permissions

Les tableaux de bord fonctionnent avec le contrôle d'accès basé sur les rôles de votre projet. Les permissions pertinentes :

| Permission           | Ce qu'elle autorise                                    |
| -------------------- | ------------------------------------------------------ |
| **Create Dashboard** | Créer de nouveaux tableaux de bord.                    |
| **Read Dashboard**   | Consulter les tableaux de bord (en mode privé).        |
| **Edit Dashboard**   | Modifier les widgets, les variables et les paramètres. |
| **Delete Dashboard** | Supprimer un tableau de bord.                          |

Il existe des permissions équivalentes pour les propriétaires de tableaux de bord et les domaines personnalisés, vous pouvez donc accorder « gérer les propriétaires » sans accorder « modifier le tableau de bord ».

Attribuez ces permissions aux rôles de projet sous **Project Settings → Teams & Roles**.

## Accès aux tableaux de bord publics

Lorsque vous rendez un tableau de bord public (voir [Partage et tableaux de bord publics](/docs/dashboards/sharing)), trois paramètres contrôlent qui peut le voir :

1. Interrupteur **Public Dashboard** — s'il est désactivé, l'URL publique renvoie une 404.
2. **Master Password** — s'il est défini, les visiteurs saisissent un mot de passe avant que le tableau de bord n'apparaisse.
3. **IP Whitelist** (plan Scale) — si elle est définie, les requêtes provenant d'autres IP sont rejetées.

Vous pouvez combiner ces options. La combinaison la plus verrouillée est « Public activé, mot de passe défini, liste d'IP autorisées active » — utile pour des portails partenaires où vous voulez les trois couches.

## Rétention des données

Les tableaux de bord eux-mêmes n'expirent pas. Les données qu'ils affichent suivent les paramètres de rétention de votre projet — les métriques, les journaux et les traces sont interrogeables aussi longtemps que votre plan les conserve. Un widget pointé sur « les 90 derniers jours » sur un plan qui en conserve 30 affichera ce qui est encore stocké.

## Dupliquer un tableau de bord

Pour copier un tableau de bord existant, ouvrez la liste des tableaux de bord et choisissez **Duplicate**. La copie comprend tous les widgets, variables et paramètres sauf le partage public — celui-ci commence toujours désactivé pour que vous puissiez décider de le réactiver ou non.

C'est la bonne approche quand vous voulez dériver un modèle (comme « notre tableau de bord d'astreinte ») en une copie spécifique à un service.

## Supprimer un tableau de bord

Sous **Dashboard → Delete**. Cette action est irréversible — la mise en page du tableau de bord et tous les domaines personnalisés qui y sont rattachés sont supprimés. Vos données de télémétrie ne sont pas affectées.

Si le tableau de bord est public sur un domaine personnalisé, l'URL cesse de répondre dès que vous le supprimez. Déplacez d'abord le domaine vers un autre tableau de bord si vous souhaitez que l'URL continue de fonctionner.

## Sauvegarde

Si vous hébergez OneUptime vous-même, une sauvegarde régulière de la base de données suffit — la configuration du tableau de bord est stockée avec le reste de votre projet.

Sur OneUptime Cloud, les sauvegardes sont gérées pour vous. Si vous voulez votre propre copie, vous pouvez lire le tableau de bord via l'[API OneUptime](/docs/api-reference/api-reference).

## Pour aller plus loin

- [Partage et tableaux de bord publics](/docs/dashboards/sharing) — contrôles du mode public.
- [Variables et filtres](/docs/dashboards/variables) — modélisation.
- [Widgets](/docs/dashboards/widgets) — le catalogue des widgets.
- [Présentation des tableaux de bord](/docs/dashboards/index) — la vue d'ensemble.
