# Serveur MCP

Le serveur MCP (Model Context Protocol) de OneUptime fournit aux LLM un accès direct à votre instance OneUptime, permettant des opérations de surveillance, de gestion des incidents et d'observabilité alimentées par l'IA.

## Qu'est-ce que le serveur MCP de OneUptime ?

Le serveur MCP de OneUptime est un pont entre les grands modèles de langage (LLM) et votre instance OneUptime. Il implémente le Model Context Protocol (MCP), permettant aux assistants IA comme Claude d'interagir directement avec votre infrastructure de surveillance.

## Fonctionnement

Le serveur MCP est hébergé aux côtés de votre instance OneUptime et accessible via le transport HTTP Streamable. Aucune installation locale n'est requise.

**Utilisateurs Cloud** : `https://oneuptime.com/mcp`
**Utilisateurs auto-hébergés** : `https://your-oneuptime-domain.com/mcp`

## Fonctionnalités clés

- **Couverture API complète** : Accès à 711 points de terminaison API OneUptime
- **126 types de ressources** : Gestion de toutes les ressources OneUptime, y compris les moniteurs, les incidents, les équipes, les sondes, et plus encore
- **Opérations en temps réel** : Création, lecture, mise à jour et suppression de ressources en temps réel
- **Interface typée** : Entièrement typé avec validation complète des entrées
- **Authentification sécurisée** : Authentification par clé API avec gestion appropriée des erreurs
- **Intégration facile** : Fonctionne avec Claude Desktop et d'autres clients compatibles MCP
- **Gestion de session** : Gestion de session intégrée avec prise en charge de la reconnexion automatique

## Ce que vous pouvez faire

Avec le serveur MCP de OneUptime, les assistants IA peuvent vous aider à :

- **Gestion des moniteurs** : Créer et configurer des moniteurs, vérifier leur statut et gérer les groupes de moniteurs
- **Gestion des incidents** : Créer des incidents, ajouter des notes, assigner des membres d'équipe et suivre la résolution
- **Opérations d'équipe** : Gérer les équipes, les permissions et les plannings d'astreinte
- **Pages de statut** : Mettre à jour les pages de statut, créer des annonces et gérer les abonnés
- **Alertes** : Configurer les règles d'alerte, gérer les politiques d'escalade et vérifier les journaux de notification
- **Sondes** : Déployer et gérer les sondes de surveillance dans différents emplacements
- **Rapports et analyses** : Générer des rapports et analyser les données de surveillance

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

| Point de terminaison | Méthode | Description |
|---------------------|---------|-------------|
| `/mcp` | GET | Flux d'événements envoyés par le serveur pour les notifications du serveur vers le client |
| `/mcp` | POST | Requêtes JSON-RPC pour les appels d'outils et autres opérations |
| `/mcp` | DELETE | Nettoyage et fin de session |
| `/mcp/health` | GET | Point de terminaison de vérification de l'état |
| `/mcp/tools` | GET | API REST pour lister les outils disponibles |

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

## Vérification

Vérifiez que le serveur MCP est en cours d'exécution :

```bash
# Pour OneUptime Cloud
curl https://oneuptime.com/mcp/health

# Pour auto-hébergé
curl https://your-oneuptime-domain.com/mcp/health
```

Listez les outils disponibles :

```bash
# Pour OneUptime Cloud
curl https://oneuptime.com/mcp/tools

# Pour auto-hébergé
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
"Who are the members of the infrastructure team?"
"Who's currently on call for the infrastructure team?"
"Show me the on-call schedule for this week"
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
- Le serveur MCP utilise l'en-tête `mcp-session-id` pour suivre les sessions
- Assurez-vous que votre client gère correctement l'identifiant de session retourné par le serveur
- Les sessions sont automatiquement nettoyées lorsque les connexions se ferment

## Ressources disponibles

Le serveur MCP donne accès à 126 types de ressources, notamment :

**Surveillance** : Monitor, MonitorStatus, MonitorGroup, Probe
**Incidents** : Incident, IncidentState, IncidentNote, IncidentTemplate
**Alertes** : Alert, AlertState, AlertSeverity
**Pages de statut** : StatusPage, StatusPageAnnouncement, StatusPageSubscriber
**Astreinte** : On-CallPolicy, EscalationRule, On-CallSchedule
**Équipes** : Team, TeamMember, TeamPermission
**Télémétrie** : TelemetryService, Log, Span, Metric
**Flux de travail** : Workflow, WorkflowVariable, WorkflowLog

Chaque ressource prend en charge les opérations standard : List, Count, Get, Create, Update et Delete.
