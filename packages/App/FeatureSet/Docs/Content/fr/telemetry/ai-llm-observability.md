# Observabilité IA / LLM avec OneUptime

Lisez chaque conversation de votre IA, rejouez-la telle qu'elle s'est déroulée et soyez prévenu quand elle répond mal. Tout repose sur OpenTelemetry standard, sans SDK propriétaire : si votre application émet des spans selon les **conventions sémantiques GenAI** d'OpenTelemetry (`gen_ai.*`), OneUptime en fait des conversations, des alertes, de l'utilisation et des coûts.

## Ce que vous obtenez

Ouvrez **IA / LLM** dans la barre de navigation, sous Observabilité :

- **Conversations** — chaque conversation de votre IA : ce que les gens ont demandé, ce que l'IA a répondu, les outils qu'elle a utilisés et ce qui s'est mal passé. Cinq chiffres surmontent la liste : les conversations, les réponses de l'IA, le nombre qui demandent votre attention, le coût et la durée habituelle d'une réponse. Ouvrez une conversation pour la lire ou la rejouer.
- **Appels** — chaque appel de LLM, d'embedding, d'agent et d'outil, filtrable par service, fournisseur, modèle, opération, personne et équipe. Cliquez sur un appel pour l'ouvrir dans la visionneuse de traces.
- **Utilisation** — les appels, les jetons et le coût d'une période, et qui dépense quoi : employés, équipes, modèles, fournisseurs et applications classés par dépense.
- **Alertes** — des alertes prêtes à l'emploi pour quand l'IA répond mal, et vos moniteurs IA / LLM.
- **Budgets** — des plafonds de coût quotidiens, publiés sous forme de métriques sur lesquelles alerter.
- **Tarifs** — vos propres prix par modèle, pour les modèles que le catalogue intégré ne connaît pas.
- **Configuration** — les cinq étapes ci-dessous, avec le point de terminaison de votre projet.

Dans la visionneuse de traces, le span de chaque appel à l'IA comporte aussi un panneau **IA / LLM** avec le modèle, le nombre de jetons, le coût, les paramètres de la requête, ainsi que le prompt et la complétion.

## Étape 1 — Envoyer vos appels à l'IA

Créez une clé d'ingestion de télémétrie : ouvrez **Paramètres du projet → Télémétrie & APM → Clés d'ingestion** et cliquez sur **Créer une clé d'ingestion**. Votre application transmet la clé dans un en-tête OTLP. (Voir le [guide OpenTelemetry](/docs/telemetry/open-telemetry) pour des captures d'écran.)

Instrumentez ensuite votre application avec n'importe quelle bibliothèque GenAI OpenTelemetry :

- **OpenLLMetry** (Traceloop) — OpenAI, Anthropic, Cohere, Bedrock, LangChain, LlamaIndex, CrewAI et plus.
- **OpenInference** (Arize) — OpenAI, LangChain, LlamaIndex, DSPy et plus.
- Le **Vercel AI SDK**, ou les **instrumentations OpenTelemetry** pour OpenAI, Anthropic et Gemini.

Vous faites passer votre trafic LLM par une passerelle comme **LiteLLM** ou **Portkey** ? Exportez les traces depuis la passerelle plutôt que d'instrumenter chaque application — voir [Observer les passerelles IA](/docs/telemetry/ai-gateways). Vous cherchez les assistants de code qu'utilisent vos ingénieurs — Claude Code, Cursor, Codex, Gemini CLI, Copilot ? Ils exportent leur propre OpenTelemetry et n'ont besoin de rien de votre part : voir [Observabilité des assistants de code IA](/docs/telemetry/ai-coding-assistants).

### Python (OpenLLMetry)

```bash
pip install traceloop-sdk opentelemetry-exporter-otlp
```

```python
from traceloop.sdk import Traceloop

Traceloop.init(
    app_name="my-ai-agent",
    api_endpoint="https://oneuptime.com/otlp",   # or your self-hosted host + /otlp
    headers={"x-oneuptime-token": "YOUR_INGESTION_TOKEN"},
)

# Your normal OpenAI / Anthropic / LangChain calls are now traced automatically.
```

### Node.js / TypeScript (OpenLLMetry)

```bash
npm install @traceloop/node-server-sdk
```

```ts
import * as traceloop from "@traceloop/node-server-sdk";

traceloop.initialize({
  appName: "my-ai-agent",
  baseUrl: "https://oneuptime.com/otlp", // or your self-hosted host + /otlp
  headers: { "x-oneuptime-token": "YOUR_INGESTION_TOKEN" },
});
```

### Variables d'environnement OpenTelemetry simples

Si vous instrumentez avec un SDK OpenTelemetry natif, dirigez l'exportateur OTLP vers OneUptime :

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
export OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_INGESTION_TOKEN"
export OTEL_SERVICE_NAME="my-ai-agent"
```

Vous hébergez OneUptime vous-même ? Remplacez `https://oneuptime.com/otlp` par `https://YOUR-ONEUPTIME-HOST/otlp`.

## Étape 2 — Enregistrer ce qui a été dit

Une conversation montre ce que les gens ont demandé et ce que l'IA a répondu lorsque votre instrumentation les enregistre. OpenLLMetry enregistre les prompts et les complétions sauf si vous le désactivez (`TRACELOOP_TRACE_CONTENT=false`). Les instrumentations OpenTelemetry ne les enregistrent que si vous le demandez :

```bash
export OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true
```

Sans eux, une conversation montre tout de même sa chronologie, son coût et ses problèmes, et indique que son contenu n'a pas été enregistré. Les prompts peuvent contenir des données sensibles : voir [Confidentialité et caviardage](#confidentialité-et-caviardage) pour les masquer avant leur stockage.

## Étape 3 — Regrouper les appels en conversations

Une application de chat fait un appel au modèle par tour. Renseignez `gen_ai.conversation.id` — ou `session.id` — avec l'identifiant de votre chat sur chaque appel à l'IA, et chaque chat apparaît comme une seule conversation, quel que soit le nombre d'appels et de traces qu'il a pris. Avec OpenLLMetry, définissez-le une fois par requête comme propriété d'association :

```python
from traceloop.sdk import Traceloop

Traceloop.set_association_properties({
    "session_id": chat.id,
    "user_email": user.email,
})
```

Les appels sans identifiant de conversation apparaissent quand même, une requête (une trace) à la fois.

## Étape 4 — Indiquer qui a demandé

Renseignez `user.id` ou `user.email` — la propriété d'association ci-dessus renseigne l'e-mail — pour voir avec qui chaque conversation a eu lieu, rechercher la liste par personne et classer les dépenses par employé dans l'onglet Utilisation. [Attribution aux employés et aux équipes](#attribution-aux-employés-et-aux-équipes) liste toutes les clés que OneUptime lit.

## Étape 5 — Signaler les mauvaises réponses

OneUptime vérifie chaque réponse à son arrivée et marque ce qui n'allait pas :

| Problème | Ce que cela signifie                                              | Détecté à partir de                                                                                                                                                                   |
| -------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Échec    | L'appel s'est terminé par une erreur, aucune réponse n'est arrivée | Statut de span Error, `error.type`, ou une raison de fin `error`                                                                                                                      |
| Refusée  | L'IA a refusé, ou un filtre de sécurité l'a bloquée               | Une raison de fin de refus ou de sécurité (`content_filter`, `refusal`, `SAFETY` et similaires), un refus dans la réponse, ou une réponse qui commence par un refus type en anglais |
| Coupée   | La réponse s'est arrêtée à la limite de jetons                    | Une raison de fin `length`, `max_tokens` ou `MAX_TOKENS`                                                                                                                              |
| Vide     | L'IA a répondu sans texte et sans appel d'outil                   | Un contenu enregistré qui ne contient rien, ou 0 jeton de sortie                                                                                                                      |
| Signalée | Une évaluation envoyée par votre application a jugé la réponse mauvaise | Un événement `gen_ai.evaluation.result`                                                                                                                                         |

Les quatre premiers ne vous demandent rien. Pour signaler le reste — une réponse que votre garde-fou, votre éval ou votre propre juge LLM rejette —, ajoutez un événement `gen_ai.evaluation.result` au span de la réponse, avec `gen_ai.evaluation.score.label` défini à `fail` :

```python
from opentelemetry import trace

trace.get_current_span().add_event(
    "gen_ai.evaluation.result",
    {
        "gen_ai.evaluation.name": "relevance",
        "gen_ai.evaluation.score.label": "fail",
        "gen_ai.evaluation.explanation": "The answer is about another product.",
    },
)
```

Des libellés comme `incorrect`, `wrong`, `unhelpful`, `toxic`, `unsafe` et `hallucination` comptent aussi comme un échec. L'événement doit se trouver sur le span de la réponse qu'il juge, tant que ce span est ouvert.

OneUptime n'envoie jamais vos conversations à une autre IA pour les juger : chaque vérification ne lit que ce que l'appel lui-même transporte.

## Lire et rejouer une conversation

Une conversation s'ouvre en entier, comme une application de chat affiche son historique : ce que la personne a dit à droite, les réponses de l'IA à gauche avec leur modèle, leur heure, leurs jetons et leur coût, les appels d'outils entre les deux, et ce qui a mal tourné marqué là où c'est arrivé. **Détails** sous une réponse affiche sa raison de fin et ses évaluations, avec un lien vers l'appel dans Traces.

La barre en bas rejoue la conversation telle que la personne l'a vécue :

- **Rejouer** la lit depuis le premier message au rythme où elle s'est déroulée, avec « L'IA répond… » qui compte pendant qu'une réponse est en route. Cliquez sur l'heure de n'importe quel message pour rejouer à partir de là.
- **Passer les attentes**, activé par défaut, raccourcit les silences de plus de 3 secondes. Le bouton de vitesse lit à 1×, 2×, 4× ou 8×.
- **K** lit ou met en pause, **J** ou **←** recule d'un message, et **L** ou **→** avance d'un message.
- L'adresse garde le message où une relecture s'est arrêtée (`?step=`), si bien qu'un lien s'ouvre sur ce moment précis.

## Être prévenu quand l'IA répond mal

L'onglet **Alertes** propose les alertes dont la plupart des applications d'IA ont besoin. En choisir une ouvre Créer un moniteur prérempli, où vous pouvez tout modifier avant d'enregistrer :

| Alerte                        | Quand elle vous prévient                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------- |
| Les réponses posent problème  | Plus de 5 % des réponses en 15 minutes échouent, sont refusées, coupées, vides ou signalées       |
| Les appels à l'IA échouent    | Plus de 10 % des appels au modèle en 5 minutes se terminent par une erreur                        |
| L'IA refuse de répondre       | Plus de 5 % des réponses en 30 minutes sont des refus                                             |
| Les réponses sont coupées     | 3 réponses ou plus en 30 minutes s'arrêtent à la limite de jetons                                 |
| Les réponses sont signalées   | Une évaluation marque une réponse comme mauvaise                                                  |
| Les réponses sont lentes      | Plus de 10 % des réponses en 15 minutes prennent plus de 30 secondes                              |
| L'IA ne répond plus           | L'IA ne donne aucune réponse pendant 30 minutes                                                   |

Les alertes sur une proportion attendent aussi au moins 3 mauvaises réponses, pour qu'une mauvaise réponse sur deux ne réveille personne.

Chaque alerte est un moniteur **IA / LLM**. Ses paramètres disent ce qui compte comme une mauvaise réponse — les problèmes ci-dessus, une réponse plus lente qu'une limite que vous fixez, ou les deux —, quelles applications et quel modèle il surveille, et jusqu'où remonte chaque vérification. En dessous, un aperçu montre ce que le moniteur compterait à cet instant. Ses critères comparent trois nombres : la **proportion de mauvaises réponses** (en %), le **nombre de mauvaises réponses** et le **nombre de réponses**. Une alerte prête à l'emploi déclenche une alerte qui se résout d'elle-même et affiche le moniteur comme Dégradé tant que les réponses sont mauvaises ; activez plutôt son incident pour appeler quelqu'un.

Les dépenses sont surveillées par les [budgets de coût quotidiens](#budgets-de-coût-quotidiens).

## Attributs reconnus par OneUptime

OneUptime lit d'abord les conventions GenAI d'OpenTelemetry, puis se rabat sur les variantes OpenLLMetry et OpenInference pour que les bibliothèques populaires fonctionnent d'emblée.

| Quoi                               | Attribut principal           | Également accepté                                                                                                                                                                                                                                                         |
| ---------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fournisseur / système              | `gen_ai.provider.name`       | `gen_ai.system` (obsolète dans les conventions, encore largement émis), `llm.system`, `llm.provider`                                                                                                                                                                     |
| Opération                          | `gen_ai.operation.name`      | `llm.request.type`, `openinference.span.kind`                                                                                                                                                                                                                             |
| Modèle demandé                     | `gen_ai.request.model`       | `llm.model_name`, `llm.request.model`                                                                                                                                                                                                                                     |
| Modèle de la réponse               | `gen_ai.response.model`      | `llm.response.model`                                                                                                                                                                                                                                                      |
| Jetons d'entrée                    | `gen_ai.usage.input_tokens`  | `gen_ai.usage.prompt_tokens`, `llm.token_count.prompt`, `llm.usage.prompt_tokens`                                                                                                                                                                                         |
| Jetons de sortie                   | `gen_ai.usage.output_tokens` | `gen_ai.usage.completion_tokens`, `llm.token_count.completion`, `llm.usage.completion_tokens`                                                                                                                                                                             |
| Total des jetons                   | `gen_ai.usage.total_tokens`  | `llm.token_count.total`, `llm.usage.total_tokens` ; déduit de l'entrée + la sortie quand aucun n'est fourni                                                                                                                                                              |
| Coût (USD)                         | `gen_ai.usage.cost`          | `gen_ai.usage.cost_usd`, `gen_ai.usage.total_cost`, `llm.usage.total_cost`, `gen_ai.cost.total_cost` (LiteLLM), `litellm.cost.total`                                                                                                                                      |
| Nom de l'agent                     | `gen_ai.agent.name`          | `agent.name`                                                                                                                                                                                                                                                              |
| Nom de l'outil                     | `gen_ai.tool.name`           | `tool.name`                                                                                                                                                                                                                                                               |
| Identifiant de conversation / session | `gen_ai.conversation.id`  | `session.id`, `langfuse.session.id`, `traceloop.association.properties.session_id`                                                                                                                                                                                        |
| Employé (qui a fait l'appel)       | `user.id`                    | `enduser.id`, `litellm.metadata.user_api_key_user_id` et `metadata.user_api_key_user_id` (graphies LiteLLM OTel v2 et v1 — les deux sont lues), `traceloop.association.properties.user_id`, `langfuse.user.id`, `user.account_uuid`, `user.account_id`, `cursor.user.id` |
| E-mail de l'employé                | `user.email`                 | `traceloop.association.properties.user_email`, `enduser.email`                                                                                                                                                                                                            |
| Équipe / centre de coûts           | `team.id`                    | `team`, `cost_center`, `department`, `litellm.metadata.user_api_key_team_id` et `litellm.team.id` (LiteLLM OTel v2), `metadata.user_api_key_team_id` (LiteLLM OTel v1), `cursor.team.id`                                                                                 |

Les sous-clés `traceloop.association.properties.*` sont **fournies par l'appelant** : Traceloop définit le préfixe, et votre code fournit ce qui se trouve dessous. `gen_ai.usage.total_tokens` et `gen_ai.usage.cost` sont des clés **de facto**, pas des conventions sémantiques GenAI — les conventions ne définissent ni attribut de total de jetons ni attribut de coût —, et OneUptime les lit parce que les instrumentations courantes les émettent. `gen_ai.system` est le prédécesseur obsolète de `gen_ai.provider.name` dans les conventions elles-mêmes ; les deux sont lus.

**Les trois lignes d'identité sont aussi recherchées avec un préfixe `resource.`.** L'ingestion OTLP aplatit chaque attribut de _ressource_ dans la table d'attributs du span sous un préfixe `resource.`, si bien que `OTEL_RESOURCE_ATTRIBUTES=team.id=platform` arrive sous la forme `resource.team.id`. OneUptime parcourt d'abord toute la liste sans préfixe, puis toute la liste `resource.`, de sorte qu'un attribut de span (qui décrit un appel) l'emporte sur un attribut de ressource (qui décrit tout le processus). Les autres lignes ne sont recherchées que sur la clé sans préfixe : ce sont des valeurs propres à chaque appel.

**Le contenu des prompts et des complétions** est lu depuis l'événement `gen_ai.client.inference.operation.details` ; depuis les attributs de span `gen_ai.input.messages`, `gen_ai.output.messages` et `gen_ai.system_instructions` ; depuis les événements par rôle **obsolètes** que les anciennes instrumentations émettent encore (`gen_ai.system.message`, `gen_ai.user.message`, `gen_ai.tool.message`, `gen_ai.assistant.message`, `gen_ai.choice`) ; depuis les attributs indexés (`gen_ai.prompt.N.content` et `gen_ai.completion.N.content`, et pour OpenInference `llm.input_messages.N.message.content` et `llm.output_messages.N.message.content`) ; et depuis les tableaux de messages JSON (`gen_ai.prompt`, `gen_ai.completion`, `input.value`, `output.value`).

### Comment le coût est calculé

Si votre instrumentation fournit un coût (`gen_ai.usage.cost`), OneUptime l'utilise tel quel : la valeur fournie l'emporte toujours. Quand aucun coût n'est fourni, OneUptime calcule un **coût estimé à l'ingestion** à partir du nombre de jetons du span et d'un catalogue intégré de prix publics des modèles courants d'OpenAI, Anthropic, Google Gemini, Mistral, DeepSeek, xAI, Cohere, Amazon Nova et Meta Llama. Les modèles sont reconnus par préfixe de nom, si bien que les instantanés datés comme `gpt-4o-2024-08-06` et les identifiants décorés par le fournisseur comme `us.anthropic.claude-3-5-sonnet-20241022-v2:0` sont correctement résolus. Les modèles inconnus ou personnalisés ne sont jamais devinés — leur coût reste à `0` jusqu'à ce que vous leur donniez un prix dans l'onglet **Tarifs**. Les estimations utilisent les prix publics et ne tiennent pas compte des remises de cache ou de traitement par lots.

Vous hébergez OneUptime vous-même ? Le catalogue se trouve dans `packages/Common/Types/Telemetry/LlmCostCatalog.ts`.

## Attribution aux employés et aux équipes

« Lequel de nos ingénieurs a dépensé 4 000 $ en Opus le mois dernier » est une question sur une personne, et aucun span LLM n'y répond à moins que quelque chose sur le span ne nomme quelqu'un. OneUptime copie l'acteur humain dans des colonnes interrogeables à l'ingestion, si bien que vous regroupez et filtrez sur une colonne au lieu d'écrire des recherches d'attributs.

Les trois lignes d'identité du tableau ci-dessus constituent tout le mécanisme ; la première clé présente l'emporte, dans l'ordre indiqué. `user.id` vient en tête parce que c'est la clé OpenTelemetry canonique pour un acteur humain, et celle sur laquelle vous standardiser si vous définissez l'identité vous-même. **Une exception : Claude Code** émet `user.id` sous la forme d'un identifiant anonyme aléatoire conservé dans `~/.claude.json`, et non d'une personne. C'est sans conséquence sur ses points de données de métriques, dont la liste commence par l'e-mail, mais si vous activez la bêta des traces de Claude Code, le `user.id` anonyme passe devant `user.email` sur les spans : supprimez ou remappez `user.id` dans un processeur du collecteur pour cette flotte. `enduser.id` est toujours un attribut actif des conventions sémantiques et il est accepté comme alias équivalent. `cursor.user.id` arrive en dernier parce que c'est un entier opaque, propre à l'équipe, qui nécessite l'API d'administration de Cursor pour remonter à une personne.

L'identité n'est lue que sur les spans déjà reconnus comme des appels LLM : `user.id`, `user.email` et `team.id` sont des clés génériques que portent aussi les spans du navigateur et des backends ordinaires. Les **points de données de métriques** portent une liste plus courte, qui commence par l'e-mail — `user.email`, `user.id`, `user.account_uuid`, `user.account_id`, `cursor.user.id`, avec les équipes issues de `team.id`, `team`, `cost_center`, `department` et `cursor.team.id`, chacune aussi recherchée avec le préfixe `resource.` —, parce que les CLI d'agents de code qui émettent des métriques sans spans émettent `user.email` nativement. Rien ne lit aujourd'hui l'identité sur les **enregistrements de journaux**.

### Définir l'équipe et le centre de coûts

Aucune instrumentation n'émet `team.id`, `team`, `cost_center` ou `department` : c'est votre organisation qui les définit, habituellement via `OTEL_RESOURCE_ATTRIBUTES` sur le processus :

```bash
export OTEL_RESOURCE_ATTRIBUTES="team.id=platform,team=Platform_Engineering,cost_center=eng-123,department=engineering"
```

Elles arrivent dans OneUptime sous les noms `resource.team.id`, `resource.team`, `resource.cost_center` et `resource.department`, et les deux niveaux sont reconnus sur les spans comme sur les points de données de métriques, que votre exportateur laisse les clés dans le bloc de ressource OTLP ou les copie sur chaque span (Claude Code fait ce dernier choix). Un `team.id` sans préfixe défini directement sur un span l'emporte toujours.

Les graphies des passerelles arrivent sans aucune configuration de votre part. LiteLLM nomme ses attributs différemment dans ses deux modes OpenTelemetry — le callback `otel` v1 par défaut utilise un simple préfixe `metadata.` (`metadata.user_api_key_user_id`, `metadata.user_api_key_user_email`, `metadata.user_api_key_team_id`), le mode v2 optionnel (`LITELLM_OTEL_V2=true`) l'espace de noms `litellm.` —, et **OneUptime lit les deux**.

### Les clés client sont exclues volontairement

Un span LLM peut porter **deux** personnes différentes : l'employé qui a fait l'appel, et le **client** en aval pour qui il a été fait. Ces clés portent le client, et OneUptime n'en lit délibérément **aucune** dans une colonne d'identité :

- `gen_ai.user` et `llm.user` — la façon dont les instrumentations reprennent le paramètre de requête `user` d'OpenAI, qu'OpenAI documente comme « a stable identifier for your end-users » (désormais obsolète au profit de `safety_identifier` et `prompt_cache_key`).
- `litellm.metadata.user_api_key_end_user_id`, `metadata.user_api_key_end_user_id` et `litellm.end_user.id` — l'identifiant explicite d'utilisateur final de LiteLLM dans ses trois graphies, distinct de l'identifiant du propriétaire de la clé, qui **est** l'employé et **est** lu.

La raison est l'exactitude de la refacturation : lisez un identifiant client dans la colonne des employés, et un bot de support qui sert 40 000 clients crée 40 000 « employés » fantômes, tandis que l'ingénieur à qui appartient la dépense semble n'avoir rien dépensé. Ces attributs restent dans la table d'attributs brute, où vous pouvez les interroger directement.

### Les colonnes d'identité sont nettoyées

La colonne de l'e-mail de l'employé contient de vraies données personnelles. Vos **Règles de masquage** de télémétrie dans la portée **Attributs** la couvrent exactement comme elles couvrent l'attribut dont elle a été lue, si bien qu'une règle de caviardage des e-mails s'applique aussi à la colonne. Configurez les règles de masquage et les filtres de suppression sous **Traces → Paramètres**.

## Les spans et les métriques sont un repli, pas une somme

**Les spans GenAI font autorité. Le flux de métriques n'est consulté que lorsque le flux de spans n'a rien fourni, et les deux ne sont jamais additionnés.** Un span porte le modèle, les jetons et le coût sur une seule ligne, si bien que là où les spans existent, ils répondent à toutes les questions. Là où ils n'existent pas — les CLI d'agents de code publient des _métriques_ de jetons et de coût et aucun span GenAI —, le flux de métriques prend le relais. Ils ne sont pas additionnés parce que de nombreuses instrumentations émettent les deux signaux pour le même appel (OpenLLMetry est le cas courant), et les additionner compterait chaque dollar deux fois.

La conséquence à anticiper : **dès que vos spans GenAI fournissent un chiffre non nul, la contribution d'une source uniquement métrique à ce chiffre n'apparaît pas.** Le repli se fait par chiffre et par ventilation, pas par émetteur :

| Où                                              | Ce qui se rabat sur les métriques                         | Quand                                       |
| ----------------------------------------------- | --------------------------------------------------------- | ------------------------------------------- |
| Utilisation → Jetons d'entrée / Jetons de sortie | Totaux des jetons d'entrée et de sortie                  | Les deux sommes de jetons des spans valent 0 |
| Utilisation → Coût (USD)                        | Coût, en USD et en micro-USD, mis à l'échelle et additionné | La somme des coûts des spans vaut 0      |
| Utilisation → Appels LLM                        | Rien — spans uniquement                                   | —                                           |
| Utilisation → Employé, Équipe, Modèle           | Le coût seulement. Les colonnes d'appels et de jetons affichent `—` | Cette ventilation n'a renvoyé aucune ligne de span |
| Utilisation → Fournisseur, Application / Service | Rien — spans uniquement                                  | —                                           |
| Conversations                                   | Rien — les conversations sont construites à partir des spans | —                                        |

Fournisseur et Application / Service n'ont pas de repli sur les métriques parce que les compteurs des agents de code ne portent aucun attribut de fournisseur GenAI et ne sont rattachés à aucun service de télémétrie OneUptime. Partout où un chiffre provient des métriques, la page l'étiquette **depuis les métriques GenAI**, car un chiffre issu des métriques n'a aucune ligne correspondante dans la liste Appels.

**Si vous voulez que les dépenses d'un outil uniquement métrique soient visibles à part, donnez-lui son propre projet**, afin que son flux de spans soit réellement vide et que le repli s'enclenche. Il en va de même pour les budgets : définissez un budget par service plutôt que de mélanger des services qui émettent des spans et des services uniquement métriques.

## Tableaux de bord et alertes sur les métriques

Les métriques GenAI arrivent comme des métriques OpenTelemetry ordinaires, vous pouvez donc créer des **tableaux de bord** qui tracent `gen_ai.client.token.usage`, `gen_ai.client.operation.duration` et le reste, et créer des **moniteurs de métriques** dessus — par exemple quand le p95 de `gen_ai.client.operation.duration` dépasse un seuil, regroupé par modèle. Voir [Surveillance des métriques](/docs/monitor/metrics-monitor).

## Budgets de coût quotidiens

L'onglet **Budgets** fixe des plafonds quotidiens en USD, évalués sur la journée UTC. Toutes les 15 minutes, un worker en arrière-plan additionne le coût des spans LLM de la journée (fourni ou calculé), l'enregistre sur le budget et publie deux métriques de type jauge :

| Métrique                            | Signification                                       |
| ----------------------------------- | --------------------------------------------------- |
| `oneuptime.llm.budget.spend.usd`    | La dépense de la journée jusqu'ici, en USD          |
| `oneuptime.llm.budget.percent.used` | La dépense en pourcentage du plafond quotidien      |

Toutes deux portent les attributs `oneuptime.llm.budget.id` et `oneuptime.llm.budget.name`, ainsi que la portée du budget (service, fournisseur et modèle) quand elle est définie. Filtrez les moniteurs par **`oneuptime.llm.budget.id`**, qui est stable ; le nom change quand vous renommez le budget.

**Alerter, c'est une [Surveillance des métriques](/docs/monitor/metrics-monitor) sur ces métriques.** Pour le schéma classique 80 % / 100 %, créez un moniteur sur `oneuptime.llm.budget.percent.used`, filtrez-le par `oneuptime.llm.budget.id` et ajoutez deux critères : `>= 80` qui crée une alerte d'avertissement et `>= 100` qui crée une alerte critique. **Réglez la durée glissante du moniteur sur 30 minutes** : un budget publie un point toutes les 15 minutes, donc la fenêtre par défaut d'une minute trouverait une série vide entre deux passages.

Les budgets peuvent être limités à un service de télémétrie, à un fournisseur LLM ou à un modèle exact, ou couvrir tout le projet, et plusieurs peuvent coexister. Un moniteur de budget peut aussi appeler un Workflow qui arrête un agent incontrôlé — voir [Disjoncteurs pour agents IA incontrôlés](/docs/telemetry/ai-agent-circuit-breaker).

## Confidentialité et caviardage

Les prompts et les complétions peuvent contenir des données sensibles. OneUptime applique vos **Règles de masquage** et **Filtres de suppression** de télémétrie aux spans LLM comme à n'importe quelle autre trace, si bien que vous pouvez masquer des attributs ou supprimer des spans avant leur stockage ; configurez-les sous **Traces → Paramètres**. La colonne de l'e-mail de l'employé est couverte par les mêmes règles — voir [Les colonnes d'identité sont nettoyées](#les-colonnes-didentité-sont-nettoyées).

Les conversations se lisent avec la même autorisation que les traces : quiconque peut lire les traces du projet peut lire ses conversations, et personne d'autre.

## Voir aussi

- [Observabilité des assistants de code IA](/docs/telemetry/ai-coding-assistants) — la matrice de prise en charge de Claude Code, Cursor, Codex, Gemini CLI, Copilot, Cline et des autres, et le fonctionnement des dépenses par employé entre eux.
- [Surveiller Claude Code](/docs/telemetry/claude-code)
- [Surveiller Cursor](/docs/telemetry/cursor)
- [Surveiller OpenAI Codex CLI](/docs/telemetry/openai-codex)
- [Surveiller Gemini CLI et GitHub Copilot](/docs/telemetry/gemini-cli-and-copilot)
- [Observer les passerelles IA (LiteLLM et Portkey)](/docs/telemetry/ai-gateways)
- [Disjoncteurs pour agents IA incontrôlés](/docs/telemetry/ai-agent-circuit-breaker)
