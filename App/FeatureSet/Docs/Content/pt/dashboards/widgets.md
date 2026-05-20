# Widgets

Um widget é um bloco em um painel. Cada widget tem um tipo (gráfico, valor, lista, …), uma posição, um tamanho e uma configuração. Esta página é o catálogo — o que cada widget mostra, o que ele recebe como entrada e quando recorrer a ele.

Para a mecânica do canvas, veja [Criar um painel](/docs/dashboards/authoring).

## Widgets de série temporal

### Chart

Um gráfico de linha / barra / área de uma ou mais séries de métrica ao longo do intervalo de tempo do painel.

**Configurar**:

- Uma ou mais consultas de métrica (`metricQueryConfig` para uma única série, `metricQueryConfigs` para múltiplas).
- **Formula** opcional combinando múltiplas consultas (por exemplo, `errors / total * 100`).
- **transformAsRate** opcional para contadores cumulativos do OpenTelemetry (por exemplo, `system.disk.io`) — o widget calcula `(value - previousValue) / Δt` por bucket.
- Exibição: séries empilhadas vs. sobrepostas, unidade do eixo Y, legenda ligada/desligada, tipo de gráfico.

Recorra a ele quando: tendências importam. Latência de requisições, contagem de erros ao longo do tempo, profundidade de fila, qualquer coisa em que o formato da curva te diz algo.

### Value

Um único número grande com limites opcionais e uma sparkline opcional.

**Configurar**:

- Uma consulta de métrica (valor único — geralmente `last`, `avg` ou `max` no intervalo de tempo).
- **Warning threshold** opcional (amarelo acima).
- **Critical threshold** opcional (vermelho acima).
- Exibição: formato do número, sufixo de unidade.

Recorra a ele quando: um único número responde à pergunta. Taxa de erros atual, latência P95 agora, contagem de incidentes abertos.

### Gauge

Um indicador circular com mínimo, máximo, faixa de alerta e faixa crítica.

**Configurar**: a consulta de métrica e os quatro limites (mínimo, máximo, alerta, crítico).

Recorra a ele quando: o valor se encaixa em um intervalo conhecido. Utilização de CPU (0–100%), preenchimento de disco, capacidade de fila.

### Table

Uma exibição tabular de resultados de consulta de métrica, uma linha por grupo.

**Configurar**: a consulta de métrica (tipicamente agrupada por um rótulo como `host.name` ou `service.name`), as colunas a mostrar e um limite de linhas.

Recorra a ele quando: você quer a divisão em vez da tendência. Top 10 hosts mais barulhentos, contagem de erros por serviço, taxa de requisições por endpoint.

## Widget de anotação

### Text

Um bloco estático de Markdown.

**Configurar**: o corpo Markdown. Cabeçalhos, listas, links, ênfase, spans de código, blocos de código cercados — tudo renderiza.

Recorra a ele quando: você quer um cabeçalho de seção, um parágrafo de contexto ("este painel cobre o serviço de checkout"), uma lista de links para runbooks ou painéis relacionados, ou um banner temporário durante um incidente.

## Logs e traces

### LogStream

Uma cauda ao vivo de linhas de log que casam com um filtro.

**Configurar**: filtros de log (serviço, severidade, correspondências de atributo), as colunas a mostrar.

Recorra a ele quando: você quer ver o que a aplicação está dizendo *agora* em um painel, sem sair da página para abrir o explorador de logs.

### TraceList

Uma lista de traces recentes que casam com um filtro, com duração, status e o nome do serviço.

**Configurar**: filtros de trace (serviço, status, correspondências de atributo).

Recorra a ele quando: você quer uma visão paginada de atividade recente em vez de um gráfico. Combinação comum: um Chart de latência no topo, um TraceList de traces lentos abaixo.

## Listas operacionais

### IncidentList

Uma lista ao vivo de incidentes que casam com um filtro.

**Configurar**: filtros por estado, severidade, rótulos, monitor ou equipe atribuída.

Recorra a ele quando: um painel é feito para responder "o que está quebrado agora?".

### AlertList

Uma lista ao vivo de alertas que casam com um filtro.

**Configurar**: filtros por estado, severidade, rótulos.

Recorra a ele quando: painéis para fluxos de trabalho dirigidos por alerta (por exemplo, painéis de equipe de desenvolvimento que acompanham os alertas do seu serviço).

### MonitorList

Uma lista ao vivo de monitores que casam com um filtro, mostrando o status atual de cada monitor.

**Configurar**: filtros por tipo de monitor, rótulos ou estado atual.

Recorra a ele quando: você quer uma visão de "todos os sites estão no ar?" no nível da frota, ou uma lista por equipe de endpoints monitorados.

## Listas de recursos de Kubernetes

Para projetos com um [Agente de Kubernetes](/docs/monitor/kubernetes-agent) instalado, os seguintes widgets de recursos ao vivo estão disponíveis. Cada um aceita filtros opcionais para `cluster`, `namespace` e rótulos.

- **KubernetesPodList** — pods com fase, reinícios e atribuição de nó.
- **KubernetesNodeList** — nós com condições, capacidade e alocações.
- **KubernetesNamespaceList** — namespaces e suas contagens de workloads.
- **KubernetesDeploymentList** — deployments com réplicas desejadas vs. prontas.
- **KubernetesStatefulSetList** — stateful sets com réplicas prontas.
- **KubernetesDaemonSetList** — daemon sets com desejados vs. prontos.
- **KubernetesJobList** — jobs com status de conclusão.
- **KubernetesCronJobList** — cron jobs com agendamento e última execução.

Recorra a estes quando: você quer um único painel que mistura o estado de recursos do Kubernetes com a telemetria desses workloads.

## Listas de recursos de Docker

Para projetos com um monitor de Docker instalado:

- **DockerHostList** — hosts rodando Docker, com contagens de contêineres.
- **DockerContainerList** — contêineres com estado, imagem, host, uptime.
- **DockerImageList** — imagens e seus tamanhos.
- **DockerNetworkList** — redes do Docker e contagens de contêineres conectados.
- **DockerVolumeList** — volumes do Docker e seu uso.

## Infraestrutura

### HostList

Hosts monitorados pelo monitor de servidores do OneUptime — com status atual, CPU, memória e uptime.

**Configurar**: filtros por rótulos ou estado atual de saúde.

## Escolhendo o widget certo

Algumas regras práticas:

- **Tendência ao longo do tempo?** Chart.
- **Um número que importa agora?** Value (ou Gauge se ele tem um intervalo natural).
- **Detalhamento entre muitas coisas?** Table.
- **O que está acontecendo no sistema agora?** LogStream, TraceList, IncidentList.
- **Estado de uma frota específica de recursos?** O widget de lista de recursos correspondente.
- **Um cabeçalho, um parágrafo ou um link?** Text.

A maioria dos painéis usa uma mistura — um Chart no topo, um ou dois Values ao lado, um divisor Text, depois uma ou duas listas abaixo.

## O que ler a seguir

- [Variáveis e filtros](/docs/dashboards/variables) — tornando widgets reutilizáveis entre serviços / clientes / clusters.
- [Criar um painel](/docs/dashboards/authoring) — o canvas, a grade e o modo edit.
- [Compartilhamento e painéis públicos](/docs/dashboards/sharing) — expondo um painel fora da equipe.
