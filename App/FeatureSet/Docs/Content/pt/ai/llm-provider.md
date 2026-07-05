# Provedores de LLM

O OneUptime suporta integração com vários provedores de Modelos de Linguagem de Grande Escala (LLM) para habilitar recursos alimentados por IA em toda a plataforma. Este guia ajudará você a configurar seu próprio provedor de LLM.

## O que os Provedores de LLM podem fazer?

Os Provedores de LLM no OneUptime ajudam você a automatizar e aprimorar seu fluxo de trabalho de gerenciamento de incidentes:

- **Notas de Incidentes**: Gerar automaticamente notas e atualizações detalhadas de incidentes
- **Notas de Alertas**: Criar descrições e contexto significativos para alertas
- **Notas de Manutenção Programada**: Gerar notas de eventos de manutenção automaticamente
- **Pós-mortems de Incidentes**: Rascunhar automaticamente relatórios abrangentes de pós-mortem de incidentes
- **Melhorias de Código**: Se você conectar seu repositório de código ao OneUptime, usaremos seu Provedor de LLM para analisar dados de telemetria (logs, rastreamentos, métricas, exceções) e sugerir melhorias de código

## Usuários do OneUptime SaaS

Se você estiver usando o **OneUptime SaaS** (versão hospedada na nuvem), poderá usar o **Provedor de LLM Global** por padrão, sem nenhuma configuração adicional. O Provedor de LLM Global está pré-configurado e pronto para uso em todos os recursos de IA.

Se preferir usar suas próprias chaves de API ou um provedor específico, ainda poderá configurar um Provedor de LLM personalizado seguindo as instruções abaixo.

## Provedores Suportados

O OneUptime atualmente suporta os seguintes provedores de LLM:

| Provedor      | Descrição                                                                       | Chave de API Necessária | URL Base Necessária |
| ------------- | ------------------------------------------------------------------------------- | ----------------------- | ------------------- |
| **OpenAI**    | GPT-4, GPT-4o, GPT-3.5 Turbo e outros modelos OpenAI                            | Sim                     | Não (usa o padrão)  |
| **Anthropic** | Claude 3 Opus, Claude 3 Sonnet, Claude 3 Haiku e outros modelos Claude          | Sim                     | Não (usa o padrão)  |
| **Ollama**    | Modelos de código aberto auto-hospedados como Llama 2, Mistral, CodeLlama, etc. | Não                     | Sim                 |

## Configurando um Provedor de LLM

### Passo 1: Navegar para as Configurações de Provedores de LLM

1. Faça login no seu painel do OneUptime
2. Vá para **Agentes de IA** > **Provedores de LLM**
3. Clique em **Criar Provedor de LLM** para adicionar um novo provedor

### Passo 2: Configurar Seu Provedor

Preencha os seguintes campos:

- **Nome**: Um nome amigável para esta configuração de LLM (ex.: "OpenAI de Produção", "Ollama Local")
- **Descrição** (opcional): Uma descrição para ajudar a identificar o propósito deste provedor
- **Tipo de LLM**: Selecione o tipo de provedor (OpenAI, Anthropic ou Ollama)
- **Chave de API**: Sua chave de API (obrigatória para OpenAI e Anthropic)
- **Nome do Modelo**: O modelo específico a ser usado (ex.: `gpt-4o`, `claude-3-opus-20240229`, `llama2`)
- **URL Base** (opcional): URL do endpoint de API personalizado (obrigatória para Ollama, opcional para outros)

## Configuração Específica por Provedor

### OpenAI

1. Obtenha sua chave de API na [Plataforma OpenAI](https://platform.openai.com/api-keys)
2. Selecione **OpenAI** como o Tipo de LLM
3. Insira sua chave de API
4. Escolha um nome de modelo:
   - `gpt-4o` - Modelo mais capaz, melhor para tarefas complexas
   - `gpt-4o-mini` - Mais rápido e mais econômico
   - `gpt-4-turbo` - Bom equilíbrio entre capacidade e velocidade
   - `gpt-3.5-turbo` - Rápido e econômico

**Exemplo de Configuração:**

```
Nome: OpenAI de Produção
Tipo de LLM: OpenAI
Chave de API: sk-xxxxxxxxxxxxxxxxxxxx
Nome do Modelo: gpt-4o
```

### Anthropic

1. Obtenha sua chave de API no [Console Anthropic](https://console.anthropic.com/)
2. Selecione **Anthropic** como o Tipo de LLM
3. Insira sua chave de API
4. Escolha um nome de modelo:
   - `claude-3-opus-20240229` - Modelo mais capaz
   - `claude-3-sonnet-20240229` - Bom equilíbrio entre inteligência e velocidade
   - `claude-3-haiku-20240307` - Mais rápido e mais compacto
   - `claude-3-5-sonnet-20241022` - Modelo Sonnet mais recente

**Exemplo de Configuração:**

```
Nome: Anthropic de Produção
Tipo de LLM: Anthropic
Chave de API: sk-ant-xxxxxxxxxxxxxxxxxxxx
Nome do Modelo: claude-3-5-sonnet-20241022
```

### Ollama (Auto-Hospedado)

O Ollama permite que você execute LLMs de código aberto localmente ou na sua própria infraestrutura.

1. Instale o Ollama em [ollama.ai](https://ollama.ai)
2. Baixe o modelo desejado: `ollama pull llama2`
3. Certifique-se de que o Ollama está em execução e acessível
4. Selecione **Ollama** como o Tipo de LLM
5. Insira a URL Base (ex.: `http://localhost:11434`)
6. Insira o nome do modelo que você baixou

**Exemplo de Configuração:**

```
Nome: Ollama Local
Tipo de LLM: Ollama
URL Base: http://localhost:11434
Nome do Modelo: llama2
```

**Modelos Populares do Ollama:**

- `llama2` - Modelo Llama 2 da Meta
- `llama3` - Modelo Llama 3 da Meta
- `mistral` - Modelo da Mistral AI
- `codellama` - Modelo Llama especializado em código
- `mixtral` - Modelo mixture of experts da Mistral

## Usando URLs Base Personalizadas

Para implantações empresariais ou ao usar serviços de proxy, você pode especificar uma URL Base personalizada:

- **Azure OpenAI**: Use a URL do seu endpoint Azure
- **APIs compatíveis com OpenAI**: Qualquer API que siga a especificação de API da OpenAI
- **Instâncias privadas do Ollama**: A URL do seu servidor Ollama interno

## Melhores Práticas

1. **Use nomes descritivos**: Nomeie seus provedores claramente (ex.: "GPT-4 de Produção", "Ollama de Desenvolvimento")
2. **Proteja suas chaves de API**: As chaves de API são criptografadas em repouso, mas evite compartilhá-las
3. **Teste sua configuração**: Após a configuração, verifique se o provedor funciona com os recursos de IA
4. **Monitore o uso**: Acompanhe o uso da API para gerenciar custos

## Solução de Problemas

### Problemas de Conexão

- **OpenAI/Anthropic**: Verifique se sua chave de API é válida e tem créditos suficientes
- **Ollama**: Certifique-se de que o servidor Ollama está em execução e a URL Base está correta
- **Firewall**: Verifique se sua rede permite conexões de saída para a API do provedor

### Modelo Não Encontrado

- Verifique se o nome do modelo está escrito corretamente
- Para Ollama, certifique-se de que você baixou o modelo com `ollama pull <nome-do-modelo>`
- Verifique se o modelo está disponível na sua região (alguns modelos têm restrições regionais)

## Precisa de Ajuda?

Se você encontrar problemas ao configurar seu provedor de LLM, por favor:

1. Verifique os [Problemas do GitHub do OneUptime](https://github.com/OneUptime/oneuptime/issues) para problemas conhecidos
2. Entre em contato com o suporte se você estiver em um plano empresarial
