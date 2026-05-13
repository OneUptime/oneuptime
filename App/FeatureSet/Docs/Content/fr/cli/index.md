# CLI OneUptime

Le CLI OneUptime est une interface en ligne de commande permettant de gérer vos ressources OneUptime directement depuis le terminal. Il prend en charge les opérations CRUD complètes sur les moniteurs, incidents, alertes, pages de statut, et plus encore.

## Fonctionnalités

- **Prise en charge multi-environnement** avec des contextes nommés pour la production, le staging et le développement
- **Découverte automatique** des ressources disponibles depuis votre instance OneUptime
- **Authentification flexible** via des indicateurs CLI, des variables d'environnement ou des contextes sauvegardés
- **Formatage de sortie intelligent** avec les modes d'affichage JSON, table et étendu
- **Compatible avec les scripts** pour les pipelines CI/CD et les flux d'automatisation

## Installation

```bash
npm install -g @oneuptime/cli
```

## Démarrage rapide

```bash
# S'authentifier auprès de votre instance OneUptime
oneuptime login <your-api-key> https://oneuptime.com

# Lister vos moniteurs
oneuptime monitor list

# Afficher un incident spécifique
oneuptime incident get <incident-id>

# Voir toutes les ressources disponibles
oneuptime resources
```

## Documentation

| Guide | Description |
|-------|-------------|
| [Authentification](./authentication.md) | Connexion, contextes et gestion des identifiants |
| [Opérations sur les ressources](./resource-operations.md) | Opérations CRUD sur les moniteurs, incidents, alertes, et plus |
| [Formats de sortie](./output-formats.md) | Modes de sortie JSON, table et étendu |
| [Scripts et CI/CD](./scripting.md) | Automatisation, variables d'environnement et utilisation dans les pipelines |
| [Référence des commandes](./command-reference.md) | Référence complète de toutes les commandes et options |

## Options globales

Ces indicateurs peuvent être utilisés avec n'importe quelle commande :

| Indicateur | Description |
|------------|-------------|
| `--api-key <key>` | Remplacer la clé API pour cette commande |
| `--url <url>` | Remplacer l'URL de l'instance pour cette commande |
| `--context <name>` | Utiliser un contexte nommé spécifique |
| `-o, --output <format>` | Format de sortie : `json`, `table`, `wide` |
| `--no-color` | Désactiver la sortie colorée |
| `--help` | Afficher l'aide de la commande |
| `--version` | Afficher la version du CLI |

## Obtenir de l'aide

```bash
# Aide générale
oneuptime --help

# Aide pour une commande spécifique
oneuptime monitor --help
oneuptime monitor list --help
```
