# 권한 레퍼런스

OneUptime이 부여할 수 있는 모든 권한을, 대시보드의 권한 선택기와 똑같은 방식으로 묶어 정리했습니다.

이 페이지는 요청 시점에 OneUptime 소스 코드에서 생성됩니다. 대시보드와 API, Terraform 프로바이더가 사용하는 것과 같은 목록이므로 제품과 어긋날 수 없고, 지금 실행 중인 버전을 그대로 반영합니다.

전체 구조(팀, 범위, 소유자, 차단)가 궁금하다면 [사용자, 팀 및 권한](/docs/permissions/index)부터 읽어 보세요.

**권한 키** 열의 값은 [API](/docs/api-reference/api-reference), [CLI](/docs/cli/index), [Terraform 프로바이더](/docs/terraform/index)에서 사용합니다. 제목은 대시보드에 표시되는 이름입니다.

## 역할

{{PERMISSION_ROLE_COUNT}}개의 역할이 있으며, 각각 하나의 제품 영역을 Admin / Member / Viewer 수준으로 묶습니다. 팀에 권한을 추가할 때 **역할** 선택기가 제시하는 것이 이 목록입니다.

**범위** 열은 부여할 때 역할을 좁힐 수 있는지 보여 줍니다. `전체, 소유 또는 라벨`은 선택할 수 있다는 뜻이고, `프로젝트 전체만`은 역할이 항상 프로젝트 전체에 적용된다는 뜻입니다.

{{PERMISSION_ROLE_TABLES}}

## 세분화된 권한

{{PERMISSION_GROUP_COUNT}}개 그룹에 걸친 {{PERMISSION_TOTAL_COUNT}}개의 개별 기능입니다. **세분화** 선택기가 제시하는 것이 이 목록이며, API 키에 할당하는 것도 이것입니다.

**라벨로 제한** 열은 이 권한의 부여를 특정 라벨이 붙은 리소스로 한정할 수 있는지 보여 줍니다.

{{PERMISSION_GRANULAR_TABLES}}
