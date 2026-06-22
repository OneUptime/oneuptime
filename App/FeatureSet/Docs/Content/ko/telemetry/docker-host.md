# OneUptime Docker Agent

## 개요

OneUptime Docker Agent는 튜닝된 OpenTelemetry Collector 구성과 함께 제공되는 사전 빌드된 컨테이너 이미지입니다. 기존 컨테이너 옆에서 실행하면 호스트의 모든 컨테이너를 자동으로 검색하여 CPU / 메모리 / 네트워크 / 블록 I/O 메트릭과 컨테이너 로그를 수집하고, 모든 데이터를 OTLP를 통해 OneUptime으로 전달합니다. 단일 이미지, 단일 명령입니다.

이 페이지는 **설치 가이드**입니다. 에이전트가 수집한 데이터를 기반으로 Docker 모니터 및 알림을 구성하려면 [Docker Monitor](/docs/monitor/docker-monitor)를 참조하세요.

## 사전 요구 사항

- Docker Engine 20.10+
- 호스트의 `/var/run/docker.sock`에 대한 접근 권한
- **OneUptime Telemetry Ingestion Token** — *Project Settings → Telemetry Ingestion Keys*에서 생성하고 값을 복사하세요

## 빠른 시작 (단일 명령)

`YOUR_ONEUPTIME_URL`, `YOUR_TELEMETRY_INGESTION_TOKEN`, 그리고 호스트 이름을 사용자 환경에 맞는 값으로 교체하세요. 호스트 이름은 이 Docker 호스트가 OneUptime에 표시되는 방식입니다 — `prod-docker-01`과 같은 이름을 선택하세요.

```bash
docker run -d \
  --name oneuptime-docker-agent \
  --user 0:0 \
  --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v /var/lib/docker/containers:/var/lib/docker/containers:ro \
  -e ONEUPTIME_URL="YOUR_ONEUPTIME_URL" \
  -e ONEUPTIME_SERVICE_TOKEN="YOUR_TELEMETRY_INGESTION_TOKEN" \
  -e DOCKER_HOST_NAME="my-docker-host" \
  oneuptime/docker-agent:release
```

이것이 전부입니다. 에이전트가 연결되면 OneUptime 대시보드의 **Docker** 섹션에 Docker 호스트가 자동으로 표시됩니다.

## 대안 — Docker Compose

Docker Compose를 선호하는 경우 다음 내용을 `docker-compose.yml`에 넣으세요:

```yaml
services:
  oneuptime-docker-agent:
    image: oneuptime/docker-agent:release
    container_name: oneuptime-docker-agent
    user: "0:0"
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
    environment:
      - ONEUPTIME_URL=YOUR_ONEUPTIME_URL
      - ONEUPTIME_SERVICE_TOKEN=YOUR_TELEMETRY_INGESTION_TOKEN
      - DOCKER_HOST_NAME=my-docker-host
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

시작:

```bash
docker compose up -d
```

## 환경 변수

| 변수                      | 필수   | 설명                                                                                                                |
| ------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------- |
| `ONEUPTIME_URL`           | 예     | OneUptime 인스턴스 URL (예: `https://oneuptime.com` 또는 자체 호스팅 호스트)                                        |
| `ONEUPTIME_SERVICE_TOKEN` | 예     | *Project Settings → Telemetry Ingestion Keys*에서 발급한 텔레메트리 수집 토큰                                       |
| `DOCKER_HOST_NAME`        | 아니오 | 이 호스트의 친숙한 이름. 기본값은 `docker-host`입니다. 호스트별로 안정적인 값으로 설정하세요 (예: `prod-docker-01`) |

## 설치 확인

에이전트가 실행 중인지 확인:

```bash
docker ps --filter name=oneuptime-docker-agent
```

에이전트 로그 확인:

```bash
docker logs -f oneuptime-docker-agent
```

다음을 찾으세요: `"Everything is ready. Begin running and processing data."`

약 1분 이내에 메트릭과 로그가 흐르면서 호스트가 OneUptime 대시보드에 표시됩니다.

## 에이전트 업그레이드

```bash
docker pull oneuptime/docker-agent:release
docker rm -f oneuptime-docker-agent
# 위의 `docker run` 명령을 다시 실행하세요
```

또는 Docker Compose 사용:

```bash
docker compose pull
docker compose up -d
```

## 에이전트 제거

```bash
docker rm -f oneuptime-docker-agent
```

Docker Compose를 사용한 경우:

```bash
docker compose down
```

## 수집되는 데이터

| 범주                | 데이터                                        |
| ------------------- | --------------------------------------------- |
| **CPU 메트릭**      | 총 사용량, 사용률, 스로틀링 시간 (컨테이너별) |
| **메모리 메트릭**   | 사용량, 한도, 비율, RSS, 캐시 (컨테이너별)    |
| **네트워크 메트릭** | 수신 / 송신 바이트 및 패킷 (컨테이너별)       |
| **블록 I/O 메트릭** | 읽기 / 쓰기 바이트 및 작업 (컨테이너별)       |
| **컨테이너 정보**   | 가동 시간, 재시작 횟수, 프로세스 수           |
| **컨테이너 로그**   | 모든 컨테이너의 stdout / stderr 로그          |

## 자체 호스팅 OneUptime

OneUptime을 자체 호스팅하는 경우 `ONEUPTIME_URL`을 사용자 인스턴스로 설정하세요:

```bash
-e ONEUPTIME_URL="https://your-oneuptime-host.example.com"
```

인스턴스가 HTTP 전용인 경우 `http://`와 적절한 포트를 사용하세요.

## 문제 해결

### Docker 소켓 권한 거부 (Permission Denied)

에이전트 컨테이너는 `/var/run/docker.sock`에 접근하기 위해 root(`--user 0:0`)로 실행되어야 합니다. `--user 0:0` 플래그(또는 Compose의 `user: "0:0"`)가 있는지 확인하세요.

### 에이전트가 연결 끊김으로 표시됨

1. 에이전트가 실행 중인지 확인: `docker ps --filter name=oneuptime-docker-agent`
2. 에이전트 로그 확인: `docker logs oneuptime-docker-agent | grep -i error`
3. OneUptime URL과 서비스 토큰이 올바른지 확인
4. Docker 호스트가 네트워크를 통해 OneUptime 인스턴스에 도달할 수 있는지 확인

### 메트릭이 표시되지 않음

1. 에이전트 내부에서 Docker 소켓에 접근할 수 있는지 확인: `docker exec oneuptime-docker-agent ls -la /var/run/docker.sock`
2. 내보내기 오류에 대한 collector 로그 확인: `docker logs oneuptime-docker-agent | tail -100`
3. 서비스 토큰이 유효하고 만료되지 않았는지 확인

### 호스트 이름이 컨테이너 ID로 표시됨

`DOCKER_HOST_NAME` 환경 변수를 친숙한 이름으로 설정하고 컨테이너를 다시 생성하세요.

## 다음 단계

- 컨테이너 CPU / 메모리 / 재시작 조건에 대해 알림을 보내도록 **Docker Monitors**를 구성하세요 — [Docker Monitor](/docs/monitor/docker-monitor)를 참조하세요.
- 독립형 Docker 호스트 대신 Kubernetes 클러스터의 경우 [OneUptime Kubernetes Agent](/docs/telemetry/kubernetes-agent)를 사용하세요.
- 컨테이너화되지 않은 호스트(Linux / macOS / Windows VM 및 베어메탈)의 경우 [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector)를 사용하세요.
