# 업데이트 및 보안 확인

자체 호스팅 OneUptime은 하루에 한 번 GitHub에 새 릴리스가 나왔는지, 그리고 OneUptime이 게시한 보안 권고가 실행 중인 버전에 영향을 주는지 묻습니다. 영향을 주는 권고가 있으면 마스터 관리자에게 업그레이드를 요청합니다. 이 페이지에서는 이 확인이 보내는 내용, 화면에 표시되는 내용, 확인을 끄는 방법을 설명합니다.

:::cards
- [확인이 보내는 내용](#확인이-보내는-내용): 공개 정보에 관한 두 가지 질문뿐이며, 설치에 관한 정보는 보내지 않습니다.
- [표시되는 내용](#표시되는-내용): 바닥글, 관리자 대시보드, 그리고 권고마다 한 통의 이메일.
- [확인 끄기](#확인-끄기): 인터넷에 연결되지 않는 네트워크에서, 또는 미러를 사용하려는 경우.
:::

## 확인이 보내는 내용

워커는 토큰 없이 GitHub API(`api.github.com`)에 다음 두 가지 요청을 보냅니다:

| 요청 | 묻는 내용 |
| --- | --- |
| `GET /repos/OneUptime/oneuptime/releases/latest` | 최신 OneUptime 릴리스가 무엇인지 |
| `GET /repos/OneUptime/oneuptime/security-advisories?state=published` | OneUptime이 게시한 보안 권고, 각 권고가 영향을 주는 버전, 그리고 이를 수정하는 릴리스 |

이 요청에는 설치에 관한 정보가 전혀 담기지 않습니다. 실행 중인 버전도, 설치의 주소도, 사용자, 프로젝트, 모니터링 데이터에 관한 정보도 없습니다. GitHub는 다른 모든 요청에서처럼 서버의 공인 IP 주소와, OneUptime이라는 이름이 담긴 `User-Agent`를 봅니다. 권고가 실행 중인 버전에 영향을 주는지는 서버에서 판단하며, 어떤 브라우저도 GitHub를 호출하지 않습니다.

확인은 워커가 시작될 때 실행되고, 그 뒤로는 하루에 한 번 실행됩니다. GitHub에 다시 묻는 간격은 최소 12시간이며, 요청이 실패한 뒤에는 최소 1시간입니다.

## 표시되는 내용

알림은 마스터 관리자에게만 갑니다. 업그레이드할 수 있는 사람이 마스터 관리자이고, 다른 사람에게 서버가 알려진 보안 문제가 있는 버전을 실행 중이라고 알리면 패치되지 않은 서버를 알려 주는 셈이 되기 때문입니다.

- 새 릴리스가 나오면 Dashboard와 관리자 대시보드의 바닥글에 **업데이트 가능**이 추가됩니다. 이를 누르면 업그레이드 가이드가 열립니다.
- 실행 중인 버전에 영향을 주는 게시된 보안 권고가 있으면 그 자리에 대신 빨간색 **보안 업데이트**가 추가됩니다.
- 그러면 관리자 대시보드의 첫 페이지에 각 권고의 심각도, 영향을 받는 버전, 이를 수정하는 릴리스, GitHub의 권고 링크가 나열됩니다. 또한 확인이 마지막으로 권고를 읽은 시각과, 최근 확인이 실패했다면 그 이유도 표시됩니다.
- 마스터 관리자와 관리자 알림 이메일(관리자 대시보드의 **설정** > **이메일**)은 실행 중인 버전에 영향을 주는 권고마다 이메일을 한 통씩 받으며, 같은 권고로 두 번째 이메일을 받는 일은 없습니다.

어떤 권고도 영향을 주지 않는 버전을 실행하면 이 모든 것이 바로 사라집니다. 업그레이드 방법은 [업그레이드](/docs/installation/upgrading)를 참고하세요.

## 확인 끄기

인터넷에 연결되지 않는 네트워크에 있거나 서버가 GitHub에 연결하면 안 되는 경우에는 확인을 끄세요. 그러면 아무것도 표시되지 않고 이메일도 보내지 않습니다.

:::tabs
@tab Kubernetes
```yaml
updateCheck:
  disabled: true
```
@tab Docker Compose
```bash
DISABLE_UPDATE_CHECK=true
```
`config.env`에 설정한 다음 `npm start`를 실행하세요.
:::

대신 네트워크 안의 미러와 대조하려면 확인이 미러를 가리키게 하세요. 미러는 GitHub와 같은 형식으로 응답해야 합니다.

| Helm 값 | Docker Compose 설정 | 기본값 |
| --- | --- | --- |
| `updateCheck.url` | `LATEST_RELEASE_CHECK_URL` | `https://api.github.com/repos/OneUptime/oneuptime/releases/latest` |
| `updateCheck.securityAdvisoriesUrl` | `SECURITY_ADVISORIES_CHECK_URL` | `https://api.github.com/repos/OneUptime/oneuptime/security-advisories` |

## GitHub에 연결할 수 없을 때

인터넷에 연결되지 않는 네트워크에서는 요청 실패가 오류가 아니라 예상된 일입니다. 워커는 이를 debug 수준으로 로그에 남기고, 마지막으로 읽은 내용을 유지한 채 나중에 다시 시도합니다. 관리자 대시보드에는 권고를 마지막으로 읽은 시각과 최근 확인이 실패한 이유가 표시됩니다. 이유는 GitHub의 속도 제한, GitHub로 가는 경로 없음, 시간 초과, GitHub가 아닌 곳의 응답 중 하나입니다.

## 다음 단계

:::cards
- [업그레이드](/docs/installation/upgrading): 메이저 버전을 한 번에 하나씩, 새 릴리스로 업그레이드합니다.
- [아키텍처](/docs/self-hosted/architecture): 자체 호스팅 OneUptime이 만드는 모든 연결.
- [VPN 또는 방화벽 뒤에서 운영](/docs/self-hosted/behind-a-firewall): 외부에서 서버에 도달하는 것.
:::
