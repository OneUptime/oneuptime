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
- **Autenticação Segura**: Login com sua conta do OneUptime (OAuth 2.1) ou envio de uma chave de API a cada requisição para agentes que executam sem supervisão
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
- Uma conta do OneUptime para fazer login, ou uma chave de API do OneUptime para um agente que executa sem supervisão (necessárias apenas para operações autenticadas — ferramentas públicas funcionam sem nenhuma das duas)

## Fazendo Login com o OneUptime

A maneira mais simples de conectar é informar ao seu cliente MCP a URL do servidor e nada mais. Na primeira vez que o cliente precisar dos seus dados, ele abre uma página do OneUptime no seu navegador, na qual você:

1. Faz login no OneUptime, se ainda não tiver feito
2. Escolhe o projeto em que o cliente deve trabalhar
3. Escolhe se o cliente terá acesso de **leitura e gravação** ou **somente leitura**
4. Clica em **Autorizar**

A partir daí, o cliente age em seu nome nesse projeto. Não há chave de API para criar, copiar ou rotacionar, e nada secreto fica armazenado em um arquivo de configuração.

O que um cliente conectado pode fazer:

- **Ele tem as suas permissões, e nunca mais do que isso.** Tudo o que as suas equipes permitem que você faça no projeto é o que o cliente pode fazer. Se a sua função mudar ou você sair do projeto, isso já vale para a próxima requisição do cliente. Sair do projeto também desconecta o cliente: a autorização dele é excluída, e você o conecta de novo se voltar ao projeto.
- **Somente leitura significa somente leitura.** Um cliente autorizado como somente leitura pode usar as ferramentas `get_`, `list_` e `count_`. Ferramentas que criam, atualizam, excluem, reconhecem ou resolvem são recusadas, tanto pelo servidor MCP quanto pela API do OneUptime por trás dele. Você nunca pode dar a um cliente mais acesso do que ele solicitou.
- **Ele vale para um único projeto.** Para usar um segundo projeto, conecte o cliente novamente e escolha esse projeto.
- **Ele funciona apenas por meio do servidor MCP.** O token de acesso do cliente é aceito pelo endpoint MCP e em nenhum outro lugar. Ele não pode ser usado para chamar diretamente a API REST do OneUptime.
- **Administradores da instância não recebem tratamento especial.** Um cliente conectado por um master admin tem o que as equipes dessa pessoa concedem no projeto, e não acesso a toda a instância.

### Gerenciando Clientes Conectados

Todo cliente que foi conectado por login aparece em **Configurações do projeto** → **Servidor MCP** → **Connected MCP Clients** (clientes MCP conectados), com quem o conectou, o que ele pode fazer e quando foi usado pela última vez. Você vê os clientes que você conectou; proprietários e administradores do projeto veem os de todos.

Clique em **Disconnect** (desconectar) para encerrar a sessão de um cliente. Ele para de funcionar imediatamente.

Um cliente permanece conectado enquanto estiver em uso. Um cliente que ficou 30 dias sem uso precisa fazer login novamente.

### Controlando Quem Pode Conectar Clientes

Por padrão, todo membro do projeto pode conectar um cliente MCP. Para impedir que os membros de uma equipe façam isso, abra a equipe, vá para **Bloquear permissões** e adicione a permissão **Authorize MCP Client** (autorizar cliente MCP). Os clientes que esses membros já conectaram param de funcionar na mesma hora.

Se o projeto exigir Single Sign-On, faça login no projeto com SSO no seu navegador antes de autorizar um cliente. A conexão do cliente dura enquanto durar esse login com SSO; quando ele expirar, conecte o cliente novamente.

No OneUptime na Nuvem, conectar um cliente MCP está disponível nos mesmos planos que as chaves de API (Growth e superiores).

Na Enterprise Edition, toda alteração feita por um cliente conectado é registrada no log de auditoria em nome da pessoa que o conectou, junto com o nome do cliente. Alterações feitas com uma chave de API mostram o nome da chave.

## Obtendo Sua Chave de API

Use uma chave de API para um agente que executa sem supervisão — uma tarefa agendada ou um pipeline de CI — em que não há ninguém para fazer login.

1. Faça login na sua instância do OneUptime
2. Navegue para **Configurações do projeto** → **Chaves de API**
3. Clique em **Criar Chave de API**
4. Forneça um nome (ex.: "Servidor MCP")
5. Selecione as permissões apropriadas para o seu caso de uso
6. Copie a chave de API gerada

As chaves de API têm escopo de projeto: o servidor MCP infere seu projeto a partir da chave, então as ferramentas de criação nunca precisam de um argumento `projectId`.

> **Aviso — nunca dê uma chave mestra a um agente de IA.** Uma chave de API *mestra* do OneUptime também é aceita neste cabeçalho e concede acesso de administrador a toda a instância. Sempre use uma chave de API de projeto com o menor privilégio de que o agente precisa (uma chave somente leitura é suficiente para todas as ferramentas `get_`/`list_`/`count_`).

## Configuração

### Conectando por Meio de Login

Adicione a URL do servidor ao seu cliente, sem credenciais. Use `https://your-oneuptime-domain.com/mcp` para uma instância auto-hospedada.

**Claude Code**

```bash
claude mcp add --transport http oneuptime https://oneuptime.com/mcp
```

Em seguida, execute `/mcp` dentro do Claude Code e escolha **oneuptime** para fazer login.

**Claude (web e desktop)**

Abra **Customize** → **Connectors**, escolha **Add custom connector** e insira `https://oneuptime.com/mcp`. O Claude pede que você faça login no OneUptime na primeira vez que precisar dos seus dados.

**VS Code com GitHub Copilot**

Adicione isto à sua configuração MCP (veja [VS Code com GitHub Copilot](#vs-code-com-github-copilot) para saber onde fica esse arquivo). O VS Code abre o OneUptime para você fazer login quando você inicia o servidor:

```json
{
  "servers": {
    "oneuptime": {
      "type": "http",
      "url": "https://oneuptime.com/mcp"
    }
  }
}
```

**Cursor**

```json
{
  "mcpServers": {
    "oneuptime": {
      "url": "https://oneuptime.com/mcp"
    }
  }
}
```

Qualquer outro cliente compatível com a autorização do MCP funciona da mesma forma: informe a URL e ele descobre todo o resto. Veja [Login (OAuth 2.1)](#login-oauth-21) para os detalhes do protocolo.

O restante desta seção mostra os mesmos clientes configurados com uma chave de API em vez do login.

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

Os clientes MCP que fazem login também usam os endpoints OAuth abaixo. O cliente os encontra sozinho; eles estão listados aqui para quem está escrevendo um cliente ou configurando um proxy.

| Endpoint                                      | Método | Descrição |
| --------------------------------------------- | ------ | ------------------------------------------------------------------------ |
| `/mcp/.well-known/oauth-protected-resource`   | GET    | Metadados do recurso protegido (RFC 9728). Também em `/.well-known/oauth-protected-resource/mcp` |
| `/.well-known/oauth-authorization-server/mcp` | GET    | Metadados do servidor de autorização (RFC 8414). Também em `/mcp/.well-known/oauth-authorization-server` |
| `/mcp/oauth/authorize`                        | GET    | Endpoint de autorização: para onde o cliente envia o seu navegador para você fazer login |
| `/mcp/oauth/token`                            | POST   | Endpoint de token: troca um código de autorização ou um token de atualização |
| `/mcp/oauth/register`                         | POST   | Registro dinâmico de clientes (RFC 7591) |
| `/mcp/oauth/revoke`                           | POST   | Revogação de token (RFC 7009) |

## Autenticação

O servidor MCP suporta três modos de operação:

### Ferramentas Públicas (Sem Autenticação Necessária)

Você pode conectar ao servidor MCP sem uma chave de API para acessar ferramentas públicas:

- **`oneuptime_help`**: Obter ajuda e orientação sobre as capacidades do MCP do OneUptime
- **`oneuptime_list_resources`**: Listar recursos disponíveis e suas operações
- **`get_public_status_page_overview`**: Obter visão geral de uma página de status pública
- **`get_public_status_page_incidents`**: Obter incidentes de uma página de status pública
- **`get_public_status_page_scheduled_maintenance`**: Obter eventos de manutenção programada
- **`get_public_status_page_announcements`**: Obter anúncios de uma página de status pública

As ferramentas de página de status pública aceitam um ID de página de status (UUID) ou o nome de domínio da página de status.

### Login (OAuth 2.1)

Para todas as outras operações (gerenciar monitores, incidentes, equipes, etc.), quem faz a chamada precisa ser identificado. Um cliente que não envia credenciais e chama uma dessas ferramentas recebe como resposta `401 Unauthorized` e um cabeçalho `WWW-Authenticate` que aponta para os metadados do recurso protegido do servidor. Esse é o sinal ao qual um cliente MCP reage para fazer o seu login; `initialize`, `tools/list` e as ferramentas públicas nunca pedem isso.

O servidor implementa a [especificação de autorização do MCP](https://modelcontextprotocol.io/specification/latest/basic/authorization):

- **Fluxo**: código de autorização do OAuth 2.1 com PKCE (apenas `S256`). Os tokens de acesso são enviados como `Authorization: Bearer`.
- **Descoberta**: metadados do recurso protegido (RFC 9728) e metadados do servidor de autorização (RFC 8414). O emissor (issuer) e o recurso são ambos `https://<host>/mcp`.
- **Identidade do cliente**: um Client ID Metadata Document (o ID do cliente é uma URL `https` que o servidor busca) ou registro dinâmico de clientes (Dynamic Client Registration, RFC 7591). Nenhum cliente precisa ser registrado por um administrador.
- **Escopos**: `mcp:read` para as ferramentas `get_`, `list_` e `count_`; `mcp:write` acrescenta todas as ferramentas que alteram algo e inclui `mcp:read`. Um token somente leitura que chama uma ferramenta de escrita recebe como resposta `403` e `error="insufficient_scope"`.
- **Tempo de vida dos tokens**: um token de acesso dura uma hora. Um token de atualização (refresh token) dura 30 dias e é substituído a cada uso; usar um token de atualização que já foi substituído encerra a conexão.
- **Indicadores de recurso** (RFC 8707): um token é emitido para `https://<host>/mcp` e não é aceito em nenhum outro lugar.
- **Revogação** (RFC 7009): revogar qualquer um dos dois tokens encerra a conexão.

### Chave de API

Um agente que executa sem supervisão se autentica com uma chave de API do OneUptime em um dos seguintes cabeçalhos:

- `x-api-key`: Sua chave de API do OneUptime
- `Authorization`: Token Bearer com sua chave de API (ex.: `Bearer your-api-key-here`)

O esquema `Bearer` não diferencia maiúsculas de minúsculas. Uma requisição que traz uma chave de API nunca recebe um pedido de login.

Erros de ferramenta são retornados como resultados de ferramenta dentro da resposta (`isError: true`) com um `statusCode`, detalhes e uma sugestão — não como erros do protocolo MCP — para que os agentes possam ler a falha e se autocorrigir.

## Ferramentas de Fluxo de Trabalho

Além das ferramentas CRUD por recurso, o servidor inclui ferramentas de fluxo de trabalho criadas especificamente para resposta a incidentes e alertas:

- **`acknowledge_incident`** / **`resolve_incident`**: Mover um incidente para o estado Reconhecido ou Resolvido do projeto — equivalente a pressionar o botão no painel
- **`acknowledge_alert`** / **`resolve_alert`**: O mesmo para alertas
- **`add_incident_note`**: Adicionar uma nota a um incidente com `visibility: "internal"` (apenas para a equipe, o padrão) ou `visibility: "public"` (publicada na página de status). Markdown é suportado
- **`add_alert_note`**: Adicionar uma nota interna a um alerta

Um ciclo típico: `list_incidents` → `acknowledge_incident` → investigar com `list_logs` → `add_incident_note` (pública) → `resolve_incident`.

## Quem Sou Eu

A ferramenta **`oneuptime_whoami`** retorna o projeto ao qual suas credenciais pertencem (ID e nome). Para um cliente que fez login, ela também retorna com qual usuário ele fez login e se ele pode fazer alterações. É uma primeira chamada útil para um agente se orientar — e como as ferramentas de criação inferem o `projectId` a partir das credenciais, o agente nunca precisa passar um ID de projeto.

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

## Configuração para Instâncias Auto-Hospedadas

O login funciona sem configuração adicional em uma instância auto-hospedada. Há duas configurações disponíveis:

| Variável de ambiente | Valor do Helm | O que faz |
| --- | --- | --- |
| `DISABLE_MCP_OAUTH` | `mcpOAuth.disabled` | Defina como `true` para desativar o login. Os endpoints OAuth deixam de ser servidos e o servidor MCP aceita apenas chaves de API. Nada é excluído; os clientes conectados voltam a funcionar quando a opção é revertida. |
| `DISABLE_MCP_OAUTH_CLIENT_ID_METADATA_DOCUMENTS` | `mcpOAuth.disableClientIdMetadataDocuments` | Defina como `true` em uma instância que não consegue acessar a internet. Um cliente pode se identificar com uma URL que o OneUptime busca; com esta opção ativada, os clientes passam a se registrar diretamente na sua instância, o que não exige nenhuma requisição de saída. |

Se você mantém seu próprio proxy reverso na frente do OneUptime, encaminhe `/.well-known/oauth-protected-resource` e `/.well-known/oauth-authorization-server` (e tudo o que estiver abaixo deles) para o OneUptime, junto com `/mcp`. O ingress incluído já faz isso.

O servidor monta todas as URLs do OAuth a partir das configurações `HOST` e `HTTP_PROTOCOL`, portanto elas precisam corresponder ao endereço que as pessoas usam para acessar sua instância.

## Solução de Problemas

### Problemas de Login

- **O cliente nunca me pede para fazer login**: o cliente pode não ser compatível com a autorização do MCP, ou pode estar configurado com um cabeçalho de chave de API, que tem precedência. Remova o cabeçalho para usar o login.
- **Meu projeto aparece em cinza na página de autorização**: a página informa o motivo ao lado do nome do projeto — o plano do projeto não inclui a conexão de clientes MCP, o projeto exige SSO e este navegador não fez login nele com SSO, ou sua equipe está bloqueada para conectar clientes.
- **Uma ferramenta é recusada com "read-only"**: o cliente foi autorizado como somente leitura. Conecte-o novamente e escolha **Leitura e gravação**.
- **O cliente parou de funcionar**: ele foi desconectado, ficou 30 dias sem uso, você foi removido do projeto ou o login com SSO do projeto expirou. Conecte-o novamente.
- **Auto-hospedado — o cliente informa que não consegue encontrar o servidor de autorização**: verifique se `HOST` e `HTTP_PROTOCOL` correspondem ao seu endereço público e se o seu proxy encaminha os caminhos `/.well-known/oauth-*`.

### Erros de Permissão

Certifique-se de que sua chave de API — ou, no caso de um cliente que fez login, a sua própria conta — tem as permissões necessárias:

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
