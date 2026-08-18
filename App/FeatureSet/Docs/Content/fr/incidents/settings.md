# Paramètres et automatisation

La configuration des incidents ne se trouve pas dans les Paramètres du projet. Elle vit à l'intérieur du domaine fonctionnel Incidents lui-même, sous **Incidents → Paramètres** et **Incidents → Règles**, à des routes commençant par `/dashboard/{projectId}/incidents/settings/`. Si vous avez fouillé les **Paramètres du projet** à la recherche des modèles d'incident ou des champs personnalisés, voilà pourquoi vous ne les trouviez pas.

Les sections **Règles** et **Paramètres** du menu latéral Incidents sont toutes deux repliées par défaut : vous devez donc les déplier avant que les éléments ci-dessous n'apparaissent. Tout ici est propre au projet : modèles, rôles, champs personnalisés et règles appartiennent à un projet et s'appliquent à chaque incident qui y est déclaré.

Cette page est la référence de cette configuration — ce que contient chaque page, et ce qui s'exécute automatiquement dès qu'un incident est créé.

## Où vivent les paramètres d'incident

Ouvrez **Incidents** dans la navigation de gauche, puis dépliez **Paramètres** en bas du menu latéral.

| Page                             | Ce que vous y faites                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **État de l'incident**           | Ajouter, renommer, recolorer et réordonner les états par lesquels passe un incident.                   |
| **Gravité de l'incident**        | Ajouter, renommer, recolorer et réordonner les niveaux de gravité.                                     |
| **Modèles d'incident**           | Préremplir un incident entier — titre, description, ressources, politiques d'astreinte, propriétaires, étiquettes. |
| **Modèles de notes**             | Du texte réutilisable pour les notes publiques et privées.                                             |
| **Modèles de post-mortem**       | Des structures de post-mortem réutilisables.                                                           |
| **Champs personnalisés**         | Définir des champs supplémentaires qui apparaissent sur chaque incident.                               |
| **Rôles d'incident**             | Définir les rôles auxquels vous attribuez les intervenants, comme Responsable d'incident.              |
| **Plus de paramètres**           | Les préfixes de numéro d'incident et d'épisode d'incident.                                             |

**État de l'incident** et **Gravité de l'incident** sont traités en profondeur dans [États et sévérités des incidents](/docs/incidents/states-and-severities) — le reste de cette page reprend à partir des **Modèles d'incident**.

Dépliez **Règles** et vous obtenez huit pages de plus : **Règles de regroupement**, **Règles d'astreinte**, **Règles de propriétaire**, **Règles de runbook**, **Règles de confidentialité**, **Règles d'étiquettes**, **Règles SLA** et **Reminder Rules**. Elles sont traitées plus bas.

## Modèles d'incident

Un modèle d'incident est un squelette d'incident enregistré. Au lieu de retaper le même titre, la même liste de moniteurs et la même politique d'astreinte chaque fois que le cluster de paiements vacille, vous l'enregistrez une fois et vous déclarez à partir de lui.

Allez dans **Incidents → Paramètres → Modèles d'incident** (`/dashboard/{projectId}/incidents/settings/templates`). La carte s'intitule **Modèles d'incident**. En créer un vous fait parcourir un assistant en six étapes :

- **Informations du modèle** — **Nom du modèle** et **Description du modèle**. Ils nomment le modèle lui-même ; ils n'apparaissent jamais sur l'incident.
- **Détails de l'incident** — **Titre**, **Description** (Markdown), **Gravité de l'incident** et **État initial de l'incident**. **État initial de l'incident** est facultatif et démarre vide ; ses options sont listées dans l'ordre des états. Laissez-le vierge et les incidents issus de ce modèle atterrissent dans l'état de création du projet.
- **Ressources affectées** — les moniteurs, hôtes, clusters et services auxquels l'incident doit être rattaché, plus **Change Monitor Status to**.
- **Astreinte** — **Politique d'astreinte**, les politiques à exécuter lorsqu'un incident créé à partir de ce modèle est déclaré.
- **Propriétaires** — **Propriétaire - Équipes** et **Propriétaire - Utilisateurs**.
- **Étiquettes** — **Étiquettes**.

Quelques règles rapides :

- La liste des modèles n'affiche que **Nom** et **Description**. Les lignes ne sont ni modifiables ni supprimables depuis la liste — ouvrez un modèle (`/dashboard/{projectId}/incidents/settings/templates/{modelId}`) pour le modifier.
- Les modèles prennent en charge l'import et l'export JSON, vous pouvez donc en déplacer un d'un projet à l'autre.
- L'état vide indique « Aucun modèle d'incident trouvé. »

### Comment un modèle est appliqué

Il y a deux chemins, et ils se comportent de la même façon.

- **Depuis le tableau de bord** — le bouton **Créer à partir d'un modèle** de la liste des incidents ouvre un sélecteur **Sélectionner le modèle d'incident**, et la page de déclaration lit le modèle depuis le paramètre de chaîne de requête `incidentTemplateId`, puis préremplit le formulaire avec le modèle ainsi que ses équipes et utilisateurs propriétaires.
- **Depuis l'API** — transmettez `createdIncidentTemplateId` à `POST /api/incident` et le serveur remplit l'incident à partir du modèle.

L'essentiel est la règle de fusion : **un modèle ne remplit qu'un champ que vous avez laissé indéfini**. Titre, description, gravité de l'incident, état initial de l'incident, le statut de moniteur derrière **Change Monitor Status to**, moniteurs, hôtes, clusters Kubernetes, hôtes Docker, hôtes Podman, services, politiques d'astreinte et étiquettes ne sont copiés depuis le modèle que lorsque l'appelant ou le formulaire n'a rien fourni. Tout ce que vous définissez explicitement l'emporte toujours.

**La fenêtre d'état vide pointe au mauvais endroit.** Si vous n'avez pas encore de modèles, le bouton **Créer à partir d'un modèle** affiche une fenêtre **No Incident Templates**. Son texte pointe vers les Paramètres du projet, mais le bouton route vers **Incidents → Paramètres → Modèles d'incident** — c'est le véritable emplacement.

## Modèles de notes

Les modèles de notes donnent aux intervenants du texte prêt à l'emploi pour les mises à jour d'incident, afin qu'une mise à jour de page de statut à 3 h du matin ne soit pas écrite de zéro par quelqu'un à moitié endormi.

Allez dans **Incidents → Paramètres → Modèles de notes** (`/dashboard/{projectId}/incidents/settings/note-templates`). La carte s'intitule **Modèles de notes publiques ou privées pour les incidents** — une seule bibliothèque sert les deux types de notes. Le formulaire de création comporte deux étapes :

- **Informations du modèle** — **Nom du modèle** et **Description du modèle**, tous deux obligatoires.
- **Détails de la note** — le corps de la note lui-même, en Markdown, obligatoire.

Comme pour les modèles d'incident, les lignes sont créées et consultées plutôt que modifiées en place ; ouvrez un modèle pour le changer.

Les modèles de notes apparaissent là où vous en avez réellement besoin : les fenêtres de confirmation **Acknowledge Incident** et **Resolve Incident** proposent toutes deux **Sélectionner le modèle de note** à côté du champ **Note publique**. Voyez [Notes, propriétaires et fil d'incident](/docs/incidents/notes-owners-and-feed) pour la différence entre notes publiques et privées.

## Modèles de post-mortem

Un modèle de post-mortem est le squelette du compte rendu que vous produisez après un incident — vos titres, vos amorces, vos questions récurrentes — pour que chaque revue du projet suive la même forme.

Allez dans **Incidents → Paramètres → Modèles de post-mortem** (`/dashboard/{projectId}/incidents/settings/postmortem-templates`). La carte s'intitule **Modèles de post-mortem**. Le formulaire de création comporte deux étapes :

- **Informations du modèle** — **Nom du modèle** et **Description du modèle**, tous deux obligatoires.
- **Détails du post-mortem** — **Modèle de post-mortem**, le corps lui-même, en Markdown, obligatoire.

Vous en appliquez un depuis l'incident, pas depuis les paramètres. Ouvrez un incident, choisissez **Post-mortem** dans son menu latéral (`/dashboard/{projectId}/incidents/{incidentId}/postmortem`), et utilisez **Appliquer le modèle**. Cela ouvre une fenêtre **Apply Postmortem Template** avec une liste déroulante **Sélectionner le modèle** ; en choisir un charge le corps du modèle dans l'éditeur **Note du post-mortem**, où vous le modifiez avant d'enregistrer. Les épisodes d'incident ont la même page **Post-mortem** et puisent dans la même bibliothèque de modèles.

## Champs personnalisés

Les champs personnalisés vous permettent de porter vos propres métadonnées sur chaque incident — un nom de service interne, une référence de ticket de changement, un niveau de client.

Allez dans **Incidents → Paramètres → Champs personnalisés** (`/dashboard/{projectId}/incidents/settings/custom-fields`). La page s'intitule **Champs personnalisés d'incident**. Chaque définition comporte :

- **Nom du champ** — obligatoire, au moins deux caractères. Le texte indicatif suggère un nom de type identifiant, comme `internal-service`.
- **Description du champ** — facultatif.
- **Type de champ** — obligatoire. Il détermine comment la donnée est saisie. Les types de liste déroulante nécessitent aussi de lister leurs options.
- **Options de la liste déroulante** — les valeurs qui apparaissent dans la liste déroulante, chacune avec une couleur facultative.

Les définitions vivent dans leur propre modèle ; les valeurs vivent sur l'incident lui-même, dans la colonne `customFields`. Sur un incident donné, vous les remplissez depuis **Champs personnalisés** dans le menu latéral de l'incident (`/dashboard/{projectId}/incidents/{incidentId}/custom-fields`).

**Une lacune à connaître.** Les définitions de champs personnalisés d'incident sont la seule partie de la famille des incidents sans déclencheur de workflow — voyez la section sur les workflows plus bas.

## Rôles d'incident

Les rôles d'incident sont les fonctions nommées auxquelles vous attribuez des personnes pendant une réponse. Définissez-les dans **Incidents → Paramètres → Rôles d'incident** (`/dashboard/{projectId}/incidents/settings/roles`) ; la description de la carte donne Responsable d'incident et intervenant comme exemples.

Les rôles ne sont que des définitions. Vous y attribuez des personnes incident par incident — l'assistant de déclaration comporte une étape **Rôles d'incident** avec un champ **Attribuer les rôles de l'incident**, et chaque incident dispose d'une page **Rôles** dans son menu latéral.

## Préfixes de numéro

Chaque incident reçoit un numéro. Par défaut, il s'affiche `#42`. Si votre équipe dit « INC-42 » à voix haute, faites en sorte que le produit le dise aussi.

Allez dans **Incidents → Paramètres → Plus de paramètres** (`/dashboard/{projectId}/incidents/settings/more`). La carte est **Préfixe du nombre** et contient deux champs sur le projet :

- **Préfixe de numéro d'incident** — jusqu'à 20 caractères, texte indicatif `INC-`. Définissez-le et l'incident `#42` s'affiche `INC-42`.
- **Préfixe de numéro d'épisode d'incident** — la même idée pour les numéros d'épisode d'incident, texte indicatif `IE-`.

Laissez l'un ou l'autre vide pour conserver le préfixe `#` par défaut ; le champ non défini affiche `# (default)`. Enregistrez avec **Mettre à jour**. La valeur préfixée est stockée sur l'incident dans `incidentNumberWithPrefix`, qui est ce qu'affichent la liste des incidents et l'en-tête de l'incident.

## Les règles qui s'exécutent à la création d'un incident

**Incidents → Règles** contient huit moteurs de règles. Ils font tous le même travail — regarder un incident au moment où il est créé, et agir s'il correspond — mais ils diffèrent par ce qu'ils font et par la façon dont plusieurs règles correspondantes se résolvent.

- **Règles de regroupement** — regroupent les incidents liés en épisodes. Les règles sont évaluées par ordre de priorité ; les numéros de priorité les plus bas passent en premier.
- **Règles d'astreinte** — exécutent des politiques d'astreinte pour les incidents correspondants. Détaillées plus bas.
- **Règles de propriétaire** — attribuent des propriétaires automatiquement.
- **Règles de runbook** — démarrent un [runbook](/docs/runbooks/index) quand un incident correspond.
- **Règles de confidentialité** — décident si un incident correspondant est privé.
- **Règles d'étiquettes** — appliquent des étiquettes automatiquement.
- **Règles SLA** — suivent les temps de réponse et de résolution. Les règles sont évaluées dans l'ordre ; les numéros d'ordre les plus bas passent en premier.
- **Reminder Rules** — rappellent périodiquement aux propriétaires d'un incident qu'il est encore ouvert. Les règles sont évaluées dans l'ordre et la première règle correspondante l'emporte.

**La sémantique de l'ordre n'est pas uniforme.** Règles de regroupement, Règles SLA et Reminder Rules sont évaluées dans l'ordre. Les Règles d'astreinte ne le sont pas — chaque règle correspondante se déclenche. Ne supposez pas qu'un seul modèle s'applique aux huit.

Les pages **Règles d'astreinte**, **Règles de propriétaire**, **Règles d'étiquettes** et **Règles de confidentialité** sont à onglets — un onglet **Incident Rules** et un onglet **Episode Rules**, chacun avec son propre tableau. Configurez l'onglet **Incident Rules** sauf si vous visez spécifiquement les épisodes. **Règles de regroupement**, **Règles de runbook**, **Règles SLA** et **Reminder Rules** sont des tableaux simples.

## Règles d'astreinte d'incident

**Incidents → Règles → Règles d'astreinte** (`/dashboard/{projectId}/incidents/settings/on-call-rules`) est l'endroit où vous rendez l'alerte automatique. La carte, **Règles d'astreinte d'incident**, décrit des règles qui exécutent automatiquement des politiques d'astreinte quand des incidents correspondants sont créés. La page comporte deux onglets : **Incident Rules** et **Episode Rules**.

Le formulaire de création comporte trois étapes :

- **Informations de base** — **Nom** (le texte indicatif suggère quelque chose comme alerter l'équipe base de données pour tout incident BD), **Description**, et une bascule **Activé**. La liste affiche une pastille verte **Activé** ou rouge **Désactivé** par règle.
- **Critères de correspondance** — **Moniteurs**, **Incident Severities**, **Étiquettes d'incident**, **Étiquettes du moniteur**, plus des champs d'expression régulière insensibles à la casse pour le titre de l'incident, la description de l'incident, le nom du moniteur et la description du moniteur.
- **Politiques d'astreinte** — les politiques que cette règle exécute.

### Comment la correspondance se résout

Les règles que la page embarque elle-même méritent d'être intégrées :

- Une règle ne correspond que lorsque **tous** les critères que vous avez remplis passent. Les critères laissés vides sont ignorés, pas mis en échec.
- À l'intérieur d'un même critère de liste — **Moniteurs**, **Incident Severities**, **Étiquettes d'incident**, **Étiquettes du moniteur** — la correspondance se fait sur au moins une valeur.
- Les champs de motif sont des expressions régulières insensibles à la casse.
- **Toutes les règles correspondantes se déclenchent.** Il n'y a ni priorité ni court-circuit.
- L'ensemble des politiques réellement exécutées est l'union des politiques de toutes les règles correspondantes, plus toute politique rattachée à l'incident manuellement ou par un modèle, dédupliquée pour que chaque politique s'exécute au plus une fois.

La gravité est un critère de correspondance ici et nulle part ailleurs. Il n'y a pas de champ d'astreinte sur une gravité d'incident — sélectionner « Incident critique » n'alerte personne en soi. Si vous voulez que la gravité pilote l'alerte, écrivez une règle d'astreinte qui s'appuie dessus.

## Rattacher directement des politiques d'astreinte

Les règles ne sont pas la seule voie. Chaque incident porte sa propre liste de politiques d'astreinte, exposée sous forme du champ **Politique d'astreinte** à l'étape **Astreinte** de l'assistant de déclaration et à l'étape **Astreinte** d'un modèle d'incident. La description du champ le dit clairement : ce sont les politiques d'astreinte à exécuter quand cet incident est créé.

Quand un incident est créé, OneUptime exécute les règles d'étiquettes, puis les règles d'astreinte (qui fusionnent leurs politiques correspondantes dans la liste de l'incident), puis les règles de runbook — et si la liste obtenue n'est pas vide, chaque politique qu'elle contient est exécutée. Les exécutions se déroulent en parallèle et sont réglées indépendamment : l'échec d'une politique n'arrête pas les autres. Chaque exécution est marquée avec l'incident qui l'a déclenchée et avec le type d'événement de notification « incident créé ».

Pour voir ce qui s'est passé, ouvrez l'incident et choisissez **Exécutions d'astreinte** dans son menu latéral (`/dashboard/{projectId}/incidents/{incidentId}/on-call-policy-execution-logs`).

## Piloter les incidents depuis les workflows

Les déclencheurs de workflow pour les incidents ne sont pas écrits à la main — OneUptime les génère à partir des modèles de données, si bien que chaque modèle de la famille incident reçoit des composants **On Create X**, **On Update X** et **On Delete X**, nommés d'après le nom au singulier du modèle. Les trois principaux sont **On Create Incident**, **On Update Incident** et **On Delete Incident**, et ils se trouvent dans la catégorie **Incident** de la palette de composants de workflow, à `/dashboard/{projectId}/workflows`.

La même génération vous donne des déclencheurs pour la configuration elle-même : **On Create Incident State**, **On Update Incident Severity**, **On Create Incident Template**, **On Create Incident Note Template**, **On Create Incident State Timeline**, **On Create Incident Public Note**, **On Create Incident Internal Note**, **On Create Incident On-Call Rule**, **On Create Incident Role**, **On Create Incident Member** et d'autres encore. Chaque modèle reçoit aussi des composants d'action correspondants — **Find One Incident**, **Create One Incident**, **Update One Incident**, **Delete One Incident** et leurs équivalents multi-lignes — de sorte qu'un déclencheur et une action aux noms voisins se retrouvent côte à côte dans la même catégorie. **On Create Incident** démarre un workflow ; **Create One Incident** ouvre un incident.

Quelques détails qui comptent au moment du câblage :

- **On Update X** prend un argument facultatif **Listen on** qui restreint le déclencheur aux mises à jour touchant des champs précis. Laissez-le vide pour se déclencher à n'importe quel changement. Si une mise à jour arrive sans trace des champs modifiés, le filtre est ignoré et le workflow s'exécute quand même.
- **On Create X** et **On Update X** prennent tous deux un argument obligatoire **Select Fields** ; **On Delete X** ne prend aucun argument.
- Tous trois exposent un unique port de sortie **Success**, et chacun accepte un argument d'identifiant pour que vous puissiez exécuter le workflow à la main sur un enregistrement précis.
- Les noms proviennent du nom au singulier du modèle, pas de son nom de table — c'est pourquoi vous voyez **On Create Incident Team Owner** et **On Create Incident User Owner** plutôt que des noms calqués sur les tables.
- Il n'y a pas de déclencheurs pour les définitions de champs personnalisés d'incident. Ce modèle est le seul membre de la famille incident dont les workflows sont désactivés.

Pour construire le reste du workflow, voyez [Créer un workflow](/docs/workflows/authoring) et [Variables de workflow](/docs/workflows/variables).

## Pour aller plus loin

- [Vue d'ensemble des incidents](/docs/incidents/index) — comment la fonctionnalité incident s'assemble.
- [Déclarer un incident](/docs/incidents/declaring-incidents) — l'assistant de déclaration, les modèles et l'API.
- [États et sévérités des incidents](/docs/incidents/states-and-severities) — les pages de paramètres d'état et de gravité, et ce que font les indicateurs.
- [Notes, propriétaires et fil d'incident](/docs/incidents/notes-owners-and-feed) — là où les modèles de notes servent.
- [Abonnés et annonces](/docs/status-pages/subscribers) — qui entend parler d'un incident en dehors de votre équipe.
- [Présentation des workflows](/docs/workflows/index) — automatiser par-dessus les déclencheurs d'incident.
- [Vue d'ensemble des Runbooks](/docs/runbooks/index) — les procédures que rattachent les règles de runbook.
