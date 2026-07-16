# OneUptime Kubernetes 에이전트 (Helm)

## 개요

OneUptime Kubernetes 에이전트는 클러스터에 OpenTelemetry 기반 컬렉터 파이프라인을 설치하는 사전 패키지화된 Helm 차트입니다. 노드, 파드, 컨테이너 및 클러스터 메트릭, Kubernetes 이벤트, 파드 로그를 제공하며, 기본적으로 활성화된 eBPF를 통해 애플리케이션 트레이스, HTTP RED 메트릭, 서비스 그래프 데이터 및 파드 간 네트워크 흐름 메트릭도 제공합니다. 코드 변경이나 SDK 없이 단 한 번의 `helm install`로 끝납니다.

이 페이지는 **설치 가이드**입니다. 에이전트가 수집한 데이터를 기반으로 Kubernetes 모니터와 알림을 구성하려면 [Kubernetes 에이전트 (모니터)](/docs/monitor/kubernetes-agent)를 참조하세요.

## 사전 요구 사항

- 실행 중인 Kubernetes 클러스터 (v1.23 이상)
- 클러스터에 접근하도록 구성된 `kubectl`
- 설치된 `helm` v3
- **OneUptime API 키** — *Project Settings → API Keys*에서 생성하세요

## 1단계 — OneUptime Helm 저장소 추가

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm repo update
```

## 2단계 — 클러스터에 맞는 프리셋 선택

차트는 `preset`이라는 단일 최상위 옵션을 노출하며, 이는 Kubernetes 배포판에 호환되는 기본값을 선택합니다. 이 옵션은 직접 수동으로 조정해야 했을 항목들 — hostPath DaemonSet을 통해 로그를 전송할지 아니면 Kubernetes API를 통해 전송할지, 그리고 어떤 보안 컨텍스트를 적용할지 — 을 제어합니다.

| `preset`              | 사용 대상                                                                            | 로그 수집                                                               |
| --------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `standard` _(기본값)_ | 자체 관리형 클러스터, **EKS on EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | hostPath를 통해 `/var/log/pods`를 읽는 DaemonSet (가장 낮은 오버헤드)   |
| `gke-autopilot`       | **GKE Autopilot**                                                                    | Kubernetes API 로그 테일러 Deployment (hostPath 없음, 호스트 접근 없음) |
| `eks-fargate`         | **EKS Fargate**                                                                      | Kubernetes API 로그 테일러 Deployment (hostPath 없음, 호스트 접근 없음) |

확실하지 않다면 `standard`로 시작하세요. 설치가 `hostPath`를 언급하는 Pod Security 오류로 실패하면 `preset=gke-autopilot`(또는 Fargate에서는 `eks-fargate`)으로 다시 실행하면 작동합니다.

## 3단계 — Kubernetes 에이전트 설치

`YOUR_ONEUPTIME_URL`, `YOUR_ONEUPTIME_API_KEY` 및 클러스터 이름을 사용자 환경에 맞는 값으로 교체하세요. 클러스터 이름은 클러스터가 OneUptime에 표시되는 방식이므로 `prod-us-east-1`처럼 안정적인 이름을 선택하세요.

### 표준 클러스터 (자체 관리형, EKS on EC2, GKE Standard, AKS)

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

## 4단계 — 설치 확인

에이전트 파드가 실행 중인지 확인하세요:

```bash
kubectl get pods -n oneuptime-agent
```

**표준** 클러스터에서는 cluster-collector Deployment와 함께 노드당 하나의 node-collector DaemonSet 파드가 표시됩니다:

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-xxxxx                   1/1     Running   0          1m
kubernetes-agent-logs-yyyyy                   1/1     Running   0          1m
```

**GKE Autopilot**에서는 노드 컬렉터가 여전히 실행되며 — hostPath 없이도 kubelet 및 cAdvisor 메트릭을 수집합니다 — 추가 Deployment가 Kubernetes API를 통해 파드 로그를 테일링합니다:

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-yyyyyyyyyy-yyyyy        1/1     Running   0          1m
kubernetes-agent-logs-xxxxx                   1/1     Running   0          1m
```

**EKS Fargate**에서는 두 개의 Deployment가 표시되고 DaemonSet은 없습니다 — Fargate는 각 파드에 자체 마이크로 VM을 제공하며 DaemonSet을 절대 스케줄링하지 않으므로, 그곳에서는 노드 수준 메트릭을 사용할 수 없습니다:

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-yyyyyyyyyy-yyyyy        1/1     Running   0          1m
```

에이전트가 연결되면 클러스터가 OneUptime 대시보드의 **Kubernetes** 섹션에 자동으로 나타납니다.

## 구성 옵션

### 네임스페이스 필터링

`namespaceFilters`는 **파드 로그**(hostPath DaemonSet과 API 로그 테일러 모두)와 **eBPF 트레이스**를 선택한 네임스페이스로 범위를 제한합니다. 기본적으로 `kube-system`은 제외됩니다. 이러한 시그널을 특정 네임스페이스로 제한하려면:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set "namespaceFilters.include={default,production,staging}"
```

다른 모든 네임스페이스는 유지하면서 시끄러운 네임스페이스 하나만 무시하려면 대신 `exclude`를 사용하세요. `exclude`는 항상 `include`보다 우선하며, 기본 제공 값은 `[kube-system]`입니다 — 따라서 이를 계속 제외하고 싶다면 다시 나열하세요:

```bash
  --set "namespaceFilters.exclude={kube-system,noisy-namespace}"
```

**파드 로그와 eBPF 트레이스의 경우 이는 비용이 전혀 들지 않습니다**: 네임스페이스는 파드 로그 경로와 OBI의 프로세스 디스커버리의 일부이므로, 필터링된 네임스페이스는 애초에 읽히지도 않습니다 — CPU도, 이그레스도 없습니다.

#### 메트릭과 트레이스에 네임스페이스 필터 적용하기

기본적으로 위의 목록은 파드 로그와 eBPF 트레이스만 다룹니다. `applyTo`는 이를 다른 시그널로 확장합니다:

```bash
  --set namespaceFilters.applyTo.metrics=true \
  --set namespaceFilters.applyTo.traces=true
```

| 설정 | 다루는 항목 |
| ------- | -------------- |
| `applyTo.metrics` | kubeletstats, cAdvisor 및 kube-state-metrics의 파드별 / 컨테이너별 메트릭 |
| `applyTo.traces` | 애플리케이션이 에이전트의 OTLP 엔드포인트로 푸시하는 스팬 (eBPF 스팬은 이미 범위가 지정되어 있음) |

둘 다 의도적으로 **기본적으로 꺼져 있습니다**. `exclude: [kube-system]`이 기본값으로 제공되므로, 이를 자동으로 켜면 업그레이드 시 기존의 모든 설치에서 kube-system 메트릭이 조용히 삭제될 것입니다.

> **노드 및 클러스터 수준 메트릭은 항상 유지됩니다.** 네임스페이스는 노드가 아니라 파드의 속성이므로, 노드 CPU, 노드 메모리, 파일 시스템 사용량과 같은 시리즈는 매칭할 대상이 없어 절대 삭제되지 않습니다. `applyTo.metrics`는 노드에 문제가 생기는 것을 놓치게 만드는 일 없이 파드별 카디널리티를 다듬습니다.

Kubernetes **이벤트**는 에이전트에서 네임스페이스로 필터링할 수 없습니다. 이들은 `k8sobjects` 리시버에서 `k8s.namespace.name` 속성 없이 도착하며 — 네임스페이스는 이벤트 본문 안에 있습니다 — 따라서 필터가 매칭할 대상이 없습니다. 대신 서버 측에서 삭제하세요(아래 참조).

### 로그 심각도로 필터링

`filters.logs.minSeverity`는 특정 심각도 미만의 **파드 로그** 레코드를 아무것도 전송되기 전에 에이전트에서 삭제합니다:

```bash
  --set filters.logs.minSeverity=WARN
```

`TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL`을 허용합니다. `WARN`은 WARN, ERROR, FATAL을 유지하고 INFO, DEBUG, TRACE를 삭제합니다. 기본값(`""`)은 모든 것을 유지합니다. 이는 **두 로그 모드 모두**에 적용됩니다 — `daemonset` 모드에서는 컬렉터를 통해, `api` 모드에서는 로그 테일러 자체 내에서 — 따라서 프리셋이 사용자도 모르는 사이에 이를 꺼 버릴 수 없습니다.

컨테이너 런타임은 로그 라인에 심각도를 기록하지 않으므로, 에이전트가 로그 텍스트(`[ERROR]`, `WARN:`, `level=info`, …)에서 직접 심각도를 파싱합니다.

> **Kubernetes 이벤트와 리소스 스펙은 이것으로 절대 필터링되지 않습니다.** 이들은 자체 심각도 없이 Kubernetes API에서 도착하므로, 임계값을 적용하면 피드를 다듬는 것이 아니라 통째로 삭제하게 됩니다 — 가장 필요로 하는 `FailedScheduling`, `BackOff`, `OOMKilling` 경고까지 포함해서 말입니다. 이들은 볼륨이 적고 가치가 높으므로 에이전트는 항상 이들을 전송합니다. 이들을 줄이려면 대신 대시보드의 서버 측 **Logs → Settings → Drop Filters**를 사용하세요.

**인식 가능한 레벨이 없는 라인이 어떻게 처리되는지는 로그 모드에 따라 달라집니다.** 두 모드가 사용할 수 있는 정보가 다르기 때문입니다:

| 모드 | 레이블 없는 라인 | 이유 |
| ---- | --------------- | --- |
| `daemonset` | `stderr` → ERROR로 처리(유지), `stdout` → INFO로 처리(WARN 임계값에서 삭제됨) | 컨테이너 런타임이 각 라인이 어느 스트림에서 왔는지 기록합니다. |
| `api` | 항상 **유지** | Kubernetes `pods/log` API는 stdout과 stderr를 라인별 표시 없이 단일 스트림으로 병합합니다. 에이전트는 추측하기보다 해당 라인을 유지합니다. |

> 따라서 `api` 모드는 `daemonset` 모드보다 엄격히 더 적게 삭제합니다. 이는 의도된 것입니다: Python 트레이스백이나 `npm ERR!`에는 심각도 키워드가 없으며, 이를 조용히 삭제하는 것이야말로 심각도 임계값이 막아야 할 바로 그 실패입니다.

여러 줄로 된 이벤트는 두 모드 모두에서 필터링 **이전에** 재결합되므로, Java 스택 트레이스는 첫 번째 줄을 기준으로 판정되어 통째로 유지되거나 삭제됩니다 — 프레임이 잘려 나간 채 `ERROR` 줄만 덩그러니 남는 일은 없습니다.

### 이름으로 메트릭 포함 또는 제외하기

`filters.metrics`는 파이프라인의 모든 리시버에 걸쳐 어떤 메트릭이 클러스터를 떠날지 제어합니다.

**시끄러운 메트릭 몇 개 삭제하기** (거부 목록 — 보통 원하는 방식입니다):

```bash
  --set-json 'filters.metrics.exclude=["k8s.volume.available","k8s.volume.capacity"]'
```

**고정된 집합만 전송하기** (허용 목록 — 그 외 모든 것이 삭제됩니다):

```bash
  --set-json 'filters.metrics.include=["k8s.pod.cpu.usage","k8s.pod.memory.usage"]'
```

정확한 이름 대신 **패턴으로 매칭하기**:

```bash
  --set filters.metrics.matchType=regexp \
  --set-json 'filters.metrics.exclude=["^container_network_"]'
```

| 키 | 의미 |
| --- | ------- |
| `filters.metrics.exclude` | 삭제할 메트릭 이름. `include` 위에 적용되므로 exclude가 항상 우선합니다. |
| `filters.metrics.include` | 비어 있지 않으면 **오직** 이들만 전송됩니다. |
| `filters.metrics.matchType` | `strict`(정확한 이름, 기본값) 또는 `regexp`(RE2, **앵커 없음**). |

장애를 막아 줄 참고 사항:

- `regexp`는 **앵커가 없습니다** — `system.cpu`는 `system.cpu.time`에도 매칭됩니다. 정확히 하나의 메트릭을 의미한다면 앵커를 붙이세요(`^system\.cpu$`).
- RE2에는 **lookahead가 없으므로** `^(?!container_)`는 컴파일되지 않습니다. "이것만 제외한 전부"는 부정 정규식이 아니라 `include`로 표현하세요.
- `include`는 모든 리시버에 한 번에 적용됩니다. 메트릭 하나를 빠뜨린 허용 목록은 그것을 기반으로 만든 모니터를 조용히 제거합니다. 정말로 닫힌 집합을 원하는 것이 아니라면 `exclude`를 선호하세요.
- 목록에는 `--set-json`(또는 values 파일)을 사용하세요. 일반 `--set`은 목록을 병합하지 않고 교체합니다.

> **롤아웃하기 전에 정규식을 테스트하세요.** 패턴은 레코드마다가 아니라 시작 시점에 컬렉터가 컴파일하므로, 잘못된 패턴은 조용히 오작동하지 않습니다 — 컬렉터가 시작을 거부하고 CrashLoopBackOff에 빠지며, 해당 컬렉터의 메트릭과 함께 **로그**까지 중단시킵니다. Helm은 RE2를 컴파일할 수 없으므로 `helm upgrade`는 잘못된 패턴도 아무 불평 없이 받아들입니다.

### 트레이스 샘플링

이 페이지의 다른 모든 조정 항목은 텔레메트리의 **범주** 하나를 제거합니다 — 네임스페이스 하나, 심각도 하나, 메트릭 이름 하나. 샘플링은 다릅니다: 모든 범주를 유지한 채 모집단을 솎아 냅니다. `sampling.traces.percentage`에 유지하고 싶은 트레이스의 비율을 설정하세요:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set sampling.traces.percentage=10
```

이렇게 하면 트레이스 열 개 중 하나를 유지하고 나머지 아홉 개는 클러스터를 떠나기 전에 에이전트에서 삭제합니다.

**조각이 아니라 온전한 트레이스를 얻습니다.** 판정은 스팬마다 동전을 던지는 것이 아니라 트레이스 ID의 해시이므로, 한 트레이스의 모든 스팬은 함께 유지되거나 함께 삭제됩니다 — 살아남은 트레이스는 완전하며 처음부터 끝까지 읽을 수 있습니다. 샘플링을 안심하고 켤 수 있게 해 주는 것이 바로 이 속성입니다.

**메트릭 기반 모니터는 달라지지 않습니다.** eBPF RED 메트릭 — 요청 속도, 오류율, 지속 시간 — 은 *메트릭* 패밀리입니다. OBI가 모든 요청에서 이를 계산하며 이들은 메트릭 파이프라인을 따라 흐르는데, 샘플러는 그 파이프라인에 없습니다. `percentage: 10`에서는 트레이스는 10분의 1이 되지만 속도/오류/지연 시간은 100% 정확합니다. 이러한 메트릭을 기반으로 만든 대시보드와 모니터는 영향을 받지 않습니다.

**스팬 기반 모니터는 달라집니다.** OneUptime이 스팬 자체에서 도출하는 것은 무엇이든 비율에 따라 함께 줄어듭니다 — 이것을 켜기 전에 아래 경고를 읽어 보세요.

| 키 | 의미 |
| --- | ------- |
| `sampling.traces.percentage` | **유지할** 트레이스의 백분율, 0-100. 기본값 `100`(모두 유지). |
| `sampling.traces.hashSeed` | 트레이스 ID 해시의 시드. 기본값 `22`. |

장애를 막아 줄 참고 사항:

- **`0`은 트레이스를 하나도 유지하지 않습니다.** 이는 끄는 스위치가 아니라 비율입니다 — eBPF DaemonSet은 계속 실행되며 비용을 발생시키는 채로 모든 트레이스를 삭제합니다. 트레이스를 원하지 않는다면 `ebpf.enabled=false`를 사용하세요. 트레이스는 원하지 않지만 RED 메트릭과 서비스 맵은 *원한다면*, eBPF를 켜 둔 채로 이 값을 의도적으로 `0`으로 설정하세요.
- **`ebpf.enabled`일 때만 적용됩니다.** 그렇지 않으면 트레이스 파이프라인 자체가 존재하지 않으므로 `ebpf.enabled=false`에서 이 값은 아무 일도 하지 않습니다.
- **트레이스 전용입니다.** `sampling.logs`나 `sampling.metrics`는 없으며, 이는 의도된 것입니다 — 아래 참고 사항을 보세요.
- **소수에는 `--set-json`이 필요하며, 하한이 있습니다.** Helm이 `0.5`를 문자열로 읽기 때문에 `--set sampling.traces.percentage=0.5`는 실패합니다. `--set-json 'sampling.traces.percentage=0.5'` 또는 values 파일을 사용하세요. 정수는 `--set`으로도 문제없이 작동합니다. 약 `0.0061` 아래에서는 비율이 0으로 양자화되어 `0`과 정확히 똑같이 동작합니다 — 모든 트레이스가 삭제되지만 오류는 나지 않습니다. `0.01`(만 분의 일)이 말 그대로 동작하는 가장 작은 값입니다.
- **멀티 클러스터는 기본적으로 작동합니다.** 두 에이전트는 `hashSeed`와 `percentage` 둘 다에 대해 의견이 일치할 때만 같은 트레이스를 유지합니다. 둘 다 어디에서나 같은 기본값을 가지므로, 두 클러스터를 넘나드는 트레이스는 추가 구성 없이도 온전히 살아남습니다. `hashSeed`는 두 샘플링 계층을 의도적으로 *비상관화*할 때만 변경하세요 — 판정이 동일한 해시에 대한 임계값이기 때문에, 같은 시드에서 서로 다른 비율은 서로 포개어지며, 두 번째 계층은 독립적으로 추첨하는 대신 첫 번째 계층이 이미 유지한 트레이스를 다시 고르게 됩니다.
- **파드 로그는 절대 샘플링되지 않으므로**, `ebpf.logToTraceCorrelation: true`에서는 모든 로그 레코드가 여전히 트레이스 ID를 지니는 반면 그 트레이스 중 `percentage`%만 유지됩니다. 대략 (100 − `percentage`)%의 로그 레코드는 막다른 길로 이어지는 트레이스 링크를 표시하게 됩니다. 트레이스 → 로그 이동은 영향을 받지 않으며, 로그 → 트레이스만 실패할 수 있습니다.

> **이 값을 설정할 때는 스팬 기반 모니터를 다시 튜닝하세요.** 샘플링은 OneUptime에 도달하는 스팬을 줄이므로, 그것을 세는 것은 무엇이든 더 적게 세게 됩니다: `Span Count`를 사용하는 **Traces** 모니터와 `Exception Count`를 사용하는 **Exceptions** 모니터는 어제 볼륨의 대략 `percentage`%만 보게 됩니다. 샘플링하지 않은 트래픽에 맞춰 튜닝한 임계값은 조용히 더 이상 넘지 않게 됩니다 — 모니터가 오류를 내는 것이 아니라 그저 침묵합니다. 비율을 설정할 때 해당 임계값을 같은 배수로 나누세요. 이 비율은 클러스터 전체에 적용되므로 개별 서비스만 예외로 두는 방법은 없습니다. 오류 **그룹화**는 선형보다 더 나쁘게 저하됩니다: 흔한 예외는 여전히 드러나지만, 드물게 한 번 발생하는 예외는 10분의 1의 빈도로 나타나기보다 아예 사라져 버릴 가능성이 더 큽니다.

> **여기에 로그나 메트릭 샘플링이 없는 이유.** 컬렉터의 샘플러는 메트릭을 아예 샘플링할 수 없습니다. 로그는 샘플링할 수 있지만 무작위성을 트레이스 ID에서 끌어옵니다 — 그리고 파드 로그에는 트레이스 ID가 없습니다. 그러면 트레이스 ID가 없는 모든 레코드가 같은 버킷으로 해싱되므로 로그 비율은 피드를 솎아 내지 못합니다: 시드에 따라 전부 유지하거나 전부 삭제하게 됩니다. 사용자의 로그를 조용히 삭제하는 조정 항목을 제공하느니, 차트는 아예 제공하지 않습니다. 로그는 무엇을 제거하는지가 정확한 [로그 심각도로 필터링](#로그-심각도로-필터링)과 [네임스페이스 필터링](#네임스페이스-필터링)으로 솎아 내세요.

### 로그 수집 비활성화

파드 로그가 필요 없는 경우:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set logs.enabled=false
```

메트릭은 영향을 받지 않습니다: 노드 컬렉터는 kubelet, cAdvisor 및 호스트 메트릭을 위해 계속 실행되며, 단지 파드 로그를 읽는 것만 중단합니다. 로그 기반 알림이 중단될 뿐, 그 외에는 아무것도 중단되지 않습니다.

### 특정 로그 수집 모드 강제 적용

고급 사용자는 `logs.mode`로 프리셋의 선택을 재정의할 수 있습니다:

- `logs.mode=daemonset` — hostPath DaemonSet (가장 낮은 오버헤드, hostPath 필요)
- `logs.mode=api` — Kubernetes API 로그 테일러 Deployment (모든 클러스터에서 작동)
- `logs.mode=disabled` — 로그 수집 안 함

> 로그 모드는 **파드 로그**를 어디에서 가져올지만 결정합니다. 노드 메트릭은 이와 무관하게 수집되므로, `api`와 `disabled`에서도 kubelet, cAdvisor 및 호스트 메트릭은 그대로 유지됩니다.
>
> 유일한 예외는 모드가 아니라 플랫폼입니다: **EKS Fargate는 DaemonSet을 아예 스케줄링할 수 없으므로** 그곳에는 노드 컬렉터가 없고 노드, 파드, 컨테이너 메트릭을 사용할 수 없습니다. GKE Autopilot은 노드 컬렉터를 문제없이 실행하지만 `hostPath`를 차단하므로, 호스트의 `/proc`과 `/sys`를 읽어야 하는 `hostmetrics` 메트릭(디스크 I/O, inode, NIC 오류) 없이 kubelet 및 cAdvisor 메트릭을 수집합니다.

명시적인 `logs.mode`는 항상 프리셋 기본값보다 우선합니다. 프리셋보다 클러스터를 더 잘 알고 있다면 이를 사용하세요.

### 컨트롤 플레인 모니터링 활성화

자체 관리형 클러스터(EKS / GKE / AKS가 아닌 경우)에서는 컨트롤 플레인 메트릭을 활성화할 수 있습니다:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set controlPlane.enabled=true
```

> 관리형 Kubernetes 서비스(EKS, GKE, AKS)는 일반적으로 컨트롤 플레인 메트릭을 노출하지 않습니다. 자체 관리형 클러스터에 대해서만 이를 활성화하세요.

### 프로젝트 레이블로 자동 태그 지정

`oneuptime.label.` 접두사가 붙은 모든 리소스 속성은 프로젝트 Label로 승격되어 이 에이전트에서 방출되는 클러스터, 서비스 및 호스트에 연결됩니다. 패턴: `oneuptime.label.<dimension>=<value>`는 `<dimension>:<value>`라는 이름의 레이블이 됩니다.

설치 시 `--set oneuptime.labels.<key>=<value>`로 레이블을 전달하세요:

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

또는 values 파일에 유지하세요:

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

레이블은 대소문자를 구분하지 않고 매칭되므로, 기존에 수동으로 생성한 `Production` 레이블은 중복 생성되지 않고 재사용됩니다. OneUptime UI에서 수동으로 추가한 레이블은 에이전트에 의해 절대 제거되지 않습니다.

## 에이전트 업그레이드

```bash
helm repo update
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values
```

`--reuse-values`는 기존 구성(프리셋, 클러스터 이름, 필터)을 유지합니다. 그 위에 새로운 `--set` 재정의를 전달하세요.

## 에이전트 제거

```bash
helm uninstall kubernetes-agent --namespace oneuptime-agent
kubectl delete namespace oneuptime-agent
```

## 수집되는 항목

| 카테고리                                               | 데이터                                                                                                                              |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| **노드 메트릭**                                        | CPU 사용률, 메모리 사용량, 파일 시스템 사용량, 네트워크 I/O                                                                         |
| **파드 메트릭**                                        | CPU 사용량, 메모리 사용량, 네트워크 I/O, 재시작                                                                                     |
| **컨테이너 메트릭**                                    | 컨테이너별 CPU 사용량, 메모리 사용량                                                                                                |
| **클러스터 메트릭**                                    | 노드 상태, 할당 가능 리소스, 파드 수                                                                                                |
| **Kubernetes 이벤트**                                  | 경고, 오류, 스케줄링 이벤트                                                                                                         |
| **파드 로그**                                          | 모든 컨테이너의 stdout/stderr 로그 (표준 클러스터에서는 hostPath DaemonSet을 통해, Autopilot / Fargate에서는 Kubernetes API를 통해) |
| **애플리케이션 트레이스** _(eBPF를 통해, 기본 활성화)_ | 모든 파드의 HTTP, gRPC, SQL/Redis 스팬 — SDK나 코드 변경 없음                                                                       |
| **HTTP RED 메트릭** _(eBPF를 통해)_                    | 서비스별 `http.server.request.duration`, 요청 및 응답 본문 크기                                                                     |
| **서비스 그래프** _(eBPF를 통해)_                      | 호출자 → 피호출자 요청 속도, 지연 시간 및 오류 엣지 — 서비스 맵 뷰를 구동                                                           |
| **네트워크 흐름 메트릭** _(eBPF를 통해)_               | k8s 메타데이터와 함께 파드 간 TCP/UDP 바이트 및 패킷 카운터                                                                         |
| **TCP 통계** _(eBPF를 통해)_                           | 노드 수준 RTT, 실패한 연결 및 재전송 카운터                                                                                         |

## eBPF를 통한 애플리케이션 트레이스 및 HTTP 메트릭 (기본 활성화)

차트는 모든 노드에서 [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/)와 함께 DaemonSet을 실행합니다. eBPF 프로그램을 커널에 로드하고 지원되는 모든 런타임(Go, .NET, Java, Node.js, Python, Ruby, Rust)에서 HTTP/HTTPS, gRPC 및 SQL/Redis 트래픽을 자동으로 캡처합니다 — SDK나 사이드카가 필요 없습니다. 그런 다음 트레이스와 요청 메트릭이 클러스터 내 컬렉터를 통해 OneUptime으로 흐릅니다.

**요구 사항:** BTF가 있는 Linux 커널 **5.8 이상** (Debian 11 이상, Ubuntu 20.10 이상, Fedora 34 이상, RHEL/Stream 9 이상에서 기본 제공). eBPF DaemonSet은 eBPF 프로그램을 로드해야 하므로 어쩔 수 없이 **privileged 모드**로 실행됩니다.

### eBPF 자동 계측 비활성화

다음 경우에 비활성화해야 합니다:

- **GKE Autopilot** 또는 **EKS Fargate**에 설치하는 경우 — 이러한 플랫폼은 privileged 파드를 차단합니다(`preset=gke-autopilot` / `preset=eks-fargate`를 사용하고 `ebpf.enabled=false`와 함께 사용하세요).
- 노드가 BTF 백포트 없이 5.8보다 오래된 커널을 실행하는 경우.
- 이미 앱에서 OpenTelemetry SDK를 통해 트레이스를 전송하고 있어 중복을 원하지 않는 경우.

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set ebpf.enabled=false
```

### 개별 시그널 패밀리 토글

모두 기본적으로 활성화되어 있습니다. `--set ebpf.features.<name>=false`로 어느 것이든 끌 수 있습니다:

| `ebpf.features.*`         | 기본값 | 추가하는 항목                                              |
| ------------------------- | ------ | ---------------------------------------------------------- |
| `httpMetrics`             | on     | 서비스별 HTTP/gRPC RED 메트릭 (요청 속도, 지연 시간, 오류) |
| `spanMetrics`             | on     | 스팬별 요청/응답 크기 및 지속 시간                         |
| `serviceGraph`            | on     | 호출자 → 피호출자 엣지 메트릭, 서비스 맵을 구동            |
| `hostMetrics`             | on     | 계측된 프로세스별 CPU 및 메모리                            |
| `networkMetrics`          | on     | 파드 간 TCP/UDP 흐름 카운터                                |
| `networkInterZoneMetrics` | off    | 네트워크 메트릭의 영역 간 변형 (카디널리티가 두 배가 됨)   |
| `tcpStats`                | on     | 노드 수준 TCP RTT, 실패한 연결, 재전송 카운터              |

서비스 간 트레이스 컨텍스트 전파도 기본적으로 활성화되어 있습니다 — OBI는 아웃바운드 HTTP/TCP에 W3C `traceparent`를 주입하므로, 파드 A → 파드 B를 가로지르는 요청이 단일 트레이스로 표시되며 어디에서도 SDK 변경이 필요 없습니다. `--set ebpf.contextPropagation=false`로 끌 수 있습니다.

## 수집되는 데이터 볼륨 줄이기

기본 설정에서 에이전트는 **커버리지**에 맞춰 튜닝되어 있습니다 — 전체 클러스터에서 메트릭, 파드 로그 및 eBPF 트레이스를 전송하므로 모든 대시보드와 모니터가 첫날부터 작동합니다. 크거나 바쁜 클러스터에서는 이것이 필요 이상의 텔레메트리일 수 있으며, 이는 더 높은 수집 볼륨(그리고 OneUptime Cloud에서는 더 높은 비용)으로 나타납니다. 여기에 있는 어떤 것도 필수는 아니지만, 클러스터가 원하는 것보다 많이 전송하고 있다면 이것들이 조정할 항목입니다 — 대략 영향도 순으로 정리되어 있습니다.

핵심은 모든 것을 수집하고 저장 비용을 지불하는 대신 **보지 않을 것은 수집을 중단하는** 것입니다. 아래의 모든 레버는 Helm 값이므로 `helm upgrade --reuse-values`에서 `--set`으로 적용하고 같은 방식으로 롤백할 수 있습니다.

### 볼륨의 출처

| 시그널                           | 가장 큰 요인                                         | 줄이는 방법                                                                                  |
| -------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **파드 로그**                    | 클러스터 전체에서 모든 컨테이너의 모든 라인          | `namespaceFilters`, `filters.logs.minSeverity`, `logs.enabled`, `logs.mode`                  |
| **eBPF 트레이스 및 스팬 메트릭** | 계측된 모든 프로세스에서 요청당 하나의 트레이스      | `sampling.traces.percentage`, `ebpf.enabled`, `ebpf.features.*`, `ebpf.autoTargetExe`, `ebpf.excludeExePaths` |
| **메트릭 데이터 포인트**         | 스크레이프 빈도 × 파드/컨테이너 수                   | `collectionInterval`, `hostMetrics.collectionInterval`, `cadvisor.scrapeInterval`            |
| **메트릭 카디널리티**            | 고유한 시리즈 수 (컨테이너별, PVC별, …)              | `filters.metrics.exclude`, `namespaceFilters.applyTo.metrics`, `cadvisor.metricsAllowlist`, `kubeletstats.volumeMetrics` |
| **옵트인 추가 기능**             | 프로파일링, 감사 로그, 컨트롤 플레인, 영역 간 메트릭 | 꺼진 상태로 두세요 (이미 기본적으로 꺼져 있음)                                               |

볼륨을 줄이는 방법은 세 가지이며, 어느 쪽을 사용하고 있는지 아는 것이 중요합니다:

- **리시버에서** — 데이터가 애초에 수집되지 않습니다. 파드 로그의 `namespaceFilters`, `cadvisor.metricsAllowlist`, 더 긴 `collectionInterval`. 실행 비용이 전혀 들지 않으며 CPU, 이그레스, 수집을 한꺼번에 절약합니다. 해당 사례를 다룰 수 있다면 항상 이쪽을 선호하세요.
- **필터 프로세서에서** — 데이터가 수집된 다음, 내보내기 전에 삭제됩니다. `filters.logs.minSeverity`, `filters.metrics.*`, `namespaceFilters.applyTo.*`. 컬렉터 CPU를 조금 더 쓰지만, 리시버 전반에 걸쳐 작동하며 리시버가 표현할 수 없는 것을 표현할 수 있습니다.
- **샘플러에서** — 데이터가 수집된 다음, 대표성 있는 일부만 유지됩니다. `sampling.traces.percentage`. 이것만 성격이 다릅니다: 위의 두 가지는 텔레메트리의 *범주* 하나를 통째로 제거하므로 이들이 삭제한 것은 모든 트레이스에서 사라집니다. 샘플링은 모든 범주를 유지한 채 모집단을 솎아 내므로, 살아남은 것은 여전히 완전하고 대표성이 있습니다.

세 가지 모두 **되돌릴 수 없습니다**: 여기에서 삭제한 것은 절대 OneUptime에 도달하지 않으며, 세 가지 모두 모니터를 조용하게 만들 수 있습니다. 앞의 두 가지는 모니터가 감시하는 시그널 자체를 제거해 모니터를 침묵시킵니다. 샘플링은 그보다 범위가 좁습니다: eBPF RED 메트릭은 샘플러가 실행되기 전에 계산되므로 메트릭 기반 모니터는 정확한 상태로 유지됩니다 — 하지만 *스팬*을 세는 모니터(`Span Count`를 사용하는 **Traces** 모니터, `Exception Count`를 사용하는 **Exceptions** 모니터)는 그에 비례해 더 적게 세므로 임계값을 같은 배수로 다시 튜닝해야 합니다. 나중에 결정하고 싶다면 OneUptime이 서버 측에서 데이터를 삭제할 수도 있습니다(**Logs → Settings → Drop Filters**, **Metrics → Settings → Pipeline Rules**) — 이는 여전히 이그레스 비용이 들지만, 재배포 없이 변경할 수 있는 설정입니다.

### 레버 1 — 파드 로그는 보통 가장 큰 단일 소스입니다

컨테이너 로그는 클러스터의 모든 컨테이너에서 로그 라인당 하나의 레코드이기 때문에 거의 항상 수집에서 가장 큰 부분을 차지합니다.

- **특정 네임스페이스의 로그만 원하나요?** `namespaceFilters`는 두 로그 모드 모두에서 파드 로그의 범위를 제한합니다(그리고 eBPF 트레이스도 함께). 매칭은 파드 로그 경로에서 일어나므로 필터링된 네임스페이스는 읽히지도 않습니다 — 이 문서에서 가장 저렴한 레버입니다:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set "namespaceFilters.include={default,production}"
  ```

  (`kube-system`은 이미 기본적으로 제외되어 있습니다.) 네임스페이스 하나만 빼고 전부 유지하려면 `--set "namespaceFilters.exclude={kube-system,noisy-namespace}"`를 사용하세요.

- **경고와 오류에만 관심 있나요?** `filters.logs.minSeverity`가 나머지를 에이전트에서 삭제합니다. 수다스러운 클러스터에서는 INFO와 DEBUG가 대부분의 애플리케이션 출력의 대부분을 차지하기 때문에, 이것이 종종 사용 가능한 가장 큰 단일 감소책입니다:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set filters.logs.minSeverity=WARN
  ```

  심각도가 어떻게 판별되는지, 그리고 분류할 수 없는 로그는 어떻게 되는지는 [로그 심각도로 필터링](#로그-심각도로-필터링)을 참조하세요.

- **OneUptime에서 파드 로그가 전혀 필요 없나요?** 끄세요:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set logs.enabled=false
  ```

  > 이것은 파드 로그만 중단합니다. 노드, 파드 및 컨테이너 메트릭은 계속 흐르고, 이를 기반으로 만든 모니터(OOM kill, CPU 스로틀링, PVC 저디스크)도 계속 작동합니다 — 노드 컬렉터는 그대로 남아 있고, 단지 `/var/log/pods`를 읽는 것만 중단합니다. `logs.mode: api`와 `logs.mode: disabled`도 마찬가지입니다.

### 레버 2 — eBPF 자동 계측 다듬기

eBPF는 코드 변경 없이 트레이스, RED 메트릭, 서비스 맵 및 네트워크 흐름 메트릭을 제공합니다 — 하지만 요청당 하나의 스팬과 서비스당 여러 메트릭 패밀리를 방출하기 때문에 두 번째로 큰 데이터 소스이기도 합니다. 세 가지 수준의 제어가 가능합니다:

- **이미 OTel SDK에서 트레이스를 전송하고 있거나 자동 트레이스를 원하지 않나요?** eBPF를 완전히 끄세요:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.enabled=false
  ```

- **트레이스는 유지하고 무거운 메트릭 패밀리는 제거하세요.** [위의 시그널 패밀리 표](#개별-시그널-패밀리-토글)에는 각 `ebpf.features.*` 플래그가 나열되어 있습니다. 가장 볼륨이 큰 패밀리는 네트워크 및 스팬 메트릭입니다 — 이를 끄면 트레이스, HTTP RED 메트릭 및 서비스 맵은 그대로 유지됩니다:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.features.networkMetrics=false \
    --set ebpf.features.tcpStats=false \
    --set ebpf.features.spanMetrics=false
  ```

  `ebpf.features.networkInterZoneMetrics`는 꺼진 상태(기본값)로 두세요 — 네트워크 흐름 카디널리티가 두 배가 됩니다.

- **관심 있는 런타임만 계측하세요.** 기본적으로 OBI는 인식하는 모든 프로세스에 연결됩니다(`ebpf.autoTargetExe: "*"`). 특정 런타임으로 좁히거나 바이너리를 건너뛰기 목록에 추가하여 에이전트가 생성하는 "서비스" 및 트레이스 수를 줄이세요:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.autoTargetExe='*/python,*/java'
  ```

  전체 기본값은 [개별 시그널 패밀리 토글](#개별-시그널-패밀리-토글)과 차트 값의 `excludeExePaths` 참고 사항을 확인하세요.

### 레버 3 — 스크레이프 간격을 늦추기

메트릭 볼륨은 에이전트가 스크레이프하는 빈도에 정비례합니다. 간격을 두 배로 늘리면 해당 메트릭이 생성하는 데이터 포인트 수가 커버리지 손실 없이 대략 절반으로 줄어들며 — 단지 해상도가 더 거칠어질 뿐입니다. 30초 단위의 세분성이 필요하지 않다면 60초 또는 120초가 크고 안전한 감소입니다:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set collectionInterval=60s \
  --set hostMetrics.collectionInterval=60s \
  --set cadvisor.scrapeInterval=60s
```

- `collectionInterval`(기본값 `30s`)는 노드 / 파드 / 컨테이너 메트릭(`kubeletstats`)과 클러스터 상태 메트릭(`k8s_cluster`)을 구동합니다 — 메트릭 볼륨의 대부분입니다.
- `hostMetrics.collectionInterval`과 `cadvisor.scrapeInterval`은 노드별 OS 메트릭과 스로틀링 / OOM 카운터를 다룹니다.
- `resourceSpecs.interval`(기본값 `300s`)은 전체 리소스 사양(레이블, 어노테이션, 상태)을 얼마나 자주 가져올지 제어합니다 — 사양 변경이 빠르게 반영될 필요가 없다면 이를 높이세요.
- 선택적 스크레이퍼를 활성화한 경우 이들도 자체 조정 항목이 있습니다: `kubeStateMetrics.scrapeInterval`, `serviceMesh.*.scrapeInterval`, `coreDns.scrapeInterval`, `csi.scrapeInterval`.

### 레버 4 — 메트릭 카디널리티를 제한된 상태로 유지하기

카디널리티(고유한 시계열 수)는 각 시리즈가 개별적으로 저장되고 청구되기 때문에 빈도만큼 중요합니다.

- **cAdvisor는 의도적으로 허용 목록으로 관리됩니다.** cAdvisor 리시버(기본 활성화)는 수백 개의 메트릭을 방출할 수 있습니다. 차트는 모니터를 구동하는 소수의 메트릭만 전달합니다(`cadvisor.metricsAllowlist`). 목록을 최소한으로 유지하세요 — **각 항목은 컨테이너별로 유지되므로 추가 메트릭 하나가 클러스터의 컨테이너 수만큼 곱해집니다.** kube-state-metrics는 기본적으로 꺼져 있지만, 이를 활성화하면(`kubeStateMetrics.enabled=true`) 해당 `kubeStateMetrics.metricsAllowlist`가 동일한 방식으로 카디널리티를 제어합니다.
- **PVC별 볼륨 메트릭**(`kubeletstats.volumeMetrics.enabled`, 기본 활성화)은 파드별 PVC당 하나의 시리즈를 방출합니다. 대부분의 클러스터에서는 괜찮지만 수천 개의 PVC가 있는 상태 저장 워크로드(Kafka, 데이터베이스)에서는 상당할 수 있습니다 — PVC 디스크 공간을 감시하지 않는다면 거기에서 이를 끄세요:

  ```bash
  --set kubeletstats.volumeMetrics.enabled=false
  ```

- **포화 메트릭**(`kubeletstats.utilizationMetrics.enabled`, 기본 활성화)은 8개의 파생된 "요청/제한 대비 %" 패밀리를 추가합니다. 이들은 저렴하지만(추가 스크레이프 없음) CPU/메모리 대 제한 모니터를 사용하지 않는다면 `--set kubeletstats.utilizationMetrics.enabled=false`로 제거할 수 있습니다.

- **이름으로 특정 메트릭 삭제하기.** 위의 허용 목록은 리시버별이지만, `filters.metrics.exclude`는 모든 리시버에 걸쳐 적용되므로 리시버 수준의 조정 항목으로 표현할 수 없는 것에 사용하세요:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set filters.metrics.matchType=regexp \
    --set-json 'filters.metrics.exclude=["^container_network_"]'
  ```

  정확한 이름 매칭과 정규식 매칭의 차이 및 허용 목록 형식은 [이름으로 메트릭 포함 또는 제외하기](#이름으로-메트릭-포함-또는-제외하기)를 참조하세요.

- **네임스페이스 전체의 메트릭 삭제하기.** 어떤 네임스페이스가 시끄럽지만 그 노드는 계속 감시하고 싶다면, `namespaceFilters.applyTo.metrics=true`가 기존 네임스페이스 목록을 파드별 및 컨테이너별 시리즈에 적용합니다. 노드 및 클러스터 수준 시리즈는 항상 유지됩니다:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set namespaceFilters.applyTo.metrics=true
  ```

### 레버 5 — 무거운 옵트인 기능을 끈 상태로 두기

이들은 부하를 추가하기 때문에 정확히 **기본적으로 꺼져 있습니다** — 그것이 구동하는 것을 실제로 사용할 때만 활성화하고, 단지 시험해 본 것이라면 다시 끄세요:

| 값                                                        | 추가하는 항목                                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `profiling.enabled`                                       | 지속적인 CPU 프로파일링 DaemonSet — eBPF 트레이스보다 무거움                    |
| `auditLogs.enabled`                                       | 모든 Kubernetes API 요청을 로그 레코드로 (높은 볼륨)                            |
| `controlPlane.enabled`                                    | etcd / API 서버 / 스케줄러 / 컨트롤러 매니저 메트릭                             |
| `kubeStateMetrics.enabled`                                | CrashLoop / ImagePull / 스케줄링 사유 메트릭 (KSM Deployment + 스크레이프 추가) |
| `ebpf.features.networkInterZoneMetrics`                   | 네트워크 흐름 메트릭 카디널리티가 두 배가 됨                                    |
| `serviceMesh.enabled` / `csi.enabled` / `coreDns.enabled` | 추가 Prometheus 스크레이프 작업                                                 |

### 레버 6 — 트레이스를 삭제하는 대신 샘플링하기

위의 모든 레버는 무언가를 포기하는 대가로 볼륨을 얻습니다: 더 이상 지켜보지 않는 네임스페이스, 더 이상 유지하지 않는 심각도, 더 이상 수집하지 않는 메트릭 패밀리. 샘플링은 예외이며, 바쁜 클러스터에서는 가장 적은 손실로 가장 크게 줄일 수 있는 방법인 경우가 많습니다:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set sampling.traces.percentage=10
```

이는 트레이스 볼륨을 90% 줄이며, 여기 있는 다른 어떤 레버보다도 잃는 것의 범위가 좁습니다:

- 유지되는 트레이스는 **온전합니다** — 판정이 트레이스 ID를 해싱하므로 한 트레이스의 모든 스팬이 판정을 공유합니다. 트레이스가 깨지는 것이 아니라 수가 줄어들 뿐입니다.
- **RED 메트릭은 정확한 상태로 유지됩니다.** 요청 속도, 오류율, 지속 시간은 OBI가 모든 요청에서 계산하며 메트릭 파이프라인을 따라 흐르는데, 샘플러는 그 파이프라인에 없습니다. 이를 기반으로 만든 모든 대시보드와 모니터는 이전과 똑같이 읽힙니다.

포기하는 것은 대체로 예시 트레이스입니다: 모니터가 울렸을 때 열어 볼 트레이스가 10분의 1로 줄어듭니다. 초당 수천 개의 동일한 요청을 처리하는 클러스터에서는 보통 좋은 거래입니다 — 백 번째로 동일한 `/healthz` 스팬은 첫 번째가 알려 주지 않은 것을 알려 주지 않습니다. 조용한 클러스터에서는 나쁜 거래인데, 장애를 일으킨 그 드문 요청의 예시가 하나도 없을 수 있기 때문입니다.

예외가 하나 있으며, 롤아웃하기 전에 확인해야 할 것은 바로 이것입니다: 메트릭이 아니라 **스팬을 세는** 모니터 — `Span Count`를 사용하는 **Traces** 모니터, `Exception Count`를 사용하는 **Exceptions** 모니터 — 는 그에 비례해 더 적게 세므로, 임계값을 같은 배수로 다시 튜닝해야 합니다. [트레이스 샘플링](#트레이스-샘플링)을 참조하세요.

eBPF 트레이스가 수집에서 큰 비중을 차지하지만 서비스 맵과 RED 메트릭은 그대로 유지하고 싶을 때 이것을 선택하세요. 무언가의 계측을 아예 중단하고 싶다면 레버 2를 선호하세요.

`0`이 끄는 스위치가 아니라 비율인 이유와 로그나 메트릭에 대응하는 항목이 없는 이유를 포함한 전체 동작은 [트레이스 샘플링](#트레이스-샘플링)을 참조하세요.

### 간소한 시작점

설치 규모는 줄이되 모니터는 계속 작동하기를 원한다면, 이 프로필은 **전체 메트릭 커버리지**를 유지하면서 실제로 볼륨을 좌우하는 두 가지 — 로그 라인과 eBPF 스팬 — 를 줄입니다:

```yaml
# lean-values.yaml
oneuptime:
  url: YOUR_ONEUPTIME_URL
  apiKey: YOUR_ONEUPTIME_API_KEY
clusterName: my-cluster

# 메트릭 데이터 포인트를 절반으로. 해상도는 거칠어지지만 커버리지는 동일합니다.
collectionInterval: 60s
hostMetrics:
  collectionInterval: 60s
cadvisor:
  scrapeInterval: 60s

# 파드 로그는 유지하되 알림 가치가 있는 것만 전송합니다. (메트릭은 이것에
# 의존하지 않습니다 — 노드 컬렉터는 어느 쪽이든 실행됩니다.)
logs:
  enabled: true
  mode: daemonset

filters:
  logs:
    minSeverity: WARN # 에이전트에서 INFO / DEBUG / TRACE를 삭제

namespaceFilters:
  exclude:
    - kube-system
    - noisy-namespace

ebpf:
  enabled: true
  features:
    networkMetrics: false # 가장 무거운 eBPF 패밀리
    tcpStats: false
    spanMetrics: false
```

```bash
helm upgrade --install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --create-namespace \
  -f lean-values.yaml
```

필요에 따라 더 조이세요: `minSeverity`를 `ERROR`로 높이거나, `namespaceFilters.applyTo.metrics=true`를 추가하거나, 이미 OTel SDK에서 트레이스를 전송하고 있다면 `ebpf.enabled=false`로 설정하세요.

> **무엇을 잘라내는지 주의하세요.** 일부 모니터는 특정 시그널에 의존합니다: `cadvisor`를 비활성화하면 OOM-kill 및 CPU 스로틀링 모니터가 제거되고, `kubeletstats.volumeMetrics`를 비활성화하면 PVC 저디스크 모니터가 제거되며, 로그를 비활성화하면 로그 기반 알림이 제거됩니다. 그리고 `sampling.traces.percentage`는 모니터를 제거하지는 않지만 스팬 기반 모니터(`Span Count`를 사용하는 **Traces** 모니터, `Exception Count`를 사용하는 **Exceptions** 모니터)를 함께 축소하므로, 그에 맞춰 임계값을 다시 튜닝하세요. 모니터가 감시하는 시그널이 아니라 대응하지 않는 시그널을 다듬으세요.

### 효과 측정

텔레메트리 사용량은 하루 단위로 집계되므로, 감소를 확인하려면 **Project Settings → Usage History**에서 하루 이틀에 걸친 추세를 확인하세요 — 변경 사항을 적용하는 즉시 움직이지는 않습니다. 모든 것을 한 번에 낮춰서 실제로 의존하던 모니터를 잃는 대신, 한 번에 하나의 레버씩 변경하여 차이를 귀속시킬 수 있도록 하세요 — 로그 끄기, 그다음 간격 늘리기, 그다음 eBPF 다듬기.

## 문제 해결

> **가장 빠른 방법 — 진단 스크립트를 실행하세요.** 이 스크립트는 파드 상태를 검사하고, 수집 키를 디코딩 및 검증하며, 클러스터가 OneUptime에 도달할 수 있는지 확인하고, OneUptime에 토큰이 실제로 수락되는지 문의한 다음 — 단일 근본 원인 판정을 출력합니다:
>
> ```bash
> curl -fsSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/HelmChart/Public/kubernetes-agent/troubleshoot.sh \
>   | bash -s -- -n oneuptime-agent
> ```
>
> 이 스크립트는 클러스터 상태를 읽고 몇 가지 프로브만 실행할 뿐, 아무것도 변경하지 않습니다. 가장 정확한 이그레스 테스트를 위해서는 먼저 `--set debug.enabled=true`로 설치한 다음(이는 에이전트 파드에 작은 네트워크 도구 사이드카를 추가하여 스크립트가 컬렉터의 정확한 이그레스 경로를 테스트하도록 함) 다시 실행하세요.

### 설치가 "hostPath volumes are not allowed" 또는 Pod Security admission 오류로 실패

클러스터가 `hostPath`를 차단합니다 — **GKE Autopilot** 및 **EKS Fargate**에서 흔히 발생합니다. API 모드 프리셋으로 전환하세요:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set preset=gke-autopilot   # or eks-fargate
```

### 에이전트가 "Disconnected"로 표시됨

클러스터의 연결 상태는 순전히 도착하는 텔레메트리에 의해 결정됩니다 — 데이터가 도착하지 않으면 약 15분 후에 클러스터가 연결 끊김으로 표시됩니다. 따라서 "연결 끊김"과 "메트릭 없음"은 거의 항상 **동일한** 원인을 갖습니다: 에이전트의 텔레메트리가 수락되지 않는 것입니다.

가장 흔한 이유 — 특히 재설치 후 — 는 **잘못되었거나 취소된 수집 키**입니다. OTLP 수집 엔드포인트는 잘못된 토큰에 대해서도 의도적으로 HTTP `200`을 반환하기 때문에(잘못 구성된 컬렉터가 서버에 재시도 폭주를 일으킬 수 없도록) 이를 놓치기 쉽습니다. 그 결과 컬렉터는 성공을 보고하고, 로그에는 오류가 표시되지 않으며, 데이터는 조용히 폐기됩니다.

1. 에이전트 파드가 실행 중인지 확인하세요: `kubectl get pods -n oneuptime-agent`
2. metrics-collector 로그를 확인하세요: `kubectl logs -n oneuptime-agent -l component=metrics-collector -c otel-collector` (여기에 오류가 없다고 해서 데이터가 도착하고 있다는 의미는 **아닙니다** — 위 내용 참조)
3. **수집 키를 검증하세요.** OneUptime에 토큰이 수락되는지 직접 문의하세요(`200` = 유효, `401` = 알 수 없음/취소됨):

   ```bash
   curl -i -H "x-oneuptime-token: <YOUR_API_KEY>" https://oneuptime.com/otlp/v1/validate
   ```

   `401`을 반환하면 릴리스의 키가 잘못되었거나 취소된 것입니다. *Project Settings → Telemetry Ingestion Keys*에서 유효한 키를 복사하여 다시 배포하세요:

   ```bash
   helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
     --namespace oneuptime-agent --reuse-values \
     --set oneuptime.apiKey=<LIVE_KEY>
   ```

4. OneUptime URL이 올바른지, 그리고 클러스터가 네트워크를 통해 도달할 수 있는지 확인하세요.
5. 재설치 시 `clusterName`을 변경했다면 에이전트가 **새로운** 클러스터로 나타나며, 이전 항목은 "Disconnected" 상태로 남습니다(이는 예상된 동작이며 오래된 항목입니다).

### 로그가 나타나지 않음 (API 모드 전용)

1. 로그 테일러 파드가 Ready 상태인지 확인하세요: `kubectl get pods -n oneuptime-agent -l component=log-collector`
2. 해당 파드의 `/healthz`를 확인하세요 — 활성 스트림 수와 마지막 내보내기 오류를 보고합니다
3. 로그를 확인하세요: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent-logs`
4. 매우 큰 클러스터의 경우 단일 레플리카가 병목이 될 수 있습니다 — 별도의 릴리스에서 `namespaceFilters.include`를 사용하여 네임스페이스별로 샤딩하세요

### 메트릭이 나타나지 않음

1. 먼저 거부된 수집 키를 배제하세요 — 가장 흔한 원인이며 에이전트 측에서는 보이지 않습니다. 위의 [에이전트가 "Disconnected"로 표시됨](#에이전트가-disconnected로-표시됨)을 참조하세요(또는 진단 스크립트를 실행하세요).
2. 클러스터 식별자가 `clusterName`으로 전달한 값과 일치하는지 확인하세요
3. RBAC 권한을 검증하세요: `kubectl get clusterrolebinding | grep kubernetes-agent`
4. OTel 컬렉터 로그에서 내보내기 오류를 확인하세요

### eBPF 파드가 CrashLoopBackOff이거나 시작에 실패함

```bash
kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200
```

흔한 원인:

- **커널이 너무 오래되었거나 BTF가 없음.** OBI는 BTF가 있는 Linux 5.8 이상이 필요합니다. 노드에서 `uname -r`을 실행하세요. 업그레이드할 수 없다면 eBPF를 비활성화하세요: `--set ebpf.enabled=false`.
- **privileged 파드가 차단됨.** 일부 클러스터는 privileged 파드를 거부합니다(GKE Autopilot, EKS Fargate 및 잠금된 환경). eBPF를 비활성화하세요.
- **`debugfs` / `tracefs`가 호스트에 마운트되지 않음.** `tcpStats` 기능은 이를 필요로 하는 커널 트레이스포인트에 연결됩니다. 차트는 `hostPath`를 통해 둘 다 마운트하지만, 호스트가 이를 노출하지 않으면 해당 패밀리만 비활성화하세요: `--set ebpf.features.tcpStats=false`.

### 애플리케이션 트레이스가 나타나지 않음

1. eBPF DaemonSet이 정상인지 확인하세요: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`
2. OBI가 트래픽을 캡처하고 있는지 확인하기 위해 디버그 트레이스 프린터를 켜세요: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, 그런 다음 `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`을 확인하세요
3. OBI의 stdout에서는 스팬이 보이지만 대시보드에는 보이지 않는다면, 문제는 컬렉터 → OneUptime 내보내기입니다 — metrics-collector 파드의 로그를 확인하세요.

## 다음 단계

- 이 에이전트가 수집하는 메트릭을 기반으로 **Kubernetes 모니터**를 구성하세요 — [Kubernetes 에이전트 (모니터)](/docs/monitor/kubernetes-agent)를 참조하세요.
- 특정 로그 패턴에 대해 알림을 받으려면 **로그 모니터**를 추가하세요(예: 파드별 또는 네임스페이스별 임계값을 초과하는 오류 수).
- Kubernetes가 아닌 호스트(Linux / macOS / Windows VM 및 베어메탈)의 경우 [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector) 페이지를 사용하세요.
