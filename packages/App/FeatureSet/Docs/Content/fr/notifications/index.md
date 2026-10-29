# Comment OneUptime vous joint

OneUptime vous joint de deux façons. Il vous alerte quand un incident ou une alerte se déclenche pendant votre astreinte, et il vous tient au courant de ce dont vous êtes propriétaire : une note sur votre incident, un moniteur dont le statut a changé, votre prochaine permanence. Les deux arrivent aux adresses que vous gérez dans les **Paramètres utilisateur**, projet par projet. Cette page explique comment les éléments s'articulent, où ils se trouvent et ce dont vous disposez au départ.

:::cards
- [Trois pages, trois questions](#trois-pages-trois-questions): Méthodes, règles d'astreinte et paramètres de notification, et ce que chacun décide.
- [Où les trouver](#où-les-trouver): Les pages des paramètres utilisateur, section par section.
- [Ce dont vous disposez au départ](#ce-dont-vous-disposez-au-départ): Les méthodes, règles et paramètres qu'un nouveau membre reçoit.
- [Quand aucune règle ne correspond](#quand-aucune-règle-ne-correspond): Comment une alerte vous parvient malgré tout, et qui en est informé.
:::

## Comment ça fonctionne

```mermaid title="Deux façons dont OneUptime vous joint, par les mêmes méthodes"
flowchart TB
    page["Un incident ou une<br/>alerte vous alerte<br/>pendant l'astreinte"] --> rules["Vos règles d'astreinte"]
    owned["Il se passe quelque<br/>chose sur un élément<br/>qui vous appartient"] --> settings["Vos paramètres<br/>de notification"]
    rules --> methods["Vos méthodes vérifiées :<br/>e-mail, téléphone,<br/>push, chat"]
    settings --> methods
```

- Une politique d'astreinte vous alerte quand l'une de ses règles d'escalade vous nomme, nomme une équipe dont vous faites partie, ou un planning dans lequel vous êtes d'astreinte. Vos règles d'astreinte décident alors quelles méthodes OneUptime essaie, et après combien de temps.
- Quand il se passe quelque chose sur un élément dont vous êtes propriétaire, ou sur vos permanences, vos paramètres de notification décident par quels canaux passe la nouvelle.
- Dans les deux cas, OneUptime n'utilise que des méthodes que vous avez vérifiées, dans le projet d'où viennent l'alerte ou la nouvelle.

## Trois pages, trois questions

| Page | Ce qu'elle contient | La question à laquelle elle répond |
| --- | --- | --- |
| **Méthodes de notification** | Vos adresses e-mail, numéros de téléphone, numéros WhatsApp, comptes Telegram, Slack et Microsoft Teams, appareils push et webhooks | Où OneUptime peut-il me joindre ? |
| **Règles d'astreinte** | Pour chaque type d'alerte et chaque gravité, quelle méthode essayer et après combien de temps | Comment suis-je alerté pendant mon astreinte ? |
| **Paramètres de notification** | Pour chaque événement concernant un élément dont vous êtes propriétaire ou vos permanences, quels canaux utiliser | De quoi d'autre suis-je informé, et où ? |

Elles sont séparées exprès. Activer tous les canaux dans les **Paramètres de notification** ne vous alerte jamais, et une méthode que vous n'avez pas vérifiée n'est jamais utilisée, quoi que disent vos règles.

> [!IMPORTANT]
> Les méthodes, les règles et les paramètres appartiennent à un projet. Configurez-les dans chaque projet où vous travaillez : les **Paramètres utilisateur** montrent toujours le projet dans lequel vous êtes.

## Où les trouver

Ouvrez les **Paramètres utilisateur**, à droite de la barre située sous la barre supérieure. Leur menu latéral contient tout ce qui concerne la façon dont OneUptime vous joint :

| Section | Pages |
| --- | --- |
| **Premiers pas** | **Liste de configuration** : ce qu'il reste à configurer, dans l'ordre qui compte |
| **Alertes & notifications** | **Méthodes de notification**, **Règles d'astreinte**, **Paramètres de notification** et **Préférences e-mail**, qui règle le nombre d'e-mails que représentent vos nouvelles |
| **Journaux d'astreinte** | **Journaux d'astreinte** : chaque fois que vous avez été alerté dans ce projet, et ce qui a été envoyé |
| **Politique d'appels entrants** | **Numéros de téléphone entrants** : le numéro auquel une politique d'appels entrants vous appelle |
| **Calendrier** | **Flux de calendrier** : vos permanences dans votre application de calendrier, et des rappels avant qu'elles commencent |
| **Profil** | **Champs personnalisés** : les informations que votre projet demande à ses membres |
| **Espace de travail** | **Slack** et **Microsoft Teams** : votre propre compte, dans chaque espace de travail que le projet a connecté |

**Premiers pas** et **Alertes & notifications** sont ouvertes ; les autres sections démarrent repliées, et une section s'ouvre d'elle-même quand vous êtes sur l'une de ses pages. **Espace de travail** n'apparaît que si le projet a connecté Slack ou Microsoft Teams.

Les propriétaires et les admins du projet peuvent aussi consulter votre configuration : dans **Utilisateurs**, ils ouvrent votre ligne et sa section **Astreinte**, avec **Disponibilité**, **Méthodes de notification** et **Règles d'astreinte**. Ils peuvent y ajouter une méthode pour vous, mais le code est envoyé à la méthode elle-même, donc vous seul pouvez la vérifier.

## Ce dont vous disposez au départ

Quand vous rejoignez un projet avec un e-mail de connexion vérifié, OneUptime vous configure pour qu'une alerte puisse toujours vous joindre :

1. Votre e-mail de connexion est ajouté comme méthode e-mail vérifiée.
2. Pour chaque gravité, sur chacun des quatre onglets des **Règles d'astreinte**, une règle vous envoie un e-mail dès que vous êtes alerté.
3. Un ensemble de nouvelles sur ce dont vous êtes propriétaire, et sur vos permanences, est activé par e-mail. Voir [Paramètres de notification](/docs/notifications/notification-settings#ce-qui-est-activé-pour-un-nouveau-membre).

Chaque méthode que vous vérifiez ensuite reçoit les mêmes règles : une règle pour chaque gravité, envoyée dès que vous êtes alerté. Vérifier un numéro de téléphone pour les SMS signifie donc que chaque alerte vous envoie aussi un SMS. Pour garder les SMS pour les alertes critiques uniquement, supprimez les règles SMS des autres gravités. Voir [Règles d'astreinte personnelles](/docs/notifications/on-call-rules#les-règles-de-départ).

## La liste de configuration

**Paramètres utilisateur → Liste de configuration** ouvre **Your setup checklist** : tout ce dont OneUptime a besoin pour vous joindre, dans l'ordre qui compte. Une étape renvoie vers la page qui la réalise, et **Revérifier** relit tout.

| Section | Ce qu'elle vérifie |
| --- | --- |
| **So we can reach you** | Vous avez une méthode, chaque méthode ajoutée est vérifiée, et au moins l'une d'elles est sur un canal que le projet a activé |
| **Comment vous souhaitez être alerté** | Chaque gravité a une règle, sur chacun des quatre onglets des **Règles d'astreinte** |
| **Staying informed** | Vous êtes prévenu quand une permanence commence, et chaque canal activé dans les **Paramètres de notification** a une méthode vérifiée derrière lui |
| **Souhaitable** | Un numéro pour les appels entrants, vos comptes Slack et Microsoft Teams, un lien de calendrier et vos champs de profil |

**Staying informed** ne signale le push que pour une mise à jour qui ne vous parvient par aucun autre moyen : chaque mise à jour qu'un nouveau membre reçoit par push arrive aussi par e-mail.

**Souhaitable** ne compte pas dans la barre de progression, pas plus qu'une étape que seul quelqu'un d'autre peut régler. La ligne du haut résume le tout :

| Titre | Ce qu'il signifie |
| --- | --- |
| **Tout est prêt** | Les alertes vous parviennent, et il ne reste rien à faire |
| **Il reste quelques éléments à configurer** | Une gravité n'a pas de règle, ou une étape n'est pas encore faite |
| **Rien ne peut encore vous joindre** | Aucune de vos méthodes n'est utilisable : aucune n'est vérifiée, ou chaque méthode vérifiée est sur un canal que ce projet a désactivé |
| **Vous êtes configuré et n'êtes pas d'astreinte en ce moment** | Tout est prêt pour le jour où une politique vous nommera |

## Quand aucune règle ne correspond

Une alerte peut vous parvenir pour un type et une gravité pour lesquels vous n'avez pas de règle : une gravité ajoutée après votre arrivée, par exemple. OneUptime vous alerte quand même, par ce que vous avez vérifié :

1. Chaque méthode gratuite que vous avez : appareils push, adresses e-mail, Slack et Microsoft Teams.
2. Si vous n'en avez aucune, une seule méthode payante, dans cet ordre : SMS, appel téléphonique, WhatsApp, Telegram. C'est la première que vous avez vérifiée, sur un canal que le projet a activé.
3. Si vous n'en avez aucune non plus, un webhook.

Vous recevez un e-mail à ce sujet, tout comme les propriétaires de la politique d'astreinte, ou ceux du projet si la politique n'en a pas. Si rien n'est vérifié, l'alerte ne peut pas être livrée, et l'e-mail le dit. Ces e-mails sont retenus tant que les alertes continuent, afin qu'une tempête d'alertes ne devienne pas une tempête d'e-mails. Pour ajouter la règle manquante, voir [Règles d'astreinte personnelles](/docs/notifications/on-call-rules#quand-une-gravité-na-pas-de-règle).

## Dépannage

:::details J'étais d'astreinte, mais rien ne m'est parvenu
Ouvrez **Paramètres utilisateur → Journaux d'astreinte**. Aucune ligne pour l'incident signifie que sa politique d'astreinte ne vous a jamais alerté : vérifiez ses règles d'escalade et qui était d'astreinte. Pour une ligne au statut **Erreur**, **Voir le message de statut** indique pourquoi, par exemple un canal que le projet a désactivé. Vérifiez ensuite que vos méthodes sont vérifiées et que **Your setup checklist** n'a plus rien en attente sous **So we can reach you**.
:::

:::details Je reçois des e-mails sur des éléments que je n'ai jamais demandés
Vous êtes propriétaire de l'élément, directement ou via une équipe, ou l'élément n'a pas de propriétaire et vous êtes propriétaire du projet. Désactivez l'événement dans **Paramètres utilisateur → Paramètres de notification**, ou réduisez le volume dans **Paramètres utilisateur → Préférences e-mail**.
:::

:::details J'ai ajouté un numéro de téléphone, mais il n'est pas dans mes règles
Un numéro rejoint vos règles une fois vérifié. Cliquez sur **Vérifier** dans sa ligne et saisissez le code. Si sa carte n'a pas de bouton d'ajout, le projet a désactivé ce canal. Voir [Méthodes de notification](/docs/notifications/notification-methods#activer-un-canal-pour-votre-projet).
:::

## Étapes suivantes

:::cards
- [Méthodes de notification](/docs/notifications/notification-methods): Ajoutez et vérifiez les adresses auxquelles OneUptime peut vous joindre.
- [Règles d'astreinte personnelles](/docs/notifications/on-call-rules): Décidez quelle méthode chaque alerte essaie, et quand.
- [Paramètres de notification](/docs/notifications/notification-settings): Choisissez les nouvelles dont vous êtes informé, et par quels canaux.
- [Règles d'escalade](/docs/on-call/escalation-rules): Comment une politique d'astreinte décide qui est alerté, niveau par niveau.
:::
