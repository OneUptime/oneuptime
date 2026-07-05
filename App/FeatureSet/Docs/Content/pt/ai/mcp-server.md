# Servidor MCP

O Servidor MCP (Model Context Protocol) do OneUptime fornece aos LLMs acesso direto à sua instância do OneUptime, habilitando operações de monitoramento, gerenciamento de incidentes e observabilidade alimentadas por IA.

## O que é o Servidor MCP do OneUptime?

O Servidor MCP do OneUptime é uma ponte entre Modelos de Linguagem de Grande Escala (LLMs) e sua instância do OneUptime. Ele implementa o Model Context Protocol (MCP), permitindo que assistentes de IA como o Claude interajam diretamente com sua infraestrutura de monitoramento.

## Como Funciona

O servidor MCP é hospedado junto com sua instância do OneUptime e acessível via transporte Streamable HTTP. Nenhuma instalação local é necessária.

**Usuários na Nuvem**: `https://oneuptime.com/mcp`
**Usuários Auto-Hospedados**: `https://seu-dominio-oneuptime.com/mcp`

## Principais Recursos

- **~155 Ferramentas**: Ferramentas CRUD completas para 22 tipos de recursos (incidentes, alertas, monitores, páginas de status, plantão e mais), ferramentas de telemetria somente leitura, além de ferramentas de fluxo de trabalho e auxiliares
- **Operações em Tempo Real**: Criar, ler, atualizar e excluir recursos em tempo real
- **Interface Tipada**: Totalmente tipado com validação de entrada abrangente
- **Autenticação Segura**: Autenticação por chave de API a cada requisição com tratamento adequado de erros
- **Anotações de Segurança**: Ferramentas somente leitura carregam `readOnlyHint` e ferramentas de exclusão carregam `destructiveHint`, para que clientes MCP possam aprovar automaticamente chamadas seguras e perguntar antes das destrutivas
- **Integração Fácil**: Funciona com Claude Desktop e outros clientes compatíveis com MCP
- **Sem Estado por Design**: Sem IDs de sessão — cada requisição é autocontida, então o servidor funciona atrás de balanceadores de carga e implantações com múltiplas réplicas

## O que Você Pode Fazer

Com o Servidor MCP do OneUptime, os assistentes de IA podem ajudá-lo a:

- **Gerenciamento de Monitores**: Criar e configurar monitores, verificar seu status e revisar o histórico de status
- **Resposta a Incidentes**: Criar, reconhecer e resolver incidentes, adicionar notas internas ou públicas e rastrear a resolução
- **Operações de Equipe**: Gerenciar equipes e políticas de plantão
- **Páginas de Status**: Gerenciar páginas de status e criar anúncios
- **Alertas**: Reconhecer e resolver alertas, adicionar notas de alerta e gerenciar estados e severidades de alertas
- **Manutenção Programada**: Criar e gerenciar eventos de manutenção programada
- **Telemetria**: Consultar logs, métricas, traces, exceções e logs de monitores (somente leitura)

## Requisitos

- Instância do OneUptime (nuvem ou auto-hospedada)
- Cliente compatível com MCP (Claude Desktop, VS Code com GitHub Copilot, etc.)
- Chave de API válida do OneUptime (necessária apenas para operações autenticadas — ferramentas públicas funcionam sem ela)

## Obtendo Sua Chave de API

1. Faça login na sua instância do OneUptime
2. Navegue para **Configurações** → **Chaves de API**
3. Clique em **Criar Chave de API**
4. Forneça um nome (ex.: "Servidor MCP")
5. Selecione as permissões apropriadas para o seu caso de uso
6. Copie a chave de API gerada

As chaves de API têm escopo de projeto: o servidor MCP infere seu projeto a partir da chave, então as ferramentas de criação nunca precisam de um argumento `projectId`.

> **Aviso — nunca dê uma chave mestra a um agente de IA.** Uma chave de API *mestra* do OneUptime também é aceita neste cabeçalho e concede acesso de administrador a toda a instância. Sempre use uma chave de API de projeto com o menor privilégio de que o agente precisa (uma chave somente leitura é suficiente para todas as ferramentas `get_`/`list_`/`count_`).

## Configuração

### Configuração do Claude Desktop

Encontre seu arquivo de configuração do Claude Desktop:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**Linux**: `~/.config/Claude/claude_desktop_config.json`

### Para OneUptime na Nuvem

Adicione a seguinte configuração:

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "https://oneuptime.com/mcp",
      "headers": {
        "x-api-key": "your-api-key-here"
      }
    }
  }
}
```

### Para OneUptime Auto-Hospedado

Substitua `oneuptime.com` pelo seu domínio do OneUptime:

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "https://your-oneuptime-domain.com/mcp",
      "headers": {
        "x-api-key": "your-api-key-here"
      }
    }
  }
}
```

### Acesso Público (Sem Chave de API)

Para usar apenas ferramentas públicas (informações de página de status, ajuda), você pode conectar sem uma chave de API:

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "https://oneuptime.com/mcp"
    }
  }
}
```

Esta configuração permite acesso a ferramentas públicas de página de status e recursos de ajuda sem exigir autenticação.

### VS Code com GitHub Copilot

O VS Code suporta servidores MCP nativamente com GitHub Copilot (versão 1.99+). Isso permite que o Copilot acesse dados do OneUptime diretamente.

#### Passo 1: Requisitos

- VS Code versão 1.99 ou posterior
- Extensão GitHub Copilot instalada e ativada
- GitHub Copilot Chat habilitado

#### Passo 2: Abrir Configuração MCP

1. Pressione `Ctrl+Shift+P` (Windows/Linux) ou `Cmd+Shift+P` (macOS)
2. Digite "MCP: Open User Configuration" e pressione Enter
3. Isso abre ou cria o arquivo de configuração `mcp.json`

Como alternativa, crie `.vscode/mcp.json` no seu espaço de trabalho para configuração específica do projeto.

#### Para OneUptime na Nuvem

```json
{
  "servers": {
    "oneuptime": {
      "type": "http",
      "url": "https://oneuptime.com/mcp",
      "headers": {
        "x-api-key": "${input:oneuptime-api-key}"
      }
    }
  },
  "inputs": [
    {
      "type": "promptString",
      "id": "oneuptime-api-key",
      "description": "OneUptime API Key",
      "password": true
    }
  ]
}
```

#### Para OneUptime Auto-Hospedado

```json
{
  "servers": {
    "oneuptime": {
      "type": "http",
      "url": "https://your-oneuptime-domain.com/mcp",
      "headers": {
        "x-api-key": "${input:oneuptime-api-key}"
      }
    }
  },
  "inputs": [
    {
      "type": "promptString",
      "id": "oneuptime-api-key",
      "description": "OneUptime API Key",
      "password": true
    }
  ]
}
```

#### Passo 3: Iniciar o Servidor MCP

1. Pressione `Ctrl+Shift+P` / `Cmd+Shift+P`
2. Digite "MCP: List Servers" para ver os servidores disponíveis
3. Clique em "oneuptime" para iniciar o servidor
4. Quando solicitado, insira sua chave de API do OneUptime

#### Passo 4: Usar com o Copilot Chat

Abra o GitHub Copilot Chat e use o modo Agente (`@workspace` ou pergunte diretamente):

```
"What monitors do I have in OneUptime?"
"Show me recent incidents"
"Create a new monitor for https://example.com"
```

#### Nota de Segurança

A configuração acima usa variáveis de entrada com `"password": true` para solicitar com segurança sua chave de API em vez de armazená-la em texto simples. O VS Code solicitará que você confirme a confiança ao iniciar o servidor MCP pela primeira vez.

## Endpoints Disponíveis

| Endpoint      | Método | Descrição                                                                                                                    |
| ------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `/mcp`        | POST   | Requisições JSON-RPC para chamadas de ferramentas e outras operações                                                                            |
| `/mcp`        | GET    | Sem um cabeçalho `Accept` de SSE: payload JSON amigável de descoberta. Com um: `405` — o servidor sem estado não oferece stream SSE autônomo (clientes em conformidade prosseguem sem ele) |
| `/mcp`        | DELETE | Sem efeito (o servidor é sem estado, então não há sessão para encerrar)                                                             |
| `/mcp/health` | GET    | Endpoint de verificação de saúde                                                                                                            |
| `/mcp/tools`  | GET    | API REST para listar ferramentas disponíveis                                                                                                 |

## Autenticação

O servidor MCP suporta dois modos de operação:

### Ferramentas Públicas (Sem Autenticação Necessária)

Você pode conectar ao servidor MCP sem uma chave de API para acessar ferramentas públicas:

- **`oneuptime_help`**: Obter ajuda e orientação sobre as capacidades do MCP do OneUptime
- **`oneuptime_list_resources`**: Listar recursos disponíveis e suas operações
- **`get_public_status_page_overview`**: Obter visão geral de uma página de status pública
- **`get_public_status_page_incidents`**: Obter incidentes de uma página de status pública
- **`get_public_status_page_scheduled_maintenance`**: Obter eventos de manutenção programada
- **`get_public_status_page_announcements`**: Obter anúncios de uma página de status pública

As ferramentas de página de status pública aceitam um ID de página de status (UUID) ou o nome de domínio da página de status.

### Ferramentas Autenticadas (Chave de API Necessária)

Para todas as outras operações (gerenciar monitores, incidentes, equipes, etc.), a autenticação é necessária via um dos seguintes cabeçalhos:

- `x-api-key`: Sua chave de API do OneUptime
- `Authorization`: Token Bearer com sua chave de API (ex.: `Bearer your-api-key-here`)

O esquema `Bearer` não diferencia maiúsculas de minúsculas. Erros de ferramenta são retornados como resultados de ferramenta dentro da resposta (`isError: true`) com um `statusCode`, detalhes e uma sugestão — não como erros do protocolo MCP — para que os agentes possam ler a falha e se autocorrigir.

## Ferramentas de Fluxo de Trabalho

Além das ferramentas CRUD por recurso, o servidor inclui ferramentas de fluxo de trabalho criadas especificamente para resposta a incidentes e alertas:

- **`acknowledge_incident`** / **`resolve_incident`**: Mover um incidente para o estado Reconhecido ou Resolvido do projeto — equivalente a pressionar o botão no painel
- **`acknowledge_alert`** / **`resolve_alert`**: O mesmo para alertas
- **`add_incident_note`**: Adicionar uma nota a um incidente com `visibility: "internal"` (apenas para a equipe, o padrão) ou `visibility: "public"` (publicada na página de status). Markdown é suportado
- **`add_alert_note`**: Adicionar uma nota interna a um alerta

Um ciclo típico: `list_incidents` → `acknowledge_incident` → investigar com `list_logs` → `add_incident_note` (pública) → `resolve_incident`.

## Quem Sou Eu

A ferramenta **`oneuptime_whoami`** retorna o projeto ao qual sua chave de API pertence (ID e nome). É uma primeira chamada útil para um agente se orientar — e como as ferramentas de criação inferem o `projectId` a partir da chave de API, o agente nunca precisa passar um ID de projeto.

## Consultando Telemetria

Logs, métricas, traces (spans), exceções e logs de monitores são expostos como ferramentas `list_` e `count_` somente leitura (`list_logs`, `list_metrics`, `list_spans`, `list_exception_instances`, `list_monitor_logs` e suas contrapartes `count_`). A telemetria é ingerida via OpenTelemetry, portanto não há ferramentas de criação.

Sempre consulte telemetria com um filtro de intervalo de tempo. Os campos de consulta aceitam um valor direto ou um objeto de operador:

```json
{
  "query": {
    "time": { "_type": "GreaterThan", "value": "2026-07-04T00:00:00.000Z" }
  },
  "sort": { "time": "DESC" },
  "limit": 50
}
```

Operadores suportados: `EqualTo`, `NotEqual`, `IsNull`, `NotNull`, `EqualToOrNull`, `GreaterThan`, `LessThan`, `GreaterThanOrEqual`, `LessThanOrEqual`, `InBetween`, `Search`, `Includes`. Os valores de ordenação são `"ASC"` ou `"DESC"`.

## Seleção de Campos e Paginação

As ferramentas `get_` e `list_` aceitam um array opcional `select` de nomes de campos. Por padrão, todos os campos legíveis são retornados, exceto os pesados (colunas JSON, de texto muito longo e HTML), que devem ser solicitados explicitamente em `select`.

As ferramentas de listagem paginam com `limit` (padrão 10, máximo 100) e `skip`, e cada resposta de listagem informa exatamente o que retornou:

```json
{
  "returnedCount": 10,
  "totalCount": 42,
  "skip": 0,
  "limit": 10,
  "hasMore": true,
  "data": ["..."]
}
```

## Verificação

Verifique se o servidor MCP está em execução:

```bash
# For OneUptime Cloud
curl https://oneuptime.com/mcp/health

# For Self-Hosted
curl https://your-oneuptime-domain.com/mcp/health
```

Liste as ferramentas disponíveis:

```bash
# For OneUptime Cloud
curl https://oneuptime.com/mcp/tools

# For Self-Hosted
curl https://your-oneuptime-domain.com/mcp/tools
```

## Exemplos de Uso

### Consultas Básicas de Informação

```
"What's the current status of all my monitors?"
"Show me incidents from the last 24 hours"
```

### Gerenciamento de Monitores

```
"Create a new website monitor for https://example.com that checks every 5 minutes"
"Set up an API monitor for https://api.example.com/health with a 30-second timeout"
"Change the monitoring interval for my website monitor to every 2 minutes"
"Disable the monitor for staging.example.com while we're doing maintenance"
```

### Gerenciamento de Incidentes

```
"Create a high-priority incident for the database outage affecting user authentication"
"Add a note to incident #123 saying 'Database connection restored, monitoring for stability'"
"Mark incident #456 as resolved"
"Assign the current payment gateway incident to the infrastructure team"
```

### Equipe e Plantão

```
"List the teams in this project"
"Show me our on-call policies"
```

### Gerenciamento de Página de Status

```
"Update our status page to show 'Investigating Payment Issues' for the payment service"
"Create a status page announcement about scheduled maintenance this weekend"
```

### Consultas de Página de Status Pública (Sem Chave de API Necessária)

Estas consultas funcionam sem autenticação, usando apenas as ferramentas públicas de página de status:

```
"What's the current status of status.example.com?"
"Show me recent incidents from the OneUptime status page"
"Are there any scheduled maintenance events on status.acme.com?"
"Get the latest announcements from my public status page with ID abc123-..."
```

### Operações Avançadas

```
"Create a scheduled maintenance window for Saturday 2-4 AM, disable all monitors for api.example.com during that time, and update the status page"
"Show me all monitors that have been down in the last hour, create incidents for any that don't already have one"
```

## Permissões de Chave de API

### Acesso Somente Leitura

Para apenas visualizar dados, adicione permissões de leitura para sua chave de API.

### Acesso Completo

Para acesso total para criar, atualizar e excluir recursos, certifique-se de que sua chave de API tem permissões de Administrador do Projeto.

### Melhores Práticas

- Use Permissões Específicas: Conceda apenas as permissões mínimas necessárias
- Rotacione Chaves de API: Rotacione regularmente suas chaves de API
- Monitore o Uso: Acompanhe o uso da chave de API no OneUptime
- Chaves Separadas: Use diferentes chaves de API para diferentes ambientes

## Solução de Problemas

### Erros de Permissão

Certifique-se de que sua chave de API tem as permissões necessárias:

- Acesso de leitura para listar recursos
- Acesso de escrita para criar/atualizar recursos
- Acesso de exclusão se você quiser remover recursos

### Problemas de Conexão

1. Verifique se a URL do OneUptime está correta
2. Verifique se sua chave de API é válida
3. Certifique-se de que sua instância do OneUptime está acessível
4. Teste o endpoint de saúde

### Chave de API Inválida

- Verifique a chave de API nas configurações do seu OneUptime
- Verifique se há espaços extras ou caracteres
- Certifique-se de que a chave não expirou

### Erros de Sessão

Se você receber erros relacionados a sessões:

- O servidor MCP é sem estado — ele não emite nem rastreia IDs de sessão, então cada requisição funciona contra qualquer réplica do servidor
- Clientes que enviam um cabeçalho `mcp-session-id` de uma versão anterior do servidor podem simplesmente omiti-lo; ele é ignorado
- Atualize configurações de clientes MCP mais antigas que esperam que um ID de sessão seja retornado pelo servidor

## Recursos Disponíveis

O servidor MCP fornece ferramentas para os seguintes recursos:

**Monitoramento**: Monitor, Status de Monitor, Evento de Status de Monitor
**Incidentes**: Incidente, Estado de Incidente, Severidade de Incidente, Linha do Tempo de Estado de Incidente, Nota Pública de Incidente, Nota Interna de Incidente
**Alertas**: Alerta, Estado de Alerta, Severidade de Alerta, Linha do Tempo de Estado de Alerta, Nota Interna de Alerta
**Páginas de Status**: Página de Status, Anúncio de Página de Status
**Manutenção Programada**: Evento de Manutenção Programada, Estado de Manutenção Programada, Linha do Tempo de Estado de Manutenção Programada
**Equipes e Plantão**: Equipe, Política de Plantão
**Rótulos**: Rótulo
**Telemetria (somente leitura)**: Log, Métrica, Span, Instância de Exceção, Log de Monitor

Cada recurso de banco de dados suporta Criar, Obter, Listar, Atualizar, Excluir e Contar via ferramentas em snake_case — por exemplo, `create_incident`, `get_incident`, `list_incidents`, `update_incident`, `delete_incident`, `count_incidents`. Recursos de telemetria expõem apenas ferramentas `list_` e `count_` (por exemplo, `list_logs`, `count_spans`).
