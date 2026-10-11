# Vue d'ensemble des formulaires

Un formulaire est une page que toute personne disposant de son lien peut remplir, sans compte OneUptime. Chaque soumission crée quelque chose dans votre projet : un **incident**, pour les signalements de problèmes, ou un **événement de maintenance planifiée**, pour les demandes de changement et de maintenance. Vous construisez les questions du formulaire dans un éditeur par glisser-déposer, décidez comment les réponses deviennent l'enregistrement et partagez le lien avec les personnes qui doivent l'utiliser.

Utilisez un formulaire quand les personnes qui remarquent un problème, ou qui ont besoin d'un changement, ne sont pas celles qui gèrent vos incidents et vos maintenances : agents du support, collègues d'un autre service, responsable de magasin, équipe d'exploitation d'un client. Elles ouvrent le lien, répondent à vos questions et cliquent sur **Soumettre**. Votre équipe reçoit un incident ou un événement ordinaire, avec les réponses dans ses champs et une note privée qui indique qui l'a envoyé.

:::cards
- [Créer votre premier formulaire](#créer-votre-premier-formulaire): D'un formulaire vide à un lien que vous pouvez partager.
- [Créer un formulaire](/docs/forms/building): Questions, types de réponse, questions masquées, modèles et image de marque.
- [Ce que crée une soumission](/docs/forms/on-submit): Comment les réponses et les paramètres deviennent un incident ou un événement de maintenance.
- [Partage et sécurité](/docs/forms/sharing-and-security): Le lien, la liste d'autorisation IP, les limites de débit et le dépannage.
:::

## Fonctionnement d'un formulaire

```mermaid title="D'un formulaire rempli à un incident ou un événement de maintenance"
flowchart TB
    submitter["Une personne avec le lien,<br/>sans compte"] --> page["La page du formulaire"]
    page -->|Soumettre| checks["Protections et<br/>vérification des réponses"]
    checks --> submission["Soumission, conservée<br/>avec le formulaire"]
    submission --> target{"Chaque soumission crée"}
    target -->|Incident| incident["Incident, masqué<br/>sur les pages de statut"]
    target -->|Maintenance planifiée| event["Événement de maintenance,<br/>masqué sauf réglage contraire"]
    incident --> response["Les politiques d'astreinte<br/>et les règles s'exécutent"]
    incident --> note["Note privée : qui l'a envoyé,<br/>autres réponses"]
    event --> note
```

Chaque requête passe d'abord les protections du formulaire : sa propre page, les limites de débit, la liste d'autorisation IP et le captcha. Une soumission dont les réponses conviennent est conservée et crée un enregistrement, rempli à partir des réponses, des paramètres **À la soumission** du formulaire et, pour un incident, de son modèle d'incident. Rien de ce qu'elle crée n'atteint une page de statut tant que votre équipe ne l'a pas décidé.

## En un coup d'œil

- **Un produit à part entière** : **Formulaires** se trouve dans le menu des produits, à `/dashboard/{projectId}/forms`. Chaque formulaire a son propre lien, par exemple `https://oneuptime.com/accounts/form/<share-key>` sur OneUptime Cloud.
- **Aucun compte nécessaire** : toute personne disposant du lien peut ouvrir le formulaire et le soumettre, sans se connecter.
- **Un éditeur, pas une page de paramètres** : ajoutez vos propres questions (réponses courtes, paragraphes, listes déroulantes, dates, cases à cocher et plus), les champs de ce que crée le formulaire (titre, description, gravité, moniteurs, étiquettes, début et fin), vos champs personnalisés, ainsi que le nom et l'e-mail de la personne qui soumet. Faites-les glisser dans l'ordre, prévisualisez le formulaire, enregistrez.
- **Vous décidez d'où vient chaque valeur** : la page **À la soumission** liste chaque champ du nouvel incident ou événement à côté de sa source : une réponse, une valeur par défaut, un paramètre qui s'applique toujours, ou le modèle d'incident.
- **Masqué jusqu'à ce que quelqu'un le publie** : les incidents issus d'un formulaire ne sont jamais affichés sur les pages de statut ni envoyés aux abonnés quand ils sont déclarés ; les événements de maintenance non plus, sauf si le formulaire le prévoit.
- **Protégé en plusieurs couches** : un interrupteur **Accepte les soumissions**, une **Liste d'autorisation IP** facultative, le refus des requêtes venant d'autres sites, des limites de débit, le captcha de l'instance et des limites de taille pour chaque réponse.
- **Chaque soumission conservée** : la page **Soumissions** de chaque formulaire, et **Formulaires → Soumissions** pour tous, listent les réponses et renvoient vers ce que chaque soumission a créé.
- **Votre propre image de marque** : téléversez un logo pour le haut de la page du formulaire et un favicon pour l'onglet du navigateur, dans la section **Image de marque** de la page **Construire**. D'ici là, le formulaire affiche ceux de OneUptime.
- **Des modèles pour les cas courants** : enregistrez des ensembles de réponses nommés, comme **Panne de l'application** ou **Maintenance prévue**, et les personnes en choisissent un en haut du formulaire pour le remplir, ou ouvrent son propre lien. Chaque modèle peut aussi rendre une question obligatoire, facultative ou masquée pour son cas. Un seul formulaire, et un seul favori, sert toute une équipe.
- **Questions masquées** : masquez une question à laquelle personne ne devrait avoir à répondre, comme la description de l'incident, et laissez chaque modèle y répondre à la place, ou la poser, pour les cas qui en ont besoin.
- **Dupliquer le formulaire** : démarrez un formulaire pour une autre équipe à partir d'un formulaire qui fonctionne, avec ses questions, ses modèles et ses paramètres.

## Ce qu'un formulaire peut créer

Quand vous créez un formulaire, vous choisissez ce que **Chaque soumission crée**. Vous pouvez le changer plus tard sur la page **À la soumission** du formulaire.

| Chaque soumission crée | À utiliser pour | Ce qui se passe |
| --- | --- | --- |
| **Incident** | Les signalements de problèmes | Un incident est déclaré immédiatement, si bien que vos politiques d'astreinte et vos règles s'exécutent et que les personnes d'astreinte sont prévenues. Il reste absent des pages de statut jusqu'à ce qu'un intervenant le publie. |
| **Maintenance planifiée** | Les demandes de changement et de maintenance | Un événement de maintenance est planifié pour la fenêtre demandée par la personne qui soumet. Sauf indication contraire du formulaire, il reste absent de ses pages de statut et ne prévient aucun abonné. |

Les formulaires commencent avec ces deux-là, et d'autres types d'enregistrements suivront.

## Avant de commencer

- **Un plan qui inclut les formulaires.** Sur OneUptime Cloud, les formulaires demandent le plan **Growth** ou supérieur. Voir [Plan](#plan).
- **L'autorisation de créer des formulaires.** **Create Form** appartient aux propriétaires et administrateurs du projet, ainsi qu'aux rôles auxquels vous la donnez. Voir [Autorisations](#autorisations).
- **Pour un formulaire d'incident, une gravité.** Chaque incident en a besoin d'une : issue d'une question, des paramètres du formulaire ou de son modèle d'incident. Sans elle, chaque soumission est refusée. Voir [Ce que crée une soumission](/docs/forms/on-submit#how-a-submission-becomes-an-incident).

## Créer votre premier formulaire

:::steps
### Créer le formulaire

Ouvrez **Formulaires** depuis le menu des produits et cliquez sur **Créer un formulaire**. Donnez au formulaire un nom (le titre de sa page publique, unique dans le projet), choisissez ce que **Chaque soumission crée** et, si vous le souhaitez, une description en Markdown, affichée en haut de la page publique.

### Construire ses questions

Le formulaire s'ouvre sur sa page **Construire**, où il demande déjà un titre, une description et qui soumet (et, pour un formulaire de maintenance, quand la maintenance commence et se termine). Ajoutez, retirez et réordonnez les questions, puis cliquez sur **Enregistrer les modifications**. Voir [Créer un formulaire](/docs/forms/building).

### Décider de ce que crée une soumission

Dans **À la soumission**, vérifiez comment une soumission devient un incident ou un événement, et cliquez sur **Modifier les paramètres** pour lui donner des valeurs par défaut : une gravité, un modèle d'incident, des moniteurs et des étiquettes à toujours joindre, des propriétaires à prévenir. Voir [Ce que crée une soumission](/docs/forms/on-submit).

### Ajouter des modèles si les mêmes cas reviennent

Dans **Modèles**, enregistrez un modèle pour chaque cas souvent signalé : le formulaire les liste au-dessus de ses questions, se remplit à partir de celui qui est choisi et pose les questions comme ce modèle l'indique ; une question dont un cas a besoin peut être obligatoire dans son modèle et masquée dans les autres. Voir [Modèles](/docs/forms/building#templates).

### Partager le lien

Dans **Partager**, copiez le lien et envoyez-le aux personnes qui doivent utiliser le formulaire. Voir [Partage et sécurité](/docs/forms/sharing-and-security).
:::

> [!IMPORTANT]
> Un nouveau formulaire **Accepte les soumissions** dès sa création, mais personne ne peut l'atteindre tant que vous n'avez pas partagé son lien. Configurez d'abord ses questions et ses protections.

## Les pages d'un formulaire

| Page | Ce qu'elle contient |
| --- | --- |
| **Construire** | Le nom et la description du formulaire, son **Image de marque** (logo et favicon, repliés) et l'éditeur : ses questions, la palette de questions et l'**Aperçu**. |
| **Modèles** | Des ensembles de réponses nommés à partir desquels on peut commencer le formulaire, la façon dont chacun pose les questions, celui avec lequel il s'ouvre et le lien propre à chacun. |
| **À la soumission** | Ce que crée chaque soumission et comment chacun de ses champs est rempli. **Modifier les paramètres** change les valeurs par défaut et ce qui s'applique toujours. |
| **Partager** | **Accepte les soumissions**, le **Lien de partage**, le message affiché après la soumission et la **Liste d'autorisation IP**. |
| **Soumissions** | Chaque soumission faite par le formulaire, la plus récente en premier, avec ses réponses et ce qu'elle a créé. |
| **Dupliquer le formulaire** | Sous **Avancé** : une copie du formulaire, nommée pour vous, avec ses questions, ses modèles, ses paramètres À la soumission, son image de marque, son message de remerciement et sa liste d'autorisation IP, et un lien qui lui est propre. La copie est d'abord désactivée et s'ouvre sur son éditeur. |
| **Supprimer le formulaire** | La suppression du formulaire, sous **Avancé**. Ses soumissions sont supprimées avec lui ; les incidents et événements qu'il a créés ne le sont pas. |

La section **Développeurs** du menu du formulaire contient ses pages Terraform, API et assistant IA, comme pour toute autre ressource.

## Formulaires et modèles d'incident

Un modèle et un formulaire vous évitent tous deux de saisir deux fois le même incident, mais ils servent des personnes différentes :

| | Modèle d'incident | Formulaire |
| --- | --- | --- |
| Qui l'utilise | Votre équipe, connectée à OneUptime | Toute personne avec le lien, sans compte |
| Où | **Créer à partir d'un modèle** dans la liste des incidents | Une page à part, au lien du formulaire |
| Ce qu'on peut changer | Chaque champ de l'incident, avant de le déclarer | Seulement les réponses aux questions que vous avez choisies |
| Ce qu'on voit | Vos moniteurs, politiques, propriétaires et chaque champ | Le nom, la description et les questions du formulaire, et seulement les options que vous proposez |
| Pages de statut | Ce que disent le modèle et le formulaire de déclaration | Masqué jusqu'à ce qu'un intervenant publie l'incident |

Ils fonctionnent ensemble. Donnez à un formulaire d'incident un **Modèle d'incident** sur sa page **À la soumission**, et chaque incident qu'il déclare l'est à partir de ce modèle : construisez le modèle pour ce dont votre équipe a besoin sur l'incident, et le formulaire pour ce que vous voulez demander à la personne qui soumet.

## Soumissions

La page **Soumissions** d'un formulaire liste chaque soumission faite par son intermédiaire, la plus récente en premier, avec **Envoyé le**, **Soumis par** (le nom et l'e-mail donnés par la personne qui soumet, ou **Anonyme**) et **Créé**, un lien vers l'incident ou l'événement créé. **Voir les réponses** affiche chaque réponse telle que la personne l'a donnée. **Formulaires → Soumissions** liste les soumissions de tous les formulaires du projet.

Les soumissions sont écrites par le formulaire, jamais à la main, et ne peuvent pas être modifiées. En supprimer une retire de la liste ses réponses ainsi que le nom et l'e-mail de la personne ; l'incident ou l'événement créé reste, de même que la note privée qu'il porte, qui reprend les coordonnées de la personne et les réponses. Quand l'incident ou l'événement est supprimé, sa soumission reste et sa colonne **Créé** indique **Supprimé depuis**.

> [!WARNING]
> Quand vous supprimez les données personnelles de quelqu'un, supprimer la soumission ne suffit pas : modifiez ou supprimez aussi la note privée sur l'incident ou l'événement qu'elle a créé.

## Autorisations

Les formulaires permettent à des personnes extérieures à votre équipe de créer des incidents et des événements de maintenance dans votre projet ; ils sont donc gérés par les propriétaires et administrateurs du projet, et par les rôles auxquels vous donnez les autorisations **Form**. Elles figurent dans le groupe **Form** de la [Référence des autorisations](/docs/permissions/reference) :

| Autorisation | Ce qu'elle permet | Qui l'a par défaut |
| --- | --- | --- |
| **Create Form** | Créer des formulaires et les dupliquer. | Project Owner, Project Admin |
| **Edit Form** | Modifier un formulaire : ses questions, son image de marque, ses modèles, ses paramètres À la soumission, **Accepte les soumissions**, son lien et sa **Liste d'autorisation IP**. | Project Owner, Project Admin |
| **Delete Form** | Supprimer un formulaire, et avec lui ses soumissions. | Project Owner, Project Admin |
| **Read Form** | Voir les formulaires, leurs questions, leurs paramètres et leurs liens. | Les rôles ci-dessus, plus Project Member, Viewer et les rôles d'incident et de maintenance planifiée |
| **Read Form Submission** | Voir les soumissions et leurs réponses. | Project Owner, Project Admin |
| **Delete Form Submission** | Supprimer des soumissions. | Project Owner, Project Admin |

Les soumissions contiennent ce que des inconnus ont saisi (noms, adresses e-mail et réponses qui n'atteignent peut-être jamais l'enregistrement) ; seuls les propriétaires et administrateurs du projet les voient donc, sauf si vous accordez **Read Form Submission**. Quiconque peut lire un formulaire peut voir et partager son lien. Soumettre un formulaire ne demande aucune autorisation. Pour savoir comment les rôles et les autorisations granulaires se combinent, voir [Utilisateurs, équipes et autorisations](/docs/permissions/index).

## Plan

Sur OneUptime Cloud, les formulaires demandent le plan **Growth** ou supérieur, et la **Liste d'autorisation IP** d'un formulaire demande **Scale**, qu'elle soit définie à la création du formulaire ou modifiée plus tard. Les liens d'un projet sous le plan **Growth**, ou dont l'abonnement est impayé, affichent le message « non disponible », et rien n'est créé.

## Les formulaires par l'API

Les formulaires sont une ressource d'API ordinaire à `/api/form`, et leurs soumissions à `/api/form-submission`, que vous pouvez lire et supprimer mais pas créer ni modifier. La [référence de l'API](/reference) donne la forme complète des requêtes et des réponses.

### Questions et paramètres

Les questions d'un formulaire sont sa colonne `fields`, une liste JSON dans l'ordre où le formulaire les pose, et ses paramètres À la soumission sont ses `targetSettings` :

```json
{
  "data": {
    "targetType": "Incident",
    "fields": [
      {
        "id": "what",
        "source": "TargetField",
        "targetField": "title",
        "label": "What is wrong?",
        "isRequired": true
      },
      {
        "id": "office",
        "source": "Question",
        "type": "Dropdown",
        "label": "Which office are you in?",
        "dropdownOptions": "Berlin\nLondon",
        "isRequired": false
      },
      {
        "id": "email",
        "source": "Submitter",
        "submitterField": "Email",
        "label": "Your Email",
        "isRequired": true
      }
    ],
    "targetSettings": {
      "incidentSeverityId": "<severity-id>",
      "labelIds": ["<label-id>"]
    }
  }
}
```

Chaque question a son propre `id` (lettres, chiffres, `-` et `_`), une `source`, un `label`, et facultativement `helpText` et `isRequired` :

| `source` | Ce qu'elle demande |
| --- | --- |
| `Question` | Une question propre au formulaire, à laquelle on répond selon son `type` : `Text`, `LongText`, `Markdown`, `Number`, `Dropdown`, `MultiSelectDropdown`, `Boolean`, `Date` ou `DateTime`. Une liste déroulante liste ses `dropdownOptions`, une par ligne. |
| `TargetField` | Un champ de ce que crée le formulaire, nommé par `targetField` : `title`, `description`, `incidentSeverityId`, `monitors`, `labels` et `impactStartedAt` pour un incident ; `title`, `description`, `startsAt`, `endsAt`, `monitors`, `statusPages` et `labels` pour un événement de maintenance. Un champ auquel on répond par un choix liste les enregistrements qu'il propose dans `allowedOptionIds`. |
| `TargetCustomField` | L'un des champs personnalisés de l'incident ou de l'événement, nommé par `customFieldId`. |
| `Submitter` | Le `Name` ou l'`Email` de la personne qui soumet, nommé par `submitterField`. |

Une question dont `isHidden` vaut `true` n'est pas affichée sur la page publique, n'est jamais obligatoire et ne reçoit de réponse que du modèle nommé par une soumission, sauf si ce modèle la pose. `isRequired` et `isHidden` sont la valeur par défaut du formulaire ; chaque modèle peut poser une question à sa façon.

### Les modèles dans l'API

Les modèles d'un formulaire sont sa colonne `templates`, une liste JSON dans l'ordre où le formulaire les liste. Chaque modèle a son propre `id` (lettres, chiffres, `-` et `_`), un `name` de 100 caractères au plus, unique dans le formulaire, et des `answers` indexées par identifiant de question, chacune telle qu'une soumission l'envoie : du texte, un nombre, `true` ou `false`, la valeur d'une option, ou une liste de valeurs pour une sélection multiple. `isDefault` à `true` en fait le modèle avec lequel le formulaire s'ouvre ; un formulaire en a au plus un, et jusqu'à 50 modèles.

`fieldSettings`, indexé lui aussi par identifiant de question, indique comment le modèle pose une question : `Required`, `Optional` ou `Hidden`. Une question qu'il ne liste pas (ou qu'il liste à `null`) est posée comme le formulaire la pose, et les questions `startsAt` et `endsAt` d'un événement de maintenance ne peuvent être que `Required` :

```json
{
  "data": {
    "templates": [
      {
        "id": "outage",
        "name": "Application Outage",
        "isDefault": true,
        "answers": {
          "what": "The application is down",
          "office": "Berlin"
        },
        "fieldSettings": {
          "office": "Required",
          "email": "Optional"
        }
      }
    ]
  }
}
```

Les questions, les modèles et les paramètres sont vérifiés à chaque enregistrement (depuis le tableau de bord, l'API, Terraform ou un workflow), et une liste qui enfreint une règle est refusée avec un message qui nomme le problème. `shareKey`, la clé du lien du formulaire, est définie par OneUptime à la création du formulaire, et la changer est ce que fait **Réinitialiser le lien**.

### L'image de marque dans l'API

L'image de marque d'un formulaire, ce sont ses `logoFileId`, `logoAltText` et `faviconFileId`. Téléversez d'abord l'image avec `POST /api/file`, dans le projet du formulaire (avec une clé d'API de ce projet, ou connecté en tant que membre avec son identifiant dans l'en-tête `tenantid`), en envoyant son `name`, son `fileType`, par exemple `image/png`, et les octets en base64 dans `file`, puis définissez l'`_id` qu'elle renvoie. Un téléversement dans un projet dont vous n'êtes pas membre est refusé avec "You can upload files only to a project you are a member of." Chaque téléversement est privé : `isPublic` est défini par OneUptime, quoi que dise la requête. Chaque image est vérifiée à l'enregistrement du formulaire : elle doit avoir été téléversée dans le projet du formulaire, et un logo doit être une image PNG, JPEG, GIF, WebP ou SVG de 512 Ko au plus, un favicon l'une de celles-ci ou un ICO de 128 Ko au plus. Définissez un identifiant à `null` pour revenir à ceux de OneUptime. Voir [Image de marque](/docs/forms/building#branding).

### Lire les soumissions

Pour lister les soumissions d'un formulaire :

```bash
curl -X POST https://oneuptime.com/api/form-submission/get-list \
  -H "apikey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": { "formId": "<form-id>" },
    "select": { "submitterName": true, "submitterEmail": true, "answers": true, "incidentId": true, "scheduledMaintenanceId": true, "createdAt": true },
    "limit": 50,
    "skip": 0
  }'
```

### Workflows

Les formulaires ont les composants de workflow générés : **On Create Form**, **On Update Form**, etc. Pour agir sur ce qu'un formulaire a créé, utilisez **On Create Incident** ou **On Create Scheduled Maintenance**.

### Les points de terminaison propres à la page publique

La page publique communique avec deux routes qui ne demandent pas de clé d'API : `GET /api/form/public/<shareKey>`, qui renvoie le nom, la description et les questions du formulaire (ainsi que son logo, le texte alternatif du logo et son favicon, les images en base64, quand il en a, et ses modèles, avec leurs réponses aux questions que pose la page), et `POST /api/form/public/<shareKey>/submit`, qui le soumet en nommant dans `templateId` le modèle à partir duquel la personne a commencé. Ce sont les points de terminaison propres à la page, pas une API sur laquelle construire : chaque appel passe par les protections du formulaire (voir [Partage et sécurité](/docs/forms/sharing-and-security)), et ils changent avec la page. Pour créer des incidents depuis votre propre code, utilisez `POST /api/incident` avec une clé d'API : voir [Déclarer un incident](/docs/incidents/declaring-incidents).

## Ce que sont devenus vos formulaires d'incident

Les formulaires remplacent les **Incident Forms** qui se trouvaient sous **Incidents → Paramètres → Formulaires**. Chaque formulaire d'incident a été transféré lors de la mise à niveau, avec le même lien et les mêmes soumissions :

- Ses questions sont devenues celles de l'éditeur : le titre, la description sauf si elle était masquée, la gravité quand la personne pouvait la choisir, chaque champ personnalisé qu'il demandait (dans l'ordre de tri des champs personnalisés), ainsi que **Your Name** et **Your Email**, obligatoires sauf si le formulaire permettait les signalements anonymes.
- Sa gravité et son modèle d'incident sont devenus ses valeurs par défaut **À la soumission**.
- Son interrupteur **Activé**, son message de réussite et sa **Liste d'autorisation IP** sont inchangés, tout comme son lien : les anciens liens `/accounts/incident-form/<share-key>` ouvrent le formulaire à sa nouvelle adresse.
- Les autorisations **Incident Form** sont devenues les autorisations **Form**, pour chaque équipe et clé d'API qui les avait.

Les anciennes pages du tableau de bord redirigent vers les nouvelles.

## Étapes suivantes

:::cards
- [Créer un formulaire](/docs/forms/building): Questions, types de réponse, champs liés, champs personnalisés et aperçu.
- [Ce que crée une soumission](/docs/forms/on-submit): Comment les réponses et les paramètres À la soumission deviennent un incident ou un événement de maintenance.
- [Partage et sécurité](/docs/forms/sharing-and-security): Le lien, la liste d'autorisation IP, les limites de débit, le captcha et le dépannage.
- [Déclarer un incident](/docs/incidents/declaring-incidents): Les autres façons de déclarer des incidents.
:::
