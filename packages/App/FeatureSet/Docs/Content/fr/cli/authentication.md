# Authentification

Le CLI OneUptime prend en charge plusieurs méthodes d'authentification auprès de votre instance OneUptime. Vous pouvez utiliser des contextes nommés, des variables d'environnement ou passer les identifiants directement en tant qu'indicateurs.

## Connexion

Authentifiez-vous auprès de votre instance OneUptime en utilisant une clé API :

```bash
oneuptime login <api-key> <instance-url>
```

**Arguments :**

| Argument         | Description                                                          |
| ---------------- | -------------------------------------------------------------------- |
| `<api-key>`      | Votre clé API OneUptime (par ex., `sk-your-api-key`)                 |
| `<instance-url>` | L'URL de votre instance OneUptime (par ex., `https://oneuptime.com`) |

**Options :**

| Option                  | Description                                   |
| ----------------------- | --------------------------------------------- |
| `--context-name <name>` | Nom de ce contexte (par défaut : `"default"`) |

**Exemples :**

```bash
# Connexion avec le contexte par défaut
oneuptime login sk-abc123 https://oneuptime.com

# Connexion avec un contexte nommé
oneuptime login sk-abc123 https://oneuptime.com --context-name production

# Configuration de plusieurs environnements
oneuptime login sk-prod-key https://oneuptime.com --context-name production
oneuptime login sk-staging-key https://staging.oneuptime.com --context-name staging
```

## Contextes

Les contextes vous permettent de sauvegarder et de basculer entre plusieurs environnements OneUptime (par ex., production, staging, développement).

### Lister les contextes

```bash
oneuptime context list
```

Affiche tous les contextes configurés. Le contexte actuel est marqué par `*`.

### Changer de contexte

```bash
oneuptime context use <name>
```

Basculez vers un contexte nommé différent pour toutes les commandes suivantes.

```bash
# Basculer vers staging
oneuptime context use staging

# Basculer vers production
oneuptime context use production
```

### Afficher le contexte actuel

```bash
oneuptime context current
```

Affiche le contexte actuellement actif, y compris l'URL de l'instance et une clé API masquée.

### Supprimer un contexte

```bash
oneuptime context delete <name>
```

Supprime un contexte nommé. Si le contexte supprimé est le contexte actuel, le CLI bascule automatiquement vers le premier contexte restant.

## Résolution des identifiants

Les identifiants sont résolus dans l'ordre de priorité suivant :

1. **Indicateurs CLI** (`--api-key` et `--url`)
2. **Variables d'environnement** (`ONEUPTIME_API_KEY` et `ONEUPTIME_URL`)
3. **Contexte nommé** (via l'indicateur `--context`)
4. **Contexte actuel** (depuis la configuration sauvegardée)

Vous pouvez combiner les sources — par exemple, utiliser une variable d'environnement pour la clé API et un contexte sauvegardé pour l'URL.

### Utilisation des indicateurs CLI

```bash
oneuptime --api-key sk-abc123 --url https://oneuptime.com incident list
```

### Utilisation des variables d'environnement

```bash
export ONEUPTIME_API_KEY=sk-abc123
export ONEUPTIME_URL=https://oneuptime.com

oneuptime incident list
```

### Utilisation d'un contexte spécifique

```bash
oneuptime --context production incident list
```

## Vérification de l'authentification

Vérifiez votre état d'authentification actuel :

```bash
oneuptime whoami
```

Cela affiche :

- L'URL de l'instance
- La clé API masquée
- Le nom du contexte actuel (affiché uniquement si un contexte sauvegardé est actif)

Si vous n'êtes pas authentifié, la commande affiche un message utile suggérant d'exécuter `oneuptime login`.

## Fichier de configuration

Les identifiants sont stockés dans `~/.oneuptime/config.json` avec des permissions restreintes (`0600`).

```json
{
  "currentContext": "production",
  "contexts": {
    "production": {
      "name": "production",
      "apiUrl": "https://oneuptime.com",
      "apiKey": "sk-..."
    },
    "staging": {
      "name": "staging",
      "apiUrl": "https://staging.oneuptime.com",
      "apiKey": "sk-..."
    }
  },
  "defaults": {
    "output": "table",
    "limit": 10
  }
}
```
