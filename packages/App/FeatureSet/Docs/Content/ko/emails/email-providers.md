# 이메일 공급자

OneUptime의 메일을 SMTP 서버 대신 이메일 공급자의 HTTPS API로 보냅니다. 지원하는 공급자는 Amazon SES, SendGrid, Mailgun, Postmark, Resend입니다. 프로젝트는 SMTP 구성에서 공급자를 고르고, 자체 호스팅 설치는 OneUptime 자체의 메일을 모두 공급자를 통해 보낼 수 있습니다. API에는 포트 443의 HTTPS로 연결하므로 SMTP 포트를 막는 네트워크에서도 메일이 나가며, 각 공급자의 키는 암호화되어 저장됩니다.

:::cards
- [Amazon SES](#amazon-ses): IAM 액세스 키와 보낸 사람을 확인한 리전.
- [SendGrid](#sendgrid): Mail Send 액세스 권한이 있는 API 키.
- [Mailgun](#mailgun): API 키, 보내는 도메인과 그 리전.
- [Postmark](#postmark): 서버의 API 토큰.
- [Resend](#resend): 보내기 권한이 있는 API 키.
- [문제 해결](#문제-해결): 각 공급자의 거부가 뜻하는 것.
:::

## 공급자 선택하기

:::tabs
@tab 프로젝트
**프로젝트 설정 > 알림 > 알림 설정** 에서 **추가 설정** 을 열고, **사용자 지정 SMTP 구성** 카드에서 **SMTP 구성 만들기** 를 클릭합니다. **공급자** 단계에서 **이름** 을 입력하고 공급자를 고릅니다. 다음 단계에서는 그 공급자의 설정을, **보낸 사람** 단계에서는 **보낸 사람 이메일** 과 **보낸 사람 이름** 을 묻습니다. 저장한 뒤에는 구성 행의 **테스트 이메일 보내기** 로 작동 여부를 확인할 수 있습니다.
@tab 자체 호스팅 인스턴스
Admin Dashboard에서 **설정** 을 열고 **알림 > 이메일** 을 엽니다. **이메일 서버 설정** 카드에서 **서버 편집** 을 클릭하고 **이메일 서버 유형** 으로 공급자를 고릅니다. 그 아래에 **Amazon SES 설정** 같은 공급자의 카드가 나타납니다. **Amazon SES 편집** 같은 편집 버튼을 클릭하고 공급자의 설정과 **보낸 사람** 단계를 채웁니다. 필요한 것이 모두 채워질 때까지 카드에는 빠진 것이 표시되고, 메일은 모두 채워야 할 설정을 알려 주는 메시지와 함께 거부됩니다.
:::

| 공급자 | 필요한 정보 | OneUptime이 보내는 곳 |
| --- | --- | --- |
| Amazon SES | 액세스 키 ID, 비밀 액세스 키, 지역 | `https://email.<region>.amazonaws.com` (SES API v2) |
| SendGrid | API 키 | `https://api.sendgrid.com/v3/mail/send` |
| Mailgun | API 키, 도메인, 지역 | `https://api.mailgun.net` 또는 `https://api.eu.mailgun.net` |
| Postmark | 서버 API 토큰 | `https://api.postmarkapp.com/email` |
| Resend | API 키 | `https://api.resend.com/emails` |

모든 메일은 텍스트 파트와 함께, 이미지 (OneUptime 로고, 스크린샷) 를 인라인 첨부 파일로 담아 보냅니다. 공급자가 보내는 속도를 제한하거나 공급자 쪽에서 실패하면, OneUptime은 공급자가 요청한 시간만큼 기다린 뒤 다시 시도합니다. 그 밖의 거부는 공급자의 응답과 함께 알림 로그에 남습니다.

## Amazon SES

:::steps
### 보낸 사람 확인하기

[Amazon SES 콘솔](https://console.aws.amazon.com/ses/) 에서 메일을 보낼 리전을 고르고, **Identities** 에서 보내는 주소나 그 도메인을 확인합니다. 계정이 SES 샌드박스에 있는 동안에는 받는 사람도 하나하나 확인하거나 프로덕션 액세스를 요청하세요.

### 액세스 키 만들기

OneUptime용 IAM 사용자를 만들어 확인한 자격 증명에 대해 `ses:SendEmail` 을 허용하는 정책을 붙인 다음, 이 사용자의 액세스 키를 만듭니다.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ses:SendEmail",
      "Resource": "arn:aws:ses:us-east-1:123456789012:identity/example.com"
    }
  ]
}
```

### Amazon SES 단계 채우기

**액세스 키 ID** 와 **비밀 액세스 키**, 그리고 자격 증명을 확인한 **지역** (예: `us-east-1`) 을 입력합니다.
:::

## SendGrid

SendGrid에서 **Settings > API Keys** 를 열어 **Mail Send** 액세스 권한이 있는 키를 만들고, 보내는 주소는 Single Sender Verification으로, 또는 그 도메인은 Domain Authentication으로 인증합니다. 이 키를 **SendGrid** 단계의 **API 키** 로 입력합니다.

## Mailgun

Mailgun에서 `mg.example.com` 같은 보내는 도메인을 추가하고 인증한 다음, 그 도메인의 sending key를 만들거나 계정의 API 키를 사용합니다. **Mailgun** 단계에서 **API 키** 와 **도메인** 을 입력하고, 도메인을 만든 **지역** 을 고릅니다: Mailgun의 EU 리전에 있는 도메인이면 `EU`, 그 밖의 도메인이면 `US` 입니다. **보낸 사람 이메일** 은 그 도메인의 주소여야 합니다. 샌드박스 도메인은 승인된 받는 사람에게만 보냅니다.

## Postmark

Postmark에서 메일을 보내는 서버를 열고 **API Tokens** 탭에서 서버 API 토큰을 복사합니다. 계정 토큰으로는 보낼 수 없습니다. 이 토큰을 **Postmark** 단계의 **서버 API 토큰** 으로 입력합니다. **보낸 사람 이메일** 은 확인된 보낸 사람 서명이거나 인증된 도메인의 주소여야 합니다. Postmark가 계정을 승인하기 전까지는 자신의 도메인에 있는 주소로만 보냅니다.

## Resend

Resend의 **Domains** 에서 도메인을 추가하고 인증한 다음, **API Keys** 에서 보내기 권한이 있는 API 키를 만듭니다. 이 키를 **Resend** 단계의 **API 키** 로 입력하고, **보낸 사람 이메일** 에는 인증된 도메인의 주소를 입력합니다. Resend 자체의 테스트 도메인은 자신의 주소로만 보냅니다.

## 문제 해결

테스트 이메일을 보내지 못하면 그 이유가 표시됩니다. 그 밖의 메일은 **프로젝트 설정 > 알림 > 알림 로그** 의 **이메일** 탭을 열고 해당 행에서 **상태 메시지 보기** 를 선택하세요.

:::details "Amazon SES needs a verified identity in …"
**보낸 사람 이메일** 이나 그 도메인이 구성에 설정된 리전에서 확인되지 않았거나, 계정이 SES 샌드박스에 있는데 받는 사람이 확인되지 않았습니다. 그 리전에서 확인하거나 프로덕션 액세스를 요청하세요.
:::

:::details "Amazon SES does not recognize the access key" 또는 "did not accept the request's signature"
**액세스 키 ID** 와 그 키가 IAM에서 활성 상태인지, **비밀 액세스 키** 가 그 키와 함께 만든 것인지 확인하세요. 서버의 시계가 틀려도 서명이 거부됩니다.
:::

:::details "The access key may not send with Amazon SES"
IAM 사용자의 정책이 자격 증명에 대한 `ses:SendEmail` 을 허용하지 않습니다. 위의 정책을 추가하세요.
:::

:::details "Mailgun has no domain … in its US region"
도메인이 구성에서 보내는 리전에 없습니다. **도메인** 을 확인하고, 도메인을 EU 리전에서 만들었다면 **지역** 을 `EU` 로 설정하세요.
:::

:::details "is not a confirmed sender signature in Postmark" 또는 "is not a verified domain in Resend"
공급자의 대시보드에서 **보낸 사람 이메일** 을 보낸 사람으로 확인하거나 그 도메인을 인증하세요.
:::

:::details "did not accept the API key" 또는 "did not accept the server API token"
구성의 키를 확인하세요. SendGrid의 키에는 Mail Send 액세스 권한이 필요하고, Mailgun의 sending key는 자신의 도메인에서만 작동하며, Postmark에는 서버의 토큰이 필요하고, Resend의 키에는 보내기 권한이 필요합니다.
:::

## 다음 단계

:::cards
- [SMTP](/docs/emails/smtp): 대신 자체 메일 서버나 Microsoft 365를 통해 보냅니다.
- [구독자 및 공지](/docs/status-pages/subscribers): 프로젝트의 SMTP 구성으로 상태 페이지 구독자에게 메일을 보냅니다.
:::
