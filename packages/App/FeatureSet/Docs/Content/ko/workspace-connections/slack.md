# Slack을 OneUptime에 연결하기

### OneUptime을 Slack에 연결하는 단계

1. **OneUptime에서 계정 생성**

   - [OneUptime.com](https://oneuptime.com)을 방문하여 계정을 생성합니다.
   - 계정이 생성되면 새 프로젝트를 생성합니다.

2. **Slack을 OneUptime 프로젝트에 연결**

   - OneUptime 프로젝트 내에서 **프로젝트 설정** > **Slack**으로 이동합니다.
   - 프롬프트에 따라 Slack 계정을 OneUptime 프로젝트에 연결합니다.

3. **인시던트 알림 구성**

   - Slack 계정을 연결한 후 **인시던트 페이지** > **Slack**으로 이동합니다.
   - Slack으로 인시던트 알림을 전송하기 위한 규칙을 추가합니다. 예를 들어 인시던트가 생성될 때 새 Slack 채널을 만들고 인시던트 담당자를 초대하는 규칙을 만들 수 있습니다.

4. **알림 및 예정 유지보수 알림 구성**
   - 알림 및 예정 유지보수의 경우 해당 페이지로 이동하여 원하는 규칙을 구성하면 동일한 규칙을 적용할 수 있습니다.

## 규칙 테스트하기

규칙 행의 **테스트 규칙**은 그 규칙의 테스트 메시지를 규칙이 지정한 채널에 게시하여 도착하는 것을 확인할 수 있게 합니다. 이벤트마다 채널을 만드는 규칙이라면 테스트도 채널을 하나 만들고 규칙의 사람들을 초대합니다.

**프로젝트 설정** > **Workspace** > **Slack**에서 채널 옆의 **테스트 보내기**와 마찬가지로, 알림 규칙을 만들 권한이 필요합니다: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member**, 또는 사용자 지정 역할의 **Create Workspace Notification Rule**. 규칙을 보기만 할 수 있는 사람(예: **Viewer**)에게는 테스트 알림을 보낼 권한이 없다고 안내합니다. OneUptime Cloud에서는 규칙을 추가할 때와 마찬가지로 규칙을 테스트하려면 **Growth** 요금제가 필요합니다.

## 자체 호스팅 배포의 네트워크 액세스

아웃바운드 연결, 인바운드 콜백 및 비공개 배포에 대한 자세한 내용은 [Slack 통합](/docs/self-hosted/slack-integration)의 네트워크 액세스 섹션을 참조하세요.
