# Serveur MCP

Le serveur MCP (Model Context Protocol) de OneUptime fournit aux LLM un accès direct à votre instance OneUptime, permettant des opérations de surveillance, de gestion des incidents et d'observabilité alimentées par l'IA.

## Qu'est-ce que le serveur MCP de OneUptime ?

Le serveur MCP de OneUptime est un pont entre les grands modèles de langage (LLM) et votre instance OneUptime. Il implémente le Model Context Protocol (MCP), permettant aux assistants IA comme Claude d'interagir directement avec votre infrastructure de surveillance.

## Fonctionnement

Le serveur MCP est hébergé aux côtés de votre instance OneUptime et accessible via le transport HTTP Streamable. Aucune installation locale n'est requise.

**Utilisateurs Cloud** : `https://oneuptime.com/mcp`
**Utilisateurs auto-hébergés** : `https://your-oneuptime-domain.com/mcp`

## Fonctionnalités clés

- **~155 outils** : Outils CRUD complets pour 22 types de ressources (incidents, alertes, moniteurs, pages de statut, astreinte, et plus encore), outils de télémétrie en lecture seule, ainsi que des outils de flux de travail et des outils utilitaires
- **Opérations en temps réel** : Création, lecture, mise à jour et suppression de ressources en temps réel
- **Interface typée** : Entièrement typé avec validation complète des entrées
- **Authentification sécurisée** : Connexion avec votre compte OneUptime (OAuth 2.1), ou clé API envoyée à chaque requête pour les agents sans surveillance
- **Annotations de sécurité** : Les outils en lecture seule portent l'annotation `readOnlyHint` et les outils de suppression l'annotation `destructiveHint`, afin que les clients MCP puissent approuver automatiquement les appels sûrs et demander confirmation avant les appels destructeurs
- **Intégration facile** : Fonctionne avec Claude Desktop et d'autres clients compatibles MCP
- **Sans état par conception** : Pas d'identifiants de session — chaque requête est autonome, de sorte que le serveur fonctionne derrière des répartiteurs de charge et des déploiements multi-répliques

## Ce que vous pouvez faire

Avec le serveur MCP de OneUptime, les assistants IA peuvent vous aider à :

- **Gestion des moniteurs** : Créer et configurer des moniteurs, vérifier leur statut et consulter l'historique de statut
- **Réponse aux incidents** : Créer, prendre en charge et résoudre des incidents, ajouter des notes internes ou publiques et suivre la résolution
- **Opérations d'équipe** : Gérer les équipes et les politiques d'astreinte
- **Pages de statut** : Gérer les pages de statut et créer des annonces
- **Alertes** : Prendre en charge et résoudre les alertes, ajouter des notes d'alerte et gérer les états et sévérités des alertes
- **Maintenance planifiée** : Créer et gérer des événements de maintenance programmée
- **Télémétrie** : Interroger les journaux, les métriques, les traces, les exceptions et les journaux de moniteurs (lecture seule)

## Prérequis

- Instance OneUptime (cloud ou auto-hébergée)
- Client compatible MCP (Claude Desktop, VS Code avec GitHub Copilot, etc.)
- Un compte OneUptime pour vous connecter, ou une clé API OneUptime pour un agent qui s'exécute sans surveillance (uniquement requis pour les opérations authentifiées — les outils publics fonctionnent sans l'un ni l'autre)

## Se connecter avec OneUptime

Le moyen le plus simple de connecter votre client MCP est de lui donner l'URL du serveur et rien d'autre. La première fois que le client a besoin de vos données, il ouvre dans votre navigateur une page OneUptime sur laquelle vous effectuez les étapes suivantes :

1. Connectez-vous à OneUptime, si vous n'êtes pas déjà connecté
2. Choisissez le projet dans lequel le client doit travailler
3. Choisissez si le client a un accès en **lecture et écriture** ou en **lecture seule**
4. Cliquez sur **Autoriser**

Le client agit alors sous votre identité dans ce projet. Il n'y a aucune clé API à créer, copier ou renouveler, et rien de secret n'est stocké dans un fichier de configuration.

Ce que peut faire un client connecté :

- **Il a vos permissions, et jamais davantage.** Ce que vos équipes vous autorisent à faire dans le projet, c'est ce que le client peut faire. Si votre rôle change ou si vous quittez le projet, cela s'applique dès la requête suivante du client. Quitter le projet déconnecte aussi le client : son autorisation est supprimée, et vous le reconnectez si vous rejoignez de nouveau le projet.
- **Lecture seule signifie lecture seule.** Un client autorisé en lecture seule peut utiliser les outils `get_`, `list_` et `count_`. Les outils qui créent, mettent à jour ou suppriment des ressources, ou qui prennent en charge ou résolvent des incidents ou des alertes, sont refusés, par le serveur MCP comme par l'API OneUptime qui se trouve derrière lui. Vous ne pouvez jamais donner à un client plus d'accès qu'il n'en a demandé.
- **Il est limité à un seul projet.** Pour utiliser un deuxième projet, connectez de nouveau le client et choisissez ce projet.
- **Il ne fonctionne qu'à travers le serveur MCP.** Le jeton d'accès du client est accepté par le point de terminaison MCP et nulle part ailleurs. Il ne peut pas servir à appeler directement l'API REST de OneUptime.
- **Les administrateurs d'instance ne bénéficient d'aucun traitement particulier.** Un client connecté par un administrateur principal (master admin) dispose de ce que les équipes de cette personne accordent dans le projet, et non d'un accès à l'ensemble de l'instance.

### Gérer les clients connectés

Chaque client connecté avec un compte est listé sous **Paramètres du projet** → **Serveur MCP** → **Connected MCP Clients**, avec la personne qui l'a connecté, ce qu'il est autorisé à faire et la date de sa dernière utilisation. Vous voyez les clients que vous avez connectés ; les propriétaires et administrateurs du projet voient ceux de tout le monde.

Cliquez sur **Disconnect** pour déconnecter un client. Il cesse immédiatement de fonctionner.

Un client reste connecté tant qu'il est utilisé. Un client qui n'a pas été utilisé pendant 30 jours doit se connecter de nouveau.

### Contrôler qui peut connecter des clients

Par défaut, chaque membre du projet peut connecter un client MCP. Pour empêcher les membres d'une équipe de le faire, ouvrez l'équipe, accédez à **Bloquer les autorisations**, puis ajoutez la permission **Authorize MCP Client**. Les clients que ces membres ont déjà connectés cessent aussitôt de fonctionner.

Si le projet exige l'authentification unique, connectez-vous au projet avec le SSO dans votre navigateur avant d'autoriser un client. La connexion du client dure aussi longtemps que cette session SSO ; lorsque celle-ci expire, connectez de nouveau le client.

Sur OneUptime Cloud, la connexion d'un client MCP est disponible avec les mêmes forfaits que les clés API (Growth et supérieurs).

Dans l'Enterprise Edition, chaque modification effectuée par un client connecté est enregistrée dans le journal d'audit au nom de la personne qui l'a connecté, avec le nom du client. Les modifications effectuées avec une clé API indiquent le nom de la clé.

## Obtention de votre clé API

Utilisez une clé API pour un agent qui s'exécute sans surveillance — une tâche planifiée ou un pipeline CI — lorsque personne n'est là pour se connecter.

1. Connectez-vous à votre instance OneUptime
2. Accédez à **Paramètres du projet** → **Clés API**
3. Cliquez sur **Créer une clé API**
4. Donnez-lui un nom (par ex., « Serveur MCP »)
5. Sélectionnez les permissions appropriées pour votre cas d'utilisation
6. Copiez la clé API générée

Les clés API sont limitées à un projet : le serveur MCP déduit votre projet à partir de la clé, si bien que les outils de création n'ont jamais besoin d'un argument `projectId`.

> **Avertissement — ne donnez jamais une clé maîtresse à un agent IA.** Une clé API *maîtresse* OneUptime est également acceptée sur cet en-tête et accorde un accès administrateur à l'ensemble de l'instance. Utilisez toujours une clé API de projet avec le privilège minimal dont l'agent a besoin (une clé en lecture seule suffit pour tous les outils `get_`/`list_`/`count_`).

## Configuration

### Connecter un client avec votre compte

Ajoutez l'URL du serveur à votre client, sans informations d'identification. Utilisez `https://your-oneuptime-domain.com/mcp` pour une instance auto-hébergée.

**Claude Code**

```bash
claude mcp add --transport http oneuptime https://oneuptime.com/mcp
```

Exécutez ensuite `/mcp` dans Claude Code et choisissez **oneuptime** pour vous connecter.

**Claude (web et bureau)**

Ouvrez **Customize** → **Connectors**, choisissez **Add custom connector**, puis saisissez `https://oneuptime.com/mcp`. Claude vous demande de vous connecter à OneUptime la première fois qu'il a besoin de vos données.

**VS Code avec GitHub Copilot**

Ajoutez ceci à votre configuration MCP (voir [VS Code avec GitHub Copilot](#vs-code-avec-github-copilot) pour l'emplacement de ce fichier). VS Code ouvre OneUptime pour que vous vous connectiez lorsque vous démarrez le serveur :

```json
{
  "servers": {
    "oneuptime": {
      "type": "http",
      "url": "https://oneuptime.com/mcp"
    }
  }
}
```

**Cursor**

```json
{
  "mcpServers": {
    "oneuptime": {
      "url": "https://oneuptime.com/mcp"
    }
  }
}
```

Tout autre client qui prend en charge l'autorisation MCP fonctionne de la même manière : donnez-lui l'URL et il découvre tout le reste. Voir [Connexion avec votre compte (OAuth 2.1)](#connexion-avec-votre-compte-oauth-21) pour les détails du protocole.

Le reste de cette section montre les mêmes clients configurés avec une clé API à la place.

### Configuration de Claude Desktop

Trouvez votre fichier de configuration Claude Desktop :

**macOS** : `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows** : `%APPDATA%\Claude\claude_desktop_config.json`
**Linux** : `~/.config/Claude/claude_desktop_config.json`

### Pour OneUptime Cloud

Ajoutez la configuration suivante :

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "https://oneuptime.com/mcp",
      "headers": {
        "x-api-key": "your-api-key-here"
      }
    }
  }
}
```

### Pour OneUptime auto-hébergé

Remplacez `oneuptime.com` par votre domaine OneUptime :

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "https://your-oneuptime-domain.com/mcp",
      "headers": {
        "x-api-key": "your-api-key-here"
      }
    }
  }
}
```

### Accès public (sans clé API)

Pour utiliser uniquement les outils publics (informations sur la page de statut, aide), vous pouvez vous connecter sans clé API :

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "https://oneuptime.com/mcp"
    }
  }
}
```

Cette configuration permet l'accès aux outils publics de la page de statut et aux ressources d'aide sans authentification.

### VS Code avec GitHub Copilot

VS Code prend en charge les serveurs MCP nativement avec GitHub Copilot (version 1.99+). Cela permet à Copilot d'accéder directement aux données OneUptime.

#### Étape 1 : Prérequis

- VS Code version 1.99 ou ultérieure
- Extension GitHub Copilot installée et activée
- GitHub Copilot Chat activé

#### Étape 2 : Ouvrir la configuration MCP

1. Appuyez sur `Ctrl+Shift+P` (Windows/Linux) ou `Cmd+Shift+P` (macOS)
2. Tapez « MCP: Open User Configuration » et appuyez sur Entrée
3. Cela ouvre ou crée le fichier de configuration `mcp.json`

Vous pouvez également créer `.vscode/mcp.json` dans votre espace de travail pour une configuration spécifique au projet.

#### Pour OneUptime Cloud

```json
{
  "servers": {
    "oneuptime": {
      "type": "http",
      "url": "https://oneuptime.com/mcp",
      "headers": {
        "x-api-key": "${input:oneuptime-api-key}"
      }
    }
  },
  "inputs": [
    {
      "type": "promptString",
      "id": "oneuptime-api-key",
      "description": "OneUptime API Key",
      "password": true
    }
  ]
}
```

#### Pour OneUptime auto-hébergé

```json
{
  "servers": {
    "oneuptime": {
      "type": "http",
      "url": "https://your-oneuptime-domain.com/mcp",
      "headers": {
        "x-api-key": "${input:oneuptime-api-key}"
      }
    }
  },
  "inputs": [
    {
      "type": "promptString",
      "id": "oneuptime-api-key",
      "description": "OneUptime API Key",
      "password": true
    }
  ]
}
```

#### Étape 3 : Démarrer le serveur MCP

1. Appuyez sur `Ctrl+Shift+P` / `Cmd+Shift+P`
2. Tapez « MCP: List Servers » pour voir les serveurs disponibles
3. Cliquez sur « oneuptime » pour démarrer le serveur
4. Lorsque vous y êtes invité, saisissez votre clé API OneUptime

#### Étape 4 : Utiliser avec Copilot Chat

Ouvrez GitHub Copilot Chat et utilisez le mode Agent (`@workspace` ou demandez directement) :

```
"What monitors do I have in OneUptime?"
"Show me recent incidents"
"Create a new monitor for https://example.com"
```

#### Note de sécurité

La configuration ci-dessus utilise des variables d'entrée avec `"password": true` pour demander de manière sécurisée votre clé API plutôt que de la stocker en texte clair. VS Code vous demandera de confirmer la confiance lors du démarrage du serveur MCP pour la première fois.

## Points de terminaison disponibles

| Point de terminaison | Méthode | Description                                                                                                                    |
| -------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `/mcp`               | POST    | Requêtes JSON-RPC pour les appels d'outils et autres opérations                                                                  |
| `/mcp`               | GET     | Sans en-tête `Accept` SSE : charge utile JSON conviviale de découverte. Avec un tel en-tête : `405` — le serveur sans état n'offre pas de flux SSE autonome (les clients conformes continuent sans lui) |
| `/mcp`               | DELETE  | Sans effet (le serveur est sans état, il n'y a donc aucune session à terminer)                                                   |
| `/mcp/health`        | GET     | Point de terminaison de vérification de l'état                                                                                   |
| `/mcp/tools`         | GET     | API REST pour lister les outils disponibles                                                                                      |

Les clients MCP qui se connectent avec un compte utilisent aussi les points de terminaison OAuth ci-dessous. Un client les trouve par lui-même ; ils sont listés ici pour les personnes qui écrivent un client ou configurent un proxy.

| Point de terminaison                          | Méthode | Description                                                              |
| --------------------------------------------- | ------- | ------------------------------------------------------------------------ |
| `/mcp/.well-known/oauth-protected-resource`   | GET     | Métadonnées de la ressource protégée (RFC 9728). Également disponibles à l'adresse `/.well-known/oauth-protected-resource/mcp` |
| `/.well-known/oauth-authorization-server/mcp` | GET     | Métadonnées du serveur d'autorisation (RFC 8414). Également disponibles à l'adresse `/mcp/.well-known/oauth-authorization-server` |
| `/mcp/oauth/authorize`                        | GET     | Point de terminaison d'autorisation : là où le client envoie votre navigateur pour que vous vous connectiez |
| `/mcp/oauth/token`                            | POST    | Point de terminaison de jetons : échange un code d'autorisation ou un jeton de rafraîchissement |
| `/mcp/oauth/register`                         | POST    | Dynamic Client Registration (RFC 7591)                                   |
| `/mcp/oauth/revoke`                           | POST    | Révocation de jeton (RFC 7009)                                           |

## Authentification

Le serveur MCP prend en charge trois modes de fonctionnement :

### Outils publics (sans authentification requise)

Vous pouvez vous connecter au serveur MCP sans clé API pour accéder aux outils publics :

- **`oneuptime_help`** : Obtenir de l'aide et des conseils sur les capacités MCP de OneUptime
- **`oneuptime_list_resources`** : Lister les ressources disponibles et leurs opérations
- **`get_public_status_page_overview`** : Obtenir un aperçu d'une page de statut publique
- **`get_public_status_page_incidents`** : Obtenir les incidents d'une page de statut publique
- **`get_public_status_page_scheduled_maintenance`** : Obtenir les événements de maintenance programmée
- **`get_public_status_page_announcements`** : Obtenir les annonces d'une page de statut publique

Les outils de page de statut publique acceptent soit un identifiant de page de statut (UUID) soit le nom de domaine de la page de statut.

### Connexion avec votre compte (OAuth 2.1)

Pour toutes les autres opérations (gestion des moniteurs, incidents, équipes, etc.), l'appelant doit être identifié. Un client qui n'envoie aucune information d'identification et appelle l'un de ces outils reçoit en réponse `401 Unauthorized` et un en-tête `WWW-Authenticate` qui pointe vers les métadonnées de la ressource protégée du serveur. C'est le signal sur lequel un client MCP s'appuie pour vous connecter ; `initialize`, `tools/list` et les outils publics ne vous demandent jamais de vous connecter.

Le serveur implémente la [spécification d'autorisation MCP](https://modelcontextprotocol.io/specification/latest/basic/authorization) :

- **Flux** : code d'autorisation OAuth 2.1 avec PKCE (`S256` uniquement). Les jetons d'accès sont envoyés sous la forme `Authorization: Bearer`.
- **Découverte** : métadonnées de la ressource protégée (RFC 9728) et métadonnées du serveur d'autorisation (RFC 8414). L'émetteur et la ressource sont tous deux `https://<host>/mcp`.
- **Identité du client** : un Client ID Metadata Document (l'identifiant du client est une URL `https` que le serveur récupère), ou Dynamic Client Registration (RFC 7591). Aucun client n'a besoin d'être enregistré par un administrateur.
- **Portées** : `mcp:read` pour les outils `get_`, `list_` et `count_` ; `mcp:write` ajoute tous les outils qui modifient quelque chose, et inclut `mcp:read`. Un jeton en lecture seule qui appelle un outil d'écriture reçoit en réponse `403` et `error="insufficient_scope"`.
- **Durée de vie des jetons** : un jeton d'accès dure une heure. Un jeton de rafraîchissement dure 30 jours et est remplacé à chaque utilisation ; l'utilisation d'un jeton de rafraîchissement déjà remplacé met fin à la connexion.
- **Indicateurs de ressource** (RFC 8707) : un jeton est émis pour `https://<host>/mcp` et n'est accepté nulle part ailleurs.
- **Révocation** (RFC 7009) : la révocation de l'un ou l'autre jeton met fin à la connexion.

### Clé API

Un agent qui s'exécute sans surveillance s'authentifie avec une clé API OneUptime dans l'un des en-têtes suivants :

- `x-api-key` : Votre clé API OneUptime
- `Authorization` : Jeton Bearer avec votre clé API (par ex., `Bearer your-api-key-here`)

Le schéma `Bearer` est insensible à la casse. Une requête qui porte une clé API n'est jamais invitée à se connecter.

Les erreurs d'outils sont renvoyées comme des résultats d'outils intégrés (`isError: true`) avec un `statusCode`, des détails et une suggestion — et non comme des erreurs du protocole MCP — afin que les agents puissent lire l'échec et se corriger d'eux-mêmes.

## Outils de flux de travail

Au-delà des outils CRUD par ressource, le serveur fournit des outils de flux de travail conçus spécifiquement pour la réponse aux incidents et aux alertes :

- **`acknowledge_incident`** / **`resolve_incident`** : Faire passer un incident à l'état Pris en charge ou Résolu du projet — équivalent à appuyer sur le bouton dans le tableau de bord
- **`acknowledge_alert`** / **`resolve_alert`** : La même chose pour les alertes
- **`add_incident_note`** : Ajouter une note à un incident avec `visibility: "internal"` (équipe uniquement, valeur par défaut) ou `visibility: "public"` (publiée sur la page de statut). Le Markdown est pris en charge
- **`add_alert_note`** : Ajouter une note interne à une alerte

Une boucle typique : `list_incidents` → `acknowledge_incident` → enquêter avec `list_logs` → `add_incident_note` (publique) → `resolve_incident`.

## Qui suis-je

L'outil **`oneuptime_whoami`** renvoie le projet (identifiant et nom) auquel appartiennent vos informations d'identification. Pour un client connecté avec un compte, il renvoie aussi l'identité sous laquelle il est connecté et indique s'il peut effectuer des modifications. C'est un premier appel utile pour qu'un agent s'oriente — et comme les outils de création déduisent le `projectId` des informations d'identification, l'agent n'a jamais besoin de transmettre un identifiant de projet.

## Interrogation de la télémétrie

Les journaux, les métriques, les traces (spans), les exceptions et les journaux de moniteurs sont exposés sous forme d'outils `list_` et `count_` en lecture seule (`list_logs`, `list_metrics`, `list_spans`, `list_exception_instances`, `list_monitor_logs`, et leurs équivalents `count_`). La télémétrie est ingérée via OpenTelemetry, il n'existe donc pas d'outils de création.

Interrogez toujours la télémétrie avec un filtre de plage temporelle. Les champs de requête acceptent soit une valeur directe, soit un objet opérateur :

```json
{
  "query": {
    "time": { "_type": "GreaterThan", "value": "2026-07-04T00:00:00.000Z" }
  },
  "sort": { "time": "DESC" },
  "limit": 50
}
```

Opérateurs pris en charge : `EqualTo`, `NotEqual`, `IsNull`, `NotNull`, `EqualToOrNull`, `GreaterThan`, `LessThan`, `GreaterThanOrEqual`, `LessThanOrEqual`, `InBetween`, `Search`, `Includes`. Les valeurs de tri sont `"ASC"` ou `"DESC"`.

## Sélection de champs et pagination

Les outils `get_` et `list_` acceptent un tableau `select` optionnel de noms de champs. Par défaut, tous les champs lisibles sont renvoyés à l'exception des champs lourds (colonnes JSON, texte très long et HTML), qui doivent être demandés explicitement dans `select`.

Les outils de liste paginent avec `limit` (10 par défaut, 100 au maximum) et `skip`, et chaque réponse de liste indique exactement ce qu'elle a renvoyé :

```json
{
  "returnedCount": 10,
  "totalCount": 42,
  "skip": 0,
  "limit": 10,
  "hasMore": true,
  "data": ["..."]
}
```

## Vérification

Vérifiez que le serveur MCP est en cours d'exécution :

```bash
# For OneUptime Cloud
curl https://oneuptime.com/mcp/health

# For Self-Hosted
curl https://your-oneuptime-domain.com/mcp/health
```

Listez les outils disponibles :

```bash
# For OneUptime Cloud
curl https://oneuptime.com/mcp/tools

# For Self-Hosted
curl https://your-oneuptime-domain.com/mcp/tools
```

## Exemples d'utilisation

### Requêtes d'informations de base

```
"What's the current status of all my monitors?"
"Show me incidents from the last 24 hours"
```

### Gestion des moniteurs

```
"Create a new website monitor for https://example.com that checks every 5 minutes"
"Set up an API monitor for https://api.example.com/health with a 30-second timeout"
"Change the monitoring interval for my website monitor to every 2 minutes"
"Disable the monitor for staging.example.com while we're doing maintenance"
```

### Gestion des incidents

```
"Create a high-priority incident for the database outage affecting user authentication"
"Add a note to incident #123 saying 'Database connection restored, monitoring for stability'"
"Mark incident #456 as resolved"
"Assign the current payment gateway incident to the infrastructure team"
```

### Équipes et astreinte

```
"List the teams in this project"
"Show me our on-call policies"
```

### Gestion des pages de statut

```
"Update our status page to show 'Investigating Payment Issues' for the payment service"
"Create a status page announcement about scheduled maintenance this weekend"
```

### Requêtes de pages de statut publiques (sans clé API)

Ces requêtes fonctionnent sans authentification, en utilisant uniquement les outils publics de la page de statut :

```
"What's the current status of status.example.com?"
"Show me recent incidents from the OneUptime status page"
"Are there any scheduled maintenance events on status.acme.com?"
"Get the latest announcements from my public status page with ID abc123-..."
```

### Opérations avancées

```
"Create a scheduled maintenance window for Saturday 2-4 AM, disable all monitors for api.example.com during that time, and update the status page"
"Show me all monitors that have been down in the last hour, create incidents for any that don't already have one"
```

## Permissions de la clé API

### Accès en lecture seule

Pour consulter uniquement les données, ajoutez des permissions de lecture à votre clé API.

### Accès complet

Pour un accès complet à la création, la mise à jour et la suppression de ressources, assurez-vous que votre clé API dispose des permissions d'administrateur de projet.

### Bonnes pratiques

- Utilisez des permissions spécifiques : N'accordez que les permissions minimales nécessaires
- Faites pivoter les clés API : Renouvelez régulièrement vos clés API
- Surveillez l'utilisation : Suivez l'utilisation des clés API dans OneUptime
- Clés séparées : Utilisez des clés API différentes pour les différents environnements

## Configuration pour OneUptime auto-hébergé

La connexion avec un compte fonctionne sans configuration supplémentaire sur une instance auto-hébergée. Deux paramètres sont disponibles :

| Variable d'environnement | Valeur Helm | Effet |
| --- | --- | --- |
| `DISABLE_MCP_OAUTH` | `mcpOAuth.disabled` | Définissez-la sur `true` pour désactiver la connexion avec un compte. Les points de terminaison OAuth ne sont plus servis et le serveur MCP n'accepte que les clés API. Rien n'est supprimé ; les clients connectés fonctionnent de nouveau lorsque la connexion avec un compte est réactivée. |
| `DISABLE_MCP_OAUTH_CLIENT_ID_METADATA_DOCUMENTS` | `mcpOAuth.disableClientIdMetadataDocuments` | Définissez-la sur `true` sur une instance qui ne peut pas accéder à Internet. Un client peut s'identifier avec une URL que OneUptime récupère ; avec ce paramètre, les clients s'enregistrent à la place directement auprès de votre instance, ce qui ne nécessite aucune requête sortante. |

Si vous exploitez votre propre proxy inverse devant OneUptime, transmettez `/.well-known/oauth-protected-resource` et `/.well-known/oauth-authorization-server` (et tout ce qui se trouve en dessous) à OneUptime, en plus de `/mcp`. L'ingress fourni le fait déjà.

Le serveur construit chaque URL OAuth à partir des paramètres `HOST` et `HTTP_PROTOCOL` ; ils doivent donc correspondre à l'adresse que les utilisateurs emploient pour accéder à votre instance.

## Dépannage

### Problèmes de connexion avec votre compte

- **Le client ne me demande jamais de me connecter** : le client ne prend peut-être pas en charge l'autorisation MCP, ou il est peut-être configuré avec un en-tête de clé API, qui est prioritaire. Supprimez l'en-tête pour vous connecter avec votre compte à la place.
- **Mon projet est grisé sur la page d'autorisation** : la page indique pourquoi à côté du nom du projet — le forfait du projet n'inclut pas la connexion de clients MCP, le projet exige le SSO et ce navigateur ne s'y est pas connecté avec le SSO, ou la connexion de clients est bloquée pour votre équipe.
- **Un outil est refusé avec « read-only »** : le client a été autorisé en lecture seule. Connectez-le de nouveau et choisissez **Lecture et écriture**.
- **Le client a cessé de fonctionner** : il a été déconnecté, n'a pas été utilisé pendant 30 jours, vous avez été retiré du projet, ou la session SSO du projet a expiré. Connectez-le de nouveau.
- **Auto-hébergé — le client signale qu'il ne trouve pas le serveur d'autorisation** : vérifiez que `HOST` et `HTTP_PROTOCOL` correspondent à votre adresse publique, et que votre proxy transmet les chemins `/.well-known/oauth-*`.

### Erreurs de permission

Assurez-vous que votre clé API — ou, pour un client connecté avec un compte, votre propre compte — dispose des permissions nécessaires :

- Accès en lecture pour lister les ressources
- Accès en écriture pour créer/mettre à jour les ressources
- Accès en suppression si vous souhaitez supprimer des ressources

### Problèmes de connexion

1. Vérifiez que l'URL de votre OneUptime est correcte
2. Vérifiez que votre clé API est valide
3. Assurez-vous que votre instance OneUptime est accessible
4. Testez le point de terminaison de vérification d'état

### Clé API invalide

- Vérifiez la clé API dans vos paramètres OneUptime
- Recherchez des espaces ou caractères supplémentaires
- Assurez-vous que la clé n'a pas expiré

### Erreurs de session

Si vous recevez des erreurs liées aux sessions :

- Le serveur MCP est sans état — il n'émet ni ne suit d'identifiants de session, chaque requête fonctionne donc avec n'importe quelle réplique du serveur
- Les clients qui envoient un en-tête `mcp-session-id` provenant d'une version antérieure du serveur peuvent simplement l'omettre ; il est ignoré
- Mettez à jour les configurations de clients MCP plus anciennes qui s'attendent à ce que le serveur renvoie un identifiant de session

## Ressources disponibles

Le serveur MCP fournit des outils pour les ressources suivantes :

**Surveillance** : Monitor, Monitor Status, Monitor Status Event
**Incidents** : Incident, Incident State, Incident Severity, Incident State Timeline, Incident Public Note, Incident Internal Note
**Alertes** : Alert, Alert State, Alert Severity, Alert State Timeline, Alert Internal Note
**Pages de statut** : Status Page, Status Page Announcement
**Maintenance planifiée** : Scheduled Maintenance Event, Scheduled Maintenance State, Scheduled Maintenance State Timeline
**Équipes et astreinte** : Team, On-Call Policy
**Étiquettes** : Label
**Télémétrie (lecture seule)** : Log, Metric, Span, Exception Instance, Monitor Log

Chaque ressource de base de données prend en charge les opérations Create, Get, List, Update, Delete et Count via des outils en snake_case — par exemple `create_incident`, `get_incident`, `list_incidents`, `update_incident`, `delete_incident`, `count_incidents`. Les ressources de télémétrie exposent uniquement des outils `list_` et `count_` (par exemple `list_logs`, `count_spans`).
