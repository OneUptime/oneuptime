## 커스텀 프로브 설정

프라이빗 네트워크 내의 리소스 또는 방화벽 뒤에 있는 리소스를 모니터링하기 위해 네트워크 내에 커스텀 프로브를 설정할 수 있습니다.

시작하려면 모니터 > 설정 > 프로브에서 커스텀 프로브를 생성해야 합니다. OneUptime 대시보드에서 커스텀 프로브를 생성하면 `PROBE_ID`와 `PROBE_KEY`를 받게 됩니다.

### 프로브 배포

#### Docker

프로브를 실행하려면 Docker가 설치되어 있는지 확인하십시오. 다음 명령으로 커스텀 프로브를 실행할 수 있습니다:

```
docker run --name oneuptime-probe --network host -e PROBE_KEY=<probe-key> -e PROBE_ID=<probe-id> -e ONEUPTIME_URL=https://oneuptime.com -d oneuptime/probe:release
```

OneUptime을 자체 호스팅하는 경우 `ONEUPTIME_URL`을 커스텀 자체 호스팅 인스턴스로 변경할 수 있습니다.

##### 프록시 구성

프로브가 OneUptime 또는 외부 리소스에 도달하기 위해 프록시 서버를 통과해야 하는 경우 다음 환경 변수를 사용하여 프록시 설정을 구성할 수 있습니다:

```
# HTTP 프록시의 경우
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTP_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release

# HTTPS 프록시의 경우
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTPS_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release

# 프록시 인증과 함께
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTP_PROXY_URL=http://username:password@proxy.example.com:8080 \
  -e HTTPS_PROXY_URL=http://username:password@proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release
```

#### Docker Compose

docker-compose를 사용하여 프로브를 실행할 수도 있습니다. 다음 내용으로 `docker-compose.yml` 파일을 생성합니다:

```yaml
version: "3"

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

##### 프록시 구성과 함께

프록시 서버를 사용해야 하는 경우 프록시 환경 변수를 추가할 수 있습니다:

```yaml
version: "3"

services:
  oneuptime-probe:
    image: oneuptime/probe:release
    container_name: oneuptime-probe
    environment:
      - PROBE_KEY=<probe-key>
      - PROBE_ID=<probe-id>
      - ONEUPTIME_URL=https://oneuptime.com
      # 프록시 구성 (선택 사항)
      - HTTP_PROXY_URL=http://proxy.example.com:8080
      - HTTPS_PROXY_URL=http://proxy.example.com:8080
      - NO_PROXY=localhost,.internal.example.com
      # 인증이 있는 프록시의 경우:
      # - HTTP_PROXY_URL=http://username:password@proxy.example.com:8080
      # - HTTPS_PROXY_URL=http://username:password@proxy.example.com:8080
      # - NO_PROXY=localhost,.internal.example.com
    network_mode: host
    restart: always
```

그런 다음 다음 명령을 실행합니다:

```
docker compose up -d
```

OneUptime을 자체 호스팅하는 경우 `ONEUPTIME_URL`을 커스텀 자체 호스팅 인스턴스로 변경할 수 있습니다.

#### Kubernetes

Kubernetes를 사용하여 프로브를 실행할 수도 있습니다. 다음 내용으로 `oneuptime-probe.yaml` 파일을 생성합니다:

```yaml
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

##### 프록시 구성과 함께

프록시 서버를 사용해야 하는 경우 프록시 환경 변수를 추가할 수 있습니다:

```yaml
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
            # 프록시 구성 (선택 사항)
            - name: HTTP_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: HTTPS_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: NO_PROXY
              value: "localhost,.internal.example.com"
            # 인증이 있는 프록시의 경우 사용:
            # - name: HTTP_PROXY_URL
            #   value: "http://username:password@proxy.example.com:8080"
            # - name: HTTPS_PROXY_URL
            #   value: "http://username:password@proxy.example.com:8080"
            # - name: NO_PROXY
            #   value: "localhost,.internal.example.com"
```

그런 다음 다음 명령을 실행합니다:

```bash
kubectl apply -f oneuptime-probe.yaml
```

OneUptime을 자체 호스팅하는 경우 `ONEUPTIME_URL`을 커스텀 자체 호스팅 인스턴스로 변경할 수 있습니다.

### 환경 변수

프로브는 다음 환경 변수를 지원합니다:

#### 필수 변수

- `PROBE_KEY` - OneUptime 대시보드의 프로브 키
- `PROBE_ID` - OneUptime 대시보드의 프로브 ID
- `ONEUPTIME_URL` - OneUptime 인스턴스의 URL (기본값: https://oneuptime.com)

#### 선택적 변수

- `HTTP_PROXY_URL` - HTTP 요청을 위한 HTTP 프록시 서버 URL
- `HTTPS_PROXY_URL` - HTTPS 요청을 위한 HTTP 프록시 서버 URL
- `NO_PROXY` - 프록시를 우회해야 하는 쉼표로 구분된 호스트 또는 도메인
- `PROBE_NAME` - 프로브의 커스텀 이름
- `PROBE_DESCRIPTION` - 프로브에 대한 설명
- `PROBE_MONITORING_WORKERS` - 모니터링 워커 수 (기본값: 1)
- `PROBE_MONITOR_FETCH_LIMIT` - 한 번에 가져올 모니터 수 (기본값: 10)
- `PROBE_MONITOR_RETRY_LIMIT` - 실패한 모니터에 대한 재시도 횟수 (기본값: 3)
- `PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS` - 합성 모니터 스크립트의 타임아웃 (밀리초 단위, 기본값: 60000)
- `PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS` - 커스텀 코드 모니터 스크립트의 타임아웃 (밀리초 단위, 기본값: 60000)
- `PROBE_API_REQUEST_TIMEOUT_IN_MS` - 프로브가 OneUptime으로 보내는 각 요청의 제한 시간 (기본값: 45000)
- `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` - OneUptime으로 보낸 요청이 이 시간보다 느릴 때 경고를 기록 (기본값: 10000)
- `PROBE_MONITOR_CHECK_TIMEOUT_IN_MS` - 모니터 하나를 검사하는 제한 시간으로, 초과하면 해당 검사를 중단하고 다음 주기에 다시 시도 (기본값: 900000)

#### 프록시 구성

프로브는 HTTP 및 HTTPS 프록시 서버를 모두 지원합니다. 구성된 경우 프로브는 지정된 프록시 서버를 통해 모든 모니터링 트래픽을 라우팅합니다. 쉼표로 구분된 `NO_PROXY` 목록을 제공하여 내부 호스트나 네트워크에 대한 프록시를 우회할 수도 있습니다.

**프록시 URL 형식:**

```
http://[username:password@]proxy.server.com:port
```

**예시:**

- 기본 프록시: `http://proxy.example.com:8080`
- 인증 포함: `http://username:password@proxy.example.com:8080`

**지원되는 기능:**

- HTTP 및 HTTPS 프록시 지원
- 프록시 인증 (사용자 이름/비밀번호)
- HTTP와 HTTPS 프록시 간의 자동 폴백
- `NO_PROXY`를 사용한 선택적 프록시 우회
- 모든 모니터 유형 (웹사이트, API, SSL, 합성 등)과 함께 작동

**참고:** 표준 환경 변수 (`HTTP_PROXY_URL`, `HTTPS_PROXY_URL`, `NO_PROXY`)와 소문자 변형 (`http_proxy`, `https_proxy`, `no_proxy`) 모두 호환성을 위해 지원됩니다.

### 확인

프로브가 성공적으로 실행되고 있다면 OneUptime 대시보드에서 `Connected`로 표시되어야 합니다. 연결됨으로 표시되지 않으면 컨테이너 로그를 확인해야 합니다. 여전히 문제가 있다면 [GitHub](https://github.com/oneuptime/oneuptime)에 이슈를 생성하거나 [지원팀에 문의](https://oneuptime.com/support)하십시오.

### 연결이 끊긴 프로브 진단

프로브가 OneUptime으로 보내는 요청이 더 이상 성공하지 않으면 해당 프로브는 `Disconnected`로 표시됩니다. 프로브 로그에는 실패한 각 요청이 어느 단계에서 멈췄는지 기록되므로 원인을 추측해야 하는 경우는 거의 없습니다.

**1. 시작 시 출력되는 환경 블록을 확인합니다.** 모든 프로브는 부팅 시 사용 중인 OneUptime URL, 요청 제한 시간, 프록시 설정, 상속받은 DNS 리졸버, Node/OS 버전, TLS 검증 비활성화 여부를 담은 JSON 블록을 한 번 출력합니다. 문제를 보고할 때는 항상 이 블록을 함께 첨부하십시오.

**2. 실패 리포트를 찾습니다.** OneUptime으로 보낸 요청이 실패할 때마다 `stalledAt`과 `whatThisMeans`가 포함된 블록이 기록됩니다. `stalledAt`은 요청이 끝내 통과하지 못한 단계를 나타냅니다:

| `stalledAt` | 의미 |
| --- | --- |
| `SocketAssignment` | 머신에서 아무것도 나가지 않았습니다. 소켓 풀이 포화 상태였거나, 구성된 프록시가 CONNECT 터널을 완료하지 못했습니다. |
| `TcpConnect` | 머신이 SYN을 보냈지만 아무 응답도 받지 못했습니다 — 방화벽이나 보안 장비가 패킷을 폐기하고 있거나, 호스트에 도달할 수 없습니다. |
| `TlsHandshake` | TCP는 연결되었지만 TLS가 완료되지 않았습니다. 대개 TLS를 검사하는 중간 장비가 원인입니다. |
| `RequestSend` | 연결은 되었지만 요청이 끝까지 전송되지 못했습니다 — 상대편이 읽기를 중단했습니다. |
| `WaitingForServerResponse` | 요청은 전달되었지만 서버가 아무 응답도 보내지 않았습니다. **프로브의 네트워크에는 문제가 없습니다** — OneUptime 서버와 로드 밸런서, 리버스 프록시를 확인하십시오. |
| `ResponseBody` | 서버가 응답을 시작했지만 도중에 멈췄습니다. |

같은 블록에는 `deadlineOverrunInMs`도 함께 기록됩니다. 45000ms 제한 시간이 실제 경과 시간으로 45000ms보다 훨씬 오래 걸렸다면 프로브 프로세스 자체가 차단된 것이므로, 네트워크를 조사하기 전에 블록 안의 `probeProcess.eventLoopMaxDriftInMs`를 확인하십시오.

**3. 연결 자체 진단 결과를 확인합니다.** 세 번 연속으로 실패하면 프로브는 동일한 서버를 DNS, TCP, TLS, 실제 HTTP 왕복 순으로 한 계층씩 테스트하고 각 단계를 소요 시간과 함께 기록합니다. 가장 먼저 실패한 단계가 원인입니다. 프록시가 구성된 경우 프로브는 프록시까지의 홉을 테스트합니다. 프로브가 실제로 수행하는 홉은 그것뿐이기 때문입니다.

**4. 실패로 이어지기 전에 느린 요청을 감시합니다.** 성공했지만 `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS`보다 오래 걸린 요청은 경과 시간과 함께 기록됩니다. 20초짜리 요청이 로그에 남기 시작한 프로브는 45초 제한 시간을 넘기기 직전입니다.

OneUptime 서버 쪽에서도 응답이 느렸던 프로브 요청이나 응답을 보내기 전에 프로브가 포기한 요청이 프로브 ID와 함께 기록됩니다. 이 두 로그를 함께 보면 연결의 어느 쪽에 문제가 있는지 알 수 있습니다.
