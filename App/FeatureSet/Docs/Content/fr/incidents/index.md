# Vue d'ensemble des incidents

Dans OneUptime, un incident est l'enregistrement autour duquel votre équipe se rassemble quand quelque chose casse. Il porte un numéro, un titre, une gravité, un état courant, les ressources qu'il touche, et tout ce que votre équipe écrit pendant qu'elle intervient — notes, cause racine, mesures de remédiation, et un fil en ajout seul qui retrace qui a fait quoi.

Ce sont les incidents qui transforment un moniteur passé au rouge en réponse coordonnée. En déclarer un alerte la bonne rotation d'astreinte, ajoute des propriétaires prévenus à chaque changement, lance des runbooks et — si vous le voulez — publie la panne sur votre page de statut publique, pour que vos clients arrêtent d'ouvrir des tickets afin de savoir si vous êtes déjà au courant.

Vous pouvez déclarer un incident à la main à 3 h du matin, ou laisser un moniteur le déclarer pour vous à la seconde où ses critères correspondent. Dans les deux cas, c'est le même objet, avec le même cycle de vie et la même trace écrite au bout du compte.

## En un coup d'œil

- **Fonctionnalité de premier niveau** — **Incidents**, dans la navigation de gauche du tableau de bord, à `/dashboard/{projectId}/incidents`.
- **Trois états initialisés** — **Identifié**, **Pris en compte** et **Résolu** sont créés pour chaque nouveau projet. Vous pouvez ajouter les vôtres ; les trois états initialisés peuvent être renommés et recolorés, jamais supprimés.
- **Trois gravités initialisées** — **Incident critique**, **Incident majeur** et **Incident mineur**. Une gravité est une étiquette avec une couleur et un ordre — elle ne porte aucun comportement en propre.
- **Quatre portes d'entrée** — l'assistant **Déclarer un incident**, **Créer à partir d'un modèle**, une règle de critères de moniteur, ou `POST /api/incident`.
- **Numérotés par projet** — chaque incident reçoit un numéro d'incident, affiché `#42` par défaut ou avec votre propre préfixe, par exemple `INC-42`.
- **Deux sortes de notes** — les notes privées (notes internes) pour votre équipe, les notes publiques pour les abonnés de la page de statut.
- **Les paramètres vivent sous Incidents, pas sous Paramètres du projet** — états, gravités, modèles, champs personnalisés et moteurs de règles se trouvent tous dans **Incidents → Paramètres** et **Incidents → Règles**.

## Termes clés

Une poignée de mots revient sur toutes les autres pages de cette section. Mettez-les au clair d'abord.

| Terme                      | Ce que cela veut dire                                                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Incident**               | L'enregistrement lui-même — titre, description, gravité, état courant, ressources affectées, et tout ce qui y est écrit pendant l'intervention.           |
| **État de l'incident**     | Où en est l'incident dans son cycle de vie. Une ligne propre au projet, avec un nom, une couleur et un `order`, plus les indicateurs qui lui donnent sens. |
| **Gravité de l'incident**  | À quel point c'est grave. Une ligne propre au projet, avec un nom, une couleur et un `order`. Pure classification — rien dans le produit ne privilégie une gravité. |
| **Numéro d'incident**      | Un compteur par projet affiché `#42`, ou avec un préfixe que vous configurez, `INC-42`.                                                                   |
| **Ressources affectées**   | Les moniteurs, hôtes, clusters Kubernetes, hôtes Docker, services et autres éléments d'infrastructure que vous rattachez à l'incident.                    |
| **Note publique**          | Une mise à jour écrite pour les lecteurs et les abonnés de la page de statut. Elle s'affiche dans la chronologie de la page de statut.                    |
| **Note privée**            | Une note interne (le modèle `IncidentInternalNote`) pour l'équipe qui intervient. Elle n'atteint jamais une page de statut.                               |
| **Propriétaire**           | Un utilisateur ou une équipe responsable de l'incident. Les propriétaires sont prévenus à sa création, à chaque note publiée et à chaque changement d'état. |
| **Incident Flux**          | La chronologie d'activité en ajout seul, sur la **Vue d'ensemble** de l'incident, qui consigne changements d'état, notes, changements de propriétaires, exécutions de règles et notifications. |
| **Chronologie d'état**     | Le relevé de l'état dans lequel l'incident s'est trouvé, quand et combien de temps — avec le statut de notification des abonnés pour chaque transition.   |

## Les trois états que OneUptime initialise pour chaque projet

À la création d'un projet, OneUptime initialise exactement trois états d'incident, dans cet ordre :

| État               | Ordre | Couleur            | Ce que cela veut dire                                                          |
| ------------------ | ----- | ------------------ | ------------------------------------------------------------------------------ |
| **Identifié**      | 1     | Rouge (`#fd625e`)  | L'état dans lequel atterrit un incident tout neuf. C'est l'état de création.    |
| **Pris en compte** | 2     | Jaune (`#ffbf53`)  | Quelqu'un a récupéré l'incident et travaille dessus.                            |
| **Résolu**         | 3     | Vert (`#2ab57d`)   | L'incident est terminé. C'est le résoudre qui le retire de votre page de statut. |

Les noms ne sont que des étiquettes — ce qui pilote vraiment le comportement, ce sont trois booléens sur la ligne d'état : `isCreatedState`, `isAcknowledgedState` et `isResolvedState`. On attend qu'un seul état par projet porte chacun de ces indicateurs.

Cette distinction compte davantage qu'il n'y paraît :

- `isCreatedState` décide où démarre un nouvel incident. Si aucun état n'est explicitement choisi à la création, OneUptime cherche l'état de création du projet et l'utilise.
- `isAcknowledgedState` et `isResolvedState` pilotent les boutons **Acknowledge** et **Résoudre** de l'en-tête de l'incident, les deux tuiles de statistiques de la **Vue d'ensemble** de l'incident, et le badge de comptage **Incidents actifs** du menu latéral.
- **Incidents actifs** se définit uniquement comme « l'état courant n'est pas l'état résolu ». Tout état personnalisé que vous ajoutez est donc actif, sauf s'il s'agit de l'état résolu.

**Attention au nom.** Le premier état initialisé s'appelle **Identifié**, même si plusieurs descriptions dans le produit continuent de l'appeler l'état de création. Si vous cherchez « Created » dans la liste d'états de votre projet, c'est la ligne nommée **Identifié**.

Vous pouvez ajouter vos propres états dans **Incidents → Paramètres → État de l'incident**. Les nouveaux états s'ajoutent à la fin de la liste ordonnée et vous pouvez les glisser pour les réordonner. Les trois états porteurs d'indicateurs ne peuvent pas être supprimés — OneUptime le bloque — mais vous pouvez les renommer et les recolorer, ce qui explique que l'interface lise les noms d'états dynamiquement.

L'ordre est appliqué, pas décoratif : un incident ne peut pas passer à un état situé avant son état courant.

Le détail complet se trouve dans [États et sévérités des incidents](/docs/incidents/states-and-severities).

## Les trois gravités que OneUptime initialise pour chaque projet

Chaque nouveau projet reçoit aussi trois gravités :

| Gravité               | Ordre | Couleur             | Ce que cela veut dire                                        |
| --------------------- | ----- | ------------------- | ------------------------------------------------------------ |
| **Incident critique** | 1     | Bordeaux (`#b70400`) | Impact client très élevé, réponse immédiate nécessaire.      |
| **Incident majeur**   | 2     | Rouge (`#fd625e`)   | Impact significatif, réponse immédiate le plus souvent.      |
| **Incident mineur**   | 3     | Jaune (`#ffbf53`)   | Faible impact, traité en général pendant les heures ouvrées. |

Les descriptions initialisées complètes sont dans [États et sévérités des incidents](/docs/incidents/states-and-severities).

Les gravités ont `name`, `description`, `color` et `order`, et rien d'autre. Aucun indicateur, et aucun chemin de code ne traite « Incident critique » différemment d'une autre ligne. La gravité sert au tri humain, et elle est disponible comme critère de correspondance quand vous écrivez des règles d'astreinte — mais choisir une gravité n'alerte personne à elle seule.

Modifiez ou ajoutez des gravités dans **Incidents → Paramètres → Gravité de l'incident**.

## La vie d'un incident

### 1. Il est déclaré

Quatre chemins mènent au même objet :

- **À la main** — depuis la liste des incidents, cliquez sur **Déclarer un incident**. Cela ouvre l'assistant **Déclarer un nouvel incident**, long de cinq étapes : **Détails de l'incident**, **Ressources affectées**, **Rôles d'incident**, **Astreinte**, **Plus**.
- **Depuis un modèle** — cliquez sur **Créer à partir d'un modèle** et choisissez un **Incident Modèle** enregistré. Les modèles préremplissent titre, description, gravité, état initial, ressources, politiques d'astreinte, propriétaires et étiquettes.
- **Depuis un moniteur** — une règle de critères de moniteur dont la bascule « déclarer un incident » est activée crée l'incident automatiquement dès que ses filtres correspondent. Les titres et descriptions y acceptent des variables `{{variable}}`.
- **Par l'API** — `POST /api/incident` avec une clé API. Le serveur renseigne pour vous `declaredAt`, l'état de création et le numéro d'incident.

Voyez [Déclarer un incident](/docs/incidents/declaring-incidents) pour la visite champ par champ.

### 2. Les bonnes personnes l'apprennent

À la création, OneUptime exécute l'automatisation que vous avez configurée : règles d'étiquettes, règles d'astreinte, règles de propriétaire et règles de runbook. Toutes les politiques d'astreinte rattachées à l'incident — manuellement, depuis un modèle, ou ajoutées par une règle d'astreinte correspondante — sont exécutées en parallèle.

Les propriétaires sont prévenus par e-mail, SMS, appel, notification push et WhatsApp, dans la limite des préférences de notification de chacun. Si un incident n'a aucun propriétaire, la notification se rabat sur les propriétaires du projet plutôt que d'être perdue.

Si l'incident est visible sur une page de statut et que les notifications aux abonnés sont activées, les abonnés sont prévenus eux aussi. Ces notifications sont pilotées par une tâche planifiée qui tourne chaque minute : comptez donc jusqu'à une minute de délai plutôt qu'un envoi instantané.

### 3. Votre équipe le traite

Les intervenants prennent l'incident en compte, rattachent les ressources affectées, exécutent des runbooks, attribuent les rôles d'incident et consignent ce qu'ils apprennent au fur et à mesure — notes privées pour l'équipe, notes publiques pour les clients, plus les pages **Cause racine** et **Remédiation** quand le tableau s'éclaircit. Tout ce qu'ils font atterrit dans l'**Incident Flux** de la page **Vue d'ensemble**.

### 4. Il est résolu

Cliquer sur **Résoudre** fait passer l'incident à l'état résolu, horodate la chronologie d'état, arrête le compteur de durée et retire l'incident de la section active de toute page de statut où il s'affichait. Rien d'autre n'a besoin de changer pour cela — l'indicateur d'état résolu est ce que regarde la requête de la page de statut.

Ensuite, vous pouvez écrire un post-mortem et, si vous le souhaitez, le publier sur la page de statut.

## Où vivent les incidents dans le tableau de bord

Ouvrez **Incidents** dans la navigation de gauche. Son menu latéral est organisé en sections :

| Section                | Ce que vous y faites                                                                                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Vue d'ensemble**     | **Tous les incidents** et **Incidents actifs** — ce dernier porte un badge rouge comptant les incidents qui ne sont pas à l'état résolu.                                  |
| **Épisodes**           | Les épisodes d'incident, une fonctionnalité de regroupement distincte avec ses propres pages.                                                                             |
| **IA**                 | **Investigation** et **Remédiation** — les réglages d'investigation automatique et d'auto-remédiation.                                                                    |
| **Espace de travail**  | Les connexions **Slack** et **Microsoft Teams** pour les incidents.                                                                                                      |
| **Règles**             | Les moteurs de règles : **Règles de regroupement**, **Règles d'astreinte**, **Règles de propriétaire**, **Règles de runbook**, **Règles de confidentialité**, **Règles d'étiquettes**, **Règles SLA**, **Reminder Rules**. |
| **Paramètres**         | **État de l'incident**, **Gravité de l'incident**, **Modèles d'incident**, **Modèles de notes**, **Modèles de post-mortem**, **Champs personnalisés**, **Rôles d'incident**, **Plus de paramètres**. |

**Règles** et **Paramètres** sont repliés par défaut — dépliez-les pour trouver les pages auxquelles renvoie le reste de cette documentation. La configuration des incidents n'est pas dans les Paramètres du projet : tout vit ici.

La liste des incidents elle-même affiche **Numéro d'incident**, **Titre**, **État**, **Gravité**, **Ressources affectées**, **Déclaré**, **Durée**, **Étiquettes** et **Propriétaires**, avec une action groupée **Modifier l'état** pour en clore plusieurs d'un coup.

## Ce que montre chaque page d'un incident

Ouvrez un incident et vous obtenez un menu latéral gauche, groupé ainsi :

- **Vue d'ensemble** — la carte **Détails de l'incident** (titre, gravité, étiquettes, numéro d'incident, déclaré le, déclaré par, politiques d'astreinte), une carte **Ressources affectées**, et l'**Incident Flux**. Au-dessus, des tuiles de statistiques pour le temps de prise en compte, le temps de résolution et la **Durée** totale.
- **Chronologie d'état** — tous les états par lesquels l'incident est passé, avec **Commence le**, **Se termine le**, **Durée** et le statut de notification des abonnés pour chaque transition. **Voir la cause** et **Voir les journaux** expliquent pourquoi chaque changement a eu lieu.
- **SLA** — le suivi du SLA pour cet incident.
- **Description**, **Cause racine**, **Remédiation** — trois pages en Markdown. La description est celle qui s'affiche sur votre page de statut.
- **Runbooks** — les exécutions de runbook rattachées à cet incident.
- **Post-mortem** — le compte rendu, que vous pouvez publier sur la page de statut si vous le souhaitez.
- **Rôles**, **Exécutions d'astreinte**, **Propriétaires** — qui s'en occupe, quelles politiques se sont déclenchées, et qui est prévenu.
- **Journaux de notification**, **Journaux IA**, **Journaux d'audit** — ce qui a été envoyé et ce qui a changé.
- **Notes privées** et **Notes publiques** — sous la section **Notes** du menu latéral.
- **Champs personnalisés**, **Paramètres**, **Supprimer l'incident** — sous **Avancé**. La page **Paramètres** porte **Visible sur la page de statut**, **Incident privé** et la carte **Reminders**.

[Notes, propriétaires et fil d'incident](/docs/incidents/notes-owners-and-feed) traite en profondeur les pages de collaboration.

## Comment les incidents s'articulent avec le reste de OneUptime

- **Les moniteurs repèrent le problème ; les incidents le consignent.** Une règle de critères de moniteur peut déclarer un incident automatiquement, en préremplissant titre, gravité, politiques d'astreinte, propriétaires, étiquettes et notes de remédiation. Voyez [Modèles d'incident et d'alerte](/docs/monitor/incident-alert-templating) pour les variables disponibles.
- **Les politiques d'astreinte se chargent d'alerter.** Rattachez des politiques à l'étape **Astreinte** de l'assistant de déclaration, sur un modèle, ou via **Incidents → Règles → Règles d'astreinte**. Toutes les règles correspondantes se déclenchent — l'ensemble exécuté est l'union de toutes les correspondances plus ce qui est rattaché directement, dédupliqué.
- **Les runbooks disent quoi faire.** Les règles de runbook rattachent une procédure automatiquement à la création d'un incident correspondant, et les intervenants peuvent en lancer une à la main depuis l'incident. Voyez [Vue d'ensemble des Runbooks](/docs/runbooks/index).
- **Les pages de statut informent les clients.** Un incident apparaît dans la liste active d'une page de statut quand la page affiche les incidents, que l'incident est marqué visible sur la page de statut, et que son état courant n'est pas l'état résolu. Les incidents privés sont masqués de toutes les pages de statut, sans exception. Voyez [Vue d'ensemble des pages de statut](/docs/status-pages/index).
- **Les workflows automatisent autour.** Les déclencheurs **On Create Incident**, **On Update Incident** et **On Delete Incident** vous permettent de construire de l'automatisation sans code par-dessus le cycle de vie de l'incident. Voyez [Présentation des workflows](/docs/workflows/index).

## Où lire ensuite

- [Déclarer un incident](/docs/incidents/declaring-incidents) — l'assistant, les modèles, les critères de moniteur et l'API.
- [États et sévérités des incidents](/docs/incidents/states-and-severities) — les indicateurs d'état, les états personnalisés et la classification par gravité.
- [Notes, propriétaires et fil d'incident](/docs/incidents/notes-owners-and-feed) — notes publiques et privées, propriétaires et fil d'activité.
- [Paramètres et automatisation des incidents](/docs/incidents/settings) — modèles, champs personnalisés, préfixes de numéro et moteurs de règles.
- [Vue d'ensemble des pages de statut](/docs/status-pages/index) — comment les incidents parviennent à vos clients.
- [Abonnés et annonces](/docs/status-pages/subscribers) — qui est prévenu quand un incident évolue.
