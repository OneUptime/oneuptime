# Monitor de Exceções

O monitoramento de exceções permite monitorar exceções e erros de aplicativos, acionando alertas quando as contagens de exceções excedem seus limites configurados. O OneUptime avalia os dados de exceções dos seus serviços de telemetria em uma janela de tempo.

## Visão Geral

Os monitores de exceções contam e filtram exceções que correspondem a critérios específicos. Isso permite que você:

- Alerte sobre picos de exceções em seus aplicativos
- Monitore tipos específicos de exceções
- Pesquise exceções por mensagem de erro
- Rastreie exceções resolvidas e ativas separadamente
- Detecte problemas de estabilidade de aplicativos a partir de padrões de erros

## Criando um Monitor de Exceções

1. Vá para **Monitores** no Painel do OneUptime
2. Clique em **Criar monitor**
3. Selecione **Exceções** como o tipo de monitor
4. Selecione os serviços de telemetria para monitorar
5. Configure filtros e critérios de exceção conforme necessário

## Opções de Configuração

### Serviços de Telemetria

Selecione um ou mais serviços para monitorar exceções. Os serviços devem estar enviando dados de exceções para o OneUptime via OpenTelemetry.

### Filtros de Exceção

| Filtro           | Descrição                                                                        | Obrigatório |
| ---------------- | -------------------------------------------------------------------------------- | ----------- |
| Exception Types  | Filtrar por nomes de tipos de exceção (ex.: `NullPointerException`, `TypeError`) | Não         |
| Message          | Pesquisa de texto dentro de mensagens de exceção                                 | Não         |
| Include Resolved | Incluir exceções marcadas como resolvidas (padrão: false)                        | Não         |
| Include Archived | Incluir exceções arquivadas (padrão: false)                                      | Não         |
| Time Window      | Quão longe retrospectar para pesquisar exceções (em segundos, padrão: 60)        | Não         |

## Critérios de Monitoramento

### Tipos de Verificação Disponíveis

| Tipo de Verificação | Descrição                                                                 |
| ------------------- | ------------------------------------------------------------------------- |
| Exception Count     | O número de exceções que correspondem aos seus filtros na janela de tempo |

### Tipos de Filtro

- **Greater Than** — A contagem de exceções excede um limite
- **Less Than** — A contagem de exceções está abaixo de um limite
- **Greater Than or Equal To** — A contagem de exceções está no limite ou acima
- **Less Than or Equal To** — A contagem de exceções está no limite ou abaixo
- **Equal To** — A contagem de exceções corresponde exatamente
- **Not Equal To** — A contagem de exceções não corresponde

### Critérios de Exemplo

#### Alertar se mais de 10 exceções em 60 segundos

- **Janela de tempo**: 60 segundos
- **Check On**: Exception Count
- **Tipo de filtro**: Greater Than
- **Valor**: 10

#### Alertar em qualquer NullPointerException

- **Tipos de exceção**: `NullPointerException`
- **Janela de tempo**: 60 segundos
- **Check On**: Exception Count
- **Tipo de filtro**: Greater Than
- **Valor**: 0

#### Monitorar exceções contendo uma mensagem específica

- **Mensagem**: `out of memory`
- **Janela de tempo**: 300 segundos
- **Check On**: Exception Count
- **Tipo de filtro**: Greater Than
- **Valor**: 0

## Requisitos de Configuração

O monitoramento de exceções requer que seus aplicativos enviem dados de exceções para o OneUptime via OpenTelemetry. Consulte a documentação do [OpenTelemetry](/docs/telemetry/open-telemetry) para instruções de configuração.
