# API 모니터

API 모니터링을 통해 HTTP/REST API의 가용성, 성능 및 정확성을 모니터링할 수 있습니다. OneUptime은 API 엔드포인트에 주기적으로 HTTP 요청을 전송하고 구성된 기준에 따라 응답을 평가합니다.

## 개요

API 모니터는 엔드포인트에 HTTP 요청을 만들고 응답을 확인합니다. 이를 통해 다음이 가능합니다:

- API 업타임 및 가용성 모니터링
- 응답 시간 및 성능 추적
- HTTP 상태 코드 및 응답 본문 확인
- 응답 헤더 유효성 검사
- 다양한 HTTP 메서드 테스트 (GET, POST, PUT, DELETE 등)
- 커스텀 요청 헤더 및 본문 전송

## API 모니터 생성

1. OneUptime 대시보드의 **모니터**로 이동합니다
2. **모니터 생성**을 클릭합니다
3. 모니터 유형으로 **API**를 선택합니다
4. API URL을 입력하고 요청 설정을 구성합니다
5. 필요에 따라 모니터링 기준을 구성합니다

## 구성 옵션

### API URL

모니터링할 API 엔드포인트의 전체 URL을 입력합니다 (예: `https://api.example.com/v1/health`).

### 동적 URL 플레이스홀더

CDN 또는 캐싱 프록시 뒤의 API를 모니터링할 때 모니터는 오리진 서버가 아닌 캐시된 응답을 받을 수 있습니다. 각 확인마다 캐시를 무효화하려면 매 모니터링 요청마다 고유한 값으로 교체되는 동적 URL 플레이스홀더를 사용할 수 있습니다.

#### 지원되는 플레이스홀더

| 플레이스홀더    | 설명                              | 예시 값                            |
| --------------- | --------------------------------- | ---------------------------------- |
| `{{timestamp}}` | 현재 Unix 타임스탬프(초)로 교체됨 | `1719500000`                       |
| `{{random}}`    | 무작위 고유 문자열로 교체됨       | `a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5` |

#### 예시

플레이스홀더를 사용하여 모니터 URL을 구성합니다:

```
https://api.example.com/health?cb={{timestamp}}
```

각 모니터링 확인 시 URL은 다음과 같이 됩니다:

```
https://api.example.com/health?cb=1719500000
https://api.example.com/health?cb=1719500005
...
```

모든 요청에 고유한 문자열을 사용하려면 `{{random}}`을 사용할 수 있습니다:

```
https://api.example.com/health?nocache={{random}}
```

### API 요청 유형

요청에 사용할 HTTP 메서드를 선택합니다:

- **GET** (기본값)
- **POST**
- **PUT**
- **DELETE**
- **PATCH**
- **HEAD**

### 고급 옵션

#### 요청 헤더

요청에 커스텀 HTTP 헤더를 추가합니다. 인증 토큰, 콘텐츠 유형 사양 및 기타 API 특정 헤더에 유용합니다.

헤더 값에 [모니터 시크릿](/docs/monitor/monitor-secrets)을 사용하여 API 키와 같은 민감한 데이터를 안전하게 저장할 수 있습니다.

#### 요청 본문 (JSON)

POST, PUT 및 PATCH 요청의 경우 JSON 요청 본문을 지정할 수 있습니다. 요청 본문에도 [모니터 시크릿](/docs/monitor/monitor-secrets)을 사용할 수 있습니다.

#### 리디렉션 따르지 않기

기본적으로 OneUptime은 HTTP 리디렉션(301, 302 등)을 따릅니다. 최종 목적지가 아닌 리디렉션 응답 자체를 모니터링하려면 이 옵션을 활성화합니다.

#### Allow Self-Signed Certificates

Enable this option to skip TLS certificate validation. Useful when the target server uses a self-signed or otherwise untrusted TLS certificate (for example, an internal staging environment).

#### Client Certificate (mTLS)

If your endpoint requires mutual TLS authentication, enable **Use client certificate (mTLS)** and provide:

- **Client Certificate (PEM)** — the PEM-encoded client certificate to present.
- **Client Private Key (PEM)** — the matching PEM-encoded private key.
- **Client Private Key Passphrase** _(optional)_ — required only if the private key is encrypted.

This is the OneUptime equivalent of the `--cert` and `--key` flags in curl:

```bash
curl --cert client.crt --key client.key https://api.example.com/health
```

For sensitive values, store the certificate and key as [Monitor Secrets](/docs/monitor/monitor-secrets) and reference them with `{{monitorSecrets.name}}`. Monitor Secrets are resolved server-side and the rendered values never appear in the dashboard.

## 모니터링 기준

다음을 기반으로 API가 온라인, 저하 또는 오프라인으로 간주되는 시점을 결정하는 기준을 구성할 수 있습니다:

- **응답 상태 코드** - HTTP 상태 코드가 예상 값과 일치하는지 확인 (예: 200, 201)
- **응답 시간** - 응답 시간이 임계값을 초과하는지 모니터링
- **응답 본문** - 응답 본문에 특정 내용이 포함되거나 일치하는지 확인
- **응답 헤더** - 특정 응답 헤더가 있거나 예상 값과 일치하는지 확인
- **JavaScript 표현식** - 응답을 평가하기 위한 커스텀 표현식 작성. 자세한 내용은 [JavaScript 표현식](/docs/monitor/javascript-expression)을 참조하십시오.
