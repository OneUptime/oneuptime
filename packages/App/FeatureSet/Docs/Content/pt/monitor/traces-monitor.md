# Monitor de Rastreamentos

O monitoramento de rastreamentos permite monitorar rastreamentos distribuídos dos seus aplicativos e acionar alertas com base em padrões, contagens e status de spans. O OneUptime avalia dados de rastreamento dos seus serviços de telemetria em uma janela de tempo.

## Visão Geral

Os monitores de rastreamentos pesquisam e contam spans que correspondem a filtros específicos. Isso permite que você:

- Alerte sobre picos de spans de erro nos seus serviços
- Monitore operações e endpoints específicos
- Rastreie volume e padrões de spans
- Filtre por status de span, nome e atributos personalizados
- Detecte problemas de desempenho e confiabilidade a partir de dados de rastreamento

## Criando um Monitor de Rastreamentos

1. Vá para **Monitores** no Painel do OneUptime
2. Clique em **Criar monitor**
3. Selecione **Traços** como o tipo de monitor
4. Escolha quais spans contar: o nome do span, a janela de tempo e os status de span
5. Para restringi-los a serviços de telemetria, entidades de infraestrutura ou atributos, abra **Mais campos** abaixo desses filtros
6. Configure os critérios conforme necessário

## Opções de Configuração

### Serviços de Telemetria

Selecione em **Mais campos** um ou mais serviços para monitorar rastreamentos. Deixe vazio para monitorar os spans de todos os serviços. Os serviços devem estar enviando rastreamentos para o OneUptime via OpenTelemetry.

### Filtros de Span

| Filtro        | Descrição                                                                             | Obrigatório |
| ------------- | ------------------------------------------------------------------------------------- | ----------- |
| Span Statuses | Filtrar por código de status de span (OK, ERROR, UNSET)                               | Não         |
| Span Name     | Pesquisa de texto para nomes de span específicos (ex.: nomes de operação ou endpoint) | Não         |
| Attributes    | Pares chave-valor para filtrar em atributos de span personalizados                    | Não         |
| Time Window   | Quão longe retrospectar para pesquisar spans (em segundos, padrão: 60)                | Não         |

### Códigos de Status de Span

- **OK** — A operação foi marcada explicitamente como bem-sucedida, pelo código do aplicativo ou por um pipeline de rastreamentos
- **ERROR** — A operação encontrou um erro
- **UNSET** — Nenhum status de erro foi definido. Este é o status padrão do OpenTelemetry

UNSET não significa que faltam dados. A instrumentação do OpenTelemetry define ERROR quando uma operação falha e deixa os spans bem-sucedidos como UNSET, por isso, em um serviço saudável, a maioria dos spans é UNSET. O OneUptime os exibe em verde como "Unset (no error)". Registrar uma exceção não altera o status de um span, portanto um span com status UNSET ainda pode ter exceções; elas são listadas junto com o span. Para alertar sobre falhas, filtre por ERROR. Para contar todos os spans que não falharam, selecione tanto OK quanto UNSET.

Se você quiser que as requisições bem-sucedidas apareçam como OK, adicione um pipeline de rastreamentos em **Traços > Configurações > Pipelines** com a condição de filtro **Status = Não definido** e um **Remapeador de status** que mapeie valores de `http.response.status_code`, como `200`, para Ok.

## Critérios de Monitoramento

### Tipos de Verificação Disponíveis

| Tipo de Verificação | Descrição                                                              |
| ------------------- | ---------------------------------------------------------------------- |
| Span Count          | O número de spans que correspondem aos seus filtros na janela de tempo |

### Tipos de Filtro

- **Greater Than** — A contagem de spans excede um limite
- **Less Than** — A contagem de spans está abaixo de um limite
- **Greater Than or Equal To** — A contagem de spans está no limite ou acima
- **Less Than or Equal To** — A contagem de spans está no limite ou abaixo
- **Equal To** — A contagem de spans corresponde exatamente

### Critérios de Exemplo

#### Alertar se mais de 50 spans de erro em 60 segundos

- **Span Statuses**: ERROR
- **Janela de tempo**: 60 segundos
- **Check On**: Span Count
- **Tipo de filtro**: Greater Than
- **Valor**: 50

#### Alertar sobre erros em um endpoint específico

- **Nome do span**: `POST /api/checkout`
- **Span Statuses**: ERROR
- **Janela de tempo**: 120 segundos
- **Check On**: Span Count
- **Tipo de filtro**: Greater Than
- **Valor**: 0

## Requisitos de Configuração

O monitoramento de rastreamentos requer que seus aplicativos enviem rastreamentos distribuídos para o OneUptime via OpenTelemetry. Consulte a documentação do [OpenTelemetry](/docs/telemetry/open-telemetry) para instruções de configuração.
