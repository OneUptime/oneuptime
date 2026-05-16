# Agents IA

Les Agents IA dans OneUptime corrigent automatiquement les erreurs, les problèmes de performance et les requêtes de base de données dans votre code. Alimentés par les données d'observabilité OpenTelemetry, les Agents IA créent des pull requests avec les correctifs — et pas seulement des alertes.

## Que peuvent faire les Agents IA ?

Les Agents IA analysent vos données d'observabilité (traces, journaux et métriques) pour détecter et corriger automatiquement les problèmes dans votre base de code :

- **Correction automatique des erreurs** : Lorsque l'Agent IA détecte des exceptions dans vos traces ou journaux, il corrige automatiquement le problème et crée une pull request.
- **Correction des problèmes de performance** : Analyse les traces dont l'exécution est la plus longue et crée des pull requests avec des optimisations de performance.
- **Correction des requêtes de base de données** : Identifie les requêtes de base de données lentes ou inefficaces et les optimise avec une indexation appropriée et des réécritures de requêtes.
- **Correction des problèmes frontend** : Résout automatiquement les problèmes de performance spécifiques au frontend, les problèmes de rendu et les erreurs JavaScript.
- **Ajout automatique de télémétrie** : Ajoutez du traçage, des métriques et des journaux à votre base de code en un seul clic. Aucune instrumentation manuelle requise.
- **Intégration GitHub et GitLab** : S'intègre parfaitement à vos dépôts existants. Les PR sont créées directement dans votre flux de travail.
- **Intégration CI/CD** : S'intègre à vos pipelines CI/CD existants. Les correctifs sont testés et validés avant la création des PR.
- **Prise en charge de Terraform** : Correction automatique des problèmes d'infrastructure. Prend en charge Terraform et OpenTofu pour l'infrastructure en tant que code.
- **Intégration des gestionnaires de tickets** : Se connecte à Jira, Linear et d'autres gestionnaires de tickets. Lie automatiquement les correctifs aux tickets pertinents.

## Fonctionnement

1. **Collecte de données** : OpenTelemetry collecte les traces, journaux et métriques de votre application
2. **Détection des problèmes** : L'IA identifie les erreurs, les goulots d'étranglement de performance et les requêtes lentes
3. **Génération du correctif** : L'IA analyse votre base de code et crée automatiquement le correctif
4. **Création de la PR** : La pull request avec le correctif et un rapport détaillé est prête pour la révision

## Flexibilité du fournisseur LLM

OneUptime fonctionne avec n'importe quel fournisseur LLM. Vous pouvez utiliser :

- Les modèles **OpenAI GPT**
- Les modèles **Anthropic Claude**
- **Meta Llama** (via Ollama ou d'autres fournisseurs)
- Les modèles **auto-hébergés personnalisés**

Auto-hébergez votre modèle IA et gardez votre code totalement privé.

## Confidentialité

Quel que soit votre abonnement, OneUptime ne voit, ne stocke et n'entraîne jamais sur votre code :

- **Aucun accès au code** : Votre code reste sur votre infrastructure
- **Aucun stockage de données** : Politique de rétention zéro
- **Aucun entraînement** : Votre code n'est jamais utilisé pour l'entraînement IA

## Agents IA globaux vs Agents IA auto-hébergés

### Agents IA globaux

Si vous utilisez **OneUptime SaaS** (version hébergée dans le cloud), les Agents IA globaux sont fournis par OneUptime et sont préconfigurés et prêts à l'emploi. Ces agents sont gérés par OneUptime et ne nécessitent aucune configuration supplémentaire.

Les Agents IA globaux sont automatiquement disponibles pour tous les projets, sauf s'ils sont désactivés dans les paramètres de votre projet.

### Agents IA auto-hébergés

Pour les organisations qui ont besoin d'exécuter des agents IA au sein de leur propre infrastructure (par exemple, pour des exigences de sécurité, de conformité ou d'accès réseau), OneUptime prend en charge les agents IA auto-hébergés.

Les agents IA auto-hébergés :
- S'exécutent dans votre réseau privé
- Peuvent accéder aux ressources et systèmes internes
- Vous donnent un contrôle total sur l'environnement de l'agent
- Peuvent être personnalisés selon vos besoins spécifiques

## Configuration d'un Agent IA auto-hébergé

### Étape 1 : Créer un Agent IA dans OneUptime

1. Connectez-vous à votre tableau de bord OneUptime
2. Accédez à **Paramètres du projet** > **Agents IA**
3. Cliquez sur **Créer un Agent IA** pour ajouter un nouvel agent
4. Remplissez les champs requis :
   - **Nom** : Un nom convivial pour votre agent IA
   - **Description** (facultatif) : Une description de l'objectif de l'agent
5. Une fois créé, vous recevrez un `AI_AGENT_ID` et un `AI_AGENT_KEY`

**Important** : Sauvegardez votre `AI_AGENT_KEY` en lieu sûr. Il ne sera affiché qu'une seule fois et ne pourra pas être récupéré ultérieurement.

### Étape 2 : Déployer l'Agent IA

#### Docker

Pour exécuter un agent IA, assurez-vous d'avoir Docker installé. Lancez l'agent avec :

```bash
docker run --name oneuptime-ai-agent --network host \
  -e AI_AGENT_KEY=<ai-agent-key> \
  -e AI_AGENT_ID=<ai-agent-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -d oneuptime/ai-agent:release
```

Si vous auto-hébergez OneUptime, remplacez `ONEUPTIME_URL` par l'URL de votre instance auto-hébergée personnalisée.

#### Docker Compose

Vous pouvez également exécuter l'agent IA avec docker-compose. Créez un fichier `docker-compose.yml` :

```yaml
version: "3"

services:
  oneuptime-ai-agent:
    image: oneuptime/ai-agent:release
    container_name: oneuptime-ai-agent
    environment:
      - AI_AGENT_KEY=<ai-agent-key>
      - AI_AGENT_ID=<ai-agent-id>
      - ONEUPTIME_URL=https://oneuptime.com
    network_mode: host
    restart: always
```

Puis exécutez :

```bash
docker compose up -d
```

#### Kubernetes

Créez un fichier `oneuptime-ai-agent.yaml` :

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-ai-agent
spec:
  selector:
    matchLabels:
      app: oneuptime-ai-agent
  template:
    metadata:
      labels:
        app: oneuptime-ai-agent
    spec:
      containers:
      - name: oneuptime-ai-agent
        image: oneuptime/ai-agent:release
        env:
          - name: AI_AGENT_KEY
            value: "<ai-agent-key>"
          - name: AI_AGENT_ID
            value: "<ai-agent-id>"
          - name: ONEUPTIME_URL
            value: "https://oneuptime.com"
```

Appliquez la configuration :

```bash
kubectl apply -f oneuptime-ai-agent.yaml
```

### Variables d'environnement

L'agent IA prend en charge les variables d'environnement suivantes :

#### Variables requises

| Variable | Description |
|----------|-------------|
| `AI_AGENT_KEY` | La clé de l'agent IA depuis votre tableau de bord OneUptime |
| `AI_AGENT_ID` | L'identifiant de l'agent IA depuis votre tableau de bord OneUptime |
| `ONEUPTIME_URL` | L'URL de votre instance OneUptime (par défaut : https://oneuptime.com) |


## Vérification de votre Agent IA

Après le déploiement de votre agent IA :

1. Accédez à **Paramètres du projet** > **Agents IA** dans votre tableau de bord OneUptime
2. Votre agent devrait apparaître comme **Connecté** dans quelques minutes
3. Si le statut indique **Déconnecté**, vérifiez les journaux du conteneur pour les erreurs

Pour consulter les journaux du conteneur :

```bash
# Docker
docker logs oneuptime-ai-agent

# Kubernetes
kubectl logs deployment/oneuptime-ai-agent
```

## Dépannage

### L'agent ne se connecte pas

1. **Vérifiez les identifiants** : Assurez-vous que `AI_AGENT_KEY` et `AI_AGENT_ID` sont corrects
2. **Vérifiez le réseau** : Assurez-vous que l'agent peut atteindre votre instance OneUptime
3. **Consultez les journaux** : Vérifiez les journaux du conteneur pour les messages d'erreur
4. **Règles de pare-feu** : Assurez-vous que le trafic HTTPS sortant (port 443) est autorisé

### L'agent se déconnecte fréquemment

1. **Vérifiez les limites de ressources** : Assurez-vous que le conteneur dispose de suffisamment de mémoire et de CPU
2. **Stabilité du réseau** : Vérifiez que la connectivité réseau est stable
3. **Consultez les journaux** : Recherchez les erreurs de délai d'attente ou de connexion dans les journaux

## Besoin d'aide ?

Si vous rencontrez des problèmes avec votre agent IA :

1. Consultez les [problèmes GitHub de OneUptime](https://github.com/OneUptime/oneuptime/issues) pour les problèmes connus
2. Créez un nouveau ticket si votre problème n'est pas encore signalé
3. Contactez le [support](https://oneuptime.com/support) si vous disposez d'un abonnement entreprise
