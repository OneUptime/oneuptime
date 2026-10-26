# Règles et paramètres de la maintenance

La configuration de la maintenance se trouve dans **Maintenance planifiée**, pas dans les **Paramètres du projet** : les règles qui agissent sur chaque nouvel événement, et les paramètres qui façonnent chaque événement du projet. Cette page est la référence de chacun d'eux, et de qui peut les modifier.

:::cards
- [Les règles que traverse un nouvel événement](#les-règles-que-traverse-un-nouvel-événement): Dans l'ordre, et ce que fait chacune.
- [Règles de rappel](#règles-de-rappel): Rappeler l'événement aux propriétaires jusqu'à ce qu'il soit achevé.
- [Paramètres](#paramètres): Modèles de notes, champs personnalisés, mesures et numérotation.
- [Qui peut les modifier](#qui-peut-les-modifier): Les rôles de maintenance, et les forfaits.
:::

## Où se trouvent les paramètres de la maintenance

Ouvrez **Maintenance planifiée** depuis le menu **Produits** de la barre supérieure. Les sections **Règles** et **Paramètres** de son menu latéral sont repliées au départ, dépliez-les donc d'abord. Chaque page ici vaut pour tout le projet, à une adresse qui commence par `/dashboard/{projectId}/scheduled-maintenance-events/settings/`.

| Page de règles     | Ce qu'elle fait                                                     |
| ------------------ | ------------------------------------------------------------------- |
| **Règles de propriétaire** | Ajoute des propriétaires aux événements qui correspondent.  |
| **Règles de runbook** | Démarre des runbooks pour les événements qui correspondent.      |
| **Règles d'étiquettes** | Ajoute des étiquettes aux événements qui correspondent.        |
| **Reminder Rules** | Rappelle l'événement aux propriétaires à intervalle régulier jusqu'à ce qu'il soit achevé. |

La section **Paramètres** contient **État de l'événement**, traité dans [États de la maintenance](/docs/scheduled-maintenance/states), **Modèles d'événement**, traité dans [Modèles et événements récurrents](/docs/scheduled-maintenance/templates), puis **Modèles de notes**, **Champs personnalisés**, **Mesures**, **Paramètres du calendrier** et **Numérotation**. **Paramètres du calendrier** est traité dans [Calendrier de maintenance](/docs/scheduled-maintenance/calendar#calendriers-externes), le reste ci-dessous.

La section **Espace de travail** contient les règles Slack et Microsoft Teams qui publient les événements dans des canaux. Voir [Slack](/docs/workspace-connections/slack#règles-de-notification) et [Microsoft Teams](/docs/workspace-connections/microsoft-teams#règles-de-notification).

## Les règles que traverse un nouvel événement

```mermaid title="Les règles que traverse un nouvel événement, dans l'ordre"
flowchart TB
    created["Un nouvel événement"] --> owners["Règles de propriétaire<br/>ajoutent des propriétaires"]
    owners --> labels["Règles d'étiquettes<br/>ajoutent des étiquettes"]
    labels --> runbooks["Règles de runbook<br/>démarrent des runbooks"]
    runbooks --> reminders["Règles de rappel<br/>planifient les rappels"]
```

Les règles diffèrent dans la façon dont plusieurs correspondances se résolvent :

- **Règles de propriétaire**, **Règles d'étiquettes** et **Règles de runbook** agissent toutes quand elles correspondent. Les propriétaires et étiquettes ajoutés par plusieurs règles sont ajoutés une seule fois.
- **Reminder Rules** sont vérifiées du haut de leur liste vers le bas, et la première correspondance l'emporte. Faites glisser une règle pour changer sa place ; une nouvelle règle va à la fin.

Une nouvelle règle démarre activée ; désactivez **Activé** dans son formulaire de modification pour la mettre en pause, et la liste affiche pour chaque règle un **Activé** vert ou un **Désactivé** rouge. Les règles de propriétaire, d'étiquettes et de runbook agissent sur les événements créés après leur enregistrement. Pour appliquer une règle de propriétaire ou d'étiquettes aux événements que vous avez déjà, utilisez **Exécuter maintenant** : voir [Exécuter des règles sur les ressources existantes](/docs/configuration/run-rules-now).

## Règles de propriétaire et d'étiquettes

Les **Règles de propriétaire** ajoutent des utilisateurs et équipes propriétaires aux nouveaux événements qui correspondent, et les **Règles d'étiquettes** ajoutent des étiquettes. En créer une prend deux étapes : **Correspondance**, les conditions, puis **Propriétaires** ou **Étiquettes**, ce que la règle ajoute.

| Condition                                                       | Correspond à                                                               |
| --------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Moniteurs**, **Étiquettes de l'événement**, **Étiquettes du moniteur** | Les événements avec l'un des moniteurs ou l'une des étiquettes choisis. |
| **Titre de l'événement**, **Description de l'événement**, **Nom du moniteur**, **Description du moniteur** | Un motif, sous forme d'expression régulière, sans tenir compte de la casse. |

Une règle ne correspond que lorsque chaque condition remplie est vraie ; une condition laissée vide est ignorée.

- **Une règle peut hériter.** Repliés sous **Hériter des propriétaires** ou **Hériter des étiquettes**, six interrupteurs transmettent les propriétaires ou les étiquettes des moniteurs, hôtes, clusters Kubernetes, hôtes Docker, hôtes Podman et services de l'événement.
- **Une nouvelle règle doit ajouter quelque chose** : choisissez au moins un propriétaire ou une étiquette, ou activez un interrupteur.
- **Notifier les propriétaires**, sous **Plus de champs** sur une règle de propriétaire, décide si les personnes ajoutées sont prévenues.

[Règles d'étiquettes et de propriétaires](/docs/configuration/label-and-owner-rules) décrit le formulaire étape par étape, pour chaque type de ressource.

## Règles de runbook

Les **Règles de runbook** démarrent un runbook quand un nouvel événement correspond, comme une liste de contrôle avant chaque mise à niveau de base de données. Elles correspondent aux mêmes éléments que les règles de propriétaire et d'étiquettes ; les événements n'ont pas de sévérité, donc les règles de runbook de maintenance n'en proposent pas. L'exécution est rattachée à l'événement, sur sa page **Runbooks**. Voir [Règles de runbook](/docs/runbooks/rules).

## Règles de rappel

**Maintenance planifiée → Règles → Reminder Rules** rappelle l'événement à ses propriétaires jusqu'à ce que les travaux soient validés. Chaque événement reçoit la première règle qui lui correspond, du haut de la liste vers le bas.

:::steps
### Choisir les événements concernés

Cliquez sur **Créer : Règle de rappel des maintenances planifiées**. Dans **Correspondance**, laissez **Tous les événements de maintenance planifiée** sélectionné pour faire des rappels sur chaque événement, ou choisissez **Uniquement les événements de maintenance planifiée qui correspondent aux conditions** puis les **Étiquettes** auxquelles elle s'applique.

### Régler l'intervalle

Dans **Rappels**, réglez **Intervalle de rappel (minutes)**, la fréquence des rappels aux propriétaires, et choisissez quand les envoyer sous **Rappels aux propriétaires**. Son **Nom** suit les deux, par exemple « Rappel toutes les 30 minutes pendant son déroulement », jusqu'à ce que vous saisissiez le vôtre, et une **Description** attend sous **Plus de champs**. Créez ensuite la règle.
:::

| Réponse | Quand les propriétaires reçoivent des rappels |
| --- | --- |
| **Pendant son déroulement** | Du début de l'événement jusqu'à sa fin. Une nouvelle règle commence par cette réponse. |
| **Avant le début** | De la planification de l'événement jusqu'à son début. |
| **Avant le début et pendant son déroulement** | De la planification de l'événement jusqu'à sa fin. |

L'API et Terraform refusent une règle qui attendrait le début de l'événement et s'arrêterait à ce moment-là : elle n'enverrait jamais de rappel. Une règle plus ancienne enregistrée ainsi est signalée dans la liste par **N'envoie jamais de rappel**, et son formulaire vous demande de choisir quand rappeler.

Les propriétaires reçoivent chaque rappel comme **Rappel de maintenance**, activé par e-mail pour chaque nouveau membre. Enregistrer, modifier ou supprimer une règle de rappel réattribue une règle à chaque événement qui n'est pas achevé. Pour arrêter les rappels d'un événement, désactivez **Envoyer des rappels** sur sa page **Paramètres** ; il enregistre dès que vous le basculez.

Ces rappels sont pour votre équipe. Les rappels que reçoivent les abonnés de vos pages de statut avant le début d'un événement se règlent sur l'événement lui-même, sous **Rappels avant l'événement**.

## Paramètres

### Modèles de notes

**Maintenance planifiée → Paramètres → Modèles de notes** contient des textes prêts à l'emploi pour les mises à jour de maintenance. La carte **Modèles de notes publiques ou privées pour les événements de maintenance planifiée** les liste ; **Créer : Modèle de note de maintenance planifiée** demande un **Nom du modèle**, une **Description du modèle** et la **Note**. Un modèle est proposé quand quelqu'un écrit une note publique ou privée sur un événement, et quand quelqu'un change son état, et son texte peut être modifié avant publication. Contrairement aux modèles de notes d'incident, les modèles de notes de maintenance ne remplissent aucune variable.

### Champs personnalisés

**Maintenance planifiée → Paramètres → Champs personnalisés** ajoute vos propres champs à chaque événement, comme un ticket de changement ou un niveau de client. Remplissez-les sur la page **Champs personnalisés** d'un événement, ou via l'API dans `customFields`. Un champ peut copier sa valeur d'un champ personnalisé de moniteur au lieu d'être saisi : voir [Champs copiés depuis un moniteur](/docs/incidents/settings#champs-copiés-dun-moniteur), qui fonctionne de la même façon pour les événements.

### Mesures

**Maintenance planifiée → Paramètres → Mesures** mesure combien de temps les choses prennent sur chaque événement. Choisissez **Retard au démarrage**, du début prévu jusqu'au début réel, **Dépassement**, de la fin prévue jusqu'à la fin réelle, ou **Durée de la maintenance**, du début jusqu'à la fin ; ou deux moments de votre choix avec **Autre chose**. Chaque mesure est affichée sur la page de l'événement et tracée dans un graphique sous `oneuptime.scheduled-maintenance.measurement.<key>`. Voir [Mesures](/docs/incidents/settings#mesures), qui fonctionne de la même façon pour les événements.

### Numérotation

**Maintenance planifiée → Paramètres → Numérotation** définit le texte devant les numéros d'événement : `SM-` dans un nouveau projet, ou `#` sans préfixe. **Mettre à jour** demande le **Préfixe du numéro de maintenance planifiée** et affiche un aperçu du numéro pendant la saisie. Seuls les événements créés ensuite reçoivent le nouveau préfixe ; les existants gardent leurs numéros. Les règles d'un préfixe sont décrites dans [Préfixes de numéro](/docs/incidents/settings#préfixes-de-numéro).

La carte **Prochain numéro** en dessous fixe le numéro que recevra le prochain événement, pour poursuivre les numéros d'un autre outil : **Mettre à jour** ouvre **Prochain numéro de maintenance planifiée**, qui doit être supérieur au plus élevé utilisé à ce jour. Voir [Prochains numéros](/docs/incidents/settings#prochains-numéros).

> [!NOTE]
> Sur OneUptime Cloud, les champs personnalisés requièrent le forfait **Growth** ou supérieur, tout comme l'ajout et la modification d'états de maintenance et de modèles.

## Workflows

Chaque modèle de maintenance a des déclencheurs et des actions de workflow, nommés d'après lui : **On Create Scheduled Maintenance Event**, **On Update Scheduled Maintenance Event**, **On Create or Update Scheduled Maintenance Event** et **On Delete Scheduled Maintenance Event**, de même pour **Scheduled Maintenance State Timeline** et les autres, et des actions comme **Create One Scheduled Maintenance Event** et **Update One Scheduled Maintenance Event**. Les définitions de champs personnalisés et les valeurs de mesure sont les exceptions : elles n'ont aucune étape de workflow. Voir [Présentation des workflows](/docs/workflows/index).

## Qui peut les modifier

| Rôle                              | Ce qu'il peut faire                                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Lecteur de la maintenance planifiée**  | Lit les événements, et ne modifie rien.                                                              |
| **Membre de la maintenance planifiée**  | Crée, modifie et supprime des événements avec leurs notes, chronologies d'état et propriétaires, ainsi que les deux types de modèles. |
| **Administrateur de la maintenance planifiée**   | Tout ce que fait un membre, et en plus crée, modifie et supprime des états de maintenance.          |

Les règles, champs personnalisés et mesures requièrent **Propriétaire du projet** ou **Administrateur du projet**, ou un rôle personnalisé avec l'autorisation propre à cette page, comme **Create Scheduled Maintenance Owner Rule**. Les règles de runbook acceptent aussi **Administrateur des runbooks**. **Membre du projet** travaille avec les événements et les modèles, comme **Membre de la maintenance planifiée**. Voir [Utilisateurs, équipes et autorisations](/docs/permissions/index).

## Dépannage

:::details Une règle de propriétaire n'a ajouté personne à un nouvel événement
Ouvrez la règle et vérifiez ses conditions : chaque condition remplie doit être vraie. Un motif de titre est une expression régulière, donc `db upgrade` ne correspond pas à « DB-Upgrade » ; écrivez `db.upgrade`. Une règle n'agit par ailleurs que sur les événements créés après son enregistrement : utilisez **Exécuter maintenant** pour ceux que vous avez déjà.
:::

:::details Les propriétaires n'ont reçu aucun rappel
Vérifiez qu'une règle de rappel correspond aux étiquettes de l'événement, que **Envoyer des rappels** de l'événement est activé et que **Rappel de maintenance** est activé dans les paramètres de notification des propriétaires. Une règle réglée sur **Pendant son déroulement** n'envoie rien avant le début de l'événement.
:::

## Prochaines étapes

:::cards
- [États de la maintenance](/docs/scheduled-maintenance/states): La page État de l'événement, et ce que fait chaque état.
- [Modèles et événements récurrents](/docs/scheduled-maintenance/templates): La page Modèles d'événement, en détail.
- [Règles d'étiquettes et de propriétaires](/docs/configuration/label-and-owner-rules): Le formulaire de règle, étape par étape.
- [Paramètres de notification](/docs/notifications/notification-settings): Comment chaque propriétaire choisit ce qui lui parvient.
:::
