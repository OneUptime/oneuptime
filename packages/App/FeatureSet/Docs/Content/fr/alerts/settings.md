# Règles et paramètres des alertes

La configuration des alertes se trouve dans **Alertes**, pas dans les **Paramètres du projet** : les règles qui agissent sur chaque nouvelle alerte, et les paramètres qui façonnent chaque alerte du projet. Cette page est la référence de chacun d'eux, et de ce qui s'exécute de lui-même à la création d'une alerte.

:::cards
- [Les règles que traverse une nouvelle alerte](#les-règles-que-traverse-une-nouvelle-alerte): Dans l'ordre, et ce que fait chacune.
- [Règles d'astreinte](#règles-dastreinte): Alerter les bonnes personnes sans choisir une politique à chaque fois.
- [Règles de rappel](#règles-de-rappel): Rappeler les propriétaires tant qu'une alerte reste ouverte.
- [Paramètres](#paramètres): Modèles de notes, champs personnalisés, mesures, appartenance aux épisodes et numérotation.
:::

## Où se trouvent les paramètres des alertes

Ouvrez **Alertes** depuis le menu **Produits** de la barre supérieure. Les sections **Règles** et **Paramètres** de son menu latéral commencent repliées, dépliez-les donc d'abord. Chaque page ici s'applique à tout le projet, à des adresses commençant par `/dashboard/{projectId}/alerts/settings/`.

| Page de règles                  | Ce qu'elle fait                                                                                |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Règles de regroupement**      | Réunit les alertes liées en épisodes. Voir [Épisodes d'alertes et règles de regroupement](/docs/alerts/episodes). |
| **Règles d'astreinte**          | Exécute des politiques d'astreinte pour les alertes et les épisodes qui correspondent.         |
| **Règles de propriétaire**      | Ajoute des propriétaires aux alertes et aux épisodes qui correspondent.                        |
| **Règles de runbook**           | Lance des runbooks pour les alertes qui correspondent.                                         |
| **Règles de confidentialité**   | Rend privés les alertes et les épisodes qui correspondent.                                     |
| **Règles d'étiquettes**         | Ajoute des étiquettes aux alertes et aux épisodes qui correspondent.                           |
| **Reminder Rules**              | Rappelle aux propriétaires, à intervalle régulier, qu'une alerte est ouverte.                  |

La section **Paramètres** contient **État de l'alerte** et **Gravité de l'alerte**, traités dans [États et sévérités des alertes](/docs/alerts/states-and-severities), puis **Modèles de notes**, **Champs personnalisés**, **Mesures**, **Appartenance aux épisodes** et **Numérotation**, traités ci-dessous.

Deux autres sections agissent sur les alertes. **Alertes → IA → Paramètres** décide de ce que OneUptime AI fait de lui-même : **Investiguer les nouvelles alertes**, activé pour les nouveaux projets, et **Corriger automatiquement les nouvelles alertes**, désactivé jusqu'à ce que vous l'activiez. Voir [AI SRE](/docs/ai/ai-sre). **Alertes → Espace de travail** contient les règles Slack et Microsoft Teams qui publient les alertes et les épisodes dans des canaux, ainsi que son onglet **Résumé**. Voir [Slack](/docs/workspace-connections/slack).

## Les règles que traverse une nouvelle alerte

```mermaid title="Les règles que traverse une nouvelle alerte, dans l'ordre"
flowchart TB
    subgraph shape["Qui la voit et la possède"]
        direction LR
        privacy["Règles de<br/>confidentialité"] --> owner["Règles de<br/>propriétaire"]
    end
    subgraph more["Ce qu'elle porte"]
        direction LR
        label["Règles<br/>d'étiquettes"] --> oncall["Règles<br/>d'astreinte"]
    end
    subgraph page["Ce qu'elle lance"]
        direction LR
        runbook["Règles de<br/>runbook"] --> execute["Les politiques<br/>s'exécutent"]
    end
    subgraph follow["Ensuite"]
        direction LR
        grouping["Règles de<br/>regroupement"] --> reminder["Règles de<br/>rappel"]
    end
    shape --> more
    more --> page
    page --> follow
```

Les règles diffèrent dans la façon dont plusieurs correspondances se résolvent :

- **Règles de regroupement** et **Reminder Rules** sont vérifiées de haut en bas de leur liste, et la première correspondance l'emporte. Faites glisser une règle pour changer sa place ; une nouvelle règle va à la fin.
- **Règles d'astreinte**, **Règles de propriétaire**, **Règles d'étiquettes**, **Règles de confidentialité** et **Règles de runbook** agissent toutes quand elles correspondent. Les politiques d'astreinte, propriétaires et étiquettes qu'ajoutent plusieurs règles ne sont ajoutés qu'une fois.

**Règles d'astreinte**, **Règles de propriétaire**, **Règles d'étiquettes** et **Règles de confidentialité** ont deux onglets : **Règles d'alerte**, pour les alertes, et **Règles d'épisode**, qui agissent de la même façon sur chaque nouvel épisode d'alerte. Une nouvelle règle commence activée ; désactivez **Activé** dans son formulaire de modification pour la mettre en pause, et la liste affiche un **Activé** vert ou un **Désactivé** rouge pour chaque règle.

La plupart des règles agissent sur les alertes et les épisodes créés après leur enregistrement. Pour appliquer une règle de propriétaire, d'étiquettes ou de confidentialité à ceux que vous avez déjà, utilisez **Exécuter maintenant** : voir [Exécuter des règles sur les ressources existantes](/docs/configuration/run-rules-now). Les règles de rappel font exception : en enregistrer une fait correspondre à nouveau chaque alerte ouverte.

### Conditions

Les conditions d'une règle décident sur quelles alertes elle agit, et se lisent comme des phrases : « Si **Titre de l'alerte** contient `database` », « Et **Étiquettes du moniteur** contient l'un de *Production* ». Une règle sans condition correspond à chaque alerte.

| Condition                                                     | Compare avec                                                                                                   |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Moniteurs**, **Gravités d'alerte**, **Étiquettes d'alerte**, **Étiquettes du moniteur** | **Contient l'un de**, **Contient tous les** ou **Ne contient aucun de**, appliqués aux valeurs que vous choisissez. |
| **Titre de l'alerte**, **Description de l'alerte**, **Nom du moniteur**, **Description du moniteur** | **Contient**, **Ne contient pas**, **Égal à**, **Différent de**, **Commence par**, **Se termine par**, sans tenir compte de la casse, ou **Correspond au modèle** et **Ne correspond pas au modèle**, pour une expression régulière ou un joker `*`. |

Avec deux conditions ou plus, choisissez **Toutes requises**, où chacune doit être remplie, ou **Au moins une requise**, où une seule suffit. Les règles d'épisode portent, elles, sur la gravité, les étiquettes, le titre et la description d'un épisode.

## Règles d'astreinte

**Alertes → Règles → Règles d'astreinte** rend les appels automatiques. Chaque règle qui correspond ajoute ses politiques à la nouvelle alerte, et l'alerte les exécute avec les politiques qu'elle avait déjà, chacune une seule fois.

:::steps
### Choisir les alertes

Cliquez sur **Créer : Règle d'astreinte des alertes**. Dans **Correspondance**, **Toutes les alertes**, où démarre une nouvelle règle, correspond à chaque nouvelle alerte. Pour la restreindre, choisissez **Uniquement les alertes qui correspondent aux conditions** et ajoutez les conditions qu'une alerte doit remplir.

### Choisir les politiques

Dans **Politiques d'astreinte**, choisissez les **Politiques d'astreinte** que la règle déclenche. Son **Nom** les suit, comme « Alerter Platform on-call », jusqu'à ce que vous saisissiez le vôtre, et une **Description** attend sous **Plus de champs**. Créez ensuite la règle.
:::

Une gravité n'alerte personne à elle seule : une règle d'astreinte qui porte sur les **Gravités d'alerte** est la façon de mettre en place « alerter l'équipe base de données pour chaque alerte Élevé ». Pour voir ce qui s'est exécuté pour une alerte, ouvrez sa page **Exécutions d'astreinte**. Chaque personne est ensuite jointe comme elle l'a configuré dans **Paramètres utilisateur → Règles d'astreinte**, dans l'onglet **Alertes** ; voir [Règles d'escalade](/docs/on-call/escalation-rules).

Une règle alerte dès qu'une alerte lui correspond. Pour qu'elle attende plutôt les heures ouvrées, répondez **Uniquement pendant les heures ouvrées** à **Quand cette règle doit-elle alerter ?** sous **Plus de champs**. Les **Heures ouvrées** commencent du lundi au vendredi, de 09:00 à 17:00, dans votre propre fuseau horaire : choisissez d'autres jours, une autre **Heure de début** ou **Heure de fin**, ou un autre **Fuseau horaire**, et une phrase sous le choix indique ce qui se passera. Dans la liste, la règle affiche ses heures sous son nom. Une alerte qui correspond en dehors de ces heures reçoit une exécution qui attend et n'alerte personne ; quand les heures commencent, la politique déclenche sa première règle d'escalade et escalade comme d'habitude. Si l'alerte est prise en compte ou résolue avant, personne n'est alerté. Si l'alerte change pendant qu'elle attend et correspond désormais à une règle qui alerte immédiatement, par exemple parce que sa gravité a été relevée, l'exécution commence aussitôt à alerter, et le fil d'activité de l'alerte indique pourquoi. Deux règles qui déclenchent la même politique la déclenchent dès que l'une d'elles le permet : une règle pour vos gravités les plus hautes qui alerte immédiatement, à côté d'une règle pour le reste qui attend les heures ouvrées, garde les nuits calmes.

## Règles de propriétaire et d'étiquettes

Les **Règles de propriétaire** ajoutent des utilisateurs et des équipes propriétaires aux nouvelles alertes qui correspondent, et les **Règles d'étiquettes** ajoutent des étiquettes. En créer une prend deux étapes : **Correspondance**, les conditions, puis **Propriétaires** ou **Étiquettes**, ce que la règle ajoute. Le **Nom** de la règle suit ce que vous choisissez jusqu'à ce que vous saisissiez le vôtre.

- **Une règle peut hériter.** Repliés sous **Hériter des propriétaires** ou **Hériter des étiquettes**, six interrupteurs transmettent les propriétaires ou les étiquettes du moniteur, des hôtes, des clusters Kubernetes, des hôtes Docker, des hôtes Podman et des services de l'alerte. Les règles d'épisode n'ont pas ces interrupteurs. La section **Hériter des propriétaires** d'une règle de propriétaires se termine par **Équipe du créateur** : parmi les équipes qui y figurent, chacune dont fait partie la personne qui crée l'alerte devient aussi propriétaire.
- **Une nouvelle règle doit ajouter quelque chose** : choisissez au moins un propriétaire ou une étiquette, ou activez un interrupteur. Sur une règle de propriétaires d'incident ou d'alerte, une équipe sous **Équipe du créateur** suffit aussi.
- **Notifier les propriétaires**, sous **Plus de champs** d'une règle de propriétaire, décide si les personnes ajoutées sont prévenues.

[Règles d'étiquettes et de propriétaires](/docs/configuration/label-and-owner-rules) décrit le formulaire étape par étape, pour chaque type de ressource.

## Règles de confidentialité et de runbook

Les **Règles de confidentialité** rendent privées les nouvelles alertes qui correspondent, avant que quoi que ce soit d'autre ne s'exécute : seuls leurs propriétaires et les administrateurs et propriétaires du projet peuvent les voir. Une règle a deux étapes : **Correspondance**, les alertes qu'elle rend privées, puis **Nom**, déjà rempli avec « Rendre les alertes privées ». Voir [Alertes privées](/docs/alerts/index#alertes-privées).

Les **Règles de runbook** lancent un runbook quand une nouvelle alerte correspond, sauf si l'alerte a été créée résolue. Voir [Règles de runbook](/docs/runbooks/rules).

## Règles de rappel

**Alertes → Règles → Reminder Rules** rappelle aux propriétaires d'une alerte qu'elle reste ouverte. Chaque nouvelle alerte reçoit la première règle qui lui correspond, de haut en bas de la liste.

:::steps
### Choisir les alertes à rappeler

Cliquez sur **Créer : Règle de rappel des alertes**. Dans **Correspondance**, laissez **Toutes les alertes** sélectionné pour rappeler chaque alerte, ou choisissez **Uniquement les alertes qui correspondent aux conditions** puis les **Gravités d'alerte** et les **Étiquettes** auxquelles elle s'applique.

### Régler l'intervalle

Dans **Rappels**, réglez **Intervalle de rappel (minutes)**, la fréquence des rappels aux propriétaires, et **Arrêter les rappels quand** : **Résolu**, par défaut, ou **Pris en compte**. Son **Nom** suit les deux, par exemple « Rappel toutes les 30 minutes jusqu'à la résolution », jusqu'à ce que vous saisissiez le vôtre. Créez ensuite la règle.
:::

Les propriétaires reçoivent chaque rappel sous la forme **Rappel d'alerte**, activé par e-mail par défaut. La règle d'une alerte est à nouveau mise en correspondance quand sa gravité ou ses étiquettes changent. Pour arrêter les rappels d'une alerte, désactivez **Envoyer des rappels** sur sa page **Paramètres** ; l'enregistrement se fait dès que vous le basculez.

## Paramètres

### Modèles de notes

**Alertes → Paramètres → Modèles de notes** contient du texte prêt à l'emploi pour les notes privées. La carte **Modèles de notes privées pour les alertes** les liste ; **Créer : Modèle de note d'alerte** demande un **Nom du modèle**, une **Description du modèle** et la **Note**. Un modèle est proposé quand quelqu'un écrit une note privée sur une alerte ou un épisode, et quand il en prend un en compte ou en résout un, et son texte peut être modifié avant publication. Les modèles de notes d'alerte sont du texte brut : contrairement aux modèles de notes d'incident, ils ne remplissent aucune variable.

### Champs personnalisés

**Alertes → Paramètres → Champs personnalisés** ajoute vos propres champs à chaque alerte, comme un niveau de client ou une référence de ticket. Remplissez-les sur la page **Champs personnalisés** d'une alerte, ou via l'API sous `customFields`. Un champ peut copier sa valeur d'un champ personnalisé du moniteur au lieu d'être saisi : voir [Champs copiés d'un moniteur](/docs/incidents/settings#champs-copiés-dun-moniteur), qui fonctionne de la même façon pour les alertes.

### Mesures

**Alertes → Paramètres → Mesures** chronomètre le temps que prennent les choses sur chaque alerte. Choisissez **Délai de prise en compte** ou **Délai de résolution**, ou deux moments à vous, comme quand **L'alerte est créée** et quand elle entre dans un état que vous choisissez. Chaque mesure s'affiche sur la page de l'alerte et figure dans les graphiques sous `oneuptime.alert.measurement.<key>`. Voir [Mesures](/docs/incidents/settings#mesures), qui fonctionne de la même façon pour les alertes.

La mesure **Délai de prise en compte après l'alerte** compte à partir de **Quelqu'un est alerté pour la première fois**, quand une politique d'astreinte ou un appel direct a alerté quelqu'un pour la première fois au sujet de l'alerte, plutôt qu'à partir de sa création : une alerte levée la nuit, pour laquelle personne n'est alerté avant le matin, ne se voit pas compter la nuit. Une alerte pour laquelle personne n'a été alerté n'a pas de valeur. Voir [Délai de prise en compte après l'alerte](/docs/incidents/settings#délai-de-prise-en-compte-après-lalerte).

### Appartenance aux épisodes

**Alertes → Paramètres → Appartenance aux épisodes** décide si une alerte peut faire partie de plusieurs épisodes. Activez **Une alerte ne peut faire partie que d'un seul épisode**, et une alerte qui fait partie d'un épisode n'est ajoutée à aucun autre, ni depuis le tableau de bord, ni par l'API, un workflow ou une règle de regroupement, si elle n'est pas d'abord retirée de cet épisode. L'interrupteur est désactivé tant que vous ne l'activez pas, et seuls les Project Owners et les Project Admins peuvent le changer. L'activer ne retire aucune alerte d'un épisode. Voir [Un seul épisode par incident](/docs/incidents/episodes#un-seul-épisode-par-incident), qui fonctionne de la même façon pour les alertes.

### Numérotation

**Alertes → Paramètres → Numérotation** définit le texte placé devant les numéros d'alerte et d'épisode : `ALT-` et `AE-` dans un nouveau projet, ou `#` sans préfixe. **Mettre à jour** ouvre **Préfixe du numéro d'alerte** et **Préfixe du numéro d'épisode d'alerte**, avec un aperçu pendant la saisie. Seuls les alertes et les épisodes créés ensuite reçoivent le nouveau préfixe. Les règles d'un préfixe sont décrites dans [Préfixes de numéro](/docs/incidents/settings#préfixes-de-numéro).

La carte **Prochain numéro** en dessous fixe le numéro que recevront la prochaine alerte et le prochain épisode, pour poursuivre les numéros d'un autre outil : **Mettre à jour** ouvre **Prochain numéro d'alerte** et **Prochain numéro d'épisode d'alerte**, chacun supérieur au plus élevé utilisé à ce jour. Voir [Prochains numéros](/docs/incidents/settings#prochains-numéros).

> [!NOTE]
> Sur OneUptime Cloud, les modèles de notes et les champs personnalisés nécessitent l'offre **Growth** ou supérieure.

## Workflows

Chaque modèle d'alerte a des déclencheurs et des actions de workflow, nommés d'après lui : **On Create Alert**, **On Update Alert**, **On Create or Update Alert** et **On Delete Alert**, de même pour **Épisode d'alerte**, **Chronologie des états de l'alerte** et les autres, et des actions comme **Create One Alert** et **Update One Alert**. Les définitions de champs personnalisés d'alerte sont la seule exception : elles n'ont pas de déclencheurs de workflow. Voir [Présentation des workflows](/docs/workflows/index).

## Qui peut les modifier

Les règles, les champs personnalisés et les mesures exigent un Project Owner ou un Project Admin, ou un rôle personnalisé disposant de l'autorisation propre à cette règle. **Membre des alertes** travaille avec les alertes et les épisodes, leurs notes, propriétaires et chronologies d'état, ainsi qu'avec les modèles de notes, et **Administrateur des alertes** gère en plus les états et les gravités d'alerte. Voir [Utilisateurs, équipes et autorisations](/docs/permissions/index).

## Étapes suivantes

:::cards
- [Épisodes d'alertes et règles de regroupement](/docs/alerts/episodes): Les règles de regroupement, en détail.
- [Règles d'escalade](/docs/on-call/escalation-rules): Ce qui se passe une fois qu'une règle d'astreinte exécute une politique.
- [Règles d'étiquettes et de propriétaires](/docs/configuration/label-and-owner-rules): Le formulaire de règle, étape par étape.
- [AI SRE](/docs/ai/ai-sre): Investiguer et corriger automatiquement les nouvelles alertes.
:::
