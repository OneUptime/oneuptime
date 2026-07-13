# Агент OneUptime для Kubernetes (Helm)

## Обзор

Агент OneUptime для Kubernetes — это готовый Helm-чарт, который устанавливает в вашем кластере конвейер сбора данных на основе OpenTelemetry. Он передаёт метрики узлов, подов, контейнеров и кластера; события Kubernetes; логи подов; а при включённом по умолчанию eBPF — трассировки приложений, HTTP RED-метрики, данные графа сервисов и метрики сетевого трафика между подами. Никаких изменений в коде, никаких SDK, одна команда `helm install`.

Эта страница — **руководство по установке**. О настройке мониторов и оповещений Kubernetes поверх данных, собираемых агентом, см. [Агент Kubernetes (мониторы)](/docs/monitor/kubernetes-agent).

## Предварительные требования

- Запущенный кластер Kubernetes (v1.23+)
- `kubectl`, настроенный для доступа к вашему кластеру
- Установленный `helm` v3
- **API-ключ OneUptime** — создайте его в разделе _Project Settings → API Keys_

## Шаг 1 — Добавьте Helm-репозиторий OneUptime

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm repo update
```

## Шаг 2 — Выберите пресет для вашего кластера

Чарт предоставляет единственный параметр верхнего уровня — `preset` — который выбирает совместимые значения по умолчанию для вашего дистрибутива Kubernetes. Он управляет тем, что иначе пришлось бы настраивать вручную: передавать ли логи через DaemonSet с hostPath или через Kubernetes API, и какой контекст безопасности применять.

| `preset`                    | Использовать для                                                                         | Сбор логов                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `standard` _(по умолчанию)_ | Самоуправляемые кластеры, **EKS на EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | DaemonSet, читающий `/var/log/pods` через hostPath (наименьшие накладные расходы)     |
| `gke-autopilot`             | **GKE Autopilot**                                                                        | Deployment, считывающий логи через Kubernetes API (без hostPath, без доступа к хосту) |
| `eks-fargate`               | **EKS Fargate**                                                                          | Deployment, считывающий логи через Kubernetes API (без hostPath, без доступа к хосту) |

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

`namespaceFilters` ограничивает **логи подов** (как DaemonSet с hostPath, так и сборщик логов через API) и **трассировки eBPF** выбранными вами пространствами имён. По умолчанию `kube-system` исключён. Чтобы ограничить эти сигналы определёнными пространствами имён:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set "namespaceFilters.include={default,production,staging}"
```

> Эти фильтры **не** уменьшают **метрики** узлов / подов / контейнеров — они собираются с каждого узла из kubelet и всегда собираются в масштабе всего кластера (ряды уровня узла и кластера не имеют пространства имён для фильтрации). `exclude` всегда имеет приоритет над `include`. Полный набор регуляторов объёма см. в разделе [Уменьшение объёма собираемых данных](#reducing-the-volume-of-data-collected).

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

| Категория                                                        | Данные                                                                                                                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Метрики узлов**                                                | Загрузка CPU, использование памяти, использование файловой системы, сетевой ввод-вывод                                                     |
| **Метрики подов**                                                | Использование CPU, использование памяти, сетевой ввод-вывод, перезапуски                                                                   |
| **Метрики контейнеров**                                          | Использование CPU, использование памяти по каждому контейнеру                                                                              |
| **Метрики кластера**                                             | Состояния узлов, выделяемые ресурсы, количество подов                                                                                      |
| **События Kubernetes**                                           | Предупреждения, ошибки, события планирования                                                                                               |
| **Логи подов**                                                   | Логи stdout/stderr из всех контейнеров (через DaemonSet с hostPath в стандартных кластерах или через Kubernetes API в Autopilot / Fargate) |
| **Трассировки приложений** _(через eBPF, включено по умолчанию)_ | Спаны HTTP, gRPC, SQL/Redis из каждого пода — без SDK и изменений в коде                                                                   |
| **HTTP RED-метрики** _(через eBPF)_                              | `http.server.request.duration`, размеры тел запросов и ответов, по каждому сервису                                                         |
| **Граф сервисов** _(через eBPF)_                                 | Частота запросов, задержка и рёбра ошибок «вызывающий → вызываемый» — формирует представление карты сервисов                               |
| **Метрики сетевого трафика** _(через eBPF)_                      | Счётчики байтов и пакетов TCP/UDP между подами с метаданными k8s                                                                           |
| **Статистика TCP** _(через eBPF)_                                | Счётчики RTT, неуспешных соединений и повторных передач на уровне узла                                                                     |

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

| `ebpf.features.*`         | По умолчанию | Что добавляет                                                                 |
| ------------------------- | ------------ | ----------------------------------------------------------------------------- |
| `httpMetrics`             | вкл          | HTTP/gRPC RED-метрики (частота запросов, задержка, ошибки) по каждому сервису |
| `spanMetrics`             | вкл          | Размер запроса/ответа и длительность по каждому спану                         |
| `serviceGraph`            | вкл          | Метрики рёбер «вызывающий → вызываемый»; формирует карту сервисов             |
| `hostMetrics`             | вкл          | CPU и память по каждому инструментированному процессу                         |
| `networkMetrics`          | вкл          | Счётчики трафика TCP/UDP между подами                                         |
| `networkInterZoneMetrics` | выкл         | Межзональный вариант сетевых метрик (удваивает кардинальность)                |
| `tcpStats`                | вкл          | Счётчики TCP RTT, неуспешных соединений, повторных передач на уровне узла     |

Распространение контекста трассировки между сервисами также включено по умолчанию — OBI внедряет W3C `traceparent` в исходящий HTTP/TCP, поэтому запрос, пересекающий под A → под B, отображается как единая трассировка, без каких-либо изменений в SDK. Отключите с помощью `--set ebpf.contextPropagation=false`.

## Уменьшение объёма собираемых данных

Из коробки агент настроен на **полноту охвата** — он передаёт метрики, логи подов и трассировки eBPF со всего кластера, чтобы каждая панель управления и монитор работали с первого дня. На больших или загруженных кластерах это может быть больше телеметрии, чем вам нужно, что проявляется в увеличенном объёме приёма данных (а на OneUptime Cloud — в более высокой стоимости). Ничто из перечисленного здесь не является обязательным, но если кластер отправляет больше, чем вам хотелось бы, вот регуляторы, которые стоит настроить — примерно в порядке влияния.

Хитрость в том, чтобы **перестать собирать то, на что вы не будете смотреть**, а не собирать всё и платить за хранение. Каждый рычаг ниже — это значение Helm, поэтому вы можете применить его с помощью `--set` при `helm upgrade --reuse-values` и откатить тем же способом.

### Откуда берётся объём

| Сигнал                                | Основной источник                                                     | Уменьшить с помощью                                                                          |
| ------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Логи подов**                        | Каждая строка от каждого контейнера, по всему кластеру                | `logs.enabled`, `logs.mode`, `namespaceFilters`                                              |
| **Трассировки eBPF и метрики спанов** | Одна трассировка на запрос от каждого инструментированного процесса   | `ebpf.enabled`, `ebpf.features.*`, `ebpf.autoTargetExe`, `ebpf.excludeExePaths`              |
| **Точки данных метрик**               | Частота сбора × количество подов/контейнеров                          | `collectionInterval`, `hostMetrics.collectionInterval`, `cadvisor.scrapeInterval`            |
| **Кардинальность метрик**             | Количество различных рядов (по каждому контейнеру, по каждому PVC, …) | `cadvisor.metricsAllowlist`, `kubeletstats.volumeMetrics`, `kubeletstats.utilizationMetrics` |
| **Опциональные дополнения**           | Профилирование, аудит-логи, управляющий слой, межзональные метрики    | Оставьте их выключенными (по умолчанию они и так выключены)                                  |

### Рычаг 1 — Логи подов обычно являются крупнейшим источником

Логи контейнеров почти всегда составляют наибольшую долю приёма данных, потому что это одна запись на каждую строку лога от каждого контейнера в кластере.

- **Совсем не нужны логи в OneUptime?** Отключите их полностью — вы сохраните все метрики, события и трассировки:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set logs.enabled=false
  ```

- **Нужны логи только из определённых пространств имён?** `namespaceFilters.include` ограничивает логи подов в обоих режимах логирования (а вместе с ними и трассировки eBPF). Сопоставление происходит на пути логов подов, поэтому отфильтрованные пространства имён вообще не читаются:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set "namespaceFilters.include={default,production}"
  ```

  (`kube-system` уже исключён по умолчанию.)

### Рычаг 2 — Сократите автоматическую инструментацию eBPF

eBPF даёт вам трассировки, RED-метрики, карту сервисов и метрики сетевого трафика без изменений в коде — но это также второй по величине источник данных, поскольку он генерирует спан на каждый запрос и несколько семейств метрик на каждый сервис. У вас есть три уровня контроля:

- **Уже передаёте трассировки через OTel SDK или не хотите автоматических трассировок?** Полностью отключите eBPF:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.enabled=false
  ```

- **Сохраните трассировки, откажитесь от тяжёлых семейств метрик.** В [таблице семейств сигналов выше](#toggle-individual-signal-families) перечислен каждый флаг `ebpf.features.*`. Семейства с наибольшим объёмом — это сетевые метрики и метрики спанов; их отключение оставляет нетронутыми трассировки, HTTP RED-метрики и карту сервисов:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.features.networkMetrics=false \
    --set ebpf.features.tcpStats=false \
    --set ebpf.features.spanMetrics=false
  ```

  Оставьте `ebpf.features.networkInterZoneMetrics` выключенным (это его значение по умолчанию) — он удваивает кардинальность сетевого трафика.

- **Инструментируйте только те среды выполнения, которые вам важны.** По умолчанию OBI подключается к каждому распознаваемому процессу (`ebpf.autoTargetExe: "*"`). Сузьте до конкретных сред выполнения или добавьте бинарные файлы в список пропуска, чтобы сократить количество «сервисов» и трассировок, которые генерирует агент:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.autoTargetExe='*/python,*/java'
  ```

  См. [Переключение отдельных семейств сигналов](#toggle-individual-signal-families) и примечание о `excludeExePaths` в значениях чарта для полного набора значений по умолчанию.

### Рычаг 3 — Замедлите интервалы сбора

Объём метрик прямо пропорционален тому, как часто агент выполняет сбор. Удвоение интервала примерно вдвое уменьшает количество точек данных, которые производит эта метрика, без потери охвата — просто с более грубым разрешением. Если вам не нужна 30-секундная детализация, 60s или 120s — это большое и безопасное сокращение:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set collectionInterval=60s \
  --set hostMetrics.collectionInterval=60s \
  --set cadvisor.scrapeInterval=60s
```

- `collectionInterval` (по умолчанию `30s`) управляет метриками узлов / подов / контейнеров (`kubeletstats`) и метриками состояния кластера (`k8s_cluster`) — основной массой объёма метрик.
- `hostMetrics.collectionInterval` и `cadvisor.scrapeInterval` охватывают метрики ОС по каждому узлу и счётчики троттлинга / OOM.
- `resourceSpecs.interval` (по умолчанию `300s`) определяет, как часто извлекаются полные спецификации ресурсов (метки, аннотации, статус) — увеличьте его, если вам не нужно быстрое отражение изменений спецификаций.
- Если вы включили какие-либо из опциональных сборщиков, у них тоже есть свои регуляторы: `kubeStateMetrics.scrapeInterval`, `serviceMesh.*.scrapeInterval`, `coreDns.scrapeInterval`, `csi.scrapeInterval`.

### Рычаг 4 — Держите кардинальность метрик под контролем

Кардинальность (количество различных временных рядов) имеет такое же значение, как и частота, потому что каждый ряд хранится и оплачивается отдельно.

- **cAdvisor намеренно ограничен списком разрешённых.** Приёмник cAdvisor (включён по умолчанию) может генерировать сотни метрик; чарт передаёт только те немногие, что питают мониторы (`cadvisor.metricsAllowlist`). Держите список компактным — **каждая запись сохраняется по каждому контейнеру, поэтому одна лишняя метрика умножается на количество контейнеров в кластере.** kube-state-metrics по умолчанию выключен, но если вы его включите (`kubeStateMetrics.enabled=true`), его `kubeStateMetrics.metricsAllowlist` ограничивает кардинальность таким же образом.
- **Метрики томов по каждому PVC** (`kubeletstats.volumeMetrics.enabled`, включено по умолчанию) генерируют один ряд на каждый PVC на каждый под. Это нормально для большинства кластеров, но может быть значительным на stateful-нагрузках (Kafka, базы данных) с тысячами PVC — отключите их там, если вы не следите за дисковым пространством PVC:

  ```bash
  --set kubeletstats.volumeMetrics.enabled=false
  ```

- **Метрики насыщения** (`kubeletstats.utilizationMetrics.enabled`, включено по умолчанию) добавляют 8 производных семейств «% от request/limit». Они дёшевы (без дополнительного сбора), но если вы не используете мониторы CPU/памяти относительно лимита, вы можете отключить их с помощью `--set kubeletstats.utilizationMetrics.enabled=false`.

### Рычаг 5 — Оставьте тяжёлые опциональные функции выключенными

Они **выключены по умолчанию** именно потому, что добавляют нагрузку — включайте функцию только тогда, когда вы активно используете то, что она обеспечивает, и снова выключайте, если просто пробовали её:

| Значение                                                  | Добавляет                                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `profiling.enabled`                                       | DaemonSet непрерывного профилирования CPU — тяжелее, чем трассировки eBPF             |
| `auditLogs.enabled`                                       | Каждый запрос к Kubernetes API в виде записи лога (большой объём)                     |
| `controlPlane.enabled`                                    | Метрики etcd / API-server / scheduler / controller-manager                            |
| `kubeStateMetrics.enabled`                                | Метрики CrashLoop / ImagePull / причин планирования (добавляет Deployment KSM + сбор) |
| `ebpf.features.networkInterZoneMetrics`                   | Удваивает кардинальность метрик сетевого трафика                                      |
| `serviceMesh.enabled` / `csi.enabled` / `coreDns.enabled` | Дополнительные задания сбора Prometheus                                               |

### Минимальная стартовая конфигурация

Если вам нужен минимальный след и вы будете добавлять сигналы по мере необходимости, этот профиль **только метрики + события** отключает логи и eBPF и вдвое снижает частоту сбора:

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

Отсюда снова включайте всё, что вам нужно: `logs.enabled=true` для нескольких пространств имён в режиме API или `ebpf.enabled=true` с суженным `autoTargetExe`.

> **Следите за тем, что отключаете.** Некоторые мониторы зависят от конкретных сигналов: отключение `cadvisor` убирает мониторы OOM-kill и троттлинга CPU; отключение `kubeletstats.volumeMetrics` убирает монитор низкого дискового пространства PVC; отключение логов убирает оповещения на основе логов. Сокращайте сигналы, на которые вы не реагируете, а не те, за которыми следит монитор.

### Измерьте эффект

Использование телеметрии агрегируется по дням, поэтому проверьте тренд за день или два в разделе **Project Settings → Usage History**, чтобы подтвердить снижение — оно не изменится в тот же миг, когда вы примените изменение. Меняйте по одному рычагу за раз, чтобы можно было связать разницу с причиной — сначала отключите логи, затем увеличьте интервал, затем сократите eBPF — вместо того чтобы уменьшать всё сразу и потерять монитор, на который вы действительно полагались.

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

Статус подключения кластера определяется исключительно поступлением телеметрии — если данные не приходят, кластер помечается как отключённый примерно через 15 минут. Поэтому «disconnected» и «нет метрик» почти всегда имеют **одну и ту же** причину: телеметрия агента не принимается.

Самая распространённая причина — особенно после переустановки — это **неверный или отозванный ключ приёма данных**. Это легко упустить, потому что эндпоинты приёма OTLP намеренно возвращают HTTP `200` даже для неверного токена (чтобы неправильно настроенный сборщик не устроил шторм повторных попыток к серверу). В результате: сборщик сообщает об успехе, в его логах нет ошибок, а данные тихо отбрасываются.

1. Убедитесь, что поды агента запущены: `kubectl get pods -n oneuptime-agent`
2. Проверьте логи сборщика метрик: `kubectl logs -n oneuptime-agent -l component=metrics-collector -c otel-collector` (отсутствие ошибок здесь **не** означает, что данные поступают — см. выше)
3. **Проверьте ключ приёма данных.** Спросите у OneUptime напрямую, принимается ли ваш токен (`200` = действителен, `401` = неизвестен/отозван):

   ```bash
   curl -i -H "x-oneuptime-token: <YOUR_API_KEY>" https://oneuptime.com/otlp/v1/validate
   ```

   Если возвращается `401`, ключ в вашем релизе неверен или был отозван. Скопируйте действующий ключ из _Project Settings → Telemetry Ingestion Keys_ и разверните заново:

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
