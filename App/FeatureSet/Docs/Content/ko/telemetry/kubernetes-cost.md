# Kubernetes 비용 관측 가능성

## 개요

OneUptime은 모든 Kubernetes 워크로드에 실제로 얼마나 비용이 드는지 보여 줍니다 — 네임스페이스별, 컨트롤러별, 파드별 지출을 유휴 용량 및 요청 대비 사용량 효율과 함께, [Kubernetes 에이전트](/docs/telemetry/kubernetes-agent)로 이미 수집하고 있는 메트릭, 로그, 트레이스 바로 옆에서 확인할 수 있습니다.

활성화는 명령 하나면 됩니다:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set cost.enabled=true
```

그것으로 설치가 완료됩니다. 차트는 오픈 소스 [OpenCost](https://opencost.io) 엔진(Apache-2.0, CNCF — Kubecost도 구동하는 [cost-model](https://github.com/kubecost/cost-model))과 함께 OpenCost가 사용량 이력을 위해 필요로 하는 최소한의 전용 Prometheus를 번들로 제공합니다 — 눈에 띄지 않게 배관 역할을 하는 작은 파드 두 개입니다. OpenCost는 클라우드 공급자의 **공개 정가를 자격 증명 없이 자동으로** 사용하여 노드, 볼륨, 로드 밸런서의 가격을 책정합니다(AWS, GCP, Azure). 온프레미스 클러스터는 대신 요금표를 설정합니다(아래 참조).

약 한 시간 이내에(첫 번째로 닫힌 시간 단위 윈도우) 다음을 얻게 됩니다:

- **클러스터별 Costs 페이지** (_Kubernetes → 해당 클러스터 → Costs_): 지출 추세, cpu/메모리/스토리지로 나뉜 네임스페이스별 지출, 워크로드별 지출, 유휴 지출 및 효율.
- **프로젝트 수준 Costs 페이지** (_Kubernetes → Costs_): 프로젝트 내 모든 클러스터에 걸친 지출.
- **Kubernetes 비용 대시보드 템플릿** (_Dashboards → Create → Kubernetes Cost Dashboard_): 노드 시간당 비용 추세, CPU/RAM 단위 비용, 퍼시스턴트 볼륨 및 로드 밸런서 지출.
- **Metric Explorer**의 원시 비용 메트릭(`node_total_hourly_cost`, `pv_hourly_cost`, ...) — 커스텀 대시보드와 메트릭 알림에 사용할 수 있습니다.

## 작동 방식

`cost.enabled=true`일 때 차트는 네 가지를 실행합니다:

1. **OpenCost** (번들) — 클러스터를 관찰하고, 클라우드 정가를 발견하며, 워크로드별로 사전에 가격이 책정된 비용 할당을 계산합니다.
2. **최소한의 Prometheus** (번들) — OpenCost는 사용량/가격 이력을 위한 PromQL 엔드포인트를 필요로 합니다. 이 Prometheus는 오로지 그 목적만을 위해 존재합니다: 단일 복제본, 3일 보존, 그리고 정확히 두 개의 스크레이프 대상(API 서버 노드 프록시를 통한 cAdvisor, 그리고 OpenCost 자체 — OpenCost는 자체적으로 KSM 스타일의 리소스 요청 메트릭을 방출하므로 kube-state-metrics는 관여하지 않습니다). 클러스터 외부에 절대 노출되지 않으며 그 데이터도 클러스터를 떠나지 않습니다.
3. **비용 할당 폴러** (`cost.agent`) — 닫힌 시간 단위 윈도우마다 한 번씩 OpenCost의 Allocation API를 폴링하고 워크로드별 비용 행(cpu / ram / gpu / pv / 네트워크 / 로드 밸런서 / 유휴, 그리고 효율)을 OneUptime으로 POST합니다. 윈도우는 정확히 한 번만 전송됩니다 — 서버가 이미 수집한 윈도우는 건너뛰므로 재시작으로 인해 지출이 이중 계산될 수 없습니다.
4. **비용 메트릭 스크레이프** (`cost.metrics`) — 에이전트의 OpenTelemetry 컬렉터가 OpenCost의 Prometheus 메트릭(비용 시리즈로 허용 목록 처리됨)을 나머지 클러스터 메트릭과 동일한 OTLP 파이프라인을 통해 스크레이프합니다.

## 이미 Kubecost나 OpenCost를 실행 중이신가요?

대신 차트가 기존 엔진을 가리키게 하세요 — 그러면 아무것도 번들되지 않습니다:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set cost.enabled=true \
  --set cost.engine.url=http://kubecost-cost-analyzer.kubecost.svc.cluster.local:9090
```

| 엔진     | 일반적인 서비스 URL                                              |
| -------- | ---------------------------------------------------------------- |
| OpenCost | `http://opencost.opencost.svc.cluster.local:9003`                |
| Kubecost | `http://kubecost-cost-analyzer.kubecost.svc.cluster.local:9090`  |

Allocation API 경로는 자동으로 감지됩니다(Kubecost는 `/model/allocation`, OpenCost는 `/allocation/compute` 또는 `/allocation`). 비표준 설치에서만 `cost.engine.allocationPath`를 설정하세요.

## 온프레미스 / 베어메탈 가격 책정

노드에 공개 클라우드 정가가 없는 클러스터는 요금표를 설정할 수 있습니다 — 그러면 OpenCost가 이 수치로 모든 리소스의 가격을 책정합니다. 모든 값은 **리소스-시간당 USD**입니다:

```yaml
cost:
  enabled: true
  opencost:
    customPricing:
      enabled: true
      cpuPerCoreHour: "0.031611"       # ~$23 per core-month
      ramPerGiBHour: "0.004237"        # ~$3 per GiB-month
      storagePerGBHour: "0.00005479452" # ~$0.04 per GB-month
      gpuPerHour: "0.95"
```

## 유용한 조정 항목

모두 선택 사항입니다 — 전체 목록은 차트의 `values.yaml`을 참조하세요:

```yaml
cost:
  agent:
    windowSeconds: 3600   # allocation window length (hourly = native)
    includeIdle: true     # ship the engine's __idle__ allocation
    currency: USD         # currency code shown in the UI (informational)
  prometheus:
    retention: 7d         # bundled TSDB history; right-sizing reads peaks back over days
    persistence:
      enabled: false      # set true for a small PVC; emptyDir otherwise
  metrics:
    enabled: true         # cost metrics for dashboards / Metric Explorer
    scrapeInterval: 60s
```

## 비용에 대한 알림

스크레이프된 비용 메트릭은 일반적인 OneUptime 메트릭이므로 다른 메트릭과 마찬가지로 메트릭 알림을 설정할 수 있습니다 — 예를 들어 평균 `node_total_hourly_cost`가 예산 임계값을 초과할 때, 또는 클러스터에 존재해서는 안 되는 볼륨 클래스에 `pv_hourly_cost`가 나타날 때 알림을 받을 수 있습니다.

## 데이터 모델 및 보존

할당 행은 ClickHouse에 저장되며(클러스터, 윈도우, 네임스페이스, 컨트롤러, 파드, 컨테이너당 한 행) 클러스터의 텔레메트리 보존 정책을 따릅니다: Kubernetes 클러스터 리소스의 `retainTelemetryDataForDays` 설정이 적용되고, 없으면 프로젝트의 데이터 보존으로 대체됩니다. 유휴 및 미할당 용량은 `__idle__` / `__unallocated__` 네임스페이스 아래의 일반 행으로 저장되므로 워크로드 지출과 동일한 group-by로 쿼리할 수 있습니다.

## 문제 해결

- **Costs 페이지가 비어 있음** — 비용 에이전트의 로그를 확인하세요: `kubectl logs -n <agent namespace> deploy/<release>-kubernetes-agent-cost`. `401`은 수집 키가 유효하지 않다는 의미이고, `cost engine did not answer any known allocation path`는 엔진이 아직 실행되지 않았거나(번들된 OpenCost는 설치 후 첫 윈도우의 가격을 책정하는 데 몇 분이 필요합니다) `cost.engine.url`이 잘못되었다는 의미입니다.
- **번들된 OpenCost가 준비되지 않음** — `kubectl logs -n <agent namespace> deploy/<release>-kubernetes-agent-opencost`. 어떤 클라우드 공급자를 감지했는지, 그리고 가격 데이터가 로드되었는지 로그로 남깁니다.
- **대시보드 템플릿에 데이터가 없음** — 템플릿은 스크레이프된 비용 메트릭을 읽습니다. `cost.metrics.enabled`가 `true`인지 확인하세요.
- **숫자가 엔진 자체 UI와 다름** — OneUptime은 각 비용 구성 요소에 엔진의 조정(reconciliation) 보정을 포함하며 닫힌 윈도우 전체를 전송합니다. 현재 진행 중인 시간의 부분 지출은 윈도우가 닫힌 뒤에 나타납니다.
- **Prometheus 파드가 재시작됨** — 기본 `emptyDir` 스토리지에서는 재시작 시 몇 시간의 사용량 이력이 손실되므로 해당 윈도우의 할당이 더 작을 수 있습니다. 이것이 중요하다면 `cost.prometheus.persistence.enabled=true`로 설정하세요.
