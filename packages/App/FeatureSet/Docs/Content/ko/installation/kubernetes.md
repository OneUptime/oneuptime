# Kubernetes 및 Helm

Helm 차트로 자체 Kubernetes 클러스터에서 OneUptime을 실행합니다. 이 페이지는 OneUptime 서버가 직접 제공하므로 인터넷에 연결되지 않아도 열리며, 실행 중인 버전의 차트를 설명합니다. 차트가 받는 모든 값은 [Artifact Hub](https://artifacthub.io/packages/helm/oneuptime/oneuptime)에 있는 차트 자체 문서에 나와 있습니다.

:::cards
- [차트 설치하기](#차트-설치하기): 값 파일 하나와 명령 두 개.
- [데이터 백업하기](#데이터-백업하기): PostgreSQL과 ClickHouse를 클러스터 밖의 스토리지로.
- [키 보관하기](#키-보관하기): 이것이 없으면 백업을 읽을 수 없습니다.
:::

## 차트 설치하기

사용자가 쓸 도메인 이름이나 IP 주소를 `http://` 없이 적은 `values.yaml`을 만듭니다:

```yaml title="values.yaml"
host: oneuptime.example.com
```

그다음 차트를 설치합니다:

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime -f values.yaml
```

**제대로 되었다면** `kubectl get pods`가 모든 파드를 `Running`으로 보여 주고, 그 주소에서 OneUptime이 열립니다. 그다음은 [자체 호스팅 가이드](/docs/installation/self-hosting-guide)에서 이어집니다: HTTPS, 관리자 계정, 그리고 이메일, SMS, 전화.

## 데이터 백업하기

OneUptime은 클러스터의 영구 볼륨에 데이터를 보관합니다. PostgreSQL에는 프로젝트, 모니터, 인시던트, 상태 페이지, 사용자가, ClickHouse에는 로그, 트레이스, 메트릭이 들어 있습니다. 다음 방법 중 하나로 두 가지 모두를 클러스터 밖의 스토리지에 백업하세요:

- **엔터프라이즈 에디션의 예약 백업.** Admin Dashboard의 **설정 > 백업**에서 설정합니다. [백업](/docs/installation/backups)을 참고하세요.
- **클라우드 제공업체의 영구 볼륨 백업**. 예를 들어 PostgreSQL과 ClickHouse 디스크의 예약 스냅샷입니다.
- **CloudNativePG의 볼륨 스냅샷 백업**. PostgreSQL이 CloudNativePG 오퍼레이터에서 실행될 때 사용할 수 있습니다. `values.yaml`에서 켠 다음 변경 사항을 적용합니다:

```yaml title="values.yaml"
postgresOperator:
  cnpg:
    enabled: true
    backup:
      enabled: true
      schedule: "0 0 3 * * *"
```

```bash
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

이 일정으로 PostgreSQL이 매일 03:00에 백업됩니다. CloudNativePG는 오래된 볼륨 스냅샷을 지우지 않으므로, 더 이상 필요 없는 스냅샷은 직접 지우세요.

OneUptime은 OneUptime 밖에서 만든 백업을 볼 수 없습니다. 백업이 실행되기 시작하면 Admin Dashboard의 **서버 설정** 페이지에서 백업 항목의 **이 서버는 백업되고 있습니다**를 클릭하세요.

## 키 보관하기

OneUptime이 암호화한 것은 암호화에 쓴 `encryptionSecret`으로만 읽을 수 있습니다. 업그레이드가 바꾸지 않도록 `oneuptimeSecret`과 `encryptionSecret`을 `values.yaml`에 직접 설정하고, 사본을 백업과 함께 클러스터 밖에 보관하세요:

```yaml title="values.yaml"
oneuptimeSecret: <random string>
encryptionSecret: <random string>
```

## 다음 단계

:::cards
- [자체 호스팅 가이드](/docs/installation/self-hosting-guide): 빈 클러스터에서 호출을 보내는 서버까지.
- [업그레이드](/docs/installation/upgrading): 업그레이드할 때마다 먼저 백업합니다.
- [백업](/docs/installation/backups): 엔터프라이즈 에디션의 예약 백업.
:::
