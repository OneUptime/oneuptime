# 사용자 지정 프로브

사용자 지정 프로브는 자체 네트워크 안에서 실행하는 작은 에이전트입니다. 프로브를 추가한 모니터(내부 웹사이트, API, 방화벽 뒤의 서버 등)를 확인하고 결과를 OneUptime에 보냅니다. HTTPS로 나가는 연결만 열기 때문에 네트워크 안의 어떤 것도 인터넷에서 오는 연결을 받을 필요가 없습니다.

:::cards
- [작동 방식](#작동-방식): 프로브가 하는 일과 OneUptime이 프로브가 실행 중임을 아는 방법.
- [프로브 설치](#프로브-설치): OneUptime에서 만들고, Docker, Docker Compose 또는 Kubernetes로 실행한 뒤 모니터에 추가합니다.
- [환경 변수](#환경-변수): 프로브가 읽는 모든 설정과 기본값.
- [연결이 끊긴 프로브 진단](#연결이-끊긴-프로브-진단): 프로브가 OneUptime에 보내는 요청이 어디서 멈추는지 찾습니다.
:::

## 작동 방식

```mermaid title="사용자 지정 프로브가 하는 일"
sequenceDiagram
    participant P as 사용자 지정 프로브
    participant O as OneUptime
    P->>O: 실행 중입니다<br/>(1분마다)
    P->>O: 내 모니터 중<br/>확인할 차례인 것은?
    O-->>P: 확인할 모니터
    Note over P: 네트워크에서<br/>각각 확인
    P->>O: 결과 전송
    Note over O: 상태를 갱신하고<br/>인시던트나 알림을 엽니다
```

- **프로브는 바깥으로 연결합니다.** 모든 요청은 프로브에서 `ONEUPTIME_URL`(으)로 HTTPS를 통해 갑니다. 네트워크 밖에서 프로브에 닿아야 하는 것은 없습니다.
- **자신의 모니터만 확인합니다.** 프로브는 자신이 추가된 모니터를 OneUptime에 묻고, 차례가 된 모니터를 각각 확인한 뒤 결과를 돌려보냅니다. 모니터의 상태가 바뀌는지는 OneUptime이 결과를 바탕으로 판단합니다.
- **OneUptime은 프로브가 실행 중인지 지켜봅니다.** 프로브의 모든 요청은 살아 있다는 신호로 간주되며, 프로브는 최소 1분에 한 번 요청을 보냅니다. 약 3분 동안 아무 요청도 없으면 프로브는 **연결 끊김** 으로 표시되고 소유자에게 알림이 갑니다. 소유자가 없는 프로브는 프로젝트 소유자에게 알립니다.

## 시작하기 전에

- **OneUptime Cloud에서는 Growth 요금제.** 프로브를 만들려면 필요합니다. 자체 호스팅 설치에는 요금제 제한이 없습니다.
- **프로브를 만들 권한.** 프로젝트 소유자, 관리자, 구성원에게 있으며, 역할이 프로브 생성을 허용하는 사람에게도 있습니다.
- **모니터링할 네트워크 안의 머신.** Docker, Docker Compose 또는 Kubernetes, 프로브가 확인할 서비스까지의 경로, 그리고 `ONEUPTIME_URL`(으)로 나가는 HTTPS가 필요합니다.

## 프로브 설치

:::steps
### 프로브 만들기

**모니터 → 설정 → 프로브** 를 열고 **프로브 만들기** 를 클릭합니다. **이름** 과 **설명** 을 입력하세요. 둘 다 필수입니다. **추가 필드** 에는 **프로브 로고** , 새로 만드는 모든 모니터에 이 프로브를 선택하는 **새 모니터에서 자동으로 모니터링 활성화** , 그리고 **레이블** 이 있습니다.

### ID와 키 복사

프로브는 연결하려면 ID와 키가 필요합니다. 복사하려면 **사용자 지정 프로브** 표에서 프로브의 메뉴를 열고 **ID 및 키 표시** 를 선택합니다. 표를 볼 수 있는 사람은 누구나 프로브의 ID를 복사할 수 있지만, 키는 프로젝트 소유자와 관리자에게만 표시됩니다. 이들에게는 **ID 및 키 표시** 가 보이고, 다른 사람에게는 **ID 표시** 가 보입니다.

프로젝트 소유자와 관리자는 프로브를 클릭할 수도 있습니다. 해당 페이지의 **Set up your Custom Probe** 카드에 ID와 키가 이미 채워진 Docker 명령이 표시됩니다.

### 프로브 실행

선택한 머신에서 프로브의 ID와 키로 실행합니다. OneUptime을 직접 호스팅한다면 `ONEUPTIME_URL`을 `https://oneuptime.com` 대신 설치 URL로 설정하세요.

:::tabs
@tab Docker
```bash
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -d oneuptime/probe:release
```
@tab Docker Compose
```yaml title="docker-compose.yml"
services:
  oneuptime-probe:
    image: oneuptime/probe:release
    container_name: oneuptime-probe
    environment:
      - PROBE_KEY=<probe-key>
      - PROBE_ID=<probe-id>
      - ONEUPTIME_URL=https://oneuptime.com
    network_mode: host
    restart: always
```

그런 다음 `docker compose up -d`(으)로 시작합니다.
@tab Kubernetes
```yaml title="oneuptime-probe.yaml"
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-probe
spec:
  selector:
    matchLabels:
      app: oneuptime-probe
  template:
    metadata:
      labels:
        app: oneuptime-probe
    spec:
      containers:
        - name: oneuptime-probe
          image: oneuptime/probe:release
          env:
            - name: PROBE_KEY
              value: "<probe-key>"
            - name: PROBE_ID
              value: "<probe-id>"
            - name: ONEUPTIME_URL
              value: "https://oneuptime.com"
```

그런 다음 `kubectl apply -f oneuptime-probe.yaml`(으)로 적용합니다.
:::

호스트 네트워킹(`--network host`, `network_mode: host`)을 쓰면 프로브가 IPv6를 포함한 호스트 자체의 네트워크를 사용합니다. 호스트 네트워킹 없이 실행하기 전에 [IPv6 대상 모니터링](#ipv6-대상-모니터링)을 읽어 보세요.

### 연결 확인

1~2분 안에 **사용자 지정 프로브** 표에서 프로브의 **상태** 가 **연결됨** 으로 바뀝니다. 계속 **연결 끊김** 이면 프로브 로그에 이유가 나옵니다. [연결이 끊긴 프로브 진단](#연결이-끊긴-프로브-진단)을 참조하세요.

### 프로브로 모니터 확인하기

프로브는 자신이 추가된 모니터만 확인합니다. 새 모니터는 **모니터 생성** 의 **프로브 및 간격** 단계에서 프로브를 고릅니다. 기존 모니터는 모니터를 열고 **구성 → 프로브 및 간격** 으로 이동합니다. 이 페이지에는 카드가 세 개 있습니다.

- **모니터링 간격** : 모니터의 각 프로브가 얼마나 자주 확인하는지. 간격을 고르면 바로 저장됩니다. 합성, Custom Code, SSL 인증서 모니터에는 5분 이상의 간격이 제시되며, 이미 더 짧은 간격이나 API로 설정한 일정을 쓰는 모니터는 그 값을 유지하고 목록에 표시합니다.
- **프로브** : **프로브 추가** 를 클릭하고 사용자 지정 프로브를 고릅니다. 프로브가 이 모니터를 더 이상 확인하지 않게 하려면 행의 메뉴에서 **편집** 으로 끄거나 행을 삭제합니다.
- **프로브 합의** : 상태가 바뀌기 전에 모니터의 프로브 중 몇 개가 같은 결과를 봐야 하는지. "... 프로브가 동의하면 이 모니터의 상태 변경"이라는 문장에 입력합니다. 모든 프로브로 하려면 상자를 비워 두세요. 켜져 있고 연결된 프로브만 참여하므로, 그보다 큰 숫자도 모두를 뜻합니다. 숫자는 상자를 벗어나거나 **Enter** 를 누르면 저장됩니다.

프로브가 확인하지 않는 모니터(수동, 수신 요청, 수신 이메일, 서버, 네트워크 장치, 텔레메트리 모니터)에는 프로브 및 간격 페이지가 없습니다.
:::

> [!TIP]
> `http://10.0.0.5/health` 같은 사설 주소를 확인해야 하는 프로브에는 `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true`가 필요합니다. 허용하기 전까지 프로브는 사설 주소를 거부합니다. [프라이빗 네트워크 접근](/docs/self-hosted/private-network-access)을 참조하세요.

## 프록시를 통해 연결

프로브가 OneUptime이나 확인하는 사이트에 닿으려면 프록시를 거쳐야 한다면, 프록시 주소를 알려 주세요.

| 변수 | 하는 일 |
| --- | --- |
| `HTTPS_PROXY_URL` | OneUptime 자체와 대부분의 사이트를 포함한 HTTPS 주소용 프록시. |
| `HTTP_PROXY_URL` | 일반 HTTP 주소용 프록시. |
| `NO_PROXY` | 프로브가 직접 연결하는 호스트로, 쉼표로 구분합니다. |

프록시 주소는 `http://proxy.example.com:8080`처럼 쓰고, 사용자 이름과 비밀번호를 요구하면 `http://username:password@proxy.example.com:8080`처럼 씁니다. 대부분의 프록시는 두 종류의 주소를 모두 처리하므로 두 변수를 같은 URL로 설정하세요.

:::tabs
@tab Docker
```bash
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTP_PROXY_URL=http://proxy.example.com:8080 \
  -e HTTPS_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release
```
@tab Docker Compose
```yaml title="docker-compose.yml"
services:
  oneuptime-probe:
    image: oneuptime/probe:release
    container_name: oneuptime-probe
    environment:
      - PROBE_KEY=<probe-key>
      - PROBE_ID=<probe-id>
      - ONEUPTIME_URL=https://oneuptime.com
      - HTTP_PROXY_URL=http://proxy.example.com:8080
      - HTTPS_PROXY_URL=http://proxy.example.com:8080
      - NO_PROXY=localhost,.internal.example.com
    network_mode: host
    restart: always
```
@tab Kubernetes
```yaml title="oneuptime-probe.yaml"
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-probe
spec:
  selector:
    matchLabels:
      app: oneuptime-probe
  template:
    metadata:
      labels:
        app: oneuptime-probe
    spec:
      containers:
        - name: oneuptime-probe
          image: oneuptime/probe:release
          env:
            - name: PROBE_KEY
              value: "<probe-key>"
            - name: PROBE_ID
              value: "<probe-id>"
            - name: ONEUPTIME_URL
              value: "https://oneuptime.com"
            - name: HTTP_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: HTTPS_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: NO_PROXY
              value: "localhost,.internal.example.com"
```
:::

프록시를 거치는 것:

- **프로브가 OneUptime에 보내는 자체 요청.**
- **모니터의 HTTP 확인** : Website, API, External Status Page, Custom Code, SSL 인증서, 합성, 도메인 모니터. SSL 인증서와 합성 모니터는 `HTTPS_PROXY_URL`을 쓰고, 그것만 설정되어 있으면 `HTTP_PROXY_URL`을 씁니다.
- **그 밖의 확인은 거치지 않습니다.** Ping, Port, DNS, SNMP 등 HTTP가 아닌 확인은 직접 연결합니다.

`NO_PROXY` 항목은 호스트 이름(`api.internal`), 그 아래 모든 이름을 뜻하도록 앞에 점이나 `*.`를 붙인 도메인(`.internal.example.com`), 둘 중 하나에 `:port`를 붙인 것, 또는 모든 것을 뜻하는 `*`입니다. IP 범위는 읽지 않으므로 주소를 하나씩 나열하세요. 소문자 이름 `http_proxy`, `https_proxy`, `no_proxy`와 `HTTP_PROXY`, `HTTPS_PROXY`도 작동합니다.

## IPv6 대상 모니터링

프로브는 자신의 네트워크에 IPv6가 있을 때만 IPv6 대상을 모니터링할 수 있습니다.

- **`--network host`를 쓴 Docker, 또는 `network_mode: host`를 쓴 Compose** (위의 구성): 프로브가 호스트의 네트워크를 공유하므로, 호스트에 IPv6가 있을 때에만 IPv6가 있습니다.
- **Docker 브리지 네트워크** (호스트 네트워킹 없이 얻는 것): 그 네트워크에 IPv6를 켜지 않는 한 IPv6가 없습니다(아래 참조).
- **Kubernetes** : 듀얼 스택 또는 IPv6 전용 클러스터에서만 Pod에 IPv6가 있습니다.

확인하려면 프로브 안에서 공개 IPv6 주소로 ping을 보냅니다.

:::tabs
@tab Docker
```bash
docker exec oneuptime-probe ping -6 -c 1 2001:4860:4860::8888
```
@tab Kubernetes
```bash
kubectl exec deploy/oneuptime-probe -- ping -6 -c 1 2001:4860:4860::8888
```
:::

`1 received`는 프로브가 IPv6 대상에 닿을 수 있다는 뜻입니다. 프로브에 쓸 수 있는 IPv6가 없으면 `ping`은 바로 실패하고, 오류가 그 이유를 알려 줍니다.

| 오류 | 의미 |
| --- | --- |
| `Network is unreachable` | 프로브의 네트워크에 IPv6 경로가 없습니다. IPv6가 없는 Docker 브리지 네트워크, IPv4 전용 Kubernetes 클러스터, 또는 IPv6 연결이 없는 호스트입니다. |
| `Cannot assign requested address` | 프로브의 네트워크 네임스페이스에서 IPv6가 꺼져 있습니다. `net.ipv6.conf.all.disable_ipv6`와 `net.ipv6.conf.lo.disable_ipv6`를 확인하세요. 프로브 안에서 `cat /proc/sys/net/ipv6/conf/all/disable_ipv6`를 실행하면 꺼져 있을 때 `1`이 출력됩니다. 호스트 네트워킹에서는 이것이 호스트의 설정입니다. |
| `Address family not supported by protocol` | 커널이 `ipv6.disable=1`로 부팅되어 머신에 IPv6가 전혀 없습니다. 커널 명령줄에서 제거하고 재부팅하거나, 다른 머신에서 프로브를 실행하세요. |

어느 경우든 대상에는 아무것도 보내지지 않았으므로, 프로브는 대상이 작동 중인지 알 수 없습니다. 확인은 그래도 실패하지만, Ping 모니터의 실패 이유는 대상이 응답하지 않았다고 하는 대신 프로브를 지목합니다.

```text
This probe cannot send IPv6 traffic (ping6: connect: Cannot assign requested address), so 2001:db8::1 was never contacted. The probe has no usable IPv6 address or route; this says nothing about whether 2001:db8::1 is up. Monitor IPv6 destinations from a probe that has IPv6 connectivity.
```

실패와 함께 기록되는 네트워크 경로에는 `Traceroute could not run: this probe cannot send IPv6 traffic (...)`라고 나옵니다. 프로브의 네트워크를 고치거나, IPv6가 있는 프로브로 모니터를 옮기세요.

### 호스트 네트워킹 없는 IPv6

호스트 네트워킹을 쓸 수 없다면, IPv6를 켠 Docker 네트워크에 프로브를 연결하세요. 호스트 자체에는 여전히 IPv6가 필요합니다.

```bash
docker network create --ipv6 oneuptime-probe-ipv6
docker run --name oneuptime-probe --network oneuptime-probe-ipv6 -e PROBE_KEY=<probe-key> -e PROBE_ID=<probe-id> -e ONEUPTIME_URL=https://oneuptime.com -d oneuptime/probe:release
```

Docker Engine 27 이상은 네트워크에 쓸 IPv6 서브넷을 고르고, 프로브의 나가는 IPv6를 호스트 주소 뒤로 마스커레이드합니다. 그보다 오래된 버전에는 명시적인 IPv6 서브넷(예: `docker network create --ipv6 --subnet fd00:0:0:1::/64 oneuptime-probe-ipv6`)과 `/etc/docker/daemon.json`의 `"ip6tables": true` 및 `"experimental": true`가 필요합니다. Docker Compose에서는 `network_mode: host`를 제거하고 프로브의 네트워크에 `enable_ipv6: true`를 설정합니다.

## 검색 스캔의 NetBIOS 이름 조회

**Windows 이름 조회(NetBIOS)** 를 켠 [네트워크 검색 스캔](/docs/monitor/network-device-monitor)은 SNMP 시스템 이름이 없는 모든 호스트에 프로브에서 NetBIOS 이름 조회(NBSTAT)를 보냅니다. 이를 사용하는 스캔에서는 다음 트래픽을 허용하세요.

- **조회 대상 호스트:** SNMP 시스템 이름도 역방향 DNS 이름(PTR)도 없는 검색된 호스트로, 사설 주소(`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)나 캐리어급 NAT 주소(`100.64.0.0/10`)에 있는 것만 해당합니다. 공개 주소는 조회하지 않으며, 프로브에서 한 역방향 DNS 조회로 이름을 얻은 호스트에도 조회를 보내지 않습니다. 조회가 실패했거나, 시간이 초과됐거나, 조회 시간 예산이 바닥나 건너뛴 호스트는 PTR 레코드가 있어도 조회될 수 있습니다.
- **나가는 트래픽:** 프로브의 임시(무작위, 높은 번호) 원본 포트 하나에서 해당 호스트의 UDP 포트 137로 가는 UDP. 위의 프록시 설정은 적용되지 않습니다.
- **들어오는 트래픽:** 각 호스트의 UDP 포트 137에서 그 임시 포트로 돌아오는 응답. 상태 저장 방화벽은 자동으로 허용합니다. 응답이 없으면 호스트는 계속 IP 주소로 표시됩니다.

이 조회에는 추가 컨테이너 capability가 필요 없으며 Kubernetes Pod 네트워킹에서도 작동합니다. 스캔당 최대 2,000개 호스트를 조회하고(`PROBE_DISCOVERY_NETBIOS_MAX_HOSTS`로 4,000까지 늘릴 수 있음), 응답 없는 호스트마다 조회를 한 번 더 보내며, 조회를 초당 약 100개로 나누어 보내고, 그 작업량에 맞춘 시간 제한에서 멈춥니다 - 호스트 2,000개를 전부 조회하면 약 54초이며, 어떤 경우에도 2분을 넘지 않습니다. 글로벌 프로브는 스캔 설정과 관계없이 NetBIOS 조회를 보내지 않으므로, NetBIOS 이름이 필요한 스캔은 사용자 지정 프로브에서 실행하세요. 이 옵션은 새 스캔에서 켜져 있습니다. 많은 호스트에 대한 NBSTAT 조회는 침입 탐지 규칙에 걸릴 수 있으므로, 그것이 문제가 되는 네트워크의 스캔에서는 끄거나 먼저 보안 팀에 알리세요.

## 환경 변수

프로브는 시작할 때 환경에서 설정을 읽습니다. 설정을 바꾼 뒤에는 프로브를 다시 시작하세요. 프로브가 읽을 수 없는 숫자나 변수가 허용하는 범위를 벗어난 숫자는 무시되고 기본값이 쓰입니다. 패킷 캡처 한도만은 대신 범위 안으로 맞춰집니다.

### 필수

| 변수 | 내용 |
| --- | --- |
| `PROBE_KEY` | **ID 및 키 표시** 에서 얻는 프로브의 키. 없으면 프로브가 시작할 때 멈춥니다. |
| `PROBE_ID` | **ID 및 키 표시** 에서 얻는 프로브의 ID. 없으면 프로브가 시작할 때 멈춥니다. |
| `ONEUPTIME_URL` | OneUptime의 위치: `https://oneuptime.com` 또는 자체 설치의 URL. 없으면 프로브가 시작할 때 멈춥니다. |

### 모니터 확인

| 변수 | 기본값 | 하는 일 |
| --- | --- | --- |
| `PROBE_MONITORING_WORKERS` | `1` | 프로브가 동시에 확인하는 모니터 묶음의 수. |
| `PROBE_MONITOR_FETCH_LIMIT` | `10` | 한 묶음에 들어가는 모니터의 수. |
| `PROBE_MONITOR_RETRY_LIMIT` | `3` | 실패한 모니터 확인의 첫 시도 뒤 재시도 횟수로, 단계가 자체 횟수를 정하지 않을 때 쓰이며 최대 4번 시도합니다. `0`이면 재시도를 끕니다. |
| `PROBE_MONITOR_CHECK_TIMEOUT_IN_MS` | `900000` | 모니터 하나를 확인하는 기한으로, 지나면 확인을 포기하고 다음 주기에 다시 시도합니다. 합성 스크립트 제한 시간을 늘리면 기본값도 늘어나므로 스크립트가 중간에 끊기지 않습니다. |
| `PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS` | `60000` | 합성 모니터 스크립트의 제한 시간(밀리초). |
| `PROBE_SYNTHETIC_MONITOR_CHROMIUM_SANDBOX_ENABLED` | `false` | `true`로 설정하면 합성 모니터의 Chromium을 자체 샌드박스 안에서 실행합니다. 프로브의 컨테이너가 Playwright의 프로필처럼 샌드박스를 허용하는 seccomp 프로필로 실행될 때만 켜세요. 그런 프로필이 없으면 Chromium이 시작되지 않습니다. 꺼져 있는 동안에는 프로브가 시작할 때 경고를 로그에 남깁니다. |
| `PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS` | `60000` | Custom Code 모니터 스크립트의 제한 시간(밀리초). |
| `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS` | `false` | `true`로 설정하면 이 프로브의 Website, API, External Status Page, Custom Code 모니터가 사설 주소에 닿을 수 있습니다. [프라이빗 네트워크 접근](/docs/self-hosted/private-network-access)을 참조하세요. |
| `PROBE_NETWORK_DEVICE_POLL_CONCURRENCY` | `25` | 프로브가 한 번에 폴링하는 네트워크 장치의 수. 많은 장치를 폴링하는 프로브라면 값을 높이세요. |

합성 모니터가 실행되는 한도(동시에 실행되는 수, 메모리, 디스크)는 [합성 모니터](/docs/monitor/synthetic-monitor) 페이지에 있습니다.

### OneUptime과의 통신

| 변수 | 기본값 | 하는 일 |
| --- | --- | --- |
| `HTTP_PROXY_URL`, `HTTPS_PROXY_URL`, `NO_PROXY` | 없음 | 프록시 설정. [프록시를 통해 연결](#프록시를-통해-연결)을 참조하세요. |
| `PROBE_API_REQUEST_TIMEOUT_IN_MS` | `45000` | 프로브가 OneUptime에 보내는 각 요청의 기한. |
| `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` | `10000` | OneUptime에 보낸 요청이 이보다 느리면 경고를 기록합니다. |

### 네트워크 검색

| 변수 | 기본값 | 하는 일 |
| --- | --- | --- |
| `PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS` | `5400000` (90분) | 네트워크 검색 스윕 한 번의 기한으로, 지나면 포기하고 스캔을 실패로 보고합니다. |
| `PROBE_DISCOVERY_PROGRESS_INTERVAL_IN_MS` | `30000` | 실행 중인 검색 스윕이 지금까지 찾은 호스트를 올리는 주기로, 긴 스캔도 진행 상황을 보여 주고 끝나기 전에 장치를 가져올 수 있습니다. 최소 `5000`. |
| `PROBE_DISCOVERY_SCAN_CONCURRENCY` | `0` | 검색 스윕이 동시에 살펴보는 주소의 고정된 수. 설정하지 않으면(또는 `0`) 스캔 대상에 맞춰 정해지며, 프로브 컨테이너가 아주 작거나 아주 크지 않다면 이것이 원하는 설정입니다. |
| `PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS` | `0` | 스윕이 찾은 호스트의 역방향 DNS 이름(PTR)을 조회하는 시간 제한(밀리초). 아래를 참조하세요. |
| `PROBE_DISCOVERY_NETBIOS_MAX_HOSTS` | `0` | 스캔 한 번의 NetBIOS 조회가 물어볼 수 있는 호스트 수. 아래를 참조하세요. |
| `PROBE_DISCOVERY_MAX_CONCURRENT_SCANS` | `4` | 이 프로브에서 동시에 실행되는 독립적인 검색 스캔의 최대 수로, 1부터 16까지입니다. 아래를 참조하세요. |

`PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS` : 설정하지 않으면(또는 `0`) 제한이 호스트 수에 맞춰 정해집니다. 약 860개 호스트까지는 60초이고, 늘어나서 최대 10분입니다. 1000부터 1200000까지 설정할 수 있습니다. 조회가 제시간에 닿지 못한 호스트는 역방향 DNS 이름을 얻지 못하고(SNMP나 NetBIOS가 이름을 주지 않으면 IP 주소로 표시됨), 스캔의 상태 메시지에 놓친 수가 나옵니다. 시간이 초과되거나 실패한 조회는 제한이 남아 있는 동안 한 번 다시 시도하며, 프로브의 네임서버에 차례로 묻습니다. 느린 DNS 서버 뒤의 큰 네트워크라면 값을 늘리세요.

`PROBE_DISCOVERY_NETBIOS_MAX_HOSTS` : NetBIOS 이름을 켠 스캔에서는 SNMP 시스템 이름이 없는 모든 호스트를 조회하며, 역방향 DNS 이름이 없는 호스트를 먼저 조회합니다. 설정하지 않으면(또는 `0`) 기본 상한 2,000을 유지하며, 1부터 4000까지 설정할 수 있습니다. 상한을 넘은 호스트는 조회하지 않고, 스캔의 상태 메시지에 그 수가 나옵니다. 값을 늘리면 조회 시간도 길어지고(시간 제한이 이 값으로 정해져 4,000개 호스트에서 약 104초), 네트워크에 NBSTAT 데이터그램도 늘어나 침입 탐지 규칙이 주목합니다.

`PROBE_DISCOVERY_MAX_CONCURRENT_SCANS` : 여유가 있는 동안 프로브는 매분 대기 중인 다른 스캔을 확인하므로, 긴 스캔이 다른 모든 스캔을 막지 않습니다. 모든 자리가 차 있으면 추가 스캔은 자리가 날 때까지 대기합니다. 스캔마다 자체 호스트 동시성이 있으므로 자원 사용량은 두 설정 모두에 따라 늘어납니다. 작은 컨테이너에서는 둘 중 한 한도를 낮추세요. 1로 설정하면 스캔을 하나씩 차례로 실행합니다.

동시 검색을 쓰도록 사용자 지정 프로브를 업그레이드하기 전에 OneUptime 서버를 업그레이드하세요. 서버가 프로브가 아직 실행 중인 스캔을 제외할 수 있어야 실행 중인 스캔을 편집할 때 새 구성이 안전하게 대기열에 들어갑니다. 업데이트된 프로브를 이전 서버에 연결할 때는 서버를 업그레이드할 때까지 `PROBE_DISCOVERY_MAX_CONCURRENT_SCANS=1`을 설정하세요.

### 패킷 캡처

| 변수 | 기본값 | 하는 일 |
| --- | --- | --- |
| `PROBE_PACKET_CAPTURE_ENABLED` | 꺼짐 | `true`로 설정하면 권한이 있는 사람이 대시보드에서 이 프로브의 패킷 캡처를 시작할 수 있습니다. 캡처에는 호스트 네트워킹과 `NET_RAW` capability도 필요합니다. [패킷 캡처](/docs/probe/packet-capture)를 참조하세요. |
| `PROBE_PACKET_CAPTURE_MAX_DURATION_IN_SECONDS` | `1800` | 이 프로브가 실행하는 가장 긴 패킷 캡처로, 5부터 1800까지입니다. |
| `PROBE_PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB` | `25` | 이 프로브가 만드는 가장 큰 캡처 파일로, 1부터 25까지입니다. |

### 프로브가 수신 대기하는 것

리스너를 켜거나 기본적으로 켜진 리스너를 그대로 두지 않는 한, 프로브는 나가는 연결만 만듭니다.

| 리스너 | 설정 | 기본값 | 자세히 |
| --- | --- | --- | --- |
| 수신 요청과 하트비트 | `PROBE_INGRESS_PORT` | 꺼짐 | [수신 요청 Ingress](/docs/probe/incoming-request-ingress) |
| SNMP 트랩 | `PROBE_SNMP_TRAP_RECEIVER_ENABLED` | 켜짐, UDP 162 | [네트워크 장치 모니터](/docs/monitor/network-device-monitor) |
| Syslog | `PROBE_SYSLOG_RECEIVER_ENABLED` | 꺼짐, UDP 5140 | [네트워크 공급업체별 가이드](/docs/monitor/network-vendor-guides) |
| NetFlow, IPFIX, sFlow | `PROBE_NETFLOW_RECEIVER_ENABLED` | 켜짐, UDP 2055, 4739, 6343 | [네트워크 트래픽](/docs/monitor/network-traffic) |
| 상태 확인 | `PORT` | 켜짐, TCP 3874 | `/status/live` 및 `/status/ready` |

컨테이너 안에서는 호스트 네트워킹을 쓰거나 포트를 게시해야만 다른 머신에서 그 포트에 닿을 수 있습니다.

Syslog 수신기는 1분에 최대 `PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE`개(기본값 `600`)의 메시지를 전달하고, 나머지는 버리며, 버린 개수를 로그에 남깁니다.

`PROBE_NAME`과 `PROBE_DESCRIPTION`은 `REGISTER_PROBE_KEY`로 스스로를 등록하는 프로브(자체 호스팅 설치가 모든 프로젝트를 위해 실행하는 프로브 등)만 읽습니다. 사용자 지정 프로브는 이름과 설명을 대시보드에서 가져옵니다.

## 문제 해결

### 연결이 끊긴 프로브 진단

프로브가 OneUptime에 보내는 요청이 성공하지 않게 되면 프로브는 `Disconnected`로 표시됩니다. 실패한 각 요청이 어디서 멈췄는지 프로브 로그에 나오므로 추측할 일은 거의 없습니다.

:::steps
#### 시작할 때 출력되는 환경 블록 읽기

모든 프로브는 시작할 때 JSON 블록 하나를 출력합니다. 사용 중인 OneUptime URL, 요청 기한, 프록시 설정, 물려받은 DNS 리졸버, Node와 OS 버전, TLS 검증이 꺼져 있는지 여부가 들어 있습니다. 문제를 보고할 때마다 이 블록을 함께 보내 주세요.

#### 실패 보고서 찾기

OneUptime에 보낸 요청이 실패할 때마다 `stalledAt`과 `whatThisMeans`가 담긴 블록이 기록됩니다. `stalledAt`은 요청이 끝내 넘지 못한 단계입니다.

| `stalledAt` | 의미 |
| --- | --- |
| `SocketAssignment` | 머신에서 아무것도 나가지 않았습니다. 소켓 풀이 가득 찼거나, 설정된 프록시가 CONNECT 터널을 완성하지 못했습니다. |
| `TcpConnect` | 머신이 SYN을 보냈지만 아무것도 돌아오지 않았습니다. 방화벽이나 보안 장비가 패킷을 버리고 있거나, 호스트에 닿을 수 없습니다. |
| `TlsHandshake` | TCP는 연결됐지만 TLS가 끝나지 않았습니다. 대개 TLS를 검사하는 중간 장비 때문입니다. |
| `RequestSend` | 연결은 됐지만 요청이 끝까지 쓰이지 않았습니다. 상대편이 읽기를 멈췄습니다. |
| `WaitingForServerResponse` | 요청은 전달됐지만 서버가 아무것도 보내지 않았습니다. **프로브의 네트워크는 정상입니다** . OneUptime 서버, 로드 밸런서, 리버스 프록시를 확인하세요. |
| `ResponseBody` | 서버가 응답을 시작했다가 중간에 멈췄습니다. |
| `Unknown` | 프로브가 요청이 어디서 멈췄는지 알 수 없었습니다. 다음으로 아래의 연결 자체 테스트를 읽으세요. |

같은 블록에는 `deadlineOverrunInMs`도 나옵니다. 45000ms 기한이 실제 시간으로 45000ms보다 훨씬 오래 걸렸다면 프로브 프로세스 자체가 막혀 있었던 것입니다. 네트워크를 조사하기 전에 블록의 `probeProcess.eventLoopMaxDriftInMs`를 확인하세요.

#### 연결 자체 테스트 읽기

연속 세 번 실패하면 프로브는 같은 서버를 한 층씩(DNS, 그다음 TCP, 그다음 TLS, 그다음 실제 HTTP 왕복) 테스트하고 각 단계를 소요 시간과 함께 기록합니다. 처음 실패한 단계가 답입니다. 프록시가 설정되어 있으면 프로브는 프록시까지의 구간을 테스트합니다. 프로브가 실제로 거치는 구간은 그것뿐이기 때문입니다. 이 테스트는 최대 5분에 한 번 실행됩니다.

#### 실패가 되기 전에 느린 요청 지켜보기

성공했지만 `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS`보다 오래 걸린 요청은 걸린 시간과 함께 기록됩니다. 20초짜리 요청을 기록하기 시작한 프로브는 45초 기한을 넘어가는 중입니다.
:::

OneUptime 서버 쪽에서도 느리게 응답한 프로브 요청이나, 응답을 보내기 전에 프로브가 포기한 요청이 프로브의 id와 함께 기록됩니다. 이 두 로그를 함께 보면 연결의 어느 쪽에 문제가 있는지 알 수 있습니다.

### 그 밖의 문제

:::details 프로브가 시작하자마자 멈춥니다
로그에 무엇이 빠졌는지 나옵니다: `PROBE_KEY is not set`, `PROBE_INGEST_URL or ONEUPTIME_URL is not set` 또는 `PROBE_ID or REGISTER_PROBE_KEY should be set`. 세 가지가 모두 설정되어 있는데 ID와 키가 어떤 프로브와도 맞지 않으면, 프로브는 30초 간격으로 10번 시도한 뒤 `Unable to register probe after 10 attempts`와 함께 멈춥니다. **ID 및 키 표시** 로 ID와 키를 다시 복사하세요.
:::

:::details 누군가 키를 재설정하기 전까지는 프로브가 작동했습니다
프로브 페이지의 **프로브 키 재설정** 은 새 키를 만들고, 이전 키는 즉시 작동을 멈춥니다. **ID 및 키 표시** 로 새 키를 복사해 `PROBE_KEY`로 설정하고 프로브를 다시 시작하세요.
:::

:::details 모니터가 사설 주소에 닿을 수 없다고 합니다
허용하기 전까지 프로브는 사설 주소를 거부합니다. 프로브에 `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true`를 설정하고 다시 시작하세요. [프라이빗 네트워크 접근](/docs/self-hosted/private-network-access)을 참조하세요.
:::

그래도 문제가 계속되면 [GitHub](https://github.com/oneuptime/oneuptime)에 이슈를 만들거나 [지원팀에 문의](https://oneuptime.com/support)하세요.

## 다음 단계

:::cards
- [모니터 만들기](/docs/monitor/create-monitor): 무엇을 확인하고 어떤 프로브로 확인할지 고릅니다.
- [수신 요청 Ingress](/docs/probe/incoming-request-ingress): 인터넷에 접근할 수 없는 서비스가 프로브를 통해 하트비트를 보내게 합니다.
- [패킷 캡처](/docs/probe/packet-capture): 프로브가 보는 트래픽을 대시보드에서 캡처합니다.
- [프라이빗 네트워크 접근](/docs/self-hosted/private-network-access): 프로브가 사설 주소를 확인하게 합니다.
:::
