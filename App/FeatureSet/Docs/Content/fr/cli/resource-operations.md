# Opérations sur les ressources

Le CLI OneUptime fournit des opérations CRUD complètes (Créer, Lire, Mettre à jour, Supprimer) pour toutes les ressources prises en charge. Les ressources sont découvertes automatiquement depuis votre instance OneUptime.

## Ressources disponibles

Exécutez la commande suivante pour voir tous les types de ressources disponibles :

```bash
oneuptime resources
```

Vous pouvez filtrer par type :

```bash
# Afficher uniquement les ressources de base de données
oneuptime resources --type database

# Afficher uniquement les ressources analytiques
oneuptime resources --type analytics
```

Les ressources courantes comprennent :

| Ressource | Commande |
|-----------|---------|
| Incident | `oneuptime incident` |
| Alerte | `oneuptime alert` |
| Moniteur | `oneuptime monitor` |
| Statut de moniteur | `oneuptime monitor-status` |
| État d'incident | `oneuptime incident-state` |
| Page de statut | `oneuptime status-page` |
| Politique d'astreinte | `oneuptime on-call-policy` |
| Équipe | `oneuptime team` |
| Événement de maintenance programmée | `oneuptime scheduled-maintenance-event` |

## Lister les ressources

Récupérer une liste de ressources avec filtrage, pagination et tri optionnels.

```bash
oneuptime <resource> list [options]
```

**Options :**

| Option | Description | Défaut |
|--------|-------------|--------|
| `--query <json>` | Critères de filtre au format JSON | Aucun |
| `--limit <n>` | Nombre maximum de résultats | `10` |
| `--skip <n>` | Nombre de résultats à ignorer | `0` |
| `--sort <json>` | Ordre de tri au format JSON | Aucun |
| `-o, --output <format>` | Format de sortie | `table` |

**Exemples :**

```bash
# Lister les 10 incidents les plus récents
oneuptime incident list

# Filtrer les incidents par identifiant d'état
oneuptime incident list --query '{"currentIncidentStateId":"<state-id>"}'

# Lister avec pagination
oneuptime incident list --limit 20 --skip 40

# Trier par date de création (décroissant)
oneuptime incident list --sort '{"createdAt":-1}'

# Sortir au format JSON
oneuptime incident list -o json
```

## Obtenir une ressource

Récupérer une seule ressource par son identifiant.

```bash
oneuptime <resource> get <id>
```

**Arguments :**

| Argument | Description |
|----------|-------------|
| `<id>` | L'identifiant de la ressource (UUID) |

**Exemples :**

```bash
# Obtenir un incident spécifique
oneuptime incident get 550e8400-e29b-41d4-a716-446655440000

# Obtenir un moniteur au format JSON
oneuptime monitor get abc-123 -o json
```

## Créer une ressource

Créer une nouvelle ressource à partir d'un JSON en ligne ou d'un fichier.

```bash
oneuptime <resource> create [options]
```

**Options :**

| Option | Description |
|--------|-------------|
| `--data <json>` | Données de la ressource sous forme d'objet JSON |
| `--file <path>` | Chemin vers un fichier JSON contenant les données de la ressource |
| `-o, --output <format>` | Format de sortie |

Vous devez fournir soit `--data` soit `--file`.

**Exemples :**

```bash
# Créer un incident avec du JSON en ligne
oneuptime incident create --data '{"title":"API Outage","currentIncidentStateId":"<state-id>","incidentSeverityId":"<severity-id>","declaredAt":"2025-01-15T10:30:00Z"}'

# Créer depuis un fichier JSON
oneuptime incident create --file incident.json

# Créer et sortir au format JSON pour capturer l'identifiant
oneuptime monitor create --data '{"name":"API Health Check"}' -o json
```

## Mettre à jour une ressource

Mettre à jour une ressource existante par identifiant.

```bash
oneuptime <resource> update <id> [options]
```

**Arguments :**

| Argument | Description |
|----------|-------------|
| `<id>` | L'identifiant de la ressource |

**Options :**

| Option | Description |
|--------|-------------|
| `--data <json>` | Champs à mettre à jour au format JSON (requis) |
| `-o, --output <format>` | Format de sortie |

**Exemples :**

```bash
# Modifier l'état d'un incident (par ex., vers résolu)
oneuptime incident update abc-123 --data '{"currentIncidentStateId":"<resolved-state-id>"}'

# Renommer un moniteur
oneuptime monitor update abc-123 --data '{"name":"Updated Monitor Name"}'
```

## Supprimer une ressource

Supprimer une ressource par identifiant.

```bash
oneuptime <resource> delete <id> [--force]
```

**Arguments :**

| Argument | Description |
|----------|-------------|
| `<id>` | L'identifiant de la ressource |

**Options :**

| Option | Description |
|--------|-------------|
| `--force` | Ignorer la demande de confirmation |

**Exemples :**

```bash
oneuptime incident delete abc-123
oneuptime monitor delete 550e8400-e29b-41d4-a716-446655440000

# Ignorer la confirmation
oneuptime monitor delete 550e8400-e29b-41d4-a716-446655440000 --force
```

## Compter les ressources

Compter les ressources correspondant à des critères de filtre optionnels.

```bash
oneuptime <resource> count [options]
```

**Options :**

| Option | Description |
|--------|-------------|
| `--query <json>` | Critères de filtre au format JSON |

**Exemples :**

```bash
# Compter tous les incidents
oneuptime incident count

# Compter les incidents par état
oneuptime incident count --query '{"currentIncidentStateId":"<state-id>"}'

# Compter les moniteurs
oneuptime monitor count
```

## Ressources analytiques

Les ressources analytiques prennent en charge un ensemble limité d'opérations par rapport aux ressources de base de données :

| Opération | Prise en charge |
|-----------|----------------|
| `list` | Oui |
| `create` | Oui |
| `count` | Oui |
| `get` | Non |
| `update` | Non |
| `delete` | Non |

Utilisez `oneuptime resources --type analytics` pour voir les ressources analytiques disponibles sur votre instance.
