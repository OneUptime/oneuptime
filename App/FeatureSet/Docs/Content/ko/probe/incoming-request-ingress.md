# 수신 요청 인그레스

커스텀 프로브는 선택적으로 프라이빗 네트워크 내부에서 `heartbeat` 및 `incoming-request` 호출을 수신하고 OneUptime으로 전달하는 **인바운드 HTTP 리스너**를 실행할 수 있습니다. 이를 통해 **아웃바운드 인터넷 액세스가 없는** 서비스가 `oneuptime.com`에 직접 요청을 전송하는 대신 로컬 네트워크의 프로브에 요청을 전송하여 [수신 요청 모니터](/docs/monitor/incoming-request-monitor)에 보고할 수 있습니다.

## 개요

`PROBE_INGRESS_PORT`가 설정되면 프로브는 해당 포트에 추가적인 HTTP 리스너를 바인딩합니다. 리스너는 공개 OneUptime 엔드포인트와 동일한 `secretkey` URL 경로를 허용합니다:

- `POST /heartbeat/:secretkey`
- `GET /heartbeat/:secretkey`
- `POST /incoming-request/:secretkey`
- `GET /incoming-request/:secretkey`

그런 다음 프로브는 요청을 OneUptime 인스턴스로 프록시하며, 메서드, 본문 및 요청 헤더를 보존합니다 (`Host`, `Connection`, `Content-Length` 등 홉바이홉 헤더 제외). 프로브는 요청이 전달 프로브에 귀속되도록 `OneUptime-Probe-Id` 헤더를 자동으로 첨부합니다.

리스너는 프로브의 내부 상태/메트릭 엔드포인트와는 별도인 **전용 포트**에서 실행되므로 다른 것을 노출하지 않고 프라이빗 네트워크에 노출할 수 있습니다.

## 이 기능을 사용하는 경우

다음의 경우 인그레스 리스너를 사용합니다:

- 서비스가 아웃바운드 HTTPS 액세스가 없는 격리된 네트워크 세그먼트에서 실행될 때
- 모든 모니터링 트래픽을 VPC / 온프레미스 네트워크 내에 유지하려고 할 때
- OneUptime에 도달할 수 있는 단일 이그레스 포인트 — 프로브 — 를 원할 때
- 이미 [커스텀 프로브](/docs/probe/custom-probe)를 배포했으며 인바운드 하트비트에 재사용하려고 할 때

서비스가 이미 `https://oneuptime.com` (또는 자체 호스팅 URL)에 직접 도달할 수 있다면 이 기능이 필요하지 않습니다 — 서비스에서 직접 하트비트 URL을 호출하십시오.

## 인그레스 리스너 활성화

`PROBE_INGRESS_PORT`를 리스너가 바인딩할 포트로 설정합니다. `0`보다 큰 값이면 리스너를 활성화합니다; 설정되지 않거나 `0`이면 비활성화합니다.

### Docker

```bash
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e PROBE_INGRESS_PORT=3875 \
  -d oneuptime/probe:release
```

`--network host`를 사용하지 않는 경우 인그레스 포트를 명시적으로 게시합니다:

```bash
docker run --name oneuptime-probe \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e PROBE_INGRESS_PORT=3875 \
  -p 3875:3875 \
  -d oneuptime/probe:release
```

### Docker Compose

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
      - PROBE_INGRESS_PORT=3875
    ports:
      - "3875:3875"
    restart: always
```

### Kubernetes

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
            - name: PROBE_INGRESS_PORT
              value: "3875"
          ports:
            - name: ingress
              containerPort: 3875
---
apiVersion: v1
kind: Service
metadata:
  name: oneuptime-probe-ingress
spec:
  selector:
    app: oneuptime-probe
  ports:
    - name: ingress
      port: 3875
      targetPort: 3875
  type: ClusterIP
```

내부 서비스는 `http://oneuptime-probe-ingress.<namespace>.svc.cluster.local:3875/heartbeat/<secret-key>`로 하트비트를 전송할 수 있습니다.

## 프로브에 요청 전송

공개 하트비트 URL을 교체합니다:

```
https://oneuptime.com/heartbeat/<secret-key>
```

프로브의 인그레스 URL로:

```
http://<probe-host>:<PROBE_INGRESS_PORT>/heartbeat/<secret-key>
```

경로, 메서드, 본문 및 헤더는 동일하므로 기존 클라이언트 코드는 기본 URL만 변경하면 됩니다.

### 예시

```bash
# GET 하트비트
curl http://probe.internal:3875/heartbeat/YOUR_SECRET_KEY

# JSON 본문이 있는 POST 하트비트
curl -X POST http://probe.internal:3875/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{"status": "healthy", "version": "1.2.3"}'

# Cron 작업
*/5 * * * * curl -s http://probe.internal:3875/heartbeat/YOUR_SECRET_KEY > /dev/null
```

## 전달 동작

- **동기 응답, 비동기 전달.** 프로브는 인바운드 요청을 즉시 `200`으로 확인하고 백그라운드에서 OneUptime으로 전달합니다. 서비스는 전달이 완료될 때까지 기다릴 필요가 없습니다.
- **헤더가 보존됩니다.** 홉바이홉 헤더 (`Host`, `Connection`, `Content-Length`, `Transfer-Encoding`, `Keep-Alive`, `Proxy-Authenticate`, `Proxy-Authorization`, `TE`, `Trailer`, `Upgrade`) 를 제외한 모든 헤더가 통과됩니다. 프로브는 자신을 식별하는 `OneUptime-Probe-Id` 헤더를 추가합니다.
- **본문이 보존됩니다.** JSON, URL 인코딩 및 원시 `application/octet-stream` 페이로드가 최대 **50MB**까지 허용됩니다.
- **백오프를 사용한 재시도.** 전달이 실패하면 프로브는 지수 백오프 (2s, 4s, 8s, 최대 15s)로 `PROBE_INGRESS_FORWARD_RETRY_LIMIT`번까지 재시도합니다.
- **프록시 인식.** 프로브 자체가 `HTTP_PROXY_URL` / `HTTPS_PROXY_URL`로 구성된 경우 전달된 요청이 프록시를 통과합니다.

## 환경 변수

| 변수                                | 기본값                     | 설명                                                                          |
| ----------------------------------- | -------------------------- | ----------------------------------------------------------------------------- |
| `PROBE_INGRESS_PORT`                | _설정되지 않음_ (비활성화) | 인바운드 리스너가 바인딩하는 포트. `0`보다 큰 값이면 인그레스를 활성화합니다. |
| `PROBE_INGRESS_FORWARD_TIMEOUT_MS`  | `10000`                    | OneUptime으로의 각 전달 시도에 대한 타임아웃 (ms). 최소 `1000`.               |
| `PROBE_INGRESS_FORWARD_RETRY_LIMIT` | `3`                        | 프로브가 전달을 포기하기 전의 재시도 횟수. `0`으로 설정하면 재시도 비활성화.  |

표준 프로브 변수 (`PROBE_KEY`, `PROBE_ID`, `ONEUPTIME_URL`, 프록시 변수)가 모두 적용됩니다 — 전체 목록은 [커스텀 프로브](/docs/probe/custom-probe)를 참조하십시오.

## 보안 고려 사항

- **엔드포인트는 설계상 인증되지 않습니다** — URL 경로의 비밀 키가 공개 `oneuptime.com` 엔드포인트에서와 마찬가지로 인증입니다. 비밀 키를 자격 증명으로 취급하십시오.
- **프라이빗 인터페이스에만 바인딩합니다.** 인그레스 리스너는 공개 인터넷에서 액세스할 수 없어야 합니다. 네트워크 정책, 방화벽 규칙 또는 `ClusterIP` 서비스를 사용하여 액세스를 제한합니다.
- **전송 중 암호화가 필요한 경우 HTTPS 종료를 사용합니다.** 프로브의 리스너는 일반 HTTP로 통신합니다. 인바운드 홉에 TLS가 필요한 경우 내부 로드 밸런서/인그레스 컨트롤러 뒤에 배치합니다. 프로브 → OneUptime의 전달 경로는 항상 HTTPS를 사용합니다 (`ONEUPTIME_URL`이 `https://`라고 가정).
- **리소스 제한.** 리스너는 최대 50MB의 요청 본문을 허용합니다. 더 엄격한 제한이 필요한 경우 앞에 리버스 프록시를 배치합니다.

## 문제 해결

- **프로브가 시작 시 `Probe ingress listener started on port <port>`를 로그합니다** — 리스너가 실행 중임을 확인합니다. 이 줄이 보이지 않으면 `PROBE_INGRESS_PORT`가 설정되지 않았거나, `0`이거나, 유효하지 않습니다.
- **`Probe ingress: failed to forward to <url> after N attempts`** — 프로브가 OneUptime에 도달할 수 없습니다. 프로브의 아웃바운드 연결, 프록시 설정 및 `ONEUPTIME_URL` 값을 확인합니다.
- **`Probe ingress: probe ID not available, forwarding without it`** — 프로브가 아직 등록되지 않았습니다. 전달은 여전히 성공합니다; 하트비트는 단순히 프로브에 귀속되지 않습니다.
- **하트비트가 OneUptime에 표시되지만 프로브를 통하지 않음** — 서비스가 공개 URL이 아닌 `http://<probe-host>:<port>/...`를 치고 있는지 확인합니다. 잘못된 DNS 또는 `/etc/hosts` 항목이 일반적인 원인입니다.

## 관련 항목

- [커스텀 프로브](/docs/probe/custom-probe)
- [수신 요청 모니터](/docs/monitor/incoming-request-monitor)
