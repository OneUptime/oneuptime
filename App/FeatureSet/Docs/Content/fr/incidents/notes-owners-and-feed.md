# Notes, propriétaires et fil d'activité

Chaque incident accumule une trace écrite pendant que vous le traitez. Une partie de cette trace est destinée à vos clients — la mise à jour publiée sur la page de statut à 02h14 annonçant que vous avez trouvé le mauvais déploiement. Le reste est destiné à votre équipe — la trace d'appels que quelqu'un a collée, le graphique qui a fini par avoir du sens, la décision de basculer.

OneUptime tient ces deux publics séparés. Les **Notes publiques** sont publiées sur votre page de statut et peuvent notifier les abonnés. Les **Notes privées** (le modèle `IncidentInternalNote`) restent à l'intérieur du tableau de bord. Sous les deux se trouve le **Fil d'incident**, une chronologie en ajout seul qui enregistre tout ce qui est arrivé à l'incident, et la liste des **Propriétaires**, qui décide qui est prévenu.

Tout cela se rattache au menu latéral gauche de l'incident : **Notes → Notes publiques**, **Notes → Notes privées**, et **Équipe → Propriétaires**. Le fil se trouve sur la page **Vue d'ensemble** de l'incident.

## Notes publiques et notes privées

Les deux types de notes se ressemblent dans le tableau de bord et se comportent très différemment.

- **Notes publiques** — le modèle `IncidentPublicNote`, servi aux pages de statut dans le cadre de la chronologie de l'incident. Elles portent une date **Publié le** que vous pouvez définir vous-même et une case à cocher **Notifier les abonnés de la page de statut**.
- **Notes privées** — le modèle `IncidentInternalNote`. Rien dans l'application de page de statut ne les lit. Elles n'ont pas de champ de date de publication (la liste est horodatée et triée par `createdAt`) ni aucun champ lié aux abonnés : une note privée ne peut donc jamais déclencher de notification aux abonnés.

**Ce que « privée » signifie réellement.** Cela signifie « non publiée sur la page de statut » — et non « réservée à un groupe restreint de personnes ». Les deux types de notes partagent les mêmes permissions de lecture : quiconque peut lire l'incident peut lire ses notes privées. Si vous devez restreindre qui peut voir l'incident tout court, utilisez l'indicateur **Incident privé** (`isPrivate`) sur l'incident lui-même, qui masque l'incident de toutes les pages de statut et le limite aux utilisateurs propriétaires de l'incident, aux membres de ses équipes propriétaires, ainsi qu'aux administrateurs et propriétaires du projet.

**Les propriétaires voient les deux.** La tâche de notification des propriétaires interroge conjointement les notes publiques et privées. Une note privée est privée vis-à-vis de vos abonnés, pas vis-à-vis des personnes qui répondent.

| Si vous voulez…                                                    | Choisissez        |
| ------------------------------------------------------------------ | ----------------- |
| Dire aux clients ce que vous savez et quand vous en saurez plus    | **Note publique** |
| Antidater une mise à jour que vous avez déjà envoyée ailleurs      | **Note publique** |
| Consigner une hypothèse, une commande exécutée ou une impasse      | **Note privée**   |
| Joindre un vidage mémoire ou une capture d'un tableau de bord interne | **Note privée** |

## Publier une note publique

Ouvrez **Notes → Notes publiques** dans le menu latéral de l'incident et créez une note. La carte explique que ce que vous écrivez ici apparaît sur la page de statut ; l'état vide indique qu'aucune note publique n'a été créée pour cet incident jusqu'ici.

| Champ                                            | Objet                                                                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| **Note d'incident publique**                     | Le corps, en Markdown. Obligatoire. Le formulaire vous rappelle que la note est visible sur votre page de statut et lie une antisèche. |
| **Pièces jointes**                               | Des fichiers partagés avec les abonnés sur la page de statut. Facultatif.                                                       |
| **Notifier les abonnés de la page de statut**    | Case à cocher, activée par défaut. Désactivez-la pour publier discrètement.                                                     |
| **Publié le**                                    | Date et heure obligatoires, prérempli à maintenant, affiché dans votre fuseau horaire actuel.                                   |

**Publié le est le véritable horodatage de la note.** Les pages de statut trient et affichent les notes publiques par `postedAt`, et non par le moment où vous les avez saisies — donc si vous mettez la page de statut à jour d'une communication envoyée il y a 40 minutes, réglez **Publié le** sur le moment où cela s'est réellement produit. Si une note arrive par l'API sans cette date, OneUptime y appose l'heure courante.

La liste affiche qui a écrit chaque note, son **Publié le**, le Markdown rendu avec ses pièces jointes, et une colonne **Statut de notification de l'abonné**. Vous pouvez filtrer par **Créé par**, **Note** et **Créé le**.

## Publier une note privée

**Notes → Notes privées** est délibérément plus dépouillé. Il n'y a que deux champs :

- **Note d'incident privée** — corps en Markdown, obligatoire. Le formulaire dit franchement que ceci est privé pour votre équipe et n'est pas visible sur la page de statut.
- **Pièces jointes** — des fichiers destinés à l'équipe de réponse à incident.

Pas de **Publié le**, pas de case à cocher pour les abonnés — la note est horodatée à sa création.

## Pièces jointes des notes

Les deux types de notes acceptent des fichiers joints via un champ **Pièces jointes**, et tous deux affichent une liste de pièces jointes sous le corps de la note avec un lien **Download attachment** par fichier.

Là où ils divergent, c'est sur qui peut récupérer le fichier :

- **Les pièces jointes des notes publiques** sont téléchargeables par les visiteurs de la page de statut via une route de la page de statut, aux côtés de la note elle-même.
- **Les pièces jointes des notes privées** ne sont accessibles que par l'API authentifiée du tableau de bord. Il n'existe aucune route de page de statut pour elles.

Les pièces jointes relèvent donc de la même décision public/privé que le texte de la note. Une image de chronologie destinée aux clients va sur une note publique ; un vidage de configuration va sur une note privée.

## Générer une note avec l'IA

Les deux pages de notes portent un bouton **Generate with AI**. Il envoie l'incident au fournisseur d'IA de votre projet et dépose le Markdown généré dans l'éditeur de note, où vous le modifiez avant d'enregistrer — rien n'est publié automatiquement.

- **Generate Public Note with AI** — décrit comme analysant les données de l'incident pour produire une note destinée aux clients. Les modèles incluent **Status Update** et **Resolution Notice**.
- **Generate Private Note with AI** — produit à la place une note technique interne. Les modèles incluent **Investigation Update** et **Technical Analysis**.

Derrière le bouton, le tableau de bord effectue un POST vers `/incident/generate-note-from-ai/{incidentId}` avec le modèle choisi et un type de note `public` ou `internal`.

## Modèles de notes

Si votre équipe écrit les trois mêmes mises à jour à chaque panne, enregistrez-les une bonne fois. Les deux pages de notes ont un bouton **Créer à partir d'un modèle** qui ouvre un sélecteur **Créer une note à partir d'un modèle** avec une liste déroulante **Sélectionner le modèle de note**.

Les modèles sont partagés entre notes publiques et privées : une seule liste de modèles sert aux deux, et le même modèle peut être inséré dans l'un ou l'autre type de note.

Vous les gérez dans **Incidents → Paramètres → Modèles de notes** — la carte s'intitule **Modèles de notes publiques ou privées pour les incidents** et son formulaire comporte une étape **Informations du modèle** (**Nom du modèle** et **Description du modèle**, tous deux obligatoires) et une étape **Détails de la note** pour le corps. Si vous cliquez sur **Créer à partir d'un modèle** avant d'en avoir créé un, OneUptime vous indique qu'il n'en existe aucun ; notez que le message pointe vers les Paramètres du projet, alors que la page se trouve en réalité sous **Incidents → Paramètres → Modèles de notes**.

## Publier des notes depuis Slack ou Microsoft Teams

Si vous avez connecté un espace de travail, les intervenants n'ont jamais besoin de quitter le canal. Slack comme Microsoft Teams exposent une action d'ajout de note qui ouvre une fenêtre avec une liste déroulante proposant **Note publique** ou **Note privée**, plus une zone de texte, et écrit le résultat directement sur l'incident.

Deux détails à connaître :

- **Protection contre les doublons** — chaque note enregistre le message Slack dont elle provient (`postedFromSlackMessageId`, au format `channel_id:message_ts`), de sorte que plusieurs personnes réagissant au même message produisent une note, pas cinq.
- **Les notes reviennent en écho** — publier l'un ou l'autre type de note pousse aussi un message dans le canal d'incident connecté, car l'élément de fil de la note est créé avec la notification d'espace de travail activée.

## Quand une note publique atteint réellement les abonnés

Créer une note publique avec **Notifier les abonnés de la page de statut** activé ne garantit pas à soi seul qu'un e-mail parte. La note doit franchir une chaîne de vérifications, et chaque échec enregistre une raison précise plutôt que de provoquer une erreur :

1. **Notifier les abonnés de la page de statut** doit être activé. Sinon, la note est marquée comme ignorée dès sa création.
2. La note doit appartenir à un incident qui existe encore.
3. L'incident doit avoir au moins un moniteur rattaché — sans moniteur, il n'y a aucune ressource de page de statut vers laquelle acheminer la note.
4. L'indicateur **Visible sur la page de statut** (`isVisibleOnStatusPage`) de l'incident doit être vrai.
5. Chaque page de statut atteinte par l'incident doit avoir **Afficher les incidents** (`showIncidentsOnStatusPage`) activé.
6. Chaque abonné doit satisfaire ses propres préférences — non désabonné, et abonné à cette ressource ainsi qu'au type d'événement `Incident` là où la page laisse les abonnés choisir.

**Les notifications ne sont pas instantanées.** La tâche qui les envoie s'exécute une fois par minute : comptez jusqu'à environ une minute entre l'enregistrement de la note et le départ du courrier. C'est ce que signifie le libellé **Sending Soon**.

La colonne **Statut de notification de l'abonné** suit tout le parcours :

| Statut                       | Signification                                                        |
| ---------------------------- | -------------------------------------------------------------------- |
| **Notifications skipped.**   | L'une des barrières ci-dessus s'est fermée. La raison est enregistrée. |
| **Sending Soon**             | En file d'attente, en attente de la prochaine exécution de la tâche d'envoi. |
| **Notifications Being Sent** | La tâche parcourt la liste des abonnés.                              |
| **Notifications envoyées**   | Toutes les notifications aux abonnés sont parties.                   |
| **Échec**                    | La tâche a levé une erreur ; celle-ci est stockée avec la note.      |

Cliquez sur **plus de détails** sur le statut pour ouvrir **Détails du statut de la notification**. Là où un renvoi a du sens, le bouton de cette fenêtre est **Retry**, qui remet la note en attente pour que la prochaine exécution la reprenne.

Le message que reçoivent réellement les abonnés est gabaritisé par page de statut et par canal — e-mail, SMS, Slack et Microsoft Teams ont chacun leur propre modèle pour l'événement **Subscriber Incident Note Created**, avec des variables pour le nom et l'URL de la page de statut, le lien vers les détails, les ressources affectées, la gravité et le titre de l'incident, le corps de la note et un lien de désabonnement propre à chaque abonné. Voyez [Abonnés et annonces](/docs/status-pages/subscribers) pour la configuration de ces modèles et canaux.

## Le fil d'incident

La carte **Fil d'incident** se trouve au bas de la colonne de gauche sur la page **Vue d'ensemble** de l'incident. C'est l'histoire de l'incident dans l'ordre : chaque élément comporte une icône, l'avatar et le nom de la personne qui l'a provoqué, un horodatage relatif avec l'heure locale exacte au survol, et un corps en Markdown. Les éléments sont triés du plus ancien au plus récent.

Certains éléments portent des détails supplémentaires — une notification de propriétaire liste par exemple toutes les personnes qui ont reçu un e-mail. Ceux-là affichent un bouton **More Information** qui ouvre un panneau **More Information**.

L'en-tête de la carte comporte aussi un menu **Actions** pour agir sans quitter la chronologie :

- **Execute Runbook** — lancer un [runbook](/docs/runbooks/index) sur cet incident.
- **Exécuter la politique d'astreinte** — alerter une politique à la demande.
- **Ajouter une note publique** — les quatre mêmes champs que la page Notes publiques, dans une fenêtre.
- **Ajouter une note privée** — corps de note et pièces jointes uniquement.

À côté, **Actualiser** recharge le fil.

**Le fil est en ajout seul, et ce n'est pas votre journal d'audit.** L'API permet de créer et de lire des éléments de fil mais pas de les mettre à jour ni de les supprimer : personne ne peut donc réécrire discrètement l'histoire d'un incident. Il n'est pas permanent pour autant : sur les installations facturées, les lignes de fil de plus de trois ans sont supprimées. Pour une trace durable de qui a changé quoi, utilisez **Audit → Journaux d'audit** dans le menu latéral de l'incident.

## Ce que le fil enregistre

Les éléments de fil sont écrits par le service d'incident lui-même, par les deux services de notes, par la chronologie d'état, par les changements de propriétaires et de membres, par les moteurs de règles, par l'exécution d'astreinte, par les moteurs d'investigation et de post-mortem par IA, et par les tâches cron de notification. Les types d'événements couvrent :

- **L'incident lui-même** — `IncidentCreated`, `IncidentUpdated`, `IncidentStateChanged`.
- **Notes et comptes rendus** — `PublicNote`, `PrivateNote`, `RootCause`, `RemediationNotes`, `PostmortemNote`.
- **Les personnes** — `OwnerUserAdded`, `OwnerTeamAdded`, `OwnerUserRemoved`, `OwnerTeamRemoved`, `IncidentMemberAdded`, `IncidentMemberRemoved`.
- **Les notifications** — `OwnerNotificationSent`, `SubscriberNotificationSent`, `OnCallPolicy`, `OnCallNotification`.
- **L'automatisation** — `LabelRuleExecuted`, `OwnerRuleExecuted`, `PrivacyRuleExecuted`, `OnCallRuleExecuted`, `AutoRemediation`.

Chaque type reçoit sa propre icône : vous pouvez ainsi parcourir un long fil et repérer les changements d'état au milieu du bavardage. L'analyse de cause racine générée par IA est signalée distinctement et rendue dans un mode Markdown restreint.

Les fils respectent la confidentialité des incidents : pour les incidents privés, les lectures du fil sont filtrées de la même façon que l'incident.

## Propriétaires

Les propriétaires sont les personnes et les équipes responsables d'un incident. Ce sont les destinataires des notifications pour tout ce qui lui arrive — et ce sont eux qui évitent qu'un incident passe inaperçu pendant que chacun suppose que quelqu'un d'autre s'en occupe.

Ouvrez **Équipe → Propriétaires** dans le menu latéral de l'incident. La carte **Propriétaires** affiche un badge de comptage et décrit les propriétaires comme les personnes et les équipes responsables de cet incident, notifiées des changements, avec un décompte courant du type « 2 personnes · 1 équipe ». Les propriétaires s'affichent en avatars superposés ; survoler l'un d'eux montre l'e-mail de la personne ou signale l'entrée comme une **Équipe**.

- Cliquez sur **Ajouter un propriétaire** pour ouvrir un sélecteur avec un champ de recherche de personnes ou d'équipes.
- Cliquez sur le contrôle de suppression d'un avatar pour ouvrir la confirmation **Supprimer le propriétaire**, puis **Supprimer**.
- Sans propriétaire, la carte le signale et vous invite à ajouter un coéquipier ou une équipe pour qu'ils soient notifiés des changements.

Les utilisateurs propriétaires et les équipes propriétaires sont des enregistrements distincts — ajouter une équipe rend chaque membre de cette équipe propriétaire aux fins de notification, sans les lister individuellement.

## Comment les propriétaires sont attribués

Il y a quatre voies vers la liste des propriétaires :

- **Depuis un modèle d'incident** — les modèles portent les champs **Propriétaire - Équipes** et **Propriétaire - Utilisateurs**, décrits comme les équipes et les utilisateurs qui possèdent l'incident et seront notifiés à sa création ou à sa mise à jour. Créer un incident à partir du modèle les préremplit. Voyez [Déclarer un incident](/docs/incidents/declaring-incidents).
- **Depuis les règles de propriétaire d'incident** — les règles correspondantes ajoutent des propriétaires automatiquement au moment de la création.
- **À la création via l'API** — les utilisateurs et équipes propriétaires transmis avec l'appel de création sont ajoutés immédiatement, avec un indicateur qui contrôle s'ils reçoivent l'e-mail « vous avez été ajouté ».
- **À la main** — le contrôle **Ajouter un propriétaire** sur la page **Propriétaires**, à tout moment pendant l'incident.

Ajouter deux fois la même personne est sans risque ; les propriétaires déjà attribués ne sont pas dupliqués.

## Règles de propriétaire d'incident

Les **Règles de propriétaire d'incident** attribuent automatiquement des utilisateurs et des équipes propriétaires quand des incidents correspondants sont créés — la couche de routage qui fait qu'un incident de base de données atterrit chez l'équipe base de données sans que personne n'ait à y penser. Vous les trouverez avec le reste de l'automatisation des incidents, couverte dans [Paramètres et automatisation des incidents](/docs/incidents/settings).

Le formulaire de règle comporte trois étapes — **Informations de base**, **Critères de correspondance** et **Propriétaires** — et l'étape des propriétaires contient deux sections :

- **Propriétaires à attribuer** — choisissez des **Équipes propriétaires** et des **Utilisateurs propriétaires**. Quand la règle correspond, chaque utilisateur et chaque équipe sélectionnés sont ajoutés comme propriétaires, et les propriétaires déjà attribués ne sont pas dupliqués.
- **Hériter des propriétaires** — attribuez des propriétaires depuis des entités liées plutôt que de les nommer. **Hériter des propriétaires des moniteurs** rend chaque propriétaire des moniteurs de l'incident propriétaire de l'incident, et **Hériter des propriétaires des hôtes**, **… des clusters Kubernetes**, **… des hôtes Docker**, **… des hôtes Podman** et **… des services** font de même pour ces ressources.

Une bascule **Notifier les propriétaires** contrôle si les personnes sont mises au courant. Laissez-la activée pour du vrai routage ; désactivez-la pour ajouter des propriétaires en silence — utile quand une règle relève de la commodité comptable plutôt que de l'alerte.

Chaque exécution de règle est écrite dans le fil d'incident : vous pouvez toujours dire si une personne a été ajoutée par une règle ou par un humain.

## Ce dont les propriétaires sont notifiés

Cinq tâches notifient les propriétaires, chacune s'exécutant une fois par minute :

- **Incident créé** — objet `[New Incident {number}] - {title}`.
- **Une note a été publiée** — pour les notes publiques *et* privées, objet `[Update Incident {number}] - {title}`.
- **L'état de l'incident a changé** — voyez [États et sévérités des incidents](/docs/incidents/states-and-severities).
- **Vous avez été ajouté comme propriétaire** — objet `You have been added as the owner of Incident {number} - {title}`.
- **Toujours non résolu** — un rappel piloté par l'heure de prochain rappel de l'incident, objet `[Reminder] Incident {number} is still {state} - {title}`.

Chaque notification est construite pour l'e-mail, le SMS, l'appel vocal, la notification push et WhatsApp, puis remise aux paramètres de notification de l'utilisateur, qui décident de ce qui est réellement envoyé. Chaque destinataire peut désactiver chacune d'elles individuellement — les paramètres par utilisateur sont formulés comme l'envoi des notifications d'incident créé, de note publiée, d'état modifié, de propriétaire ajouté, de membre assigné et de rappel d'incident encore ouvert. Quelqu'un qui ne veut un appel que pour les changements d'état peut avoir exactement cela.

**Les incidents sans propriétaire ne sont pas silencieux.** Si un incident n'a aucun propriétaire, les tâches de notification retombent sur les propriétaires du projet : rien n'est laissé de côté. Chaque personne notifiée est également ajoutée à l'élément de fil correspondant, ce qui vous permet de voir après coup exactement qui a été prévenu et à quelle adresse.

## Pour aller plus loin

- [Vue d'ensemble des incidents](/docs/incidents/index) — ce qu'est un incident et comment les pièces s'assemblent.
- [Déclarer un incident](/docs/incidents/declaring-incidents) — créer des incidents à la main, depuis des modèles et depuis des moniteurs.
- [États et sévérités des incidents](/docs/incidents/states-and-severities) — la machine à états qui alimente la moitié du fil.
- [Paramètres et automatisation des incidents](/docs/incidents/settings) — règles de propriétaire, modèles de notes et le reste de l'automatisation.
- [Abonnés et annonces](/docs/status-pages/subscribers) — où finissent les notes publiques et qui les reçoit.
- [Vue d'ensemble des pages de statut](/docs/status-pages/index) — la face client d'un incident.
