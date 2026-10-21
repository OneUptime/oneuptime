# Explorador de métricas

Métricas são os números que seus serviços e sua infraestrutura informam ao longo do tempo: contagens de requisições, latências, CPU, profundidade de filas. O explorador de métricas lista cada métrica que seu projeto recebe, transforma qualquer uma delas em gráfico, combina métricas com fórmulas e transforma um gráfico em monitor ou em widget de painel.

:::cards
- [Encontrar uma métrica](#encontrar-uma-métrica): Pesquisar a lista de nomes de métricas.
- [Fazer o gráfico de uma métrica](#fazer-o-gráfico-de-uma-métrica): Agregar, filtrar e agrupar uma consulta.
- [Combinar consultas com uma fórmula](#combinar-consultas-com-uma-fórmula): Taxas de erro e outras proporções.
- [Usar o que você colocou no gráfico](#usar-o-que-você-colocou-no-gráfico): Um monitor, um widget de painel ou um link.
:::

## Como o explorador funciona

O explorador tem dois níveis. A aba **Visualizador** lista as métricas que seu projeto recebe. Clique em uma, e o explorador de métricas abre com uma consulta para ela: uma métrica, como agregá-la e como filtrá-la e agrupá-la. Cada consulta é uma variável, `a`, `b` e assim por diante, que uma fórmula pode usar.

```mermaid title="Das consultas de métricas a um gráfico, um monitor ou um painel"
flowchart TB
    a["Consulta a: requisições,<br/>agregadas por Sum"] --> f["Fórmula:<br/>$b / $a * 100"]
    b["Consulta b: erros,<br/>agregados por Sum"] --> f
    f --> chart["Gráfico: taxa de<br/>erros em percentual"]
    chart --> monitor["Um monitor de métricas"]
    chart --> dash["Um widget de painel"]
```

O explorador tem quatro abas:

| Aba | Para que serve |
| --- | --- |
| **Visualizador** | A lista de métricas, cada uma com um pequeno gráfico e o último valor. Abre na última hora. |
| **Insights** | Quais serviços informam métricas, e quantas. |
| **Guia de configuração** | Como enviar métricas com OpenTelemetry, usando uma das suas chaves de ingestão. |
| **Configurações** | **Regras de pipeline** e **Regras de gravação**: o que acontece com as métricas quando chegam. |

## Antes de começar

- **Métricas chegando.** Envie-as com [OpenTelemetry](/docs/telemetry/open-telemetry), ou de um agente como o [coletor OpenTelemetry para hosts](/docs/telemetry/host-otel-collector) ou o [agente Kubernetes](/docs/telemetry/kubernetes-agent).
- **Uma função que possa ler telemetria.** Project Owner, Project Admin, Project Member, Viewer, Telemetry Admin, Telemetry Member ou Telemetry Viewer, ou uma função personalizada com a permissão Read Telemetry Service Metrics. Veja [Telemetria](/docs/permissions/index#telemetria) para saber quais métricas ela lê.

## Encontrar uma métrica

Acesse **Produtos → Observabilidade → Métricas**. O **Visualizador** lista cada métrica que seu projeto já recebeu, por nome, cada uma com um pequeno gráfico do intervalo de tempo e o último valor.

- Pesquise nomes com palavras soltas ou `name:`, por exemplo `name:http.server` encontra `http.server.request.duration`. Veja [Sintaxe de pesquisa](/docs/telemetry/search-syntax#métricas).
- Filtre por **Serviço** na barra lateral para ver só as métricas que um serviço informa.
- Clique em uma métrica para fazer o gráfico dela no explorador de métricas.

## Fazer o gráfico de uma métrica

:::steps
### Abrir a métrica

Clique na métrica no **Visualizador**. O explorador abre com uma consulta, `a`, para o intervalo de tempo e os filtros da lista.

### Escolher como agregá-la

Em **Aggregate by**, escolha como os valores de cada ponto do gráfico são combinados: Avg, que é o padrão, Sum, Min, Max, Count, ou um percentil, P50, P75, P90, P95 ou P99. O percentil de uma métrica de histograma, como a duração de uma requisição, é calculado a partir dos buckets dela.

### Filtrá-la e agrupá-la

Abra **Filters & grouping**. **Filter by attributes** mantém os pontos de dados cujos atributos correspondem, como uma `http.route` específica, e **Group by** desenha uma linha por valor dos atributos que você escolher, como uma linha por host.

### Ajustar o gráfico

Abra **Display Settings** para escolher o **Chart type** (linha, área ou barras), desenhar um **Warning Threshold** e um **Critical Threshold** no gráfico, ou ativar **Convert to per-second rate**.
:::

> [!TIP]
> Um contador que só cresce, como `system.disk.io`, é mais fácil de ler como taxa. Ative **Convert to per-second rate** para mostrar a rapidez com que ele muda, em vez do total acumulado; o explorador sugere isso quando reconhece um contador assim.

Cada consulta desenha o próprio gráfico. Para desenhar uma consulta no mesmo gráfico que a anterior, ative **Overlay with previous query** nas **Display Settings** dela.

## Combinar consultas com uma fórmula

:::steps
### Adicionar as consultas

Clique em **Adicionar métrica** para cada métrica de que precisar. As novas consultas são `b`, `c` e assim por diante.

### Adicionar uma fórmula

Clique em **Adicionar fórmula** e escreva a **Fórmula** com as variáveis das consultas, os operadores `+`, `-`, `*`, `/`, `%` e `^`, e parênteses. Para uma taxa de erros em percentual, escreva `$b / $a * 100`.
:::

Uma variável pode ser escrita com ou sem o `$`, em maiúsculas ou minúsculas. Uma fórmula que cita uma consulta que você não definiu avisa isso em vez de desenhar.

## Explorar em torno de um gráfico

Os botões acima dos gráficos trabalham no intervalo de tempo que você está vendo:

| Botão | O que faz |
| --- | --- |
| **Registros** | Abre o [Explorador de registros](/docs/telemetry/logs-explorer) para este intervalo de tempo e seus filtros. |
| **Traços** | Abre o [Explorador de traços](/docs/telemetry/traces-explorer) para este intervalo de tempo e seus filtros. |
| **Investigar** | Abre um painel lateral com os registros, os traços e as exceções deste intervalo de tempo. |
| **Eventos** | Marca nos gráficos os incidentes e os alertas deste intervalo de tempo. |
| **Compare** | Desenha o período anterior em cada gráfico como linha tracejada, para você ver o que mudou. |

Arraste sobre um gráfico para dar zoom em um momento, e clique duas vezes para voltar: veja [Aplicar zoom em um intervalo de tempo](/docs/telemetry/charts-and-time-ranges).

## Usar o que você colocou no gráfico

- **Ações → Criar monitor a partir desta visualização** abre um novo monitor de métricas com estas consultas e fórmulas já preenchidas. Veja [Monitor de métricas](/docs/monitor/metrics-monitor).
- **Ações → Add to dashboard** adiciona o gráfico a um painel que você escolher. Você precisa de permissão para editar esse painel.
- **Copiar link** copia um link exatamente para esta visualização: consultas, fórmulas e intervalo de tempo.
- **Saved Views** guarda a visualização com um nome, para todos no projeto. O **Visualizador** tem as próprias visualizações salvas, para a pesquisa e os filtros dele. As visualizações salvas funcionam como no [Explorador de registros](/docs/telemetry/logs-explorer#salvar-uma-visualização).

## Insights de métricas

A aba **Insights** conta as métricas de um intervalo de tempo: **Métricas ativas**, **Serviços de relatório** e a média por serviço. Ela agrupa as métricas em categorias e lista os serviços que as informam.

## O que acontece com as métricas quando chegam

**Métricas → Configurações → Regras de pipeline** altera as métricas quando chegam, antes de serem armazenadas. As regras são executadas na ordem da lista, que você muda arrastando; uma regra para um serviço é executada antes das regras para todos os serviços.

| Tipo de regra | O que faz |
| --- | --- |
| Filtro (lista de permissões) | Mantém só os pontos de dados que correspondem e descarta o resto. |
| Descartar | Descarta os pontos de dados que correspondem. |
| Renomear Métrica | Renomeia a métrica. |
| Renomear Atributo | Renomeia a chave de um atributo nos pontos de dados que correspondem. |
| Adicionar atributo | Adiciona um atributo aos pontos de dados que correspondem. |
| Remover Atributo | Remove um atributo, como um com valores demais para ser útil. |
| Redigir Atributo | Substitui o valor de um atributo por um marcador. |
| Amostra | Mantém uma porcentagem dos pontos de dados que correspondem. |

**Métricas → Configurações → Regras de gravação** calcula a cada minuto novas métricas a partir de outras métricas. Veja [Regras de gravação de registros](/docs/telemetry/log-recording-rules) para saber como as regras de gravação funcionam.

## Solução de problemas

:::details O gráfico de um contador só sobe
É um contador cumulativo. Ative **Convert to per-second rate** nas **Display Settings** da consulta.
:::

:::details A lista diz que nenhuma métrica foi encontrada
Limpe primeiro sua pesquisa e seus chips de filtro. Se a lista continuar vazia, nenhuma métrica chegou ao OneUptime ainda: compare sua configuração com o **Guia de configuração**.
:::

:::details Faltam as métricas de um serviço
Filtre o **Visualizador** por esse **Serviço** e amplie o intervalo de tempo. Se elas continuarem faltando, o escopo da sua função pode estar deixando esse serviço de fora: veja [Telemetria](/docs/permissions/index#telemetria).
:::

## Próximos passos

:::cards
- [Monitor de métricas](/docs/monitor/metrics-monitor): Receber alertas quando uma métrica ultrapassar um limite.
- [Criar um painel](/docs/dashboards/authoring): Colocar seus gráficos lado a lado.
- [Sintaxe de pesquisa](/docs/telemetry/search-syntax): Todos os filtros que a caixa de pesquisa entende.
:::
