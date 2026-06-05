# GitLab 통합

OneUptime 인시던트가 생성될 때 자동으로 [GitLab](https://gitlab.com) 이슈를 열어 — 영향받은 서비스를 소유하는 프로젝트에서 엔지니어링 후속 작업이 이루어지도록 합니다.

이 통합은 **아웃바운드**: OneUptime이 [GitLab REST API](https://docs.gitlab.com/ee/api/issues.html)를 호출합니다. **Incident → On Create** 트리거와 **API 컴포넌트** 를 갖춘 OneUptime **[Workflow](/docs/workflows/index)** 를 사용합니다. GitLab.com과 자체 관리형 GitLab 모두 동일하게 동작합니다.

```text
OneUptime Incident → On Create  ──►  API component (POST /projects/{id}/issues)  ──►  GitLab issue
```

## 사전 요건

- GitLab 프로젝트와 해당 **Project ID** (프로젝트 이름 아래 프로젝트 개요 페이지에 표시됨).
- 이슈를 만들 수 있는 액세스 토큰 — `api` 범위의 **프로젝트**, **그룹**, 또는 **개인 액세스 토큰**: **Settings → Access Tokens**.
- 워크플로를 만들 수 있는 OneUptime 프로젝트.

## 1단계 — 토큰 저장

1. **Workflows → Global Variables → Create** 로 이동합니다.
2. 이름을 `GITLAB_TOKEN` 으로 지정하고 토큰을 붙여넣고 **Is Secret** 를 켭니다.

## 2단계 — 워크플로 구성

1. **Workflows → Create Workflow** 를 열고, 이름을 `Incidents → GitLab Issues` 로 지정하고 **Builder** 를 엽니다.
2. **Incident** 트리거를 **On Create** 로 설정해 추가합니다. 이름을 `Incident` 로 변경합니다.
3. 트리거에 연결된 **API** 블록을 추가합니다:
   - **Method**: `POST`
   - **URL**: `https://gitlab.com/api/v4/projects/12345678/issues`  *(`12345678` 을 Project ID로 교체합니다. 자체 관리형의 경우 자체 호스트 사용)*
   - **Headers**:

     ```text
     PRIVATE-TOKEN: {{variable.GITLAB_TOKEN}}
     Content-Type: application/json
     ```

   - **Body**:

     ```json
     {
       "title": "OneUptime incident: {{Incident.title}}",
       "description": "{{Incident.description}}\n\nFiled automatically from OneUptime.",
       "labels": "incident,oneuptime"
     }
     ```

4. **Save** 하고, 활성화하고, 테스트 인시던트를 만듭니다. 워크플로 로그에서 `201 Created` 가 나오면 이슈가 생성된 것입니다. 응답 본문에 `iid` 와 `web_url` 이 포함됩니다.

## 팁

- **자체 관리형 GitLab**: `https://gitlab.com` 을 인스턴스 URL로 교체합니다. `/api/v4/...` 경로는 동일하게 유지됩니다.
- **ID 대신 프로젝트 경로**: 숫자 ID 대신 URL 인코딩된 경로를 사용할 수 있습니다 — 예: `group%2Fproject`.
- **담당자 / 마감일**: 본문에 `"assignee_ids": [42]` 또는 `"due_date": "2026-01-31"` 을 추가합니다.
- **링크 백**: `{{CreateIssue.response-body.web_url}}` 을 읽고 **Update Incident** 블록으로 인시던트에 저장합니다.

## 문제 해결

- **`401`** — 토큰이 유효하지 않거나 만료되었거나 `api` 범위가 없습니다.
- **`404`** — Project ID가 잘못되었거나 토큰이 비공개 프로젝트에 접근할 수 없습니다.
- **`400`** — 필수 필드가 누락되거나 잘못된 형식입니다. `title` 은 필수입니다.

## 다음에 읽어 볼 내용

- [통합 개요](/docs/integrations/index) — 패턴과 인증 빠른 참조.
- [GitHub](/docs/integrations/github) — GitHub에 대한 동일한 아이디어.
- [API 컴포넌트](/docs/workflows/components#api) — 응답 본문 읽기.
