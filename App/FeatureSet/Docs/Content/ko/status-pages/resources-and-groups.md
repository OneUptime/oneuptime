# 리소스 및 그룹

리소스는 상태 페이지의 한 행입니다 — 방문자가 이해할 수 있는 이름, 현재 상태, 그리고 선택적으로 가동 시간 숫자와 기록 차트를 가진 모니터(또는 모니터 그룹)입니다. 그룹은 리소스를 담는 섹션이므로, 40개의 모니터를 가진 페이지도 하나의 끝없는 목록 대신 "API", "웹 앱", "데이터 파이프라인"으로 읽힙니다.

이 둘은 하나의 화면에서 만듭니다. 상태 페이지를 열고 사이드 메뉴에서 **리소스**를 선택하세요(모니터 그룹이 활성화되지 않은 프로젝트에서는 이 항목이 **모니터**로 표시됩니다). 그룹은 예전에는 자체 페이지에 있었지만 이제는 더 이상 그렇지 않으며, 예전 `/groups` URL은 그냥 여기로 리디렉션됩니다.

이 부분을 제대로 만들면 상태 페이지의 나머지는 장식일 뿐입니다. 방문자는 "나만 그런 건가 아니면 정말 문제가 있는 건가"를 이 행들로부터 판단하므로, 고객이 여러분의 제품을 부르는 방식대로 이름을 지으세요 — `prod-checkout-lb-healthcheck-us-east-1`이 아니라 **Checkout API**처럼요.

## 리소스 화면

화면은 둘로 나뉩니다. 왼쪽은 페이지의 모든 그룹을 나열하는 내비게이터이고, 오른쪽은 선택한 그룹의 내용입니다.

- **그룹 내비게이터(왼쪽)** — 그룹의 트리이며, 위에는 검색창(**Search groups...**)이, 아래에는 `3 groups · 12 resources`처럼 진행 중인 개수가 표시됩니다. 페이지에 화면에 다 들어가지 않을 만큼 많은 그룹이 있으면 **Show N more of M** 버튼이 나타나 나머지를 보여줍니다.
- **Top of page** — 내비게이터의 첫 번째 행입니다. 어떤 그룹에도 속하지 않은 리소스를 담고 있으며, 툴팁이 그 의미를 정확히 설명합니다. 방문자는 이 항목들을 모든 그룹보다 먼저 봅니다. 페이지에 그룹이 전혀 없으면 오른쪽 창은 대신 **All resources**라는 제목이 붙습니다.
- **리소스 창(오른쪽)** — 선택한 그룹의 이름이 제목으로 붙습니다. 헤더에는 **Edit Group**, 기본 버튼인 **Add Monitor**, 그리고 **More actions** 오버플로가 있습니다.

카드 헤더 자체에는 두 개의 버튼이 있습니다: **New Group**, 그리고 **Import groups from CSV**와 **Refresh**를 담은 점 세 개 오버플로입니다.

카드의 설명은 페이지의 형태에 따라 달라집니다. 그룹이 있으면 이곳이 방문자가 보는 모든 것이며 왼쪽에서 그룹을 선택해 내용을 편집하라고 안내합니다. 아직 그룹이 없으면 더 긴 페이지를 섹션으로 나누기 위해 그룹을 만들라고 권합니다.

**빈 상태는 무엇을 해야 하는지 알려줍니다.** 비어 있는 그룹은 **No monitors here yet**과 함께 **Add Monitor**, **Add Multiple**, 그리고 — 상태 페이지에 그룹이 전혀 없을 때만 — **Create a Group**을 보여줍니다. 아무것도 일치하지 않는 검색은 **No resources match your search**를 보여줍니다. 비어 있는 내비게이터는 그룹이 더 긴 상태 페이지를 섹션으로 나누며 중첩할 수 있다고 안내합니다.

## 모니터 추가하기

리소스를 넣을 그룹을 선택하고(그룹에 속하지 않은 행이라면 **Top of page**), **Add Monitor**를 클릭하세요. 모달의 제목은 **Add a monitor to {group}**이며 두 단계로 구성됩니다: **Monitor Details**와 **Advanced**입니다.

**Monitor Details**에서:

- **Monitor** — 프로젝트의 모니터 드롭다운이며, 플레이스홀더는 **Select Monitor**입니다. 필수입니다.
- **Display Name** — 필수입니다. 방문자가 읽는 텍스트이며, 모니터 자체의 이름과는 별도로 저장되므로 모니터링에는 손대지 않고 이곳에서 이름을 바꿀 수 있습니다.
- **Description** — 행 아래에 표시되는 선택적 마크다운입니다. 서비스가 실제로 무엇을 하는지 한 문장으로 설명하기에 좋습니다.

프로젝트에 모니터 그룹이 활성화되어 있으면, 드롭다운 아래에 **Add a Monitor Group instead.**라는 링크가 나타납니다 — 클릭하면 **Monitor** 드롭다운이 **Monitor Group** 드롭다운(**Select Monitor Group**)으로 바뀝니다. 그러면 링크는 다시 돌아갈 수 있도록 **Add a Monitor instead.**로 바뀝니다. 페이지의 한 행이 여러 체크를 하나로 묶어 나타내길 원할 때 모니터 그룹을 사용하세요.

### 한 번에 여러 개 추가하기

**Add Multiple**(**More actions** 메뉴의 **Add multiple monitors**로도 접근 가능)은 **Add Multiple Monitors**를 엽니다. 동일한 두 단계를 거치지만, 첫 번째 단계는 단일 드롭다운 대신 **Monitors** 다중 선택이며, **Advanced**에서 선택한 표시 옵션은 선택한 모든 모니터에 적용됩니다. 새 페이지를 빠르게 채우는 가장 빠른 방법입니다.

## 리소스의 표시 옵션

**Advanced** 단계는 단일 추가 양식과 일괄 모달에서 동일합니다. 여기의 모든 항목은 리소스별로 설정됩니다 — 같은 그룹 안의 두 행도 서로 다르게 구성할 수 있습니다.

| 필드                                                    | 용도                                                                                            |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Tooltip**(`displayTooltip`)                           | 상태 페이지의 리소스 옆에 표시되는 추가 텍스트입니다. 범위를 설명할 때 사용하세요: "US and EU customers". |
| **Show Current Resource Status**(`showCurrentStatus`)   | 기본값은 켜짐입니다. 행 옆에 실시간 상태 — 정상 운영, 성능 저하, 오프라인 — 를 표시합니다.           |
| **Show Uptime %**(`showUptimePercent`)                  | 기본값은 꺼짐입니다. 리소스 옆에 가동 시간 비율을 표시합니다.                                    |
| **Select Uptime Precision**(`uptimePercentPrecision`)   | **Show Uptime %**가 켜졌을 때만 나타납니다. 필수이며, 기본값은 소수점 한 자리입니다.              |
| **Show Status History Chart**(`showStatusHistoryChart`) | 기본값은 켜짐입니다. 리소스의 일별 가동 시간 기록 막대 차트를 표시합니다.                        |

첫 단계의 **Display Name**(`displayName`)과 **Description**(`displayDescription`)도 표시 전용입니다 — 모니터 자체를 바꾸는 일은 절대 없습니다.

## 가동 시간 비율과 기록 차트

**Show Uptime %**와 **Show Status History Chart**는 모두 다른 곳에 있는 설정에 의존합니다. 이들이 다루는 기간은 **상태 페이지 → 해당 페이지 → 고급 → 고급 설정**의 **가동 시간 기록 설정** 카드에 있는 **가동 시간 기록 표시(일 단위)**입니다. 1일에서 90일까지 허용되며 기본값은 90입니다.

즉 순서는 이렇습니다: 리소스별로 토글을 켠 다음, 페이지 전체에 대해 기간을 한 번 설정합니다.

**정밀도는 판단의 문제입니다.** **Select Uptime Precision** 드롭다운은 `99% (No Decimal)`, `99.9% (One Decimal)`, `99.99% (Two Decimal)`, `99.999% (Three Decimal)`을 제공합니다. 소수점이 많을수록 정밀해 보이지만 세 번째 자리를 둘러싼 논쟁을 부를 수 있습니다. 세 자리 나인(three nines)으로 SLA를 공표한다면 그에 맞추고 그 이상은 넘지 마세요.

그룹도 이 토글의 자체 사본을 가집니다 — 아래를 참고하세요 — 그래서 그룹은 종합된 비율을 보여주되 그 안의 개별 모니터는 조용히 유지하거나, 그 반대로도 할 수 있습니다.

기록 차트 막대의 색상, 그리고 어떤 모니터 상태가 "다운"으로 취급되는지는 **Overview Page** 브랜딩 화면에서 설정하며, [상태 페이지 브랜딩 및 도메인](/docs/status-pages/branding-and-domains)에서 다룹니다.

## 그룹

**New Group**을 클릭해 **Create New Status Page Group**을 여세요. 양식은 세 단계로 구성됩니다: **Group Details**, **Layout**, **Advanced**입니다.

**Group Details**:

- **Group Name**(`name`) — 필수입니다. 방문자가 보는 섹션 제목입니다.
- **Group Description**(`description`) — 제목 아래에 표시되는 선택적 마크다운입니다.
- **Parent Group**(`parentStatusPageGroupId`) — 선택 사항입니다. 그룹을 최상위에 두려면 **No parent group (top level)**로 두세요.
- **Expand on Status Page by Default**(`isExpandedByDefault`) — 방문자에게 섹션이 펼쳐진 채로 시작할지, 접힌 채로 시작할지를 결정합니다.

**Advanced**는 리소스 토글을 그룹 수준에서 그대로 반영합니다.

- **Show Current Group Status**(`showCurrentStatus`) — 기본값은 켜짐입니다. 그룹 제목 옆에 상태를 표시합니다.
- **Show Uptime %**(`showUptimePercent`) — 기본값은 꺼짐이며, 켜지면 **Select Uptime Precision**이 나타납니다.

편집도 같은 방식입니다: 창 헤더의 **Edit Group**, 또는 내비게이터 행 메뉴의 **Edit group**을 누르면 **Save Changes** 버튼이 있는 **Edit Status Page Group**이 열립니다.

창 헤더에는 현재 켜져 있는 설정을 나타내는 칩이 표시됩니다 — **Grid**, **Collapsed by default**, **Uptime %** — 그래서 양식을 열지 않고도 그룹이 어떻게 구성되어 있는지 볼 수 있습니다.

### 그룹 관리하기

내비게이터의 행별 메뉴에는 **Edit group**, **Move up**, **Move down**, **Show ID**, **Delete group**이 있습니다. 창의 **More actions** 오버플로에는 더 자세한 형태의 동일한 항목이 있습니다 — **Edit this group**, **Add a sub group**, **Move group up**, **Move group down**, **Show group ID**, **Refresh**, **Delete this group**입니다. 이름 없이 저장된 그룹은 **Untitled group**으로 표시되며, 이는 여러분이 무언가를 입력하려 했다는 좋은 신호입니다.

## 그룹 중첩하기

그룹은 중첩할 수 있습니다: 자식 그룹에서 **Parent Group**을 설정하거나, 내비게이터의 **Add a sub group inside this group** 작업을 사용하세요. 양식 자체의 도움말 텍스트는 이것이 어떤 형태를 위해 만들어졌는지 설명합니다 — Corporate Units › Region › Market 같은 형태로, 모든 단계가 그 아래에 있는 모든 것의 종합 상태와 가동 시간을 보여준다고 안내합니다.

그룹에 자식이 있으면, 리소스 창에는 각 자식으로 바로 연결되는 **Sub groups** 칩 행이 표시되어, 내비게이터로 돌아가지 않고도 계층을 탐색할 수 있습니다.

중첩은 큰 페이지에서 진가를 발휘합니다. 제품 안에 지역이 있는 호스팅 제공업체, 또는 사업 단위 안에 시장이 있는 소매업체 같은 경우입니다. 12개의 모니터만 있는 페이지라면 한 단계로 평평하게 두는 편이 더 친절합니다.

## 목록 레이아웃 vs 그리드 레이아웃

**Layout** 단계는 그룹의 **View Mode**(`viewMode`)를 설정하며, 이는 그룹이 공개적으로 어떻게 렌더링되는지를 바꿉니다.

| 원하는 것…                                                     | 선택                   |
| ------------------------------------------------------------------- | ---------------------- |
| 서비스를 한 줄에 하나씩 세로로 나열                                 | **List**(기본값)        |
| 여러 지역 또는 테넌트에 걸쳐 같은 서비스를 행렬로 표시              | **Grid**               |

**Grid**를 선택하면 네 개의 필드가 추가로 나타납니다.

- **Row Axis Label** — 행 차원의 이름이며, 플레이스홀더는 `Service`입니다.
- **Row Axis Values** — 행 자체이며, **Add Row**로 하나씩 추가합니다(플레이스홀더 `e.g. Auth`).
- **Column Axis Label** — 열 차원이며, 플레이스홀더는 `Region`입니다.
- **Column Axis Values** — **Add Column**으로 추가합니다(플레이스홀더 `e.g. US-East`).

그리드 그룹의 각 모니터는 셀에 배치되므로, 일괄 모달에서는 모니터와 함께 여러분이 만든 축 레이블을 사용해 행과 열을 함께 물어봅니다.

**모니터를 추가하기 전에 축을 먼저 설정하세요.** 행이나 열이 없는 그리드 그룹은 축이 만들어지기 전까지 모니터를 놓을 곳이 없다는 주황색 알림과 **Set up the grid** 버튼을 보여주며, 그때까지는 **Add Monitor** 버튼이 숨겨집니다.

## 방문자가 보는 순서 정하기

순서는 알파벳순이 아니라 명시적으로 지정되며, 세 곳에서 설정합니다.

- **그룹 안의 리소스** — 행을 드래그하세요. 창에도 안내가 있습니다: **Drag a row to change the order visitors see**.
- **그룹 간의 상대적 순서** — 내비게이터 행 메뉴의 **Move up** / **Move down**, 또는 창 오버플로의 **Move group up** / **Move group down**입니다.
- **그룹에 속하지 않은 리소스** — **Top of page**에 위치하며 항상 모든 그룹 위에 렌더링되므로, 모두가 가장 먼저 확인하는 항목을 그곳에 두세요.

**드래그가 꺼지는 경우가 두 가지 있습니다.** 창을 **Search in {group}...** 상자로 필터링하면 순서 변경이 비활성화됩니다 — 창에는 `N of M shown · drag to reorder is off while filtering`라고 표시되므로 먼저 검색을 지우세요. 그리고 그리드 그룹은 순서가 행과 열 축에서 결정되므로 드래그 순서 변경을 절대 지원하지 않습니다.

가장 많이 문의받는 서비스를 맨 위에 두세요. 장애 중에 페이지를 방문한 사람들은 대개 첫 화면을 넘어가면 더 읽지 않습니다.

## CSV로 그룹 가져오기

깊은 계층을 손으로 만드는 것은 번거롭습니다. 카드 헤더의 점 세 개 오버플로에는 **Import groups from CSV**가 있으며, 이는 **Import Groups from CSV** 모달을 엽니다.

흐름은 다음과 같습니다: **Download CSV Template**으로 `status-page-groups-template.csv`를 받고, 채운 뒤 **Choose CSV File**을 선택하고, **Preview Import**로 실제로 저장되기 전에 무엇이 만들어질지 확인합니다. 결과는 **Groups Imported**와 **Some Groups Could Not Be Imported**로 나뉘므로, 잘못된 행이 소리 없이 사라지지 않습니다.

`name`만 필수입니다. 허용되는 컬럼은 다음과 같습니다.

| 컬럼                   | 설정하는 것                                         |
| ------------------------ | ---------------------------------------------------- |
| `name`                   | 그룹 이름입니다. 필수입니다.                          |
| `parentName`             | 이 그룹이 중첩될 부모 그룹의 이름입니다.              |
| `description`            | 그룹 설명입니다.                                      |
| `isExpandedByDefault`    | 방문자에게 섹션이 펼쳐진 채로 시작할지 여부입니다.     |
| `showCurrentStatus`      | 그룹 제목 옆에 상태를 표시할지 여부입니다.             |
| `showUptimePercent`      | 그룹 옆에 가동 시간 비율을 표시할지 여부입니다.        |
| `uptimePercentPrecision` | 그 비율이 사용하는 소수점 자릿수입니다.                |
| `viewMode`               | `List` 또는 `Grid`입니다.                              |
| `rowAxisLabel`           | 그리드 그룹의 행 차원 이름입니다.                      |
| `rowAxisValues`          | 그리드 그룹의 행 값입니다.                             |
| `columnAxisLabel`        | 그리드 그룹의 열 차원 이름입니다.                      |
| `columnAxisValues`       | 그리드 그룹의 열 값입니다.                             |

가져오기는 그룹만 생성하며 리소스는 생성하지 않습니다 — 이후 **Add Monitor** 또는 **Add Multiple**로 모니터를 추가하세요.

## 다음에 읽을 문서

- [상태 페이지 개요](/docs/status-pages/index) — 상태 페이지가 무엇이며 각 부분이 어떻게 맞물리는지 다룹니다.
- [상태 페이지 브랜딩 및 도메인](/docs/status-pages/branding-and-domains) — 로고, 파비콘, 차트 색상, 그리고 페이지를 여러분의 도메인에 올리는 방법을 다룹니다.
- [구독자 및 공지](/docs/status-pages/subscribers) — 이 리소스가 바뀔 때 누가 알림을 받는지 다룹니다.
- [공용 API](/docs/status-pages/public-api) — 상태 페이지 데이터를 프로그래밍 방식으로 읽는 방법을 다룹니다.
- [인시던트 상태 및 심각도](/docs/incidents/states-and-severities) — 무엇이 인시던트를 페이지에 올리고 내리는지 다룹니다.
