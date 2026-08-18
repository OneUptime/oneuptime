# Paramètres et automatisation

La configuration des incidents ne se trouve pas dans les paramètres du projet. Elle vit à l'intérieur du domaine fonctionnel Incidents lui-même, sous **Incidents → Paramètres** et **Incidents → Règles**, sur des routes qui commencent par `/dashboard/{projectId}/incidents/settings/`. Si vous avez fouillé les **Paramètres du projet** à la recherche des modèles d'incident ou des champs personnalisés, voilà pourquoi vous ne les trouviez pas.

Les sections **Règles** et **Paramètres** du menu latéral Incidents sont repliées par défaut : dépliez-les avant d'espérer voir apparaître ce qui suit. Tout ici est à l'échelle du projet — modèles, rôles, champs personnalisés et règles appartiennent à un projet et s'appliquent à chaque incident qui y est déclaré.

Cette page sert de référence pour cette configuration : ce que contient chaque écran, et ce qui parmi tout cela s'exécute automatiquement dès qu'un incident est créé.

## Où vivent les paramètres d'incident

Ouvrez **Incidents** dans la navigation de gauche, puis dépliez **Paramètres** en bas du menu latéral.

| Écran                        | Ce que vous y faites                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **État de l'incident**       | Ajouter, renommer, recolorer et réordonner les états que traverse un incident.                                       |
| **Gravité de l'incident**    | Ajouter, renommer, recolorer et réordonner les niveaux de gravité.                                                   |
| **Modèles d'incident**       | Préremplir un incident entier — titre, description, ressources, politiques d'astreinte, propriétaires, étiquettes.   |
| **Modèles de notes**         | Du texte réutilisable pour les notes publiques et privées.                                                           |
| **Modèles de post-mortem**   | Des structures de post-mortem réutilisables.                                                                         |
| **Champs personnalisés**     | Définir des champs supplémentaires qui apparaissent sur chaque incident.                                             |
| **Rôles d'incident**         | Définir les rôles auxquels vous affectez les intervenants, comme Incident Commander.                                 |
| **Plus de paramètres**       | Les préfixes de numéro d'incident et d'épisode d'incident.                                                           |

**État de l'incident** et **Gravité de l'incident** sont traités en détail dans [États et sévérités des incidents](/docs/incidents/states-and-severities) — le reste de cette page reprend à partir des **Modèles d'incident**.

Dépliez **Règles** et vous obtenez huit écrans de plus : **Règles de regroupement**, **Règles d'astreinte**, **Règles de propriétaire**, **Règles de runbook**, **Règles de confidentialité**, **Règles d'étiquettes**, **Règles SLA** et **Reminder Rules**. Ils sont traités plus bas.

## Modèles d'incident

Un modèle d'incident est un squelette d'incident enregistré. Plutôt que de retaper le même titre, la même liste de moniteurs et la même politique d'astreinte chaque fois que le cluster de paiement tangue, vous l'enregistrez une fois et vous déclarez à partir de là.

Allez dans **Incidents → Paramètres → Modèles d'incident** (`/dashboard/{projectId}/incidents/settings/templates`). La carte s'intitule **Modèles d'incident**. En créer un vous fait parcourir un assistant en six étapes :

- **Informations du modèle** — **Nom du modèle** et **Description du modèle**. Ils nomment le modèle lui-même ; ils n'apparaissent jamais sur l'incident.
- **Détails de l'incident** — **Titre**, **Description** (en Markdown), **Gravité de l'incident** et **État initial de l'incident**. **État initial de l'incident** est facultatif et démarre vide ; ses options sont listées dans l'ordre des états. Laissez-le vide et les incidents issus de ce modèle atterrissent dans l'état de création du projet.
- **Ressources affectées** — les moniteurs, hôtes, clusters et services auxquels l'incident doit être rattaché, plus **Modifier le statut du moniteur en**.
- **Astreinte** — **Politique d'astreinte**, les politiques à exécuter quand un incident créé depuis ce modèle est déclaré.
- **Propriétaires** — **Propriétaire - Équipes** et **Propriétaire - Utilisateurs**.
- **Étiquettes** — **Étiquettes**.

Quelques règles rapides :

- La liste des modèles n'affiche que **Nom** et **Description**. Les lignes ne se modifient ni ne se suppriment depuis la liste — ouvrez un modèle (`/dashboard/{projectId}/incidents/settings/templates/{modelId}`) pour le changer.
- Les modèles gèrent l'import et l'export JSON, ce qui permet d'en déplacer un d'un projet à l'autre.
- L'état vide affiche « Aucun modèle d'incident trouvé. »

### Comment un modèle s'applique

Il y a deux chemins, et ils se comportent de la même façon.

- **Depuis le tableau de bord** — le bouton **Créer à partir d'un modèle** de la liste des incidents ouvre un sélecteur **Sélectionner le modèle d'incident**, puis la page de déclaration lit le modèle depuis le paramètre de requête `incidentTemplateId` et préremplit le formulaire avec le modèle ainsi que ses équipes et utilisateurs propriétaires.
- **Depuis l'API** — passez `createdIncidentTemplateId` à `POST /api/incident` et le serveur remplit l'incident depuis le modèle.

L'essentiel tient dans la règle de fusion : **un modèle ne remplit qu'un champ que vous avez laissé indéfini**. Titre, description, gravité, état initial, le statut de moniteur derrière **Modifier le statut du moniteur en**, moniteurs, hôtes, clusters Kubernetes, hôtes Docker, hôtes Podman, services, politiques d'astreinte et étiquettes ne sont copiés depuis le modèle que si l'appelant ou le formulaire n'a rien fourni. Tout ce que vous définissez explicitement l'emporte toujours.

**La fenêtre d'état vide pointe au mauvais endroit.** Si vous n'avez encore aucun modèle, le bouton **Créer à partir d'un modèle** affiche une fenêtre **No Incident Templates**. Son texte renvoie vers les paramètres du projet, mais le bouton, lui, mène à **Incidents → Paramètres → Modèles d'incident** — c'est là que ça se passe vraiment.

## Modèles de notes

Les modèles de notes donnent aux intervenants du texte prêt à l'emploi pour les mises à jour d'incident, afin qu'une mise à jour de page de statut à 3 h du matin ne soit pas rédigée de zéro par quelqu'un à moitié endormi.

Allez dans **Incidents → Paramètres → Modèles de notes** (`/dashboard/{projectId}/incidents/settings/note-templates`). La carte s'intitule **Modèles de notes publiques ou privées pour les incidents** — une seule bibliothèque sert les deux types de notes. Le formulaire de création comporte deux étapes :

- **Informations du modèle** — **Nom du modèle** et **Description du modèle**, tous deux obligatoires.
- **Détails de la note** — le corps de la note lui-même, en Markdown, obligatoire.

Comme pour les modèles d'incident, les lignes se créent et se consultent plutôt qu'elles ne s'éditent en place ; ouvrez un modèle pour le modifier.

Les modèles de notes apparaissent là où vous en avez réellement besoin : les fenêtres de confirmation **Acknowledge Incident** et **Resolve Incident** proposent toutes deux **Sélectionner le modèle de note** à côté du champ **Note publique**. Voyez [Notes, propriétaires et fil d'incident](/docs/incidents/notes-owners-and-feed) pour la différence entre notes publiques et privées.

## Modèles de post-mortem

Un modèle de post-mortem est le squelette du compte rendu que vous produisez après un incident — vos intertitres, vos amorces, vos questions récurrentes — pour que chaque revue du projet suive la même forme.

Allez dans **Incidents → Paramètres → Modèles de post-mortem** (`/dashboard/{projectId}/incidents/settings/postmortem-templates`). La carte s'intitule **Modèles de post-mortem**. Le formulaire de création comporte deux étapes :

- **Informations du modèle** — **Nom du modèle** et **Description du modèle**, tous deux obligatoires.
- **Détails du post-mortem** — **Modèle de post-mortem**, le corps lui-même, en Markdown, obligatoire.

L'application se fait depuis l'incident, pas depuis les paramètres. Ouvrez un incident, choisissez **Post-mortem** dans son menu latéral (`/dashboard/{projectId}/incidents/{incidentId}/postmortem`) et utilisez **Appliquer le modèle**. Cela ouvre une fenêtre **Appliquer le modèle de post-mortem** avec une liste déroulante **Sélectionner le modèle** ; en choisir un charge le corps du modèle dans l'éditeur **Note du post-mortem**, où vous le retravaillez avant d'enregistrer. Les épisodes d'incident ont la même page **Post-mortem** et puisent dans la même bibliothèque de modèles.

## Champs personnalisés

Les champs personnalisés vous permettent de porter vos propres métadonnées sur chaque incident : un nom de service interne, une référence de ticket de changement, un niveau de contrat client.

Allez dans **Incidents → Paramètres → Champs personnalisés** (`/dashboard/{projectId}/incidents/settings/custom-fields`). La page s'intitule **Champs personnalisés d'incident**. Chaque définition comporte :

- **Nom du champ** — obligatoire, au moins deux caractères. Le texte indicatif suggère un nom façon slug, comme `internal-service`.
- **Description du champ** — facultatif.
- **Type de champ** — obligatoire. C'est lui qui détermine la manière dont la donnée est saisie. Les types liste déroulante exigent en plus que leurs options soient listées.
- **Options de la liste déroulante** — les valeurs proposées dans la liste, chacune avec une couleur facultative.

Les définitions vivent dans leur propre modèle ; les valeurs, elles, vivent sur l'incident lui-même, dans la colonne `customFields`. Sur un incident donné, vous les renseignez depuis **Champs personnalisés** dans le menu latéral de l'incident (`/dashboard/{projectId}/incidents/{incidentId}/custom-fields`).

**Une lacune à connaître.** Les définitions de champs personnalisés d'incident sont la seule partie de la famille Incidents à n'avoir aucun déclencheur de workflow — voyez la section workflows plus bas.

## Rôles d'incident

Les rôles d'incident sont les fonctions nommées auxquelles vous affectez des personnes pendant une réponse. Définissez-les dans **Incidents → Paramètres → Rôles d'incident** (`/dashboard/{projectId}/incidents/settings/roles`) ; la description de la carte cite Incident Commander et Responder en exemples.

Les rôles ne sont que des définitions. L'affectation des personnes se fait incident par incident — l'assistant de déclaration comporte une étape **Rôles d'incident** avec un champ **Attribuer les rôles de l'incident**, et chaque incident dispose d'une page **Rôles** dans son menu latéral.

## Préfixes de numéro

Chaque incident reçoit un numéro. Par défaut, il s'affiche sous la forme `#42`. Si votre équipe dit « INC-42 » à voix haute, faites en sorte que le produit le dise aussi.

Allez dans **Incidents → Paramètres → Plus de paramètres** (`/dashboard/{projectId}/incidents/settings/more`). La carte s'appelle **Préfixe du nombre** et porte deux champs sur le projet :

- **Préfixe de numéro d'incident** — jusqu'à 20 caractères, texte indicatif `INC-`. Renseignez-le et l'incident `#42` s'affiche `INC-42`.
- **Préfixe de numéro d'épisode d'incident** — la même idée pour les numéros d'épisode d'incident, texte indicatif `IE-`.

Laissez l'un ou l'autre vide pour conserver le préfixe `#` par défaut ; le champ non renseigné affiche `# (default)`. Enregistrez avec **Mettre à jour**. La valeur préfixée est stockée sur l'incident sous `incidentNumberWithPrefix`, et c'est elle que rendent la liste des incidents et l'en-tête de l'incident.

## Les règles qui s'exécutent à la création d'un incident

**Incidents → Règles** regroupe huit moteurs de règles. Ils font tous le même travail — regarder un incident à l'instant où il est créé, et agir s'il correspond — mais ils diffèrent par ce qu'ils font et par la façon dont plusieurs règles correspondantes se résolvent.

- **Règles de regroupement** — regrouper des incidents liés en épisodes. Les règles sont évaluées par ordre de priorité ; les numéros de priorité les plus bas passent en premier.
- **Règles d'astreinte** — exécuter des politiques d'astreinte pour les incidents correspondants. Détaillées plus bas.
- **Règles de propriétaire** — attribuer des propriétaires automatiquement.
- **Règles de runbook** — lancer un [runbook](/docs/runbooks/index) quand un incident correspond.
- **Règles de confidentialité** — décider si un incident correspondant est privé.
- **Règles d'étiquettes** — appliquer des étiquettes automatiquement.
- **Règles SLA** — suivre les délais de réponse et de résolution. Les règles sont évaluées dans l'ordre ; les numéros d'ordre les plus bas passent en premier.
- **Reminder Rules** — relancer périodiquement les propriétaires d'un incident tant qu'il reste ouvert. Les règles sont évaluées dans l'ordre et la première qui correspond l'emporte.

**La sémantique de l'ordre n'est pas uniforme.** Les **Règles de regroupement**, les **Règles SLA** et les **Reminder Rules** sont évaluées dans l'ordre. Les **Règles d'astreinte**, non — chaque règle correspondante se déclenche. Ne supposez pas qu'un seul modèle vaut pour les huit.

Les écrans **Règles d'astreinte**, **Règles de propriétaire**, **Règles d'étiquettes** et **Règles de confidentialité** sont à onglets : un onglet **Incident Rules** et un onglet **Episode Rules**, chacun avec sa propre table. Configurez l'onglet **Incident Rules**, sauf si vous visez précisément les épisodes. **Règles de regroupement**, **Règles de runbook**, **Règles SLA** et **Reminder Rules** n'ont qu'une seule table.

## Règles d'astreinte des incidents

**Incidents → Règles → Règles d'astreinte** (`/dashboard/{projectId}/incidents/settings/on-call-rules`) est l'endroit où vous rendez l'alerte automatique. La carte, **Règles d'astreinte d'incident**, décrit des règles qui exécutent automatiquement des politiques d'astreinte à la création d'incidents correspondants. L'écran a deux onglets : **Incident Rules** et **Episode Rules**.

Le formulaire de création comporte trois étapes :

- **Informations de base** — **Nom** (le texte indicatif suggère quelque chose comme alerter l'équipe base de données pour tout incident DB), **Description**, et une bascule **Activé**. La liste affiche une pastille verte **Activé** ou rouge **Désactivé** par règle.
- **Critères de correspondance** — **Moniteurs**, **Incident Gravités**, **Étiquettes d'incident**, **Étiquettes du moniteur**, plus des champs d'expression régulière insensibles à la casse pour le titre de l'incident, sa description, le nom du moniteur et sa description.
- **Politiques d'astreinte** — les politiques que cette règle exécute.

### Comment se résout la correspondance

Les règles que l'écran embarque lui-même valent la peine d'être assimilées :

- Une règle ne correspond que lorsque **tous** les critères que vous avez renseignés passent. Les critères laissés vides sont ignorés, pas mis en échec.
- À l'intérieur d'un même critère de type liste — **Moniteurs**, **Incident Gravités**, **Étiquettes d'incident**, **Étiquettes du moniteur** — la correspondance se fait sur au moins une valeur.
- Les champs de motif sont des expressions régulières insensibles à la casse.
- **Toutes les règles correspondantes se déclenchent.** Il n'y a ni priorité ni court-circuit.
- L'ensemble des politiques réellement exécutées est l'union des politiques de chaque règle correspondante, plus les politiques attachées à l'incident manuellement ou par un modèle, dédoublonnée pour que chaque politique ne s'exécute qu'une fois au plus.

La gravité est un critère de correspondance ici et nulle part ailleurs. Il n'existe aucun champ d'astreinte sur une gravité d'incident — choisir « Incident critique » n'alerte personne en soi. Si vous voulez que la gravité pilote l'alerte, écrivez une règle d'astreinte qui s'appuie dessus.

## Attacher directement des politiques d'astreinte

Les règles ne sont pas le seul chemin. Chaque incident porte sa propre liste de politiques d'astreinte, exposée par le champ **Politique d'astreinte** à l'étape **Astreinte** de l'assistant de déclaration et à l'étape **Astreinte** d'un modèle d'incident. La description du champ le dit sans détour : ce sont les politiques d'astreinte à exécuter quand cet incident est créé.

À la création d'un incident, OneUptime exécute les règles d'étiquettes, puis les règles d'astreinte (qui fusionnent leurs politiques correspondantes dans la liste de l'incident), puis les règles de runbook — et si la liste obtenue n'est pas vide, chacune de ses politiques est exécutée. Les exécutions se déroulent en parallèle et se règlent indépendamment : l'échec d'une politique n'arrête pas les autres. Chaque exécution est étiquetée avec l'incident qui l'a déclenchée et avec le type d'événement de notification « incident créé ».

Pour voir ce qui s'est passé, ouvrez l'incident et choisissez **Exécutions d'astreinte** dans son menu latéral (`/dashboard/{projectId}/incidents/{incidentId}/on-call-policy-execution-logs`).

## Piloter les incidents depuis des workflows

Les déclencheurs de workflow pour les incidents ne sont pas écrits à la main — OneUptime les génère depuis les modèles de données, si bien que chaque modèle de la famille Incidents obtient ses composants **On Create X**, **On Update X** et **On Delete X**, nommés d'après le nom au singulier du modèle. Les trois principaux sont **On Create Incident**, **On Update Incident** et **On Delete Incident**, et vous les trouverez sous la catégorie **Incident** du panneau **Ajouter un composant**, sur `/dashboard/{projectId}/workflows`.

La même génération vous donne des déclencheurs pour la configuration elle-même : **On Create Incident State**, **On Update Incident Severity**, **On Create Incident Template**, **On Create Incident Note Template**, **On Create Incident State Timeline**, **On Create Incident Public Note**, **On Create Incident Internal Note**, **On Create Incident On-Call Rule**, **On Create Incident Role**, **On Create Incident Member** et d'autres encore. Chaque modèle reçoit aussi ses composants d'action correspondants — **Find One Incident**, **Create One Incident**, **Update One Incident**, **Delete One Incident** et leurs équivalents multi-lignes — de sorte qu'un déclencheur et une action aux noms voisins se retrouvent côte à côte dans la même catégorie. **On Create Incident** démarre un workflow ; **Create One Incident** ouvre un incident.

Quelques détails qui comptent au moment de câbler tout ça :

- **On Update X** accepte un argument facultatif **Listen on** qui restreint le déclencheur aux mises à jour touchant certains champs. Laissez-le vide pour réagir à tout changement. Si une mise à jour arrive sans trace des champs modifiés, le filtre est ignoré et le workflow s'exécute quand même.
- **On Create X** et **On Update X** exigent tous deux un argument **Select Fields** ; **On Delete X** ne prend aucun argument.
- Les trois exposent un unique port de sortie **Success**, et chacun accepte un argument d'identifiant pour que vous puissiez lancer le workflow à la main sur un enregistrement précis.
- Les noms viennent du nom au singulier du modèle, pas de son nom de table — c'est pourquoi vous voyez **On Create Incident Team Owner** et **On Create Incident User Owner** plutôt que des noms calqués sur les tables.
- Il n'existe aucun déclencheur pour les définitions de champs personnalisés d'incident. Ce modèle est le seul membre de la famille Incidents dont les workflows sont désactivés.

Pour construire le reste du workflow, voyez [Créer un workflow](/docs/workflows/authoring) et [Variables](/docs/workflows/variables).

## Où lire ensuite

- [Vue d'ensemble des incidents](/docs/incidents/index) — comment s'assemble la fonctionnalité incident.
- [Déclarer un incident](/docs/incidents/declaring-incidents) — l'assistant de déclaration, les modèles et l'API.
- [États et sévérités des incidents](/docs/incidents/states-and-severities) — les écrans de paramètres d'état et de gravité, et ce que font les indicateurs.
- [Notes, propriétaires et fil d'incident](/docs/incidents/notes-owners-and-feed) — où servent les modèles de notes.
- [Abonnés et annonces](/docs/status-pages/subscribers) — qui entend parler d'un incident en dehors de votre équipe.
- [Présentation des workflows](/docs/workflows/index) — automatiser par-dessus les déclencheurs d'incident.
- [Vue d'ensemble des Runbooks](/docs/runbooks/index) — les procédures que les règles de runbook attachent.
