# Microsoft Teams

Connectez OneUptime à Microsoft Teams pour publier dans vos canaux et conversations les incidents, alertes, épisodes, maintenances planifiées, moniteurs et mises à jour d'astreinte, donner à chaque incident un canal à lui et laisser les intervenants agir depuis Teams : prendre en compte, résoudre, ajouter des notes, alerter l'astreinte, déclarer des incidents et interroger OneUptime AI.

:::cards
- [Connecter Microsoft Teams](#connecter-microsoft-teams): Le consentement administrateur, votre connexion et l'application dans chaque équipe.
- [Demander à chacun de connecter son compte](#demander-à-chacun-de-connecter-son-compte): Écrivez en une seule fois à tous les membres qui n'ont pas encore connecté leur compte.
- [Règles de notification](#règles-de-notification): Décidez quels événements sont publiés où, et lesquels ont un canal à eux.
- [Parler au bot OneUptime](#parler-au-bot-oneuptime): Commandes, questions et formulaires dans une conversation avec le bot.
- [Balises d'astreinte](#balises-dastreinte): Alignez la balise d'une équipe sur les personnes d'astreinte, et alertez-la.
- [Agir sur les incidents, alertes et événements depuis Microsoft Teams](#agir-sur-les-incidents-alertes-et-événements-depuis-microsoft-teams): Les boutons des cartes de OneUptime.
:::

## Fonctionnement

```mermaid title="D'un événement dans OneUptime à une carte dans Microsoft Teams"
flowchart TB
    event["Un incident, une alerte ou un événement<br/>est créé ou change"] --> rules{"Règles de notification<br/>dont les conditions correspondent"}
    rules -->|"Un canal<br/>pour chacun"| own["Un canal à lui<br/>dans l'équipe choisie"]
    rules -->|"Publier dans un canal<br/>ou une conversation existants"| existing["Vos canaux et conversations"]
    own --> card["Une carte avec des boutons"]
    existing --> card
    card -->|"Un intervenant en presse un"| change["Le changement est fait dans OneUptime,<br/>en son nom"]
```

Trois choses rendent cela possible :

- **La connexion du projet**, faite une fois : un administrateur Microsoft 365 consent à l'application OneUptime pour votre organisation.
- **L'application OneUptime dans chaque équipe** où vous voulez des notifications. Microsoft ne laisse le bot publier que dans une équipe à laquelle il a été ajouté.
- **La connexion propre à chaque personne** : son compte Microsoft Teams associé à son compte OneUptime. Les boutons, les commandes et les réactions agissent au nom de cette personne, avec ses autorisations dans le projet.

Une organisation Microsoft 365 peut être connectée à plus d'un projet, par exemple la production et la préproduction. Le bouton d'une carte agit dans le projet pour lequel la carte a été envoyée, par exemple le projet de l'incident qu'elle concerne. Un message au bot agit dans le projet du canal où il est envoyé, par exemple le canal d'un incident, ou sinon dans le seul projet où le compte Microsoft Teams de son expéditeur est connecté. Quand rien ne permet de le savoir, le bot demande à la personne de quel projet il s'agit, avec un bouton pour chaque projet dont elle fait partie, et continue dans celui qu'elle choisit. Dans une conversation avec OneUptime AI, son choix vaut pour les questions de suivi, jusqu'à ce qu'une heure passe sans aucune.

## Avant de commencer

- **Un rôle qui peut connecter le projet :** **Propriétaire du projet**, **Administrateur du projet** ou **Membre du projet**. Désinstaller demande **Propriétaire du projet** ou **Administrateur du projet**.
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

Chaque personne associe son propre compte Microsoft Teams dans **Paramètres utilisateur** > **Espace de travail** > **Microsoft Teams** avec **Connect my account with Microsoft Teams**, pour agir sur les incidents et recevoir des messages directs en son nom. Cette section apparaît dès que le projet est connecté à Microsoft Teams. Pour faire venir toute une équipe d'un coup, voir [Demander à chacun de connecter son compte](#demander-à-chacun-de-connecter-son-compte).

### Ajouter une règle de notification

Allez dans **Incidents** > **Espace de travail** > **Microsoft Teams**. La section **Espace de travail** ne liste que les espaces de discussion que votre projet a connectés, donc **Microsoft Teams** y apparaît dès qu'il est connecté. Créez une règle, par exemple une qui publie dans un canal Teams quand un incident est créé, puis cliquez sur **Tester la règle** sur sa ligne.
:::

> [!NOTE]
> Installer OneUptime pour vous-même, ou l'ajouter à une conversation, est une autre installation et ne lui permet pas de publier dans les canaux d'une équipe. Les **canaux privés** ont besoin de l'application dans le canal lui-même : ouvrez le canal > "..." > **Manage channel** > **Apps** > **Add an app**. Les **canaux partagés** ne peuvent pas recevoir de notifications : Microsoft Teams ne prend pas en charge les bots dans les canaux partagés.

## Demander à chacun de connecter son compte

Personne ne peut connecter le compte Microsoft Teams de quelqu'un d'autre, pas même un administrateur : chacun se connecte avec son propre compte. Pour faire venir toute une équipe, un **Propriétaire du projet** ou un **Administrateur du projet** demande à tout le monde à la fois de connecter son compte, dans **Paramètres du projet** > **Espace de travail** > **Microsoft Teams**. La carte **Members' Microsoft Teams accounts** indique combien de membres ont connecté leur compte. Avec **Ask everyone to connect**, le bot OneUptime envoie un message à chaque membre qui ne l'a pas encore fait, avec un bouton **Connect Microsoft Teams account** qui connecte son compte en un clic.

- **Qui reçoit un message.** Chaque membre du projet qui n'a pas connecté son compte Microsoft Teams et qui fait partie d'une équipe à laquelle l'application OneUptime a été ajoutée, retrouvé là par son adresse e-mail ou son nom d'utilisateur principal. Quiconque a été sollicité dans les dernières 24 heures ne l'est pas de nouveau : redemander le lendemain ne relance donc que les personnes qui n'ont toujours pas connecté leur compte.
- **Ce que dit la carte.** Où en sont les messages pendant leur envoi, puis qui a fait la demande et combien de membres ont reçu un message. Les membres que OneUptime n'a pas trouvés sont nommés sur la carte : ajoutez l'application à leur équipe, ou demandez-leur de connecter eux-mêmes leur compte dans **Paramètres utilisateur** > **Espace de travail** > **Microsoft Teams**.
- **Ce que connecte le bouton.** Le compte Microsoft Teams de la personne qui le presse et se connecte, à son propre compte OneUptime. Transmis à quelqu'un d'autre, le message ne connecte rien au membre à qui il était destiné.

## Règles de notification

Une règle de notification dit quels événements sont publiés dans Microsoft Teams, et où. Chaque produit a ses propres règles, sous **Espace de travail** > **Microsoft Teams** dans son menu :

| Produit | Onglets de sa page **Microsoft Teams** |
| --- | --- |
| **Incidents** | **Incidents**, **Épisodes d'incident**, **Résumé** |
| **Alertes** | **Alertes**, **Épisodes d'alerte**, **Résumé** |
| **Maintenance planifiée** | Une liste de règles |
| **Moniteurs** | Une liste de règles |
| **Astreinte** | Une liste de règles |

Créer une règle passe par quatre étapes :

| Étape | Ce que vous définissez |
| --- | --- |
| **Basique** | **Nom de la règle** et **Description de la règle**. |
| **Conditions** | Pour quels événements est la règle, par exemple selon la gravité, l'état, l'étiquette, le moniteur ou des mots du titre. Elles sont vérifiées à la création d'un événement, puis à chaque mise à jour que OneUptime publie à son sujet : une règle pour les incidents pris en compte agit donc quand un incident est pris en compte. Une nouvelle règle est pour chaque événement, par exemple **Tous les incidents**. Pour la restreindre, choisissez **Uniquement les incidents qui correspondent aux conditions** et ajoutez les conditions. Avec deux ou plus, **Condition de correspondance** dit si toutes doivent correspondre, ou une seule. |
| **Destination** | Où elle publie : dans un canal existant d'une équipe choisie, dans les conversations choisies, dans un canal pour chaque incident (ou alerte, épisode, événement, moniteur ou politique d'astreinte) créé dans une équipe choisie, ou dans plusieurs d'entre eux à la fois. Sous l'étape, **Ce que fait cette règle** le dit en phrases, comme la carte de la règle. |
| **Appel vidéo** | Incidents et alertes uniquement : lancer un appel pour chacun. Voir [Appels vidéo](/docs/workspace-connections/video-calls). |

Un canal que la règle crée porte le nom de son enregistrement : l'incident INC-42 reçoit `inc-42`, l'alerte ALT-7 reçoit `alt-7`, et dans un projet sans préfixes de numéro, l'incident 42 reçoit `incident-42`. Le texte de **Préfixe du nom de canal** se place devant, donc `prod-` donne `prod-inc-42`, et le formulaire montre le nom pendant que vous tapez. Pour un événement de maintenance planifiée, le préfixe remplace son préfixe de numéro : SM-5 reçoit `sm-5`, et `maint-` donne `maint-5`. OneUptime conserve les lettres, les chiffres, les espaces, `-` et `_`, jusqu'aux 50 caractères qu'accepte Microsoft Teams. Si l'équipe a déjà un canal de ce nom, par exemple celui d'un autre projet ou un canal supprimé ces 30 derniers jours, OneUptime ajoute `-2`, `-3` et ainsi de suite.

Une règle crée son canal la première fois qu'un événement lui correspond : à la création de l'événement, ou plus tard, quand une mise à jour le fait correspondre alors qu'il est encore ouvert. Une règle pour les incidents pris en compte crée le canal quand l'incident est pris en compte. Microsoft Teams affiche les canaux d'une équipe à tous ses membres, donc OneUptime n'ajoute personne à un canal un par un : tous les membres de l'équipe choisie peuvent l'ouvrir, comme le formulaire de la règle le dit sous **Qui rejoint le canal**. Un incident, une alerte ou un épisode privé reçoit un canal privé, que seuls ses membres voient ; ajoutez-y des personnes dans Microsoft Teams.

Pour faire venir les personnes d'astreinte, choisissez leurs plannings d'astreinte sous **Mentionner les personnes d'astreinte**. À la création du canal, OneUptime y publie un message, juste après le premier message de l'enregistrement, qui mentionne avec @ les personnes d'astreinte dans ces plannings, pour que Microsoft Teams les notifie. Personne n'est alerté. OneUptime trouve chaque personne de l'équipe par le compte Microsoft Teams qu'elle a connecté à OneUptime, ou sinon par son adresse e-mail. Une personne qui n'est pas dans l'équipe ne peut pas ouvrir ses canaux, elle est donc nommée dans le message à la place, avec la raison. Dans un canal privé, seuls ses membres peuvent l'ouvrir ; ajoutez-y donc les personnes d'astreinte dans Microsoft Teams.

Chaque mise à jour ultérieure de l'enregistrement — un changement d'état, une note, un nouveau propriétaire — est publiée dans ses canaux, et dans les canaux et conversations existants que ses règles nomment tant que leurs conditions correspondent. OneUptime ne peut pas archiver un canal Microsoft Teams, donc le canal d'une règle reste quand son enregistrement est terminé ; archivez-le ou supprimez-le dans Microsoft Teams.

Un incident, une alerte, un épisode ou un événement de maintenance planifiée qui a son propre canal affiche **Ouvrir dans Microsoft Teams** dans l'en-tête de sa page dans OneUptime, à côté de ses boutons d'état. Ce bouton ouvre ce canal dans un nouvel onglet, dans l'application Microsoft Teams ou dans le navigateur. Un enregistrement qui a deux canaux à lui les liste tous les deux sous le bouton. Un enregistrement qui a des canaux à la fois dans Slack et dans Microsoft Teams a à la place un seul bouton **Ouvrir le canal**, qui les liste tous. Les canaux et conversations existants où vos règles publient ne sont pas proposés.

La page de l'enregistrement a aussi une carte **Canal Microsoft Teams**, qui dit qui peut ouvrir le canal : tout le monde dans l'équipe ou, pour un canal privé, ses membres, que ses propriétaires ajoutent dans Microsoft Teams. OneUptime ne change pas qui est dans un canal Microsoft Teams. Pour un canal Slack, la carte liste qui s'y trouve et ajoute des personnes : voir [Qui est dans le canal d'un enregistrement](/docs/workspace-connections/slack#qui-est-dans-le-canal-dun-enregistrement).

Les canaux et les conversations restent lisibles : chaque événement est publié une seule fois, et le premier état d'un enregistrement figure dans la carte qui annonce l'enregistrement, pas dans une carte à part. Une exécution d'une politique d'astreinte est une seule carte, modifiée au fil de l'escalade : qui a été alerté, combien de fois et comment, qui ne l'a pas été et pourquoi, et qui l'a pris en compte. Une nouvelle carte n'est publiée que lorsque quelqu'un doit agir : une règle d'escalade n'a atteint personne, ou l'exécution s'est terminée sans que personne ne le prenne en compte. Le fait que les propriétaires de l'enregistrement ou les abonnés de la page de statut ont été prévenus reste dans son fil d'activité dans OneUptime.

**Paramètres du projet** > **Espace de travail** > **Microsoft Teams** liste les canaux que OneUptime voit dans vos équipes, et les conversations auxquelles il a été ajouté, avec **Envoyer le test** à côté de chacun. Une conversation apparaît dès que l'application OneUptime y est ajoutée dans Microsoft Teams ; **Refresh Chats** récupère les nouvelles conversations et leurs noms actuels.

## Tester une règle

**Tester la règle** sur la ligne d'une règle publie un message de test pour cette règle dans les canaux qu'elle nomme, pour que vous le voyiez arriver. Si la règle crée un canal pour chaque événement, le test en crée un aussi et y invite les personnes de la règle.

Comme **Envoyer le test** à côté d'un canal dans **Paramètres du projet** > **Espace de travail** > **Microsoft Teams**, il demande l'autorisation de créer des règles de notification : **Propriétaire du projet**, **Administrateur du projet**, **Membre du projet**, **Administrateur des paramètres**, **Membre des paramètres**, ou **Create Workspace Notification Rule** et **Read Workspace Notification Rule** dans un rôle personnalisé. Pour quelqu'un qui peut seulement voir les règles, comme un **Lecteur**, **Tester la règle** est verrouillé, et son info-bulle dit ce qu'il faut ; l'API refuse son test avec "You do not have permission to send test notifications in this project." Sur OneUptime Cloud, tester une règle demande le plan **Growth**, comme en ajouter une.

Sur OneUptime Cloud, **Envoyer le test** à côté d'un canal ou d'une conversation demande aussi le plan **Growth**, car publier dans un canal est ce que font les règles et les résumés. **Envoyer un test maintenant** sur un résumé demande l'autorisation de créer des résumés (**Create Workspace Notification Summary** et **Read Workspace Notification Summary** dans un rôle personnalisé) et, sur OneUptime Cloud, le plan **Growth** ; pour tous les autres, il est verrouillé, et son info-bulle dit ce qu'il faut. Un client MCP connecté en lecture seule ne peut envoyer aucun test.

## Résumés

L'onglet **Résumé** de **Incidents** > **Espace de travail** > **Microsoft Teams** (et des **Alertes**) publie un récapitulatif récurrent dans les canaux que vous nommez : combien d'incidents ou d'alertes il y a eu, à quelle vitesse ils ont été pris en compte et résolus, et une liste avec des liens. Un nouveau résumé part chaque semaine et couvre les 7 derniers jours. Laissez **Envoyer le premier rapport à** vide, et le premier part à 09:00 au début de la semaine, du jour ou du mois suivant ; le formulaire dit quand.

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
| 📣 ou 📢 | Une note publique, affichée sur la page de statut. Incidents et événements de maintenance planifiée uniquement. Sur un incident privé, une note privée, et la confirmation dit pourquoi. |

La note reprend le message tel que Microsoft Teams l'affichait : sa mise en forme, ses liens et son code, les personnes qu'il mentionne par leur nom, et ses fichiers et images sous forme de liens. Une note publique laisse de côté les fichiers et les images, puisqu'ils ne s'ouvrent que pour votre équipe.

Ce sont les mots de la personne qui a écrit le message : son nom dans OneUptime quand son compte Microsoft Teams est connecté, sinon le nom qu'affiche Teams. Une note privée est placée dans la chronologie au moment où le message a été publié, même si elle est enregistrée bien plus tard. Une note publique est placée au moment où elle est enregistrée, c'est-à-dire quand la page de statut l'affiche. La chronologie indique qui l'a enregistrée. La note n'est pas republiée dans le canal, où le message se trouve déjà.

La note est enregistrée en votre nom, avec vos autorisations, et l'application OneUptime doit être dans l'équipe. Si votre compte Microsoft Teams n'est pas encore connecté, OneUptime vous demande de le connecter, dans une réponse qui vous mentionne, avec un bouton qui enregistre le message dès que c'est fait.

## Parler au bot OneUptime

Écrivez au bot dans une conversation personnelle, ou mentionnez OneUptime avec @ dans un canal ou une conversation de groupe : là, il ne répond que lorsqu'il est mentionné.

| Message | Ce que fait le bot |
| --- | --- |
| `help` | Liste ce qu'il sait faire. |
| `incident [title or number]` | Ouvre le formulaire d'incident, avec le titre rempli. Le numéro d'un incident, comme `42` ou `INC-42`, affiche plutôt cet incident : voir [Gérer un incident depuis Microsoft Teams](#gérer-un-incident-depuis-microsoft-teams). |
| `maintenance [title]` | Ouvre le formulaire de maintenance planifiée, avec le titre rempli. |
| `oncall` | Liste qui est d'astreinte en ce moment dans chaque planning d'astreinte que vous pouvez voir, jusqu'à quand, et qui est le suivant. |
| `page [who] [message]` | Alerte les personnes que vous mentionnez avec @ au sujet de votre message, ou envoie une carte pour choisir qui alerter. Voir [Alerter quelqu'un depuis Microsoft Teams](#alerter-quelquun-depuis-microsoft-teams). |
| `ask [question]`, ou toute question en langage courant | OneUptime AI répond sur vos journaux, traces, métriques, incidents et moniteurs, par exemple "Quels moniteurs sont en panne en ce moment ?". Les réponses ne font que lire. |
| `show active incidents`, `show active alerts` | Liste ce qui est ouvert maintenant. |
| `show scheduled maintenance`, `show ongoing maintenance` | Liste les événements de maintenance à venir, ou en cours. |

Hormis les listes `show`, ce sont les mots qui suivent `/oneuptime` dans Slack ; `create incident` et `create maintenance` fonctionnent toujours. Interroger OneUptime AI demande votre propre compte Microsoft Teams connecté, et l'IA activée pour le projet. Si le vôtre n'est pas connecté, le bot vous demande une fois par fil ou par conversation de le connecter, avec un bouton **Connect Microsoft Teams account**. Voir [Demander à l'IA](/docs/ai/ask-ai).

## Votre accueil dans Microsoft Teams

Écrivez `home` au bot OneUptime, et il répond avec votre accueil : une carte qui montre ce qui se passe dans le projet, tel que vous pouvez le voir.

- **Votre astreinte.** Les plannings d'astreinte dans lesquels vous êtes d'astreinte en ce moment, et jusqu'à quand, ou sinon votre prochain créneau.
- **Ce qui est ouvert.** Les incidents et alertes ouverts les plus récents que vous pouvez lire, chacun avec un lien vers sa page dans OneUptime.
- **Ses boutons.** **Declare incident** et **Page someone** répondent comme `incident` et `page`, **Who's on call** comme `oncall`, et **Refresh** relit la carte, à sa place.

Quand vous ajoutez l'application OneUptime pour vous-même, le bot vous envoie aussitôt votre accueil. L'accueil et les listes `show` lisent en votre nom, il leur faut donc votre propre compte Microsoft Teams connecté : tant qu'il ne l'est pas, le bot répond avec un bouton **Connect Microsoft Teams account**. **Ouvrir OneUptime dans Microsoft Teams**, sous **Paramètres utilisateur** > **Espace de travail** > **Microsoft Teams**, ouvre l'application dans Teams.

Quand l'application est ajoutée à une équipe, le bot y dit bonjour : comment lui poser une question, et où ajouter une règle de notification qui publie dans les canaux de l'équipe.

## Créer des incidents et des maintenances depuis Microsoft Teams

Écrire `incident` ou `maintenance` au bot OneUptime ouvre un formulaire pour la personne qui l'a écrit, dans une conversation personnelle, un canal ou une conversation de groupe indifféremment. Il est rempli au nom de cette personne : en tant que compte OneUptime auquel son compte Microsoft Teams est connecté (voir [Connecter Microsoft Teams](#connecter-microsoft-teams)), avec les autorisations de ce compte dans le projet. Une personne dont le compte n'est pas connecté, ou dont le compte OneUptime n'est plus membre du projet, apprend quoi faire dans une réponse qui la mentionne, au lieu de recevoir le formulaire.

- **Qui peut les utiliser.** Les personnes qui peuvent déclarer un incident ou créer un événement de maintenance planifiée dans OneUptime : **Propriétaire du projet**, **Administrateur du projet**, **Membre du projet**, **Administrateur des incidents** et **Membre des incidents** pour un incident (**Create Incident** dans un rôle personnalisé), et **Administrateur de la maintenance planifiée** et **Membre de la maintenance planifiée** pour un événement (**Create Scheduled Maintenance**). Tous les autres en sont informés, et ne reçoivent pas de formulaire.
- **Ce qu'un formulaire propose.** Chaque liste — gravités, moniteurs, états de moniteur, politiques d'astreinte et étiquettes — contient ce que la personne qui l'a demandé peut lire, comme la même liste dans OneUptime, et les notes "not shown" de la carte ne comptent que ceux-là : avec un rôle limité à certaines étiquettes, les moniteurs et politiques d'astreinte portant ces étiquettes. Une liste qu'elle ne peut pas lire du tout est retirée. Les politiques d'astreinte archivées ne sont jamais proposées.
- **Ce qu'un formulaire peut nommer.** Dans un canal ou une conversation de groupe, toute personne présente peut soumettre le formulaire, et il est soumis au nom de celle qui le fait, avec ses propres autorisations. L'incident ou l'événement est créé avec ces autorisations et attribué à cette personne. Un moniteur, une politique d'astreinte, une étiquette, une gravité ou un état qu'elle ne peut pas lire, ou qui appartient à un autre projet, est refusé comme un élément que le projet n'a pas, et rien n'est créé : le bot répond "One of the values you picked ... is not available in this project any more. Please pick it again."

**Execute On-Call Policy** sur un incident, une alerte ou un épisode fonctionne de la même façon : il demande l'autorisation d'exécuter une politique d'astreinte (**Propriétaire du projet**, **Administrateur du projet**, **Membre du projet**, **Administrateur des astreintes** et **Membre des astreintes**, ou **Create On-Call Duty Policy Execution Log** dans un rôle personnalisé) et de lire cet incident, cette alerte ou cet épisode, et propose les politiques d'astreinte actives que la personne peut lire. Consulter un moniteur ou une politique d'astreinte depuis une carte le lit aussi au nom de la personne qui a pressé le bouton.

## Alerter quelqu'un depuis Microsoft Teams

Dans un canal ou une conversation de groupe, `@OneUptime page @Nawaz Dhandala The checkout API is throwing 500s` alerte Nawaz immédiatement. OneUptime crée une alerte dont le titre est votre message, et chaque personne que vous mentionnez avec @ reçoit un appel téléphonique, un SMS, une notification push ou un e-mail, selon ses propres règles d'astreinte, jusqu'à ce que quelqu'un accuse réception de l'alerte.

- **Qui est alerté immédiatement.** Les personnes que vous mentionnez avec @, et les personnes d'astreinte dans les plannings que suit une balise que vous mentionnez avec @ (voir [Balises d'astreinte](#balises-dastreinte)), quand un message les suit. OneUptime reconnaît une personne au compte OneUptime auquel son compte Microsoft Teams est connecté, ou sinon à son adresse e-mail dans Microsoft Teams. Personne en dehors du projet n'est alerté.
- **Tout le reste reçoit une carte.** Sans personne mentionnée avec @, comme dans une conversation personnelle avec le bot, sans message, avec une balise qui ne suit aucun planning d'astreinte que vous pouvez voir, ou avec une personne que OneUptime ne reconnaît pas, le bot répond avec la carte **Page someone**, où ce que vous avez tapé est déjà rempli, et indique qui il n'a pas pu choisir. Choisissez des personnes, une équipe, un planning d'astreinte, qui alerte la personne d'astreinte dans ce planning en ce moment, ou une politique d'astreinte, qui alerte selon ses règles d'escalade, puis soumettez-la. Toute personne de la conversation peut soumettre la carte, en son propre nom. Une fois l'alerte envoyée, la carte est retirée, pour que personne n'alerte deux fois avec elle.
- **Où cela s'affiche.** La conversation en affiche le suivi comme une seule carte, tenue à jour : qui a été alerté et comment, et qui a accusé réception. Là où le bot ne peut pas la publier, sa réponse indique qui a été alerté, avec un lien vers l'alerte.
- **Qui peut alerter.** Toute personne qui peut à la fois exécuter une politique d'astreinte et créer une alerte : **Propriétaire du projet**, **Administrateur du projet** et **Membre du projet**, ou **Membre des astreintes** avec **Membre des alertes** (**Create On-Call Duty Policy Execution Log** et **Create Alert** dans un rôle personnalisé). Alerter directement des personnes, une équipe ou un planning, sans politique d'astreinte derrière l'alerte, demande aussi l'accès à toutes les politiques d'astreinte du projet. Tous les autres en sont informés dans une réponse, et personne n'est alerté. Sur OneUptime Cloud, alerter demande le plan Growth : en dessous, OneUptime indique le plan nécessaire, et personne n'est alerté.

## Balises d'astreinte

Alignez une balise Microsoft Teams, comme `@Payments on-call`, sur les personnes d'astreinte dans un ou plusieurs plannings d'astreinte, pour que chacun dans son équipe puisse la mentionner avec @ afin de les joindre. OneUptime modifie les membres de la balise à chaque passation et à chaque remplacement, et la vérifie toutes les 15 minutes.

:::steps
### Connecter une balise à un planning

Ouvrez le planning dans **Astreinte** > **Plannings d'astreinte**. Dans sa carte **Balises Microsoft Teams**, cliquez sur **Connecter une balise**, choisissez l'équipe, puis nommez la balise : la balise de l'équipe portant ce nom, ou une nouvelle que OneUptime crée. Ses membres sont aussitôt remplacés par les personnes d'astreinte.

### La connecter aussi au planning secondaire

Pour une balise qui contient l'astreinte principale et l'astreinte secondaire, connectez la même balise sur la page du planning secondaire. Une balise peut suivre autant de plannings que vous voulez.
:::

- **Ce que montre la carte.** Qui est dans chaque balise en ce moment, son équipe, les autres plannings qu'elle suit, et si elle est **À jour**. Une balise ne contient que des membres de son équipe : une personne d'astreinte qui n'est pas dans l'équipe est nommée, avec la raison.
- **Personne d'astreinte.** OneUptime retire tout le monde de la balise jusqu'à ce que quelqu'un soit d'astreinte. Une nouvelle balise a besoin de quelqu'un de l'équipe d'astreinte, car Microsoft Teams ne crée pas de balise vide.
- **L'alerter.** `@OneUptime page @Payments on-call The checkout API is down` alerte les personnes d'astreinte dans les plannings que suit la balise. Voir [Alerter quelqu'un depuis Microsoft Teams](#alerter-quelquun-depuis-microsoft-teams).
- **Ce dont Microsoft 365 a besoin.** Modifier les balises demande l'autorisation `TeamworkTag.ReadWrite.All` de l'application, qu'un administrateur Microsoft 365 accorde avec **Accorder le consentement administrateur** dans **Paramètres du projet** > **Espace de travail** > **Microsoft Teams**. Si votre organisation a donné son consentement avant que OneUptime puisse tenir des balises à jour, donnez-le une fois de plus.
- **Qui peut en connecter une.** Les rôles qui peuvent modifier les plannings : **Propriétaire du projet**, **Administrateur du projet**, **Membre du projet**, **Administrateur des astreintes** et **Membre des astreintes**, ou **Edit On-Call Duty Policy Schedule** dans un rôle personnalisé. Sur OneUptime Cloud, en connecter une nécessite la formule **Growth**.
- **Déconnecter.** OneUptime cesse de modifier la balise. La balise et ses membres restent dans Microsoft Teams tels quels.

## Gérer un incident depuis Microsoft Teams

La carte d'un incident a quatre boutons, **Acknowledge Incident**, **Resolve Incident**, **Add Note** et **View Incident**, et le reste dans son menu, le bouton à trois points :

| Élément du menu | Ce qu'il fait |
| --- | --- |
| **Change Severity** | Définit la gravité de l'incident. |
| **Change Incident State** | Fait passer l'incident à un état suivant. |
| **Assign Role** | Donne à quelqu'un un rôle sur l'incident, comme **Incident Commander**. Un rôle réservé à une seule personne lui revient. |
| **Page Someone** | Alerte des personnes, une équipe, la personne d'astreinte dans un planning, ou une politique d'astreinte au sujet de l'incident, jusqu'à ce que quelqu'un en accuse réception. |
| **Edit Custom Fields** | Définit les champs personnalisés de l'incident, chacun rempli avec ce que contient l'incident. Un champ laissé vide est effacé. |

`incident 42`, écrit au bot, répond avec l'incident 42, ces boutons et son menu. Tapez le numéro tel que OneUptime l'affiche : `42`, `#42` ou `INC-42`. Dans le canal propre à un incident, `incident` seul affiche cet incident.

- **Qui peut les utiliser.** Les personnes qui peuvent faire le même changement dans OneUptime, comme dans Slack : voir [Gérer un incident depuis Slack](/docs/workspace-connections/slack#gérer-un-incident-depuis-slack). Chaque élément répond avec une carte, remplie selon ce que la personne qui l'a pressé peut voir de l'incident. Toute personne de la conversation peut soumettre la carte, en son propre nom, avec ses propres autorisations.
- **Ce qui se passe.** Le changement est fait au nom de la personne qui a soumis la carte, comme dans OneUptime, et le fil de l'incident dit ce qui a changé. Le bot le dit dans une réponse qui la mentionne, et retire la carte, pour que personne ne la soumette deux fois. **Page Someone** indique qui a été alerté, ou pourquoi personne ne l'a été ; un incident déjà résolu n'alerte personne.
- **Ce qui diffère dans Microsoft Teams.** Une carte ne peut pas indiquer sous un champ ce qui ne va pas : une valeur qui ne convient pas est signalée dans une réponse, et la carte reste pour être corrigée et soumise à nouveau. Un champ de date et d'heure est un jour et une heure, dans votre propre fuseau horaire. Un ancien client Teams affiche le menu comme des boutons supplémentaires. `incident 42` répond dans la conversation, où tous ceux qui y sont peuvent voir l'incident.
- **Cartes publiées avant le menu.** Elles gardent leur bouton **Execute On-Call Policy**, qui fonctionne toujours : **Page Someone** alerte aussi une politique d'astreinte. Les alertes et les épisodes gardent le leur.

## Agir sur les incidents, alertes et événements depuis Microsoft Teams

Les boutons des cartes de OneUptime agissent au nom de la personne qui les presse, dans une conversation personnelle, un canal ou une conversation de groupe indifféremment : en tant que compte OneUptime auquel son compte Microsoft Teams est connecté, avec les autorisations de ce compte dans le projet. **Acknowledge**, **Resolve**, **Change State**, **Add Note** et **Execute On-Call Policy** sur un incident, une alerte ou un épisode, et **Mark as Ongoing**, **Mark as Complete**, **Change State** et **Add Note** sur un événement de maintenance planifiée, font chacun le changement que la même action fait dans OneUptime, et il y est attribué à cette personne : la chronologie des états et le fil de l'enregistrement montrent qui a changé son état, et la note est la sienne. Une note enregistrée depuis un message avec une réaction est publiée de la même façon.

- **Qui peut les utiliser.** Les personnes qui peuvent faire le même changement dans OneUptime. Prendre en compte, résoudre ou changer l'état d'un incident demande l'autorisation de changer son état : **Propriétaire du projet**, **Administrateur du projet**, **Membre du projet**, **Administrateur des incidents** et **Membre des incidents**, ou **Create Incident State Timeline** dans un rôle personnalisé. Une alerte, un épisode ou un événement de maintenance planifiée demande la même autorisation pour son propre type (**Create Alert State Timeline**, par exemple), et une note demande l'autorisation de publier ce type de note. Comme le panneau d'état dans OneUptime, ils ne demandent pas l'autorisation de modifier l'incident ou l'alerte elle-même. Tous les autres en sont informés, et rien ne change.
- **Quels enregistrements.** Ceux que la personne peut lire, comme dans OneUptime : avec un rôle limité à certaines étiquettes, les incidents, alertes, épisodes et événements portant ces étiquettes. Un bouton sur tout autre enregistrement dit pourquoi, et rien ne change : sur un incident que son rôle n'atteint pas, "your access in this project does not include this incident. Ask a project admin for access to it." ; sur un incident privé dont elle n'est pas propriétaire, "this incident is private, so only its owners and the project's owners and admins can see it. Ask one of them to add you as an owner." ; et sur un incident supprimé depuis, "the incident was not found. It may have been deleted." Sur OneUptime Cloud, un changement que le plan du projet n'inclut pas est refusé avec le plan qu'il demande.
- **Ce que propose Change State.** Les états que la personne peut lire et vers lesquels l'enregistrement peut passer ensuite, dans l'ordre du projet : aucun avant l'état où il se trouve, pour un épisode comme pour un incident, une alerte ou un événement de maintenance planifiée, car un changement d'état ne fait jamais remonter un enregistrement dans sa liste (voir [L'ordre est une vraie contrainte, pas une préférence d'affichage](/docs/incidents/states-and-severities#lordre-est-une-vraie-contrainte-pas-une-préférence-daffichage)). Si elle n'en peut lire aucun, le bot dit "No incident states are available to you in this project. Ask a project admin for access to them." ; si l'enregistrement est dans le dernier état qu'il peut atteindre, il dit "There is no later state to move this incident to." Aucun des deux n'affiche une carte vide.
- **Add Note sur un incident privé.** Un incident privé n'accepte aucune note publique : sa carte ne demande donc pas de type de note et ajoute une note privée. Une carte envoyée avant qu'il devienne privé ajoute elle aussi une note privée, et le dit. Voir [Les incidents privés n'acceptent que des notes privées](/docs/incidents/notes-owners-and-feed#les-incidents-privés-nacceptent-que-des-notes-privées).
- **Escalate.** **Escalate** sur une carte exécute sa politique d'astreinte pour l'incident, l'alerte ou l'épisode dont parle la carte, au nom de la personne qui l'a pressé, avec les mêmes autorisations que **Execute On-Call Policy**. Une carte qui ne parle d'aucun d'eux reçoit pour réponse "This on-call policy can only be executed for an incident, an alert or an episode. Open the record you are paging about and use Execute On-Call Policy there.", et personne n'est alerté.
- **Où la personne reçoit la réponse.** Dans une réponse dans la même conversation, le fil de la carte dans un canal, qui la mentionne, pour que Microsoft Teams la prévienne. Un bouton pressé trop tard dit qui est passé avant, et quand, par exemple "Incident INC-2 was already acknowledged by Simon Lee at 6:07 PM."
- **Si son compte n'est pas connecté.** La réponse lui demande de le connecter, avec un bouton **Connect Microsoft Teams account**. Le bouton ouvre ses propres paramètres Microsoft Teams dans OneUptime et connecte son compte en une étape, après une connexion à OneUptime si besoin. OneUptime termine ensuite ce qu'elle a pressé, en son nom, et répond dans la même conversation ; pour un bouton qui ouvre un formulaire, ou une commande, il lui demande de le presser ou de la taper à nouveau. Le bouton fonctionne une fois, pendant 30 minutes, et seulement pour le compte Microsoft qui l'a pressé.

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
Pressez **Connect Microsoft Teams account** dans la réponse du bot pour le connecter en une étape, ou associez-le dans **Paramètres utilisateur** > **Espace de travail** > **Microsoft Teams** avec **Connect my account with Microsoft Teams**. Dans les deux cas, vous vous connectez à l'organisation à laquelle le projet est connecté, en tant qu'invité si vous y êtes invité. Si vous êtes invité et avez déjà connecté le compte de votre propre organisation, connectez-le à nouveau.
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
