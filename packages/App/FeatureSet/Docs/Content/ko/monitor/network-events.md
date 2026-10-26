# 네트워크 이벤트(syslog 및 SNMP 트랩)

라우터, 방화벽, 스위치, 액세스 포인트는 자신에게 일어난 일을 syslog에 기록합니다. 링크가 끊겼다, 터널이 내려갔다, 방화벽이 장애 조치되었다, 누군가 로그인했다 같은 내용입니다. 공급업체마다 표현이 다릅니다. 이 syslog를 OneUptime 프로브로 보내면 **이벤트** 페이지가 디바이스를 누가 만들었든 같은 말로 무슨 일이 있었는지 보여 주고, 같은 일이 다시 일어나면 알려 줍니다.

이벤트 페이지는 두 곳에 있습니다.

- **네트워크** -> **이벤트**: 전체 네트워크입니다. 모든 디바이스의 이벤트와, 아직 디바이스가 아니면서 syslog를 보내는 모든 주소를 한 페이지에 보여 줍니다.
- 디바이스의 **이벤트** 탭: 그 디바이스가 보고한 내용입니다.

## 이벤트 페이지에 표시되는 내용

- 기간 내 이벤트를 최신순으로 보여 줍니다. 각 행은 무슨 일이, 어느 디바이스에서, 무엇에(인터페이스, 터널, 게이트웨이) 일어났는지와 디바이스가 직접 쓴 표현을 알려 줍니다.
- **문제**, **복구**, **정보성**과 각각의 기간 내 건수입니다. 하나를 클릭하면 그 종류만 볼 수 있습니다.
- **모든 이벤트** 선택기와, 네트워크 페이지에서는 **All devices** 선택기로 목록을 더 좁힐 수 있습니다. 기간과 필터는 페이지 주소에 저장되므로, 링크를 열면 정확히 같은 화면이 열립니다.
- 이벤트를 클릭하면 열립니다. 언제 일어났는지, 무엇에 관한 것인지, 디바이스가 보낸 그대로의 메시지, 그리고 OneUptime이 거기서 읽어 낸 모든 속성을 볼 수 있습니다.
- **알림 만들기**는 대부분의 네트워크에 필요한 알림을 제안하고, **이 이벤트에 대한 알림 만들기**는 열어 둔 이벤트에 대한 알림을 만듭니다. [알림](#알림)을 참고하세요.

이벤트는 로그입니다. 이벤트 페이지에 있는 모든 것은 **로그**에서도 검색하고, 차트로 그리고, 알림을 걸 수 있습니다. 이벤트는 속성 `event.domain`이 `network`이고, 무슨 일이 있었는지가 `event.name`에 들어 있는 로그입니다.

## OneUptime이 읽는 것

RFC 3164 및 RFC 5424 형식의 syslog와 Common Event Format(CEF)은 어떤 제품의 것이든 읽습니다. 여기에 더해 OneUptime은 다음 제품이 기록하는 내용을 이해합니다.

| 공급업체 | 제품 | 읽는 이벤트 | 속성 |
| --- | --- | --- | --- |
| Cisco | IOS, IOS XE, NX-OS, ASA | 인터페이스, 디바이스, 고가용성, VPN, 라우팅, 하드웨어, 스위칭, 로그인 | `cisco.*` |
| Sophos | Sophos Firewall (SFOS, XG, XGS) | 인터페이스, 디바이스, 고가용성, VPN, WAN, 로그인 | `sophos.*` |
| Fortinet | FortiGate (FortiOS) | 인터페이스, 디바이스, 고가용성, VPN, WAN, 하드웨어, 로그인 | `fortigate.*` |
| Extreme Networks | ExtremeXOS, Switch Engine | 인터페이스, 디바이스, 고가용성, 라우팅, 하드웨어, 스위칭, 로그인 | `extreme.*` |
| Extreme Networks | Fabric Engine, VOSS | 인터페이스, 라우팅 | `extreme.*` |
| HPE Aruba Networking | AOS-CX | 인터페이스, 하드웨어 | `aruba.*` |
| HPE Aruba Networking | AOS-Switch (ArubaOS-Switch, ProCurve) | 인터페이스 | `aruba.*` |
| MikroTik | RouterOS | 인터페이스, 디바이스, 로그인 | `mikrotik.*` |
| Cambium Networks | Enterprise Wi-Fi (cnPilot, XV, XE, XH) | 디바이스, VPN, Wi-Fi | `cambium.*` |
| Ubiquiti | UniFi Network | 디바이스, WAN, 스위칭, 로그인, Wi-Fi | `cef.*` |
| 모두 | Linux 기반 디바이스(kernel, hostapd, OpenSSH, Dropbear) | 인터페이스, 로그인, Wi-Fi | - |

이 형식 중 하나로 된 메시지는 자체 필드가 마지막 열의 접두사 아래에 속성으로 저장됩니다. 예를 들어 Sophos 방화벽의 `con_name="HQ-Branch1"`은 속성 `sophos.con_name`이 됩니다. 그 밖의 제품에서 온 CEF 메시지는 헤더와 확장 필드가 `cef.*` 아래에 저장됩니다. OneUptime이 분류하지 못한 메시지도 syslog 헤더를 읽은 채 로그로 저장되며, 그 이벤트의 이름은 직접 지정할 수 있습니다. [나만의 이벤트](#나만의-이벤트)를 참고하세요.

표준 SNMP 트랩도 같은 이벤트로 읽습니다. `linkDown`과 `linkUp`은 **인터페이스 다운**과 **인터페이스 업**으로, `coldStart`와 `warmStart`는 **디바이스 재시작됨**으로 바뀝니다.

## 이벤트

OneUptime이 인식한 모든 메시지는 디바이스를 누가 만들었든 다음 이름 중 하나를 `event.name`에 담아 저장됩니다.

| 이벤트 | `event.name` | 종류 | 대상 |
| --- | --- | --- | --- |
| 인터페이스 다운 | `interface.down` | 문제 | `network.interface.name` |
| 인터페이스 업 | `interface.up` | 복구 | `network.interface.name` |
| 스위치가 포트를 차단함 | `interface.error_disabled` | 문제 | `network.interface.name` |
| 디바이스 재시작됨 | `device.reboot` | 문제 | - |
| 구성 변경됨 | `device.config_change` | 정보성 | `user.name` |
| 디바이스 오프라인 | `device.offline` | 문제 | - |
| 디바이스 온라인 | `device.online` | 복구 | - |
| 장애 조치 | `ha.failover` | 문제 | `ha.role` |
| 고가용성 상태 변경됨 | `ha.state_change` | 정보성 | `ha.role` |
| 고가용성 피어 다운 | `ha.peer_down` | 문제 | `ha.peer` |
| 고가용성 피어 복구 | `ha.peer_up` | 복구 | `ha.peer` |
| VPN 터널 다운 | `vpn.tunnel_down` | 문제 | `vpn.tunnel.name` |
| VPN 터널 업 | `vpn.tunnel_up` | 복구 | `vpn.tunnel.name` |
| 라우팅 네이버 다운 | `routing.neighbor_down` | 문제 | `network.peer.address` |
| 라우팅 네이버 복구 | `routing.neighbor_up` | 복구 | `network.peer.address` |
| 게이트웨이 다운 | `gateway.down` | 문제 | `network.gateway.name` |
| 게이트웨이 복구 | `gateway.up` | 복구 | `network.gateway.name` |
| WAN 장애 조치 | `wan.failover` | 문제 | `network.gateway.name` |
| SD-WAN 링크가 SLA 미달 | `sdwan.sla_not_met` | 문제 | `network.gateway.name` |
| SD-WAN 링크가 SLA 범위로 복귀 | `sdwan.sla_met` | 복구 | `network.gateway.name` |
| 팬 고장 | `hardware.fan_failed` | 문제 | `hw.name` |
| 팬 다시 작동 | `hardware.fan_ok` | 복구 | `hw.name` |
| 전원 공급 장치 고장 | `hardware.power_supply_failed` | 문제 | `hw.name` |
| 전원 공급 장치 다시 작동 | `hardware.power_supply_ok` | 복구 | `hw.name` |
| 온도가 너무 높음 | `hardware.temperature_high` | 문제 | - |
| 루프 감지됨 | `loop.detected` | 문제 | `network.interface.name` |
| 스패닝 트리 토폴로지 변경 | `stp.topology_change` | 정보성 | - |
| PoE 장애 | `poe.fault` | 문제 | `network.interface.name` |
| 로그인 실패 | `auth.login_failed` | 문제 | `user.name` |
| 로그인함 | `auth.login_success` | 정보성 | `user.name` |
| Wi-Fi 클라이언트 연결됨 | `wireless.client_connected` | 정보성 | `client.mac` |
| Wi-Fi 클라이언트 연결 끊김 | `wireless.client_disconnected` | 정보성 | `client.mac` |

마지막 열은 이벤트가 무엇에 관한 것인지 알려 주는 속성입니다. 모든 제품이 모든 이벤트를 보고하지는 않습니다. 스위치에는 VPN 터널이 없고, 제품의 syslog가 알려 주는 내용에도 한계가 있습니다.

모든 이벤트에는 다음 속성도 있습니다.

| 속성 | 담긴 내용 |
| --- | --- |
| `event.domain` | `network`. 모든 네트워크 이벤트에 붙습니다 |
| `event.kind` | `problem`, `recovery` 또는 `info` |
| `event.category` | `interface`, `device`, `ha`, `vpn`, `routing`, `wan`, `hardware`, `switching`, `security` 또는 `wireless`(위 표의 이벤트) |
| `event.device` | 어느 디바이스인지: OneUptime에서의 이름, 없으면 디바이스가 스스로 밝힌 이름, 그것도 없으면 주소 |
| `event.message` | 디바이스가 한 말, 그 표현 그대로 |
| `syslog.vendor`, `syslog.parser` | 메시지를 어느 형식으로 읽었는지 |

## 이벤트가 도착하는 과정

모든 프로브는 포트 5140에서 UDP와 TCP로 syslog를 수신합니다. TCP에서는 메시지가 한 줄이거나, RFC 6587이 설명하는 대로 앞에 길이가 붙습니다. 프로브는 받은 것을 몇 초마다 OneUptime으로 전달하고, OneUptime은 메시지가 온 주소로 각 메시지를 디바이스에 연결합니다.

1. 프로브가 폴링하는 디바이스 중 호스트 이름이 그 주소이거나(또는 그 주소로 확인되거나), **설정** 페이지의 **기타 주소**에 그 주소가 있는 디바이스.
2. 내 (사용자 지정) 프로브에서는, 그 주소를 가진 프로젝트의 모든 디바이스, 또는 메시지에 담긴 호스트 이름을 가진 디바이스(그 이름의 디바이스가 정확히 하나일 때).
3. 그 밖의 경우, 내 프로브에서는 어느 디바이스의 것인지 지정할 때까지 메시지가 네트워크 이벤트 페이지의 **syslog를 보내는 중, 아직 디바이스가 아님**에 보관됩니다. 글로벌 프로브는 이를 버립니다.

알 수 없는 주소에서 온 줄 가운데 syslog 우선순위가 없고 이벤트도 아닌 것은 노이즈로 보고 버립니다.

컨트롤러는 자신이 관리하는 디바이스를 대신해 보고합니다. UniFi 콘솔은 자신의 액세스 포인트와 스위치에 대해 보고합니다. 한 디바이스에서 온 메시지가 다른 디바이스를 MAC 주소, 일련번호, 주소 또는 컨트롤러가 붙인 이름으로 가리키면 이벤트는 그 디바이스의 것이 되고, 로그에는 메시지를 전달한 컨트롤러의 이름이 `syslog.relay.name`에 남습니다.

로그는 프로브가 받은 시각으로 저장됩니다. 보류되었던 메시지, 즉 자체 타임스탬프가 시간대를 포함하는 RFC 5424 형식이고 5분보다 오래된 메시지는 7일 전까지 디바이스의 시각을 그대로 유지합니다. 그 밖에 프로브의 시계와 5분 넘게 차이 나는 타임스탬프는 믿지 않습니다. 로그는 받은 시각으로 저장되고, 디바이스의 시각은 `syslog.deviceTime`에 남습니다.

HTTPS로 [syslog 엔드포인트](/docs/telemetry/syslog)에 보낸 syslog도 같은 파서가 읽습니다. 이 경우 메시지는 네트워크 공급업체 고유의 형식일 때, 또는 네트워크 디바이스 중 하나를 MAC 주소, 일련번호, 주소 또는 호스트 이름으로 가리킬 때 네트워크 이벤트가 됩니다. 서버의 `sshd` 줄은 일반 로그로 남습니다.

## 설정하기

1. **디바이스 네트워크에 있는 프로브를 사용하세요.** syslog는 디바이스가 보내므로, 디바이스가 도달할 수 있는 [사용자 지정 프로브](/docs/probe/custom-probe)가 필요합니다. 공용 인터넷의 글로벌 프로브는 이를 받지 못합니다.
2. **syslog가 프로브에 도달하게 하세요.** 디바이스에서 프로브로 가는 포트 5140(UDP 또는 TCP)을 허용합니다. 사용자 지정 프로브 페이지처럼 호스트 네트워크(`--network host`)로 시작한 Docker 프로브는 그대로 받을 수 있고, 호스트 네트워크 없이 실행한다면 `-p 5140:5140/udp -p 5140:5140/tcp`로 포트를 게시하세요. 포트 514로만 보낼 수 있는 디바이스라면 `-p 514:5140/udp`로 게시하거나, 호스트 네트워크를 쓰는 프로브에 `PROBE_SYSLOG_RECEIVER_PORT=514`를 설정하세요.
3. **프로브를 디바이스의 syslog 서버로 설정하세요.** 주요 디바이스의 명령은 아래에 있습니다. 첫 메시지가 도착할 때까지 **이벤트** 페이지에도 같은 단계가 표시되고, 도착하면 저절로 목록으로 바뀝니다.
4. **디바이스 주소를 확인하세요.** 메시지는 디바이스가 보낸 주소로 연결됩니다. 호스트 이름이 아닌 루프백이나 관리 인터페이스에서 보낸다면, 그 주소를 디바이스의 **기타 주소**에 추가하세요.

syslog 수신기는 기본적으로 켜져 있습니다. 설정은 프로브의 환경 변수입니다.

| 변수 | 하는 일 | 기본값 |
| --- | --- | --- |
| `PROBE_SYSLOG_RECEIVER_ENABLED` | `false`로 설정하면 syslog 수신기를 끕니다 | `true` |
| `PROBE_SYSLOG_RECEIVER_PORT` | UDP와 TCP에 쓰는 포트 | `5140` |
| `PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE` | 모든 디바이스를 합쳐 분당 전달하는 메시지 수 | `600` |

한도를 넘어도 프로브는 네트워크 이벤트로 읽히는 메시지를 같은 수만큼 더 전달합니다. 일상적인 줄이 쏟아져도 링크가 끊겼다는 한 줄이 밀려나지 않게 하기 위해서입니다. 이 기능보다 오래된 프로브는 `PROBE_SYSLOG_RECEIVER_ENABLED=true`로 시작했을 때만, 그리고 UDP로만 수신합니다. 프로브를 업데이트하세요.

### Cisco IOS, IOS XE 및 NX-OS

```text
logging host <probe-address> transport udp port 5140
logging trap informational
service timestamps log datetime msec
```

두 번째 줄은 정보성 메시지와 그보다 심각한 모든 메시지를 보냅니다. 링크 변화, 재시작, 로그인이 여기에 포함됩니다. NX-OS에서는 `logging server <probe-address> 6 port 5140 use-vrf management`를 사용합니다.

### Sophos Firewall

1. 방화벽의 웹 관리 화면에서 **System services** > **Log settings**를 열고, **Syslog servers**에서 **Add**를 선택합니다.
2. 프로브의 IP 주소와 포트 `5140`을 입력하고, 심각도 수준을 **Information**으로 설정합니다. 방화벽이 제공하는 두 로그 형식 모두 읽을 수 있습니다.
3. **Log settings**로 돌아가, 보낼 로그에 대해 새 서버를 선택합니다. 최소한 시스템 이벤트를, 그리고 SLA 변화를 보려면 **SD-WAN**을 선택하세요. 방화벽의 트래픽 로그는 양이 많으므로, 필요하지 않다면 빼 두세요.

### Fortinet FortiGate

```text
config log syslogd setting
    set status enable
    set server "<probe-address>"
    set port 5140
    set mode udp
    set format default
end
```

FortiGate는 로그 설정에서 선택한 것을 보냅니다. 이벤트 로그에는 터널, 링크, 장애 조치가 담깁니다. 트래픽 로그는 양이 많으므로, 필요하지 않다면 빼 두세요.

### Extreme Networks

```text
configure syslog add <probe-address>:5140 vr VR-Default local7
enable log target syslog <probe-address>:5140 vr VR-Default local7
enable syslog
```

`VR-Default`를 프로브에 도달하는 가상 라우터로 바꾸세요.

### HPE Aruba

```text
logging <probe-address> udp 5140 severity info
```

AOS-CX에서는 관리 포트를 통해 프로브에 도달한다면 줄에 `vrf mgmt`를 추가하세요. AOS-Switch에서는 `logging <probe-address> udp 5140`을 사용합니다.

### MikroTik RouterOS

```text
/system logging action set remote remote=<probe-address> remote-port=5140
/system logging add topics=info action=remote
/system logging add topics=warning action=remote
/system logging add topics=error action=remote
/system logging add topics=critical action=remote
```

첫 번째 줄은 라우터에 내장된 원격 작업이 프로브를 향하게 하고, 나머지 줄은 무엇을 보낼지 고릅니다. 원격 로그 형식은 그대로 두세요.

### Ubiquiti UniFi

1. UniFi Network에서 **Integration** > **System Logging / SIEM**을 열고 대상으로 **SIEM Server**를 선택합니다.
2. 프로브의 IP 주소와 포트 `5140`을 입력하고, 내보낼 로그 범주를 선택합니다.

콘솔은 자신이 관리하는 액세스 포인트와 스위치에 대해 보고합니다. 디바이스가 MAC 주소와 함께 OneUptime에 등록되어 있으면 이벤트가 그 디바이스의 페이지에 표시되고, 그렇지 않으면 콘솔의 페이지에 표시됩니다.

### Cambium Networks

1. cnMaestro 또는 액세스 포인트의 웹 인터페이스에서 시스템 설정을 열고 syslog 서버 항목을 찾습니다.
2. 프로브의 IP 주소를 syslog 서버로 입력하고, 양식에 포트 입력란이 있으면 `5140`을 지정한 뒤, syslog 심각도를 **Info**로 설정합니다.

포트를 설정할 수 없는 경우 액세스 포인트는 포트 514로 보냅니다. [설정하기](#설정하기)의 2단계처럼 프로브의 포트를 그 포트에 게시하세요.

### 기타 디바이스

디바이스에 원격 syslog 서버를 추가합니다. 프로브의 IP 주소, 포트 5140, UDP 또는 TCP로, 정보성 메시지와 그보다 심각한 모든 메시지를 보내도록 설정하세요. OneUptime이 형식을 모르는 디바이스의 메시지도 저장되며, 그 이벤트의 이름은 직접 지정할 수 있습니다.

## 알림

이벤트 페이지의 **알림 만들기**는 대부분의 네트워크에 필요한 알림을 나열합니다. 어느 것을 고르든 내용이 채워진 **모니터 생성** 화면이 열리고, 저장하기 전에 무엇이든 바꿀 수 있습니다.

| 알림 | 알려 주는 때 | 알림 단위 | 닫히는 때 |
| --- | --- | --- | --- |
| VPN 터널이 다운될 때 | `vpn.tunnel_down` | 디바이스와 터널 | 그 터널의 `vpn.tunnel_up` |
| 방화벽 또는 스위치가 장애 조치될 때 | `ha.failover` | 디바이스 | 다시 발생하지 않고 5분 경과 |
| WAN 링크가 다운될 때 | `gateway.down` | 디바이스와 게이트웨이 | 그 게이트웨이의 `gateway.up` |
| 라우팅 네이버가 다운될 때 | `routing.neighbor_down` | 디바이스와 네이버 | 그 네이버의 `routing.neighbor_up` |
| 디바이스가 재시작될 때 | `device.reboot` | 디바이스 | 다시 발생하지 않고 5분 경과 |
| 하드웨어가 고장 날 때 | 팬, 전원 공급 장치 또는 온도 | 디바이스와 구성 요소 | 같은 구성 요소가 다시 정상으로 보고됨 |
| 인터페이스가 다운될 때 | `interface.down` | 디바이스와 인터페이스 | 그 인터페이스의 `interface.up` |
| 누군가 계속 로그인에 실패할 때 | 10건을 넘는 `auth.login_failed`가 5분 안에 발생 | 디바이스 | 10건 이하인 채로 5분 경과 |

각각은 최근 5분 동안의 이벤트를 세는 [로그 모니터](/docs/monitor/logs-monitor)입니다. **Group by Attributes** 설정으로 터널, 게이트웨이, 인터페이스마다 별도의 알림이 생기고, **해결 기준 속성**에는 문제가 끝났음을 알리는 이벤트가 설정됩니다. 이런 알림은 같은 디바이스와 같은 터널에 대해 그 이벤트가 도착할 때까지, 아무리 오래 걸려도 열린 상태로 남습니다. [로그로 해결](/docs/monitor/logs-monitor#로그로-해결)을 참고하세요. OneUptime은 온도가 정상으로 돌아왔다는 이벤트를 읽지 않으므로, 온도 알림은 직접 해결할 때까지 열려 있습니다.

디바이스의 **이벤트** 탭에서 만든 모니터는 그 디바이스만 감시합니다. 그 밖의 이벤트는 이벤트 페이지에서 하나를 열고 **이 이벤트에 대한 알림 만들기**를 클릭하세요. 알림을 어딘가로 보내거나 누군가를 호출하려면, 다른 모니터와 마찬가지로 모니터에 온콜 정책이나 워크플로를 추가하세요.

## 아직 디바이스가 아닌 주소

syslog는 그것을 보내는 디바이스가 OneUptime에 추가되기 전에 도착할 수 있습니다. 내 프로브에서는 그 syslog가 보관되고, 이벤트는 디바이스가 스스로 밝힌 이름으로 네트워크 이벤트 페이지에 표시되며, 주소는 **syslog를 보내는 중, 아직 디바이스가 아님**에 나열됩니다.

- **디바이스로 추가**는 주소와 프로브가 채워진 **디바이스 추가** 화면을 엽니다. 이미 도착한 메시지는 네트워크 페이지에 남고, 새 메시지는 디바이스로 갑니다.
- **내 디바이스 중 하나입니다**는 그 주소를 디바이스의 **기타 주소**에 추가합니다. 이미 추가한 디바이스가 루프백 같은 다른 주소에서 보낼 때 사용하세요. 그 메시지는 다음 1분부터 그 디바이스로 갑니다.

하나의 NAT 주소 뒤에 있는 여러 디바이스는 그 주소를 공유하므로, 메시지가 자기 디바이스를 가리키지 않는 한 메시지는 그 주소를 가진 한 디바이스로 갑니다.

## 나만의 이벤트

OneUptime이 형식을 모르는 디바이스나 읽지 않는 이벤트에는 [로그 파이프라인](/docs/telemetry/log-pipelines)을 사용합니다.

1. `attributes.networkDevice.name = 'rack-ups'`처럼 필터가 그 디바이스의 로그와 일치하는 파이프라인을 만듭니다.
2. **Grok Parser** 또는 **Key=Value Parser**를 추가해 필요한 필드를 메시지에서 꺼냅니다.
3. **대상 속성**이 `event.name`인 **카테고리 프로세서**를 추가하고, 이벤트마다 규칙을 하나씩 만듭니다. 규칙 이름은 위의 이벤트처럼 소문자와 점 또는 밑줄로 짓습니다(예: `ups.on_battery`).

그런 이름이 붙은 네트워크 디바이스의 로그는 네트워크 이벤트가 됩니다. 이벤트 페이지에 표시되고, **이 이벤트에 대한 알림 만들기**도 사용할 수 있습니다. 무엇에 관한 이벤트인지 알리려면, 내 필드를 이벤트 표에 있는 속성 중 하나(예: `hw.name`)로 복사하는 **속성 리매퍼**를 추가하세요. 파이프라인이 `event.kind`를 `problem` 또는 `recovery`로 설정하지 않는 한 이벤트는 **정보성**에 나열됩니다. `interface.down`처럼 기본 제공 이벤트의 이름을 붙인 규칙은 종류와 알림까지 그대로인 기본 제공 이벤트를 만듭니다.

파이프라인은 자신의 프로젝트에 속합니다. 다른 프로젝트에서 쓰려면 같은 프로세서로 그 프로젝트에 만드세요.

## 포함되지 않는 것

- **TLS를 통한 syslog**(RFC 5425). 프로브는 암호화되지 않은 UDP와 TCP를 받습니다. 디바이스와 프로브 사이의 경로는 신뢰할 수 있는 네트워크 안에 두세요.
- **프로젝트 간 파서 공유.** 파이프라인은 아직 내보내고 가져올 수 없습니다.
- **표준 네 가지 외의 SNMP 트랩에서 나온 이벤트.** 공급업체 고유의 트랩은 로그로 저장되며, **SNMP Trap Received (Trap OID)** 기준을 사용해 [네트워크 장치 모니터](/docs/monitor/network-device-monitor)에서 알림을 걸 수 있습니다.
- **Cambium cnMatrix 스위치, Aruba 모빌리티 컨트롤러, CEF 모드의 FortiGate.** 메시지는 저장되고 검색할 수 있지만, 아직 이벤트로 읽지는 않습니다.
- **라이브 테일.** 이벤트 페이지는 열었을 때까지 도착한 것을 보여 줍니다. 새로고침 버튼을 사용하거나 **로그**의 라이브 테일을 사용하세요.

## 문제 해결

이벤트 페이지에 계속 설정 단계가 표시된다면:

- **프로브가 무엇이든 받고 있나요?** 네트워크 이벤트 페이지의 **syslog를 보내는 중, 아직 디바이스가 아님**에는 기간 내에 syslog를 보낸 모든 주소가 나열됩니다. 디바이스가 거기에 있다면 호스트 이름이 아닌 주소에서 보내고 있는 것입니다. 그 주소를 디바이스의 **기타 주소**에 추가하세요.
- **방화벽과 Docker.** 디바이스에서 프로브로 가는 포트 5140을 허용하고, 프로브가 Docker에서 실행된다면 포트를 게시하세요. 많은 디바이스는 따로 지정하지 않으면 포트 514로 보냅니다.
- **프로브의 로그.** 프로브는 시작할 때 수신하는 포트, 또는 포트를 열지 못했다는 사실을 로그에 남깁니다. `PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE`를 넘어 메시지를 버릴 때는 몇 건인지를 1분에 한 번 기록합니다.
- **글로벌 프로브.** 글로벌 프로브가 폴링하는 디바이스는 사설 네트워크에서 그 프로브로 syslog를 보낼 수 없습니다. 디바이스 네트워크에서 사용자 지정 프로브를 실행하고 디바이스 설정에서 선택하세요.
- **메시지는 도착하는데 이벤트가 없습니다.** 페이지가 그렇게 알려 주며, 모든 메시지는 디바이스의 **로그** 탭에 있습니다. 디바이스가 오류만이 아니라 정보성 메시지도 보내는지, 제품이 [OneUptime이 읽는 것](#oneuptime이-읽는-것)에 있는 제품인지 확인하세요. 그렇지 않다면 로그 파이프라인에서 이벤트에 이름을 붙이세요.
