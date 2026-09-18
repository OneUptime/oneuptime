# Scripts et CI/CD

Le CLI OneUptime est conçu pour l'automatisation. Il prend en charge l'authentification par variables d'environnement, la sortie JSON pour l'analyse programmatique, et des codes de sortie appropriés pour l'intégration dans les pipelines.

## Variables d'environnement

Définissez ces variables d'environnement pour vous authentifier sans contextes sauvegardés :

```bash
export ONEUPTIME_API_KEY=sk-your-api-key
export ONEUPTIME_URL=https://oneuptime.com
```

Ces variables ont la priorité sur les contextes sauvegardés mais sont remplacées par les indicateurs CLI.

## Codes de sortie

| Code | Signification                                                   |
| ---- | --------------------------------------------------------------- |
| `0`  | Succès                                                          |
| `1`  | Erreur générale                                                 |
| `2`  | Erreur d'authentification (identifiants manquants ou invalides) |
| `3`  | Introuvable (404)                                               |

Utilisez les codes de sortie dans les scripts pour gérer les erreurs :

```bash
if ! oneuptime monitor list > /dev/null 2>&1; then
  echo "Failed to list monitors"
  exit 1
fi
```

## Traitement JSON avec jq

Utilisez `-o json` pour produire une sortie lisible par machine :

```bash
# Extraire tous les titres d'incidents
oneuptime incident list -o json | jq '.[].title'

# Obtenir l'identifiant d'un moniteur nouvellement créé
NEW_ID=$(oneuptime monitor create --data '{"name":"API Health"}' -o json | jq -r '._id')
echo "Created monitor: $NEW_ID"

# Compter les incidents par gravité
oneuptime incident count --query '{"incidentSeverityId":"<severity-id>"}'
```

## Création de ressources depuis des fichiers

Utilisez `--file` pour créer des ressources depuis des fichiers JSON, utile pour l'infrastructure versionnée :

```bash
# monitor.json
# {
#   "name": "API Health Check",
#   "projectId": "your-project-id"
# }

oneuptime monitor create --file monitor.json
```

## Opérations par lots

Traiter plusieurs ressources dans une boucle :

```bash
# Créer plusieurs moniteurs depuis un tableau JSON dans un fichier
cat monitors.json | jq -r '.[] | @json' | while read monitor; do
  oneuptime monitor create --data "$monitor"
done
```

## Exemples de pipelines CI/CD

### GitHub Actions

```yaml
name: Check Active Incidents
on:
  schedule:
    - cron: "*/5 * * * *"

jobs:
  health-check:
    runs-on: ubuntu-latest
    steps:
      - name: Install OneUptime CLI
        run: npm install -g @oneuptime/cli

      - name: Check for active incidents
        env:
          ONEUPTIME_API_KEY: ${{ secrets.ONEUPTIME_API_KEY }}
          ONEUPTIME_URL: https://oneuptime.com
        run: |
          INCIDENT_COUNT=$(oneuptime incident count)
          if [ "$INCIDENT_COUNT" -gt 0 ]; then
            echo "WARNING: $INCIDENT_COUNT incidents found"
            exit 1
          fi
```

### Script CI/CD générique

```bash
#!/bin/bash
set -e

export ONEUPTIME_API_KEY="$CI_ONEUPTIME_API_KEY"
export ONEUPTIME_URL="$CI_ONEUPTIME_URL"

# Créer un incident de déploiement et capturer l'identifiant
# Note : currentIncidentStateId et incidentSeverityId doivent référencer des identifiants d'état/gravité existants dans votre projet
INCIDENT_ID=$(oneuptime incident create --data '{
  "title": "Deployment Started",
  "currentIncidentStateId": "'"$INVESTIGATING_STATE_ID"'",
  "incidentSeverityId": "'"$SEVERITY_ID"'",
  "declaredAt": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"
}' -o json | jq -r '._id')

# Exécutez les étapes de déploiement ici...

# Résoudre l'incident après un déploiement réussi
oneuptime incident update "$INCIDENT_ID" --data '{"currentIncidentStateId":"'"$RESOLVED_STATE_ID"'"}'
```

### Docker

```dockerfile
FROM node:26-slim
RUN npm install -g @oneuptime/cli
ENV ONEUPTIME_API_KEY=""
ENV ONEUPTIME_URL=""
ENTRYPOINT ["oneuptime"]
```

```bash
docker run --rm \
  -e ONEUPTIME_API_KEY=sk-abc123 \
  -e ONEUPTIME_URL=https://oneuptime.com \
  oneuptime-cli incident list
```

## Utilisation d'un contexte spécifique dans les scripts

Si vous avez plusieurs contextes sauvegardés, ciblez-en un spécifique :

```bash
oneuptime --context production incident list
oneuptime --context staging monitor count
```
