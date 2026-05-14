# Docker 모니터

Docker 모니터링을 통해 Docker 호스트와 그 위에서 실행 중인 컨테이너의 상태 및 성능을 모니터링할 수 있습니다. OneUptime은 사전 구성된 OpenTelemetry 콜렉터(**OneUptime Docker 에이전트**)를 통해 메트릭과 컨테이너 로그를 수집하고 구성된 기준에 따라 평가합니다.

## 개요

Docker 모니터는 호스트의 메트릭과 로그를 사용하여 컨테이너 워크로드에 대한 가시성을 제공합니다. 이를 통해 다음이 가능합니다:

- Docker 호스트 및 컨테이너별 상태 모니터링
- 컨테이너 전반의 CPU, 메모리, 네트워크, 블록 I/O 및 프로세스 수 추적
- 컨테이너 재시작, 충돌 및 CPU 스로틀링 감지
- 네이티브 OpenTelemetry 형식으로 구조화된 컨테이너 로그 스트리밍
- 높은 CPU, 높은 메모리, 재시작 루프 등에 대한 알림

## Docker 모니터 생성

1. OneUptime 대시보드의 **모니터**로 이동합니다
2. **모니터 생성**을 클릭합니다
3. 모니터 유형으로 **Docker**를 선택합니다
4. 모니터링할 Docker 호스트와 리소스 범위를 선택합니다
5. 메트릭 쿼리 및 집계를 구성합니다
6. 필요에 따라 모니터링 기준을 구성합니다

## 구성 옵션

### Docker 호스트

모니터링할 Docker 호스트를 선택합니다. 호스트는 OneUptime Docker 에이전트가 처음으로 텔레메트리를 전송할 때 자동으로 등록됩니다 — 수동으로 생성할 필요가 없습니다.

### 리소스 범위

리소스를 모니터링할 수준을 선택합니다:

| 범위 | 설명 |
|-------|-------------|
| 호스트 | 모든 컨테이너에 걸쳐 집계된 전체 Docker 호스트 모니터링 |
| 컨테이너 | 이름 또는 이미지별로 특정 컨테이너 모니터링 |

### 메트릭 쿼리

평가할 하나 이상의 메트릭 쿼리를 구성합니다. 각 쿼리는 다음을 지정합니다:

- **메트릭 이름** — 쿼리할 컨테이너 메트릭
- **집계** — 메트릭 값을 집계하는 방법 (평균, 합계, 최대, 최소)
- **필터** — 추가 속성 기반 필터링 (예: 컨테이너 이름, 이미지 또는 호스트별)
- **그룹화** — 선택적으로 `resource.container.name`별로 그룹화하여 각 컨테이너가 독립적으로 평가되도록 함

여러 메트릭 쿼리를 수학적 표현식을 사용하여 결합하는 **수식**을 생성할 수도 있습니다.

### 롤링 시간 창

메트릭 평가를 위한 시간 창을 선택합니다:

- 과거 1분
- 과거 5분
- 과거 10분
- 과거 15분
- 과거 30분
- 과거 60분

## 수집된 메트릭

Docker 에이전트는 OpenTelemetry `docker_stats` 수신기를 사용하며, 구성 가능한 간격으로 Docker Engine API를 스크랩합니다 (기본값: 30초마다).

### CPU

| 메트릭 | 설명 |
|--------|-------------|
| `container.cpu.utilization` | 호스트 CPU의 백분율로 표시된 CPU 사용률 |
| `container.cpu.usage.total` | 컨테이너에서 사용한 누적 CPU 시간 |
| `container.cpu.throttling_data.throttled_time` | cgroup에 의해 컨테이너가 스로틀된 시간 |
| `container.cpu.throttling_data.throttled_periods` | 스로틀링 기간 수 |

### 메모리

| 메트릭 | 설명 |
|--------|-------------|
| `container.memory.usage.total` | 바이트 단위의 현재 메모리 사용량 |
| `container.memory.usage.limit` | 바이트 단위의 메모리 제한 |
| `container.memory.percent` | 제한에 대한 백분율로 표시된 메모리 사용량 |

### 네트워크

| 메트릭 | 설명 |
|--------|-------------|
| `container.network.io.usage.rx_bytes` | 총 수신 바이트 |
| `container.network.io.usage.tx_bytes` | 총 전송 바이트 |

### 블록 I/O

| 메트릭 | 설명 |
|--------|-------------|
| `container.blockio.io_service_bytes_recursive.read` | 블록 장치에서 읽은 바이트 |
| `container.blockio.io_service_bytes_recursive.write` | 블록 장치에 쓴 바이트 |

### 컨테이너 정보

| 메트릭 | 설명 |
|--------|-------------|
| `container.uptime` | 초 단위의 컨테이너 가동 시간 |
| `container.restarts` | 컨테이너가 재시작된 횟수 |
| `container.pids.count` | 컨테이너 내의 프로세스 수 |

## 모니터링 기준

### 사용 가능한 확인 유형

| 확인 유형 | 설명 |
|------------|-------------|
| 메트릭 값 | 구성된 메트릭 쿼리 또는 수식의 값 |

### 집계 유형

| 집계 | 설명 |
|-------------|-------------|
| 평균 | 시간 창에 대한 평균 값 |
| 합계 | 모든 값의 합계 |
| 최대값 | 시간 창에서 가장 높은 값 |
| 최솟값 | 시간 창에서 가장 낮은 값 |
| 모든 값 | 모든 값이 기준을 충족해야 함 |
| 임의 값 | 하나 이상의 값이 기준을 충족해야 함 |

### 필터 유형

- **초과**, **미만**, **이상**, **이하**, **동일**, **다름**

## 사전 구축된 알림 템플릿

OneUptime은 일반적인 Docker 모니터링 시나리오에 대한 템플릿을 제공합니다:

| 템플릿 | 설명 | 임계값 | 집계 |
|----------|-------------|-----------|-------------|
| 높은 컨테이너 CPU | 컨테이너별 CPU 사용률 | > 90% | 최대 (컨테이너별) |
| 높은 컨테이너 메모리 | 제한에 대한 백분율로 표시된 메모리 사용량 | > 85% | 최대 (컨테이너별) |
| 높은 CPU 스로틀링 | CPU 스로틀된 기간 | > 0 | 최대 (컨테이너별) |
| 컨테이너 재시작 루프 | 컨테이너 재시작 횟수 | > 3 | 합계 |
| 컨테이너 다운 | 컨테이너 가동 시간이 0으로 재설정됨 | = 0 | 최솟값 |

> 참고: CPU, 메모리 및 스로틀링 템플릿은 `resource.container.name`별로 그룹화된 **최대** 집계를 사용합니다. 이렇게 하면 바쁜 단일 컨테이너의 신호가 동일한 호스트의 많은 유휴 컨테이너에 의해 희석되는 것을 방지합니다.

## 수집된 로그

메트릭 외에도 Docker 에이전트는 OpenTelemetry filelog 수신기를 통해 모든 컨테이너의 `*-json.log` 파일을 추적하고 네이티브 OTLP 로그 형식으로 로그 레코드를 전송합니다. 각 로그 레코드는 다음으로 보강됩니다:

- `resource.host.name` — Docker 호스트 식별자
- `resource.container.id` — 전체 컨테이너 ID
- `resource.container.runtime` — 항상 `docker`
- `attributes["log.iostream"]` — `stdout` 또는 `stderr`
- `severityText` / `severityNumber` — 스트림에서 파생됨: `stderr` → `ERROR`, `stdout` → `INFO`
- `body` — 컨테이너 프로세스에서 내보낸 원시 로그 줄
- `time` — 해당 줄에 대한 Docker 데몬의 타임스탬프

로그는 Docker 호스트의 **로그** 탭과 각 컨테이너의 세부 정보 페이지에 나타납니다.

### 로그 드라이버 요구 사항

**Docker 에이전트는 Docker의 `json-file` 로그 드라이버를 사용하는 컨테이너의 로그만 수집합니다.** 이것은 Docker의 기본값이지만 컨테이너별 또는 전역적으로 재정의될 수 있습니다:

- **`local`** 드라이버 — `/var/lib/docker/containers/<id>/local-logs/container.log`에 이진 protobuf 청크를 씁니다. filelog 수신기는 이 형식을 파싱할 수 없습니다.
- **`journald`**, **`syslog`**, **`fluentd`**, **`gelf`**, **`awslogs`**, **`splunk`** 등 — 원격 대상으로 로그를 전송하여 추적할 파일이 없습니다.
- **`none`** — 로그를 완전히 삭제합니다.

위 중 하나를 사용하는 경우 Docker 호스트 페이지에서 메트릭을 볼 수 있지만 **로그** 탭은 비어 있을 것입니다 (또는 Docker 에이전트 자체 로그만 포함됨).

**특정 컨테이너의 로그 드라이버 확인:**

```bash
docker inspect <container> --format '{{.HostConfig.LogConfig.Type}}'
```

**데몬 기본값 확인:**

```bash
docker info --format '{{.LoggingDriver}}'
```

**Docker Compose 서비스를 합리적인 로테이션으로 `json-file`로 전환:**

```yaml
services:
  my-app:
    image: my-app:latest
    logging:
      driver: "json-file"
      options:
        max-size: "100m"
        max-file: "5"
```

**데몬 기본값 전환** (`/etc/docker/daemon.json` 편집):

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "5"
  }
}
```

그런 다음 Docker 데몬을 재시작하고 영향 받는 컨테이너를 **재생성**합니다. Docker는 컨테이너 생성 시 로그 드라이버를 바인딩하므로 기존 컨테이너는 제거되고 재생성될 때까지 이전 드라이버를 유지합니다:

```bash
# Docker Compose
docker compose up -d --force-recreate <service>

# Plain docker
docker rm -f <container>
docker run ... <image>
```

## 설정 요구 사항

Docker 모니터링을 사용하려면 다음이 필요합니다:

1. 모니터링하려는 각 Docker 호스트에 OneUptime Docker 에이전트 설치
2. `ONEUPTIME_URL`, `ONEUPTIME_SERVICE_TOKEN` 및 `DOCKER_HOST_NAME`을 환경 변수로 전달
3. 관찰하려는 컨테이너가 `json-file` 로그 드라이버를 사용하는지 확인 (위 참조)

에이전트는 Docker Hub에서 `oneuptime/docker-agent:release`로 게시됩니다. 전체 `docker run` 및 `docker compose` 예시에 대한 [Docker 에이전트 설치 가이드](https://github.com/OneUptime/oneuptime/tree/master/DockerAgent)를 참조하십시오.

## 문제 해결

### 메트릭은 표시되지만 로그 탭이 비어 있는 경우

컨테이너가 `json-file` 로그 드라이버를 사용하지 않을 가능성이 큽니다. 위의 [로그 드라이버 요구 사항](#log-driver-requirement) 섹션의 진단 명령을 실행하고 로그를 전송해야 하는 컨테이너를 전환하십시오.

### Filelog 수신기가 `no files match the configured criteria`를 로그하는 경우

포함 glob `/var/lib/docker/containers/*/*-json.log`가 에이전트가 시작될 때 어떤 파일도 일치하지 않았음을 의미합니다. 이유:

1. 이 호스트의 어떤 컨테이너도 `json-file`을 사용하지 않거나,
2. 바인드 마운트 `-v /var/lib/docker/containers:/var/lib/docker/containers:ro`가 없거나 비어 있는 디렉토리를 가리키거나,
3. 에이전트가 Linux VM의 컨테이너 디렉토리가 노출되지 않은 macOS의 Docker Desktop에서 실행 중입니다.

### 로그가 도착하지만 잘못된 호스트 이름으로 그룹화되는 경우

OneUptime은 `DOCKER_HOST_NAME` 환경 변수에서 가져온 `resource.host.name`으로 Docker 호스트를 자동으로 등록합니다. 첫 번째 텔레메트리 배치 후 `DOCKER_HOST_NAME`을 변경하면 기존 호스트의 이름을 바꾸지 않고 두 번째 호스트 행이 생성됩니다.

### "높은 CPU"에 대한 인시던트가 발생하지 않는 경우

메트릭 쿼리의 집계가 **최대** (평균이 아님)이고 `resource.container.name`별로 그룹화되어 있는지 확인합니다. 바쁜 호스트의 모든 컨테이너에 걸친 평균은 유휴 컨테이너에 의해 희석되어 임계값을 거의 초과하지 않습니다.
