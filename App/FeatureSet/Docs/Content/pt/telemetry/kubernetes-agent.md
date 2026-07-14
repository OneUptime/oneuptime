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

Em um cluster **standard**, você verá um Deployment do coletor de métricas mais um pod do DaemonSet do coletor de logs por nó:

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-xxxxx                   1/1     Running   0          1m
kubernetes-agent-logs-yyyyy                   1/1     Running   0          1m
```

No **GKE Autopilot** ou **EKS Fargate**, você verá dois Deployments em vez disso (sem DaemonSet):

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-yyyyyyyyyy-yyyyy        1/1     Running   0          1m
```

Assim que o agente se conectar, seu cluster aparecerá automaticamente na seção **Kubernetes** do dashboard do OneUptime.

## Opções de Configuração

### Filtragem de Namespace

O `namespaceFilters` limita os **logs de pods** (tanto o DaemonSet com hostPath quanto o coletor de logs via API) e os **traces eBPF** aos namespaces que você escolher. Por padrão, `kube-system` é excluído. Para restringir esses sinais a namespaces específicos:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set "namespaceFilters.include={default,production,staging}"
```

> Esses filtros **não** reduzem as **métricas** de nó / pod / contêiner — essas são coletadas por nó a partir do kubelet e são sempre coletadas em todo o cluster (séries em nível de nó e de cluster não têm namespace para filtrar). O `exclude` sempre prevalece sobre o `include`. Consulte [Reduzindo o Volume de Dados Coletados](#reducing-the-volume-of-data-collected) para o conjunto completo de controles de volume.

### Desabilitar a Coleta de Logs

Se você precisar apenas de métricas e eventos (sem logs de pods):

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set logs.enabled=false
```

### Forçar um Modo Específico de Coleta de Logs

Usuários avançados podem sobrescrever a escolha do preset com `logs.mode`:

- `logs.mode=daemonset` — DaemonSet com hostPath (menor sobrecarga, requer hostPath)
- `logs.mode=api` — Deployment de coletor de logs via API do Kubernetes (funciona em qualquer cluster)
- `logs.mode=disabled` — sem coleta de logs

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
| **Logs de pods**                   | Cada linha de cada contêiner, em todo o cluster                       | `logs.enabled`, `logs.mode`, `namespaceFilters`                                              |
| **Traces eBPF e métricas de span** | Um trace por requisição de cada processo instrumentado                | `ebpf.enabled`, `ebpf.features.*`, `ebpf.autoTargetExe`, `ebpf.excludeExePaths`              |
| **Pontos de dados de métricas**    | Frequência de coleta × número de pods/contêineres                     | `collectionInterval`, `hostMetrics.collectionInterval`, `cadvisor.scrapeInterval`            |
| **Cardinalidade de métricas**      | Número de séries distintas (por contêiner, por PVC, …)                | `cadvisor.metricsAllowlist`, `kubeletstats.volumeMetrics`, `kubeletstats.utilizationMetrics` |
| **Extras opcionais**               | Profiling, logs de auditoria, plano de controle, métricas entre zonas | Deixe-os desativados (eles já estão por padrão)                                              |

### Alavanca 1 — Logs de pods geralmente são a maior fonte isolada

Os logs de contêiner quase sempre são a maior fatia da ingestão, porque é um registro por linha de log de cada contêiner do cluster.

- **Não precisa de logs no OneUptime de forma alguma?** Desative-os completamente — você mantém todas as métricas, eventos e traces:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set logs.enabled=false
  ```

- **Quer apenas logs de determinados namespaces?** O `namespaceFilters.include` limita os logs de pods em ambos os modos de log (e os traces eBPF junto com eles). A correspondência acontece no caminho dos logs de pods, então os namespaces filtrados nunca chegam a ser lidos:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set "namespaceFilters.include={default,production}"
  ```

  (`kube-system` já é excluído por padrão.)

### Alavanca 2 — Reduza a autoinstrumentação por eBPF

O eBPF fornece traces, métricas RED, o mapa de serviços e métricas de fluxo de rede sem alterações de código — mas também é a segunda maior fonte de dados, porque emite um span por requisição e várias famílias de métricas por serviço. Você tem três níveis de controle:

- **Já envia traces a partir de SDKs do OTel, ou não quer traces automáticos?** Desative o eBPF por completo:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.enabled=false
  ```

- **Mantenha os traces, elimine as famílias de métricas pesadas.** A [tabela de famílias de sinais acima](#toggle-individual-signal-families) lista cada flag `ebpf.features.*`. As famílias de maior volume são as métricas de rede e de span — desativá-las mantém intactos os traces, as métricas HTTP RED e o mapa de serviços:

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

  Consulte [Alternar famílias individuais de sinais](#toggle-individual-signal-families) e a observação sobre `excludeExePaths` nos values do chart para os padrões completos.

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

### Um ponto de partida enxuto

Se você quer uma pegada mínima e vai readicionar sinais conforme precisar deles, este perfil de **apenas métricas + eventos** elimina logs e eBPF e reduz pela metade a taxa de coleta:

```yaml
# lean-values.yaml
oneuptime:
  url: YOUR_ONEUPTIME_URL
  apiKey: YOUR_ONEUPTIME_API_KEY
clusterName: my-cluster

collectionInterval: 60s

logs:
  enabled: false # no pod logs

ebpf:
  enabled: false # no auto-traces

hostMetrics:
  collectionInterval: 60s

cadvisor:
  scrapeInterval: 60s
```

```bash
helm upgrade --install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --create-namespace \
  -f lean-values.yaml
```

A partir daí, reative o que você precisar: `logs.enabled=true` para alguns namespaces no modo API, ou `ebpf.enabled=true` com um `autoTargetExe` restrito.

> **Cuidado com o que você corta.** Alguns monitores dependem de sinais específicos: desabilitar `cadvisor` remove os monitores de OOM-kill e de throttling de CPU; desabilitar `kubeletstats.volumeMetrics` remove o monitor de pouco espaço em disco de PVC; desabilitar os logs remove os alertas baseados em logs. Corte os sinais sobre os quais você não age, não aqueles que um monitor está observando.

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
4. Para clusters muito grandes, uma única réplica pode ser um gargalo — fragmente por namespace usando `namespaceFilters.include` em releases separados

### Nenhuma métrica aparecendo

1. Primeiro descarte uma chave de ingestão rejeitada — é a causa mais comum e é invisível do lado do agente. Veja [O agente mostra "Disconnected"](#agent-shows-disconnected) acima (ou simplesmente execute o script de diagnóstico).
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
