# Visão geral dos painéis

Painéis são como você transforma a telemetria que o OneUptime já coleta — métricas, logs, traces, incidentes, monitores, recursos de Kubernetes e Docker — em uma única página que alguém consegue olhar e entender a saúde de um sistema.

Coloque um gráfico de latência de requisições ao lado de uma lista de incidentes abertos, ao lado de um indicador de utilização de CPU, ao lado de uma frase de status em texto simples. Salve. Compartilhe o link.

## Visão rápida

- **Funcionalidade de primeiro nível** no painel do OneUptime, em **Dashboards**.
- **Canvas baseado em grade** — 12 unidades de largura por 60 unidades de altura por padrão. Arraste widgets, redimensione-os, encaixe na grade.
- **Mais de 20 tipos de widget** — gráficos, valores únicos, indicadores, tabelas, blocos de texto, fluxos de log, listas de trace e listas de recursos em tempo real para incidentes, alertas, monitores, Kubernetes (pods, nós, deployments, …), Docker e hosts.
- **Variáveis e filtros** — transformam um único painel em uma visão templada que você reaproveita para cada cluster, serviço, cliente ou ambiente.
- **Compartilhamento público** — acione uma chave e o painel fica acessível em uma URL pública, com proteção opcional por senha e lista de IPs permitidos.
- **Domínios personalizados** — hospede um painel público em `status.seu-dominio.com` em vez do domínio do OneUptime.

## Por que usar painéis?

Painéis valem o investimento quando uma destas é verdade:

- **Você precisa de uma página "está tudo OK?"** para uma escala de plantão, uma reunião diária de equipe ou um CEO que passa em frente à TV da parede.
- **Você precisa correlacionar sinais** — um pico de CPU no mesmo minuto que um aumento de latência em traces e um incidente aberto é muito mais óbvio em um único painel do que em três abas.
- **Você está investigando** — um painel livre que você monta durante uma sessão de depuração é mais rápido do que rodar dez consultas na mão.
- **Você está publicando externamente** — um painel de performance voltado para o cliente, um rollup para parceiros, um quadro público de saúde para um serviço open source.

## Conceitos-chave

| Termo | Significado |
| --- | --- |
| **Painel** | O canvas. Uma visão nomeada e reutilizável que contém uma lista de widgets, um controle de intervalo de tempo e um conjunto de variáveis. |
| **Widget** | Um componente no canvas — um gráfico, um valor, uma tabela, um bloco de texto, uma lista. Cada um tem um tipo e uma configuração no estilo JSON. |
| **Unidade de painel** | O quadrado da grade. Os widgets são dimensionados em unidades de painel (por exemplo, "4 de largura × 6 de altura"). As unidades se convertem em pixels com base na janela de visualização. |
| **Variável** | Um valor nomeado que o visualizador escolhe em uma lista suspensa (ou digita) e que o painel injeta na consulta de cada widget. Cluster, serviço, cliente, ambiente — qualquer coisa pela qual você filtraria. |
| **Intervalo de tempo** | A janela de tempo contra a qual todo widget consulta. Escolha um preset ("últimas 24 horas") ou um intervalo personalizado. |
| **Intervalo de atualização** | Com que frequência os widgets reconsultam no modo **View**. Off, 5s, 10s, 30s, 1m, 5m, 15m. |
| **Modo** | `Edit` (arrastar, redimensionar, configurar) ou `View` (somente leitura). Os dois compartilham o mesmo canvas. |

## O catálogo de widgets

Um mapa não exaustivo do que você pode colocar em um painel:

| Categoria | Widgets |
| --- | --- |
| **Série temporal** | Chart |
| **Número único** | Value, Gauge |
| **Tabular** | Table |
| **Anotação** | Text |
| **Logs e traces** | LogStream, TraceList |
| **Listas operacionais** | IncidentList, AlertList, MonitorList |
| **Kubernetes** | KubernetesPodList, KubernetesNodeList, KubernetesNamespaceList, KubernetesDeploymentList, KubernetesStatefulSetList, KubernetesDaemonSetList, KubernetesJobList, KubernetesCronJobList |
| **Docker** | DockerHostList, DockerContainerList, DockerImageList, DockerNetworkList, DockerVolumeList |
| **Infraestrutura** | HostList |

Para os argumentos de cada um e quando recorrer a eles, veja [Widgets](/docs/dashboards/widgets).

## Onde os painéis ficam no painel

| Página | O que você faz lá |
| --- | --- |
| **Dashboards** | Navegar, criar, pesquisar e rotular painéis. |
| **Um painel → View** | O canvas — modo Edit para autores, modo View para o resto. Alterne entre eles no cabeçalho. |
| **Um painel → Overview** | Descrição, propriedade, rótulos. |
| **Um painel → Settings** | Compartilhamento público, senha mestra, lista de IPs permitidos, domínios personalizados, branding (título da página, descrição, logo, favicon). |
| **Um painel → Owners** | Usuários e equipes com propriedade explícita. |
| **Um painel → Delete** | Remover o painel (irreversível). |

## O ciclo de vida de um painel

1. **Criar** — Em **Dashboards → Create Dashboard**, dê um nome a ele. O canvas abre vazio.
2. **Colocar widgets** — Na paleta de widgets, escolha um tipo, configure a fonte dele (uma consulta de métrica, um filtro de lista, um corpo livre de texto). Posicione e redimensione.
3. **(Opcional) Adicionar variáveis** — Defina uma lista suspensa como `cluster` ou `service` para que o mesmo painel renderize para cada valor.
4. **Defina o intervalo de tempo e o intervalo de atualização** — Os padrões funcionam bem; ajuste depois.
5. **(Opcional) Compartilhe publicamente** — Em **Settings**, acione **Public Dashboard**. Adicione uma senha mestra se quiser uma barreira, ou restrinja por IP.
6. **(Opcional) Domínio personalizado** — Adicione um registro `dashboard.seu-dominio.com` e verifique o DNS, depois sirva o painel na sua própria URL.

## Um exemplo trabalhado

Objetivo: uma página de plantão para o serviço de checkout com latência, taxa de erros, incidentes abertos e uma cauda de logs recentes.

1. Crie um painel "Checkout oncall".
2. Adicione uma variável `service` do tipo **Telemetry Attribute** vinculada à chave de atributo `service.name`. Valor padrão `checkout`.
3. Adicione um widget **Chart**: latência P95 da sua métrica de APM, filtrado por `service.name = {{service}}`. O intervalo de tempo segue o do painel.
4. Ao lado, adicione um widget **Value**: percentual de taxa de erros com um limite de alerta em 1% e um limite crítico em 5%.
5. Abaixo, adicione um widget **IncidentList** filtrado por rótulos que incluem `checkout`.
6. Abaixo disso, um widget **LogStream** filtrado por `service.name = {{service}}`.
7. Salve. Troque a lista suspensa de variáveis para `payments` — o painel inteiro re-renderiza para o serviço de payments. Mesmo template, filtro diferente.

## Como os painéis se encaixam no resto do OneUptime

- **Monitores e telemetria** alimentam os painéis com dados brutos — toda métrica configurada, toda linha de log ingerida, todo span de trace é consultável em um widget.
- **Incidentes e alertas** aparecem em widgets **IncidentList** e **AlertList** — painéis são visões somente leitura sobre eles; crie/edite essas entidades em outro lugar.
- **Páginas de status** são uma ferramenta de comunicação voltada para o cliente ("o sistema está no ar agora?"). Painéis são uma ferramenta analítica ("como o sistema está se comportando em detalhe?"). Os dois se complementam, não se substituem.
- **Workflows** são o lado de escrita do OneUptime — painéis são o lado de leitura.

## O que ler a seguir

- [Criar um painel](/docs/dashboards/authoring) — usar o canvas, a grade, modo edit vs view.
- [Widgets](/docs/dashboards/widgets) — o catálogo e a configuração por widget.
- [Variáveis e filtros](/docs/dashboards/variables) — templar um painel para que funcione para muitos serviços / clientes / clusters.
- [Compartilhamento e painéis públicos](/docs/dashboards/sharing) — URLs públicas, senha mestra, lista de IPs permitidos, domínios personalizados.
- [Configuração e permissões](/docs/dashboards/configuration) — propriedade, rótulos, retenção, controle de acesso baseado em função.
