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

Activer ou désactiver les SMS, les appels téléphoniques, WhatsApp ou Telegram pour le projet relève de la facturation, car chaque message coûte de l'argent. Seuls `ProjectOwner` et l'autorisation `ManageProjectBilling` (**Manage Billing**) peuvent modifier ces interrupteurs, dans **Paramètres du projet > Notifications > Paramètres de notification** — pas `ProjectAdmin`.

Recharger les soldes prépayés du projet relève aussi de la facturation. Sur OneUptime Cloud, les SMS, les appels téléphoniques, WhatsApp et Telegram sont payés par le solde de **Paramètres du projet > Notifications > Paramètres de notification**, et l'IA par les crédits IA de **Paramètres du projet > IA > Crédits IA**. Seul un propriétaire du projet ou une personne disposant de **Manage Billing** peut les recharger ou modifier leur **Rechargement automatique** — un administrateur du projet ne le peut pas. Un message sur un solde qui s'épuise indique qui peut le recharger, et seules ces personnes ont un bouton **Recharger le solde** qui fonctionne ou un lien vers la page.

Créez autant d'équipes supplémentaires que vous voulez — « Astreinte Frontend », « Support », « Auditeurs en lecture seule » — et donnez à chacune les autorisations dont elle a besoin.

Où le trouver : **Paramètres → Équipes**. Ouvrez une équipe pour accéder à **Members** et **Permissions** ; **Block Permissions** se trouve sous **More settings**, en bas de la page Permissions.

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

Les autorisations accordées à un utilisateur s'additionnent sur toutes ses équipes, mais un blocage s'applique à tout ce que fait l'utilisateur : un blocage sans étiquette sur une équipe retire la capacité même si une autre équipe l'accorde, et une entrée de blocage n'accorde jamais rien. Si quelqu'un a moins d'accès que prévu, cherchez un blocage dans chacune de ses équipes ; s'il en a plus, cherchez une autorisation dans chacune.

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

## Télémétrie

Les logs, les traces, les métriques, les exceptions, les profils et les relectures de session appartiennent à la ressource qui les a envoyés : un service, un hôte, un cluster Kubernetes, un moniteur, une application RUM, etc. Une autorisation de télémétrie lit aussi loin que porte sa portée :

- **Toutes les ressources** lit la télémétrie de toutes les ressources du projet.
- **Possédées** lit la télémétrie des ressources que vous ou l'une de vos équipes possédez, ainsi que la télémétrie qui ne nomme aucune ressource.
- **Étiquettes** lit la télémétrie des ressources portant l'une des étiquettes de l'autorisation.

Un blocage avec étiquettes sur une autorisation de télémétrie écarte la télémétrie des ressources portant ces étiquettes, quoi que vous déteniez par ailleurs. Cela vaut partout où la télémétrie est lue : les explorateurs et leurs graphiques, filtres et listes d'attributs, les exports, les relectures de session et ce que l'assistant IA lit pour vous. La liste des noms de métriques montre les métriques que remonte un service que vous pouvez lire, et celles qu'aucun service ne remonte, comme les métriques des hôtes et des clusters. Si vous pouvez aussi lire la télémétrie d'autres types de ressources, comme des hôtes ou des clusters, elle montre tous les noms de métriques.

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
3. Vérifier d'abord la liste des blocages. Un blocage sans étiquette sur n'importe quelle autorisation que la table cible accepte pour cette opération rejette la requête immédiatement, quelle que soit l'équipe qui le porte.
4. Vérifier la liste des autorisations accordées. La requête a besoin d'au moins une autorisation que la table cible accepte pour cette opération. Pour une ressource opérationnelle — un moniteur, un incident, un tableau de bord, etc. — l'autorisation **All Operational Resources** correspondante (Create, Read, Edit ou Delete) compte aussi, sauf si elle est elle-même bloquée.
5. Appliquer la portée. Les attributions en portée Possédées restreignent la requête aux ressources possédées ; celles par étiquettes la restreignent aux étiquettes correspondantes. Si une autre attribution pour la même opération est plus large, c'est la plus large qui l'emporte.
6. Appliquer les blocages par étiquettes. Un blocage avec étiquettes rejette la requête si la ressource cible en porte une. Quand un enregistrement n'a pas d'étiquettes propres, comme une note d'incident ou une annonce de page de statut, un blocage avec étiquettes sur sa lecture l'écarte si un enregistrement auquel il appartient porte l'une de ces étiquettes.

Chaque champ d'un enregistrement se lit avec l'autorisation de lecture de l'enregistrement lui-même : une autorisation portant sur un autre type d'enregistrement ne l'ouvre jamais. Certains champs sont volontairement plus restreints. Les secrets ne sont lus que par les personnes qui peuvent modifier ou administrer l'enregistrement auquel ils appartiennent, comme les clés de requêtes entrantes et d'e-mails entrants d'un moniteur et la clé de son agent serveur, ou les clés de webhook et d'e-mail entrant d'un workflow. Regarder l'enregistrement d'une relecture de session demande **Watch Session Replays**, pas seulement **List Session Replays**. La télémétrie se lit signal par signal : **Read Telemetry Service Log** lit les logs, **Read Telemetry Service Traces** lit les traces et **Read Telemetry Service Metrics** lit les métriques, graphiques de métriques compris.

Les champs suivent la même règle. Un blocage sans étiquette sur l'autorisation d'un champ retire ce champ, et pour une ressource opérationnelle l'autorisation **All Operational Resources** correspondante ouvre chaque champ que peut ouvrir toute personne autorisée à lire ou modifier l'enregistrement — mais pas un champ volontairement plus restreint, comme une clé secrète.

La même règle décide de tout ce qui demande si vous détenez une autorisation : les actions qui ne sont pas une simple lecture ou écriture — ajouter du crédit SMS, appels ou IA, payer une facture, tester une règle de notification — et les boutons qu'affiche OneUptime. Un bouton que vous ne pouvez pas utiliser s'affiche verrouillé et dit pourquoi ; quand un blocage sur l'une de vos équipes en est la raison, il nomme l'autorisation bloquée.

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
