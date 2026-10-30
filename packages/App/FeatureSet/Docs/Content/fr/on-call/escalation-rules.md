# Règles d'escalade

Une politique d'astreinte alerte les personnes par niveaux. Chaque règle d'escalade est un niveau : qui est alerté, et combien de temps attendre qu'une personne accuse réception avant d'alerter le niveau suivant. Les règles d'une politique sont listées, dans l'ordre, sur sa page **Règles d'escalade**.

```mermaid title="Une politique d'astreinte alerte niveau par niveau jusqu'à un accusé de réception"
flowchart TB
    trigger["Incident ou alerte"] --> level1["Level 1 alerte"]
    level1 --> ack1{"Accusé de réception<br/>à temps ?"}
    ack1 -->|"Oui"| stop["Les alertes s'arrêtent"]
    ack1 -->|"Non"| level2["Level 2 alerte"]
    level2 --> ack2{"Accusé de réception<br/>à temps ?"}
    ack2 -->|"Oui"| stop
    ack2 -->|"Non, dernier niveau"| repeat{"Répéter la politique ?"}
    repeat -->|"Oui"| level1
    repeat -->|"Non"| done["La politique s'arrête"]
```

:::cards
- [Qui est alerté en premier](#qui-est-alerté-en-premier): Créer une politique avec son premier niveau.
- [Ajouter une règle d'escalade](#ajouter-une-règle-descalade): Ajouter le niveau suivant, étape par étape.
- [Comment les niveaux alertent les personnes](#comment-les-niveaux-alertent-les-personnes): Délais, répétitions et manière de joindre chaque personne.
- [La personne suivante de la rotation](#escalader-vers-la-personne-suivante-de-la-rotation): Alerter le suppléant de la personne d'astreinte, dans la même rotation.
- [Escalader une alerte](#escalader-une-alerte): Vous ne pouvez pas prendre une alerte ? Faites alerter le niveau suivant tout de suite.
- [API et Terraform](#créer-des-règles-avec-lapi-ou-terraform): Créer des politiques et des règles sous forme de code.
:::

## Qui est alerté en premier

Lorsque vous créez une politique d'astreinte sur la page **Politiques d'astreinte**, le formulaire demande son **Nom** et **Qui est alerté en premier ?**. La question utilise le même sélecteur que **Notifier** : plannings d'astreinte, équipes et personnes, autant qu'il en faut. Les personnes choisies forment la première règle d'escalade de la politique, **Level 1**, qui attend **30 minutes** un accusé de réception avant d'alerter le niveau suivant.

:::steps
1. Allez dans **Astreinte** > **Politiques d'astreinte** et cliquez sur **Créer : Politique d'astreinte**.
2. Saisissez un **Nom**.
3. Sous **Qui est alerté en premier ?**, cliquez sur **Ajouter un intervenant** et choisissez les plannings d'astreinte, les équipes et les personnes à alerter en premier.
4. Cliquez sur **Créer : Politique d'astreinte**. La nouvelle politique s'ouvre ensuite sur sa page **Règles d'escalade**, où vous pouvez ajouter d'autres niveaux.
:::

**Qui est alerté en premier ?** est facultatif. Si vous le laissez vide, la politique démarre sans règles d'escalade : elle n'alerte personne tant que vous n'en ajoutez pas, et sa vue d'ensemble le signale. La description et les étiquettes se trouvent sous **Plus de champs**. La question n'est posée qu'aux personnes autorisées à ajouter des règles d'escalade.

## Ajouter une règle d'escalade

:::steps
### Ouvrir les règles d'escalade de la politique

Ouvrez la politique d'astreinte, choisissez **Règles d'escalade** dans son menu latéral et cliquez sur **Ajouter une règle d'escalade**. La boîte de dialogue tient sur une seule page courte.

### Choisir qui notifier

Sous **Notifier**, cliquez sur **Ajouter un intervenant**, recherchez et choisissez autant de plannings d'astreinte, d'équipes et de personnes que ce niveau doit alerter. Il en faut au moins un.

| Intervenant | Qui est alerté quand le niveau s'exécute |
| --- | --- |
| Un **planning d'astreinte** | La personne d'astreinte dans ce planning au moment où le niveau s'exécute, et non une personne fixe. |
| Le **Suivant dans la rotation** d'un planning | La personne qui suit celle d'astreinte dans ce planning, dans la même rotation. Voir [Escalader vers la personne suivante de la rotation](#escalader-vers-la-personne-suivante-de-la-rotation). |
| Une **équipe** | Chaque membre de l'équipe. |
| Une **personne** | Cette personne, directement. |

### Définir le délai d'attente

**Escalader après (en minutes)** est le temps d'attente d'un accusé de réception avant d'alerter le niveau suivant. La valeur de départ est **30 minutes** ; adaptez-la au niveau.

### Nommer la règle, si vous le souhaitez

Tout le reste se trouve sous **Plus de champs**, replié jusqu'à ce que vous l'ouvriez :

- **Nom** : facultatif. Une règle sans nom porte le nom de son niveau : la première règle d'une politique est **Level 1**, la deuxième **Level 2**, et ainsi de suite. Le champ du nom affiche le nom que la règle recevra.
- **Description** : notes facultatives, par exemple qui ce niveau alerte et pourquoi.

Repliée, la section **Plus de champs** nomme les deux dans son en-tête et affiche ceux que la règle possède : une description, ou un nom choisi par vous.

### Créer la règle

Cliquez sur **Créer une règle**. La règle est ajoutée sous les autres, comme niveau suivant de la politique.
:::

## Comment les niveaux alertent les personnes

Lorsqu'un incident ou une alerte atteint la politique, **Level 1** alerte ses intervenants immédiatement. Si personne n'accuse réception dans son délai, **Level 2** est alerté, et ainsi de suite. Une fois le délai du dernier niveau écoulé sans accusé de réception, la politique recommence à **Level 1** si sa **Politique de répétition** (sous les règles) prévoit une répétition, autant de fois qu'elle le permet, et s'arrête sinon. Accuser réception de l'incident ou de l'alerte, ou le résoudre, arrête les alertes à n'importe quel niveau. Une personne alertée qui ne peut pas prendre l'alerte peut l'escalader, et le niveau suivant est alerté sans attendre : voir [Escalader une alerte](#escalader-une-alerte).

Un incident, une alerte ou un épisode créé déjà pris en compte ou résolu — enregistré après coup — n'exécute aucune de ses politiques : personne n'est alerté, et son fil d'activité l'indique en les nommant. Voir [Déclaré déjà pris en compte ou résolu](/docs/incidents/declaring-incidents#déclaré-déjà-pris-en-compte-ou-résolu).

Un niveau qui n'a personne à alerter quand il est atteint est passé immédiatement : le niveau suivant est alerté tout de suite, sans attendre. C'est le cas d'un niveau sans intervenant, et d'un niveau dont les intervenants ne laissent personne à alerter à ce moment-là : une équipe sans membre, un planning où personne n'est d'astreinte, ou des personnes absentes sans remplaçant, qui ont quitté le projet ou qui ne peuvent pas être jointes du tout. Quand aucun niveau n'a personne à alerter, la politique s'arrête immédiatement et ne se répète pas.

Pour répéter une politique, cliquez sur **Modifier** sur la carte **Politique de répétition**, choisissez **Recommencer depuis Level 1** et indiquez **Combien de fois de plus ?**.

### Le résumé de l'escalade

Le résumé en haut de la page **Règles d'escalade** montre toute l'échelle : quand chaque niveau est alerté, qui il alerte et ce qui se passe après le dernier. Un niveau dont tous les intervenants ne peuvent pas être alertés l'indique sur sa carte ; cliquez sur le libellé pour voir qui et pourquoi. Un niveau sans intervenant affiche **Ignoré immédiatement**, et son délai n'est pas compté pour savoir quand le niveau suivant est alerté.

### Comment chaque personne est jointe

Chaque personne alertée par un niveau est jointe selon ses propres règles d'astreinte : **Paramètres utilisateur** > **Règles d'astreinte**, avec un onglet pour les incidents, les épisodes d'incident, les alertes et les épisodes d'alerte, et une carte par gravité qui indique quelle méthode de notification est utilisée et après combien de temps. Un administrateur du projet peut consulter et modifier les règles d'un membre dans **Utilisateurs** > le membre > **Règles d'astreinte**. Voir [Règles d'astreinte personnelles](/docs/notifications/on-call-rules).

```mermaid title="Qui un niveau alerte, et comment chaque personne est jointe"
flowchart TB
    subgraph notify["Notifier"]
        direction LR
        schedule["Planning<br/>d'astreinte"]
        team["Équipe"]
        user["Personne"]
    end
    schedule -->|"la personne<br/>d'astreinte"| person["Personne alertée"]
    team -->|"chaque membre"| person
    user -->|"directement"| person
    person --> rules["Ses règles<br/>d'astreinte"]
    rules --> methods["Ses méthodes<br/>de notification"]
```

Un remplacement d'utilisateur en vigueur pour une personne envoie ses alertes à la personne qui la remplace. Un remplacement qui ne désigne personne pour la remplacer lui fait passer son tour : elle ne reçoit pas d'alerte, l'exécution de la politique indique qu'elle est absente et jusqu'à quand, et dans un planning d'astreinte chacun de ses tours revient à la personne suivante de la rotation. Voir [Remplacements d'utilisateur](/docs/on-call/user-overrides).

Chaque message est accepté par son fournisseur, de sorte qu'une alerte part toujours. Voici ce que chaque canal transporte :

| Canal | Le message le plus long qu'il transporte |
| --- | --- |
| SMS | 1 600 caractères |
| Appel téléphonique | Ce qui tient dans le script d'appel Twilio de 4 000 caractères |
| Notification push | 4 Ko, dont 3 Ko au plus pour le titre, le texte et les données |
| WhatsApp | 1 024 caractères |
| Telegram | 4 096 caractères |

Un message plus long, avec un titre long ou une longue description qu'un modèle y a placée, est coupé et se termine par une note indiquant que le texte complet est dans OneUptime : « … (truncated — see OneUptime for the full text) ». Le libellé d'un message WhatsApp est un modèle fixe, ce sont donc les valeurs les plus longues qui y sont coupées, chacune se terminant par « … ». Les liens d'un message ne sont jamais coupés.

### Ce que dit le SMS d'une alerte

Un SMS est envoyé, et facturé, par parties de 160 caractères. Une alerte par SMS est écrite pour tenir en une seule partie chaque fois que c'est possible, et ne dit que ce dont vous avez besoin sur un téléphone verrouillé : qui l'envoie, ce qui s'est passé, et l'unique lien pour accuser réception de l'alerte ou l'escalader. Sur un téléphone, elle s'affiche ainsi :

```text
OneUptime: Critical Incident INC-42 in Acme Prod: Checkout API is down.
Ack or escalate: https://oneuptime.com/l/XJlaZRsd
```

Il indique la gravité et ce qui s'est passé (un incident, une alerte ou un épisode de l'un ou de l'autre), son numéro, le projet et le titre, dans cet ordre. Quand tout ne tient pas en une partie :

1. Le projet est d'abord omis.
2. Puis le titre est coupé, et se termine par `...`.

La gravité, le numéro et le lien ne sont jamais coupés. Un titre garde au moins 20 caractères : si même cela ne tient pas, par exemple avec une adresse ou un nom de produit très long, le SMS prend une deuxième partie et dit tout.

Quand une politique alerte de nouveau parce qu'un incident ou une alerte pris en compte n'est toujours pas résolu, le SMS le dit après le numéro et le projet, et ces mots ne sont jamais coupés non plus :

```text
OneUptime: Critical Incident INC-42 in Acme Prod is still not resolved:
Checkout API is down. Ack or escalate: https://oneuptime.com/l/XJlaZRsd
```

Quand quelqu'un vous alerte depuis Slack ou Microsoft Teams, le SMS dit qui a alerté qui après `OneUptime:`, et ces mots ne sont jamais coupés non plus :

```text
OneUptime: Alice Kim paged Platform about Critical Incident INC-42
in Acme Prod: Checkout API is down.
Ack or escalate: https://oneuptime.com/l/XJlaZRsd
```

Un seul caractère hors de l'alphabet simple des SMS fait partir tout le message par parties de 70 caractères. C'est pourquoi les guillemets et les tirets typographiques sont écrits `"`, `'` et `-`, `…` est écrit `...`, et les lettres comme `ç` et `ł` perdent leurs accents ; les emoji sont omis. Un titre dans une autre écriture, comme le japonais ou le russe, est envoyé tel qu'il est écrit, et prend deux parties ou plus.

Les autres SMS que OneUptime vous envoie, par exemple pour une modification d'un incident dont vous êtes propriétaire ou le début de votre tour d'astreinte, commencent aussi par `OneUptime:` et se terminent par `Turn off in User Settings > Notification Settings.`, une phrase omise quand c'est ce qui permet au SMS de tenir en une partie.

### Quand une alerte n'est pas envoyée

Une alerte non envoyée indique pourquoi dans les **Journaux d'astreinte** de la personne (Paramètres utilisateur) : sa ligne affiche **Erreur**, et son message d'état en donne la raison. Elle ne reste plus bloquée sur **Envoi en cours**. Le message indique l'une de ces raisons :

- le solde du projet n'a pas pu la payer, et qui peut ajouter du solde ;
- le canal est désactivé dans le projet, et qui peut l'activer.

Les propriétaires du projet en sont informés une fois par e-mail, jusqu'à ce que le solde soit rechargé ou que le canal soit réactivé.

Sur OneUptime Cloud, chaque SMS, appel, message WhatsApp et Telegram est payé sur le solde du projet dans **Paramètres du projet > Notifications > Paramètres de notification** : son coût exact est débité du solde lorsque le fournisseur l'accepte, quel que soit le nombre de messages envoyés en même temps.

- Avec le **Rechargement automatique** activé à cet endroit, le message qui trouve le solde sous son seuil ajoute d'abord le montant défini pour le rechargement automatique, en débitant la carte du projet ; les messages qui le trouvent bas au même moment ne débitent la carte qu'une fois.
- Si ce débit échoue (aucun moyen de paiement, ou carte refusée), le rechargement automatique réessaie la carte une heure plus tard, et **Paramètres de notification** l'indique en haut de la page jusque-là. Ajouter du solde à la main, ou enregistrer à nouveau le rechargement automatique, réessaie immédiatement.
- Les alertes continuent de partir sur le solde restant tant que le rechargement automatique ne peut pas débiter la carte.

> [!IMPORTANT]
> Les SMS, les appels téléphoniques, WhatsApp et Telegram sont désactivés dans un nouveau projet : sur OneUptime Cloud, chaque message est payé sur le solde du projet, et une installation auto-hébergée a d'abord besoin d'un compte Twilio ou d'un bot Telegram configuré. Tant qu'un canal est désactivé, personne dans le projet ne peut y ajouter de méthode. Seul un propriétaire du projet ou une personne disposant du rôle **Administrateur de la facturation** ou de l'autorisation **Manage Billing** peut en activer un, dans la carte **Canaux de notification** de **Paramètres du projet > Notifications > Paramètres de notification** — un administrateur du projet ne le peut pas. Partout où un canal est désactivé, tous les autres apprennent exactement qui peut l'activer : au-dessus de leur propre liste de méthodes sur ce canal, dans leur liste de configuration et dans le message qu'ils reçoivent quand quelque chose en a besoin.

## Escalader vers la personne suivante de la rotation

Un niveau peut alerter la personne suivante de la rotation d'un planning d'astreinte : celle qui suit la personne d'astreinte dans ce planning. Une politique peut ainsi alerter d'abord la personne d'astreinte, puis son suppléant dans la même rotation, puis une équipe ou un manager, le tout à partir d'un seul planning.

| Niveau | Notifier | Qui est alerté |
| --- | --- | --- |
| **Level 1** | Le planning Payments primary | La personne d'astreinte dans ce planning, par exemple Alex |
| **Level 2** | Le **Suivant dans la rotation** du même planning | La personne qui suit Alex dans la rotation, par exemple Sam |
| **Level 3** | L'équipe Platform | Chaque membre de l'équipe |

:::steps
1. Vérifiez que le premier niveau de la politique, **Level 1**, notifie le planning d'astreinte.
2. Cliquez sur **Ajouter une règle d'escalade**, puis sur **Ajouter un intervenant**, et choisissez le même planning sous **Suivant dans la rotation**. Définissez **Escalader après (en minutes)** et cliquez sur **Créer une règle**.
3. Ajoutez un niveau de plus pour l'équipe ou le manager qui doit être prévenu ensuite.
:::

La personne suivante est déterminée au moment où le niveau s'exécute, d'après le planning tel qu'il est alors :

- C'est la personne qui suit la personne d'astreinte, dans l'ordre où les personnes de la rotation se relaient. Après la dernière personne revient la première.
- Les personnes absentes sont passées, que quelqu'un les remplace ou non, de même que toute personne d'astreinte à la place de quelqu'un d'autre.
- C'est toujours quelqu'un de la même rotation : avec plusieurs couches, la couche d'où vient la personne d'astreinte. Une rotation où il n'y a personne d'autre, ou dont tous les autres membres sont absents, n'a personne de suivant : le niveau n'y alerte personne et l'indique.
- Quand personne n'est d'astreinte dans le planning, il n'y a personne de suivant non plus, et le niveau n'y alerte personne.

Le message de l'exécution dans Slack et Microsoft Teams, le fil d'activité de l'incident et la **Chronologie d'exécution** indiquent qui a été alerté en tant que suivant dans la rotation, et depuis quel planning : « Sam Lee (next in the Payments primary rotation) ».

> [!TIP]
> Un seul planning suffit : pas de second planning de suppléance à garder en phase avec le premier, et les absences que posent ses membres valent pour les deux niveaux.

## Escalader une alerte

Une personne alertée qui ne peut pas prendre l'alerte, parce qu'elle dort, est dans un avion ou travaille déjà sur un autre incident, peut l'escalader plutôt que de la laisser sonner. La politique alerte alors son niveau suivant tout de suite, sans attendre la fin du délai **Escalader après (en minutes)** du niveau, et cette personne n'est plus alertée à ce sujet.

```mermaid title="Escalader une alerte fait passer la politique au niveau suivant tout de suite"
flowchart TB
    page["Level 1 alerte Alex"] --> take{"Alex peut-il<br/>la prendre ?"}
    take -->|"Oui"| ack["Alex accuse<br/>réception :<br/>les alertes s'arrêtent"]
    take -->|"Non"| pass["Alex l'escalade"]
    pass --> others{"Quelqu'un<br/>d'autre encore<br/>alerté sur Level 1 ?"}
    others -->|"Oui"| wait["La politique<br/>les attend,<br/>comme avant"]
    others -->|"Non"| next["Level 2 est alerté<br/>maintenant"]
```

Chaque alerte peut être escaladée là où elle vous a atteint :

| Où | Comment l'escalader |
| --- | --- |
| E-mail | Le bouton **Escalate**, puis **Escalate** sur la page qu'il ouvre |
| SMS et WhatsApp | Le lien du message ouvre la page de prise en compte, qui propose aussi **Escalate** |
| Telegram, Slack et Microsoft Teams | Le lien "Can't take it? Escalate", puis **Escalate** sur la page qu'il ouvre |
| Appel téléphonique | Appuyez sur 2. L'appel dit ensuite ce qui s'est passé |
| Notification push | Touchez-la : l'incident, l'alerte ou l'épisode s'ouvre dans l'app OneUptime On-Call, avec **Escalate** en dessous |
| OneUptime | **Escalader** en haut de l'incident, de l'alerte ou de l'épisode, après ses boutons d'état |

Chaque moyen, sauf l'appel, demande avant d'agir et dit ce qui va se passer, par exemple « This will immediately page Platform leads (Level 2 of 3), without waiting. » ; lors d'un appel, appuyer sur 2 est la réponse. Seule la personne alertée peut escalader son alerte : le bouton dans OneUptime ne s'affiche que pour elle, et le lien d'un message n'escalade que l'alerte dont il parle, pour la personne à qui il a été envoyé, pendant 7 jours.

La suite dépend des autres personnes encore alertées :

- D'autres personnes du même niveau sont encore alertées : la politique les attend, comme avant. Elle passe à la suite quand le délai du niveau expire, ou dès que la dernière d'entre elles escalade aussi l'alerte.
- Il ne reste personne d'autre sur le niveau : le niveau suivant est alerté tout de suite.
- C'était le dernier niveau : si la **Politique de répétition** prévoit une répétition, la politique recommence tout de suite à **Level 1**. Sinon, les alertes s'arrêtent, et quelqu'un doit s'en charger.

Escalader une alerte n'en accuse pas réception : l'incident ou l'alerte attend toujours que quelqu'un en accuse réception, et la personne qui l'a escaladée peut encore en accuser réception elle-même. Cette exécution ne l'alerte plus à ce sujet : un niveau suivant, ou une répétition, qui la nomme la passe. Une fois que tous ceux qu'elle a alertés l'ont escaladée et qu'il ne reste personne à alerter, les alertes s'arrêtent, et le fil d'activité de l'incident l'indique.

Une alerte qu'un workflow envoie directement à des personnes n'a pas de niveaux : l'escalader arrête de vous alerter, et une fois que tous ceux qu'elle a alertés l'ont escaladée, les alertes s'arrêtent.

Chaque escalade est enregistrée. La **Chronologie d'exécution** de l'exécution marque la ligne de la personne **Escaladé**, le fil d'activité de l'incident indique « Alex Kim escalated the page from on-call policy Payments at Level 1 of 3. », le message de l'exécution dans Slack et Microsoft Teams indique qu'elle l'a escaladée, et ses **Journaux d'astreinte** montrent l'alerte comme **Escaladé**.

## Modifier, réordonner et supprimer des règles

La carte de chaque règle propose **Modifier la règle**, et un menu **⋯** avec les autres actions :

- **Modifier la règle** ouvre la même boîte de dialogue d'une page, remplie avec la règle telle qu'elle est : ses intervenants, son délai, ainsi que son nom et sa description sous **Plus de champs**. Ajoutez ou retirez des intervenants et cliquez sur **Enregistrer les modifications**. Vider le nom redonne à la règle le nom de son niveau.
- **Monter** et **Descendre**, dans le menu **⋯** d'une règle, changent son niveau. Une règle qui porte le nom de son niveau garde un nom qui correspond à sa place : quand **Level 3** remonte au-dessus de **Level 2**, les deux échangent leurs noms. Un nom que vous avez choisi, comme **Nœuds manager**, reste le même où que la règle aille.
- **Supprimer la règle** demande d'abord confirmation et indique qui ce niveau alerte. Supprimer un niveau fait remonter les niveaux situés en dessous, et les règles qui portent le nom de leur niveau sont renommées en conséquence.

## Créer des règles avec l'API ou Terraform

Les règles d'escalade sont la ressource `/api/on-call-duty-policy-escalation-rule` ; les personnes, équipes et plannings qu'une règle alerte sont les ressources `/api/on-call-duty-policy-escalation-rule-user`, `-team` et `-schedule`.

- Une règle créée sans `name` porte le nom de son niveau, comme dans le tableau de bord : **Level 3** pour une règle qui devient le troisième niveau de sa politique. La ressource Terraform des règles d'escalade exige toujours un nom.
- `escalateAfterInMinutes` n'a pas de valeur par défaut en dehors du tableau de bord. Une règle créée sans cette valeur n'attend pas : le niveau suivant est alerté dès que celui-ci s'est exécuté. Définissez-la explicitement — 30 est la valeur que propose le tableau de bord.
- Une règle créée avec `onCallSchedules`, `teams` ou `users` (des listes d'identifiants) dans ses `miscDataProps` reçoit ces intervenants ; c'est ainsi que le sélecteur **Notifier** du tableau de bord les envoie. Une règle créée sans eux n'alerte personne tant que vous n'ajoutez pas d'intervenants via les ressources ci-dessus.
- Une règle créée avec `nextInRotationSchedules` (une liste d'identifiants de plannings) dans ses `miscDataProps` alerte la personne suivante de la rotation de chacun de ces plannings. Sur la ressource `-schedule`, une ligne dont `pageNextInRotation` vaut `true` fait de même ; cette valeur est fixée à la création de la ligne.
- Les règles qui portent le nom de leur niveau sont renommées lorsque vous déplacez ou supprimez des règles dans le tableau de bord. Modifier `order` via l'API ou Terraform ne change que l'ordre.
- Créer une politique d'astreinte via `/api/on-call-duty-policy` avec `onCallSchedules`, `teams` ou `users` (des listes d'identifiants) dans ses `miscDataProps` lui donne sa première règle d'escalade, comme le fait le tableau de bord : **Level 1**, qui les alerte, avec un `escalateAfterInMinutes` de 30. Chaque identifiant doit appartenir au projet et l'appelant doit être autorisé à créer des règles d'escalade, sinon la politique n'est pas créée. Une politique créée sans eux n'a pas de règles, comme auparavant ; la ressource Terraform des politiques ne les envoie pas.

```bash
curl -X POST https://oneuptime.com/api/on-call-duty-policy \
  -H "apikey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "projectId": "<project-id>",
      "name": "Production on-call"
    },
    "miscDataProps": {
      "onCallSchedules": ["<schedule-id>"],
      "users": ["<user-id>"]
    }
  }'
```

## Étapes suivantes

:::cards
- [Plannings d'astreinte](/docs/on-call/schedules): Construire les rotations qu'un niveau alerte.
- [Chronologie des astreintes](/docs/on-call/schedule-timeline): Voir qui est d'astreinte dans tous les plannings et repérer les trous de couverture.
- [Politique d'appels entrants](/docs/on-call/incoming-call-policy): Permettre aux appelants de joindre la personne d'astreinte par téléphone.
:::
