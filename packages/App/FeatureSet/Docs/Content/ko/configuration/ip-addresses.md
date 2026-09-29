# OneUptime.com의 IP 주소 화이트리스트

OneUptime.com을 사용하면서 보안상의 이유로 당사 IP를 화이트리스트에 추가하려면 아래 지침을 따르십시오.

oneuptime.com이 귀하의 리소스에 도달할 수 있도록 방화벽에서 다음 IP를 화이트리스트에 추가하십시오.

{{IP_WHITELIST}}

이러한 IP는 변경될 수 있으며, 변경이 발생하면 사전에 알려드리겠습니다.

## 프로그래밍 방식으로 IP 주소 가져오기

다음 API 엔드포인트를 통해 프로브 이그레스 IP 주소 목록을 프로그래밍 방식으로 가져올 수도 있습니다:

```
GET https://oneuptime.com/ip-whitelist
```

JSON 응답을 반환합니다:

```json
{
  "ipWhitelist": ["<list of IPs>"]
}
```

이 엔드포인트를 사용하여 방화벽 화이트리스트를 자동으로 최신 상태로 유지할 수 있습니다.
