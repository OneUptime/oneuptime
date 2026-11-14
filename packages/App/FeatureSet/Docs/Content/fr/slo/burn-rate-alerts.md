# Alertes et incidents de taux de consommation

Les budgets d'erreur vous disent où vous en êtes ; les règles de taux de consommation vous disent quand vous lever. Quand un SLO consomme son budget d'erreur assez vite pour que cela compte, une règle de taux de consommation déclenche une alerte, déclare un incident, ou les deux, avec vos propres titre et description, gravité, propriétaires, étiquettes, escalade d'astreinte et notifications d'espace de travail.

:::cards
- [Comment une règle décide](#comment-une-règle-décide-de-se-déclencher): Deux fenêtres, toutes deux au-dessus du seuil.
- [Règles par défaut](#règles-par-défaut): Fast burn, Slow burn et Slow leak, adaptées à la fenêtre du SLO.
- [Créer une règle](#créer-ou-modifier-une-règle): Cinq étapes sur la page Règles de taux de consommation du SLO.
- [Variables de modèle](#ce-que-dit-chaque-alerte-et-chaque-incident): Écrivez vos propres titres et descriptions.
:::

## Ce que signifie le taux de consommation

Le taux de consommation est la vitesse à laquelle vous dépensez votre budget d'erreur par rapport à un rythme régulier :

```text
burn rate = (share of time that was bad) ÷ (share of time the target allows to be bad)
```

Avec un taux de consommation de 1, vous dépensez le budget exactement sur la fenêtre et atteignez l'objectif sans rien de reste. Plus le chiffre est élevé, plus le budget s'épuise tôt. Pour un SLO à 99,9 % sur 30 jours :

| Taux de consommation, s'il dure | Budget épuisé en |
| --- | --- |
| 1 | 30 jours |
| 2 | 15 jours |
| 6 | 5 jours |
| 14.4 | environ 2 jours (50 heures) |

Le taux de consommation ne dépend pas du budget qui reste. Il répond à « à quel point est-ce grave en ce moment ? », ce dont a besoin la décision d'alerter quelqu'un.

Pour agir plutôt selon le budget qui reste, par exemple ne livrer que du travail de fiabilité une fois qu'il n'en reste qu'un quart, donnez au SLO une [politique de budget d'erreur](/docs/slo/error-budget-policy).

## Comment une règle décide de se déclencher

OneUptime vérifie chaque règle de taux de consommation activée à chaque évaluation du SLO, toutes les 5 minutes. Chaque règle mesure le taux de consommation sur deux fenêtres et ne se déclenche que si les deux atteignent ou dépassent son seuil :

- La **fenêtre longue** (par exemple 1 heure) montre que la consommation est durable et significative, et pas une simple vérification ratée.
- La **fenêtre courte** (par exemple 5 minutes) montre qu'elle est toujours en cours. Sans elle, un pic d'il y a une heure continuerait d'alerter longtemps après le rétablissement.

C'est le modèle multi-fenêtres et multi-taux du Google SRE Workbook, et celui que OneUptime met en place par défaut.

```mermaid title="Ce que fait une règle de taux de consommation à chaque évaluation"
flowchart TB
    start["Le SLO est évalué"] --> long(["Fenêtre longue<br/>au seuil ou<br/>au-dessus ?"])
    long -->|"Non"| recover["Résoudre ce qui est<br/>ouvert, si la résolution<br/>automatique est active"]
    long -->|"Oui"| short(["Fenêtre courte<br/>au seuil ou<br/>au-dessus ?"])
    short -->|"Non"| hold["Laisser ouvert<br/>ce qui est ouvert"]
    short -->|"Oui"| fire["Déclencher l'alerte,<br/>déclarer l'incident,<br/>ou les deux"]
```

Une règle ne peut pas se déclencher tant que le SLO n'a pas une fenêtre longue complète d'historique de surveillance : sinon, la toute première vérification ratée d'un moniteur, divisée par quelques minutes d'historique, donnerait un taux de consommation énorme. Un nouveau SLO ne peut donc pas déclencher sa règle **Fast burn** pendant sa première heure, ni sa règle **Slow burn** pendant ses six premières, ni sa règle **Slow leak** pendant ses trois premiers jours. Si un SLO n'a plus autant d'historique plus tard, par exemple après le remplacement de ses moniteurs par de nouveaux, la règle résout ce qu'elle a d'ouvert au lieu de le laisser en suspens. Une règle ne se déclenche pas non plus tant que l'un des moniteurs du SLO est en maintenance planifiée : voir [Maintenance planifiée](#maintenance-planifiée).

## Règles par défaut

Chaque nouveau SLO reçoit trois règles de taux de consommation. Pour une fenêtre de 30 jours :

| Règle | Seuil | Fenêtre longue | Fenêtre courte | Se déclenche quand |
| --- | --- | --- | --- | --- |
| **Fast burn** | 14.4× | 1 heure | 5 minutes | Environ 2 % du budget est consommé en une heure : il serait épuisé en environ 2 jours. |
| **Slow burn** | 6× | 6 heures | 30 minutes | Environ 5 % du budget est consommé en six heures : il serait épuisé en environ 5 jours. |
| **Slow leak** | 1× | 3 jours | 6 heures | Environ 10 % du budget est consommé en trois jours : il serait épuisé d'ici la fin de la fenêtre. |

Fast burn et Slow burn servent à alerter quelqu'un : elles déclenchent une alerte à la gravité d'alerte la plus élevée du projet. Slow leak sert de ticket : elle déclenche son alerte à la gravité d'alerte la plus basse du projet. Elle repère une consommation régulière qui n'atteint jamais le seuil des deux autres : à 3×, le budget d'un SLO à 99,9 % est épuisé en 10 jours, et pourtant seule Slow leak se déclenche. Après la résolution de son alerte, elle attend 24 heures, et non sa fenêtre longue de 3 jours, avant d'en déclencher une autre.

Les seuils sont calculés pour un budget de 30 jours, OneUptime les adapte donc à la fenêtre de votre SLO. Fast burn et Slow burn signifient toujours « 2 % du budget en 1 heure » et « 5 % du budget en 6 heures » :

| Fenêtre du SLO | Seuil Fast burn | Seuil Slow burn |
| --- | --- | --- |
| 7 jours | 3.36× | 1.4× |
| 28 jours | 13.44× | 5.6× |
| 30 jours | 14.4× | 6× |
| 90 jours | 43.2× | 18× |

Slow leak signifie toujours « 10 % du budget sur sa fenêtre longue ». Sur une fenêtre de 30 jours ou plus, ses fenêtres restent de 3 jours et 6 heures et son seuil augmente avec la fenêtre. Sur une fenêtre plus courte, sa fenêtre longue vaut un dixième de la fenêtre du SLO et sa fenêtre courte un douzième de celle-ci, son seuil reste donc à 1×. Si sa fenêtre longue restait à 3 jours, son seuil passerait sous 1× et elle se déclencherait pour un SLO en bonne voie d'atteindre son objectif.

| Fenêtre du SLO | Seuil Slow leak | Fenêtre longue | Fenêtre courte |
| --- | --- | --- | --- |
| 7 jours | 1× | 16,8 heures | 84 minutes |
| 28 jours | 1× | 2,8 jours | 5,6 heures |
| 30 jours | 1× | 3 jours | 6 heures |
| 90 jours | 3× | 3 jours | 6 heures |

Les SLO par mois calendaire reçoivent les valeurs de 30 jours. Les règles utilisent le titre et la description intégrés, résolvent leurs alertes automatiquement et n'ajoutent ni propriétaires ni étiquettes. Aucune d'elles ne déclare d'incident, une mise à niveau de OneUptime ne se met donc jamais à déclarer des incidents à votre place. Modifiez-les, supprimez-les ou ajoutez les vôtres.

### Ajouter les règles recommandées à un SLO existant

Les SLO créés avant l'arrivée de Slow leak n'ont que Fast burn et Slow burn : une mise à niveau de OneUptime n'ajoute jamais d'elle-même une règle qui se mettrait à déclencher des alertes. Tant qu'il manque à un SLO l'une des trois règles par défaut, sa page **Règles de taux de consommation** les nomme dans une note au-dessus du tableau. Cliquez sur **Ajouter les règles recommandées** dans la note pour voir exactement ce qui sera ajouté, adapté à la fenêtre du SLO, puis confirmez. Seules les règles manquantes sont ajoutées, et cliquer de nouveau n'ajoute rien.

Une règle compte comme présente quand le SLO a une règle du même nom, ou une règle avec la même fenêtre longue, qu'elle soit activée ou non. Une règle par défaut que vous avez renommée ou ajustée n'est donc jamais ajoutée deux fois. Pour que la note cesse de proposer une règle par défaut dont vous ne voulez pas, gardez la règle et désactivez-la au lieu de la supprimer. Il vous faut la permission de créer des règles de taux de consommation de SLO. Chaque règle ajoutée ainsi est publiée dans le fil d'activité du SLO et enregistrée dans ses journaux d'audit, comme une règle que vous créez vous-même.

### Les ajouter à plusieurs SLO à la fois

Pour donner les règles recommandées à de nombreux SLO, partez de la liste des SLO plutôt que de la page de chaque SLO.

:::steps
#### Sélectionner les SLO

Ouvrez **SLOs** et sélectionnez les SLO à mettre à jour. Pour prendre tous les SLO qu'affiche un filtre, sélectionnez toute la page, puis toutes les correspondances que la liste propose.

#### Choisir l'action groupée

Ouvrez **Actions groupées** et choisissez **Ajouter les règles recommandées**.

#### Vérifier ce qui sera ajouté, puis confirmer

Avant tout ajout, la confirmation compte combien des SLO sélectionnés reçoivent chaque règle, adaptée à leur propre fenêtre. Quand des SLO aux fenêtres différentes reçoivent une règle sous des formes différentes, comme Slow leak sur un SLO de 7 jours et sur un SLO de 30 jours, elle liste chaque forme avec son seuil, ses fenêtres et les SLO qui la reçoivent. Elle indique aussi combien ont déjà toutes les règles recommandées, et combien n'ont pas pu être lus. Cliquez sur **Ajouter les règles recommandées** pour les ajouter.
:::

Chaque SLO ne reçoit que les règles qui lui manquent, exactement comme sa propre page **Règles de taux de consommation** les ajouterait : la même vérification de ce qui compte comme présent, et un élément dans le fil d'activité et une entrée dans les journaux d'audit pour chaque règle. Le résultat indique, pour chaque SLO, si des règles ont été ajoutées, s'il avait déjà toutes les règles recommandées, ou s'il n'a pas été modifié et pourquoi, par exemple pour un SLO que vous n'avez pas le droit de modifier. Un SLO qui n'est pas modifié n'empêche jamais les autres de l'être, et relancer l'action sur les mêmes SLO n'ajoute rien. Les SLO archivés ne figurent pas dans la liste et ne se voient jamais proposer les règles, car ils ne sont pas évalués : désarchivez d'abord le SLO.

Des scripts peuvent faire de même par l'API, avec une [clé d'API](/docs/api-reference/api-reference) du projet. Les requêtes pour un seul SLO attendent `{ "serviceLevelObjectiveId": "..." }` et renvoient les règles dans `rules`. Les requêtes groupées attendent `{ "serviceLevelObjectiveIds": ["..."] }`, avec 100 SLO au plus par requête, et renvoient une entrée pour chaque SLO dans `results`, dans l'ordre demandé :

| Requête | Ce qu'elle fait |
| --- | --- |
| `POST /api/service-level-objective-burn-rate-rule/recommended-rules` | Liste les règles recommandées qui manquent au SLO. Elle n'enregistre rien. |
| `POST /api/service-level-objective-burn-rate-rule/recommended-rules/add` | Les ajoute, et liste ce qu'elle a ajouté. La relancer n'ajoute rien. |
| `POST /api/service-level-objective-burn-rate-rule/recommended-rules/bulk` | Indique ce qui manque à chaque SLO : `Missing` avec les règles, `NothingMissing`, ou `Refused` pour un SLO que vous n'avez pas le droit de lire. Elle n'enregistre rien. |
| `POST /api/service-level-objective-burn-rate-rule/recommended-rules/bulk/add` | Ajoute ce qui manque à chaque SLO, un SLO après l'autre : `Added` avec les règles, `NothingMissing`, `Refused`, ou `Failed` avec les règles ajoutées avant l'échec. La relancer n'ajoute que ce qui manque encore. |

## Créer ou modifier une règle

Il vous faut la permission de créer des règles de taux de consommation de SLO.

:::steps
### Ouvrir Règles de taux de consommation

Ouvrez le SLO, allez dans **Règles de taux de consommation**, dans la section **Règles** de son menu latéral, et cliquez sur **Créer : Règle de taux de consommation du SLO**, ou modifiez l'une des règles par défaut.

### Nommer la règle

Dans **Règle**, saisissez un **Nom**, comme « Fast burn ». Une nouvelle règle est active ; pour qu'elle cesse plus tard de se déclencher, désactivez **Activé** dans son formulaire de modification.

### Définir la fenêtre de consommation

Dans **Fenêtre de consommation**, définissez le **Seuil de taux de consommation** (par exemple `14.4`), la **Fenêtre longue (minutes)** et la **Fenêtre courte (minutes)**, et éventuellement la **Suppression du redéclenchement (minutes)**.

### Choisir ce qu'elle déclare

Dans **Ce qu'elle déclare**, répondez à **Quand elle se déclenche** : **Créer une alerte**, le choix par défaut, **Déclarer un incident** ou **Les deux**. **Ajouter les propriétaires du SLO comme propriétaires** fait aussi des propriétaires du SLO les propriétaires de tout ce que crée la règle.

### Décrire l'alerte et l'incident

Les étapes **Alerte** et **Incident** n'apparaissent que pour ce que la règle déclare. Chacune a un titre et une gravité, et des sections repliées : **Description**, **Propriété et étiquettes**, **Astreinte** et **Plus de champs**, qui contient la résolution automatique, la confidentialité et les notes de remédiation. Les nouvelles règles commencent avec le titre et la description intégrés, prêts à être modifiés. Cliquez sur **Créer : Règle de taux de consommation du SLO** à la dernière étape.
:::

OneUptime vérifie les nombres d'une règle quand vous l'enregistrez :

| Réglage | Doit être |
| --- | --- |
| **Seuil de taux de consommation** | Supérieur à 0. |
| **Fenêtre courte (minutes)** | Supérieure à 0. |
| **Fenêtre longue (minutes)** | Plus longue que la fenêtre courte. |
| **Suppression du redéclenchement (minutes)** | 0 ou plus. Vide signifie la durée de la fenêtre longue. |

Chaque réponse à **Quand elle se déclenche** ouvre quelque chose. L'API refuse une règle qui ne créerait aucune alerte et ne déclarerait aucun incident, car elle serait vérifiée à chaque évaluation sans jamais rien déclarer.

Le tableau des règles affiche, pour chaque règle, son seuil, ses fenêtres et sa suppression, ce qu'elle déclare (et si l'alerte ou l'incident n'est résolu qu'à la main, ou est privé), ses gravités, ses politiques d'astreinte, ses propriétaires et ses étiquettes.

> [!TIP]
> Un bon départ : gardez les trois règles par défaut, envoyez la règle de consommation rapide à votre politique d'astreinte qui alerte, avec une gravité élevée, laissez la règle de consommation lente déclencher une alerte de gravité plus basse pour les heures de bureau, et faites de la règle de fuite lente un ticket pour l'équipe responsable. Si votre équipe gère tout par des incidents, choisissez **Déclarer un incident** pour la règle de consommation rapide, ou **Les deux** pour recevoir aussi une alerte.

## Ce qu'une règle déclare

|  | **Alerte** | **Incident** |
| --- | --- | --- |
| Ouvert par | **Créer une alerte**, le choix par défaut, ou **Les deux** | **Déclarer un incident** ou **Les deux** |
| Ce que c'est | Le signal léger : il arrive dans la liste des alertes. | Le signal lourd : il prend un numéro d'incident et lance tout le processus de réponse. |
| Titre et description | Les siens, ou le texte intégré | Les siens, ou le texte intégré |
| Gravité | **Gravité de l'alerte** : la plus élevée du projet si vide | **Gravité de l'incident** : la plus élevée du projet si vide |
| Escalade | **Politiques d'astreinte de l'alerte** | **Politiques d'astreinte de l'incident** |
| Propriétaires et étiquettes | **Propriétaires de l'alerte** et **Étiquettes d'alerte** | **Propriétaires de l'incident** et **Étiquettes d'incident** |
| Privé | Désactivé | Désactivé |
| Résolution automatique | Activée | Activée |
| Pages de statut | Jamais publié | Jamais publié |

Comme chacun est configuré séparément, vous pouvez envoyer une alerte brève à la rotation de l'équipe responsable et un incident détaillé à votre rotation pour les incidents majeurs. Ils vivent aussi séparément : chacun est dédupliqué, résolu et suspendu de son côté, résoudre l'incident ne réinitialise donc pas la suppression de l'alerte, ni l'inverse.

### Le SLO est une ressource affectée

Chaque alerte et chaque incident qu'une règle de taux de consommation crée liste son SLO sous **Ressources affectées** et renvoie vers lui. Le filtre **Ressources affectées** des listes d'alertes et d'incidents les restreint à un SLO, et les pages **Alertes** et **Incidents** du SLO les listent, avec des badges dans le menu latéral qui comptent ceux qui sont ouverts. OneUptime établit ce lien lui-même, et modifier l'alerte ou l'incident ne le retire jamais.

### Les incidents de taux de consommation restent internes

Un budget d'erreur qui se consomme vite est un signal pour l'ingénierie, pas une panne déclarée. Un incident de taux de consommation n'est jamais affiché sur les pages de statut et ne notifie jamais les abonnés des pages de statut. Il n'est lié à aucun moniteur non plus, car le résoudre réécrirait sinon l'historique de statut des moniteurs à partir duquel le SLO est mesuré.

Si vous résolvez un tel incident à la main, rien ne le déclare de nouveau tant que la consommation ne s'est pas rétablie et que la règle ne se déclenche pas vraiment à nouveau : vous ne luttez donc jamais contre la règle pendant que vous traitez un incident.

## Ce que dit chaque alerte et chaque incident

Les nouvelles règles commencent avec le titre et la description intégrés, dans l'alerte comme dans l'incident. Videz un titre ou une description pour revenir au texte intégré. Le titre intégré est :

```text
SLO burn rate: {{sloName}} — {{ruleName}}
```

La description intégrée nomme la règle, donne le taux de consommation sur les deux fenêtres par rapport au seuil, et le budget d'erreur restant.

Pour écrire les vôtres, utilisez des variables de modèle dans le titre, la description et les notes de remédiation. Chacun de ces champs les liste sous **Variables de modèle** : cliquez sur l'une pour l'insérer à l'emplacement du curseur, ou tapez `{{` dans le champ et choisissez-en une. La description et les notes de remédiation ont aussi **Insérer une variable** dans leur barre d'outils. Les variables sont remplies quand la règle se déclenche :

| Variable | Ce qu'elle contient | Exemple |
| --- | --- | --- |
| `{{sloName}}` | Nom du SLO. | `Checkout availability` |
| `{{sloId}}` | ID du SLO. | `b7f4c2d8-1f3e-4a5b-9c6d-7e8f9a0b1c2d` |
| `{{sloLink}}` | Lien vers le SLO dans le tableau de bord OneUptime. | `https://oneuptime.com/dashboard/project-id/slos/slo-id` |
| `{{sloStatus}}` | Statut du SLO après cette évaluation. | `At Risk` |
| `{{ruleName}}` | Nom de la règle de taux de consommation qui s'est déclenchée. | `Fast burn` |
| `{{burnRateThreshold}}` | Le seuil de taux de consommation de la règle (un multiple du rythme soutenable). | `14.4` |
| `{{longWindowBurnRate}}` | Taux de consommation mesuré sur la fenêtre longue de la règle. | `21.5` |
| `{{shortWindowBurnRate}}` | Taux de consommation mesuré sur la fenêtre courte de la règle. | `36` |
| `{{longWindowInMinutes}}` | Durée de la fenêtre longue de la règle, en minutes. | `60` |
| `{{shortWindowInMinutes}}` | Durée de la fenêtre courte de la règle, en minutes. | `5` |
| `{{targetPercentage}}` | L'objectif du SLO, en pourcentage. | `99.9` |
| `{{currentSliPercentage}}` | Le SLI mesuré sur la fenêtre de conformité du SLO, en pourcentage. | `99.87` |
| `{{errorBudgetRemainingPercentage}}` | Part du budget d'erreur qui reste, en pourcentage. Négative une fois le budget dépassé. | `42.5` |
| `{{errorBudgetRemaining}}` | Budget d'erreur qui reste, en durée. Commence par un signe moins une fois le budget dépassé. | `18m 22s` |
| `{{errorBudgetRemainingMinutes}}` | Budget d'erreur qui reste, en minutes. | `18.37` |
| `{{windowDescription}}` | La fenêtre de conformité du SLO, en toutes lettres. | `rolling 30-day window` |
| `{{policyTier}}` | Nom du palier de la politique de budget d'erreur dans lequel se trouve le SLO après cette évaluation. « None » quand il n'est dans aucun palier. | `Reliability first` |
| `{{policyTierThresholdPercentage}}` | Seuil de budget restant de ce palier, en pourcentage. Vide quand le SLO n'est dans aucun palier. | `25` |
| `{{policyTierWhatWeDo}}` | Ce que l'équipe s'est engagée à faire dans ce palier, tel qu'écrit sur le palier. Vide quand le SLO n'est dans aucun palier. | `Only reliability work and critical fixes ship.` |

Par exemple, le titre `{{ruleName}}: {{sloName}} is burning {{longWindowBurnRate}}x` devient `Fast burn: Checkout availability is burning 21.5x`.

:::details Comment les variables sont remplies
- Les nombres sont arrondis à deux décimales.
- Les espaces à l'intérieur des accolades sont acceptés : `{{ sloName }}` fonctionne.
- Une variable mal orthographiée est laissée telle quelle, une faute de frappe se voit donc dans l'alerte au lieu de disparaître sans rien dire.
- Les titres peuvent faire 500 caractères, et les descriptions et notes de remédiation 50 000. Un titre qui dépasse 500 caractères une fois ses variables remplies est mis sur une ligne et raccourci avec des points de suspension, l'alerte ou l'incident est donc quand même créé.
- Si le lien vers le SLO ne peut pas être construit au moment où la règle se déclenche, `{{sloLink}}` reste vide et l'alerte ou l'incident est quand même créé.
:::

## Propriétaires, étiquettes et confidentialité

- **Propriétaires de l'alerte** et **Propriétaires de l'incident** sont des personnes et des équipes, choisies dans une même liste avec **Ajouter un propriétaire**. Ils sont ajoutés à l'alerte ou à l'incident dès sa création, et notifiés. Les personnes doivent être membres du projet.
- **Ajouter les propriétaires du SLO comme propriétaires** ajoute aussi les propriétaires du SLO, ses utilisateurs propriétaires et les membres de ses équipes propriétaires, à tout ce que crée la règle. Les propriétaires du SLO sont déjà informés des changements de statut du SLO lui-même, cela peut donc les notifier deux fois. C'est désactivé par défaut.
- Chaque propriétaire n'est ajouté qu'une fois : un utilisateur déjà propriétaire de l'alerte ou de l'incident, par exemple par les règles de propriétaire du projet, ou membre d'une équipe propriétaire ajoutée, n'est pas ajouté de nouveau.
- **Étiquettes d'alerte** et **Étiquettes d'incident** sont ajoutées à l'alerte ou à l'incident, pour que les filtres, les règles de propriétaire et les règles de notification d'espace de travail puissent y correspondre.
- Une alerte ou un incident privé n'est visible que par ses propriétaires, les administrateurs du projet et les propriétaires du projet.

Les étiquettes, les équipes propriétaires et les politiques d'astreinte doivent appartenir au projet du SLO.

## Résolution et suppression des redéclenchements

- **La résolution suit la fenêtre longue.** Avec la résolution automatique activée (par défaut), OneUptime résout l'alerte et l'incident d'une règle dès que le taux de consommation sur la fenêtre longue repasse sous le seuil. Résoudre sur la fenêtre courte ferait osciller : une panne récurrente serait résolue après cinq minutes calmes et alerterait de nouveau toute la nuit.
- **Résolution automatique désactivée.** Désactivez **Résoudre automatiquement l'alerte** ou **Résoudre automatiquement l'incident**, et cet enregistrement reste ouvert jusqu'à ce que quelqu'un le résolve, même une fois la consommation rétablie. La règle n'en ouvre pas un autre par-dessus, et une fois qu'il est résolu à la main et que la fenêtre longue est sous le seuil, la règle peut se déclencher de nouveau après sa suppression.
- **Suppression des redéclenchements.** Après la résolution d'un enregistrement, la règle ne déclare plus ce type d'enregistrement pendant la période de suppression, par défaut la durée de la fenêtre longue. Cela laisse à un système qui se rétablit le temps de le faire sans alerter sur le bruit qui reste. Slow leak est créée avec 24 heures au lieu de sa fenêtre longue de 3 jours, une fuite qui revient est donc signalée de nouveau dès le lendemain.

Certains changements résolvent toujours ce qu'une règle a d'ouvert, quels que soient ses réglages de résolution automatique, pour que rien ne continue d'escalader pour une règle qui ne peut plus le justifier :

- modifier **Quand elle se déclenche** pour retirer l'alerte ou l'incident ferme ce que cette sortie avait ouvert ;
- désactiver la règle ou la supprimer ;
- désactiver l'évaluation du SLO, archiver le SLO ou le supprimer ;
- le SLO passe **En pause** ou **Mal configuré**, car il ne mesure alors plus rien ;
- la règle perd son seuil ou ses fenêtres, ou le SLO n'a plus une fenêtre longue complète d'historique.

## Maintenance planifiée

Tant qu'un moniteur du SLO est dans un événement de maintenance en cours, ses règles de taux de consommation ne déclenchent aucune alerte et ne déclarent aucun incident : un travail prévu ne doit alerter personne. Ce que les règles ont déjà d'ouvert est toujours résolu comme d'habitude. Le temps compte quand même dans le budget d'erreur, selon les statuts d'indisponibilité du SLO.

## Le fil d'activité du SLO

Le **Fil d'activité** du SLO publie chaque alerte qu'une règle déclenche et chaque incident qu'elle déclare, avec un lien et les taux de consommation qui l'expliquent, et le moment où chacun est résolu, automatiquement ou à la main. Un enregistrement que la règle reprend parce qu'il était encore ouvert n'est pas publié deux fois. La création, la modification et la suppression d'une règle sont aussi publiées, et enregistrées dans les **Journaux d'audit** du SLO. Voir [Fil d'activité et journaux d'audit des SLO](/docs/slo/feed-and-audit-logs).

## Dépannage

:::details Une règle ne s'est pas déclenchée juste après la création du SLO
Une règle ne se déclenche qu'une fois que le SLO a une fenêtre longue complète d'historique de surveillance : une heure pour la règle de consommation rapide par défaut, six heures pour la règle de consommation lente et trois jours pour la règle de fuite lente, ou un dixième de la fenêtre du SLO quand celle-ci fait moins de 30 jours.
:::

:::details Une alerte a été résolue alors que la panne continuait
La résolution automatique suit la fenêtre longue : dès que le taux de consommation sur la fenêtre longue repasse sous le seuil, l'alerte est résolue. Donnez à la règle une fenêtre longue plus longue, ou désactivez **Résoudre automatiquement l'alerte** et résolvez l'alerte à la main.
:::

:::details Rien ne s'est déclenché pendant un événement de maintenance
Les règles de taux de consommation restent silencieuses tant que l'un des moniteurs du SLO est dans un événement de maintenance en cours. L'indisponibilité compte quand même dans le budget.
:::

:::details Existe-t-il un nombre minimal d'échantillons ?
Pas pour les SLO mesurés à partir de la disponibilité des moniteurs. La disponibilité se mesure en secondes, chaque seconde de la fenêtre est donc un échantillon, et il n'y a pas de cas de faible trafic à surveiller. Un nombre minimal d'échantillons ne compte que pour les SLI fondés sur des événements, qui ne sont pas encore disponibles.
:::

## Prochaines étapes

:::cards
- [Budgets d'erreur](/docs/slo/error-budget): Ce qu'est le budget, et combien de temps il dure.
- [Politique de budget d'erreur](/docs/slo/error-budget-policy): Agir selon le budget qui reste, palier par palier.
- [Règles d'escalade](/docs/on-call/escalation-rules): Qui est alerté, et dans quel ordre.
- [Fil d'activité et journaux d'audit des SLO](/docs/slo/feed-and-audit-logs): Chaque alerte et chaque incident qu'une règle a déclenché.
:::
