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
- **Authentification sécurisée** : Authentification par clé API à chaque requête avec gestion appropriée des erreurs
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
- **Maintenance programmée** : Créer et gérer des événements de maintenance programmée
- **Télémétrie** : Interroger les journaux, les métriques, les traces, les exceptions et les journaux de moniteurs (lecture seule)

## Prérequis

- Instance OneUptime (cloud ou auto-hébergée)
- Client compatible MCP (Claude Desktop, VS Code avec GitHub Copilot, etc.)
- Clé API OneUptime valide (uniquement requise pour les opérations authentifiées — les outils publics fonctionnent sans elle)

## Obtention de votre clé API

1. Connectez-vous à votre instance OneUptime
2. Accédez à **Paramètres** → **Clés API**
3. Cliquez sur **Créer une clé API**
4. Donnez-lui un nom (par ex., « Serveur MCP »)
5. Sélectionnez les permissions appropriées pour votre cas d'utilisation
6. Copiez la clé API générée

Les clés API sont limitées à un projet : le serveur MCP déduit votre projet à partir de la clé, si bien que les outils de création n'ont jamais besoin d'un argument `projectId`.

> **Avertissement — ne donnez jamais une clé maîtresse à un agent IA.** Une clé API *maîtresse* OneUptime est également acceptée sur cet en-tête et accorde un accès administrateur à l'ensemble de l'instance. Utilisez toujours une clé API de projet avec le privilège minimal dont l'agent a besoin (une clé en lecture seule suffit pour tous les outils `get_`/`list_`/`count_`).

## Configuration

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

## Authentification

Le serveur MCP prend en charge deux modes de fonctionnement :

### Outils publics (sans authentification requise)

Vous pouvez vous connecter au serveur MCP sans clé API pour accéder aux outils publics :

- **`oneuptime_help`** : Obtenir de l'aide et des conseils sur les capacités MCP de OneUptime
- **`oneuptime_list_resources`** : Lister les ressources disponibles et leurs opérations
- **`get_public_status_page_overview`** : Obtenir un aperçu d'une page de statut publique
- **`get_public_status_page_incidents`** : Obtenir les incidents d'une page de statut publique
- **`get_public_status_page_scheduled_maintenance`** : Obtenir les événements de maintenance programmée
- **`get_public_status_page_announcements`** : Obtenir les annonces d'une page de statut publique

Les outils de page de statut publique acceptent soit un identifiant de page de statut (UUID) soit le nom de domaine de la page de statut.

### Outils authentifiés (clé API requise)

Pour toutes les autres opérations (gestion des moniteurs, incidents, équipes, etc.), l'authentification est requise via l'un des en-têtes suivants :

- `x-api-key` : Votre clé API OneUptime
- `Authorization` : Jeton Bearer avec votre clé API (par ex., `Bearer your-api-key-here`)

Le schéma `Bearer` est insensible à la casse. Les erreurs d'outils sont renvoyées comme des résultats d'outils intégrés (`isError: true`) avec un `statusCode`, des détails et une suggestion — et non comme des erreurs du protocole MCP — afin que les agents puissent lire l'échec et se corriger d'eux-mêmes.

## Outils de flux de travail

Au-delà des outils CRUD par ressource, le serveur fournit des outils de flux de travail conçus spécifiquement pour la réponse aux incidents et aux alertes :

- **`acknowledge_incident`** / **`resolve_incident`** : Faire passer un incident à l'état Pris en charge ou Résolu du projet — équivalent à appuyer sur le bouton dans le tableau de bord
- **`acknowledge_alert`** / **`resolve_alert`** : La même chose pour les alertes
- **`add_incident_note`** : Ajouter une note à un incident avec `visibility: "internal"` (équipe uniquement, valeur par défaut) ou `visibility: "public"` (publiée sur la page de statut). Le Markdown est pris en charge
- **`add_alert_note`** : Ajouter une note interne à une alerte

Une boucle typique : `list_incidents` → `acknowledge_incident` → enquêter avec `list_logs` → `add_incident_note` (publique) → `resolve_incident`.

## Qui suis-je

L'outil **`oneuptime_whoami`** renvoie le projet auquel appartient votre clé API (identifiant et nom). C'est un premier appel utile pour qu'un agent s'oriente — et comme les outils de création déduisent le `projectId` de la clé API, l'agent n'a jamais besoin de transmettre un identifiant de projet.

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

## Dépannage

### Erreurs de permission

Assurez-vous que votre clé API dispose des permissions nécessaires :

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
**Maintenance programmée** : Scheduled Maintenance Event, Scheduled Maintenance State, Scheduled Maintenance State Timeline
**Équipes et astreinte** : Team, On-Call Policy
**Étiquettes** : Label
**Télémétrie (lecture seule)** : Log, Metric, Span, Exception Instance, Monitor Log

Chaque ressource de base de données prend en charge les opérations Create, Get, List, Update, Delete et Count via des outils en snake_case — par exemple `create_incident`, `get_incident`, `list_incidents`, `update_incident`, `delete_incident`, `count_incidents`. Les ressources de télémétrie exposent uniquement des outils `list_` et `count_` (par exemple `list_logs`, `count_spans`).
