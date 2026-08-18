# États et sévérités

Chaque incident porte deux classifications : un **état** qui dit où il en est dans votre réponse, et une **gravité** qui dit à quel point il fait mal. Dans le tableau de bord, ils se ressemblent — tous deux s'affichent en pastilles colorées dans la liste des incidents, tous deux sont des listes propres au projet que vous pouvez renommer et recolorer. Ils font des travaux très différents.

Les états pilotent le comportement. Trois indicateurs booléens sur les lignes d'état décident quels incidents comptent comme actifs, quels boutons apparaissent dans l'en-tête de l'incident, quand le chronomètre du SLA s'arrête, et quand l'incident disparaît de votre page de statut. Les gravités ne pilotent rien par elles-mêmes — ce sont des étiquettes qui décrivent l'impact, et sur lesquelles d'autres règles peuvent faire correspondre.

Les deux listes sont initialisées à la création de votre projet, et toutes deux se modifient sous **Incidents → Paramètres**. Cette section du menu latéral Incidents est repliée par défaut : dépliez **Paramètres** avant d'aller la chercher.

## Les états portent le comportement, les gravités portent le sens

Le modèle `IncidentState` possède `name`, `description`, `color` et `order`, plus trois booléens : `isCreatedState`, `isAcknowledgedState` et `isResolvedState`. Tout ce que le produit fait avec les états se fonde sur ces booléens et sur `order` — jamais sur le nom de l'état. C'est pourquoi vous pouvez renommer **Résolu** en « Clôturé » sans rien casser : l'indicateur voyage avec la ligne.

Le modèle `IncidentSeverity` possède `name`, `description`, `color` et `order`, et rien d'autre. Il n'y a aucun indicateur. Rien dans OneUptime ne traite **Incident critique** différemment de **Incident mineur** en soi — la gravité ne compte que là où vous pointez quelque chose vers elle, comme le critère de correspondance **Incident Severities** d'une règle d'astreinte.

Quelques règles rapides :

- **Choisissez la gravité pour communiquer l'impact** — elle apparaît dans la liste des incidents, sur la **Vue d'ensemble** de l'incident, et c'est un champ obligatoire quand vous déclarez un incident.
- **Choisissez les états pour modéliser votre processus** — les étapes de réponse que vous parcourez réellement, dans l'ordre où vous les parcourez.
- **N'encodez pas l'urgence dans les états** — un état nommé « Critique » n'alerterait personne. C'est la gravité plus une règle d'astreinte qui font cela.

## Les états initialisés

Trois états sont créés avec le projet, dans cet ordre. L'initialisation est idempotente — un état n'est ajouté que s'il n'en existe pas déjà un portant ce nom.

| État                | `order` | Indicateur            | Couleur   | Signification                                            |
| ------------------- | ------- | --------------------- | --------- | -------------------------------------------------------- |
| **Identifié**       | `1`     | `isCreatedState`      | `#fd625e` | L'état dans lequel arrivent les nouveaux incidents.      |
| **Pris en compte** | `2`     | `isAcknowledgedState` | `#ffbf53` | Quelqu'un a pris l'incident en main.                     |
| **Résolu**          | `3`     | `isResolvedState`     | `#2ab57d` | L'incident est terminé et cesse de compter comme actif.  |

Attention au nom : le premier état est **Identifié**, même si plusieurs descriptions à l'intérieur du produit continuent de l'appeler l'état « de création ». Quand une doc ou une infobulle dit « état de création », elle désigne l'état qui porte `isCreatedState` — dans un projet neuf, il s'agit de **Identifié**.

## Ce que fait réellement chaque indicateur d'état

| Indicateur            | Objet                                                                                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `isCreatedState`      | L'état que reçoit un incident quand personne n'en a choisi. Si aucun état du projet ne porte cet indicateur, la création d'un incident échoue avec une erreur vous demandant d'ajouter un état d'incident de création depuis les paramètres. |
| `isAcknowledgedState` | Alimente le bouton **Acknowledge** et la tuile de statistique « <nom de l'état> en » sur la **Vue d'ensemble** de l'incident. Lors d'un changement vers cet état, le SLA de l'incident est marqué comme ayant reçu une réponse. |
| `isResolvedState`     | Alimente le bouton **Résoudre** et la tuile de statistique de résolution, définit la liste **Incidents actifs**, et c'est ce qui retire l'incident de la section active d'une page de statut. Marque le SLA comme résolu. |

On attend qu'un seul état par projet porte chacun de ces indicateurs — les recherches ne récupèrent qu'une seule ligne. Les trois états porteurs d'indicateurs peuvent être renommés, recolorés et réordonnés, mais la page de paramètres refuse de les supprimer et affiche une erreur nommant les états de création, de prise en compte et de résolution.

Comme l'interface lit les noms d'état dynamiquement, renommer un état change ce que vous voyez partout — les tuiles de statistiques, les titres des fenêtres de confirmation et la pastille de la liste des incidents suivent tous le nom que vous avez donné à la ligne.

## Ajouter vos propres états

Allez dans **Incidents → Paramètres → État de l'incident**. La page est une liste ordonnée triée par `order` croissant, et les nouveaux états sont ajoutés à la fin. Faites glisser une ligne pour changer sa position.

**Champs d'un état :**

- **Nom** — obligatoire, au moins deux caractères. Le texte indicatif suggère quelque chose comme « Investigating ».
- **Description** — texte libre facultatif expliquant quand un incident se trouve dans cet état.
- **Couleur** — obligatoire. Choisie dans le sélecteur de couleurs ; stockée comme valeur hexadécimale, par exemple `#fd625e`.

Vous ne pouvez pas définir les trois indicateurs depuis ce formulaire — ils appartiennent aux lignes initialisées. Un état que vous ajoutez est donc un état sans indicateur, ce qui a deux conséquences à anticiper :

- **Il compte comme actif.** **Incidents actifs** est défini comme « l'état actuel n'est pas l'état résolu » : tout ce que vous ajoutez, hormis l'état résolu, maintient l'incident dans la liste active et dans le décompte de la barre latérale.
- **Son bouton de transition est générique.** Au lieu de **Acknowledge** ou **Résoudre**, la fenêtre de confirmation s'intitule **Marquer l'incident comme `<state name>`** avec un bouton de soumission **Mark as `<state name>`**.

Une forme courante consiste à insérer une étape de triage ou d'atténuation entre les états de prise en compte et de résolution — par exemple, faites glisser un nouvel état « Atténué » pour qu'il se place après **Pris en compte** et avant **Résolu**.

## L'ordre est une vraie contrainte, pas une préférence d'affichage

La colonne `order` est appliquée quand un changement d'état est écrit, et pas seulement quand la liste est dessinée :

- **Les transitions vers l'arrière sont rejetées.** Faire passer un incident à un état situé plus tôt dans l'ordre que son état actuel échoue avec une erreur nommant les deux états.
- **Resélectionner l'état actuel est rejeté.** Définir un incident sur l'état dans lequel il se trouve déjà échoue avec « Incident state cannot be same as previous state. »
- **Une ligne antidatée ne peut pas dupliquer sa voisine.** Insérer une ligne de chronologie dont l'état correspond à celui de la ligne qui la suit est refusé également.
- **Les boutons d'en-tête suivent la position des états porteurs d'indicateurs dans l'ordre.** **Acknowledge** et **Résoudre** sont proposés selon la place de l'état actuel dans la liste triée par ordre. Un état personnalisé placé *après* l'état résolu n'affichera jamais de bouton **Résoudre**, car il n'y a plus rien vers quoi avancer.

Donc, quand vous ajoutez un état, placez-le là où un incident passerait réellement. Le mal ordonner ne fait pas que paraître étrange — cela rend les transitions impossibles.

## Les gravités initialisées

Trois gravités sont créées avec le projet, dans cet ordre :

- **Incident critique** (`order` 1, `#b70400`) — des problèmes causant un impact très élevé sur les clients, nécessitant une réponse immédiate. Une panne totale ou une fuite de données.
- **Incident majeur** (`order` 2, `#fd625e`) — un impact significatif, nécessitant généralement une réponse immédiate, parfois avec un contournement qui limite les dégâts. La défaillance d'un sous-système important.
- **Incident mineur** (`order` 3, `#ffbf53`) — un faible impact, traité en général pendant les heures ouvrées, et que la plupart des clients ne remarqueront probablement pas. Une légère baisse des performances de l'application.

La gravité est obligatoire quand vous déclarez un incident, et elle est obligatoire sur chaque spécification d'incident dans les critères d'un moniteur : chaque incident — manuel ou automatique — arrive donc avec une gravité. Voyez [Déclarer un incident](/docs/incidents/declaring-incidents) pour le parcours de déclaration et [Modèles d'incident et d'alerte](/docs/monitor/incident-alert-templating) pour la voie pilotée par les moniteurs.

## Modifier les gravités

Allez dans **Incidents → Paramètres → Gravité de l'incident**. Même forme que la page des états — une liste ordonnée triée par `order`, glissez pour réordonner, nouvelles gravités ajoutées à la fin, avec **Nom**, **Description** et **Couleur** sur le formulaire.

Deux différences par rapport aux états :

- **Il n'y a pas de garde-fou de suppression.** N'importe quelle gravité peut être supprimée, y compris les trois initialisées.
- **Il n'y a aucun indicateur à hériter.** Une nouvelle gravité se comporte exactement comme les gravités initialisées — c'est une étiquette avec une couleur et une position.

**Une remarque sur les textes indicatifs.** Le formulaire de gravité réutilise mot pour mot le texte d'exemple du formulaire d'état : les indications parlent donc d'états d'incident plutôt que de gravités. Ignorez-les et écrivez vos propres noms et descriptions de gravité.

Là où la gravité fait plus que décrire : sur **Incidents → Règles → Règles d'astreinte**, le champ **Incident Severities** d'une règle est un critère de correspondance. Y lister **Incident critique** est la façon d'exprimer « alerter l'équipe base de données pour tout ce qui est critique » — la politique d'astreinte vit sur la règle, pas sur la gravité.

## Faire évoluer un incident au fil de ses états

Il y a quatre façons pour un incident de changer d'état :

- **Les boutons d'en-tête.** Ouvrez un incident. Si son état actuel est avant l'état de prise en compte, vous obtenez **Acknowledge** et **Résoudre** ; s'il est entre les deux, vous obtenez **Résoudre**. Chacun ouvre une fenêtre de confirmation — **Acknowledge Incident** ou **Resolve Incident** — qui propose aussi **Sélectionner le modèle de note**, **Note publique** et **Notifier les abonnés de la page de statut**.
- **La chronologie d'état.** Ajoutez une ligne à la main depuis la page **Chronologie d'état** de l'incident avec **Statut de l'incident**, **Commence le** et **Notifier les abonnés de la page de statut**.
- **Le changement groupé.** La liste des incidents propose une action groupée **Modifier l'état** pour faire évoluer plusieurs incidents d'un coup.
- **Automatiquement.** Un critère de moniteur avec **Résoudre automatiquement l'incident** activé résout son incident lorsque le critère n'est plus rempli, et l'API peut mettre à jour l'état via `/api/incident-state-timeline`.

Chacune de ces voies écrit une ligne de chronologie. Un changement d'état fait aussi quelques choses que vous n'avez pas à demander : il publie une entrée dans le fil d'incident, attribue un Responsable d'incident si l'incident n'en a pas encore, et met à jour le chronomètre du SLA. Rouvrir un incident résolu démarre un nouvel enregistrement de SLA à partir de l'heure de réouverture.

## La chronologie d'état

La page **Chronologie d'état** dans le menu latéral de l'incident est la piste d'audit de tous les états par lesquels l'incident est passé. La carte de cette page s'intitule **Chronologie de statut**, et elle est triée du plus récent au plus ancien.

**Colonnes :**

- **Statut de l'incident** — une pastille colorée avec le nom et la couleur de l'état.
- **Commence le** — quand l'incident est entré dans cet état.
- **Se termine le** — quand il en est sorti. L'état actuel affiche `Currently Active`.
- **Durée** — le temps passé dans l'état, compté jusqu'à maintenant pour l'état courant.
- **Statut de notification de l'abonné** — si la notification de page de statut pour ce changement a été envoyée, ignorée ou est encore en attente, avec un lien **plus de détails** et — lorsque l'envoi a échoué — une action **Retry**.

**Actions de ligne :**

- **Voir la cause** — ouvre une fenêtre **Cause racine** affichant le markdown enregistré avec ce changement d'état.
- **Voir les journaux** — ouvre une fenêtre expliquant pourquoi le statut a changé, avec une visionneuse **Journal des états de l'incident**.

Les lignes de chronologie peuvent être créées et supprimées, mais pas modifiées. Supprimer la mauvaise ligne réécrit l'histoire de l'incident : traitez cela comme un outil de correction plutôt que comme une habitude de ménage.

## La liste des incidents actifs

**Incidents → Incidents actifs** est la liste que vous surveillez pendant une garde. Sa définition tient en une seule condition : l'état actuel de l'incident est un état où `isResolvedState` est faux. Rien d'autre n'est pris en compte — ni la gravité, ni l'ancienneté, ni le fait que quelqu'un l'ait pris en compte.

L'élément du menu latéral porte un badge de comptage rouge utilisant la même requête, si bien que le badge et la liste sont toujours d'accord. Quand il n'y a rien à voir, la page le dit.

La conséquence pratique : tout état personnalisé que vous ajoutez maintient les incidents dans cette liste. C'est en général ce que vous voulez — « Atténué » n'est pas « terminé » — mais cela signifie que le badge ne se vide que lorsque les incidents atteignent réellement l'état résolu.

## Prévenir les abonnés de la page de statut d'un changement d'état

Un changement d'état peut envoyer un e-mail aux abonnés de votre page de statut, mais il passe par plusieurs barrières. Les comprendre évite beaucoup de débogage du type « pourquoi personne n'a été notifié ».

La notification est demandée par ligne de chronologie via **Notifier les abonnés de la page de statut** (`shouldStatusPageSubscribersBeNotified`), la case à cocher de la fenêtre de changement d'état et du formulaire manuel de chronologie. Quand elle est désactivée, la ligne est stockée avec un statut « ignoré » et une explication. Quand elle est activée, la ligne est mise en file d'attente et une tâche d'arrière-plan la prend en charge — la tâche s'exécute chaque minute, la distribution est donc rapide mais pas instantanée.

**La ligne mise en file d'attente est ensuite ignorée dès que l'une de ces conditions est vraie :**

- **Le nouvel état est l'état de création.** Les abonnés ont déjà été prévenus quand l'incident a été déclaré : la première ligne de chronologie n'envoie donc délibérément pas un second message.
- **L'incident n'a aucun moniteur rattaché.** Sans ressources, il n'y a aucune page de statut sur laquelle mapper l'incident.
- **L'incident n'est pas visible sur la page de statut** (`isVisibleOnStatusPage` est désactivé).
- **La page de statut a les incidents désactivés** (`showIncidentsOnStatusPage` est désactivé). Celle-ci est propre à chaque page de statut — les autres pages affichant le même moniteur reçoivent quand même la notification.

**Une dernière chose qui change le résultat.** Si vous saisissez une **Note publique** dans la fenêtre de changement d'état, la ligne de chronologie est marquée comme déjà notifiée plutôt que mise en file d'attente. C'est la note elle-même qui atteint les abonnés : ils reçoivent un message au lieu de deux. Le type d'événement derrière le message simple de changement d'état est `Subscriber Incident State Changed`.

Pour savoir qui les reçoit et comment les modèles sont choisis, voyez [Abonnés et annonces](/docs/status-pages/subscribers).

## Garder un incident hors de la page de statut

Trois choses distinctes décident si un incident apparaît sur la page publique, et les trois doivent être vraies :

- **Afficher les incidents** (`showIncidentsOnStatusPage`) sur la page de statut elle-même.
- **Visible sur la page de statut** (`isVisibleOnStatusPage`) sur l'incident — une bascule sur la page **Paramètres** de l'incident. Sa valeur par défaut est vrai et elle n'est pas dans l'assistant de déclaration ; un critère de moniteur peut la définir avec **Afficher l'incident sur la page de statut**.
- **L'état actuel n'est pas l'état résolu.** C'est ce qui retire un incident de la section active : la requête de la page de statut récupère les incidents dont l'état actuel est un état non résolu. Vous n'archivez ni ne clôturez rien — vous le résolvez, et il bascule dans l'historique.

**Les incidents privés n'apparaissent jamais.** Activer **Incident privé** masque l'incident de toutes les pages de statut, quels que soient les réglages ci-dessus, et le restreint à ses propriétaires ainsi qu'aux administrateurs et propriétaires du projet.

La quantité d'historique résolu conservée par la page est un paramètre de la page de statut, pas de l'incident. Voyez [Ressources et groupes de la page de statut](/docs/status-pages/resources-and-groups) pour savoir comment les moniteurs de la page déterminent quels incidents apparaissent.

## Pour aller plus loin

- [Vue d'ensemble des incidents](/docs/incidents/index) — comment le domaine fonctionnel des incidents s'assemble.
- [Déclarer un incident](/docs/incidents/declaring-incidents) — l'assistant de déclaration, les modèles et l'API.
- [Notes, propriétaires et fil d'incident](/docs/incidents/notes-owners-and-feed) — notes publiques, notes privées et fil d'activité.
- [Paramètres et automatisation des incidents](/docs/incidents/settings) — modèles, champs personnalisés, règles et déclencheurs de workflow.
- [Abonnés et annonces](/docs/status-pages/subscribers) — qui reçoit les e-mails envoyés par un changement d'état.
- [Vue d'ensemble des pages de statut](/docs/status-pages/index) — ce qu'affiche une page de statut et à qui.
- [Présentation des workflows](/docs/workflows/index) — réagir aux changements d'état avec de l'automatisation.
