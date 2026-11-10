# Crossplane 개요

OneUptime Crossplane 프로바이더는 Kubernetes에서 OneUptime 프로젝트를 관리합니다. 모니터, 상태 페이지, 온콜 정책, 팀, 레이블 등 프로젝트의 레코드를 Kubernetes 리소스로 선언하면, Crossplane이 프로젝트를 선언한 그대로 유지합니다. 새로운 것은 만들고, 편집한 것은 변경하고, 누군가 다른 곳에서 바꾼 것은 되돌리고, 제거한 것은 삭제합니다. Argo CD, Flux를 비롯해 매니페스트를 적용하는 도구라면 무엇이든 이 리소스도 적용할 수 있습니다. OneUptime Cloud와 자체 호스팅 OneUptime 모두에서 작동합니다.

:::cards
- [프로바이더의 작동 방식](#프로바이더의-작동-방식): kind, 네임스페이스, 그리고 그 뒤에 있는 API 키.
- [프로바이더 설치](#프로바이더-설치): 패키지와 고를 버전.
- [프로바이더에 API 키 전달하기](#프로바이더에-api-키-전달하기): 네임스페이스에 두는 Secret과 ProviderConfig.
- [첫 리소스 만들기](#첫-리소스-만들기): 모니터, 모니터에 붙는 레이블, 모니터가 설정하는 상태.
:::

## 프로바이더의 작동 방식

프로바이더는 Crossplane 패키지입니다. 설치하면 OneUptime API의 레코드 유형마다 kind를 하나씩 `crossplane.oneuptime.com` API 그룹에 추가합니다. `Monitor`, `StatusPage`, `OnCallPolicy`, `Team`, `Label` 외에도 400개가 넘는 kind가 있습니다. 이 kind의 각 리소스는 네임스페이스에 속하며 프로젝트의 레코드 하나를 나타냅니다. 프로바이더는 프로젝트의 API 키로 OneUptime REST API를 통해 레코드를 읽고 변경하며, 확인한 내용을 리소스의 status에 기록합니다.

프로바이더는 릴리스마다 [Terraform 프로바이더](/docs/terraform/index)로부터 만들어집니다. 이 프로바이더의 kind는 Terraform 프로바이더의 리소스이며, 필드도, 그 뒤에서 보내는 API 요청도 같습니다.

## 시작하기 전에

- **Crossplane 2.0 이상.** 프로바이더의 리소스는 네임스페이스에 속합니다. 네임스페이스에 속하는 리소스는 Crossplane 2에서 도입되었습니다. 클러스터에 설치하는 방법은 Crossplane 자체 문서에서 설명합니다.
- **프로젝트의 API 키.** Terraform [빠른 시작](/docs/terraform/quick-start#프로젝트-api-키-만들기)에서 **프로젝트 설정 → 고급 → API 키**에서 키를 만드는 방법을 보여 줍니다. 이 키에 따라 리소스가 속하는 프로젝트와, 프로바이더가 그 프로젝트에서 변경할 수 있는 것이 정해집니다.
- **OneUptime Cloud에서는 Growth 플랜 이상.** 프로젝트의 API 키는 이 플랜에서만 작동합니다.

## 프로바이더 설치

`Provider`로 패키지를 설치합니다.

```yaml title="provider.yaml"
apiVersion: pkg.crossplane.io/v1
kind: Provider
metadata:
  name: provider-oneuptime
spec:
  package: ghcr.io/oneuptime/provider-oneuptime:{{CROSSPLANE_PROVIDER_VERSION}}
```

```bash
kubectl apply -f provider.yaml
kubectl get providers.pkg.crossplane.io provider-oneuptime
```

`INSTALLED`와 `HEALTHY`가 모두 `True`이면 프로바이더가 실행 중입니다. 같은 패키지가 Docker Hub에도 `docker.io/oneuptime/provider-oneuptime`으로 올라와 있습니다.

### 버전 고르기

패키지 버전은 OneUptime 버전과 같습니다. `{{CROSSPLANE_PROVIDER_VERSION}}`은 이 페이지를 제공하는 OneUptime 릴리스로 만들어졌습니다. OneUptime Cloud에서는 최신 버전을 사용하세요. 자체 호스팅 OneUptime에서는 사용 중인 OneUptime과 같은 버전을 사용하세요. 그래야 프로바이더가 사용 중인 OneUptime의 API와 같은 필드를 알 수 있습니다.

### 사용하는 kind만 활성화하기

Crossplane의 Helm 차트는 기본적으로 모든 프로바이더의 모든 kind를 활성화하며(`provider.defaultActivations` 값), 이 프로바이더에서는 400개가 넘는 커스텀 리소스 정의가 됩니다. 사용하는 kind만 활성화하려면 `--set provider.defaultActivations={}`로 Crossplane을 설치하고, 활성화할 kind를 정책에 나열하세요.

```yaml title="activation-policy.yaml"
apiVersion: apiextensions.crossplane.io/v1alpha1
kind: ManagedResourceActivationPolicy
metadata:
  name: oneuptime
spec:
  activate:
    - monitors.crossplane.oneuptime.com
    - monitorstatusdefinitions.crossplane.oneuptime.com
    - labels.crossplane.oneuptime.com
    - statuspages.crossplane.oneuptime.com
```

## 프로바이더에 API 키 전달하기

리소스가 놓일 네임스페이스의 Secret에 키를 넣고, 같은 네임스페이스의 `ProviderConfig`가 그 Secret을 가리키게 하세요. Secret을 `kubectl`로 만들면 키가 파일에 남지 않습니다.

```bash
kubectl create namespace team-a
kubectl -n team-a create secret generic oneuptime --from-literal=api-key="<your-api-key>"
```

```yaml title="provider-config.yaml"
apiVersion: crossplane.oneuptime.com/v1beta1
kind: ProviderConfig
metadata:
  name: default
  namespace: team-a
spec:
  credentials:
    secretRef:
      name: oneuptime
      key: api-key
```

`ProviderConfig`는 자신의 네임스페이스에 있는 Secret만 읽으므로, 한 네임스페이스의 키를 다른 네임스페이스에서 사용할 수 없습니다. 각 리소스는 `spec.providerConfigRef`에 사용할 `ProviderConfig`를 지정합니다.

### 자체 호스팅 OneUptime 사용하기

`ProviderConfig`의 `url`에 사용 중인 OneUptime의 주소를 `/api` 없이 지정합니다.

```yaml title="provider-config.yaml"
apiVersion: crossplane.oneuptime.com/v1beta1
kind: ProviderConfig
metadata:
  name: default
  namespace: team-a
spec:
  url: https://oneuptime.example.com
  credentials:
    secretRef:
      name: oneuptime
      key: api-key
```

### 여러 네임스페이스에서 키 하나 공유하기

`ClusterProviderConfig`는 어느 네임스페이스의 Secret이든 읽을 수 있으며, 모든 네임스페이스의 리소스가 이를 지정할 수 있습니다. 한 팀이 클러스터 전체의 키를 관리할 때 사용하세요.

```yaml title="cluster-provider-config.yaml"
apiVersion: crossplane.oneuptime.com/v1beta1
kind: ClusterProviderConfig
metadata:
  name: oneuptime
spec:
  credentials:
    source: Secret
    secretRef:
      namespace: crossplane-system
      name: oneuptime
      key: credentials
```

리소스는 `providerConfigRef`에 `kind: ClusterProviderConfig`를 써서 이를 지정합니다. Secret에는 키만 넣거나, 주소까지 담은 JSON을 넣습니다: `{"api_key": "<your-api-key>", "oneuptime_url": "https://oneuptime.example.com"}`. `ClusterProviderConfig`에 쓴 `url`은 JSON의 주소보다 우선합니다. `ClusterProviderConfig`는 `source: Environment` 또는 `source: Filesystem`으로 프로바이더 Pod의 환경 변수나 파일에서 키를 읽을 수도 있습니다.

## 첫 리소스 만들기

레이블이 붙은 홈페이지 모니터로, 프로젝트의 **오프라인** 상태와 **정상 작동** 상태를 설정합니다.

:::steps
### 모니터가 설정하는 상태 관찰하기

프로젝트의 상태는 프로젝트를 만들 때 OneUptime이 함께 만든 것이므로, 새로 만들지 않고 관찰합니다. 프로바이더는 ID로 상태를 읽기만 하고, 변경하거나 삭제하지 않습니다. [OneUptime CLI](/docs/cli/resource-operations#레코드-나열)의 `oneuptime monitor-status list --fields _id,name`으로 ID를 나열할 수 있습니다.

```yaml title="statuses.yaml"
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: MonitorStatusDefinition
metadata:
  name: offline
  namespace: team-a
  annotations:
    crossplane.io/external-name: "<the Offline status's ID>"
spec:
  managementPolicies: ["Observe"]
  providerConfigRef:
    kind: ProviderConfig
    name: default
  forProvider: {}
---
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: MonitorStatusDefinition
metadata:
  name: operational
  namespace: team-a
  annotations:
    crossplane.io/external-name: "<the Operational status's ID>"
spec:
  managementPolicies: ["Observe"]
  providerConfigRef:
    kind: ProviderConfig
    name: default
  forProvider: {}
```

### 레이블과 모니터 만들기

모니터는 레이블과 상태를 Kubernetes 이름으로 지정하고, 프로바이더가 그 ID를 채웁니다.

```yaml title="homepage.yaml"
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: Label
metadata:
  name: production
  namespace: team-a
spec:
  providerConfigRef:
    kind: ProviderConfig
    name: default
  forProvider:
    name: Production
    color: "#16a34a"
---
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: Monitor
metadata:
  name: homepage
  namespace: team-a
spec:
  providerConfigRef:
    kind: ProviderConfig
    name: default
  forProvider:
    name: Homepage
    description: Checks that the homepage responds
    monitorType: Website
    monitoringInterval: "*/5 * * * *"
    labelsRefs:
      - name: production
    monitorSteps:
      - monitorDestination: https://example.com
        monitorDestinationType: URL
        requestType: GET
        criteria:
          - name: Offline
            description: The homepage does not respond
            filterCondition: Any
            changeMonitorStatus: true
            monitorStatusIdRef:
              name: offline
            filters:
              - checkOn: Is Online
                filterType: "False"
          - name: Online
            description: The homepage responds
            filterCondition: All
            changeMonitorStatus: true
            monitorStatusIdRef:
              name: operational
            filters:
              - checkOn: Is Online
                filterType: "True"
```

### OneUptime에서 확인하기

```bash
kubectl apply -f statuses.yaml -f homepage.yaml
kubectl -n team-a get managed
```

`SYNCED`와 `READY`가 `True`이면 레코드가 프로젝트에 들어간 것입니다. `EXTERNAL-NAME`은 OneUptime에서의 레코드 ID입니다.
:::

## 다음 단계

- [리소스 관리](/docs/crossplane/managing-resources)에서는 kind와 그 필드, 참조, 이미 있는 것 가져오기, OneUptime이 만드는 시크릿, 리소스가 준비되지 않을 때 확인할 것을 설명합니다.
- [Terraform 완전한 가이드](/docs/terraform/complete-guide)에서는 프로바이더의 kind가 공유하는 리소스와 그 필드를 설명합니다.
