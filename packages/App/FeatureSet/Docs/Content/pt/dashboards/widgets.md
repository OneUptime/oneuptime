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

## HTML

Seu próprio HTML, CSS e JavaScript, renderizados como um widget.

**Configurações**: o corpo em HTML, uma folha de estilos opcional, um script opcional e três opções de permissão.

Use quando: você precisa de algo que nenhum widget nativo cobre — um selo de terceiros incorporado, uma tabela puxada de uma API interna, uma legenda personalizada, um conjunto de links estilizados para as suas próprias ferramentas.

### O que ele pode e o que não pode fazer

O widget é renderizado em um frame com sandbox, em uma origem isolada própria. Dentro desse frame, seu código pode fazer praticamente qualquer coisa: construir DOM, executar timers, buscar dados de qualquer URL, desenhar em um canvas.

O que ele não pode fazer é alcançar a página do OneUptime ao redor. Ele não tem acesso ao DOM, aos cookies, ao armazenamento local nem à sessão de API do painel, e não pode tirar a aba do navegador da página atual. Isso vale tanto para um painel privado quanto para um compartilhado publicamente.

Duas consequências que vale conhecer antes de colar algo aqui:

- Um `fetch` a partir do widget é uma requisição de origem cruzada vinda de uma origem opaca, então o servidor que você chama precisa permiti-la com CORS. Chamar a API do OneUptime a partir daqui não é suportado.
- O widget começa transparente. Defina um fundo no `body` no seu CSS se quiser que ele preencha o bloco.

### Usando variáveis do painel

Escreva `{{variableName}}` em qualquer lugar do HTML, do CSS ou do JavaScript e isso será substituído pelo valor atual dessa variável antes de o widget ser renderizado. Escolher um novo valor renderiza o widget de novo. Um placeholder que nomeia uma variável inexistente é deixado como está.

Scripts recebem os mesmos valores, mais o intervalo de tempo do painel, em `window.ONEUPTIME`:

```javascript
window.ONEUPTIME.variables.environment; // valor atual, ou "" se não definido
window.ONEUPTIME.startDate; // string ISO 8601, início do intervalo de tempo do painel
window.ONEUPTIME.endDate; // string ISO 8601, fim dele
```

O widget é recarregado sempre que o painel atualiza, então um widget que busca os próprios dados acompanha o intervalo de atualização.

### Permissões

**Run JavaScript** (executar JavaScript; ativado por padrão) executa o seu script. Desligue para renderizar apenas marcação e estilos — o script então fica totalmente de fora do widget, em vez de apenas ser bloqueado.

**Open links in a new tab** (abrir links em uma nova aba; ativado por padrão) permite que links e `window.open` abram uma aba do navegador. Links sempre abrem em uma nova aba; o widget nunca pode navegar o próprio painel.

**Allow forms to submit** (permitir o envio de formulários; desativado por padrão) permite que um `<form>` dentro do widget seja enviado.

Quem pode editar o painel decide o que este widget executa, e todos que visualizam o painel o executam — em um painel público, isso inclui visitantes anônimos. Trate o acesso de edição a um painel que contém um widget HTML como você trataria o acesso a qualquer outro código que você coloca em produção.

## Logs e traces

### Gráfico de Logs

Um gráfico de série temporal do volume de logs ao longo do intervalo de tempo do painel. Cada série representa uma severidade, então picos de erro se destacam do tráfego normal.

**Configurações**:

- Visualização em barras, linhas ou áreas. Gráficos de barras e de áreas empilham as séries de severidade.
- Filtros de severidade opcionais.
- Busca textual opcional no corpo do log.
- Filtros exatos de atributos do OpenTelemetry por meio de linhas de chave/valor pesquisáveis. Nomes de atributos e valores conhecidos são sugeridos conforme você digita, e valores personalizados continuam suportados.
- Um título opcional.

Os controles de intervalo de tempo e de atualização do painel reconsultam o gráfico automaticamente. Variáveis de atributo de telemetria do painel também se aplicam a ele, incluindo variáveis de seleção múltipla.

O Gráfico de Logs exige, por enquanto, um painel autenticado. Painéis públicos mostram o widget como indisponível em vez de expor anonimamente os agregados de logs do projeto.

Use quando: você quer perceber mudanças no volume de logs ou comparar erros, avisos e logs informativos sem sair do painel.

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

## Objetivos de nível de serviço

### SLO

Um objetivo de nível de serviço, desenhado como um número único ou como uma linha ao longo do tempo.

**Configurações**: qual SLO, qual dos seus três números (SLI, orçamento de erro restante ou taxa de consumo), exibição como Cartão ou Gráfico, e um título opcional.

- **Cartão** mostra o número atual e, quando existe, uma segunda linha — a meta abaixo do SLI, os minutos restantes abaixo do orçamento de erro. Uma pílula de status colore o conjunto.
- **Gráfico** desenha o mesmo número ao longo do intervalo de tempo do painel, com a meta marcada como linha tracejada na série do SLI. O histórico é escrito a cada poucos minutos pelo worker de avaliação, então um SLO recém-criado aparece vazio até ser avaliado pela primeira vez.

Use quando: o painel responde a "estamos cumprindo o que prometemos?" e não a "o que está acontecendo agora?"

O widget de SLO funciona em [painéis públicos](/docs/dashboards/sharing). O que é publicado são os números principais do SLO — nome, meta, SLI atual, orçamento de erro restante, taxa de consumo e status — independentemente de qual deles o widget desenha. Sua definição continua privada: os monitores que ele observa, suas etiquetas, sua descrição, sua consulta e sua programação de avaliação nunca são enviados a um visitante público. Um widget de Cartão publica apenas esses números atuais; um widget de Gráfico publica também o histórico da única série que desenha, e nada mais.

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

## Rede

### Mapa de Rede

Seus sites de rede desenhados no mapa-múndi, cada um fixado em sua própria latitude e longitude e colorido pelo status de monitor agregado sobre ele. Sites próximos entre si compartilham um marcador com a contagem impressa dentro dele; um marcador que representa exatamente um site abre esse site quando você clica nele.

O mapa se enquadra nos sites que desenhou — um parque dentro de um único país preenche o enquadramento com aquele país, e um espalhado por continentes abre no mundo. Não há controles de zoom nem de deslocamento: um bloco de painel é uma imagem, e a página Mapa de Rede, em Rede, é onde você percorre a hierarquia.

Acima do mapa é impresso quantos sites estão fora do ar, porque um ponto vermelho de dois pixels entre duzentos verdes não é algo que alguém leia à distância de um painel. Abaixo, uma linha de cobertura diz o que o mapa _não_ está mostrando — sites sem coordenadas, e se o limite de linhas foi atingido.

**Configurações**: título, visualização em mapa ou lista, máximo de sites desenhados, se os nomes dos sites são impressos, e filtros por tipo de site e por status. Os nomes dos sites saem automaticamente quando o mapa fica cheio demais para que sejam legíveis; o tooltip continua nomeando cada marcador.

Um site só aparece se tiver coordenadas. Adicione latitude e longitude no site (ou importe-as de um CSV) para fixá-lo.

## Qual widget devo usar?

Algumas regras rápidas:

- **Tendência ao longo do tempo?** Gráfico.
- **Volume de logs ou picos de erro ao longo do tempo?** Gráfico de Logs.
- **Um número que importa agora?** Valor (ou Indicador se tiver um mínimo/máximo claro).
- **Detalhamento entre muitas coisas?** Tabela.
- **O que está acontecendo no sistema agora?** Fluxo de Logs, Lista de Traces, Lista de Incidentes.
- **O estado de um grupo específico de recursos?** A lista correspondente.
- **Estamos entregando a confiabilidade que prometemos?** SLO.
- **Onde no mundo sua rede está e o que está vermelho?** Mapa de Rede.
- **Um título, um parágrafo ou um link?** Texto.
- **Algo que nada disso cobre?** HTML — mas só depois de verificar que um widget nativo realmente não dá conta.

A maioria dos painéis mistura alguns — um gráfico no topo, um ou dois valores ao lado, um divisor de texto e uma ou duas listas embaixo.

## O que ler em seguida

- [Variáveis e Filtros](/docs/dashboards/variables) — tornando widgets reutilizáveis para muitos serviços ou clientes.
- [Criando um Painel](/docs/dashboards/authoring) — a mecânica do canvas.
- [Compartilhamento e Painéis Públicos](/docs/dashboards/sharing) — compartilhando fora da sua equipe.
