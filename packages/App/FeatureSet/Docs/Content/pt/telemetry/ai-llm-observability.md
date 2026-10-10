# Observabilidade de IA / LLM com o OneUptime

Leia cada conversa que sua IA teve, repita-a do jeito que aconteceu e seja avisado quando ela responder mal. Tudo roda sobre OpenTelemetry padrão, sem SDK proprietário: se seu aplicativo emite spans com as **convenções semânticas GenAI** do OpenTelemetry (`gen_ai.*`), o OneUptime os transforma em conversas, alertas, uso e custo.

## O que você ganha

Abra **IA / LLM** na barra de navegação, em Observabilidade:

- **Conversas** — cada conversa que sua IA teve: o que as pessoas perguntaram, o que a IA respondeu, as ferramentas que usou e o que deu errado. Cinco números ficam acima da lista: conversas, respostas da IA, quantas precisam de atenção, custo e quanto tempo uma resposta costuma levar. Abra uma conversa para lê-la ou repeti-la.
- **Chamadas** — cada chamada de LLM, embedding, agente e ferramenta, filtrável por serviço, provedor, modelo, operação, pessoa e equipe. Clique em uma chamada para abri-la no visualizador de traços.
- **Uso** — as chamadas, os tokens e o custo de um período, e quem gasta o quê: funcionários, equipes, modelos, provedores e aplicativos classificados por gasto.
- **Alertas** — alertas prontos para quando a IA responde mal, e seus monitores de IA / LLM.
- **Orçamentos** — limites de custo diários, publicados como métricas para alertar.
- **Preços** — seus próprios preços por modelo, para modelos que o catálogo embutido não conhece.
- **Configuração** — os cinco passos abaixo, com o endpoint do seu projeto.

No visualizador de traços, o span de cada chamada à IA também tem um painel **IA / LLM** com o modelo, a contagem de tokens, o custo, os parâmetros da requisição, e o prompt e a resposta.

## Passo 1 — Envie suas chamadas à IA

Crie uma chave de ingestão de telemetria: abra **Configurações do projeto → Telemetria e APM → Chaves de ingestão** e clique em **Criar chave de ingestão**. Seu aplicativo envia a chave como um cabeçalho OTLP. (Veja o [guia do OpenTelemetry](/docs/telemetry/open-telemetry) para capturas de tela.)

Depois instrumente seu aplicativo com qualquer biblioteca GenAI do OpenTelemetry:

- **OpenLLMetry** (Traceloop) — OpenAI, Anthropic, Cohere, Bedrock, LangChain, LlamaIndex, CrewAI e mais.
- **OpenInference** (Arize) — OpenAI, LangChain, LlamaIndex, DSPy e mais.
- O **Vercel AI SDK**, ou as **instrumentações do OpenTelemetry** para OpenAI, Anthropic e Gemini.

Encaminha seu tráfego de LLM por um gateway como **LiteLLM** ou **Portkey**? Exporte os traços do gateway em vez de instrumentar cada aplicativo — veja [Observando gateways de IA](/docs/telemetry/ai-gateways). Procurando os assistentes de programação que seus engenheiros usam — Claude Code, Cursor, Codex, Gemini CLI, Copilot? Eles exportam o próprio OpenTelemetry e não precisam de nada de você: veja [Observabilidade de assistentes de programação com IA](/docs/telemetry/ai-coding-assistants).

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

### Variáveis de ambiente simples do OpenTelemetry

Se você instrumenta com um SDK nativo do OpenTelemetry, aponte o exportador OTLP para o OneUptime:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
export OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_INGESTION_TOKEN"
export OTEL_SERVICE_NAME="my-ai-agent"
```

Hospeda o OneUptime por conta própria? Substitua `https://oneuptime.com/otlp` por `https://YOUR-ONEUPTIME-HOST/otlp`.

## Passo 2 — Registre o que foi dito

Uma conversa mostra o que as pessoas perguntaram e o que a IA respondeu quando sua instrumentação registra isso. O OpenLLMetry registra prompts e respostas, a menos que você desligue (`TRACELOOP_TRACE_CONTENT=false`). As instrumentações do OpenTelemetry só os registram quando você pede:

```bash
export OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true
```

Sem eles, uma conversa ainda mostra seus tempos, seu custo e seus problemas, e informa que o conteúdo não foi registrado. Prompts podem conter dados sensíveis: veja [Privacidade e ocultação](#privacidade-e-ocultação) para mascará-los antes de serem armazenados.

## Passo 3 — Agrupe as chamadas em conversas

Um aplicativo de chat faz uma chamada ao modelo por turno. Defina `gen_ai.conversation.id` — ou `session.id` — com o id do seu chat em cada chamada à IA, e cada chat aparece como uma única conversa, não importa quantas chamadas e traços tenha levado. Com o OpenLLMetry, defina-o uma vez por requisição como propriedade de associação:

```python
from traceloop.sdk import Traceloop

Traceloop.set_association_properties({
    "session_id": chat.id,
    "user_email": user.email,
})
```

Chamadas sem id de conversa também aparecem, uma requisição (um traço) por vez.

## Passo 4 — Informe quem perguntou

Defina `user.id` ou `user.email` — a propriedade de associação acima define o e-mail — para ver com quem foi cada conversa, pesquisar a lista por pessoa e classificar o gasto por funcionário na aba Uso. [Atribuição a funcionários e equipes](#atribuição-a-funcionários-e-equipes) lista todas as chaves que o OneUptime lê.

## Passo 5 — Sinalize respostas ruins

O OneUptime verifica cada resposta assim que ela chega e marca o que deu errado:

| Problema   | O que significa                                              | Detectado por                                                                                                                                                                  |
| ---------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Falhou     | A chamada terminou em erro, então nenhuma resposta chegou    | Status do span Error, `error.type`, ou um motivo de término `error`                                                                                                            |
| Recusado   | A IA recusou, ou um filtro de segurança bloqueou             | Um motivo de término de recusa ou de segurança (`content_filter`, `refusal`, `SAFETY` e similares), uma recusa na resposta, ou uma resposta que começa com uma recusa padrão em inglês |
| Cortado    | A resposta parou no limite de tokens                         | Um motivo de término `length`, `max_tokens` ou `MAX_TOKENS`                                                                                                                    |
| Vazio      | A IA respondeu sem texto e sem chamada de ferramenta         | Conteúdo registrado que não contém nada, ou 0 tokens de saída                                                                                                                  |
| Sinalizado | Uma avaliação enviada pelo seu aplicativo disse que a resposta era ruim | Um evento `gen_ai.evaluation.result`                                                                                                                                |

Os quatro primeiros não precisam de nada de você. Para sinalizar o resto — uma resposta que seu guardrail, seu eval ou seu próprio juiz LLM rejeita —, adicione um evento `gen_ai.evaluation.result` ao span da resposta, com `gen_ai.evaluation.score.label` definido como `fail`:

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

Rótulos como `incorrect`, `wrong`, `unhelpful`, `toxic`, `unsafe` e `hallucination` também contam como falha. O evento precisa estar no span da resposta que ele julga, enquanto esse span está aberto.

O OneUptime nunca envia suas conversas para outra IA julgá-las: cada verificação lê apenas o que a própria chamada traz.

## Ler e repetir uma conversa

Uma conversa abre inteira, do jeito que um aplicativo de chat mostra seu histórico: o que a pessoa disse à direita, as respostas da IA à esquerda com modelo, horário, tokens e custo, as chamadas de ferramentas entre elas, e o que deu errado marcado onde aconteceu. **Detalhes** abaixo de uma resposta mostra o motivo de término e as avaliações, com um link para a chamada em Traços.

A barra na parte de baixo repete a conversa do jeito que a pessoa a viveu:

- **Repetir** a reproduz a partir da primeira mensagem no ritmo em que aconteceu, com "A IA está respondendo…" contando enquanto uma resposta está a caminho. Clique no horário de qualquer mensagem para repetir a partir dali.
- **Pular esperas**, ligado por padrão, encurta silêncios maiores que 3 segundos. O botão de velocidade reproduz em 1×, 2×, 4× ou 8×.
- **K** reproduz ou pausa, **J** ou **←** volta uma mensagem, e **L** ou **→** avança uma.
- O endereço guarda a mensagem em que uma reprodução parou (`?step=`), então um link abre naquele momento.

## Seja avisado quando a IA responder mal

A aba **Alertas** oferece os alertas que a maioria dos aplicativos de IA quer. Escolher um abre Criar monitor já preenchido, onde você pode mudar qualquer coisa antes de salvar:

| Alerta                       | Quando avisa você                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| Respostas dão errado         | Mais de 5% das respostas em 15 minutos falham, são recusadas, cortadas, vazias ou sinalizadas      |
| As chamadas à IA falham      | Mais de 10% das chamadas ao modelo em 5 minutos terminam em erro                                   |
| A IA se recusa a responder   | Mais de 5% das respostas em 30 minutos são recusas                                                 |
| Respostas cortadas           | 3 ou mais respostas em 30 minutos param no limite de tokens                                        |
| Respostas sinalizadas        | Uma avaliação marca uma resposta como ruim                                                         |
| Respostas lentas             | Mais de 10% das respostas em 15 minutos levam mais de 30 segundos                                  |
| A IA para de responder       | A IA não dá nenhuma resposta por 30 minutos                                                        |

Os alertas sobre uma proporção também esperam por pelo menos 3 respostas ruins, para que uma resposta ruim em duas não acorde ninguém.

Cada alerta é um monitor de **IA / LLM**. Suas configurações dizem o que conta como resposta ruim — os problemas acima, uma resposta mais lenta que um limite que você define, ou ambos —, quais aplicativos e qual modelo ele observa, e até onde cada verificação olha para trás. Abaixo delas, uma prévia mostra o que o monitor contaria agora mesmo. Seus critérios comparam três números: a **proporção de respostas ruins** (em %), o **número de respostas ruins** e o **número de respostas**. Um alerta pronto gera um alerta que se resolve sozinho e mostra o monitor como Degradado enquanto as respostas estão ruins; ative o incidente dele para acionar alguém.

O gasto é vigiado pelos [orçamentos de custo diários](#orçamentos-de-custo-diários).

## Atributos que o OneUptime reconhece

O OneUptime lê primeiro as convenções GenAI do OpenTelemetry e recorre às variantes do OpenLLMetry e do OpenInference para que as bibliotecas populares funcionem de imediato.

| O quê                                 | Atributo principal           | Também aceito                                                                                                                                                                                                                                                             |
| ------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provedor / sistema                    | `gen_ai.provider.name`       | `gen_ai.system` (obsoleto nas convenções, ainda muito emitido), `llm.system`, `llm.provider`                                                                                                                                                                             |
| Operação                              | `gen_ai.operation.name`      | `llm.request.type`, `openinference.span.kind`                                                                                                                                                                                                                             |
| Modelo solicitado                     | `gen_ai.request.model`       | `llm.model_name`, `llm.request.model`                                                                                                                                                                                                                                     |
| Modelo da resposta                    | `gen_ai.response.model`      | `llm.response.model`                                                                                                                                                                                                                                                      |
| Tokens de entrada                     | `gen_ai.usage.input_tokens`  | `gen_ai.usage.prompt_tokens`, `llm.token_count.prompt`, `llm.usage.prompt_tokens`                                                                                                                                                                                         |
| Tokens de saída                       | `gen_ai.usage.output_tokens` | `gen_ai.usage.completion_tokens`, `llm.token_count.completion`, `llm.usage.completion_tokens`                                                                                                                                                                             |
| Total de tokens                       | `gen_ai.usage.total_tokens`  | `llm.token_count.total`, `llm.usage.total_tokens`; derivado de entrada + saída quando nenhum é informado                                                                                                                                                                  |
| Custo (USD)                           | `gen_ai.usage.cost`          | `gen_ai.usage.cost_usd`, `gen_ai.usage.total_cost`, `llm.usage.total_cost`, `gen_ai.cost.total_cost` (LiteLLM), `litellm.cost.total`                                                                                                                                      |
| Nome do agente                        | `gen_ai.agent.name`          | `agent.name`                                                                                                                                                                                                                                                              |
| Nome da ferramenta                    | `gen_ai.tool.name`           | `tool.name`                                                                                                                                                                                                                                                               |
| Id de conversa / sessão               | `gen_ai.conversation.id`     | `session.id`, `langfuse.session.id`, `traceloop.association.properties.session_id`                                                                                                                                                                                        |
| Funcionário (quem fez a chamada)      | `user.id`                    | `enduser.id`, `litellm.metadata.user_api_key_user_id` e `metadata.user_api_key_user_id` (grafias do LiteLLM OTel v2 e v1 — ambas são lidas), `traceloop.association.properties.user_id`, `langfuse.user.id`, `user.account_uuid`, `user.account_id`, `cursor.user.id` |
| E-mail do funcionário                 | `user.email`                 | `traceloop.association.properties.user_email`, `enduser.email`                                                                                                                                                                                                            |
| Equipe / centro de custo              | `team.id`                    | `team`, `cost_center`, `department`, `litellm.metadata.user_api_key_team_id` e `litellm.team.id` (LiteLLM OTel v2), `metadata.user_api_key_team_id` (LiteLLM OTel v1), `cursor.team.id`                                                                                   |

As subchaves de `traceloop.association.properties.*` são **fornecidas por quem chama**: o Traceloop define o prefixo, e seu código fornece o que vai abaixo dele. `gen_ai.usage.total_tokens` e `gen_ai.usage.cost` são chaves **de fato**, não convenções semânticas GenAI — as convenções não definem atributo de total de tokens nem de custo —, e o OneUptime as lê porque as instrumentações comuns as emitem. `gen_ai.system` é o antecessor obsoleto de `gen_ai.provider.name` nas próprias convenções; ambos são lidos.

**As três linhas de identidade também são procuradas com um prefixo `resource.`.** A ingestão OTLP achata cada atributo de _recurso_ no mapa de atributos do span sob um prefixo `resource.`, então `OTEL_RESOURCE_ATTRIBUTES=team.id=platform` chega como `resource.team.id`. O OneUptime procura primeiro na lista inteira sem prefixo, depois na lista inteira `resource.`, de modo que um atributo de span (que descreve uma chamada) vence um atributo de recurso (que descreve o processo todo). As demais linhas são procuradas só pela chave sem prefixo: são valores por chamada.

**O conteúdo de prompts e respostas** é lido do evento `gen_ai.client.inference.operation.details`; dos atributos de span `gen_ai.input.messages`, `gen_ai.output.messages` e `gen_ai.system_instructions`; dos eventos por papel **obsoletos** que instrumentações mais antigas ainda emitem (`gen_ai.system.message`, `gen_ai.user.message`, `gen_ai.tool.message`, `gen_ai.assistant.message`, `gen_ai.choice`); dos atributos indexados (`gen_ai.prompt.N.content` e `gen_ai.completion.N.content`, e no OpenInference `llm.input_messages.N.message.content` e `llm.output_messages.N.message.content`); e dos arrays de mensagens JSON (`gen_ai.prompt`, `gen_ai.completion`, `input.value`, `output.value`).

### Como o custo é calculado

Se sua instrumentação informa um custo (`gen_ai.usage.cost`), o OneUptime o usa como está: o valor informado sempre vence. Quando nenhum custo é informado, o OneUptime calcula um **custo estimado na ingestão** a partir da contagem de tokens do span e de um catálogo embutido de preços de tabela de modelos comuns da OpenAI, Anthropic, Google Gemini, Mistral, DeepSeek, xAI, Cohere, Amazon Nova e Meta Llama. Os modelos são reconhecidos pelo prefixo do nome, então snapshots datados como `gpt-4o-2024-08-06` e ids decorados pelo fornecedor como `us.anthropic.claude-3-5-sonnet-20241022-v2:0` são resolvidos corretamente. Modelos desconhecidos ou personalizados nunca são adivinhados — o custo deles fica em `0` até você dar um preço a eles na aba **Preços**. As estimativas usam preços de tabela e não consideram descontos de cache ou de lote.

Hospeda o OneUptime por conta própria? O catálogo fica em `packages/Common/Types/Telemetry/LlmCostCatalog.ts`.

## Atribuição a funcionários e equipes

"Qual dos nossos engenheiros gastou US$ 4 mil em Opus no mês passado" é uma pergunta sobre uma pessoa, e nenhum span de LLM a responde a menos que algo no span diga quem é. O OneUptime copia o ator humano para colunas consultáveis na ingestão, então você agrupa e filtra por uma coluna em vez de escrever buscas de atributos.

As três linhas de identidade da tabela acima são todo o mecanismo; vence a primeira chave presente, na ordem listada. `user.id` vem primeiro porque é a chave canônica do OpenTelemetry para um ator humano e a que você deve padronizar se definir a identidade por conta própria. **Uma exceção: o Claude Code** emite `user.id` como um identificador anônimo aleatório guardado em `~/.claude.json`, não uma pessoa. Isso é inofensivo nos pontos de dados de métricas dele, cuja lista começa pelo e-mail, mas se você ativar o beta de traços do Claude Code, o `user.id` anônimo passa à frente de `user.email` nos spans: remova ou remapeie `user.id` em um processador do coletor para essa frota. `enduser.id` ainda é um atributo ativo das convenções semânticas e é aceito como alias equivalente. `cursor.user.id` vem por último porque é um inteiro opaco, restrito à equipe, que precisa da API de administração do Cursor para chegar a uma pessoa.

A identidade só é lida em spans já reconhecidos como chamadas de LLM: `user.id`, `user.email` e `team.id` são chaves genéricas que spans de navegador e de backends comuns também carregam. Os **pontos de dados de métricas** carregam uma lista mais curta, que começa pelo e-mail — `user.email`, `user.id`, `user.account_uuid`, `user.account_id`, `cursor.user.id`, com equipes de `team.id`, `team`, `cost_center`, `department` e `cursor.team.id`, cada um também procurado com o prefixo `resource.` —, porque as CLIs de agentes de programação que emitem métricas sem spans emitem `user.email` nativamente. Hoje nada lê a identidade dos **registros de log**.

### Definindo a equipe e o centro de custo

Nenhuma instrumentação emite `team.id`, `team`, `cost_center` ou `department`: sua organização os define, normalmente via `OTEL_RESOURCE_ATTRIBUTES` no processo:

```bash
export OTEL_RESOURCE_ATTRIBUTES="team.id=platform,team=Platform_Engineering,cost_center=eng-123,department=engineering"
```

Eles chegam ao OneUptime como `resource.team.id`, `resource.team`, `resource.cost_center` e `resource.department`, e os dois níveis são reconhecidos em spans e em pontos de dados de métricas, seja seu exportador deixando as chaves no bloco de recurso OTLP ou copiando-as para cada span (o Claude Code faz a segunda opção). Um `team.id` sem prefixo definido diretamente em um span continua vencendo.

As grafias dos gateways chegam sem nenhuma configuração sua. O LiteLLM nomeia seus atributos de forma diferente nos seus dois modos de OpenTelemetry — o callback `otel` v1 padrão usa um prefixo `metadata.` simples (`metadata.user_api_key_user_id`, `metadata.user_api_key_user_email`, `metadata.user_api_key_team_id`), o modo v2 opcional (`LITELLM_OTEL_V2=true`) o namespace `litellm.` —, e **o OneUptime lê os dois**.

### As chaves de cliente são excluídas de propósito

Um span de LLM pode carregar **duas** pessoas diferentes: o funcionário que fez a chamada e o **cliente** final para quem ela foi feita. Estas chaves carregam o cliente, e o OneUptime deliberadamente não lê **nenhuma** delas em uma coluna de identidade:

- `gen_ai.user` e `llm.user` — como as instrumentações repetem o parâmetro de requisição `user` da OpenAI, que a OpenAI documenta como "a stable identifier for your end-users" (agora obsoleto em favor de `safety_identifier` e `prompt_cache_key`).
- `litellm.metadata.user_api_key_end_user_id`, `metadata.user_api_key_end_user_id` e `litellm.end_user.id` — o id explícito de usuário final do LiteLLM nas três grafias, distinto do id do dono da chave, que **é** o funcionário e **é** lido.

O motivo é a exatidão do rateio de custos: leia um id de cliente na coluna de funcionário e um bot de suporte que atende 40.000 clientes cria 40.000 "funcionários" fantasmas, enquanto o engenheiro dono do gasto parece não ter gastado nada. Esses atributos ficam no mapa de atributos bruto, onde você pode consultá-los diretamente.

### As colunas de identidade são limpas

A coluna de e-mail do funcionário guarda dados pessoais reais. Suas **Regras de mascaramento** de telemetria no escopo **Atributos** a cobrem exatamente como cobrem o atributo de onde ela foi lida, então uma regra de ocultação de e-mails também se aplica à coluna. Configure regras de mascaramento e filtros de descarte em **Traços → Configurações**.

## Spans e métricas são um recurso alternativo, não uma soma

**Os spans GenAI são a fonte oficial. O fluxo de métricas só é consultado quando o fluxo de spans não informou nada, e os dois nunca são somados.** Um span carrega modelo, tokens e custo em uma linha, então onde há spans, eles respondem a qualquer pergunta. Onde não há — as CLIs de agentes de programação publicam _métricas_ de tokens e custo e nenhum span GenAI —, o fluxo de métricas assume. Eles não são somados porque muitas instrumentações emitem os dois sinais para a mesma chamada (o OpenLLMetry é o caso comum), e somá-los contaria cada dólar duas vezes.

A consequência a planejar: **assim que seus spans GenAI informam um valor diferente de zero, a contribuição de uma fonte só de métricas para esse valor não aparece.** O recurso alternativo é por valor e por detalhamento, não por emissor:

| Onde                                          | O que recorre às métricas                                    | Quando                                        |
| --------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------- |
| Uso → Tokens de entrada / Tokens de saída     | Totais de tokens de entrada e de saída                       | As duas somas de tokens dos spans são 0       |
| Uso → Custo (USD)                             | Custo, em USD e micro-USD, escalado e somado                 | A soma de custo dos spans é 0                 |
| Uso → Chamadas de LLM                         | Nada — só spans                                              | —                                             |
| Uso → Funcionário, Equipe, Modelo             | Só o custo. As colunas de chamadas e tokens mostram `—`      | Esse detalhamento não retornou linhas de span |
| Uso → Provedor, Aplicação / Serviço           | Nada — só spans                                              | —                                             |
| Conversas                                     | Nada — as conversas são montadas a partir de spans           | —                                             |

Provedor e Aplicação / Serviço não têm recurso às métricas porque os contadores dos agentes de programação não carregam nenhum atributo de provedor GenAI e não estão ligados a nenhum serviço de telemetria do OneUptime. Sempre que um valor vem de métricas, a página o rotula **das métricas GenAI**, porque um valor vindo de métricas não tem linhas correspondentes na lista Chamadas.

**Se você precisa que o gasto de uma ferramenta só de métricas apareça separado, dê a ela um projeto próprio**, para que seu fluxo de spans fique realmente vazio e o recurso alternativo entre em ação. O mesmo vale para orçamentos: defina um orçamento por serviço em vez de misturar serviços que emitem spans com serviços só de métricas.

## Dashboards e alertas de métricas

As métricas GenAI chegam como métricas comuns do OpenTelemetry, então você pode criar **dashboards** com gráficos de `gen_ai.client.token.usage`, `gen_ai.client.operation.duration` e o resto, e criar **monitores de métricas** sobre elas — por exemplo quando o p95 de `gen_ai.client.operation.duration` passa de um limite, agrupado por modelo. Veja [Monitor de métricas](/docs/monitor/metrics-monitor).

## Orçamentos de custo diários

A aba **Orçamentos** define limites diários em USD, avaliados sobre o dia UTC. A cada 15 minutos um worker em segundo plano soma o custo dos spans de LLM do dia (informado ou calculado), registra-o no orçamento e publica duas métricas do tipo gauge:

| Métrica                             | Significado                                   |
| ----------------------------------- | --------------------------------------------- |
| `oneuptime.llm.budget.spend.usd`    | O gasto do dia até agora, em USD              |
| `oneuptime.llm.budget.percent.used` | O gasto como porcentagem do limite diário     |

Ambas carregam os atributos `oneuptime.llm.budget.id` e `oneuptime.llm.budget.name`, além do escopo de serviço, provedor e modelo do orçamento quando definido. Filtre os monitores por **`oneuptime.llm.budget.id`**, que é estável; o nome muda quando você renomeia o orçamento.

**Para alertar, use um [Monitor de métricas](/docs/monitor/metrics-monitor) sobre essas métricas.** Para o padrão clássico de 80% / 100%, crie um monitor sobre `oneuptime.llm.budget.percent.used`, filtre-o por `oneuptime.llm.budget.id` e adicione dois critérios: `>= 80` criando um alerta de aviso e `>= 100` criando um crítico. **Defina a janela de tempo móvel do monitor como 30 minutos**: um orçamento publica um ponto a cada 15 minutos, então a janela padrão de 1 minuto encontraria uma série vazia entre duas varreduras.

Os orçamentos podem ser restritos a um serviço de telemetria, a um provedor de LLM ou a um modelo exato, ou valer para o projeto todo, e vários podem coexistir. Um monitor de orçamento também pode chamar um Workflow que pare um agente descontrolado — veja [Disjuntores para agentes de IA descontrolados](/docs/telemetry/ai-agent-circuit-breaker).

## Privacidade e ocultação

Prompts e respostas podem conter dados sensíveis. O OneUptime aplica suas **Regras de mascaramento** e **Filtros de descarte** de telemetria aos spans de LLM como a qualquer outro traço, então você pode mascarar atributos ou descartar spans antes de serem armazenados; configure-os em **Traços → Configurações**. A coluna de e-mail do funcionário é coberta pelas mesmas regras — veja [As colunas de identidade são limpas](#as-colunas-de-identidade-são-limpas).

As conversas são lidas com a mesma permissão que os traços: quem pode ler os traços do projeto pode ler suas conversas, e mais ninguém.

## Relacionado

- [Observabilidade de assistentes de programação com IA](/docs/telemetry/ai-coding-assistants) — a matriz de suporte para Claude Code, Cursor, Codex, Gemini CLI, Copilot, Cline e os demais, e como o gasto por funcionário funciona entre eles.
- [Monitorando o Claude Code](/docs/telemetry/claude-code)
- [Monitorando o Cursor](/docs/telemetry/cursor)
- [Monitorando o OpenAI Codex CLI](/docs/telemetry/openai-codex)
- [Monitorando o Gemini CLI e o GitHub Copilot](/docs/telemetry/gemini-cli-and-copilot)
- [Observando gateways de IA (LiteLLM e Portkey)](/docs/telemetry/ai-gateways)
- [Disjuntores para agentes de IA descontrolados](/docs/telemetry/ai-agent-circuit-breaker)
