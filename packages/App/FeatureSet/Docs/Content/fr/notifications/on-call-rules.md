# Règles d'astreinte personnelles

Vos règles d'astreinte décident comment une alerte vous parvient : quelles méthodes de notification OneUptime essaie, et combien de temps après le début de l'alerte. Chaque type d'alerte a ses propres règles, un ensemble par gravité, si bien qu'un incident critique peut vous appeler tout de suite tandis qu'une alerte de faible gravité attend un e-mail. Vous les réglez dans **Paramètres utilisateur → Règles d'astreinte**.

> [!NOTE]
> Ces règles n'appartiennent qu'à vous. Les **Règles d'astreinte** de **Incidents → Règles** et de **Alertes → Règles** sont autre chose : elles décident quelles politiques d'astreinte un nouvel incident ou une nouvelle alerte exécute.

:::cards
- [Comment une alerte vous parvient](#comment-une-alerte-vous-parvient): Vos règles pour une alerte, étape par étape.
- [Les règles de départ](#les-règles-de-départ): Ce que chaque méthode vérifiée ajoute, et comment l'alléger.
- [Ajouter une règle](#ajouter-une-règle): Une méthode et un délai pour une gravité.
- [Règles push](#règles-push): Passer outre le mode silencieux, et répéter jusqu'à la prise en compte.
:::

## Comment une alerte vous parvient

Une politique d'astreinte vous alerte quand l'une de ses règles d'escalade vous nomme, nomme une équipe dont vous faites partie, ou un planning dans lequel vous êtes d'astreinte. OneUptime parcourt alors vos règles pour ce type d'alerte et sa gravité : chaque règle se déclenche sur sa propre méthode une fois son délai écoulé depuis le début de l'alerte. Prendre en compte l'incident ou l'alerte, depuis n'importe quel message ou dans OneUptime, arrête chaque règle qui ne s'est pas encore déclenchée.

```mermaid title="Une alerte critique, trois règles, jusqu'à la prise en compte"
flowchart TB
    page["Un incident critique<br/>vous alerte"] --> first["Tout de suite :<br/>notification push"]
    first --> second["Après 5 minutes :<br/>SMS"]
    second --> third["Après 10 minutes :<br/>appel téléphonique"]
    ack["Vous prenez en compte"] -.->|"arrête le reste"| third
```

La plupart des messages peuvent prendre en compte l'alerte : les e-mails, les SMS et les messages WhatsApp, Telegram, Slack et Microsoft Teams contiennent un lien de prise en compte, et un appel vous demande d'appuyer sur 1. Si vous ne pouvez pas prendre une alerte, les mêmes messages vous permettent de l'escalader, et un appel vous demande d'appuyer sur 2 : la politique alerte tout de suite son niveau suivant, et vous n'êtes plus alerté à ce sujet. Voir [Escalader une alerte](/docs/on-call/escalation-rules#escalader-une-alerte). Chaque alerte reçue figure dans **Paramètres utilisateur → Journaux d'astreinte**, où **Voir la chronologie** montre chaque message envoyé et s'il a été livré.

## Les quatre onglets

**Paramètres utilisateur → Règles d'astreinte** a un onglet par type d'alerte. Chaque onglet a une carte par gravité, nommée et colorée comme votre projet l'a définie :

| Onglet | Alertes pour | Cartes pour |
| --- | --- | --- |
| **Incidents** | Les incidents | Les gravités d'incident |
| **Épisodes d'incident** | Les épisodes qui regroupent des incidents | Les gravités d'incident |
| **Alertes** | Les alertes | Les gravités d'alerte |
| **Épisodes d'alerte** | Les épisodes qui regroupent des alertes | Les gravités d'alerte |

Un épisode vous alerte par ses propres politiques d'astreinte, indépendamment des incidents ou des alertes qu'il contient, c'est pourquoi ses règles ont leur propre onglet. L'adresse de la page nomme l'onglet ouvert, par exemple `/dashboard/{projectId}/user-settings/on-call-rules?type=alerts` ; les autres valeurs sont `incident-episodes` et `alert-episodes`, et sans `type` la page s'ouvre sur **Incidents**.

Une gravité que votre projet a archivée vient après les autres, marquée **Archivé**, tant que vous avez des règles pour elle : les incidents et les alertes qui l'ont encore vous préviennent selon ces règles. Vous pouvez les modifier ou les supprimer, mais pas en ajouter de nouvelles.

## Les règles de départ

Chaque méthode que vous vérifiez reçoit une règle sur chaque carte de chaque onglet, envoyée dès que vous êtes alerté. Votre e-mail de connexion les a depuis le jour de votre arrivée, pour qu'une alerte vous joigne toujours. Vérifiez un numéro de téléphone pour les SMS, et chaque alerte vous envoie aussi un SMS.

C'est un départ sûr, et en général trop. Réduisez-le à ce que chaque gravité mérite :

| Gravité | Un ensemble sensé |
| --- | --- |
| Critique | Push tout de suite, un appel après 5 minutes |
| Majeure | Push tout de suite, un SMS après 10 minutes |
| Mineure ou faible | Un e-mail tout de suite |

Vos propres règles n'ont pas d'heures calmes : gardez les faibles gravités sur l'e-mail, ou sur une règle push réglée sur **Standard**, pour qu'elles ne vous réveillent jamais. Pour que l'alerte d'une faible gravité attende les heures ouvrées pour tout le monde, réglez la règle d'astreinte qui la déclenche sur **Uniquement pendant les heures ouvrées** : voir [Règles d'astreinte](/docs/alerts/settings#règles-dastreinte).

## Ajouter une règle

:::steps
### Ouvrir la carte

Allez dans **Paramètres utilisateur → Règles d'astreinte**, ouvrez l'onglet du type d'alerte et trouvez la carte de la gravité.

### Choisir la méthode

Cliquez sur **Ajouter : Règle de notification**. Dans **Méthode de notification**, choisissez l'une de vos méthodes vérifiées ; une méthode que vous n'avez pas vérifiée n'est pas proposée.

### Choisir le son d'un push

Pour un téléphone, choisissez **Notification push** : **Alerte critique** ou **Standard**. Pour tout appareil push, choisissez **Répéter jusqu'à la prise en compte**. Voir [Règles push](#règles-push).

### Fixer le délai

Choisissez **Me notifier après** : **Immédiatement**, **5 minutes**, **10 minutes**, **15 minutes**, **30 minutes** ou **1 heure**. Cliquez ensuite sur **Ajouter : Règle de notification** dans la boîte de dialogue.
:::

La carte liste ses règles dans l'ordre de leur délai, avec **Méthode de notification** et **Notifier après** pour chacune.

## Modifier ou supprimer une règle

- **Modifier** dans la ligne d'une règle change son délai. Pour envoyer une règle vers une autre méthode, supprimez-la et ajoutez-en une nouvelle.
- Sur une règle push, cliquez sur l'étiquette sous la méthode pour passer de **Alerte critique** à **Standard**, ou pour changer la fréquence de répétition. C'est enregistré aussitôt.
- **Supprimer** demande d'abord une confirmation, et indique si la gravité se retrouve sans règle. Une gravité sans règle se rabat sur vos méthodes vérifiées ; voir [Quand une gravité n'a pas de règle](#quand-une-gravité-na-pas-de-règle).

## Règles push

Une règle qui alerte un téléphone indique comment son push sonne :

| Choix | Ce que fait le téléphone |
| --- | --- |
| **Alerte critique** | Sonne même quand le téléphone est en silencieux ou en Ne pas déranger, une fois Critical On-Call Alerts activé dans l'application OneUptime On-Call. Une nouvelle règle de téléphone commence ici. |
| **Standard** | Suit les réglages de son, de silencieux et de Ne pas déranger du téléphone. |

Une règle push, pour un téléphone ou un navigateur, peut aussi renvoyer son push jusqu'à ce que quelqu'un prenne en compte : **Ne pas répéter**, par défaut, ou **Chaque minute**, **Toutes les 2 minutes**, **Toutes les 3 minutes**, **Toutes les 5 minutes**, **Toutes les 10 minutes**, **Toutes les 15 minutes** ou **Toutes les 30 minutes**. Elle se répète jusqu'à 10 fois de plus, et s'arrête dès que l'incident, l'alerte ou l'épisode est pris en compte. Voir [Alertes d'astreinte critiques](/docs/self-hosted/push-notifications#alertes-dastreinte-critiques-outrepasser-le-mode-silencieux).

## Quand une gravité n'a pas de règle

Une gravité que votre projet ajoute plus tard reçoit des règles en quelques minutes, faites à partir des choix que vous avez déjà faits sur cet onglet : les mêmes méthodes, après les mêmes délais. Si vous n'aviez aucune règle sur cet onglet, elle reçoit votre e-mail vérifié, tout de suite.

Une alerte qui ne trouve toujours pas de règle est quand même envoyée à vos méthodes vérifiées, et vous recevez un e-mail à ce sujet ; voir [Quand aucune règle ne correspond](/docs/notifications/index#quand-aucune-règle-ne-correspond).

:::details Désactiver une gravité exprès
L'API peut enregistrer une règle de désinscription, avec `isOptOut` activé et sans méthode : vous n'êtes alors pas du tout alerté pour ce type d'alerte et cette gravité, et rien ne prend le relais. La ligne affiche **Muted - notifications turned off for this rule**, et la supprimer réactive les alertes. Une gravité ajoutée plus tard est aussi muette quand chaque règle que vous avez sur cet onglet est une désinscription.
:::

:::details Désactiver le repli pour tout un projet
Un propriétaire du projet, ou une personne disposant de **Manage Billing**, peut définir `disableOnCallNotificationFallback` du projet via l'API. Une alerte qui ne trouve pas de règle n'est alors pas livrée, et son journal indique que l'utilisateur doit ajouter des règles dans **Paramètres utilisateur → Règles d'astreinte**.
:::

## Les règles d'un coéquipier

Les propriétaires et les admins du projet peuvent voir et modifier la même page pour toute personne du projet : dans **Utilisateurs**, ils ouvrent la personne, puis **Règles d'astreinte** dans la section **Astreinte**. **Disponibilité**, juste à côté, montre si chaque gravité la joint. Quand quelqu'un d'autre ajoute, modifie ou supprime vos règles, vous recevez un e-mail à ce sujet, et chaque changement figure dans le journal d'audit du projet.

## Dépannage

:::details Mon téléphone est resté silencieux pour une alerte critique
Vérifiez que le push de la règle est **Alerte critique** et non **Standard**, et que **Alertes critiques** est activé pour le téléphone dans **Paramètres utilisateur → Méthodes de notification**, onglet **Push Notifications**.
:::

:::details Je suis alerté deux fois pour chaque incident
Chaque méthode vérifiée a une règle pour chaque gravité, envoyée tout de suite. Supprimez les règles dont vous ne voulez pas, ou donnez-leur un délai. Un incident dans un épisode peut vous alerter une fois pour l'incident et une fois pour l'épisode, par deux politiques.
:::

:::details J'ai reçu un e-mail alors que ma règle dit SMS
L'alerte n'a trouvé aucune règle pour son type ou sa gravité, et s'est rabattue sur vos méthodes gratuites : ajoutez la règle sur le bon onglet et la bonne carte. Ou l'e-mail était une nouvelle sur un élément dont vous êtes propriétaire, qui suit les **Paramètres de notification**, pas vos règles. Vos **Journaux d'astreinte** ne listent que les alertes.
:::

## Étapes suivantes

:::cards
- [Méthodes de notification](/docs/notifications/notification-methods): Ajoutez et vérifiez les méthodes vers lesquelles pointent vos règles.
- [Règles d'escalade](/docs/on-call/escalation-rules): Comment une politique d'astreinte alerte les personnes, niveau par niveau.
- [Notifications push](/docs/self-hosted/push-notifications): Alertes critiques, sons d'alarme et répétitions sur les téléphones.
- [Comment OneUptime vous joint](/docs/notifications/index): Comment les méthodes, les règles et les paramètres s'articulent.
:::
