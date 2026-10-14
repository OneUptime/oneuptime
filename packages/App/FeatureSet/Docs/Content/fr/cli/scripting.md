# Scripts et CI/CD

La CLI fonctionne dans un script comme dans un terminal. Donnez-lui une clé API dans des variables d'environnement, lisez ses réponses en JSON, et laissez son code de sortie dire au script ce qui s'est passé. Cette page montre chacun de ces points, et des pipelines complets pour GitHub Actions, GitLab CI et Docker.

:::cards
- [Donner sa clé API à un script](#donner-sa-clé-api-à-un-script): Deux variables d'environnement, aucun contexte enregistré.
- [Codes de sortie](#codes-de-sortie): 0 quand cela a fonctionné, et pourquoi sinon.
- [Lire les réponses avec jq](#lire-les-réponses-avec-jq): Des ID, des titres et des dates tirés du JSON.
- [Exemples de pipelines](#exemples-de-pipelines): GitHub Actions, GitLab CI et Docker.
:::

## Comment un script utilise la CLI

Un déploiement peut d'abord demander à OneUptime si un incident est ouvert, et s'arrêter s'il y en a un :

```mermaid title="Un déploiement qui attend tant qu'un incident est ouvert"
flowchart TB
    J["La tâche de CI démarre"] --> S["Ses secrets définissent<br/>ONEUPTIME_API_KEY<br/>et ONEUPTIME_URL"]
    S --> Q["oneuptime incident count<br/>des incidents non résolus"]
    Q -->|"0"| D["Déployer"]
    Q -->|"1 ou plus"| X["Arrêt : un incident<br/>est ouvert"]
    Q -->|"code de sortie 2"| A["Arrêt : vérifier<br/>la clé API"]
```

## Donner sa clé API à un script

Définissez `ONEUPTIME_API_KEY` et `ONEUPTIME_URL` à partir des secrets de votre système de CI. La CLI n'a alors besoin ni de `login` ni de fichier de configuration. Une option passe toujours avant elles pour une seule commande, et elles passent avant les contextes enregistrés.

```bash
export ONEUPTIME_API_KEY="$CI_ONEUPTIME_API_KEY"
export ONEUPTIME_URL="https://oneuptime.com"
oneuptime incident count
```

> [!TIP]
> Donnez à chaque pipeline sa propre clé API, avec seulement l'accès dont il a besoin : une vérification qui ne fait que lire a besoin d'une clé qui ne fait que lire. Supprimez la clé dans OneUptime quand le pipeline est retiré.

Si une machine exécute des tâches pour plusieurs projets, enregistrez un contexte pour chacun et nommez-le dans chaque commande, afin qu'une tâche n'utilise jamais le contexte actuel d'une autre :

```bash
oneuptime --context production incident count
oneuptime --context staging monitor count
```

## Codes de sortie

| Code | Signification | Par exemple |
| --- | --- | --- |
| `0` | Cela a fonctionné | Une liste, même une qui ne trouve rien |
| `1` | Cela a échoué | OneUptime a refusé la requête, comme `API error (422)` ; du JSON non valide ; une option manquante ou inconnue ; un contexte qui n'est pas enregistré |
| `2` | Aucune clé API utilisable | Aucun identifiant trouvé ; une clé API non valide ; une clé sous son offre (`402`) ; `401` |
| `3` | Introuvable | OneUptime a répondu `404` : l'enregistrement n'existe pas, se trouve dans un autre projet, ou la clé ne peut pas le lire |

`whoami` et `context current` se terminent avec `0` même quand rien n'est enregistré : ils indiquent ce qui est défini, ils ne le vérifient pas. Un script distingue les cas grâce au code :

```bash
oneuptime incident get "$INCIDENT_ID" -o json > incident.json
case $? in
  0) echo "Saved the incident to incident.json" ;;
  2) echo "Check ONEUPTIME_API_KEY and ONEUPTIME_URL" >&2; exit 1 ;;
  3) echo "There is no incident $INCIDENT_ID" >&2; exit 1 ;;
  *) echo "OneUptime refused the request" >&2; exit 1 ;;
esac
```

Les messages d'erreur vont sur la sortie d'erreur standard : `incident.json` ne contient donc que la réponse.

## Lire les réponses avec jq

Écrivez `-o json` dans les scripts. Dans un pipe, la CLI affiche de toute façon du JSON, mais l'option garde le script fonctionnel où qu'il tourne :

```bash
# The title of each incident
oneuptime incident list -o json | jq -r '.[].title'

# The ID of a new monitor
MONITOR_ID=$(oneuptime monitor create --data '{"name":"Checkout API","monitorType":"Manual"}' -o json | jq -r '._id')

# When each incident was created: dates come as objects
oneuptime incident list -o json | jq -r '.[] | "\(.createdAt.value)  \(.title)"'

# The newest 100 incidents as CSV
oneuptime incident list --limit 100 -o json | jq -r '.[] | [._id, .title, .createdAt.value] | @csv'
```

Un comptage affiche un seul nombre, prêt à être comparé :

```bash
OPEN=$(oneuptime incident count --query '{"currentIncidentState":{"isResolvedState":false}}')
echo "$OPEN incidents are open"
```

## Créer des enregistrements à partir de fichiers

Gardez les enregistrements sous forme de fichiers JSON à côté de votre code, et créez-les à partir de là :

```json title="monitors/checkout-api.json"
{
  "name": "Checkout API",
  "monitorType": "Manual"
}
```

```bash
oneuptime monitor create --file monitors/checkout-api.json
```

De nombreux enregistrements à partir d'un tableau JSON, une création chacun :

```bash
jq -c '.[]' monitors.json | while IFS= read -r monitor; do
  oneuptime monitor create --data "$monitor" -o json | jq -r '._id'
done
```

> [!NOTE]
> Chaque exécution crée de nouveaux enregistrements. Pour garder les moniteurs et les pages de statut alignés sur des fichiers, ne modifier que ce qui a changé et retirer ce qui a disparu, utilisez le [fournisseur Terraform](/docs/terraform/index).

## Exemples de pipelines

:::tabs
@tab GitHub Actions
```yaml title=".github/workflows/deploy.yml"
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: lts/*
      - name: Install the OneUptime CLI
        run: npm install -g @oneuptime/cli
      - name: Stop while an incident is open
        env:
          ONEUPTIME_API_KEY: ${{ secrets.ONEUPTIME_API_KEY }}
          ONEUPTIME_URL: https://oneuptime.com
        run: |
          OPEN=$(oneuptime incident count --query '{"currentIncidentState":{"isResolvedState":false}}')
          if [ "$OPEN" -gt 0 ]; then
            echo "$OPEN incidents are open: not deploying."
            exit 1
          fi
      - name: Deploy
        run: ./deploy.sh
```
@tab GitLab CI
```yaml title=".gitlab-ci.yml"
check-incidents:
  stage: test
  image: node:lts
  variables:
    ONEUPTIME_URL: https://oneuptime.com
  script:
    - npm install -g @oneuptime/cli
    - OPEN=$(oneuptime incident count --query '{"currentIncidentState":{"isResolvedState":false}}')
    - echo "$OPEN incidents are open"
    - test "$OPEN" -eq 0
```
@tab Docker
```dockerfile title="Dockerfile"
FROM node:lts-slim
RUN npm install -g @oneuptime/cli
ENTRYPOINT ["oneuptime"]
```
:::

Dans GitHub Actions, ajoutez `ONEUPTIME_API_KEY` sous **Settings → Secrets and variables → Actions** du dépôt ; dans GitLab, ajoutez-la comme variable CI/CD masquée. Avec l'image Docker, passez les variables à chaque exécution :

```bash
docker build -t oneuptime-cli .
docker run --rm -e ONEUPTIME_API_KEY -e ONEUPTIME_URL oneuptime-cli incident count
```

## Étapes suivantes

:::cards
- [Authentification](/docs/cli/authentication): La clé qu'une commande utilise quand plusieurs sont définies.
- [Formats de sortie](/docs/cli/output-formats): Le JSON que vos scripts lisent.
- [Opérations sur les ressources](/docs/cli/resource-operations): Les filtres, la pagination et les champs d'un enregistrement.
- [Fournisseur Terraform](/docs/terraform/index): Garder la configuration de OneUptime dans des fichiers.
:::
