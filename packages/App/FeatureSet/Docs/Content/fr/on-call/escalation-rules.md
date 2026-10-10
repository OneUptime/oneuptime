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

Lorsqu'un incident ou une alerte atteint la politique, **Level 1** alerte ses intervenants immédiatement. Si personne n'accuse réception dans son délai, **Level 2** est alerté, et ainsi de suite. Une fois le délai du dernier niveau écoulé sans accusé de réception, la politique recommence à **Level 1** si sa **Politique de répétition** (sous les règles) prévoit une répétition, autant de fois qu'elle le permet, et s'arrête sinon. Accuser réception de l'incident ou de l'alerte, ou le résoudre, arrête les alertes à n'importe quel niveau.

Un incident, une alerte ou un épisode créé déjà pris en compte ou résolu — enregistré après coup — n'exécute aucune de ses politiques : personne n'est alerté, et son fil d'activité l'indique en les nommant. Voir [Déclaré déjà pris en compte ou résolu](/docs/incidents/declaring-incidents#déclaré-déjà-pris-en-compte-ou-résolu).

Pour répéter une politique, cliquez sur **Modifier** sur la carte **Politique de répétition**, activez **Repeat if no one acknowledges** et définissez le **Nombre de répétitions**.

### Le résumé de l'escalade

Le résumé en haut de la page **Règles d'escalade** montre toute l'échelle : quand chaque niveau est alerté, qui il alerte et ce qui se passe après le dernier. Un niveau dont tous les intervenants ne peuvent pas être alertés l'indique sur sa carte ; cliquez sur le libellé pour voir qui et pourquoi.

### Comment chaque personne est jointe

Chaque personne alertée par un niveau est jointe selon ses propres règles d'astreinte : **Paramètres utilisateur** > **Règles d'astreinte**, avec un onglet pour les incidents, les épisodes d'incident, les alertes et les épisodes d'alerte, et une carte par gravité qui indique quelle méthode de notification est utilisée et après combien de temps. Un administrateur du projet peut consulter et modifier les règles d'un membre dans **Utilisateurs** > le membre > **Règles d'astreinte**.

```mermaid title="Qui un niveau alerte, et comment chaque personne est jointe"
flowchart TB
    subgraph notify["Notifier"]
        direction LR
        schedule["Planning d'astreinte"]
        team["Équipe"]
        user["Personne"]
    end
    schedule -->|"la personne d'astreinte"| person["Personne alertée"]
    team -->|"chaque membre"| person
    user -->|"directement"| person
    person --> rules["Ses règles d'astreinte"]
    rules --> methods["Ses méthodes de notification"]
```

Un remplacement d'utilisateur en vigueur pour une personne envoie ses alertes à la personne qui la remplace.

Chaque message est accepté par son fournisseur, de sorte qu'une alerte part toujours. Voici ce que chaque canal transporte :

| Canal | Le message le plus long qu'il transporte |
| --- | --- |
| SMS | 1 600 caractères |
| Appel téléphonique | Ce qui tient dans le script d'appel Twilio de 4 000 caractères |
| Notification push | 4 Ko, dont 3 Ko au plus pour le titre, le texte et les données |
| WhatsApp | 1 024 caractères |
| Telegram | 4 096 caractères |

Un message plus long, avec un titre long ou une longue description qu'un modèle y a placée, est coupé et se termine par une note indiquant que le texte complet est dans OneUptime : « … (truncated — see OneUptime for the full text) ». Le libellé d'un message WhatsApp est un modèle fixe, ce sont donc les valeurs les plus longues qui y sont coupées, chacune se terminant par « … ». Les liens d'un message ne sont jamais coupés.

### Quand une alerte n'est pas envoyée

Une alerte non envoyée indique pourquoi dans les **Journaux d'astreinte** de la personne (Paramètres utilisateur) : sa ligne affiche **Erreur**, et son message d'état en donne la raison. Elle ne reste plus bloquée sur **Sending**. Le message indique l'une de ces raisons :

- le solde du projet n'a pas pu la payer, et qui peut ajouter du solde ;
- le canal est désactivé dans le projet, et qui peut l'activer.

Les propriétaires du projet en sont informés une fois par e-mail, jusqu'à ce que le solde soit rechargé ou que le canal soit réactivé.

Sur OneUptime Cloud, chaque SMS, appel, message WhatsApp et Telegram est payé sur le solde du projet dans **Paramètres du projet > Notifications > Paramètres de notification** : son coût exact est débité du solde lorsque le fournisseur l'accepte, quel que soit le nombre de messages envoyés en même temps.

- Avec le **Rechargement automatique** activé à cet endroit, le message qui trouve le solde sous son seuil ajoute d'abord le montant défini pour le rechargement automatique, en débitant la carte du projet ; les messages qui le trouvent bas au même moment ne débitent la carte qu'une fois.
- Si ce débit échoue (aucun moyen de paiement, ou carte refusée), le rechargement automatique réessaie la carte une heure plus tard, et **Paramètres de notification** l'indique en haut de la page jusque-là. Ajouter du solde à la main, ou enregistrer à nouveau le rechargement automatique, réessaie immédiatement.
- Les alertes continuent de partir sur le solde restant tant que le rechargement automatique ne peut pas débiter la carte.

> [!IMPORTANT]
> Les SMS, les appels téléphoniques, WhatsApp et Telegram sont désactivés dans un nouveau projet : sur OneUptime Cloud, chaque message est payé sur le solde du projet, et une installation auto-hébergée a d'abord besoin d'un compte Twilio ou d'un bot Telegram configuré. Tant qu'un canal est désactivé, personne dans le projet ne peut y ajouter de méthode. Seul un propriétaire du projet ou une personne disposant du rôle **Billing Admin** ou de l'autorisation **Manage Billing** peut en activer un, dans la carte **Canaux de notification** de **Paramètres du projet > Notifications > Paramètres de notification** — un administrateur du projet ne le peut pas. Partout où un canal est désactivé, tous les autres apprennent exactement qui peut l'activer : au-dessus de leur propre liste de méthodes sur ce canal, dans leur liste de configuration et dans le message qu'ils reçoivent quand quelque chose en a besoin.

## Modifier, réordonner et supprimer des règles

La carte de chaque règle propose **Modifier la règle**, et un menu **⋯** avec les autres actions :

- **Modifier la règle** ouvre la même boîte de dialogue d'une page, remplie avec la règle telle qu'elle est : ses intervenants, son délai, ainsi que son nom et sa description sous **Plus de champs**. Ajoutez ou retirez des intervenants et cliquez sur **Enregistrer les modifications**. Vider le nom redonne à la règle le nom de son niveau.
- **Monter** et **Descendre**, dans le menu **⋯** d'une règle, changent son niveau. Une règle qui porte le nom de son niveau garde un nom qui correspond à sa place : quand **Level 3** remonte au-dessus de **Level 2**, les deux échangent leurs noms. Un nom que vous avez choisi, comme **Managers**, reste le même où que la règle aille.
- **Supprimer la règle** demande d'abord confirmation et indique qui ce niveau alerte. Supprimer un niveau fait remonter les niveaux situés en dessous, et les règles qui portent le nom de leur niveau sont renommées en conséquence.

## Créer des règles avec l'API ou Terraform

Les règles d'escalade sont la ressource `/api/on-call-duty-policy-escalation-rule` ; les personnes, équipes et plannings qu'une règle alerte sont les ressources `/api/on-call-duty-policy-escalation-rule-user`, `-team` et `-schedule`.

- Une règle créée sans `name` porte le nom de son niveau, comme dans le tableau de bord : **Level 3** pour une règle qui devient le troisième niveau de sa politique. La ressource Terraform des règles d'escalade exige toujours un nom.
- `escalateAfterInMinutes` n'a pas de valeur par défaut en dehors du tableau de bord. Une règle créée sans cette valeur n'attend pas : le niveau suivant est alerté dès que celui-ci s'est exécuté. Définissez-la explicitement — 30 est la valeur que propose le tableau de bord.
- Une règle créée avec `onCallSchedules`, `teams` ou `users` (des listes d'identifiants) dans ses `miscDataProps` reçoit ces intervenants ; c'est ainsi que le sélecteur **Notifier** du tableau de bord les envoie. Une règle créée sans eux n'alerte personne tant que vous n'ajoutez pas d'intervenants via les ressources ci-dessus.
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
