# Servidor MCP

O Servidor MCP (Model Context Protocol) do OneUptime fornece aos LLMs acesso direto à sua instância do OneUptime, habilitando operações de monitoramento, gerenciamento de incidentes e observabilidade alimentadas por IA.

## O que é o Servidor MCP do OneUptime?

O Servidor MCP do OneUptime é uma ponte entre Modelos de Linguagem de Grande Escala (LLMs) e sua instância do OneUptime. Ele implementa o Model Context Protocol (MCP), permitindo que assistentes de IA como o Claude interajam diretamente com sua infraestrutura de monitoramento.

## Como Funciona

O servidor MCP é hospedado junto com sua instância do OneUptime e acessível via transporte Streamable HTTP. Nenhuma instalação local é necessária.

**Usuários na Nuvem**: `https://oneuptime.com/mcp`
**Usuários Auto-Hospedados**: `https://seu-dominio-oneuptime.com/mcp`

## Principais Recursos

- **Cobertura Completa de API**: Acesso a 711 endpoints de API do OneUptime
- **126 Tipos de Recursos**: Gerencie todos os recursos do OneUptime incluindo monitores, incidentes, equipes, probes e mais
- **Operações em Tempo Real**: Criar, ler, atualizar e excluir recursos em tempo real
- **Interface Tipada**: Totalmente tipado com validação de entrada abrangente
- **Autenticação Segura**: Autenticação baseada em chave de API com tratamento adequado de erros
- **Integração Fácil**: Funciona com Claude Desktop e outros clientes compatíveis com MCP
- **Gerenciamento de Sessão**: Gerenciamento de sessão integrado com suporte a reconexão automática

## O que Você Pode Fazer

Com o Servidor MCP do OneUptime, os assistentes de IA podem ajudá-lo a:

- **Gerenciamento de Monitores**: Criar e configurar monitores, verificar seu status e gerenciar grupos de monitores
- **Resposta a Incidentes**: Criar incidentes, adicionar notas, atribuir membros de equipe e rastrear resolução
- **Operações de Equipe**: Gerenciar equipes, permissões e escalas de plantão
- **Páginas de Status**: Atualizar páginas de status, criar anúncios e gerenciar assinantes
- **Alertas**: Configurar regras de alerta, gerenciar políticas de escalonamento e verificar logs de notificação
- **Probes**: Implantar e gerenciar probes de monitoramento em diferentes localizações
- **Relatórios e Análises**: Gerar relatórios e analisar dados de monitoramento

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
        "x-api-key": "sua-chave-de-api-aqui"
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
      "url": "https://seu-dominio-oneuptime.com/mcp",
      "headers": {
        "x-api-key": "sua-chave-de-api-aqui"
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
      "url": "https://seu-dominio-oneuptime.com/mcp",
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
"Quais monitores eu tenho no OneUptime?"
"Mostre-me incidentes recentes"
"Crie um novo monitor para https://example.com"
```

#### Nota de Segurança

A configuração acima usa variáveis de entrada com `"password": true` para solicitar com segurança sua chave de API em vez de armazená-la em texto simples. O VS Code solicitará que você confirme a confiança ao iniciar o servidor MCP pela primeira vez.

## Endpoints Disponíveis

| Endpoint      | Método | Descrição                                                                             |
| ------------- | ------ | ------------------------------------------------------------------------------------- |
| `/mcp`        | GET    | Stream de eventos enviados pelo servidor para notificações do servidor para o cliente |
| `/mcp`        | POST   | Requisições JSON-RPC para chamadas de ferramentas e outras operações                  |
| `/mcp`        | DELETE | Limpeza e encerramento de sessão                                                      |
| `/mcp/health` | GET    | Endpoint de verificação de saúde                                                      |
| `/mcp/tools`  | GET    | API REST para listar ferramentas disponíveis                                          |

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
- `Authorization`: Token Bearer com sua chave de API (ex.: `Bearer sua-chave-de-api-aqui`)

## Verificação

Verifique se o servidor MCP está em execução:

```bash
# Para OneUptime na Nuvem
curl https://oneuptime.com/mcp/health

# Para Auto-Hospedado
curl https://seu-dominio-oneuptime.com/mcp/health
```

Liste as ferramentas disponíveis:

```bash
# Para OneUptime na Nuvem
curl https://oneuptime.com/mcp/tools

# Para Auto-Hospedado
curl https://seu-dominio-oneuptime.com/mcp/tools
```

## Exemplos de Uso

### Consultas Básicas de Informação

```
"Qual é o status atual de todos os meus monitores?"
"Mostre-me incidentes das últimas 24 horas"
```

### Gerenciamento de Monitores

```
"Crie um novo monitor de site para https://example.com que verifica a cada 5 minutos"
"Configure um monitor de API para https://api.example.com/health com um timeout de 30 segundos"
"Altere o intervalo de monitoramento do meu monitor de site para a cada 2 minutos"
"Desative o monitor para staging.example.com enquanto estamos fazendo manutenção"
```

### Gerenciamento de Incidentes

```
"Crie um incidente de alta prioridade para a interrupção do banco de dados afetando a autenticação de usuários"
"Adicione uma nota ao incidente #123 dizendo 'Conexão com banco de dados restaurada, monitorando a estabilidade'"
"Marque o incidente #456 como resolvido"
"Atribua o incidente atual do gateway de pagamento à equipe de infraestrutura"
```

### Equipe e Plantão

```
"Quem são os membros da equipe de infraestrutura?"
"Quem está de plantão atualmente para a equipe de infraestrutura?"
"Mostre-me a escala de plantão desta semana"
```

### Gerenciamento de Página de Status

```
"Atualize nossa página de status para mostrar 'Investigando Problemas de Pagamento' para o serviço de pagamento"
"Crie um anúncio na página de status sobre manutenção programada neste fim de semana"
```

### Consultas de Página de Status Pública (Sem Chave de API Necessária)

Estas consultas funcionam sem autenticação, usando apenas as ferramentas públicas de página de status:

```
"Qual é o status atual de status.example.com?"
"Mostre-me incidentes recentes da página de status do OneUptime"
"Há algum evento de manutenção programada em status.acme.com?"
"Obtenha os últimos anúncios da minha página de status pública com ID abc123-..."
```

### Operações Avançadas

```
"Crie uma janela de manutenção programada para sábado das 2h às 4h, desative todos os monitores para api.example.com durante esse período e atualize a página de status"
"Mostre-me todos os monitores que estiveram fora na última hora, crie incidentes para aqueles que ainda não têm um"
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

- O servidor MCP usa o cabeçalho `mcp-session-id` para rastrear sessões
- Certifique-se de que seu cliente lida adequadamente com o ID de sessão retornado pelo servidor
- As sessões são limpas automaticamente quando as conexões fecham

## Recursos Disponíveis

O servidor MCP fornece acesso a 126 tipos de recursos incluindo:

**Monitoramento**: Monitor, MonitorStatus, MonitorGroup, Probe
**Incidentes**: Incident, IncidentState, IncidentNote, IncidentTemplate
**Alertas**: Alert, AlertState, AlertSeverity
**Páginas de Status**: StatusPage, StatusPageAnnouncement, StatusPageSubscriber
**Plantão**: On-CallPolicy, EscalationRule, On-CallSchedule
**Equipes**: Team, TeamMember, TeamPermission
**Telemetria**: TelemetryService, Log, Span, Metric
**Fluxos de Trabalho**: Workflow, WorkflowVariable, WorkflowLog

Cada recurso suporta operações padrão: Listar, Contar, Obter, Criar, Atualizar e Excluir.
