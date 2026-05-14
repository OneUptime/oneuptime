# Kubernetes 에이전트 설치

OneUptime Kubernetes 에이전트는 Kubernetes 클러스터에서 클러스터 메트릭, 이벤트 및 파드 로그를 수집하여 OneUptime으로 전송합니다. Helm 차트로 배포됩니다.

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

## 클러스터에 맞는 사전 설정 선택

다양한 Kubernetes 배포판은 서로 다른 제약 조건을 가지고 있습니다 — 가장 주목할 것은 워크로드가 `hostPath` 볼륨을 마운트할 수 있는지 여부입니다. 보안 문서를 읽게 하는 대신, 차트는 단일 최상위 옵션인 `preset`을 노출합니다.

| 사전 설정 | 사용 대상 | 로그 수집 | 참고 |
| --- | --- | --- | --- |
| `standard` (기본값) | 자체 관리, **EC2의 EKS**, **GKE Standard**, **AKS**, minikube, kind, k3s | hostPath를 통해 `/var/log/pods`를 읽는 DaemonSet | 가장 낮은 오버헤드. 이러한 플랫폼에서 hostPath를 사용할 수 있습니다. |
| `gke-autopilot` | **GKE Autopilot** | Kubernetes API 테일러 (Deployment) | Autopilot에서는 hostPath가 차단됩니다. Autopilot의 Pod 보안 표준을 통과하는 강화된 보안 컨텍스트를 설정합니다. |
| `eks-fargate` | **EKS Fargate** | Kubernetes API 테일러 (Deployment) | `gke-autopilot`과 동일합니다. Fargate는 hostPath와 DaemonSet을 차단합니다. |

확실하지 않으면 `preset`을 설정하지 마십시오 — `standard` 기본값을 사용합니다. hostPath를 언급하는 Pod 보안 정책 오류로 설치가 거부되면 `gke-autopilot` (또는 EKS Fargate의 경우 `eks-fargate`)으로 전환하고 재설치합니다.

### 예시

**GKE Standard, EC2의 EKS, 자체 관리 또는 AKS:**

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

내부적으로 `preset`은 `logs.mode`를 설정합니다 — 사전 설정 기본값을 재정의해야 하는 경우 직접 설정할 수도 있습니다.

### DaemonSet 모드 (`logs.mode: daemonset`)

DaemonSet은 노드당 하나의 OpenTelemetry 콜렉터 파드를 실행합니다. hostPath 볼륨을 통해 `/var/log/pods/` 아래의 로그 파일을 추적하고 OTLP를 통해 전달합니다.

- **장점:** 가장 낮은 오버헤드, 노드에 따라 선형적으로 확장, Kubernetes API 서버에 부하 없음, 로그 로테이션 처리.
- **단점:** hostPath 필요, DaemonSet을 예약할 수 있어야 함 — GKE Autopilot 및 EKS Fargate에서는 모두 사용할 수 없습니다.

### API 모드 (`logs.mode: api`)

단일 복제본 Deployment (`oneuptime/kubernetes-log-tailer` 이미지)가 Kubernetes API를 사용하여 컨테이너 로그를 스트리밍합니다 — `kubectl logs -f`가 사용하는 동일한 엔드포인트. hostPath 없음, 호스트 액세스 없음, DaemonSet 없음.

- **장점:** GKE Autopilot, EKS Fargate 및 hostPath를 차단하거나 `restricted` Pod 보안 표준을 적용하는 모든 클러스터에서 작동합니다.
- **단점:** 모든 컨테이너 스트림이 `kube-apiserver`에 대한 장기 연결입니다. 실제로 단일 복제본은 수천 개의 컨테이너를 편안하게 처리합니다. 매우 큰 클러스터의 경우 각 복제본에 `logs.api.replicas`와 `namespaceFilters.include`를 사용하여 네임스페이스별로 분할합니다.

### 어떤 것을 사용해야 하나요?

hostPath가 작동하면 DaemonSet을 사용합니다. 그 외 모든 곳에서는 API 모드를 사용합니다. `preset` 설정이 적합한 것을 선택합니다.

`--set logs.enabled=false`로 로그 수집을 완전히 비활성화하고 대신 OpenTelemetry SDK를 통해 애플리케이션 로그를 전송할 수도 있습니다. [OpenTelemetry](/docs/telemetry/open-telemetry) 문서를 참조하십시오.

## 일반적인 옵션

| 옵션 | 기본값 | 설명 |
| --- | --- | --- |
| `preset` | (비어 있음 — `standard`로 처리됨) | 위의 표를 참조하십시오. |
| `oneuptime.url` | *(필수)* | OneUptime 인스턴스의 URL. |
| `oneuptime.apiKey` | *(필수)* | 프로젝트 API 키 (설정 → API 키). |
| `clusterName` | *(필수)* | 이 클러스터의 고유한 이름. 모든 레코드에 `k8s.cluster.name`으로 스탬프됩니다. |
| `namespaceFilters.include` | `[]` | 설정된 경우 이러한 네임스페이스만 모니터링됩니다. |
| `namespaceFilters.exclude` | `["kube-system"]` | 건너뛸 네임스페이스. |
| `logs.enabled` | `true` | 로그 수집 켜기 또는 끄기. |
| `logs.mode` | (사전 설정에서 파생됨) | `daemonset`, `api` 또는 `disabled`. 사전 설정을 재정의합니다. |
| `logs.api.replicas` | `1` | 로그 테일러 Deployment 복제본 수 (API 모드에서만). |
| `controlPlane.enabled` | `false` | etcd / api-server / scheduler / controller-manager 스크랩. 자체 관리 클러스터만 — 관리형 제공 서비스 (EKS/GKE/AKS)는 일반적으로 이러한 엔드포인트를 노출하지 않습니다. |

전체 목록은 [차트의 `values.yaml`](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/kubernetes-agent/values.yaml)을 참조하십시오.

## 업그레이드

```bash
helm repo update
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values
```

`--reuse-values`는 기존 구성을 유지합니다; 그 위에 새 `--set` 재정의를 전달합니다.

## 제거

```bash
helm uninstall oneuptime-agent --namespace oneuptime-kubernetes-agent
kubectl delete namespace oneuptime-kubernetes-agent
```

## 문제 해결

### "hostPath volumes are not allowed"로 설치가 실패하는 경우

클러스터가 hostPath를 차단합니다. API 모드 사전 설정으로 전환합니다:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values \
  --set preset=gke-autopilot   # 또는 eks-fargate
```

### OneUptime에 로그가 나타나지 않는 경우

에이전트 파드를 확인합니다:

```bash
kubectl get pods -n oneuptime-kubernetes-agent
kubectl logs -n oneuptime-kubernetes-agent -l app.kubernetes.io/part-of=oneuptime --tail=200
```

API 모드에서 로그 테일러 파드는 포트 13133에서 `/healthz`를 노출합니다 — `kubectl port-forward`를 통해 내보내기 상태 스냅샷을 확인합니다.

### 클러스터에 파드가 너무 많아 하나의 로그 테일러 복제본으로 처리할 수 없는 경우 (API 모드 전용)

네임스페이스를 분할하여 수평으로 확장합니다. 네임스페이스 그룹당 한 번씩 배포합니다:

```bash
helm install oneuptime-agent-ns-a oneuptime/kubernetes-agent \
  --set preset=gke-autopilot \
  --set namespaceFilters.include={app-a,app-b} \
  ...
```

또는 `logs.api.replicas`를 증가시킵니다 — 단, 각 복제본이 허용된 모든 네임스페이스를 처리하므로 중복 제거를 위해서는 여전히 네임스페이스 분할이 필요합니다.
