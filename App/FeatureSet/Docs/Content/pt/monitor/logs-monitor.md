# Monitor de Logs

O monitoramento de logs permite monitorar os logs do seu aplicativo e acionar alertas com base em padrões de log, contagens e níveis de severidade. O OneUptime avalia logs dos seus serviços de telemetria e os verifica em relação aos critérios configurados.

## Visão Geral

Os monitores de logs pesquisam e contam logs que correspondem a filtros específicos em uma janela de tempo. Isso permite que você:

- Alerte sobre picos de logs de erro
- Monitore padrões ou mensagens de log específicos
- Rastreie o volume de logs por nível de severidade
- Filtre logs por serviço, atributos e conteúdo
- Detecte problemas de aplicativos a partir de padrões de log

## Criando um Monitor de Logs

1. Vá para **Monitors** no Painel do OneUptime
2. Clique em **Create Monitor**
3. Selecione **Logs** como o tipo de monitor
4. Selecione os serviços de telemetria para monitorar
5. Configure filtros e critérios de log conforme necessário

## Opções de Configuração

### Serviços de Telemetria

Selecione um ou mais serviços para monitorar logs. Os serviços devem estar enviando logs para o OneUptime via OpenTelemetry.

### Filtros de Log

| Filtro | Descrição | Obrigatório |
|--------|-------------|----------|
| Severity Levels | Filtrar por severidade do log (ERROR, WARN, INFO, DEBUG, etc.) | Não |
| Body | Pesquisa de texto dentro do corpo da mensagem de log | Não |
| Attributes | Pares chave-valor para filtrar em atributos de log personalizados | Não |
| Time Window | Quão longe retrospectar para pesquisar logs (em segundos, padrão: 60) | Não |

### Níveis de Severidade

Filtre logs por um ou mais níveis de severidade:

- **FATAL** / **EMERGENCY** / **CRITICAL**
- **ERROR**
- **WARN** / **WARNING**
- **INFO** / **INFORMATIONAL**
- **DEBUG**
- **TRACE**
- **UNSPECIFIED**

## Critérios de Monitoramento

### Tipos de Verificação Disponíveis

| Tipo de Verificação | Descrição |
|------------|-------------|
| Log Count | O número de logs que correspondem aos seus filtros na janela de tempo |

### Tipos de Filtro

- **Greater Than** — A contagem de logs excede um limite
- **Less Than** — A contagem de logs está abaixo de um limite
- **Greater Than or Equal To** — A contagem de logs está no limite ou acima
- **Less Than or Equal To** — A contagem de logs está no limite ou abaixo
- **Equal To** — A contagem de logs corresponde exatamente
- **Not Equal To** — A contagem de logs não corresponde

### Critérios de Exemplo

#### Alertar se mais de 100 logs de erro em 60 segundos

- **Severity Levels**: ERROR
- **Time Window**: 60 segundos
- **Check On**: Log Count
- **Filter Type**: Greater Than
- **Value**: 100

#### Alertar se algum log fatal aparecer

- **Severity Levels**: FATAL
- **Time Window**: 60 segundos
- **Check On**: Log Count
- **Filter Type**: Greater Than
- **Value**: 0

#### Monitorar logs contendo uma mensagem de erro específica

- **Body**: `database connection timeout`
- **Time Window**: 300 segundos
- **Check On**: Log Count
- **Filter Type**: Greater Than
- **Value**: 5

## Requisitos de Configuração

O monitoramento de logs requer que seus aplicativos enviem logs para o OneUptime via OpenTelemetry. Consulte a documentação do [OpenTelemetry](/docs/telemetry/open-telemetry) para instruções de configuração.
