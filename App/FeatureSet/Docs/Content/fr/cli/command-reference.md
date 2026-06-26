# Référence des commandes

Référence complète de toutes les commandes du CLI OneUptime.

## Commandes d'authentification

### `oneuptime login`

S'authentifier auprès d'une instance OneUptime.

```bash
oneuptime login <api-key> <instance-url> [--context-name <name>]
```

| Paramètre        | Type     | Requis | Description                                |
| ---------------- | -------- | ------ | ------------------------------------------ |
| `<api-key>`      | argument | Oui    | Clé API pour l'authentification            |
| `<instance-url>` | argument | Oui    | URL de l'instance OneUptime                |
| `--context-name` | option   | Non    | Nom du contexte (par défaut : `"default"`) |

---

### `oneuptime context list`

Lister tous les contextes sauvegardés.

```bash
oneuptime context list
```

---

### `oneuptime context use`

Basculer vers un contexte nommé.

```bash
oneuptime context use <name>
```

| Paramètre | Type     | Requis | Description               |
| --------- | -------- | ------ | ------------------------- |
| `<name>`  | argument | Oui    | Nom du contexte à activer |

---

### `oneuptime context current`

Afficher le contexte actif avec la clé API masquée.

```bash
oneuptime context current
```

---

### `oneuptime context delete`

Supprimer un contexte sauvegardé.

```bash
oneuptime context delete <name>
```

| Paramètre | Type     | Requis | Description                 |
| --------- | -------- | ------ | --------------------------- |
| `<name>`  | argument | Oui    | Nom du contexte à supprimer |

---

## Commandes de ressources

Toutes les commandes de ressources suivent le même schéma. Remplacez `<resource>` par n'importe quel nom de ressource pris en charge (par ex., `incident`, `monitor`, `alert`, `status-page`).

### `oneuptime <resource> list`

Lister les ressources avec filtrage et pagination.

```bash
oneuptime <resource> list [options]
```

| Option           | Type   | Défaut  | Description                       |
| ---------------- | ------ | ------- | --------------------------------- |
| `--query <json>` | chaîne | Aucun   | Critères de filtre au format JSON |
| `--limit <n>`    | nombre | `10`    | Nombre maximum de résultats       |
| `--skip <n>`     | nombre | `0`     | Résultats à ignorer               |
| `--sort <json>`  | chaîne | Aucun   | Ordre de tri au format JSON       |
| `-o, --output`   | chaîne | `table` | Format de sortie                  |

---

### `oneuptime <resource> get`

Obtenir une seule ressource par identifiant.

```bash
oneuptime <resource> get <id> [-o <format>]
```

| Paramètre      | Type     | Requis | Description                        |
| -------------- | -------- | ------ | ---------------------------------- |
| `<id>`         | argument | Oui    | Identifiant de la ressource (UUID) |
| `-o, --output` | option   | Non    | Format de sortie                   |

---

### `oneuptime <resource> create`

Créer une nouvelle ressource.

```bash
oneuptime <resource> create [--data <json> | --file <path>] [-o <format>]
```

| Option          | Type   | Requis                       | Description                            |
| --------------- | ------ | ---------------------------- | -------------------------------------- |
| `--data <json>` | chaîne | L'un de `--data` ou `--file` | Données de la ressource au format JSON |
| `--file <path>` | chaîne | L'un de `--data` ou `--file` | Chemin vers le fichier JSON            |
| `-o, --output`  | chaîne | Non                          | Format de sortie                       |

---

### `oneuptime <resource> update`

Mettre à jour une ressource existante.

```bash
oneuptime <resource> update <id> --data <json> [-o <format>]
```

| Paramètre       | Type     | Requis | Description                           |
| --------------- | -------- | ------ | ------------------------------------- |
| `<id>`          | argument | Oui    | Identifiant de la ressource           |
| `--data <json>` | option   | Oui    | Champs à mettre à jour au format JSON |
| `-o, --output`  | option   | Non    | Format de sortie                      |

---

### `oneuptime <resource> delete`

Supprimer une ressource.

```bash
oneuptime <resource> delete <id> [--force]
```

| Paramètre | Type     | Requis | Description                        |
| --------- | -------- | ------ | ---------------------------------- |
| `<id>`    | argument | Oui    | Identifiant de la ressource        |
| `--force` | option   | Non    | Ignorer la demande de confirmation |

---

### `oneuptime <resource> count`

Compter les ressources correspondant à un filtre.

```bash
oneuptime <resource> count [--query <json>]
```

| Option           | Type   | Défaut | Description                       |
| ---------------- | ------ | ------ | --------------------------------- |
| `--query <json>` | chaîne | Aucun  | Critères de filtre au format JSON |

---

## Commandes utilitaires

### `oneuptime version`

Afficher la version du CLI.

```bash
oneuptime version
```

---

### `oneuptime whoami`

Afficher les détails d'authentification actuels.

```bash
oneuptime whoami
```

Affiche l'URL de l'instance et la clé API masquée. Si un contexte sauvegardé est actif, le nom du contexte est également affiché.

---

### `oneuptime resources`

Lister tous les types de ressources disponibles.

```bash
oneuptime resources [--type <type>]
```

| Option          | Type   | Défaut | Description                           |
| --------------- | ------ | ------ | ------------------------------------- |
| `--type <type>` | chaîne | Aucun  | Filtrer par `database` ou `analytics` |

---

## Options globales

Ces indicateurs sont disponibles sur toutes les commandes :

| Option                  | Description                                |
| ----------------------- | ------------------------------------------ |
| `--api-key <key>`       | Remplacer la clé API                       |
| `--url <url>`           | Remplacer l'URL de l'instance              |
| `--context <name>`      | Utiliser un contexte spécifique            |
| `-o, --output <format>` | Format de sortie : `json`, `table`, `wide` |
| `--no-color`            | Désactiver la sortie colorée               |
| `--help`                | Afficher l'aide                            |
| `--version`             | Afficher la version                        |

## Routes API

Pour référence, le CLI associe les commandes à ces points de terminaison API :

| Commande | Méthode | Point de terminaison            |
| -------- | ------- | ------------------------------- |
| `list`   | POST    | `/api/<resource>/get-list`      |
| `get`    | POST    | `/api/<resource>/<id>/get-item` |
| `create` | POST    | `/api/<resource>`               |
| `update` | PUT     | `/api/<resource>/<id>/`         |
| `delete` | DELETE  | `/api/<resource>/<id>/`         |
| `count`  | POST    | `/api/<resource>/count`         |

Toutes les requêtes incluent l'en-tête `APIKey` pour l'authentification.
