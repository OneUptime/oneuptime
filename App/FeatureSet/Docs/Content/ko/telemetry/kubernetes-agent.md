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

| `preset` | 사용 대상 | 로그 수집 |
|---|---|---|
| `standard` *(기본값)* | 자체 관리형 클러스터, **EKS on EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | hostPath를 통해 `/var/log/pods`를 읽는 DaemonSet (가장 낮은 오버헤드) |
| `gke-autopilot` | **GKE Autopilot** | Kubernetes API 로그 테일러 Deployment (hostPath 없음, 호스트 접근 없음) |
| `eks-fargate` | **EKS Fargate** | Kubernetes API 로그 테일러 Deployment (hostPath 없음, 호스트 접근 없음) |

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

**표준** 클러스터에서는 metrics-collector Deployment와 함께 노드당 하나의 log-collector DaemonSet 파드가 표시됩니다:

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-xxxxx                   1/1     Running   0          1m
kubernetes-agent-logs-yyyyy                   1/1     Running   0          1m
```

**GKE Autopilot** 또는 **EKS Fargate**에서는 DaemonSet 대신 두 개의 Deployment가 표시됩니다:

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-yyyyyyyyyy-yyyyy        1/1     Running   0          1m
```

에이전트가 연결되면 클러스터가 OneUptime 대시보드의 **Kubernetes** 섹션에 자동으로 나타납니다.

## 구성 옵션

### 네임스페이스 필터링

기본적으로 `kube-system`은 제외됩니다. 특정 네임스페이스만 모니터링하려면:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set "namespaceFilters.include={default,production,staging}"
```

### 로그 수집 비활성화

메트릭과 이벤트만 필요하고 파드 로그는 필요 없는 경우:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set logs.enabled=false
```

### 특정 로그 수집 모드 강제 적용

고급 사용자는 `logs.mode`로 프리셋의 선택을 재정의할 수 있습니다:

- `logs.mode=daemonset` — hostPath DaemonSet (가장 낮은 오버헤드, hostPath 필요)
- `logs.mode=api` — Kubernetes API 로그 테일러 Deployment (모든 클러스터에서 작동)
- `logs.mode=disabled` — 로그 수집 안 함

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

| 카테고리 | 데이터 |
|----------|------|
| **노드 메트릭** | CPU 사용률, 메모리 사용량, 파일 시스템 사용량, 네트워크 I/O |
| **파드 메트릭** | CPU 사용량, 메모리 사용량, 네트워크 I/O, 재시작 |
| **컨테이너 메트릭** | 컨테이너별 CPU 사용량, 메모리 사용량 |
| **클러스터 메트릭** | 노드 상태, 할당 가능 리소스, 파드 수 |
| **Kubernetes 이벤트** | 경고, 오류, 스케줄링 이벤트 |
| **파드 로그** | 모든 컨테이너의 stdout/stderr 로그 (표준 클러스터에서는 hostPath DaemonSet을 통해, Autopilot / Fargate에서는 Kubernetes API를 통해) |
| **애플리케이션 트레이스** *(eBPF를 통해, 기본 활성화)* | 모든 파드의 HTTP, gRPC, SQL/Redis 스팬 — SDK나 코드 변경 없음 |
| **HTTP RED 메트릭** *(eBPF를 통해)* | 서비스별 `http.server.request.duration`, 요청 및 응답 본문 크기 |
| **서비스 그래프** *(eBPF를 통해)* | 호출자 → 피호출자 요청 속도, 지연 시간 및 오류 엣지 — 서비스 맵 뷰를 구동 |
| **네트워크 흐름 메트릭** *(eBPF를 통해)* | k8s 메타데이터와 함께 파드 간 TCP/UDP 바이트 및 패킷 카운터 |
| **TCP 통계** *(eBPF를 통해)* | 노드 수준 RTT, 실패한 연결 및 재전송 카운터 |

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

| `ebpf.features.*` | 기본값 | 추가하는 항목 |
|---|---|---|
| `httpMetrics` | on | 서비스별 HTTP/gRPC RED 메트릭 (요청 속도, 지연 시간, 오류) |
| `spanMetrics` | on | 스팬별 요청/응답 크기 및 지속 시간 |
| `serviceGraph` | on | 호출자 → 피호출자 엣지 메트릭, 서비스 맵을 구동 |
| `hostMetrics` | on | 계측된 프로세스별 CPU 및 메모리 |
| `networkMetrics` | on | 파드 간 TCP/UDP 흐름 카운터 |
| `networkInterZoneMetrics` | off | 네트워크 메트릭의 영역 간 변형 (카디널리티가 두 배가 됨) |
| `tcpStats` | on | 노드 수준 TCP RTT, 실패한 연결, 재전송 카운터 |

서비스 간 트레이스 컨텍스트 전파도 기본적으로 활성화되어 있습니다 — OBI는 아웃바운드 HTTP/TCP에 W3C `traceparent`를 주입하므로, 파드 A → 파드 B를 가로지르는 요청이 단일 트레이스로 표시되며 어디에서도 SDK 변경이 필요 없습니다. `--set ebpf.contextPropagation=false`로 끌 수 있습니다.

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

1. 먼저 거부된 수집 키를 배제하세요 — 가장 흔한 원인이며 에이전트 측에서는 보이지 않습니다. 위의 [에이전트가 "Disconnected"로 표시됨](#agent-shows-disconnected)을 참조하세요(또는 진단 스크립트를 실행하세요).
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
