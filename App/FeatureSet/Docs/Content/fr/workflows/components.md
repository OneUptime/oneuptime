# Composants

Les composants sont les nœuds d'action que vous placez après un déclencheur. Chacun fait un travail — faire une requête HTTP, envoyer un message Slack, brancher sur une condition, exécuter un extrait JavaScript — et expose un ou plusieurs ports de sortie auxquels le nœud suivant peut se connecter.

Cette page est un catalogue. Pour les règles de câblage et le canevas lui-même, voir [Créer un workflow](/docs/workflows/authoring).

## API

Fait une requête HTTP sortante vers n'importe quelle URL.

**Arguments** :

- **Method** — `GET`, `POST`, `PUT`, `PATCH`, `DELETE`.
- **URL** — l'URL de la requête. Interpolée.
- **Request Headers** — objet JSON d'en-têtes.
- **Request Body** — corps JSON ou texte pour `POST` / `PUT` / `PATCH`.

**Ports de sortie** :

- `success` — se déclenche quand le statut de la réponse est 2xx. Valeurs de retour : `response-status`, `response-headers`, `response-body`.
- `error` — se déclenche lors d'un échec réseau ou d'une réponse non-2xx. Valeur de retour : message d'`error`.

À utiliser pour : toute API REST tierce, vos propres endpoints d'administration, intégrations légères qui n'ont pas de composant dédié.

## Webhook (sortant)

Un wrapper léger autour du composant API pour le cas courant « fire-and-forget ». Publie un corps JSON vers une URL et expose une seule paire `success` / `error`.

Préférez **API** si vous devez lire le corps de la réponse en aval ; préférez **Webhook** si vous voulez juste notifier un autre système.

## Slack

Publie un message dans un canal Slack en utilisant la connexion d'espace de travail Slack de votre projet.

**Arguments** :

- **Channel name** — le canal dans lequel publier. Le bot doit déjà être membre de ce canal.
- **Message text** — le corps. Interpolé ; supporte le mrkdwn Slack.

Configurez d'abord la connexion d'espace de travail dans **Project Settings → Workspace Connections → Slack**. Voir [Slack Workspace Connection](/docs/workspace-connections/slack).

## Microsoft Teams

Publie un message dans un canal Microsoft Teams en utilisant la connexion Teams de votre projet.

**Arguments** :

- **Team & channel** — la destination.
- **Message text** — le corps.

Voir [Microsoft Teams Workspace Connection](/docs/workspace-connections/microsoft-teams) pour la configuration de la connexion.

## Discord

Publie un message dans un canal Discord via une URL de webhook entrant configurée sur le composant.

## Telegram

Envoie un message à un chat Telegram via un token de bot et un ID de chat configurés sur le composant.

## E-mail

Envoie un e-mail via la configuration SMTP de OneUptime.

**Arguments** :

- **To** — adresse e-mail du destinataire.
- **Subject** — interpolé.
- **Body** — Markdown ou HTML.

L'e-mail est envoyé depuis l'adresse de l'expéditeur configurée pour le projet (voir [SMTP](/docs/emails/smtp)).

## Custom Code

Exécute un extrait de JavaScript avec accès aux variables du workflow et aux valeurs de retour du nœud en amont.

**Arguments** :

- **Code** — le corps JavaScript. La valeur de la dernière expression (ou tout ce qui est retourné depuis `(async () => { ... })()`) devient la valeur de retour du composant.
- **Arguments** — valeurs nommées optionnelles passées en `args`.

**Ports de sortie** : `success` (valeur de retour), `error` (exception capturée).

À utiliser pour : transformer une charge utile entre deux systèmes, faire un petit calcul qui ne mérite pas son propre composant, appeler une logique JS uniquement. Le scripting plus lourd qui doit s'exécuter dans votre propre infrastructure appartient à une étape Bash ou JavaScript de [Runbook](/docs/runbooks/index).

## JSON

Convertit entre texte et JSON.

- **JSON → Text** — sérialise un objet JSON en chaîne (pratique pour transmettre dans un argument `body` d'un composant sortant qui attend du texte).
- **Text → JSON** — analyse une chaîne en objet JSON. Utile lorsqu'une API en amont a renvoyé son corps sous forme de texte mais que vous devez lire un champ.

## Conditions

Branche sur une comparaison. Configurez :

- **Left value** — typiquement une référence interpolée comme `{{Incident.title}}`.
- **Operator** — `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with`.
- **Right value** — la valeur à laquelle comparer.

**Ports de sortie** : `yes` et `no`. Câblez le reste du workflow depuis la branche qui correspond à votre intention.

## Schedule (délai)

Met un workflow en pause pour une durée configurée avant de continuer. Utile lorsque vous devez donner un moment à un système externe pour se stabiliser avant de vérifier son état.

## Log

Écrit une ligne dans le journal d'exécution du workflow. Pure aide au débogage ; la ligne est capturée sur l'exécution et visible sous **Logs**. Aucun effet de bord externe.

## Execute Workflow

Appelle un autre workflow comme sous-étape. Le workflow appelé s'exécute indépendamment (fire-and-forget) — le contrôle revient à l'appelant dès que l'appel est dispatché.

Utilisez-le pour factoriser la logique partagée hors de plusieurs workflows : construisez un workflow « post-to-incident-channel » une fois et appelez-le depuis chaque autre workflow qui doit notifier le canal.

Une limite de récursion empêche les workflows de s'appeler mutuellement dans une boucle infinie. Voir [Configuration et sécurité](/docs/workflows/configuration).

## Composants de modèle (CRUD sur les entités OneUptime)

Pour chaque entité OneUptime qui supporte les workflows (monitors, incidents, alertes, status pages, politiques d'astreinte, etc.), la palette expose automatiquement les composants suivants — recherchables par nom d'entité :

- **Find One {Entity}** — récupère un seul enregistrement par requête.
- **Find {Entity}** — récupère une liste d'enregistrements par requête (paginée).
- **Create {Entity}** — insère un nouvel enregistrement.
- **Update {Entity}** — met à jour un enregistrement par ID.
- **Delete {Entity}** — supprime un enregistrement par ID.
- **Count {Entity}** — compte les enregistrements correspondant à une requête.

C'est ainsi qu'un workflow peut lire et écrire l'état OneUptime sans quitter la plateforme. Par exemple : un webhook depuis votre outil CI appelle **Create Incident** avec le message d'échec du build ; ou un workflow planifié exécute **Find Incident** toutes les cinq minutes et envoie un résumé par e-mail.

## Choisir le bon composant

Quelques règles de pouce rapides :

- S'il existe un composant dédié pour ce que vous voulez faire (Slack, E-mail, un CRUD sur une entité OneUptime), utilisez-le — il vous donne une meilleure gestion des erreurs et des journaux plus clairs que de le rouler vous-même.
- Si vous devez appeler une API HTTP externe qui n'a pas de composant dédié, utilisez **API**.
- Si vous devez *façonner* des données entre deux composants, utilisez **Custom Code** ou **JSON**.
- Si vous devez prendre des actions différentes selon une valeur, utilisez **Conditions**.

## Où lire ensuite

- [Variables](/docs/workflows/variables) — comment alimenter des données d'un composant vers le suivant.
- [Exécutions et journaux](/docs/workflows/runs-and-logs) — comment inspecter ce que chaque composant a renvoyé pendant une exécution.
- [Configuration et sécurité](/docs/workflows/configuration) — limites, propriété et secrets.
