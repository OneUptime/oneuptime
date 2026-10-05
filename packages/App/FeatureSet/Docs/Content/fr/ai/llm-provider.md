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

OneUptime SaaS ne peut joindre que des endpoints LLM sur l'internet public. Il ne peut pas se connecter à un modèle situé sur votre réseau privé, comme un serveur Ollama ou vLLM auto-hébergé. Pour utiliser un modèle que vous exécutez vous-même, auto-hébergez OneUptime sur un réseau qui peut le joindre, ou exposez le modèle sur un endpoint public — voir [Choisir l'URL de base d'un modèle auto-hébergé](#choisir-lurl-de-base-dun-modèle-auto-hébergé).

## Auto-hébergé : zéro configuration avec les variables d'environnement

Sur une instance auto-hébergée, le moyen le plus rapide d'activer les fonctionnalités IA pour **tous les projets à la fois** est de définir les variables d'environnement `GLOBAL_LLM_PROVIDER_*` sur votre serveur OneUptime — dans `config.env` pour Docker Compose, ou via les valeurs Helm. Au démarrage, OneUptime enregistre à partir de ces variables un fournisseur LLM global (et le maintient synchronisé) ; aucune configuration par projet n'est nécessaire dans le tableau de bord, et les tâches de correctif IA l'utilisent aussi lorsqu'un projet n'a pas son propre fournisseur.

| Variable | Description |
| --- | --- |
| `GLOBAL_LLM_PROVIDER_TYPE` | Obligatoire pour l'activer. L'une des valeurs : `OpenAI`, `AzureOpenAI`, `Anthropic`, `Groq`, `Mistral`, `Ollama`, `OpenAICompatible` |
| `GLOBAL_LLM_PROVIDER_API_KEY` | Clé API — requise pour OpenAI, Azure OpenAI, Anthropic, Groq et Mistral ; inutile pour Ollama ou les serveurs compatibles OpenAI sans clé |
| `GLOBAL_LLM_PROVIDER_BASE_URL` | Point de terminaison de l'API — requis pour Azure OpenAI, Ollama et les serveurs compatibles OpenAI |
| `GLOBAL_LLM_PROVIDER_MODEL_NAME` | Modèle à utiliser (requis pour les serveurs compatibles OpenAI, recommandé ailleurs) |
| `GLOBAL_LLM_PROVIDER_NAME` | Nom convivial facultatif affiché dans le tableau de bord |

**Exemple : Ollama auto-hébergé**

```bash
GLOBAL_LLM_PROVIDER_TYPE=Ollama
# Une adresse que le serveur OneUptime peut joindre. Jamais localhost : voir
# "Choisir l'URL de base d'un modèle auto-hébergé" plus bas.
GLOBAL_LLM_PROVIDER_BASE_URL=http://ollama:11434
GLOBAL_LLM_PROVIDER_MODEL_NAME=llama3.1
# Aucune clé API nécessaire — Ollama fonctionne sans clé.
```

**Exemple : OpenAI**

```bash
GLOBAL_LLM_PROVIDER_TYPE=OpenAI
GLOBAL_LLM_PROVIDER_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
GLOBAL_LLM_PROVIDER_MODEL_NAME=gpt-5.1
```

La synchronisation est déclarative : modifier les variables met à jour le fournisseur au prochain redémarrage, et retirer `GLOBAL_LLM_PROVIDER_TYPE` le supprime. Les fournisseurs globaux créés manuellement dans le tableau de bord d'administration ne sont jamais modifiés. Les projets peuvent toujours ajouter leur propre fournisseur sous **Paramètres du projet** > **IA** > **Fournisseurs LLM** — un fournisseur propre au projet a toujours la priorité sur le fournisseur global.

## Fournisseurs pris en charge

OneUptime prend actuellement en charge les fournisseurs LLM suivants :

| Fournisseur           | Description                                                               | Clé API requise  | URL de base requise                |
| --------------------- | ------------------------------------------------------------------------- | ---------------- | ---------------------------------- |
| **OpenAI**            | GPT-5.1 et autres modèles OpenAI                                          | Oui              | Non (utilise la valeur par défaut) |
| **Azure OpenAI**      | Modèles OpenAI hébergés sur votre déploiement Azure                       | Oui              | Oui                                |
| **Anthropic**         | Claude Sonnet 5, Claude Opus 5, Claude Haiku 4.5 et autres modèles Claude | Oui              | Non (utilise la valeur par défaut) |
| **Groq**              | Inférence rapide pour Llama, Mixtral et autres modèles ouverts            | Oui              | Non (utilise la valeur par défaut) |
| **Mistral**           | Modèles hébergés de Mistral                                               | Oui              | Non (utilise la valeur par défaut) |
| **Ollama**            | Modèles open source auto-hébergés tels que Llama 3.1, Mistral, Qwen, etc. | Non              | Oui                                |
| **OpenAI Compatible** | Tout serveur compatible OpenAI (vLLM, LocalAI, LM Studio, etc.)           | Non (facultatif) | Oui                                |

## Configuration d'un fournisseur LLM

### Étape 1 : Accéder aux paramètres des fournisseurs LLM

1. Connectez-vous à votre tableau de bord OneUptime
2. Accédez à **Paramètres du projet** > **IA** > **Fournisseurs LLM**
3. Cliquez sur **Créer un fournisseur LLM** pour ajouter un nouveau fournisseur

### Étape 2 : Configurer votre fournisseur

Remplissez les champs suivants :

- **Nom** : Un nom convivial pour cette configuration LLM (par ex., « OpenAI de production », « Ollama local »)
- **Description** (facultatif) : Une description pour identifier l'objectif de ce fournisseur
- **Fournisseur LLM** : Sélectionnez le type de fournisseur (OpenAI, Azure OpenAI, Anthropic, Groq, Mistral, Ollama ou OpenAI Compatible)
- **Clé API** : Votre clé API (requise pour OpenAI, Azure OpenAI, Anthropic, Groq et Mistral ; facultative pour Ollama et les serveurs compatibles OpenAI)
- **Nom du modèle** : Le modèle spécifique à utiliser (par ex., `gpt-5.1`, `claude-sonnet-5`, `llama3.1`)
- **URL de base** (facultatif) : URL personnalisée du point de terminaison API (requise pour Azure OpenAI, Ollama et OpenAI Compatible ; facultative pour les autres)
- **Plus de champs**, replié sous les champs ci-dessus : **Définir par défaut**, activé pour un nouveau fournisseur car les fonctionnalités IA n'utilisent que le fournisseur par défaut du projet, et **Paramètres supplémentaires**, un objet JSON facultatif dont les paramètres sont envoyés au fournisseur avec chaque requête (par exemple `{"temperature": 0.2}`)

## Configuration spécifique au fournisseur

### OpenAI

1. Obtenez votre clé API depuis [OpenAI Platform](https://platform.openai.com/api-keys)
2. Sélectionnez **OpenAI** comme fournisseur LLM
3. Saisissez votre clé API
4. Choisissez un nom de modèle :
   - `gpt-5.1` — Choix par défaut recommandé, performant pour l'appel d'outils et les investigations complexes
   - `gpt-5.1-mini` — Plus rapide et plus économique

**Exemple de configuration :**

```
Name: Production OpenAI
LLM Provider: OpenAI
API Key: sk-xxxxxxxxxxxxxxxxxxxx
Model Name: gpt-5.1
```

### Anthropic

1. Obtenez votre clé API depuis [Anthropic Console](https://console.anthropic.com/)
2. Sélectionnez **Anthropic** comme fournisseur LLM
3. Saisissez votre clé API
4. Choisissez un nom de modèle :
   - `claude-sonnet-5` — Choix par défaut recommandé, meilleur équilibre entre intelligence, vitesse et coût
   - `claude-opus-5` — Modèle le plus performant, pour les investigations les plus difficiles
   - `claude-haiku-4-5` — Le plus rapide et le plus économique

**Exemple de configuration :**

```
Name: Production Anthropic
LLM Provider: Anthropic
API Key: sk-ant-xxxxxxxxxxxxxxxxxxxx
Model Name: claude-sonnet-5
```

### Ollama (auto-hébergé)

Ollama vous permet d'exécuter des LLM open source localement ou sur votre propre infrastructure.

1. Installez Ollama depuis [ollama.ai](https://ollama.ai)
2. Téléchargez le modèle souhaité : `ollama pull llama3.1`
3. Assurez-vous qu'Ollama est en cours d'exécution et joignable depuis le serveur OneUptime. Une installation native n'écoute que sur `127.0.0.1` : démarrez-la avec `OLLAMA_HOST=0.0.0.0:11434` pour qu'elle accepte les connexions d'autres machines et conteneurs (l'image Docker officielle `ollama/ollama` le fait déjà)
4. Sélectionnez **Ollama** comme fournisseur LLM
5. Saisissez l'URL de base : l'adresse du serveur Ollama telle que le serveur OneUptime la joint, par ex. `http://ollama:11434` (OneUptime ajoute lui-même `/api/chat`). `localhost` ne fonctionne pas — voir [Choisir l'URL de base d'un modèle auto-hébergé](#choisir-lurl-de-base-dun-modèle-auto-hébergé)
6. Saisissez le nom du modèle que vous avez téléchargé

**Exemple de configuration (Ollama en tant que service nommé `ollama` sur le réseau Docker Compose de OneUptime) :**

```
Name: Self-Hosted Ollama
LLM Provider: Ollama
Base URL: http://ollama:11434
Model Name: llama3.1
```

**Agrandissez la fenêtre de contexte.** Sauf indication contraire, Ollama exécute un modèle avec une petite fenêtre de contexte (4096 tokens dans les versions actuelles, 2048 dans les plus anciennes) et coupe silencieusement tout ce qui dépasse. Les fonctionnalités IA de OneUptime envoient leurs définitions d'outils à chaque requête, et celles-ci peuvent à elles seules occuper plusieurs milliers de tokens. Lorsqu'elles sont coupées, aucune erreur n'apparaît : le modèle répond simplement qu'il n'a aucun outil pour la question. Définissez un `num_ctx` plus grand dans le champ **Paramètres supplémentaires** du fournisseur :

```json
{ "options": { "num_ctx": 16384 } }
```

OneUptime fusionne cet objet `options` avec les options qu'il envoie à Ollama : n'indiquez donc que les réglages à modifier. Une fenêtre de contexte plus grande demande plus de mémoire ; choisissez une taille que votre modèle prend en charge et que votre matériel peut supporter. Pour relever plutôt la valeur par défaut pour tous les clients, définissez `OLLAMA_CONTEXT_LENGTH` sur le serveur Ollama. Pour un fournisseur global enregistré à partir des variables `GLOBAL_LLM_PROVIDER_*`, renseignez ce champ dans le tableau de bord d'administration, sous **Paramètres** > **Fournisseurs LLM globaux** ; la synchronisation au démarrage n'y touche pas.

**Modèles Ollama populaires :**

- `llama3.1` — Modèle Llama 3.1 de Meta, le plus ancien Llama prenant en charge l'appel d'outils
- `llama3.3` — Modèle Llama 3.3 de Meta
- `qwen2.5` — Modèle Qwen 2.5 d'Alibaba
- `mistral-nemo` — Modèle Nemo de Mistral AI

> Remarque : les fonctionnalités IA de OneUptime sont agentiques — elles reposent fortement sur l'appel d'outils. Utilisez `llama3.1` ou plus récent (ou un autre modèle prenant en charge l'appel d'outils). Les petits modèles ou ceux sans appel d'outils (par ex. `llama2`, le `llama3` d'origine) donnent de mauvais résultats : ils ne peuvent pas interroger vos moniteurs, incidents ou données de télémétrie, si bien que les investigations reviennent vides ou hallucinées.

### Choisir l'URL de base d'un modèle auto-hébergé

L'URL de base d'un modèle auto-hébergé — Ollama, vLLM, LM Studio ou tout autre serveur compatible OpenAI — doit être une adresse que le **serveur OneUptime** peut joindre. Votre navigateur ne s'y connecte jamais.

**Les adresses de bouclage sont toujours refusées.** Avant de se connecter, OneUptime vérifie chaque adresse vers laquelle se résout le nom d'hôte de l'URL de base. `localhost`, `127.0.0.1`, `[::1]` et `0.0.0.0`, ainsi que les adresses de lien local et de métadonnées cloud comme `169.254.169.254`, sont refusées dans tous les déploiements, auto-hébergés compris. C'est voulu : l'URL de base d'un fournisseur ne doit pas permettre d'atteindre des services sur le serveur OneUptime lui-même. Dans Docker Compose ou Kubernetes, `localhost` désignerait de toute façon le conteneur OneUptime, et non la machine qui exécute votre modèle.

Utilisez plutôt une adresse privée ou un nom d'hôte interne :

| Où s'exécute le serveur du modèle | URL de base |
| --- | --- |
| Un service sur le réseau Docker Compose de OneUptime (`oneuptime`) | Le nom du service, par ex. `http://ollama:11434` |
| Le même cluster Kubernetes que OneUptime | Le nom DNS du Service, par ex. `http://ollama.<namespace>.svc.cluster.local:11434` — le même schéma que le [vLLM intégré](#vllm-auto-hébergé-sur-kubernetes-helm) |
| La machine hôte elle-même, hors de tout conteneur | L'IP LAN de l'hôte, par ex. `http://192.168.1.20:11434`, ou `http://host.docker.internal:11434` avec Docker Desktop |
| Une autre machine de votre réseau | Son IP privée ou son nom d'hôte interne, par ex. `http://10.0.0.12:11434` |

Les serveurs compatibles OpenAI suivent les mêmes règles, avec leur propre port et le chemin `/v1`, par ex. `http://vllm:8000/v1`, ou `http://192.168.1.20:1234/v1` pour LM Studio. Comme une installation native d'Ollama, LM Studio n'écoute que sur `127.0.0.1` tant que vous n'activez pas **Serve on Local Network** dans ses paramètres de serveur.

**Les adresses privées fonctionnent sur les installations auto-hébergées.** Un OneUptime auto-hébergé peut joindre les adresses de réseau privé, comme `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10` et IPv6 `fc00::/7`, sauf si vous définissez `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true`, qui les refuse comme le fait OneUptime Cloud.

**OneUptime Cloud (SaaS) ne peut pas joindre les réseaux privés.** Il refuse les adresses de réseau privé, et les noms d'hôte qui s'y résolvent, pour tous les fournisseurs LLM. Pour utiliser un modèle qui tourne sur votre propre infrastructure, auto-hébergez OneUptime sur un réseau qui peut le joindre, ou exposez le modèle sur un endpoint accessible publiquement. Protégez un endpoint public par une clé API : le fournisseur **Ollama** n'envoie aucun identifiant, tandis que **OpenAI Compatible** envoie la clé API comme jeton bearer (Ollama expose aussi une API compatible OpenAI sous `/v1` ; il peut donc se placer derrière un reverse proxy qui vérifie la clé).

### OpenAI Compatible (vLLM, LocalAI, LM Studio, etc.)

Utilisez le fournisseur **OpenAI Compatible** pour tout serveur qui implémente l'API OpenAI `/chat/completions` mais qui n'est pas OpenAI lui-même — par exemple [vLLM](https://docs.vllm.ai), [LocalAI](https://localai.io), [LM Studio](https://lmstudio.ai) ou text-generation-webui. Ces serveurs sont généralement auto-hébergés à votre propre URL et fonctionnent souvent sans authentification.

1. Démarrez votre serveur compatible OpenAI et notez son URL de base (elle se termine généralement par `/v1`)
2. Sélectionnez **OpenAI Compatible** comme fournisseur LLM
3. Saisissez l'**URL de base** (requise), par ex. `http://your-server:8000/v1`. Elle doit être joignable depuis le serveur OneUptime, donc pas `localhost` — voir [Choisir l'URL de base d'un modèle auto-hébergé](#choisir-lurl-de-base-dun-modèle-auto-hébergé)
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

> Astuce : Après l'enregistrement, utilisez le bouton **Tester** sur le fournisseur pour confirmer que la connexion, le nom du modèle et l'URL de base sont corrects.

### vLLM auto-hébergé sur Kubernetes (Helm)

Si vous auto-hébergez OneUptime avec le chart Helm, vous pouvez exécuter [vLLM](https://docs.vllm.ai) — un serveur d'inférence compatible OpenAI — au sein de votre cluster et servir des modèles locaux sur vos propres GPU. Aucune donnée ne quitte votre infrastructure.

1. Activez-le dans vos valeurs Helm (nécessite des nœuds GPU NVIDIA) :

   ```yaml
   vllm:
     enabled: true
     model: Qwen/Qwen2.5-1.5B-Instruct
   ```

2. Exécutez `helm upgrade` et attendez que le pod vLLM devienne Ready (le premier démarrage télécharge le modèle)
3. C'est tout — vLLM est enregistré automatiquement comme fournisseur LLM global au démarrage (`vllm.globalProvider.enabled`, `true` par défaut), afin que les fonctionnalités IA fonctionnent pour tous les projets, y compris les tâches de correctif IA. (Partout — dans le cloud comme en auto-hébergé — les tâches de correctif de l'agent utilisent le fournisseur global lorsque le projet n'a pas son propre fournisseur ; dans le cloud, cet usage est facturé en tokens IA mesurés. Un fournisseur propre au projet a toujours la priorité.)

Si vous avez désactivé l'enregistrement automatique (`vllm.globalProvider.enabled: false`), créez le fournisseur manuellement :

1. Sélectionnez **OpenAI Compatible** comme fournisseur LLM (vLLM parle l'API OpenAI)
2. Saisissez l'URL de base interne au cluster : `http://<release>-vllm.<namespace>.svc.cluster.local:8000/v1` (remplacez `cluster.local` si vous avez modifié `global.clusterDomain`)
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

Consultez le [guide vLLM du chart Helm](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/ai-vllm.md) pour la planification GPU, les modèles à accès restreint et les options de réglage.

## Utilisation d'URL de base personnalisées

Pour les déploiements d'entreprise ou lors de l'utilisation de services proxy, vous pouvez spécifier une URL de base personnalisée :

- **Azure OpenAI** : Utilisez votre URL de point de terminaison Azure
- **API compatibles OpenAI** : Toute API suivant la spécification API d'OpenAI
- **Instances Ollama privées** : L'URL de votre serveur Ollama interne

## Bonnes pratiques

1. **Utilisez des noms descriptifs** : Nommez clairement vos fournisseurs (par ex., « OpenAI de production », « Ollama de développement »)
2. **Sécurisez vos clés API** : Les clés API sont chiffrées au repos, mais évitez de les partager
3. **Testez votre configuration** : Après la configuration, vérifiez que le fournisseur fonctionne avec les fonctionnalités IA
4. **Surveillez l'utilisation** : Gardez un œil sur l'utilisation de l'API pour gérer les coûts

## Dépannage

### Problèmes de connexion

- **OpenAI/Anthropic** : Vérifiez que votre clé API est valide et dispose de crédits suffisants
- **Ollama** : Assurez-vous que le serveur Ollama est en cours d'exécution, qu'il écoute sur une adresse que le serveur OneUptime peut joindre (`OLLAMA_HOST=0.0.0.0:11434` pour une installation native) et que l'URL de base pointe vers cette adresse
- **OpenAI Compatible** : Assurez-vous que l'URL de base se termine par `/v1` (ou correspond à votre serveur), que le nom du modèle correspond à un modèle exposé par votre serveur, et ne définissez une clé API que si votre serveur en exige une
- **"…points to an address OneUptime is not allowed to connect to"** : l'URL de base se résout vers une adresse refusée — `localhost` ou une autre adresse de bouclage, ou, sur OneUptime Cloud, une adresse de réseau privé. (OneUptime Cloud signale plutôt un nom d'hôte refusé par "…could not be reached".) Voir [Choisir l'URL de base d'un modèle auto-hébergé](#choisir-lurl-de-base-dun-modèle-auto-hébergé)
- **Pare-feu** : Vérifiez que votre réseau autorise les connexions sortantes vers l'API du fournisseur

### Modèle introuvable

- Vérifiez que le nom du modèle est correctement orthographié
- Pour Ollama, assurez-vous d'avoir téléchargé le modèle avec `ollama pull <nom-du-modèle>`
- Vérifiez si le modèle est disponible dans votre région (certains modèles ont des restrictions régionales)

## Besoin d'aide ?

Si vous rencontrez des problèmes lors de la configuration de votre fournisseur LLM, veuillez :

1. Consulter les [problèmes GitHub de OneUptime](https://github.com/OneUptime/oneuptime/issues) pour les problèmes connus
2. Contacter le support si vous disposez d'un abonnement entreprise
