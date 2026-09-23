# Monitor de Exceções

O monitoramento de exceções permite monitorar exceções e erros de aplicativos, acionando alertas quando as contagens de exceções excedem seus limites configurados. O OneUptime avalia os dados de exceções dos seus serviços de telemetria em uma janela de tempo.

## Visão Geral

Os monitores de exceções contam e filtram exceções que correspondem a critérios específicos. Isso permite que você:

- Alerte sobre picos de exceções em seus aplicativos
- Monitore tipos específicos de exceções
- Restrinja alertas a um ambiente de implantação, como `production`
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
| Environments     | Filtrar por ambiente de implantação (ex.: `production`, `staging`)               | Não         |
| Message          | Pesquisa de texto dentro de mensagens de exceção                                 | Não         |
| Include Resolved | Incluir exceções marcadas como resolvidas (padrão: false)                        | Não         |
| Include Archived | Incluir exceções arquivadas (padrão: false)                                      | Não         |
| Time Window      | Quão longe retrospectar para pesquisar exceções (em segundos, padrão: 60)        | Não         |

### Ambientes

Os ambientes vêm do atributo de recurso do OpenTelemetry `deployment.environment` em cada exceção, o mesmo valor que o explorador de exceções filtra com `env:production`. Insira um ambiente, ou vários separados por vírgulas; uma exceção é contada quando seu ambiente corresponde a qualquer um deles.

A correspondência é exata e diferencia maiúsculas de minúsculas: `production` não corresponde a `Production` nem a `prod`. Exceções sem ambiente não são contadas quando este filtro está definido. Deixe-o vazio para contar exceções de todos os ambientes, incluindo as que não têm ambiente.

O filtro de ambiente é combinado com todos os outros filtros, portanto um monitor restrito a um serviço de telemetria e a `production` conta apenas as exceções de produção desse serviço.

Ao criar o monitor pela API, defina `environments` no `exceptionMonitor` da etapa como uma lista de nomes de ambiente:

```json
{
  "exceptionMonitor": {
    "telemetryServiceIds": [],
    "environments": ["production"],
    "exceptionTypes": [],
    "message": "",
    "includeResolved": false,
    "includeArchived": false,
    "lastXSecondsOfExceptions": 300
  }
}
```

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

#### Alertar apenas em exceções de produção

- **Ambientes**: `production`
- **Janela de tempo**: 300 segundos
- **Check On**: Exception Count
- **Tipo de filtro**: Greater Than
- **Valor**: 5

#### Monitorar exceções contendo uma mensagem específica

- **Mensagem**: `out of memory`
- **Janela de tempo**: 300 segundos
- **Check On**: Exception Count
- **Tipo de filtro**: Greater Than
- **Valor**: 0

## Requisitos de Configuração

O monitoramento de exceções requer que seus aplicativos enviem dados de exceções para o OneUptime via OpenTelemetry. Consulte a documentação do [OpenTelemetry](/docs/telemetry/open-telemetry) para instruções de configuração.
