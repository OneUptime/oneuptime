# Fournisseurs LLM

OneUptime prend en charge l'intégration avec divers fournisseurs de grands modèles de langage (LLM) pour activer les fonctionnalités alimentées par l'IA dans toute la plateforme. Ce guide vous aidera à configurer votre propre fournisseur LLM.

## Que peuvent faire les fournisseurs LLM ?

Les fournisseurs LLM dans OneUptime vous aident à automatiser et améliorer votre flux de gestion des incidents :

- **Notes d'incident** : Génération automatique de notes et de mises à jour détaillées sur les incidents
- **Notes d'alerte** : Création de descriptions d'alertes significatives avec contexte
- **Notes de maintenance programmée** : Génération automatique de notes sur les événements de maintenance
- **Post-mortems d'incidents** : Rédaction automatique de rapports complets de post-mortem d'incidents
- **Améliorations du code** : Si vous connectez votre dépôt de code à OneUptime, nous utiliserons votre fournisseur LLM pour analyser les données de télémétrie (journaux, traces, métriques, exceptions) et suggérer des améliorations de code

## Utilisateurs OneUptime SaaS

Si vous utilisez **OneUptime SaaS** (version hébergée dans le cloud), vous pouvez utiliser le **Fournisseur LLM global** par défaut sans aucune configuration supplémentaire. Le Fournisseur LLM global est préconfiguré et prêt à l'emploi pour toutes les fonctionnalités IA.

Si vous préférez utiliser vos propres clés API ou un fournisseur spécifique, vous pouvez toujours configurer un fournisseur LLM personnalisé en suivant les instructions ci-dessous.

## Fournisseurs pris en charge

OneUptime prend actuellement en charge les fournisseurs LLM suivants :

| Fournisseur           | Description                                                                  | Clé API requise  | URL de base requise                |
| --------------------- | ---------------------------------------------------------------------------- | ---------------- | ---------------------------------- |
| **OpenAI**            | GPT-4, GPT-4o, GPT-3.5 Turbo et autres modèles OpenAI                        | Oui              | Non (utilise la valeur par défaut) |
| **Azure OpenAI**      | Modèles OpenAI hébergés sur votre déploiement Azure                          | Oui              | Oui                                |
| **Anthropic**         | Claude 3 Opus, Claude 3 Sonnet, Claude 3 Haiku et autres modèles Claude      | Oui              | Non (utilise la valeur par défaut) |
| **Groq**              | Inférence rapide pour Llama, Mixtral et autres modèles ouverts               | Oui              | Non (utilise la valeur par défaut) |
| **Mistral**           | Modèles hébergés de Mistral                                                  | Oui              | Non (utilise la valeur par défaut) |
| **Ollama**            | Modèles open source auto-hébergés tels que Llama 2, Mistral, CodeLlama, etc. | Non              | Oui                                |
| **OpenAI Compatible** | Tout serveur compatible OpenAI (vLLM, LocalAI, LM Studio, etc.)              | Non (facultatif) | Oui                                |

## Configuration d'un fournisseur LLM

### Étape 1 : Accéder aux paramètres des fournisseurs LLM

1. Connectez-vous à votre tableau de bord OneUptime
2. Accédez à **Agents IA** > **Fournisseurs LLM**
3. Cliquez sur **Créer un fournisseur LLM** pour ajouter un nouveau fournisseur

### Étape 2 : Configurer votre fournisseur

Remplissez les champs suivants :

- **Nom** : Un nom convivial pour cette configuration LLM (par ex., « OpenAI de production », « Ollama local »)
- **Description** (facultatif) : Une description pour identifier l'objectif de ce fournisseur
- **Type de LLM** : Sélectionnez le type de fournisseur (OpenAI, Azure OpenAI, Anthropic, Groq, Mistral, Ollama ou OpenAI Compatible)
- **Clé API** : Votre clé API (requise pour OpenAI, Azure OpenAI, Anthropic, Groq et Mistral ; facultative pour Ollama et les serveurs compatibles OpenAI)
- **Nom du modèle** : Le modèle spécifique à utiliser (par ex., `gpt-4o`, `claude-3-opus-20240229`, `llama2`)
- **URL de base** (facultatif) : URL personnalisée du point de terminaison API (requise pour Azure OpenAI, Ollama et OpenAI Compatible ; facultative pour les autres)

## Configuration spécifique au fournisseur

### OpenAI

1. Obtenez votre clé API depuis [OpenAI Platform](https://platform.openai.com/api-keys)
2. Sélectionnez **OpenAI** comme type de LLM
3. Saisissez votre clé API
4. Choisissez un nom de modèle :
   - `gpt-4o` — Modèle le plus performant, idéal pour les tâches complexes
   - `gpt-4o-mini` — Plus rapide et plus économique
   - `gpt-4-turbo` — Bon équilibre entre capacité et vitesse
   - `gpt-3.5-turbo` — Rapide et économique

**Exemple de configuration :**

```
Name: Production OpenAI
LLM Type: OpenAI
API Key: sk-xxxxxxxxxxxxxxxxxxxx
Model Name: gpt-4o
```

### Anthropic

1. Obtenez votre clé API depuis [Anthropic Console](https://console.anthropic.com/)
2. Sélectionnez **Anthropic** comme type de LLM
3. Saisissez votre clé API
4. Choisissez un nom de modèle :
   - `claude-3-opus-20240229` — Modèle le plus performant
   - `claude-3-sonnet-20240229` — Bon équilibre entre intelligence et vitesse
   - `claude-3-haiku-20240307` — Le plus rapide et le plus compact
   - `claude-3-5-sonnet-20241022` — Dernier modèle Sonnet

**Exemple de configuration :**

```
Name: Production Anthropic
LLM Type: Anthropic
API Key: sk-ant-xxxxxxxxxxxxxxxxxxxx
Model Name: claude-3-5-sonnet-20241022
```

### Ollama (auto-hébergé)

Ollama vous permet d'exécuter des LLM open source localement ou sur votre propre infrastructure.

1. Installez Ollama depuis [ollama.ai](https://ollama.ai)
2. Téléchargez le modèle souhaité : `ollama pull llama2`
3. Assurez-vous qu'Ollama est en cours d'exécution et accessible
4. Sélectionnez **Ollama** comme type de LLM
5. Saisissez l'URL de base (par ex., `http://localhost:11434`)
6. Saisissez le nom du modèle que vous avez téléchargé

**Exemple de configuration :**

```
Name: Local Ollama
LLM Type: Ollama
Base URL: http://localhost:11434
Model Name: llama2
```

**Modèles Ollama populaires :**

- `llama2` — Modèle Llama 2 de Meta
- `llama3` — Modèle Llama 3 de Meta
- `mistral` — Modèle de Mistral AI
- `codellama` — Modèle Llama spécialisé dans le code
- `mixtral` — Modèle mixture of experts de Mistral

### OpenAI Compatible (vLLM, LocalAI, LM Studio, etc.)

Utilisez le fournisseur **OpenAI Compatible** pour tout serveur qui implémente l'API OpenAI `/chat/completions` mais qui n'est pas OpenAI lui-même — par exemple [vLLM](https://docs.vllm.ai), [LocalAI](https://localai.io), [LM Studio](https://lmstudio.ai) ou text-generation-webui. Ces serveurs sont généralement auto-hébergés à votre propre URL et fonctionnent souvent sans authentification.

1. Démarrez votre serveur compatible OpenAI et notez son URL de base (elle se termine généralement par `/v1`)
2. Sélectionnez **OpenAI Compatible** comme type de LLM
3. Saisissez l'**URL de base** (requise), par ex. `http://your-server:8000/v1`
4. Saisissez le **nom du modèle** (requis) — il doit correspondre à un modèle exposé par votre serveur
5. Saisissez la **clé API** uniquement si votre serveur en exige une ; laissez-la vide pour les serveurs sans authentification

**Exemple de configuration (vLLM sans clé) :**

```
Name: Self-Hosted vLLM
LLM Provider: OpenAI Compatible
Base URL: http://vllm.internal:8000/v1
Model Name: meta-llama/Llama-3.1-8B-Instruct
API Key: (leave blank)
```

> Astuce : Après l'enregistrement, utilisez le bouton **Test** sur le fournisseur pour confirmer que la connexion, le nom du modèle et l'URL de base sont corrects.

### vLLM auto-hébergé sur Kubernetes (Helm)

Si vous auto-hébergez OneUptime avec le chart Helm, vous pouvez exécuter [vLLM](https://docs.vllm.ai) — un serveur d'inférence compatible OpenAI — au sein de votre cluster et servir des modèles locaux sur vos propres GPU. Aucune donnée ne quitte votre infrastructure.

1. Activez-le dans vos valeurs Helm (nécessite des nœuds GPU NVIDIA) :

   ```yaml
   vllm:
     enabled: true
     model: Qwen/Qwen2.5-1.5B-Instruct
   ```

2. Exécutez `helm upgrade` et attendez que le pod vLLM devienne Ready (le premier démarrage télécharge le modèle)
3. C'est tout — vLLM est enregistré automatiquement comme fournisseur LLM global au démarrage (`vllm.globalProvider.enabled`, `true` par défaut), afin que les fonctionnalités IA fonctionnent pour tous les projets. Remarque : les agents IA au niveau projet ne peuvent pas utiliser les fournisseurs globaux et nécessitent toujours un fournisseur LLM propre au projet.

Si vous avez désactivé l'enregistrement automatique (`vllm.globalProvider.enabled: false`), créez le fournisseur manuellement :

1. Sélectionnez **OpenAI Compatible** comme type de LLM (vLLM parle l'API OpenAI)
2. Saisissez l'URL de base interne au cluster : `http://<release>-vllm.<namespace>.svc.cluster.local:8000/v1`
3. Saisissez le nom du modèle : l'identifiant complet du modèle HuggingFace (ou `vllm.servedModelName` si vous en avez défini un)
4. Saisissez la clé API uniquement si vous avez défini `vllm.apiKey` ; laissez-la vide pour un vLLM sans authentification

**Exemple de configuration :**

```
Name: In-Cluster vLLM
LLM Provider: OpenAI Compatible
Base URL: http://oneuptime-vllm.default.svc.cluster.local:8000/v1
Model Name: Qwen/Qwen2.5-1.5B-Instruct
API Key: (leave blank unless vllm.apiKey is set)
```

Consultez le [README du chart Helm](https://github.com/OneUptime/oneuptime/tree/master/HelmChart/Public/oneuptime#local-models-with-vllm) pour la planification GPU, les modèles à accès restreint et les options de réglage.

## Utilisation d'URL de base personnalisées

Pour les déploiements d'entreprise ou lors de l'utilisation de services proxy, vous pouvez spécifier une URL de base personnalisée :

- **Azure OpenAI** : Utilisez votre URL de point de terminaison Azure
- **API compatibles OpenAI** : Toute API suivant la spécification API d'OpenAI
- **Instances Ollama privées** : L'URL de votre serveur Ollama interne

## Bonnes pratiques

1. **Utilisez des noms descriptifs** : Nommez clairement vos fournisseurs (par ex., « GPT-4 de production », « Ollama de développement »)
2. **Sécurisez vos clés API** : Les clés API sont chiffrées au repos, mais évitez de les partager
3. **Testez votre configuration** : Après la configuration, vérifiez que le fournisseur fonctionne avec les fonctionnalités IA
4. **Surveillez l'utilisation** : Gardez un œil sur l'utilisation de l'API pour gérer les coûts

## Dépannage

### Problèmes de connexion

- **OpenAI/Anthropic** : Vérifiez que votre clé API est valide et dispose de crédits suffisants
- **Ollama** : Assurez-vous que le serveur Ollama est en cours d'exécution et que l'URL de base est correcte
- **OpenAI Compatible** : Assurez-vous que l'URL de base se termine par `/v1` (ou correspond à votre serveur), que le nom du modèle correspond à un modèle exposé par votre serveur, et ne définissez une clé API que si votre serveur en exige une
- **Pare-feu** : Vérifiez que votre réseau autorise les connexions sortantes vers l'API du fournisseur

### Modèle introuvable

- Vérifiez que le nom du modèle est correctement orthographié
- Pour Ollama, assurez-vous d'avoir téléchargé le modèle avec `ollama pull <nom-du-modèle>`
- Vérifiez si le modèle est disponible dans votre région (certains modèles ont des restrictions régionales)

## Besoin d'aide ?

Si vous rencontrez des problèmes lors de la configuration de votre fournisseur LLM, veuillez :

1. Consulter les [problèmes GitHub de OneUptime](https://github.com/OneUptime/oneuptime/issues) pour les problèmes connus
2. Contacter le support si vous disposez d'un abonnement entreprise
