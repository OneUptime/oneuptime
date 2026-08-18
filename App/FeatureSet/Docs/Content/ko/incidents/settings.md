# 설정 및 자동화

인시던트 설정은 프로젝트 설정에 있지 않습니다. **Incidents → Settings**와 **Incidents → Rules** 아래, `/dashboard/{projectId}/incidents/settings/`로 시작하는 경로에서 인시던트 제품 영역 자체 안에 있습니다. 인시던트 템플릿이나 사용자 정의 필드를 찾아 **Project Settings**를 뒤지고 다녔다면, 그것이 찾지 못한 이유입니다.

인시던트 사이드 메뉴의 **Rules**와 **Settings** 섹션은 둘 다 기본적으로 접혀 있으므로, 아래의 항목들이 보이려면 먼저 펼쳐야 합니다. 여기 있는 모든 것은 프로젝트 범위입니다. 템플릿, 역할, 사용자 정의 필드, 규칙은 하나의 프로젝트에 속하며 그 프로젝트에서 선언되는 모든 인시던트에 적용됩니다.

이 페이지는 그 설정에 대한 참조입니다 — 각 페이지에 무엇이 있고, 그중 무엇이 인시던트 생성 순간 자동으로 실행되는지 다룹니다.

## 인시던트 설정이 있는 곳

왼쪽 내비게이션에서 **Incidents**를 열고, 사이드 메뉴 맨 아래의 **Settings**를 펼칩니다.

| 페이지                       | 여기서 하는 일                                                            |
| ----------------------------- | -------------------------------------------------------------------------- |
| **Incident State**            | 인시던트가 거치는 상태를 추가, 이름 변경, 색상 변경, 순서 변경합니다.      |
| **Incident Severity**         | 심각도 수준을 추가, 이름 변경, 색상 변경, 순서 변경합니다.                 |
| **Incident Templates**        | 인시던트 전체를 미리 채웁니다 — 제목, 설명, 리소스, 온콜 정책, 소유자, 레이블. |
| **Note Templates**            | 공개 노트와 비공개 노트를 위한 재사용 가능한 텍스트입니다.                 |
| **Postmortem Templates**      | 재사용 가능한 포스트모템 구조입니다.                                       |
| **Custom Fields**             | 모든 인시던트에 나타나는 추가 필드를 정의합니다.                          |
| **Incident Roles**            | Incident Commander 같은, 대응자에게 배정할 역할을 정의합니다.             |
| **More Settings**             | 인시던트 및 인시던트 에피소드 번호 접두사입니다.                          |

**Incident State**와 **Incident Severity**는 [인시던트 상태 및 심각도](/docs/incidents/states-and-severities)에서 자세히 다루므로, 이 페이지의 나머지 부분은 **Incident Templates**부터 이어집니다.

**Rules**를 펼치면 여덟 개의 페이지가 더 나타납니다. **Grouping Rules**, **On-Call Rules**, **Owner Rules**, **Runbook Rules**, **Privacy Rules**, **Label Rules**, **SLA Rules**, **Reminder Rules**입니다. 이들은 아래에서 더 자세히 다룹니다.

## 인시던트 템플릿

인시던트 템플릿은 저장된 인시던트의 골격입니다. 결제 클러스터가 흔들릴 때마다 같은 제목, 같은 모니터 목록, 같은 온콜 정책을 매번 다시 입력하는 대신, 한 번 저장해 두고 그로부터 선언하면 됩니다.

**Incidents → Settings → Incident Templates**(`/dashboard/{projectId}/incidents/settings/templates`)로 이동합니다. 카드 제목은 **Incident Templates**입니다. 하나를 만들면 6단계 마법사가 안내합니다.

- **Template Info** — **Template Name**과 **Template Description**. 이는 템플릿 자체를 명명하는 것이며, 인시던트에는 절대 나타나지 않습니다.
- **Incident Details** — **Title**, **Description**(마크다운), **Incident Severity**, **Initial Incident State**. **Initial Incident State**는 선택 사항이며 처음에는 비어 있고, 옵션은 상태 순서대로 나열됩니다. 비워 두면 이 템플릿에서 만든 인시던트는 프로젝트의 생성 상태로 들어갑니다.
- **Resources Affected** — 인시던트를 연결할 모니터, 호스트, 클러스터, 서비스, 그리고 **Change Monitor Status to**입니다.
- **On-Call** — **On-Call Policy**, 이 템플릿에서 만든 인시던트가 선언될 때 실행할 정책입니다.
- **Owners** — **Owner - Teams**와 **Owner - Users**입니다.
- **Labels** — **Labels**입니다.

몇 가지 간단한 규칙이 있습니다.

- 템플릿 목록에는 **Name**과 **Description**만 표시됩니다. 목록에서 행을 편집하거나 삭제할 수는 없습니다 — 템플릿을 열어서(`/dashboard/{projectId}/incidents/settings/templates/{modelId}`) 변경하세요.
- 템플릿은 JSON 가져오기와 내보내기를 지원하므로 프로젝트 간에 이동할 수 있습니다.
- 빈 상태에는 "No incident templates found."라고 표시됩니다.

### 템플릿이 적용되는 방식

두 가지 경로가 있으며 동작 방식은 같습니다.

- **대시보드에서** — 인시던트 목록의 **Create from Template** 버튼을 누르면 **Select Incident Template** 선택기가 열리고, 선언 페이지는 `incidentTemplateId` 쿼리 문자열 매개변수에서 템플릿을 읽어 양식을 템플릿과 그 소유자 팀, 소유자 사용자로 미리 채웁니다.
- **API에서** — `POST /api/incident`에 `createdIncidentTemplateId`를 전달하면 서버가 템플릿에서 인시던트를 채웁니다.

중요한 부분은 병합 규칙입니다. **템플릿은 정의되지 않은 채로 남겨 둔 필드만 채웁니다.** 제목, 설명, 인시던트 심각도, 초기 인시던트 상태, **Change Monitor Status to** 뒤에 있는 모니터 상태, 모니터, 호스트, Kubernetes 클러스터, Docker 호스트, Podman 호스트, 서비스, 온콜 정책, 레이블은 호출자나 양식이 아무것도 제공하지 않았을 때만 템플릿에서 복사됩니다. 직접 설정한 값은 항상 우선합니다.

**빈 상태 대화 상자는 잘못된 위치를 가리킵니다.** 아직 템플릿이 없다면 **Create from Template** 버튼은 **No Incident Templates** 대화 상자를 보여 줍니다. 그 안내 문구는 Project Settings를 가리키지만, 버튼 자체는 **Incidents → Settings → Incident Templates**로 이동합니다 — 그곳이 실제 위치입니다.

## 노트 템플릿

노트 템플릿은 대응자에게 인시던트 업데이트용 정형 문구를 제공하므로, 새벽 3시의 상태 페이지 업데이트를 반쯤 잠든 누군가가 처음부터 작성할 필요가 없습니다.

**Incidents → Settings → Note Templates**(`/dashboard/{projectId}/incidents/settings/note-templates`)로 이동합니다. 카드 제목은 **Public or Private Note Templates for Incidents**이며 — 하나의 라이브러리가 두 노트 유형 모두를 지원합니다. 생성 양식은 두 단계입니다.

- **Template Info** — **Template Name**과 **Template Description**, 둘 다 필수입니다.
- **Note Details** — 노트 본문 자체이며 마크다운이고 필수입니다.

인시던트 템플릿과 마찬가지로 행은 인라인으로 편집되지 않고 생성 후 조회됩니다. 변경하려면 템플릿을 여세요.

노트 템플릿은 실제로 필요한 곳에 나타납니다. **Acknowledge Incident**와 **Resolve Incident** 확인 대화 상자 모두 **Public Note** 필드 옆에 **Select Note Template**을 제공합니다. 공개 노트와 비공개 노트가 어떻게 다른지는 [인시던트 메모, 소유자 및 피드](/docs/incidents/notes-owners-and-feed)를 참고하세요.

## 포스트모템 템플릿

포스트모템 템플릿은 인시던트 이후에 작성하는 회고문의 골격입니다 — 제목, 질문, 상시 확인 항목 — 이므로 프로젝트의 모든 회고가 같은 형태를 따르게 됩니다.

**Incidents → Settings → Postmortem Templates**(`/dashboard/{projectId}/incidents/settings/postmortem-templates`)로 이동합니다. 카드 제목은 **Postmortem Templates**입니다. 생성 양식은 두 단계입니다.

- **Template Info** — **Template Name**과 **Template Description**, 둘 다 필수입니다.
- **Postmortem Details** — **Postmortem Template**, 본문 자체이며 마크다운이고 필수입니다.

이것은 설정이 아니라 인시던트에서 적용합니다. 인시던트를 열고 사이드 메뉴에서 **Postmortem**(`/dashboard/{projectId}/incidents/{incidentId}/postmortem`)을 선택한 다음 **Apply Template**을 사용하세요. 이는 **Select Template** 드롭다운이 있는 **Apply Postmortem Template** 대화 상자를 열며, 하나를 고르면 템플릿 본문이 **Postmortem Note** 편집기에 로드되어 저장하기 전에 수정할 수 있습니다. 인시던트 에피소드도 같은 **Postmortem** 페이지를 가지며 같은 템플릿 라이브러리를 사용합니다.

## 사용자 정의 필드

사용자 정의 필드를 사용하면 모든 인시던트에 자체 메타데이터를 담을 수 있습니다 — 내부 서비스 이름, 변경 티켓 참조, 고객 등급 같은 것입니다.

**Incidents → Settings → Custom Fields**(`/dashboard/{projectId}/incidents/settings/custom-fields`)로 이동합니다. 페이지 제목은 **Incident Custom Fields**입니다. 각 정의는 다음을 가집니다.

- **Field Name** — 필수이며 최소 두 글자입니다. 플레이스홀더는 `internal-service`와 같은 슬러그 형태의 이름을 제안합니다.
- **Field Description** — 선택 사항입니다.
- **Field Type** — 필수입니다. 데이터가 어떻게 입력되는지를 결정합니다. 드롭다운 유형은 옵션 목록도 필요합니다.
- **Dropdown Options** — 드롭다운에 나타나는 값들이며, 각각 선택적인 색상을 가질 수 있습니다.

정의는 자체 모델에 저장되며, 값은 인시던트 자체의 `customFields` 컬럼에 저장됩니다. 하나의 인시던트에서는 인시던트 사이드 메뉴의 **Custom Fields**(`/dashboard/{projectId}/incidents/{incidentId}/custom-fields`)에서 채웁니다.

**알아 둘 만한 한 가지 공백.** 인시던트 사용자 정의 필드 정의는 인시던트 계열 중 워크플로우 트리거가 전혀 없는 유일한 부분입니다 — 아래 워크플로우 섹션을 참고하세요.

## 인시던트 역할

인시던트 역할은 대응 중에 사람들에게 배정하는 이름 붙은 직무입니다. **Incidents → Settings → Incident Roles**(`/dashboard/{projectId}/incidents/settings/roles`)에서 정의하며, 카드 설명은 예시로 Incident Commander와 Responder를 듭니다.

역할은 정의일 뿐입니다. 사람은 인시던트별로 역할에 배정합니다 — 선언 마법사에는 **Assign Incident Roles** 필드가 있는 **Incident Roles** 단계가 있으며, 각 인시던트는 사이드 메뉴에 **Roles** 페이지를 가집니다.

## 번호 접두사

모든 인시던트는 번호를 받습니다. 기본적으로는 `#42`로 표시됩니다. 팀이 "INC-42"라고 소리 내어 말한다면, 제품에도 그렇게 표시되게 하세요.

**Incidents → Settings → More Settings**(`/dashboard/{projectId}/incidents/settings/more`)로 이동합니다. 카드는 **Number Prefix**이며 프로젝트에 대해 두 필드를 가집니다.

- **Incident Number Prefix** — 최대 20자이며 플레이스홀더는 `INC-`입니다. 설정하면 인시던트 `#42`가 `INC-42`로 표시됩니다.
- **Incident Episode Number Prefix** — 인시던트 에피소드 번호에 대한 같은 개념이며 플레이스홀더는 `IE-`입니다.

둘 다 비워 두면 기본 `#` 접두사가 유지됩니다. 비어 있는 필드는 `# (default)`로 표시됩니다. **Update**로 저장합니다. 접두사가 붙은 값은 인시던트에 `incidentNumberWithPrefix`로 저장되며, 인시던트 목록과 인시던트 헤더가 렌더링하는 것이 바로 이 값입니다.

## 인시던트가 생성될 때 실행되는 규칙

**Incidents → Rules**는 여덟 개의 규칙 엔진을 담고 있습니다. 이들은 모두 같은 일을 합니다 — 인시던트가 생성되는 순간을 보고, 일치하면 행동합니다 — 하지만 무엇을 하는지, 그리고 여러 일치 규칙이 어떻게 해소되는지는 서로 다릅니다.

- **Grouping Rules** — 관련된 인시던트를 에피소드로 그룹화합니다. 규칙은 우선순위 순으로 평가되며, 낮은 우선순위 번호가 먼저 실행됩니다.
- **On-Call Rules** — 일치하는 인시던트에 대해 온콜 듀티 정책을 실행합니다. 아래에서 자세히 다룹니다.
- **Owner Rules** — 소유자를 자동으로 배정합니다.
- **Runbook Rules** — 인시던트가 일치하면 [runbook](/docs/runbooks/index)을 시작합니다.
- **Privacy Rules** — 일치하는 인시던트를 비공개로 할지 결정합니다.
- **Label Rules** — 레이블을 자동으로 적용합니다.
- **SLA Rules** — 응답 및 해결 시간을 추적합니다. 규칙은 순서대로 평가되며 낮은 순서 번호가 먼저 실행됩니다.
- **Reminder Rules** — 인시던트가 아직 열려 있는 동안 소유자에게 주기적으로 알립니다. 규칙은 순서대로 평가되며 처음으로 일치한 규칙이 이깁니다.

**순서 방식은 균일하지 않습니다.** Grouping Rules, SLA Rules, Reminder Rules는 순서 기반으로 평가됩니다. On-Call Rules는 그렇지 않습니다 — 일치하는 모든 규칙이 실행됩니다. 하나의 모델이 여덟 개 모두에 적용된다고 가정하지 마세요.

**On-Call Rules**, **Owner Rules**, **Label Rules**, **Privacy Rules** 페이지는 탭으로 나뉘어 있습니다 — **Incident Rules** 탭과 **Episode Rules** 탭이며, 각각 자체 테이블을 가집니다. 특별히 에피소드를 의도한 것이 아니라면 **Incident Rules** 탭을 구성하세요. **Grouping Rules**, **Runbook Rules**, **SLA Rules**, **Reminder Rules**는 단일 테이블입니다.

## 인시던트 온콜 규칙

**Incidents → Rules → On-Call Rules**(`/dashboard/{projectId}/incidents/settings/on-call-rules`)는 호출을 자동화하는 곳입니다. **Incident On-Call Rules** 카드는 일치하는 인시던트가 생성될 때 온콜 듀티 정책을 자동으로 실행하는 규칙이라고 설명합니다. 페이지는 **Incident Rules**와 **Episode Rules** 두 개의 탭을 가집니다.

생성 양식은 세 단계입니다.

- **Basic Info** — **Name**(플레이스홀더는 DB 인시던트가 발생하면 데이터베이스 팀을 호출하는 것 같은 예시를 제안합니다), **Description**, **Enabled** 토글입니다. 목록은 규칙별로 초록색 **Enabled** 또는 빨간색 **Disabled** 알약을 표시합니다.
- **Match Criteria** — **Monitors**, **Incident Severities**, **Incident Labels**, **Monitor Labels**, 그리고 인시던트 제목, 인시던트 설명, 모니터 이름, 모니터 설명에 대한 대소문자를 구분하지 않는 정규식 필드입니다.
- **On-Call Policies** — 이 규칙이 실행할 정책입니다.

### 일치가 해소되는 방식

이 페이지 자체가 제공하는 규칙은 익혀 둘 만합니다.

- 규칙은 여러분이 채운 기준을 **모두** 통과했을 때만 일치합니다. 비워 둔 기준은 실패로 취급되지 않고 건너뜁니다.
- 하나의 목록 기준 안에서는 — **Monitors**, **Incident Severities**, **Incident Labels**, **Monitor Labels** — 하나라도 일치하면 됩니다.
- 패턴 필드는 대소문자를 구분하지 않는 정규식입니다.
- **일치하는 모든 규칙이 실행됩니다.** 우선순위도 없고 단축 평가도 없습니다.
- 실제로 실행되는 정책 집합은 일치한 모든 규칙의 정책과 인시던트에 수동으로 또는 템플릿으로 연결된 정책의 합집합이며, 각 정책이 최대 한 번만 실행되도록 중복이 제거됩니다.

심각도는 오직 여기에서만 일치 기준으로 쓰입니다. 인시던트 심각도에는 온콜 필드가 없습니다. "Critical Incident"를 선택한다고 해서 그 자체로 누군가를 호출하지는 않습니다. 심각도가 호출을 이끌게 하려면 이를 기준으로 일치하는 온콜 규칙을 작성하세요.

## 온콜 정책을 직접 연결하기

규칙만이 유일한 경로는 아닙니다. 모든 인시던트는 자체 온콜 정책 목록을 가지며, 이는 선언 마법사의 **On-Call** 단계와 인시던트 템플릿의 **On-Call** 단계에서 **On-Call Policy** 필드로 나타납니다. 필드 설명은 명확히 말합니다. 이는 이 인시던트가 생성될 때 실행할 온콜 듀티 정책입니다.

인시던트가 생성되면 OneUptime은 레이블 규칙을 실행한 다음 온콜 규칙(일치하는 정책을 인시던트 목록에 병합합니다)을 실행하고, 이어서 runbook 규칙을 실행합니다 — 결과 목록이 비어 있지 않으면 그 안의 모든 정책이 실행됩니다. 실행은 병렬로 이루어지며 서로 독립적으로 처리되므로, 하나의 정책이 실패해도 다른 정책은 멈추지 않습니다. 각 실행에는 그것을 촉발한 인시던트와 인시던트 생성 알림 이벤트 유형이 태그로 붙습니다.

무슨 일이 일어났는지 보려면 인시던트를 열고 사이드 메뉴에서 **On-Call Executions**(`/dashboard/{projectId}/incidents/{incidentId}/on-call-policy-execution-logs`)를 선택하세요.

## 워크플로우로 인시던트 구동하기

인시던트용 워크플로우 트리거는 손으로 작성되지 않습니다 — OneUptime이 데이터 모델로부터 이를 생성하므로, 인시던트 계열의 모든 모델은 모델의 단수 이름을 따서 명명된 **On Create X**, **On Update X**, **On Delete X** 컴포넌트를 갖게 됩니다. 대표적인 세 가지는 **On Create Incident**, **On Update Incident**, **On Delete Incident**이며, `/dashboard/{projectId}/workflows`의 **구성 요소 추가** 패널에서 **Incident** 카테고리에 있습니다.

같은 생성 방식은 설정 자체에 대한 트리거도 제공합니다. **On Create Incident State**, **On Update Incident Severity**, **On Create Incident Template**, **On Create Incident Note Template**, **On Create Incident State Timeline**, **On Create Incident Public Note**, **On Create Incident Internal Note**, **On Create Incident On-Call Rule**, **On Create Incident Role**, **On Create Incident Member** 등입니다. 각 모델은 대응하는 액션 컴포넌트도 갖습니다 — **Find One Incident**, **Create One Incident**, **Update One Incident**, **Delete One Incident**와 그 여러 행 버전들 — 그래서 이름이 비슷한 트리거와 액션이 같은 카테고리 안에 나란히 놓입니다. **On Create Incident**는 워크플로우를 시작하고, **Create One Incident**는 하나를 엽니다.

이를 연결할 때 중요한 몇 가지 세부 사항이 있습니다.

- **On Update X**는 선택적인 **Listen on** 인자를 받아 트리거를 특정 필드가 변경된 업데이트로 좁힙니다. 비워 두면 어떤 변경에도 실행됩니다. 어떤 필드가 바뀌었는지에 대한 기록 없이 업데이트가 도착하면 필터는 건너뛰고 워크플로우가 실행됩니다.
- **On Create X**와 **On Update X**는 둘 다 필수인 **Select Fields** 인자를 받습니다. **On Delete X**는 인자를 받지 않습니다.
- 셋 다 하나의 **Success** 출력 포트를 노출하며, 각각 ID 인자를 받으므로 특정 레코드에 대해 워크플로우를 수동으로 실행할 수 있습니다.
- 이름은 모델의 테이블 이름이 아니라 단수 이름에서 옵니다 — 테이블 형태의 이름이 아니라 **On Create Incident Team Owner**와 **On Create Incident User Owner**가 보이는 이유입니다.
- 인시던트 사용자 정의 필드 정의에는 트리거가 없습니다. 이 모델은 인시던트 계열 중 워크플로우가 비활성화된 유일한 구성원입니다.

워크플로우의 나머지 부분을 만드는 방법은 [워크플로우 작성](/docs/workflows/authoring)과 [변수](/docs/workflows/variables)를 참고하세요.

## 다음에 읽을 문서

- [인시던트 개요](/docs/incidents/index) — 인시던트 기능이 어떻게 맞물리는지 다룹니다.
- [인시던트 선언](/docs/incidents/declaring-incidents) — 선언 마법사, 템플릿, API를 다룹니다.
- [인시던트 상태 및 심각도](/docs/incidents/states-and-severities) — 상태와 심각도 설정 페이지, 그리고 플래그가 하는 일을 다룹니다.
- [인시던트 메모, 소유자 및 피드](/docs/incidents/notes-owners-and-feed) — 노트 템플릿이 쓰이는 곳을 다룹니다.
- [구독자 및 공지](/docs/status-pages/subscribers) — 팀 밖에서 누가 인시던트에 대해 듣는지 다룹니다.
- [워크플로우 개요](/docs/workflows/index) — 인시던트 트리거 위에 자동화를 구축하는 방법을 다룹니다.
- [Runbook 개요](/docs/runbooks/index) — runbook 규칙이 연결하는 절차를 다룹니다.
