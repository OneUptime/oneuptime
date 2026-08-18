# Déclarer un incident

Déclarer un incident, c'est le moment où OneUptime commence à tenir les comptes. Un enregistrement est créé, un numéro lui est apposé, les politiques d'astreinte se déclenchent et — sauf indication contraire de votre part — les abonnés de votre page de statut en entendent parler. Tout le reste du cycle de vie découle de cette première écriture.

Il y a quatre façons de faire entrer un incident dans OneUptime, et elles aboutissent toutes au même endroit : une ligne dans la table `Incident`, avec une gravité, un état courant et une liste de ressources affectées. La seule différence, c'est qui remplit les champs — vous à 3 h du matin, un modèle enregistré, les critères d'un moniteur, ou votre propre code qui appelle l'API.

Cette page parcourt les quatre, champ par champ, puis explique ce que le serveur remplit à votre place et ce qui se déclenche dès que l'incident existe.

## Quatre façons de déclarer un incident

| Si vous voulez…                                                     | Choisissez                                                                  |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Ouvrir un incident à la main, en remplissant tout                    | L'assistant **Déclarer un incident**                                        |
| Ouvrir un type d'incident récurrent avec les champs préremplis       | **Créer à partir d'un modèle**                                              |
| En ouvrir un automatiquement quand les tests d'un moniteur échouent  | Un filtre de critères de moniteur avec **When filters match, declare an incident.** |
| En ouvrir un depuis votre code, un script ou un autre outil          | `POST /api/incident`                                                        |

Les quatre écrivent le même modèle : un incident ouvert par une sonde ressemble exactement à un incident ouvert à la main par un intervenant — à quelques colonnes de comptabilité près, que le serveur renseigne sur les incidents automatiques.

## Déclarer à la main

Ouvrez **Incidents → Tous les incidents** et cliquez sur **Déclarer un incident** en haut à droite de la liste **Incidents**. Vous arrivez sur une carte intitulée **Déclarer un nouvel incident**, qui étale le formulaire sur cinq étapes : **Détails de l'incident**, **Ressources affectées**, **Rôles d'incident**, **Astreinte** et **Plus**. Le bouton de validation, à la fin, s'intitule lui aussi **Déclarer un incident**.

Seule la première étape comporte des champs obligatoires. Si vous êtes pressé, remplissez **Détails de l'incident** et validez — vous pourrez rattacher des ressources, attribuer des rôles et ajouter des politiques d'astreinte depuis les pages de l'incident lui-même.

### Étape 1 — Détails de l'incident

- **Titre** — obligatoire. Le résumé d'une ligne que tout le monde verra dans la liste, dans Slack et (si l'incident est visible) sur votre page de statut. Texte indicatif : `Incident Title`.
- **Description** — facultative, rédigée en Markdown. C'est ce champ qui s'affiche sur la page de statut : écrivez-le donc pour vos clients plutôt que pour votre équipe. Vous pourrez le modifier plus tard depuis **Description**, dans le menu latéral de l'incident.
- **Déclaré le** — obligatoire dans le formulaire, avec l'heure courante par défaut. C'est l'horodatage à partir duquel toutes les durées de l'incident sont mesurées : antidatez-le si vous consignez quelque chose qui a commencé plus tôt.
- **Gravité de l'incident** — obligatoire. Une des gravités configurées pour votre projet ; les nouveaux projets sont initialisés avec **Incident critique**, **Incident majeur** et **Incident mineur**.
- **État de l'incident** — facultatif. Laissez-le tel quel et l'incident atterrit dans l'état marqué `isCreatedState`, que les nouveaux projets initialisent à **Identifié**. Ne le renseignez que si vous consignez un incident qui avait déjà dépassé ce point.

**Si la liste déroulante des états vous pose problème.** Si aucun état de votre projet ne porte l'indicateur `isCreatedState`, l'appel de création échoue et vous invite à ajouter un état de création depuis les paramètres. Cela n'arrive normalement que sur un projet dont les états ont été largement remaniés — voyez [États et sévérités des incidents](/docs/incidents/states-and-severities).

### Étape 2 — Ressources affectées

- **Ressources affectées** — un unique champ de recherche qui rattache moniteurs, hôtes, clusters Kubernetes, hôtes Docker, hôtes Podman et services. Sous le capot, ce sont des relations distinctes sur l'incident (`monitors`, `hosts`, `kubernetesClusters`, `dockerHosts`, `podmanHosts`, `services` et d'autres), mais le formulaire les rassemble en un seul sélecteur.
- **Change Monitor Status to** — facultatif. Choisit un statut de moniteur appliqué à chaque moniteur rattaché à cet incident, de sorte que déclarer l'incident et marquer les moniteurs comme dégradés ne fasse qu'une action au lieu de deux.

**Rattachez des moniteurs même quand cela paraît redondant.** Le lien entre un incident et une page de statut passe par les moniteurs de l'incident : une page de statut affiche un incident lorsque l'une de ses ressources est l'un des moniteurs de l'incident. Une notification de changement d'état aux abonnés est purement et simplement ignorée si l'incident n'a aucun moniteur rattaché. Voyez [Ressources et groupes de la page de statut](/docs/status-pages/resources-and-groups).

### Étape 3 — Rôles d'incident

- **Attribuer les rôles de l'incident** — attribuez des membres de l'équipe aux rôles définis par votre projet. Certains rôles acceptent plusieurs utilisateurs.

Les rôles eux-mêmes se configurent dans **Incidents → Paramètres → Rôles d'incident**, où vous définissez les rôles attribuables pendant l'intervention — Responsable d'incident, intervenant, et tout ce dont votre processus a besoin. Si vous sautez cette étape, un Responsable d'incident est attribué automatiquement au premier changement d'état si personne ne tient encore ce rôle.

### Étape 4 — Astreinte

- **Politique d'astreinte** — une sélection multiple des politiques d'astreinte à exécuter à la création de cet incident. Cela correspond à `onCallDutyPolicies` sur l'incident.

C'est le seul endroit où une politique d'astreinte est rattachée directement à un incident. Les gravités ne portent pas de politique d'astreinte — une gravité est une étiquette, et elle n'influence l'alerte qu'en tant que *critère de correspondance* à l'intérieur d'une règle d'astreinte. Les règles configurées dans **Incidents → Règles → Règles d'astreinte** ajoutent leurs politiques par-dessus ce que vous choisissez ici ; l'ensemble finalement exécuté est l'union dédupliquée des deux.

### Étape 5 — Plus

- **Étiquettes** — facultatives, et fonctionnalité avancée : les membres de l'équipe qui ont accès à ces étiquettes sont ceux qui peuvent accéder à l'incident.
- **Notifier les abonnés de la page de statut** — case à cocher, activée par défaut. Elle décide si les abonnés reçoivent un e-mail annonçant la création de l'incident (`shouldStatusPageSubscribersBeNotifiedOnIncidentCreated`). Décochez-la pour le bruit interne que vous voulez quand même consigner.
- **Incident privé** — case à cocher, décochée par défaut (`isPrivate`). Un incident privé n'est visible que par ses utilisateurs propriétaires, les membres de ses équipes propriétaires, les administrateurs et les propriétaires du projet — et il est masqué de toutes les pages de statut, quel que soit le reste des réglages. La liste des incidents les signale par une pastille rouge **Private**.

L'indicateur **Should be visible on status page?** (`isVisibleOnStatusPage`) n'est pas dans l'assistant ; il vaut vrai par défaut. Modifiez-le ensuite depuis **Paramètres**, dans le menu latéral de l'incident, où il s'intitule **Visible sur la page de statut**.

## Déclarer depuis un modèle

Si vous déclarez sans cesse la même forme d'incident — même schéma de titre, même gravité, même politique d'astreinte — enregistrez-la une bonne fois comme modèle.

Cliquez sur **Créer à partir d'un modèle** (le bouton en contour à côté de **Déclarer un incident**) : une fenêtre **Créer un incident à partir d'un modèle** s'ouvre, avec une liste déroulante **Sélectionner le modèle d'incident**. Choisissez un modèle et le formulaire de création s'ouvre prérempli ; vous pouvez encore tout changer avant de valider. Si votre projet n'a pas encore de modèles, vous obtenez à la place une fenêtre **No Incident Templates**, avec un bouton **Create Template** qui vous emmène dans **Incidents → Paramètres → Modèles d'incident**.

Les modèles se construisent avec leur propre assistant en six étapes — **Informations du modèle**, **Détails de l'incident**, **Ressources affectées**, **Astreinte**, **Propriétaires**, **Étiquettes** — avec ces champs :

| Champ                            | À quoi il sert                                                     |
| -------------------------------- | ------------------------------------------------------------------ |
| **Nom du modèle**                | Comment le modèle est identifié dans le sélecteur.                 |
| **Description du modèle**        | Un mot à votre vous futur, sur le moment où y recourir.            |
| **Titre**                        | Le titre prérempli sur l'incident.                                 |
| **Description**                  | La description Markdown préremplie sur l'incident.                 |
| **Gravité de l'incident**        | La gravité préremplie sur l'incident.                              |
| **État initial de l'incident**   | L'état dans lequel démarrent les incidents issus de ce modèle.     |
| **Ressources affectées**         | Les moniteurs, hôtes, clusters et services à rattacher.            |
| **Change Monitor Status to**     | Le statut de moniteur à appliquer aux moniteurs rattachés.         |
| **Politique d'astreinte**        | Les politiques à exécuter à la création de l'incident.             |
| **Propriétaire - Équipes**       | Les équipes propriétaires des incidents issus de ce modèle.        |
| **Propriétaire - Utilisateurs**  | Les utilisateurs propriétaires des incidents issus de ce modèle.   |
| **Étiquettes**                   | Les étiquettes appliquées à l'incident.                            |

Quelques règles rapides :

- Les modèles ne se modifient pas depuis la liste des modèles — vous en créez un, puis vous l'ouvrez pour le changer.
- Un modèle ne remplit qu'un champ que vous avez laissé vide. Sur la page de création, le modèle s'applique comme un préremplissage que vous pouvez écraser ; via l'API, le serveur ne remplit un champ depuis le modèle que si la requête a laissé ce champ `undefined`. Ce que l'appelant fournit l'emporte toujours.

## Déclarer automatiquement depuis les critères d'un moniteur

La plupart des incidents ne devraient pas exiger qu'un humain les saisisse. Dans l'éditeur de critères d'un moniteur, activez la bascule **When filters match, declare an incident.** et une section **Créer un incident** apparaît, avec un bouton **Ajouter un incident** — un même filtre de critères peut déclarer plusieurs incidents.

Chaque entrée comporte :

- **Titre de l'incident** — accepte les variables ; le texte indicatif suggère quelque chose comme `{{monitorName}} is down`.
- **Gravité** — obligatoire.
- **Description de l'incident** — également variabilisée.
- **Astreinte → Politiques d'astreinte** — les politiques exécutées à la création de cet incident.
- **Rôles d'incident** — attribuez à l'avance des membres de l'équipe aux rôles.
- **Propriété et étiquettes → Équipes propriétaires**, **Utilisateurs propriétaires**, **Étiquettes**.
- **Options avancées → Résoudre automatiquement l'incident** (résout l'incident automatiquement quand les critères cessent de correspondre), **Afficher l'incident sur la page de statut**, **Incident privé** et **Notes de remédiation**.

Pour la liste complète des variables `{{variable}}` utilisables dans le titre, la description et les notes de remédiation, voyez [Modèles d'incident et d'alerte](/docs/monitor/incident-alert-templating).

Les incidents créés ainsi sont marqués par le serveur : `isCreatedAutomatically` est positionné, `createdCriteriaId` retient quel filtre de critères s'est déclenché, et `createdByProbe` retient quelle sonde l'a vu. Pour tout le reste, ils se comportent exactement comme un incident déclaré à la main.

## Déclarer via l'API

Le modèle d'incident expose un point de terminaison CRUD standard : `POST /api/incident` en crée un. Authentifiez-vous avec une clé API générée dans **Paramètres du projet → Clés API**, envoyée dans l'en-tête `apikey` — la clé identifie le projet, vous n'avez donc pas besoin de transmettre un identifiant de projet séparément.

```bash
curl -X POST https://oneuptime.com/api/incident \
  -H "apikey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "title": "Checkout latency above SLO",
      "description": "Investigating elevated p99 latency on the checkout service.",
      "incidentSeverityId": "<incident-severity-id>"
    }
  }'
```

Champs utiles dans le corps de la requête :

- `title` — le seul champ que vous devez vraiment fournir.
- `declaredAt` — facultatif ici, même si le formulaire l'exige. Omettez-le et le serveur prend l'heure courante.
- `incidentSeverityId` et `currentIncidentStateId` — le serveur vérifie que les deux appartiennent au même projet que la clé API, et rejette la requête sinon. Le même contrôle s'applique au statut de moniteur derrière **Change Monitor Status to**.
- `createdIncidentTemplateId` — applique un modèle enregistré. Tout champ omis est rempli depuis le modèle ; tout champ que vous envoyez est conservé tel quel.

Les points de terminaison apparentés sont `/api/incident-state`, `/api/incident-severity` et `/api/incident-state-timeline`. La [référence de l'API](/reference) générée donne les formes exactes de requête et de réponse pour chacun, y compris la façon dont s'expriment les champs de relation comme les moniteurs.

## Numéros d'incident et préfixes

Chaque incident reçoit un numéro séquentiel issu d'un compteur propre au projet, attribué par le serveur à la création. Deux colonnes le portent : `incidentNumber` (l'entier brut) et `incidentNumberWithPrefix` (ce que vous voyez réellement). Sans préfixe configuré, la valeur affichée est `#42`.

Pour changer cela, allez dans **Incidents → Paramètres → Plus de paramètres**. La carte **Préfixe du nombre** contient un champ **Préfixe de numéro d'incident** (jusqu'à 20 caractères, texte indicatif `INC-`) — renseignez-le et le même incident s'affiche `INC-42`. Laissez-le vide pour garder le `#` par défaut. La carte porte aussi **Préfixe de numéro d'épisode d'incident**, pour la numérotation des épisodes.

Le numéro apparaît en première colonne de la liste des incidents, renvoie vers l'incident, et s'affiche comme **Numéro d'incident** sur la **Vue d'ensemble** de l'incident.

## Ce qui se passe à l'instant où un incident est déclaré

L'appel de création fait bien plus qu'écrire une ligne. Dans l'ordre :

1. **Le serveur comble les trous.** `declaredAt` prend l'heure courante par défaut, l'état courant prend par défaut l'état `isCreatedState` du projet, et le numéro d'incident et sa version préfixée sont attribués depuis le compteur du projet.
2. **Un modèle est appliqué**, si `createdIncidentTemplateId` a été fourni — en ne remplissant que les champs laissés indéfinis par l'appelant.
3. **Les règles de confidentialité s'exécutent**, marquant l'incident comme privé si une règle correspondante le dit. C'est le premier moteur de règles à tourner, si bien que tout ce qui suit voit le bon réglage de confidentialité.
4. **Les règles de propriétaire s'exécutent**, ajoutant les utilisateurs et équipes propriétaires que désignent les règles correspondantes.
5. **Les règles d'étiquettes s'exécutent**, ajoutant les étiquettes qui correspondent à l'incident.
6. **Les règles d'astreinte s'exécutent.** Chaque règle activée dans **Incidents → Règles → Règles d'astreinte** dont les critères correspondent ajoute ses politiques à l'incident. Il n'y a ni ordre de priorité ni court-circuit — toutes les règles correspondantes se déclenchent et les politiques sont dédupliquées.
7. **Les règles de runbook s'exécutent**, rattachant et démarrant les runbooks correspondants. Voyez [Runbooks](/docs/runbooks/index).
8. **Les politiques d'astreinte s'exécutent.** Chaque politique portée par l'incident — choisie dans l'assistant, héritée d'un modèle ou ajoutée par une règle — est exécutée en parallèle avec le type d'événement `IncidentCreated`. L'échec d'une politique n'arrête pas les autres.
9. **Les abonnés sont mis en file**, si **Notifier les abonnés de la page de statut** est resté activé et que l'incident est visible sur la page de statut. La livraison est prise en charge par une tâche de fond, pas en ligne avec votre requête.
10. **Les workflows se déclenchent.** Le déclencheur **On Create Incident** lance tout workflow bâti dessus. Voyez [Présentation des workflows](/docs/workflows/index).

À partir de là, l'incident est vivant : il compte dans le badge **Incidents actifs** du menu latéral Incidents (tout état non marqué `isResolvedState` compte comme actif), il apparaît sur les pages de statut qui portent l'un de ses moniteurs, et sa **Chronologie d'état** commence à enregistrer.

## Où lire ensuite

- [Vue d'ensemble des incidents](/docs/incidents/index) — comment s'assemble le modèle d'incident.
- [États et sévérités des incidents](/docs/incidents/states-and-severities) — ce que font les indicateurs d'état et comment ajouter les vôtres.
- [Notes, propriétaires et fil d'incident](/docs/incidents/notes-owners-and-feed) — notes publiques, notes privées, propriétaires et fil d'activité.
- [Paramètres et automatisation des incidents](/docs/incidents/settings) — modèles, champs personnalisés, rôles, règles et déclencheurs de workflow.
- [Abonnés et annonces](/docs/status-pages/subscribers) — qui entend parler de l'incident que vous venez de déclarer.
- [Modèles d'incident et d'alerte](/docs/monitor/incident-alert-templating) — les variables disponibles pour les incidents déclarés automatiquement.
