# Abonnés et annonces

Une page de statut est un endroit où les gens se rendent. Les abonnés, eux, préféreraient s'en dispenser — ils vous confient une fois une adresse e-mail, un numéro de téléphone, un webhook Slack ou un point de terminaison HTTP, et à partir de là ce sont vos mises à jour qui viennent à eux.

Les annonces sont l'autre moitié du même travail. Un moniteur peut dire à vos visiteurs que le paiement renvoie des 500 ; aucun moniteur ne peut leur dire que vous migrez des bases de données samedi, qu'un prestataire tiers passe une mauvaise journée, ou que l'incident dont ils ont entendu parler hier est définitivement clos. Les annonces sont le canal en texte libre pour tout ce que vos vérifications ne voient pas, et elles partent vers cette même liste d'abonnés.

Cette page couvre les deux : les cinq canaux d'abonnement et la façon dont les visiteurs s'inscrivent, ce que les abonnés peuvent choisir de recevoir, les parcours de double opt-in et de désabonnement, et la manière dont les annonces s'écrivent, se planifient et se transforment en modèles.

## Les canaux d'abonnement

Une page de statut prend en charge cinq canaux, chacun avec sa propre bascule sur la page. Allez dans **Pages de statut → votre page → Abonnés → Paramètres des abonnés** :

- **Activer les abonnés par e-mail** (`enableEmailSubscribers`) — activé par défaut. Tout le reste est désactivé tant que vous ne l'activez pas.
- **Activer les abonnés par SMS** (`enableSmsSubscribers`) — désactivé par défaut.
- **Activer les abonnés Slack** (`enableSlackSubscribers`) — désactivé par défaut.
- **Activer les abonnés Microsoft Teams** (`enableMicrosoftTeamsSubscribers`) — désactivé par défaut.
- **Activer les abonnés Webhook** (`enableWebhookSubscribers`) — désactivé par défaut.

Chaque canal reçoit aussi sa propre liste dans le menu latéral de la page de statut, sous **Abonnés** : **Abonnés e-mail**, **Abonnés SMS**, **Abonnés Slack**, **Abonnés MS Teams** et **Abonnés au webhook**. C'est là que vous regardez qui est inscrit, que vous ajoutez quelqu'un à la main, ou que vous vous laissez une entrée **Notes** (`internalNote`) sur un abonné en particulier.

**Une seule bascule ne suffit pas.** L'entrée **S'abonner** de la barre de navigation de la page de statut n'apparaît que si **Afficher la page des abonnés** (`showSubscriberPageOnStatusPage`) est activé *et* qu'au moins un canal est activé. Si vous activez **Activer les abonnés par e-mail** mais laissez **Afficher la page des abonnés** désactivé, les visiteurs n'ont aucun moyen d'atteindre le formulaire.

Les cinq mêmes bascules apparaissent une seconde fois dans la carte **Paramètres des abonnés** des **Paramètres avancés**, aux côtés d'**Afficher la page des abonnés**. Ce sont les mêmes colonnes en dessous — choisissez un écran et tenez-vous-y, en privilégiant la page dédiée **Paramètres des abonnés**, puisque c'est là que vit le reste de la configuration des abonnés.

## Ce que voit un visiteur sur la page S'abonner

La page **S'abonner** possède un sous-menu avec un onglet par canal activé — **E-mail**, **SMS**, **Slack**, **MS Teams**, **Webhooks** — associés à `/subscribe/email`, `/subscribe/sms`, `/subscribe/slack`, `/subscribe/microsoft-teams` et `/subscribe/webhooks`. Chaque onglet demande le strict minimum dont il a besoin :

- **E-mail** — titre **S'abonner par e-mail**, un seul champ **Votre e-mail** avec l'espace réservé `subscriber@company.com`.
- **SMS** — titre **S'abonner par SMS**, un seul champ **Votre numéro de téléphone** avec l'espace réservé `+11234567890`.
- **Slack** — titre **S'abonner via Slack**, avec **Nom de l'espace de travail Slack** (utilisé pour la validation) et **URL du webhook entrant Slack**, espace réservé `https://hooks.slack.com/services/...`.
- **MS Teams** — titre **S'abonner via Microsoft Teams**, avec **Nom de l'espace de travail Microsoft Teams** et **URL du webhook entrant Microsoft Teams**, espace réservé `https://outlook.office.com/webhook/...`.
- **Webhooks** — titre **S'abonner par webhook**, un seul champ **URL du webhook**. Une requête JSON `POST` y est envoyée à chaque événement de la page de statut.

Le bouton d'envoi porte la mention **S'abonner**, et une inscription réussie affiche *Vous avez été abonné avec succès.* La page porte aussi une séparation **Nouvel abonnement** / **Gérer l'abonnement existant**, pour que quelqu'un déjà abonné puisse revenir à ses préférences sans avoir à retrouver un vieil e-mail.

## Laisser les abonnés choisir ressources et types d'événements

Par défaut, un abonné reçoit tout ce qui se passe sur la page. Deux bascules de la carte **Paramètres avancés des abonnés** changent cela :

- **Permettre aux abonnés de choisir les ressources** (`allowSubscribersToChooseResources`) — désactivé par défaut. Activez-le et le formulaire d'abonnement gagne une bascule **S'abonner à toutes les ressources** ; décochez-la et **Sélectionner les ressources à suivre** apparaît, pour que le visiteur choisisse des ressources une par une.
- **Permettre aux abonnés de choisir les types d'événements** (`allowSubscribersToChooseEventTypes`) — désactivé par défaut. Même forme : une bascule **S'abonner à tous les types d'événements**, et **Sélectionner les types d'événements à suivre** en dessous lorsqu'elle est décochée.

Les types d'événements sont `Incident`, `Announcement` et `Scheduled Event`.

Les choix atterrissent sur la fiche de l'abonné sous **Is Subscribed to All Resources** (`isSubscribedToAllResources`, `true` par défaut), **Is Subscribed to All Event Types** (`isSubscribedToAllEventTypes`, `true` par défaut), **Subscribed to Resources** et **Subscribed to Event Types**.

Utile pour : une page qui couvre plusieurs produits. Un client qui n'utilise que votre API n'a pas envie d'une notification chaque fois que le site marketing vacille — laissez-le restreindre la liste lui-même plutôt que de le regarder se désabonner complètement.

La même carte porte aussi **Fuseaux horaires des abonnés**.

## Double opt-in par e-mail

Les abonnés par e-mail confirment toujours. Quand un abonné est créé avec une adresse e-mail sans être déjà confirmé, **Is Subscription Confirmed** (`isSubscriptionConfirmed`) est forcé à `false` et un **Subscription Confirmation Token** à six chiffres est généré. OneUptime envoie alors par e-mail un lien de confirmation de la forme `{statusPageUrl}/confirm-subscription/{statusPageSubscriberId}?verification-token={token}`. Le visiteur atterrit sur une page **Confirmer l'abonnement** et, une fois l'opération passée, voit *Abonnement confirmé avec succès*.

Les abonnés SMS, Slack, Microsoft Teams et webhook sautent cette étape — ils sont créés avec `isSubscriptionConfirmed` déjà à `true`.

**Non confirmé veut dire silencieux.** La requête qui récupère les abonnés pour une notification filtre sur `isUnsubscribed: false` et `isSubscriptionConfirmed: true`. Une adresse e-mail qui n'a jamais cliqué sur le lien restera dans votre liste **Abonnés e-mail** sans jamais rien recevoir. Si quelqu'un jure être abonné mais n'entend rien, vérifiez cette colonne en premier.

Il n'existe aucune bascule pour désactiver la confirmation par e-mail — elle est inconditionnelle pour quiconque s'inscrit depuis la page de statut. Une autre colonne, propre à chaque abonné, **Send You Have Subscribed Message** (`sendYouHaveSubscribedMessage`, `true` par défaut), commande l'e-mail « vous êtes abonné » qui part une fois l'abonné confirmé.

## Gérer et résilier un abonnement

Chaque e-mail envoyé à un abonné porte un lien de désabonnement de la forme `{statusPageUrl}/update-subscription/{statusPageSubscriberId}`. Cette page s'intitule **Mettre à jour l'abonnement** et indique au visiteur qu'il peut y modifier ses préférences ou se désabonner. Elle contient :

- Les sélecteurs de ressources et de types d'événements que la page autorise, le cas échéant.
- Une bascule **Se désabonner**, décrite comme un désabonnement de toutes les ressources. Elle écrit **Est désabonné** (`isUnsubscribed`, `false` par défaut).
- Un bouton d'envoi portant la mention **Mettre à jour l'abonnement** ; l'enregistrement affiche *Vos modifications ont été enregistrées.*

Quelqu'un qui a perdu le lien passe par **Gérer l'abonnement existant** sur la page **S'abonner** et clique sur **Envoyer le lien de gestion**. OneUptime répond qu'un e-mail contenant le lien a été envoyé, et invite à vérifier le dossier spam s'il n'arrive pas.

Les points de terminaison derrière tout cela sont `POST .../subscribe/:statusPageId`, `POST .../manage-subscription/:statusPageId`, `POST .../get-subscription/:statusPageId/:subscriberId` et `PUT .../update-subscription/:statusPageId/:subscriberId`.

Se désabonner bascule un indicateur au lieu de supprimer une ligne : la fiche reste donc dans la liste du canal avec **Est désabonné** activé — pratique quand il faut expliquer plus tard pourquoi une adresse précise a cessé de recevoir du courrier.

## Ce dont les abonnés sont prévenus

Les abonnés entendent parler des trois types d'événements ci-dessus, mais chaque source a son propre interrupteur, si bien que rien ne part par accident.

### Notifications d'annonce

L'annonce elle-même porte **Should subscribers be notified?** (`shouldStatusPageSubscribersBeNotified`), exposé sur le formulaire de création sous la case **Notifier les abonnés de la page de statut**, cochée par défaut. Si l'annonce nomme des moniteurs sous **Moniteurs affectés (facultatif)**, la notification est limitée à ces moniteurs ; laissez le champ vide et tous les abonnés sont prévenus.

### Événements de maintenance planifiée

Un événement de maintenance planifiée dispose de son propre jeu de colonnes d'abonnés : **Should subscribers be notified when event is created?**, **Should subscribers be notified when event is changed to ongoing?**, **Should subscribers be notified when event is changed to ended?**, auxquelles s'ajoutent **Subscriber notifications before the event** et **Next subscriber notification before the event at?** pour les avertissements anticipés. **Pages de statut** sur l'événement décide sur quelles pages il apparaît, et **Should be visible on status page?** décide s'il apparaît tout court.

### Incidents

`Incident` est le troisième type d'événement. Ce qui fait qu'un incident arrive sur une page de statut — les ressources qu'il touche et les états qui le gardent visible — est traité dans [États et sévérités des incidents](/docs/incidents/states-and-severities).

La section **Journaux de notification** du menu latéral de la page de statut (`{id}/notification-logs`) est l'endroit où aller quand vous avez besoin de voir ce que la page a réellement envoyé.

## Personnaliser les modèles de notification

La carte **Modèles de notification** des **Paramètres des abonnés** liste les modèles utilisés par cette page de statut, avec les colonnes **Nom du modèle**, **Type d'événement** et **Méthode de notification** — de quoi varier la formulation par type d'événement et par canal, plutôt que d'accepter un seul message maison pour tout.

Les modèles valables pour tout le projet vivent un niveau au-dessus, dans **Pages de statut → Paramètres → Modèles d'abonnés**, à côté de **Modèles d'annonce**.

## Pied de page d'e-mail, SMTP personnalisé et Twilio

Trois autres cartes des **Paramètres des abonnés** commandent la façon dont les messages aux abonnés quittent votre projet :

- **Paramètres du pied de page de l'e-mail** — **Activer le texte personnalisé du pied de page de l'e-mail** et **Texte de pied de page des notifications par e-mail aux abonnés** posent votre propre pied de page sur les e-mails aux abonnés.
- **SMTP personnalisé** — **Configuration SMTP personnalisée** fait passer les e-mails aux abonnés par votre propre serveur de messagerie plutôt que par celui par défaut.
- **Configuration Twilio** — **Configuration Twilio** est le compte Twilio utilisé pour les abonnés SMS.

Le SMTP personnalisé vaut la peine d'être mis en place tôt si vous avez des abonnés par e-mail : un courrier qui part de votre propre domaine a bien moins de chances d'être filtré, et bien plus de chances d'inspirer confiance au client qui le lit à 2 h du matin.

## Les annonces

Une annonce est un enregistrement au niveau du projet (le modèle `StatusPageAnnouncement`) que vous diffusez vers une ou plusieurs pages de statut, éventuellement limité à certains moniteurs, avec une fenêtre pendant laquelle il est affiché.

Vous en créez une depuis **Pages de statut → Plus → Annonces**, ou depuis **Annonces** dans le menu latéral d'une page de statut donnée. Le formulaire de création est un assistant en quatre étapes :

1. **Informations de base** — **Titre de l'annonce** (obligatoire, au moins deux caractères), **Description** (Markdown, facultative) et **Pièces jointes** pour les fichiers qui doivent accompagner l'annonce sur la page de statut.
2. **Pages de statut** — **Afficher l'annonce sur ces pages de statut**, une sélection multiple obligatoire. Une même annonce peut viser plusieurs pages à la fois.
3. **Ressources affectées** — **Moniteurs affectés (facultatif)**. Si vous n'en sélectionnez aucun, tous les abonnés sont prévenus.
4. **Planification et paramètres** — **Commencer à afficher l'annonce à** (obligatoire, réglé sur maintenant par défaut), **Fin de l'affichage de l'annonce à** (facultatif) et **Notifier les abonnés de la page de statut** (activé par défaut).

Les visiteurs lisent les annonces sur `/announcements`, réparties entre **Annonces actives** et **Annonces passées**, chacune datée d'un **Annoncé le**. Les annonces en cours sont en plus épinglées en haut de la page d'aperçu. Quand il n'y a rien à montrer, la page affiche *Aucune annonce* avec la mention qu'aucune n'a été publiée pour l'instant.

Les pièces jointes sont servies depuis `GET {statusPageCrudPath}/status-page-announcement/attachment/:statusPageId/:announcementId/:fileId`, derrière le même contrôle de lecture que la page de statut elle-même — une pièce jointe sur une page privée reste donc privée.

## Comment fonctionne la planification des annonces

**Show At** (`showAnnouncementAt`) et **End At** (`endAnnouncementAt`) commandent tout, mais la page d'aperçu et la liste des annonces ne posent pas la même question, et cette différence fait trébucher.

- **La page d'aperçu** affiche une annonce quand `showAnnouncementAt` est dans le passé et que `endAnnouncementAt` est soit dans le futur, soit vide.
- **La liste `/announcements`** affiche les annonces dont le `showAnnouncementAt` tombe dans la fenêtre **Afficher l'historique des annonces (en jours)** (`showAnnouncementHistoryInDays`, 14 par défaut), puis les répartit côté client entre actives et passées.

Deux conséquences à anticiper :

- **Une annonce sans date de fin n'expire jamais.** Laissez **Fin de l'affichage de l'annonce à** vide et elle reste épinglée indéfiniment sur la page d'aperçu. Mettez une date de fin sur tout ce qui est limité dans le temps.
- **Une annonce ancienne mais toujours active peut disparaître de la liste.** Si elle a commencé il y a plus de `showAnnouncementHistoryInDays`, elle sort de `/announcements` tout en restant sur l'aperçu. Élargissez la fenêtre d'historique si vous gardez des avis de longue durée.

L'apparition même des annonces dépend de la carte **Paramètres de l'annonce** des **Paramètres avancés** : **Afficher les annonces** (`showAnnouncementsOnStatusPage`, activé par défaut) et **Afficher l'historique des annonces (en jours)** (14 par défaut). Avec **Afficher les annonces** désactivé, le point de terminaison des annonces refuse purement et simplement la requête.

## Les modèles d'annonce

Si vous publiez le même genre d'avis à répétition — un rappel de maintenance mensuel, une dégradation récurrente chez un tiers — préparez-le à l'avance. **Pages de statut → Paramètres → Modèles d'annonce** stocke le modèle `StatusPageAnnouncementTemplate`, et son formulaire demande **Nom du modèle**, **Description du modèle**, **Titre de l'annonce**, **Description**, **Afficher l'annonce sur ces pages de statut**, **Moniteurs affectés (facultatif)** et **Notifier les abonnés** : la diffusion et la décision de notifier sont donc prises une fois pour toutes plutôt qu'à chaque fois.

## Les abonnés webhook et la protection contre le SSRF

Les abonnés webhook reçoivent une requête JSON `POST` à chaque événement de la page de statut, ce qui en fait la façon la plus simple d'acheminer les mises à jour de la page vers un système à vous — un chatbot, un tableau de bord interne, une file de tickets.

Comme l'abonnement est une opération publique sur une page publique, OneUptime protège la cible :

- Une **URL du webhook** générique est validée avant d'être acceptée, et les adresses privées, de bouclage, de lien local et de métadonnées cloud sont rejetées. Vous ne pouvez pas pointer un abonnement vers quelque chose situé à l'intérieur du réseau du déploiement OneUptime lui-même.
- Une **URL du webhook entrant Slack** doit commencer par `https://hooks.slack.com/services/`.

Si un abonnement webhook est refusé à l'inscription, une URL interne ou mal formée est la première chose à vérifier.

## Où lire ensuite

- [Vue d'ensemble des pages de statut](/docs/status-pages/index) — ce qu'est une page de statut et comment elle est agencée.
- [Ressources et groupes de la page de statut](/docs/status-pages/resources-and-groups) — les moniteurs et les groupes entre lesquels les abonnés peuvent choisir.
- [Personnalisation et domaines de la page de statut](/docs/status-pages/branding-and-domains) — domaines personnalisés, logos et l'allure de la page vers laquelle pointent vos e-mails.
- [API publique](/docs/status-pages/public-api) — lire les données de la page de statut par programme.
- [États et sévérités des incidents](/docs/incidents/states-and-severities) — ce qui met un incident sur une page de statut et ce qui l'en retire.
- [Paramètres et automatisation des incidents](/docs/incidents/settings) — les règles au niveau du projet derrière la communication d'incident.
