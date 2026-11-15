# Mattermost

Connectez OneUptime à votre serveur Mattermost pour publier dans vos canaux les incidents, alertes, épisodes, maintenances planifiées, moniteurs et mises à jour d'astreinte, donner à chaque incident un canal à lui et laisser les intervenants prendre en compte, résoudre, ajouter des notes et changer l'état sans quitter Mattermost.

:::cards
- [Connecter Mattermost](#connecter-mattermost): Créez un compte bot pour OneUptime, puis connectez le projet avec son jeton.
- [Connecter votre propre compte](#connecter-votre-propre-compte-mattermost): Associez votre compte Mattermost à votre compte OneUptime.
- [Règles de notification](#règles-de-notification): Décidez quels événements sont publiés où, et lesquels ont un canal à eux.
- [Qui est dans le canal d'un enregistrement](#qui-est-dans-le-canal-dun-enregistrement): Voyez qui s'y trouve, rejoignez-le et ajoutez des personnes, depuis la page de l'enregistrement.
- [Agir depuis Mattermost](#agir-sur-les-incidents-alertes-et-événements-depuis-mattermost): Les boutons des messages de OneUptime.
- [Réseau et auto-hébergement](#réseau-et-auto-hébergement): Ce que chaque serveur doit pouvoir joindre.
:::

## Fonctionnement

```mermaid title="D'un événement dans OneUptime à un message dans Mattermost"
flowchart TB
    event["Un incident, une alerte ou un événement<br/>est créé ou change"] --> rules{"Règles de notification<br/>dont les conditions correspondent"}
    rules -->|"Un canal<br/>pour chacun"| own["Un canal à lui,<br/>ses personnes ajoutées dès qu'elles arrivent"]
    rules -->|"Publier dans des canaux existants"| existing["Vos canaux existants"]
    own --> message["Un message avec des boutons"]
    existing --> message
    message -->|"Un intervenant en presse un"| change["Le changement est fait dans OneUptime,<br/>en son nom"]
```

Deux connexions rendent cela possible :

- **La connexion du projet**, faite une fois : un compte bot sur votre serveur Mattermost, dans les équipes où OneUptime publie. Il publie les messages, crée les canaux et y ajoute les personnes.
- **La connexion propre à chaque personne** : son compte Mattermost associé à son compte OneUptime. Les boutons agissent au nom de cette personne, avec ses autorisations dans le projet.

Une équipe Mattermost peut être connectée à plus d'un projet, par exemple la production et la préproduction. Un bouton agit dans le projet de l'enregistrement dont parle son message.

## Avant de commencer

- **Un rôle qui peut connecter le projet :** **Propriétaire du projet**, **Administrateur du projet** ou **Membre du projet**. Déconnecter demande **Propriétaire du projet** ou **Administrateur du projet**.
- **Un serveur Mattermost** où vous pouvez créer un compte bot, ou un administrateur Mattermost qui peut en créer un pour vous. Mattermost Cloud et Mattermost auto-hébergé fonctionnent tous les deux.
- **Le plan Growth sur OneUptime Cloud** pour les règles de notification et les résumés.

Rien n'est à configurer pour Mattermost sur le serveur de OneUptime lui-même : chaque projet apporte son propre serveur Mattermost et son propre compte bot.

## Connecter Mattermost

:::steps
### Créer un compte bot dans Mattermost

Dans Mattermost, ouvrez **System Console** > **Integrations** > **Bot Accounts** et vérifiez que **Enable Bot Account Creation** est activé. Allez ensuite dans **Integrations** > **Bot Accounts** > **Add Bot Account**, nommez-le `oneuptime` et enregistrez. Mattermost n'affiche le jeton d'accès du bot qu'une seule fois : copiez-le.

### Ajouter le bot à votre équipe

Ajoutez le bot à chaque équipe dans laquelle OneUptime doit publier, comme vous ajouteriez une personne : **Main Menu** > **Invite People**, et invitez `@oneuptime`. OneUptime ne crée des canaux et ne publie que dans les équipes dont le bot est membre.

### Connecter le projet

Dans OneUptime, allez dans **Paramètres du projet** > **Espace de travail** > **Mattermost** et cliquez sur **Se connecter avec Mattermost**. Saisissez l'adresse de votre serveur, par exemple `https://chat.example.com`, et le jeton d'accès du bot. OneUptime vérifie le jeton auprès de votre serveur avant de conserver quoi que ce soit. Si le bot fait partie de plus d'une équipe, OneUptime vous demande laquelle est l'équipe par défaut : celle où une règle de notification qui ne nomme aucune équipe crée ses canaux. Tant qu'aucun espace de travail n'est connecté, la section **Espace de travail** des menus Incidents, Alertes, Maintenance planifiée, Moniteurs et Astreinte contient **Connecter un espace de travail**, qui mène aussi ici.

### Ajouter une règle de notification

Allez dans **Incidents** > **Espace de travail** > **Mattermost** et créez une règle. Par exemple, une qui crée un canal Mattermost pour chaque nouvel incident avec tous ceux qui y travaillent. Voir [Règles de notification](#règles-de-notification).
:::

Le jeton d'accès du bot n'est conservé que sur le serveur OneUptime, chiffré avec les autres secrets du projet, et n'est plus jamais affiché. L'adresse du serveur, les équipes et le nom d'utilisateur du bot sont visibles par tous dans le projet, sur la page des paramètres Mattermost.

Un projet est connecté à un seul serveur Mattermost. Pour le déplacer vers un autre serveur, déconnectez-le d'abord : **Paramètres du projet** > **Espace de travail** > **Mattermost**, puis **⋯** > **Déconnecter Mattermost**. La déconnexion déconnecte aussi le compte Mattermost de chaque membre, et supprime ses méthodes de notification Mattermost et les règles d'astreinte qui les utilisent. Vos règles de notification et vos résumés sont conservés pour quand vous vous reconnectez.

## Plus d'une équipe

OneUptime fonctionne dans chaque équipe de votre serveur Mattermost dont son bot est membre :

1. Dans Mattermost, ajoutez le bot à chaque équipe qui doit utiliser OneUptime, comme vous ajouteriez une personne : ouvrez l'équipe, puis **Main Menu** > **Invite People**.
2. La carte **Équipes Mattermost** dans **Paramètres du projet** > **Espace de travail** > **Mattermost** liste ces équipes, l'équipe par défaut en premier. Cliquez sur **Actualiser** après avoir ajouté le bot à une autre équipe.

- **L'équipe qu'une règle utilise.** Les règles de notification choisissent l'**Équipe Mattermost** de leurs canaux. Si elle est laissée vide, une règle crée son canal dans l'équipe par défaut, et cherche les canaux qu'elle nomme d'abord dans celle-ci, puis dans les autres équipes du bot.
- **L'équipe qu'un résumé utilise.** Les résumés, dans l'onglet **Résumé** de **Incidents** et des **Alertes**, choisissent eux aussi l'**Équipe Mattermost** de leurs canaux. Si elle est laissée vide, un résumé cherche ses canaux d'abord dans l'équipe par défaut, puis dans les autres équipes du bot.
- **L'équipe par défaut.** C'est l'équipe à laquelle vous avez connecté le projet. **Définir par défaut** sur la carte fait d'une autre équipe l'équipe par défaut, pour un rôle qui peut connecter le projet.
- **Où OneUptime fonctionne.** Les boutons des messages de OneUptime, et les formulaires qu'ils ouvrent, fonctionnent dans chacune de ces équipes. Dans une équipe dont le bot a été retiré, un bouton indique seulement que l'équipe n'est plus connectée.
- **Une équipe par défaut dont le bot a été retiré.** La carte le signale. Rajoutez le bot dans Mattermost, ou définissez une autre équipe par défaut.
- **Une équipe qu'une règle nomme et dont le bot a été retiré.** La carte de la règle le signale, et la règle n'utilise pas une autre équipe à la place. Rajoutez le bot à l'équipe dans Mattermost, ou choisissez une autre équipe dans la règle : son formulaire affiche toujours l'ancien choix, pour que vous puissiez le changer.

## Connecter votre propre compte Mattermost

Mattermost n'a pas de page de connexion vers laquelle OneUptime pourrait vous envoyer ; le bot de OneUptime envoie donc à la place un message direct avec un lien à votre compte Mattermost :

:::steps
1. Allez dans **Paramètres utilisateur** > **Espace de travail** > **Mattermost**. OneUptime cherche le compte Mattermost associé à votre adresse e-mail. S'il en trouve un, cliquez sur **Envoyer le lien à @your-username**. Sinon, cliquez sur **M'envoyer un lien** et saisissez votre nom d'utilisateur Mattermost.
2. Ouvrez dans Mattermost le message direct du bot OneUptime, et cliquez sur **Connect my account**.
3. Le lien ouvre OneUptime, qui connecte votre compte.
:::

Ouvrez le lien dans le navigateur où vous l'avez demandé : il ne fonctionne que là, une seule fois, et pendant 15 minutes seulement. Cela prouve que la personne qui l'a demandé détient les deux comptes, si bien que personne ne peut connecter le compte Mattermost de quelqu'un d'autre. Si vous n'avez pas demandé de lien, ignorez-le : rien n'est connecté tant qu'il n'est pas ouvert dans le navigateur qui l'a demandé.

La connexion de votre compte appartient à ce projet. Dans un autre projet connecté à la même équipe Mattermost, connectez-le aussi là-bas.

## Être alerté dans Mattermost

Pour être alerté par message direct quand vous êtes d'astreinte, ajoutez Mattermost parmi vos méthodes de notification :

:::steps
1. Connectez votre propre compte Mattermost (voir [Connecter votre propre compte Mattermost](#connecter-votre-propre-compte-mattermost)).
2. Allez dans **Paramètres utilisateur** > **Méthodes de notification**, ouvrez l'onglet **Applications d'espace de travail** et cliquez sur **Ajouter un compte Mattermost**.
3. Cliquez sur **Send Test Message** sur sa ligne. Le message arrive en message direct du bot du projet.
:::

L'ajouter l'ajoute aussitôt à vos règles d'astreinte, si bien que les alertes vous atteignent dans Mattermost dès lors. Changez les alertes qu'il reçoit dans **Paramètres utilisateur** > **Comment me joindre**. Chaque alerte contient un lien pour la prendre en compte et un autre pour l'escalader. Déconnecter votre compte Mattermost supprime cette méthode et les règles d'astreinte qui l'utilisent.

## Règles de notification

Une règle de notification dit quels événements sont publiés dans Mattermost, et où. Chaque produit a ses propres règles, sous **Espace de travail** > **Mattermost** dans son menu : **Incidents** (avec **Épisodes d'incident** et un onglet **Résumé**), **Alertes** (avec **Épisodes d'alerte** et **Résumé**), **Maintenance planifiée**, **Moniteurs**, **Astreinte**, **Événements de sécurité** et **SLOs**. Elles fonctionnent comme celles de Slack : voir [Règles de notification](/docs/workspace-connections/slack#règles-de-notification) pour les conditions, les destinations, les mises à jour qu'une règle publie et qui rejoint un canal. Les messages d'astreinte sont les mêmes que dans Slack, une ligne à chaque relève : voir [Messages d'astreinte](/docs/workspace-connections/slack#messages-dastreinte). Une heure dans un message, comme la fin d'un tour d'astreinte, s'affiche en UTC : Mattermost ne peut pas l'afficher dans le fuseau horaire de chaque lecteur.

Un canal qu'une règle crée porte le nom de son enregistrement : l'incident INC-42 reçoit `inc-42`. Mattermost accepte les lettres minuscules, les chiffres, `-` et `_`, jusqu'à 64 caractères, en commençant et en finissant par une lettre ou un chiffre, et le formulaire de la règle montre le nom pendant que vous tapez. Si un canal porte déjà ce nom, par exemple un canal archivé, OneUptime ajoute `-2`, `-3` et ainsi de suite. Un incident, une alerte ou un épisode privé reçoit un canal privé.

Pour publier dans un canal existant, saisissez son nom tel qu'il apparaît dans son adresse, par exemple `incidents` pour `chat.example.com/team/channels/incidents`, ou son nom d'affichage. OneUptime rejoint de lui-même un canal public la première fois qu'il y publie. Ajoutez le bot à un canal privé dans Mattermost avant qu'une règle n'y publie. Quand le bot fait partie de plus d'une équipe, une règle choisit aussi l'équipe où se trouvent ses canaux : voir [Plus d'une équipe](#plus-dune-équipe).

Les personnes rejoignent le canal d'une règle par le compte Mattermost qu'elles ont connecté, ou sinon par le compte Mattermost associé à leur adresse e-mail, quand votre serveur montre les adresses e-mail au bot (**System Console** > **Site Configuration** > **Users and Teams** > **Show Email Address**). OneUptime nomme les personnes qu'il n'a pas pu ajouter dans un seul message dans le canal, avec un lien pour connecter leur compte.

Un incident, une alerte, un épisode ou un événement de maintenance planifiée qui a son propre canal affiche **Ouvrir dans Mattermost** dans l'en-tête de sa page dans OneUptime, à côté de ses boutons d'état. Ce bouton ouvre ce canal dans un nouvel onglet, sur votre serveur Mattermost. Un enregistrement qui a deux canaux à lui les liste tous les deux sous le bouton. Un enregistrement qui a aussi des canaux dans Slack ou Microsoft Teams a à la place un seul bouton **Ouvrir le canal**, qui les liste tous. Les canaux existants où vos règles publient ne sont pas proposés.

**Tester la règle** sur la ligne d'une règle publie un message de test pour cette règle dans les canaux qu'elle nomme, comme pour Slack.

Les messages de OneUptime ne notifient personne par ce qu'ils citent : un nom ou une description qui contient `@channel`, `@here` ou `@someone` s'affiche tel qu'il est écrit, et ne notifie personne.

## Qui est dans le canal d'un enregistrement

Un incident, une alerte, un épisode ou un événement de maintenance planifiée qui a son propre canal Mattermost affiche une carte **Canal Mattermost** sur sa page dans OneUptime. La carte montre le canal, sous la forme d'un lien qui l'ouvre sur votre serveur Mattermost, s'il est privé, et qui s'y trouve, vous en premier. Depuis la carte, sans administrateur Mattermost :

- **Rejoindre le canal** vous ajoute, quand vous n'êtes pas dans le canal.
- **Ajouter des personnes** ouvre une liste des personnes et des équipes du projet : choisissez une personne pour l'ajouter, ou une équipe pour ajouter tous ses membres.

Le bot de OneUptime les ajoute, comme il ajoute les personnes du canal d'une règle. Le bot reste dans les canaux qu'il crée : cela fonctionne donc aussi pour un canal privé que tout le monde a quitté. Un enregistrement qui a aussi des canaux dans Slack ou Microsoft Teams les liste tous sur une seule carte **Canaux de discussion**.

- **Qui peut ajouter des personnes.** Quiconque peut modifier l'enregistrement : **Propriétaire du projet**, **Administrateur du projet**, **Membre du projet**, **Administrateur des incidents** et **Membre des incidents** pour un incident, ou **Edit Incident** dans un rôle personnalisé, et la même autorisation pour une alerte, un épisode ou un événement (**Edit Alert**, par exemple). Les autres voient qui est dans le canal, et comment y entrer.
- **Qui peut être ajouté.** Une personne que OneUptime trouve dans Mattermost, par le compte qu'elle a connecté ou sinon par son adresse e-mail, quand votre serveur montre les adresses e-mail au bot, et qui est dans l'équipe du canal. Un compte invité de cette équipe peut aussi être ajouté : Mattermost permet aux membres d'un canal d'ajouter des invités. La carte nomme les personnes qu'elle n'a pas pu ajouter, et pourquoi.
- **Ce qui est consigné.** Qui a été ajouté, et par qui, dans le fil d'activité de l'enregistrement (**Membre ajouté au canal**) et dans **Paramètres du projet** > **Notifications** > **Journaux de notification**, sur l'onglet **Espace de travail**.
- **Un canal archivé.** La carte liste toujours qui s'y trouve, et n'ajoute personne tant que le canal n'est pas désarchivé dans Mattermost.
- **Un canal dont le bot a été retiré.** Mattermost ne montre les personnes d'un canal qu'à quelqu'un qui s'y trouve, même pour un canal public : la carte dit donc qu'elle ne voit pas le canal. Quelqu'un qui en est membre peut rajouter le bot dans Mattermost. OneUptime rejoint aussi de lui-même un canal public la prochaine fois qu'il y publie.
- **Retirer quelqu'un.** OneUptime ne fait qu'ajouter : retirez quelqu'un du canal dans Mattermost.

## Agir sur les incidents, alertes et événements depuis Mattermost

Les messages de OneUptime portent des boutons, et un menu **More actions** pour ce dont moins de personnes ont besoin. Chacun agit en votre nom, avec vos autorisations dans le projet, et répond dans un message que vous seul voyez.

| Enregistrement | Boutons et menu |
| --- | --- |
| **Incident** | **Acknowledge**, **Resolve**, **Add Note**, et dans le menu **Change Severity** et **Change State** |
| **Alerte** | **Acknowledge**, **Resolve**, **Add Note**, **Change State**, **Execute On-Call Policy** |
| **Épisode d'incident, épisode d'alerte** | **Acknowledge**, **Resolve**, **Add Note**, **Change State**, **Execute On-Call Policy** |
| **Maintenance planifiée** | **Mark as Ongoing**, **Mark as Complete**, **Add Note**, **Change State** |

**Add Note**, **Change State**, **Change Severity** et **Execute On-Call Policy** ouvrent un formulaire dans Mattermost. Une note sur un incident ou sur un événement de maintenance planifiée peut être publique, affichée sur la page de statut, ou privée ; une note sur un incident privé est toujours privée, et sur une alerte toujours privée aussi. Chaque message a aussi un lien qui ouvre son enregistrement dans OneUptime, pour tout le reste. Quand les notes publiques du projet doivent être approuvées, une note publique envoyée depuis le formulaire attend son approbation, et un message que vous seul voyez dit qui elle attend : voir [Approbation des notes publiques](/docs/incidents/notes-owners-and-feed#approbation-des-notes-publiques).

Si votre compte Mattermost n'est pas encore connecté, un bouton vous le dit, avec un lien vers **Paramètres utilisateur** > **Espace de travail** > **Mattermost**. Connectez votre compte, puis pressez à nouveau le bouton.

Chaque pression sur un bouton est consignée dans **Paramètres du projet** > **Notifications** > **Journaux de notification**, dans l'onglet **Espace de travail**, en indiquant qui l'a pressé.

## Approuver une note publique

Lorsque les notes publiques de votre projet doivent être approuvées et que vous activez Mattermost pour **Approbation des notes publiques** dans vos paramètres de notification, chaque note publique qui attend une étape que vous approuvez arrive dans vos messages directs avec le bot de OneUptime : qui l'a envoyée, l'étape qu'elle attend, la note, **Approve**, **Reject** et un lien vers la note dans OneUptime. **Approve** l'approuve pour cette étape ; à la dernière étape, il s'intitule **Approve and publish** et la note est publiée aussitôt. **Reject** ouvre un formulaire qui demande pourquoi : une raison est obligatoire, et l'auteur de la note la voit. Les boutons agissent en votre nom, selon les mêmes règles que dans OneUptime, et répondent dans un message que vous seul voyez. Un clic après la décision de quelqu'un d'autre, ou après un changement de la note ou de ses étapes, ne décide rien et dit ce qui s'est passé. Une fois la note décidée, le message de chaque approbateur à son sujet, le vôtre compris, change pour dire ce qui s'est passé : approuvée pour son étape et qui elle attend maintenant, publiée, rejetée, modifiée ou renvoyée pour approbation, publiée sans approbation, ou supprimée. Il garde son lien vers la note dans OneUptime, et **Approve** et **Reject** disparaissent. Si votre compte Mattermost n'est pas connecté, connectez-le dans **Paramètres utilisateur** > **Espace de travail** > **Mattermost**, puis cliquez à nouveau sur le bouton. Quand les étapes d'approbation changent pendant qu'une note attend, votre message à son sujet change aussi si la note n'attend plus votre étape ou si vous n'êtes plus sollicité, et ceux qu'elle attend désormais reçoivent leur propre message. Voir [Approbation des notes publiques](/docs/incidents/notes-owners-and-feed#approbation-des-notes-publiques).

## Réseau et auto-hébergement

Deux serveurs communiquent entre eux :

- **OneUptime appelle votre serveur Mattermost**, pour publier, créer des canaux et ajouter des personnes. Sur OneUptime Cloud, votre serveur Mattermost doit être joignable depuis Internet. Un OneUptime auto-hébergé peut joindre un serveur Mattermost sur un réseau privé dès que son opérateur autorise les adresses privées avec `ALLOW_PRIVATE_NETWORK_WEBHOOKS` ou `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST`. OneUptime n'appelle jamais une adresse sur sa propre machine ni une adresse de métadonnées cloud, et ne suit jamais de redirection.
- **Votre serveur Mattermost appelle OneUptime** quand quelqu'un presse un bouton ou envoie un formulaire : `https://<your OneUptime>/api/mattermost/interactive` et `/api/mattermost/dialog`. Si l'adresse de OneUptime est une adresse privée, ajoutez son hôte à **System Console** > **Environment** > **Developer** > **Allow untrusted internal connections to** dans Mattermost, sinon les boutons ne fonctionneront pas.

Chaque bouton que OneUptime publie porte une signature, vérifiée quand on le presse, pour l'équipe Mattermost où il a été publié : une pression que OneUptime n'a pas signée, ou qui vient d'une autre équipe, ne fait rien.

## Dépannage

| Ce que vous voyez | Ce qu'il faut faire |
| --- | --- |
| **Mattermost did not accept the access token** | Copiez à nouveau le jeton du bot. Mattermost ne l'affiche qu'une fois : créez-en un nouveau dans **Integrations** > **Bot Accounts** si besoin. |
| **The bot account is not a member of any team** | Ajoutez le bot à votre équipe dans Mattermost, puis reconnectez le projet. |
| Une équipe à laquelle vous avez ajouté le bot n'apparaît pas sur la carte **Équipes Mattermost** | Cliquez sur **Actualiser** sur la carte. |
| **OneUptime's bot is not a member of this Mattermost team** | Vous avez choisi une équipe que le bot a quittée. Ajoutez-y le bot dans Mattermost, puis cliquez sur **Actualiser**. |
| **OneUptime's bot may not create channels in the Mattermost team this rule names** | Ajoutez le bot à cette équipe dans Mattermost, ou choisissez une autre équipe dans la règle. |
| **OneUptime's bot is not a member of the Mattermost team chosen for the channel** | Ajoutez le bot à cette équipe dans Mattermost, ou choisissez une autre équipe dans la règle. |
| **OneUptime's bot is no longer a member of the project's default Mattermost team** | Rajoutez le bot à cette équipe dans Mattermost, ou définissez une autre équipe par défaut. |
| **OneUptime could not reach the Mattermost server** | Vérifiez l'adresse, et que OneUptime peut la joindre. Voir [Réseau et auto-hébergement](#réseau-et-auto-hébergement). |
| **The bot is not a member of the private Mattermost channel** | Ajoutez le bot au canal dans Mattermost. |
| Un bouton ne fait rien, ou Mattermost dit qu'il n'a pas pu terminer l'action | Mattermost ne peut pas joindre OneUptime. Voir [Réseau et auto-hébergement](#réseau-et-auto-hébergement). |
| Aucun message direct n'arrive avec votre lien | Vérifiez le nom d'utilisateur, et que le bot est dans une équipe dont vous faites partie. |
| La carte du canal dit que OneUptime ne voit pas le canal | Le canal a été supprimé, ou le bot en a été retiré. S'il existe encore, quelqu'un qui en est membre peut rajouter le bot dans Mattermost. |
| La carte du canal dit qu'une personne n'est pas dans l'équipe Mattermost | Ajoutez-la dans Mattermost à l'équipe du canal, puis ajoutez-la à nouveau. |
