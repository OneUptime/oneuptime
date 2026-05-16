# Monitor de Métricas

O monitoramento de métricas permite monitorar métricas de aplicativos e infraestrutura personalizadas coletadas via OpenTelemetry. O OneUptime avalia valores de métricas em uma janela de tempo e aciona alertas com base nos critérios configurados.

## Visão Geral

Os monitores de métricas consultam e avaliam métricas numéricas dos seus serviços de telemetria. Isso permite que você:

- Monitore métricas de aplicativos personalizadas (taxas de requisição, profundidade de filas, taxas de erro, etc.)
- Rastreie métricas de infraestrutura (CPU, memória, disco, rede)
- Crie consultas de métricas complexas com filtros e agregações
- Combine múltiplas métricas usando fórmulas matemáticas
- Defina alertas com base em limites de métricas

## Criando um Monitor de Métricas

1. Vá para **Monitors** no Painel do OneUptime
2. Clique em **Create Monitor**
3. Selecione **Metrics** como o tipo de monitor
4. Configure consultas de métricas e fórmulas opcionais
5. Selecione a estratégia de agregação
6. Configure os critérios de monitoramento conforme necessário

## Opções de Configuração

### Consultas de Métricas

Defina uma ou mais consultas de métricas. Cada consulta inclui:

| Campo | Descrição | Obrigatório |
|-------|-------------|----------|
| Metric Name | O nome da métrica a consultar | Sim |
| Aggregation Type | Como agregar valores brutos de métricas (sum, avg, min, max, count) | Sim |
| Attributes | Filtros chave-valor para restringir os dados de métricas | Não |
| Aggregate By | Dimensões para agrupar a métrica | Não |

Cada consulta recebe um alias (ex.: `a`, `b`, `c`) para uso em fórmulas.

### Fórmulas

Combine múltiplas consultas de métricas usando expressões matemáticas. Por exemplo:

- `a / b * 100` — Calcular uma porcentagem a partir de duas consultas
- `a + b` — Somar duas métricas
- `a - b` — Diferença entre métricas

### Janela de Tempo Deslizante

Selecione a janela de tempo para avaliação de métricas:

- Último 1 Minuto
- Últimos 5 Minutos
- Últimos 10 Minutos
- Últimos 15 Minutos
- Últimos 30 Minutos
- Últimos 60 Minutos

### Estratégia de Agregação

Escolha como agregar os valores de métricas para avaliação:

| Estratégia | Descrição |
|----------|-------------|
| Average | Valor médio ao longo da janela de tempo |
| Sum | Soma de todos os valores |
| Maximum Value | Maior valor na janela de tempo |
| Minimum Value | Menor valor na janela de tempo |
| All Values | Todos os valores devem corresponder aos critérios |
| Any Value | Pelo menos um valor deve corresponder |

## Critérios de Monitoramento

### Tipos de Verificação Disponíveis

| Tipo de Verificação | Descrição |
|------------|-------------|
| Metric Value | O valor agregado da consulta de métrica ou fórmula configurada |

### Tipos de Filtro

- **Greater Than** — O valor da métrica excede um limite
- **Less Than** — O valor da métrica está abaixo de um limite
- **Greater Than or Equal To** — O valor da métrica está no limite ou acima
- **Less Than or Equal To** — O valor da métrica está no limite ou abaixo
- **Equal To** — O valor da métrica corresponde exatamente
- **Not Equal To** — O valor da métrica não corresponde

### Critérios de Exemplo

#### Alertar se a taxa de erro exceder 5%

- **Query a**: `http_requests_total` filtrado por `status=5xx`
- **Query b**: `http_requests_total`
- **Formula**: `a / b * 100`
- **Check On**: Metric Value
- **Filter Type**: Greater Than
- **Value**: 5

#### Alertar se a profundidade da fila de requisições for alta

- **Query**: `request_queue_size`, agregação: Maximum Value
- **Check On**: Metric Value
- **Filter Type**: Greater Than
- **Value**: 1000

## Requisitos de Configuração

O monitoramento de métricas requer que seus aplicativos ou infraestrutura enviem métricas para o OneUptime via OpenTelemetry. Consulte a documentação do [OpenTelemetry](/docs/telemetry/open-telemetry) para instruções de configuração.
