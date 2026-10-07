# États et sévérités

Chaque incident porte deux classifications : un **état** qui dit où il en est dans votre réponse, et une **gravité** qui dit à quel point il fait mal. Dans le tableau de bord, les deux se ressemblent — pastilles colorées dans la liste des incidents, listes propres au projet que vous pouvez renommer et recolorer. Leurs rôles n'ont pourtant rien à voir.

Les états pilotent le comportement. Trois indicateurs booléens sur les lignes d'état, avec l'ordre des états, décident quels incidents comptent comme actifs, quels boutons apparaissent dans l'en-tête de l'incident, quand le chronomètre du SLA s'arrête et quand l'incident disparaît de votre page de statut. Les gravités, elles, ne pilotent rien par elles-mêmes : ce sont des étiquettes qui décrivent l'impact et sur lesquelles d'autres règles peuvent se caler.

Les deux listes sont initialisées à la création de votre projet, et les deux se modifient sous **Incidents → Paramètres**. Cette section du menu latéral Incidents est repliée par défaut : dépliez **Paramètres** avant de partir à leur recherche.

## Les états portent du comportement, les gravités portent du sens

Le modèle `IncidentState` possède `name`, `description`, `color` et `order`, plus trois booléens : `isCreatedState`, `isAcknowledgedState` et `isResolvedState`. Tout ce que le produit fait avec les états s'appuie sur ces booléens et sur `order` — jamais sur le nom de l'état. C'est pourquoi vous pouvez renommer **Résolu** en « Clôturé » sans rien casser : l'indicateur voyage avec la ligne.

Le modèle `IncidentSeverity` possède `name`, `description`, `color` et `order`, et rien d'autre. Aucun indicateur. Rien dans OneUptime ne traite spontanément **Incident critique** autrement que **Incident mineur** — la gravité ne compte que là où vous la désignez, comme le critère de correspondance **Incident Gravités** d'une règle d'astreinte.

Quelques règles rapides :

- **Choisissez la gravité pour communiquer l'impact** — elle apparaît dans la liste des incidents, sur la **Vue d'ensemble** de l'incident, et c'est un champ obligatoire quand vous déclarez un incident.
- **Choisissez les états pour modéliser votre processus** — les étapes de réponse que vous parcourez réellement, dans l'ordre où vous les parcourez.
- **N'encodez pas l'urgence dans les états** — un état nommé « Critique » n'alerterait personne. C'est la gravité plus une règle d'astreinte qui fait cela.

## Les états initialisés

Trois états sont créés avec le projet, dans cet ordre. L'initialisation est idempotente — un état n'est ajouté que s'il n'en existe pas déjà un portant ce nom.

| État               | `order` | Indicateur            | Couleur   | Ce que cela veut dire                                     |
| ------------------ | ------- | --------------------- | --------- | --------------------------------------------------------- |
| **Identifié**      | `1`     | `isCreatedState`      | `#fd625e` | L'état dans lequel atterrissent les nouveaux incidents.   |
| **Pris en compte** | `2`     | `isAcknowledgedState` | `#ffbf53` | Quelqu'un a récupéré l'incident.                          |
| **Résolu**         | `3`     | `isResolvedState`     | `#2ab57d` | L'incident est terminé et cesse de compter comme actif.   |

Attention au nom : le premier état est **Identifié**, même si plusieurs descriptions dans le produit continuent de l'appeler l'état « de création ». Quand une page de documentation ou une infobulle dit « état de création », elle désigne l'état qui porte `isCreatedState` — dans un projet neuf, c'est **Identifié**.

## Ce que fait vraiment chaque indicateur d'état

| Indicateur            | Rôle                                                                                                                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isCreatedState`      | L'état que reçoit un incident quand personne n'en a choisi. Si aucun état du projet ne porte cet indicateur, la création d'un incident échoue avec une erreur vous invitant à ajouter un état de création depuis les paramètres. |
| `isAcknowledgedState` | Marque l'état « pris en compte » du projet : celui vers lequel **Acknowledge** fait passer un incident et qui donne son nom à la tuile correspondante. Un incident dans cet état, dans tout état placé après lui ou résolu est pris en compte : **Acknowledge** ne lui est plus proposé, l'astreinte cesse d'alerter pour lui et son SLA est marqué comme ayant reçu une réponse. |
| `isResolvedState`     | Désigne l'état résolu du projet : celui vers lequel **Résoudre** fait passer un incident et que montre la tuile de statistique de résolution. Un incident dans cet état, ou dans un état placé après lui, est résolu : il quitte **Incidents actifs** et la section active d'une page de statut, et son SLA est marqué comme résolu. |

On attend qu'un seul état par projet porte chacun de ces indicateurs — les recherches ne ramènent qu'une ligne. Les trois états porteurs d'indicateurs peuvent être renommés, recolorés et réordonnés, mais la page de paramètres refuse de les supprimer et affiche une erreur nommant les états de création, de prise en compte et de résolution.

Comme l'interface lit les noms d'états dynamiquement, renommer un état change ce que vous voyez partout — les tuiles de statistiques, les titres des fenêtres de confirmation et la pastille de la liste des incidents suivent tous le nom que vous avez donné à la ligne.

## Ajouter vos propres états

Allez dans **Incidents → Paramètres → État de l'incident**. La page est une liste ordonnée triée par `order` croissant, et un nouvel état s'ajoute juste au-dessus de l'état résolu. Faites glisser une ligne pour changer sa position.

**Champs d'un état :**

- **Nom** — obligatoire, au moins deux caractères. Le texte indicatif suggère quelque chose comme « Investigating ».
- **Description** — texte libre facultatif expliquant quand un incident se trouve dans cet état.
- **Couleur** — obligatoire. Choisie dans le sélecteur de couleurs ; stockée en hexadécimal, par exemple `#fd625e`.

Vous ne pouvez pas positionner les trois indicateurs depuis ce formulaire — ils appartiennent aux lignes initialisées. Un état que vous ajoutez est donc un état sans indicateur, ce qui a deux conséquences à anticiper :

- **Au-dessus de l'état résolu, il garde l'incident actif.** **Incidents actifs** regroupe les incidents dont l'état courant se trouve au-dessus de l'état résolu : un état que vous ajoutez là maintient donc l'incident dans la liste active et dans le compteur de la barre latérale. Un état que vous faites glisser sous l'état résolu compte comme résolu partout — listes actives, pages de statut, rappels et SLA — et faire passer un incident de **Résolu** à cet état n'est pas une seconde résolution.
- **Son bouton de transition est générique.** Au lieu de **Acknowledge** ou **Résoudre**, la fenêtre de confirmation s'intitule **Marquer l'incident comme `<state name>`**, avec un bouton de validation **Mark as `<state name>`**.

Une configuration courante consiste à insérer une étape de triage ou d'atténuation entre les états de prise en compte et de résolution — par exemple, faire glisser un nouvel état « Atténué » pour qu'il se place après **Pris en compte** et avant **Résolu**.

## L'ordre est une vraie contrainte, pas une préférence d'affichage

La colonne `order` est appliquée à l'écriture d'un changement d'état, pas seulement au dessin de la liste :

- **Les transitions en arrière sont refusées.** Faire passer un incident à un état situé avant son état courant échoue avec une erreur nommant les deux états.
- **Resélectionner l'état courant est refusé.** Remettre un incident dans l'état où il est déjà échoue avec « Incident state cannot be same as previous state. »
- **Une ligne antidatée ne peut pas dupliquer sa voisine.** Insérer une ligne de chronologie dont l'état est identique à celui de la ligne qui la suit est refusé aussi.
- **Les boutons d'en-tête suivent la position des états porteurs d'indicateurs dans l'ordre.** **Acknowledge** et **Résoudre** sont proposés selon la place de l'état courant dans la liste triée par ordre. Un état personnalisé placé *après* l'état résolu n'affichera jamais de bouton **Résoudre**, car il ne reste plus rien vers quoi avancer.

Alors, quand vous ajoutez un état, placez-le là où un incident passerait réellement. Un mauvais ordre ne fait pas que dénoter — il rend les transitions impossibles.

## Les gravités initialisées

Trois gravités sont créées avec le projet, dans cet ordre :

- **Incident critique** (`order` 1, `#b70400`) — des problèmes à très fort impact sur les clients, exigeant une réponse immédiate. Une panne totale ou une fuite de données.
- **Incident majeur** (`order` 2, `#fd625e`) — un impact significatif, exigeant en général une réponse immédiate, parfois avec un contournement qui limite les dégâts. Un sous-système important en panne.
- **Incident mineur** (`order` 3, `#ffbf53`) — un faible impact, traité en général pendant les heures ouvrées, et que la plupart des clients ne remarqueront probablement pas. Une légère baisse des performances de l'application.

La gravité est obligatoire quand vous déclarez un incident, et elle l'est sur chaque spécification d'incident dans les critères d'un moniteur : tout incident — manuel ou automatique — arrive donc avec une gravité. Voyez [Déclarer un incident](/docs/incidents/declaring-incidents) pour le parcours de déclaration et [Modèles d'incident et d'alerte](/docs/monitor/incident-alert-templating) pour la voie pilotée par les moniteurs.

## Modifier les gravités

Allez dans **Incidents → Paramètres → Gravité de l'incident**. Même forme que la page des états — une liste ordonnée triée par `order`, un glisser-déposer pour réordonner, les nouvelles gravités ajoutées à la fin, avec **Nom**, **Description** et **Couleur** sur le formulaire.

Deux différences avec les états :

- **Il n'y a pas de garde-fou à la suppression.** Toute gravité peut être supprimée, y compris les trois initialisées.
- **Il n'y a aucun indicateur à hériter.** Une nouvelle gravité se comporte exactement comme les initialisées — une étiquette avec une couleur et une position.

**Un mot sur les textes indicatifs.** Le formulaire des gravités reprend mot pour mot les exemples du formulaire des états : les indications parlent donc d'états d'incident plutôt que de gravités. Ignorez-les et écrivez vos propres noms et descriptions de gravité.

Là où la gravité fait plus que décrire : dans **Incidents → Règles → Règles d'astreinte**, le champ **Incident Gravités** d'une règle est un critère de correspondance. Y lister **Incident critique**, c'est ainsi qu'on exprime « alerter l'équipe base de données pour tout ce qui est critique » — la politique d'astreinte vit sur la règle, pas sur la gravité.

## Faire évoluer un incident à travers ses états

Un incident change d'état de quatre façons :

- **Les boutons d'en-tête.** Ouvrez un incident. Si son état courant précède l'état de prise en compte, vous obtenez **Prendre en compte** et **Résoudre** ; s'il se situe entre les deux, vous obtenez **Résoudre**. Chacun ouvre une courte confirmation — **Prendre en compte l'incident** ou **Résoudre l'incident** — avec **Notifier les abonnés de la page de statut** et, repliés sous **Ajouter une note publique**, le champ facultatif **Note publique** et le sélecteur **Sélectionner le modèle de note** (si le projet a des modèles de notes). La prise en compte arrête aussi toute escalade d'astreinte de l'incident.
- **La chronologie d'état.** Ajoutez une ligne à la main depuis la page **Chronologie d'état** de l'incident, avec **Statut de l'incident**, **Commence le** et **Notifier les abonnés de la page de statut**.
- **En masse.** La liste des incidents dispose d'une action groupée **Modifier l'état** pour en déplacer plusieurs d'un coup.
- **Automatiquement.** Un critère de moniteur avec **Résoudre automatiquement l'incident** activé résout son incident dès que le critère n'est plus satisfait, et l'API peut mettre à jour l'état via `/api/incident-state-timeline`.

Chacune de ces voies écrit une ligne de chronologie. Un changement d'état fait aussi quelques choses que vous n'avez pas à demander : il publie une entrée dans le fil d'incident, attribue un Responsable d'incident si l'incident n'en a pas encore, et met à jour le chronomètre du SLA. Rouvrir un incident résolu démarre un nouvel enregistrement de SLA à partir de l'heure de réouverture.

## Ce que fait la prise en compte

Un incident est pris en compte dès qu'il passe à votre état pris en compte, à tout état placé après lui — un état **Investigation** que vous avez placé sous **Pris en compte**, par exemple — ou à un état résolu, quelle que soit celle des quatre voies ci-dessus qui le déplace. La page des réglages des états indique lesquels. Une fois pris en compte :

- **Acknowledge n'est plus proposé.** Ni dans l'en-tête de l'incident, ni dans l'application mobile (son bouton et son balayage), ni dans Slack ou Microsoft Teams, ni par `acknowledge_incident` du serveur MCP de OneUptime. Le prendre en compte malgré tout — depuis une alerte d'astreinte, Slack ou Teams — est refusé avec « Incident is already acknowledged. » (ou « Incident is already resolved. »), au lieu de le faire remonter dans sa liste.
- **L'astreinte cesse d'alerter pour lui.** Une personne qui accuse réception de son alerte après qu'un collègue a pris l'incident en compte, ou l'a fait avancer, voit son alerte acquittée, et l'incident reste où il est.
- **Le SLA est marqué comme ayant reçu une réponse**, au premier passage de ce type ; avancer ensuite dans des états plus loin conserve cette heure.
- **Le délai de prise en compte court jusqu'à ce premier passage** — la tuile de la **Vue d'ensemble** de l'incident, la métrique **Time to Acknowledge**, une mesure qui se termine quand l'incident est pris en compte, et le MTTA des résumés Slack et Microsoft Teams. Un incident passé directement d'**Identifié** à **Investigation** a été pris en compte à ce moment-là ; un incident résolu aussitôt l'a été à sa résolution.
- **Un filtre Pris en compte** — sur le widget de liste d'incidents d'un tableau de bord, par exemple — montre les incidents dans votre état pris en compte et dans tout état placé après lui, tant qu'ils ne sont pas résolus.

Les alertes et les épisodes suivent la même règle avec vos états d'alerte.

## Ce que fait la résolution

Un incident est résolu quand il passe d'un état au-dessus de votre état résolu à l'état résolu, ou à tout état placé après lui — quelle que soit celle des quatre voies ci-dessus qui le déplace. Chaque résolution :

- **Rend les moniteurs que l'incident retient.** Un incident déclaré ouvert retient ses moniteurs : il les a mis dans son statut **Change Monitor Status to**, s'il en indique un, et, déclaré à la main, a mis leur surveillance en pause. Une modification pendant qu'il est ouvert — ajouter des moniteurs ou changer ce statut — les lui fait retenir aussi. La résolution relance leur surveillance et les remet en état opérationnel, sauf si un autre incident ouvert les retient encore, et dès lors l'incident ne retient plus rien. Un incident déclaré déjà résolu ne rend donc rien, pas plus qu'une seconde résolution après une réouverture : le statut que ses moniteurs ont pris entre-temps — par leurs sondes, par une maintenance ou à la main — reste.
- **Marque le SLA comme résolu** et, quand les brouillons de post-mortem de OneUptime AI sont activés, rédige un brouillon de post-mortem.

Passer de **Résolu** à un état placé après lui — **Clôturé**, par exemple — n'est pas une seconde résolution : rien de tout cela ne se rejoue et aucun nouveau SLA ne démarre. Un incident déclaré avant que OneUptime n'enregistre cela rend ses moniteurs à sa prochaine résolution, comme avant.

## La chronologie d'état

La page **Chronologie d'état** du menu latéral de l'incident est la piste d'audit de tous les états par lesquels l'incident est passé. La carte de cette page s'intitule **Chronologie de statut**, et elle est triée du plus récent au plus ancien.

**Colonnes :**

- **Statut de l'incident** — une pastille colorée avec le nom et la couleur de l'état.
- **Commence le** — quand l'incident est entré dans cet état.
- **Se termine le** — quand il en est sorti. L'état courant affiche `Currently Active`.
- **Durée** — le temps passé dans l'état, compté jusqu'à maintenant pour l'état courant.
- **Statut de notification de l'abonné** — si la notification de page de statut pour ce changement a été envoyée, ignorée ou est encore en attente, avec un lien **plus de détails** et — en cas d'échec d'envoi — une action **Retry**.

**Actions de ligne :**

- **Voir la cause** — ouvre une fenêtre **Cause racine** affichant le Markdown enregistré avec ce changement d'état.
- **Voir les journaux** — ouvre une fenêtre expliquant pourquoi le statut a changé, avec une visionneuse **Journal des états de l'incident**.

Les lignes de chronologie peuvent être créées et supprimées, mais pas modifiées. Supprimer la mauvaise ligne réécrit l'histoire de l'incident : traitez cela comme un outil de correction, pas comme une habitude de rangement.

## La liste des incidents actifs

**Incidents → Incidents actifs** est la liste que vous surveillez pendant une astreinte. Sa définition tient en une seule condition : l'état courant de l'incident se trouve au-dessus de votre état résolu — le premier état de l'ordre marqué `isResolvedState`. Rien d'autre n'entre en compte — ni la gravité, ni l'ancienneté, ni le fait que quelqu'un l'ait pris en compte.

L'entrée du menu latéral porte un badge de comptage rouge qui utilise la même requête : le badge et la liste sont donc toujours d'accord. Quand il n'y a rien à voir, la page le dit.

Conséquence pratique : un état personnalisé que vous ajoutez au-dessus de l'état résolu maintient les incidents dans cette liste — « Atténué » n'est pas « terminé » — et un état placé après lui les en retire, comme le fait l'état résolu. Les alertes et les épisodes suivent la même règle avec leurs propres états, et les compteurs du menu latéral, les rappels, les pages de statut et l'application mobile la lisent tous.

## Prévenir les abonnés de la page de statut d'un changement d'état

Un changement d'état peut envoyer un e-mail aux abonnés de votre page de statut, mais il doit franchir plusieurs barrières. Les comprendre vous épargne beaucoup de « pourquoi personne n'a été prévenu ».

La notification est demandée ligne de chronologie par ligne de chronologie via **Notifier les abonnés de la page de statut** (`shouldStatusPageSubscribersBeNotified`), la case à cocher présente sur la fenêtre de changement d'état et sur le formulaire manuel de chronologie. Quand elle est décochée, la ligne est enregistrée avec un statut « ignoré » et une explication. Quand elle est cochée, la ligne est mise en file et une tâche de fond la reprend — la tâche tourne chaque minute, la livraison est donc rapide mais pas instantanée.

**La ligne mise en file est ensuite ignorée dès que l'une de ces conditions est vraie :**

- **Le nouvel état est l'état de création.** Les abonnés ont déjà été prévenus à la déclaration de l'incident : la première ligne de chronologie n'envoie donc délibérément pas un second message.
- **L'incident n'a aucun moniteur rattaché.** Sans ressources, il n'y a aucune page de statut sur laquelle projeter l'incident.
- **L'incident n'est pas visible sur la page de statut** (`isVisibleOnStatusPage` est désactivé).
- **La page de statut n'affiche pas les incidents** (`showIncidentsOnStatusPage` est désactivé). Celle-ci est propre à chaque page de statut — les autres pages qui affichent le même moniteur sont quand même notifiées.

**Une dernière chose qui change le résultat.** Si vous saisissez une **Note publique** dans la fenêtre de changement d'état, la ligne de chronologie est marquée comme déjà notifiée plutôt que mise en file. C'est la note elle-même qui atteint les abonnés : ils reçoivent un message au lieu de deux. Ce message nomme le nouvel état sur chaque canal, comme l'aurait fait le message de changement d'état : par exemple `[Resolved Incident] <title>` dans l'objet de l'e-mail et `**Status:** Resolved` dans Slack et Microsoft Teams. Publier la note demande la permission de créer des notes publiques : sans elle, la fenêtre ne propose pas la note, et un changement d'état envoyé avec une note est refusé, si bien que l'état reste inchangé. Le type d'événement derrière le message de changement d'état simple est `Subscriber Incident State Changed`.

Les alertes, les épisodes d'alertes et les épisodes d'incidents proposent plutôt une note privée avec un changement d'état (**Ajouter une note privée**), et elle fonctionne de la même façon : la publier demande la permission propre à la note (**Create Alert Internal Note**, **Create Alert Episode Internal Note** ou **Create Incident Episode Internal Note** dans un rôle personnalisé ; les rôles intégrés d'alertes, d'incidents et de projet les ont), et un changement d'état envoyé avec une note privée par quelqu'un qui ne l'a pas est refusé en entier, si bien que l'état reste inchangé.

Pour savoir qui reçoit ces messages et comment les modèles sont choisis, voyez [Abonnés et annonces](/docs/status-pages/subscribers).

## Garder un incident hors de la page de statut

Trois choses distinctes décident si un incident figure sur la page publique, et les trois doivent être vraies :

- **Afficher les incidents** (`showIncidentsOnStatusPage`) sur la page de statut elle-même.
- **Visible sur la page de statut** (`isVisibleOnStatusPage`) sur l'incident — une bascule sur la page **Paramètres** de l'incident. Elle vaut vrai par défaut et n'est pas dans l'assistant de déclaration ; un critère de moniteur peut la positionner via **Afficher l'incident sur la page de statut**.
- **L'état courant se trouve au-dessus de l'état résolu.** C'est ce qui retire un incident de la section active : la requête de la page de statut récupère les incidents dont l'état courant se trouve au-dessus de votre état résolu, si bien que l'état résolu et tout état placé après lui retirent l'incident. Vous n'archivez ni ne clôturez rien — vous le résolvez, et il bascule dans l'historique.

**Les incidents privés n'apparaissent jamais.** Activer **Incident privé** masque l'incident de toutes les pages de statut, quels que soient les réglages ci-dessus, et le restreint à ses propriétaires ainsi qu'aux administrateurs et propriétaires du projet.

La quantité d'historique résolu que garde la page est un réglage de page de statut, pas d'incident. Voyez [Ressources et groupes de la page de statut](/docs/status-pages/resources-and-groups) pour savoir comment les moniteurs d'une page décident quels incidents s'y affichent.

## Où lire ensuite

- [Vue d'ensemble des incidents](/docs/incidents/index) — comment s'assemble le domaine fonctionnel des incidents.
- [Déclarer un incident](/docs/incidents/declaring-incidents) — l'assistant de déclaration, les modèles et l'API.
- [Notes, propriétaires et fil d'incident](/docs/incidents/notes-owners-and-feed) — notes publiques, notes privées et fil d'activité.
- [Paramètres et automatisation des incidents](/docs/incidents/settings) — modèles, champs personnalisés, règles et déclencheurs de workflow.
- [Abonnés et annonces](/docs/status-pages/subscribers) — qui reçoit les e-mails déclenchés par un changement d'état.
- [Vue d'ensemble des pages de statut](/docs/status-pages/index) — ce qu'affiche une page de statut, et pour qui.
- [Présentation des workflows](/docs/workflows/index) — réagir aux changements d'état avec de l'automatisation.
