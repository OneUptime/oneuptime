# Composants

Les composants sont les briques de base que vous ajoutez après le déclencheur. Chacun fait une chose — envoyer un message, appeler une API, vérifier une condition — et se relie à ce qui vient ensuite.

Cette page est le catalogue. Pour savoir comment glisser, déposer et relier les blocs sur le canevas, voir [Création d'un workflow](/docs/workflows/authoring).

## API

Effectuez une requête HTTP vers n'importe quelle URL.

**Paramètres** :

- **Method** — `GET`, `POST`, `PUT`, `PATCH` ou `DELETE`.
- **URL** — l'adresse à appeler.
- **Headers** — les en-têtes à envoyer.
- **Body** — le corps de la requête pour `POST` / `PUT` / `PATCH`.

**Sorties** :

- **Success** — se déclenche lorsque l'appel a réussi (réponse 2xx). Transmet le statut, les en-têtes et le corps.
- **Error** — se déclenche lors d'une erreur réseau ou d'une réponse non 2xx. Transmet le message d'erreur.

À utiliser pour : toute API externe, vos propres points de terminaison d'administration, ou toute intégration qui n'a pas son propre composant dédié.

## Webhook (sortant)

Une version plus simple du composant API pour les cas « envoyer et oublier ». Publie un corps JSON vers une URL.

Utilisez **API** si vous avez besoin de lire la réponse. Utilisez **Webhook** si vous voulez simplement envoyer une notification et passer à autre chose.

## Slack

Publiez un message dans un canal Slack.

**Paramètres** :

- **Channel** — le nom du canal. Le bot doit déjà être présent dans ce canal.
- **Message** — le texte à envoyer. Prend en charge le formatage Slack.

Connectez d'abord Slack à votre projet sous **Project Settings → Workspace Connections → Slack**. Voir [Connexion d'espace de travail Slack](/docs/workspace-connections/slack).

## Microsoft Teams

Publiez un message dans un canal Microsoft Teams.

**Paramètres** :

- **Team and channel** — l'endroit où publier.
- **Message** — le texte à envoyer.

Voir [Connexion d'espace de travail Microsoft Teams](/docs/workspace-connections/microsoft-teams) pour la configuration.

## Discord

Publiez un message dans un canal Discord via une URL de webhook entrant.

## Telegram

Envoyez un message à un chat Telegram à l'aide d'un jeton de bot et d'un identifiant de chat.

## Email

Envoyez un e-mail via OneUptime.

**Paramètres** :

- **To** — l'adresse e-mail du destinataire.
- **Subject** — l'objet de l'e-mail.
- **Body** — le message en Markdown ou en HTML.

L'e-mail est envoyé depuis l'expéditeur configuré pour votre projet — voir [SMTP](/docs/emails/smtp).

## Custom Code

Exécutez un petit morceau de JavaScript lorsque vous avez besoin de quelque chose que les autres blocs ne peuvent pas faire.

**Paramètres** :

- **Code** — votre JavaScript. La dernière valeur (ou ce que vous renvoyez depuis une fonction async) devient la sortie du bloc.
- **Arguments** — des valeurs nommées que vous pouvez passer en entrée.

**Sorties** : success (votre valeur de retour) et error (toute exception).

À utiliser pour : remettre en forme des données entre deux systèmes, faire un petit calcul, tout ce qui ne mérite pas son propre bloc. Pour des scripts plus lourds, utilisez plutôt un [Runbook](/docs/runbooks/index).

## JSON

Convertissez entre texte et JSON.

- **JSON → Text** — transforme un objet JSON en chaîne. Pratique quand le bloc suivant attend du texte.
- **Text → JSON** — analyse une chaîne en objet JSON. Pratique quand quelque chose est arrivé sous forme de texte et que vous devez lire un champ.

## Conditions

Créez un embranchement en fonction d'une comparaison.

**Paramètres** :

- **Left value** — généralement une valeur provenant d'un bloc précédent.
- **Operator** — `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with`.
- **Right value** — la valeur à comparer.

**Sorties** : **Yes** et **No**. Reliez les blocs suivants à la branche de votre choix.

## Delay

Met le workflow en pause pendant une durée donnée avant de continuer. Utile lorsque vous devez laisser à un autre système le temps de rattraper son retard.

## Log

Écrit une ligne dans le journal d'exécution. Aucun effet externe — cela apparaît simplement dans les journaux du workflow pour que vous puissiez les lire. Pratique pour le débogage.

## Execute Workflow

Appelle un autre workflow depuis celui-ci. Le workflow appelé s'exécute de son côté — votre workflow continue sans attendre qu'il se termine.

Utilisez ceci pour partager une logique commune. Construisez un workflow « publier dans le canal d'incident » une seule fois, puis appelez-le depuis tout autre workflow qui a besoin de notifier ce canal.

Une limite de sécurité empêche les workflows de s'appeler entre eux indéfiniment. Voir [Configuration et sécurité](/docs/workflows/configuration).

## Composants de données OneUptime

Pour chaque type d'enregistrement dans OneUptime (monitors, incidents, alertes, status pages, politiques d'astreinte et bien d'autres), la palette propose ces composants — recherchez par le nom du type :

- **Find One** — récupérer un enregistrement par ID ou par filtre.
- **Find** — récupérer une liste d'enregistrements.
- **Create** — ajouter un nouvel enregistrement.
- **Update** — modifier un enregistrement.
- **Delete** — supprimer un enregistrement.
- **Count** — compter les enregistrements correspondant à un filtre.

C'est ainsi qu'un workflow peut lire et modifier les données OneUptime. Par exemple : un webhook depuis votre outil CI peut utiliser **Create Incident** pour ouvrir un incident avec les détails de l'échec.

## Quel composant choisir ?

Quelques règles rapides :

- S'il existe un bloc dédié à ce que vous voulez (Slack, Email, un enregistrement OneUptime), utilisez-le — vous bénéficiez d'une meilleure gestion des erreurs et de journaux plus clairs.
- Pour toute autre API externe, utilisez **API**.
- Pour remettre en forme des données entre blocs, utilisez **Custom Code** ou **JSON**.
- Pour réaliser des actions différentes selon une valeur, utilisez **Conditions**.

## Pour aller plus loin

- [Variables](/docs/workflows/variables) — faire circuler les données entre les blocs.
- [Exécutions et journaux](/docs/workflows/runs-and-logs) — vérifier ce que chaque bloc a fait lors d'une exécution.
- [Configuration et sécurité](/docs/workflows/configuration) — limites, propriétaires et secrets.
