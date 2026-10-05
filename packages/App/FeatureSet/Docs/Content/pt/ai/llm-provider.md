# Provedores de LLM

O OneUptime suporta integração com vários provedores de Modelos de Linguagem de Grande Escala (LLM) para habilitar recursos alimentados por IA em toda a plataforma. Este guia ajudará você a configurar seu próprio provedor de LLM.

## O que os Provedores de LLM podem fazer?

Os Provedores de LLM no OneUptime ajudam você a automatizar e aprimorar seu fluxo de trabalho de gerenciamento de incidentes:

- **Investigações autônomas**: Investigar automaticamente novos incidentes e alertas e publicar na linha do tempo uma análise de causa raiz com as fontes citadas — veja [AI SRE](/docs/ai/ai-sre)
- **Notas de Incidentes**: Gerar automaticamente notas e atualizações detalhadas de incidentes
- **Notas de Alertas**: Criar descrições e contexto significativos para alertas
- **Notas de Manutenção Programada**: Gerar notas de eventos de manutenção automaticamente
- **Pós-mortems de Incidentes**: Rascunhar automaticamente relatórios abrangentes de pós-mortem de incidentes
- **Melhorias de Código**: Se você conectar seu repositório de código ao OneUptime, usaremos seu Provedor de LLM para analisar dados de telemetria (logs, rastreamentos, métricas, exceções) e sugerir melhorias de código

## Usuários do OneUptime SaaS

Se você estiver usando o **OneUptime SaaS** (versão hospedada na nuvem), poderá usar o **Provedor de LLM Global** por padrão, sem nenhuma configuração adicional. O Provedor de LLM Global está pré-configurado e pronto para uso em todos os recursos de IA.

Se preferir usar suas próprias chaves de API ou um provedor específico, ainda poderá configurar um Provedor de LLM personalizado seguindo as instruções abaixo.

O OneUptime SaaS só consegue acessar endpoints de LLM na internet pública. Ele não consegue se conectar a um modelo na sua rede privada, como um servidor Ollama ou vLLM auto-hospedado. Para usar um modelo que você mesmo executa, auto-hospede o OneUptime em uma rede que consiga alcançá-lo ou exponha o modelo em um endpoint público — veja [Como escolher a URL base de um modelo auto-hospedado](#como-escolher-a-url-base-de-um-modelo-auto-hospedado).

## Auto-hospedado: configuração zero com variáveis de ambiente

Em uma instância auto-hospedada, a forma mais rápida de ativar os recursos de IA para **todos os projetos de uma vez** é definir as variáveis de ambiente `GLOBAL_LLM_PROVIDER_*` no seu servidor OneUptime — no `config.env` para Docker Compose, ou pelos valores do Helm. Na inicialização, o OneUptime registra a partir delas um Provedor de LLM Global (e o mantém sincronizado); não é preciso configurar nada no painel para cada projeto, e as tarefas de correção de IA também o usam quando um projeto não tem um provedor próprio.

| Variável | Descrição |
| --- | --- |
| `GLOBAL_LLM_PROVIDER_TYPE` | Obrigatória para ativar. Um destes valores: `OpenAI`, `AzureOpenAI`, `Anthropic`, `Groq`, `Mistral`, `Ollama`, `OpenAICompatible` |
| `GLOBAL_LLM_PROVIDER_API_KEY` | Chave de API — obrigatória para OpenAI, Azure OpenAI, Anthropic, Groq e Mistral; desnecessária para Ollama ou servidores compatíveis com OpenAI sem chave |
| `GLOBAL_LLM_PROVIDER_BASE_URL` | Endpoint da API — obrigatório para Azure OpenAI, Ollama e servidores compatíveis com OpenAI |
| `GLOBAL_LLM_PROVIDER_MODEL_NAME` | Modelo a usar (obrigatório para servidores compatíveis com OpenAI, recomendado nos demais casos) |
| `GLOBAL_LLM_PROVIDER_NAME` | Nome amigável opcional exibido no painel |

**Exemplo: Ollama auto-hospedado**

```bash
GLOBAL_LLM_PROVIDER_TYPE=Ollama
# Um endereço que o servidor do OneUptime consiga alcançar. Nunca localhost:
# veja "Como escolher a URL base de um modelo auto-hospedado" mais abaixo.
GLOBAL_LLM_PROVIDER_BASE_URL=http://ollama:11434
GLOBAL_LLM_PROVIDER_MODEL_NAME=llama3.1
# Nenhuma chave de API necessária — o Ollama funciona sem chave.
```

**Exemplo: OpenAI**

```bash
GLOBAL_LLM_PROVIDER_TYPE=OpenAI
GLOBAL_LLM_PROVIDER_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
GLOBAL_LLM_PROVIDER_MODEL_NAME=gpt-5.1
```

A sincronização é declarativa: alterar as variáveis atualiza o provedor na próxima reinicialização, e remover `GLOBAL_LLM_PROVIDER_TYPE` o exclui. Provedores globais criados manualmente no painel de administração nunca são alterados. Os projetos ainda podem adicionar o próprio provedor em **Configurações do projeto** > **IA** > **Provedores LLM** — um provedor do próprio projeto sempre tem prioridade sobre o global.

## Provedores Suportados

O OneUptime atualmente suporta os seguintes provedores de LLM:

| Provedor              | Descrição                                                                    | Chave de API Necessária | URL Base Necessária |
| --------------------- | ---------------------------------------------------------------------------- | ----------------------- | ------------------- |
| **OpenAI**            | GPT-5.1 e outros modelos OpenAI                                              | Sim                     | Não (usa o padrão)  |
| **Azure OpenAI**      | Modelos OpenAI hospedados na sua implantação Azure                           | Sim                     | Sim                 |
| **Anthropic**         | Claude Sonnet 5, Claude Opus 5, Claude Haiku 4.5 e outros modelos Claude     | Sim                     | Não (usa o padrão)  |
| **Groq**              | Inferência rápida para Llama, Mixtral e outros modelos abertos               | Sim                     | Não (usa o padrão)  |
| **Mistral**           | Modelos hospedados da Mistral                                                | Sim                     | Não (usa o padrão)  |
| **Ollama**            | Modelos de código aberto auto-hospedados como Llama 3.1, Mistral, Qwen, etc. | Não                     | Sim                 |
| **OpenAI Compatible** | Qualquer servidor compatível com a OpenAI (vLLM, LocalAI, LM Studio, etc.)   | Não (opcional)          | Sim                 |

## Configurando um Provedor de LLM

### Passo 1: Navegar para as Configurações de Provedores de LLM

1. Faça login no seu painel do OneUptime
2. Vá para **Configurações do projeto** > **IA** > **Provedores LLM**
3. Clique em **Criar: Provedor LLM** para adicionar um novo provedor

### Passo 2: Configurar Seu Provedor

Preencha os seguintes campos:

- **Nome**: Um nome amigável para esta configuração de LLM (ex.: "OpenAI de Produção", "Ollama Local")
- **Descrição** (opcional): Uma descrição para ajudar a identificar o propósito deste provedor
- **Provedor LLM**: Selecione o tipo de provedor (OpenAI, Azure OpenAI, Anthropic, Groq, Mistral, Ollama ou OpenAI Compatible)
- **Chave de API**: Sua chave de API (obrigatória para OpenAI, Azure OpenAI, Anthropic, Groq e Mistral; opcional para Ollama e servidores compatíveis com OpenAI)
- **Nome do Modelo**: O modelo específico a ser usado (ex.: `gpt-5.1`, `claude-sonnet-5`, `llama3.1`)
- **URL base** (opcional): URL do endpoint de API personalizado (obrigatória para Azure OpenAI, Ollama e OpenAI Compatible; opcional para outros)
- **Mais campos**, recolhido abaixo dos campos acima: **Definir como padrão**, que vem ativado em um provedor novo porque os recursos de IA usam apenas o provedor padrão do projeto, e **Parâmetros adicionais**, um objeto JSON opcional com parâmetros extras enviados ao provedor em cada requisição (por exemplo, `{"temperature": 0.2}`)

## Configuração Específica por Provedor

### OpenAI

1. Obtenha sua chave de API na [Plataforma OpenAI](https://platform.openai.com/api-keys)
2. Selecione **OpenAI** como o Provedor LLM
3. Insira sua chave de API
4. Escolha um nome de modelo:
   - `gpt-5.1` - Padrão recomendado, forte em chamadas de ferramentas e investigações complexas
   - `gpt-5.1-mini` - Mais rápido e mais econômico

**Exemplo de Configuração:**

```
Nome: OpenAI de Produção
Provedor LLM: OpenAI
Chave de API: sk-xxxxxxxxxxxxxxxxxxxx
Nome do Modelo: gpt-5.1
```

### Anthropic

1. Obtenha sua chave de API no [Console Anthropic](https://console.anthropic.com/)
2. Selecione **Anthropic** como o Provedor LLM
3. Insira sua chave de API
4. Escolha um nome de modelo:
   - `claude-sonnet-5` - Padrão recomendado, melhor equilíbrio entre inteligência, velocidade e custo
   - `claude-opus-5` - Modelo mais capaz, para as investigações mais difíceis
   - `claude-haiku-4-5` - O mais rápido e mais econômico

**Exemplo de Configuração:**

```
Nome: Anthropic de Produção
Provedor LLM: Anthropic
Chave de API: sk-ant-xxxxxxxxxxxxxxxxxxxx
Nome do Modelo: claude-sonnet-5
```

### Ollama (Auto-Hospedado)

O Ollama permite que você execute LLMs de código aberto localmente ou na sua própria infraestrutura.

1. Instale o Ollama em [ollama.ai](https://ollama.ai)
2. Baixe o modelo desejado: `ollama pull llama3.1`
3. Certifique-se de que o Ollama está em execução e acessível a partir do servidor do OneUptime. Uma instalação nativa escuta apenas em `127.0.0.1`, então inicie-a com `OLLAMA_HOST=0.0.0.0:11434` para aceitar conexões de outras máquinas e contêineres (a imagem Docker oficial `ollama/ollama` já faz isso)
4. Selecione **Ollama** como o Provedor LLM
5. Insira a URL Base: o endereço do servidor Ollama como o servidor do OneUptime o alcança, ex.: `http://ollama:11434` (o OneUptime acrescenta `/api/chat` sozinho). `localhost` não funciona — veja [Como escolher a URL base de um modelo auto-hospedado](#como-escolher-a-url-base-de-um-modelo-auto-hospedado)
6. Insira o nome do modelo que você baixou

**Exemplo de Configuração (Ollama como um serviço chamado `ollama` na rede Docker Compose do OneUptime):**

```
Nome: Ollama Auto-Hospedado
Provedor LLM: Ollama
URL Base: http://ollama:11434
Nome do Modelo: llama3.1
```

**Aumente a janela de contexto.** A menos que seja configurado de outra forma, o Ollama executa um modelo com uma janela de contexto pequena (4096 tokens nas versões atuais, 2048 nas mais antigas) e corta silenciosamente tudo o que não cabe. Os recursos de IA do OneUptime enviam suas definições de ferramentas em cada requisição, e só elas podem ocupar vários milhares de tokens. Quando são cortadas, nenhum erro aparece: o modelo simplesmente responde que não tem nenhuma ferramenta para a pergunta. Defina um `num_ctx` maior no campo **Parâmetros adicionais** do provedor:

```json
{ "options": { "num_ctx": 16384 } }
```

O OneUptime mescla este objeto `options` com as opções que envia ao Ollama, então liste apenas as configurações que você quer alterar. Uma janela de contexto maior exige mais memória; escolha um tamanho que seu modelo suporte e que seu hardware aguente. Para aumentar, em vez disso, o padrão para todos os clientes, defina `OLLAMA_CONTEXT_LENGTH` no servidor Ollama. Para um provedor global registrado a partir das variáveis `GLOBAL_LLM_PROVIDER_*`, defina esse campo no painel de administração, em **Configurações** > **Provedores de LLM globais**; a sincronização na inicialização não mexe nesse campo.

**Modelos Populares do Ollama:**

- `llama3.1` - Modelo Llama 3.1 da Meta, o Llama mais antigo com suporte a chamadas de ferramentas
- `llama3.3` - Modelo Llama 3.3 da Meta
- `qwen2.5` - Modelo Qwen 2.5 da Alibaba
- `mistral-nemo` - Modelo Nemo da Mistral AI

> Observação: os recursos de IA do OneUptime são agênticos — dependem fortemente de chamadas de ferramentas. Use `llama3.1` ou mais recente (ou outro modelo com suporte a chamadas de ferramentas). Modelos pequenos ou sem suporte a chamadas de ferramentas (ex.: `llama2`, o `llama3` original) produzem resultados ruins: não conseguem consultar seus monitores, incidentes ou telemetria, então as investigações voltam vazias ou inventadas.

### Como escolher a URL base de um modelo auto-hospedado

A URL base de um modelo auto-hospedado — Ollama, vLLM, LM Studio ou qualquer outro servidor compatível com a OpenAI — precisa ser um endereço que o **servidor do OneUptime** consiga alcançar. O seu navegador nunca se conecta a ela.

**Endereços de loopback são sempre recusados.** Antes de se conectar, o OneUptime verifica cada endereço para o qual o nome de host da URL base é resolvido. `localhost`, `127.0.0.1`, `[::1]` e `0.0.0.0`, assim como endereços link-local e de metadados de nuvem como `169.254.169.254`, são recusados em todas as implantações, inclusive nas auto-hospedadas. Isso é intencional: a URL base de um provedor não pode servir para alcançar serviços no próprio servidor do OneUptime. Além disso, dentro do Docker Compose ou do Kubernetes, `localhost` seria o contêiner do OneUptime, e não a máquina que executa o seu modelo.

Em vez disso, use um endereço privado ou um nome de host interno:

| Onde o servidor do modelo é executado | URL base |
| --- | --- |
| Um serviço na rede Docker Compose do OneUptime (`oneuptime`) | O nome do serviço, ex.: `http://ollama:11434` |
| O mesmo cluster Kubernetes do OneUptime | O nome DNS do Service, ex.: `http://ollama.<namespace>.svc.cluster.local:11434` — o mesmo padrão do [vLLM incluído](#vllm-auto-hospedado-no-kubernetes-helm) |
| A própria máquina host, fora de qualquer contêiner | O IP de LAN do host, ex.: `http://192.168.1.20:11434`, ou `http://host.docker.internal:11434` no Docker Desktop |
| Outra máquina da sua rede | O IP privado ou o nome de host interno dela, ex.: `http://10.0.0.12:11434` |

Servidores compatíveis com a OpenAI seguem as mesmas regras, com sua própria porta e o caminho `/v1`, ex.: `http://vllm:8000/v1`, ou `http://192.168.1.20:1234/v1` para o LM Studio. Assim como uma instalação nativa do Ollama, o LM Studio só escuta em `127.0.0.1` até você ativar **Serve on Local Network** nas configurações do servidor dele.

**Endereços privados funcionam em instalações auto-hospedadas.** Um OneUptime auto-hospedado consegue alcançar endereços de rede privada, como `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10` e IPv6 `fc00::/7`, a menos que você defina `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true`, que os recusa como o OneUptime Cloud faz.

**O OneUptime Cloud (SaaS) não consegue alcançar redes privadas.** Ele recusa endereços de rede privada, e nomes de host que resolvem para eles, para todos os provedores de LLM. Para usar um modelo executado na sua própria infraestrutura, auto-hospede o OneUptime em uma rede que consiga alcançá-lo ou exponha o modelo em um endpoint acessível publicamente. Proteja um endpoint público com uma chave de API: o provedor **Ollama** não envia credenciais, enquanto o **OpenAI Compatible** envia a Chave de API como token bearer (o Ollama também oferece uma API compatível com a OpenAI em `/v1`, então pode ficar atrás de um proxy reverso que verifique a chave).

### OpenAI Compatible (vLLM, LocalAI, LM Studio, etc.)

Use o provedor **OpenAI Compatible** para qualquer servidor que implemente a API `/chat/completions` da OpenAI, mas que não seja a OpenAI em si — por exemplo, [vLLM](https://docs.vllm.ai), [LocalAI](https://localai.io), [LM Studio](https://lmstudio.ai) ou text-generation-webui. Esses servidores geralmente são auto-hospedados em sua própria URL e frequentemente funcionam sem autenticação.

1. Inicie seu servidor compatível com OpenAI e anote sua URL base (geralmente termina em `/v1`)
2. Selecione **OpenAI Compatible** como o Provedor LLM
3. Insira a **URL base** (obrigatória), ex.: `http://your-server:8000/v1`. Ela precisa ser acessível a partir do servidor do OneUptime, então não use `localhost` — veja [Como escolher a URL base de um modelo auto-hospedado](#como-escolher-a-url-base-de-um-modelo-auto-hospedado)
4. Insira o **Nome do Modelo** (obrigatório) — deve corresponder a um modelo exposto pelo seu servidor
5. Insira a **Chave de API** somente se o seu servidor exigir uma; deixe em branco para servidores sem autenticação

**Exemplo de Configuração (vLLM sem chave):**

```
Nome: vLLM Auto-Hospedado
Provedor LLM: OpenAI Compatible
URL Base: http://vllm.internal:8000/v1
Nome do Modelo: meta-llama/Llama-3.1-8B-Instruct
Chave de API: (deixe em branco)
```

> Dica: Após salvar, use o botão **Testar** no provedor para confirmar que a conexão, o nome do modelo e a URL base estão corretos.

### vLLM Auto-Hospedado no Kubernetes (Helm)

Se você auto-hospeda o OneUptime com o Helm chart, pode executar o [vLLM](https://docs.vllm.ai) — um servidor de inferência compatível com OpenAI — dentro do seu cluster e servir modelos locais em suas próprias GPUs. Nenhum dado sai da sua infraestrutura.

1. Habilite-o nos seus valores do Helm (requer nós com GPU NVIDIA):

   ```yaml
   vllm:
     enabled: true
     model: Qwen/Qwen2.5-1.5B-Instruct
   ```

2. Execute `helm upgrade` e aguarde o pod do vLLM ficar pronto (a primeira inicialização baixa o modelo)
3. Pronto — o vLLM é registrado automaticamente como um Provedor de LLM Global na inicialização (`vllm.globalProvider.enabled`, padrão `true`), então os recursos de IA funcionam para todos os projetos, inclusive as tarefas de correção de IA. (Em todo lugar — na nuvem e em instalações auto-hospedadas — as tarefas de correção do agente usam o provedor global quando o projeto não tem um provedor próprio; na nuvem, esse uso é cobrado como tokens de IA medidos. Um provedor do próprio projeto sempre tem prioridade.)

Se você desabilitou o registro automático (`vllm.globalProvider.enabled: false`), crie o provedor manualmente:

1. Selecione **OpenAI Compatible** como o Provedor LLM (o vLLM fala a API da OpenAI)
2. Insira a URL Base interna do cluster: `http://<release>-vllm.<namespace>.svc.cluster.local:8000/v1` (substitua `cluster.local` se você alterou `global.clusterDomain`)
3. Insira o Nome do Modelo: o id completo do modelo no HuggingFace (ou `vllm.servedModelName` se você definiu um)
4. Insira a Chave de API somente se você definiu `vllm.apiKey`; deixe em branco para um vLLM sem autenticação

**Exemplo de Configuração:**

```
Nome: vLLM no Cluster
Provedor LLM: OpenAI Compatible
URL Base: http://oneuptime-vllm.default.svc.cluster.local:8000/v1
Nome do Modelo: Qwen/Qwen2.5-1.5B-Instruct
Chave de API: (deixe em branco, a menos que vllm.apiKey esteja definido)
```

Consulte o [guia de vLLM do Helm chart](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/ai-vllm.md) para agendamento de GPU, modelos restritos e opções de ajuste.

## Usando URLs Base Personalizadas

Para implantações empresariais ou ao usar serviços de proxy, você pode especificar uma URL Base personalizada:

- **Azure OpenAI**: Use a URL do seu endpoint Azure
- **APIs compatíveis com OpenAI**: Qualquer API que siga a especificação de API da OpenAI
- **Instâncias privadas do Ollama**: A URL do seu servidor Ollama interno

## Melhores Práticas

1. **Use nomes descritivos**: Nomeie seus provedores claramente (ex.: "OpenAI de Produção", "Ollama de Desenvolvimento")
2. **Proteja suas chaves de API**: As chaves de API são criptografadas em repouso, mas evite compartilhá-las
3. **Teste sua configuração**: Após a configuração, verifique se o provedor funciona com os recursos de IA
4. **Monitore o uso**: Acompanhe o uso da API para gerenciar custos

## Solução de Problemas

### Problemas de Conexão

- **OpenAI/Anthropic**: Verifique se sua chave de API é válida e tem créditos suficientes
- **Ollama**: Certifique-se de que o servidor Ollama está em execução, escuta em um endereço que o servidor do OneUptime consegue alcançar (`OLLAMA_HOST=0.0.0.0:11434` em uma instalação nativa) e que a URL Base aponta para esse endereço
- **OpenAI Compatible**: Certifique-se de que a URL Base termina em `/v1` (ou corresponde ao seu servidor), que o Nome do Modelo corresponde a um modelo exposto pelo seu servidor, e defina uma Chave de API somente se o seu servidor exigir uma
- **"…points to an address OneUptime is not allowed to connect to"**: a URL Base resolve para um endereço recusado — `localhost` ou outro endereço de loopback ou, no OneUptime Cloud, um endereço de rede privada. (O OneUptime Cloud informa um nome de host recusado como "…could not be reached".) Veja [Como escolher a URL base de um modelo auto-hospedado](#como-escolher-a-url-base-de-um-modelo-auto-hospedado)
- **Firewall**: Verifique se sua rede permite conexões de saída para a API do provedor

### Modelo Não Encontrado

- Verifique se o nome do modelo está escrito corretamente
- Para Ollama, certifique-se de que você baixou o modelo com `ollama pull <nome-do-modelo>`
- Verifique se o modelo está disponível na sua região (alguns modelos têm restrições regionais)

## Precisa de Ajuda?

Se você encontrar problemas ao configurar seu provedor de LLM, por favor:

1. Verifique os [Problemas do GitHub do OneUptime](https://github.com/OneUptime/oneuptime/issues) para problemas conhecidos
2. Entre em contato com o suporte se você estiver em um plano empresarial
