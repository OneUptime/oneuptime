# États et sévérités des alertes

Chaque alerte porte un **état**, où en est votre équipe avec elle, et une **gravité**, son importance. Les états pilotent ce que fait OneUptime : qui est encore alerté, ce qui compte comme actif, quand un épisode se résout. Les gravités classent les alertes, et les règles peuvent s'appuyer dessus. Cette page s'adresse à quiconque les configure, ou se demande pourquoi une alerte a alerté ou non.

:::cards
- [Les états prédéfinis](#les-états-prédéfinis): Identifié, Pris en compte et Résolu, et ce que fait chacun.
- [Ajouter vos propres états](#ajouter-vos-propres-états): Une étape à vous, comme « En investigation ».
- [Faire passer une alerte par ses états](#faire-passer-une-alerte-par-ses-états): Toutes les façons dont un état change.
- [Gravités](#les-gravités-prédéfinies): Élevé et Low, et ajouter les vôtres.
:::

## Fonctionnement

Les états d'alerte d'un projet forment une liste ordonnée, et les alertes ne font que la descendre. La place d'un état décide de ce que compte une alerte qui s'y trouve : pas encore prise en compte, prise en compte ou résolue. Les épisodes d'alertes parcourent la même liste.

```mermaid title="Les alertes ne font que descendre la liste ; la place d'un état décide de ce qu'il compte"
flowchart TB
    subgraph open["Compte comme<br/>non prise en compte"]
        identified["Identifié"]
    end
    subgraph working["Compte comme<br/>prise en compte"]
        acknowledged["Pris en compte"]
        investigating["En investigation<br/>(personnalisé)"]
    end
    subgraph done["Compte comme<br/>résolue"]
        resolved["Résolu"]
        closed["Fermé<br/>(personnalisé)"]
    end
    identified --> acknowledged
    acknowledged --> investigating
    investigating --> resolved
    resolved --> closed
    identified -. "sauter" .-> resolved
```

Le modèle `AlertState` a `name`, `description`, `color` et `order`, plus trois indicateurs : `isCreatedState`, `isAcknowledgedState` et `isResolvedState`. OneUptime lit les indicateurs et l'ordre, jamais le nom, vous pouvez donc renommer **Résolu** en « Fermé » sans rien casser. Le modèle `AlertSeverity` a `name`, `description`, `color` et `order`, et aucun indicateur.

> [!TIP]
> Les deux listes se trouvent sous **Alertes → Paramètres**, qui commence replié dans le menu latéral : dépliez **Paramètres** pour trouver **État de l'alerte** et **Gravité de l'alerte**.

## Les états prédéfinis

Chaque nouveau projet commence avec trois états d'alerte, dans cet ordre :

| État               | `order` | Indicateur            | Couleur   | Ce qu'il signifie                                 |
| ------------------ | ------- | --------------------- | --------- | ------------------------------------------------- |
| **Identifié**      | `1`     | `isCreatedState`      | `#fd625e` | L'état dans lequel commencent les nouvelles alertes. |
| **Pris en compte** | `2`     | `isAcknowledgedState` | `#ffbf53` | Quelqu'un s'en occupe, et les appels s'arrêtent.  |
| **Résolu**         | `3`     | `isResolvedState`     | `#2ab57d` | L'alerte est terminée et ne compte plus comme active. |

Les trois états à indicateur portent la mention **Intégré** sur la page des paramètres. Vous pouvez les renommer, les recolorer et les déplacer, mais ils gardent leur ordre, création avant prise en compte avant résolution, et ne peuvent pas être supprimés : leur bouton **Supprimer** reste verrouillé et explique pourquoi.

## Ce que fait chaque indicateur

| Indicateur            | Ce qu'en fait OneUptime                                                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isCreatedState`      | Les nouvelles alertes commencent ici quand personne ne choisit un autre état : chaque alerte qu'un moniteur lève, et chaque alerte créée avec **État initial** vide.             |
| `isAcknowledgedState` | **Prendre en compte** amène une alerte ici. Dans cet état ou dans tout état suivant, l'alerte compte comme prise en compte : ses politiques d'astreinte cessent d'alerter et **Prendre en compte** n'est plus proposé. |
| `isResolvedState`     | **Résoudre** amène une alerte ici. Dans cet état ou dans tout état suivant, l'alerte compte comme résolue : elle quitte les **Alertes actives**, ses rappels s'arrêtent et son épisode peut se résoudre. |

## Ajouter vos propres états

Un état que vous ajoutez est une étape que votre équipe traverse et que les trois états prédéfinis ne nomment pas : « En investigation », « Atténué », « Fermé ».

:::steps
### Ouvrir la liste des états

Allez dans **Alertes → Paramètres → État de l'alerte**. La carte **États d'alerte** liste vos états dans leur ordre. Chaque ligne montre sa couleur et son nom, ce que **Compte comme** une alerte qui s'y trouve, et sa description.

### Créer l'état

Cliquez sur **Créer : État de l'alerte** et remplissez son **Nom**, sa **Description** et sa **Couleur**. La couleur est déjà choisie : une couleur qu'aucun autre état n'utilise encore. Le nouvel état est ajouté juste au-dessus de l'état résolu, il garde donc les alertes actives.

### Le faire glisser à sa place

Faites glisser une ligne par sa poignée pour la déplacer ; le nouvel ordre est enregistré dès que vous la lâchez. La colonne **Compte comme** suit : au-dessus de l'état de prise en compte, une alerte est **Non pris en compte**, à partir de lui **Pris en compte**, et à partir de l'état résolu **Résolu**.
:::

Un état que vous ajoutez n'a pas d'indicateur : sa place fait son sens. Placez une étape d'atténuation entre **Pris en compte** et **Résolu**, et une étape de tri au-dessus de **Pris en compte**. Un état placé sous **Résolu** compte comme résolu partout.

Vous faites passer une alerte dans un état à vous depuis le menu **⋯** de l'en-tête de l'alerte, sous **Changer l'état en**, qui liste chaque état après l'état actuel. Sa confirmation s'intitule **Marquer l'alerte comme {{state}}**, avec le nom de l'état.

> [!NOTE]
> Sur OneUptime Cloud, ajouter ou modifier des états et des gravités d'alerte nécessite l'offre **Growth** ou supérieure. Toutes les offres peuvent les lire, les utiliser et supprimer un état que vous avez ajouté.

## L'ordre est imposé

Chaque changement d'état d'une alerte est vérifié par rapport à la liste, qui qu'en soit l'auteur : le tableau de bord, Slack, Microsoft Teams, l'API, Terraform, un workflow ou OneUptime lui-même.

- **Les retours en arrière sont refusés**, avec un message qui nomme les deux états : « Alert cannot transition to Acknowledged state from Resolved state because Acknowledged is before Resolved in the order of alert states. »
- **Passer à l'état où elle se trouve déjà est refusé** : « Alert state cannot be same as previous state. »
- **Les sélecteurs ne proposent que les états après l'état actuel**, si bien que personne ne se voit proposer un changement qui serait refusé.

Les épisodes d'alertes suivent la même liste, avec leurs propres messages (« Episode cannot transition to … »). Le seul retour vers le haut de la liste est le fait de OneUptime : une règle de regroupement qui rouvre un épisode résolu récemment. Pour corriger un état posé par erreur, supprimez sa ligne sur la page **Chronologie d'état** de l'alerte ; l'alerte revient à l'état de sa dernière ligne restante.

## Les gravités prédéfinies

Chaque nouveau projet commence avec deux gravités d'alerte, de la plus grave à la moins grave :

| Gravité   | `order` | Couleur   | Description prédéfinie                                                            |
| --------- | ------- | --------- | --------------------------------------------------------------------------------- |
| **Élevé** | `1`     | `#b70400` | Issues causing very high impact to customers. Immediate attention is required.    |
| **Faible**   | `2`     | `#ffbf53` | Issues causing low impact to customers.                                           |

Les incidents commencent avec trois gravités et les alertes avec deux. Quand le modèle d'une recommandation de moniteur indique **Critique** ou **Warning**, OneUptime le fait correspondre à votre première et deuxième gravité d'alerte, qui sont **Élevé** et **Faible** dans un nouveau projet.

## Modifier les gravités

Allez dans **Alertes → Paramètres → Gravité de l'alerte**. La carte **Gravités d'alerte** les liste de la plus grave à la moins grave ; faites glisser une ligne pour changer son rang. **Créer : Gravité de l'alerte** en ajoute une en fin de liste, la moins grave, avec les mêmes **Nom**, **Description** et **Couleur** qu'un état.

Le rang décide quelle gravité l'emporte là où OneUptime les compare : la gravité d'un épisode monte jusqu'à celle de l'alerte la plus grave qui le rejoint. Les gravités n'ont ni indicateur ni verrou de suppression : toute gravité peut être supprimée, y compris les deux prédéfinies.

Une gravité n'alerte personne à elle seule. Pour alerter selon la gravité, ajoutez une règle d'astreinte dont les **Gravités d'alerte** lui correspondent : voir [Règles et paramètres des alertes](/docs/alerts/settings). Modifier la gravité d'une alerte écrit une entrée dans son fil d'activité et fait correspondre à nouveau sa règle de rappel.

## Archiver un état ou une gravité

Archivez un état ou une gravité que votre équipe ne doit plus utiliser, au lieu de le supprimer. L'archivage ne modifie aucune alerte. Supprimer un état retire ses lignes de l'historique de chaque alerte, et une gravité ne peut pas être supprimée tant que des alertes l'ont.

- **Archiver** se trouve dans le menu **⋯** de la ligne. Il demande d'abord confirmation et liste les règles, mesures, critères de moniteur et flux de travail configurés pour utiliser la valeur : ils continuent à l'utiliser tant que vous ne les modifiez pas.
- **Personne ne peut plus la choisir.** **Modifier l'état**, l'en-tête de l'alerte, Slack, Microsoft Teams, les règles et les critères de moniteur l'excluent. L'API, Terraform et MCP la refusent, en nommant la valeur et l'endroit où la désarchiver.
- **Les alertes la conservent.** Une alerte qui l'a la conserve à chaque modification ultérieure, sa chronologie d'états l'affiche toujours, et vous pouvez toujours filtrer par celle-ci.
- **Les valeurs archivées sont listées à part**, dans la section repliée **États d'alerte archivés** ou **Gravités d'alerte archivées** sous le tableau, avec qui a archivé chacune et quand. **Désarchiver** en remet une telle qu'elle était.
- **Certaines ne peuvent pas être archivées.** Les états créé, accusé et résolu, ainsi que la dernière gravité non archivée du projet. Leur **Archiver** est verrouillé, avec la raison.

**Supprimer** indique d'abord ce que la suppression ferait. Tant que des alertes ou des épisodes ont la valeur, la suppression est refusée et la boîte de dialogue les liste. Sinon, elle liste ce que la suppression changerait et propose **Archiver plutôt**.

## Faire passer une alerte par ses états

| Moyen                      | Où                                                                                        | Ce qui est demandé                                                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Boutons de l'en-tête**   | L'en-tête de l'alerte : **Prendre en compte**, **Résoudre**, et **Changer l'état en** dans son menu **⋯** | Une courte confirmation, **Prendre en compte l'alerte**, **Résoudre l'alerte** ou **Marquer l'alerte comme {{state}}**, avec une note facultative sous **Ajouter une note privée**. |
| **State timeline**         | **Chronologie d'état** dans le menu latéral de l'alerte                                   | Une ligne que vous ajoutez à la main, avec **Statut de l'alerte** et **Commence le**.                                                 |
| **Ligne de la liste** | Le menu **⋯** sur la ligne d'une alerte dans la liste des alertes : **Prendre en compte**, **Résoudre** et **Modifier l'état** | La confirmation de l'en-tête, qui nomme l'alerte. Une alerte qu'un autre changement a déjà fait avancer est laissée telle quelle, et la boîte de dialogue dit pourquoi. |
| **Changement groupé**      | **Prendre en compte**, **Résoudre** ou **Modifier l'état** sur une sélection dans la liste des alertes                           | L'état, et une note privée ajoutée à chaque alerte. Les alertes déjà dans cet état ou au-delà sont ignorées.                          |
| **Automatiquement**        | Un moniteur, un épisode, un incident lié ou votre propre code                             | **Résoudre automatiquement l'alerte** dans les critères d'un moniteur, le changement d'état d'un épisode, les interrupteurs d'incident de [Alertes liées](/docs/incidents/linked-alerts), ou une ligne créée sur `/api/alert-state-timeline`. |

L'en-tête propose **Prendre en compte** et **Résoudre** tant que l'alerte n'est pas encore prise en compte, et seulement **Résoudre** une fois qu'elle l'est. Une alerte résolue n'affiche ni l'un ni l'autre. Une personne dont le rôle ne permet pas de changer l'état de l'alerte voit les boutons verrouillés, sans menu des autres états : en pointant l'un d'eux, elle voit les autorisations qui le lui permettraient.

## Ce que fait la prise en compte

Une alerte est prise en compte dès qu'elle passe dans votre état de prise en compte, ou dans n'importe quel état suivant, y compris un état résolu. Alors :

- **L'astreinte cesse d'alerter pour elle.** Ses politiques d'astreinte n'alertent pas le niveau suivant.
- **Prendre en compte n'est plus proposé**, ni dans l'en-tête ni dans Slack et Microsoft Teams, où une nouvelle prise en compte est refusée avec « Alert is already acknowledged. » ou « Alert is already resolved. » Quelqu'un qui répond ensuite à son appel voit son appel pris en compte, et l'alerte reste où elle est.
- **Le temps de prise en compte est fixé**, à partir du premier changement de ce type : la première tuile de la **Vue d'ensemble**, et une mesure qui se termine quand **L'alerte est prise en compte**.

## Ce que fait la résolution

Une alerte est résolue quand elle passe dans votre état résolu, ou dans n'importe quel état suivant. Alors :

- **Elle quitte les Alertes actives**, et le compteur du menu latéral.
- **Ses rappels s'arrêtent**, quoi qu'en dise sa règle de rappel.
- **Son épisode peut se résoudre.** Un épisode se résout de lui-même dès que toutes ses alertes sont résolues. Voir [Épisodes d'alertes et règles de regroupement](/docs/alerts/episodes).
- **Son moniteur peut lever une nouvelle alerte.** Un critère garde une seule alerte ouverte à la fois ; une fois celle-ci résolue, la correspondance suivante en ouvre une autre.

Passer de **Résolu** à un état suivant, « Fermé » par exemple, ne change rien à tout cela : l'alerte était déjà résolue.

## La chronologie d'état

La page **Chronologie d'état** de l'alerte est le registre de chaque état par lequel elle est passée. Sa carte, **Chronologie de statut**, les dessine en chronologie : une bande où chaque état occupe le temps qu'il a duré, et dessous chaque changement, du plus récent au plus ancien. **Tableau**, dans l'en-tête de la carte, les liste plutôt en lignes, avec **Statut de l'alerte**, **Commence le**, **Se termine le** et **Durée**.

- **Voir la cause** affiche la cause racine enregistrée avec ce changement.
- **Voir les journaux** affiche ce que OneUptime a enregistré quand l'alerte a changé, comme la vérification du moniteur qui l'a provoqué.

Les lignes peuvent être ajoutées et supprimées, mais pas modifiées, et une alerte en garde toujours au moins une. Supprimer la dernière ligne remet l'alerte dans l'état de la ligne précédente.

> [!WARNING]
> Supprimer une ligne réécrit l'historique de l'alerte et chaque mesure qui en a été tirée. Servez-vous-en pour corriger une erreur, pas pour faire du ménage.

## La liste Alertes actives

**Alertes → Alertes actives** contient chaque alerte dont l'état se situe au-dessus de votre état résolu, et rien d'autre n'en décide : ni la gravité, ni l'ancienneté, ni le fait que quelqu'un l'ait prise en compte. Le badge rouge à côté dans le menu latéral compte les mêmes alertes.

Un état à vous placé au-dessus de **Résolu** garde donc les alertes dans la liste, et un état placé en dessous les en retire, comme le fait la résolution. **Épisodes actifs** fonctionne de la même façon pour les épisodes.

## Étapes suivantes

:::cards
- [Vue d'ensemble des alertes](/docs/alerts/index): D'où viennent les alertes et comment votre équipe les traite.
- [Épisodes d'alertes et règles de regroupement](/docs/alerts/episodes): Comment l'état d'un épisode fait évoluer ses alertes.
- [Règles et paramètres des alertes](/docs/alerts/settings): Alerter et rappeler selon la gravité.
- [États et sévérités des incidents](/docs/incidents/states-and-severities): Le même cycle de vie, pour les incidents.
:::
