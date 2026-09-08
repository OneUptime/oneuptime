# SendGrid 인바운드 이메일 통합

OneUptime의 **수신 이메일 모니터**를 통해 고유한 모니터별 이메일 주소로 전송된 이메일을 기반으로 알림을 생성하고 해결할 수 있습니다. 레거시 시스템, 알림 도구 또는 이메일을 전송할 수 있는 모든 서비스와 통합하는 데 유용합니다.

이 가이드는 자체 호스팅 OneUptime 인스턴스로 수신 이메일을 전달하도록 SendGrid Inbound Parse를 설정하는 방법을 설명합니다.

## 전제 조건

- Inbound Parse에 접근할 수 있는 SendGrid 계정
- DNS 설정에 액세스할 수 있는 제어 가능한 도메인
- SendGrid 웹훅을 OneUptime으로 전달하는 공개 HTTPS 엔드포인트

## 네트워크 접근

Inbound Parse에는 SendGrid에서 OneUptime으로 시작하는 연결이 필요합니다. OneUptime의 아웃바운드 인터넷 접근만 허용해서는 동작하지 않습니다.

| 방향 | 대상 | 프로토콜 / 포트 | 용도 |
| --- | --- | --- | --- |
| SendGrid → OneUptime | `https://your-oneuptime-domain.com/incoming-email/sendgrid/YOUR_SECRET` | HTTPS / TCP 443 | 분석한 이메일을 multipart POST로 전달합니다. |
| 발송 메일 서버 → SendGrid | 수신 도메인의 공개 MX 레코드가 지정하는 `mx.sendgrid.net` | SMTP / TCP 25 | SendGrid에서 이메일을 수신합니다. OneUptime 서버로 연결하지 않습니다. |
| OneUptime → SendGrid, 이메일 발송을 별도로 설정한 경우만 | `api.sendgrid.com` | HTTPS / TCP 443 | Mail Send API로 알림 이메일을 보냅니다. |

웹훅 호스트 이름의 공개 DNS를 설정하고 공개적으로 신뢰할 수 있는 인증서를 사용하세요. 비공개 배포는 OneUptime에 내부적으로 접근하는 공개 역방향 프록시나 게이트웨이로 웹훅 경로만 노출할 수 있습니다. 경로, 비밀 값, 콘텐츠 유형, multipart 본문을 보존하고 대화형 로그인이나 브라우저 확인 없이 POST를 허용하세요. OneUptime에는 인바운드 SMTP 리스너가 필요하지 않습니다. [SendGrid 설정 안내](https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/setting-up-the-inbound-parse-webhook)를 참고하세요.

`INBOUND_EMAIL_WEBHOOK_SECRET`을 강력한 무작위 값으로 설정하고 `YOUR_SECRET`을 그 값으로 바꾸세요. 마지막 경로 구간은 필수입니다. OneUptime은 설정한 비밀 값과 비교하며, 변수를 비워 두면 검증이 비활성화됩니다. 전체 URL과 모니터 이메일 주소는 프록시 로그에서도 비공개로 유지하세요. OneUptime은 현재 SendGrid의 서명된 Inbound Parse 헤더나 OAuth 토큰을 검증하지 않습니다. 필요하다면 [SendGrid 보안 문서](https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/securing-your-parse-webhooks)에 따라 게이트웨이에서 검증한 뒤 전달하세요.

SendGrid는 신뢰할 수 있는 고정 Inbound Parse 출처 IP 목록을 제공하지 않습니다. 이메일 발송 IP와 `mx.sendgrid.net`의 DNS 조회 결과는 웹훅 허용 목록으로 사용할 수 없습니다. [SendGrid 방화벽 안내](https://support.sendgrid.com/hc/en-us/articles/44375457225371-How-to-Configure-Firewall-Settings-for-SendGrid-Webhook-and-Inbound-Parse-IPs)를 따르세요.

Inbound Parse는 이메일 발송과 별개입니다. 수신을 위해 OneUptime이 SendGrid API를 호출할 필요는 없습니다. SendGrid로 알림도 발송한다면 DNS와 `api.sendgrid.com`으로의 아웃바운드 HTTPS를 허용하세요. [Mail Send](https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send)의 제출에는 인바운드 콜백이 필요하지 않습니다. SMTP를 사용한다면 OneUptime에 설정된 서버와 포트를 허용하세요.

공개 MX 레코드를 확인하고 테스트 모니터에 이메일을 보내 웹훅 수신과 해당 경고의 생성 또는 해결을 확인하세요. 빈 POST나 발송 이메일 테스트 성공만으로 Inbound Parse 전체 흐름을 검증할 수 없습니다.

## 작동 방식

1. OneUptime에서 **수신 이메일 모니터**를 생성합니다
2. OneUptime이 해당 모니터에 대한 고유한 이메일 주소를 생성합니다 (예: `monitor-abc123@inbound.yourdomain.com`)
3. 해당 주소로 이메일이 전송되면 SendGrid가 수신하고 웹훅을 통해 OneUptime으로 전달합니다
4. OneUptime은 구성된 기준에 따라 이메일을 평가하여 알림을 생성하거나 해결합니다

## 설정 지침

### 1단계: 인바운드 이메일 도메인 선택

수신 이메일 전용 서브도메인이 필요합니다. 다음과 같은 서브도메인을 사용하는 것이 좋습니다:

- `inbound.yourdomain.com`
- `email.yourdomain.com`
- `monitor.yourdomain.com`

이 서브도메인은 OneUptime 모니터 이메일에만 사용됩니다.

### 2단계: DNS MX 레코드 구성

인바운드 서브도메인의 이메일을 SendGrid로 라우팅하기 위해 DNS 구성에 MX 레코드를 추가합니다.

| 유형 | 호스트/이름 | 우선순위 | 값              |
| ---- | ----------- | -------- | --------------- |
| MX   | inbound     | 10       | mx.sendgrid.net |

**예시:** 도메인이 `example.com`이고 `inbound.example.com`을 사용하는 경우:

```
inbound.example.com.  IN  MX  10  mx.sendgrid.net.
```

**참고:** DNS 변경은 전파에 최대 48시간이 걸릴 수 있지만 일반적으로 몇 시간 내에 완료됩니다.

### 3단계: SendGrid에서 도메인 인증

수신 도메인은 [SendGrid에서 인증한 도메인](https://www.twilio.com/docs/sendgrid/ui/account-and-settings/inbound-parse) 중 하나에 속해야 합니다.

1. [SendGrid 대시보드](https://app.sendgrid.com)에 로그인합니다
2. **설정** > **발신자 인증**으로 이동합니다
3. **도메인 인증**을 클릭합니다
4. 프롬프트에 따라 필요한 DNS 레코드 (DKIM에 대한 CNAME 레코드)를 추가합니다

### 4단계: SendGrid Inbound Parse 구성

1. [SendGrid 대시보드](https://app.sendgrid.com)에 로그인합니다
2. **설정** > **Inbound Parse**로 이동합니다
3. **호스트 및 URL 추가**를 클릭합니다
4. 다음을 구성합니다:

| 필드                           | 값                                                                      |
| ------------------------------ | ----------------------------------------------------------------------- |
| **수신 도메인**                | 인바운드 서브도메인 (예: `inbound.yourdomain.com`)                      |
| **대상 URL**                   | `https://your-oneuptime-domain.com/incoming-email/sendgrid/YOUR_SECRET` |
| **수신 이메일 스팸 확인**      | 선택 사항 - 원하는 경우 활성화                                          |
| **원시 전체 MIME 메시지 전송** | 체크하지 않음 (필요하지 않음)                                           |
| **원시 전체 MIME 메시지 POST** | 체크하지 않음 (필요하지 않음)                                           |

5. **추가**를 클릭합니다

### 5단계: OneUptime 환경 변수 구성

#### Docker Compose

`config.env` 파일에 다음 환경 변수를 추가합니다:

```bash
# 인바운드 이메일 구성
INBOUND_EMAIL_PROVIDER=SendGrid
INBOUND_EMAIL_DOMAIN=inbound.yourdomain.com
INBOUND_EMAIL_WEBHOOK_SECRET=replace-with-a-strong-random-secret
```

#### Kubernetes + Helm

`values.yaml` 파일에 다음을 추가합니다:

```yaml
inboundEmail:
  provider: "SendGrid"
  domain: "inbound.yourdomain.com"
  webhookSecret: "replace-with-a-strong-random-secret"
```

4단계 대상 URL과 같은 비밀 값을 사용하고 설정 변경 후 OneUptime을 재시작하세요.

### 6단계: 수신 이메일 모니터 생성

1. OneUptime 대시보드에 로그인합니다
2. **모니터** > **모니터 생성**으로 이동합니다
3. **수신 이메일**을 모니터 유형으로 선택합니다
4. 모니터를 구성합니다:
   - **이름:** 모니터의 설명적인 이름
   - **설명:** 이 모니터의 용도
5. **알림 생성 기준** 구성 (알림을 생성하는 시점):
   - 예시: 이메일 제목에 "ALERT" 또는 "CRITICAL" 포함
6. **알림 해결 기준** 구성 (알림을 해결하는 시점):
   - 예시: 이메일 제목에 "RESOLVED" 또는 "OK" 포함
7. **만들기**를 클릭합니다

생성 후 이 모니터에 대한 고유한 이메일 주소를 볼 수 있습니다 (예: `monitor-abc123def456@inbound.yourdomain.com`).

### 7단계: 통합 테스트

1. OneUptime 대시보드에서 모니터의 이메일 주소를 복사합니다
2. 알림 기준과 일치하는 제목의 테스트 이메일을 해당 주소로 전송합니다
3. OneUptime 대시보드를 확인하여 다음을 검증합니다:
   - 이메일이 수신됨 (모니터 요약에서 표시)
   - 알림이 생성됨 (기준이 일치한 경우)

## 환경 변수 참조

| 변수                           | 설명                                                                                                             | 필수 여부 | 기본값 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------- | --------- | ------ |
| `INBOUND_EMAIL_PROVIDER`       | 사용할 인바운드 이메일 공급자                                                                                    | 예        | -      |
| `INBOUND_EMAIL_DOMAIN`         | 인바운드 이메일을 위해 구성된 서브도메인                                                                         | 예        | -      |
| `INBOUND_EMAIL_WEBHOOK_SECRET` | `/incoming-email/sendgrid/YOUR_SECRET`의 마지막 경로 구간과 비교합니다. 공개 엔드포인트에는 설정하세요. 빈 값은 검증을 비활성화합니다. | 권장 | - |

## 지원되는 이메일 기준

수신 이메일 모니터를 구성할 때 다음을 기반으로 기준을 생성할 수 있습니다:

| 필드              | 설명                             | 사용 가능한 필터                                                     |
| ----------------- | -------------------------------- | -------------------------------------------------------------------- |
| **이메일 제목**   | 이메일의 제목 줄                 | 포함, 포함하지 않음, 동일, 다름, 시작, 끝, 비어 있음, 비어 있지 않음 |
| **이메일 발신자** | 발신자의 이메일 주소             | 포함, 포함하지 않음, 동일, 다름, 시작, 끝, 비어 있음, 비어 있지 않음 |
| **이메일 본문**   | 이메일의 일반 텍스트 본문        | 포함, 포함하지 않음, 동일, 다름, 시작, 끝, 비어 있음, 비어 있지 않음 |
| **이메일 수신자** | 수신자 이메일 주소               | 포함, 포함하지 않음, 동일, 다름, 시작, 끝, 비어 있음, 비어 있지 않음 |
| **이메일 수신**   | 마지막 이메일이 수신된 이후 시간 | 분 내 수신, 분 내 미수신                                             |

## 예시 사용 사례

### 레거시 시스템 알림

많은 레거시 시스템은 이메일 알림만 보낼 수 있습니다. 수신 이메일 모니터를 생성하여:

- 레거시 시스템이 `[CRITICAL]` 이메일을 전송할 때 OneUptime 알림 생성
- `[RESOLVED]` 이메일이 수신되면 알림 해결

### 타사 서비스 통합

이메일 알림을 전송하는 서비스와 통합:

- API 통합이 없는 모니터링 도구
- 클라우드 공급자 알림
- 보안 스캐닝 도구

### 이메일을 통한 하트비트

"이메일 수신" 기준을 사용하여 주기적인 이메일이 수신되는지 확인합니다:

- 60분 내에 이메일이 수신되지 않으면 알림 생성
- 완료 이메일을 전송하는 배치 작업 또는 예약 작업 모니터링에 유용

## 문제 해결

### 이메일이 수신되지 않는 경우

1. **DNS 전파 확인:**

   ```bash
   dig MX inbound.yourdomain.com
   ```

   `mx.sendgrid.net`을 반환해야 합니다

2. **SendGrid Inbound Parse 설정 확인:**

   - SendGrid 대시보드에 로그인합니다
   - 설정 > Inbound Parse로 이동합니다
   - 도메인 및 웹훅 URL이 올바른지 확인합니다

3. **OneUptime 로그 확인:**
   - OneUptime 애플리케이션 로그(Telemetry / ProbeIngest)에서 수신 이메일 웹훅을 확인하세요.
   - 오류 메시지를 확인합니다

### 웹훅 실패

- 비밀 값을 포함한 전체 HTTPS URL에 인터넷에서 접근할 수 있어야 합니다. 마지막 경로 구간이 없으면 라우트와 일치하지 않습니다.
- 로그인 리디렉션이나 브라우저 확인 없이 POST를 허용하세요. SendGrid 이메일 발송 IP는 웹훅 출처 허용 목록이 아닙니다.
- 공개적으로 신뢰할 수 있는 인증서와 전체 인증서 체인을 사용하고 네트워크 접근 절차에 따라 전달을 확인하세요.

### 모니터가 알림을 생성하지 않는 경우

1. **기준 구성 확인:**

   - 알림 생성 기준이 이메일 내용과 일치하는지 확인합니다
   - 패턴 매칭을 사용하기 전에 정확한 문자열로 먼저 테스트합니다

2. **모니터 상태 확인:**

   - 모니터가 비활성화되어 있지 않은지 확인합니다
   - 모니터 유형이 "수신 이메일"인지 확인합니다

3. **모니터 요약 검토:**
   - 이메일이 수신되고 처리되었는지 확인합니다
   - 기준 매칭 세부 정보에 대한 평가 로그를 검토합니다

### SendGrid 웹훅 전달 로그

SendGrid가 성공적으로 웹훅을 전송하는지 확인하려면:

1. 불행히도 SendGrid는 Inbound Parse에 대한 자세한 로그를 제공하지 않습니다
2. 들어오는 웹훅 요청에 대한 OneUptime 서버 로그를 확인합니다
3. 임시로 웹훅 전달을 테스트하려면 [RequestBin](https://requestbin.com)과 같은 도구를 사용합니다

## 보안 모범 사례

1. **HTTPS 사용:** 웹훅 엔드포인트에 항상 HTTPS를 사용합니다
2. **웹훅 시크릿:** 추가 검증을 위해 `INBOUND_EMAIL_WEBHOOK_SECRET`을 구성하고 웹훅 URL에 포함합니다 (예: `/incoming-email/sendgrid/your-secret`)
3. **도메인 확인:** 더 나은 이메일 보안을 위해 SendGrid에서 도메인을 확인합니다
4. **액세스 제한:** 신뢰할 수 있는 이메일 소스에 대해서만 모니터를 생성합니다
5. **로그 모니터링:** 의심스러운 활동에 대한 수신 이메일 로그를 정기적으로 검토합니다

## 대체 공급자

OneUptime은 여러 인바운드 이메일 공급자를 지원하도록 설계되었습니다. 현재 지원되는 공급자:

| 공급자               | 상태    |
| -------------------- | ------- |
| SendGrid             | 지원됨  |
| Haraka (자체 호스팅) | 계획 중 |

다른 공급자에 대한 지원이 필요한 경우 문의하거나 기능 요청을 제출하십시오.

## 지원

SendGrid 인바운드 이메일 통합에 문제가 발생한 경우:

1. 위의 문제 해결 섹션을 확인합니다
2. 자세한 오류 메시지에 대한 OneUptime 로그를 검토합니다
3. [hello@oneuptime.com](mailto:hello@oneuptime.com)으로 문의합니다

이 통합을 개선하기 위한 피드백을 환영합니다!
