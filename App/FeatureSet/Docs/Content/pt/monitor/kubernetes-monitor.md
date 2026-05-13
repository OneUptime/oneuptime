# Monitor do Kubernetes

O monitoramento do Kubernetes permite monitorar a saúde e o desempenho dos seus clusters Kubernetes, incluindo nós, pods, cargas de trabalho e componentes do plano de controle. O OneUptime coleta métricas do seu cluster e as avalia em relação aos critérios configurados.

## Visão Geral

Os monitores do Kubernetes usam métricas do seu cluster para fornecer visibilidade profunda da sua infraestrutura. Isso permite que você:

- Monitore a saúde do cluster, namespace, carga de trabalho, nó e pod
- Rastreie o uso de CPU, memória, disco e rede em recursos
- Detecte falhas de pod, reinicializações e falhas de agendamento
- Monitore a disponibilidade de réplicas de deployment
- Alerte sobre problemas do plano de controle (etcd, servidor de API, agendador)
- Rastreie solicitações e limites de recursos

## Criando um Monitor do Kubernetes

1. Vá para **Monitors** no Painel do OneUptime
2. Clique em **Create Monitor**
3. Selecione **Kubernetes** como o tipo de monitor
4. Selecione o cluster e o escopo de recurso para monitorar
5. Configure filtros de recursos e consultas de métricas
6. Configure os critérios de monitoramento conforme necessário

## Opções de Configuração

### Cluster

Selecione o cluster Kubernetes para monitorar. Os clusters devem ser integrados ao OneUptime via OpenTelemetry.

### Escopo de Recurso

Escolha o nível no qual monitorar recursos:

| Escopo | Descrição |
|-------|-------------|
| Cluster | Monitorar todo o cluster |
| Namespace | Monitorar recursos dentro de um namespace específico |
| Workload | Monitorar um deployment, statefulset, daemonset, job ou cronjob específico |
| Node | Monitorar um nó de cluster específico |
| Pod | Monitorar um pod específico |

### Filtros de Recursos

Afine o escopo com filtros opcionais:

| Filtro | Descrição | Escopos Aplicáveis |
|--------|-------------|-------------------|
| Namespace | Namespace do Kubernetes | Namespace, Workload, Pod |
| Workload Type | deployment, statefulset, daemonset, job, cronjob | Workload |
| Workload Name | Nome da carga de trabalho | Workload |
| Node Name | Nome do nó | Node |
| Pod Name | Nome do pod | Pod |

### Consultas de Métricas

Configure uma ou mais consultas de métricas para avaliar. Cada consulta especifica:

- **Nome da métrica** — A métrica do Kubernetes a consultar
- **Agregação** — Como agregar valores de métricas
- **Filtros** — Filtragem adicional baseada em atributos

Você também pode criar **fórmulas** que combinam múltiplas consultas de métricas usando expressões matemáticas.

### Janela de Tempo Deslizante

Selecione a janela de tempo para avaliação de métricas:

- Último 1 Minuto
- Últimos 5 Minutos
- Últimos 10 Minutos
- Últimos 15 Minutos
- Últimos 30 Minutos
- Últimos 60 Minutos

## Métricas Comuns do Kubernetes

### Métricas de Pod

| Métrica | Descrição |
|--------|-------------|
| Pod CPU Usage | Consumo de CPU pelos pods |
| Pod Memory Usage | Consumo de memória pelos pods |
| Pod Filesystem Usage | Uso de disco pelos pods |
| Pod Network Receive/Transmit | Tráfego de rede |
| Pod Phase | Fase atual do pod (Running, Pending, Failed, etc.) |

### Métricas de Nó

| Métrica | Descrição |
|--------|-------------|
| Node CPU Usage | Utilização de CPU por nó |
| Node Memory Usage | Utilização de memória por nó |
| Node Filesystem Usage | Uso de disco por nó |
| Node Disk I/O | Operações de leitura/escrita |
| Node Ready Condition | Se o nó está pronto |

### Métricas de Contêiner

| Métrica | Descrição |
|--------|-------------|
| Container Restarts | Número de reinicializações do contêiner |
| Container CPU/Memory Limits | Limites de recursos |
| Container CPU/Memory Requests | Solicitações de recursos |
| Container Ready Status | Se os contêineres estão prontos |

### Métricas de Carga de Trabalho

| Métrica | Descrição |
|--------|-------------|
| Deployment Available/Unavailable Replicas | Contagens de réplicas |
| DaemonSet Misscheduled Nodes | Problemas de agendamento |
| StatefulSet Ready Replicas | Contagem de réplicas prontas |
| Job Active/Failed/Succeeded Pods | Status do job |

## Critérios de Monitoramento

### Tipos de Verificação Disponíveis

| Tipo de Verificação | Descrição |
|------------|-------------|
| Metric Value | O valor da consulta de métrica ou fórmula configurada |

### Tipos de Agregação

| Agregação | Descrição |
|-------------|-------------|
| Average | Valor médio ao longo da janela de tempo |
| Sum | Soma de todos os valores |
| Maximum Value | Maior valor na janela de tempo |
| Minimum Value | Menor valor na janela de tempo |
| All Values | Todos os valores devem corresponder aos critérios |
| Any Value | Pelo menos um valor deve corresponder |

### Tipos de Filtro

- **Greater Than**, **Less Than**, **Greater Than or Equal To**, **Less Than or Equal To**, **Equal To**, **Not Equal To**

## Modelos de Alerta Pré-construídos

O OneUptime fornece modelos para cenários comuns de monitoramento do Kubernetes:

| Modelo | Descrição | Limite |
|----------|-------------|-----------|
| CrashLoopBackOff Detection | Contagem de reinicializações do contêiner | > 5 reinicializações |
| Pod Stuck in Pending | Pods na fase Pending | > 0 pods |
| Node Not Ready | Condição de prontidão do nó | = 0 (não pronto) |
| High Node CPU | Utilização de CPU do nó | > 90% |
| High Node Memory | Utilização de memória do nó | > 85% |
| Deployment Replica Mismatch | Réplicas indisponíveis | > 0 réplicas |
| Job Failures | Pods com falha em um job | > 0 falhas |
| etcd No Leader | Líder do cluster etcd ausente | = 0 (sem líder) |
| API Server Throttling | Requisições de API descartadas | > 0 requisições |
| Scheduler Backlog | Pods pendentes no agendador | > 0 pods |
| High Node Disk Usage | Uso do sistema de arquivos do nó | > 90% |
| DaemonSet Unavailable | Nós mal agendados | > 0 nós |

## Requisitos de Configuração

Para usar o monitoramento do Kubernetes, você precisa instalar o agente Kubernetes do OneUptime no seu cluster. O agente envia métricas do cluster, eventos e logs de pods para o OneUptime via OTLP.

Consulte o guia [Instalar o Agente Kubernetes](/docs/monitor/kubernetes-agent) — ele cobre a instalação Helm de um comando e a opção `preset` para escolher a configuração certa para o seu cluster (standard, GKE Autopilot, EKS Fargate).
