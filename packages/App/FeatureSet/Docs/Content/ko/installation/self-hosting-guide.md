# 자체 호스팅 가이드

이 페이지를 위에서 아래로 따라가면 빈 서버에서 시작해, HTTPS로 실행되고 테스트 이메일을 보냈으며 여러분에게 알림을 보낼 수 있는 자신만의 OneUptime에 도달합니다. 각 단계는 제대로 되었는지 확인하는 방법으로 끝나며, 자세한 내용은 더 긴 페이지로 연결됩니다.

:::cards
- [OneUptime 설치](#oneuptime-설치): 서버 한 대에서 Docker Compose, 또는 Kubernetes에서 Helm 차트.
- [서버 설정 마치기](#서버-설정-마치기): 이메일, 그다음 SMS와 전화, 각각 테스트와 함께.
- [설치 확인하기](#설치-확인하기): 무엇이 잘못되었는지 알려 주는 명령 하나.
- [빠른 시작](/docs/introduction/quickstart): 첫 모니터, 첫 온콜 정책, 첫 상태 페이지.
:::

## 필요한 것

- **서버.** Docker Compose라면 OneUptime을 시험해 보는 데 메모리 8 GB, 4코어, 디스크 20 GB인 Linux 서버, 팀용으로는 16 GB, 8코어, 400 GB가 필요합니다: [사이징 및 용량 계획](/docs/installation/sizing)을 참고하세요. Helm 차트라면 Kubernetes 클러스터가 필요합니다.
- **도메인 이름.** 사람들이 OneUptime을 열 때 쓸 `oneuptime.example.com` 같은 이름과, 서버를 가리키는 DNS `A` 레코드가 필요합니다. 서버의 IP 주소로 시작할 수도 있지만, Let's Encrypt 인증서에는 도메인 이름이 필요합니다.
- **포트 80과 443.** HTTPS를 위해 인터넷에서 접근할 수 있어야 합니다.
- **이메일을 보낼 방법.** 회사 메일 서버, Microsoft 365, Google Workspace 같은 메일 서버, 또는 Amazon SES, SendGrid, Mailgun, Postmark, Resend 계정.
- **Twilio 계정.** SMS와 전화로 알림을 받는 데 필요합니다. 이메일과 푸시 알림에는 필요 없습니다.

**제대로 되었다면** `dig +short oneuptime.example.com`이 서버의 IP 주소를 출력합니다.

## OneUptime 설치

:::tabs
@tab Docker Compose
새 Ubuntu, Debian 또는 RHEL 계열 서버에서는 명령 하나로 없는 Docker, Git, Node.js를 설치하고, OneUptime을 `oneuptime` 폴더에 클론하고, 사람들이 쓸 주소를 묻고, 시작까지 합니다:

```bash
curl -fsSL https://oneuptime.com/install.sh | bash
```

같은 작업을 직접 하려면 Docker, Git, Node.js를 설치한 뒤 다음을 실행합니다:

```bash
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime
cp config.example.env config.env
```

`config.env`를 열고 첫 번째 설정인 `HOST`를 도메인 이름이나 IP 주소로 설정합니다. `http://`는 붙이지 않습니다. 반드시 바꿔야 하는 설정은 이것뿐입니다. 이메일, SMS, 전화는 Admin Dashboard에서 설정하고, `ADVANCED` 아래의 모든 설정은 그대로 동작합니다. 그다음 OneUptime을 시작합니다:

```bash
npm start
```

**제대로 되었다면** `npm start`가 **OneUptime is up!**와 열어야 할 주소로 끝납니다. 첫 시작은 Docker가 이미지를 내려받는 동안 몇 분 걸립니다. `npm start`가 그 전에 멈추면 무엇을 바꿔야 하는지 알려 줍니다. 자세한 내용은 [Docker Compose](/docs/installation/docker-compose)에 있습니다.
@tab Kubernetes
도메인 이름이나 IP 주소를 `http://` 없이 적은 `values.yaml`을 만듭니다:

```yaml title="values.yaml"
host: oneuptime.example.com
```

차트는 클러스터의 기본 스토리지 클래스에 데이터를 저장합니다. `kubectl get storageclass`가 어느 것도 `(default)`로 표시하지 않으면, 그중 하나의 이름으로 `global.storageClass`를 추가합니다. 그다음 차트를 설치합니다:

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime -f values.yaml
```

**제대로 되었다면** `kubectl get pods`가 모든 파드를 `Running`으로 보여 주고, `helm install`이 출력한 주소에서 OneUptime이 열립니다. 자세한 내용은 [차트 설치 가이드](https://github.com/OneUptime/oneuptime/blob/main/HelmChart/Public/oneuptime/docs/installation.md)에 있습니다.
:::

## HTTPS 켜기

도메인 이름이 서버를 가리키게 되면 OneUptime이 Let's Encrypt에서 무료 인증서를 받게 하세요. 인증서 갱신도 OneUptime이 직접 합니다.

:::tabs
@tab Docker Compose
`config.env`에 다음 값을 설정한 뒤 `npm start`를 다시 실행합니다:

```ini title="config.env"
HOST=oneuptime.example.com
PROVISION_SSL=true
HTTP_PROTOCOL=https
```

Caddy, Nginx, 로드 밸런서 같은 리버스 프록시를 이미 쓰고 있나요? `PROVISION_SSL=false`를 그대로 두고, `HTTP_PROTOCOL=https`와 `TRUSTED_PROXY_HOPS=2`를 설정한 뒤 [직접 운영하는 리버스 프록시 사용](/docs/installation/docker-compose#직접-운영하는-리버스-프록시-사용)을 참고하세요.
@tab Kubernetes
`values.yaml`에 다음 값을 설정한 뒤 적용합니다:

```yaml title="values.yaml"
host: oneuptime.example.com
httpProtocol: https
ssl:
  provision: true
```

```bash
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

대신 직접 운영하는 인그레스 컨트롤러에서 TLS를 종료하려면 `ssl.provision`을 끈 채로 두고 `httpProtocol: https`만 설정합니다.
:::

**제대로 되었다면** `https://oneuptime.example.com`이 인증서 경고 없이 열립니다. 첫 인증서는 보통 몇 분 안에 도착합니다. `localhost`에서 OneUptime을 시험하는 중인가요? 이 단계는 건너뛰세요. 인증서에는 도메인 이름이 필요합니다.

## 관리자 계정 만들기

`https://oneuptime.example.com` 같은 주소를 열고 가입합니다. 새 서버의 첫 계정은 마스터 관리자가 되며, `/admin`에서 Admin Dashboard를 열 수 있습니다.

**제대로 되었다면** `/admin`에서 Admin Dashboard가 열립니다. 이메일, HTTPS, 가입에 대한 선택이 남아 있는 동안에는 **이 서버 설정 마치기** 화면으로 열립니다.

## 서버 설정 마치기

Admin Dashboard의 **서버 설정** 페이지(`/admin/setup`)는 새 서버에 필요한 것을 중요한 순서대로 보여 줍니다. 이메일, HTTPS, 가입할 수 있는 사람은 필수입니다. SMS와 전화, 글로벌 프로브, 백업, 업데이트 확인은 권장 사항입니다. 각 항목에는 설정하는 곳을 여는 버튼이 있고, `npm start`는 마지막에 이 페이지의 주소를 출력합니다.

:::steps
### 이메일 설정

**이메일 설정**을 클릭합니다. **설정 > 알림 > 이메일**이 열리면 메일 서버(대부분 포트 `587` 사용)나 이메일 제공업체, 그리고 이메일을 보낼 주소를 입력합니다. 저장한 뒤 **테스트 이메일 보내기**를 클릭해 자신에게 한 통 보냅니다.

**제대로 되었다면** 이메일이 도착하고 체크리스트에서 이메일이 완료로 표시됩니다. 테스트가 실패하면 메일 서버가 응답한 내용을 보여 줍니다: [SMTP](/docs/emails/smtp#문제-해결)를 참고하세요.

### 가입할 수 있는 사람 선택

주소를 열 수 있는 사람은 누구나 가입할 수 있습니다. 팀의 계정이 다 만들어지면 **설정 > 인증**에서 **가입 허용**을 끄세요. 프로젝트에 초대한 사람은 그래도 참여할 수 있습니다. 가입을 열어 두려면 **가입을 열어 둡니다**를 클릭합니다.

**제대로 되었다면** 체크리스트에서 가입이 완료로 표시됩니다.

### SMS와 전화 설정, 또는 이메일과 푸시만 사용

SMS와 전화로 알림을 받으려면 **SMS와 전화 설정**을 클릭하고 **설정 > 알림 > 전화 및 SMS**에서 Twilio 계정을 추가합니다. 각 값을 찾는 곳은 [Twilio 통합](/docs/self-hosted/twilio-integration)에 나와 있습니다. 그다음 **테스트 SMS 보내기**와 **테스트 전화 걸기**를 클릭합니다. 대신 직접 운영하는 게이트웨이로 보내려면 [SMS 및 통화 게이트웨이](/docs/self-hosted/sms-and-call-gateway)를 참고하세요. 이메일과 푸시 알림으로 충분하다면 **이메일과 푸시만 사용**을 클릭합니다.

**제대로 되었다면** SMS가 도착하고 전화가 울리거나, 체크리스트에 여러분의 선택이 표시됩니다.
:::

HTTPS 항목은 [HTTPS 켜기](#https-켜기)가 동작하면 완료되고, 권장 항목마다 무엇을 해야 하는지 안내합니다.

## 설치 확인하기

:::tabs
@tab Docker Compose
`oneuptime` 폴더에서 doctor를 실행합니다:

```bash
npm run doctor
```

모든 컨테이너, `config.env`, `HOST`가 이 서버에 도달하는지, 인증서와 남은 디스크를 확인하고, 이메일과 프로브처럼 OneUptime이 스스로 보는 상태를 묻습니다. 문제마다 해결 방법이 함께 나옵니다: [설치 확인하기](/docs/installation/docker-compose#설치-확인하기)를 참고하세요.
@tab Kubernetes
[차트 문제 해결 가이드](https://github.com/OneUptime/oneuptime/blob/main/HelmChart/Public/oneuptime/docs/troubleshooting.md#run-it)에 나온 대로 차트의 진단 스크립트를 클러스터에 대해 실행합니다. 읽기만 하며, 찾은 내용을 심각한 순서로 요약하며 끝납니다.
:::

**제대로 되었다면** doctor가 **Everything looks right.**로 끝나고 `0`으로 종료합니다. 고칠 것이 있으면 `1`로, 확인을 실행하지 못하면 `2`로 종료합니다. Kubernetes에서는 요약에 `CRITICAL` 항목이 없습니다.

## 무언가를 모니터링하고 알림 받기

이제 서버는 이메일을 보내고 사람들에게 알림을 보낼 수 있습니다. [빠른 시작](/docs/introduction/quickstart)은 제품 안에서 이어집니다. 웹사이트 모니터, 사이트가 다운되면 알림을 보내는 온콜 정책, 상태 페이지를 약 15분 만에 만듭니다. 마지막 부분에서 테스트 인시던트를 선언하므로 알림이 도착하는 것을 볼 수 있습니다.

## 문제 해결

:::details npm start가 멈추고 HOST가 아직 주소가 아니라고 표시함
`config.env`의 `HOST`에 `<your-address>` 같은 자리표시자가 남아 있습니다. 도메인 이름이나 IP 주소를 `http://` 없이 설정하고 `npm start`를 다시 실행하세요.
:::

:::details 테스트 이메일이 실패함
버튼 아래의 메시지는 메일 서버의 응답입니다. 호스트 이름, 포트, 사용자 이름, 비밀번호를 확인하고, 메일 서버가 이메일을 보내는 주소로 발송을 허용하는지 확인하세요. [SMTP](/docs/emails/smtp#문제-해결)를 참고하세요.
:::

:::details 브라우저가 인증서에 대해 경고함
Let's Encrypt에는 인터넷에서 접근할 수 있는 포트 80과 443, 그리고 이 서버를 가리키는 도메인 이름이 필요합니다. 몇 분 기다린 뒤 `npm run doctor`를 실행하세요. 인증서를 확인하고 무엇이 잘못되었는지 알려 줍니다.
:::

## 다음 단계

:::cards
- [빠른 시작](/docs/introduction/quickstart): 모니터, 온콜 정책, 상태 페이지를 15분 만에.
- [Docker Compose](/docs/installation/docker-compose): 직접 운영하는 프록시, 백업, 업데이트, 운영 환경 체크리스트.
- [업그레이드](/docs/installation/upgrading): 새 릴리스로, 한 번에 메이저 버전 하나씩 옮겨 갑니다.
- [아키텍처](/docs/self-hosted/architecture): OneUptime의 구성 요소가 어떻게 맞물리는지.
:::
