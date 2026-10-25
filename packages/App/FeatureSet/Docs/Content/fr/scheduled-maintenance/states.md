# États de la maintenance

Chaque événement de maintenance planifiée est dans un seul **état** : où en sont les travaux, de prévus à validés. Les états décident de ce que OneUptime fait de l'événement : quand ses moniteurs cessent d'être vérifiés, ce que montrent vos pages de statut, quand ses rappels s'arrêtent. Cette page présente les quatre états avec lesquels démarre chaque projet, ce qui fait passer un événement de l'un à l'autre et comment ajouter vos propres étapes.

:::cards
- [Les états initiaux](#les-états-initiaux): Planifié, En cours, Terminé et Achevé.
- [Ce qui fait avancer un événement](#ce-qui-fait-avancer-un-événement): L'horloge, l'en-tête, la chronologie, le chat et l'API.
- [Vos propres états](#vos-propres-états): Une étape avant le début des travaux, ou une vérification après.
- [La chronologie d'état](#la-chronologie-détat): Chaque état dans lequel un événement a été, et comment le corriger.
:::

## Comment ça marche

Les états de maintenance d'un projet forment une seule liste ordonnée, et les événements ne font que la descendre. La place d'un état décide de ce que vaut un événement qui s'y trouve : en attente de début, en cours ou passé.

```mermaid title="Les événements ne font que descendre la liste ; la place d'un état décide de ce qu'il vaut"
flowchart TB
    subgraph waiting["En attente de début"]
        scheduled["Planifié"]
        confirmed["Confirmé<br/>(le vôtre)"]
    end
    subgraph progress["En cours"]
        ongoing["En cours"]
        verifying["Vérification<br/>(le vôtre)"]
    end
    subgraph over["Passé"]
        ended["Terminé"]
        completed["Achevé"]
    end
    scheduled --> confirmed
    confirmed -->|"son Commence le"| ongoing
    ongoing --> verifying
    verifying -->|"son Se termine le"| ended
    ended --> completed
```

Le modèle `ScheduledMaintenanceState` a `name`, `description`, `color` et `order`, plus quatre indicateurs : `isScheduledState`, `isOngoingState`, `isEndedState` et `isResolvedState`. OneUptime lit les indicateurs et l'ordre, jamais le nom, vous pouvez donc renommer **Achevé** en « Validé » sans rien casser.

> [!TIP]
> La liste se trouve sous **Maintenance planifiée → Paramètres → État de l'événement**. **Paramètres** est replié au départ dans le menu latéral : dépliez-le d'abord.

## Les états initiaux

Chaque nouveau projet démarre avec quatre états de maintenance, dans cet ordre :

| État          | `order` | Indicateur         | Couleur   | Ce qu'il signifie                                              |
| ------------- | ------- | ------------------ | --------- | -------------------------------------------------------------- |
| **Planifié**  | `1`     | `isScheduledState` | `#000000` | Chaque nouvel événement commence ici et attend son heure de début. |
| **En cours**  | `2`     | `isOngoingState`   | `#ffbf53` | Les travaux sont en cours, et les moniteurs de l'événement ne sont pas vérifiés. |
| **Terminé**   | `3`     | `isEndedState`     | `#4a4a4a` | La fenêtre est passée, et les vérifications reprennent.       |
| **Achevé**    | `4`     | `isResolvedState`  | `#2ab57d` | Quelqu'un a validé les travaux, et les rappels aux propriétaires s'arrêtent. |

Les quatre états marqués portent l'étiquette **Intégré** sur la page des paramètres. Vous pouvez les renommer, les recolorer et les déplacer, mais ils gardent leur ordre et ne peuvent pas être supprimés : leur **Supprimer** reste verrouillé, et dit pourquoi.

**Terminé** et **Achevé** sont tous deux passés. La différence est qui fait avancer l'événement : OneUptime le passe à **Terminé** à son **Se termine le**, et une personne, un bouton de chat ou l'API le passe à **Achevé** une fois les travaux vérifiés.

## Ce qui fait avancer un événement

| Moyen            | Où                                                                                          | Ce qu'il demande                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **L'horloge**    | Une tâche qui s'exécute chaque minute                                                       | Rien : à **Commence le**, elle passe un événement en attente à **En cours**, et à **Se termine le** un événement en cours à **Terminé**. |
| **L'en-tête**    | La **Vue d'ensemble** de l'événement : les boutons **Marquer comme {{state}}**, et **Changer l'état en** dans son menu **⋯** | Une courte boîte de dialogue, **Marquer la maintenance planifiée comme {{state}}**, avec **Notifier les abonnés de la page de statut** et une note facultative sous **Ajouter une note publique**. |
| **La chronologie** | **Chronologie d'état** dans le menu latéral de l'événement                                | Une ligne que vous ajoutez à la main, avec **Statut de la maintenance planifiée** et **Commence le**.           |
| **Une ligne de la liste** | Le menu **⋯** sur la ligne d'un événement dans la liste des événements : les étapes **Marquer comme {{state}}** et **Modifier l'état** | La boîte de dialogue de l'en-tête, qui nomme l'événement. Un événement qu'un autre changement a déjà fait avancer est laissé tel quel, et la boîte de dialogue dit pourquoi. |
| **Modification groupée** | **Marquer comme {{state}}** ou **Modifier l'état** sur une sélection dans la liste des événements                  | L'état, et une note publique ajoutée à chaque événement. Les événements déjà à cet état ou au-delà sont ignorés. |
| **Le chat**      | Les boutons des messages Slack et Microsoft Teams de l'événement                            | Le même changement, fait en votre nom. Voir [Slack](/docs/workspace-connections/slack#agir-sur-les-incidents-alertes-et-événements-depuis-slack). |
| **L'API**        | Une ligne créée sous `/api/scheduled-maintenance-state-timeline`                            | L'état, et si les abonnés sont prévenus.                                                                        |

Les boutons de l'en-tête portent le nom de vos états. Tant que l'événement attend, il en propose deux : l'un qui le démarre, nommé d'après votre état en cours, et l'autre qui le termine, nommé d'après votre état terminé. Tant que l'événement est en cours, seulement le second. Le menu **⋯** liste chaque autre état après l'état actuel. Une personne dont le rôle ne permet pas de changer l'état de l'événement voit les boutons verrouillés, sans menu des autres états : en pointant l'un d'eux, elle voit les autorisations qui le lui permettraient.

## Ce que font le démarrage et la fin

Un événement démarre quand il passe d'un état où il attend à **En cours**, ou directement à l'un de vos états placé entre **En cours** et **Terminé**. Alors :

- **Ses moniteurs cessent d'être vérifiés** et passent à son **Changer le statut du moniteur en**, s'il en a un. Un moniteur que vous ajoutez à l'événement pendant les travaux change aussi.
- **Ses pages de statut le listent comme en cours**, et ses abonnés sont prévenus : à son heure si **Lorsque l'événement commence** est activé, et à la main selon ce que dit **Notifier les abonnés de la page de statut** dans la boîte de dialogue.
- **Ses propriétaires sont prévenus**, s'ils ont activé la notification de changement d'état, et l'événement apparaît sous **Événements en cours**.

Un événement se termine quand il passe d'un état où il est en cours à **Terminé**, **Achevé** ou l'un de vos états placé après **Terminé**. Ses moniteurs sont alors de nouveau vérifiés et reviennent à « opérationnel », sauf si un autre événement en cours les retient encore, et ses abonnés sont prévenus de la même façon : à son heure si **Lorsque l'événement se termine** est activé, et à la main selon ce que dit la boîte de dialogue.

Passer de **En cours** à « Vérification », ou de **Terminé** à **Achevé**, ne démarre ni ne termine rien de nouveau : l'événement avait déjà commencé, ou s'était déjà terminé.

## L'horloge de l'en-tête

Avant le début, l'en-tête fait un compte à rebours ; pendant que l'événement se déroule, il compte depuis combien de temps il dure ; une fois passé, il indique combien de temps il a pris. Quand l'événement manque une limite de plus de deux minutes, un avis orange le signale :

- **Début en retard** : l'événement attend toujours après son **Commence le**.
- **Dépassement** : l'événement est toujours en cours après son **Se termine le**.

L'avis indique l'heure prévue et l'état que l'événement n'a pas encore atteint. Juste après une limite, la tâche qui fait avancer les événements ne s'est peut-être pas encore exécutée, donc pendant les minutes suivantes l'en-tête vérifie de nouveau tout seul, et affiche le nouvel état sans rechargement.

## L'ordre est imposé

Chaque changement d'état est vérifié par rapport à la liste, quel qu'en soit l'auteur : le tableau de bord, Slack, Microsoft Teams, l'API, Terraform, un workflow ou OneUptime lui-même.

- **Les retours en arrière sont refusés**, avec un message qui nomme les deux états : "Scheduled Maintenance cannot transition to Scheduled state from Ongoing state because Scheduled is before Ongoing in the order of scheduled maintenance states."
- **Passer à l'état dans lequel il est déjà est refusé** : "Scheduled Maintenance state cannot be same as previous state."
- **Les sélecteurs ne proposent que les états après l'état actuel**, pour que personne ne se voie proposer un changement qui serait refusé.

Pour corriger un état défini par erreur, supprimez sa ligne sur la page **Chronologie d'état** de l'événement ; l'événement revient à l'état de la ligne précédente.

## Vos propres états

Un état que vous ajoutez est une étape que votre équipe franchit et que les quatre états initiaux ne nomment pas : « Confirmé » avant le début des travaux, « Vérification » après.

:::steps
### Ouvrir la liste des états

Allez dans **Maintenance planifiée → Paramètres → État de l'événement**. La carte **États de maintenance planifiée** liste vos états dans leur ordre. Chaque ligne affiche sa couleur et son nom, ce que vaut un événement qui s'y trouve (colonne **Compte comme**) et sa description.

### Créer l'état

Cliquez sur **Créer : État de maintenance planifiée** et renseignez son **Nom**, sa **Description** et sa **Couleur**. Le nouvel état est ajouté juste au-dessus de l'état achevé.

### Le glisser à sa place

Faites glisser une ligne par sa poignée pour la déplacer ; le nouvel ordre est enregistré quand vous la déposez. La colonne **Compte comme** suit la place où vous la déposez.
:::

Un état que vous ajoutez n'a pas d'indicateur, donc sa place est ce qu'il signifie :

| Où vous le placez                       | Un événement qui s'y trouve                                                                                      |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Entre **Planifié** et **En cours**      | Attend son **Commence le**, comme dans **Planifié**, et démarre de là à son heure.                               |
| Entre **En cours** et **Terminé**       | Est en cours, comme dans **En cours** : ses moniteurs restent non vérifiés, et il se termine à son **Se termine le**. |
| Entre **Terminé** et **Achevé**         | Est passé, mais pas encore achevé : les rappels qui durent jusqu'à l'achèvement continuent.                     |
| Sous **Achevé**                         | Est achevé, comme dans **Achevé**.                                                                               |

Gardez vos états sous **Planifié** : chaque nouvel événement commence là, et un événement ne remonte jamais la liste, donc un état au-dessus n'est jamais atteint. Vous faites passer un événement à l'un de vos états depuis le menu **⋯** de son en-tête, sous **Changer l'état en**.

> [!NOTE]
> Sur OneUptime Cloud, ajouter ou modifier des états de maintenance requiert le forfait **Growth** ou supérieur. Tous les forfaits peuvent les lire, les utiliser et supprimer un état que vous avez ajouté.

## Archiver un état

Archivez un état créé par vous que votre équipe ne doit plus utiliser, au lieu de le supprimer. L'archivage ne modifie aucun événement : un événement dans cet état y reste et avance comme d'habitude, et sa chronologie d'états l'affiche toujours.

- **Archiver** se trouve dans le menu **⋯** de la ligne. Il demande d'abord confirmation et liste les mesures et flux de travail configurés pour utiliser l'état.
- **Personne ne peut plus le choisir.** L'en-tête de l'événement, **Modifier l'état**, Slack et Microsoft Teams l'excluent, et l'API, Terraform et MCP le refusent. Vous pouvez toujours filtrer les événements par celui-ci.
- **Les états archivés sont listés à part**, dans la section repliée **États de maintenance planifiée archivés** sous le tableau. **Désarchiver** en remet un tel qu'il était.
- **Les quatre états intégrés ne peuvent pas être archivés** : OneUptime y fait passer les événements. Leur **Archiver** est verrouillé, avec la raison.

## La chronologie d'état

La page **Chronologie d'état** de l'événement est l'historique de chaque état dans lequel il a été. Sa carte, **Chronologie de statut**, les dessine sous forme de chronologie : une bande où chaque état dure ce qu'il a duré, et en dessous chaque changement, le plus récent en premier. **Tableau**, dans l'en-tête de la carte, les liste plutôt en lignes, avec **Statut de la maintenance planifiée**, **Commence le**, **Se termine le**, **Durée**, si les abonnés devaient être prévenus et comment s'est passée leur notification.

Dans le tableau de bord, les lignes peuvent être ajoutées et supprimées, mais pas modifiées, et un événement en garde toujours au moins une. Via l'API, le `startsAt` d'une ligne peut être corrigé, et chaque mesure calculée à partir de la chronologie le suit. Supprimer la ligne la plus récente remet l'événement dans l'état de la ligne précédente.

> [!WARNING]
> Supprimer une ligne réécrit l'historique de l'événement et chaque mesure qui en est calculée. Servez-vous-en pour corriger une erreur, pas pour faire du rangement.

## Dépannage

:::details L'en-tête indique Start overdue
L'événement attend toujours plus de deux minutes après son **Commence le**, donc la tâche qui démarre les événements ne l'a pas encore fait avancer. Démarrez-le vous-même avec le bouton de l'en-tête : un démarrage à la main fait tout ce que fait la tâche, y compris pour ses moniteurs.
:::

:::details Un événement ne peut pas revenir à un état où il a été
Les états ne font que descendre la liste. Supprimez les lignes après l'état voulu sur la page **Chronologie d'état** de l'événement, la plus récente en premier.
:::

:::details L'état achevé manque parmi les boutons de l'en-tête
Les boutons de l'en-tête démarrent et terminent l'événement. L'achever se trouve dans le menu **⋯**, sous **Changer l'état en**.
:::

## Prochaines étapes

:::cards
- [Vue d'ensemble de la maintenance planifiée](/docs/scheduled-maintenance/index): Où tout se trouve, et ce qu'un événement affecte.
- [Créer des événements de maintenance](/docs/scheduled-maintenance/creating-events): Le formulaire, champ par champ.
- [Règles et paramètres de la maintenance](/docs/scheduled-maintenance/settings): Rappeler l'événement aux propriétaires jusqu'à ce qu'il soit achevé.
- [États et sévérités des incidents](/docs/incidents/states-and-severities): La même liste ordonnée, pour les incidents.
:::
