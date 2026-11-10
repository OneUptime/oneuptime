# 리소스 관리

이 페이지는 첫 리소스가 실행된 뒤의 프로바이더 리소스를 다룹니다. kind와 필드의 이름이 정해지는 방식, 리소스가 서로를 참조하는 방법, 프로젝트에 이미 있는 것을 가져오는 방법, OneUptime이 만드는 시크릿, Kubernetes 밖에서 이루어진 변경이 어떻게 되는지, 그리고 리소스가 준비되지 않을 때 확인할 것입니다. 프로바이더를 설치하고 첫 리소스를 만들려면 [Crossplane 개요](/docs/crossplane/index)부터 시작하세요.

:::cards
- [kind와 필드](#kind와-필드): 바탕이 되는 Terraform 리소스와 이름을 짓는 방식.
- [다른 리소스 참조하기](#다른-리소스-참조하기): ID 대신 이름으로 참조하며, 모니터 단계의 어느 깊이에서든 쓸 수 있습니다.
- [이미 있는 것 가져오기](#이미-있는-것-가져오기): 레코드를 ID로 관찰한 다음 관리를 넘겨받습니다.
- [리소스 문제 해결](#리소스-문제-해결): 컨디션, 이벤트, 프로바이더 로그.
:::

## kind와 필드

[Terraform 프로바이더](/docs/terraform/index)의 각 리소스는 CamelCase로 이름을 붙인 kind가 됩니다. `oneuptime_status_page`는 `StatusPage`, `oneuptime_on_call_policy`는 `OnCallPolicy`입니다. Spec, Status, List로 끝나게 되는 이름에는 Definition이 붙으므로 `oneuptime_monitor_status`는 `MonitorStatusDefinition`입니다. 다음은 kind의 일부입니다.

| kind | 나타내는 레코드 | Terraform 리소스 |
| --- | --- | --- |
| `Monitor` | 모니터 | `oneuptime_monitor` |
| `StatusPage` | 상태 페이지 | `oneuptime_status_page` |
| `OnCallPolicy` | 온콜 정책 | `oneuptime_on_call_policy` |
| `Team` | 팀 | `oneuptime_team` |
| `Label` | 레이블 | `oneuptime_label` |
| `IncidentSeverity` | 인시던트 심각도 | `oneuptime_incident_severity` |
| `MonitorStatusDefinition` | 모니터 상태 | `oneuptime_monitor_status` |
| `TelemetryIngestionKey` | 텔레메트리 수집 키 | `oneuptime_telemetry_ingestion_key` |

`kubectl api-resources --api-group=crossplane.oneuptime.com`은 클러스터에서 활성화된 모든 kind를 나열합니다.

kind의 필드는 Terraform 리소스의 인수를 camelCase로 바꾼 것이며, `spec.forProvider` 아래에 둡니다. 예를 들어 `monitoring_interval`은 `monitoringInterval`입니다. Terraform에서 `jsonencode()`로 쓰는 필드는 JSON 문자열을 받습니다. `kubectl explain`은 각 필드를 Terraform 프로바이더와 같은 방식으로 설명하며, [Terraform 완전한 가이드](/docs/terraform/complete-guide)에서 사용 방법을 볼 수 있습니다.

```bash
kubectl explain monitors.spec.forProvider --api-version=crossplane.oneuptime.com/v1alpha1
```

`status.atProvider`는 OneUptime에 있는 그대로의 레코드를 `id`와 함께 보여 줍니다. 생략한 필드를 OneUptime이 기본값 등으로 채우면, 그 값은 레코드가 만들어진 뒤 `spec.forProvider`에 복사됩니다. 그래서 다음 확인에서 바꿀 것이 없습니다.

## 다른 리소스 참조하기

다른 레코드의 ID를 담는 필드는 모두 그 레코드를 나타내는 리소스에 대한 참조도 받습니다. `<field>Ref`는 같은 네임스페이스의 리소스를 이름으로 지정하고, `<field>Selector`는 Kubernetes 레이블로 리소스를 고릅니다. `labels`처럼 ID 목록을 담는 필드는 `labelsRefs`와 `labelsSelector`를 받습니다. 프로바이더는 참조한 리소스가 OneUptime에 생길 때까지 기다린 다음 그 ID를 채웁니다.

```yaml title="selector.yaml"
spec:
  forProvider:
    labelsSelector:
      matchLabels:
        tier: production
```

참조는 모니터 단계 안에서도 쓸 수 있습니다. 기준의 상태(`monitorStatusIdRef`), 그리고 기준이 만드는 인시던트와 알림의 심각도, 소유 팀, 온콜 정책, 레이블(`incidentSeverityIdRef`, `alertSeverityIdRef`, `ownerTeamIdsRefs`, `onCallPolicyIdsRefs`, `labelIdsRefs`)이 그렇습니다. 사람을 위한 kind는 없습니다. 필드는 `ownerUserIds`처럼 사용자 ID로 사람을 지정하며, 많은 kind는 `TeamMember`의 `userEmail`처럼 그 옆에 이메일 주소도 받습니다([사용자와 팀](/docs/terraform/people-and-teams)).

## 이미 있는 것 가져오기

레코드를 관찰하는 리소스는 ID로 레코드를 읽기만 하고, 변경하거나 삭제하지 않습니다. ID를 리소스의 외부 이름으로 설정하고, 관리 정책은 `Observe` 하나만 설정하세요.

```yaml title="team.yaml"
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: Team
metadata:
  name: sre
  namespace: team-a
  annotations:
    crossplane.io/external-name: "<the team's ID>"
spec:
  managementPolicies: ["Observe"]
  providerConfigRef:
    kind: ProviderConfig
    name: default
  forProvider: {}
```

레코드의 ID는 대시보드에서 그 레코드의 **개발자 → Terraform** 페이지가 작성하는 `import` 블록에 있으며, [OneUptime CLI](/docs/cli/resource-operations#레코드-나열)의 `oneuptime <resource> list`로 한 종류의 레코드 ID를 나열할 수도 있습니다. 리소스가 준비되면 `status.atProvider`에 레코드가 표시됩니다. 그때부터 레코드를 관리하려면 필드를 `spec.forProvider`에 쓰고 `managementPolicies`를 `["*"]`로 설정하세요.

## 시크릿

### OneUptime이 만드는 시크릿

일부 레코드에는 텔레메트리 수집 키의 시크릿처럼 OneUptime이 만드는 시크릿이 딸려 있습니다. 프로바이더는 이 시크릿을 리소스에 절대 넣지 않습니다. 대신 리소스 네임스페이스에 있는, `writeConnectionSecretToRef`가 이름을 지정한 Secret에 기록하며, 키는 `attribute.` 뒤에 Terraform 속성 이름을 붙인 것입니다.

```yaml title="telemetry-key.yaml"
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: TelemetryIngestionKey
metadata:
  name: collector
  namespace: team-a
spec:
  providerConfigRef:
    kind: ProviderConfig
    name: default
  writeConnectionSecretToRef:
    name: collector-telemetry-key
  forProvider:
    name: Collector
```

```bash
kubectl -n team-a get secret collector-telemetry-key -o jsonpath='{.data.attribute\.secret_key}' | base64 -d
```

리소스를 삭제하면 Secret도 함께 삭제됩니다.

### 직접 제공하는 시크릿

모니터 단계의 TLS 클라이언트 키 암호 문구처럼 시크릿을 담는 필드는 값 대신 리소스 네임스페이스의 Secret을 받습니다. `tlsClientKeyPassphraseSecretRef`에 Secret의 `name`과 `key`를 지정합니다.

## Kubernetes 밖에서 이루어진 변경

프로바이더는 10분마다 모든 리소스를 해당 레코드와 비교하고, 누군가 OneUptime에서 바꾼 것을 되돌립니다. 더 자주 확인하려면 프로바이더에 `--poll`을 넣은 런타임 구성을 지정하세요.

```yaml title="runtime-config.yaml"
apiVersion: pkg.crossplane.io/v1beta1
kind: DeploymentRuntimeConfig
metadata:
  name: oneuptime
spec:
  deploymentTemplate:
    spec:
      selector: {}
      template:
        spec:
          containers:
            - name: package-runtime
              args:
                - --poll=1m
---
apiVersion: pkg.crossplane.io/v1
kind: Provider
metadata:
  name: provider-oneuptime
spec:
  package: ghcr.io/oneuptime/provider-oneuptime:{{CROSSPLANE_PROVIDER_VERSION}}
  runtimeConfigRef:
    name: oneuptime
```

레코드가 만들어진 뒤 어떤 필드를 대시보드에 맡기려면, 그 필드를 `spec.forProvider` 대신 `spec.initProvider`에 쓰세요. 이 값은 레코드를 만들 때만 쓰이고, 그 후에는 되돌려지지 않습니다. 레코드 전체를 대시보드에 맡기려면 관리 정책에서 `Update`를 빼세요: `["Observe", "Create", "Delete", "LateInitialize"]`.

## 리소스 삭제하기

리소스를 삭제하면 OneUptime의 해당 레코드도 삭제됩니다. 레코드를 유지하려면 리소스를 삭제하기 전에 리소스의 관리 정책에서 `Delete`를 빼세요: `["Observe", "Create", "Update", "LateInitialize"]`. 관찰만 하는 리소스는 레코드를 절대 삭제하지 않습니다.

## 리소스 문제 해결

`kubectl -n team-a get managed`는 각 리소스의 `SYNCED`와 `READY`를 보여 줍니다. 둘 중 하나라도 `True`가 아니면 리소스의 컨디션과 이벤트가 그 이유를 알려 주며, API가 요청을 거부한 경우에는 OneUptime의 응답도 함께 보여 줍니다.

```bash
kubectl -n team-a describe monitors.crossplane.oneuptime.com homepage
```

| 표시되는 내용 | 확인할 것 |
| --- | --- |
| `cannot read the API key` | `ProviderConfig`가 지정하는 Secret 또는 그 안의 키. |
| `cannot get referenced ProviderConfig` | 리소스가 자신의 네임스페이스에 없는 `ProviderConfig`를 지정하고 있습니다. 클러스터의 것을 쓰려면 `kind: ClusterProviderConfig`를 사용하세요. |
| 해결할 수 없는 참조 | 참조하는 리소스가 네임스페이스에 없거나 아직 준비되지 않았습니다. |
| OneUptime API의 오류 | API 키의 권한, 그리고 오류가 가리키는 필드의 값. |

프로바이더의 로그에는 더 자세한 내용이 나오며, 위의 `--poll`처럼 `args`에 `--debug`를 추가하면 더욱 자세해집니다.

```bash
kubectl -n crossplane-system logs -l pkg.crossplane.io/provider=provider-oneuptime
```

## 패키지 검증하기

각 릴리스는 OneUptime의 이미지와 마찬가지로 Sigstore의 cosign을 사용해 키리스 방식으로 패키지에 서명합니다. 설치하기 전에 패키지를 확인하려면 다음을 실행하세요.

```bash
cosign verify ghcr.io/oneuptime/provider-oneuptime:{{CROSSPLANE_PROVIDER_VERSION}} \
  --certificate-identity https://github.com/OneUptime/oneuptime/.github/workflows/release.yml@refs/heads/release \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```
