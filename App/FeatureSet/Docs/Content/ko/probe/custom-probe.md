## 커스텀 프로브 설정

프라이빗 네트워크 내의 리소스 또는 방화벽 뒤에 있는 리소스를 모니터링하기 위해 네트워크 내에 커스텀 프로브를 설정할 수 있습니다.

시작하려면 프로젝트 설정 > 프로브에서 커스텀 프로브를 생성해야 합니다. OneUptime 대시보드에서 커스텀 프로브를 생성하면 `PROBE_ID`와 `PROBE_KEY`를 받게 됩니다.

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

프로브가 성공적으로 실행되고 있다면 OneUptime 대시보드에서 `연결됨`으로 표시되어야 합니다. 연결됨으로 표시되지 않으면 컨테이너 로그를 확인해야 합니다. 여전히 문제가 있다면 [GitHub](https://github.com/oneuptime/oneuptime)에 이슈를 생성하거나 [지원팀에 문의](https://oneuptime.com/support)하십시오.
