# Référence des autorisations

Toutes les autorisations que OneUptime peut accorder, regroupées exactement comme le sélecteur d'autorisations du tableau de bord les regroupe.

Cette page est générée à partir du code source de OneUptime au moment de la requête — à partir de la même liste qu'utilisent le tableau de bord, l'API et le fournisseur Terraform. Elle ne peut pas diverger du produit et reflète la version que vous exécutez.

Si vous cherchez comment tout s'articule — équipes, portées, propriétaires, blocages — commencez par [Utilisateurs, équipes et autorisations](/docs/permissions/index).

La colonne **Clé d'autorisation** contient la valeur à utiliser avec l'[API](/docs/api-reference/api-reference), la [CLI](/docs/cli/index) et le [fournisseur Terraform](/docs/terraform/index). Les intitulés sont ceux affichés dans le tableau de bord.

## Rôles

{{PERMISSION_ROLE_COUNT}} rôles, chacun regroupant un domaine du produit au niveau Admin, Member ou Viewer. Ce sont eux que propose le sélecteur **Rôle** lorsque vous ajoutez une autorisation à une équipe.

La colonne **Portée** indique si le rôle peut être restreint au moment de l'attribution. `Toutes, Possédées ou Étiquettes` signifie que vous pouvez choisir ; `Projet entier uniquement` signifie que le rôle s'applique toujours à l'ensemble du projet.

{{PERMISSION_ROLE_TABLES}}

## Autorisations granulaires

{{PERMISSION_TOTAL_COUNT}} capacités individuelles réparties en {{PERMISSION_GROUP_COUNT}} groupes. Ce sont elles que propose le sélecteur **Granulaire**, et celles que vous attribuez aux clés d'API.

La colonne **Restriction par étiquettes** indique si l'attribution de cette autorisation peut être limitée aux ressources portant certaines étiquettes.

{{PERMISSION_GRANULAR_TABLES}}
