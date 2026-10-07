# Microsoft Teams를 OneUptime에 연결하기

### OneUptime을 Microsoft Teams에 연결하는 단계

1. **OneUptime에서 계정 생성**

   - [OneUptime.com](https://oneuptime.com)을 방문하여 계정을 생성합니다.
   - 계정이 생성되면 새 프로젝트를 생성합니다.

2. **Microsoft Teams를 OneUptime 프로젝트에 연결**

   - OneUptime 프로젝트 내에서 **프로젝트 설정** > **Microsoft Teams**로 이동합니다.
   - 프롬프트에 따라 Microsoft Teams 계정을 OneUptime 프로젝트에 연결합니다.

3. **인시던트 알림 구성**

   - Microsoft Teams 계정을 연결한 후 **인시던트 페이지** > **Microsoft Teams**로 이동합니다.
   - Microsoft Teams로 인시던트 알림을 전송하기 위한 규칙을 추가합니다. 예를 들어 인시던트가 생성될 때 Teams 채널에 메시지를 게시하는 규칙을 만들 수 있습니다.

4. **알림 및 예정 유지보수 알림 구성**
   - 알림 및 예정 유지보수의 경우 해당 페이지로 이동하여 원하는 규칙을 구성하면 동일한 규칙을 적용할 수 있습니다.

## 규칙 테스트하기

규칙 행의 **테스트 규칙**은 그 규칙의 테스트 메시지를 규칙이 지정한 채널에 게시하여 도착하는 것을 확인할 수 있게 합니다. 이벤트마다 채널을 만드는 규칙이라면 테스트도 채널을 하나 만들고 규칙의 사람들을 초대합니다.

**프로젝트 설정** > **Workspace** > **Microsoft Teams**에서 채널 옆의 **테스트 보내기**와 마찬가지로, 알림 규칙을 만들 권한이 필요합니다: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member**, 또는 사용자 지정 역할의 **Create Workspace Notification Rule** 및 **Read Workspace Notification Rule**. 규칙을 보기만 할 수 있는 사람(예: **Viewer**)에게는 **테스트 규칙**이 잠겨 있고 툴팁이 무엇이 필요한지 알려 줍니다. API는 그 사람의 테스트를 "You do not have permission to send test notifications in this project."로 거부합니다. OneUptime Cloud에서는 규칙을 추가할 때와 마찬가지로 규칙을 테스트하려면 **Growth** 요금제가 필요합니다.

OneUptime Cloud에서는 채널이나 채팅 옆의 **테스트 보내기**에도 **Growth** 요금제가 필요합니다. 채널에 게시하는 것은 규칙과 요약이 하는 일이기 때문입니다. 요약의 **지금 테스트 보내기**에는 요약을 만들 권한(사용자 지정 역할의 **Create Workspace Notification Summary** 및 **Read Workspace Notification Summary**)과, OneUptime Cloud에서는 **Growth** 요금제가 필요합니다. 그 밖의 사람에게는 잠겨 있고 툴팁이 무엇이 필요한지 알려 줍니다. 읽기 전용으로 연결된 MCP 클라이언트는 어떤 테스트도 보낼 수 없습니다.

## 요약

**인시던트** > **Workspace** > **Microsoft Teams**(그리고 **알림**)의 **Summary** 탭은 지정한 채널에 정기적인 요약을 게시합니다. 인시던트나 알림이 몇 건이었는지, 얼마나 빨리 확인되고 해결되었는지, 링크가 포함된 목록이 담깁니다. 새 요약은 매주 전송되며 최근 7일을 다룹니다. **첫 보고서 전송 시각**을 비워 두면 첫 요약은 다음 주, 다음 날 또는 다음 달이 시작될 때 09:00에 전송되며, 언제인지 양식에 표시됩니다.

요약은 **시간대**의 시계를 따르며, 시간대는 처음에 사용자의 시간대로 설정됩니다. 요약은 그 시간대에서 일 년 내내 같은 시각을 유지합니다. 베를린 09:00으로 설정한 요약은 서머타임으로 시계가 바뀐 뒤에도 베를린 시간 09:00에 전송되고, 메시지의 날짜도 베를린 기준입니다. API에서는 `timezone`을 `Europe/Berlin` 같은 IANA 시간대 이름으로 보냅니다. 시간대 없이 만든 요약은 만든 사람의 프로필 시간대를 사용하고, API 키로 만들면 UTC를 사용합니다.

## 자체 호스팅 배포의 네트워크 액세스

아웃바운드 연결, 인바운드 콜백 및 비공개 배포에 대한 자세한 내용은 [Microsoft Teams 통합](/docs/self-hosted/microsoft-teams-integration)의 네트워크 액세스 섹션을 참조하세요.
