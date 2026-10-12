# Passerelles IA (LiteLLM, Portkey)

Une passerelle IA se place entre vos applications et les fournisseurs de modèles, donc chaque appel au modèle passe par elle. Envoyez une fois l'OpenTelemetry de la passerelle à OneUptime, et chaque appel qu'elle sert arrive dans [IA / LLM](/docs/telemetry/ai-llm-observability) avec son modèle, ses tokens, son coût et, sauf si vous le désactivez, le prompt et la réponse, sans instrumenter chaque application.

:::cards
- [LiteLLM Proxy](#litellm-proxy): Export intégré, réglé avec trois variables.
- [Qui a dépensé quoi](#une-clé-virtuelle-par-employé): Une clé virtuelle LiteLLM par employé nomme chaque personne.
- [Portkey](#portkey): Export intégré sur les passerelles auto-hébergées ; ailleurs, instrumentez l'application.
- [Vérifier que les appels arrivent](#vérifier-que-les-appels-arrivent): Ce que vous devriez voir, et que faire sinon.
:::

## Fonctionnement

```mermaid title="Un seul export couvre chaque application derrière la passerelle"
flowchart TB
    apps["Vos applications, agents<br/>et outils de code"] --> gateway["Passerelle IA :<br/>LiteLLM ou Portkey"]
    gateway --> providers["Fournisseurs de modèles"]
    gateway -->|"Traces OTLP"| ingest["OneUptime"]
    ingest --> llm["IA / LLM : appels,<br/>utilisation et coût"]
```

| | LiteLLM Proxy | Portkey, auto-hébergé ou Enterprise | Portkey, open source ou hébergé |
| --- | --- | --- | --- |
| Export vers OneUptime | Intégré | Intégré, expérimental | Aucun : instrumentez plutôt l'application |
| Endpoint à régler | `https://oneuptime.com/otlp/v1/traces` | `https://oneuptime.com/otlp` | L'exporteur propre de l'application |
| Nomme chaque personne | Oui, avec une clé virtuelle par employé | Non | Seulement ce que l'application envoie |
| Prompts et réponses | Envoyés sauf si vous les désactivez | Toujours envoyés | Dépend de l'instrumentation |

## Avant de commencer

- Une clé d'ingestion : ouvrez **Paramètres du projet → Télémétrie & APM → Clés d'ingestion** et cliquez sur **Créer une clé d'ingestion**.
- Votre URL de base OTLP : `https://oneuptime.com/otlp`, ou `https://YOUR-ONEUPTIME-HOST/otlp` si vous hébergez OneUptime vous-même. OneUptime accepte OTLP sur HTTP, en protobuf et en JSON.
- La clé voyage dans l'en-tête `x-oneuptime-token` de chaque requête d'export.

## LiteLLM Proxy

Le callback OpenTelemetry de LiteLLM fait partie du proxy open source, et l'image Docker officielle (`ghcr.io/berriai/litellm`) embarque les paquets dont il a besoin.

:::steps
### Activer le callback otel

Ajoutez `otel` aux callbacks dans le `config.yaml` du proxy :

```yaml title="config.yaml"
model_list:
  - model_name: gpt-4o
    litellm_params:
      model: openai/gpt-4o
      api_key: os.environ/OPENAI_API_KEY

litellm_settings:
  callbacks: ["otel"]
```

### Diriger l'exporteur vers OneUptime

Définissez trois variables sur le proxy :

```bash
export OTEL_EXPORTER="otlp_http"
export OTEL_ENDPOINT="https://oneuptime.com/otlp/v1/traces"
export OTEL_HEADERS="x-oneuptime-token=YOUR_INGESTION_TOKEN"
```

### Démarrer le proxy

:::tabs
@tab Docker
```bash
docker run \
  -v $(pwd)/config.yaml:/app/config.yaml \
  -e OPENAI_API_KEY="sk-..." \
  -e OTEL_EXPORTER="otlp_http" \
  -e OTEL_ENDPOINT="https://oneuptime.com/otlp/v1/traces" \
  -e OTEL_HEADERS="x-oneuptime-token=YOUR_INGESTION_TOKEN" \
  -e OTEL_SERVICE_NAME="litellm-gateway" \
  -p 4000:4000 \
  ghcr.io/berriai/litellm:main-stable \
  --config /app/config.yaml
```
@tab pip
```bash
pip install 'litellm[proxy]' opentelemetry-api opentelemetry-sdk opentelemetry-exporter-otlp
litellm --config config.yaml
```
:::

`litellm[proxy]` seul n'inclut pas les paquets OpenTelemetry, donc installez-les avec.

### Envoyer une requête à travers lui

Appelez le proxy une fois, puis vérifiez IA / LLM comme décrit dans [Vérifier que les appels arrivent](#vérifier-que-les-appels-arrivent).
:::

| Variable | Valeur | Remarques |
| --- | --- | --- |
| `OTEL_EXPORTER` | `otlp_http` | Également lue sous le nom `OTEL_EXPORTER_OTLP_PROTOCOL` |
| `OTEL_ENDPOINT` | `https://oneuptime.com/otlp/v1/traces` | Le chemin complet `/v1/traces` fonctionne avec toutes les versions de LiteLLM ; également lue sous le nom `OTEL_EXPORTER_OTLP_ENDPOINT` |
| `OTEL_HEADERS` | `x-oneuptime-token=YOUR_INGESTION_TOKEN` | Paires `key=value` séparées par des virgules ; également lue sous le nom `OTEL_EXPORTER_OTLP_HEADERS` |
| `OTEL_SERVICE_NAME` | Le nom de votre passerelle | Le service sous lequel ses appels apparaissent ; `litellm` par défaut |

### Ce que LiteLLM envoie

Chaque appel porte `gen_ai.system`, `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.usage.input_tokens` et `gen_ai.usage.output_tokens`, ses paramètres, ainsi que le prompt et la réponse : tout ce dont OneUptime a besoin pour [lire l'appel](/docs/telemetry/ai-llm-observability).

Depuis LiteLLM 1.81, ces attributs sont sur le span `Received Proxy Server Request` de la requête, et il n'y a plus de span `litellm_request` séparé. Quand une requête fait plusieurs appels au modèle, chaque appel y écrase les attributs du précédent : définissez donc `USE_OTEL_LITELLM_REQUEST_SPAN=true` pour obtenir un span `litellm_request` par appel.

LiteLLM fixe lui-même le prix de chaque appel, y compris les tarifs personnalisés réglés sur le proxy, et le rapporte dans `gen_ai.cost.total_cost`. OneUptime préfère un coût rapporté à sa propre estimation, et [estime à partir des tokens](/docs/telemetry/ai-llm-observability) seulement quand LiteLLM n'a pas pu fixer de prix, par exemple pour un modèle personnalisé sans prix défini.

### Une clé virtuelle par employé

Donnez à chaque personne sa propre clé virtuelle LiteLLM, et chaque appel qu'elle fait arrive avec son identité. LiteLLM écrit sur le span l'ID, l'e-mail et l'équipe du propriétaire de la clé, et OneUptime les lit comme l'employé et l'équipe, si bien que l'onglet **Utilisation** classe la dépense par personne sans rien configurer sur leurs machines.

Les clés virtuelles exigent une base de données et une clé maître sur le proxy (`DATABASE_URL` et `LITELLM_MASTER_KEY`). Créez un utilisateur avec son e-mail, puis une clé pour cet utilisateur :

```bash
curl -X POST "http://localhost:4000/user/new" \
  -H "Authorization: Bearer YOUR_MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"user_email": "alice@example.com"}'

curl -X POST "http://localhost:4000/key/generate" \
  -H "Authorization: Bearer YOUR_MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"user_id": "USER_ID_FROM_THE_FIRST_CALL", "team_id": "platform"}'
```

| Attribut de span LiteLLM | OneUptime le lit comme |
| --- | --- |
| `metadata.user_api_key_user_id` | L'ID de l'employé |
| `metadata.user_api_key_user_email` | L'e-mail de l'employé |
| `metadata.user_api_key_team_id` | L'équipe |
| `metadata.user_api_key_end_user_id` | Jamais l'employé : c'est le `user` que votre application envoie pour son propre client |

Dans le mode OpenTelemetry v2 de LiteLLM, les mêmes valeurs arrivent avec un préfixe `litellm.` (`litellm.metadata.user_api_key_user_email` et ainsi de suite), que OneUptime lit aussi.

### Garder les prompts dehors

Le callback `otel` envoie par défaut les prompts et les réponses complets. Pour les garder dehors, utilisez l'une de ces options :

:::tabs
@tab Tous les callbacks
```yaml title="config.yaml"
litellm_settings:
  callbacks: ["otel"]
  turn_off_message_logging: true
```
@tab Le callback OTel seul
```yaml title="config.yaml"
litellm_settings:
  callbacks: ["otel"]

callback_settings:
  otel:
    message_logging: False
```
@tab Variable d'environnement
```bash
export OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT="NO_CONTENT"
```
:::

`callback_settings` est une clé de premier niveau, pas une clé sous `litellm_settings`. Pour garder les prompts mais en masquer des parties, utilisez plutôt les règles de nettoyage sous **Traces → Paramètres**.

:::details Le mode OpenTelemetry v2 de LiteLLM
Les versions récentes de LiteLLM ont un mode OpenTelemetry v2 optionnel (`LITELLM_OTEL_V2=true`, sans changement de `config.yaml`). Il envoie une trace par requête, avec le traitement HTTP, l'authentification, les garde-fous et l'appel au modèle sous forme de spans GenAI nommés comme `chat gpt-4o`. En mode v2, les prompts sont désactivés par défaut ; activez-les avec `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT`. Son coût arrive dans `litellm.cost.total`, que OneUptime lit aussi. Utilisez un mode ou l'autre, pas les deux.
:::

## Portkey

Ce que Portkey peut envoyer dépend de la façon dont vous l'exécutez :

| Déploiement | Export vers OneUptime |
| --- | --- |
| Passerelle auto-hébergée ou Enterprise | Intégré (expérimental) : définissez les variables ci-dessous |
| Passerelle open source (`portkey-ai/gateway`) | Aucun : instrumentez l'application qui l'appelle |
| Passerelle hébergée (portkey.ai) | Aucun côté passerelle : instrumentez l'application qui l'appelle |

Portkey a aussi son propre endpoint OpenTelemetry (`api.portkey.ai/v1/otel`). Il reçoit des traces dans Portkey, la direction inverse de cette page.

### Passerelles auto-hébergées et Enterprise

Définissez ces variables sur le conteneur de la passerelle :

```yaml title="docker-compose.yml"
services:
  portkey-gateway:
    environment:
      EXPERIMENTAL_GEN_AI_OTEL_TRACES_ENABLED: "true"
      EXPERIMENTAL_GEN_AI_OTEL_EXPORTER_OTLP_ENDPOINT: "https://oneuptime.com/otlp"
      EXPERIMENTAL_GEN_AI_OTEL_EXPORTER_OTLP_HEADERS: "x-oneuptime-token=YOUR_INGESTION_TOKEN"
```

- Donnez l'URL de base OTLP : Portkey ajoute `/v1/traces` lui-même.
- Les en-têtes sont des paires `key=value` séparées par des virgules. `EXPERIMENTAL_GEN_AI_OTEL_RESOURCE_ATTRIBUTES` ajoute des attributs de ressource de la même façon, par exemple `deployment.environment=production`.
- Portkey envoie OTLP sur HTTP en JSON uniquement, ce que OneUptime accepte sans collecteur intermédiaire.
- Chaque appel est un span nommé `{operation} {model}`, par exemple `chat gpt-4o`, sous le service `portkey`, avec `gen_ai.provider.name`, le modèle demandé et le modèle servi, les nombres de tokens, `gen_ai.conversation.id`, et les messages dans `gen_ai.input.messages` et `gen_ai.output.messages`.
- Les prompts et les réponses complets sont toujours inclus. Masquez ce qu'il faut avec les règles de nettoyage sous **Traces → Paramètres**.
- Chaque appel est envoyé seul après la réponse, sans regroupement ni nouvelle tentative : un export échoué est perdu. Traitez-le comme de l'observabilité, pas comme un journal d'audit.
- Quand votre `x-portkey-trace-id` est un ID de trace valide (32 caractères hexadécimaux), Portkey le réutilise, si bien que les spans de la passerelle rejoignent la trace de votre application.

Portkey indique que cet export est expérimental. Si les variables n'ont aucun effet, confrontez la documentation actuelle de Portkey à la version de votre passerelle.

### Passerelles open source et hébergées

La passerelle open source n'a pas d'exporteur, et sur la passerelle hébergée vous ne pouvez pas définir ses variables. Instrumentez plutôt l'application qui appelle Portkey. Portkey parle l'API OpenAI, donc les instrumentations GenAI de [Observabilité IA / LLM](/docs/telemetry/ai-llm-observability) (OpenLLMetry, OpenInference, OpenLIT) tracent les appels de votre SDK même quand l'URL de base pointe vers Portkey :

```python
from traceloop.sdk import Traceloop
from openai import OpenAI

Traceloop.init(
    app_name="my-ai-agent",
    api_endpoint="https://oneuptime.com/otlp",
    headers={"x-oneuptime-token": "YOUR_INGESTION_TOKEN"},
)

client = OpenAI(
    base_url="https://api.portkey.ai/v1",   # or your gateway's URL
    default_headers={"x-portkey-api-key": "PORTKEY_API_KEY"},
)
# Calls through Portkey are now traced to OneUptime.
```

Ces spans décrivent l'appel tel que votre application l'a fait : le modèle demandé, le temps d'attente, les tokens reçus. Ce que la passerelle a décidé en route, comme un repli, une nouvelle tentative ou un succès de cache, reste dans Portkey. Pour le voir dans OneUptime, utilisez l'export de la passerelle auto-hébergée.

## Vérifier que les appels arrivent

:::steps
1. Envoyez une requête à travers la passerelle et attendez quelques secondes.
2. Ouvrez **Produits → IA / LLM → Appels**. L'appel apparaît avec son fournisseur, son modèle et ses tokens.
3. Cliquez sur l'appel pour ouvrir sa trace, puis ouvrez l'onglet **LLM** du span : le modèle, les tokens, les paramètres et, sauf si vous les avez désactivés, le prompt et la réponse.
4. Ouvrez **Utilisation** : l'appel compte dans les totaux, avec le coût rapporté par la passerelle ou celui estimé par OneUptime.
:::

## Dépannage

:::details Rien n'arrive de LiteLLM
Définissez `OTEL_EXPORTER="console"` un instant. Si des spans s'affichent dans la sortie du proxy, LiteLLM trace bien, et le problème est l'endpoint ou la clé. `DEBUG_OTEL="true"` affiche ce que fait l'exporteur.
:::

:::details La clé est refusée
OneUptime répond `401` pour une clé absente, inconnue ou expirée, et `422` pour une clé désactivée ou une clé de navigateur. Créez une clé serveur sous **Paramètres du projet → Télémétrie & APM → Clés d'ingestion** et envoyez-la dans `x-oneuptime-token`.
:::

:::details L'endpoint est faux
LiteLLM prend le chemin complet, `https://oneuptime.com/otlp/v1/traces`. Portkey prend l'URL de base, `https://oneuptime.com/otlp`, et ajoute `/v1/traces` lui-même.
:::

:::details Des spans arrivent, mais pas dans IA / LLM
Filtrez **Traces** sur le service de la passerelle (`litellm`, `portkey` ou votre `OTEL_SERVICE_NAME`) pour voir ses spans bruts. Un span ne compte comme appel au modèle que s'il porte des attributs `gen_ai.*` : vérifiez que le callback est `otel` et que l'appel est allé vers un modèle.
:::

:::details La dépense apparaît comme non attribuée
Les appels ne nomment personne. Donnez à chaque employé sa propre clé virtuelle, comme dans [Une clé virtuelle par employé](#une-clé-virtuelle-par-employé). Le champ `user` envoyé par votre application nomme son client, pas l'employé, et n'est jamais lu comme l'employé.
:::

:::details Seul le dernier de plusieurs appels apparaît
Depuis LiteLLM 1.81, les appels au modèle d'une requête partagent un span. Définissez `USE_OTEL_LITELLM_REQUEST_SPAN=true` pour obtenir un span par appel.
:::

## Étapes suivantes

:::cards
- [Observabilité IA / LLM](/docs/telemetry/ai-llm-observability): Conversations, alertes, utilisation et budgets de coût quotidiens pour ces appels.
- [Assistants de code IA](/docs/telemetry/ai-coding-assistants): Placer une passerelle devant les outils qui n'envoient aucune télémétrie propre.
- [Disjoncteurs pour agents IA](/docs/telemetry/ai-agent-circuit-breaker): Arrêter un agent emballé quand son alerte se déclenche.
- [Moniteur de traces](/docs/monitor/traces-monitor): Alerter sur des motifs de spans, comme un outil appelé en boucle.
:::
