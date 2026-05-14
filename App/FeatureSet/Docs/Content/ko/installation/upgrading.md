# OneUptime 업그레이드

이 가이드는 자체 호스팅 OneUptime 설치를 안전하게 업그레이드하는 방법을 다룹니다.

## 일반 지침

- 주요 버전 간에는 단계적으로 업그레이드합니다 (예: 6 → 7 → 8). 주요 버전을 건너뛰지 마십시오.
- 릴리스 노트를 따르는 한 부 버전/패치 버전은 건너뛸 수 있습니다 (예: 8.1 → 8.4).
- 업그레이드 전에 항상 백업을 수행하고 복원할 수 있는지 확인합니다.

## OneUptime 8 → 9 업그레이드

Helm 차트는 더 이상 Kubernetes Ingress 리소스를 프로비저닝하지 않습니다. OneUptime은 이미 TLS를 종료하고 플랫폼의 상태 페이지 도메인을 관리하며 트래픽을 라우팅하는 ingress gateway 컨테이너를 제공하므로 클러스터 ingress 컨트롤러가 더 이상 필요하지 않습니다.

- 업그레이드하기 전에 커스텀 `values.yaml` 파일에서 `oneuptimeIngress` 재정의를 제거합니다. 해당 키는 이제 무시되며 그대로 두면 유효성 검사 오류가 발생합니다.
- `nginx.service.type`이 번들된 ingress gateway를 노출하는 방법을 반영하는지 확인합니다 (예: `LoadBalancer`, `NodePort` 또는 외부 로드 밸런서가 있는 `ClusterIP`).
- 상태 페이지 또는 기본 호스트의 DNS 레코드가 OneUptime ingress gateway 앞에 있는 서비스 또는 로드 밸런서를 여전히 가리키는지 확인합니다.
- 업그레이드 후 TLS 인증서가 임베디드 게이트웨이를 통해 계속 갱신되고 상태 페이지 도메인이 올바르게 확인되는지 확인합니다.


## OneUptime 7 → 8 업그레이드

Kubernetes에서 실행하는 경우 중요한 변경 사항이 있습니다:

- [Bitnami 라이선스 변경](https://github.com/bitnami/charts/issues/35164)으로 인해 더 이상 Postgres, Redis 및 ClickHouse에 Bitnami 차트를 사용하지 않습니다
- 이러한 변경 사항은 이전 버전과 호환되지 않습니다. Helm 차트 `values.yaml`의 새 구조를 따라야 합니다.
- 업그레이드 전에 데이터를 백업합니다 (Postgres, ClickHouse 및 영구 볼륨).


> 팁: 먼저 스테이징 환경에서 업그레이드를 테스트합니다. 프로덕션을 업그레이드하기 전에 워크로드가 정상이고 데이터가 온전한지 확인합니다.
