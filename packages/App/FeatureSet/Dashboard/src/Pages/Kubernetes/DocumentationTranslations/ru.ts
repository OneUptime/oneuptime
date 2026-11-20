import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Kubernetes setup guide in Russian (#8341): each piece of the English
 * guide's markdown (Pages/Kubernetes/Utils/DocumentationMarkdown.ts) and its
 * Russian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Russian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A Kubernetes cluster running v1.23 or later":
    "Кластер Kubernetes версии v1.23 или новее",
  "`kubectl` and `helm` (v3) installed on your machine":
    "`kubectl` и `helm` (v3), установленные на вашем компьютере",
  "Wrong cluster? Switch with `kubectl config use-context <context-name>`.":
    "Не тот кластер? Переключитесь командой `kubectl config use-context <context-name>`.",
  "Replace `my-cluster` with a name for this cluster, such as `prod-us-east-1`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "Замените `my-cluster` именем этого кластера, например `prod-us-east-1`. Под этим именем кластер отображается в OneUptime, поэтому не меняйте его: новое имя регистрирует новый кластер.",
  "`--set aiAgent.enabled=true` turns **AI investigations** on, as the chart does by default: OneUptime AI investigates incidents and alerts on this cluster with read-only kubectl, through the Kubernetes AI agent.":
    "`--set aiAgent.enabled=true` включает **расследования ИИ**, как и делает chart по умолчанию: ИИ OneUptime расследует инциденты и оповещения этого кластера с помощью kubectl только для чтения через ИИ-агент Kubernetes.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Выберите ключ приёма на шаге 1, чтобы подставить `<YOUR_API_KEY>`.",
  "You should see:": "Вы должны увидеть:",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "Коллектор и ИИ-агент Kubernetes, а также по одному поду `-logs` и `-ebpf` на каждом узле. Когда они перейдут в `Running`, кластер автоматически появится в разделе **Kubernetes**, обычно через минуту-две.",
  "**Kubernetes AI agent (on by default, read-only).** The `kubernetes-agent-ai-agent` pod lets OneUptime AI investigate incidents and alerts on this cluster with read-only kubectl — `get`, `describe`, `logs`, `events`, `top` — using the same API key, and it can change nothing unless you give it write access later. Open the cluster and go to **AI → Agent** to see it. Don't want it? Install with `--set aiAgent.enabled=false` instead of `--set aiAgent.enabled=true`.":
    "**ИИ-агент Kubernetes (включён по умолчанию, только чтение).** Под `kubernetes-agent-ai-agent` позволяет ИИ OneUptime расследовать инциденты и оповещения этого кластера с помощью kubectl только для чтения (`get`, `describe`, `logs`, `events`, `top`) с тем же ключом API, и он ничего не может изменить, пока вы позже не дадите ему права на запись. Откройте кластер и перейдите в **ИИ → Агент**, чтобы его увидеть. Не нужен? Устанавливайте с `--set aiAgent.enabled=false` вместо `--set aiAgent.enabled=true`.",
  "Namespace rules decide what the agent collects from each namespace. To collect pod logs and eBPF data only from `default`, `production` and `staging`:":
    "Правила для пространств имён определяют, что агент собирает из каждого пространства имён. Чтобы собирать журналы подов и данные eBPF только из `default`, `production` и `staging`:",
  "To keep everything but stop the logs of noisy namespaces, exclude them from `podLogs` only:":
    "Чтобы оставить всё, но остановить журналы шумных пространств имён, исключите их только из `podLogs`:",
  "- **Scopes:** `podLogs` (container stdout/stderr), `ebpfDiscovery` (eBPF traces and metrics), `metrics` (namespaced metrics) and `traces` (every span).":
    "- **Области:** `podLogs` (stdout/stderr контейнеров), `ebpfDiscovery` (трассировки и метрики eBPF), `metrics` (метрики с пространством имён) и `traces` (каждый span).",
  "- **Patterns** match the whole namespace name and accept `*`, as in `team-*`. An `exclude` rule always wins over an `include` rule.":
    "- **Шаблоны** сопоставляются с полным именем пространства имён и допускают `*`, как в `team-*`. Правило `exclude` всегда побеждает правило `include`.",
  "- **Setting the rules replaces the default one**, which excludes `kube-system` from `podLogs` and `ebpfDiscovery`. Keep it in your list, as in the second example, if you still want that.":
    "- **Свои правила заменяют правило по умолчанию**, которое исключает `kube-system` из `podLogs` и `ebpfDiscovery`. Оставьте его в своём списке, как во втором примере, если оно вам всё ещё нужно.",
  "- Node and cluster metrics have no namespace, so they are always kept.":
    "- У метрик узлов и кластера нет пространства имён, поэтому они сохраняются всегда.",
  "- `--set-json` needs Helm 3.10 or later.":
    "- `--set-json` требует Helm 3.10 или новее.",
  "**Only send important lines.** Drop pod log lines below a severity before they leave the cluster:":
    "**Отправлять только важные строки.** Отбрасывайте строки журналов подов ниже заданной важности до того, как они покинут кластер:",
  'Accepts `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` and `FATAL`: `WARN` keeps warnings, errors and fatal lines. The severity is read from the log line itself (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes events are never dropped by this.':
    'Принимает `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` и `FATAL`: `WARN` оставляет предупреждения, ошибки и фатальные строки. Важность читается из самой строки журнала (`[ERROR]`, `level=warn`, `"level":"info"`). События Kubernetes этим никогда не отбрасываются.',
  "**Turn pod logs off.** Metrics are not affected — the node collector keeps running for kubelet and cAdvisor metrics, it just stops reading pod logs:":
    "**Отключить журналы подов.** Метрики это не затрагивает: коллектор узлов продолжает работать для метрик kubelet и cAdvisor и лишь перестаёт читать журналы подов:",
  "**Change how logs are read.** The preset picks this for you; an explicit `logs.mode` always wins over it:":
    "**Изменить способ чтения журналов.** Preset выбирает его за вас; явный `logs.mode` всегда имеет приоритет:",
  "- `logs.mode=daemonset` — reads `/var/log/pods` on every node through hostPath (lowest overhead; needs hostPath).":
    "- `logs.mode=daemonset`: читает `/var/log/pods` на каждом узле через hostPath (наименьшие накладные расходы; требуется hostPath).",
  "- `logs.mode=api` — a Deployment tails pod logs through the Kubernetes API (works on any cluster).":
    "- `logs.mode=api`: Deployment отслеживает журналы подов через API Kubernetes (работает в любом кластере).",
  "- `logs.mode=disabled` — no pod logs.":
    "- `logs.mode=disabled`: без журналов подов.",
  "That reads the API server, where it answers inside the cluster. etcd, the scheduler and the controller manager answer on the control-plane nodes, which the agent's pod cannot guess, so it reads them once you list each node's address:":
    "Так читается API-сервер, там, где он отвечает внутри кластера. etcd, планировщик и диспетчер контроллеров отвечают на узлах плоскости управления, которые под агента угадать не может, поэтому он читает их, как только вы укажете адрес каждого узла:",
  "- **The scheduler and the controller manager** serve HTTPS and accept the agent's token, but kubeadm binds them to `127.0.0.1`: give them a `--bind-address` the agent's pod can reach.":
    "- **Планировщик и диспетчер контроллеров** отдают HTTPS и принимают токен агента, но kubeadm привязывает их к `127.0.0.1`: задайте им `--bind-address`, доступный поду агента.",
  "- **etcd** serves its metrics in plain HTTP on kubeadm's `--listen-metrics-urls` (port 2381, bound to `127.0.0.1` until you add the node's address), as above. Or scrape its HTTPS client port, 2379, with the client certificate it asks for: put `ca.crt`, `tls.crt` and `tls.key` in a Secret in `oneuptime-agent` and name it in `controlPlane.etcd.clientCertSecret`.":
    "- **etcd** отдаёт свои метрики по обычному HTTP на `--listen-metrics-urls` kubeadm (порт 2381, привязанный к `127.0.0.1`, пока вы не добавите адрес узла), как показано выше. Или опрашивайте его клиентский порт HTTPS, 2379, с клиентским сертификатом, который он запрашивает: поместите `ca.crt`, `tls.crt` и `tls.key` в Secret в `oneuptime-agent` и укажите его в `controlPlane.etcd.clientCertSecret`.",
  "Only for self-managed clusters: managed services (EKS, GKE, AKS) do not expose their control plane metrics.":
    "Только для самостоятельно управляемых кластеров: управляемые сервисы (EKS, GKE, AKS) не открывают метрики своей плоскости управления.",
  "Cost monitoring is on by default: the agent bundles the open-source OpenCost engine (plus the small Prometheus it needs), prices your nodes and volumes from your cloud provider's public list prices — no credentials required — and sends what each namespace and workload costs. The first data appears on the cluster's overview and Costs page after the first full hour.":
    "Мониторинг затрат включён по умолчанию: агент включает открытый движок OpenCost (и небольшой Prometheus, который ему нужен), рассчитывает стоимость ваших узлов и томов по публичным прайс-листам вашего облачного провайдера, без учётных данных, и отправляет, сколько стоит каждое пространство имён и каждая рабочая нагрузка. Первые данные появляются в обзоре кластера и на его странице «Затраты» после первого полного часа.",
  "On an agent installed before it was on by default, upgrade it:":
    "Если агент был установлен до того, как мониторинг затрат стал включаться по умолчанию, обновите его:",
  "- **Turn it off:** add `--set cost.enabled=false` to the same upgrade.":
    "- **Отключение:** добавьте `--set cost.enabled=false` в ту же команду обновления.",
  "Cost monitoring is off by default on this platform: it bills every pod by what it requests, so the three cost pods would add to your bill, and OpenCost prices nodes rather than pods. To turn it on anyway:":
    "На этой платформе мониторинг затрат по умолчанию выключен: она выставляет счёт за каждый под по запрошенным им ресурсам, поэтому три пода затрат увеличили бы ваш счёт, а OpenCost оценивает узлы, а не поды. Чтобы всё же включить его:",
  "That alone is a complete install: the chart bundles the open-source OpenCost engine (plus the small Prometheus it needs) and prices your nodes and volumes from your cloud provider's public list prices — no credentials required. It adds three small pods; the first data appears after the first full hour.":
    "Уже одно это и есть полная установка: chart включает открытый движок OpenCost (и небольшой Prometheus, который ему нужен) и рассчитывает стоимость ваших узлов и томов по публичным прайс-листам вашего облачного провайдера, без учётных данных. Он добавляет три небольших пода; первые данные появляются после первого полного часа.",
  "- **Already running Kubecost or OpenCost?** The agent finds it and reads it instead of the bundled engine, and the cluster's overview says so: add `--set cost.engine.url=auto` to stop bundling a second one.":
    "- **Уже используете Kubecost или OpenCost?** Агент находит его и читает вместо встроенного движка, а обзор кластера сообщает об этом: добавьте `--set cost.engine.url=auto`, чтобы не устанавливать второй движок.",
  "- **On-prem or bare metal?** Set a rate card with `--set cost.opencost.customPricing.enabled=true` (USD per resource-hour — see the chart's `values.yaml`).":
    "- **Свои серверы или bare metal?** Задайте тарифы с помощью `--set cost.opencost.customPricing.enabled=true` (USD за час ресурса; см. `values.yaml` chart).",
  "Full guide: [Kubernetes Cost Observability](/docs/telemetry/kubernetes-cost).":
    "Полное руководство: [Наблюдаемость затрат Kubernetes](/docs/telemetry/kubernetes-cost).",
  "The agent runs [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) on every node. It captures HTTP/HTTPS, gRPC and SQL/Redis traffic from Go, .NET, Java, Node.js, Python, Ruby and Rust services — no SDK and no sidecar — and ships traces, request (RED) metrics and service-graph data through the collector.":
    "Агент запускает [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) на каждом узле. Она перехватывает трафик HTTP/HTTPS, gRPC и SQL/Redis от сервисов на Go, .NET, Java, Node.js, Python, Ruby и Rust, без SDK и без sidecar, и отправляет трассировки, метрики запросов (RED) и данные графа сервисов через коллектор.",
  "**Requirements:** Linux kernel **5.8+** with BTF (the default on Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). The eBPF pods run **privileged**, which they need to load eBPF programs.":
    "**Требования:** ядро Linux **5.8+** с BTF (по умолчанию в Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). Поды eBPF работают в **привилегированном** режиме, который нужен им для загрузки программ eBPF.",
  "**Turn it off** if your nodes run an older kernel, if privileged pods are not allowed, or if your services already send traces with OpenTelemetry SDKs and you don't want duplicates:":
    "**Отключите её**, если на узлах старое ядро, если привилегированные поды запрещены или если ваши сервисы уже отправляют трассировки через SDK OpenTelemetry и вам не нужны дубликаты:",
  "**Choose the signals.** Each family is switched with `--set ebpf.features.<name>=false` (or `=true`):":
    "**Выбрать сигналы.** Каждое семейство включается или отключается через `--set ebpf.features.<name>=false` (или `=true`):",
  "| `ebpf.features.*` | Default | What it adds |":
    "| `ebpf.features.*` | По умолчанию | Что добавляет |",
  "| `httpMetrics` | on | HTTP/gRPC request rate, errors and latency per service |":
    "| `httpMetrics` | вкл. | Частота запросов HTTP/gRPC, ошибки и задержка по сервисам |",
  "| `spanMetrics` | on | Span call count and duration (`traces.span.metrics.*`) |":
    "| `spanMetrics` | вкл. | Число вызовов и длительность span-ов (`traces.span.metrics.*`) |",
  "| `serviceGraph` | on | Caller → callee edges; drives the service map |":
    "| `serviceGraph` | вкл. | Рёбра вызывающий → вызываемый; строит карту сервисов |",
  "| `networkMetrics` | on | Pod-to-pod TCP/UDP flow counters |":
    "| `networkMetrics` | вкл. | Счётчики потоков TCP/UDP между подами |",
  "| `networkInterZoneMetrics` | off | Inter-zone network metrics (doubles their cardinality) |":
    "| `networkInterZoneMetrics` | выкл. | Сетевые метрики между зонами (удваивает их кардинальность) |",
  "| `tcpStats` | on | Node-level TCP RTT, failed-connection and retransmit counters |":
    "| `tcpStats` | вкл. | RTT TCP и счётчики неудачных соединений и повторных передач на уровне узла |",
  "**Cross-service trace propagation** — linking a request that crosses pod A → pod B into a single trace, on another node too — is **on by default**. It works by rewriting traffic that is already in flight (widening plaintext HTTP requests in the kernel, and appending a TCP option to TLS and raw TCP), and a mistake in that byte accounting desynchronizes the stream — the reported symptom is transfers through an L7 proxy such as nginx hanging once a response passes ~64KB. If you see that, or a service mesh starts failing pods, turn it off with `--set ebpf.contextPropagation=false`; an OpenTelemetry SDK propagates `traceparent` in userspace without any of that.":
    "**Сквозное распространение трассировок между сервисами** (связывание в одну трассировку запроса, идущего из пода A → под B, в том числе на другом узле) **включено по умолчанию**. Оно работает, переписывая уже идущий трафик (расширяя открытые HTTP-запросы в ядре и добавляя опцию TCP к TLS и чистому TCP), и ошибка в этом подсчёте байтов рассинхронизирует поток: заявленный симптом — передачи через прокси L7, например nginx, которые зависают, как только ответ превышает ~64KB. Если вы это видите или service mesh начинает ронять поды, отключите его с помощью `--set ebpf.contextPropagation=false`; SDK OpenTelemetry распространяет `traceparent` в пространстве пользователя без всего этого.",
  "Each `oneuptime.labels.<key>=<value>` becomes the label `<key>:<value>` on the cluster, and on the services and hosts it reports. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Каждая `oneuptime.labels.<key>=<value>` становится меткой `<key>:<value>` на кластере, а также на сервисах и хостах, о которых он сообщает. Метки сравниваются без учёта регистра, поэтому существующая метка `Production` используется повторно; метки, добавленные в интерфейсе OneUptime, агент никогда не удаляет.",
  "**Upgrade** to the latest chart. `--reset-then-reuse-values` (Helm 3.14+) keeps the values you set (preset, cluster name, filters) and takes everything else from the new chart; add any new `--set` flags on top of it:":
    "**Обновите** chart до последней версии. `--reset-then-reuse-values` (Helm 3.14+) сохраняет заданные вами значения (preset, имя кластера, фильтры) и берёт всё остальное из нового chart; добавьте сверху любые новые флаги `--set`:",
  "On Helm 3.13 and earlier, upgrade with the values you set instead:":
    "В Helm 3.13 и старше обновляйте вместо этого с заданными вами значениями:",
  "Don't use `--reuse-values`: it also keeps the defaults of the chart you upgrade from, so a newer chart's defaults (its eBPF image among them) never apply.":
    "Не используйте `--reuse-values`: он сохраняет и значения по умолчанию chart, с которого вы обновляетесь, поэтому значения по умолчанию более нового chart (среди них его образ eBPF) так и не применяются.",
  "**Uninstall** the agent and its namespace:":
    "**Удалите** агент и его пространство имён:",
  "| Category | Data |": "| Категория | Данные |",
  "| **Node metrics** | CPU, memory, filesystem and network usage |":
    "| **Метрики узлов** | Использование CPU, памяти, файловой системы и сети |",
  "| **Pod and container metrics** | CPU, memory, network I/O and restarts |":
    "| **Метрики подов и контейнеров** | CPU, память, сетевой ввод-вывод и перезапуски |",
  "| **Cluster metrics** | Node conditions, allocatable resources, pod and workload counts |":
    "| **Метрики кластера** | Состояния узлов, выделяемые ресурсы, число подов и рабочих нагрузок |",
  "| **Kubernetes events** | Warnings, errors and scheduling events |":
    "| **События Kubernetes** | Предупреждения, ошибки и события планирования |",
  "| **Pod logs** | stdout/stderr of every container, read from each node |":
    "| **Журналы подов** | stdout/stderr каждого контейнера, прочитанные на каждом узле |",
  "| **Application traces** *(eBPF)* | HTTP, gRPC and SQL/Redis spans from every pod — no SDK or code changes |":
    "| **Трассировки приложений** *(eBPF)* | Span-ы HTTP, gRPC и SQL/Redis от каждого пода, без SDK и изменений кода |",
  "| **Request metrics and service graph** *(eBPF)* | Request rate, errors and latency per service, and caller → callee edges for the service map |":
    "| **Метрики запросов и граф сервисов** *(eBPF)* | Частота запросов, ошибки и задержка по сервисам, а также рёбра вызывающий → вызываемый для карты сервисов |",
  "| **Network flows** *(eBPF)* | Pod-to-pod TCP/UDP byte and packet counters |":
    "| **Сетевые потоки** *(eBPF)* | Счётчики байтов и пакетов TCP/UDP между подами |",
  "| **Workload costs** *(opt-in, `cost.enabled=true`)* | Spend per namespace, workload and pod, with idle capacity and efficiency |":
    "| **Затраты рабочих нагрузок** *(по выбору, `cost.enabled=true`)* | Расходы по пространствам имён, рабочим нагрузкам и подам, с простаивающей мощностью и эффективностью |",
  "| **Workload costs** *(on by default)* | Spend per namespace, workload and pod, with idle capacity and efficiency, also as metrics to alert on |":
    "| **Затраты рабочих нагрузок** *(включены по умолчанию)* | Расходы по пространствам имён, рабочим нагрузкам и подам, с простаивающей мощностью и эффективностью, а также в виде метрик для оповещений |",
  "Your cluster blocks `hostPath` volumes or privileged pods. That is normal on **GKE Autopilot** and **EKS Fargate** — pick that platform at the top of this guide and follow its steps. On **OpenShift** the install succeeds instead, but the agent's node pods never start: pick **Red Hat OpenShift**.":
    "Ваш кластер блокирует тома `hostPath` или привилегированные поды. Это нормально для **GKE Autopilot** и **EKS Fargate**: выберите эту платформу вверху этого руководства и выполните её шаги. В **OpenShift**, напротив, установка проходит, но поды узлов агента так и не запускаются: выберите **Red Hat OpenShift**.",
  "On any other cluster with a restrictive Pod Security policy, remove the failed release:":
    "В любом другом кластере с ограничительной политикой Pod Security удалите неудавшийся релиз:",
  "Then run the install command again with `--set preset=gke-autopilot` added. That preset reads pod logs through the Kubernetes API instead of hostPath, applies a hardened security context, and leaves out the privileged eBPF and profiling pods.":
    "Затем снова выполните команду установки, добавив `--set preset=gke-autopilot`. Этот preset читает журналы подов через API Kubernetes вместо hostPath, применяет усиленный контекст безопасности и не устанавливает привилегированные поды eBPF и профилирования.",
  "1. Check that the agent's pods are running: `kubectl get pods -n oneuptime-agent`":
    "1. Проверьте, что поды агента запущены: `kubectl get pods -n oneuptime-agent`",
  "2. Check the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "2. Проверьте журналы коллектора: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "3. Verify the OneUptime URL and ingestion key in the install command are correct.":
    "3. Убедитесь, что URL OneUptime и ключ приёма в команде установки указаны верно.",
  "4. Make sure the cluster can reach your OneUptime instance over the network.":
    "4. Убедитесь, что кластер может достучаться до вашего экземпляра OneUptime по сети.",
  "1. Check the AI agent's pod: `kubectl get pods -n oneuptime-agent -l component=ai-agent`":
    "1. Проверьте под ИИ-агента: `kubectl get pods -n oneuptime-agent -l component=ai-agent`",
  "2. Check its logs: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`":
    "2. Проверьте его журналы: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`",
  "3. No pod? Upgrade the chart (see **Upgrade or uninstall the agent** under Advanced) and add `--set aiAgent.enabled=true`.":
    "3. Пода нет? Обновите chart (см. **Обновление или удаление агента** в разделе Расширенный) и добавьте `--set aiAgent.enabled=true`.",
  "1. Check that the cluster name matches: this guide installs **`my-cluster`**.":
    "1. Проверьте, совпадает ли имя кластера: это руководство устанавливает **`my-cluster`**.",
  "2. Verify the agent's RBAC permissions: `kubectl get clusterrolebinding | grep kubernetes-agent`":
    "2. Проверьте права RBAC агента: `kubectl get clusterrolebinding | grep kubernetes-agent`",
  "3. Look for export errors in the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. Поищите ошибки экспорта в журналах коллектора: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "- **Kernel too old or no BTF.** eBPF needs Linux 5.8+ with BTF — check with `uname -r` on a node. If you can't upgrade, turn eBPF off with `--set ebpf.enabled=false`.":
    "- **Ядро слишком старое или без BTF.** eBPF требует Linux 5.8+ с BTF; проверьте командой `uname -r` на узле. Если обновить нельзя, отключите eBPF с помощью `--set ebpf.enabled=false`.",
  "- **Privileged pods blocked.** Some locked-down clusters reject them. Turn eBPF off.":
    "- **Привилегированные поды заблокированы.** Некоторые закрытые кластеры их отклоняют. Отключите eBPF.",
  "- **`debugfs` / `tracefs` not available on the host.** Turn off just the TCP stats family: `--set ebpf.features.tcpStats=false`.":
    "- **`debugfs` / `tracefs` недоступны на хосте.** Отключите только семейство статистики TCP: `--set ebpf.features.tcpStats=false`.",
  "1. Check the eBPF pods are healthy: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`":
    "1. Проверьте, что поды eBPF исправны: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`",
  "2. Turn on OBI's debug output to confirm it sees traffic: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, then read `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.":
    "2. Включите отладочный вывод OBI, чтобы убедиться, что она видит трафик: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, затем прочитайте `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.",
  "3. If spans show up there but not in OneUptime, check the collector's logs for export errors: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. Если span-ы появляются там, но не в OneUptime, поищите ошибки экспорта в журналах коллектора: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "This installs the agent for **`k8s-1`** — keep `clusterName` exactly as it is, or the data registers as a new cluster.":
    "Это устанавливает агент для **`k8s-1`**: оставьте `clusterName` ровно таким, как есть, иначе данные зарегистрируются как новый кластер.",
  "The AWS CLI (`aws`), signed in to the cluster's account":
    "AWS CLI (`aws`), с выполненным входом в учётную запись кластера",
  "The Google Cloud CLI (`gcloud`) with the `gke-gcloud-auth-plugin` component":
    "Google Cloud CLI (`gcloud`) с компонентом `gke-gcloud-auth-plugin`",
  "The Azure CLI (`az`), signed in to the cluster's subscription":
    "Azure CLI (`az`), с выполненным входом в подписку кластера",
  "OpenShift 4.11 or later, and the OpenShift CLI (`oc`) logged in with cluster-admin rights: the install creates security context constraints":
    "OpenShift 4.11 или новее и OpenShift CLI (`oc`) с выполненным входом с правами cluster-admin: установка создаёт security context constraints",
  "The web console gives the exact command, token included: **Copy login command**, under your user name. Log in as a cluster admin: the install creates security context constraints.":
    "Веб-консоль выдаёт точную команду вместе с токеном: **Copy login command** под вашим именем пользователя. Войдите как администратор кластера: установка создаёт security context constraints.",
  "`preset=openshift` creates two security context constraints (SCCs), one for the node collector and one for the eBPF pods, each used only by its own service account. Every other pod runs under OpenShift's default `restricted-v2`, with the user ID OpenShift assigns.":
    "`preset=openshift` создаёт два security context constraints (SCC): один для коллектора узлов и один для подов eBPF, каждый используется только своей сервисной учётной записью. Все остальные поды работают под стандартным для OpenShift `restricted-v2`, с идентификатором пользователя, который назначает OpenShift.",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. The `-logs` and `-ebpf` pods run under the SCCs the chart created for them: `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf` lists both. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "Коллектор и ИИ-агент Kubernetes, а также по одному поду `-logs` и `-ebpf` на каждом узле. Поды `-logs` и `-ebpf` работают под SCC, созданными для них chart: `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf` показывает оба. Когда они перейдут в `Running`, кластер автоматически появится в разделе **Kubernetes**, обычно через минуту-две.",
  "OpenShift admits a pod only under a security context constraint (SCC) its service account may use, and the release installs either way, so a refused pod simply never appears. Look for the refusal:":
    "OpenShift допускает под только под security context constraint (SCC), которую может использовать его сервисная учётная запись, а релиз устанавливается в любом случае, поэтому отклонённый под просто никогда не появляется. Найдите отказ:",
  "- **`unable to validate against any security context constraint`:** the release was installed without the openshift preset, so the chart created no SCCs. `helm get values kubernetes-agent --namespace oneuptime-agent` shows the values it was given. Add the preset:":
    "- **`unable to validate against any security context constraint`:** релиз был установлен без preset openshift, поэтому chart не создал ни одной SCC. `helm get values kubernetes-agent --namespace oneuptime-agent` показывает значения, которые он получил. Добавьте preset:",
  "- **The SCCs are missing:** check with `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf`. Creating them takes cluster-admin rights, so an install by anyone else fails when it gets to them.":
    "- **SCC отсутствуют:** проверьте командой `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf`. Для их создания нужны права cluster-admin, поэтому установка, выполненная кем-то другим, на них и завершается ошибкой.",
  "- **`violates PodSecurity`:** the namespace's Pod Security level is stricter than the eBPF pods, which run privileged, need. Label it `pod-security.kubernetes.io/enforce=privileged`, or turn eBPF off with `--set ebpf.enabled=false`.":
    "- **`violates PodSecurity`:** уровень Pod Security пространства имён строже, чем нужно подам eBPF, которые работают в привилегированном режиме. Поставьте на него метку `pod-security.kubernetes.io/enforce=privileged` или отключите eBPF с помощью `--set ebpf.enabled=false`.",
  "- **Your cluster admin will not add SCCs:** use the `openshift-restricted` preset. The chart then creates no SCC and every pod runs under `restricted-v2`, so pod logs come through the Kubernetes API, and there are no host metrics, eBPF traces or profiles:":
    "- **Администратор кластера не добавит SCC:** используйте preset `openshift-restricted`. Тогда chart не создаёт ни одной SCC и все поды работают под `restricted-v2`, поэтому журналы подов приходят через API Kubernetes, а метрик хоста, трассировок eBPF и профилей нет:",
  "`preset=gke-autopilot` collects pod logs through the Kubernetes API instead of reading them from each node, and leaves out eBPF tracing and profiling, which need privileged pods that GKE Autopilot does not allow.":
    "`preset=gke-autopilot` собирает журналы подов через API Kubernetes, а не читает их на каждом узле, и не включает трассировку и профилирование eBPF, которым нужны привилегированные поды, запрещённые в GKE Autopilot.",
  "The collector, the Kubernetes AI agent and the pod log reader, plus one node collector per node for kubelet metrics. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "Коллектор, ИИ-агент Kubernetes и читатель журналов подов, а также по одному коллектору на узел для метрик kubelet. Когда они перейдут в `Running`, кластер автоматически появится в разделе **Kubernetes**, обычно через минуту-две.",
  "On other clusters the agent runs [OpenTelemetry eBPF Instrumentation](https://opentelemetry.io/docs/zero-code/obi/) on every node to capture HTTP, gRPC and SQL traces with no code changes. Loading eBPF programs needs privileged pods, which this platform does not allow, so the platform's preset leaves it out, and the continuous profiler with it.":
    "В других кластерах агент запускает [OpenTelemetry eBPF Instrumentation](https://opentelemetry.io/docs/zero-code/obi/) на каждом узле, чтобы перехватывать трассировки HTTP, gRPC и SQL без изменений кода. Загрузка программ eBPF требует привилегированных подов, которые эта платформа запрещает, поэтому preset платформы её не включает, а вместе с ней и непрерывный профилировщик.",
  "To get traces here, instrument your services with an [OpenTelemetry SDK](/docs/telemetry/open-telemetry) and send them to OneUptime directly.":
    "Чтобы получать трассировки здесь, инструментируйте свои сервисы с помощью [SDK OpenTelemetry](/docs/telemetry/open-telemetry) и отправляйте их прямо в OneUptime.",
  "| **Pod logs** | stdout/stderr of every container, read through the Kubernetes API |":
    "| **Журналы подов** | stdout/stderr каждого контейнера, прочитанные через API Kubernetes |",
  "Autopilot blocks hostPath, so node metrics that read the host's `/proc` and `/sys` (disk I/O, inodes, NIC errors) are not collected; kubelet and cAdvisor metrics are.":
    "Autopilot блокирует hostPath, поэтому метрики узлов, читающие `/proc` и `/sys` хоста (дисковый ввод-вывод, inode, ошибки сетевых карт), не собираются; метрики kubelet и cAdvisor собираются.",
  "Pod logs are read through the Kubernetes API on this platform.":
    "На этой платформе журналы подов читаются через API Kubernetes.",
  "1. Check that the log reader is ready: `kubectl get pods -n oneuptime-agent -l component=log-collector`":
    "1. Проверьте, что читатель журналов готов: `kubectl get pods -n oneuptime-agent -l component=log-collector`",
  "3. Its `/healthz` endpoint reports the number of active log streams and the last export error.":
    "3. Его конечная точка `/healthz` сообщает число активных потоков журналов и последнюю ошибку экспорта.",
  "4. On very large clusters one reader can fall behind — split the namespaces across separate releases with `namespaceFilters`.":
    "4. В очень больших кластерах один читатель может отставать: распределите пространства имён по отдельным релизам с помощью `namespaceFilters`.",
  "The AWS CLI (`aws`) and `eksctl`, signed in to the cluster's account":
    "AWS CLI (`aws`) и `eksctl`, с выполненным входом в учётную запись кластера",
  "Pods run on Fargate only in namespaces a Fargate profile selects. Create one for `oneuptime-agent` — without it the agent's pods stay `Pending`:":
    "В Fargate поды запускаются только в пространствах имён, которые выбирает профиль Fargate. Создайте его для `oneuptime-agent`: без него поды агента остаются в `Pending`:",
  "`preset=eks-fargate` collects pod logs through the Kubernetes API instead of reading them from each node, and leaves out eBPF tracing and profiling, which need privileged pods that EKS Fargate does not allow.":
    "`preset=eks-fargate` собирает журналы подов через API Kubernetes, а не читает их на каждом узле, и не включает трассировку и профилирование eBPF, которым нужны привилегированные поды, запрещённые в EKS Fargate.",
  "Three Deployments — the collector, the Kubernetes AI agent and the pod log reader. Fargate never schedules DaemonSets, so there are no per-node pods. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "Три Deployment: коллектор, ИИ-агент Kubernetes и читатель журналов подов. Fargate никогда не планирует DaemonSet, поэтому подов на каждом узле нет. Когда они перейдут в `Running`, кластер автоматически появится в разделе **Kubernetes**, обычно через минуту-две.",
  "Then remove the Fargate profile: `eksctl delete fargateprofile --cluster <cluster-name> --name oneuptime-agent`.":
    "Затем удалите профиль Fargate: `eksctl delete fargateprofile --cluster <cluster-name> --name oneuptime-agent`.",
  "Fargate never schedules DaemonSets, so node, pod and container metrics are not available there.":
    "Fargate никогда не планирует DaemonSet, поэтому метрики узлов, подов и контейнеров там недоступны.",
  "Fargate only schedules pods in namespaces that a Fargate profile selects. Check that one exists for `oneuptime-agent`:":
    "Fargate планирует поды только в пространствах имён, которые выбирает профиль Fargate. Проверьте, что для `oneuptime-agent` такой профиль есть:",
  "If there is none, create it. Fargate is chosen when a pod is created, so pods that were already pending stay pending — restart the agent's Deployments once the profile is active:":
    "Если его нет, создайте. Fargate выбирается при создании пода, поэтому поды, которые уже ожидали, продолжают ожидать: перезапустите Deployment агента, как только профиль станет активным:",
};

export default TRANSLATION;
