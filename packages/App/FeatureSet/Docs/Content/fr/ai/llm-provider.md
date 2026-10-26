# Fournisseurs LLM

Un fournisseur LLM est le modèle derrière chaque fonctionnalité d'IA de OneUptime : les investigations, Demander à l'IA, les brouillons et les pull requests de correctif. Cette page montre quel fournisseur une fonctionnalité utilise, comment ajouter le vôtre (OpenAI, Azure OpenAI et Microsoft Foundry, Anthropic, Groq, Mistral, Ollama ou n'importe quel serveur compatible OpenAI) et comment faire pointer OneUptime vers un modèle que vous exécutez vous-même.

:::cards
- [Quel fournisseur l'IA utilise](#quel-fournisseur-lia-utilise): Le fournisseur par défaut du projet, sinon le fournisseur global.
- [Auto-hébergé : sans configuration via les variables d'environnement](#auto-hébergé-sans-configuration-via-les-variables-denvironnement): Un fournisseur pour chaque projet, depuis les paramètres du serveur.
- [Configurer un fournisseur LLM](#configurer-un-fournisseur-llm): Ajoutez un fournisseur à un projet, puis testez-le.
- [Choisir une URL de base pour un modèle auto-hébergé](#choisir-une-url-de-base-pour-un-modèle-auto-hébergé): Une adresse que le serveur OneUptime peut joindre.
:::

## Ce qu'un fournisseur alimente

- **Investigations** : OneUptime AI enquête sur les nouveaux incidents et les nouvelles alertes et publie dans la chronologie une analyse de cause racine sourcée. Voir [AI SRE](/docs/ai/ai-sre).
- **Questions** : **Demander à l'IA** répond à partir des données de votre projet, avec une source pour chaque affirmation. Voir [Demander à l'IA](/docs/ai/ask-ai).
- **Brouillons** : **Rédiger avec l'IA** dans les notes des incidents, des alertes et des maintenances planifiées, et les postmortems, rédigés à la demande ou lorsqu'un incident est résolu.
- **Code** : des pull requests qui corrigent les exceptions, les traces lentes et les causes que trouvent les investigations, depuis OneUptime ou depuis GitHub. Voir [Code](/docs/ai/ai-agent).
- **Tout le reste** : le tri d'AI Insights, les étapes d'IA des workflows et des runbooks, et les réponses dans Slack et Microsoft Teams.

## Quel fournisseur l'IA utilise

Les fonctionnalités d'IA utilisent le fournisseur par défaut du projet. Un projet sans fournisseur par défaut utilise le fournisseur global, s'il y en a un. Demander à l'IA peut aussi faire passer une conversation à un autre des fournisseurs du projet, ou à un fournisseur global.

```mermaid title="Quel fournisseur une fonctionnalité d'IA utilise"
flowchart TB
    F["Une fonctionnalité d'IA<br/>a besoin<br/>d'un modèle"] --> D{"Le projet a-t-il<br/>un fournisseur<br/>par défaut ?"}
    D -->|"oui"| P["Le fournisseur<br/>par défaut<br/>du projet"]
    D -->|"non"| G{"Y a-t-il un<br/>fournisseur<br/>global ?"}
    G -->|"oui"| GP["Le fournisseur<br/>global :<br/>crédits IA sur<br/>OneUptime Cloud"]
    G -->|"non"| N["Rien ne s'exécute,<br/>et les pages d'IA<br/>signalent qu'un<br/>fournisseur manque"]
```

Un fournisseur est celui par défaut d'un projet quand **Définir par défaut** est activé, ce qui est le cas pour chaque nouveau fournisseur. Un projet dont tous les fournisseurs ont cette option désactivée se rabat sur le fournisseur global, comme s'il n'en avait aucun.

Chaque règle de OneUptime AI — règles IA et règles de post-mortem — peut à la place choisir son propre fournisseur, sous **Plus de champs** : l'un des fournisseurs du projet ou un fournisseur global, utilisé pour tout ce que la règle lance. Une règle qui n'en choisit aucun utilise le fournisseur par défaut, et un fournisseur choisi qui ne peut plus être utilisé revient à celui-ci. Voir [Quel fournisseur LLM une règle utilise](/docs/ai/ai-sre#quel-fournisseur-llm-une-règle-utilise).

## OneUptime Cloud

Sur **OneUptime Cloud**, chaque projet peut utiliser le fournisseur global sans configuration. Il est prêt pour chaque fonctionnalité d'IA et il est payé sur les crédits IA du projet.

Pour utiliser plutôt vos propres clés API ou un modèle particulier, ajoutez votre propre fournisseur, comme ci-dessous : l'IA qui s'exécute sur votre propre fournisseur ne vous est pas facturée.

Le fournisseur LLM global est payé sur les crédits IA du projet. Pour plafonner ce que l'IA peut dépenser chaque jour, définissez une **Limite quotidienne de dépenses IA (USD)** sous **Paramètres du projet → IA → Fonctionnalités IA → Plus de paramètres** ; une **Limite quotidienne de jetons IA** au même endroit plafonne les jetons sur n'importe quel fournisseur, le vôtre compris. Voir [les limites quotidiennes propres au projet](/docs/ai/ai-sre#les-limites-quotidiennes-propres-au-projet).

OneUptime Cloud ne peut joindre que des points de terminaison LLM sur l'internet public. Il ne peut pas se connecter à un modèle sur votre réseau privé, comme un serveur Ollama ou vLLM auto-hébergé. Pour utiliser un modèle que vous exécutez vous-même, auto-hébergez OneUptime sur un réseau qui peut le joindre, ou exposez le modèle sur un point de terminaison public : voir [Choisir une URL de base pour un modèle auto-hébergé](#choisir-une-url-de-base-pour-un-modèle-auto-hébergé).

## Auto-hébergé : sans configuration via les variables d'environnement

Sur une instance auto-hébergée, le moyen le plus rapide d'activer l'IA pour **tous les projets à la fois** est de définir les variables d'environnement `GLOBAL_LLM_PROVIDER_*` sur votre serveur OneUptime : dans `config.env` pour Docker Compose, ou via les valeurs Helm. Au démarrage, OneUptime enregistre à partir d'elles un fournisseur LLM global et le tient à jour ; aucun projet n'a rien à configurer, et les tâches de correction IA l'utilisent aussi quand un projet n'a pas de fournisseur propre.

| Variable | Description |
| --- | --- |
| `GLOBAL_LLM_PROVIDER_TYPE` | Requise pour l'activer. L'une de `OpenAI`, `AzureOpenAI`, `Anthropic`, `Groq`, `Mistral`, `Ollama`, `OpenAICompatible` |
| `GLOBAL_LLM_PROVIDER_API_KEY` | La clé API : requise pour OpenAI, Azure OpenAI, Anthropic, Groq et Mistral ; inutile pour Ollama ou pour un serveur compatible OpenAI sans clé |
| `GLOBAL_LLM_PROVIDER_BASE_URL` | Le point de terminaison : requis pour Azure OpenAI, Ollama et les serveurs compatibles OpenAI |
| `GLOBAL_LLM_PROVIDER_MODEL_NAME` | Le modèle à utiliser. Facultatif : s'il n'est pas défini, OneUptime utilise le modèle par défaut du fournisseur et, sur un serveur compatible OpenAI, le premier modèle que liste le serveur |
| `GLOBAL_LLM_PROVIDER_NAME` | Un nom convivial facultatif, affiché dans le tableau de bord |

:::tabs
@tab Ollama
```bash
GLOBAL_LLM_PROVIDER_TYPE=Ollama
# An address the OneUptime server can reach. Never localhost: see
# "Choosing a Base URL for a Self-Hosted Model" below.
GLOBAL_LLM_PROVIDER_BASE_URL=http://ollama:11434
GLOBAL_LLM_PROVIDER_MODEL_NAME=llama3.1
# No API key needed — Ollama is keyless.
```
@tab OpenAI
```bash
GLOBAL_LLM_PROVIDER_TYPE=OpenAI
GLOBAL_LLM_PROVIDER_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
GLOBAL_LLM_PROVIDER_MODEL_NAME=gpt-5.1
```
:::

La synchronisation est déclarative : modifiez une variable et le fournisseur suit au prochain redémarrage ; retirez `GLOBAL_LLM_PROVIDER_TYPE` et le fournisseur est supprimé. Les fournisseurs globaux créés à la main dans l'Admin Dashboard ne sont jamais modifiés. Un projet peut toujours ajouter son propre fournisseur sous **Paramètres du projet → IA → Fournisseurs LLM**, et un fournisseur qui appartient au projet passe toujours en premier.

## Fournisseurs pris en charge

| Fournisseur | À quoi il sert | Clé API requise | URL de base requise |
| --- | --- | --- | --- |
| **OpenAI** | GPT-5.1 et les autres modèles OpenAI | Oui | Non (utilise la valeur par défaut) |
| **Azure OpenAI / Microsoft Foundry** | Les modèles que vous déployez dans Microsoft Foundry ou Azure OpenAI : modèles OpenAI, Foundry Models et Claude | Oui | Oui |
| **Anthropic** | Claude Sonnet 5.5, Claude Opus 5.5, Claude Haiku 5.5 et les autres modèles Claude | Oui | Non (utilise la valeur par défaut) |
| **Groq** | Inférence rapide pour Llama, Mixtral et d'autres modèles ouverts | Oui | Non (utilise la valeur par défaut) |
| **Mistral** | Les modèles hébergés de Mistral | Oui | Non (utilise la valeur par défaut) |
| **Ollama** | Des modèles open source que vous exécutez vous-même, comme Llama 3.1, Mistral ou Qwen | Non | Oui |
| **OpenAI Compatible** | N'importe quel serveur compatible OpenAI : vLLM, LocalAI, LM Studio et d'autres | Non (facultative) | Oui |

## Configurer un fournisseur LLM

:::steps
### Ouvrir les fournisseurs LLM

Allez dans **Paramètres du projet → IA → Fournisseurs LLM** (la section **IA** du menu latéral est repliée au départ) et cliquez sur **Créer : Fournisseur LLM**.

### Choisir le fournisseur

Dans **Fournisseur**, choisissez votre **Fournisseur LLM** : une carte pour OpenAI, Anthropic, Azure OpenAI / Microsoft Foundry, Groq, Mistral, Ollama et tout serveur compatible OpenAI, chacune disant en une ligne ce qu'il est.

### Le connecter

Dans **Connexion**, le formulaire ne demande que ce que ce fournisseur utilise, avec sa propre aide sous chaque champ :

- **Clé API** : votre clé API, requise pour OpenAI, Azure OpenAI, Anthropic, Groq et Mistral et facultative pour un serveur compatible OpenAI ; elle n'est pas demandée pour Ollama
- **URL de base** : le point de terminaison, requis pour Azure OpenAI, Ollama et OpenAI Compatible ; pour les autres, seulement pour passer par un proxy ou une passerelle
- **Nom du modèle** : le modèle à utiliser, comme `gpt-5.1`, `claude-sonnet-5-5` ou `llama3.1`. Laissé vide, OneUptime utilise le modèle par défaut du fournisseur ; un serveur compatible OpenAI n'en a pas, alors OneUptime lui demande quels modèles il sert et utilise le premier qu'il liste
- **Nom** : le nom du fournisseur, jusqu'à ce que vous saisissiez le vôtre, comme "Production OpenAI" ou "Local Ollama"
- **Plus de champs**, replié sous les champs ci-dessus : une **Description**, **Définir par défaut**, activé pour un nouveau fournisseur parce que les fonctionnalités d'IA n'utilisent que le fournisseur par défaut du projet, et **Paramètres supplémentaires**, un objet JSON facultatif de paramètres en plus envoyés au fournisseur avec chaque requête (par exemple `{"temperature": 0.2}`)

**Qui peut voir un fournisseur.** Les fournisseurs LLM d'un projet ne sont lus que par ses membres qui peuvent lire les paramètres du projet : **Project Owner**, **Project Admin**, **Project Member**, **Viewer**, **Settings Admin**, **Settings Member**, **Settings Viewer** et **Read LLM**. La **Clé API** et les **Paramètres supplémentaires** d'un fournisseur ne sont lus que par les propriétaires et les administrateurs du projet, car les paramètres sont envoyés au fournisseur avec chaque requête et peuvent contenir un jeton ou un en-tête, tout comme la clé. Les autres membres voient si des paramètres sont enregistrés, pas lesquels. Les membres qui peuvent modifier un fournisseur peuvent toujours remplacer sa clé API ou ses paramètres sans les lire : dans le formulaire de modification, ces champs sont vides au départ, et en laisser un vide conserve la valeur enregistrée. Pour supprimer les paramètres, enregistrez `{}`. Seuls les propriétaires et les administrateurs du projet peuvent changer l'**URL de base** d'un fournisseur, car sa clé API et ses paramètres supplémentaires sont envoyés à cette adresse ; les autres membres qui peuvent modifier un fournisseur peuvent changer tout le reste. Quiconque peut lire un fournisseur peut lire son **URL de base**, alors n'y mettez jamais de clé, de jeton ou de mot de passe : utilisez la **Clé API**. La liste **Fournisseurs LLM globaux** sur la même page, les fournisseurs partagés sur lesquels un projet se rabat, affiche leur nom, leur description et leur prix à toute personne connectée, et rien d'autre à leur sujet.

### Le tester

**Tester un fournisseur.** **Tester**, sur la page du fournisseur ou dans le menu de sa ligne, envoie au fournisseur un court prompt avec sa **Clé API**, son **Nom du modèle**, son **URL de base** et ses **Paramètres supplémentaires**, et indique s'il a répondu et appelé un outil, ce dont les fonctionnalités d'IA de OneUptime ont besoin. Un test échoué indique d'abord quoi vérifier, puis ce que le fournisseur a répondu. Quiconque peut modifier un fournisseur peut le tester : **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member** et **Edit LLM**. Toutes les autres personnes qui voient le fournisseur trouvent **Tester** verrouillé. Un fournisseur LLM global est testé par un administrateur du serveur, dans l'Admin Dashboard sous **Paramètres → Fournisseurs LLM globaux**.
:::

## Configuration propre à chaque fournisseur

### OpenAI

1. Obtenez votre clé API sur [OpenAI Platform](https://platform.openai.com/api-keys)
2. Sélectionnez **OpenAI** comme fournisseur LLM
3. Saisissez votre clé API
4. Choisissez un nom de modèle :
   - `gpt-5.1` - Valeur par défaut recommandée, solide en appels d'outils et en investigations complexes
   - `gpt-5.1-mini` - Plus rapide et plus économique

```text title="Example configuration"
Name: Production OpenAI
LLM Provider: OpenAI
API Key: sk-xxxxxxxxxxxxxxxxxxxx
Model Name: gpt-5.1
```

### Anthropic

1. Obtenez votre clé API dans la [Anthropic Console](https://console.anthropic.com/)
2. Sélectionnez **Anthropic** comme fournisseur LLM
3. Saisissez votre clé API
4. Choisissez un nom de modèle :
   - `claude-sonnet-5-5` - Valeur par défaut recommandée, le meilleur équilibre entre intelligence, vitesse et coût
   - `claude-opus-5-5` - Plus performant, pour les investigations les plus difficiles
   - `claude-haiku-5-5` - Le plus rapide et le plus économique

```text title="Example configuration"
Name: Production Anthropic
LLM Provider: Anthropic
API Key: sk-ant-xxxxxxxxxxxxxxxxxxxx
Model Name: claude-sonnet-5-5
```

Claude Opus 4.7 et tous les modèles Claude ultérieurs choisissent eux-mêmes leur échantillonnage et refusent une requête qui définit `temperature`, `top_p` ou `top_k`. OneUptime omet ces paramètres pour ces modèles. Si un modèle en refuse un malgré tout, OneUptime renvoie la requête sans lui et s'en souvient pour le fournisseur.

Les modèles Claude 5 réfléchissent avant de répondre, et cette réflexion compte dans la limite de jetons de la réponse, alors OneUptime lui laisse de la place. Pour qu'ils réfléchissent moins et répondent plus vite et pour moins cher, définissez `{"output_config": {"effort": "low"}}` dans les **Paramètres supplémentaires** du fournisseur. OneUptime envoie à Anthropic les paramètres que vous y ajoutez avec chaque requête, sauf `model`, `messages`, `system`, `tools`, `tool_choice` et `stream`, qu'il définit lui-même.

OneUptime utilise la mise en cache des prompts d'Anthropic. Chaque appel d'une investigation ou d'une réponse de Demander à l'IA renvoie le prompt système, les outils et la conversation jusque-là, et OneUptime les marque pour le cache : un appel paie un dixième du prix ou moins pour ce que les appels précédents ont envoyé, et un quart de plus que le prix pour ce qui est nouveau, qu'il écrit dans le cache. Si une passerelle placée devant Claude refuse les marqueurs de cache, OneUptime renvoie la requête sans eux et s'en souvient pour le fournisseur. [Comment les jetons sont comptés](/docs/ai/ai-sre#comment-les-jetons-sont-comptés) explique comment les jetons mis en cache comptent dans vos limites.

### Azure OpenAI et Microsoft Foundry

Utilisez **Azure OpenAI / Microsoft Foundry** pour les modèles que vous déployez dans Microsoft Foundry ou Azure OpenAI : modèles OpenAI, autres Foundry Models et Claude. Saisissez l'une des clés de la ressource comme **Clé API**, le nom du déploiement comme **Nom du modèle**, et le point de terminaison de la ressource comme **URL de base**, par exemple `https://contoso-ai.openai.azure.com/openai/v1`. [Microsoft Foundry et Azure OpenAI](/docs/ai/microsoft-foundry) détaille le côté Azure : la ressource, les autorisations, le déploiement du modèle, les exigences réseau et le dépannage.

### Ollama (auto-hébergé)

Ollama exécute des modèles open source sur vos propres machines.

1. Installez Ollama depuis [ollama.ai](https://ollama.ai)
2. Téléchargez un modèle : `ollama pull llama3.1`
3. Assurez-vous qu'Ollama tourne et que le serveur OneUptime peut le joindre. Une installation native n'écoute que sur `127.0.0.1`, alors démarrez-la avec `OLLAMA_HOST=0.0.0.0:11434` pour accepter les connexions d'autres machines et conteneurs (l'image Docker officielle `ollama/ollama` le fait déjà)
4. Sélectionnez **Ollama** comme fournisseur LLM
5. Saisissez l'URL de base : l'adresse du serveur Ollama telle que le serveur OneUptime la joint, comme `http://ollama:11434` (OneUptime ajoute `/api/chat` lui-même). `localhost` ne fonctionne pas : voir [Choisir une URL de base pour un modèle auto-hébergé](#choisir-une-url-de-base-pour-un-modèle-auto-hébergé)
6. Saisissez le nom du modèle que vous avez téléchargé

```text title="Ollama as a service named ollama on OneUptime's Docker Compose network"
Name: Self-Hosted Ollama
LLM Provider: Ollama
Base URL: http://ollama:11434
Model Name: llama3.1
```

**Agrandir la fenêtre de contexte.** Sauf indication contraire, Ollama dimensionne la fenêtre de contexte d'un modèle selon la mémoire GPU qu'il trouve : 4k jetons en dessous de 24 Gio, 32k jusqu'à 48 Gio et 256k au-delà (les anciennes versions utilisent 2 048 ou 4 096 jetons). Les fonctionnalités d'IA de OneUptime sont des agents. Chaque requête porte leur prompt système et leurs définitions d'outils, plus de 10 000 jetons avant toute question, et une investigation IA ajoute chaque résultat de requête à la conversation au fur et à mesure. Quand une requête ne tient plus, Ollama supprime les messages les plus anciens, et la question part avec eux. Selon le modèle et la version d'Ollama, le modèle répond alors sans la question ou sans ses outils, ou la requête échoue avec "no user query found in messages" (Qwen 3.8 et ultérieurs) ou "the prompt is longer than the context length currently available to the model". OneUptime signale ces échecs comme "…the request is larger than the model's context window" et ne relance pas l'investigation. Définissez un `num_ctx` plus grand dans les **Paramètres supplémentaires** du fournisseur :

```json
{ "options": { "num_ctx": 65536 } }
```

OneUptime fusionne cet objet `options` avec les options qu'il envoie à Ollama, alors ne listez que les paramètres que vous voulez changer. 65 536 jetons, c'est ce qu'Ollama recommande pour les agents, et cela couvre la plupart des investigations. Une longue investigation peut en utiliser davantage, car OneUptime ne commence à raccourcir les anciens résultats de requêtes qu'une fois que la conversation dépasse environ 75 000 jetons : utilisez 131 072 si le modèle le permet et que votre GPU peut le contenir. Une fenêtre de contexte plus grande demande plus de mémoire, et `ollama ps` affiche le contexte obtenu par chaque modèle chargé. Pour relever plutôt la valeur par défaut pour tous les clients, définissez `OLLAMA_CONTEXT_LENGTH` sur le serveur Ollama. C'est le seul moyen quand OneUptime joint Ollama par son API `/v1` compatible OpenAI (le fournisseur **OpenAI Compatible**), qui ignore `num_ctx`. Pour un fournisseur global enregistré à partir des variables `GLOBAL_LLM_PROVIDER_*`, définissez les **Paramètres supplémentaires** dans l'Admin Dashboard sous **Paramètres → Fournisseurs LLM globaux** ; la synchronisation au démarrage ne touche pas ce champ.

**Modèles Ollama populaires :**

- `llama3.1` - Le modèle Llama 3.1 de Meta, le plus ancien Llama qui prend en charge les appels d'outils
- `llama3.3` - Le modèle Llama 3.3 de Meta
- `qwen2.5` - Le modèle Qwen 2.5 d'Alibaba
- `mistral-nemo` - Le modèle Nemo de Mistral AI

> [!NOTE]
> Les fonctionnalités d'IA de OneUptime sont des agents : elles s'appuient fortement sur les appels d'outils. Utilisez `llama3.1` ou plus récent, ou un autre modèle qui appelle des outils. Un petit modèle, ou un modèle sans appels d'outils (comme `llama2` ou le `llama3` d'origine), répond mal : il ne peut pas interroger vos moniteurs, vos incidents ou votre télémétrie, si bien que les investigations reviennent vides ou inventées.

### Choisir une URL de base pour un modèle auto-hébergé

L'URL de base d'un modèle auto-hébergé, qu'il s'agisse d'Ollama, de vLLM, de LM Studio ou de tout autre serveur compatible OpenAI, doit être une adresse que le **serveur OneUptime** peut joindre. Votre navigateur ne s'y connecte jamais.

**Les adresses de bouclage sont toujours refusées.** Avant de se connecter, OneUptime vérifie chaque adresse vers laquelle se résout le nom d'hôte de l'URL de base. `localhost`, `127.0.0.1`, `[::1]` et `0.0.0.0`, ainsi que les adresses link-local et de métadonnées cloud comme `169.254.169.254`, sont refusées dans tous les déploiements, auto-hébergés compris. C'est voulu : l'URL de base d'un fournisseur ne doit pas pouvoir servir à joindre des services sur le serveur OneUptime lui-même. Dans Docker Compose ou Kubernetes, `localhost` serait de toute façon le conteneur OneUptime, pas la machine qui exécute votre modèle.

Utilisez plutôt une adresse privée ou un nom d'hôte interne :

| Où tourne le serveur du modèle | URL de base |
| --- | --- |
| Un service sur le réseau Docker Compose de OneUptime (`oneuptime`) | Le nom du service, par ex. `http://ollama:11434` |
| Le même cluster Kubernetes que OneUptime | Le nom DNS du Service, par ex. `http://ollama.<namespace>.svc.cluster.local:11434`, sur le même modèle que le [vLLM fourni](#vllm-auto-hébergé-sur-kubernetes-helm) |
| La machine hôte elle-même, hors de tout conteneur | L'IP LAN de l'hôte, par ex. `http://192.168.1.20:11434`, ou `http://host.docker.internal:11434` sur Docker Desktop |
| Une autre machine de votre réseau | Son IP privée ou son nom d'hôte interne, par ex. `http://10.0.0.12:11434` |

Les serveurs compatibles OpenAI suivent les mêmes règles avec leur propre port et leur chemin `/v1`, par ex. `http://vllm:8000/v1`, ou `http://192.168.1.20:1234/v1` pour LM Studio. Comme une installation native d'Ollama, LM Studio n'écoute que sur `127.0.0.1` tant que vous n'activez pas **Serve on Local Network** dans ses paramètres de serveur.

**Les adresses privées fonctionnent sur les installations auto-hébergées.** Un OneUptime auto-hébergé peut joindre des adresses de réseau privé, comme `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10` et IPv6 `fc00::/7`, sauf si vous définissez `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true`, qui les refuse comme le fait OneUptime Cloud. Ce paramètre ne s'applique pas à un fournisseur LLM global, qu'un administrateur configure (avec les variables `GLOBAL_LLM_PROVIDER_*` ou dans l'Admin Dashboard) plutôt qu'un projet : il peut toujours joindre des adresses privées. Les adresses de bouclage et link-local restent refusées pour tous les fournisseurs.

**OneUptime Cloud (SaaS) ne peut pas joindre les réseaux privés.** Il refuse les adresses de réseau privé, et les noms d'hôte qui s'y résolvent, pour tous les fournisseurs LLM. Pour utiliser un modèle qui tourne sur votre propre infrastructure, auto-hébergez OneUptime sur un réseau qui peut le joindre, ou exposez le modèle sur un point de terminaison joignable publiquement. Protégez un point de terminaison public par une clé API : le fournisseur **Ollama** n'envoie aucun identifiant, tandis qu'**OpenAI Compatible** envoie la clé API comme jeton bearer (Ollama sert aussi une API compatible OpenAI sous `/v1`, il peut donc se placer derrière un proxy inverse qui vérifie la clé).

### OpenAI Compatible (vLLM, LocalAI, LM Studio et autres)

Utilisez le fournisseur **OpenAI Compatible** pour tout serveur qui implémente l'API `/chat/completions` d'OpenAI sans être OpenAI lui-même, par exemple [vLLM](https://docs.vllm.ai), [LocalAI](https://localai.io), [LM Studio](https://lmstudio.ai) ou text-generation-webui. Ils tournent généralement à votre propre adresse, souvent sans authentification.

1. Démarrez votre serveur compatible OpenAI et notez son URL de base (elle se termine généralement par `/v1`)
2. Sélectionnez **OpenAI Compatible** comme fournisseur LLM
3. Saisissez l'**URL de base** (requise), par ex. `http://your-server:8000/v1`. Le serveur OneUptime doit la joindre, donc pas `localhost` : voir [Choisir une URL de base pour un modèle auto-hébergé](#choisir-une-url-de-base-pour-un-modèle-auto-hébergé)
4. Saisissez le **Nom du modèle**, ou laissez-le vide : OneUptime demande alors à votre serveur quels modèles il sert et utilise le premier qu'il liste, c'est-à-dire, sur vLLM, le modèle qu'il sert. Un nom saisi doit correspondre à un modèle que votre serveur sert
5. Saisissez la **Clé API** seulement si votre serveur en demande une ; laissez-la vide pour un serveur sans clé

```text title="A keyless vLLM"
Name: Self-Hosted vLLM
LLM Provider: OpenAI Compatible
Base URL: http://vllm.internal:8000/v1
Model Name: meta-llama/Llama-3.1-8B-Instruct
API Key: (leave blank)
```

> [!TIP]
> Après l'enregistrement, utilisez **Tester** sur le fournisseur pour vérifier la connexion, le nom du modèle et l'URL de base.

### vLLM auto-hébergé sur Kubernetes (Helm)

Si vous auto-hébergez OneUptime avec le chart Helm, vous pouvez exécuter [vLLM](https://docs.vllm.ai), un serveur d'inférence compatible OpenAI, dans votre cluster et servir des modèles locaux sur vos propres GPU. Aucune donnée ne quitte votre infrastructure.

1. Activez-le dans vos valeurs Helm (il faut des nœuds GPU NVIDIA) :

   ```yaml
   vllm:
     enabled: true
     model: Qwen/Qwen2.5-1.5B-Instruct
   ```

2. Exécutez `helm upgrade` et attendez que le pod vLLM soit Ready (le premier démarrage télécharge le modèle)
3. C'est tout : vLLM est enregistré automatiquement comme fournisseur LLM global au démarrage (`vllm.globalProvider.enabled`, par défaut `true`), si bien que les fonctionnalités d'IA marchent pour tous les projets, y compris les tâches de correction IA. (Partout, dans le cloud comme en auto-hébergé, les tâches de correction de l'agent utilisent le fournisseur global quand le projet n'a pas de fournisseur propre ; dans le cloud, cet usage est facturé en jetons IA mesurés. Un fournisseur propre au projet passe toujours en premier.)

Si vous avez désactivé l'enregistrement automatique (`vllm.globalProvider.enabled: false`), créez le fournisseur à la main :

1. Sélectionnez **OpenAI Compatible** comme fournisseur LLM (vLLM parle l'API OpenAI)
2. Saisissez l'URL de base interne au cluster : `http://<release>-vllm.<namespace>.svc.cluster.local:8000/v1` (remplacez `cluster.local` si vous avez changé `global.clusterDomain`)
3. Saisissez le nom du modèle : l'identifiant complet du modèle Hugging Face (ou `vllm.servedModelName` si vous en avez défini un), ou laissez-le vide pour utiliser le modèle que sert vLLM
4. Saisissez la clé API seulement si vous avez défini `vllm.apiKey` ; laissez-la vide pour un vLLM sans clé

```text title="The in-cluster vLLM"
Name: In-Cluster vLLM
LLM Provider: OpenAI Compatible
Base URL: http://oneuptime-vllm.default.svc.cluster.local:8000/v1
Model Name: Qwen/Qwen2.5-1.5B-Instruct
API Key: (leave blank unless vllm.apiKey is set)
```

Avec la facturation activée, ou avec `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true` (`outboundConnections.blockPrivateNetwork: true` dans les valeurs Helm), le fournisseur propre d'un projet ne peut pas joindre cette adresse interne au cluster, qui se résout en une IP privée du cluster. Créez plutôt le fournisseur dans l'Admin Dashboard sous **Paramètres → Fournisseurs LLM globaux**, avec les mêmes champs : un fournisseur LLM global peut joindre cette adresse.

Voir le [guide vLLM du chart Helm](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/ai-vllm.md) pour la planification des GPU, les modèles à accès restreint et les options de réglage.

## Bonnes pratiques

- **Nommez clairement les fournisseurs**, comme "Production OpenAI" ou "Development Ollama", pour qu'un collègue sache lequel est lequel.
- **Gardez les clés dans le champ Clé API.** Les clés API sont chiffrées au repos, et seuls les propriétaires et les administrateurs du projet les lisent.
- **Testez après chaque modification**, avec **Tester** sur le fournisseur.
- **Surveillez ce que coûte l'IA.** Chaque appel est listé avec ses jetons et son coût sous **Paramètres du projet → IA → Journaux IA**.

## Dépannage

:::details Le fournisseur est injoignable
- **OpenAI ou Anthropic** : vérifiez que votre clé API est valide et dispose de crédits
- **Azure OpenAI / Microsoft Foundry** : l'erreur commence par ce qu'il faut changer. [Microsoft Foundry et Azure OpenAI](/docs/ai/microsoft-foundry) explique chaque erreur que renvoie Azure
- **Ollama** : vérifiez que le serveur Ollama tourne, écoute sur une adresse que le serveur OneUptime peut joindre (`OLLAMA_HOST=0.0.0.0:11434` pour une installation native) et que l'URL de base pointe vers cette adresse
- **OpenAI Compatible** : vérifiez que l'URL de base se termine par `/v1` (ou correspond à votre serveur), que le nom du modèle, si vous en avez saisi un, correspond à un modèle que votre serveur sert, et que vous n'avez défini une clé API que si votre serveur en demande une. Si le nom du modèle est vide et que le serveur ne liste aucun modèle sur son point de terminaison `/models`, saisissez-en un
- **"…points to an address OneUptime is not allowed to connect to"** : l'URL de base se résout en une adresse refusée : `localhost` ou une autre adresse de bouclage, ou, sur OneUptime Cloud, une adresse de réseau privé. (OneUptime Cloud signale plutôt un nom d'hôte refusé comme "…could not be reached".) Voir [Choisir une URL de base pour un modèle auto-hébergé](#choisir-une-url-de-base-pour-un-modèle-auto-hébergé)
- **Un pare-feu** : vérifiez que votre réseau autorise les connexions sortantes vers l'API du fournisseur
:::

:::details Le modèle est introuvable
Vérifiez l'orthographe du nom du modèle. Pour Ollama, téléchargez d'abord le modèle avec `ollama pull <model-name>`. Certains modèles ne sont disponibles que dans certaines régions.
:::

:::details La fenêtre de contexte est trop petite
- **"…the request is larger than the model's context window"** : la requête ne tenait pas dans la fenêtre de contexte du modèle, généralement parce qu'une investigation IA a rassemblé beaucoup de preuves. Augmentez `num_ctx` dans les **Paramètres supplémentaires** du fournisseur, ou `OLLAMA_CONTEXT_LENGTH` sur le serveur Ollama ; voir [Ollama (auto-hébergé)](#ollama-auto-hébergé)
- **"no user query found in messages"** : le même problème, tel que Qwen le signale. OneUptime envoie toujours la question ; Ollama l'a supprimée pour faire tenir le reste de la requête
:::

Toujours bloqué ? Cherchez votre erreur dans les [issues GitHub de OneUptime](https://github.com/OneUptime/oneuptime/issues), ou contactez le support si votre offre l'inclut.

## Étapes suivantes

:::cards
- [Code](/docs/ai/ai-agent): Les pull requests que rédige votre fournisseur, et là où elles démarrent.
- [AI SRE](/docs/ai/ai-sre): Ce que OneUptime AI fait du fournisseur une fois qu'il en a un.
- [Demander à l'IA](/docs/ai/ask-ai): Posez une question à votre projet, et changez le fournisseur d'une conversation.
:::
