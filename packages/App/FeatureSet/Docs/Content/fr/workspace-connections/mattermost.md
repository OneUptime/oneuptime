# Mattermost

Connectez OneUptime à votre serveur Mattermost pour publier dans vos canaux les incidents, alertes, épisodes, maintenances planifiées, moniteurs et mises à jour d'astreinte, donner à chaque incident un canal à lui et laisser les intervenants prendre en compte, résoudre, ajouter des notes et changer l'état sans quitter Mattermost.

:::cards
- [Connecter Mattermost](#connecter-mattermost): Créez un compte bot pour OneUptime, puis connectez le projet avec son jeton.
- [Connecter votre propre compte](#connecter-votre-propre-compte-mattermost): Associez votre compte Mattermost à votre compte OneUptime.
- [Règles de notification](#règles-de-notification): Décidez quels événements sont publiés où, et lesquels ont un canal à eux.
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

- **La connexion du projet**, faite une fois : un compte bot sur votre serveur Mattermost, dans l'équipe où OneUptime publie. Il publie les messages, crée les canaux et y ajoute les personnes.
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

Ajoutez le bot à l'équipe dans laquelle OneUptime doit publier, comme vous ajouteriez une personne : **Main Menu** > **Invite People**, et invitez `@oneuptime`. OneUptime ne crée des canaux et ne publie que dans cette équipe.

### Connecter le projet

Dans OneUptime, allez dans **Paramètres du projet** > **Espace de travail** > **Mattermost** et cliquez sur **Se connecter avec Mattermost**. Saisissez l'adresse de votre serveur, par exemple `https://chat.example.com`, et le jeton d'accès du bot. OneUptime vérifie le jeton auprès de votre serveur avant de conserver quoi que ce soit. Si le bot fait partie de plus d'une équipe, OneUptime vous demande dans laquelle publier. Tant qu'aucun espace de travail n'est connecté, la section **Espace de travail** des menus Incidents, Alertes, Maintenance planifiée, Moniteurs et Astreinte contient **Connecter un espace de travail**, qui mène aussi ici.

### Ajouter une règle de notification

Allez dans **Incidents** > **Espace de travail** > **Mattermost** et créez une règle. Par exemple, une qui crée un canal Mattermost pour chaque nouvel incident avec tous ceux qui y travaillent. Voir [Règles de notification](#règles-de-notification).
:::

Le jeton d'accès du bot n'est conservé que sur le serveur OneUptime, chiffré avec les autres secrets du projet, et n'est plus jamais affiché. L'adresse du serveur, l'équipe et le nom d'utilisateur du bot sont visibles par tous dans le projet, sur la page des paramètres Mattermost.

Un projet est connecté à une seule équipe Mattermost. Pour le déplacer vers une autre équipe, ou un autre serveur, déconnectez-le d'abord : **Paramètres du projet** > **Espace de travail** > **Mattermost**, puis **⋯** > **Déconnecter Mattermost**. La déconnexion déconnecte aussi le compte Mattermost de chaque membre. Vos règles de notification et vos résumés sont conservés pour quand vous vous reconnectez.

## Connecter votre propre compte Mattermost

Mattermost n'a pas de page de connexion vers laquelle OneUptime pourrait vous envoyer ; le bot de OneUptime envoie donc à la place un message direct avec un lien à votre compte Mattermost :

:::steps
1. Allez dans **Paramètres utilisateur** > **Espace de travail** > **Mattermost**. OneUptime cherche le compte Mattermost associé à votre adresse e-mail. S'il en trouve un, cliquez sur **Envoyer le lien à @your-username**. Sinon, cliquez sur **M'envoyer un lien** et saisissez votre nom d'utilisateur Mattermost.
2. Ouvrez dans Mattermost le message direct du bot OneUptime, et cliquez sur **Connect my account**.
3. Le lien ouvre OneUptime, qui connecte votre compte.
:::

Ouvrez le lien dans le navigateur où vous l'avez demandé : il ne fonctionne que là, une seule fois, et pendant 15 minutes seulement. Cela prouve que la personne qui l'a demandé détient les deux comptes, si bien que personne ne peut connecter le compte Mattermost de quelqu'un d'autre. Si vous n'avez pas demandé de lien, ignorez-le : rien n'est connecté tant qu'il n'est pas ouvert dans le navigateur qui l'a demandé.

La connexion de votre compte appartient à ce projet. Dans un autre projet connecté à la même équipe Mattermost, connectez-le aussi là-bas.

## Règles de notification

Une règle de notification dit quels événements sont publiés dans Mattermost, et où. Chaque produit a ses propres règles, sous **Espace de travail** > **Mattermost** dans son menu : **Incidents** (avec **Épisodes d'incident** et un onglet **Résumé**), **Alertes** (avec **Épisodes d'alerte** et **Résumé**), **Maintenance planifiée**, **Moniteurs**, **Astreinte** et **Événements de sécurité**. Elles fonctionnent comme celles de Slack : voir [Règles de notification](/docs/workspace-connections/slack#règles-de-notification) pour les conditions, les destinations et qui rejoint un canal.

Un canal qu'une règle crée porte le nom de son enregistrement : l'incident INC-42 reçoit `inc-42`. Mattermost accepte les lettres minuscules, les chiffres, `-` et `_`, jusqu'à 64 caractères, en commençant et en finissant par une lettre ou un chiffre, et le formulaire de la règle montre le nom pendant que vous tapez. Si un canal porte déjà ce nom, par exemple un canal archivé, OneUptime ajoute `-2`, `-3` et ainsi de suite. Un incident, une alerte ou un épisode privé reçoit un canal privé.

Pour publier dans un canal existant, saisissez son nom tel qu'il apparaît dans son adresse, par exemple `incidents` pour `chat.example.com/team/channels/incidents`, ou son nom d'affichage. OneUptime rejoint de lui-même un canal public la première fois qu'il y publie. Ajoutez le bot à un canal privé dans Mattermost avant qu'une règle n'y publie.

Les personnes rejoignent le canal d'une règle par le compte Mattermost qu'elles ont connecté, ou sinon par le compte Mattermost associé à leur adresse e-mail, quand votre serveur montre les adresses e-mail au bot (**System Console** > **Site Configuration** > **Users and Teams** > **Show Email Address**). OneUptime nomme les personnes qu'il n'a pas pu ajouter dans un seul message dans le canal, avec un lien pour connecter leur compte.

Un incident, une alerte, un épisode ou un événement de maintenance planifiée qui a son propre canal affiche **Ouvrir dans Mattermost** dans l'en-tête de sa page dans OneUptime, à côté de ses boutons d'état. Ce bouton ouvre ce canal dans un nouvel onglet, sur votre serveur Mattermost. Un enregistrement qui a deux canaux à lui les liste tous les deux sous le bouton. Un enregistrement qui a aussi des canaux dans Slack ou Microsoft Teams a à la place un seul bouton **Ouvrir le canal**, qui les liste tous. Les canaux existants où vos règles publient ne sont pas proposés.

**Tester la règle** sur la ligne d'une règle publie un message de test pour cette règle dans les canaux qu'elle nomme, comme pour Slack.

Les messages de OneUptime ne notifient personne par ce qu'ils citent : un nom ou une description qui contient `@channel`, `@here` ou `@someone` s'affiche tel qu'il est écrit, et ne notifie personne.

## Agir sur les incidents, alertes et événements depuis Mattermost

Les messages de OneUptime portent des boutons, et un menu **More actions** pour ce dont moins de personnes ont besoin. Chacun agit en votre nom, avec vos autorisations dans le projet, et répond dans un message que vous seul voyez.

| Enregistrement | Boutons et menu |
| --- | --- |
| **Incident** | **Acknowledge**, **Resolve**, **Add Note**, et dans le menu **Change Severity** et **Change State** |
| **Alerte** | **Acknowledge**, **Resolve**, **Add Note**, **Change State**, **Execute On-Call Policy** |
| **Épisode d'incident, épisode d'alerte** | **Acknowledge**, **Resolve**, **Add Note**, **Change State**, **Execute On-Call Policy** |
| **Maintenance planifiée** | **Mark as Ongoing**, **Mark as Complete**, **Add Note**, **Change State** |

**Add Note**, **Change State**, **Change Severity** et **Execute On-Call Policy** ouvrent un formulaire dans Mattermost. Une note sur un incident ou sur un événement de maintenance planifiée peut être publique, affichée sur la page de statut, ou privée ; une note sur un incident privé est toujours privée, et sur une alerte toujours privée aussi. Chaque message a aussi un lien qui ouvre son enregistrement dans OneUptime, pour tout le reste.

Si votre compte Mattermost n'est pas encore connecté, un bouton vous le dit, avec un lien vers **Paramètres utilisateur** > **Espace de travail** > **Mattermost**. Connectez votre compte, puis pressez à nouveau le bouton.

Chaque pression sur un bouton est consignée dans **Paramètres du projet** > **Notifications** > **Journaux de notification**, dans l'onglet **Espace de travail**, en indiquant qui l'a pressé.

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
| **OneUptime could not reach the Mattermost server** | Vérifiez l'adresse, et que OneUptime peut la joindre. Voir [Réseau et auto-hébergement](#réseau-et-auto-hébergement). |
| **The bot is not a member of the private Mattermost channel** | Ajoutez le bot au canal dans Mattermost. |
| Un bouton ne fait rien, ou Mattermost dit qu'il n'a pas pu terminer l'action | Mattermost ne peut pas joindre OneUptime. Voir [Réseau et auto-hébergement](#réseau-et-auto-hébergement). |
| Aucun message direct n'arrive avec votre lien | Vérifiez le nom d'utilisateur, et que le bot est dans une équipe dont vous faites partie. |
