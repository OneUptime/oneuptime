# IP 주소

OneUptime Cloud의 프로브는 고정된 IP 주소 집합에서 웹사이트, API, 서버를 확인합니다. 모니터링 대상 앞에 방화벽이나 허용 목록이 있다면 확인 요청이 통과할 수 있도록 이 주소들을 허용하세요.

```mermaid title="허용 목록이 적용되는 위치"
flowchart LR
    P["OneUptime 프로브"] -->|"목록의 IP에서 확인"| F["방화벽"]
    F -->|"허용됨"| S["웹사이트, API 또는 서버"]
```

## 허용할 IP 주소

방화벽에서 다음 주소의 트래픽을 허용하세요.

{{IP_WHITELIST}}

> [!NOTE]
> 이 주소는 바뀔 수 있습니다. 바뀔 때는 OneUptime이 미리 알려 드립니다. 공지를 계속 확인하지 않고도 최신 상태를 유지하려면 방화벽을 업데이트할 때마다 [목록을 가져오세요](#프로그래밍-방식으로-목록-가져오기).

## 프로그래밍 방식으로 목록 가져오기

같은 목록이 API 키 없이 JSON으로 제공되므로, 스크립트로 방화벽 규칙을 최신 상태로 유지할 수 있습니다.

```bash
curl -s https://oneuptime.com/ip-whitelist
```

```json
{
  "ipWhitelist": ["<list of IPs>"]
}
```

`ipWhitelist`는 항목마다 주소가 하나씩 들어 있는 배열입니다. 예를 들어 방화벽 스크립트에 넘기기 위해 한 줄에 주소 하나씩 출력하려면 다음과 같이 합니다.

```bash
curl -s https://oneuptime.com/ip-whitelist | jq -r '.ipWhitelist[]'
```

## 자체 호스팅 OneUptime

자체 인스턴스에서는 이 페이지와 `/ip-whitelist` 엔드포인트에 인스턴스의 `IP_WHITELIST` 설정(쉼표로 구분된 목록)에 있는 주소가 표시됩니다. 자체 프로브가 확인 요청을 보내는 주소를 나열하세요.

:::tabs
@tab Kubernetes
Helm 차트의 `ipWhitelist` 값을 설정합니다.

```yaml title="values.yaml"
ipWhitelist: "203.0.113.1,203.0.113.2"
```
@tab Docker Compose
`config.env`는 이 설정을 앱에 전달하지 않습니다. `docker-compose.yml` 옆의 `docker-compose.override.yml`에서 `app` 서비스의 환경 변수에 추가한 다음 OneUptime을 다시 시작하세요.

```yaml title="docker-compose.override.yml"
services:
  app:
    environment:
      IP_WHITELIST: "203.0.113.1,203.0.113.2"
```
:::

아무것도 설정하지 않으면 이 페이지에 **No IP addresses configured.** 메시지가 표시되고, 엔드포인트는 빈 `ipWhitelist` 배열을 반환합니다.

## 다음 단계

:::cards
- [사용자 지정 프로브](/docs/probe/custom-probe): 방화벽을 여는 대신 자체 네트워크 안에서 프로브를 실행합니다.
- [모니터 만들기](/docs/monitor/create-monitor): 웹사이트, API 또는 서버 확인을 시작합니다.
:::
