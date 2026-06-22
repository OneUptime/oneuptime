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

1. Vá para **Monitors** no Painel do OneUptime
2. Clique em **Create Monitor**
3. Selecione **Traces** como o tipo de monitor
4. Selecione os serviços de telemetria para monitorar
5. Configure filtros e critérios de span conforme necessário

## Opções de Configuração

### Serviços de Telemetria

Selecione um ou mais serviços para monitorar rastreamentos. Os serviços devem estar enviando rastreamentos para o OneUptime via OpenTelemetry.

### Filtros de Span

| Filtro        | Descrição                                                                             | Obrigatório |
| ------------- | ------------------------------------------------------------------------------------- | ----------- |
| Span Statuses | Filtrar por código de status de span (OK, ERROR, UNSET)                               | Não         |
| Span Name     | Pesquisa de texto para nomes de span específicos (ex.: nomes de operação ou endpoint) | Não         |
| Attributes    | Pares chave-valor para filtrar em atributos de span personalizados                    | Não         |
| Time Window   | Quão longe retrospectar para pesquisar spans (em segundos, padrão: 60)                | Não         |

### Códigos de Status de Span

- **OK** — A operação foi concluída com sucesso
- **ERROR** — A operação encontrou um erro
- **UNSET** — O status não foi definido explicitamente

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
- **Not Equal To** — A contagem de spans não corresponde

### Critérios de Exemplo

#### Alertar se mais de 50 spans de erro em 60 segundos

- **Span Statuses**: ERROR
- **Time Window**: 60 segundos
- **Check On**: Span Count
- **Filter Type**: Greater Than
- **Value**: 50

#### Alertar sobre erros em um endpoint específico

- **Span Name**: `POST /api/checkout`
- **Span Statuses**: ERROR
- **Time Window**: 120 segundos
- **Check On**: Span Count
- **Filter Type**: Greater Than
- **Value**: 0

## Requisitos de Configuração

O monitoramento de rastreamentos requer que seus aplicativos enviem rastreamentos distribuídos para o OneUptime via OpenTelemetry. Consulte a documentação do [OpenTelemetry](/docs/telemetry/open-telemetry) para instruções de configuração.
