# SMSEagle 통합

[SMSEagle](https://www.smseagle.eu)을 통해 알림을 SMS나 전화로 보냅니다. SMSEagle은 자체 네트워크에 설치하는 하드웨어 SMS 게이트웨이입니다. OneUptime에는 **SMSEagle** 워크플로 컴포넌트가 내장되어 있어 빠르게 설정할 수 있습니다.

이 통합은 **아웃바운드**입니다. OneUptime은 [SMSEagle APIv2](https://www.smseagle.eu/docs/apiv2/)를 통해 메시지를 보냅니다.

```text
OneUptime 알림 → On Create  ──►  SMSEagle 컴포넌트  ──►  전화로 SMS 또는 통화
```

## 1단계: API 키 만들기

1. SMSEagle 웹 GUI에서 **Settings → API → API v2**로 이동한 뒤 **Create API key**를 클릭합니다.
2. **Permissions**에서 **Send SMS**를 허용하고, 전화가 필요하면 **Make a TTS Advanced Call**도 허용합니다.
3. 키를 복사합니다. OneUptime에서는 이를 **SMSEagle Access Token**이라고 부릅니다.

## 2단계: OneUptime이 장치에 연결되도록 하기

1. OneUptime 서버에서 장치 주소(예: `https://192.168.0.100`)로의 연결을 그 사이의 방화벽과 VPN에서 허용합니다.
2. SMSEagle 장치는 보통 사설 주소를 사용하며, 워크플로는 기본적으로 이를 차단합니다. 자체 호스팅 인스턴스에서는 API 서버의 `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST`에 장치의 IP 주소나 호스트 이름을 추가하고(예: `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST=192.168.0.100`) 다시 시작합니다. [사설 네트워크 액세스](/docs/self-hosted/private-network-access)를 참고하세요.

## 3단계: 비밀 값 저장하기

1. OneUptime에서 **워크플로 → 전역 변수 → 만들기**로 이동합니다.
2. `SMSEAGLE_URL`, `SMSEAGLE_ACCESS_TOKEN`(비밀), `ONCALL_PHONE`을 만듭니다.

## 4단계: 워크플로 만들기

1. **워크플로 → 워크플로 생성**을 열고 이름을 `Alerts → SMSEagle`로 지정한 뒤 **빌더**를 엽니다.
2. **On Create**로 설정한 **Alert** 트리거를 추가하고 이름을 `Alert`로 바꿉니다.
3. 트리거에 연결된 **Send SMS via SMSEagle** 컴포넌트를 추가합니다.
   - **SMSEagle URL**: `{{variable.SMSEAGLE_URL}}`
   - **SMSEagle Access Token**: `{{variable.SMSEAGLE_ACCESS_TOKEN}}`
   - **Phone Number**: `{{variable.ONCALL_PHONE}}`
   - **Message Text**: `New alert: {{Alert.title}}`
4. **저장**을 클릭하고 워크플로를 켠 뒤 테스트 알림을 만듭니다. 전화로 SMS가 도착합니다.

템플릿 **Text a phone via SMSEagle when an alert fires**로도 같은 워크플로를 만들 수 있습니다.

## SMS 대신 전화

대신 **Make a Call via SMSEagle**을 사용합니다. 같은 설정에 장치의 음성 합성 목소리인 **Voice ID**가 추가되며, **Text to Read Out**을 읽어 줍니다. API 키에는 **Make a TTS Advanced Call** 권한이 필요합니다.

템플릿 **Call a phone via SMSEagle when an alert fires**로 전화를 거는 같은 워크플로를 만들 수 있습니다.

## 대안: API 컴포넌트

**API** 블록도 사용할 수 있습니다.

- **Method**: `POST`
- **URL**: `{{variable.SMSEAGLE_URL}}/api/v2/messages/sms`
- **Headers**: `access-token: {{variable.SMSEAGLE_ACCESS_TOKEN}}`
- **Body**: `{ "to": ["{{variable.ONCALL_PHONE}}"], "text": "New alert: {{Alert.title}}" }`

## 팁

- 장치가 메시지를 거부하면 그 이유는 컴포넌트의 **Error** 값에 들어 있습니다. **오류** 출력에서 로그로 남기세요.
- 보내기 전에 **조건**으로 심각도를 걸러 냅니다.
- 여러 사람에게 보내려면 번호마다 하나씩 SMSEagle 컴포넌트를 연결합니다.

## 다음에 읽을 문서

- [통합 개요](/docs/integrations/index): 아웃바운드 방식.
- [컴포넌트 → SMSEagle](/docs/workflows/components#smseagle): 컴포넌트 참조.
