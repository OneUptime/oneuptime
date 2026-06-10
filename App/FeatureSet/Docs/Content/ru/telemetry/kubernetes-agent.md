# Агент OneUptime для Kubernetes (Helm)

## Обзор

Агент OneUptime для Kubernetes — это готовый Helm-чарт, который устанавливает в вашем кластере конвейер сбора данных на основе OpenTelemetry. Он передаёт метрики узлов, подов, контейнеров и кластера; события Kubernetes; логи подов; а при включённом по умолчанию eBPF — трассировки приложений, HTTP RED-метрики, данные графа сервисов и метрики сетевого трафика между подами. Никаких изменений в коде, никаких SDK, одна команда `helm install`.

Эта страница — **руководство по установке**. О настройке мониторов и оповещений Kubernetes поверх данных, собираемых агентом, см. [Агент Kubernetes (мониторы)](/docs/monitor/kubernetes-agent).

## Предварительные требования

- Запущенный кластер Kubernetes (v1.23+)
- `kubectl`, настроенный для доступа к вашему кластеру
- Установленный `helm` v3
- **API-ключ OneUptime** — создайте его в разделе *Project Settings → API Keys*

## Шаг 1 — Добавьте Helm-репозиторий OneUptime

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm repo update
```

## Шаг 2 — Выберите пресет для вашего кластера

Чарт предоставляет единственный параметр верхнего уровня — `preset` — который выбирает совместимые значения по умолчанию для вашего дистрибутива Kubernetes. Он управляет тем, что иначе пришлось бы настраивать вручную: передавать ли логи через DaemonSet с hostPath или через Kubernetes API, и какой контекст безопасности применять.

| `preset` | Использовать для | Сбор логов |
|---|---|---|
| `standard` *(по умолчанию)* | Самоуправляемые кластеры, **EKS на EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | DaemonSet, читающий `/var/log/pods` через hostPath (наименьшие накладные расходы) |
| `gke-autopilot` | **GKE Autopilot** | Deployment, считывающий логи через Kubernetes API (без hostPath, без доступа к хосту) |
| `eks-fargate` | **EKS Fargate** | Deployment, считывающий логи через Kubernetes API (без hostPath, без доступа к хосту) |

Если вы не уверены, начните с `standard`. Если установка завершается ошибкой Pod Security с упоминанием `hostPath`, повторно запустите с `preset=gke-autopilot` (или `eks-fargate` на Fargate), и всё заработает.

## Шаг 3 — Установите агент Kubernetes

Замените `YOUR_ONEUPTIME_URL`, `YOUR_ONEUPTIME_API_KEY` и имя кластера на значения для вашей среды. Имя кластера — это то, как кластер будет отображаться в OneUptime; выберите что-то стабильное, например `prod-us-east-1`.

### Стандартные кластеры (самоуправляемые, EKS на EC2, GKE Standard, AKS)

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

## Шаг 4 — Проверьте установку

Убедитесь, что поды агента запущены:

```bash
kubectl get pods -n oneuptime-agent
```

В **стандартном** кластере вы увидите Deployment сборщика метрик плюс один под DaemonSet сборщика логов на каждый узел:

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-xxxxx                   1/1     Running   0          1m
kubernetes-agent-logs-yyyyy                   1/1     Running   0          1m
```

В **GKE Autopilot** или **EKS Fargate** вы увидите вместо этого два Deployment (без DaemonSet):

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-yyyyyyyyyy-yyyyy        1/1     Running   0          1m
```

После подключения агента ваш кластер автоматически появится в разделе **Kubernetes** панели управления OneUptime.

## Параметры конфигурации

### Фильтрация пространств имён

По умолчанию `kube-system` исключён. Чтобы мониторить только определённые пространства имён:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set "namespaceFilters.include={default,production,staging}"
```

### Отключение сбора логов

Если вам нужны только метрики и события (без логов подов):

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set logs.enabled=false
```

### Принудительный выбор режима сбора логов

Продвинутые пользователи могут переопределить выбор пресета с помощью `logs.mode`:

- `logs.mode=daemonset` — DaemonSet с hostPath (наименьшие накладные расходы, требует hostPath)
- `logs.mode=api` — Deployment, считывающий логи через Kubernetes API (работает в любом кластере)
- `logs.mode=disabled` — без сбора логов

Явно заданный `logs.mode` всегда имеет приоритет над значением пресета по умолчанию. Используйте это, если вы знаете свой кластер лучше, чем пресет.

### Включение мониторинга управляющего слоя (control plane)

Для самоуправляемых кластеров (не EKS / GKE / AKS) вы можете включить метрики управляющего слоя:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set controlPlane.enabled=true
```

> Управляемые сервисы Kubernetes (EKS, GKE, AKS) обычно не предоставляют метрики управляющего слоя. Включайте это только для самоуправляемых кластеров.

### Автоматическая разметка метками проекта

Любой атрибут ресурса с префиксом `oneuptime.label.` повышается до метки проекта (Label) и прикрепляется к кластеру, сервисам и хостам, генерируемым этим агентом. Шаблон: `oneuptime.label.<dimension>=<value>` превращается в метку с именем `<dimension>:<value>`.

Передавайте метки во время установки с помощью `--set oneuptime.labels.<key>=<value>`:

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

Или храните их в файле значений:

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

Метки сопоставляются без учёта регистра, поэтому существующая метка `Production`, созданная вручную, будет переиспользована, а не продублирована. Метки, добавленные вручную в интерфейсе OneUptime, никогда не удаляются агентом.

## Обновление агента

```bash
helm repo update
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values
```

`--reuse-values` сохраняет вашу существующую конфигурацию (пресет, имя кластера, фильтры); передавайте любые новые переопределения `--set` поверх неё.

## Удаление агента

```bash
helm uninstall kubernetes-agent --namespace oneuptime-agent
kubectl delete namespace oneuptime-agent
```

## Что собирается

| Категория | Данные |
|----------|------|
| **Метрики узлов** | Загрузка CPU, использование памяти, использование файловой системы, сетевой ввод-вывод |
| **Метрики подов** | Использование CPU, использование памяти, сетевой ввод-вывод, перезапуски |
| **Метрики контейнеров** | Использование CPU, использование памяти по каждому контейнеру |
| **Метрики кластера** | Состояния узлов, выделяемые ресурсы, количество подов |
| **События Kubernetes** | Предупреждения, ошибки, события планирования |
| **Логи подов** | Логи stdout/stderr из всех контейнеров (через DaemonSet с hostPath в стандартных кластерах или через Kubernetes API в Autopilot / Fargate) |
| **Трассировки приложений** *(через eBPF, включено по умолчанию)* | Спаны HTTP, gRPC, SQL/Redis из каждого пода — без SDK и изменений в коде |
| **HTTP RED-метрики** *(через eBPF)* | `http.server.request.duration`, размеры тел запросов и ответов, по каждому сервису |
| **Граф сервисов** *(через eBPF)* | Частота запросов, задержка и рёбра ошибок «вызывающий → вызываемый» — формирует представление карты сервисов |
| **Метрики сетевого трафика** *(через eBPF)* | Счётчики байтов и пакетов TCP/UDP между подами с метаданными k8s |
| **Статистика TCP** *(через eBPF)* | Счётчики RTT, неуспешных соединений и повторных передач на уровне узла |

## Трассировки приложений и HTTP-метрики через eBPF (включено по умолчанию)

Чарт запускает DaemonSet с [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) на каждом узле. Он загружает eBPF-программы в ядро и автоматически перехватывает трафик HTTP/HTTPS, gRPC и SQL/Redis из каждой поддерживаемой среды выполнения (Go, .NET, Java, Node.js, Python, Ruby, Rust) — без SDK и без sidecar. Затем трассировки и метрики запросов проходят через внутрикластерный сборщик в OneUptime.

**Требования:** ядро Linux **5.8+** с BTF (по умолчанию в Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL/Stream 9+). DaemonSet eBPF работает в **привилегированном режиме**, потому что иначе невозможно загрузить eBPF-программы.

### Отключение автоматической инструментации eBPF

Вам следует отключить её, когда:

- Устанавливаете на **GKE Autopilot** или **EKS Fargate** — эти платформы блокируют привилегированные поды (используйте `preset=gke-autopilot` / `preset=eks-fargate` в сочетании с `ebpf.enabled=false`).
- Узлы работают на ядре старше 5.8 без бэкпортов BTF.
- Вы уже передаёте трассировки через OpenTelemetry SDK из ваших приложений и не хотите дубликатов.

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set ebpf.enabled=false
```

### Переключение отдельных семейств сигналов

Все включены по умолчанию. Отключите любое с помощью `--set ebpf.features.<name>=false`:

| `ebpf.features.*` | По умолчанию | Что добавляет |
|---|---|---|
| `httpMetrics` | вкл | HTTP/gRPC RED-метрики (частота запросов, задержка, ошибки) по каждому сервису |
| `spanMetrics` | вкл | Размер запроса/ответа и длительность по каждому спану |
| `serviceGraph` | вкл | Метрики рёбер «вызывающий → вызываемый»; формирует карту сервисов |
| `hostMetrics` | вкл | CPU и память по каждому инструментированному процессу |
| `networkMetrics` | вкл | Счётчики трафика TCP/UDP между подами |
| `networkInterZoneMetrics` | выкл | Межзональный вариант сетевых метрик (удваивает кардинальность) |
| `tcpStats` | вкл | Счётчики TCP RTT, неуспешных соединений, повторных передач на уровне узла |

Распространение контекста трассировки между сервисами также включено по умолчанию — OBI внедряет W3C `traceparent` в исходящий HTTP/TCP, поэтому запрос, пересекающий под A → под B, отображается как единая трассировка, без каких-либо изменений в SDK. Отключите с помощью `--set ebpf.contextPropagation=false`.

## Устранение неполадок

> **Самый быстрый путь — запустите диагностический скрипт.** Он проверяет работоспособность подов, декодирует и валидирует ключ приёма данных, проверяет, что ваш кластер может достучаться до OneUptime, и спрашивает у OneUptime, действительно ли принимается ваш токен, — затем выводит единый вердикт о первопричине:
>
> ```bash
> curl -fsSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/HelmChart/Public/kubernetes-agent/troubleshoot.sh \
>   | bash -s -- -n oneuptime-agent
> ```
>
> Он только читает состояние кластера и выполняет пару проб; он ничего не меняет. Для наиболее точной проверки исходящего трафика сначала установите с `--set debug.enabled=true` (это добавляет небольшой sidecar с сетевыми инструментами в поды агента, чтобы скрипт тестировал точный путь исходящего трафика сборщика), затем перезапустите.

### Установка завершается ошибкой «hostPath volumes are not allowed» или ошибкой Pod Security admission

Ваш кластер блокирует `hostPath` — это часто встречается в **GKE Autopilot** и **EKS Fargate**. Переключитесь на пресет в режиме API:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set preset=gke-autopilot   # или eks-fargate
```

### Агент показывает «Disconnected»

Статус подключения кластера определяется исключительно поступлением телеметрии — если данные не приходят, кластер помечается как отключённый примерно через 5 минут. Поэтому «disconnected» и «нет метрик» почти всегда имеют **одну и ту же** причину: телеметрия агента не принимается.

Самая распространённая причина — особенно после переустановки — это **неверный или отозванный ключ приёма данных**. Это легко упустить, потому что эндпоинты приёма OTLP намеренно возвращают HTTP `200` даже для неверного токена (чтобы неправильно настроенный сборщик не устроил шторм повторных попыток к серверу). В результате: сборщик сообщает об успехе, в его логах нет ошибок, а данные тихо отбрасываются.

1. Убедитесь, что поды агента запущены: `kubectl get pods -n oneuptime-agent`
2. Проверьте логи сборщика метрик: `kubectl logs -n oneuptime-agent -l component=metrics-collector -c otel-collector` (отсутствие ошибок здесь **не** означает, что данные поступают — см. выше)
3. **Проверьте ключ приёма данных.** Спросите у OneUptime напрямую, принимается ли ваш токен (`200` = действителен, `401` = неизвестен/отозван):

   ```bash
   curl -i -H "x-oneuptime-token: <YOUR_API_KEY>" https://oneuptime.com/otlp/v1/validate
   ```

   Если возвращается `401`, ключ в вашем релизе неверен или был отозван. Скопируйте действующий ключ из *Project Settings → Telemetry Ingestion Keys* и разверните заново:

   ```bash
   helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
     --namespace oneuptime-agent --reuse-values \
     --set oneuptime.apiKey=<LIVE_KEY>
   ```

4. Убедитесь, что ваш URL OneUptime корректен и ваш кластер может достучаться до него по сети.
5. Если при переустановке вы изменили `clusterName`, агент появляется как **новый** кластер — старая запись остаётся в статусе «Disconnected» (это ожидаемо; она устарела).

### Логи не появляются (только режим API)

1. Убедитесь, что под, считывающий логи, в состоянии Ready: `kubectl get pods -n oneuptime-agent -l component=log-collector`
2. Проверьте его `/healthz` — он сообщает количество активных потоков и последнюю ошибку экспорта
3. Проверьте логи: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent-logs`
4. Для очень больших кластеров единственная реплика может стать узким местом — шардируйте по пространствам имён, используя `namespaceFilters.include` в отдельных релизах

### Метрики не появляются

1. Сначала исключите отклонённый ключ приёма данных — это самая распространённая причина, и она невидима со стороны агента. См. [Агент показывает «Disconnected»](#agent-shows-disconnected) выше (или просто запустите диагностический скрипт).
2. Убедитесь, что идентификатор кластера совпадает со значением, переданным в `clusterName`
3. Проверьте права RBAC: `kubectl get clusterrolebinding | grep kubernetes-agent`
4. Проверьте логи сборщика OTel на наличие ошибок экспорта

### Поды eBPF в состоянии CrashLoopBackOff или не запускаются

```bash
kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200
```

Распространённые причины:

- **Слишком старое ядро или отсутствие BTF.** OBI требует Linux 5.8+ с BTF. Выполните `uname -r` на узле. Если вы не можете обновить ядро, отключите eBPF: `--set ebpf.enabled=false`.
- **Привилегированные поды заблокированы.** Некоторые кластеры отклоняют привилегированные поды (GKE Autopilot, EKS Fargate и заблокированные среды). Отключите eBPF.
- **`debugfs` / `tracefs` не смонтированы на хосте.** Функция `tcpStats` подключается к точкам трассировки ядра, которым они нужны. Чарт монтирует обе через `hostPath` — но если ваш хост их не предоставляет, отключите только это семейство: `--set ebpf.features.tcpStats=false`.

### Трассировки приложений не отображаются

1. Убедитесь, что DaemonSet eBPF работает нормально: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`
2. Включите отладочный вывод трассировок, чтобы подтвердить, что OBI перехватывает трафик: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, затем проверьте `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`
3. Если вы видите спаны в stdout OBI, но не в панели управления, проблема в экспорте сборщик → OneUptime — проверьте логи пода сборщика метрик.

## Дальнейшие шаги

- Настройте **мониторы Kubernetes** поверх метрик, собираемых этим агентом — см. [Агент Kubernetes (мониторы)](/docs/monitor/kubernetes-agent).
- Добавьте **мониторы логов** для оповещения по определённым шаблонам логов (например, количество ошибок выше порога на под или на пространство имён).
- Для хостов вне Kubernetes (виртуальные машины и физические серверы Linux / macOS / Windows) используйте страницу [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector).
