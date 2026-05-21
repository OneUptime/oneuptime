# Widgets

Um widget é um bloco em um painel. Esta página lista todos os widgets que você pode adicionar, o que mostram e quando usá-los.

Para saber como arrastar widgets pelo canvas, veja [Criando um Painel](/docs/dashboards/authoring).

## Gráficos e números

### Gráfico

Um gráfico de linhas, barras ou área de uma ou mais séries de métricas ao longo do intervalo de tempo do painel.

**Configurações**:

- Uma ou mais consultas de métrica.
- Uma fórmula opcional que combina duas consultas (por exemplo, `errors / total * 100` para obter uma taxa de erro).
- Uma opção "mostrar como taxa" para contadores cumulativos que crescem sem reiniciar.
- Opções de exibição: empilhado ou sobreposto, unidade do eixo Y, posição da legenda, tipo de gráfico.

Use quando: tendências importam. Latência ao longo do tempo, contagem de erros, profundidade de fila, qualquer coisa em que a forma da linha conta a história.

### Valor

Um único número grande com limiares coloridos opcionais.

**Configurações**:

- Uma consulta de métrica que retorna um único número (último valor, média ou máximo no intervalo de tempo).
- Um limiar opcional de **aviso** (amarelo acima dele).
- Um limiar opcional **crítico** (vermelho acima dele).
- Formato e unidade do número.

Use quando: um número responde à pergunta. Taxa de erro atual, latência P95 agora, contagem de incidentes abertos.

### Indicador

Um indicador circular com mínimo, máximo, faixa de aviso e faixa crítica.

**Configurações**: uma consulta de métrica e os quatro limites.

Use quando: o valor cabe em uma faixa conhecida. Porcentagem de CPU (0–100%), uso de disco, capacidade de fila.

### Tabela

Uma tabela de resultados de métricas, uma linha por grupo.

**Configurações**: uma consulta de métrica (geralmente agrupada por uma etiqueta como host ou serviço), as colunas a mostrar e um limite de linhas.

Use quando: você quer um detalhamento em vez de uma tendência. Top 10 hosts mais barulhentos, contagem de erros por serviço, requisições por endpoint.

## Texto

Um bloco estático de Markdown.

**Configurações**: o corpo em Markdown. Títulos, listas, links, ênfases e blocos de código são todos renderizados.

Use quando: você quer um título de seção, um parágrafo de contexto, uma lista de links para runbooks ou um banner temporário durante um incidente.

## Logs e traces

### Fluxo de Logs

Um acompanhamento ao vivo das linhas de log que correspondem a um filtro.

**Configurações**: filtros de log (serviço, severidade, atributos) e as colunas a mostrar.

Use quando: você quer ver o que a aplicação está dizendo agora mesmo, sem sair do painel.

### Lista de Traces

Uma lista de traces recentes que correspondem a um filtro, com duração, status e serviço.

**Configurações**: filtros de trace (serviço, status, atributos).

Use quando: você quer uma lista de atividades recentes em vez de um gráfico. Um padrão comum é um gráfico de latência no topo com uma lista de traces lentos abaixo.

## Listas ao vivo

### Lista de Incidentes

Uma lista ao vivo de incidentes que correspondem a um filtro.

**Configurações**: filtros por estado, severidade, etiquetas, monitor ou equipe.

Use quando: o painel responde a "o que está quebrado agora?"

### Lista de Alertas

Uma lista ao vivo de alertas que correspondem a um filtro.

**Configurações**: filtros por estado, severidade, etiquetas.

Use quando: um painel de equipe acompanha os alertas dos serviços dela.

### Lista de Monitores

Uma lista ao vivo de monitores e seu status atual.

**Configurações**: filtros por tipo de monitor, etiquetas ou estado atual.

Use quando: você quer uma visão de frota — "todos os sites estão no ar?"

## Listas de recursos do Kubernetes

Para projetos com um [Agente Kubernetes](/docs/monitor/kubernetes-agent) instalado. Cada um aceita filtros opcionais por cluster, namespace e etiquetas.

- **Lista de Pods Kubernetes** — pods com sua fase, reinícios e nó.
- **Lista de Nós Kubernetes** — nós com suas condições e capacidade.
- **Lista de Namespaces Kubernetes** — namespaces e contagens de workloads.
- **Lista de Deployments Kubernetes** — deployments com réplicas desejadas vs. prontas.
- **Lista de StatefulSets Kubernetes** — statefulsets com réplicas prontas.
- **Lista de DaemonSets Kubernetes** — daemonsets com desejadas vs. prontas.
- **Lista de Jobs Kubernetes** — jobs e seu status de conclusão.
- **Lista de CronJobs Kubernetes** — cronjobs com agendamento e última execução.

Use estes quando: você quer um único painel misturando estado do Kubernetes com a telemetria desses workloads.

## Listas de recursos do Docker

Para projetos com monitoramento Docker configurado.

- **Lista de Hosts Docker** — hosts executando Docker, com contagens de contêineres.
- **Lista de Contêineres Docker** — contêineres com estado, imagem, host, tempo no ar.
- **Lista de Imagens Docker** — imagens e seus tamanhos.
- **Lista de Redes Docker** — redes do Docker e contêineres conectados.
- **Lista de Volumes Docker** — volumes do Docker e seu uso.

## Infraestrutura

### Lista de Hosts

Hosts monitorados pelo monitor de servidor do OneUptime, com status, CPU, memória e tempo no ar.

**Configurações**: filtros por etiquetas ou estado atual.

## Qual widget devo usar?

Algumas regras rápidas:

- **Tendência ao longo do tempo?** Gráfico.
- **Um número que importa agora?** Valor (ou Indicador se tiver um mínimo/máximo claro).
- **Detalhamento entre muitas coisas?** Tabela.
- **O que está acontecendo no sistema agora?** Fluxo de Logs, Lista de Traces, Lista de Incidentes.
- **O estado de um grupo específico de recursos?** A lista correspondente.
- **Um título, um parágrafo ou um link?** Texto.

A maioria dos painéis mistura alguns — um gráfico no topo, um ou dois valores ao lado, um divisor de texto e uma ou duas listas embaixo.

## O que ler em seguida

- [Variáveis e Filtros](/docs/dashboards/variables) — tornando widgets reutilizáveis para muitos serviços ou clientes.
- [Criando um Painel](/docs/dashboards/authoring) — a mecânica do canvas.
- [Compartilhamento e Painéis Públicos](/docs/dashboards/sharing) — compartilhando fora da sua equipe.
