import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Kubernetes setup guide in Portuguese (#8341): each piece of the English
 * guide's markdown (Pages/Kubernetes/Utils/DocumentationMarkdown.ts) and its
 * Portuguese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Portuguese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A Kubernetes cluster running v1.23 or later":
    "Um cluster Kubernetes com v1.23 ou posterior",
  "`kubectl` and `helm` (v3) installed on your machine":
    "`kubectl` e `helm` (v3) instalados na sua máquina",
  "Wrong cluster? Switch with `kubectl config use-context <context-name>`.":
    "Cluster errado? Troque com `kubectl config use-context <context-name>`.",
  "Replace `my-cluster` with a name for this cluster, such as `prod-us-east-1`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "Substitua `my-cluster` por um nome para este cluster, como `prod-us-east-1`. É assim que o cluster aparece no OneUptime, então mantenha-o estável: um nome novo registra um cluster novo.",
  "`--set aiAgent.enabled=true` turns **AI investigations** on, as the chart does by default: OneUptime AI investigates incidents and alerts on this cluster with read-only kubectl, through the Kubernetes AI agent.":
    "`--set aiAgent.enabled=true` ativa as **investigações de IA**, como o chart faz por padrão: o OneUptime AI investiga incidentes e alertas deste cluster com kubectl somente leitura, por meio do agente de IA do Kubernetes.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Escolha uma chave de ingestão na etapa 1 para preencher `<YOUR_API_KEY>`.",
  "You should see:": "Você deve ver:",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "O coletor e o agente de IA do Kubernetes, mais um pod `-logs` e um pod `-ebpf` em cada nó. Quando estiverem `Running`, o cluster aparece automaticamente na seção **Kubernetes**, normalmente em um ou dois minutos.",
  "**Kubernetes AI agent (on by default, read-only).** The `kubernetes-agent-ai-agent` pod lets OneUptime AI investigate incidents and alerts on this cluster with read-only kubectl — `get`, `describe`, `logs`, `events`, `top` — using the same API key, and it can change nothing unless you give it write access later. Open the cluster and go to **AI → Agent** to see it. Don't want it? Install with `--set aiAgent.enabled=false` instead of `--set aiAgent.enabled=true`.":
    "**Agente de IA do Kubernetes (ativado por padrão, somente leitura).** O pod `kubernetes-agent-ai-agent` permite que o OneUptime AI investigue incidentes e alertas deste cluster com kubectl somente leitura (`get`, `describe`, `logs`, `events`, `top`), usando a mesma chave de API, e não pode alterar nada a menos que você lhe dê acesso de escrita depois. Abra o cluster e vá em **IA → Agente** para vê-lo. Não quer? Instale com `--set aiAgent.enabled=false` em vez de `--set aiAgent.enabled=true`.",
  "Namespace rules decide what the agent collects from each namespace. To collect pod logs and eBPF data only from `default`, `production` and `staging`:":
    "Regras de namespace decidem o que o agente coleta de cada namespace. Para coletar logs de pods e dados de eBPF apenas de `default`, `production` e `staging`:",
  "To keep everything but stop the logs of noisy namespaces, exclude them from `podLogs` only:":
    "Para manter tudo, mas parar os logs de namespaces barulhentos, exclua-os apenas de `podLogs`:",
  "- **Scopes:** `podLogs` (container stdout/stderr), `ebpfDiscovery` (eBPF traces and metrics), `metrics` (namespaced metrics) and `traces` (every span).":
    "- **Escopos:** `podLogs` (stdout/stderr dos contêineres), `ebpfDiscovery` (traces e métricas de eBPF), `metrics` (métricas com namespace) e `traces` (todos os spans).",
  "- **Patterns** match the whole namespace name and accept `*`, as in `team-*`. An `exclude` rule always wins over an `include` rule.":
    "- Os **padrões** correspondem ao nome inteiro do namespace e aceitam `*`, como em `team-*`. Uma regra `exclude` sempre vence uma regra `include`.",
  "- **Setting the rules replaces the default one**, which excludes `kube-system` from `podLogs` and `ebpfDiscovery`. Keep it in your list, as in the second example, if you still want that.":
    "- **Definir as regras substitui a regra padrão**, que exclui `kube-system` de `podLogs` e `ebpfDiscovery`. Mantenha-a na sua lista, como no segundo exemplo, se ainda quiser isso.",
  "- Node and cluster metrics have no namespace, so they are always kept.":
    "- Métricas de nó e de cluster não têm namespace, então são sempre mantidas.",
  "- `--set-json` needs Helm 3.10 or later.":
    "- `--set-json` requer Helm 3.10 ou posterior.",
  "**Only send important lines.** Drop pod log lines below a severity before they leave the cluster:":
    "**Envie só as linhas importantes.** Descarte linhas de log de pods abaixo de uma severidade antes que saiam do cluster:",
  'Accepts `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` and `FATAL`: `WARN` keeps warnings, errors and fatal lines. The severity is read from the log line itself (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes events are never dropped by this.':
    'Aceita `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` e `FATAL`: `WARN` mantém avisos, erros e linhas fatais. A severidade é lida da própria linha de log (`[ERROR]`, `level=warn`, `"level":"info"`). Eventos do Kubernetes nunca são descartados por isso.',
  "**Turn pod logs off.** Metrics are not affected — the node collector keeps running for kubelet and cAdvisor metrics, it just stops reading pod logs:":
    "**Desative os logs de pods.** As métricas não são afetadas: o coletor de nós continua rodando para as métricas de kubelet e cAdvisor, só deixa de ler os logs de pods:",
  "**Change how logs are read.** The preset picks this for you; an explicit `logs.mode` always wins over it:":
    "**Mude como os logs são lidos.** O preset escolhe isso por você; um `logs.mode` explícito sempre tem prioridade:",
  "- `logs.mode=daemonset` — reads `/var/log/pods` on every node through hostPath (lowest overhead; needs hostPath).":
    "- `logs.mode=daemonset`: lê `/var/log/pods` em cada nó via hostPath (menor sobrecarga; requer hostPath).",
  "- `logs.mode=api` — a Deployment tails pod logs through the Kubernetes API (works on any cluster).":
    "- `logs.mode=api`: um Deployment acompanha os logs de pods pela API do Kubernetes (funciona em qualquer cluster).",
  "- `logs.mode=disabled` — no pod logs.":
    "- `logs.mode=disabled`: sem logs de pods.",
  "That reads the API server, where it answers inside the cluster. etcd, the scheduler and the controller manager answer on the control-plane nodes, which the agent's pod cannot guess, so it reads them once you list each node's address:":
    "Isso lê o servidor de API, onde ele responde dentro do cluster. O etcd, o scheduler e o controller manager respondem nos nós do plano de controle, que o pod do agente não consegue adivinhar, então ele os lê assim que você informa o endereço de cada nó:",
  "- **The scheduler and the controller manager** serve HTTPS and accept the agent's token, but kubeadm binds them to `127.0.0.1`: give them a `--bind-address` the agent's pod can reach.":
    "- **O scheduler e o controller manager** servem HTTPS e aceitam o token do agente, mas o kubeadm os vincula a `127.0.0.1`: dê a eles um `--bind-address` que o pod do agente consiga alcançar.",
  "- **etcd** serves its metrics in plain HTTP on kubeadm's `--listen-metrics-urls` (port 2381, bound to `127.0.0.1` until you add the node's address), as above. Or scrape its HTTPS client port, 2379, with the client certificate it asks for: put `ca.crt`, `tls.crt` and `tls.key` in a Secret in `oneuptime-agent` and name it in `controlPlane.etcd.clientCertSecret`.":
    "- **etcd** serve suas métricas em HTTP simples nas `--listen-metrics-urls` do kubeadm (porta 2381, vinculada a `127.0.0.1` até você adicionar o endereço do nó), como acima. Ou consulte a porta de cliente HTTPS dele, 2379, com o certificado de cliente que ele pede: coloque `ca.crt`, `tls.crt` e `tls.key` em um Secret em `oneuptime-agent` e informe-o em `controlPlane.etcd.clientCertSecret`.",
  "Only for self-managed clusters: managed services (EKS, GKE, AKS) do not expose their control plane metrics.":
    "Apenas para clusters autogerenciados: serviços gerenciados (EKS, GKE, AKS) não expõem as métricas do plano de controle.",
  "Cost monitoring is on by default: the agent bundles the open-source OpenCost engine (plus the small Prometheus it needs), prices your nodes and volumes from your cloud provider's public list prices — no credentials required — and sends what each namespace and workload costs. The first data appears on the cluster's overview and Costs page after the first full hour.":
    "O monitoramento de custos vem ativado por padrão: o agente inclui o mecanismo de código aberto OpenCost (mais o pequeno Prometheus de que ele precisa), precifica seus nós e volumes pelos preços públicos de tabela do seu provedor de nuvem, sem credenciais, e envia quanto custa cada namespace e workload. Os primeiros dados aparecem na visão geral do cluster e na página Custos depois da primeira hora completa.",
  "On an agent installed before it was on by default, upgrade it:":
    "Se o agente foi instalado antes de isso ser o padrão, atualize-o:",
  "- **Turn it off:** add `--set cost.enabled=false` to the same upgrade.":
    "- **Para desativá-lo:** adicione `--set cost.enabled=false` à mesma atualização.",
  "Cost monitoring is off by default on this platform: it bills every pod by what it requests, so the three cost pods would add to your bill, and OpenCost prices nodes rather than pods. To turn it on anyway:":
    "O monitoramento de custos vem desativado por padrão nesta plataforma: ela cobra cada pod pelo que ele solicita, então os três pods de custos aumentariam a sua conta, e o OpenCost precifica nós, não pods. Para ativá-lo mesmo assim:",
  "That alone is a complete install: the chart bundles the open-source OpenCost engine (plus the small Prometheus it needs) and prices your nodes and volumes from your cloud provider's public list prices — no credentials required. It adds three small pods; the first data appears after the first full hour.":
    "Só isso já é uma instalação completa: o chart inclui o mecanismo de código aberto OpenCost (mais o pequeno Prometheus de que ele precisa) e precifica seus nós e volumes pelos preços públicos de tabela do seu provedor de nuvem, sem credenciais. Ele adiciona três pods pequenos; os primeiros dados aparecem depois da primeira hora completa.",
  "- **Already running Kubecost or OpenCost?** Point the agent at it instead, and nothing is bundled: add `--set cost.engine.url=http://opencost.opencost.svc.cluster.local:9003` (or your Kubecost service).":
    "- **Já usa Kubecost ou OpenCost?** Aponte o agente para ele, e nada é incluído: adicione `--set cost.engine.url=http://opencost.opencost.svc.cluster.local:9003` (ou o seu serviço Kubecost).",
  "- **On-prem or bare metal?** Set a rate card with `--set cost.opencost.customPricing.enabled=true` (USD per resource-hour — see the chart's `values.yaml`).":
    "- **On-premises ou bare metal?** Defina uma tabela de preços com `--set cost.opencost.customPricing.enabled=true` (USD por hora de recurso; veja o `values.yaml` do chart).",
  "Full guide: [Kubernetes Cost Observability](/docs/telemetry/kubernetes-cost).":
    "Guia completo: [Observabilidade de custos do Kubernetes](/docs/telemetry/kubernetes-cost).",
  "The agent runs [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) on every node. It captures HTTP/HTTPS, gRPC and SQL/Redis traffic from Go, .NET, Java, Node.js, Python, Ruby and Rust services — no SDK and no sidecar — and ships traces, request (RED) metrics and service-graph data through the collector.":
    "O agente executa o [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) em cada nó. Ele captura tráfego HTTP/HTTPS, gRPC e SQL/Redis de serviços em Go, .NET, Java, Node.js, Python, Ruby e Rust, sem SDK nem sidecar, e envia traces, métricas de requisições (RED) e dados do grafo de serviços pelo coletor.",
  "**Requirements:** Linux kernel **5.8+** with BTF (the default on Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). The eBPF pods run **privileged**, which they need to load eBPF programs.":
    "**Requisitos:** kernel Linux **5.8+** com BTF (o padrão no Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). Os pods de eBPF rodam como **privilegiados**, o que precisam para carregar programas eBPF.",
  "**Turn it off** if your nodes run an older kernel, if privileged pods are not allowed, or if your services already send traces with OpenTelemetry SDKs and you don't want duplicates:":
    "**Desative-o** se seus nós usam um kernel mais antigo, se pods privilegiados não são permitidos ou se seus serviços já enviam traces com SDKs do OpenTelemetry e você não quer duplicatas:",
  "**Choose the signals.** Each family is switched with `--set ebpf.features.<name>=false` (or `=true`):":
    "**Escolha os sinais.** Cada família é ligada ou desligada com `--set ebpf.features.<name>=false` (ou `=true`):",
  "| `ebpf.features.*` | Default | What it adds |":
    "| `ebpf.features.*` | Padrão | O que adiciona |",
  "| `httpMetrics` | on | HTTP/gRPC request rate, errors and latency per service |":
    "| `httpMetrics` | ligado | Taxa de requisições HTTP/gRPC, erros e latência por serviço |",
  "| `spanMetrics` | on | Span call count and duration (`traces.span.metrics.*`) |":
    "| `spanMetrics` | ligado | Contagem de chamadas e duração dos spans (`traces.span.metrics.*`) |",
  "| `serviceGraph` | on | Caller → callee edges; drives the service map |":
    "| `serviceGraph` | ligado | Arestas chamador → chamado; alimenta o mapa de serviços |",
  "| `networkMetrics` | on | Pod-to-pod TCP/UDP flow counters |":
    "| `networkMetrics` | ligado | Contadores de fluxos TCP/UDP de pod para pod |",
  "| `networkInterZoneMetrics` | off | Inter-zone network metrics (doubles their cardinality) |":
    "| `networkInterZoneMetrics` | desligado | Métricas de rede entre zonas (dobra a cardinalidade delas) |",
  "| `tcpStats` | on | Node-level TCP RTT, failed-connection and retransmit counters |":
    "| `tcpStats` | ligado | RTT de TCP e contadores de conexões com falha e retransmissões por nó |",
  "**Cross-service trace propagation** — linking a request that crosses pod A → pod B into a single trace, on another node too — is **on by default**. It works by rewriting traffic that is already in flight (widening plaintext HTTP requests in the kernel, and appending a TCP option to TLS and raw TCP), and a mistake in that byte accounting desynchronizes the stream — the reported symptom is transfers through an L7 proxy such as nginx hanging once a response passes ~64KB. If you see that, or a service mesh starts failing pods, turn it off with `--set ebpf.contextPropagation=false`; an OpenTelemetry SDK propagates `traceparent` in userspace without any of that.":
    "A **propagação de traces entre serviços** (ligar em um único trace uma requisição que vai do pod A → pod B, também em outro nó) fica **ligada por padrão**. Ela funciona reescrevendo o tráfego que já está em andamento (ampliando requisições HTTP em texto puro no kernel e acrescentando uma opção TCP ao TLS e ao TCP bruto), e um erro nessa contagem de bytes dessincroniza o fluxo: o sintoma relatado são transferências por um proxy L7 como o nginx que travam quando uma resposta passa de ~64KB. Se você vir isso, ou se uma service mesh começar a derrubar pods, desligue-a com `--set ebpf.contextPropagation=false`; um SDK do OpenTelemetry propaga `traceparent` no espaço do usuário sem nada disso.",
  "Each `oneuptime.labels.<key>=<value>` becomes the label `<key>:<value>` on the cluster, and on the services and hosts it reports. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Cada `oneuptime.labels.<key>=<value>` vira o rótulo `<key>:<value>` no cluster e nos serviços e hosts que ele informa. Os rótulos são comparados sem diferenciar maiúsculas de minúsculas, então um rótulo `Production` existente é reutilizado; rótulos adicionados na interface do OneUptime nunca são removidos pelo agente.",
  "**Upgrade** to the latest chart. `--reset-then-reuse-values` (Helm 3.14+) keeps the values you set (preset, cluster name, filters) and takes everything else from the new chart; add any new `--set` flags on top of it:":
    "**Atualize** para o chart mais recente. `--reset-then-reuse-values` (Helm 3.14+) mantém os valores que você definiu (preset, nome do cluster, filtros) e pega todo o resto do chart novo; adicione por cima quaisquer novos flags `--set`:",
  "On Helm 3.13 and earlier, upgrade with the values you set instead:":
    "No Helm 3.13 e anteriores, atualize com os valores que você definiu:",
  "Don't use `--reuse-values`: it also keeps the defaults of the chart you upgrade from, so a newer chart's defaults (its eBPF image among them) never apply.":
    "Não use `--reuse-values`: ele também mantém os padrões do chart de onde você atualiza, então os padrões de um chart mais novo (entre eles a imagem de eBPF) nunca se aplicam.",
  "**Uninstall** the agent and its namespace:":
    "**Desinstale** o agente e o namespace dele:",
  "| Category | Data |": "| Categoria | Dados |",
  "| **Node metrics** | CPU, memory, filesystem and network usage |":
    "| **Métricas de nós** | Uso de CPU, memória, sistema de arquivos e rede |",
  "| **Pod and container metrics** | CPU, memory, network I/O and restarts |":
    "| **Métricas de pods e contêineres** | CPU, memória, E/S de rede e reinícios |",
  "| **Cluster metrics** | Node conditions, allocatable resources, pod and workload counts |":
    "| **Métricas do cluster** | Condições dos nós, recursos alocáveis, contagem de pods e workloads |",
  "| **Kubernetes events** | Warnings, errors and scheduling events |":
    "| **Eventos do Kubernetes** | Avisos, erros e eventos de agendamento |",
  "| **Pod logs** | stdout/stderr of every container, read from each node |":
    "| **Logs de pods** | stdout/stderr de cada contêiner, lidos em cada nó |",
  "| **Application traces** *(eBPF)* | HTTP, gRPC and SQL/Redis spans from every pod — no SDK or code changes |":
    "| **Traços de aplicações** *(eBPF)* | Spans HTTP, gRPC e SQL/Redis de cada pod, sem SDK nem mudanças no código |",
  "| **Request metrics and service graph** *(eBPF)* | Request rate, errors and latency per service, and caller → callee edges for the service map |":
    "| **Métricas de requisições e grafo de serviços** *(eBPF)* | Taxa de requisições, erros e latência por serviço, e arestas chamador → chamado para o mapa de serviços |",
  "| **Network flows** *(eBPF)* | Pod-to-pod TCP/UDP byte and packet counters |":
    "| **Fluxos de rede** *(eBPF)* | Contadores de bytes e pacotes TCP/UDP de pod para pod |",
  "| **Workload costs** *(opt-in, `cost.enabled=true`)* | Spend per namespace, workload and pod, with idle capacity and efficiency |":
    "| **Custos dos workloads** *(opcional, `cost.enabled=true`)* | Gasto por namespace, workload e pod, com capacidade ociosa e eficiência |",
  "| **Workload costs** *(on by default)* | Spend per namespace, workload and pod, with idle capacity and efficiency, also as metrics to alert on |":
    "| **Custos dos workloads** *(ativados por padrão)* | Gasto por namespace, workload e pod, com capacidade ociosa e eficiência, também como métricas para alertas |",
  "Your cluster blocks `hostPath` volumes or privileged pods. That is normal on **GKE Autopilot** and **EKS Fargate** — pick that platform at the top of this guide and follow its steps. On **OpenShift** the install succeeds instead, but the agent's node pods never start: pick **Red Hat OpenShift**.":
    "Seu cluster bloqueia volumes `hostPath` ou pods privilegiados. Isso é normal no **GKE Autopilot** e no **EKS Fargate**: escolha essa plataforma no topo deste guia e siga as etapas dela. No **OpenShift**, ao contrário, a instalação funciona, mas os pods de nó do agente nunca iniciam: escolha **Red Hat OpenShift**.",
  "On any other cluster with a restrictive Pod Security policy, remove the failed release:":
    "Em qualquer outro cluster com uma política de Pod Security restritiva, remova a release que falhou:",
  "Then run the install command again with `--set preset=gke-autopilot` added. That preset reads pod logs through the Kubernetes API instead of hostPath, applies a hardened security context, and leaves out the privileged eBPF and profiling pods.":
    "Depois execute o comando de instalação de novo, acrescentando `--set preset=gke-autopilot`. Esse preset lê os logs de pods pela API do Kubernetes em vez de hostPath, aplica um contexto de segurança reforçado e deixa de fora os pods privilegiados de eBPF e de profiling.",
  "1. Check that the agent's pods are running: `kubectl get pods -n oneuptime-agent`":
    "1. Verifique se os pods do agente estão rodando: `kubectl get pods -n oneuptime-agent`",
  "2. Check the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "2. Verifique os logs do coletor: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "3. Verify the OneUptime URL and ingestion key in the install command are correct.":
    "3. Confirme que a URL do OneUptime e a chave de ingestão no comando de instalação estão corretas.",
  "4. Make sure the cluster can reach your OneUptime instance over the network.":
    "4. Garanta que o cluster consegue alcançar sua instância do OneUptime pela rede.",
  "1. Check the AI agent's pod: `kubectl get pods -n oneuptime-agent -l component=ai-agent`":
    "1. Verifique o pod do agente de IA: `kubectl get pods -n oneuptime-agent -l component=ai-agent`",
  "2. Check its logs: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`":
    "2. Verifique os logs dele: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`",
  "3. No pod? Upgrade the chart (see **Upgrade or uninstall the agent** under Advanced) and add `--set aiAgent.enabled=true`.":
    "3. Nenhum pod? Atualize o chart (veja **Atualize ou desinstale o agente** em Avançado) e adicione `--set aiAgent.enabled=true`.",
  "1. Check that the cluster name matches: this guide installs **`my-cluster`**.":
    "1. Verifique se o nome do cluster confere: este guia instala **`my-cluster`**.",
  "2. Verify the agent's RBAC permissions: `kubectl get clusterrolebinding | grep kubernetes-agent`":
    "2. Confirme as permissões RBAC do agente: `kubectl get clusterrolebinding | grep kubernetes-agent`",
  "3. Look for export errors in the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. Procure erros de exportação nos logs do coletor: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "- **Kernel too old or no BTF.** eBPF needs Linux 5.8+ with BTF — check with `uname -r` on a node. If you can't upgrade, turn eBPF off with `--set ebpf.enabled=false`.":
    "- **Kernel antigo demais ou sem BTF.** O eBPF precisa do Linux 5.8+ com BTF; confira com `uname -r` em um nó. Se não puder atualizar, desligue o eBPF com `--set ebpf.enabled=false`.",
  "- **Privileged pods blocked.** Some locked-down clusters reject them. Turn eBPF off.":
    "- **Pods privilegiados bloqueados.** Alguns clusters restritos os rejeitam. Desligue o eBPF.",
  "- **`debugfs` / `tracefs` not available on the host.** Turn off just the TCP stats family: `--set ebpf.features.tcpStats=false`.":
    "- **`debugfs` / `tracefs` indisponíveis no host.** Desligue só a família de estatísticas TCP: `--set ebpf.features.tcpStats=false`.",
  "1. Check the eBPF pods are healthy: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`":
    "1. Verifique se os pods de eBPF estão saudáveis: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`",
  "2. Turn on OBI's debug output to confirm it sees traffic: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, then read `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.":
    "2. Ative a saída de depuração do OBI para confirmar que ele vê tráfego: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, e depois leia `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.",
  "3. If spans show up there but not in OneUptime, check the collector's logs for export errors: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. Se os spans aparecem ali, mas não no OneUptime, procure erros de exportação nos logs do coletor: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "This installs the agent for **`k8s-1`** — keep `clusterName` exactly as it is, or the data registers as a new cluster.":
    "Isso instala o agente para **`k8s-1`**: mantenha `clusterName` exatamente como está, ou os dados serão registrados como um cluster novo.",
  "The AWS CLI (`aws`), signed in to the cluster's account":
    "A CLI da AWS (`aws`), conectada à conta do cluster",
  "The Google Cloud CLI (`gcloud`) with the `gke-gcloud-auth-plugin` component":
    "A CLI do Google Cloud (`gcloud`) com o componente `gke-gcloud-auth-plugin`",
  "The Azure CLI (`az`), signed in to the cluster's subscription":
    "A CLI do Azure (`az`), conectada à assinatura do cluster",
  "OpenShift 4.11 or later, and the OpenShift CLI (`oc`) logged in with cluster-admin rights: the install creates security context constraints":
    "OpenShift 4.11 ou posterior, e a CLI do OpenShift (`oc`) conectada com direitos de cluster-admin: a instalação cria security context constraints",
  "The web console gives the exact command, token included: **Copy login command**, under your user name. Log in as a cluster admin: the install creates security context constraints.":
    "O console web fornece o comando exato, com o token incluído: **Copy login command**, abaixo do seu nome de usuário. Entre como administrador do cluster: a instalação cria security context constraints.",
  "`preset=openshift` creates two security context constraints (SCCs), one for the node collector and one for the eBPF pods, each used only by its own service account. Every other pod runs under OpenShift's default `restricted-v2`, with the user ID OpenShift assigns.":
    "`preset=openshift` cria duas security context constraints (SCCs), uma para o coletor de nós e outra para os pods de eBPF, cada uma usada só pela própria service account. Todos os outros pods rodam sob o `restricted-v2` padrão do OpenShift, com o ID de usuário que o OpenShift atribui.",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. The `-logs` and `-ebpf` pods run under the SCCs the chart created for them: `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf` lists both. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "O coletor e o agente de IA do Kubernetes, mais um pod `-logs` e um pod `-ebpf` em cada nó. Os pods `-logs` e `-ebpf` rodam sob as SCCs que o chart criou para eles: `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf` lista as duas. Quando estiverem `Running`, o cluster aparece automaticamente na seção **Kubernetes**, normalmente em um ou dois minutos.",
  "OpenShift admits a pod only under a security context constraint (SCC) its service account may use, and the release installs either way, so a refused pod simply never appears. Look for the refusal:":
    "O OpenShift só admite um pod sob uma security context constraint (SCC) que a service account dele possa usar, e a release é instalada de qualquer jeito, então um pod recusado simplesmente nunca aparece. Procure a recusa:",
  "- **`unable to validate against any security context constraint`:** the release was installed without the openshift preset, so the chart created no SCCs. `helm get values kubernetes-agent --namespace oneuptime-agent` shows the values it was given. Add the preset:":
    "- **`unable to validate against any security context constraint`:** a release foi instalada sem o preset openshift, então o chart não criou nenhuma SCC. `helm get values kubernetes-agent --namespace oneuptime-agent` mostra os valores que ela recebeu. Adicione o preset:",
  "- **The SCCs are missing:** check with `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf`. Creating them takes cluster-admin rights, so an install by anyone else fails when it gets to them.":
    "- **As SCCs estão faltando:** confira com `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf`. Criá-las exige direitos de cluster-admin, então uma instalação feita por qualquer outra pessoa falha quando chega nelas.",
  "- **`violates PodSecurity`:** the namespace's Pod Security level is stricter than the eBPF pods, which run privileged, need. Label it `pod-security.kubernetes.io/enforce=privileged`, or turn eBPF off with `--set ebpf.enabled=false`.":
    "- **`violates PodSecurity`:** o nível de Pod Security do namespace é mais rígido do que os pods de eBPF, que rodam como privilegiados, precisam. Coloque nele o rótulo `pod-security.kubernetes.io/enforce=privileged`, ou desligue o eBPF com `--set ebpf.enabled=false`.",
  "- **Your cluster admin will not add SCCs:** use the `openshift-restricted` preset. The chart then creates no SCC and every pod runs under `restricted-v2`, so pod logs come through the Kubernetes API, and there are no host metrics, eBPF traces or profiles:":
    "- **Seu administrador do cluster não vai adicionar SCCs:** use o preset `openshift-restricted`. O chart então não cria nenhuma SCC e todos os pods rodam sob `restricted-v2`, então os logs de pods chegam pela API do Kubernetes e não há métricas do host, traces de eBPF nem perfis:",
  "`preset=gke-autopilot` collects pod logs through the Kubernetes API instead of reading them from each node, and leaves out eBPF tracing and profiling, which need privileged pods that GKE Autopilot does not allow.":
    "`preset=gke-autopilot` coleta os logs de pods pela API do Kubernetes em vez de lê-los em cada nó, e deixa de fora o tracing e o profiling de eBPF, que precisam de pods privilegiados que o GKE Autopilot não permite.",
  "The collector, the Kubernetes AI agent and the pod log reader, plus one node collector per node for kubelet metrics. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "O coletor, o agente de IA do Kubernetes e o leitor de logs de pods, mais um coletor de nó por nó para as métricas do kubelet. Quando estiverem `Running`, o cluster aparece automaticamente na seção **Kubernetes**, normalmente em um ou dois minutos.",
  "On other clusters the agent runs [OpenTelemetry eBPF Instrumentation](https://opentelemetry.io/docs/zero-code/obi/) on every node to capture HTTP, gRPC and SQL traces with no code changes. Loading eBPF programs needs privileged pods, which this platform does not allow, so the platform's preset leaves it out, and the continuous profiler with it.":
    "Nos outros clusters, o agente executa o [OpenTelemetry eBPF Instrumentation](https://opentelemetry.io/docs/zero-code/obi/) em cada nó para capturar traces HTTP, gRPC e SQL sem mudanças no código. Carregar programas eBPF exige pods privilegiados, que esta plataforma não permite, então o preset da plataforma deixa isso de fora, e com ele o profiler contínuo.",
  "To get traces here, instrument your services with an [OpenTelemetry SDK](/docs/telemetry/open-telemetry) and send them to OneUptime directly.":
    "Para ter traces aqui, instrumente seus serviços com um [SDK do OpenTelemetry](/docs/telemetry/open-telemetry) e envie-os diretamente ao OneUptime.",
  "| **Pod logs** | stdout/stderr of every container, read through the Kubernetes API |":
    "| **Logs de pods** | stdout/stderr de cada contêiner, lidos pela API do Kubernetes |",
  "Autopilot blocks hostPath, so node metrics that read the host's `/proc` and `/sys` (disk I/O, inodes, NIC errors) are not collected; kubelet and cAdvisor metrics are.":
    "O Autopilot bloqueia o hostPath, então as métricas de nó que leem `/proc` e `/sys` do host (E/S de disco, inodes, erros de NIC) não são coletadas; as métricas de kubelet e cAdvisor são.",
  "Pod logs are read through the Kubernetes API on this platform.":
    "Nesta plataforma, os logs de pods são lidos pela API do Kubernetes.",
  "1. Check that the log reader is ready: `kubectl get pods -n oneuptime-agent -l component=log-collector`":
    "1. Verifique se o leitor de logs está pronto: `kubectl get pods -n oneuptime-agent -l component=log-collector`",
  "3. Its `/healthz` endpoint reports the number of active log streams and the last export error.":
    "3. O endpoint `/healthz` dele informa o número de fluxos de log ativos e o último erro de exportação.",
  "4. On very large clusters one reader can fall behind — split the namespaces across separate releases with `namespaceFilters`.":
    "4. Em clusters muito grandes, um leitor pode ficar para trás: divida os namespaces entre releases separadas com `namespaceFilters`.",
  "The AWS CLI (`aws`) and `eksctl`, signed in to the cluster's account":
    "A CLI da AWS (`aws`) e o `eksctl`, conectados à conta do cluster",
  "Pods run on Fargate only in namespaces a Fargate profile selects. Create one for `oneuptime-agent` — without it the agent's pods stay `Pending`:":
    "No Fargate, os pods só rodam em namespaces que um perfil do Fargate seleciona. Crie um para `oneuptime-agent`: sem ele, os pods do agente ficam em `Pending`:",
  "`preset=eks-fargate` collects pod logs through the Kubernetes API instead of reading them from each node, and leaves out eBPF tracing and profiling, which need privileged pods that EKS Fargate does not allow.":
    "`preset=eks-fargate` coleta os logs de pods pela API do Kubernetes em vez de lê-los em cada nó, e deixa de fora o tracing e o profiling de eBPF, que precisam de pods privilegiados que o EKS Fargate não permite.",
  "Three Deployments — the collector, the Kubernetes AI agent and the pod log reader. Fargate never schedules DaemonSets, so there are no per-node pods. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "Três Deployments: o coletor, o agente de IA do Kubernetes e o leitor de logs de pods. O Fargate nunca agenda DaemonSets, então não há pods por nó. Quando estiverem `Running`, o cluster aparece automaticamente na seção **Kubernetes**, normalmente em um ou dois minutos.",
  "Then remove the Fargate profile: `eksctl delete fargateprofile --cluster <cluster-name> --name oneuptime-agent`.":
    "Depois remova o perfil do Fargate: `eksctl delete fargateprofile --cluster <cluster-name> --name oneuptime-agent`.",
  "Fargate never schedules DaemonSets, so node, pod and container metrics are not available there.":
    "O Fargate nunca agenda DaemonSets, então métricas de nós, pods e contêineres não estão disponíveis ali.",
  "Fargate only schedules pods in namespaces that a Fargate profile selects. Check that one exists for `oneuptime-agent`:":
    "O Fargate só agenda pods em namespaces que um perfil do Fargate seleciona. Verifique se existe um para `oneuptime-agent`:",
  "If there is none, create it. Fargate is chosen when a pod is created, so pods that were already pending stay pending — restart the agent's Deployments once the profile is active:":
    "Se não houver, crie-o. O Fargate é escolhido quando um pod é criado, então pods que já estavam pendentes continuam pendentes: reinicie os Deployments do agente quando o perfil estiver ativo:",
};

export default TRANSLATION;
