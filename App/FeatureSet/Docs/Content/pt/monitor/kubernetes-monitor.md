# Monitor Kubernetes

A monitorização Kubernetes permite-lhe monitorizar a saúde e o desempenho dos seus clusters Kubernetes, incluindo nós, pods, cargas de trabalho e componentes do control plane. O OneUptime recolhe métricas do seu cluster e avalia-as em função dos critérios configurados.

## Visão geral

Os monitores Kubernetes utilizam métricas do seu cluster para proporcionar visibilidade profunda da sua infraestrutura. Isto permite-lhe:

- Monitorizar a saúde de cluster, namespace, carga de trabalho, nó e pod
- Acompanhar a utilização de CPU, memória, disco e rede entre recursos
- Detetar crashes de pods, reinícios e falhas de agendamento
- Monitorizar a disponibilidade de réplicas de Deployment
- Receber alertas sobre problemas no control plane (etcd, API server, scheduler)
- Acompanhar requests e limits de recursos

## Criar um monitor Kubernetes

1. Aceda a **Monitors** no dashboard do OneUptime
2. Clique em **Create Monitor**
3. Selecione **Kubernetes** como tipo de monitor
4. Selecione o cluster e o âmbito de recurso a monitorizar
5. Configure os filtros de recurso e as consultas de métricas
6. Configure os critérios de monitorização conforme necessário

## Opções de configuração

### Cluster

Selecione o cluster Kubernetes a monitorizar. Os clusters têm de estar integrados com o OneUptime via OpenTelemetry.

### Âmbito do recurso

Escolha o nível ao qual pretende monitorizar os recursos:

| Âmbito    | Descrição                                                                    |
| --------- | ---------------------------------------------------------------------------- |
| Cluster   | Monitorizar o cluster inteiro                                                |
| Namespace | Monitorizar recursos dentro de um namespace específico                       |
| Workload  | Monitorizar um deployment, statefulset, daemonset, job ou cronjob específico |
| Node      | Monitorizar um nó específico do cluster                                      |
| Pod       | Monitorizar um pod específico                                                |

### Filtros de recurso

Restrinja o âmbito com filtros opcionais:

| Filtro        | Descrição                                        | Âmbitos aplicáveis       |
| ------------- | ------------------------------------------------ | ------------------------ |
| Namespace     | Namespace do Kubernetes                          | Namespace, Workload, Pod |
| Workload Type | deployment, statefulset, daemonset, job, cronjob | Workload                 |
| Workload Name | Nome da carga de trabalho                        | Workload                 |
| Node Name     | Nome do nó                                       | Node                     |
| Pod Name      | Nome do pod                                      | Pod                      |

### Consultas de métricas

Configure uma ou mais consultas de métricas a avaliar. Cada consulta especifica:

- **Nome da métrica** — A métrica Kubernetes a consultar
- **Agregação** — Como agregar os valores da métrica
- **Filtros** — Filtragem adicional baseada em atributos

Também pode criar **fórmulas** que combinam várias consultas de métricas usando expressões matemáticas.

### Janela temporal deslizante

Selecione a janela temporal para a avaliação das métricas:

- Último 1 minuto
- Últimos 5 minutos
- Últimos 10 minutos
- Últimos 15 minutos
- Últimos 30 minutos
- Últimos 60 minutos

## Métricas Kubernetes comuns

### Métricas de pod

| Métrica                      | Descrição                                          |
| ---------------------------- | -------------------------------------------------- |
| Pod CPU Usage                | Consumo de CPU pelos pods                          |
| Pod Memory Usage             | Consumo de memória pelos pods                      |
| Pod Filesystem Usage         | Utilização de disco pelos pods                     |
| Pod Network Receive/Transmit | Tráfego de rede                                    |
| Pod Phase                    | Fase atual do pod (Running, Pending, Failed, etc.) |

### Métricas de nó

| Métrica               | Descrição                    |
| --------------------- | ---------------------------- |
| Node CPU Usage        | Utilização de CPU por nó     |
| Node Memory Usage     | Utilização de memória por nó |
| Node Filesystem Usage | Utilização de disco por nó   |
| Node Disk I/O         | Operações de leitura/escrita |
| Node Ready Condition  | Indica se o nó está pronto   |

### Métricas de contentor

| Métrica                       | Descrição                              |
| ----------------------------- | -------------------------------------- |
| Container Restarts            | Número de reinícios do contentor       |
| Container CPU/Memory Limits   | Limits de recursos                     |
| Container CPU/Memory Requests | Requests de recursos                   |
| Container Ready Status        | Indica se os contentores estão prontos |

### Métricas de carga de trabalho

| Métrica                                   | Descrição                    |
| ----------------------------------------- | ---------------------------- |
| Deployment Available/Unavailable Replicas | Contagens de réplicas        |
| DaemonSet Misscheduled Nodes              | Problemas de agendamento     |
| StatefulSet Ready Replicas                | Contagem de réplicas prontas |
| Job Active/Failed/Succeeded Pods          | Estado do job                |

## Critérios de monitorização

### Tipos de verificação disponíveis

| Tipo de verificação | Descrição                                                |
| ------------------- | -------------------------------------------------------- |
| Metric Value        | O valor da consulta de métrica configurada ou da fórmula |

### Tipos de agregação

| Agregação     | Descrição                                          |
| ------------- | -------------------------------------------------- |
| Average       | Valor médio durante a janela temporal              |
| Sum           | Soma de todos os valores                           |
| Maximum Value | Valor mais alto na janela temporal                 |
| Minimum Value | Valor mais baixo na janela temporal                |
| All Values    | Todos os valores têm de corresponder aos critérios |
| Any Value     | Pelo menos um valor tem de corresponder            |

### Tipos de filtro

- **Maior que**, **Menor que**, **Maior ou igual a**, **Menor ou igual a**, **Igual a**, **Diferente de**

## Modelos de alerta pré-construídos

O OneUptime fornece modelos para cenários comuns de monitorização Kubernetes:

| Modelo                      | Descrição                          | Limiar          |
| --------------------------- | ---------------------------------- | --------------- |
| CrashLoopBackOff Detection  | Contagem de reinícios de contentor | > 5 reinícios   |
| Pod Stuck in Pending        | Pods na fase Pending               | > 0 pods        |
| Node Not Ready              | Condição de prontidão do nó        | = 0 (not ready) |
| High Node CPU               | Utilização de CPU do nó            | > 90%           |
| High Node Memory            | Utilização de memória do nó        | > 85%           |
| Deployment Replica Mismatch | Réplicas indisponíveis             | > 0 réplicas    |
| Job Failures                | Pods falhados num job              | > 0 falhas      |
| etcd No Leader              | Líder do cluster etcd em falta     | = 0 (no leader) |
| API Server Throttling       | Pedidos descartados pela API       | > 0 pedidos     |
| Scheduler Backlog           | Pods pendentes no scheduler        | > 0 pods        |
| High Node Disk Usage        | Utilização do filesystem do nó     | > 90%           |
| DaemonSet Unavailable       | Nós com agendamento incorreto      | > 0 nós         |

## Requisitos de configuração

Para utilizar a monitorização Kubernetes, é necessário instalar o agente Kubernetes do OneUptime no seu cluster. O agente envia métricas do cluster, eventos, logs de pods e — por omissão — **traces de aplicação e métricas RED de HTTP capturadas via eBPF** para o OneUptime através de OTLP. Não são necessárias alterações de código nem SDKs por aplicação para ver tráfego ao nível de serviço.

Consulte o guia [Instalar o agente Kubernetes](/docs/monitor/kubernetes-agent) — cobre a instalação Helm de um único comando, a opção `preset` para escolher a configuração correta para o seu cluster (standard, GKE Autopilot, EKS Fargate) e os interruptores `ebpf.features.*` para as várias famílias de sinais (métricas RED de HTTP, service graph, fluxos de rede, estatísticas TCP).
