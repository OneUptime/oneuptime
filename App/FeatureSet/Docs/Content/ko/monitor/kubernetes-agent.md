# Kubernetes 에이전트 설치

OneUptime Kubernetes 에이전트는 Kubernetes 클러스터에서 클러스터 메트릭, 이벤트, 파드 로그, **애플리케이션 트레이스(eBPF를 통한 HTTP/gRPC)**, **OS 레벨 노드 메트릭**을 수집하여 OneUptime으로 전송합니다. Helm 차트로 배포되며 단일 명령으로 설치됩니다 — eBPF 자동 계측이 기본적으로 활성화되어 있으므로 코드 변경 없이 서비스 레벨 트레이스와 RED 메트릭을 확인할 수 있습니다. **연속 CPU 플레임 그래프(eBPF 프로파일러)**도 사용할 수 있으며, 더 많은 텔레메트리를 원할 때 `--set profiling.enabled=true`로 옵트인하십시오.

## 빠른 시작

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

클러스터는 몇 분 내에 OneUptime에 나타납니다.

## 클러스터에 맞는 프리셋 선택

Kubernetes 배포판마다 서로 다른 제약 조건이 있습니다 — 가장 주목할 점은 워크로드가 `hostPath` 볼륨을 마운트할 수 있는지 여부입니다. 보안 문서를 일일이 읽지 않아도 되도록, 차트는 단일 최상위 옵션인 `preset`을 제공합니다.

| 프리셋              | 사용 대상                                                                  | 로그 수집                                        | 비고                                                                                                                    |
| ------------------- | -------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `standard` (기본값) | 자체 관리형, **EC2의 EKS**, **GKE Standard**, **AKS**, minikube, kind, k3s | hostPath를 통해 `/var/log/pods`를 읽는 DaemonSet | 가장 낮은 오버헤드. 이러한 플랫폼에서는 hostPath를 사용할 수 있습니다.                                                  |
| `gke-autopilot`     | **GKE Autopilot**                                                          | Kubernetes API 테일러(Deployment)                | Autopilot에서는 hostPath가 차단됩니다. Autopilot의 Pod Security Standards를 통과하는 강화된 보안 컨텍스트를 설정합니다. |
| `eks-fargate`       | **EKS Fargate**                                                            | Kubernetes API 테일러(Deployment)                | `gke-autopilot`과 동일합니다. Fargate는 hostPath와 DaemonSet을 차단합니다.                                              |

확실하지 않다면 `preset`을 설정하지 않은 채로 두십시오 — `standard` 기본값이 적용됩니다. `hostPath`를 언급하는 Pod Security 정책 오류로 설치가 거부된다면 `gke-autopilot`(또는 EKS Fargate의 경우 `eks-fargate`)으로 전환한 후 재설치하십시오.

### 예시

**GKE Standard, EC2의 EKS, 자체 관리형 또는 AKS:**

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

## 두 가지 로그 수집 모드의 차이점

내부적으로 `preset`은 `logs.mode`를 설정합니다 — 프리셋 기본값을 재정의해야 하는 경우 이를 직접 설정할 수도 있습니다.

### DaemonSet 모드 (`logs.mode: daemonset`)

DaemonSet은 노드당 하나의 OpenTelemetry Collector 파드를 실행합니다. hostPath 볼륨을 통해 `/var/log/pods/` 아래의 로그 파일을 추적하고 OTLP로 전달합니다.

- **장점:** 가장 낮은 오버헤드, 노드에 따라 선형적으로 확장, Kubernetes API 서버에 부하를 주지 않음, 로그 로테이션 처리.
- **단점:** hostPath가 필요하며 DaemonSet을 예약할 수 있어야 합니다 — 두 가지 모두 GKE Autopilot 및 EKS Fargate에서는 사용할 수 없습니다.

### API 모드 (`logs.mode: api`)

단일 복제본 Deployment(`oneuptime/kubernetes-log-tailer` 이미지)가 Kubernetes API를 사용하여 컨테이너 로그를 스트리밍합니다 — `kubectl logs -f`가 사용하는 것과 동일한 엔드포인트입니다. hostPath도, 호스트 액세스도, DaemonSet도 필요 없습니다.

- **장점:** GKE Autopilot, EKS Fargate 및 hostPath를 차단하거나 `restricted` Pod Security Standard를 적용하는 모든 클러스터에서 작동합니다.
- **단점:** 모든 컨테이너 스트림이 `kube-apiserver`에 대한 장기 연결이 됩니다. 실제로 단일 복제본으로도 수천 개의 컨테이너를 무리 없이 처리합니다. 매우 큰 클러스터의 경우 각 복제본에서 `logs.api.replicas`와 `namespaceFilters.include`를 사용하여 네임스페이스별로 샤딩하십시오.

### 어느 것을 사용해야 하나요?

hostPath가 작동한다면 DaemonSet을 사용하십시오. 그 외의 환경에서는 API 모드를 사용하십시오. `preset` 설정이 적합한 모드를 선택해 줍니다.

`--set logs.enabled=false`로 로그 수집을 완전히 비활성화하고 대신 OpenTelemetry SDK를 통해 애플리케이션 로그를 전송할 수도 있습니다. [OpenTelemetry](/docs/telemetry/open-telemetry) 문서를 참조하십시오.

## eBPF를 통한 애플리케이션 트레이스 및 HTTP 요청 (기본 활성화)

차트는 모든 노드에서 [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/)를 실행하는 DaemonSet을 포함합니다. OBI는 Linux 커널에 eBPF 프로그램을 로드하고 소켓 레벨 트래픽을 관찰하여 노드의 모든 파드에서 HTTP/HTTPS, gRPC, SQL/Redis 호출을 재구성합니다 — 코드 변경, SDK, 사이드카가 모두 필요 없습니다. 캡처된 트래픽은 OTLP 트레이스와 요청/지연 메트릭으로 OneUptime에 직접 내보내집니다.

설치 후 1~2분 이내에 **Telemetry → Traces**와 서비스 맵에서 서비스가 표시되기 시작하며, `k8s.cluster.name`이 `clusterName`으로 설정되어 클러스터별로 필터링할 수 있습니다.

### 비활성화해야 할 시점

eBPF는 **기본적으로 활성화**되어 있습니다. 다음과 같은 경우 비활성화(`--set ebpf.enabled=false`)해야 합니다:

- **GKE Autopilot** 또는 **EKS Fargate**에 설치하는 경우. 이러한 플랫폼은 특권 파드를 차단하며, OBI는 eBPF 프로그램을 로드하기 위해 특권 모드가 필요합니다.
- 노드가 BTF 백포트 없이 **Linux 5.8**보다 오래된 커널을 실행하는 경우. (최신 배포판 — Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL/Stream 9+ — 는 문제가 없습니다.)
- 이미 애플리케이션에서 OpenTelemetry SDK를 통해 트레이스를 전송하고 있어 중복을 원하지 않는 경우.

### 무엇이 전송되는가

OBI는 캡처된 트래픽에서 여러 시그널 패밀리를 추출합니다. 모두 기본적으로 활성화되어 있으며, 각 항목은 `--set ebpf.features.<key>=false`로 개별적으로 비활성화할 수 있습니다:

| 시그널                                  | 기본값 | 추가되는 내용                                                                                                                                                      |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ebpf.features.httpMetrics`             | on     | HTTP/gRPC RED 메트릭 — 서비스별 요청률, 지연 히스토그램, 오류 카운트.                                                                                              |
| `ebpf.features.spanMetrics`             | on     | 스팬 속성 기반 메트릭: 라우트/오퍼레이션별로 분류된 요청 크기, 응답 크기, 지속 시간.                                                                               |
| `ebpf.features.serviceGraph`            | on     | 서비스 간 엣지 메트릭(호출자 → 피호출자 요청률 및 지연). 서비스 맵을 구동합니다.                                                                                   |
| `ebpf.features.hostMetrics`             | on     | 계측된 프로세스별 CPU 및 메모리 — 기본적인 용량 질문을 위해 별도의 프로파일러를 실행할 필요가 없습니다.                                                            |
| `ebpf.features.networkMetrics`          | on     | k8s 메타데이터가 포함된 파드 간 TCP/UDP 플로우 바이트 및 패킷 카운터. OBI가 파싱할 수 없는 프로토콜을 사용하는 파드를 포함하여 통신하는 모든 파드 쌍을 표시합니다. |
| `ebpf.features.networkInterZoneMetrics` | off    | 네트워크 메트릭의 존 간 변형. 카디널리티가 두 배가 됩니다; 실제로 존 기반 스케줄링을 사용하는 경우에만 활성화할 가치가 있습니다.                                   |
| `ebpf.features.tcpStats`                | on     | 노드 레벨 TCP 통계: RTT 히스토그램, 실패한 연결 수, 재전송.                                                                                                        |

OBI는 또한 기본적으로 서비스 경계 전반에 걸쳐 트레이스 컨텍스트를 전파합니다. 파드 A가 파드 B로 HTTP/gRPC 요청을 보낼 때 OBI는 아웃바운드 요청에 W3C `traceparent` 헤더를 삽입합니다 — 따라서 파드 B 쪽에서 생성되는 결과 스팬이 파드 A의 아웃바운드와 동일한 트레이스에 연결됩니다. 어느 앱에서도 SDK 변경이 필요하지 않습니다.

| 옵션                       | 기본값 | 설명                                                                                                                                                        |
| -------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ebpf.contextPropagation`  | on     | 아웃바운드 트래픽(HTTP 헤더 + 사용자 정의 TCP 옵션)에 W3C `traceparent`를 삽입합니다. 각 서비스의 스팬을 로컬로 유지하려면 `false`로 설정하십시오.          |
| `ebpf.trackRequestHeaders` | on     | 일반 HTTP 서버(Go가 아닌 경우, TLS가 아닌 경우)에서도 전파가 작동하도록 커널 측 요청 헤더 추적을 수행합니다. `contextPropagation`이 true일 때만 적용됩니다. |

### 로그 ↔ 트레이스 상관관계

이 기능도 기본적으로 활성화되어 있습니다. OBI의 로그 인리처는 계측된 프로세스의 파드 stdout 쓰기를 가로채어 다음을 수행합니다:

- **JSON 형식 로그**의 경우: 라인에 `trace_id` 및 `span_id` 필드를 삽입합니다(로그의 기존 값은 보존됨). 그러면 filelog DaemonSet이 해당 필드를 LogRecord의 네이티브 trace_id/span_id 슬롯으로 끌어올리므로, 트레이스 뷰에서 스팬을 클릭하면 OneUptime에서 해당 로그로 이동하며 — 반대로 로그 라인을 클릭하면 부모 트레이스로 이동합니다.
- **JSON이 아닌 로그**의 경우: 라인은 그대로 보존됩니다 — 여전히 수집되지만 자동으로 연결되지는 않습니다.

| 옵션                         | 기본값 | 설명                                                                                                                |
| ---------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------- |
| `ebpf.logToTraceCorrelation` | on     | OBI 로그 인리처와 filelog 파이프라인의 trace_id 끌어올리기를 활성화합니다. 둘 다 건너뛰려면 `false`로 설정하십시오. |

주의 사항:

- **trace_id가 표시되려면 로그가 JSON이어야 합니다.** 로거를 JSON 포맷터로 전환하십시오 — `structlog`, `pino`, `winston`, `serilog`, `logback-json`, klog `--logging-format=json` 등.
- **버퍼링된 stdout은 상관관계를 깨뜨립니다.** `write()` 시스템 콜이 요청을 처리한 스레드와 다른 스레드에서 발생하기 때문입니다. 일반적인 해결책:
  - **Python**: `PYTHONUNBUFFERED=1`을 설정합니다(런타임은 TTY가 아닐 때 stdout을 블록 버퍼링합니다).
  - **.NET**: 시작 시 `Console.SetOut(new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true })`를 실행합니다. Microsoft.Extensions.Logging의 `AddConsole()`과 Serilog의 비동기 싱크도 작동하지 않습니다 — 동기식 콘솔 라이터로 전환하십시오(Serilog의 기본값인 `WriteTo.Console()`은 괜찮습니다).
- Greenlet / gevent, Tornado 및 기타 사용자 정의 비동기 런타임은 지원되지 않습니다.

### 튜닝

| 옵션                   | 기본값                                                 | 설명                                                                                              |
| ---------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `ebpf.enabled`         | `true`                                                 | 마스터 스위치. eBPF DaemonSet 전체를 건너뛰려면 `false`로 설정하십시오.                           |
| `ebpf.image.tag`       | `v0.9.0`                                               | OBI 이미지 태그. OBI는 1.0 이전 버전이므로, 검증된 버전에 고정하고 업데이트 시 재테스트하십시오.  |
| `ebpf.autoTargetExe`   | `*`                                                    | 계측할 실행 파일의 글로브 패턴. 자동 계측 범위를 좁히려면 이를 좁히십시오(예: `*/python,*/java`). |
| `ebpf.excludeExePaths` | (shells, kubelet, runc, containerd, otelcol, OBI 자체) | 건너뛸 글로브 패턴(쉼표로 구분).                                                                  |
| `ebpf.logLevel`        | `info`                                                 | `debug`, `info`, `warn` 또는 `error`. 문제 해결 시 `debug`로 설정하십시오.                        |
| `ebpf.printTraces`     | `false`                                                | OTLP 내보내기에 더해 OBI의 stdout에 스팬을 출력합니다 — 설치 중 캡처를 확인하는 데 유용합니다.    |
| `ebpf.resources.*`     | `100m / 256Mi` 요청, `1000m / 1Gi` 제한                | 트래픽이 많은 클러스터의 경우 늘리십시오.                                                         |

OBI가 실행 중이며 트래픽을 보고 있는지 확인하려면:

```bash
kubectl get pods -n oneuptime-kubernetes-agent -l component=ebpf-instrument
kubectl logs -n oneuptime-kubernetes-agent -l component=ebpf-instrument --tail=200
```

## 연속 CPU 프로파일링 (기본 비활성화)

별도의 DaemonSet이 [OpenTelemetry eBPF Profiler](https://github.com/open-telemetry/opentelemetry-ebpf-profiler)를 실행합니다 — `otel/opentelemetry-collector-ebpf-profiler` 이미지로 패키징되어 있습니다. 지원되는 모든 런타임(Go, Java, .NET, Python, Ruby, Node.js, PHP, Perl, C/C++, Rust)에서 19Hz로 on-CPU 스택을 샘플링하고 OTLP 프로파일을 OneUptime으로 전송하며, **Telemetry → Performance Profiles** 아래와 개별 트레이스 스팬에서 연결된 플레임 그래프로 표시됩니다.

프로파일링은 **기본적으로 비활성화**되어 있습니다 — OBI 자동 계측보다 무거우며(노드당 CPU 사용량이 더 많고 메모리 사용량이 더 큼), 모든 클러스터가 항상 켜진 플레임 그래프를 원하는 것은 아닙니다. 더 풍부한 텔레메트리를 원할 때 활성화하십시오: `--set profiling.enabled=true`.

eBPF 자동 계측도 활성화되어 있는 경우(`ebpf.enabled: true`, 기본값), 각 CPU 샘플은 공유된 bpffs 맵을 통해 OBI의 트레이스 컨텍스트와 상관 관계가 지정됩니다 — 따라서 플레임 그래프에 trace_id/span_id가 포함되며 OneUptime UI는 스팬별 플레임 그래프를 보여줄 수 있습니다.

요구 사항:

- **Linux 커널 5.10+** (OBI가 필요로 하는 5.8보다 약간 더 최신 버전).
- hostPID를 사용하는 특권 파드 — eBPF 자동 계측 DaemonSet과 동일한 제약입니다. GKE Autopilot, EKS Fargate 또는 기타 잠긴 환경에서는 실행할 수 없습니다.

튜닝:

| 옵션                          | 기본값               | 설명                                                                                                                                                   |
| ----------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `profiling.enabled`           | `false`              | 마스터 스위치. 기본적으로 비활성화; 연속 CPU 플레임 그래프를 사용하려면 옵트인하십시오.                                                                |
| `profiling.image.tag`         | `0.152.0`            | `otel/opentelemetry-collector-ebpf-profiler` 이미지 태그. 프로파일러는 1.0 이전 버전이므로, 검증된 버전에 고정하십시오.                                |
| `profiling.samplesPerSecond`  | `19`                 | 샘플링 주기(Hz). 업스트림 기본값으로, 일반적인 타이머 주파수와의 우발적인 얼라이어싱을 방지합니다.                                                     |
| `profiling.offCpuThreshold`   | `0`                  | (0–1] 범위로 off-CPU 프로파일링을 활성화합니다 — 락 경합과 블로킹 I/O를 진단합니다. tracepoint 오버헤드가 추가되므로 기본적으로 비활성화되어 있습니다. |
| `profiling.tracers`           | `""` _(모든 런타임)_ | 로드할 언어 트레이서 목록(쉼표로 구분).                                                                                                                |
| `profiling.obiProcessContext` | `true`               | 트레이스 ↔ 프로파일 연결을 위해 OBI의 트레이스 컨텍스트와 샘플을 상관시킵니다.                                                                        |

## 기타 데이터 수집 (호스트 메트릭, 포화도, cAdvisor, KSM, 감사 로그, CSI, CoreDNS)

차트는 다음도 수집할 수 있습니다:

| `<key>.enabled`                   | 기본값 | 추가되는 내용                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `hostMetrics`                     | on     | `/proc`와 `/sys`에서 가져온 노드별 OS 메트릭 — 디스크 I/O 큐 깊이, 파일시스템 inode 사용량, NIC 오류 카운터, 페이징 통계, 부하 평균. 로그 콜렉터 DaemonSet 내부에 존재합니다(추가 파드 없음).                                                                                                                                                                                                    |
| `kubeletstats.utilizationMetrics` | on     | 포화도 메트릭 — 요청 및 제한에 대한 백분율로 표현된 컨테이너 및 파드 CPU/메모리. "CPU/Memory vs Request" 및 "CPU/Memory vs Limit" 모니터를 구동하는 8개의 파생 메트릭 패밀리. 기존 `kubeletstats` 리시버와 동일한 스크랩이며, 추가 파드가 필요 없습니다. 파드에 요청/제한이 설정되지 않은 경우 항상 0입니다.                                                                                     |
| `kubeletstats.volumeMetrics`      | on     | PVC별 디스크 사용량(`k8s.volume.available`, `k8s.volume.capacity`). "PVC Low Disk Space" 모니터를 구동합니다. 파드별 PVC당 하나의 시리즈 — 대부분의 클러스터에서는 제한적이지만, 수천 개의 PVC가 있는 스테이트풀 워크로드에서는 더 무거워집니다.                                                                                                                                                 |
| `cadvisor`                        | on     | 각 노드의 DaemonSet 파드에서 kubelet의 `/metrics/cadvisor` 엔드포인트를 스크랩하여 `kubeletstats`가 변환하지 않는 컨테이너 메트릭을 가져옵니다: CFS 스로틀링(`container_cpu_cfs_throttled_seconds_total`, `container_cpu_cfs_periods_total`) 및 OOM kill 이벤트(`container_oom_events_total`). 리라벨 허용 목록이 리시버에서 나머지를 모두 삭제하므로 카디널리티가 제한된 상태로 유지됩니다.     |
| `kubeStateMetrics`                | off    | kube-state-metrics에서 클러스터 상태 메트릭을 가져옵니다: 파드 단계(Pending / Terminating), 컨테이너 대기 원인(CrashLoopBackOff, ImagePullBackOff), 리소스 쿼터 사용량. `mode: bundled`(기본값)는 작은 KSM Deployment를 배포합니다; `mode: external`은 `endpoint`를 통해 기존 KSM을 스크랩합니다. 번들된 모드가 차트의 풋프린트에 Deployment를 추가하기 때문에 기본적으로 비활성화되어 있습니다. |
| `auditLogs`                       | off    | 호스트에서 `/var/log/kubernetes/audit.log`를 추적합니다. 모든 Kubernetes API 요청을 캡처합니다 — 누가 어떤 리소스에 무엇을 했는지. 자체 관리형 클러스터 전용 — 관리형 K8s(EKS, GKE, AKS, DOKS)는 감사 로그를 클라우드 제공업체의 싱크로 라우팅합니다.                                                                                                                                            |
| `csi`                             | off    | `app=csi-driver`(또는 `app.kubernetes.io/component=csi-driver`) 레이블이 붙은 파드를 자동으로 발견하고 Prometheus `metrics` 포트를 스크랩합니다 — 볼륨 연결/분리 지연, 프로비저닝 실패, IOPS.                                                                                                                                                                                                    |
| `coreDns`                         | off    | 클러스터 CoreDNS 서비스를 `:9153/metrics`에서 스크랩합니다. 쿼리율, 지연, 캐시 히트율, 오류 카운트를 표시합니다 — 일반적인 P99 지연 원인입니다.                                                                                                                                                                                                                                                  |

## 일반 옵션

| 옵션                                      | 기본값                            | 설명                                                                                                                                                                                          |
| ----------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preset`                                  | (비어 있음 — `standard`로 처리됨) | 위의 표를 참조하십시오.                                                                                                                                                                       |
| `oneuptime.url`                           | _(필수)_                          | OneUptime 인스턴스의 URL입니다.                                                                                                                                                               |
| `oneuptime.apiKey`                        | _(필수)_                          | 프로젝트 API 키(Settings → API Keys).                                                                                                                                                         |
| `clusterName`                             | _(필수)_                          | 이 클러스터의 고유한 이름입니다. 모든 레코드에 `k8s.cluster.name`으로 기록됩니다.                                                                                                             |
| `namespaceFilters.include`                | `[]`                              | 설정되면 이 네임스페이스만 모니터링됩니다.                                                                                                                                                    |
| `namespaceFilters.exclude`                | `["kube-system"]`                 | 건너뛸 네임스페이스.                                                                                                                                                                          |
| `logs.enabled`                            | `true`                            | 로그 수집 켜기 또는 끄기.                                                                                                                                                                     |
| `logs.mode`                               | (`preset`에서 파생됨)             | `daemonset`, `api` 또는 `disabled`. 프리셋을 재정의합니다.                                                                                                                                    |
| `logs.api.replicas`                       | `1`                               | 로그 테일러 Deployment 복제본 수(API 모드에서만).                                                                                                                                             |
| `ebpf.enabled`                            | `true`                            | OpenTelemetry eBPF Instrumentation을 통해 모든 파드에서 HTTP/gRPC 트레이스를 자동으로 캡처합니다. 위의 섹션을 참조하십시오.                                                                   |
| `profiling.enabled`                       | `false`                           | OpenTelemetry eBPF Profiler를 통한 연속 CPU 플레임 그래프. 기본적으로 비활성화; 더 많은 텔레메트리를 위해 옵트인하십시오. 위의 섹션을 참조하십시오.                                           |
| `hostMetrics.enabled`                     | `true`                            | 노드별 OS 메트릭.                                                                                                                                                                             |
| `kubeletstats.utilizationMetrics.enabled` | `true`                            | 컨테이너 및 파드 CPU/메모리 포화도(요청 및 제한의 %). 추가 스크랩 없음 — kubeletstats 데이터에서 파생됩니다.                                                                                  |
| `kubeletstats.volumeMetrics.enabled`      | `true`                            | PVC별 디스크 사용량(`k8s.volume.available`, `k8s.volume.capacity`).                                                                                                                           |
| `cadvisor.enabled`                        | `true`                            | 이 노드의 kubelet `/metrics/cadvisor`를 스크랩하여 CFS 스로틀링 + OOM kill 카운터를 가져옵니다. 3개의 메트릭으로 허용 목록 처리됩니다.                                                        |
| `kubeStateMetrics.enabled`                | `false`                           | kube-state-metrics에서 파드 단계, 컨테이너 대기 원인(CrashLoopBackOff / ImagePullBackOff), ResourceQuota 사용량을 가져옵니다. 번들 vs 외부에 대해서는 `kubeStateMetrics.mode`를 참조하십시오. |
| `auditLogs.enabled`                       | `false`                           | Kubernetes 감사 로그 수집(자체 관리형 클러스터).                                                                                                                                              |
| `csi.enabled`                             | `false`                           | CSI 드라이버 Prometheus 메트릭.                                                                                                                                                               |
| `coreDns.enabled`                         | `false`                           | CoreDNS Prometheus 메트릭.                                                                                                                                                                    |
| `controlPlane.enabled`                    | `false`                           | etcd / api-server / scheduler / controller-manager 스크랩. 자체 관리형 클러스터 전용 — 관리형 제공 서비스(EKS/GKE/AKS)는 일반적으로 이러한 엔드포인트를 노출하지 않습니다.                    |

전체 목록은 [차트의 `values.yaml`](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/kubernetes-agent/values.yaml)을 참조하십시오.

## 업그레이드

```bash
helm repo update
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values
```

`--reuse-values`는 기존 구성을 유지합니다; 그 위에 새로운 `--set` 재정의를 전달하십시오.

> **주의: `--reuse-values`는 차트의 새 기본값을 병합하지 않습니다.** Helm은 이전에 렌더링된 값을 그대로 재사용합니다 — 따라서 새 차트 버전에 추가된 새로운 최상위 필드(예: `profiling.*`, `ebpf.features.*`)는 기존 릴리스에서 설정되지 않은 채로 남아 있고, 템플릿은 마치 비활성화한 것처럼 렌더링됩니다.
>
> **Helm 3.14+** — `--reset-then-reuse-values`로 전환하십시오. 재정의하지 않은 키에 대해 차트 기본값을 다시 읽어옵니다:
>
> ```bash
> helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
>   --namespace oneuptime-kubernetes-agent \
>   --reset-then-reuse-values
> ```
>
> **Helm 3.13 이하** — `--reuse-values`를 제거하고 원래의 `--set` 플래그(또는 `-f values.yaml`)를 명시적으로 전달하십시오. 재정의하지 않은 모든 항목에 대해 새 차트 기본값이 적용됩니다.
>
> 업그레이드 후 새로운 기능의 파드(예: `kubernetes-agent-profiling-*`)가 나타나지 않는다면 거의 항상 이것이 원인입니다. `helm get values <release>`로 Helm이 실제로 가지고 있는 값을 확인할 수 있습니다 — 출력에 누락된 필드는 해당 필드에 대해 기본값이 병합되지 않았음을 의미합니다.

## 제거

```bash
helm uninstall oneuptime-agent --namespace oneuptime-kubernetes-agent
kubectl delete namespace oneuptime-kubernetes-agent
```

## 문제 해결

### "hostPath volumes are not allowed"로 설치가 실패하는 경우

클러스터가 hostPath를 차단하고 있습니다. API 모드 프리셋으로 전환하십시오:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values \
  --set preset=gke-autopilot   # or eks-fargate
```

### OneUptime에 로그가 나타나지 않는 경우

에이전트 파드를 확인하십시오:

```bash
kubectl get pods -n oneuptime-kubernetes-agent
kubectl logs -n oneuptime-kubernetes-agent -l app.kubernetes.io/part-of=oneuptime --tail=200
```

API 모드에서 로그 테일러 파드는 포트 13133에서 `/healthz`를 노출합니다 — `kubectl port-forward`로 접근하여 내보내기 상태 스냅샷을 확인하십시오.

### eBPF DaemonSet 파드가 `CrashLoopBackOff` 상태이거나 시작에 실패하는 경우

OBI 파드 로그를 확인하십시오:

```bash
kubectl logs -n oneuptime-kubernetes-agent -l component=ebpf-instrument --tail=200
```

일반적인 원인:

- **커널이 너무 오래되었거나 BTF가 없음.** OBI는 BTF가 포함된 Linux 5.8+를 필요로 합니다. 노드에서 `uname -r`로 확인하십시오. 업그레이드할 수 없다면 eBPF를 비활성화하십시오: `--set ebpf.enabled=false`.
- **특권 파드가 차단됨.** 일부 클러스터는 Autopilot/Fargate가 아니더라도 특권 파드를 거부합니다. eBPF를 비활성화하십시오.
- **OBI는 실행 중이지만 대시보드에 트레이스가 없음.** `--set ebpf.printTraces=true`로 설정하고 OBI의 stdout을 확인하십시오 — 그곳에 스팬이 보인다면 문제는 OTLP 전달에 있습니다(`OTEL_EXPORTER_OTLP_ENDPOINT` 및 OneUptime URL/API 키를 확인하십시오). 스팬이 보이지 않는다면, OBI가 관찰 중인 트래픽이 모두 OBI가 가로챌 수 없는 TLS 라이브러리(예: 인식되지 않는 정적 링크된 TLS 구현)로 암호화되어 있을 수 있습니다.

### 클러스터의 파드가 너무 많아 하나의 로그 테일러 복제본으로 처리할 수 없는 경우 (API 모드 전용)

네임스페이스를 샤딩하여 수평으로 확장하십시오. 네임스페이스 그룹마다 한 번씩 배포하십시오:

```bash
helm install oneuptime-agent-ns-a oneuptime/kubernetes-agent \
  --set preset=gke-autopilot \
  --set namespaceFilters.include={app-a,app-b} \
  ...
```

또는 `logs.api.replicas`를 늘리십시오 — 단, 각 복제본이 허용된 모든 네임스페이스를 처리하므로 중복 제거를 위해서는 여전히 네임스페이스 샤딩이 필요합니다.
