# Agentes de IA

Os Agentes de IA do OneUptime corrigem automaticamente erros, problemas de desempenho e consultas de banco de dados no seu código. Alimentados pelos dados de observabilidade do OpenTelemetry, os Agentes de IA criam pull requests com correções — não apenas alertas.

## O que os Agentes de IA podem fazer?

Os Agentes de IA analisam seus dados de observabilidade (rastreamentos, logs e métricas) para detectar e corrigir automaticamente problemas na sua base de código:

- **Corrigir Erros Automaticamente**: Quando o Agente de IA detecta exceções nos seus rastreamentos ou logs, ele corrige o problema automaticamente e cria um pull request.
- **Corrigir Problemas de Desempenho**: Analisa rastreamentos que levam mais tempo para executar e cria pull requests com otimizações de desempenho.
- **Corrigir Consultas de Banco de Dados**: Identifica consultas de banco de dados lentas ou ineficientes e as otimiza com indexação adequada e reescrita de consultas.
- **Corrigir Problemas de Frontend**: Resolve problemas de desempenho específicos do frontend, problemas de renderização e erros de JavaScript automaticamente.
- **Adicionar Telemetria Automaticamente**: Adiciona rastreamento, métricas e logs à sua base de código com um único clique. Nenhuma instrumentação manual necessária.
- **Integração com GitHub e GitLab**: Integra-se perfeitamente com seus repositórios existentes. Os PRs são criados diretamente no seu fluxo de trabalho.
- **Integração com CI/CD**: Integra-se com seus pipelines de CI/CD existentes. As correções são testadas e validadas antes da criação do PR.
- **Suporte ao Terraform**: Corrige problemas de infraestrutura automaticamente. Suporta Terraform e OpenTofu para infraestrutura como código.
- **Integração com Rastreadores de Problemas**: Conecta-se com Jira, Linear e outros rastreadores de problemas. Vincula automaticamente as correções aos problemas relevantes.

## Como funciona

1. **Coletar Dados**: O OpenTelemetry coleta rastreamentos, logs e métricas da sua aplicação
2. **Detectar Problemas**: A IA identifica erros, gargalos de desempenho e consultas lentas
3. **Gerar Correção**: A IA analisa sua base de código e cria a correção automaticamente
4. **Criar PR**: Pull request com a correção e relatório detalhado pronto para revisão

## Flexibilidade de Provedor de LLM

O OneUptime funciona com qualquer provedor de LLM. Você pode usar:

- Modelos **OpenAI GPT**
- Modelos **Anthropic Claude**
- **Meta Llama** (via Ollama ou outros provedores)
- Modelos **auto-hospedados personalizados**

Auto-hospede seu modelo de IA e mantenha seu código completamente privado.

## Privacidade

Independentemente do seu plano, o OneUptime nunca visualiza, armazena ou treina com seu código:

- **Sem Acesso ao Código**: Seu código permanece na sua infraestrutura
- **Sem Armazenamento de Dados**: Política de retenção de dados zero
- **Sem Treinamento**: Seu código nunca é usado para treinamento de IA

## Agentes de IA Globais vs. Agentes de IA Auto-Hospedados

### Agentes de IA Globais

Se você estiver usando o **OneUptime SaaS** (versão hospedada na nuvem), os Agentes de IA Globais são fornecidos pelo OneUptime e estão pré-configurados e prontos para uso. Esses agentes são gerenciados pelo OneUptime e não requerem configuração adicional.

Os Agentes de IA Globais estão automaticamente disponíveis para todos os projetos, a menos que desativados nas configurações do seu projeto.

### Agentes de IA Auto-Hospedados

Para organizações que precisam executar agentes de IA dentro de sua própria infraestrutura (por exemplo, por requisitos de segurança, conformidade ou acesso à rede), o OneUptime suporta agentes de IA auto-hospedados.

Agentes de IA auto-hospedados:

- Executam dentro da sua rede privada
- Podem acessar recursos e sistemas internos
- Oferecem controle total sobre o ambiente do agente
- Podem ser personalizados para suas necessidades específicas

## Configurando um Agente de IA Auto-Hospedado

### Passo 1: Criar um Agente de IA no OneUptime

1. Faça login no seu painel do OneUptime
2. Vá para **Configurações do Projeto** > **Agentes de IA**
3. Clique em **Criar Agente de IA** para adicionar um novo agente
4. Preencha os campos obrigatórios:
   - **Nome**: Um nome amigável para o seu agente de IA
   - **Descrição** (opcional): Uma descrição do propósito do agente
5. Após a criação, você receberá um `AI_AGENT_ID` e `AI_AGENT_KEY`

**Importante**: Salve seu `AI_AGENT_KEY` com segurança. Ele será exibido apenas uma vez e não poderá ser recuperado posteriormente.

### Passo 2: Implantar o Agente de IA

#### Docker

Para executar um agente de IA, certifique-se de ter o Docker instalado. Execute o agente com:

```bash
docker run --name oneuptime-ai-agent --network host \
  -e AI_AGENT_KEY=<ai-agent-key> \
  -e AI_AGENT_ID=<ai-agent-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -d oneuptime/ai-agent:release
```

Se você estiver auto-hospedando o OneUptime, altere `ONEUPTIME_URL` para a URL da sua instância auto-hospedada personalizada.

#### Docker Compose

Você também pode executar o agente de IA usando docker-compose. Crie um arquivo `docker-compose.yml`:

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

Em seguida, execute:

```bash
docker compose up -d
```

#### Kubernetes

Crie um arquivo `oneuptime-ai-agent.yaml`:

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

Aplique a configuração:

```bash
kubectl apply -f oneuptime-ai-agent.yaml
```

### Variáveis de Ambiente

O agente de IA suporta as seguintes variáveis de ambiente:

#### Variáveis Obrigatórias

| Variável        | Descrição                                                           |
| --------------- | ------------------------------------------------------------------- |
| `AI_AGENT_KEY`  | A chave do agente de IA do seu painel do OneUptime                  |
| `AI_AGENT_ID`   | O ID do agente de IA do seu painel do OneUptime                     |
| `ONEUPTIME_URL` | A URL da sua instância do OneUptime (padrão: https://oneuptime.com) |

## Verificando Seu Agente de IA

Após implantar seu agente de IA:

1. Vá para **Configurações do Projeto** > **Agentes de IA** no seu painel do OneUptime
2. Seu agente deve aparecer como **Conectado** em alguns minutos
3. Se o status mostrar **Desconectado**, verifique os logs do contêiner para erros

Para visualizar os logs do contêiner:

```bash
# Docker
docker logs oneuptime-ai-agent

# Kubernetes
kubectl logs deployment/oneuptime-ai-agent
```

## Solução de Problemas

### Agente Não Conectando

1. **Verificar credenciais**: Certifique-se de que `AI_AGENT_KEY` e `AI_AGENT_ID` estão corretos
2. **Verificar rede**: Certifique-se de que o agente pode alcançar sua instância do OneUptime
3. **Revisar logs**: Verifique os logs do contêiner para mensagens de erro
4. **Regras de firewall**: Certifique-se de que HTTPS de saída (porta 443) seja permitido

### Agente Continua Desconectando

1. **Verificar limites de recursos**: Certifique-se de que o contêiner tem memória e CPU suficientes
2. **Estabilidade da rede**: Verifique se a conectividade de rede está estável
3. **Revisar logs**: Procure por erros de timeout ou conexão nos logs

## Precisa de Ajuda?

Se você encontrar problemas com seu agente de IA:

1. Verifique os [Problemas do GitHub do OneUptime](https://github.com/OneUptime/oneuptime/issues) para problemas conhecidos
2. Crie um novo problema se o seu ainda não foi relatado
3. Entre em contato com o [suporte](https://oneuptime.com/support) se você estiver em um plano empresarial
