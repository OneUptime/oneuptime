# Observabilidade de Custos do Kubernetes

## Visão Geral

O OneUptime pode mostrar quanto cada workload do Kubernetes realmente custa — gasto por namespace, por controller e por pod, com capacidade ociosa e eficiência de request-vs-uso — bem ao lado das métricas, dos logs e dos traces que você já coleta com o [Agente Kubernetes](/docs/telemetry/kubernetes-agent).

Habilitá-la é um único comando:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set cost.enabled=true
```

Isso é uma instalação completa. O chart embute o motor open-source [OpenCost](https://opencost.io) (Apache-2.0, CNCF — o [cost-model](https://github.com/kubecost/cost-model) que também alimenta o Kubecost) mais um Prometheus mínimo e dedicado de que ele precisa para o histórico de uso — dois pods pequenos de encanamento invisível. O OpenCost precifica seus nós, volumes e load balancers a partir dos **preços de tabela públicos do seu provedor de nuvem automaticamente, sem credenciais** (AWS, GCP, Azure); clusters on-prem definem uma tabela de preços em vez disso (abaixo).

Em cerca de uma hora (a primeira janela horária fechada), você recebe:

- Uma **página de Custos por cluster** (_Kubernetes → seu cluster → Costs_): tendência de gastos, gasto por namespace com divisão de cpu/memória/armazenamento, gasto por workload, gasto ocioso e eficiência.
- Uma **página de Custos em nível de projeto** (_Kubernetes → Costs_): gasto em todos os clusters do projeto.
- Um **template de dashboard de Custos do Kubernetes** (_Dashboards → Create → Kubernetes Cost Dashboard_): tendências de custo horário dos nós, custos unitários de CPU/RAM, gasto com volumes persistentes e load balancers.
- Métricas de custo brutas (`node_total_hourly_cost`, `pv_hourly_cost`, ...) no **Metric Explorer**, utilizáveis em dashboards personalizados e alertas de métrica.

## Como Funciona

Com `cost.enabled=true` o chart executa quatro coisas:

1. **OpenCost** (embutido) — observa o cluster, descobre os preços de tabela da nuvem e calcula alocações de custo pré-precificadas por workload.
2. **Um Prometheus mínimo** (embutido) — o OpenCost requer um endpoint PromQL para o histórico de uso/preços. Este existe apenas para isso: réplica única, retenção de 3 dias e exatamente dois alvos de coleta (o cAdvisor via o proxy de nó do API-server, e o próprio OpenCost — o OpenCost emite suas próprias métricas de requests de recursos no estilo KSM, então o kube-state-metrics não está envolvido). Ele nunca é exposto fora do cluster e seus dados nunca saem dele.
3. **O poller de alocação de custos** (`cost.agent`) — consulta a Allocation API do OpenCost uma vez por janela horária fechada e envia via POST linhas de custo por workload (cpu / ram / gpu / pv / rede / load balancer / ocioso, mais eficiência) para o OneUptime. As janelas são enviadas exatamente uma vez — o servidor ignora janelas que já ingeriu, então reinicializações não podem contabilizar o gasto em dobro.
4. **Uma coleta de métricas de custo** (`cost.metrics`) — o coletor OpenTelemetry do agente coleta as métricas Prometheus do OpenCost (com allowlist restrita às séries de custo) pelo mesmo pipeline OTLP que o restante das métricas do seu cluster.

## Já Executa Kubecost ou OpenCost?

Aponte o chart para o seu motor existente — nesse caso, nada é embutido:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set cost.enabled=true \
  --set cost.engine.url=http://kubecost-cost-analyzer.kubecost.svc.cluster.local:9090
```

| Motor    | URL de serviço típica                                            |
| -------- | ---------------------------------------------------------------- |
| OpenCost | `http://opencost.opencost.svc.cluster.local:9003`                |
| Kubecost | `http://kubecost-cost-analyzer.kubecost.svc.cluster.local:9090`  |

O caminho da Allocation API é detectado automaticamente (`/model/allocation` para o Kubecost, `/allocation/compute` ou `/allocation` para o OpenCost). Defina `cost.engine.allocationPath` apenas para instalações fora do padrão.

## Precificação On-Prem / Bare-Metal

Clusters cujos nós não têm preço de tabela público de nuvem podem definir uma tabela de preços — o OpenCost então precifica cada recurso a partir desses valores. Todos os valores são em **USD por recurso-hora**:

```yaml
cost:
  enabled: true
  opencost:
    customPricing:
      enabled: true
      cpuPerCoreHour: "0.031611"       # ~$23 per core-month
      ramPerGiBHour: "0.004237"        # ~$3 per GiB-month
      storagePerGBHour: "0.00005479452" # ~$0.04 per GB-month
      gpuPerHour: "0.95"
```

## Controles Úteis

Todos opcionais — consulte o `values.yaml` do chart para a lista completa:

```yaml
cost:
  agent:
    windowSeconds: 3600   # allocation window length (hourly = native)
    includeIdle: true     # ship the engine's __idle__ allocation
    currency: USD         # currency code shown in the UI (informational)
  prometheus:
    retention: 3d         # bundled TSDB history — a few days is plenty
    persistence:
      enabled: false      # set true for a small PVC; emptyDir otherwise
  metrics:
    enabled: true         # cost metrics for dashboards / Metric Explorer
    scrapeInterval: 60s
```

## Alertando sobre Custos

As métricas de custo coletadas são métricas comuns do OneUptime, então você pode colocar alertas de métrica sobre elas como sobre qualquer outra — por exemplo, alertar quando a média de `node_total_hourly_cost` subir acima de um limite de orçamento, ou quando `pv_hourly_cost` aparecer para uma classe de volume que não deveria existir em um cluster.

## Modelo de Dados e Retenção

As linhas de alocação são armazenadas no ClickHouse (uma linha por cluster, janela, namespace, controller, pod e contêiner) e seguem a retenção de telemetria do cluster: a configuração `retainTelemetryDataForDays` no recurso de cluster Kubernetes, com fallback para a retenção de dados do projeto. A capacidade ociosa e a não alocada são armazenadas como linhas comuns sob os namespaces `__idle__` / `__unallocated__`, de modo que podem ser consultadas com os mesmos agrupamentos que o gasto de workloads.

## Solução de Problemas

- **As páginas de Custos estão vazias** — verifique os logs do agente de custos: `kubectl logs -n <agent namespace> deploy/<release>-kubernetes-agent-cost`. Um `401` significa que a chave de ingestão é inválida; `cost engine did not answer any known allocation path` significa que o motor ainda não está no ar (o OpenCost embutido precisa de alguns minutos após a instalação para precificar suas primeiras janelas) ou que `cost.engine.url` está errado.
- **O OpenCost embutido não está pronto** — `kubectl logs -n <agent namespace> deploy/<release>-kubernetes-agent-opencost`. Ele registra qual provedor de nuvem detectou e se os dados de precificação foram carregados.
- **O template de dashboard não mostra dados** — o template lê as métricas de custo coletadas; confirme que `cost.metrics.enabled` está em `true`.
- **Os números diferem da interface do próprio motor** — o OneUptime inclui os ajustes de reconciliação do motor em cada componente de custo e envia janelas fechadas inteiras; o gasto parcial da hora atual aparece depois que a janela fecha.
- **O pod do Prometheus reiniciou** — com o armazenamento `emptyDir` padrão, uma reinicialização perde algumas horas de histórico de uso, então as alocações dessas janelas podem ser menores. Defina `cost.prometheus.persistence.enabled=true` se isso for importante para você.
