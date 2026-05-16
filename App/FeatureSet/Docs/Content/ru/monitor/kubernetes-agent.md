# Установка агента Kubernetes

Агент OneUptime Kubernetes собирает метрики кластера, события и журналы подов из вашего кластера Kubernetes и отправляет их в OneUptime. Агент распространяется в виде Helm-чарта.

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

Различные дистрибутивы Kubernetes имеют разные ограничения — в частности, могут ли рабочие нагрузки монтировать тома `hostPath`. Вместо того чтобы заставлять вас изучать документацию по безопасности, чарт предоставляет единый параметр верхнего уровня: `preset`.

| Пресет | Использовать для | Сбор журналов | Примечания |
| --- | --- | --- | --- |
| `standard` (по умолчанию) | Самоуправляемые, **EKS на EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | DaemonSet, читающий `/var/log/pods` через hostPath | Минимальные накладные расходы. hostPath доступен на этих платформах. |
| `gke-autopilot` | **GKE Autopilot** | Tailer через Kubernetes API (Deployment) | hostPath заблокирован в Autopilot. Устанавливает жёсткий контекст безопасности, соответствующий стандартам Pod Security Standards Autopilot. |
| `eks-fargate` | **EKS Fargate** | Tailer через Kubernetes API (Deployment) | Аналогично `gke-autopilot`. Fargate блокирует hostPath и DaemonSets. |

Если вы не уверены, какой пресет выбрать — оставьте `preset` без значения, будут применены настройки `standard` по умолчанию. Если при установке кластер возвращает ошибку Pod Security policy с упоминанием `hostPath`, переключитесь на `gke-autopilot` (или `eks-fargate` для EKS Fargate) и повторите установку.

### Примеры

**GKE Standard, EKS на EC2, самоуправляемый или AKS:**

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

## Различия между двумя режимами сбора журналов

Под капотом параметр `preset` устанавливает `logs.mode` — его также можно задать напрямую для переопределения значения по умолчанию пресета.

### Режим DaemonSet (`logs.mode: daemonset`)

DaemonSet запускает один под OpenTelemetry Collector на каждом узле. Он отслеживает файлы журналов в `/var/log/pods/` через том hostPath и пересылает их по OTLP.

- **Преимущества:** минимальные накладные расходы, линейное масштабирование с узлами, нет нагрузки на сервер Kubernetes API, поддержка ротации журналов.
- **Недостатки:** требуется hostPath и возможность планирования DaemonSets — оба недоступны в GKE Autopilot и EKS Fargate.

### Режим API (`logs.mode: api`)

Deployment с одной репликой (образ `oneuptime/kubernetes-log-tailer`) использует Kubernetes API для потоковой передачи журналов контейнеров — тот же эндпоинт, что использует `kubectl logs -f`. Нет hostPath, нет доступа к хосту, нет DaemonSet.

- **Преимущества:** работает на GKE Autopilot, EKS Fargate и в любом кластере, блокирующем hostPath или использующем стандарт безопасности `restricted`.
- **Недостатки:** каждый поток контейнера — это долгоживущее соединение с `kube-apiserver`. На практике одна реплика комфортно обрабатывает несколько тысяч контейнеров. Для очень больших кластеров выполняйте шардинг по пространству имён с помощью `logs.api.replicas` и `namespaceFilters.include` на каждой реплике.

### Что выбрать?

Если hostPath доступен — используйте DaemonSet. В остальных случаях — режим API. Параметр `preset` выбирает правильный режим за вас.

Сбор журналов также можно полностью отключить с помощью `--set logs.enabled=false` и отправлять журналы приложений через OpenTelemetry SDK. См. документацию [OpenTelemetry](/docs/telemetry/open-telemetry).

## Общие параметры

| Параметр | По умолчанию | Описание |
| --- | --- | --- |
| `preset` | (не задан — воспринимается как `standard`) | См. таблицу выше. |
| `oneuptime.url` | *(обязательно)* | URL вашего экземпляра OneUptime. |
| `oneuptime.apiKey` | *(обязательно)* | API-ключ проекта (Настройки → API-ключи). |
| `clusterName` | *(обязательно)* | Уникальное имя этого кластера. Добавляется как `k8s.cluster.name` в каждую запись. |
| `namespaceFilters.include` | `[]` | Если задано, отслеживаются только указанные пространства имён. |
| `namespaceFilters.exclude` | `["kube-system"]` | Пространства имён для исключения из мониторинга. |
| `logs.enabled` | `true` | Включить/выключить сбор журналов. |
| `logs.mode` | (определяется из `preset`) | `daemonset`, `api` или `disabled`. Переопределяет пресет. |
| `logs.api.replicas` | `1` | Количество реплик Deployment tailer журналов (только в режиме API). |
| `controlPlane.enabled` | `false` | Опрос etcd / api-server / scheduler / controller-manager. Только для самоуправляемых кластеров — управляемые (EKS/GKE/AKS) обычно не предоставляют эти эндпоинты. |

Полный список см. в файле [`values.yaml` чарта](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/kubernetes-agent/values.yaml).

## Обновление

```bash
helm repo update
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values
```

`--reuse-values` сохраняет существующую конфигурацию; новые параметры `--set` добавляются поверх неё.

## Удаление

```bash
helm uninstall oneuptime-agent --namespace oneuptime-kubernetes-agent
kubectl delete namespace oneuptime-kubernetes-agent
```

## Устранение неполадок

### Установка завершается ошибкой «hostPath volumes are not allowed»

Ваш кластер блокирует hostPath. Переключитесь на пресет с режимом API:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values \
  --set preset=gke-autopilot   # или eks-fargate
```

### Журналы не появляются в OneUptime

Проверьте поды агента:

```bash
kubectl get pods -n oneuptime-kubernetes-agent
kubectl logs -n oneuptime-kubernetes-agent -l app.kubernetes.io/part-of=oneuptime --tail=200
```

В режиме API под tailer журналов предоставляет `/healthz` на порту 13133 — обратитесь к нему через `kubectl port-forward` для получения снимка статуса экспорта.

### В кластере слишком много подов для одной реплики tailer журналов (только в режиме API)

Масштабируйте горизонтально, разбив по пространствам имён. Разворачивайте по одному экземпляру на группу пространств имён:

```bash
helm install oneuptime-agent-ns-a oneuptime/kubernetes-agent \
  --set preset=gke-autopilot \
  --set namespaceFilters.include={app-a,app-b} \
  ...
```

Как вариант, увеличьте `logs.api.replicas` — но имейте в виду, что каждая реплика обрабатывает все разрешённые пространства имён, поэтому для дедупликации всё равно потребуется шардинг по пространствам имён.
