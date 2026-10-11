# 권한 레퍼런스

OneUptime이 부여할 수 있는 모든 역할과 권한을 대시보드의 권한 선택기와 같은 그룹으로 묶어 보여 줍니다. 팀, API 키 또는 Terraform 리소스에 부여할 정확한 이름이나 키를 찾을 때 이 페이지를 사용하세요.

표는 페이지가 제공될 때 OneUptime 소스 코드에서 생성됩니다. 대시보드, API, Terraform 공급자가 사용하는 것과 같은 목록이므로 항상 실행 중인 버전과 일치합니다. 권한이 서로 어떻게 맞물리는지(팀, 범위, 소유자, 차단)는 [사용자, 팀 및 권한](/docs/permissions/index)부터 읽어 보세요.

## 표 읽는 방법

각 역할과 권한에는 다음 열이 있는 행이 하나씩 있습니다.

- **역할** 또는 **권한**: 대시보드에 표시되는 이름입니다.
- **권한 키**: [API](/docs/api-reference/api-reference), [CLI](/docs/cli/index), [Terraform 공급자](/docs/terraform/index)에서 사용하는 값입니다.
- **범위**(역할만 해당): `전체, 소유 또는 라벨`은 역할을 부여할 때 그 적용 범위를 직접 고른다는 뜻입니다. `프로젝트 전체만`은 역할이 항상 프로젝트 전체에 적용된다는 뜻입니다.
- **라벨로 제한**(권한만 해당): `예`는 이 권한의 부여를 특정 라벨이 붙은 리소스로 제한할 수 있다는 뜻입니다.
- **설명**: 역할이나 권한이 허용하는 작업입니다.

> [!TIP]
> 먼저 역할을 고르세요. 역할은 OneUptime에 기능이 추가되어도 계속 올바르게 유지되지만, 개별 권한 목록은 직접 최신 상태로 관리해야 합니다.

## 역할

역할은 {{PERMISSION_ROLE_COUNT}}개입니다. 그중 Project Owner, Project Admin, Project Member, Viewer의 네 가지는 프로젝트 전체에 적용됩니다. 나머지 역할은 각각 인시던트나 모니터 같은 하나의 제품 영역을 Admin, Member, Viewer 수준으로 다룹니다. 팀의 **권한** 페이지와 API 키 페이지에서 **역할 추가**가 제시하는 것이 바로 이 역할들입니다.

{{PERMISSION_ROLE_TABLES}}

## 세분화된 권한

{{PERMISSION_GROUP_COUNT}}개 그룹에 걸친 {{PERMISSION_TOTAL_COUNT}}개의 개별 기능입니다. 역할이 필요한 것보다 넓을 때 팀이나 API 키에 대해 **권한 추가**가 제시하는 것이 바로 이 권한들입니다.

{{PERMISSION_GRANULAR_TABLES}}

## 다음 단계

:::cards
- [사용자, 팀 및 권한](/docs/permissions/index): 팀, 범위, 소유자, 차단이 누가 무엇을 할 수 있는지 어떻게 결정하는지 알아봅니다.
- [API 참조](/docs/api-reference/api-reference): API 키에 권한 키를 사용합니다.
- [Terraform 공급자](/docs/terraform/index): 팀과 그 권한을 코드로 관리합니다.
:::
