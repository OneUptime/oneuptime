# Agente Kubernetes do OneUptime (Helm)

## Visão Geral

O Agente Kubernetes do OneUptime é um chart Helm pré-empacotado que instala um pipeline de coletor baseado em OpenTelemetry no seu cluster. Ele envia métricas de nó, pod, contêiner e cluster; eventos do Kubernetes; logs de pods; e — com eBPF ativado por padrão — traces de aplicação, métricas HTTP RED, dados de grafo de serviços e métricas de fluxo de rede pod-a-pod. Sem alterações de código, sem SDKs, um único `helm install`.

Esta página é o **guia de instalação**. Para configurar monitores e alertas do Kubernetes sobre os dados que o agente coleta, consulte [Agente Kubernetes (monitores)](/docs/monitor/kubernetes-agent).

## Pré-requisitos

- Um cluster Kubernetes em execução (v1.23+)
- `kubectl` configurado para acessar seu cluster
- `helm` v3 instalado
- Uma **chave de API do OneUptime** — crie uma em _Project Settings → API Keys_

## Passo 1 — Adicione o Repositório Helm do OneUptime

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm repo update
```

## Passo 2 — Escolha um Preset para o Seu Cluster

O chart expõe uma única opção de nível superior — `preset` — que escolhe padrões compatíveis para a sua distribuição do Kubernetes. Ela controla aspectos que você precisaria ajustar manualmente de outra forma: se os logs devem ser enviados por meio de um DaemonSet com hostPath ou pela API do Kubernetes, e qual contexto de segurança aplicar.

| `preset`              | Use para                                                                                 | Coleta de logs                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `standard` _(padrão)_ | Clusters autogerenciados, **EKS no EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | DaemonSet lendo `/var/log/pods` via hostPath (menor sobrecarga)                        |
| `gke-autopilot`       | **GKE Autopilot**                                                                        | Deployment de coletor de logs via API do Kubernetes (sem hostPath, sem acesso ao host) |
| `eks-fargate`         | **EKS Fargate**                                                                          | Deployment de coletor de logs via API do Kubernetes (sem hostPath, sem acesso ao host) |

Se você não tiver certeza, comece com `standard`. Se a instalação falhar com um erro de Pod Security mencionando `hostPath`, execute novamente com `preset=gke-autopilot` (ou `eks-fargate` no Fargate) e funcionará.

## Passo 3 — Instale o Agente Kubernetes

Substitua `YOUR_ONEUPTIME_URL`, `YOUR_ONEUPTIME_API_KEY` e o nome do cluster pelos valores do seu ambiente. O nome do cluster é como o cluster aparecerá no OneUptime — escolha algo estável como `prod-us-east-1`.

### Clusters padrão (autogerenciados, EKS no EC2, GKE Standard, AKS)

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster"
```

### GKE Autopilot

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set preset=gke-autopilot
```

### EKS Fargate

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set preset=eks-fargate
```

## Passo 4 — Verifique a Instalação

Verifique se os pods do agente estão em execução:

```bash
kubectl get pods -n oneuptime-agent
```

Em um cluster **standard**, você verá um Deployment do coletor de cluster mais um pod do DaemonSet do coletor de nós por nó:

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-xxxxx                   1/1     Running   0          1m
kubernetes-agent-logs-yyyyy                   1/1     Running   0          1m
```

No **GKE Autopilot**, o coletor de nós continua em execução — ele coleta métricas do kubelet e do cAdvisor sem precisar de hostPath — e um Deployment adicional lê os logs de pods pela API do Kubernetes:

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-yyyyyyyyyy-yyyyy        1/1     Running   0          1m
kubernetes-agent-logs-xxxxx                   1/1     Running   0          1m
```

No **EKS Fargate**, você verá dois Deployments e nenhum DaemonSet — o Fargate dá a cada pod sua própria micro-VM e nunca agenda DaemonSets, portanto métricas em nível de nó não estão disponíveis lá:

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-yyyyyyyyyy-yyyyy        1/1     Running   0          1m
```

Assim que o agente se conectar, seu cluster aparecerá automaticamente na seção **Kubernetes** do dashboard do OneUptime.

## Opções de Configuração

### Filtragem de Namespace

`namespaceFilters.rules` aplica padrões de namespace de forma independente a quatro escopos:

- `podLogs`: filtra stdout/stderr dos pods no receptor filelog hostPath ou no coletor de logs pela API; eventos do Kubernetes e logs de auditoria não são afetados.
- `ebpfDiscovery`: filtra a descoberta de processos do OBI e, portanto, tanto traces quanto métricas eBPF.
- `metrics`: filtra séries de métricas com namespace após o enriquecimento de metadados; séries de nó e cluster sem namespace são preservadas.
- `traces`: filtra spans eBPF e spans OTLP enviados pelas aplicações após o enriquecimento de metadados.

Os padrões correspondem ao nome completo do namespace e aceitam * como curinga, por exemplo team-*. Se um escopo tiver qualquer regra include, somente namespaces correspondentes serão mantidos nesse escopo. Regras exclude sempre prevalecem. A regra padrão exclui kube-system apenas de podLogs e ebpfDiscovery.

Para limitar logs de pods e a descoberta eBPF a namespaces específicos:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set-json 'namespaceFilters.rules=[{"action":"include","namespaces":["default","production","staging"],"scopes":["podLogs","ebpfDiscovery"]}]'
```

Para interromper os logs de um namespace ruidoso e manter seus traces eBPF, mapa de serviços e métricas, limite a exclusão a podLogs:

```bash
  --set-json 'namespaceFilters.rules=[{"action":"exclude","namespaces":["kube-system"],"scopes":["podLogs","ebpfDiscovery"]},{"action":"exclude","namespaces":["noisy-*"],"scopes":["podLogs"]}]'
```

As regras podLogs e ebpfDiscovery filtram na origem: arquivos de log excluídos nunca são abertos e workloads excluídos nunca são instrumentados. As regras metrics e traces são executadas depois no collector, após a inclusão dos metadados de namespace.

#### Filtrar métricas e traces por namespace

Adicione esses escopos diretamente à regra quando também quiser filtrar métricas ou spans associados a namespaces:

```bash
  --set-json 'namespaceFilters.rules=[{"action":"exclude","namespaces":["kube-system","noisy-*"],"scopes":["podLogs","ebpfDiscovery","metrics","traces"]}]'
```

> **Métricas em nível de nó e cluster sempre são mantidas. Um namespace pertence a um pod, não a um nó; portanto, séries sem namespace não correspondem à regra e não são removidas.**

Eventos do Kubernetes não podem ser filtrados por namespace no agente. Eles chegam do receptor k8sobjects sem o atributo k8s.namespace.name; o namespace está no corpo do evento. Filtre-os no servidor.

### Filtragem por Severidade de Log

O `filters.logs.minSeverity` descarta registros de **log de pods** abaixo de uma severidade, no agente, antes que qualquer coisa seja enviada:

```bash
  --set filters.logs.minSeverity=WARN
```

Aceita `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL`. O `WARN` mantém WARN, ERROR e FATAL e descarta INFO, DEBUG e TRACE. O padrão (`""`) mantém tudo. Aplica-se em **ambos** os modos de log — no modo `daemonset` por meio do coletor, no modo `api` dentro do próprio coletor de logs — de modo que os presets não podem desativá-lo sem você perceber.

Os runtimes de contêiner não registram uma severidade na linha de log, então o próprio agente extrai uma do texto do log (`[ERROR]`, `WARN:`, `level=info`, …).

> **Os eventos do Kubernetes e as especificações de recursos nunca são filtrados por isso.** Eles chegam da API do Kubernetes sem severidade própria, então um limiar apagaria o feed inteiro em vez de afiná-lo — incluindo os avisos `FailedScheduling`, `BackOff` e `OOMKilling` que você mais quer. Eles são de baixo volume e alto valor, então o agente sempre os envia. Para reduzi-los, use os **Logs → Settings → Drop Filters** do lado do servidor no dashboard.

**O que acontece com uma linha sem nível reconhecível depende do modo de log**, porque os dois modos têm informações diferentes disponíveis:

| Modo        | Linha sem rótulo                                                                                      | Por quê                                                                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `daemonset` | `stderr` → tratada como ERROR (mantida), `stdout` → tratada como INFO (descartada por um limiar WARN) | O runtime de contêiner registra de qual fluxo cada linha veio.                                                                                 |
| `api`       | Sempre **mantida**                                                                                    | A API `pods/log` do Kubernetes mescla stdout e stderr em um único fluxo, sem marcador por linha. Em vez de adivinhar, o agente mantém a linha. |

> Portanto, o modo `api` descarta estritamente menos que o modo `daemonset`. Isso é intencional: um traceback de Python ou um `npm ERR!` não carrega nenhuma palavra-chave de severidade, e apagá-lo silenciosamente é exatamente a falha da qual um limiar de severidade deveria proteger você.

Eventos de múltiplas linhas são recombinados **antes** da filtragem em ambos os modos, então um stack trace de Java é julgado pela sua primeira linha e mantido ou descartado por inteiro — você nunca vai receber uma linha `ERROR` isolada com seus frames removidos.

### Incluindo ou Excluindo Métricas por Nome

O `filters.metrics` controla quais métricas saem do cluster, em todos os receptores do pipeline.

**Descarte algumas métricas ruidosas** (uma denylist — geralmente o que você quer):

```bash
  --set-json 'filters.metrics.exclude=["k8s.volume.available","k8s.volume.capacity"]'
```

**Envie apenas um conjunto fixo** (uma allowlist — todo o resto é descartado):

```bash
  --set-json 'filters.metrics.include=["k8s.pod.cpu.utilization","k8s.pod.memory.usage"]'
```

**Corresponda por padrão** em vez de por nome exato:

```bash
  --set filters.metrics.matchType=regexp \
  --set-json 'filters.metrics.exclude=["^container_network_"]'
```

| Chave                       | Significado                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| `filters.metrics.exclude`   | Nomes de métricas a descartar. Aplicado por cima do `include`, então o exclude sempre vence. |
| `filters.metrics.include`   | Quando não vazio, **apenas** estas são enviadas.                                             |
| `filters.metrics.matchType` | `strict` (nome exato, o padrão) ou `regexp` (RE2, **sem âncora**).                           |

Observações que vão lhe poupar um incidente:

- O `regexp` é **sem âncora** — `system.cpu` também corresponde a `system.cpu.time`. Ancore-o (`^system\.cpu$`) quando você quiser dizer exatamente uma métrica.
- O RE2 **não tem lookahead**, então `^(?!container_)` não vai compilar. Expresse "tudo exceto" com o `include`, não com uma regex negativa.
- O `include` abrange todos os receptores de uma vez. Uma allowlist que esquece uma métrica remove silenciosamente os monitores construídos sobre ela. Prefira o `exclude`, a menos que você realmente queira um conjunto fechado.
- Use `--set-json` (ou um arquivo de values) para listas. O `--set` simples substitui uma lista em vez de mesclá-la.

> **Teste uma regex antes de colocá-la em produção.** Os padrões são compilados pelo coletor na inicialização, não a cada registro, então um padrão inválido não se comporta mal silenciosamente — o coletor se recusa a iniciar e entra em CrashLoopBackOff, derrubando os **logs** daquele coletor junto com suas métricas. O Helm não consegue compilar RE2, então o `helm upgrade` aceita um padrão ruim sem reclamar.

### Amostragem de Traces

Os filtros acima removem uma **categoria** de telemetria — um namespace, uma severidade, um nome de métrica. A amostragem é diferente: ela mantém todas as categorias e, em vez disso, afina a população. Defina o `sampling.traces.percentage` com a parcela de traces que você quer manter:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set sampling.traces.percentage=10
```

Isso mantém um trace a cada dez e descarta os outros nove no agente, antes que eles saiam do seu cluster.

**Você recebe traces inteiros, não fragmentos.** A decisão é um hash do ID do trace, e não um cara ou coroa por span, então todos os spans de um trace são mantidos ou descartados juntos — os traces que sobrevivem são completos e legíveis de ponta a ponta. É essa propriedade que torna a amostragem segura de ativar.

**Seus monitores baseados em métricas não se mexem.** As métricas RED do eBPF — taxa de requisições, taxa de erros, duração — são uma família de *métricas*. O OBI as calcula a partir de cada requisição e elas percorrem o pipeline de métricas, no qual o amostrador não está. Com `percentage: 10` você recebe um décimo dos traces e taxa/erros/latência 100% precisos. Os dashboards e monitores construídos sobre essas métricas não são afetados.

**Seus monitores baseados em spans se mexem, sim.** Tudo o que o OneUptime deriva dos próprios spans diminui junto com a taxa — veja o aviso abaixo antes de ativar isto.

| Chave                        | Significado                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `sampling.traces.percentage` | Porcentagem de traces a **manter**, de 0 a 100. Padrão `100` (mantém tudo).    |
| `sampling.traces.hashSeed`   | Semente para o hash do ID do trace. Padrão `22`.                              |

Observações que vão lhe poupar um incidente:

- **O `0` não mantém trace nenhum.** É uma taxa, não uma chave de desligar — ele apaga todos os traces enquanto o DaemonSet do eBPF continua em execução e lhe custando dinheiro. Se você não quer traces, use `ebpf.enabled=false`. Se você não quer traces mas *quer* as métricas RED e o mapa de serviços, mantenha o eBPF ativado e defina isto como `0` deliberadamente.
- **Só se aplica quando `ebpf.enabled`.** O pipeline de traces não existe fora disso, então com `ebpf.enabled=false` este valor não faz nada.
- **Apenas traces.** Não existe `sampling.logs` nem `sampling.metrics`, e isso é proposital — veja a observação abaixo.
- **Frações precisam de `--set-json`, e elas têm um piso.** O `--set sampling.traces.percentage=0.5` falha, porque o Helm lê `0.5` como uma string. Use `--set-json 'sampling.traces.percentage=0.5'` ou um arquivo de values. Números inteiros funcionam bem com `--set`. Abaixo de cerca de `0.0061` a taxa é quantizada para zero e se comporta exatamente como `0` — todos os traces descartados, sem erro. O `0.01` (um em dez mil) é o menor valor que faz o que promete.
- **Multi-cluster funciona por padrão.** Dois agentes mantêm o mesmo trace apenas se concordarem tanto no `hashSeed` quanto no `percentage`. Ambos têm o mesmo padrão em todo lugar, então um trace que cruza dois clusters sobrevive inteiro sem nenhuma configuração extra. Altere o `hashSeed` apenas para *descorrelacionar* deliberadamente dois níveis de amostragem — como a decisão é um limiar sobre o mesmo hash, a mesma semente em taxas diferentes se aninha, então um segundo nível apenas volta a escolher os traces que o primeiro já havia mantido, em vez de sortear de forma independente.
- **Os logs de pods nunca são amostrados**, então com `ebpf.logToTraceCorrelation: true` todo registro de log continua carregando um ID de trace, enquanto apenas `percentage`% desses traces são mantidos. Aproximadamente (100 − `percentage`)% dos registros de log vão exibir um link de trace que não leva a lugar nenhum. A navegação trace → logs não é afetada; apenas a de logs → trace pode falhar.

> **Reajuste seus monitores baseados em spans ao definir isto.** A amostragem reduz os spans que chegam ao OneUptime, então tudo o que os conta passa a contar menos: um monitor **Traces** com o critério `Span Count` e um monitor **Exceptions** com o critério `Exception Count` verão aproximadamente `percentage`% do volume de ontem. Um limiar ajustado sobre tráfego não amostrado silenciosamente deixa de ser cruzado — o monitor não dá erro, ele apenas fica em silêncio. Divida esses limiares pelo mesmo fator ao definir a taxa; a taxa vale para todo o cluster, então não há como isentar um serviço individual dela. O **agrupamento** de erros se degrada de forma pior que linear: uma exceção comum ainda aparece, mas uma rara e isolada tem mais chance de sumir por completo do que de aparecer um décimo das vezes.

> **Por que não há amostragem de logs ou de métricas aqui.** O amostrador do coletor não consegue amostrar métricas de jeito nenhum. Ele consegue amostrar logs, mas tira sua aleatoriedade do ID do trace — e os logs de pods não têm um. Todo registro sem ID de trace então vai para o mesmo bucket no hash, de modo que uma taxa para logs não afinaria o feed: ela manteria tudo ou apagaria tudo, dependendo da semente. Em vez de entregar um botão que apaga os seus logs silenciosamente, o chart não oferece nenhum. Afine os logs com a [Filtragem por Severidade de Log](#filtragem-por-severidade-de-log) e a [Filtragem de Namespace](#filtragem-de-namespace), que são precisas sobre o que removem.

### Desabilitar a Coleta de Logs

Se você não precisar de logs de pods:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set logs.enabled=false
```

Suas métricas não são afetadas: o coletor de nós continua em execução para as métricas do kubelet, do cAdvisor e do host, ele apenas deixa de ler os logs de pods. Os alertas baseados em logs param, e nada mais.

### Forçar um Modo Específico de Coleta de Logs

Usuários avançados podem sobrescrever a escolha do preset com `logs.mode`:

- `logs.mode=daemonset` — DaemonSet com hostPath (menor sobrecarga, requer hostPath)
- `logs.mode=api` — Deployment de coletor de logs via API do Kubernetes (funciona em qualquer cluster)
- `logs.mode=disabled` — sem coleta de logs

> O modo de logs decide apenas de onde vêm os **logs de pods**. As métricas de nó são coletadas independentemente dele, então `api` e `disabled` mantêm suas métricas do kubelet, do cAdvisor e do host.
>
> A única exceção é a plataforma, não o modo: **o EKS Fargate não consegue agendar DaemonSets de forma alguma**, portanto não há coletor de nós ali e as métricas por nó/pod/contêiner ficam indisponíveis. O GKE Autopilot executa o coletor de nós normalmente, mas bloqueia `hostPath`, então coleta métricas do kubelet e do cAdvisor sem as do `hostmetrics` (E/S de disco, inodes, erros de NIC), que precisam ler o `/proc` e o `/sys` do host.

O `logs.mode` explícito sempre prevalece sobre o padrão do preset. Use isso se você conhecer seu cluster melhor do que o preset.

### Habilitar Monitoramento do Plano de Controle

Para clusters autogerenciados (não EKS / GKE / AKS), você pode habilitar métricas do plano de controle:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set controlPlane.enabled=true
```

> Serviços gerenciados do Kubernetes (EKS, GKE, AKS) normalmente não expõem métricas do plano de controle. Habilite isso apenas para clusters autogerenciados.

### Marcação automática com labels de projeto

Qualquer atributo de recurso prefixado com `oneuptime.label.` é promovido a um Label de projeto e anexado ao cluster, serviços e hosts emitidos por este agente. Padrão: `oneuptime.label.<dimension>=<value>` torna-se um label chamado `<dimension>:<value>`.

Passe labels no momento da instalação com `--set oneuptime.labels.<key>=<value>`:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="prod" \
  --set oneuptime.labels.team=payments \
  --set oneuptime.labels.env=production \
  --set oneuptime.labels.region=us-east-1
```

Ou mantenha-os em um arquivo de values:

```yaml
# values.yaml
oneuptime:
  url: YOUR_ONEUPTIME_URL
  apiKey: YOUR_ONEUPTIME_API_KEY
  labels:
    team: payments
    env: production
    region: us-east-1
clusterName: prod
```

Os labels são correspondidos sem diferenciar maiúsculas de minúsculas, então um label `Production` existente criado manualmente é reutilizado em vez de duplicado. Labels adicionados manualmente na interface do OneUptime nunca são removidos pelo agente.

## Atualizando o Agente

```bash
helm repo update
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values
```

`--reuse-values` mantém sua configuração existente (preset, nome do cluster, filtros); passe quaisquer novas sobrescritas `--set` por cima dela.

## Desinstalando o Agente

```bash
helm uninstall kubernetes-agent --namespace oneuptime-agent
kubectl delete namespace oneuptime-agent
```

## O Que é Coletado

| Categoria                                                | Dados                                                                                                                                          |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Métricas de Nó**                                       | Utilização de CPU, uso de memória, uso de sistema de arquivos, E/S de rede                                                                     |
| **Métricas de Pod**                                      | Uso de CPU, uso de memória, E/S de rede, reinicializações                                                                                      |
| **Métricas de Contêiner**                                | Uso de CPU, uso de memória por contêiner                                                                                                       |
| **Métricas de Cluster**                                  | Condições dos nós, recursos alocáveis, contagens de pods                                                                                       |
| **Eventos do Kubernetes**                                | Avisos, erros, eventos de agendamento                                                                                                          |
| **Logs de Pods**                                         | Logs de stdout/stderr de todos os contêineres (via DaemonSet com hostPath em clusters padrão, ou via API do Kubernetes no Autopilot / Fargate) |
| **Traces de Aplicação** _(via eBPF, ativado por padrão)_ | Spans de HTTP, gRPC, SQL/Redis de cada pod — sem SDK nem alterações de código                                                                  |
| **Métricas HTTP RED** _(via eBPF)_                       | `http.server.request.duration`, tamanhos de corpo de requisição e resposta, por serviço                                                        |
| **Grafo de Serviços** _(via eBPF)_                       | Taxa de requisições, latência e arestas de erro de chamador → chamado — alimenta a visão de mapa de serviços                                   |
| **Métricas de Fluxo de Rede** _(via eBPF)_               | Contadores de bytes e pacotes TCP/UDP pod-a-pod com metadados do k8s                                                                           |
| **Estatísticas de TCP** _(via eBPF)_                     | Contadores de RTT, conexões falhas e retransmissões em nível de nó                                                                             |

## Traces de Aplicação e Métricas HTTP via eBPF (ativado por padrão)

O chart executa um DaemonSet com [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) em cada nó. Ele carrega programas eBPF no kernel e captura automaticamente tráfego HTTP/HTTPS, gRPC e SQL/Redis de cada runtime suportado (Go, .NET, Java, Node.js, Python, Ruby, Rust) — sem SDK e sem sidecar. Os traces e as métricas de requisição então fluem pelo coletor dentro do cluster até o OneUptime.

**Requisitos:** Kernel Linux **5.8+** com BTF (padrão no Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL/Stream 9+). O DaemonSet do eBPF é executado em **modo privilegiado** porque precisa, para carregar programas eBPF.

### Desabilitar a autoinstrumentação por eBPF

Você deve desabilitá-la quando:

- Instalar no **GKE Autopilot** ou **EKS Fargate** — essas plataformas bloqueiam pods privilegiados (use `preset=gke-autopilot` / `preset=eks-fargate` e combine com `ebpf.enabled=false`).
- Os nós executam um kernel anterior ao 5.8 sem backports de BTF.
- Você já envia traces via SDKs do OpenTelemetry a partir dos seus aplicativos e não quer duplicatas.

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set ebpf.enabled=false
```

### Alternar famílias individuais de sinais

Todas ativadas por padrão. Desative qualquer uma com `--set ebpf.features.<name>=false`:

| `ebpf.features.*`         | Padrão     | O que adiciona                                                            |
| ------------------------- | ---------- | ------------------------------------------------------------------------- |
| `httpMetrics`             | ativado    | Métricas HTTP/gRPC RED (taxa de requisições, latência, erros) por serviço |
| `spanMetrics`             | ativado    | Tamanho de requisição/resposta e duração por span                         |
| `serviceGraph`            | ativado    | Métricas de aresta chamador → chamado; alimenta o mapa de serviços        |
| `hostMetrics`             | ativado    | CPU e memória por processo instrumentado                                  |
| `networkMetrics`          | ativado    | Contadores de fluxo TCP/UDP pod-a-pod                                     |
| `networkInterZoneMetrics` | desativado | Variante entre zonas das métricas de rede (dobra a cardinalidade)         |
| `tcpStats`                | ativado    | Contadores de RTT TCP, conexões falhas e retransmissões em nível de nó    |

A propagação de contexto de trace entre serviços também está ativada por padrão — o OBI injeta o `traceparent` W3C no tráfego HTTP/TCP de saída, de modo que uma requisição cruzando do pod A → pod B aparece como um único trace, sem alterações de SDK em lugar algum. Desative com `--set ebpf.contextPropagation=false`.

## Reduzindo o Volume de Dados Coletados

De fábrica, o agente é ajustado para **cobertura** — ele envia métricas, logs de pods e traces eBPF de todo o cluster para que cada dashboard e monitor funcione desde o primeiro dia. Em clusters grandes ou movimentados, isso pode ser mais telemetria do que você precisa, o que se manifesta como um volume de ingestão maior (e, no OneUptime Cloud, um custo maior). Nada aqui é obrigatório, mas se um cluster estiver enviando mais do que você deseja, estes são os botões a ajustar — aproximadamente em ordem de impacto.

O truque é **parar de coletar o que você não vai olhar**, em vez de coletar tudo e pagar para armazenar. Cada alavanca abaixo é um valor do Helm, então você pode aplicá-la com `--set` em `helm upgrade --reuse-values` e revertê-la da mesma forma.

### De onde vem o volume

| Sinal                              | Maior fator                                                           | Reduza com                                                                                   |
| ---------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Logs de pods**                   | Cada linha de cada contêiner, em todo o cluster                       | `namespaceFilters`, `filters.logs.minSeverity`, `logs.enabled`, `logs.mode`                  |
| **Traces eBPF e métricas de span** | Um trace por requisição de cada processo instrumentado                | `sampling.traces.percentage`, `ebpf.enabled`, `ebpf.features.*`, `ebpf.autoTargetExe`, `ebpf.excludeExePaths` |
| **Pontos de dados de métricas**    | Frequência de coleta × número de pods/contêineres                     | `collectionInterval`, `hostMetrics.collectionInterval`, `cadvisor.scrapeInterval`            |
| **Cardinalidade de métricas**      | Número de séries distintas (por contêiner, por PVC, …)                | `filters.metrics.exclude`, `namespaceFilters.rules` (`metrics`), `cadvisor.metricsAllowlist`, `kubeletstats.volumeMetrics` |
| **Extras opcionais**               | Profiling, logs de auditoria, plano de controle, métricas entre zonas | Deixe-os desativados (eles já estão por padrão)                                              |

Há três maneiras de cortar volume, e vale a pena saber qual delas você está usando:

- **No receptor** — os dados nunca chegam a ser coletados. O `namespaceFilters` nos logs de pods, o `cadvisor.metricsAllowlist`, um `collectionInterval` maior. Não custa nada para executar e economiza CPU, egresso e ingestão de uma só vez. Prefira sempre estas opções onde elas cobrirem o seu caso.
- **No processador de filtro** — os dados são coletados e então descartados antes da exportação. O `filters.logs.minSeverity`, o `filters.metrics.*`, o `namespaceFilters.rules` (`metrics`/`traces`). Um pouco mais de CPU do coletor, mas funciona entre receptores e consegue expressar coisas que um receptor não consegue.
- **No amostrador** — os dados são coletados e então uma fração representativa é mantida. O `sampling.traces.percentage`. É o diferente do grupo: os dois acima removem uma *categoria* inteira de telemetria, então o que eles descartam some de todos os traces. A amostragem mantém todas as categorias e afina a população, então o que sobrevive continua completo e representativo.

As três são **irreversíveis**: o que você descarta aqui nunca chega ao OneUptime, e as três podem fazer um monitor ficar em silêncio. As duas primeiras silenciam um monitor removendo o sinal que ele observa. A amostragem é mais restrita: as métricas RED do eBPF são calculadas antes de o amostrador rodar, então os monitores baseados em métricas permanecem exatos — mas os monitores que contam *spans* (Traces com `Span Count`, Exceptions com `Exception Count`) veem proporcionalmente menos e precisam ter seus limiares reajustados pelo mesmo fator. Se você preferir decidir depois, o OneUptime pode descartar os dados no lado do servidor (**Logs → Settings → Drop Filters**, **Metrics → Settings → Pipeline Rules**) — isso ainda custa egresso, mas é uma configuração que você pode alterar sem um novo deploy.

### Alavanca 1 — Logs de pods geralmente são a maior fonte isolada

Os logs de contêiner quase sempre são a maior fatia da ingestão, porque é um registro por linha de log de cada contêiner do cluster.

- **Quer apenas logs de determinados namespaces? Use uma regra include com o escopo podLogs. A correspondência ocorre na origem do log, portanto namespaces filtrados nunca são lidos e a telemetria eBPF permanece independente.**

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set-json 'namespaceFilters.rules=[{"action":"include","namespaces":["default","production"],"scopes":["podLogs"]}]'
  ```

  Para manter todos os namespaces exceto uma família ruidosa, use uma regra exclude com namespaces: [noisy-*] e scopes: [podLogs].

- **Só se importa com avisos e erros?** O `filters.logs.minSeverity` descarta o resto no agente. Em um cluster tagarela, essa costuma ser a maior redução isolada disponível, porque INFO e DEBUG são o grosso da saída da maioria das aplicações:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set filters.logs.minSeverity=WARN
  ```

  Consulte [Filtragem por Severidade de Log](#filtragem-por-severidade-de-log) para saber como a severidade é determinada e o que acontece com os logs que ela não consegue classificar.

- **Não precisa dos logs de pods no OneUptime de forma alguma?** Desative-os:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set logs.enabled=false
  ```

  > Isso interrompe apenas os logs de pods. As métricas de nó, pod e contêiner continuam fluindo, e os monitores construídos sobre elas (OOM kills, throttling de CPU, pouco espaço em PVC) continuam funcionando — o coletor de nós permanece, apenas deixa de ler `/var/log/pods`. O mesmo vale para `logs.mode: api` e `logs.mode: disabled`.

### Alavanca 2 — Reduza a autoinstrumentação por eBPF

O eBPF fornece traces, métricas RED, o mapa de serviços e métricas de fluxo de rede sem alterações de código — mas também é a segunda maior fonte de dados, porque emite um span por requisição e várias famílias de métricas por serviço. Você tem três níveis de controle:

- **Já envia traces a partir de SDKs do OTel, ou não quer traces automáticos?** Desative o eBPF por completo:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.enabled=false
  ```

- **Mantenha os traces, elimine as famílias de métricas pesadas.** A [tabela de famílias de sinais acima](#alternar-famílias-individuais-de-sinais) lista cada flag `ebpf.features.*`. As famílias de maior volume são as métricas de rede e de span — desativá-las mantém intactos os traces, as métricas HTTP RED e o mapa de serviços:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.features.networkMetrics=false \
    --set ebpf.features.tcpStats=false \
    --set ebpf.features.spanMetrics=false
  ```

  Deixe `ebpf.features.networkInterZoneMetrics` desativado (seu padrão) — ele dobra a cardinalidade do fluxo de rede.

- **Instrumente apenas os runtimes que lhe interessam.** Por padrão, o OBI se conecta a cada processo que reconhece (`ebpf.autoTargetExe: "*"`). Restrinja-o a runtimes específicos, ou adicione binários à lista de exclusão, para reduzir o número de "serviços" e traces que o agente produz:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.autoTargetExe='*/python,*/java'
  ```

  Consulte [Alternar famílias individuais de sinais](#alternar-famílias-individuais-de-sinais) e a observação sobre `excludeExePaths` nos values do chart para os padrões completos.

### Alavanca 3 — Aumente os intervalos de coleta

O volume de métricas é diretamente proporcional à frequência com que o agente faz a coleta. Dobrar um intervalo reduz aproximadamente pela metade o número de pontos de dados que aquela métrica produz, sem perda de cobertura — apenas uma resolução mais grosseira. Se você não precisa de granularidade de 30 segundos, 60s ou 120s é uma redução grande e segura:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set collectionInterval=60s \
  --set hostMetrics.collectionInterval=60s \
  --set cadvisor.scrapeInterval=60s
```

- `collectionInterval` (padrão `30s`) controla as métricas de nó / pod / contêiner (`kubeletstats`) e as métricas de estado do cluster (`k8s_cluster`) — o grosso do volume de métricas.
- `hostMetrics.collectionInterval` e `cadvisor.scrapeInterval` cobrem as métricas de SO por nó e os contadores de throttling / OOM.
- `resourceSpecs.interval` (padrão `300s`) controla com que frequência as especificações completas de recursos (labels, anotações, status) são obtidas — aumente-o se você não precisar que as mudanças de especificação sejam refletidas rapidamente.
- Se você habilitou algum dos coletores opcionais, eles também têm seus próprios controles: `kubeStateMetrics.scrapeInterval`, `serviceMesh.*.scrapeInterval`, `coreDns.scrapeInterval`, `csi.scrapeInterval`.

### Alavanca 4 — Mantenha a cardinalidade de métricas limitada

A cardinalidade (o número de séries temporais distintas) importa tanto quanto a frequência, porque cada série é armazenada e cobrada separadamente.

- **O cAdvisor tem uma allowlist de propósito.** O receptor do cAdvisor (ativado por padrão) pode emitir centenas de métricas; o chart encaminha apenas o punhado que alimenta os monitores (`cadvisor.metricsAllowlist`). Mantenha a lista enxuta — **cada entrada é mantida por contêiner, então uma métrica extra se multiplica pela contagem de contêineres do cluster.** O kube-state-metrics está desativado por padrão, mas se você o habilitar (`kubeStateMetrics.enabled=true`), o `kubeStateMetrics.metricsAllowlist` controla a cardinalidade da mesma forma.
- **Métricas de volume por PVC** (`kubeletstats.volumeMetrics.enabled`, ativado por padrão) emitem uma série por PVC por pod. Isso é adequado para a maioria dos clusters, mas pode ser considerável em cargas de trabalho stateful (Kafka, bancos de dados) com milhares de PVCs — desative-o nesses casos se você não monitora o espaço em disco dos PVCs:

  ```bash
  --set kubeletstats.volumeMetrics.enabled=false
  ```

- **Métricas de saturação** (`kubeletstats.utilizationMetrics.enabled`, ativado por padrão) adicionam 8 famílias derivadas de "% de request/limit". Elas são baratas (sem coleta extra), mas se você não usa os monitores de CPU/Memória-vs-limite, pode removê-las com `--set kubeletstats.utilizationMetrics.enabled=false`.

- **Descarte métricas específicas por nome.** As allowlists acima são por receptor; o `filters.metrics.exclude` abrange todos eles, então use-o para tudo o que os controles em nível de receptor não conseguem expressar:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set filters.metrics.matchType=regexp \
    --set-json 'filters.metrics.exclude=["^container_network_"]'
  ```

  Consulte [Incluindo ou Excluindo Métricas por Nome](#incluindo-ou-excluindo-métricas-por-nome) para correspondência exata versus regex e para a forma de allowlist.

- **Quer descartar as métricas de um namespace inteiro? Adicione uma regra exclude com o escopo metrics. Séries por pod e contêiner são filtradas, enquanto séries de nó e cluster sem namespace são preservadas.**

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set-json 'namespaceFilters.rules=[{"action":"exclude","namespaces":["noisy-*"],"scopes":["metrics"]}]'
  ```

### Alavanca 5 — Deixe desativados os recursos opcionais pesados

Estes estão **desativados por padrão** justamente porque adicionam carga — habilite um apenas quando você usar ativamente o que ele alimenta, e desative-o novamente se estava apenas experimentando:

| Valor                                                     | Adiciona                                                                                        |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `profiling.enabled`                                       | DaemonSet de profiling contínuo de CPU — mais pesado que os traces eBPF                         |
| `auditLogs.enabled`                                       | Cada requisição à API do Kubernetes como um registro de log (alto volume)                       |
| `controlPlane.enabled`                                    | Métricas de etcd / API-server / scheduler / controller-manager                                  |
| `kubeStateMetrics.enabled`                                | Métricas de CrashLoop / ImagePull / motivo de agendamento (adiciona um Deployment KSM + coleta) |
| `ebpf.features.networkInterZoneMetrics`                   | Dobra a cardinalidade das métricas de fluxo de rede                                             |
| `serviceMesh.enabled` / `csi.enabled` / `coreDns.enabled` | Jobs extras de coleta do Prometheus                                                             |

### Alavanca 6 — Faça amostragem dos traces em vez de descartá-los

Toda alavanca acima compra volume abrindo mão de algo: um namespace que você deixa de observar, uma severidade que você deixa de manter, uma família de métricas que você deixa de coletar. A amostragem é a exceção e, em um cluster movimentado, muitas vezes é o maior corte disponível pela menor perda:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set sampling.traces.percentage=10
```

Isso é um corte de 90% no volume de traces, por uma perda mais restrita que a de qualquer outra alavanca aqui:

- Os traces que você mantém são **inteiros** — a decisão faz o hash do ID do trace, então todos os spans de um trace o compartilham. Você recebe menos traces, não traces quebrados.
- Suas **métricas RED continuam exatas**. A taxa de requisições, a taxa de erros e a duração são calculadas pelo OBI a partir de cada requisição e percorrem o pipeline de métricas, no qual o amostrador não está. Cada dashboard e monitor construído sobre elas mostra o mesmo de antes.

O que você abre mão são, em sua maior parte, os traces de exemplo: quando um monitor dispara, você tem um décimo dos traces para abrir. Em um cluster que faz milhares de requisições idênticas por segundo isso costuma ser uma boa troca — o centésimo span idêntico de `/healthz` não lhe ensina nada que o primeiro já não tenha ensinado. Em um cluster tranquilo é uma troca ruim, porque você pode não ter nenhum exemplo da requisição rara que quebrou.

A exceção, e a única coisa a verificar antes de colocar isto em produção: os monitores que **contam spans** em vez de métricas — Traces com `Span Count`, Exceptions com `Exception Count` — veem proporcionalmente menos, então seus limiares precisam ser reajustados pelo mesmo fator. Consulte [Amostragem de Traces](#amostragem-de-traces).

Recorra a isto quando os traces eBPF forem uma fatia grande da sua ingestão mas você ainda quiser o mapa de serviços e as métricas RED intactos. Prefira a Alavanca 2 quando quiser parar de instrumentar algo por completo.

Consulte [Amostragem de Traces](#amostragem-de-traces) para o comportamento completo, incluindo por que o `0` é uma taxa e não uma chave de desligar e por que não há equivalente para logs ou métricas.

### Um ponto de partida enxuto

Se você quer uma pegada menor mas ainda quer que os monitores funcionem, este perfil mantém a **cobertura completa de métricas** e corta as duas coisas que realmente geram volume — linhas de log e spans de eBPF:

```yaml
# lean-values.yaml
oneuptime:
  url: YOUR_ONEUPTIME_URL
  apiKey: YOUR_ONEUPTIME_API_KEY
clusterName: my-cluster

# Reduz pela metade os pontos de dados de métricas. Resolução mais grosseira, mesma cobertura.
collectionInterval: 60s
hostMetrics:
  collectionInterval: 60s
cadvisor:
  scrapeInterval: 60s

# Mantenha os logs de pods, mas envie apenas os que valem um alerta.
# (As métricas não dependem disso — o coletor de nós roda de qualquer forma.)
logs:
  enabled: true
  mode: daemonset

filters:
  logs:
    minSeverity: WARN # descarta INFO / DEBUG / TRACE no agente

namespaceFilters:
  rules:
    - action: exclude
      namespaces: [kube-system]
      scopes: [podLogs, ebpfDiscovery]
    - action: exclude
      namespaces: [noisy-*]
      scopes: [podLogs]

ebpf:
  enabled: true
  features:
    networkMetrics: false # as famílias de eBPF mais pesadas
    tcpStats: false
    spanMetrics: false
```

```bash
helm upgrade --install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --create-namespace \
  -f lean-values.yaml
```

Reduza ainda mais se necessário: aumente minSeverity para ERROR, adicione metrics aos escopos de uma regra de namespace ou defina ebpf.enabled=false se você já envia traces por SDKs OTel.

> **Cuidado com o que você corta.** Alguns monitores dependem de sinais específicos: desabilitar `cadvisor` remove os monitores de OOM-kill e de throttling de CPU; desabilitar `kubeletstats.volumeMetrics` remove o monitor de pouco espaço em disco de PVC; desabilitar os logs remove os alertas baseados em logs; e o `sampling.traces.percentage` não remove um monitor, mas reduz proporcionalmente os baseados em spans (Traces com `Span Count`, Exceptions com `Exception Count`), então reajuste os limiares deles para acompanhar. Corte os sinais sobre os quais você não age, não aqueles que um monitor está observando.

### Meça o efeito

O uso de telemetria é agregado por dia, então acompanhe a tendência ao longo de um ou dois dias em **Project Settings → Usage History** para confirmar a queda — ela não se moverá no instante em que você aplicar uma mudança. Altere uma alavanca por vez para conseguir atribuir a diferença — logs desativados, depois intervalo aumentado, depois eBPF reduzido — em vez de baixar tudo de uma vez e perder um monitor do qual você realmente dependia.

## Solução de Problemas

> **Caminho mais rápido — execute o script de diagnóstico.** Ele inspeciona a saúde dos pods, decodifica e valida a chave de ingestão, verifica se o seu cluster consegue alcançar o OneUptime e pergunta ao OneUptime se o seu token é de fato aceito — e então imprime um único veredito de causa raiz:
>
> ```bash
> curl -fsSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/HelmChart/Public/kubernetes-agent/troubleshoot.sh \
>   | bash -s -- -n oneuptime-agent
> ```
>
> Ele apenas lê o estado do cluster e executa algumas sondagens; não altera nada. Para o teste de egresso mais preciso, instale primeiro com `--set debug.enabled=true` (isso adiciona um pequeno sidecar de ferramentas de rede aos pods do agente para que o script teste o caminho de egresso exato do coletor) e então execute novamente.

### A instalação falha com "hostPath volumes are not allowed" ou um erro de admissão do Pod Security

Seu cluster bloqueia `hostPath` — comum no **GKE Autopilot** e no **EKS Fargate**. Mude para o preset de modo API:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set preset=gke-autopilot   # or eks-fargate
```

### O agente mostra "Disconnected"

O status de conexão de um cluster é determinado puramente pela chegada de telemetria — se nenhum dado chegar, o cluster é marcado como desconectado após ~15 minutos. Portanto "disconnected" e "no metrics" quase sempre têm a **mesma** causa: a telemetria do agente não está sendo aceita.

A razão mais comum — especialmente após uma reinstalação — é uma **chave de ingestão errada ou revogada**. Isso é fácil de passar despercebido porque os endpoints de ingestão OTLP retornam deliberadamente HTTP `200` mesmo para um token inválido (para que um coletor mal configurado não cause uma tempestade de novas tentativas no servidor). O resultado: o coletor relata sucesso, seus logs não mostram erros, e os dados são descartados silenciosamente.

1. Verifique se os pods do agente estão em execução: `kubectl get pods -n oneuptime-agent`
2. Verifique os logs do coletor de métricas: `kubectl logs -n oneuptime-agent -l component=metrics-collector -c otel-collector` (a ausência de erros aqui **não** significa que os dados estão chegando — veja acima)
3. **Valide a chave de ingestão.** Pergunte diretamente ao OneUptime se o seu token é aceito (`200` = válido, `401` = desconhecido/revogado):

   ```bash
   curl -i -H "x-oneuptime-token: <YOUR_API_KEY>" https://oneuptime.com/otlp/v1/validate
   ```

   Se retornar `401`, a chave no seu release está errada ou foi revogada. Copie uma chave ativa em _Project Settings → Telemetry Ingestion Keys_ e reimplante:

   ```bash
   helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
     --namespace oneuptime-agent --reuse-values \
     --set oneuptime.apiKey=<LIVE_KEY>
   ```

4. Verifique se a sua URL do OneUptime está correta e se o seu cluster consegue alcançá-la pela rede.
5. Se você alterou `clusterName` na reinstalação, o agente aparece como um **novo** cluster — a entrada antiga permanece "Disconnected" (isso é esperado; está obsoleta).

### Nenhum log aparecendo (apenas no modo API)

1. Confirme que o pod do coletor de logs está Ready: `kubectl get pods -n oneuptime-agent -l component=log-collector`
2. Verifique seu `/healthz` — ele relata a contagem de streams ativos e o último erro de exportação
3. Verifique os logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent-logs`
4. Em clusters muito grandes, uma única réplica pode se tornar um gargalo — divida releases separadas com regras include de escopo podLogs em namespaceFilters.rules.

### Nenhuma métrica aparecendo

1. Primeiro descarte uma chave de ingestão rejeitada — é a causa mais comum e é invisível do lado do agente. Veja [O agente mostra "Disconnected"](#o-agente-mostra-disconnected) acima (ou simplesmente execute o script de diagnóstico).
2. Verifique se o identificador do cluster corresponde ao valor que você passou como `clusterName`
3. Verifique as permissões de RBAC: `kubectl get clusterrolebinding | grep kubernetes-agent`
4. Verifique os logs do coletor OTel em busca de erros de exportação

### Os pods de eBPF estão em CrashLoopBackOff ou falham ao iniciar

```bash
kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200
```

Causas comuns:

- **Kernel muito antigo ou BTF ausente.** O OBI precisa de Linux 5.8+ com BTF. Execute `uname -r` em um nó. Se não puder atualizar, desabilite o eBPF: `--set ebpf.enabled=false`.
- **Pods privilegiados bloqueados.** Alguns clusters rejeitam pods privilegiados (GKE Autopilot, EKS Fargate e ambientes restritos). Desabilite o eBPF.
- **`debugfs` / `tracefs` não montados no host.** O recurso `tcpStats` se conecta a tracepoints do kernel que precisam deles. O chart monta ambos via `hostPath` — mas se o seu host não os expuser, desabilite apenas essa família: `--set ebpf.features.tcpStats=false`.

### Nenhum trace de aplicação aparecendo

1. Confirme que o DaemonSet do eBPF está saudável: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`
2. Ative o impressor de traces de depuração para confirmar que o OBI está capturando tráfego: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, depois verifique `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`
3. Se você vir spans no stdout do OBI, mas não no dashboard, o problema é a exportação do coletor → OneUptime — verifique os logs do pod do coletor de métricas.

## Próximos passos

- Configure **Monitores do Kubernetes** sobre as métricas que este agente coleta — consulte [Agente Kubernetes (monitores)](/docs/monitor/kubernetes-agent).
- Adicione **Monitores de Logs** para alertar sobre padrões específicos de log (por exemplo, contagens de erros acima de um limite por pod ou por namespace).
- Para hosts que não são Kubernetes (VMs Linux / macOS / Windows e bare metal), use a página [Coletor OpenTelemetry de Host](/docs/telemetry/host-otel-collector).
