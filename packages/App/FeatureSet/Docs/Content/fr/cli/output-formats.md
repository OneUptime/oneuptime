# Formats de sortie

Le CLI OneUptime prend en charge trois formats de sortie : **table**, **JSON** et **étendu**. Vous pouvez définir le format avec l'indicateur `-o` ou `--output` sur n'importe quelle commande.

## Table (par défaut)

Le format par défaut lors de l'exécution dans un terminal interactif. Affiche les résultats sous forme de tableau ASCII avec des colonnes sélectionnées intelligemment.

```bash
oneuptime incident list
```

```
┌──────────────────┬───────────────────────┬─────────────────────┬─────────────────────┐
│ _id              │ title                 │ createdAt           │ updatedAt           │
├──────────────────┼───────────────────────┼─────────────────────┼─────────────────────┤
│ abc-123          │ API Outage            │ 2025-01-15T10:30:00 │ 2025-01-15T12:00:00 │
│ def-456          │ Database Slowdown     │ 2025-01-14T08:15:00 │ 2025-01-14T09:30:00 │
└──────────────────┴───────────────────────┴─────────────────────┴─────────────────────┘
```

Comportement du format table :

- Sélectionne jusqu'à 6 colonnes, en priorité : `_id`, `name`, `title`, `createdAt`, `updatedAt`
- Tronque les valeurs de plus de 60 caractères avec `...`
- Utilise des en-têtes colorés (désactivez avec `--no-color`)

## JSON

Sortie JSON brute, formatée avec une indentation de 2 espaces. C'est le meilleur format pour les scripts et la redirection vers d'autres outils.

```bash
oneuptime incident list -o json
```

```json
[
  {
    "_id": "abc-123",
    "title": "API Outage",
    "currentIncidentStateId": "550e8400-e29b-41d4-a716-446655440000",
    "createdAt": "2025-01-15T10:30:00Z"
  }
]
```

Le format JSON est automatiquement utilisé lorsque la sortie est redirigée vers une autre commande (mode non-TTY) :

```bash
# JSON est utilisé automatiquement lors de la redirection
oneuptime incident list | jq '.[].title'
```

## Étendu

Affiche toutes les colonnes sans troncature. Utile pour une inspection détaillée, mais peut produire une sortie très large.

```bash
oneuptime incident list -o wide
```

## Désactivation des couleurs

La sortie colorée peut être désactivée de plusieurs façons :

```bash
# Utilisation de l'indicateur --no-color
oneuptime --no-color incident list

# Utilisation de la variable d'environnement NO_COLOR
NO_COLOR=1 oneuptime incident list
```

## Cas de sortie spéciaux

| Scénario                      | Sortie                     |
| ----------------------------- | -------------------------- |
| Ensemble de résultats vide    | `"No results found."`      |
| Aucune donnée retournée       | `"No data returned."`      |
| Objet unique (par ex., `get`) | Format de table clé-valeur |
| Commande `count`              | Valeur numérique simple    |
