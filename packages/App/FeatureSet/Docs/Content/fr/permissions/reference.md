# Référence des autorisations

Chaque rôle et chaque autorisation qu'OneUptime peut accorder, regroupés comme dans le sélecteur d'autorisations du tableau de bord. Utilisez cette page pour trouver le nom ou la clé exacte à donner à une équipe, à une clé API ou à une ressource Terraform.

Les tableaux sont générés à partir du code source d'OneUptime au moment où la page est servie : c'est la même liste que celle qu'utilisent le tableau de bord, l'API et le fournisseur Terraform. Ils correspondent donc toujours à la version que vous exécutez. Pour comprendre comment les autorisations s'articulent (équipes, portées, propriétaires et blocages), commencez par [Utilisateurs, équipes et autorisations](/docs/permissions/index).

## Lire les tableaux

Chaque rôle et chaque autorisation occupe une ligne avec ces colonnes :

- **Rôle** ou **Autorisation** : le nom affiché par le tableau de bord.
- **Clé d'autorisation** : la valeur à utiliser avec l'[API](/docs/api-reference/api-reference), la [CLI](/docs/cli/index) et le [fournisseur Terraform](/docs/terraform/index).
- **Portée** (rôles uniquement) : `Toutes, Possédées ou Étiquettes` signifie que vous choisissez jusqu'où le rôle s'étend quand vous l'accordez. `Projet entier uniquement` signifie que le rôle s'applique toujours à tout le projet.
- **Restriction par étiquettes** (autorisations uniquement) : `Oui` signifie qu'une attribution de cette autorisation peut être limitée aux ressources portant certaines étiquettes.
- **Description** : ce que le rôle ou l'autorisation permet.

> [!TIP]
> Privilégiez d'abord un rôle. Les rôles restent justes à mesure qu'OneUptime ajoute des fonctionnalités, alors qu'une liste d'autorisations individuelles doit être tenue à jour à la main.

## Rôles

{{PERMISSION_ROLE_COUNT}} rôles. Quatre d'entre eux couvrent tout le projet : Project Owner, Project Admin, Project Member et Viewer. Chacun des autres couvre un domaine du produit, comme les incidents ou les moniteurs, au niveau Admin, Member ou Viewer. Ce sont eux que propose **Ajouter un rôle** sur la page **Autorisations** d'une équipe et sur la page d'une clé API.

{{PERMISSION_ROLE_TABLES}}

## Autorisations individuelles

{{PERMISSION_TOTAL_COUNT}} capacités individuelles réparties en {{PERMISSION_GROUP_COUNT}} groupes. Ce sont elles que propose **Ajouter une permission**, pour une équipe ou une clé API, quand un rôle accorde plus que nécessaire.

{{PERMISSION_GRANULAR_TABLES}}

## Étapes suivantes

:::cards
- [Utilisateurs, équipes et autorisations](/docs/permissions/index): Comment les équipes, les portées, les propriétaires et les blocages décident de ce qu'une personne peut faire.
- [Référence API](/docs/api-reference/api-reference): Utiliser les clés d'autorisation avec des clés API.
- [Fournisseur Terraform](/docs/terraform/index): Gérer les équipes et leurs autorisations sous forme de code.
:::
