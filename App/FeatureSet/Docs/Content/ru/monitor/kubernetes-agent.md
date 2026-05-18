# Установка агента Kubernetes

Агент OneUptime Kubernetes собирает метрики кластера, события, логи Pod, **трассировки приложений (HTTP/gRPC через eBPF)**, **непрерывные flame graph CPU (eBPF profiler)** и **метрики уровня ОС узлов** из вашего кластера Kubernetes и отправляет их в OneUptime. Он распространяется в виде Helm chart и устанавливается одной командой — eBPF auto-instrumentation и профилирование включены по умолчанию, поэтому вы получаете трассировки уровня сервисов, RED-метрики и flame graph без каких-либо изменений в коде.

## Быстрый старт

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

Ваш кластер появится в OneUptime в течение нескольких минут.

## Выбор подходящего пресета для вашего кластера

Разные дистрибутивы Kubernetes имеют разные ограничения — в первую очередь, могут ли рабочие нагрузки монтировать тома `hostPath`. Вместо того чтобы заставлять вас изучать документацию по безопасности, chart предоставляет одну опцию верхнего уровня: `preset`.

| Пресет | Применение | Сбор логов | Примечания |
| --- | --- | --- | --- |
| `standard` (по умолчанию) | Самоуправляемые кластеры, **EKS на EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | DaemonSet читает `/var/log/pods` через hostPath | Минимальные накладные расходы. hostPath доступен на этих платформах. |
| `gke-autopilot` | **GKE Autopilot** | Kubernetes API tailer (Deployment) | hostPath заблокирован в Autopilot. Устанавливает усиленный security context, который проходит Pod Security Standards Autopilot. |
| `eks-fargate` | **EKS Fargate** | Kubernetes API tailer (Deployment) | То же, что и `gke-autopilot`. Fargate блокирует hostPath и DaemonSet. |

Если вы не уверены, оставьте `preset` неустановленным — будут использованы значения `standard` по умолчанию. Если ваш кластер отклоняет установку с ошибкой Pod Security policy, упоминающей `hostPath`, переключитесь на `gke-autopilot` (или `eks-fargate` для EKS Fargate) и переустановите.

### Примеры

**GKE Standard, EKS на EC2, самоуправляемые кластеры или AKS:**

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

## Чем отличаются два режима сбора логов

Под капотом `preset` задаёт `logs.mode` — и вы также можете задать это значение напрямую, если нужно переопределить значение пресета по умолчанию.

### Режим DaemonSet (`logs.mode: daemonset`)

DaemonSet запускает один Pod OpenTelemetry Collector на каждый узел. Он читает файлы логов в `/var/log/pods/` через том hostPath и пересылает их по OTLP.

- **Преимущества:** минимальные накладные расходы, линейное масштабирование с количеством узлов, отсутствие нагрузки на Kubernetes API server, обработка ротации логов.
- **Недостатки:** требуется hostPath, требуется возможность планировать DaemonSet — оба недоступны на GKE Autopilot и EKS Fargate.

### Режим API (`logs.mode: api`)

Deployment с одной репликой (образ `oneuptime/kubernetes-log-tailer`) использует Kubernetes API для стриминга логов контейнеров — тот же endpoint, который использует `kubectl logs -f`. Никаких hostPath, никакого доступа к хосту, никакого DaemonSet.

- **Преимущества:** работает на GKE Autopilot, EKS Fargate и в любом кластере, где заблокирован hostPath или применяется `restricted` Pod Security Standard.
- **Недостатки:** каждый поток контейнера — это долгоживущее соединение с `kube-apiserver`. На практике одна реплика комфортно обслуживает несколько тысяч контейнеров. Для очень больших кластеров шардируйте по пространствам имён, используя `logs.api.replicas` плюс `namespaceFilters.include` на каждой реплике.

### Какой режим использовать?

Если hostPath работает, используйте DaemonSet. Везде остальном — используйте режим API. Настройка `preset` выбирает правильный режим за вас.

Вы также можете полностью отключить сбор логов с помощью `--set logs.enabled=false` и отправлять логи приложений через OpenTelemetry SDK. См. документацию [OpenTelemetry](/docs/telemetry/open-telemetry).

## Трассировки приложений и HTTP-запросы через eBPF (включено по умолчанию)

Chart поставляется с DaemonSet, который запускает [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) на каждом узле. OBI загружает eBPF-программы в ядро Linux и отслеживает трафик уровня сокетов, чтобы реконструировать вызовы HTTP/HTTPS, gRPC и SQL/Redis из каждого Pod на узле — без изменений в коде, без SDK, без sidecar. Перехваченный трафик экспортируется как OTLP-трассировки и метрики запросов/задержки напрямую в OneUptime.

После установки ваши сервисы начинают появляться в разделе **Telemetry → Traces** и на карте сервисов в течение пары минут, причём `k8s.cluster.name` устанавливается равным вашему `clusterName`, что позволяет фильтровать по кластеру.

### Когда это стоит отключить

eBPF **включено по умолчанию**. Вам следует отключить его (`--set ebpf.enabled=false`), если:

- Вы устанавливаете на **GKE Autopilot** или **EKS Fargate**. Эти платформы блокируют привилегированные Pod, а OBI требует режим privileged для загрузки eBPF-программ.
- Ваши узлы работают с ядром старше **Linux 5.8** без бэкпортов BTF. (Современные дистрибутивы — Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL/Stream 9+ — работают нормально.)
- Вы уже отправляете трассировки через OpenTelemetry SDK из ваших приложений и не хотите дубликатов.

### Что отправляется

OBI извлекает несколько семейств сигналов из перехваченного трафика. Все они включены по умолчанию; каждое можно отключить независимо с помощью `--set ebpf.features.<key>=false`:

| Сигнал | По умолчанию | Что добавляет |
| --- | --- | --- |
| `ebpf.features.httpMetrics` | вкл. | RED-метрики HTTP/gRPC — частота запросов, гистограммы задержки, счётчики ошибок — для каждого сервиса. |
| `ebpf.features.spanMetrics` | вкл. | Метрики с ключами по атрибутам span: размер запроса, размер ответа, длительность с разбивкой по маршруту/операции. |
| `ebpf.features.serviceGraph` | вкл. | Метрики рёбер между сервисами (caller → callee частота запросов + задержка). Питает карту сервисов. |
| `ebpf.features.hostMetrics` | вкл. | CPU и память для каждого инструментированного процесса — избавляет от необходимости запускать отдельный профилировщик для базовых вопросов ёмкости. |
| `ebpf.features.networkMetrics` | вкл. | Счётчики байтов и пакетов TCP/UDP потоков между Pod с метаданными k8s. Показывает каждую пару взаимодействующих Pod, включая те, которые используют протоколы, не разбираемые OBI. |
| `ebpf.features.networkInterZoneMetrics` | выкл. | Межзональный вариант метрик сети. Удваивает кардинальность; включать стоит только если вы действительно используете планирование по зонам. |
| `ebpf.features.tcpStats` | вкл. | TCP-статистика уровня узлов: гистограммы RTT, счётчики неудачных соединений, ретрансмиссий. |

OBI также по умолчанию распространяет контекст трассировки через границы сервисов. Когда Pod A делает HTTP/gRPC-запрос к Pod B, OBI вставляет заголовок W3C `traceparent` в исходящий запрос — поэтому результирующий span на стороне Pod B связывается с той же трассировкой, что и исходящий span Pod A. Никаких изменений SDK в обоих приложениях не требуется.

| Опция | По умолчанию | Описание |
| --- | --- | --- |
| `ebpf.contextPropagation` | вкл. | Вставка W3C `traceparent` в исходящий трафик (HTTP-заголовки + кастомная TCP-опция). Установите `false`, чтобы оставить span каждого сервиса локальными. |
| `ebpf.trackRequestHeaders` | вкл. | Отслеживание заголовков запросов на стороне ядра, чтобы распространение также работало на простых HTTP-серверах (не Go, не TLS). Действует только если `contextPropagation` имеет значение true. |

### Корреляция логов и трассировок

Также включено по умолчанию. Энричер логов OBI перехватывает запись в stdout от инструментированных процессов Pod и:

- Для **логов в формате JSON**: вставляет поля `trace_id` и `span_id` в строку (любые существующие значения в логе сохраняются). Затем DaemonSet filelog поднимает эти поля в нативные слоты trace_id/span_id LogRecord, поэтому при клике по span в представлении трассировок происходит переход к его логам в OneUptime — а клик по строке лога переходит к родительской трассировке.
- Для **логов не в формате JSON**: строка сохраняется без изменений — всё равно собирается, просто без автосвязи.

| Опция | По умолчанию | Описание |
| --- | --- | --- |
| `ebpf.logToTraceCorrelation` | вкл. | Включает энричер логов OBI и подъём trace_id в pipeline filelog. Установите `false`, чтобы пропустить и то, и другое. |

Особенности:

- **Логи должны быть в JSON, чтобы trace_id появлялся.** Переключите ваш логгер на JSON-форматтер — `structlog`, `pino`, `winston`, `serilog`, `logback-json`, klog `--logging-format=json` и т.д.
- **Буферизованный stdout ломает корреляцию**, потому что системный вызов `write()` срабатывает в другом потоке, не в том, который обработал запрос. Распространённые решения:
  - **Python**: установите `PYTHONUNBUFFERED=1` (runtime буферизует stdout блоками, если это не TTY).
  - **.NET**: при запуске выполните `Console.SetOut(new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true })`. Microsoft.Extensions.Logging `AddConsole()` и асинхронные sink Serilog тоже не подойдут — переключитесь на синхронный консольный writer (стандартный `WriteTo.Console()` Serilog подходит).
- Greenlet / gevent, Tornado и другие кастомные асинхронные runtime не охватываются.

### Тонкая настройка

| Опция | По умолчанию | Описание |
| --- | --- | --- |
| `ebpf.enabled` | `true` | Главный переключатель. Установите `false`, чтобы полностью пропустить eBPF DaemonSet. |
| `ebpf.image.tag` | `v0.9.0` | Тег образа OBI. OBI до версии 1.0; зафиксируйте проверенную версию и повторно тестируйте при обновлениях. |
| `ebpf.autoTargetExe` | `*` | Glob исполняемых файлов для инструментирования. Сузьте его (например, `*/python,*/java`), если хотите ограничить auto-instrumentation. |
| `ebpf.excludeExePaths` | (shells, kubelet, runc, containerd, otelcol, сам OBI) | Glob через запятую для пропуска. |
| `ebpf.logLevel` | `info` | `debug`, `info`, `warn` или `error`. Установите `debug` при устранении неполадок. |
| `ebpf.printTraces` | `false` | Печатать span в stdout OBI в дополнение к OTLP-экспорту — полезно для проверки захвата при установке. |
| `ebpf.resources.*` | `100m / 256Mi` requests, `1000m / 1Gi` limits | Увеличьте для кластеров с высоким трафиком. |

Чтобы проверить, что OBI работает и видит трафик:

```bash
kubectl get pods -n oneuptime-kubernetes-agent -l component=ebpf-instrument
kubectl logs -n oneuptime-kubernetes-agent -l component=ebpf-instrument --tail=200
```

## Непрерывное профилирование CPU (включено по умолчанию)

Отдельный DaemonSet запускает [OpenTelemetry eBPF Profiler](https://github.com/open-telemetry/opentelemetry-ebpf-profiler) — упакованный как образ `otel/opentelemetry-collector-ebpf-profiler`. Он сэмплирует on-CPU стеки на частоте 19Hz во всех поддерживаемых runtime (Go, Java, .NET, Python, Ruby, Node.js, PHP, Perl, C/C++, Rust) и отправляет OTLP-профили в OneUptime, где они появляются в разделе **Telemetry → Performance Profiles** и в виде flame graph, связанных с отдельными span трассировок.

Когда eBPF auto-instrumentation также включена (`ebpf.enabled: true`, по умолчанию), каждый сэмпл CPU коррелируется с контекстом трассировки OBI через общую карту bpffs — поэтому flame graph несут trace_id/span_id, и UI OneUptime может показать вам flame graph для каждого span.

Требования:

- **Ядро Linux 5.10+** (немного новее, чем 5.8, требуемое OBI).
- Привилегированный Pod с hostPID — те же ограничения, что и у DaemonSet eBPF auto-instrumentation. Отключите на GKE Autopilot, EKS Fargate и в закрытых окружениях: `--set profiling.enabled=false`.

Тонкая настройка:

| Опция | По умолчанию | Описание |
| --- | --- | --- |
| `profiling.enabled` | `true` | Главный переключатель. |
| `profiling.image.tag` | `0.152.0` | Тег образа `otel/opentelemetry-collector-ebpf-profiler`. Профилировщик до версии 1.0; зафиксируйте проверенную версию. |
| `profiling.samplesPerSecond` | `19` | Частота сэмплирования в Hz. Значение по умолчанию из upstream; предотвращает случайное совпадение с распространёнными частотами таймеров. |
| `profiling.offCpuThreshold` | `0` | (0–1] включает off-CPU профилирование — диагностирует конкуренцию за блокировки и блокирующий I/O. По умолчанию выключено, поскольку добавляет накладные расходы tracepoint. |
| `profiling.tracers` | `""` *(все runtime)* | Список языковых трассировщиков через запятую для загрузки. |
| `profiling.obiProcessContext` | `true` | Коррелировать сэмплы с контекстом трассировки OBI для связи trace ↔ профиль. |

## Другой сбор данных (host metrics, audit logs, CSI, CoreDNS)

Chart также может собирать:

| `<key>.enabled` | По умолчанию | Что добавляет |
| --- | --- | --- |
| `hostMetrics` | вкл. | Метрики ОС каждого узла из `/proc` и `/sys` — глубина очереди дискового I/O, использование inode файловой системы, счётчики ошибок NIC, статистика подкачки, средняя нагрузка. Живут внутри DaemonSet сборщика логов (без дополнительных Pod). |
| `auditLogs` | выкл. | Читает `/var/log/kubernetes/audit.log` с хоста. Захватывает каждый запрос к Kubernetes API — кто что сделал с каким ресурсом. Только самоуправляемые кластеры — управляемые K8s (EKS, GKE, AKS, DOKS) направляют audit logs в sink облачного провайдера. |
| `csi` | выкл. | Автоматически обнаруживает Pod с меткой `app=csi-driver` (или `app.kubernetes.io/component=csi-driver`) и собирает Prometheus-порт `metrics` — задержка attach/detach томов, ошибки provisioning, IOPS. |
| `coreDns` | выкл. | Собирает метрики CoreDNS кластера на `:9153/metrics`. Показывает частоту запросов, задержку, частоту попаданий в кэш, счётчики ошибок — частые причины P99-задержки. |

## Общие опции

| Опция | По умолчанию | Описание |
| --- | --- | --- |
| `preset` | (пусто — обрабатывается как `standard`) | См. таблицу выше. |
| `oneuptime.url` | *(обязательно)* | URL вашего инстанса OneUptime. |
| `oneuptime.apiKey` | *(обязательно)* | API-ключ проекта (Settings → API Keys). |
| `clusterName` | *(обязательно)* | Уникальное имя для этого кластера. Записывается как `k8s.cluster.name` в каждой записи. |
| `namespaceFilters.include` | `[]` | Если задано, мониторятся только эти пространства имён. |
| `namespaceFilters.exclude` | `["kube-system"]` | Пространства имён для пропуска. |
| `logs.enabled` | `true` | Включить или выключить сбор логов. |
| `logs.mode` | (выводится из `preset`) | `daemonset`, `api` или `disabled`. Переопределяет пресет. |
| `logs.api.replicas` | `1` | Количество реплик Deployment log-tailer (только в режиме API). |
| `ebpf.enabled` | `true` | Автозахват HTTP/gRPC-трассировок из каждого Pod через OpenTelemetry eBPF Instrumentation. См. раздел выше. |
| `profiling.enabled` | `true` | Непрерывные flame graph CPU через OpenTelemetry eBPF Profiler. См. раздел выше. |
| `hostMetrics.enabled` | `true` | Метрики ОС каждого узла. |
| `auditLogs.enabled` | `false` | Сбор audit logs Kubernetes (самоуправляемые кластеры). |
| `csi.enabled` | `false` | Prometheus-метрики CSI-драйвера. |
| `coreDns.enabled` | `false` | Prometheus-метрики CoreDNS. |
| `controlPlane.enabled` | `false` | Сбор метрик etcd / api-server / scheduler / controller-manager. Только самоуправляемые кластеры — управляемые предложения (EKS/GKE/AKS) обычно не предоставляют эти endpoint. |

Полный список см. в [`values.yaml` chart](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/kubernetes-agent/values.yaml).

## Обновление

```bash
helm repo update
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values
```

`--reuse-values` сохраняет вашу существующую конфигурацию; передавайте любые новые переопределения `--set` поверх неё.

> **Внимание: `--reuse-values` не объединяет новые значения по умолчанию из chart.** Helm повторно использует ваши ранее отрендеренные значения дословно — поэтому любое новое поле верхнего уровня, добавленное в более новой версии chart (например, `profiling.*`, `ebpf.features.*`), остаётся неустановленным в вашем существующем релизе, и шаблон рендерится так, как если бы вы его отключили.
>
> **Helm 3.14+** — переключитесь на `--reset-then-reuse-values`. Эта опция повторно считывает значения chart по умолчанию для ключей, которые вы не переопределяли:
>
> ```bash
> helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
>   --namespace oneuptime-kubernetes-agent \
>   --reset-then-reuse-values
> ```
>
> **Helm 3.13 или ранее** — уберите `--reuse-values` и передайте исходные флаги `--set` (или `-f values.yaml`) явно. Новые значения chart по умолчанию будут применяться ко всему, что вы не переопределяете.
>
> Если Pod нового функционала (например, `kubernetes-agent-profiling-*`) не появляются после обновления, причина почти всегда в этом. `helm get values <release>` показывает, что у Helm есть на самом деле — отсутствие полей в выводе означает, что значения по умолчанию для них не были объединены.

## Удаление

```bash
helm uninstall oneuptime-agent --namespace oneuptime-kubernetes-agent
kubectl delete namespace oneuptime-kubernetes-agent
```

## Устранение неполадок

### Установка завершается ошибкой "hostPath volumes are not allowed"

Ваш кластер блокирует hostPath. Переключитесь на пресет режима API:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values \
  --set preset=gke-autopilot   # or eks-fargate
```

### В OneUptime не отображаются логи

Проверьте Pod агента:

```bash
kubectl get pods -n oneuptime-kubernetes-agent
kubectl logs -n oneuptime-kubernetes-agent -l app.kubernetes.io/part-of=oneuptime --tail=200
```

В режиме API Pod log-tailer предоставляет `/healthz` на порту 13133 — обратитесь к нему через `kubectl port-forward`, чтобы получить снимок статуса экспорта.

### Pod eBPF DaemonSet находится в `CrashLoopBackOff` или не запускается

Проверьте логи Pod OBI:

```bash
kubectl logs -n oneuptime-kubernetes-agent -l component=ebpf-instrument --tail=200
```

Распространённые причины:

- **Слишком старое ядро или отсутствие BTF.** OBI требует Linux 5.8+ с BTF. Проверьте с помощью `uname -r` на узле. Если обновление невозможно, отключите eBPF: `--set ebpf.enabled=false`.
- **Привилегированные Pod заблокированы.** Некоторые кластеры отклоняют привилегированные Pod даже вне Autopilot/Fargate. Отключите eBPF.
- **На дашборде нет трассировок, но OBI работает.** Установите `--set ebpf.printTraces=true` и проверьте stdout OBI — если вы видите там span, проблема в доставке OTLP (проверьте `OTEL_EXPORTER_OTLP_ENDPOINT` и URL/API-ключ OneUptime). Если span не видно, трафик, который наблюдает OBI, может быть полностью зашифрован TLS-библиотекой, которую OBI не может перехватить (например, статически связанной реализацией TLS, которую он не распознаёт).

### В моём кластере слишком много Pod для одной реплики log-tailer (только режим API)

Масштабируйте горизонтально, шардируя пространства имён. Разверните по одному на каждую группу пространств имён:

```bash
helm install oneuptime-agent-ns-a oneuptime/kubernetes-agent \
  --set preset=gke-autopilot \
  --set namespaceFilters.include={app-a,app-b} \
  ...
```

Альтернативно, увеличьте `logs.api.replicas` — но обратите внимание, что каждая реплика обрабатывает все разрешённые пространства имён, поэтому для дедупликации вам всё равно нужен шардинг по пространствам имён.
