# Microsoft Teams

Connectez OneUptime à Microsoft Teams pour publier dans vos canaux et conversations les incidents, alertes, épisodes, maintenances planifiées, moniteurs et mises à jour d'astreinte, donner à chaque incident un canal à lui et laisser les intervenants agir depuis Teams : prendre en compte, résoudre, ajouter des notes, alerter l'astreinte, déclarer des incidents et interroger OneUptime AI.

:::cards
- [Connecter Microsoft Teams](#connecter-microsoft-teams): Le consentement administrateur, votre connexion et l'application dans chaque équipe.
- [Règles de notification](#règles-de-notification): Décidez quels événements sont publiés où, et lesquels ont un canal à eux.
- [Parler au bot OneUptime](#parler-au-bot-oneuptime): Commandes, questions et formulaires dans une conversation avec le bot.
- [Agir sur les incidents, alertes et événements depuis Microsoft Teams](#agir-sur-les-incidents-alertes-et-événements-depuis-microsoft-teams): Les boutons des cartes de OneUptime.
:::

## Fonctionnement

```mermaid title="D'un événement dans OneUptime à une carte dans Microsoft Teams"
flowchart TB
    event["Un incident, une alerte ou un événement<br/>est créé ou change"] --> rules{"Règles de notification<br/>dont les conditions correspondent"}
    rules -->|"Create Microsoft Teams Channel"| own["Un canal à lui<br/>dans l'équipe choisie"]
    rules -->|"Publier dans un canal<br/>ou une conversation existants"| existing["Vos canaux et conversations"]
    own --> card["Une carte avec des boutons"]
    existing --> card
    card -->|"Un intervenant en presse un"| change["Le changement est fait dans OneUptime,<br/>en son nom"]
```

Trois choses rendent cela possible :

- **La connexion du projet**, faite une fois : un administrateur Microsoft 365 consent à l'application OneUptime pour votre organisation.
- **L'application OneUptime dans chaque équipe** où vous voulez des notifications. Microsoft ne laisse le bot publier que dans une équipe à laquelle il a été ajouté.
- **La connexion propre à chaque personne** : son compte Microsoft Teams associé à son compte OneUptime. Les boutons, les commandes et les réactions agissent au nom de cette personne, avec ses autorisations dans le projet.

## Avant de commencer

- **Un rôle qui peut connecter le projet :** **Project Owner**, **Project Admin** ou **Project Member**. Désinstaller demande **Project Owner** ou **Project Admin**.
- **Un administrateur Microsoft 365** pour donner le consentement administrateur, une fois pour toute l'organisation.
- **Le plan Growth sur OneUptime Cloud** pour les règles de notification et les résumés. Voir [Règles de notification sous le plan Growth](#règles-de-notification-sous-le-plan-growth).
- **Sur un serveur auto-hébergé,** un bot Teams configuré pour lui au préalable. Voir [Intégration Microsoft Teams](/docs/self-hosted/microsoft-teams-integration).

## Connecter Microsoft Teams

:::steps
### Donner le consentement administrateur

Allez dans **Paramètres du projet** > **Espace de travail** > **Microsoft Teams** et cliquez sur **Accorder le consentement administrateur**. Un administrateur Microsoft 365 se connecte et autorise l'application OneUptime pour l'organisation. La carte indique alors **Consentement administrateur accordé**. Tant qu'aucun espace de travail n'est connecté, la section **Espace de travail** des menus Incidents, Alertes, Maintenance planifiée, Moniteurs et Astreinte contient **Connecter Slack ou Teams**, qui mène aussi ici.

### Connecter votre compte

Cliquez sur **Se connecter avec Microsoft Teams** et connectez-vous avec votre compte professionnel. OneUptime lit les équipes de votre organisation ; **Voir les équipes** les liste.

### Ajouter l'application OneUptime à chaque équipe (obligatoire)

Connecter votre compte ne suffit pas à lui seul. Microsoft ne laisse le bot OneUptime publier que dans une équipe à laquelle il a été ajouté ; faites donc ceci pour chaque équipe où vous voulez des notifications :

- Dans Microsoft Teams, cliquez sur le "..." à côté du **nom de l'équipe** (pas du nom du canal).
- Choisissez **Manage team** > **Apps** > **More apps**, trouvez **OneUptime** et cliquez sur **Add**.

Sur OneUptime Cloud, **Ouvrir la boutique Teams** ouvre l'application dans le Microsoft Teams Store, où **Add to a team** fait la même chose. Sur un serveur auto-hébergé, installez plutôt le paquet de **Télécharger le zip du manifeste de l'application** : lui seul porte le bot de votre serveur. Si une notification de test indique que l'application OneUptime n'est pas installée dans l'équipe, c'est cette étape qui a été oubliée.

### Connecter tous les autres

Chaque personne associe son propre compte Microsoft Teams dans **Paramètres utilisateur** > **Espace de travail** > **Microsoft Teams** avec **Connect my account with Microsoft Teams**, pour agir sur les incidents et recevoir des messages directs en son nom. Cette section apparaît dès que le projet est connecté à Microsoft Teams.

### Ajouter une règle de notification

Allez dans **Incidents** > **Espace de travail** > **Microsoft Teams**. La section **Espace de travail** ne liste que les espaces de discussion que votre projet a connectés, donc **Microsoft Teams** y apparaît dès qu'il est connecté. Créez une règle, par exemple une qui publie dans un canal Teams quand un incident est créé, puis cliquez sur **Tester la règle** sur sa ligne.
:::

> [!NOTE]
> Installer OneUptime pour vous-même, ou l'ajouter à une conversation, est une autre installation et ne lui permet pas de publier dans les canaux d'une équipe. Les **canaux privés** ont besoin de l'application dans le canal lui-même : ouvrez le canal > "..." > **Manage channel** > **Apps** > **Add an app**. Les **canaux partagés** ne peuvent pas recevoir de notifications : Microsoft Teams ne prend pas en charge les bots dans les canaux partagés.

## Règles de notification

Une règle de notification dit quels événements sont publiés dans Microsoft Teams, et où. Chaque produit a ses propres règles, sous **Espace de travail** > **Microsoft Teams** dans son menu :

| Produit | Onglets de sa page **Microsoft Teams** |
| --- | --- |
| **Incidents** | **Incidents**, **Épisodes d'incident**, **Summary** |
| **Alertes** | **Alertes**, **Épisodes d'alerte**, **Summary** |
| **Maintenance planifiée** | Une liste de règles |
| **Moniteurs** | Une liste de règles |
| **Astreinte** | Une liste de règles |

Créer une règle passe par quatre étapes :

| Étape | Ce que vous définissez |
| --- | --- |
| **Basique** | **Nom de la règle** et **Description de la règle**. |
| **Conditions** | Pour quels événements la règle se déclenche, par exemple selon la gravité, l'état, l'étiquette, le moniteur ou des mots du titre. Sans condition, elle se déclenche pour chaque événement. Avec deux ou plus, **Condition de correspondance** dit si toutes doivent correspondre, ou une seule. |
| **Destination** | Où elle publie : dans un canal existant d'une équipe choisie, dans les conversations choisies, dans un nouveau canal créé dans une équipe choisie, ou dans plusieurs d'entre eux à la fois. |
| **Appel vidéo** | Incidents et alertes uniquement : lancer un appel pour chacun. Voir [Appels vidéo](/docs/workspace-connections/video-calls). |

Un canal que la règle crée prend le nom de **New Microsoft Teams Channel Name** suivi du numéro de l'enregistrement, par exemple `oneuptime-incident-42`, et seul un canal créé reçoit les personnes que la règle invite. Un incident, une alerte ou un épisode privé reçoit un canal privé. Chaque mise à jour ultérieure de l'enregistrement — un changement d'état, une note, un nouveau propriétaire — est publiée dans ses canaux et conversations.

**Paramètres du projet** > **Espace de travail** > **Microsoft Teams** liste les canaux que OneUptime voit dans vos équipes, et les conversations auxquelles il a été ajouté, avec **Envoyer le test** à côté de chacun. Une conversation apparaît dès que l'application OneUptime y est ajoutée dans Microsoft Teams ; **Refresh Chats** récupère les nouvelles conversations et leurs noms actuels.

## Tester une règle

**Tester la règle** sur la ligne d'une règle publie un message de test pour cette règle dans les canaux qu'elle nomme, pour que vous le voyiez arriver. Si la règle crée un canal pour chaque événement, le test en crée un aussi et y invite les personnes de la règle.

Comme **Envoyer le test** à côté d'un canal dans **Paramètres du projet** > **Espace de travail** > **Microsoft Teams**, il demande l'autorisation de créer des règles de notification : **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member**, ou **Create Workspace Notification Rule** et **Read Workspace Notification Rule** dans un rôle personnalisé. Pour quelqu'un qui peut seulement voir les règles, comme un **Viewer**, **Tester la règle** est verrouillé, et son info-bulle dit ce qu'il faut ; l'API refuse son test avec "You do not have permission to send test notifications in this project." Sur OneUptime Cloud, tester une règle demande le plan **Growth**, comme en ajouter une.

Sur OneUptime Cloud, **Envoyer le test** à côté d'un canal ou d'une conversation demande aussi le plan **Growth**, car publier dans un canal est ce que font les règles et les résumés. **Envoyer un test maintenant** sur un résumé demande l'autorisation de créer des résumés (**Create Workspace Notification Summary** et **Read Workspace Notification Summary** dans un rôle personnalisé) et, sur OneUptime Cloud, le plan **Growth** ; pour tous les autres, il est verrouillé, et son info-bulle dit ce qu'il faut. Un client MCP connecté en lecture seule ne peut envoyer aucun test.

## Résumés

L'onglet **Summary** de **Incidents** > **Espace de travail** > **Microsoft Teams** (et des **Alertes**) publie un récapitulatif récurrent dans les canaux que vous nommez : combien d'incidents ou d'alertes il y a eu, à quelle vitesse ils ont été pris en compte et résolus, et une liste avec des liens. Un nouveau résumé part chaque semaine et couvre les 7 derniers jours. Laissez **Envoyer le premier rapport à** vide, et le premier part à 09:00 au début de la semaine, du jour ou du mois suivant ; le formulaire dit quand.

Un résumé part à l'heure de son **Fuseau horaire**, qui commence sur le vôtre. Il y garde son heure toute l'année : un résumé réglé sur 09:00 à Berlin part toujours à 09:00 à Berlin après le changement d'heure, et les dates de son message sont aussi celles de Berlin. Par l'API, envoyez `timezone` sous la forme d'un nom de fuseau horaire IANA, par exemple `Europe/Berlin`. Un résumé créé sans fuseau prend celui du profil de la personne qui l'a créé, ou UTC lorsqu'une clé d'API le crée.

Le formulaire d'un résumé a quatre étapes : **Informations de base** (son nom, les canaux et leur **Nom de l'équipe**), **Planification**, **Contenu** (**Quoi inclure**) et **Filtres** (quels incidents ou alertes il compte).

## Règles de notification sous le plan Growth

Sur OneUptime Cloud, les règles de notification et les résumés font partie du plan **Growth** et au-delà. Un projet en dessous garde les règles et les résumés qu'il a déjà, et ils continuent de publier dans Microsoft Teams. Ainsi, la page **Microsoft Teams** de chaque produit (Incidents, Alertes, Maintenance planifiée, Astreinte, Moniteurs) affiche la note de plan avec eux en dessous (**Règles de notification encore configurées**, **Résumés encore configurés**) : supprimez une règle, ou désactivez ou supprimez un résumé. Ajouter ou modifier des règles et des résumés demande **Growth**.

## Être alerté dans Microsoft Teams

Pour être alerté par message direct quand vous êtes d'astreinte, ajoutez Microsoft Teams parmi vos méthodes de notification :

:::steps
1. Connectez votre propre compte Microsoft Teams (voir [Connecter Microsoft Teams](#connecter-microsoft-teams)).
2. Allez dans **Paramètres utilisateur** > **Méthodes de notification**, ouvrez l'onglet **Workspace Apps** et cliquez sur **Ajouter un compte Microsoft Teams**.
3. Cliquez sur **Send Test Message** sur sa ligne. Le message arrive dans vos conversations Microsoft Teams.
:::

L'ajouter l'ajoute aussitôt à vos règles d'astreinte, si bien que les alertes vous atteignent dans Microsoft Teams dès lors. Changez les alertes qu'il reçoit dans **Paramètres utilisateur** > **Règles d'astreinte**.

## Enregistrer des messages comme notes

Réagissez à un message, ou à une réponse, dans le canal que OneUptime a créé pour un incident, une alerte, un épisode ou un événement de maintenance planifiée, et OneUptime l'enregistre comme note sur cet enregistrement. Il repère la réaction en moins d'une minute et le confirme par une réponse dans le fil :

| Réaction | Enregistré comme |
| --- | --- |
| 📌 ou 📍 | Une note privée, visible seulement par votre équipe |
| 📣 ou 📢 | Une note publique, affichée sur la page de statut. Incidents et événements de maintenance planifiée uniquement. |

La note est enregistrée en votre nom, avec vos autorisations, donc votre propre compte Microsoft Teams doit être connecté, et l'application OneUptime doit être dans l'équipe.

## Parler au bot OneUptime

Écrivez au bot dans une conversation personnelle, ou mentionnez OneUptime avec @ dans un canal ou une conversation de groupe : là, il ne répond que lorsqu'il est mentionné.

| Message | Ce que fait le bot |
| --- | --- |
| `help` | Liste ce qu'il sait faire. |
| `ask <question>`, ou toute question en langage courant | OneUptime AI répond sur vos journaux, traces, métriques, incidents et moniteurs, par exemple "Quels moniteurs sont en panne en ce moment ?". Les réponses ne font que lire. |
| `create incident [title]` | Ouvre le formulaire d'incident, avec le titre rempli. |
| `create maintenance [title]` | Ouvre le formulaire de maintenance planifiée, avec le titre rempli. |
| `show active incidents`, `show active alerts` | Liste ce qui est ouvert maintenant. |
| `show scheduled maintenance`, `show ongoing maintenance` | Liste les événements de maintenance à venir, ou en cours. |

Interroger OneUptime AI demande l'IA activée pour le projet. Voir [Demander à l'IA](/docs/ai/ask-ai).

## Créer des incidents et des maintenances depuis Microsoft Teams

Écrire `create incident` ou `create maintenance` au bot OneUptime ouvre un formulaire pour la personne qui l'a écrit, dans une conversation personnelle, un canal ou une conversation de groupe indifféremment. Il est rempli au nom de cette personne : en tant que compte OneUptime auquel son compte Microsoft Teams est connecté (voir [Connecter Microsoft Teams](#connecter-microsoft-teams)), avec les autorisations de ce compte dans le projet. Une personne dont le compte n'est pas connecté, ou dont le compte OneUptime n'est plus membre du projet, apprend quoi faire au lieu de recevoir le formulaire.

- **Qui peut les utiliser.** Les personnes qui peuvent déclarer un incident ou créer un événement de maintenance planifiée dans OneUptime : **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** et **Incident Member** pour un incident (**Create Incident** dans un rôle personnalisé), et **Scheduled Maintenance Admin** et **Scheduled Maintenance Member** pour un événement (**Create Scheduled Maintenance**). Tous les autres en sont informés, et ne reçoivent pas de formulaire.
- **Ce qu'un formulaire propose.** Chaque liste — gravités, moniteurs, états de moniteur, politiques d'astreinte et étiquettes — contient ce que la personne qui l'a demandé peut lire, comme la même liste dans OneUptime, et les notes "not shown" de la carte ne comptent que ceux-là : avec un rôle limité à certaines étiquettes, les moniteurs et politiques d'astreinte portant ces étiquettes. Une liste qu'elle ne peut pas lire du tout est retirée. Les politiques d'astreinte archivées ne sont jamais proposées.
- **Ce qu'un formulaire peut nommer.** Dans un canal ou une conversation de groupe, toute personne présente peut soumettre le formulaire, et il est soumis au nom de celle qui le fait, avec ses propres autorisations. L'incident ou l'événement est créé avec ces autorisations et attribué à cette personne. Un moniteur, une politique d'astreinte, une étiquette, une gravité ou un état qu'elle ne peut pas lire, ou qui appartient à un autre projet, est refusé comme un élément que le projet n'a pas, et rien n'est créé : le bot répond "One of the values you picked ... is not available in this project any more. Please pick it again."

**Execute On-Call Policy** sur un incident, une alerte ou un épisode fonctionne de la même façon : il demande l'autorisation d'exécuter une politique d'astreinte (**Project Owner**, **Project Admin**, **Project Member**, **On-Call Admin** et **On-Call Member**, ou **Create On-Call Duty Policy Execution Log** dans un rôle personnalisé) et de lire cet incident, cette alerte ou cet épisode, et propose les politiques d'astreinte actives que la personne peut lire. Consulter un moniteur ou une politique d'astreinte depuis une carte le lit aussi au nom de la personne qui a pressé le bouton.

## Agir sur les incidents, alertes et événements depuis Microsoft Teams

Les boutons des cartes de OneUptime agissent au nom de la personne qui les presse, dans une conversation personnelle, un canal ou une conversation de groupe indifféremment : en tant que compte OneUptime auquel son compte Microsoft Teams est connecté, avec les autorisations de ce compte dans le projet. **Acknowledge**, **Resolve**, **Change State**, **Add Note** et **Execute On-Call Policy** sur un incident, une alerte ou un épisode, et **Mark as Ongoing**, **Mark as Complete**, **Change State** et **Add Note** sur un événement de maintenance planifiée, font chacun le changement que la même action fait dans OneUptime, et il y est attribué à cette personne : la chronologie des états et le fil de l'enregistrement montrent qui a changé son état, et la note est la sienne. Une note enregistrée depuis un message avec une réaction est publiée de la même façon.

- **Qui peut les utiliser.** Les personnes qui peuvent faire le même changement dans OneUptime. Prendre en compte, résoudre ou changer l'état d'un incident demande l'autorisation de changer son état : **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** et **Incident Member**, ou **Create Incident State Timeline** dans un rôle personnalisé. Une alerte, un épisode ou un événement de maintenance planifiée demande la même autorisation pour son propre type (**Create Alert State Timeline**, par exemple), et une note demande l'autorisation de publier ce type de note. Comme le panneau d'état dans OneUptime, ils ne demandent pas l'autorisation de modifier l'incident ou l'alerte elle-même. Tous les autres en sont informés, et rien ne change.
- **Quels enregistrements.** Ceux que la personne peut lire, comme dans OneUptime : avec un rôle limité à certaines étiquettes, les incidents, alertes, épisodes et événements portant ces étiquettes. Un bouton sur tout autre enregistrement, ou sur un enregistrement d'un autre projet, reçoit pour réponse que l'enregistrement "was not found in this project, or you do not have access to it.", et rien ne change. Sur OneUptime Cloud, un changement que le plan du projet n'inclut pas est refusé avec le plan qu'il demande.
- **Ce que propose Change State.** Les états que la personne peut lire et vers lesquels l'enregistrement peut passer ensuite, dans l'ordre du projet : aucun avant l'état où il se trouve, pour un épisode comme pour un incident, une alerte ou un événement de maintenance planifiée, car un changement d'état ne fait jamais remonter un enregistrement dans sa liste (voir [L'ordre est une vraie contrainte, pas une préférence d'affichage](/docs/incidents/states-and-severities#lordre-est-une-vraie-contrainte-pas-une-préférence-daffichage)). Si elle n'en peut lire aucun, le bot dit "No incident states are available to you in this project. Ask a project admin for access to them." ; si l'enregistrement est dans le dernier état qu'il peut atteindre, il dit "There is no later state to move this incident to." Aucun des deux n'affiche une carte vide.
- **Escalate.** **Escalate** sur une carte exécute sa politique d'astreinte pour l'incident, l'alerte ou l'épisode dont parle la carte, au nom de la personne qui l'a pressé, avec les mêmes autorisations que **Execute On-Call Policy**. Une carte qui ne parle d'aucun d'eux reçoit pour réponse "This on-call policy can only be executed for an incident, an alert or an episode. Open the record you are paging about and use Execute On-Call Policy there.", et personne n'est alerté.

## Déconnecter

- **Déconnecter** ne dissocie que votre propre compte Microsoft Teams, et retire avec lui votre méthode de notification Microsoft Teams.
- **Uninstall OneUptime from Microsoft Teams**, dans **Paramètres du projet** > **Espace de travail** > **Microsoft Teams**, déconnecte le projet. OneUptime cesse de publier dans Microsoft Teams, et les menus **Espace de travail** cessent de le lister. Les règles de notification et les résumés sont conservés pour quand vous vous reconnectez.

> [!WARNING]
> Désinstaller dissocie aussi le compte Microsoft Teams de chaque membre du projet, et retire les méthodes de notification Microsoft Teams et les règles d'astreinte qui les utilisaient. Un projet est connecté à une seule organisation Microsoft 365 : pour le déplacer vers une autre, désinstallez d'abord.

## Dépannage

:::details Un test dit que l'application OneUptime n'est pas installée dans l'équipe
Microsoft a refusé la publication parce que le bot n'est pas dans cette équipe. Ajoutez l'application à l'équipe (voir [Connecter Microsoft Teams](#connecter-microsoft-teams)) ou, pour un canal privé, au canal lui-même. L'ajouter à une équipe ne fait rien pour les autres.
:::

:::details Microsoft Teams n'a pas été connecté
Quand Microsoft vous renvoie sans connexion, la page d'où vous êtes parti indique **Microsoft Teams n'a pas été connecté**, et une phrase dit pourquoi : il vous manque l'autorisation, le lien a déjà servi ou a expiré, vous vous êtes connecté à une autre organisation Microsoft 365, ou votre organisation n'a encore aucune équipe. Voir [La connexion n'a pas abouti](/docs/self-hosted/microsoft-teams-integration#la-connexion-na-pas-abouti) pour chaque phrase et ce qu'il faut faire.
:::

:::details Le bot dit que mon compte n'est pas connecté
Associez-le dans **Paramètres utilisateur** > **Espace de travail** > **Microsoft Teams** avec **Connect my account with Microsoft Teams**, connecté à l'organisation à laquelle le projet est connecté. Un compte invité d'une autre organisation n'est pas le même compte.
:::

:::details Toutes les notifications échouent sur un serveur auto-hébergé
L'application Teams installée dans vos équipes doit être le paquet que votre serveur a construit, et Microsoft doit pouvoir joindre le point de terminaison du bot de votre serveur. Voir le dépannage de l'[Intégration Microsoft Teams](/docs/self-hosted/microsoft-teams-integration#dépannage).
:::

## Étapes suivantes

:::cards
- [Slack](/docs/workspace-connections/slack): Les mêmes notifications et actions dans Slack.
- [Appels vidéo](/docs/workspace-connections/video-calls): Donnez à chaque incident un appel, publié avec ses mises à jour.
- [Intégration Microsoft Teams](/docs/self-hosted/microsoft-teams-integration): Configurer le bot Teams sur un serveur auto-hébergé.
- [Déclarer un incident](/docs/incidents/declaring-incidents): Toutes les façons dont un incident commence, et ce qui s'exécute alors.
:::
