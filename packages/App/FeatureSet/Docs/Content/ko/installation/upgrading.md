# OneUptime 업그레이드

이 가이드는 자체 호스팅 OneUptime 설치를 안전하게 업그레이드하는 방법을 다룹니다.

## 일반 지침

- 주요 버전 간에는 단계적으로 업그레이드합니다 (예: 6 → 7 → 8). 주요 버전을 건너뛰지 마십시오.
- 릴리스 노트를 따르는 한 부 버전/패치 버전은 건너뛸 수 있습니다 (예: 8.1 → 8.4).
- 업그레이드 전에 항상 백업을 수행하고 복원할 수 있는지 확인합니다.

<!-- TODO(i18n): Translate this section. English source: en/installation/upgrading.md (added for the Community/Enterprise image split). -->

## Community and Enterprise Edition images

OneUptime now ships the app as two images. The **Community Edition** is open
source under the Apache License 2.0. The **Enterprise Edition** adds the
enterprise modules from the repository's `ee/` directory: SAML SSO, OIDC, SCIM,
team compliance, audit logs and the enterprise Health dashboards in the Admin
Dashboard. Before this change both editions ran the same code, and
`IS_ENTERPRISE_EDITION` decided which features were switched on. Now the image
decides, and the Community image does not contain the `ee/` directory.

The [Enterprise Edition](/docs/self-hosted/enterprise) page has the full
feature comparison, licensing details and what happens when you switch
editions.

### What to do before you upgrade

- **Community Edition without SSO, OIDC or SCIM:** nothing. Upgrade as usual.
- **Helm with `image.type: enterprise-edition`:** nothing. The chart already
  pulls the `enterprise-` images, which now contain the enterprise modules.
- **Docker Compose with `IS_ENTERPRISE_EDITION=true`:** switch to the
  Enterprise image when you upgrade by setting `APP_TAG=enterprise-release`
  (or `enterprise-<version>`) in `config.env`. `APP_TAG=release` is the
  Community image, and `IS_ENTERPRISE_EDITION=true` no longer switches anything
  on. `npm run update` makes this change for you while
  `IS_ENTERPRISE_EDITION=true` (`release` becomes `enterprise-release`, a
  pinned `13.0.7` becomes `enterprise-13.0.7`) and prints what it changed.
  The App now **refuses to start** when `IS_ENTERPRISE_EDITION=true` is set on
  the Community image, instead of silently no longer enforcing "Require SSO",
  SSO, SCIM and audit logging. The error says what to set:
  `APP_TAG=enterprise-<version>` to keep the Enterprise Edition, or
  `IS_ENTERPRISE_EDITION=false` to run the Community Edition.
- **Community image with SSO, OIDC or SCIM already configured:** SSO sign-in
  and SCIM provisioning stop with this upgrade, and "Require SSO for login" is
  no longer enforced. Switch to the Enterprise image to keep them. Otherwise,
  read [Switching from Enterprise to Community](/docs/self-hosted/enterprise#switching-from-enterprise-to-community)
  before you upgrade. It explains how users sign in afterwards and who to
  remove first. To run the Community Edition, also set
  `IS_ENTERPRISE_EDITION=false`.

Your configuration is never deleted, and no migration is needed to switch
editions in either direction.

### Licensing after the upgrade

The Enterprise Edition now checks its license:

- **An install with a license key** keeps working. It checks the license with
  OneUptime when it starts and once a day. If the license expires, everything
  keeps working for a 30-day grace period, and after that the same happens as
  for an install with no license.
- **An install with no license**, for example one that ran the Enterprise
  Edition on `IS_ENTERPRISE_EDITION=true` alone, gets a 14-day trial from the
  first start of this release. **If you use SSO, OIDC, SCIM or audit logging,
  activate a license before the trial ends.** After the trial, SSO and OIDC
  sign-in stop, "Require SSO for login" is no longer enforced (users sign in
  with their password), SCIM provisioning stops and audit logging stops
  recording. Enterprise configuration also becomes read-only and the
  enterprise Health dashboards are locked. Everything resumes, without a
  restart, as soon as you activate a license. The trial is for evaluation:
  production use of the Enterprise Edition requires a OneUptime Enterprise
  subscription. See
  [When a license expires or is missing](/docs/self-hosted/enterprise#when-a-license-expires-or-is-missing).
- **Air-gapped installs** can activate with a signed license token instead of
  a key. See [Offline activation](/docs/self-hosted/enterprise#offline-activation-air-gapped-installs).

### OneUptime Cloud customers

Nothing changes for you. OneUptime Cloud runs the Enterprise Edition, and your
plan still decides which features you get: SSO, OIDC, SCIM and team
compliance on the Scale plan and above, and audit logs on the Enterprise plan.
Projects on the Scale plan now see the SSO, OIDC, SCIM and team compliance
settings that used to show an upgrade prompt.

### API and endpoint changes

- `GET /api/global-config/license` returns the license key, the license token,
  the instance list, the instance ID and version details only to master
  admins. Other callers get the edition and the license status.
- Self-hosted installs no longer serve the license-server endpoints under
  `/api/enterprise-license/`. Only oneuptime.com uses them.
- The SSO, OIDC and SCIM endpoints keep their exact paths on the Enterprise
  Edition, so identity provider configuration does not change. On the
  Community Edition they return `404`. On the Enterprise Edition they refuse
  requests while the license is lapsed (after the trial or grace period), and
  answer again as soon as a license is activated.

## OneUptime 13 → 14 업그레이드

OneUptime 14는 애플리케이션을 두 에디션으로 나누며, 어떤 에디션이 실행되는지는 내려받는 이미지가 결정합니다. **Community Edition**(Apache-2.0, `release` 및 `<version>` 태그)에는 저장소의 `ee/` 디렉터리가 들어 있지 않습니다. SAML SSO, OpenID Connect, SCIM 프로비저닝, 팀 규정 준수 설정, 감사 로그, 관리자 화면의 **Health** 대시보드와 **Query Console**은 그 이미지에 전혀 포함되어 있지 않습니다. **Enterprise Edition**(`enterprise-release` 및 `enterprise-<version>` 태그)은 이 기능들을 포함하며, 실행 중에 Enterprise 라이선스를 확인합니다. OneUptime 13은 라이선스를 확인한 적이 없습니다.

위의 [Community and Enterprise Edition images](#community-and-enterprise-edition-images)가 이 변경에 대한 기준 문서입니다. 각 에디션에 무엇이 들어 있는지, 배포 방식별로 무엇을 설정해야 하는지, 라이선스가 무슨 일을 하는지가 정리되어 있습니다. 이 절은 업그레이드 자체를 다룹니다. 13에서 업그레이드하십시오. 아직 12라면 12 → 13을 먼저 수행하십시오.

어느 에디션에서도 삭제되는 것은 없습니다. SSO, OIDC, SCIM 설정과 "Require SSO for login" 설정, 지금까지 기록된 감사 로그는 데이터베이스에 그대로 남습니다. Community Edition은 그것들을 제공하거나 강제하지 않을 뿐이며, 에디션 전환에는 어느 방향으로도 마이그레이션이 필요하지 않습니다.

### 해야 할 일

1. **이 설치가 어떤 에디션으로 동작할지 결정하십시오.** SAML SSO, OpenID Connect, SCIM 프로비저닝, 팀 규정 준수 설정, 감사 로그를 사용하거나 관리자 화면의 **Health** 대시보드가 필요하다면 Enterprise Edition입니다. 그렇지 않다면 결정할 것이 없습니다. 이미 쓰고 있는 것이 Community Edition입니다.
2. **Helm에서는 values 파일에 에디션을 지정하십시오.** `image.type: enterprise-edition`(기본값은 `community-edition`)입니다. `image.tag`는 그대로 두십시오. 차트가 `enterprise-` 접두사를 직접 붙이므로 `image.tag: release`는 `oneuptime/app:enterprise-release`를 내려받습니다. 새로 생긴 값이 아니며, 이미 `enterprise-edition`으로 운영 중이라면 바꿀 것이 없습니다. 지금까지 받던 태그에 이제 `ee/`가 들어 있습니다.
3. **Docker Compose에서는 `config.env`에 `APP_TAG=enterprise-release`를 설정하십시오**(버전을 고정하려면 `enterprise-<version>`). `APP_TAG=release`는 Community 이미지입니다. 13 설치가 멈추는 지점이 바로 여기입니다. 13에서 Compose 기반 Enterprise 설치는 `APP_TAG=release`에 `IS_ENTERPRISE_EDITION=true`를 더한 형태였는데, 이제 그 조합은 SSO 설정을 더 이상 강제하지 않는 Community Edition으로 조용히 올라오는 대신 **시작을 거부**합니다. `IS_ENTERPRISE_EDITION=true`인 동안에는 `npm run update`가 `APP_TAG`를 대신 바꿔 주고(`release`는 `enterprise-release`로, 고정된 `13.0.8`은 `enterprise-13.0.8`로) 무엇을 바꿨는지 출력합니다. 이미지를 직접 내려받는다면 먼저 `APP_TAG`를 직접 설정하십시오.
4. **Enterprise Edition에서는 라이선스를 활성화하십시오.** 라이선스가 없는 설치에는 14일 평가 기간이 주어지며, Enterprise Edition을 처음 시작한 시점부터 계산합니다. 업그레이드의 경우 그 시점은 업그레이드한 날이지, OneUptime을 처음 설치한 날이 아닙니다. 마스터 관리자가 관리자 화면 헤더의 에디션 라벨에서 활성화하며, 인터넷에 연결되지 않은 설치는 서명된 토큰으로 활성화합니다. [Licensing](/docs/self-hosted/enterprise#licensing)을 참고하십시오.
5. **SSO 강제 설정이 있는 상태에서 이 설치를 Community Edition으로 운영할 예정이라면, 업그레이드 전에 누가 접근 권한을 가지고 있는지 확인하십시오.** "Require SSO for login"이 더 이상 강제되지 않아 비밀번호 로그인이 다시 허용되며, 계정과 그 메일함에 접근할 수 있는 사람은 누구나 "비밀번호 찾기"로 비밀번호를 설정할 수 있습니다. SCIM 해제 프로비저닝도 중단되므로 ID 공급자에서 삭제한 사람도 여기에 포함됩니다. 그런 사용자를 먼저 제거하십시오: [Switching from Enterprise to Community](/docs/self-hosted/enterprise#switching-from-enterprise-to-community).
6. **Ping, Port, SSL 모니터로 IPv6 주소를 감시하고 있다면 업그레이드 후 해당 모니터를 다시 저장하십시오.** 14 이전에 저장된 대상은 잘린 채 저장되었을 수 있습니다(아래 참조).

### 에디션: 무엇이 바뀌고 무엇이 그대로인가

| | 13까지 | 14부터 |
| --- | --- | --- |
| Enterprise 코드 | 모든 이미지에 포함, `IS_ENTERPRISE_EDITION=true`로 활성화 | `ee/`에 있으며 `enterprise-` 이미지에만 포함 |
| Helm 선택 | `image.type` | `image.type` — 그대로지만 이미지의 내용이 실제로 달라짐 |
| Compose 선택 | `IS_ENTERPRISE_EDITION=true` | `APP_TAG=enterprise-release` |
| Enterprise 라이선스 | 실행 중에 확인하지 않음 | 시작할 때와 하루 한 번 확인 |
| SSO, OIDC, SCIM 엔드포인트 | 두 에디션에서 같은 경로 | Enterprise에서는 같은 경로, Community에서는 `404` |
| Enterprise 설정 | 저장되고 강제됨 | 양쪽 모두 저장되며 Enterprise에서 강제됨 |

마이그레이션은 한 건 실행됩니다. 한 행짜리 테이블 `GlobalConfig`에 NULL 허용 컬럼 `enterpriseEditionFirstSeenAt`을 추가하는 것으로, 즉시 끝납니다. ClickHouse 마이그레이션은 없고, 삭제되는 것도 없으며, 에디션 전환에는 어느 방향으로도 마이그레이션이 필요하지 않습니다.

### Enterprise Edition의 라이선스 시간표

- **라이선스가 없는 설치**는 Enterprise Edition을 처음 시작한 시점부터 14일 동안 평가 기간으로 동작합니다. 그동안 모든 Enterprise 기능이 동작하고, 기간이 끝나기 전에 에디션 라벨이 경고합니다. 평가 기간은 검토용입니다. Enterprise Edition을 운영 환경에서 사용하려면 OneUptime Enterprise License에 따른 구독이 필요합니다.
- **만료되는 라이선스**에는 만료일부터 30일의 유예 기간이 주어지며, 그동안 모든 Enterprise 기능이 동작하고 에디션 라벨이 경고합니다.
- **평가 기간 이후 또는 그 유예 기간 이후**, 라이선스를 활성화할 때까지는 다음과 같습니다. SSO 및 OIDC 로그인이 거부되고, "Require SSO for login"이 더 이상 강제되지 않으며(사용자는 비밀번호로 로그인합니다), ID 공급자의 SCIM 요청이 거부되고, 감사 로그 기록이 중단됩니다. Enterprise 설정은 읽기 전용이 됩니다. 조회와 삭제, SSO 또는 OIDC 공급자 비활성화, SCIM 베어러 토큰 재설정은 계속 가능하며, 이는 장애 대응에 필요한 작업입니다. Health 대시보드와 Query Console은 잠깁니다.
- **아무것도 삭제되지 않으며 핵심 모니터링은 결코 영향을 받지 않습니다.** 모니터, 알림, 인시던트, 온콜, 상태 페이지, 텔레메트리는 라이선스와 무관하며, 비밀번호 로그인은 마스터 관리자를 포함한 모든 사용자에게 그대로 열려 있습니다. 라이선스를 활성화하면 SSO 로그인, SSO 강제, SCIM 프로비저닝, 감사 로그 기록이 이미 가지고 있던 설정 그대로 재시작 없이 되살아납니다.
- **이미 보유한 라이선스 키는 그대로 인정됩니다.** "unverified" 라이선스로 처리되어 만료일과 좌석 수는 라이선스 서버가 이 설치에 이미 알려 준 값에서 가져오며, 그 만료 이후에도 동일한 30일 유예 기간이 적용됩니다. 앞으로 발급되는 라이선스는 서명되어 애플리케이션이 직접 검증합니다. 이번 업그레이드를 위해 새 키를 받을 필요는 없습니다.

전체 상태 표는 [When a license expires or is missing](/docs/self-hosted/enterprise#when-a-license-expires-or-is-missing)에 있습니다.

### Docker Compose: 이미지 태그 고르기

```
git checkout release # release 브랜치에 있는지 확인하십시오.
git pull
npm run update
```

- **`IS_ENTERPRISE_EDITION=true`인 동안 `npm run update`는 `APP_TAG`를** 같은 릴리스의 Enterprise 이미지로 옮기고 무엇을 바꿨는지 출력합니다. 주석과 따옴표는 그대로 유지되고, 이미 `enterprise-` 태그인 `APP_TAG`는 건드리지 않으며, 두 번째 실행에서는 아무것도 바뀌지 않습니다.
- **이미지를 직접 내려받으면 이 과정이 생략됩니다.** 그러면 애플리케이션은 시작 시 종료되며, 무엇을 설정해야 하는지 정확히 알려 주는 오류를 냅니다. Enterprise Edition을 유지하려면 `APP_TAG=enterprise-<version>`, Community Edition으로 운영하려면 `IS_ENTERPRISE_EDITION=false`입니다.
- **의도적으로 Community Edition으로 옮기려면** `APP_TAG=release`와 `IS_ENTERPRISE_EDITION=false`를 설정하십시오. 이 설치가 SSO를 강제하고 있다면 위의 5번을 먼저 읽으십시오.
- 이번 릴리스를 위해 `config.env`에서 그 밖에 바꿀 것은 없습니다.

### Helm: 이미지 유형 고르기

```
helm repo update
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

- **이미 `image.type: enterprise-edition`으로 운영 중인 설치는 values를 바꿀 필요가 없습니다.** 차트는 오래전부터 태그에 접두사를 붙여 왔고, 새로운 점은 `enterprise-` 이미지에 `ee/`가 들어 있다는 것입니다. 이번 릴리스부터 위의 시간표대로 라이선스가 적용됩니다.
- **`image.tag: release`가 기본값**이므로, 이 유동 태그에 머물러 있는 차트는 다음 업그레이드에서 values를 전혀 바꾸지 않아도 14로 넘어갑니다. 그 설치가 `community-edition`에서 SSO, OIDC, SCIM을 설정해 두었다면 같은 업그레이드에서 `image.type: enterprise-edition`을 설정하십시오.
- **`IS_ENTERPRISE_EDITION`은 여전히 차트가 내보냅니다.** `image.type`에서 파생되므로 둘이 어긋날 수 없습니다. 이 변수는 아무것도 제어하지 않습니다. Community 이미지에서 `extraEnv`로 `true`를 강제하면 애플리케이션이 시작을 거부할 뿐입니다. `ONEUPTIME_EDITION`은 차트로 설정하지 마십시오.
- **차트의 프로브가 `probes.<key>.allowPrivateNetworkMonitors`를 다시 존중합니다**([#3879](https://github.com/OneUptime/oneuptime/issues/3879)). 이 값을 설정하지 않으면 아무것도 달라지지 않으며(기본값은 여전히 `false`입니다), 차트의 프로브는 글로벌 프로브이므로 설정하면 인스턴스의 **모든 프로젝트** 모니터에 적용됩니다. 루프백, 링크 로컬, `169.254.169.254`는 값과 상관없이 계속 차단됩니다.

### 14의 그 밖의 변경

- **OTLP 수집은 큐가 배치를 받아들인 뒤에야 확인 응답을 보냅니다.** 13은 `200`을 먼저 응답하고 나중에 큐에 넣었기 때문에 큐가 거부한 배치는 조용히 사라졌습니다. 14는 `503`과 `Telemetry queue unavailable. Please retry.`를 응답하고, gRPC 엔드포인트는 `UNAVAILABLE`을 반환합니다. 둘 다 재시도 가능하며 익스포터는 다시 보냅니다. 로그, 메트릭, 트레이스, 프로파일에 모두 해당합니다. 조치할 것은 없지만, 예전에는 데이터가 사라지던 상황에서 익스포터의 재시도와 큐의 백프레셔가 이제 드러납니다. 수집 용량을 산정한다면 알아 둘 만합니다.
- **관리자 화면의 Health 대시보드와 Query Console은 Enterprise Edition이 필요합니다.** PostgreSQL과 Valkey 상태 알림도 마찬가지입니다. 13에서는 `IS_ENTERPRISE_EDITION=true`만으로 쓸 수 있었으므로, 이를 사용하던 Community 설치에는 눈에 띄는 손실입니다. ClickHouse 용량 보기와 정리, 마이그레이션 상태, 글로벌 프로브, 지원 번들은 두 에디션 모두에 있습니다.
- **프로브의 프록시를 통해 IP 주소에 도달하는 HTTPS 모니터가 다시 동작합니다.** 프로브가 IP를 TLS 서버 이름으로 보냈는데, IP는 올바른 서버 이름이 아니어서 Node가 곧바로 거부했습니다. 그래서 `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS`를 설정한 글로벌 프로브에서 `https://<사설 IP>`를 감시하면 핸드셰이크에 실패했습니다. 이제 대상이 IP이면 프로브가 서버 이름을 보내지 않고 인증서를 IP 자체로 검증합니다. 호스트 이름 대상은 달라지지 않습니다.
- **`oneuptime` CLI가 `--version`에서 실제 버전을 보고합니다**(이전에는 자리 표시자였습니다).
- 이동되었거나 접근이 제한된 엔드포인트는 위의 [API and endpoint changes](#api-and-endpoint-changes)에 정리되어 있습니다. `GET /api/global-config/license`와, 자체 호스팅 설치가 더 이상 제공하지 않는 라이선스 서버 엔드포인트가 포함됩니다.

### IPv6 모니터: Ping, Port, SSL

앞뒤에 공백이 붙은 채 붙여 넣은 Ping 또는 Port 대상은 지금까지 잘린 채 저장되었습니다. looking glass나 라우터 설정에서 주소를 복사하면 정확히 이런 형태가 됩니다. `2001:518:2800:9::2 `는 호스트 `2001`, 포트 `518`로 저장되었습니다. 두 조각 모두 유효한 값이라 아무 오류도 나지 않고 오류 표시도 없었으며, 모니터는 아무도 입력하지 않은 호스트를 감시했습니다. IPv4 주소는 나눌 콜론이 없어서 전혀 영향을 받지 않았습니다. 14는 이 파싱을 고치고, 아울러 macOS와 FreeBSD 프로브에서 IPv6 Ping 모니터가 즉시 그리고 계속 실패하던(실제 장애로 보고되던) 문제와 IPv6 SSL 모니터가 `ENOTFOUND`로 실패하던 문제도 고칩니다.

이미 저장된 대상을 위한 마이그레이션은 없습니다. 따라서 **업그레이드 후 Ping, Port, SSL의 IPv6 모니터를 하나씩 열어 다시 저장하고**, 표시되는 대상을 확인하십시오. macOS나 FreeBSD 프로브에서 계속 실패하던 모니터는 이제 사실대로 보고하므로, 인시던트가 해소되거나 새로 발생할 수 있습니다.

### 에디션과 라이선스 확인

- **관리자 화면 헤더의 에디션 라벨**이 실행 중인 에디션을 알려 주며, Enterprise Edition에서는 라이선스 상태도 함께 보여 줍니다.
- **Compose:** `docker compose images`로 실행 중인 태그를 확인할 수 있습니다. Enterprise Edition에서는 모든 OneUptime 이미지에 `enterprise-` 접두사가 붙습니다.
- **Helm:** `kubectl get pods -n <namespace> -o jsonpath='{..image}'`로 파드가 실행 중인 이미지를 출력할 수 있습니다. 같은 접두사 규칙이 적용됩니다.
- SSO, OIDC, SCIM 엔드포인트로 두 경우를 구분할 수 있습니다. `404`는 그 이미지에 `ee/`가 없다는 뜻(Community Edition)이고, `402`나 `403`은 Enterprise Edition이 실행 중이며 라이선스에 조치가 필요하다는 뜻입니다.

### 13으로 롤백

- 두 에디션과 두 릴리스가 같은 데이터를 읽고, 스키마 변경은 13이 무시하는 NULL 허용 컬럼 하나뿐이므로 이미지를 되돌리는 데 데이터베이스 작업은 필요 없습니다.
- **Docker Compose:** `APP_TAG`를 운영하던 13 태그(`13.0.8` 또는 `enterprise-13.0.8`)로 되돌리고 `npm run update`를 실행하십시오. 13에서는 `IS_ENTERPRISE_EDITION=true`가 Enterprise 기능을 켜므로, 설정해 두었다면 다시 넣으십시오.
- **Helm:** `helm rollback my-oneuptime`을 실행하거나 `image.tag`를 `13.0.8`로 고정하십시오.
- 14를 실행해도 Enterprise 설정은 건드려지지 않으므로 롤백하면 그대로 남아 있습니다.

> 팁: Enterprise Edition에서는 평가 기간이 끝날 때가 아니라 업그레이드하는 날에 라이선스를 활성화하십시오. 싱글 사인온 강제를 유지해 주는 것이 바로 활성화이며, 평가 기간은 최초 설치일이 아니라 이번 업그레이드부터 계산됩니다.

## OneUptime 12 → 13 업그레이드

OneUptime 13은 기본 제공 캐시·큐 엔진을 Redis에서 [Valkey](https://valkey.io)로 교체합니다. Redis 7.4가 BSD 라이선스를 떠났고, 초기 Redis 기여자 대부분이 Valkey로 옮겼기 때문입니다. Valkey는 Redis 7.2의 포크이며 동일한 프로토콜을 사용합니다. 소켓 위 계층은 아무것도 바뀌지 않았고, 원한다면 여전히 실제 Redis나 관리형 Redis 호환 서비스를 가리키게 할 수 있습니다.

설정하는 항목의 이름도 모두 그에 맞춰졌습니다. 설정은 `VALKEY_*`, Helm 값은 `valkey:` / `externalValkey:`, 쿠버네티스 오브젝트는 `<release>-valkey*`입니다. **기존 이름은 모두 계속 동작합니다.** 손대지 않은 `config.env`나 `values.yaml`도 그대로 업그레이드되어 계속 동작합니다. 반드시 수정해야 하는 설정은 없고, 옮겨야 할 데이터도 없습니다. 캐시는 진실의 원천이 아니며 Postgres와 ClickHouse는 영향을 받지 않습니다.

무엇을 해야 하는지는 배포 방식에 따라 다릅니다.

- **Docker Compose:** 평소대로 업데이트하되, 중요한 옵션이 하나 있습니다 — [Docker Compose 업그레이드](#docker-compose-업그레이드)를 참고하세요.
- **Helm:** 값을 바꿀 필요는 없지만 캐시 파드가 다시 생성되어 비어 있는 상태로 돌아옵니다 — [Helm 업그레이드](#helm-업그레이드)를 참고하세요.
- **직접 운영하는 캐시를 OneUptime이 바라보게 한 경우**(관리형 Redis, ElastiCache, Memorystore, 직접 운영하는 Valkey): [직접 캐시를 운영하는 경우](#직접-캐시를-운영하는-경우)를 읽어 보세요. 아무 신호 없이 서버에 도달하지 못하게 될 수 있는 유일한 구성입니다.
- **쿠버네티스 오브젝트 이름에 의존하는 대시보드, 알림, 네트워크 정책, 스크립트가 있는 경우:** 그 이름들이 바뀝니다 — [Helm 업그레이드](#helm-업그레이드)를 참고하세요.

### 무엇이 바뀌고 무엇이 그대로인가

| | 12까지 | 13부터 |
| --- | --- | --- |
| 엔진 | `redis:7.0.12` | `valkey/valkey:9.1-alpine` |
| 설정 | `REDIS_*` | `VALKEY_*` — `REDIS_*`도 계속 읽음 |
| Compose 서비스 | `redis` | `valkey` — 호스트 이름 `redis`로도 계속 응답 |
| Helm 값 | `redis:`, `externalRedis:` | `valkey:`, `externalValkey:` — 기존 키도 계속 적용 |
| 쿠버네티스 오브젝트 | `<release>-redis`, `<release>-redis-master` | `<release>-valkey`, `<release>-valkey-master` |
| 생성되는 Secret | `<release>-redis`의 `redis-password` | `<release>-valkey`의 `valkey-password` |
| 외부 캐시 Secret | `<release>-external-redis` | `<release>-external-valkey` |

이름이 바뀐 설정은 `VALKEY_HOST`, `VALKEY_PORT`, `VALKEY_DB`, `VALKEY_USERNAME`, `VALKEY_PASSWORD`, `VALKEY_IP_FAMILY`, `VALKEY_TLS_CA`, `VALKEY_TLS_CERT`, `VALKEY_TLS_KEY`, `VALKEY_TLS_SENTINEL_MODE` 열 개입니다. 두 표기가 모두 있으면 애플리케이션은 `VALKEY_*` 쪽을 우선합니다. Helm 차트는 반대로 처리합니다. 예전 `redis:` 키가 새 기본값을 이기므로, 한 번도 건드리지 않은 값 파일은 이전과 완전히 똑같이 동작합니다.

**캐시는 한 번 재시작합니다.** 컨테이너가 교체되므로 두 배포 방식 모두 마찬가지입니다. 디스크에는 아무것도 저장하지 않으므로(`appendonly no`, `save ""`) 비어 있는 상태로 돌아옵니다. 캐시된 값은 사라지고, 대기 중이거나 지연되었거나 백오프 중이던 BullMQ 작업도 사라집니다. 반복 작업과 cron 작업은 재연결 시 스스로 다시 등록됩니다. 진행 중인 텔레메트리나 워크플로 재시도가 중요하다면 한산한 시간대에 업그레이드하세요.

### Docker Compose 업그레이드

평소의 업데이트로 충분합니다.

```
git checkout release # release 브랜치에 있는지 확인하세요.
git pull
npm run update
```

- **Compose를 직접 실행한다면 `--remove-orphans`를 사용하세요.** `npm run update`와 `npm run start`는 이미 이 옵션을 넘기며, 이것이 예전 `redis` 컨테이너를 제거합니다. 그대로 두면 두 컨테이너가 호스트 이름 `redis`에 응답해 연결이 무작위로 낡은 쪽에 도달합니다.
- **`config.env`는 다시 쓰이지 않습니다.** `npm run update`는 보통 `config.example.env`에는 있고 사용자 파일에는 없는 설정을 덧붙이지만, 이 열 개는 이름 변경으로 인식해 `REDIS_PASSWORD`를 포함한 값을 있던 자리에 그대로 둡니다. 무엇을 유지했는지도 출력합니다.
- 자신의 키를 `VALKEY_*`로 바꾸는 것은 선택 사항이며 나중에 해도 안전합니다. 설정마다 표기는 하나만 두세요.
- **`docker-compose.override.yml`에서 캐시 변수를 설정한다면 `VALKEY_*`로 바꾸세요.** 베이스 파일이 이제 사용자의 `REDIS_HOST`로부터 `VALKEY_HOST`를 설정하고 애플리케이션은 `VALKEY_HOST`를 먼저 읽으므로, `REDIS_HOST`만 설정하는 오버라이드는 더 이상 우선하지 않습니다.

### Helm 업그레이드

```
helm repo update
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

- **값을 바꿀 필요가 없습니다.** `redis:`와 `externalRedis:`는 계속 동작하며, 그 아래에 설정한 내용은 `valkey:` / `externalValkey:`의 새 기본값 위에 덮입니다. 그리고 `helm upgrade`는 발견한 예전 키를 나열하는 `DEPRECATED VALUES` 안내를 출력합니다. 편할 때 이름을 바꾸면 됩니다.
- **회전되는 값은 없습니다.** 차트는 기존 `<release>-redis` Secret에서 비밀번호를 읽어 새로 만들지 않고 `<release>-valkey`로 옮깁니다.
- **예전 Secret 두 개는 그대로 남습니다.** `<release>-redis`와, 자체 캐시를 사용한다면 `<release>-external-redis`에는 `helm.sh/resource-policy: keep` 주석이 붙어 있어 이제 쓰이지 않는 사본으로 남습니다. 업그레이드가 안정되면 삭제하세요. 다만 먼저 [12로 롤백](#12로-롤백)을 읽어 보세요.
- **오브젝트 이름이 바뀝니다.** `<release>-redis`나 `<release>-redis-master`에 의존하는 것들, 즉 Grafana 대시보드, 알림 규칙, NetworkPolicy, ServiceMonitor, 백업 작업을 갱신하세요.
- Service는 예전 이름 `<release>-redis-master`로도 함께 게시되므로, 아직 교체되지 않은 파드가 롤아웃 내내 이름 해석에 실패하지 않고 스스로 다시 연결됩니다. 모든 워크로드가 교체된 뒤에는 `valkey.legacyServiceAlias: false`로 설정해 제거하세요.
- **`persistence.enabled: true`를 쓰고 있었다면**, 새 StatefulSet은 새 볼륨 `data-<release>-valkey-0`을 요구합니다. 예전 `data-<release>-redis-0`에는 아무것도 들어 있지 않았으니 비용이 더 나가지 않도록 삭제하세요.

### 직접 캐시를 운영하는 경우

OneUptime이 직접 실행하지 않는 캐시를 가리키는 구성은 여전히 완전히 지원되며, 반대편 서버는 Valkey든 Redis든 관리형 Redis 호환 서비스든 상관없습니다. 달라진 것은 그것을 설정하는 블록의 이름뿐입니다.

- 값 파일의 `externalRedis:`를 `externalValkey:`로 바꾸세요. 선택 사항이지만(예전 키도 계속 적용됩니다) 차트가 지금 문서화하는 표기입니다.
- 차트는 Secret을 새 이름 `<release>-external-valkey`로 다시 만듭니다. 예전 `<release>-external-redis`는 남지만 더 이상 갱신되지 않으므로, 직접 작성한 매니페스트가 이름으로 참조한다면 대상을 옮기세요.
- **`extraEnv` 오버라이드는 더 이상 캐시에 도달하지 않으며, 조용히 실패합니다.** `externalValkey:` 블록 대신 `extraEnv: [{name: REDIS_HOST, ...}]`로 관리형 캐시를 가리키고 있다면, 해당 항목은 여전히 `REDIS_HOST` 자리를 차지하지만 애플리케이션은 `VALKEY_HOST`를 먼저 읽고 차트는 그 값을 클러스터 안의 자체 캐시로 설정합니다. 즉 오버라이드는 파드 스펙에 남은 채 무시됩니다. 해당 항목을 `VALKEY_*`로 바꾸거나, 지원되는 방식인 `externalValkey:`로 설정을 옮기세요. `helm upgrade`는 차트 전역의 `extraEnv` 항목에 대해서는 경고하지만 서비스별 `<service>.extraEnv` 목록은 볼 수 없으므로 직접 확인해야 합니다. Compose에서의 대응물은 `REDIS_HOST`만 설정하는 오버라이드 파일입니다.

### 업그레이드 확인

- **관리자 대시보드 → Health → Valkey**에 「Connected」와 메모리 수치가 표시되어야 합니다. 상태 경고 이메일이 사용하는 것과 같은 도달성 점검입니다.
- **Compose:** `docker compose ps`에 `valkey` 서비스가 보이고 `redis` 컨테이너는 없습니다.
- **Helm:** `kubectl get pods,svc -n <namespace>`에 `<release>-valkey-0`이 Running으로, Service `<release>-valkey-master`가 함께 표시됩니다. `helm get notes my-oneuptime`으로 업그레이드가 출력한 안내를 다시 볼 수 있습니다.
- 더 깊이 보려면 `HelmChart/Public/diagnose.sh`가 캐시 메모리, 축출, 연결성을 보고하며 예전 이름과 새 이름을 모두 이해합니다.

### 12로 롤백

- **Helm:** `helm rollback`은 정상 동작합니다. 12 차트가 자신이 만든 `<release>-redis` Secret이 그대로 있는 것을 찾아 그 비밀번호를 다시 쓰기 때문입니다. 예전 Secret을 남겨 두는 이유가 이것이니, 13에 머무를 것이 확실해질 때까지 삭제하지 마세요.
- **Docker Compose:** 확신이 설 때까지 `config.env`의 표기를 `REDIS_*`로 유지하세요. OneUptime 12는 `REDIS_*`만 읽으므로, 키 이름을 바꾼 `config.env` 그대로 롤백하면 캐시는 비밀번호가 설정되지 않은 채 Compose 네트워크에 열린 상태로 시작하고 애플리케이션은 인증하지 못합니다. 두 표기를 같은 값으로 함께 두는 방법도 괜찮습니다.
- 롤백도 캐시를 다시 재시작하므로 콜드 스타트 비용은 동일합니다.

### 의도적으로 Redis로 남긴 이름

이것들은 빠뜨린 것이 아니며, 어느 것도 조치가 필요하지 않습니다.

- **API 형태는 그대로입니다.** 인스턴스 상태 응답의 `components.redis`와 `summary.redis`, 경로 `/api/admin/health/redis`, 관리자 쿼리 콘솔의 엔진 값 `redis`는 표시 문구가 아니라 프로토콜 키입니다. 이를 대상으로 작성한 스크립트는 그대로 동작합니다.
- **Redis 프로토콜 용어:** `redis-cli`, `INFO`의 `redis_version` 필드, 그리고 상태 알림이 비교 기준으로 삼는 저장된 메모리 기준값. 이 키의 이름을 바꾸면 모든 인스턴스의 이력이 사라집니다.
- **기본 호스트 이름은 여전히 `redis`입니다.** 손으로 작성한 매니페스트와 단순한 `docker run` 구성을 위한 것입니다. `VALKEY_HOST`와 `REDIS_HOST`가 모두 없을 때만 쓰이는데, 저희 Compose나 Helm에서는 그런 일이 없습니다.
- 내부 클래스 이름과 Postgres 열 이름. 아무도 보지 않으며 이름을 바꾸면 마이그레이션 비용만 듭니다.

## OneUptime 11 → 12 업그레이드

<!-- TODO(i18n): Translate this section. English source: en/installation/upgrading.md (added for the v12 Runner merge). -->

OneUptime 12 merges two components into one. The **Runbook Agent** (the
container you installed on your own hosts to execute runbook steps) and the
**AI Agent** (the service that worked on AI code fixes) are now a single
component: the **OneUptime Runner**, shipped as the `oneuptime/runner`
Docker image. The old `oneuptime/runbook-agent` and `oneuptime/ai-agent`
images are no longer built or published — existing tags remain pullable,
but they will never receive another update.

A Runner is one installed container that can hold several **capabilities**,
toggled per Runner in the dashboard: **Runs Runbooks** (on by default),
**Runs AI Code Fixes** (off by default), and **Runs AI Remediation Commands** (off by
default). Capability changes are adopted on the Runner's next heartbeat —
no restart needed. See [Runners](/docs/runbooks/agents) for how the
component works day to day.

What you need to do depends on how you deployed:

- **Everyone:** read [What happens automatically](#what-happens-automatically)
  and [Dashboard pages moved](#dashboard-pages-moved).
- **You installed Runbook Agents on your hosts:** redeploy them onto the new
  image — see [Redeploy your Runbook Agents](#redeploy-your-runbook-agents).
- **Docker Compose:** environment variable renames plus **one
  security-relevant step** — see [Docker Compose deployments](#docker-compose-deployments).
- **Helm:** a values-file rename that fails validation if skipped — see
  [Helm deployments](#helm-deployments).
- **API keys that were granted agent permissions directly:** re-grant them —
  see [Permissions: teams migrate, API keys do not](#permissions-teams-migrate-api-keys-do-not).

### What happens automatically

No manual database work. On first boot, v12 runs a migration that:

- Renames the Postgres tables and columns (`RunbookAgent` → `Runner`,
  `RunbookAgentJob` → `RunnerJob`, plus the owner, label, and join tables to
  match). Runner ids, keys, and job history are untouched — this is a
  rename, not a re-registration.
- Migrates every **team** permission grant from the old `…RunbookAgent…`
  permission names to the new `…Runner…` names, so team roles keep working
  without reassignment. (Direct API-key grants are the exception — see below.)

The API stays compatible too:

- Requests to `/api/runbook-agent`, `/api/runbook-agent-job`,
  `/api/runbook-agent-owner-team`, and `/api/runbook-agent-owner-user` are
  rewritten server-side onto their `/runner…` equivalents, so existing
  scripts keep working.
- The agent-facing ingest path `/runbook-agent-ingest` is still served
  alongside the new `/runner-ingest`, so **Runbook Agent containers you have
  not redeployed yet keep heartbeating and executing Bash and JavaScript
  steps** against a v12 server. Each one logs a deprecation warning on the
  server naming the agent that should be redeployed.

### Redeploy your Runbook Agents

Your existing agents keep running Bash and JavaScript steps unchanged, so
this does not block the upgrade — but do it soon after:

- **SSH and Kubernetes steps (new in v12) fail on old agents.** The server
  does not exclude old agents from claiming them: an agent still on the
  `runbook-agent` image will claim an SSH or Kubernetes job and fail it with
  `Unsupported step type` — typically mid-incident, when the runbook runs.
  Redeploy the agent **before** authoring SSH or Kubernetes steps that
  target it.
- The old image receives no further updates of any kind.

Redeploying means re-running the install command with the new image and
variable names. The agent's id and key are **unchanged** (same database
row) — swap the names, keep the values:

```bash
docker rm -f oneuptime-runbook-agent

docker run --name oneuptime-runner --restart unless-stopped \
  -e ONEUPTIME_RUNNER_ID=<agent-id> \
  -e ONEUPTIME_RUNNER_KEY=<agent-key> \
  -e ONEUPTIME_URL=https://oneuptime.yourdomain.com \
  -d oneuptime/runner:release
```

(Or open the Runner in **Settings → Runners** and use **Show setup
instructions** for a pre-filled command.)

If you tuned the agent with environment variables, rename them — the old
names are **silently ignored** by the new image:

| Old (Runbook Agent)                     | New (Runner)                              |
| --------------------------------------- | ----------------------------------------- |
| `RUNBOOK_AGENT_ID`                       | `ONEUPTIME_RUNNER_ID`                     |
| `RUNBOOK_AGENT_KEY`                      | `ONEUPTIME_RUNNER_KEY`                    |
| `RUNBOOK_AGENT_POLL_INTERVAL_MS`         | `ONEUPTIME_RUNNER_POLL_INTERVAL_MS`       |
| `RUNBOOK_AGENT_HEARTBEAT_INTERVAL_MS`    | `ONEUPTIME_RUNNER_HEARTBEAT_INTERVAL_MS`  |
| `RUNBOOK_AGENT_JOB_HEARTBEAT_INTERVAL_MS`| `ONEUPTIME_RUNNER_JOB_HEARTBEAT_INTERVAL_MS` |
| `RUNBOOK_AGENT_CONCURRENCY`              | `ONEUPTIME_RUNNER_CONCURRENCY`            |

### If you ran the standalone AI Agent

The **Settings → AI → AI Agents** page is gone and the `oneuptime/ai-agent`
image is no longer built. If you had installed an AI Agent container
yourself, replace it with a Runner:

1. Create a Runner under **Settings → Runners** and install it with the
   command from **Show setup instructions**.
2. Enable **Runs AI Code Fixes** on it. The change is picked up on the next
   heartbeat.

Old AI Agent credentials still boot the new `oneuptime/runner` image
through a legacy fallback (code fixes only, with a logged warning telling
you to create a real Runner) — treat that as a bridge during the migration,
not a destination.

### Docker Compose deployments

The compose service `ai-agent` is now `runner`. If you upgrade with the
standard `npm run update` flow, the new variables are appended to your
`config.env` automatically and the stack boots — but read the key warning
below. The renames, if you manage `config.env` or overrides by hand:

| Old                              | New                                |
| -------------------------------- | ---------------------------------- |
| `AI_AGENT_KEY`                   | `ONEUPTIME_RUNNER_KEY`             |
| `AI_AGENT_ONEUPTIME_URL`         | `ONEUPTIME_RUNNER_ONEUPTIME_URL`   |
| `AI_AGENT_PORT`                  | `ONEUPTIME_RUNNER_PORT`            |
| `DISABLE_TELEMETRY_FOR_AI_AGENT` | `DISABLE_TELEMETRY_FOR_RUNNER`     |
| `ENABLE_PROFILING_FOR_AI_AGENT`  | `ENABLE_PROFILING_FOR_RUNNER`      |

The old `AI_AGENT_*` lines can stay in `config.env`; nothing reads them
anymore.

**Important — set `ONEUPTIME_RUNNER_KEY` to a random value.** The template
merge appends it with the literal placeholder
`please-change-this-to-random-value`; your old `AI_AGENT_KEY` value is
**not** carried over. This key registers the instance-wide Runner and
authenticates the AI code-fix protocol — including minting repository
access tokens — so leaving the publicly known placeholder in place is a
security hole. Before starting v12, set it to a long random value (reusing
your old `AI_AGENT_KEY` value is fine).

**Remove the orphaned `ai-agent` container.** `npm start` runs compose with
`--remove-orphans` and cleans it up. If you run `docker compose up -d` by
hand, add `--remove-orphans` (or `docker rm -f` the old container) —
otherwise the old AI Agent keeps running and keeps claiming code-fix work
alongside the new Runner.

### Helm deployments

- Rename the `aiAgent:` block in your values overrides to `runner:`. All
  subkeys (`enabled`, `replicaCount`, `resources`, `keda`, and so on) are
  unchanged. This is a hard break: the chart schema rejects unknown keys,
  so `helm upgrade` **fails validation** while an `aiAgent:` block remains.
- Workload names change from `<release>-ai-agent` to `<release>-runner` —
  update anything keyed on the old names (dashboards, alerts, network
  policies).
- The release secret key changes from `ai-agent-key` to `runner-key`. A
  fresh key is generated on upgrade and the in-cluster Runner re-registers
  itself automatically, so there is nothing to do unless something external
  referenced the old secret value.
- Deliberately unchanged: the KEDA scaling metric is still named
  `oneuptime_ai_agent_queue_size` — do not rename it in custom scalers.

### Permissions: teams migrate, API keys do not

Twelve permissions were renamed (`CreateRunbookAgent` → `CreateRunner`,
`EditRunbookAgent` → `EditRunner`, `DeleteRunbookAgent` → `DeleteRunner`,
`ReadRunbookAgent` → `ReadRunner`, and the same four verbs for
`…RunbookAgentOwnerTeam` → `…RunnerOwnerTeam` and
`…RunbookAgentOwnerUser` → `…RunnerOwnerUser`). Grants held through
**teams** are migrated automatically. Grants attached **directly to an API
key** are not — a key that held one of these twelve permissions loses that
access after the upgrade. Re-grant the new `…Runner…` permissions on those
keys in the dashboard. The `RunbookSecret`, `RunbookCredential`, and
`RunbookExecution` permission families kept their names.

Separately, v12 closes a hole: starting a runbook execution now requires
an authenticated caller with `ProjectOwner`, `ProjectAdmin`,
`ProjectMember`, `CreateRunbookExecution`, `RunbookAdmin`, or
`RunbookMember` — advancing or cancelling one also accepts
`EditRunbookExecution`. Unauthenticated triggering no longer works, and
read-only roles (for example `RunbookViewer`) can no longer start runs —
API automation that triggers runbooks needs `CreateRunbookExecution`.

### Dashboard pages moved

There are no redirects from the old URLs — update bookmarks and internal
wiki links:

| Page                    | Old location                             | New location                              |
| ----------------------- | ---------------------------------------- | ----------------------------------------- |
| Runners (was "Agents")  | Runbooks → Settings → Agents (`…/runbooks/settings/agents`) | Settings → Runners (`…/settings/runners`) |
| Runner Credentials      | Runbooks → Settings → Credentials (`…/runbooks/settings/credentials`) | Settings → Runner Credentials (`…/settings/runner-credentials`) |
| AI Agents               | Settings → AI → AI Agents (`…/settings/ai-agents`) | Removed — Runners with the **Runs AI Code Fixes** capability replace it |

Runbook Secrets stays where it was, under Runbooks → Settings → Secrets.

### New in 12, nothing to enable by accident

v12 adds AI-composed remediation commands: the AI can propose a command
plan and hand it to a Runner for execution. Everything about it is off by
default and stays off until you opt in twice — the project-level **AI
command execution** setting and the per-Runner **Runs AI Remediation Commands**
capability must both be enabled, and only runbooks/rules you configure for
it participate. Upgrading changes nothing here.

> Tip: as with every major upgrade, back up Postgres before upgrading (a
> rollback to v11 means restoring that backup), test in staging first, and
> upgrade step-by-step — 11 → 12, do not skip from older majors.

## OneUptime 10 → 11 업그레이드

<!-- TODO(i18n): Translate this section. English source: en/installation/upgrading.md (added for v11 SSO->Enterprise change). -->

### Identity features (SSO, OIDC, SCIM) now require the Enterprise Edition

In v11, the following authentication and access-management features moved to
the **OneUptime Enterprise Edition** and are no longer part of the free,
open-source (Community) build:

- **SAML SSO** — both project login and status-page login
- **OpenID Connect (OIDC)** — both project login and status-page login
- **SCIM user provisioning** — project and status page
- **Global (instance-wide) SSO / OIDC**
- **Team compliance settings**

**What you'll see after upgrading:** if you configured any of these on a
Community Edition build, the settings pages show an upgrade prompt instead of
the configuration form, and the configuration can no longer be changed. Until
the Community and Enterprise images were split, providers you had already
configured could keep signing users in on a Community build, because it still
contained the sign-in code. The Community image no longer contains any SSO,
OIDC or SCIM code, so sign-in through them stops once you upgrade to it — see
[Community and Enterprise Edition images](#community-and-enterprise-edition-images).
Your existing provider records are **preserved in the database** — nothing is
deleted — and they work again as soon as the instance runs the Enterprise
Edition.

**Availability:**

- **Self-hosted:** requires the **Enterprise Edition** build.
- **OneUptime Cloud:** requires the **Scale** plan (or above).

**If you rely on SSO and self-host**, email
[support@oneuptime.com](mailto:support@oneuptime.com) for an Enterprise Edition
license so you can restore SSO/OIDC/SCIM. Mention that you upgraded from v10 to
v11 and we'll help you get it back online. If your team is mid-upgrade and this
is blocking sign-in, contact us before upgrading production so we can plan it
with you.

OneUptime 11은 ClickHouse 텔레메트리 스토리지를 새로 구축합니다. 이 페이지에서는 무엇이 바뀌는지, 누가 조치해야 하는지, 그리고 과거 텔레메트리를 이어가려는 설치 환경을 위해 필요한 모든 쿼리를 설명합니다.

### v11에서 바뀌는 것

텔레메트리(로그, 트레이스, 메트릭, 예외, 프로파일, 모니터 로그, 감사 로그)는 시간 기반 파티셔닝, 열별 압축 코덱, 새로운 엔티티 모델 열을 갖춘 새 ClickHouse 테이블로 이동합니다:

| 기존 테이블           | 새 테이블             |
| --------------------- | --------------------- |
| `LogItemV2`           | `LogItemV3`           |
| `MetricItemV2`        | `MetricItemV3`        |
| `SpanItemV2`          | `SpanItemV3`          |
| `ExceptionItemV2`     | `ExceptionItemV3`     |
| `ProfileItemV2`       | `ProfileItemV3`       |
| `ProfileSampleItemV2` | `ProfileSampleItemV3` |
| `MonitorLogV2`        | `MonitorLogV3`        |
| `AuditLogV1`          | `AuditLogV2`          |

모든 텔레메트리 테이블에서 두 개의 열 이름이 변경됩니다: `serviceId` → `primaryEntityId`, `serviceType` → `primaryEntityType`. 이것은 엄격한 이름 변경입니다 — **OneUptime analytics API를 `serviceId`/`serviceType` 필터로 직접 쿼리하고 있다면 새 이름으로 업데이트하세요.** OneUptime 내부의 대시보드, 모니터, 알림은 자동으로 마이그레이션됩니다.

이 전환은 **전방 전용**입니다: 새 테이블은 비어 있는 상태로 시작하고, 업그레이드 이후 수집되는 모든 텔레메트리는 즉시 새 테이블에 들어가며, 이력은 시간이 지나면서 자연스럽게 채워집니다. 기존 테이블은 디스크 공간을 회수하기 위해 업그레이드 중에 **자동으로 삭제됩니다** — 이력을 이어갈 선택지를 남겨 두려면 업그레이드 **전에** 테이블 이름을 변경하세요(아래 Step 0).

> **이미 11.0.0 또는 11.0.1을 사용 중인가요?** 해당 릴리스에서는 기존 테이블이 유지되었습니다(TTL로 서서히 비워졌고, 복사는 "업그레이드 후 언제든지" 실행할 수 있었습니다). 이후의 모든 업데이트는 **시작 시 기존 테이블을 삭제합니다**. 이력 복사를 아직 하지 않았고 앞으로 하려 한다면, 업데이트를 적용하기 전에 아래 Step 0을 실행하세요.

### 누가 조치해야 하나

- **신규 설치:** 할 일이 없습니다.
- **업그레이드 이전 텔레메트리가 UI에 필요 없는 업그레이드:** 할 일이 없습니다. 텔레메트리 페이지는 업그레이드 시점 이후의 데이터만 표시하며, 기존 테이블은 업그레이드 중에 삭제됩니다.
- **업그레이드 이전 텔레메트리를 보고 싶은 업그레이드:** 업그레이드 **전에** 기존 테이블의 이름을 변경하고(아래 Step 0), 이후 언제든지 수동 복사를 실행하세요.

언제나처럼 메이저 버전은 단계별로 업그레이드하고(10 → 11, 건너뛰지 마세요), 업그레이드 전에 Postgres와 ClickHouse를 백업하세요.

### 선택 사항: 텔레메트리 이력 이어가기

Step 0은 **업그레이드 전에** 실행합니다. Step 1부터는 모두 **업그레이드가 완전히 부팅된 후에** 실행합니다(새 테이블과 해당 머티리얼라이즈드 뷰가 존재해야 합니다). ClickHouse 호스트에서 직접 접속하세요 — 네이티브 프로토콜에는 HTTP 타임아웃이 없으므로 몇 시간짜리 문장도 문제없습니다:

```bash
clickhouse-client --database oneuptime
```

시작하기 전에 알아 두면 좋은 것:

- 복사는 OneUptime이 운영 중인 상태에서도 안전하게 실행할 수 있습니다. 새 텔레메트리는 독립적으로 새 테이블에 기록되고, 복사된 이력은 그 뒤에서 채워집니다.
- 대규모(수백 GB)에서는 몇 시간이 걸릴 수 있습니다.
- 아래 모든 문장은 `insert_deduplication_token`을 가지며, 새 테이블에는 중복 제거 윈도우가 내장되어 있습니다 — 따라서 **중간에 실패한 문장을 다시 실행해도 안전합니다**(이미 삽입된 블록은 메트릭 롤업을 포함해 건너뜁니다). 단, 적당히 빨리 다시 실행해야 합니다. 라이브 수집이 많은 환경에서는 윈도우(테이블당 최근 10,000개의 insert 블록)가 결국 오래된 토큰을 밀어냅니다.
- 메트릭을 복사하면 사전 집계된 대시보드 롤업도 자동으로 재구축됩니다(복사된 각 행이 롤업 머티리얼라이즈드 뷰에 다시 공급됩니다) — 그래서 메트릭 복사는 다른 것보다 느립니다. 마지막에 실행하세요.

#### Step 0 — 업그레이드 전에 기존 테이블 이름 변경

업그레이드는 시작 시 기존 테이블을 삭제하므로, 복사 원본으로 쓸 테이블을 먼저 그 손이 닿지 않는 곳으로 옮기세요. OneUptime을 중지하고(디플로이먼트를 0으로 스케일) 아무것도 테이블에 쓰거나 다시 만들 수 없게 한 뒤 이름을 변경합니다 — `RENAME TABLE`은 즉각적인 메타데이터 작업이며, `IF EXISTS` 덕분에 설치 환경에 없던 테이블은 건너뜁니다(10.0.x 중반 이전의 디플로이먼트에는 `AuditLogV1`이나 일부 `…V2` 테이블이 없을 수 있습니다 — 그런 경우 복사할 해당 유형의 이력이 없는 것입니다):

```sql
RENAME TABLE IF EXISTS LogItemV2 TO LogItemV2_backup;
RENAME TABLE IF EXISTS MetricItemV2 TO MetricItemV2_backup;
RENAME TABLE IF EXISTS SpanItemV2 TO SpanItemV2_backup;
RENAME TABLE IF EXISTS ExceptionItemV2 TO ExceptionItemV2_backup;
RENAME TABLE IF EXISTS ProfileItemV2 TO ProfileItemV2_backup;
RENAME TABLE IF EXISTS ProfileSampleItemV2 TO ProfileSampleItemV2_backup;
RENAME TABLE IF EXISTS MonitorLogV2 TO MonitorLogV2_backup;
RENAME TABLE IF EXISTS AuditLogV1 TO AuditLogV1_backup;
RENAME TABLE IF EXISTS MetricItemAggMV1mByHost TO MetricItemAggMV1mByHost_backup;
```

그런 다음 업그레이드하고 계속하기 전에 OneUptime이 완전히 부팅될 때까지 기다리세요.

> 이름 변경 후 v10으로 롤백하는 경우(v10은 시작 시 기존 이름의 빈 테이블을 다시 만듭니다), v10을 재시작하기 전에 `_backup` 테이블을 원래 이름으로 되돌리세요 — 그러지 않으면 롤백 중에 수집된 텔레메트리가 다시 만들어진 테이블에 들어가고, 이후 업그레이드에서 삭제됩니다.

#### Step 1 — 원본 파티션 나열

각 기존 테이블의 파티션은 최대 16개입니다. 각 원본 테이블에 대해:

```sql
SELECT DISTINCT _partition_id FROM LogItemV2_backup ORDER BY _partition_id;
```

#### Step 2 — 복사 문장 생성

열 구성은 설치 환경마다 약간 다를 수 있으므로(오래된 디플로이먼트에는 최근 추가된 열이 없을 수 있음), 고정된 문장을 붙여 넣지 말고 실제 스키마에서 문장을 생성하세요. `WITH` 절의 `src`와 `dst`를 위 표의 테이블 쌍 중 하나로 설정하고(원본에는 Step 0의 `_backup` 접미사가 붙습니다) 실행합니다:

```sql
WITH 'LogItemV2_backup' AS src, 'LogItemV3' AS dst
SELECT concat(
  'INSERT INTO ', dst, ' (`', arrayStringConcat(groupArray(name), '`, `'), '`)',
  ' SELECT ', arrayStringConcat(groupArray(selectExpr), ', '),
  ' FROM ', src,
  ' WHERE _partition_id = ''{PARTITION}''',
  ' ORDER BY ', (SELECT sorting_key FROM system.tables WHERE database = currentDatabase() AND name = dst), ', _id',
  ' SETTINGS max_execution_time = 0, max_partitions_per_insert_block = 0, insert_deduplication_token = ''v3copy:', dst, ':{PARTITION}'', deduplicate_blocks_in_dependent_materialized_views = 1'
) AS copy_sql
FROM (
  SELECT name,
    multiIf(name = 'primaryEntityId', 'serviceId', name = 'primaryEntityType', 'serviceType', name) AS srcName,
    if(srcName = name, concat('`', name, '`'), concat('`', srcName, '` AS `', name, '`')) AS selectExpr,
    position
  FROM system.columns
  WHERE database = currentDatabase() AND table = dst
    AND srcName IN (SELECT name FROM system.columns WHERE database = currentDatabase() AND table = src)
  ORDER BY position
);
```

생성된 문장은 두 테이블이 공유하는 열만 복사하고(새 열은 기본값을 가짐), `serviceId`/`serviceType`을 즉석에서 이름 변경하며, 재실행 시 동일하고 중복 제거 가능한 블록이 생성되도록 행을 결정론적으로 정렬하고, 이 정도 규모의 문장에 필요한 실행 시간 및 파티션 수 제한을 해제합니다.

#### Step 3 — 한 번에 한 파티션씩 실행

생성된 문장에서 `{PARTITION}`(`WHERE`와 토큰에 두 번 등장)을 Step 1의 각 파티션 id로 치환하세요. 문장을 하나씩 실행한 뒤, 각 테이블 쌍에 대해 Step 1–3을 반복합니다.

> 참고: 원본 테이블이 설치 환경에 존재하지 않아 Step 0에서 건너뛰었다면, 해당 쌍의 Step 1은 `UNKNOWN_TABLE`로 실패합니다 — 그 쌍은 그냥 건너뛰세요. 복사할 해당 유형의 이력이 없습니다.

문장이 중간에 실패하면 **같은** 문장을 즉시 다시 실행하세요 — 이미 커밋된 블록은 중복 제거됩니다. 한참 후에 다시 실행한다면 먼저 행 수를 비교하세요(Step 5).

#### Step 4(선택) — 호스트별 메트릭 롤업 이력

복사된 원시 메트릭 행은 서비스 수준 롤업을 자동으로 재구축하지만, **호스트별** 롤업은 재구축하지 않습니다(기존 행에는 호스트 엔티티 키가 없음). Step 0에서 이름을 변경한 기존 롤업 테이블이 이 이력의 유일한 원본입니다. 호스트 이름에서 새 키를 계산해 이어가세요:

```sql
INSERT INTO MetricItemAggMV1mByHostV2 (projectId, name, hostEntityKey, bucketTime, valueSumState, valueCountState, valueMinState, valueMaxState, retentionDate)
SELECT
  projectId,
  name,
  substring(lower(hex(SHA256(concat(projectId, '|host|host.name=', lower(trimBoth(hostIdentifier)))))), 1, 16) AS hostEntityKey,
  bucketTime,
  valueSumState,
  valueCountState,
  valueMinState,
  valueMaxState,
  retentionDate
FROM MetricItemAggMV1mByHost_backup
ORDER BY projectId, name, hostIdentifier, bucketTime, _id
SETTINGS max_execution_time = 0, insert_deduplication_token = 'v3copy:MetricItemAggMV1mByHostV2:all';
```

`ORDER BY`가 중요합니다: 재실행 시 중복 제거 토큰이 인식할 수 있는 동일한 insert 블록을 생성합니다. 이것이 없으면 재실행이 조용히 건너뛰어지거나 이중으로 집계될 수 있습니다. (예외 사례: `\`, `|`, `=`가 포함된 호스트 이름 — RFC 1123에서 허용되지 않는 호스트 이름 문자 — 은 애플리케이션과 다른 키를 계산합니다. 그런 호스트가 있다는 것을 알지 못하는 한 무시하세요.)

#### Step 5 — 검증

테이블 쌍별로 합계를 비교하세요(새 테이블에는 업그레이드 이후의 행도 포함되므로 기존 테이블보다 크거나 같아야 합니다):

```sql
SELECT
  (SELECT count() FROM LogItemV2_backup) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### Step 6 — 백업 삭제

이름이 변경된 테이블은 보존 TTL을 유지하므로 스스로 비워지고 줄어듭니다 — 그러나 복사 결과에 만족했다면 즉시 디스크를 회수하도록 삭제하세요:

```sql
DROP TABLE IF EXISTS LogItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MetricItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS SpanItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ExceptionItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ProfileItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ProfileSampleItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MonitorLogV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS AuditLogV1_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MetricItemAggMV1mByHost_backup SETTINGS max_table_size_to_drop = 0;
```

(`max_table_size_to_drop = 0`은 해당 문장에 한해 서버의 50 GB 삭제 보호를 해제합니다.)

> 팁: 다른 모든 메이저 업그레이드와 마찬가지로, 먼저 스테이징 환경에서 테스트하고 프로덕션에서 복사본에 의존하기 전에 텔레메트리가 새 테이블로 흘러 들어가는지 확인하세요.

## OneUptime 9 → 10 업그레이드

수동 조치가 필요한 변경 사항은 없습니다. 표준 업그레이드 절차를 따르기만 하면 됩니다.

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
