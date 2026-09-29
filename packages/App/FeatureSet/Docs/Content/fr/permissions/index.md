# Utilisateurs, équipes et autorisations

Tout dans OneUptime vit à l'intérieur d'un **projet**. Qui peut y faire quoi se ramène à trois choses : les **utilisateurs** qui en font partie, les **équipes** auxquelles ils appartiennent et les **autorisations** accordées à ces équipes.

La règle qui explique presque tout : **les utilisateurs ne détiennent jamais d'autorisations directement.** L'accès d'un utilisateur est l'union des autorisations de toutes les équipes auxquelles il appartient dans ce projet. Pour changer ce que quelqu'un peut faire, vous changez son appartenance à une équipe ou les autorisations de cette équipe.

Les **propriétaires** relèvent d'une autre idée. Un propriétaire est la personne responsable d'une ressource précise — un moniteur, un incident, un tableau de bord. Les propriétaires sont notifiés au sujet de leurs ressources, et les autorisations peuvent facultativement être restreintes à « uniquement ce que je possède ».

## Le modèle en un coup d'œil

```text
Projet
  └── Équipe                        ← les autorisations sont attachées ici
       ├── Autorisations accordées  ← chacune avec une portée : Toutes / Possédées / Étiquettes
       ├── Autorisations bloquées   ← l'emportent toujours sur les autorisations accordées
       └── Membres de l'équipe      ← utilisateurs ayant accepté l'invitation
```

| Concept | Ce que c'est |
| --- | --- |
| Utilisateur | Un compte OneUptime unique. Une connexion, autant de projets que nécessaire. |
| Projet | La frontière du locataire. Moniteurs, incidents, équipes et données appartiennent à un seul projet. |
| Équipe | Un groupe nommé au sein d'un projet, porteur des autorisations. |
| Membre d'équipe | Un utilisateur invité dans une équipe et ayant accepté. |
| Autorisation | Une capacité unique, p. ex. `CreateProjectMonitor`, ou un rôle qui en regroupe plusieurs, p. ex. `MonitorAdmin`. |
| Portée | Jusqu'où va une autorisation accordée : toutes les ressources, seulement celles possédées, ou seulement celles étiquetées. |
| Propriétaire | Un utilisateur ou une équipe désigné responsable d'une ressource précise. |
| Étiquette | Un marqueur posé sur les ressources, utilisé pour restreindre les autorisations et pour organiser. |

## Utilisateurs

Un compte utilisateur est global à l'instance OneUptime — la même connexion fonctionne dans tous les projets où l'utilisateur a été invité.

Un utilisateur est « dans » un projet dès qu'il est membre d'**au moins une équipe** de ce projet. Il n'existe pas d'étape séparée « ajouter un utilisateur au projet » : inviter quelqu'un dans un projet, c'est l'inviter dans une équipe.

- Les invitations créent un membre d'équipe en attente. L'utilisateur ne compte comme membre du projet — et n'obtient la moindre autorisation — **qu'après avoir accepté l'invitation.**
- Retirer un utilisateur de toutes les équipes d'un projet lui retire l'accès à ce projet.
- Si votre projet impose le SSO et qu'un utilisateur ne s'est pas encore authentifié auprès du fournisseur d'identité, il est traité comme un utilisateur SSO non autorisé et ne voit rien tant qu'il ne l'a pas fait. Voir [SSO](/docs/identity/sso).
- Avec SCIM configuré, votre fournisseur d'identité peut créer, mettre à jour et supprimer automatiquement les utilisateurs et leurs appartenances aux équipes. Voir [SCIM](/docs/identity/scim).

Où le trouver : **Paramètres → Utilisateurs** liste toutes les personnes du projet et leur statut d'invitation.

## Équipes

Les équipes sont le chemin par lequel les autorisations parviennent aux personnes. Chaque nouveau projet démarre avec trois :

| Équipe | Autorisation détenue | Modifiable |
| --- | --- | --- |
| Owners | `ProjectOwner` | Non. Compte toujours au moins un membre. |
| Admin | `ProjectAdmin` | Non |
| Members | `ProjectMember` | Oui — c'est un point de départ, modifiez-la librement |

Les équipes **Owners** et **Admin** sont volontairement verrouillées : leurs autorisations ne peuvent pas être modifiées et les équipes ne peuvent être ni supprimées ni renommées. C'est ce qui empêche un projet de se verrouiller lui-même par accident. L'équipe Owners doit toujours conserver au moins un membre.

`ProjectOwner` est le niveau d'accès le plus élevé : facturation, suppression du projet, et tout ce que peut faire un administrateur. `ProjectAdmin` couvre tout sauf la facturation et la suppression du projet.

Créez autant d'équipes supplémentaires que vous voulez — « Astreinte Frontend », « Support », « Auditeurs en lecture seule » — et donnez à chacune les autorisations dont elle a besoin.

Où le trouver : **Paramètres → Équipes**. Ouvrez une équipe pour accéder à **Members**, **Permissions** et **Block Permissions**.

## Autorisations

Une autorisation est une capacité unique. Il y a deux façons de les distribuer, toutes deux dans l'onglet **Permissions** de l'équipe.

### Rôles

Un rôle regroupe tout un domaine du produit à l'un de trois niveaux :

- **Admin** — contrôle total sur ce domaine, y compris sa configuration (gravités, états, modèles).
- **Member** — le travail quotidien : créer, modifier et supprimer les ressources, mais pas reconfigurer le domaine.
- **Viewer** — lecture seule.

`MonitorAdmin`, `IncidentMember`, `StatusPageViewer`, etc. Les rôles conviennent dans la quasi-totalité des cas — ils restent corrects à mesure que OneUptime ajoute des fonctionnalités, car une nouvelle table liée aux moniteurs est rattachée aux rôles moniteurs existants au lieu d'exiger une nouvelle attribution de votre part.

Les {{PERMISSION_ROLE_COUNT}} rôles sont listés dans la [Référence des autorisations](/docs/permissions/reference).

### Autorisations granulaires

Chaque capacité individuelle est aussi attribuable seule — `CreateProjectMonitor`, `ReadProjectIncident`, `DeleteProjectStatusPage` et {{PERMISSION_TOTAL_COUNT}} autres. Utilisez-les quand un rôle est trop large et que vous devez n'accorder qu'une seule chose.

Ce sont également les clés à utiliser pour créer des clés d'API, et celles qu'attendent l'API et le fournisseur Terraform.

La liste complète est dans la [Référence des autorisations](/docs/permissions/reference).

### Accorder et bloquer

Chaque équipe possède deux listes :

- **Permissions** (accorder) — ce que cette équipe peut faire.
- **Block Permissions** — ce que cette équipe ne peut jamais faire, quelle que soit l'autorisation accordée.

**Le blocage l'emporte toujours.** Une entrée de blocage sans étiquette retire purement et simplement la capacité à l'équipe. Une entrée de blocage avec étiquettes ne la retire que pour les ressources portant ces étiquettes — pratique pour « cette équipe peut modifier les moniteurs, sauf ceux étiquetés Production ».

Une autorisation ne peut pas porter d'étiquettes de restriction dans les deux listes à la fois ; OneUptime rejette la seconde avec une explication.

Comme l'accès d'un utilisateur est l'union sur toutes ses équipes, un blocage sur une équipe n'annule **pas** une autorisation accordée sur une autre. Les blocages restreignent l'équipe sur laquelle ils sont définis. Si quelqu'un a plus d'accès que prévu, vérifiez toutes les équipes auxquelles il appartient.

## Portée : jusqu'où va une autorisation accordée

Chaque autorisation accordée l'est avec une portée, choisie au moment de l'ajout :

| Portée | Signification |
| --- | --- |
| Toutes les ressources du projet | La valeur par défaut. L'autorisation s'applique à toutes les ressources correspondantes. |
| Possédées par cette équipe ou ses membres | L'autorisation ne s'applique qu'aux ressources dont cette équipe, ou l'utilisateur qui agit, est propriétaire. |
| Restreindre par étiquettes (avancé) | L'autorisation ne s'applique qu'aux ressources portant au moins une des étiquettes sélectionnées. |

**Possédées** est le moyen le plus simple de construire un modèle « chacun s'occupe de ses propres services » : donnez à une équipe `MonitorAdmin` avec la portée Possédées, puis faites de cette équipe le propriétaire des moniteurs dont elle a la charge. Cela ne restreint que les ressources pouvant réellement avoir des propriétaires — moniteurs, incidents, tableaux de bord, services, etc. La configuration du projet (états d'incident, étiquettes, équipes elles-mêmes) n'a pas de propriétaire ; un rôle en portée Possédées s'y comporte donc normalement.

**Étiquettes** est la version plus manuelle de la même idée : marquez les ressources, puis accordez des autorisations restreintes à ces marqueurs.

Certains rôles sont projet-entier par définition et n'offrent aucune portée, car les restreindre n'aurait pas de sens — « Billing Admin, mais seulement pour la facturation que je possède » ne décrit rien :

{{PERMISSION_SCOPE_EXEMPT_ROLES}}

## Propriétaires

Un propriétaire est un utilisateur ou une équipe rattaché à une ressource précise. La plupart des ressources représentant quelque chose que vous exploitez — moniteurs, incidents, alertes, maintenances planifiées, politiques d'astreinte, tableaux de bord, services, pages de statut, workflows, runbooks et SLO — ont un onglet **Owners**.

Les propriétaires jouent deux rôles :

1. **Notification.** Les propriétaires sont ceux que OneUptime prévient quand il arrive quelque chose à la ressource — un moniteur tombe, un incident est créé, un SLO commence à consommer son budget d'erreur.
2. **Accès, si vous le demandez.** La propriété est ce sur quoi se résout la portée Possédées. Un utilisateur correspond s'il est personnellement propriétaire, ou si l'une de ses équipes l'est.

La propriété seule n'accorde rien. Être propriétaire d'un moniteur ne permet pas de le modifier si aucune de vos équipes ne détient également une autorisation sur les moniteurs. La propriété restreint l'accès ; elle ne l'élargit jamais.

## Étiquettes

Les étiquettes sont des marqueurs valables dans tout le projet que vous attachez aux ressources. Elles servent à deux choses : filtrer et regrouper dans le tableau de bord, et restreindre les autorisations comme décrit plus haut.

Une restriction par étiquettes est satisfaite si la ressource porte **au moins une** des étiquettes de l'autorisation. Une ressource sans aucune étiquette ne satisfait aucune autorisation restreinte par étiquettes.

Où le trouver : **Paramètres → Étiquettes**.

## Clés d'API

Les clés d'API reçoivent leurs autorisations directement, sur la clé elle-même — elles n'appartiennent à aucune équipe et ne sont pas affectées par les appartenances.

- Attribuez les mêmes autorisations granulaires et rôles que vous donneriez à une équipe.
- Les clés prennent en charge les **autorisations bloquées** et les **restrictions par étiquettes**, comme les équipes.
- Les clés ne prennent **pas** en charge la portée Possédées. La propriété se résout par rapport à un utilisateur, et une clé n'est pas un utilisateur : accordez donc aux clés l'accès dont elles ont besoin de manière explicite.

Donnez à chaque intégration sa propre clé, avec le jeu d'autorisations le plus étroit qui fonctionne, afin de pouvoir en révoquer une sans perturber les autres.

Où le trouver : **Paramètres → Clés d'API**. Voir aussi la [Référence de l'API](/docs/api-reference/api-reference).

## Comment OneUptime décide si une requête est autorisée

Pour un utilisateur connecté, dans l'ordre :

1. Trouver les équipes auxquelles l'utilisateur appartient dans ce projet, en ne comptant que les invitations acceptées.
2. Rassembler toutes les lignes d'autorisation de ces équipes — accordées et bloquées, chacune avec ses étiquettes et sa portée.
3. Vérifier d'abord la liste des blocages. Un blocage correspondant sans étiquette rejette la requête immédiatement.
4. Vérifier la liste des autorisations accordées. La requête a besoin d'au moins une autorisation que la table cible accepte pour cette opération.
5. Appliquer la portée. Les attributions en portée Possédées restreignent la requête aux ressources possédées ; celles par étiquettes la restreignent aux étiquettes correspondantes. Si une autre attribution pour la même opération est plus large, c'est la plus large qui l'emporte.
6. Appliquer les blocages par étiquettes. Un blocage avec étiquettes rejette la requête si la ressource cible en porte une.

Tout utilisateur connecté détient en plus un petit ensemble d'autorisations automatiques couvrant par exemple la lecture de son propre profil et de ses propres règles de notification. Ce ne sont pas des autorisations d'administration et elles ne donnent accès aux données de personne d'autre.

Les autorisations résolues sont mises en cache par utilisateur et par projet, et rafraîchies quand l'appartenance aux équipes ou les autorisations d'équipe changent. Si vous modifiez des autorisations et qu'un utilisateur ne voit pas le changement immédiatement, demandez-lui de recharger.

## Recettes

**Une équipe qui observe seulement.** Créez l'équipe et ajoutez le rôle `Viewer`, ou les rôles `*Viewer` par domaine pour les seuls domaines qu'elle doit voir.

**Des ingénieurs d'astreinte qui gèrent leurs propres services.** Donnez à l'équipe `MonitorAdmin`, `IncidentMember` et `OnCallMember` en portée **Possédées**, puis ajoutez l'équipe comme propriétaire des moniteurs qu'elle exploite.

**Des prestataires tenus à l'écart de la production.** Donnez à l'équipe les rôles nécessaires en portée **Toutes**, puis ajoutez une **autorisation bloquée** pour les capacités sensibles, restreinte à l'étiquette `Production`.

**Un pipeline CI qui ne fait que signaler des déploiements.** Créez une clé d'API avec uniquement les autorisations granulaires nécessaires — aucun rôle.

**Quelqu'un qui ne doit pas voir la facturation.** Ne l'ajoutez pas à l'équipe Owners. `ProjectAdmin` exclut déjà la facturation.

## Pour aller plus loin

- [Référence des autorisations](/docs/permissions/reference) — chaque rôle et chaque autorisation granulaire, générés depuis le code source de OneUptime.
- [SSO](/docs/identity/sso) et [SCIM](/docs/identity/scim) — authentification et approvisionnement automatique des utilisateurs.
- [Référence de l'API](/docs/api-reference/api-reference) — utiliser les autorisations depuis l'API.
