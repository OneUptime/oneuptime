# 네트워크 트래픽(NetFlow, IPFIX, sFlow)

라우터, 방화벽, 스위치는 자신을 지나는 트래픽을 **플로 레코드**로 기술할 수 있습니다. 누가 누구와, 어떤 프로토콜과 포트로, 어떤 인터페이스를 거쳐, 몇 바이트를 주고받았는지입니다. 이 내보내기를 OneUptime 프로브로 보내면 **트래픽** 페이지에서 트래픽이 어디로 가는지 볼 수 있습니다. 어떤 기간이든 가장 활발한 주소, 대화, 애플리케이션, 인터페이스를 보여 줍니다.

트래픽 페이지는 세 곳에 있습니다.

- **네트워크** -> **트래픽**: 전체 네트워크입니다. 모든 디바이스의 플로와, 아직 디바이스가 아니면서 플로를 보내는 모든 주소를 한 페이지에 보여 줍니다.
- 사이트의 **트래픽** 페이지: 그 사이트의 디바이스입니다.
- 디바이스의 **트래픽** 탭: 그 디바이스와 인터페이스입니다. 디바이스의 프로브에서 실행한 패킷 캡처는 플로 아래에 나열되어, 패킷 자체가 필요할 때 사용할 수 있습니다.

## 트래픽 페이지에 표시되는 내용

- 기간에 대한 네 가지 숫자: **트래픽**(바이트), **평균** 및 **최고** 속도, **플로**(디바이스가 보낸 플로 레코드 수).
- **시간에 따른 트래픽**(초당 비트). 차트에서 드래그하면 구간을 확대하고, 두 번 클릭하거나 **확대/축소 초기화**를 사용하면 돌아갑니다.
- **상위 소스**와 **상위 대상**: 가장 많이 보내고 받은 주소 10개.
- **상위 애플리케이션**: 프로토콜과 서비스 포트별 트래픽으로, 그 포트에서 보통 실행되는 서비스 이름으로 표시합니다(HTTPS는 TCP 포트 443).
- 디바이스 페이지의 **상위 인터페이스**: 각 인터페이스로 들어오고 나간 양을, 디바이스의 SNMP 워크에서 가져온 이름과 속도와 함께 보여 줍니다. 사이트와 네트워크 페이지에는 **상위 디바이스**가 있습니다.
- **상위 대화**: 가장 활발한 주소 쌍 10개를, 보낸 쪽에서 받은 쪽으로 향하는 다이어그램이나 목록으로 보여 줍니다.

주소, 애플리케이션, 인터페이스, 디바이스, 다이어그램의 띠 등 어느 행을 클릭해도 페이지 전체가 그 트래픽으로 좁혀집니다. 페이지 위의 칩이 무엇으로 좁혀졌는지 알려 주며, 칩의 x를 클릭하면 다시 넓어집니다. **IP 주소 찾기**는 한 주소와 주고받은 트래픽으로 페이지를 좁힙니다. 기간과 필터는 페이지 주소에 저장되므로, 링크를 열면 정확히 같은 화면이 열립니다.

## 플로가 들어오는 방식

모든 프로브는 플로 수집기를 실행합니다. 세 개의 UDP 포트에서 수신 대기하며, 모든 포트가 모든 형식을 읽습니다.

| 포트     | 주로 사용하는 형식          |
| -------- | --------------------------- |
| UDP 2055 | NetFlow v5, NetFlow v9      |
| UDP 4739 | IPFIX                       |
| UDP 6343 | sFlow v5                    |

프로브는 레코드를 디코딩하고, 샘플링된 수치에 샘플링 비율을 다시 곱하고, 같은 대화의 레코드를 몇 초마다 합산해 OneUptime으로 보냅니다. 각 레코드는 디바이스가 보낸 주소(sFlow는 데이터그램 안의 에이전트 주소)를 기준으로 디바이스에 연결됩니다.

1. 프로브가 폴링하는 디바이스 중 호스트 이름이 그 주소이거나(또는 그 주소로 확인되거나), **설정** 페이지의 **기타 주소**에 그 주소가 있는 디바이스.
2. 내 (사용자 지정) 프로브에서는, 그 주소를 호스트 이름이나 기타 주소로 가진 프로젝트의 모든 디바이스.
3. 그 밖의 경우, 내 프로브에서는 어느 디바이스의 것인지 지정할 때까지 플로가 네트워크 트래픽 페이지의 **플로를 보내는 곳**에 보관됩니다. 글로벌 프로브는 이를 버립니다.

플로는 30일 동안 보관되며, 한 페이지에는 최대 31일까지 표시됩니다.

## 설정하기

1. **디바이스 네트워크에 있는 프로브를 사용하세요.** 플로는 디바이스가 보내는 UDP 데이터그램이므로, 디바이스가 도달할 수 있는 [사용자 지정 프로브](/docs/probe/custom-probe)가 필요합니다. 공용 인터넷의 글로벌 프로브는 이를 받지 못합니다.
2. **데이터그램이 프로브에 도달하게 하세요.** 디바이스에서 프로브로 가는 UDP 2055, 4739, 6343을 허용합니다. 사용자 지정 프로브 페이지처럼 호스트 네트워크(`--network host`)로 시작한 Docker 프로브는 그대로 받을 수 있고, 호스트 네트워크 없이 실행한다면 `-p 2055:2055/udp -p 4739:4739/udp -p 6343:6343/udp`로 포트를 게시하세요.
3. **디바이스에서 플로 내보내기를 켜고** 프로브의 IP 주소로 보내세요. 주요 디바이스의 명령은 아래에 있습니다. 첫 플로가 도착할 때까지 디바이스의 **트래픽** 탭에도 프로브 포트가 포함된 같은 단계가 표시됩니다.
4. **디바이스 주소를 확인하세요.** 레코드는 디바이스가 보낸 주소로 연결됩니다. 호스트 이름이 아닌 루프백이나 관리 인터페이스에서 보낸다면, 그 주소를 디바이스의 **기타 주소**에 추가하세요.

수집기는 기본적으로 켜져 있습니다. 설정은 프로브의 환경 변수입니다.

| 변수                                | 하는 일                                                             | 기본값  |
| ----------------------------------- | ------------------------------------------------------------------- | ------- |
| PROBE_NETFLOW_RECEIVER_ENABLED      | `false`로 설정하면 플로 수집기를 끕니다                             | true    |
| PROBE_NETFLOW_RECEIVER_PORT         | NetFlow 포트. `0`이면 이 포트에서 수신 대기하지 않습니다            | 2055    |
| PROBE_IPFIX_RECEIVER_PORT           | IPFIX 포트. `0`이면 이 포트에서 수신 대기하지 않습니다              | 4739    |
| PROBE_SFLOW_RECEIVER_PORT           | sFlow 포트. `0`이면 이 포트에서 수신 대기하지 않습니다              | 6343    |
| PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE | 모든 디바이스와 포트를 합쳐 분당 받아들이는 데이터그램 수           | 6000    |

### Cisco IOS XE(Flexible NetFlow)

IPFIX를 UDP 4739로 내보냅니다. 트래픽을 보려는 모든 인터페이스에 마지막 줄을 추가하세요. 각 인터페이스로 들어오는 트래픽을 측정하면 모든 대화가 한 번씩만 집계됩니다.

```text
flow exporter ONEUPTIME
 destination <probe-address>
 source Loopback0
 transport udp 4739
 export-protocol ipfix
 template data timeout 60
 option interface-table
 option sampler-table
!
flow monitor ONEUPTIME
 exporter ONEUPTIME
 cache timeout active 60
 record netflow ipv4 original-input
!
interface GigabitEthernet0/0/0
 ip flow monitor ONEUPTIME input
```

### Cisco IOS(NetFlow v9)

NetFlow v9를 UDP 2055로 내보냅니다.

```text
ip flow-export version 9
ip flow-export destination <probe-address> 2055
ip flow-export source Loopback0
ip flow-export template timeout-rate 1
ip flow-cache timeout active 1
!
interface GigabitEthernet0/0
 ip flow ingress
```

### Arista EOS(sFlow)

sFlow를 UDP 6343으로 내보냅니다. sFlow는 N개 중 1개의 패킷을 샘플링하고(여기서는 16384), 트래픽 페이지가 샘플을 다시 곱하므로 숫자는 추정치입니다.

```text
sflow sample 16384
sflow destination <probe-address> 6343
sflow source-interface Loopback0
sflow run
```

### Cisco Meraki MX 및 Z

MX 어플라이언스와 Z 시리즈 원격 근무 게이트웨이는 Meraki 대시보드에서 NetFlow v9를 내보냅니다.

1. **Network-wide** > **General**을 열고 **Reporting**을 찾습니다.
2. **NetFlow traffic reporting**을 **Enabled: send NetFlow traffic statistics**로 설정합니다.
3. **NetFlow collector IP**에 프로브의 IP 주소를, **NetFlow collector port**에 `2055`를 입력하고 저장합니다.

MX나 Z는 자신을 지나는 트래픽만 봅니다. 스위치가 VLAN 안에서 처리하는 트래픽은 도달하지 않으므로 내보내기에 포함되지 않습니다.

### Juniper(인라인 J-Flow)

MX 라우터에서 IPFIX를 UDP 4739로 내보냅니다. 샘플링하는 인터페이스가 있는 FPC를 사용하세요.

```text
set services flow-monitoring version-ipfix template ONEUPTIME ipv4-template
set services flow-monitoring version-ipfix template ONEUPTIME flow-active-timeout 60
set services flow-monitoring version-ipfix template ONEUPTIME template-refresh-rate seconds 60
set chassis fpc 0 sampling-instance ONEUPTIME
set forwarding-options sampling instance ONEUPTIME input rate 1
set forwarding-options sampling instance ONEUPTIME family inet output flow-server <probe-address> port 4739
set forwarding-options sampling instance ONEUPTIME family inet output flow-server <probe-address> version-ipfix template ONEUPTIME
set forwarding-options sampling instance ONEUPTIME family inet output inline-jflow source-address <device-address>
set interfaces ge-0/0/0 unit 0 family inet sampling input
```

### Fortinet FortiGate

NetFlow v9를 UDP 2055로 내보냅니다. FortiOS 7.2 이상에서는 수집기가 `config system netflow` 안의 `config collectors` 아래 항목입니다.

```text
config system netflow
    set collector-ip <probe-address>
    set collector-port 2055
    set template-tx-timeout 60
end
config system interface
    edit "port1"
        set netflow-sampler both
    next
end
```

### Palo Alto Networks

1. **Device** > **Server Profiles** > **NetFlow**에서 프로브의 IP 주소와 포트 `2055`로 프로필을 추가하고, **Active Timeout**을 1분으로 설정합니다.
2. **Network** > **Interfaces**에서 트래픽을 보려는 각 인터페이스를 열고 **Advanced** 탭의 **NetFlow Profile**로 그 프로필을 선택합니다.
3. 커밋합니다.

### MikroTik RouterOS 7

```text
/ip traffic-flow set enabled=yes interfaces=all active-flow-timeout=1m
/ip traffic-flow target add dst-address=<probe-address> port=2055 version=9
```

### pfSense 및 Linux 호스트

pfSense에서는 **softflowd** 패키지를 설치하고, **Services** > **softflowd**에서 인터페이스를 선택하고 프로브의 IP 주소와 포트 `2055`를 입력한 뒤 NetFlow 버전 9를 선택합니다. Linux 호스트에서는 트래픽을 보려는 인터페이스에서 softflowd를 실행합니다.

```bash
softflowd -i eth0 -n <probe-address>:2055 -v 9 -t maxlife=60
```

### 기타 디바이스

NetFlow v5, NetFlow v9, IPFIX는 프로브 IP 주소의 UDP 2055(또는 4739)로, sFlow v5는 UDP 6343으로 보내세요. 디바이스의 활성 플로 타임아웃을 60초로 설정하고, NetFlow v9와 IPFIX는 템플릿을 60초마다 보내세요. Sophos와 Extreme Networks는 [네트워크 공급업체 가이드](/docs/monitor/network-vendor-guides)에서 다룹니다.

## 아직 디바이스가 아닌 주소

플로는 그것을 보내는 디바이스가 OneUptime에 추가되기 전에 도착할 수 있습니다. 내 프로브에서는 이 플로가 보관되고, 네트워크 트래픽 페이지의 **플로를 보내는 곳**에 **아직 디바이스가 아님** 표시와 함께 주소가 나열됩니다.

- **디바이스로 추가**는 주소와 프로브가 채워진 상태로 디바이스 추가 화면을 엽니다. 이미 도착한 플로는 네트워크 페이지에 남고, 새 플로는 디바이스로 갑니다.
- **내 디바이스 중 하나입니다**는 주소를 디바이스의 **기타 주소**에 추가합니다. 이미 추가한 디바이스가 루프백 같은 다른 주소에서 보낼 때 사용하세요. 다음 1분부터 그 플로가 해당 디바이스로 갑니다.

하나의 NAT 주소 뒤에 있는 여러 디바이스는 그 주소를 공유하므로, 플로는 그 주소를 가진 디바이스 한 대로 갑니다.

## 숫자 읽는 법

- **샘플링.** 샘플링하는 디바이스(sFlow는 항상, NetFlow나 IPFIX는 경우에 따라)는 N개 중 1개의 패킷을 보고합니다. 프로브가 수치에 N을 곱하므로 페이지는 추정치를 보여 주고, 네 숫자 아래에 그렇다고 표시합니다. 트래픽이 많으면 정확하고 패킷이 적으면 대략적입니다.
- **두 번 집계.** 내보내는 디바이스 두 대를 지나는 트래픽은 두 디바이스 모두 보고합니다. 디바이스 페이지는 한 번, 사이트나 네트워크 페이지는 보고한 디바이스마다 한 번씩 집계합니다.
- **애플리케이션.** 애플리케이션은 프로토콜과 서비스 포트이며, 그 포트에서 보통 실행되는 서비스 이름으로 표시합니다. 심층 패킷 검사가 아니므로 포트 8443의 HTTPS는 TCP 포트 8443으로 표시됩니다. 클라이언트의 수명이 짧은 포트는 제외되므로, 한 서버로 가는 브라우저 연결 1,000개는 애플리케이션 하나입니다.
- **최고**는 차트에서 가장 바쁜 구간의 속도이므로, 기간이 짧아 구간이 짧을수록 최고치가 더 뾰족합니다. **평균**은 전체 기간의 바이트로 구합니다.
- **시간.** 플로는 시작된 구간에 집계됩니다. 긴 다운로드는 실행되는 1분마다 하나씩 여러 플로로 보고되므로, 디바이스의 활성 타임아웃은 60초여야 합니다.

## 포함되지 않는 것

- **플로 기반 알림.** 아직 플로 기반 모니터는 없습니다. 혼잡한 링크에 대해 알림을 받으려면, SNMP를 읽는 [네트워크 디바이스 모니터](/docs/monitor/network-device-monitor)의 인터페이스 사용률 알림을 사용하세요.
- **포트를 넘어선 애플리케이션 이름.** 심층 패킷 검사는 없으며, Cisco NBAR 애플리케이션 이름도 읽지 않습니다.
- **Meraki Dashboard API.** Meraki 트래픽 분석은 가져오지 않습니다. 대신 MX와 Z 어플라이언스가 프로브로 NetFlow를 보냅니다.
- 트래픽 **이상 탐지**.
- **플로 레코드의 인터페이스 이름.** 인터페이스 이름과 속도는 디바이스의 SNMP 워크에서 가져옵니다. 워크하지 않는 디바이스는 인터페이스 번호를 표시합니다.

## 문제 해결

트래픽 페이지에 계속 설정 단계가 표시된다면:

- **프로브가 무엇이든 받고 있나요?** 네트워크 트래픽 페이지의 **플로를 보내는 곳**에는 지난 1시간 동안 플로를 보낸 모든 주소가 나열됩니다. 디바이스가 **아직 디바이스가 아님**으로 표시되어 있다면 호스트 이름이 아닌 주소에서 보내고 있는 것입니다. 그 주소를 디바이스의 **기타 주소**에 추가하세요.
- **방화벽과 Docker.** 디바이스에서 프로브로 가는 UDP 2055, 4739, 6343을 허용하고, 프로브가 Docker에서 실행된다면 포트를 게시하세요.
- **프로브 로그.** 프로브는 1분에 한 번 읽지 못한 것을 기록합니다. 지원하지 않는 형식의 데이터그램(NetFlow v1, v6, v7, v8 또는 버전 5 이전의 sFlow), 잘못된 데이터그램, 템플릿을 기다리는 데이터, `PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE`를 넘어 버려진 데이터그램입니다.
- **템플릿.** NetFlow v9와 IPFIX는 레코드 구조를 템플릿으로 보냅니다. 프로브는 템플릿보다 먼저 도착한 데이터를 최대 10분 동안 보관합니다. 1분 안에 페이지가 채워지도록 디바이스가 템플릿을 60초마다 보내게 설정하세요.
- **글로벌 프로브.** 글로벌 프로브가 폴링하는 디바이스는 사설 네트워크에서 그 프로브로 플로를 보낼 수 없습니다. 디바이스 네트워크에서 사용자 지정 프로브를 실행하고 디바이스 설정에서 선택하세요.
