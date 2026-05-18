# Instalar o agente Kubernetes

O agente Kubernetes do OneUptime recolhe métricas do cluster, eventos, logs de pods, **traces de aplicação (HTTP/gRPC via eBPF)**, **flame graphs contínuos de CPU (profiler eBPF)** e **métricas de nó ao nível do sistema operativo** do seu cluster Kubernetes e envia-os para o OneUptime. É distribuído como um Helm chart e instalado com um único comando — a auto-instrumentação eBPF e o profiling estão ambos ativos por omissão, pelo que poderá ver traces ao nível de serviço, métricas RED e flame graphs sem alterações de código.

## Início rápido

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm repo update

helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=<A_UNIQUE_NAME_FOR_THIS_CLUSTER>
```

O seu cluster aparecerá no OneUptime dentro de alguns minutos.

## Escolha o preset correto para o seu cluster

Diferentes distribuições de Kubernetes têm restrições distintas — em especial, se as cargas de trabalho podem montar volumes `hostPath`. Em vez de o obrigar a ler documentação de segurança, o chart expõe uma única opção de nível superior: `preset`.

| Preset | Utilizar para | Recolha de logs | Notas |
| --- | --- | --- | --- |
| `standard` (omissão) | Self-managed, **EKS on EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | DaemonSet que lê `/var/log/pods` via hostPath | Sobrecarga mais baixa. hostPath está disponível nestas plataformas. |
| `gke-autopilot` | **GKE Autopilot** | Tailer da API Kubernetes (Deployment) | hostPath é bloqueado no Autopilot. Define um contexto de segurança reforçado que cumpre os Pod Security Standards do Autopilot. |
| `eks-fargate` | **EKS Fargate** | Tailer da API Kubernetes (Deployment) | Igual a `gke-autopilot`. O Fargate bloqueia hostPath e DaemonSets. |

Se não tiver a certeza, deixe `preset` por definir — obtém as predefinições `standard`. Se o seu cluster rejeitar a instalação com um erro de política Pod Security a mencionar `hostPath`, mude para `gke-autopilot` (ou `eks-fargate` no EKS Fargate) e reinstale.

### Exemplos

**GKE Standard, EKS on EC2, self-managed ou AKS:**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod
```

**GKE Autopilot:**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod-gke-autopilot \
  --set preset=gke-autopilot
```

**EKS Fargate:**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod-eks-fargate \
  --set preset=eks-fargate
```

## Como diferem os dois modos de recolha de logs

Internamente, `preset` define `logs.mode` — e também pode definir esse valor diretamente se precisar de sobrepor o valor predefinido do preset.

### Modo DaemonSet (`logs.mode: daemonset`)

Um DaemonSet executa um pod do OpenTelemetry Collector por cada nó. Lê os ficheiros de log em `/var/log/pods/` através de um volume hostPath e encaminha-os por OTLP.

- **Vantagens:** sobrecarga mínima, escala linearmente com os nós, não sobrecarrega o servidor da API Kubernetes, trata da rotação de logs.
- **Desvantagens:** requer hostPath, requer a capacidade de agendar DaemonSets — ambos indisponíveis no GKE Autopilot e EKS Fargate.

### Modo API (`logs.mode: api`)

Um Deployment de réplica única (a imagem `oneuptime/kubernetes-log-tailer`) utiliza a API do Kubernetes para fazer streaming dos logs dos contentores — o mesmo endpoint que o `kubectl logs -f` utiliza. Sem hostPath, sem acesso ao host, sem DaemonSet.

- **Vantagens:** funciona no GKE Autopilot, EKS Fargate e qualquer cluster que bloqueie hostPath ou imponha o Pod Security Standard `restricted`.
- **Desvantagens:** cada stream de contentor é uma ligação de longa duração ao `kube-apiserver`. Na prática, uma réplica gere alguns milhares de contentores confortavelmente. Para clusters muito grandes, distribua por namespace usando `logs.api.replicas` em conjunto com `namespaceFilters.include` em cada réplica.

### Qual deve utilizar?

Se o hostPath funcionar, use DaemonSet. Em todos os outros casos, use o modo API. A definição `preset` escolhe o correto por si.

Também pode desativar a recolha de logs completamente com `--set logs.enabled=false` e enviar logs de aplicação via SDKs do OpenTelemetry. Consulte a documentação do [OpenTelemetry](/docs/telemetry/open-telemetry).

## Traces de aplicação e pedidos HTTP via eBPF (ativo por omissão)

O chart inclui um DaemonSet que executa o [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) em cada nó. O OBI carrega programas eBPF no kernel do Linux e observa o tráfego ao nível dos sockets para reconstruir chamadas HTTP/HTTPS, gRPC e SQL/Redis a partir de cada pod no nó — sem alterações de código, sem SDK, sem sidecar. O tráfego capturado é exportado como traces OTLP e métricas de pedido/latência diretamente para o OneUptime.

Após a instalação, os seus serviços começam a aparecer em **Telemetry → Traces** e no mapa de serviços dentro de um ou dois minutos, com `k8s.cluster.name` definido para o seu `clusterName`, permitindo-lhe filtrar por cluster.

### Quando desativar

O eBPF está **ativo por omissão**. Deverá desativá-lo (`--set ebpf.enabled=false`) se:

- Estiver a instalar em **GKE Autopilot** ou **EKS Fargate**. Estas plataformas bloqueiam pods privilegiados, e o OBI necessita do modo privilegiado para carregar programas eBPF.
- Os seus nós executam um kernel mais antigo do que o **Linux 5.8** sem retroportes BTF. (Distribuições modernas — Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL/Stream 9+ — são adequadas.)
- Já estiver a enviar traces via SDK do OpenTelemetry a partir das suas aplicações e não pretender duplicados.

### O que é emitido

O OBI extrai várias famílias de sinais do tráfego capturado. Todas estão ativas por omissão; cada uma pode ser desativada independentemente com `--set ebpf.features.<key>=false`:

| Sinal | Omissão | O que adiciona |
| --- | --- | --- |
| `ebpf.features.httpMetrics` | ativo | Métricas RED de HTTP/gRPC — taxa de pedidos, histogramas de latência, contagens de erros — por serviço. |
| `ebpf.features.spanMetrics` | ativo | Métricas indexadas por atributos de span: tamanho do pedido, tamanho da resposta, duração detalhada por rota/operação. |
| `ebpf.features.serviceGraph` | ativo | Métricas de arestas serviço-a-serviço (taxa de pedidos chamador → chamado + latência). Alimenta o mapa de serviços. |
| `ebpf.features.hostMetrics` | ativo | CPU e memória por processo instrumentado — evita executar um profiler separado para questões básicas de capacidade. |
| `ebpf.features.networkMetrics` | ativo | Contadores de bytes e pacotes de fluxos TCP/UDP pod-a-pod com metadados de k8s. Mostra cada par de pods que comunica, incluindo os que utilizam protocolos que o OBI não consegue analisar. |
| `ebpf.features.networkInterZoneMetrics` | inativo | Variante inter-zona das métricas de rede. Duplica a cardinalidade; só vale a pena ativar se realmente utilizar agendamento baseado em zonas. |
| `ebpf.features.tcpStats` | ativo | Estatísticas TCP ao nível do nó: histogramas de RTT, contagens de ligações falhadas, retransmissões. |

O OBI também propaga, por omissão, o contexto de trace através das fronteiras entre serviços. Quando o pod A faz um pedido HTTP/gRPC ao pod B, o OBI injeta um cabeçalho `traceparent` W3C no pedido de saída — pelo que o span resultante no lado do pod B é ligado ao mesmo trace que o pedido de saída do pod A. Não são necessárias alterações de SDK em qualquer das aplicações.

| Opção | Omissão | Descrição |
| --- | --- | --- |
| `ebpf.contextPropagation` | ativo | Injeta `traceparent` W3C no tráfego de saída (cabeçalhos HTTP + opção TCP personalizada). Defina para `false` para manter os spans de cada serviço locais. |
| `ebpf.trackRequestHeaders` | ativo | Acompanhamento de cabeçalhos de pedido no lado do kernel para que a propagação funcione também em servidores HTTP simples (não-Go, não-TLS). Só tem efeito quando `contextPropagation` for verdadeiro. |

### Correlação log ↔ trace

Também ativa por omissão. O enriquecedor de logs do OBI interceta escritas em stdout dos pods provenientes de processos instrumentados e:

- Para **logs no formato JSON**: injeta os campos `trace_id` e `span_id` na linha (qualquer valor já existente no log é preservado). O DaemonSet filelog eleva depois esses campos para os slots nativos trace_id/span_id do LogRecord, pelo que clicar num span na vista de traces salta para os respetivos logs no OneUptime — e clicar numa linha de log salta para o trace pai.
- Para **logs não-JSON**: a linha é preservada sem alterações — continua a ser recolhida, apenas não é ligada automaticamente.

| Opção | Omissão | Descrição |
| --- | --- | --- |
| `ebpf.logToTraceCorrelation` | ativo | Ativa o enriquecedor de logs do OBI e a elevação de trace_id no pipeline filelog. Defina para `false` para ignorar ambos. |

Ressalvas:

- **Os logs têm de estar em JSON para que o trace_id apareça.** Mude o seu logger para um formatador JSON — `structlog`, `pino`, `winston`, `serilog`, `logback-json`, klog `--logging-format=json`, etc.
- **A bufferização do stdout quebra a correlação** porque o syscall `write()` é disparado numa thread diferente da que tratou o pedido. Correções comuns:
  - **Python**: defina `PYTHONUNBUFFERED=1` (o runtime faz block-buffer do stdout quando não é um TTY).
  - **.NET**: no arranque, `Console.SetOut(new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true })`. O `AddConsole()` do Microsoft.Extensions.Logging e os sinks assíncronos do Serilog também não funcionarão — mude para um writer de consola síncrono (o `WriteTo.Console()` predefinido do Serilog está bem).
- Greenlet / gevent, Tornado e outros runtimes assíncronos personalizados não estão cobertos.

### Ajuste fino

| Opção | Omissão | Descrição |
| --- | --- | --- |
| `ebpf.enabled` | `true` | Interruptor principal. Defina para `false` para ignorar completamente o DaemonSet eBPF. |
| `ebpf.image.tag` | `v0.9.0` | Tag da imagem OBI. O OBI é pré-1.0; fixe numa versão validada e volte a testar em atualizações. |
| `ebpf.autoTargetExe` | `*` | Glob de executáveis a instrumentar. Restrinja-o (p.ex., `*/python,*/java`) se pretender delimitar a auto-instrumentação. |
| `ebpf.excludeExePaths` | (shells, kubelet, runc, containerd, otelcol, o próprio OBI) | Globs separados por vírgulas a ignorar. |
| `ebpf.logLevel` | `info` | `debug`, `info`, `warn` ou `error`. Defina para `debug` durante a resolução de problemas. |
| `ebpf.printTraces` | `false` | Imprime spans no stdout do OBI para além da exportação OTLP — útil para verificar a captura durante a instalação. |
| `ebpf.resources.*` | requests `100m / 256Mi`, limits `1000m / 1Gi` | Aumente para clusters de alto tráfego. |

Para verificar que o OBI está em execução e a observar tráfego:

```bash
kubectl get pods -n oneuptime-kubernetes-agent -l component=ebpf-instrument
kubectl logs -n oneuptime-kubernetes-agent -l component=ebpf-instrument --tail=200
```

## Profiling contínuo de CPU (ativo por omissão)

Um DaemonSet separado executa o [OpenTelemetry eBPF Profiler](https://github.com/open-telemetry/opentelemetry-ebpf-profiler) — empacotado como a imagem `otel/opentelemetry-collector-ebpf-profiler`. Faz amostragem das stacks on-CPU a 19 Hz em todos os runtimes suportados (Go, Java, .NET, Python, Ruby, Node.js, PHP, Perl, C/C++, Rust) e envia profiles OTLP para o OneUptime, onde aparecem em **Telemetry → Performance Profiles** e como flame graphs ligados a spans de trace individuais.

Quando a auto-instrumentação eBPF também está ativa (`ebpf.enabled: true`, a predefinição), cada amostra de CPU é correlacionada com o contexto de trace do OBI através de um mapa bpffs partilhado — pelo que os flame graphs transportam trace_id/span_id e a UI do OneUptime consegue mostrar-lhe um flame graph por span.

Requisitos:

- **Kernel Linux 5.10+** (ligeiramente mais recente do que o 5.8 exigido pelo OBI).
- Pod privilegiado com hostPID — as mesmas restrições do DaemonSet de auto-instrumentação eBPF. Desative em GKE Autopilot, EKS Fargate e ambientes restritos: `--set profiling.enabled=false`.

Ajuste fino:

| Opção | Omissão | Descrição |
| --- | --- | --- |
| `profiling.enabled` | `true` | Interruptor principal. |
| `profiling.image.tag` | `0.152.0` | Tag da imagem `otel/opentelemetry-collector-ebpf-profiler`. O profiler é pré-1.0; fixe numa versão validada. |
| `profiling.samplesPerSecond` | `19` | Frequência de amostragem em Hz. Predefinição upstream; evita aliasing acidental com frequências de temporizador comuns. |
| `profiling.offCpuThreshold` | `0` | (0–1] ativa profiling off-CPU — diagnostica contenção de bloqueios e I/O bloqueante. Inativo por omissão por adicionar sobrecarga de tracepoints. |
| `profiling.tracers` | `""` *(todos os runtimes)* | Lista separada por vírgulas de tracers de linguagem a carregar. |
| `profiling.obiProcessContext` | `true` | Correlaciona as amostras com o contexto de trace do OBI para ligação trace ↔ profile. |

## Outras recolhas de dados (host metrics, audit logs, CSI, CoreDNS)

O chart também consegue recolher:

| `<key>.enabled` | Omissão | O que adiciona |
| --- | --- | --- |
| `hostMetrics` | ativo | Métricas de SO por nó a partir de `/proc` e `/sys` — profundidade da fila de I/O de disco, utilização de inodes do sistema de ficheiros, contadores de erros da NIC, estatísticas de paging, load average. Reside dentro do DaemonSet do coletor de logs (sem pods adicionais). |
| `auditLogs` | inativo | Lê `/var/log/kubernetes/audit.log` a partir do host. Captura cada pedido à API do Kubernetes — quem fez o quê a que recurso. Apenas clusters self-managed — Kubernetes geridos (EKS, GKE, AKS, DOKS) encaminham os audit logs para o sink do fornecedor de nuvem. |
| `csi` | inativo | Deteta automaticamente pods com a etiqueta `app=csi-driver` (ou `app.kubernetes.io/component=csi-driver`) e faz scrape da respetiva porta `metrics` Prometheus — latência de attach/detach de volumes, falhas de aprovisionamento, IOPS. |
| `coreDns` | inativo | Faz scrape do serviço CoreDNS do cluster em `:9153/metrics`. Mostra a taxa de queries, latência, taxa de cache hit, contagens de erros — culpados frequentes de latência P99. |

## Opções comuns

| Opção | Omissão | Descrição |
| --- | --- | --- |
| `preset` | (vazio — tratado como `standard`) | Veja a tabela acima. |
| `oneuptime.url` | *(obrigatório)* | URL da sua instância OneUptime. |
| `oneuptime.apiKey` | *(obrigatório)* | Chave de API do projeto (Settings → API Keys). |
| `clusterName` | *(obrigatório)* | Nome único para este cluster. Carimbado como `k8s.cluster.name` em cada registo. |
| `namespaceFilters.include` | `[]` | Se definido, apenas estes namespaces são monitorizados. |
| `namespaceFilters.exclude` | `["kube-system"]` | Namespaces a ignorar. |
| `logs.enabled` | `true` | Liga ou desliga a recolha de logs. |
| `logs.mode` | (derivado de `preset`) | `daemonset`, `api` ou `disabled`. Sobrepõe-se ao preset. |
| `logs.api.replicas` | `1` | Número de réplicas do Deployment log-tailer (apenas no modo API). |
| `ebpf.enabled` | `true` | Captura automática de traces HTTP/gRPC de cada pod via OpenTelemetry eBPF Instrumentation. Veja a secção acima. |
| `profiling.enabled` | `true` | Flame graphs contínuos de CPU via OpenTelemetry eBPF Profiler. Veja a secção acima. |
| `hostMetrics.enabled` | `true` | Métricas de SO por nó. |
| `auditLogs.enabled` | `false` | Recolha de audit logs do Kubernetes (clusters self-managed). |
| `csi.enabled` | `false` | Métricas Prometheus dos drivers CSI. |
| `coreDns.enabled` | `false` | Métricas Prometheus do CoreDNS. |
| `controlPlane.enabled` | `false` | Faz scrape de etcd / api-server / scheduler / controller-manager. Apenas clusters self-managed — ofertas geridas (EKS/GKE/AKS) normalmente não expõem estes endpoints. |

Consulte o ficheiro [`values.yaml` do chart](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/kubernetes-agent/values.yaml) para a lista completa.

## Atualizar

```bash
helm repo update
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values
```

`--reuse-values` mantém a sua configuração existente; passe quaisquer novas substituições `--set` por cima.

> **Atenção: `--reuse-values` não faz merge de novas predefinições do chart.** O Helm reutiliza os valores previamente renderizados literalmente — pelo que qualquer novo campo de nível superior adicionado numa versão mais recente do chart (p.ex., `profiling.*`, `ebpf.features.*`) permanece por definir no seu release existente e o template é renderizado como se o tivesse desativado.
>
> **Helm 3.14+** — mude para `--reset-then-reuse-values`. Volta a ler as predefinições do chart para as chaves que não substituiu:
>
> ```bash
> helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
>   --namespace oneuptime-kubernetes-agent \
>   --reset-then-reuse-values
> ```
>
> **Helm 3.13 ou anterior** — remova `--reuse-values` e passe explicitamente as suas flags `--set` originais (ou `-f values.yaml`). Aplicam-se as novas predefinições do chart para tudo o que não substituir.
>
> Se os pods de uma nova funcionalidade (p.ex., `kubernetes-agent-profiling-*`) não aparecerem após a atualização, é quase sempre por este motivo. `helm get values <release>` mostra o que o Helm tem realmente — campos em falta na saída significam que as predefinições não foram fundidas para eles.

## Desinstalar

```bash
helm uninstall oneuptime-agent --namespace oneuptime-kubernetes-agent
kubectl delete namespace oneuptime-kubernetes-agent
```

## Resolução de problemas

### A instalação falha com "hostPath volumes are not allowed"

O seu cluster bloqueia hostPath. Mude para um preset em modo API:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values \
  --set preset=gke-autopilot   # or eks-fargate
```

### Não aparecem logs no OneUptime

Verifique os pods do agente:

```bash
kubectl get pods -n oneuptime-kubernetes-agent
kubectl logs -n oneuptime-kubernetes-agent -l app.kubernetes.io/part-of=oneuptime --tail=200
```

No modo API, o pod log-tailer expõe `/healthz` na porta 13133 — aceda via `kubectl port-forward` para obter um snapshot do estado da exportação.

### O pod do DaemonSet eBPF está em `CrashLoopBackOff` ou não arranca

Verifique os logs do pod OBI:

```bash
kubectl logs -n oneuptime-kubernetes-agent -l component=ebpf-instrument --tail=200
```

Causas comuns:

- **Kernel demasiado antigo ou sem BTF.** O OBI precisa de Linux 5.8+ com BTF. Verifique com `uname -r` num nó. Se não conseguir atualizar, desative o eBPF: `--set ebpf.enabled=false`.
- **Pods privilegiados estão bloqueados.** Alguns clusters rejeitam pods privilegiados mesmo fora do Autopilot/Fargate. Desative o eBPF.
- **Sem traces no dashboard mas o OBI está em execução.** Defina `--set ebpf.printTraces=true` e verifique o stdout do OBI — se vir spans aí, o problema é a entrega OTLP (verifique o `OTEL_EXPORTER_OTLP_ENDPOINT` e o seu URL/chave de API do OneUptime). Se não vir spans, o tráfego que o OBI está a observar pode estar todo encriptado por uma biblioteca TLS que o OBI não consegue intercetar (p.ex., uma implementação TLS ligada estaticamente que não reconhece).

### O meu cluster tem demasiados pods para uma única réplica de log-tailer (apenas modo API)

Escale horizontalmente fazendo sharding por namespaces. Faça uma instalação por cada grupo de namespaces:

```bash
helm install oneuptime-agent-ns-a oneuptime/kubernetes-agent \
  --set preset=gke-autopilot \
  --set namespaceFilters.include={app-a,app-b} \
  ...
```

Em alternativa, aumente `logs.api.replicas` — mas note que cada réplica processa todos os namespaces permitidos, pelo que para deduplicação continuará a precisar de sharding por namespace.
