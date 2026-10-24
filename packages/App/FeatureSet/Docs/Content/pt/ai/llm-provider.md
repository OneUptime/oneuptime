# Provedores de LLM

Um provedor de LLM é o modelo por trás de cada recurso de IA do OneUptime: investigações, Pergunte à IA, rascunhos e pull requests de correção. Esta página mostra qual provedor um recurso usa, como adicionar o seu (OpenAI, Azure OpenAI e Microsoft Foundry, Anthropic, Groq, Mistral, Ollama ou qualquer servidor compatível com OpenAI) e como apontar o OneUptime para um modelo que você mesmo executa.

:::cards
- [Qual provedor a IA usa](#qual-provedor-a-ia-usa): O provedor padrão do projeto, senão o global.
- [Auto-hospedado: sem configuração por variáveis de ambiente](#auto-hospedado-sem-configuração-por-variáveis-de-ambiente): Um provedor para todos os projetos, a partir das configurações do servidor.
- [Configurando um provedor de LLM](#configurando-um-provedor-de-llm): Adicione um provedor a um projeto e teste-o.
- [Escolhendo uma URL base para um modelo auto-hospedado](#escolhendo-uma-url-base-para-um-modelo-auto-hospedado): Um endereço que o servidor do OneUptime consiga alcançar.
:::

## O que um provedor alimenta

- **Investigações**: a OneUptime AI investiga novos incidentes e alertas e publica na linha do tempo uma análise de causa raiz com citações. Veja [AI SRE](/docs/ai/ai-sre).
- **Perguntas**: **Ask AI** responde a partir dos dados do seu projeto, com uma citação em cada afirmação. Veja [Pergunte à IA](/docs/ai/ask-ai).
- **Rascunhos**: **Draft with AI** nas notas de incidentes, alertas e manutenções programadas, e postmortems, redigidos sob demanda ou quando um incidente é resolvido.
- **Código**: pull requests que corrigem exceções, traces lentos e as causas que as investigações encontram, a partir do OneUptime ou do GitHub. Veja [Código](/docs/ai/ai-agent).
- **Todo o resto**: a triagem do AI Insights, as etapas de IA de fluxos de trabalho e runbooks, e as respostas no Slack e no Microsoft Teams.

## Qual provedor a IA usa

Os recursos de IA usam o provedor padrão do projeto. Um projeto sem provedor padrão usa o provedor global, quando existe um. Pergunte à IA também pode mudar uma conversa para outro dos provedores do projeto, ou para um global.

```mermaid title="Qual provedor um recurso de IA usa"
flowchart TB
    F["Um recurso de IA<br/>precisa de um modelo"] --> D{"O projeto tem<br/>um provedor<br/>padrão?"}
    D -->|"sim"| P["O provedor padrão<br/>do projeto"]
    D -->|"não"| G{"Existe um provedor<br/>global?"}
    G -->|"sim"| GP["O provedor global:<br/>créditos de IA no<br/>OneUptime Cloud"]
    G -->|"não"| N["Nada roda, e<br/>as páginas de IA<br/>dizem que falta<br/>um provedor"]
```

Um provedor é o padrão de um projeto quando **Definir como padrão** está ativado, o que acontece em todo provedor novo. Um projeto cujos provedores estão todos com essa opção desativada recorre ao provedor global, como se não tivesse nenhum.

Toda regra da OneUptime AI — regras de IA e regras de post-mortem — pode escolher, em vez disso, um provedor próprio em **Mais campos**: um dos provedores do projeto ou um global, usado para tudo o que a regra inicia. Uma regra que não escolhe nenhum usa o provedor padrão, e um provedor escolhido que não pode mais ser usado volta a ele. Veja [Qual provedor LLM uma regra usa](/docs/ai/ai-sre#qual-provedor-llm-uma-regra-usa).

## OneUptime Cloud

No **OneUptime Cloud**, todo projeto pode usar o provedor global sem configuração. Ele está pronto para todo recurso de IA e é pago com os créditos de IA do projeto.

Para usar suas próprias chaves de API ou um modelo específico, adicione um provedor seu, como abaixo: você não é cobrado pela IA que roda no seu próprio provedor.

O provedor de LLM global é pago com os créditos de IA do projeto. Para limitar quanto a IA pode gastar por dia, defina um **Limite diário de gastos de IA (USD)** em **Configurações do projeto → IA → AI Features → Mais configurações**; um **Limite diário de tokens de IA** ali limita os tokens em qualquer provedor, inclusive o seu. Veja [os limites diários do próprio projeto](/docs/ai/ai-sre#os-limites-diários-do-próprio-projeto).

O OneUptime Cloud só consegue alcançar endpoints de LLM na internet pública. Ele não consegue se conectar a um modelo na sua rede privada, como um servidor Ollama ou vLLM auto-hospedado. Para usar um modelo que você mesmo executa, hospede o OneUptime em uma rede que consiga alcançá-lo, ou exponha o modelo em um endpoint público: veja [Escolhendo uma URL base para um modelo auto-hospedado](#escolhendo-uma-url-base-para-um-modelo-auto-hospedado).

## Auto-hospedado: sem configuração por variáveis de ambiente

Em uma instância auto-hospedada, a forma mais rápida de ativar a IA para **todos os projetos de uma vez** é definir as variáveis de ambiente `GLOBAL_LLM_PROVIDER_*` no seu servidor do OneUptime: no `config.env` para o Docker Compose, ou pelos valores do Helm. Na inicialização, o OneUptime registra a partir delas um provedor de LLM global e o mantém em dia; nenhum projeto precisa configurar nada, e as tarefas de correção de IA também o usam quando um projeto não tem provedor próprio.

| Variável | Descrição |
| --- | --- |
| `GLOBAL_LLM_PROVIDER_TYPE` | Necessária para ativá-lo. Uma de `OpenAI`, `AzureOpenAI`, `Anthropic`, `Groq`, `Mistral`, `Ollama`, `OpenAICompatible` |
| `GLOBAL_LLM_PROVIDER_API_KEY` | A chave de API: necessária para OpenAI, Azure OpenAI, Anthropic, Groq e Mistral; não é necessária para Ollama ou para um servidor compatível com OpenAI sem chave |
| `GLOBAL_LLM_PROVIDER_BASE_URL` | O endpoint: necessário para Azure OpenAI, Ollama e servidores compatíveis com OpenAI |
| `GLOBAL_LLM_PROVIDER_MODEL_NAME` | O modelo a usar: necessário para servidores compatíveis com OpenAI, recomendado para os outros |
| `GLOBAL_LLM_PROVIDER_NAME` | Um nome amigável opcional, mostrado no painel |

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

A sincronização é declarativa: mude uma variável e o provedor acompanha no próximo reinício; remova `GLOBAL_LLM_PROVIDER_TYPE` e o provedor é removido. Provedores globais criados à mão no Admin Dashboard nunca são alterados. Um projeto ainda pode adicionar um provedor próprio em **Configurações do projeto → IA → Provedores LLM**, e um provedor que pertence ao projeto sempre tem prioridade.

## Provedores compatíveis

| Provedor | Para que serve | Chave de API obrigatória | URL base obrigatória |
| --- | --- | --- | --- |
| **OpenAI** | GPT-5.1 e os outros modelos da OpenAI | Sim | Não (usa o padrão) |
| **Azure OpenAI / Microsoft Foundry** | Modelos que você implanta no Microsoft Foundry ou no Azure OpenAI: modelos da OpenAI, Foundry Models e Claude | Sim | Sim |
| **Anthropic** | Claude Sonnet 5.5, Claude Opus 5.5, Claude Haiku 5.5 e os outros modelos Claude | Sim | Não (usa o padrão) |
| **Groq** | Inferência rápida para Llama, Mixtral e outros modelos abertos | Sim | Não (usa o padrão) |
| **Mistral** | Os modelos hospedados da Mistral | Sim | Não (usa o padrão) |
| **Ollama** | Modelos de código aberto que você mesmo executa, como Llama 3.1, Mistral ou Qwen | Não | Sim |
| **OpenAI Compatible** | Qualquer servidor compatível com OpenAI: vLLM, LocalAI, LM Studio e outros | Não (opcional) | Sim |

## Configurando um provedor de LLM

:::steps
### Abra Provedores LLM

Vá para **Configurações do projeto → IA → Provedores LLM** (a seção **IA** do menu lateral começa recolhida) e clique em **Criar: Provedor LLM**.

### Escolha o provedor

Em **Provedor**, escolha seu **Provedor LLM**: um cartão para OpenAI, Anthropic, Azure OpenAI / Microsoft Foundry, Groq, Mistral, Ollama e qualquer servidor compatível com OpenAI, cada um com uma linha que diz o que é.

### Conecte-o

Em **Conexão**, o formulário pede só o que esse provedor usa, com a ajuda dele sob cada campo:

- **Chave de API**: sua chave de API, necessária para OpenAI, Azure OpenAI, Anthropic, Groq e Mistral e opcional para um servidor compatível com OpenAI; para o Ollama, nenhuma é pedida
- **URL base**: o endpoint, necessário para Azure OpenAI, Ollama e OpenAI Compatible; para os outros, só para passar por um proxy ou gateway
- **Nome do Modelo**: o modelo a usar, como `gpt-5.1`, `claude-sonnet-5-5` ou `llama3.1`. Se ficar vazio, o OneUptime usa o modelo padrão do provedor, exceto em um servidor compatível com OpenAI, que precisa de um
- **Nome**: o nome do provedor até você digitar o seu, como "Production OpenAI" ou "Local Ollama"
- **Mais campos**, recolhido abaixo dos campos acima: uma **Descrição**, **Definir como padrão**, que fica ativado para um provedor novo porque os recursos de IA só usam o provedor padrão do projeto, e **Parâmetros adicionais**, um objeto JSON opcional de parâmetros extras enviados ao provedor em cada requisição (por exemplo `{"temperature": 0.2}`)

**Quem pode ver um provedor.** Os provedores de LLM de um projeto só são lidos pelos membros que podem ler as configurações do projeto: **Project Owner**, **Project Admin**, **Project Member**, **Viewer**, **Settings Admin**, **Settings Member**, **Settings Viewer** e **Read LLM**. A **Chave de API** e os **Parâmetros adicionais** de um provedor só são lidos pelos proprietários e administradores do projeto, porque os parâmetros são enviados ao provedor em cada requisição e podem levar um token ou um cabeçalho, assim como a chave. Os outros membros veem se há parâmetros salvos, não quais são. Membros que podem editar um provedor ainda podem substituir a chave de API ou os parâmetros sem lê-los: no formulário de edição esses campos começam vazios, e deixar um em branco mantém o que está salvo. Para remover os parâmetros, salve `{}`. Só proprietários e administradores do projeto podem mudar a **URL base** de um provedor, porque a chave de API e os parâmetros adicionais dele são enviados para esse endereço; os outros membros que podem editar um provedor podem mudar todo o resto. Quem pode ler um provedor pode ler a **URL base** dele, então nunca coloque nela uma chave, um token ou uma senha: use a **Chave de API**. A lista **Provedores de LLM globais** na mesma página, os provedores compartilhados aos quais um projeto recorre, mostra nome, descrição e preço a qualquer pessoa conectada, e nada mais sobre eles.

### Teste-o

**Testando um provedor.** **Testar**, na página do provedor ou no menu da linha dele, envia ao provedor um prompt curto com a **Chave de API**, o **Nome do Modelo**, a **URL base** e os **Parâmetros adicionais** dele, e diz se ele respondeu e chamou uma ferramenta, algo de que os recursos de IA do OneUptime precisam. Um teste que falha diz primeiro o que verificar e depois o que o provedor respondeu. Quem pode alterar um provedor pode testá-lo: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member** e **Edit LLM**. Todos os outros que podem ver o provedor encontram **Testar** bloqueado. Um provedor de LLM global é testado por um administrador do servidor, no Admin Dashboard em **Configurações → Provedores de LLM globais**.
:::

## Configuração específica de cada provedor

### OpenAI

1. Obtenha sua chave de API na [OpenAI Platform](https://platform.openai.com/api-keys)
2. Selecione **OpenAI** como provedor de LLM
3. Informe sua chave de API
4. Escolha um nome de modelo:
   - `gpt-5.1` - Padrão recomendado, forte em chamadas de ferramentas e investigações complexas
   - `gpt-5.1-mini` - Mais rápido e mais econômico

```text title="Example configuration"
Name: Production OpenAI
LLM Provider: OpenAI
API Key: sk-xxxxxxxxxxxxxxxxxxxx
Model Name: gpt-5.1
```

### Anthropic

1. Obtenha sua chave de API no [Anthropic Console](https://console.anthropic.com/)
2. Selecione **Anthropic** como provedor de LLM
3. Informe sua chave de API
4. Escolha um nome de modelo:
   - `claude-sonnet-5-5` - Padrão recomendado, o melhor equilíbrio entre inteligência, velocidade e custo
   - `claude-opus-5-5` - Mais capaz, para as investigações mais difíceis
   - `claude-haiku-5-5` - O mais rápido e econômico

```text title="Example configuration"
Name: Production Anthropic
LLM Provider: Anthropic
API Key: sk-ant-xxxxxxxxxxxxxxxxxxxx
Model Name: claude-sonnet-5-5
```

O Claude Opus 4.7 e todos os modelos Claude posteriores escolhem a própria amostragem e recusam uma requisição que define `temperature`, `top_p` ou `top_k`. O OneUptime omite essas configurações para esses modelos. Se mesmo assim um modelo recusar uma delas, o OneUptime envia a requisição de novo sem ela e se lembra disso para o provedor.

Os modelos Claude 5 pensam antes de responder, e o raciocínio conta para o limite de tokens da resposta, então o OneUptime deixa espaço para ele. Para que pensem menos e respondam mais rápido e por menos, defina `{"output_config": {"effort": "low"}}` nos **Parâmetros adicionais** do provedor. O OneUptime envia à Anthropic as configurações que você adiciona ali em cada requisição, exceto `model`, `messages`, `system`, `tools`, `tool_choice` e `stream`, que ele mesmo define.

O OneUptime usa o cache de prompts da Anthropic. Cada chamada de uma investigação ou de uma resposta do Pergunte à IA envia de novo o prompt do sistema, as ferramentas e a conversa até ali, e o OneUptime os marca para o cache: uma chamada paga um décimo do preço ou menos pelo que as chamadas anteriores enviaram, e um quarto a mais que o preço pelo que é novo, que ela grava no cache. Se um gateway na frente do Claude recusar as marcações de cache, o OneUptime envia a solicitação de novo sem elas e se lembra disso para o provedor. [Como os tokens são contados](/docs/ai/ai-sre#como-os-tokens-são-contados) explica como os tokens em cache contam para os seus limites.

### Azure OpenAI e Microsoft Foundry

Use **Azure OpenAI / Microsoft Foundry** para os modelos que você implanta no Microsoft Foundry ou no Azure OpenAI: modelos da OpenAI, outros Foundry Models e Claude. Informe uma das chaves do recurso como **Chave de API**, o nome da implantação como **Nome do Modelo** e o endpoint do recurso como **URL base**, por exemplo `https://contoso-ai.openai.azure.com/openai/v1`. [Microsoft Foundry e Azure OpenAI](/docs/ai/microsoft-foundry) percorre o lado do Azure: o recurso, as permissões, a implantação do modelo, os requisitos de rede e a solução de problemas.

### Ollama (auto-hospedado)

O Ollama executa modelos de código aberto nas suas próprias máquinas.

1. Instale o Ollama a partir de [ollama.ai](https://ollama.ai)
2. Baixe um modelo: `ollama pull llama3.1`
3. Garanta que o Ollama está rodando e que o servidor do OneUptime consegue alcançá-lo. Uma instalação nativa só escuta em `127.0.0.1`, então inicie-a com `OLLAMA_HOST=0.0.0.0:11434` para aceitar conexões de outras máquinas e contêineres (a imagem oficial do Docker `ollama/ollama` já faz isso)
4. Selecione **Ollama** como provedor de LLM
5. Informe a URL base: o endereço do servidor do Ollama como o servidor do OneUptime o alcança, como `http://ollama:11434` (o OneUptime acrescenta `/api/chat` sozinho). `localhost` não funciona: veja [Escolhendo uma URL base para um modelo auto-hospedado](#escolhendo-uma-url-base-para-um-modelo-auto-hospedado)
6. Informe o nome do modelo que você baixou

```text title="Ollama as a service named ollama on OneUptime's Docker Compose network"
Name: Self-Hosted Ollama
LLM Provider: Ollama
Base URL: http://ollama:11434
Model Name: llama3.1
```

**Aumente a janela de contexto.** Salvo indicação em contrário, o Ollama dimensiona a janela de contexto de um modelo pela memória de GPU que encontra: 4k tokens abaixo de 24 GiB, 32k até 48 GiB e 256k acima disso (versões antigas usam 2.048 ou 4.096 tokens). Os recursos de IA do OneUptime são agentes. Cada requisição carrega o prompt de sistema e as definições de ferramentas deles, mais de 10.000 tokens antes de qualquer pergunta, e uma investigação de IA acrescenta cada resultado de consulta à conversa à medida que avança. Quando uma requisição não cabe mais, o Ollama descarta as mensagens mais antigas, e a pergunta vai junto. Dependendo do modelo e da versão do Ollama, o modelo então responde sem a pergunta ou sem as ferramentas, ou a requisição falha com "no user query found in messages" (Qwen 3.8 e posteriores) ou "the prompt is longer than the context length currently available to the model". O OneUptime relata essas falhas como "…the request is larger than the model's context window" e não executa a investigação de novo. Defina um `num_ctx` maior nos **Parâmetros adicionais** do provedor:

```json
{ "options": { "num_ctx": 65536 } }
```

O OneUptime mescla este objeto `options` às opções que envia ao Ollama, então liste só as configurações que quer mudar. 65.536 tokens é o que o Ollama recomenda para agentes, e isso cobre a maioria das investigações. Uma investigação longa pode usar mais, porque o OneUptime só começa a encurtar resultados de consultas antigos quando a conversa passa de cerca de 75.000 tokens: use 131.072 se o modelo suportar e sua GPU aguentar. Uma janela de contexto maior precisa de mais memória, e `ollama ps` mostra o contexto que cada modelo carregado recebeu. Para aumentar o padrão para todos os clientes, defina `OLLAMA_CONTEXT_LENGTH` no servidor do Ollama. É a única forma quando o OneUptime alcança o Ollama pela API `/v1` compatível com OpenAI (o provedor **OpenAI Compatible**), que ignora `num_ctx`. Para um provedor global registrado a partir das variáveis `GLOBAL_LLM_PROVIDER_*`, defina os **Parâmetros adicionais** no Admin Dashboard em **Configurações → Provedores de LLM globais**; a sincronização na inicialização não mexe nesse campo.

**Modelos populares do Ollama:**

- `llama3.1` - O modelo Llama 3.1 da Meta, o Llama mais antigo com suporte a chamadas de ferramentas
- `llama3.3` - O modelo Llama 3.3 da Meta
- `qwen2.5` - O modelo Qwen 2.5 da Alibaba
- `mistral-nemo` - O modelo Nemo da Mistral AI

> [!NOTE]
> Os recursos de IA do OneUptime são agentes: dependem muito de chamadas de ferramentas. Use `llama3.1` ou mais recente, ou outro modelo que chame ferramentas. Um modelo pequeno, ou um sem chamadas de ferramentas (como `llama2` ou o `llama3` original), responde mal: não consegue consultar seus monitores, incidentes ou telemetria, então as investigações voltam vazias ou inventadas.

### Escolhendo uma URL base para um modelo auto-hospedado

A URL base de um modelo auto-hospedado, seja Ollama, vLLM, LM Studio ou qualquer outro servidor compatível com OpenAI, precisa ser um endereço que o **servidor do OneUptime** consiga alcançar. Seu navegador nunca se conecta a ela.

**Endereços de loopback são sempre recusados.** Antes de se conectar, o OneUptime verifica cada endereço para o qual o nome de host da URL base resolve. `localhost`, `127.0.0.1`, `[::1]` e `0.0.0.0`, assim como endereços link-local e de metadados de nuvem como `169.254.169.254`, são recusados em toda implantação, inclusive auto-hospedada. Isso é proposital: a URL base de um provedor não pode servir para alcançar serviços no próprio servidor do OneUptime. Dentro do Docker Compose ou do Kubernetes, `localhost` seria de qualquer forma o contêiner do OneUptime, não a máquina que roda o seu modelo.

Use em vez disso um endereço privado ou um nome de host interno:

| Onde o servidor do modelo roda | URL base |
| --- | --- |
| Um serviço na rede do Docker Compose do OneUptime (`oneuptime`) | O nome do serviço, por ex. `http://ollama:11434` |
| O mesmo cluster Kubernetes do OneUptime | O nome DNS do Service, por ex. `http://ollama.<namespace>.svc.cluster.local:11434`, o mesmo padrão do [vLLM incluído](#vllm-auto-hospedado-no-kubernetes-helm) |
| A própria máquina host, fora de qualquer contêiner | O IP de LAN do host, por ex. `http://192.168.1.20:11434`, ou `http://host.docker.internal:11434` no Docker Desktop |
| Outra máquina na sua rede | O IP privado ou o nome de host interno dela, por ex. `http://10.0.0.12:11434` |

Servidores compatíveis com OpenAI seguem as mesmas regras com a própria porta e o caminho `/v1`, por ex. `http://vllm:8000/v1`, ou `http://192.168.1.20:1234/v1` para o LM Studio. Como uma instalação nativa do Ollama, o LM Studio só escuta em `127.0.0.1` até você ativar **Serve on Local Network** nas configurações de servidor dele.

**Endereços privados funcionam em instalações auto-hospedadas.** Um OneUptime auto-hospedado consegue alcançar endereços de rede privada, como `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10` e IPv6 `fc00::/7`, a menos que você defina `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true`, que os recusa como faz o OneUptime Cloud. Essa configuração não se aplica a um provedor de LLM global, que um administrador configura (com as variáveis `GLOBAL_LLM_PROVIDER_*` ou no Admin Dashboard) em vez de um projeto: ele continua alcançando endereços privados. Endereços de loopback e link-local continuam recusados para todo provedor.

**O OneUptime Cloud (SaaS) não consegue alcançar redes privadas.** Ele recusa endereços de rede privada, e nomes de host que resolvem para eles, para todo provedor de LLM. Para usar um modelo que roda na sua própria infraestrutura, hospede o OneUptime em uma rede que consiga alcançá-lo, ou exponha o modelo em um endpoint acessível publicamente. Proteja um endpoint público com uma chave de API: o provedor **Ollama** não envia credenciais, enquanto **OpenAI Compatible** envia a chave de API como token bearer (o Ollama também serve uma API compatível com OpenAI em `/v1`, então ele pode ficar atrás de um proxy reverso que verifique a chave).

### OpenAI Compatible (vLLM, LocalAI, LM Studio e outros)

Use o provedor **OpenAI Compatible** para qualquer servidor que implemente a API `/chat/completions` da OpenAI mas não seja a OpenAI, por exemplo [vLLM](https://docs.vllm.ai), [LocalAI](https://localai.io), [LM Studio](https://lmstudio.ai) ou text-generation-webui. Eles costumam rodar no seu próprio endereço, muitas vezes sem autenticação.

1. Inicie seu servidor compatível com OpenAI e anote a URL base dele (ela costuma terminar em `/v1`)
2. Selecione **OpenAI Compatible** como provedor de LLM
3. Informe a **URL base** (obrigatória), por ex. `http://your-server:8000/v1`. O servidor do OneUptime precisa alcançá-la, então não `localhost`: veja [Escolhendo uma URL base para um modelo auto-hospedado](#escolhendo-uma-url-base-para-um-modelo-auto-hospedado)
4. Informe o **Nome do Modelo** (obrigatório): ele precisa corresponder a um modelo que o seu servidor oferece
5. Informe a **Chave de API** só se o seu servidor pedir uma; deixe em branco para um servidor sem chave

```text title="A keyless vLLM"
Name: Self-Hosted vLLM
LLM Provider: OpenAI Compatible
Base URL: http://vllm.internal:8000/v1
Model Name: meta-llama/Llama-3.1-8B-Instruct
API Key: (leave blank)
```

> [!TIP]
> Depois de salvar, use **Testar** no provedor para verificar a conexão, o nome do modelo e a URL base.

### vLLM auto-hospedado no Kubernetes (Helm)

Se você hospeda o OneUptime com o chart do Helm, pode executar o [vLLM](https://docs.vllm.ai), um servidor de inferência compatível com OpenAI, dentro do seu cluster e servir modelos locais nas suas próprias GPUs. Nenhum dado sai da sua infraestrutura.

1. Ative-o nos seus valores do Helm (ele precisa de nós com GPU NVIDIA):

   ```yaml
   vllm:
     enabled: true
     model: Qwen/Qwen2.5-1.5B-Instruct
   ```

2. Execute `helm upgrade` e espere o pod do vLLM ficar Ready (a primeira inicialização baixa o modelo)
3. Pronto: o vLLM é registrado automaticamente como provedor de LLM global na inicialização (`vllm.globalProvider.enabled`, padrão `true`), então os recursos de IA funcionam para todos os projetos, inclusive as tarefas de correção de IA. (Em todo lugar, na nuvem e auto-hospedado, as tarefas de correção do agente usam o provedor global quando o projeto não tem provedor próprio; na nuvem esse uso é cobrado como tokens de IA medidos. Um provedor do próprio projeto sempre tem prioridade.)

Se você desativou o registro automático (`vllm.globalProvider.enabled: false`), crie o provedor à mão:

1. Selecione **OpenAI Compatible** como provedor de LLM (o vLLM fala a API da OpenAI)
2. Informe a URL base dentro do cluster: `http://<release>-vllm.<namespace>.svc.cluster.local:8000/v1` (substitua `cluster.local` se você mudou `global.clusterDomain`)
3. Informe o nome do modelo: o id completo do modelo no Hugging Face (ou `vllm.servedModelName`, se você definiu um)
4. Informe a chave de API só se você definiu `vllm.apiKey`; deixe em branco para um vLLM sem chave

```text title="The in-cluster vLLM"
Name: In-Cluster vLLM
LLM Provider: OpenAI Compatible
Base URL: http://oneuptime-vllm.default.svc.cluster.local:8000/v1
Model Name: Qwen/Qwen2.5-1.5B-Instruct
API Key: (leave blank unless vllm.apiKey is set)
```

Com o faturamento ativado, ou com `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true` (`outboundConnections.blockPrivateNetwork: true` nos valores do Helm), o provedor próprio de um projeto não consegue alcançar este endereço dentro do cluster, que resolve para um IP privado do cluster. Crie em vez disso o provedor no Admin Dashboard em **Configurações → Provedores de LLM globais**, com os mesmos campos: um provedor de LLM global consegue alcançar esse endereço.

Veja o [guia do vLLM do chart do Helm](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/ai-vllm.md) para agendamento de GPU, modelos restritos e opções de ajuste.

## Boas práticas

- **Dê nomes claros aos provedores**, como "Production OpenAI" ou "Development Ollama", para que um colega saiba qual é qual.
- **Guarde as chaves no campo Chave de API.** As chaves de API são criptografadas em repouso, e só os proprietários e administradores do projeto as leem.
- **Teste depois de cada mudança**, com **Testar** no provedor.
- **Acompanhe quanto a IA custa.** Cada chamada é listada com seus tokens e seu custo em **Configurações do projeto → IA → Registros de IA**.

## Solução de problemas

:::details Não é possível alcançar o provedor
- **OpenAI ou Anthropic**: verifique se sua chave de API é válida e tem créditos
- **Azure OpenAI / Microsoft Foundry**: o erro começa pelo que mudar. [Microsoft Foundry e Azure OpenAI](/docs/ai/microsoft-foundry) explica cada erro com que o Azure responde
- **Ollama**: verifique se o servidor do Ollama está rodando, se escuta em um endereço que o servidor do OneUptime alcança (`OLLAMA_HOST=0.0.0.0:11434` em uma instalação nativa) e se a URL base aponta para esse endereço
- **OpenAI Compatible**: verifique se a URL base termina em `/v1` (ou corresponde ao seu servidor), se o nome do modelo corresponde a um modelo que o seu servidor oferece e se você só definiu uma chave de API caso o seu servidor peça uma
- **"…points to an address OneUptime is not allowed to connect to"**: a URL base resolve para um endereço recusado: `localhost` ou outro endereço de loopback, ou, no OneUptime Cloud, um endereço de rede privada. (O OneUptime Cloud relata um nome de host recusado como "…could not be reached".) Veja [Escolhendo uma URL base para um modelo auto-hospedado](#escolhendo-uma-url-base-para-um-modelo-auto-hospedado)
- **Um firewall**: verifique se a sua rede permite conexões de saída para a API do provedor
:::

:::details O modelo não é encontrado
Verifique a grafia do nome do modelo. No Ollama, baixe primeiro o modelo com `ollama pull <model-name>`. Alguns modelos só estão disponíveis em algumas regiões.
:::

:::details A janela de contexto é pequena demais
- **"…the request is larger than the model's context window"**: a requisição não coube na janela de contexto do modelo, geralmente porque uma investigação de IA reuniu muitas evidências. Aumente `num_ctx` nos **Parâmetros adicionais** do provedor, ou `OLLAMA_CONTEXT_LENGTH` no servidor do Ollama; veja [Ollama (auto-hospedado)](#ollama-auto-hospedado)
- **"no user query found in messages"**: o mesmo problema, como o Qwen o relata. O OneUptime sempre envia a pergunta; o Ollama a descartou para fazer o resto da requisição caber
:::

Ainda com problemas? Procure o seu erro nas [issues do GitHub do OneUptime](https://github.com/OneUptime/oneuptime/issues), ou fale com o suporte se o seu plano incluir.

## Próximos passos

:::cards
- [Código](/docs/ai/ai-agent): Os pull requests que o seu provedor escreve, e onde eles começam.
- [AI SRE](/docs/ai/ai-sre): O que a OneUptime AI faz com o provedor depois de tê-lo.
- [Pergunte à IA](/docs/ai/ask-ai): Faça uma pergunta ao seu projeto, e troque o provedor de uma conversa.
:::
