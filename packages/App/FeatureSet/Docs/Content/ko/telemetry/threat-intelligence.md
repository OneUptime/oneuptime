# 위협 인텔리전스(STIX/TAXII)

위협 인텔리전스 피드는 알려진 악성 IP 주소, 도메인, URL, 이메일 주소, 파일 해시를 OneUptime으로 가져와, 여러분의 [보안 이벤트](/docs/telemetry/security-events) 가 그중 하나를 언급하면 알려 줍니다. 각 피드는 STIX 2.1 지표를 담은 TAXII 2.1 컬렉션 하나를 구독합니다. 직접 운영하는 MISP, OpenCTI, OpenTAXII 서버일 수도 있고, 공급자의 컬렉션일 수도 있습니다. OneUptime은 자체 피드 콘텐츠를 제공하지 않습니다. Sigma 규칙과 마찬가지로 컬렉션은 여러분이 가져옵니다.

:::cards
- [피드 구독하기](#피드-구독하기): TAXII 서버, 컬렉션, 로그인 방법.
- [수집되는 것](#수집되는-것): OneUptime이 보관하는 지표 패턴과 보관 기간.
- [일치를 찾는 방법](#일치를-찾는-방법): 이벤트가 도착할 때 태그하고, 매분 대조합니다.
- [위협 수준](#위협-수준): 지표의 confidence가 심각도가 되는 방식.
:::

## 작동 방식

```mermaid title="TAXII 컬렉션에서 알림까지"
flowchart TB
    taxii["TAXII 2.1 컬렉션"] -->|"피드의 간격마다<br/>폴링"| indicators["지표: IP,<br/>도메인, URL,<br/>이메일, 해시"]
    events["새 보안 이벤트"] --> tag["도착할 때<br/>threat.* 속성으로<br/>태그"]
    indicators --> tag
    indicators --> match["매분 최근<br/>이벤트와 대조"]
    match --> act["알림, 선택적 인시던트,<br/>탐지 결과"]
```

## 시작하기 전에

- STIX 2.1 `indicator` 객체를 게시하는 TAXII 2.1 서버와, 폴링할 컬렉션의 ID. 피드는 익명, bearer 토큰, 또는 HTTP Basic 인증으로 로그인합니다.
- CISA AIS처럼 TLS 클라이언트 인증서(상호 TLS)를 요구하는 서버는 지원하지 않습니다. MITRE의 공개 ATT&CK 서버는 지표가 아니라 기법과 그룹을 게시하므로, 그 서버를 가리키는 피드는 비어 있게 됩니다.
- 피드를 만들 수 있는 역할: Project Owner, Project Admin, Security Admin, Security Member. Security Viewer는 피드와 지표를 읽을 수 있습니다. [역할](/docs/permissions/reference#역할) 을 참고하세요.

## 피드 구독하기

:::steps
### Threat Intel로 이동하기

**제품 → Security Events → Threat Intel** 을 엽니다.

### 피드 만들기

**Threat Intel Feed 만들기** 를 클릭하고 **기본 정보**, **TAXII Server**, **인증**, **일치 시** 의 네 단계를 채웁니다. 필드는 아래 표에 있습니다.

### 첫 폴링 확인하기

1~2분 안에 피드 행에 **Last Polled** 가 표시되고, **Last Poll Summary** 가 폴링으로 가져온 내용을 알려 줍니다. 지표는 피드 아래의 **Indicators** 표에 나타납니다.
:::

| 필드 | 입력할 내용 |
| --- | --- |
| **TAXII API Root URL** | 서버의 TAXII 2.1 API 루트. 예: `https://taxii.example.com/api1/`. 컬렉션은 그 아래에서 주소가 지정됩니다. |
| **Collection ID** | 지표를 게시하는 컬렉션. |
| **Poll Interval (Minutes)** | 새 객체를 가져오는 빈도. 1~1440분이며 기본값은 60입니다. |
| **Minimum Confidence** | STIX `confidence` 가 이보다 낮은 지표는 건너뜁니다. 0~100이며, 0이면 모두 남깁니다. confidence가 없는 지표는 항상 통과합니다. |
| **API Token** | 토큰을 요구하는 컬렉션용 bearer 토큰. |
| **Basic Auth Username** 과 **Basic Auth Password** | HTTP Basic 인증을 쓰는 컬렉션용. 공개 컬렉션이라면 둘 다, 그리고 토큰도 비워 두세요. |
| **Create Alert on Match** | 기본적으로 켜짐: 일치한 지표마다 알림을 엽니다. |
| **알림 심각도** | 이 피드가 여는 모든 알림의 심각도. 비워 두면 각 지표의 위협 수준을 사용합니다. |
| **Create Incident on Match** | 기본적으로 꺼짐. 인시던트는 온콜 에스컬레이션, SLA, 상태 페이지를 움직이며, 지표 일치에는 보통 알림으로 충분합니다. |
| **인시던트 심각도** | **알림 심각도** 와 같으며, 인시던트용입니다. |
| **Write Detection Finding on Match** | 기본적으로 켜짐: 일치할 때마다 이벤트 스트림에 탐지 결과를 기록합니다. |

토큰과 비밀번호는 암호화되며, 저장한 뒤에는 다시 표시되지 않습니다. 바꾸려면 피드 행에서 **Update Credentials** 를 고른 뒤 **API Token (Bearer)**, **Basic Auth**, **Anonymous (clear stored credentials)** 중 하나를 선택하세요. 선택한 것이 피드의 로그인 방식을 대체하므로, 토큰을 저장하면 저장된 비밀번호가 지워지고 그 반대도 마찬가지입니다.

### 피드를 폴링하는 방식

각 폴링은 TAXII의 `added_after` 커서로 이전 폴링 이후 추가된 객체를 요청하고, 객체 500개짜리 페이지를 최대 10페이지까지 읽습니다. 그래서 큰 컬렉션은 여러 번의 폴링에 걸쳐 동기화되며, 남은 페이지가 있으면 **Last Poll Summary** 가 알려 줍니다. 큰 첫 동기화를 더 빨리 끝내려면 따라잡을 때까지 **Poll Interval (Minutes)** 을 최소 1까지 낮추세요.

폴링은 사용자 에이전트 `OneUptime/<version> (+https://oneuptime.com)` 로 자신을 밝힙니다. 공급자의 방화벽이 `403` 을 반환하면 이 에이전트를 허용해 달라고 요청하세요. 많은 방화벽이 이름 없는 스크립트처럼 보이는 요청을 차단합니다.

비활성화된 피드는 폴링도 대조도 하지 않습니다. 이미 가진 지표는 만료될 때까지 새 이벤트에 계속 태그를 붙입니다.

## 수집되는 것

OneUptime은 패턴이 다음 유형 중 하나에 대한 단순한 동등 비교인 STIX `indicator` 객체를 보관합니다.

| 유형 | 패턴 예 |
| --- | --- |
| IPv4 주소(`ipv4-addr`) | `[ipv4-addr:value = '198.51.100.7']` |
| IPv6 주소(`ipv6-addr`) | `[ipv6-addr:value = '2001:db8::7']` |
| 도메인 이름(`domain-name`) | `[domain-name:value = 'evil.example']` |
| URL(`url`) | `[url:value = 'http://evil.example/payload']` |
| 이메일 주소(`email-addr`) | `[email-addr:value = 'billing@evil.example']` |
| 파일 해시, SHA-256(`file-hash-sha256`) | `[file:hashes.'SHA-256' = 'e3b0…b855']` |
| 파일 해시, SHA-1(`file-hash-sha1`) | `[file:hashes.'SHA-1' = 'da39…0709']` |
| 파일 해시, MD5(`file-hash-md5`) | `[file:hashes.MD5 = 'd41d…427e']` |

`OR` 로 이은 비교는 `[...]` 하나 안에서든 여러 개에 걸쳐서든 괜찮으며, 각 값이 별개의 지표가 됩니다.

```text
[domain-name:value = 'evil.example' OR domain-name:value = 'evil2.example']
[ipv4-addr:value = '198.51.100.7'] OR [url:value = 'http://evil.example/x']
```

그 밖의 패턴, 즉 `AND`, `FOLLOWEDBY`, `NOT`, `LIKE`, `MATCHES`, `WITHIN` 같은 시간 한정자, 또는 다른 객체 유형이 들어간 패턴은 통째로 건너뛰고 **Last Poll Summary** 에서 지원하지 않는 것으로 셉니다. `AND` 패턴의 일부만 변환하면 피드 작성자가 의도한 것보다 훨씬 많이 일치하기 때문입니다.

### 지표가 활성 상태로 남는 기간

- 지표는 `valid_from` 부터 `valid_until` 까지 일치합니다. `valid_until` 이 없으면 `valid_from` 부터 365일 동안 활성 상태이며, 다시 폴링해도 연장되지 않습니다.
- 철회된 지표나 과거의 `valid_until` 로 업데이트된 지표는 그 업데이트를 폴링하는 즉시 일치하지 않게 됩니다. 공급자가 업데이트된 패턴에서 뺀 값도 마찬가지입니다.
- 값은 소문자로 저장되며, 대소문자에 관계없이 일치합니다.

**Indicators** 표는 저장된 그대로의 지표를 **활성**, **만료됨**, **Revoked** 중 하나인 **상태** 와 함께 나열합니다. 다시 폴링한 지표는 한동안 두 번 보일 수 있고, 만료되거나 철회된 행은 저장소 정리로 제거될 때까지, 만료 후 최대 약 한 달 동안 목록에 남습니다. 대조할 때는 항상 유효 기간과 철회 여부를 확인하므로, 그런 행이 일치하는 일은 없습니다.

## 일치를 찾는 방법

### 이벤트가 도착할 때 태그하기

수집 API나 연결에서 들어오는 모든 보안 이벤트는 저장되기 전에 활성 지표와 대조됩니다. 이벤트의 observable(이벤트에서 뽑아낸 IP, 호스트, 도메인, 해시, 사용자) 중 하나가 지표의 값과 같으면, 이벤트에 다음 속성이 붙습니다.

| 속성 | 값 |
| --- | --- |
| `threat.matched` | 태그된 이벤트에서는 항상 `"true"` |
| `threat.indicator_id` | STIX 지표의 ID |
| `threat.indicator_type` | 지표의 유형. 예: `ipv4-addr` 또는 `file-hash-sha256` |
| `threat.indicator_value` | 일치한 값(소문자) |
| `threat.feed` / `threat.feed_id` | 지표를 가져온 피드 |
| `threat.confidence` | 지표의 STIX confidence |
| `threat.match_count` | 이벤트의 observable 중 지표와 일치한 수 |

여러 지표가 한 이벤트와 일치하면, confidence가 가장 높은 지표가 이 값들을 채웁니다. 일반 속성이므로 **이벤트** 에서 검색하고, 보안 이벤트 모니터를 필터링하고, 탐지 규칙에서 사용할 수 있습니다.

```yaml title="threat-intel-logon.yml"
title: High-confidence indicator in a successful logon
level: critical
detection:
  selection:
    threat.matched: 'true'
    threat.confidence|gte: 80
    className: Authentication
    statusName: Success
  condition: selection
```

태그는 이벤트가 도착한 시점에 있는 지표만 압니다. 이벤트에 나중에 다시 태그를 붙이는 일은 없습니다.

### 매분 대조하기

매분, 활성화된 각 피드의 활성 지표를 이벤트 시각이 그 피드의 이전 확인 이후인 이벤트와 대조합니다. 이렇게 하면 이벤트가 태그된 뒤에 도착한 인텔리전스도 잡아냅니다.

- 첫 확인은 최근 15분을 대상으로 합니다. 장애가 있었다면 다음 확인이 최대 최근 24시간까지 따라잡습니다.
- 각 윈도우는 한 번만 확인합니다. 윈도우가 확인된 뒤 도착한 인텔리전스는 그 이후의 이벤트에만 적용됩니다.
- 이전 확인보다 앞선 시각을 달고 늦게 도착한 이벤트는 도착할 때 태그는 되지만 대조되지는 않습니다.
- 각 확인은 피드마다 최대 100개의 지표 값을 대조하며, 가장 많은 이벤트에서 보인 값이 선택됩니다.

### 일치하면 일어나는 일

- 제목이 `[Threat Intel] <feed name> — <indicator value>` 인 알림. 열려 있는 동안에는 피드와 값마다 하나입니다. 해결되면 다음 일치가 새 알림을 엽니다. 알림은 자동으로 해결되지 않습니다.
- 인시던트. **Create Incident on Match** 를 켠 경우에만 열리며, 같은 방식으로 중복이 제거됩니다.
- Threat Intel 탐지 결과. **Write Detection Finding on Match** 를 켠 경우, 제품 `OneUptime Threat Intel` 에서 나온 `Detection Finding` 이벤트(OCSF 클래스 2004)가 지표의 위협 수준을 심각도로 삼아 다음 속성과 함께 기록됩니다.

| 속성 | 값 |
| --- | --- |
| `oneuptime.threat.feed_id` / `oneuptime.threat.feed_name` | 피드 |
| `oneuptime.threat.indicator_id` | STIX 지표의 ID |
| `oneuptime.threat.indicator_type` / `oneuptime.threat.indicator_value` | 일치한 것 |
| `oneuptime.threat.confidence` | 지표의 confidence |
| `oneuptime.threat.match_count` | 이 탐지 결과의 근거가 된 이벤트 수 |

탐지 결과 자체는 대조되지 않으므로, 일치 하나가 다른 일치를 일으키는 일은 없습니다.

## 위협 수준

지표에는 Sigma 수준이 없습니다. 대신 STIX `confidence` 가 위협 수준을 정합니다.

| 지표의 confidence | 위협 수준 |
| --- | --- |
| 90~100 | Critical |
| 70~89 | High |
| 40~69 | Medium |
| 1~39 | Low |
| 점수 없음(0 또는 누락) | Medium |

점수가 없는 지표는 Medium으로 칩니다. 그래도 누군가 그 지표를 피드에 넣기로 했기 때문입니다. 위협 수준은 탐지 결과의 심각도이며, 알림의 심각도를 프로젝트의 심각도 중에서 다음 순서로 고릅니다.

1. 설정되어 있다면 피드의 **알림 심각도**(또는 **인시던트 심각도**). 피드에서 나온 모든 일치에 적용됩니다.
2. 위협 수준과 같은 이름을 가진 여러분의 심각도. 예를 들어 High이며, 대소문자는 가리지 않습니다.
3. 순위에 따라: Critical과 High는 가장 무거운 심각도를, Medium과 Low는 가장 가벼운 심각도를 받습니다.

위협 수준은 피드가 아니라 각 지표에 속하므로, 피드 하나가 같은 분에 Critical 알림과 Low 알림을 함께 열 수도 있습니다. **Minimum Confidence** 는 같은 숫자로 필터링합니다. 최솟값을 70으로 하면 High와 Critical 지표, 그리고 항상 통과하는 점수 없는 지표만 남습니다.

## 피드의 일치 지켜보기

피드 행의 **모니터 생성** 동작은 그 피드의 탐지 결과를 세는 새 보안 이벤트 모니터를 엽니다. 이벤트 클래스는 `Detection Finding` 이고, `oneuptime.threat.feed_id` 의 피드 ID(이름을 바꾸면 달라지는 이름은 쓰지 않음)로 필터링하며, 대상은 최근 한 시간입니다. 일치가 갑자기 몰릴 때나, 활발하던 피드가 조용해질 때를 알아차리는 데 쓰세요.

## 보존과 청구

지표는 텔레메트리가 아니라 구성이므로, 수집된 데이터로 청구되지 않습니다. 일치가 기록하는 탐지 결과는 일반 보안 이벤트이며, 나머지와 똑같이 청구되고 보관됩니다. [보안 이벤트](/docs/telemetry/security-events#보존과-청구) 를 참고하세요.

## 문제 해결

:::details 폴링 후 Last Error가 설정됨
`401` 또는 `403`: 자격 증명이 틀렸거나 없습니다. **Update Credentials** 로 바꾸세요. `403` 은 공급자의 방화벽이 사용자 에이전트를 차단하는 경우일 수도 있습니다. `404`: 보통 `/api1/` 같은 경로로 끝나는 **TAXII API Root URL** 과 **Collection ID** 를 확인하세요. 다음 폴링이 성공하면 오류가 사라집니다.
:::

:::details 피드는 폴링되지만 지표가 나타나지 않음
**Last Poll Summary** 를 읽어 보세요. 가져온 객체 없음: 컬렉션이 비어 있거나 지표를 게시하지 않습니다. 지원하지 않는 패턴: 공급자가 이 페이지에서 건너뛴다고 설명한 패턴 기능을 쓰고 있습니다. 최소 confidence 미만: **Minimum Confidence** 를 낮추세요. 이미 비활성: 공급자가 이미 철회되었거나 만료된 지표를 보냈습니다.
:::

:::details 지표는 있는데 아무것도 일치하지 않음
대조는 지표의 값을 이벤트의 모든 필드가 아니라 observable과 비교합니다. 일치할 것으로 예상한 이벤트를 **이벤트** 에서 열어, 그 observable에 값이 들어 있는지 확인하세요. 상태가 **활성** 인 지표만 일치합니다. 피드의 **Last Match Error** 도 확인하세요.
:::

:::details 일치했는데 알림이 열리지 않음
**Create Alert on Match** 가 꺼져 있거나, 같은 피드와 값의 알림이 아직 열려 있어 이후 일치가 그 알림에 합쳐지고 있습니다. 피드가 알림을 열려면 프로젝트에 알림 심각도가 하나 이상 있어야 합니다.
:::

## 다음 단계

:::cards
- [보안 이벤트](/docs/telemetry/security-events): 이벤트를 보내고, 검색하고, 탐지 규칙을 작성합니다.
- [Google SecOps](/docs/integrations/google-secops): Chronicle의 탐지와 이벤트를 가져옵니다.
- [권한 레퍼런스](/docs/permissions/reference): Security 역할과 각 역할이 할 수 있는 일.
:::
